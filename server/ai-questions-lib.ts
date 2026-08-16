/**
 * Pure helpers for the "AI Questions → FAQ" pipeline (Variant 2).
 *
 * Kept dependency-free on purpose: both the AI-chat save hook (server/ai-chat.ts)
 * and the admin routes (server/ai-questions-routes.ts) import from here, so the
 * normalization/stop-word logic lives in exactly one place.
 */

/** Normalize a user question so the same question asked differently maps to one row. */
export function normalizeAiQuestion(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?!.]+$/g, "")
    .slice(0, 300);
}

/** Short filler replies that are not real questions — never worth saving. */
const AI_QUESTION_STOPWORDS = new Set([
  "да",
  "нет",
  "ок",
  "окей",
  "ага",
  "угу",
  "понятно",
  "понял",
  "поняла",
  "спасибо",
  "спс",
  "благодарю",
  "здравствуйте",
  "привет",
  "приветствую",
  "добрый день",
  "добрый вечер",
  "доброе утро",
  "а подробнее",
  "подробнее",
  "расскажи еще",
  "расскажи ещё",
  "ещё",
  "еще",
  "что ещё",
  "что еще",
  "ладно",
  "хорошо",
  "ясно",
  "отлично",
  "супер",
  "круто",
  "класс",
  "а что",
  "почему",
  "зачем",
  "как дела",
]);

/** Whether a raw user message is worth persisting for FAQ analytics. */
export function isWorthSavingAiQuestion(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 4 || t.length > 500) return false;
  const norm = normalizeAiQuestion(t);
  if (AI_QUESTION_STOPWORDS.has(norm)) return false;
  return true;
}

/**
 * Builds the system prompt for FAQ-draft generation.
 * Grounds the model in maintained AI-knowledge blocks (brand, assortment) plus
 * existing FAQ items so it does not invent facts and does not duplicate answers.
 */
export function buildFaqDraftSystemPrompt(context: {
  brandPrompt: string;
  assortmentBlock: string;
  existingFaq: Array<{ question: string; answer: string }>;
}): string {
  const lines: string[] = [
    "Ты — контент-редактор раздела «Вопросы и ответы» интернет-магазина BMGBRAND (Booomerangs), бренда одежды и мерча артистов.",
    "Пользователь пришлёт вопрос покупателя. Напиши грамотный ответ для публичной FAQ-страницы магазина.",
    "Правила:",
    "1. Отвечай ТОЛЬКО на основе фактов из контекста ниже (промт бренда, ассортимент, существующие ответы). Если факта нет — не выдумывай, сформулируй общий корректный ответ без конкретики.",
    "2. Формат: 2–5 коротких предложений, без заголовков, без маркдауна, без «Здравствуйте!». Можно одну маркированную строку с примером, если это уместно.",
    "3. Если ответ уже существует среди «Существующих ответов FAQ» (смысловое совпадение) — так и напиши: «Ответ уже есть на странице: <вопрос>».",
    "4. Не упоминай, что ты ИИ, не обращайся к читателю по имени.",
  ];

  if (context.brandPrompt) lines.push("\n### Промт бренда (база):\n" + context.brandPrompt.slice(0, 3000));
  if (context.assortmentBlock) lines.push("\n### Ассортимент магазина:\n" + context.assortmentBlock.slice(0, 3000));

  if (context.existingFaq.length > 0) {
    lines.push(
      "\n### Существующие ответы FAQ (не дублируй их):\n" +
        context.existingFaq
          .slice(0, 40)
          .map((f, i) => `${i + 1}. ${f.question} — ${f.answer.slice(0, 400)}`)
          .join("\n")
    );
  }

  lines.push("\nВерни ТОЛЬКО текст ответа — без кавычек и пояснений.");
  return lines.join("\n");
}
