import { describe, it, expect, beforeEach } from "vitest";
import {
  ONEC_FILE_PART_LIMIT,
  accumulateOneCFilePart,
  collectOneCFile,
  collectPendingOneCFiles,
  dropOneCAssembly,
  fastPublishDecision,
  oneCFileKey,
  type PendingOneCFile,
} from "../lib/one-c-file-parts";

// Приём файлов 1С по фрагментам — см. `.agents/memory/1c-file-parts.md`.
// Object Storage не нужен: без креденшелов модуль использует тот же алгоритм
// на локальном фолбэке в памяти процесса.
delete process.env.YANDEX_STORAGE_BUCKET_NAME;
delete process.env.YANDEX_STORAGE_ACCESS_KEY;
delete process.env.YANDEX_STORAGE_SECRET_KEY;

/** Мини-JPEG: сигнатура, ровное «тело» и маркер конца — проверка целостности его пропускает. */
function jpeg(size: number): Buffer {
  const buf = Buffer.alloc(size, 0x2a);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(buf, 0);
  buf.writeUInt16BE(0xffd9, size - 2);
  return buf;
}

/** Так 1С режет файл по file_limit: части по лимиту, последняя — меньше. */
function splitIntoParts(file: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < file.length; offset += ONEC_FILE_PART_LIMIT) {
    parts.push(file.subarray(offset, offset + ONEC_FILE_PART_LIMIT));
  }
  return parts;
}

/** Забрать и снять все сборки (как это делает routes.ts после публикации). */
async function drain(exceptKey?: string, minIdleMs = 0): Promise<PendingOneCFile[]> {
  const pending = await collectPendingOneCFiles(exceptKey, minIdleMs);
  for (const file of pending) {
    await dropOneCAssembly(file.type, file.filename);
  }
  return pending;
}

