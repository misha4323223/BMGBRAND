/**
 * Ozon Delivery API отдаёт int64-идентификаторы в JSON. Часть из них
 * (16+ цифр) выходит за Number.MAX_SAFE_INTEGER, и обычный JSON.parse
 * молча округляет их. Перед разбором превращаем такие целые в строки.
 *
 * Это не полноценный JSON-парсер: он только проходит по тексту, не трогая
 * строковые литералы, и берёт в кавычки целые числа, которые не помещаются
 * в безопасный диапазон JavaScript. Остальные числа остаются числами.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = -MAX_SAFE;

function quoteUnsafeIntegers(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    const startsNumber =
      char === "-" || (char >= "0" && char <= "9");
    if (!startsNumber) {
      result += char;
      continue;
    }

    const start = i;
    if (char === "-") i++;
    while (i < text.length && text[i] >= "0" && text[i] <= "9") i++;
    while (
      i < text.length &&
      (text[i] === "." ||
        text[i] === "e" ||
        text[i] === "E" ||
        text[i] === "+" ||
        text[i] === "-" ||
        (text[i] >= "0" && text[i] <= "9"))
    ) {
      i++;
    }

    const token = text.slice(start, i);
    i--;

    if (/^-?\d+$/.test(token)) {
      try {
        const value = BigInt(token);
        if (value > MAX_SAFE || value < MIN_SAFE) {
          result += `"${token}"`;
          continue;
        }
      } catch {
        /* невалидный токен — пусть JSON.parse сообщит об ошибке */
      }
    }
    result += token;
  }

  return result;
}

export function parseOzonJson(text: string): any {
  return JSON.parse(quoteUnsafeIntegers(text));
}
