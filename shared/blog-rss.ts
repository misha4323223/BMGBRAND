/**
 * RSS 2.0-канал блога для Яндекс.Вебмастера (раздел «Свежий контент») и
 * агрегаторов (Яндекс.Дзен, Турбо-страницы).
 *
 * Чистые функции без побочных эффектов — покрыты unit-тестами
 * (server/__tests__/blog-rss.test.ts).
 *
 * Требования Яндекса к каналу
 * (https://yandex.ru/support/webmaster/ru/search-appearance/fresh-content):
 *  - RSS 2.0, кодировка объявлена в XML-декларации;
 *  - обязательные элементы item: title, link, pubDate, yandex:full-text;
 *  - pubDate — RFC-822 с таймзоной;
 *  - в yandex:full-text — полный текст публикации без имени источника,
 *    автора, подписей к фото, даты, контактов и ссылок на картинки;
 *  - размер файла ≤ 10 МБ, релевантными считаются публикации за 8 дней.
 */
import { escapeXml } from "./feed-utils";
import { blogDescriptionFor, stripBlogHtml, type BlogPostForSsr } from "./blog-post";

/** Пространство имён расширений Яндекса (`yandex:full-text`, `yandex:genre`). */
export const YANDEX_RSS_NS = "http://news.yandex.ru";
/** Пространство имён Media RSS (`media:content`, `media:thumbnail`). */
export const MEDIA_RSS_NS = "http://search.yahoo.com/mrss/";
/** МСК: сайт и статьи живут в этой таймзоне, Яндекс ждёт фактическое время. */
export const MSK_OFFSET_MINUTES = 180;
/** Больше Яндекс не обходит, а файл быстро растёт (лимит канала — 10 МБ). */
export const MAX_FEED_ITEMS = 50;
/** Лимит Яндекса на заголовок публикации. */
export const MAX_TITLE_LENGTH = 200;
/** Лимит Яндекса на длину URL в item (ASCII-символы). */
export const MAX_URL_LENGTH = 243;
/** Полный текст одной статьи: выше крыши для обхода, файл остаётся небольшим. */
export const MAX_FULL_TEXT_LENGTH = 20_000;

const RFC822_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RFC822_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Экспортируемый путь канала (для ссылок rel="alternate" и llms.txt). */
export const BLOG_RSS_PATH = "/rss.xml";
/** Алиас: тот же канал на «блоговом» адресе. */
export const BLOG_RSS_ALIAS_PATH = "/blog/rss.xml";

/**
 * `YYYY-MM-DD` → RFC-822 `Mon, 06 Oct 2026 12:00:00 +0300`.
 *
 * В статьях блога хранится только дата (без времени), поэтому время фиксируем
 * на 12:00 МСК — фид валиден, а «свежесть» публикации остаётся правдивой.
 * Невалидная дата → null: элемент без pubDate Яндекс для «Свежего контента»
 * не возьмёт, но канал остаётся валидным RSS 2.0.
 */
export function formatRfc822Date(dateIso: string, hour: number = 12): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateIso || "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  const dd = String(day).padStart(2, "0");
  const hh = String(Math.min(Math.max(Math.trunc(hour), 0), 23)).padStart(2, "0");
  const offset = `+${String(Math.trunc(MSK_OFFSET_MINUTES / 60)).padStart(2, "0")}00`;
  return `${RFC822_DAYS[utc.getUTCDay()]}, ${dd} ${RFC822_MONTHS[month - 1]} ${year} ${hh}:00:00 ${offset}`;
}

/**
 * Момент времени → RFC-822 в указанной таймзоне (по умолчанию МСК).
 * Часы берутся из сдвинутого инстанта, а не из локальных часов сервера: контейнер
 * живёт в UTC, поэтому `date.getHours()` давал бы время, помеченное как +0300.
 */
