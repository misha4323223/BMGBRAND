import { logError, logWarn } from "../logger";
import {
  deleteFromYandexStorage,
  downloadBinaryFromYandexStorage,
  downloadFromYandexStorage,
  listCommonPrefixesFromYandexStorage,
  listObjectsFromYandexStorage,
  putObjectToYandexStorage,
} from "./storage-s3";

/**
 * Приём файлов 1С по фрагментам.
 *
 * В ответе на `mode=init` сайт сообщает 1С `file_limit` — максимально допустимый
 * размер файла за один запрос. Файл больше лимита 1С режет на части и шлёт их
 * ОДНИМ И ТЕМ ЖЕ запросом `mode=file&filename=...` (номера части в протоколе нет,
 * части идут строго по порядку, каждая часть — не больше file_limit байт).
 * По контракту протокола сайт просто дописывает полученное содержимое к файлу;
 * последняя часть ничем не помечена, поэтому здесь мы только накапливаем части,
 * а готовый файл публикует вызывающий код (flushPendingOneCFiles в routes.ts):
 * следующий запрос 1С (другой файл или `mode=import`) гарантирует, что предыдущий
 * файл дослан целиком — тогда он публикуется сразу, без искусственных пауз.
 *
 * Зачем это нужно: Yandex Serverless Containers режет запросы больше 3.5 МБ
 * (включая заголовки), поэтому объявлять 1С большой file_limit нельзя — большие
 * фото и XML приезжали битыми. 2 МиБ оставляют запас и под лимит контейнера,
 * и под 2.5 МБ API Gateway.
 *
 * Сборка живёт в Object Storage, а не в памяти процесса: запросы 1С синхронные
 * и последовательные, но могут попадать в разные экземпляры контейнера.
 */

export const ONEC_FILE_PART_LIMIT = 2 * 1024 * 1024;

/** Служебный префикс сборки в бакете (не под products/, чтобы не мешать картинкам). */
const PARTS_PREFIX = "1c_parts";
/** Пауза между фрагментами, после которой незавершённую сборку считаем новой загрузкой. */
const ASSEMBLY_IDLE_RESET_MS = 3 * 60 * 1000;
/** Брошенные сборки старше этого времени сносим на старте сессии обмена. */
export const ONEC_ASSEMBLY_STALE_MS = 60 * 60 * 1000;
/** Предохранитель от бесконечной сборки: максимальный размер одного файла 1С. */
const ASSEMBLY_MAX_BYTES = 256 * 1024 * 1024;

type AssemblyMeta = {
  type: string;
  filename: string;
  parts: number;
  bytes: number;
  updatedAt: number;
};

export type OneCFilePartResult = {
  /** Сколько фрагментов уже собрано. */
  parts: number;
  /** Сколько байт уже собрано. */
  bytes: number;
  /** Если задано — фрагмент не сохранён, 1С нужно ответить `failure`. */
  error?: string;
};

export type PendingOneCFile = {
  type: string;
  filename: string;
  data: Buffer;
  parts: number;
};

/** Ключ сборки: тип обмена + имя файла из GET-параметра `filename` (как его шлёт 1С). */
export function oneCFileKey(type: string, filename: string): string {
  return `${type}/${filename}`;
}

/** Локальный фолбэк для dev-окружения без Object Storage (один экземпляр процесса). */
const memoryAssemblies = new Map<string, { chunks: Buffer[]; updatedAt: number }>();

function isStorageConfigured(): boolean {
  return Boolean(
    process.env.YANDEX_STORAGE_BUCKET_NAME &&
      process.env.YANDEX_STORAGE_ACCESS_KEY &&
      process.env.YANDEX_STORAGE_SECRET_KEY,
  );
}

/**
 * Файл всегда начинается с сигнатуры (JPEG/PNG/GIF/WebP) или объявления `<?xml`.
 * Если фрагмент начинается так, а сборка уже есть — это НОВАЯ загрузка файла
 * (например, повторная выгрузка после оборвавшегося обмена), а не продолжение.
 */
function looksLikeFileStart(body: Buffer): boolean {
  if (body.length < 5) return false;
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return true; // JPEG
  if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) return true; // PNG
  if (body[0] === 0x47 && body[1] === 0x49 && body[2] === 0x46) return true; // GIF
  if (
    body.subarray(0, 4).toString("ascii") === "RIFF" &&
    body.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return true;
  }
  if (body.subarray(0, 5).toString("utf-8") === "<?xml") return true;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf && body.subarray(3, 8).toString("utf-8") === "<?xml") {
    return true; // UTF-8 BOM + <?xml
  }
  // XML без объявления: корень CommerceML — единственное место в файле,
  // с которого может начинаться фрагмент, кроме первого (в середине его нет).
  if (body.subarray(0, 64).toString("utf-8").startsWith("<КоммерческаяИнформация")) return true;
  return false;
}

