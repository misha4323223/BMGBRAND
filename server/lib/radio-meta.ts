import https from "https";
import type { IncomingMessage } from "http";

/**
 * ICY-метаданные потока (Icecast/Shoutcast).
 *
 * Станция отдаёт `icy-metaint: N` в ответ на заголовок `Icy-MetaData: 1`:
 * каждые N байт аудио встроен блок метаданных, длина которого —
 * первый байт блока × 16. Название трека лежит в блоке как `StreamTitle='...';`.
 *
 * Всё, что здесь есть — чистые функции (тестируются без сети) + один сетевой
 * хелпер `fetchIcyStreamTitle`, который читает ровно один блок и закрывает соединение.
 */

export interface IcyScanResult {
  /** Найденный `StreamTitle` (null — если в просмотренных блоках пусто). */
  title: string | null;
  /** Хвост буфера, который ещё не был разобран (границы блоков учтены). */
  rest: Buffer;
}

export function parseIcyStreamTitle(block: Buffer | string): string | null {
  const text = typeof block === "string" ? block : block.toString("utf8");
  const match = /StreamTitle\s*=\s*'([^']*)'/i.exec(text);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

/**
 * Просматривает буфер, начиная с первой границы метаданных, и возвращает
 * первое найденное название. Пустые блоки пропускаются (у живых потоков
 * первый блок часто пустой, а `StreamTitle` появляется в следующем).
 */
export function scanIcyBuffer(buffer: Buffer, metaint: number): IcyScanResult {
  if (!Number.isFinite(metaint) || metaint <= 0) {
    return { title: null, rest: Buffer.alloc(0) };
  }
  let offset = 0;
  while (buffer.length - offset >= metaint + 1) {
    const metaLength = buffer[offset + metaint] * 16;
    if (buffer.length - offset < metaint + 1 + metaLength) break;
    const title = parseIcyStreamTitle(
      buffer.subarray(offset + metaint + 1, offset + metaint + 1 + metaLength),
    );
    if (title) return { title, rest: buffer.subarray(offset) };
    offset += metaint + 1 + metaLength;
  }
  return { title: null, rest: buffer.subarray(offset) };
}

export interface FetchIcyTitleOptions {
  /** Общий таймаут запроса, мс. */
  timeoutMs?: number;
  /** Защита от утечки памяти: больше этого объёма не читаем. */
  maxBytes?: number;
}

/**
 * Читает название текущего трека из ICY-потока.
 * Никогда не отклоняется: при любой проблеме возвращает null,
 * а вызывающая сторона (кэширующий роут) просто отдаст «нет данных».
 */
export function fetchIcyStreamTitle(
  streamUrl: string,
  options: FetchIcyTitleOptions = {},
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxBytes = options.maxBytes ?? 256 * 1024;

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let request: ReturnType<typeof https.get> | null = null;

    const finish = (title: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      request?.destroy();
      resolve(title);
    };

    timer = setTimeout(() => finish(null), timeoutMs);

    request = https.get(
      streamUrl,
      { headers: { "Icy-MetaData": "1", "User-Agent": "BOOOMERANGS-Radio/1.0" } },
      (response: IncomingMessage) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(null);
          return;
        }

        const metaint = Number.parseInt(String(response.headers["icy-metaint"] ?? ""), 10);
        if (!Number.isFinite(metaint) || metaint <= 0) {
          response.resume();
          finish(null);
          return;
        }

        let buffer: Buffer = Buffer.alloc(0);
        response.on("data", (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          const { title, rest } = scanIcyBuffer(buffer, metaint);
          if (title) {
            finish(title);
            return;
          }
          buffer = rest;
          if (buffer.length > maxBytes) finish(null);
        });
        response.on("error", () => finish(null));
        response.on("end", () => finish(null));
      },
    );

    request.on("error", () => finish(null));
  });
}
