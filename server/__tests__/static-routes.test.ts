import { describe, it, expect } from "vitest";
import { KNOWN_STATIC_ROUTES, KNOWN_STATIC_PREFIXES } from "../static";

/**
 * static.ts отдаёт 404, если путь не попал ни в известные роуты, ни в префиксы,
 * ни в правило «односегментный слаг товара/подкатегории». Поэтому любой живой
 * роут из client/src/App.tsx обязан сюда попадать — иначе production отвечает
 * 404 на рабочую страницу (так было с /concept/<slug>, /partner/<slug>,
 * /partner/<slug>/widget, /partner/confirm-signature и /predrop/checkout).
 */
const isValidStaticRoute = (pathname: string): boolean => {
  const isKnownRoute =
    KNOWN_STATIC_ROUTES.has(pathname) || KNOWN_STATIC_PREFIXES.some((p) => pathname.startsWith(p));
  const slugMatch = pathname.match(/^\/([a-z0-9][a-z0-9-]*[a-z0-9])\/?$/);
  return isKnownRoute || !!slugMatch;
};

// Пути из client/src/App.tsx с подставленными параметрами.
const CLIENT_ROUTES = [
  "/",
  "/products",
  "/products/clothing",
  "/products/clothing/hoodies",
  "/products/clothing/hoodies/xudi-s-nacyosom",
  "/cart",
  "/checkout",
  "/about",
  "/admin",
  "/verify-email",
  "/reset-password",
  "/profile",
  "/favorites",
  "/vacancies",
  "/faq",
  "/wholesale",
  "/wholesale/register",
  "/wholesale/profile",
  "/wholesale/preorder",
  "/partner",
  "/partner/login",
  "/partner/register",
  "/partner/confirm-signature",
  "/partner/profile",
  "/partner/some-artist",
  "/partner/some-artist/widget",
  "/gift-cards",
  "/gift-cards/success",
  "/gift-cards/failed",
  "/blog",
  "/blog/1770036436632",
  "/terms",
  "/privacy",
  "/care",
  "/order-success/123",
  "/order-failed/123",
  "/links",
  "/track/1234567890",
  "/concept",
  "/concept/bmgbrand",
  "/predrop/checkout",
  "/merch-na-zakaz",
  "/dikaya-myata", // /:slug — подкатегория
  "/sale-hoodie-product", // /:slug — товар
];

describe("static.ts: известные SPA-роуты", () => {
  it("не отдаёт 404 ни на один роут client/src/App.tsx", () => {
    const broken = CLIENT_ROUTES.filter((route) => !isValidStaticRoute(route));
    expect(broken).toEqual([]);
  });

  it("неизвестный многосегментный путь по-прежнему 404", () => {
    expect(isValidStaticRoute("/products/unknown-section/unknown-sub")).toBe(true); // внутри /products/ — решается отдельно по каталогу
    expect(isValidStaticRoute("/concept-unknown/deeper")).toBe(false);
    expect(isValidStaticRoute("/random/deep/path")).toBe(false);
  });
});