/**
 * Проверка, что собранные байты — целый файл, а не обрезок: шлюз режет запросы
 * на 3.5 МБ, а обмен 1С может оборваться посреди файла. Неполный файл
 * публиковать нельзя — именно так и получались «битые» картинки.
 * Неизвестные расширения не блокируем.
 */
function looksLikeCompleteFile(filename: string, data: Buffer): boolean {
  const name = filename.toLowerCase();

  if (/\.(jpg|jpeg)$/.test(name)) {
    if (!(data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)) return false;
    const tail = data.subarray(Math.max(0, data.length - 64));
    for (let i = 0; i < tail.length - 1; i++) {
      if (tail[i] === 0xff && tail[i + 1] === 0xd9) return true; // маркер конца JPEG (EOI)
    }
    return false;
  }
  if (/\.png$/.test(name)) {
    if (!(data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47)) return false;
    return data.subarray(Math.max(0, data.length - 32)).includes(Buffer.from("IEND"));
  }
  if (/\.gif$/.test(name)) {
    if (!(data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46)) return false;
    return data.subarray(Math.max(0, data.length - 8)).includes(0x3b);
  }
  if (/\.webp$/.test(name)) {
    if (data.length < 12) return false;
    if (data.subarray(0, 4).toString("ascii") !== "RIFF" || data.subarray(8, 12).toString("ascii") !== "WEBP") {
      return false;
    }
    return data.readUInt32LE(4) === data.length - 8;
  }
  if (/\.xml$/.test(name)) {
    const tail = data.subarray(Math.max(0, data.length - 512)).toString("utf-8").trimEnd();
    return tail.endsWith(">") && tail.includes("</");
  }
  return true;
}

function assemblyPrefix(type: string, filename: string): string {
  return `${PARTS_PREFIX}/${encodeURIComponent(type)}/${encodeURIComponent(filename)}/`;
}

function partObjectKey(prefix: string, index: number): string {
  return `${prefix}part-${String(index).padStart(6, "0")}`;
}

function decodeAssemblyPrefix(prefix: string): { type: string; filename: string } | null {
  const [root, type, filename] = prefix.replace(/\/+$/, "").split("/");
  if (root !== PARTS_PREFIX || !type || !filename) return null;
  try {
    return { type: decodeURIComponent(type), filename: decodeURIComponent(filename) };
  } catch {
    return null;
  }
}

async function readMeta(prefix: string): Promise<AssemblyMeta | null> {
  const raw = await downloadFromYandexStorage(`${prefix}meta.json`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.parts === "number" && typeof parsed.bytes === "number") {
      return parsed as AssemblyMeta;
    }
  } catch {
    logWarn(`[1C PARTS] Повреждённые метаданные сборки: ${prefix}meta.json`);
  }
  return null;
}

async function writeMeta(prefix: string, meta: AssemblyMeta): Promise<boolean> {
  const url = await putObjectToYandexStorage(
    Buffer.from(JSON.stringify(meta)),
    `${prefix}meta.json`,
    "application/json",
    "no-store",
  );
  return Boolean(url);
}

/** Все сборки, лежащие в бакете (по «папкам», без перечисления каждого фрагмента). */
async function listPendingAssemblies(): Promise<Array<{ type: string; filename: string }>> {
  const found: Array<{ type: string; filename: string }> = [];
  for (const type of ["catalog", "sale"]) {
    const prefixes = await listCommonPrefixesFromYandexStorage(
      `${PARTS_PREFIX}/${encodeURIComponent(type)}/`,
    );
    for (const prefix of prefixes) {
      const decoded = decodeAssemblyPrefix(prefix);
      if (decoded) found.push(decoded);
    }
  }
  return found;
}

async function dropAssemblyObjects(prefix: string): Promise<void> {
  const keys = await listObjectsFromYandexStorage(prefix);
  await Promise.all(keys.map((key) => deleteFromYandexStorage(key)));
}

/**
 * Принять очередной фрагмент файла 1С. Файл никогда не публикуется здесь:
 * см. `collectPendingOneCFiles` + `dropOneCAssembly` у вызывающего кода.
 */
