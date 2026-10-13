import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  tempPublicOrigin,
  isSiteHost,
  publicBaseUrl,
  emailBaseUrl,
  cookieDomainForHost,
  yandexRedirectUri,
} from "../public-origin";
import { rewriteSiteLinks } from "../email";

// Временный режим «сайт на адресе контейнера» — см. docs/TEMP-CONTAINER-MODE.md.
// Ключевая гарантия: пока TEMP_PUBLIC_ORIGIN не задан, все функции возвращают ровно то,
// что возвращал код до правки (прод-домен), — то есть режим выключен по умолчанию.

const CONTAINER = "https://bba6fol2jvub7mr2uahi.containers.yandexcloud.net";
const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["TEMP_PUBLIC_ORIGIN", "APP_DOMAIN", "NODE_ENV", "REPLIT_DEV_DOMAIN"]) {
    SAVED[key] = process.env[key];
    delete process.env[key];
  }
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("tempPublicOrigin", () => {
  it("выключен, пока переменная не задана", () => {
    expect(tempPublicOrigin()).toBeNull();
    process.env.TEMP_PUBLIC_ORIGIN = "";
    expect(tempPublicOrigin()).toBeNull();
    process.env.TEMP_PUBLIC_ORIGIN = "   ";
    expect(tempPublicOrigin()).toBeNull();
  });

  it("нормализует адрес контейнера", () => {
    process.env.TEMP_PUBLIC_ORIGIN = `${CONTAINER}/`;
    expect(tempPublicOrigin()).toBe(CONTAINER);
    process.env.TEMP_PUBLIC_ORIGIN = `  ${CONTAINER}  `;
    expect(tempPublicOrigin()).toBe(CONTAINER);
  });

  it("игнорирует мусор вместо адреса", () => {
    process.env.TEMP_PUBLIC_ORIGIN = "containers.yandexcloud.net";
    expect(tempPublicOrigin()).toBeNull();
    process.env.TEMP_PUBLIC_ORIGIN = "javascript:alert(1)";
    expect(tempPublicOrigin()).toBeNull();
  });
});

describe("isSiteHost", () => {
  it("узнаёт наш домен и поддомены, но не похожие хосты", () => {
    expect(isSiteHost("booomerangs.ru")).toBe(true);
    expect(isSiteHost("www.booomerangs.ru")).toBe(true);
    expect(isSiteHost("BOOOMERANGS.RU:443")).toBe(true);
    expect(isSiteHost("evilbooomerangs.ru")).toBe(false);
    expect(isSiteHost("bba6fol2jvub7mr2uahi.containers.yandexcloud.net")).toBe(false);
    expect(isSiteHost(undefined)).toBe(false);
  });
});

describe("publicBaseUrl", () => {
  it("по умолчанию (режим выключен) повторяет прежнюю логику: APP_DOMAIN → хост запроса", () => {
    expect(publicBaseUrl("booomerangs.ru")).toBe("https://booomerangs.ru");
    process.env.APP_DOMAIN = "https://www.booomerangs.ru/";
    expect(publicBaseUrl("booomerangs.ru")).toBe("https://www.booomerangs.ru");
  });

  it("во временном режиме отдаёт адрес контейнера", () => {
    process.env.APP_DOMAIN = "https://www.booomerangs.ru";
    process.env.TEMP_PUBLIC_ORIGIN = CONTAINER;
    expect(publicBaseUrl("www.booomerangs.ru")).toBe(CONTAINER);
  });
});

describe("emailBaseUrl", () => {
  it("по умолчанию остаётся прод-домен из config", () => {
    expect(emailBaseUrl()).toBe("https://www.booomerangs.ru");
  });

  it("во временном режиме — адрес контейнера", () => {
    process.env.TEMP_PUBLIC_ORIGIN = CONTAINER;
    expect(emailBaseUrl()).toBe(CONTAINER);
  });
});

describe("cookieDomainForHost", () => {
  it("режим выключен → домен всегда как раньше", () => {
    expect(cookieDomainForHost("booomerangs.ru", ".booomerangs.ru")).toBe(".booomerangs.ru");
    expect(cookieDomainForHost("bba6fol2jvub7mr2uahi.containers.yandexcloud.net", ".booomerangs.ru")).toBe(
      ".booomerangs.ru",
    );
  });

  it("режим включён → на адресе контейнера cookie без Domain, на нашем домене — как раньше", () => {
    process.env.TEMP_PUBLIC_ORIGIN = CONTAINER;
    expect(cookieDomainForHost("bba6fol2jvub7mr2uahi.containers.yandexcloud.net", ".booomerangs.ru")).toBeUndefined();
    expect(cookieDomainForHost("www.booomerangs.ru", ".booomerangs.ru")).toBe(".booomerangs.ru");
  });

  it("в dev (без прод-домена) ничего не меняется", () => {
    process.env.TEMP_PUBLIC_ORIGIN = CONTAINER;
    expect(cookieDomainForHost("localhost:5000", undefined)).toBeUndefined();
  });
});

describe("rewriteSiteLinks (ссылки внутри писем)", () => {
  const HTML = `<a href="https://www.booomerangs.ru/profile">Личный кабинет</a><a href="https://booomerangs.ru/offer">Оферта</a>`;

  it("режим выключен → письмо не меняется", () => {
    expect(rewriteSiteLinks(HTML)).toBe(HTML);
  });

  it("режим включён → все ссылки ведут на адрес контейнера", () => {
    process.env.TEMP_PUBLIC_ORIGIN = CONTAINER;
    expect(rewriteSiteLinks(HTML)).toBe(
      `<a href="${CONTAINER}/profile">Личный кабинет</a><a href="${CONTAINER}/offer">Оферта</a>`,
    );
  });

  it("не трогает похожие домены и почтовые адреса", () => {
    process.env.TEMP_PUBLIC_ORIGIN = CONTAINER;
    expect(rewriteSiteLinks("https://evilbooomerangs.ru/x")).toBe("https://evilbooomerangs.ru/x");
    expect(rewriteSiteLinks("mailto:info@booomerangs.ru")).toBe("mailto:info@booomerangs.ru");
  });
});

describe("yandexRedirectUri", () => {
  it("по умолчанию — прежний прод-адрес", () => {
    process.env.NODE_ENV = "production";
    expect(yandexRedirectUri()).toBe("https://www.booomerangs.ru/api/auth/yandex/callback");
  });

  it("во временном режиме — адрес контейнера", () => {
    process.env.NODE_ENV = "production";
    process.env.TEMP_PUBLIC_ORIGIN = CONTAINER;
    expect(yandexRedirectUri()).toBe(`${CONTAINER}/api/auth/yandex/callback`);
  });
});