export function formatRfc822DateTime(date: Date, offsetMinutes: number = MSK_OFFSET_MINUTES): string | null {
  const value = date instanceof Date ? date : new Date(date as unknown as string);
  if (!Number.isFinite(value.getTime())) return null;
  const shifted = new Date(value.getTime() + offsetMinutes * 60_000);
  const abs = Math.abs(offsetMinutes);
  const offsetSign = offsetMinutes < 0 ? "-" : "+";
  const offset = `${offsetSign}${String(Math.trunc(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mi = String(shifted.getUTCMinutes()).padStart(2, "0");
  const ss = String(shifted.getUTCSeconds()).padStart(2, "0");
  return `${RFC822_DAYS[shifted.getUTCDay()]}, ${dd} ${RFC822_MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()} ${hh}:${mi}:${ss} ${offset}`;
}

/** Абсолютный URL статьи: `/blog/{id}` → `https://site/blog/{id}`. */
export function blogPostUrl(siteUrl: string, id: number): string {
  return `${String(siteUrl).replace(/\/$/, "")}/blog/${id}`;
}

/** Абсолютный URL картинки: относительные пути получают домен сайта. */
function absoluteUrl(siteUrl: string, url: string): string {
  const value = String(url || "").trim();
  if (!value || value.startsWith("data:")) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${String(siteUrl).replace(/\/$/, "")}${value.startsWith("/") ? "" : "/"}${value}`;
}

/** MIME-тип по расширению — Media RSS требует его для media:content. */
function imageMimeType(url: string): string {
  const ext = (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1] || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "avif") return "image/avif";
  return "image/jpeg";
}

/**
 * Заголовок item: без переносов, без точки в конце (Яндекс отклоняет такое
 * item) и не длиннее 200 символов.
 */
export function blogRssTitle(title: string): string {
  const clean = String(title || "").replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  if (clean.length <= MAX_TITLE_LENGTH) return clean;
  const cut = clean.lastIndexOf(" ", MAX_TITLE_LENGTH);
  return cut > 100 ? clean.slice(0, cut) : clean.slice(0, MAX_TITLE_LENGTH);
}

/** Полный текст для yandex:full-text — только текст статьи, без разметки. */
export function blogRssFullText(content: string): string {
  const text = stripBlogHtml(content);
  if (text.length <= MAX_FULL_TEXT_LENGTH) return text;
  const cut = text.lastIndexOf(" ", MAX_FULL_TEXT_LENGTH);
  return text.slice(0, cut > 0 ? cut : MAX_FULL_TEXT_LENGTH);
}

export interface BlogRssOptions {
  /** Домен сайта без слэша на конце (например https://booomerangs.ru). */
  siteUrl: string;
  /** Заголовок канала. */
  title?: string;
  /** Описание канала — одно предложение, без HTML. */
  description?: string;
  /** Язык публикаций по ISO 639-1. */
  language?: string;
  /** Момент сборки канала — для lastBuildDate. */
  now?: Date;
}

/**
 * RSS 2.0-канал блога. Статьи без валидной даты попадают в конец канала
 * без pubDate: для «Свежего контента» Яндекс их не подхватит, но канал
 * не ломается (RSS 2.0 остаётся корректным).
 */
export function buildBlogRssFeed(posts: BlogPostForSsr[], opts: BlogRssOptions): string {
  const siteUrl = String(opts.siteUrl || "").replace(/\/$/, "");
  const dated = posts.filter((p) => formatRfc822Date(p.dateIso) !== null);
  const undated = posts.filter((p) => formatRfc822Date(p.dateIso) === null);
  dated.sort((a, b) => (a.dateIso === b.dateIso ? b.id - a.id : a.dateIso < b.dateIso ? 1 : -1));
  undated.sort((a, b) => b.id - a.id);
  const items = [...dated, ...undated].slice(0, MAX_FEED_ITEMS);

  const now = opts.now instanceof Date ? opts.now : new Date();
  const lastBuildDate = formatRfc822DateTime(now) ?? "";

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<rss xmlns:yandex="${YANDEX_RSS_NS}" xmlns:media="${MEDIA_RSS_NS}" version="2.0">`);
  lines.push(`  <channel>`);
  lines.push(`    <title>${escapeXml(opts.title || "BOOOMERANGS: Блог")}</title>`);
  lines.push(`    <link>${escapeXml(siteUrl)}</link>`);
  lines.push(
    `    <description>${escapeXml(
      opts.description ||
        "Блог BOOOMERANGS: статьи об одежде, мерче, материалах и коллаборациях с артистами.",
    )}</description>`,
  );
  lines.push(`    <language>${escapeXml(opts.language || "ru")}</language>`);
  if (lastBuildDate) lines.push(`    <lastBuildDate>${lastBuildDate}</lastBuildDate>`);

  for (const post of items) {
    const link = blogPostUrl(siteUrl, post.id);
    if (link.length > MAX_URL_LENGTH) continue;
    const pubDate = formatRfc822Date(post.dateIso);
    const image = absoluteUrl(siteUrl, post.image);
    lines.push(`    <item>`);
    lines.push(`      <title>${escapeXml(blogRssTitle(post.title))}</title>`);
    lines.push(`      <link>${escapeXml(link)}</link>`);
    lines.push(`      <guid isPermaLink="true">${escapeXml(link)}</guid>`);
    if (pubDate) lines.push(`      <pubDate>${pubDate}</pubDate>`);
    if (post.author) lines.push(`      <author>${escapeXml(post.author)}</author>`);
    if (post.category) lines.push(`      <category>${escapeXml(post.category)}</category>`);
    lines.push(`      <description>${escapeXml(blogDescriptionFor(post, 300))}</description>`);
    lines.push(`      <yandex:genre>article</yandex:genre>`);
    if (image) {
      lines.push(`      <media:group>`);
      lines.push(`        <media:content url="${escapeXml(image)}" type="${imageMimeType(image)}"/>`);
      lines.push(`        <media:thumbnail url="${escapeXml(image)}"/>`);
      lines.push(`      </media:group>`);
    }
    lines.push(`      <yandex:full-text>${escapeXml(blogRssFullText(post.content))}</yandex:full-text>`);
    lines.push(`    </item>`);
  }

  lines.push(`  </channel>`);
  lines.push(`</rss>`);
  return lines.join("\n") + "\n";
}