export async function accumulateOneCFilePart(
  type: string,
  filename: string,
  body: Buffer,
): Promise<OneCFilePartResult> {
  if (!body || body.length === 0) {
    return { parts: 0, bytes: 0, error: "Empty file body" };
  }
  if (!isStorageConfigured()) {
    return accumulateInMemory(type, filename, body);
  }

  const prefix = assemblyPrefix(type, filename);
  const meta = await readMeta(prefix);
  const now = Date.now();
  const restart = Boolean(meta) && looksLikeFileStart(body);
  if (restart) {
    logWarn(`[1C PARTS] ${oneCFileKey(type, filename)}: пришло начало файла, старая сборка сброшена`);
  }
  const continueAssembly = Boolean(meta && !restart && now - meta.updatedAt <= ASSEMBLY_IDLE_RESET_MS);
  const parts = continueAssembly && meta ? meta.parts : 0;
  const bytes = (continueAssembly && meta ? meta.bytes : 0) + body.length;

  if (bytes > ASSEMBLY_MAX_BYTES) {
    await dropAssemblyObjects(prefix);
    return { parts: 0, bytes: 0, error: `файл больше ${ASSEMBLY_MAX_BYTES} байт` };
  }

  const partSaved = await putObjectToYandexStorage(
    body,
    partObjectKey(prefix, parts),
    "application/octet-stream",
    "no-store",
  );
  if (!partSaved) {
    logError(`[1C PARTS] Не удалось сохранить фрагмент ${parts} файла ${oneCFileKey(type, filename)}`);
    return { parts, bytes: bytes - body.length, error: "не удалось сохранить фрагмент файла" };
  }

  if (!(await writeMeta(prefix, { type, filename, parts: parts + 1, bytes, updatedAt: now }))) {
    await deleteFromYandexStorage(partObjectKey(prefix, parts));
    return { parts, bytes: bytes - body.length, error: "не удалось сохранить состояние сборки" };
  }

  return { parts: parts + 1, bytes };
}

/**
 * Результат чтения сборки: целый файл, пусто, слишком свежая сборка
 * (её ещё дописывают) или мусор (сборка удалена).
 */
type AssemblyReadResult =
  | { kind: "ready"; data: Buffer; parts: number }
  | { kind: "empty" }
  | { kind: "skipped" }
  | { kind: "broken"; reason: string };

async function readAssembly(type: string, filename: string, minIdleMs = 0): Promise<AssemblyReadResult> {
  const prefix = assemblyPrefix(type, filename);
  const meta = await readMeta(prefix);
  if (!meta || meta.parts <= 0) {
    await dropAssemblyObjects(prefix);
    return { kind: "empty" };
  }
  if (minIdleMs > 0 && Date.now() - meta.updatedAt < minIdleMs) return { kind: "skipped" };

  const chunks: Buffer[] = [];
  for (let i = 0; i < meta.parts; i++) {
    const chunk = await downloadBinaryFromYandexStorage(partObjectKey(prefix, i));
    if (!chunk || chunk.length === 0) {
      await dropAssemblyObjects(prefix);
      return { kind: "broken", reason: `фрагмент ${i} не найден в Object Storage` };
    }
    chunks.push(chunk);
  }

  const data = Buffer.concat(chunks);
  if (!looksLikeCompleteFile(filename, data)) {
    await dropAssemblyObjects(prefix);
    return { kind: "broken", reason: `собранные ${data.length} Б не похожи на целый файл` };
  }
  return { kind: "ready", data, parts: meta.parts };
}

function readMemoryAssembly(type: string, filename: string, minIdleMs = 0): AssemblyReadResult {
  const key = oneCFileKey(type, filename);
  const assembly = memoryAssemblies.get(key);
  if (!assembly || assembly.chunks.length === 0) {
    memoryAssemblies.delete(key);
    return { kind: "empty" };
  }
  if (minIdleMs > 0 && Date.now() - assembly.updatedAt < minIdleMs) return { kind: "skipped" };

  const data = Buffer.concat(assembly.chunks);
  if (!looksLikeCompleteFile(filename, data)) {
    memoryAssemblies.delete(key);
    return { kind: "broken", reason: `собранные ${data.length} Б не похожи на целый файл` };
  }
  return { kind: "ready", data, parts: assembly.chunks.length };
}

/**
 * Решение «быстрого пути» для `flushPendingOneCFiles` в routes.ts: публиковать
 * ли файл `previousKey` сразу. Считаем, что он дослан, если фрагменты принимал
 * этот экземпляр контейнера последним, а 1С уже перешла к другому файлу или к
 * другому шагу обмена (протокол синхронный). Тип обмена обязан совпадать:
 * catalog и sale идут независимыми сессиями и могут перекрываться по времени —
 * чужой обмен нельзя считать «перешедшим дальше».
 */
export function fastPublishDecision(
  previousKey: string | null,
  currentKey: string | undefined,
  exchangeType: string,
): { type: string; filename: string } | null {
  if (!previousKey || previousKey === currentKey) return null;
  const separator = previousKey.indexOf("/");
  const type = previousKey.slice(0, separator);
  if (type !== exchangeType) return null;
  return { type, filename: previousKey.slice(separator + 1) };
}

/**
 * Отдать одну конкретную сборку (если она целая). Нужно для «быстрого пути»:
 * экземпляр контейнера, принимавший части файла, публикует его без обхода бакета.
 * Сборку не удаляет — это делает вызывающий после успешной публикации.
 */
