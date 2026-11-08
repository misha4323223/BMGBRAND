// Единый формат FAQ для всех поверхностей: /faq (React), bot-ssr, static и llms.txt.
//
// Данные лежат в page_settings → static_pages → faq_data = { items: [...] }.
// Категория НЕОБЯЗАТЕЛЬНА: старые записи без неё продолжают работать и, если
// категорий нет ни у одного вопроса, страница рендерится одним списком, как раньше.

export interface FaqItem {
  question: string;
  answer: string;
  /** Заголовок раздела на /faq. Пусто/нет — попадёт в «Общие вопросы». */
  category?: string;
}

/** Раздел для вопросов, у которых категория не задана (когда остальные заданы). */
export const FAQ_UNCATEGORIZED = "Общие вопросы";

export interface FaqGroup {
  /** Заголовок раздела; пустая строка — раздел без заголовка (старый формат). */
  title: string;
  /** Якорь раздела для навигации по странице. */
  anchor: string;
  items: FaqItem[];
}

function parseRaw(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Приводит faq_data (объект, JSON-строка или мусор) к массиву валидных вопросов.
 * Пустые вопросы/ответы отбрасываются — так же, как это делала страница раньше.
 */
export function normalizeFaqItems(raw: unknown): FaqItem[] {
  const parsed = parseRaw(raw) as { items?: unknown } | null;
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const result: FaqItem[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const question = String(source.question ?? "").trim();
    const answer = String(source.answer ?? "").trim();
    if (!question || !answer) continue;

    const category = String(source.category ?? "").trim();
    result.push(category ? { question, answer, category } : { question, answer });
  }

  return result;
}

/** Уникальные категории в порядке первого появления — для подсказок в админке. */
export function collectFaqCategories(items: FaqItem[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const category = String(item.category ?? "").trim();
    if (!category || seen.has(category)) continue;
    seen.add(category);
    result.push(category);
  }

  return result;
}

/**
 * Разбивает вопросы по категориям.
 *
 * - категорий нет ни у кого → один раздел без заголовка (поведение до категорий);
 * - порядок разделов = порядок первого появления категории в списке;
 * - вопросы без категории уходят в «Общие вопросы» последним разделом.
 */
export function groupFaqItems(items: FaqItem[]): FaqGroup[] {
  if (items.length === 0) return [];

  const categories = collectFaqCategories(items);
  if (categories.length === 0) {
    return [{ title: "", anchor: "faq", items: [...items] }];
  }

  const groups: FaqGroup[] = categories.map((title, index) => ({
    title,
    anchor: `faq-${index + 1}`,
    items: [],
  }));
  const byTitle = new Map(groups.map((group) => [group.title, group]));
  const uncategorized: FaqItem[] = [];

  for (const item of items) {
    const category = String(item.category ?? "").trim();
    if (!category) {
      uncategorized.push(item);
      continue;
    }
    const group = byTitle.get(category);
    if (group) group.items.push(item);
  }

  if (uncategorized.length > 0) {
    groups.push({
      title: FAQ_UNCATEGORIZED,
      anchor: `faq-${groups.length + 1}`,
      items: uncategorized,
    });
  }

  return groups.filter((group) => group.items.length > 0);
}