describe("1С: склейка файлов из фрагментов", () => {
  beforeEach(async () => {
    await drain();
  });

  it("пустой фрагмент отклоняется", async () => {
    const result = await accumulateOneCFilePart("catalog", "empty.jpg", Buffer.alloc(0));
    expect(result.error).toBe("Empty file body");
  });

  it("одиночный файл собирается и отдаётся целиком", async () => {
    const xml = Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?><КоммерческаяИнформация><Каталог/></КоммерческаяИнформация>',
      "utf-8",
    );
    const part = await accumulateOneCFilePart("catalog", "import.xml", xml);
    expect(part.error).toBeUndefined();
    expect(part.parts).toBe(1);
    expect(part.bytes).toBe(xml.length);

    const pending = await drain();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe("catalog");
    expect(pending[0].filename).toBe("import.xml");
    expect(pending[0].data.equals(xml)).toBe(true);
  });

  it("фрагментированное фото склеивается без потерь (3 фрагмента)", async () => {
    const photoKey = "import_files/aa/photo.jpg";
    const bigPhoto = jpeg(ONEC_FILE_PART_LIMIT * 2 + 12345);
    const parts = splitIntoParts(bigPhoto);
    expect(parts).toHaveLength(3);

    for (const part of parts) {
      const result = await accumulateOneCFilePart("catalog", photoKey, part);
      expect(result.error).toBeUndefined();
    }

    // Текущий файл-продолжение не публикуется раньше времени.
    expect(await drain(oneCFileKey("catalog", photoKey))).toHaveLength(0);

    const pending = await drain();
    expect(pending).toHaveLength(1);
    expect(pending[0].parts).toBe(3);
    expect(pending[0].data.equals(bigPhoto)).toBe(true);
  });

  it("обрезок файла (обмен оборвался) не публикуется", async () => {
    const photoKey = "import_files/bb/broken.jpg";
    const photo = jpeg(ONEC_FILE_PART_LIMIT * 2);
    // Дошёл первый фрагмент и половина второго: конца файла (JPEG EOI) нет.
    await accumulateOneCFilePart("catalog", photoKey, photo.subarray(0, ONEC_FILE_PART_LIMIT));
    await accumulateOneCFilePart("catalog", photoKey, photo.subarray(ONEC_FILE_PART_LIMIT, photo.length - 500_000));

    expect(await drain()).toHaveLength(0);

    // Повторная выгрузка файла не склеивается с обрывком: сигнатура сбрасывает сборку.
    const retry = jpeg(ONEC_FILE_PART_LIMIT);
    const result = await accumulateOneCFilePart("catalog", photoKey, retry);
    expect(result.parts).toBe(1);
    expect(result.bytes).toBe(retry.length);
    expect((await drain())[0].data.equals(retry)).toBe(true);
  });

  it("свежую сборку обход бакета не трогает, а быстрый путь публикует сразу", async () => {
    const photoKey = "import_files/cc/fresh.jpg";
    const photo = jpeg(ONEC_FILE_PART_LIMIT);
    await accumulateOneCFilePart("catalog", photoKey, photo);

    // Полный обход не берёт сборку, которую может дописывать другой экземпляр...
    expect(await drain(undefined, 20_000)).toHaveLength(0);
    // ...а публикация по конкретному ключу (следующий файл/import) — сразу.
    const fast = await collectOneCFile("catalog", photoKey);
    expect(fast?.data.equals(photo)).toBe(true);

    const pending = await drain();
    expect(pending).toHaveLength(1);
  });

  it("повторная выгрузка не склеивается с хвостом оборвавшегося обмена", async () => {
    const photoKey = "import_files/aa/photo.jpg";
    // Успел прийти первый фрагмент старой загрузки (2 МиБ без сигнатуры файла).
    await accumulateOneCFilePart("catalog", photoKey, Buffer.alloc(ONEC_FILE_PART_LIMIT, 0x2a));

    // Новая выгрузка: 1С снова шлёт файл с начала — он начинается с JPEG-сигнатуры.
    const restartFirstPart = jpeg(ONEC_FILE_PART_LIMIT);
    const result = await accumulateOneCFilePart("catalog", photoKey, restartFirstPart);
    expect(result.parts).toBe(1);
    expect(result.bytes).toBe(restartFirstPart.length);

    const pending = await drain();
    expect(pending).toHaveLength(1);
    expect(pending[0].data.equals(restartFirstPart)).toBe(true);
  });

  it("принимаемый файл не мешает публикации предыдущего", async () => {
    const part = jpeg(ONEC_FILE_PART_LIMIT);
    await accumulateOneCFilePart("catalog", "a.jpg", part);
    await accumulateOneCFilePart("catalog", "b.jpg", part);

    const pending = await drain(oneCFileKey("catalog", "b.jpg"));
    expect(pending).toHaveLength(1);
    expect(pending[0].filename).toBe("a.jpg");
  });

  it("новый XML без объявления тоже начинает сборку заново", async () => {
    const xmlKey = "import.xml";
    // Хвост оборвавшегося обмена: 2 МиБ без начала файла.
    await accumulateOneCFilePart("catalog", xmlKey, Buffer.alloc(ONEC_FILE_PART_LIMIT, 0x20));

    const xml = Buffer.from("<КоммерческаяИнформация><Каталог></Каталог></КоммерческаяИнформация>", "utf-8");
    const result = await accumulateOneCFilePart("catalog", xmlKey, xml);
    expect(result.parts).toBe(1);
    expect(result.bytes).toBe(xml.length);

    const pending = await drain();
    expect(pending).toHaveLength(1);
    expect(pending[0].data.equals(xml)).toBe(true);
  });

  it("быстрый путь: файл дослан, когда 1С перешла дальше — и только в своём обмене", () => {
    const keyA = oneCFileKey("catalog", "photo-a.jpg");
    const keyB = oneCFileKey("catalog", "photo-b.jpg");

    // Продолжение того же файла — публиковать нельзя.
    expect(fastPublishDecision(keyA, keyA, "catalog")).toBeNull();
    // Пришёл следующий файл каталога — предыдущий дослан.
    expect(fastPublishDecision(keyA, keyB, "catalog")).toEqual({ type: "catalog", filename: "photo-a.jpg" });
    // mode=import/query (файла в запросе нет) — тоже дослан.
    expect(fastPublishDecision(keyA, undefined, "catalog")).toEqual({ type: "catalog", filename: "photo-a.jpg" });
    // Параллельная сессия sale не должна считать чужой файл досланным.
    expect(fastPublishDecision(keyA, oneCFileKey("sale", "photo-b.jpg"), "sale")).toBeNull();
    expect(fastPublishDecision(keyA, undefined, "sale")).toBeNull();
    // Сборок не было — публиковать нечего.
    expect(fastPublishDecision(null, keyB, "catalog")).toBeNull();
  });

  it("обмен целиком: каждый файл публикуется один раз и без примесей", async () => {
    const photoA = jpeg(ONEC_FILE_PART_LIMIT * 2 + 77);
    const photoB = jpeg(ONEC_FILE_PART_LIMIT);

    for (const part of splitIntoParts(photoA)) {
      const result = await accumulateOneCFilePart("catalog", "photo-a.jpg", part);
      expect(result.error).toBeUndefined();
    }

    // Пришёл файл B — публикуем A по решению быстрого пути.
    const forA = fastPublishDecision(
      oneCFileKey("catalog", "photo-a.jpg"),
      oneCFileKey("catalog", "photo-b.jpg"),
      "catalog",
    );
    expect(forA).not.toBeNull();
    const readyA = await collectOneCFile(forA!.type, forA!.filename);
    expect(readyA?.parts).toBe(3);
    expect(readyA?.data.equals(photoA)).toBe(true);
    await dropOneCAssembly(forA!.type, forA!.filename);

    // Приняли B целиком (1 фрагмент)...
    const partB = await accumulateOneCFilePart("catalog", "photo-b.jpg", photoB);
    expect(partB.parts).toBe(1);

    // ...и на mode=import публикуем его же.
    const forB = fastPublishDecision(oneCFileKey("catalog", "photo-b.jpg"), undefined, "catalog");
    expect(forB).not.toBeNull();
    const readyB = await collectOneCFile(forB!.type, forB!.filename);
    expect(readyB?.data.equals(photoB)).toBe(true);
    await dropOneCAssembly(forB!.type, forB!.filename);

    // Ничего не осталось — повторная публикация невозможна.
    expect(await drain()).toHaveLength(0);
  });
});
