// Единый источник правды по транспортным компаниям (оптовые заказы).
// Используется на сервере (telegram.ts, invoice.ts, routes.ts) и на клиенте
// (Checkout.tsx, WholesalePreorder.tsx, PreorderCheckout.tsx, Admin.tsx, профили).
// Добавляя новую ТК — правь ТОЛЬКО здесь, чтобы она появилась везде.

export interface TransportCompany {
  id: string;
  name: string;
  abbr: string;
  color: string;
  desc: string;
}

export const TRANSPORT_COMPANIES: TransportCompany[] = [
  { id: "cdek",   name: "СДЭК",           abbr: "СД",  color: "#00A94B", desc: "Доставка по всей России" },
  { id: "dellin", name: "Деловые Линии",  abbr: "ДЛ",  color: "#ED1C24", desc: "Грузовая логистика" },
  { id: "pek",    name: "ПЭК",            abbr: "ПЭК", color: "#00599D", desc: "Межрегиональная доставка" },
  { id: "pochta", name: "Почта России",   abbr: "ПР",  color: "#004D9E", desc: "Отправление по всей РФ" },
  { id: "baikal", name: "ТК Байкал",      abbr: "БК",  color: "#0070C0", desc: "Доставка до терминала" },
];

export const TRANSPORT_COMPANY_NAMES: Record<string, string> = Object.fromEntries(
  TRANSPORT_COMPANIES.map((tc) => [tc.id, tc.name]),
);

export const TRANSPORT_COMPANY_COLORS: Record<string, string> = Object.fromEntries(
  TRANSPORT_COMPANIES.map((tc) => [tc.id, tc.color]),
);

/** Возвращает русское название ТК по id, либо сам id (или пустую строку) если неизвестно. */
export function transportCompanyName(id?: string | null): string {
  if (!id) return "";
  return TRANSPORT_COMPANY_NAMES[id] || id;
}
