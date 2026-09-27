import { describe, expect, it } from "vitest";
import { parseIcyStreamTitle, scanIcyBuffer } from "../lib/radio-meta";

/** Собирает один ICY-блок: [metaint байт аудио][длина×16][метаданные с паддингом]. */
function buildIcyBuffer(metaint: number, metadata: string): Buffer {
  const audio = Buffer.alloc(metaint, 0x11);
  if (!metadata) return Buffer.concat([audio, Buffer.from([0])]);
  const raw = Buffer.from(metadata, "utf8");
  const slots = Math.ceil(raw.length / 16);
  const block = Buffer.alloc(slots * 16, 0);
  raw.copy(block);
  return Buffer.concat([audio, Buffer.from([slots]), block]);
}

describe("parseIcyStreamTitle", () => {
  it("достаёт название из StreamTitle", () => {
    expect(parseIcyStreamTitle("StreamTitle='Nirvana - Smells Like Teen Spirit';")).toBe(
      "Nirvana - Smells Like Teen Spirit",
    );
  });

  it("терпит пробелы и регистр", () => {
    expect(parseIcyStreamTitle("streamtitle = 'Кино - Группа крови';")).toBe(
      "Кино - Группа крови",
    );
  });

  it("возвращает null для пустого или отсутствующего названия", () => {
    expect(parseIcyStreamTitle("StreamTitle='';")).toBeNull();
    expect(parseIcyStreamTitle("StreamTitle='   ';")).toBeNull();
    expect(parseIcyStreamTitle("какой-то мусор")).toBeNull();
  });

  it("работает с нулевым паддингом блока", () => {
    const padded = Buffer.concat([
      Buffer.from("StreamTitle='Мумий Тролль - Владивосток 2000';", "utf8"),
      Buffer.alloc(12, 0),
    ]);
    expect(parseIcyStreamTitle(padded)).toBe("Мумий Тролль - Владивосток 2000");
  });
});

describe("scanIcyBuffer", () => {
  it("находит название, когда блок целиком в буфере", () => {
    const buffer = buildIcyBuffer(32, "StreamTitle='Пикник - Королевство кривых';");
    const result = scanIcyBuffer(buffer, 32);
    expect(result.title).toBe("Пикник - Королевство кривых");
  });

  it("возвращает null, но не теряет данные, если блок ещё не дошёл целиком", () => {
    const full = buildIcyBuffer(32, "StreamTitle='Земфира - Искала';");
    const cut = full.subarray(0, full.length - 8);
    const result = scanIcyBuffer(cut, 32);
    expect(result.title).toBeNull();
    expect(result.rest.length).toBe(cut.length);
  });

  it("пропускает пустой блок и находит название в следующем", () => {
    const empty = buildIcyBuffer(16, "");
    const withTitle = buildIcyBuffer(16, "StreamTitle='Сплин - Выхода нет';");
    const result = scanIcyBuffer(Buffer.concat([empty, withTitle]), 16);
    expect(result.title).toBe("Сплин - Выхода нет");
  });

  it("считает остаток правильно, чтобы следующий чанк сшился без потерь", () => {
    const empty = buildIcyBuffer(16, "");
    const result = scanIcyBuffer(empty, 16);
    expect(result.title).toBeNull();
    expect(result.rest.length).toBe(0);
  });

  it("не падает и ничего не читает без metaint", () => {
    const buffer = buildIcyBuffer(16, "StreamTitle='X';");
    expect(scanIcyBuffer(buffer, 0)).toEqual({ title: null, rest: Buffer.alloc(0) });
    expect(scanIcyBuffer(buffer, Number.NaN).title).toBeNull();
  });
});
