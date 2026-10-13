/**
 * Временный режим «сайт работает на адресе контейнера».
 *
 * Зачем: пока не отвечает фронт домена (API Gateway в Yandex Cloud), сайт открывается
 * только по публичному адресу контейнера. Чтобы вход в личный кабинет и возврат с оплаты
 * работали на этом адресе, достаточно задать переменную окружения TEMP_PUBLIC_ORIGIN,
 * например:
 *
 *   TEMP_PUBLIC_ORIGIN=https://bba6fol2jvub7mr2uahi.containers.yandexcloud.net
 *
 * ГЛАВНОЕ СВОЙСТВО: если переменная не задана (или пустая), каждая функция ниже
 * возвращает ровно то же, что возвращал код до этой правки. Вернуть прежнее поведение
 * можно, просто убрав переменную окружения и передеплоив ревизию — откатывать код не нужно.
 * Порядок включения/выключения: docs/TEMP-CONTAINER-MODE.md
 */
import { config } from './config';

const SITE_COOKIE_SUFFIX = 'booomerangs.ru';

/** Адрес контейнера из окружения или null, если временный режим выключен. */
export function tempPublicOrigin(): string | null {
  const raw = (process.env.TEMP_PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  // Мусор в переменной не должен ломать сайт: принимаем только абсолютный http(s)-origin.
  if (!/^https?:\/\/[^\s/]+$/i.test(raw)) return null;
  return raw;
}

/** Наш хост? (booomerangs.ru или любой его поддомен). */
export function isSiteHost(host?: string): boolean {
  const h = (host || '').toLowerCase().split(':')[0].trim();
  if (!h) return false;
  return h === SITE_COOKIE_SUFFIX || h.endsWith(`.${SITE_COOKIE_SUFFIX}`);
}

/**
 * База для абсолютных ссылок на оплату: SuccessURL/FailURL и NotificationURL вебхука.
 * Временный адрес (если включён) → APP_DOMAIN → хост текущего запроса — как было раньше.
 */
export function publicBaseUrl(requestHost?: string): string {
  const temp = tempPublicOrigin();
  if (temp) return temp;
  const appDomain = (process.env.APP_DOMAIN || '').trim().replace(/\/+$/, '');
  if (appDomain) return appDomain;
  return `https://${(requestHost || '').trim()}`;
}

/** База ссылок в письмах (подтверждение почты, сброс пароля, подпись оферты). */
export function emailBaseUrl(): string {
  return tempPublicOrigin() || config.app.domain;
}

/**
 * Домен cookie авторизации для конкретного запроса.
 * Пока временный режим выключен — всегда defaultDomain, как было раньше.
 * Во временном режиме на чужом хосте (адрес контейнера) домен НЕ ставим: браузер обязан
 * отбросить cookie с Domain=.booomerangs.ru для хоста *.containers.yandexcloud.net,
 * иначе вход формально проходит, а человек сразу оказывается разлогинен.
 */
export function cookieDomainForHost(
  host: string | undefined,
  defaultDomain: string | undefined,
): string | undefined {
  if (!defaultDomain) return undefined;
  if (!tempPublicOrigin()) return defaultDomain;
  return isSiteHost(host) ? defaultDomain : undefined;
}

/** redirect_uri для входа через Яндекс ИД: временный адрес → прод-домен → локальная разработка. */
export function yandexRedirectUri(): string {
  const temp = tempPublicOrigin();
  if (temp) return `${temp}/api/auth/yandex/callback`;
  return process.env.NODE_ENV === 'production'
    ? 'https://www.booomerangs.ru/api/auth/yandex/callback'
    : `${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000'}/api/auth/yandex/callback`;
}