export async function collectOneCFile(type: string, filename: string): Promise<PendingOneCFile | null> {
  const read = isStorageConfigured() ? await readAssembly(type, filename) : readMemoryAssembly(type, filename);
  if (read.kind === "broken") {
    logWarn(`[1C PARTS] ${oneCFileKey(type, filename)}: ${read.reason} — не публикую`);
  }
  if (read.kind !== "ready") return null;
  return { type, filename, data: read.data, parts: read.parts };
}

/**
 * Отдать все собранные, но ещё не опубликованные файлы (кроме `exceptKey` —
 * это файл, который прямо сейчас продолжает приниматься).
 * `minIdleMs` защищает от публикации сборки, которую прямо сейчас дописывает
 * ДРУГОЙ экземпляр контейнера: такую сборку трогаем только после паузы.
 * Вызывающий публикует файлы и затем снимает сборку через `dropOneCAssembly`.
 */
export async function collectPendingOneCFiles(exceptKey?: string, minIdleMs = 0): Promise<PendingOneCFile[]> {
  const result: PendingOneCFile[] = [];

  if (!isStorageConfigured()) {
    for (const key of Array.from(memoryAssemblies.keys())) {
      if (key === exceptKey) continue;
      const separator = key.indexOf("/");
      const type = key.slice(0, separator);
      const filename = key.slice(separator + 1);
      const read = readMemoryAssembly(type, filename, minIdleMs);
      if (read.kind === "broken") {
        logWarn(`[1C PARTS] ${key}: ${read.reason} — не публикую`);
        continue;
      }
      if (read.kind === "ready") result.push({ type, filename, data: read.data, parts: read.parts });
    }
    return result;
  }

  for (const { type, filename } of await listPendingAssemblies()) {
    if (oneCFileKey(type, filename) === exceptKey) continue;
    const read = await readAssembly(type, filename, minIdleMs);
    if (read.kind === "broken") {
      logWarn(`[1C PARTS] ${oneCFileKey(type, filename)}: ${read.reason} — не публикую`);
      continue;
    }
    if (read.kind === "ready") result.push({ type, filename, data: read.data, parts: read.parts });
  }

  return result;
}

/** Удалить сборку после успешной публикации файла. */
export async function dropOneCAssembly(type: string, filename: string): Promise<void> {
  if (!isStorageConfigured()) {
    memoryAssemblies.delete(oneCFileKey(type, filename));
    return;
  }
  await dropAssemblyObjects(assemblyPrefix(type, filename));
}

/**
 * Снести брошенные сборки (например, после оборвавшегося обмена 1С).
 * Вызывается на старте сессии (`mode=init`), чтобы повторная выгрузка
 * того же файла не дописалась к «хвостам» прошлой попытки.
 */
export async function discardStaleOneCPartAssemblies(maxIdleMs = ONEC_ASSEMBLY_STALE_MS): Promise<void> {
  const now = Date.now();

  if (!isStorageConfigured()) {
    for (const [key, assembly] of Array.from(memoryAssemblies.entries())) {
      if (now - assembly.updatedAt > maxIdleMs) memoryAssemblies.delete(key);
    }
    return;
  }

  for (const { type, filename } of await listPendingAssemblies()) {
    const prefix = assemblyPrefix(type, filename);
    const meta = await readMeta(prefix);
    if (meta && now - meta.updatedAt <= maxIdleMs) continue;
    logWarn(
      `[1C PARTS] Удаляю брошенную сборку ${oneCFileKey(type, filename)}` +
        (meta ? ` (${meta.parts} фрагм., ${meta.bytes} Б)` : " (без метаданных)"),
    );
    await dropAssemblyObjects(prefix);
  }
}

function accumulateInMemory(type: string, filename: string, body: Buffer): OneCFilePartResult {
  const key = oneCFileKey(type, filename);
  const now = Date.now();
  const existing = memoryAssemblies.get(key);
  const restart = Boolean(existing) && looksLikeFileStart(body);
  const continueAssembly = Boolean(existing && !restart && now - existing.updatedAt <= ASSEMBLY_IDLE_RESET_MS);
  const assembly = continueAssembly && existing ? existing : { chunks: [] as Buffer[], updatedAt: now };

  const bytes = assembly.chunks.reduce((sum, chunk) => sum + chunk.length, 0) + body.length;
  if (bytes > ASSEMBLY_MAX_BYTES) {
    memoryAssemblies.delete(key);
    return { parts: 0, bytes: 0, error: `файл больше ${ASSEMBLY_MAX_BYTES} байт` };
  }

  assembly.chunks.push(body);
  assembly.updatedAt = now;
  memoryAssemblies.set(key, assembly);
  return { parts: assembly.chunks.length, bytes };
}
