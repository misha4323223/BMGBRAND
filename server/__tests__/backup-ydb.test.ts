import { describe, it, expect } from "vitest";
import { Ydb } from "ydb-sdk";
import {
  buildDdl,
  extractTypedValue,
  parseArgs,
  rowToObject,
  typeToYql,
  type TableSchema,
} from "../../scripts/backup-ydb";

// Тесты на скрипт scripts/backup-ydb.ts: боевая YDB недоступна из тестов,
// поэтому проверяем конвертеры типов/значений и разбор аргументов.
// Рантайм ydb-sdk отдаёт typeId числовым enum (см. PRIMITIVE_TYPE_NAMES).
const TypeId = (Ydb as any).Type.PrimitiveTypeId;

describe("typeToYql", () => {
  it("переводит примитивы боевой схемы", () => {
    expect(typeToYql({ typeId: TypeId.UINT64 })).toBe("Uint64");
    expect(typeToYql({ typeId: TypeId.INT64 })).toBe("Int64");
    expect(typeToYql({ typeId: TypeId.INT32 })).toBe("Int32");
    expect(typeToYql({ typeId: TypeId.UTF8 })).toBe("Utf8");
    expect(typeToYql({ typeId: TypeId.BOOL })).toBe("Bool");
    expect(typeToYql({ typeId: TypeId.TIMESTAMP })).toBe("Timestamp");
    expect(typeToYql({ typeId: TypeId.JSON })).toBe("Json");
    expect(typeToYql({ typeId: TypeId.STRING })).toBe("String");
  });

  it("разворачивает составные типы", () => {
    expect(typeToYql({ optionalType: { item: { typeId: TypeId.UTF8 } } })).toBe("Utf8?");
    expect(typeToYql({ optionalType: { item: { typeId: TypeId.JSON } } })).toBe("Json?");
    expect(typeToYql({ listType: { item: { typeId: TypeId.UINT64 } } })).toBe("List<Uint64>");
    expect(
      typeToYql({
        dictType: { key: { typeId: TypeId.UTF8 }, payload: { typeId: TypeId.INT32 } },
      }),
    ).toBe("Dict<Utf8,Int32>");
    expect(
      typeToYql({
        structType: {
          members: [
            { name: "a", type: { typeId: TypeId.UINT64 } },
            { name: "b", type: { typeId: TypeId.UTF8 } },
          ],
        },
      }),
    ).toBe("Struct<a:Uint64,b:Utf8>");
  });

  it("терпит мусор и строковые имена", () => {
    expect(typeToYql(null)).toBe("String");
    expect(typeToYql({ typeId: "UINT64" })).toBe("Uint64");
    expect(typeToYql({ typeId: 999999 })).toBe("String");
  });
});

describe("extractTypedValue", () => {
  it("читает скаляры", () => {
    expect(extractTypedValue({ textValue: "текст" })).toBe("текст");
    expect(extractTypedValue({ int32Value: 0 })).toBe(0);
    expect(extractTypedValue({ boolValue: false })).toBe(false);
    expect(extractTypedValue({ doubleValue: 1.5 })).toBe(1.5);
    expect(extractTypedValue({ uint64Value: 42 })).toBe(42);
  });

  it("переводит Timestamp (микросекунды) в ISO, а обычные числа не трогает", () => {
    const micros = Date.UTC(2020, 0, 2, 3, 4, 5) * 1000;
    expect(extractTypedValue({ uint64Value: micros })).toBe("2020-01-02T03:04:05.000Z");
    expect(extractTypedValue({ uint64Value: 1_700_000_000_000 })).toBe(1_700_000_000_000);
  });

  it("не теряет Int64 за пределами Number.MAX_SAFE_INTEGER", () => {
    const big = { valueOf: () => 9007199254740992, toString: () => "9007199254740993" };
    expect(extractTypedValue({ int64Value: big })).toBe("9007199254740993");
  });

  it("декодирует String/Utf8 как текст, а бинарь — как base64", () => {
    expect(extractTypedValue({ bytesValue: Buffer.from("текст", "utf8") })).toBe("текст");
    expect(extractTypedValue({ bytesValue: Buffer.from([0xff, 0xfe]) })).toBe("//4=");
  });

  it("разворачивает Optional и NULL", () => {
    expect(extractTypedValue({ optionalValue: { uint32Value: 7 } })).toBe(7);
    expect(extractTypedValue({ nullFlagValue: 0 })).toBeNull();
    expect(extractTypedValue(null)).toBeNull();
  });

  it("читает List и Struct", () => {
    expect(extractTypedValue({ items: [{ uint32Value: 1 }, { uint32Value: 2 }] })).toEqual([1, 2]);
    expect(
      extractTypedValue({ pairs: [{ name: "a", value: { uint32Value: 1 } }] }),
    ).toEqual({ a: 1 });
    expect(extractTypedValue({ items: [] })).toBeNull();
  });
});

describe("rowToObject", () => {
  it("раскладывает строку по именам колонок", () => {
    const row = { items: [{ uint64Value: 5 }, { textValue: "товар" }, { boolValue: true }] };
    expect(rowToObject(row, ["id", "title", "is_active"])).toEqual({
      id: 5,
      title: "товар",
      is_active: true,
    });
  });

  it("не падает на пустой строке", () => {
    expect(rowToObject({}, ["id"])).toEqual({});
    expect(rowToObject(null, ["id"])).toEqual({});
  });
});

describe("buildDdl", () => {
  const schema: TableSchema = {
    source: "describeTable",
    columns: [
      { name: "id", typeYql: "Uint64", rawType: null },
      { name: "title", typeYql: "Utf8", rawType: null },
    ],
    primaryKey: ["id"],
  };

  it("собирает CREATE TABLE с PRIMARY KEY", () => {
    const ddl = buildDdl(schema, "products");
    expect(ddl).toContain("CREATE TABLE `products` (");
    expect(ddl).toContain("`id` Uint64");
    expect(ddl).toContain("PRIMARY KEY (`id`)");
  });

  it("предупреждает, когда PRIMARY KEY неизвестен", () => {
    const ddl = buildDdl({ ...schema, primaryKey: [], note: "нет" }, "products");
    expect(ddl).toContain("PRIMARY KEY неизвестен");
    expect(ddl).not.toContain("PRIMARY KEY (");
  });
});

describe("parseArgs", () => {
  it("по умолчанию включает оба режима и все таблицы", () => {
    const opts = parseArgs([]);
    expect(opts.data).toBe(true);
    expect(opts.schema).toBe(true);
    expect(opts.tables).toEqual([]);
    expect(opts.out).toBeNull();
  });

  it("понимает отдельные режимы, --tables= и --out", () => {
    expect(parseArgs(["--data"]).schema).toBe(false);
    expect(parseArgs(["--schema"]).data).toBe(false);
    const opts = parseArgs(["--data", "--tables=orders, users ,orders", "--out=/tmp/dump"]);
    expect(opts.tables).toEqual(["orders", "users"]);
    expect(opts.out).toBe("/tmp/dump");
    expect(parseArgs(["--tables", "orders"]).tables).toEqual(["orders"]);
  });

  it("ругается на неизвестные и пустые аргументы", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Неизвестный аргумент/);
    expect(() => parseArgs(["--tables="])).toThrow(/пуст/);
    expect(() => parseArgs(["--tables"])).toThrow(/требует значения/);
  });
});
