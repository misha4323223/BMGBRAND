// ─────────────────────────────────────────────────────────────────────
// Проверка, относится ли IP к "доверенным" диапазонам с точки зрения
// форензики ПЭП партнёрки.
//
// Контекст: req.socket.remoteAddress (TCP-источник) — нельзя подделать
// заголовками. Если запрос пришёл через Yandex Cloud API Gateway,
// remote_ip это либо публичный IP YC, либо внутренний IP NAT/proxy
// инфраструктуры YC (часто из приватных RFC1918-диапазонов).
//
// Если remote_ip НЕ из YC и НЕ приватный — значит запрос пришёл
// напрямую на публичный URL контейнера, минуя Gateway. Это однозначный
// признак попытки обхода (см. секцию "Усиление ПЭП — IP-spoofing
// закрыт" в replit.md).
//
// Список диапазонов YC периодически меняется. Источник правды —
// официальный JSON Yandex Cloud (https://cloud.yandex.ru/docs/vpc/concepts/ips).
// Здесь захардкожены стабильные крупные диапазоны Compute и Serverless
// Containers; при необходимости можно добавить свои через ENV
// `YANDEX_CLOUD_IP_RANGES` (формат: "1.2.3.0/24,5.6.7.0/16").
// ─────────────────────────────────────────────────────────────────────

import { BlockList, isIPv4, isIPv6 } from 'node:net';

const YANDEX_CLOUD_PUBLIC_RANGES: ReadonlyArray<readonly [string, number]> = [
  // Compute Cloud / Serverless / API Gateway (Москва, Владимир, Калуга)
  ['51.250.0.0', 16],
  ['158.160.0.0', 16],
  ['84.201.128.0', 17],
  ['130.193.32.0', 19],
  ['84.252.128.0', 19],
  ['178.154.196.0', 22],
  ['213.180.193.0', 24],
  // Object Storage / CDN / прочие сервисы
  ['77.88.0.0', 18],
  ['93.158.128.0', 18],
  ['199.36.240.0', 22],
];

const PRIVATE_RANGES: ReadonlyArray<readonly [string, number]> = [
  // RFC1918 — внутренние сети YC (Gateway → Container идёт через них)
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  // Loopback и link-local — для локальной разработки и unit-тестов
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
];

const blockList = new BlockList();

function addRange(addr: string, mask: number) {
  try {
    blockList.addSubnet(addr, mask);
  } catch (e: any) {
    console.warn(`[YC-IP] Не удалось добавить диапазон ${addr}/${mask}: ${e?.message}`);
  }
}

for (const [addr, mask] of YANDEX_CLOUD_PUBLIC_RANGES) addRange(addr, mask);
for (const [addr, mask] of PRIVATE_RANGES) addRange(addr, mask);

// ENV-override: добавление своих диапазонов без правок кода
const envRanges = (process.env.YANDEX_CLOUD_IP_RANGES || '').split(',').map(s => s.trim()).filter(Boolean);
for (const cidr of envRanges) {
  const m = cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (!m) {
    console.warn(`[YC-IP] Пропущен невалидный CIDR из YANDEX_CLOUD_IP_RANGES: "${cidr}"`);
    continue;
  }
  const mask = Number(m[2]);
  if (mask < 0 || mask > 32) {
    console.warn(`[YC-IP] Пропущен CIDR с невалидной маской: "${cidr}"`);
    continue;
  }
  addRange(m[1], mask);
}

/**
 * Проверка: входит ли IP в "доверенные" диапазоны (публичные YC + приватные RFC1918).
 *
 * @returns
 *   - `true`  — IP в одном из известных диапазонов (норма)
 *   - `false` — IP внешний и не из YC (подозрительно: возможен обход Gateway)
 *   - `null`  — IP отсутствует или некорректный/IPv6 (не можем оценить)
 */
export function isYandexCloudOrPrivateIp(ip?: string | null): boolean | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/i, '');
  if (isIPv4(clean)) return blockList.check(clean);
  // Чистый IPv6: только loopback/link-local считаем доверенным локальным
  // (на YC API Gateway → container трафик идёт по IPv4 / IPv4-mapped,
  // так что чистого IPv6 в проде быть не должно).
  if (isIPv6(ip)) {
    if (ip === '::1') return true;
    if (/^fe80:/i.test(ip)) return true;
    return null; // внешний IPv6 — не оцениваем, чтобы не давать ложных тревог
  }
  return null;
}
