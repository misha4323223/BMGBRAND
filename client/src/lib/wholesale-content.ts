/**
 * Контент страницы оптовых партнёров (/wholesale).
 *
 * Хранится в `page_settings` как pageName = "wholesale", section_id = "content".
 * Дефолты ниже дословно повторяют прежнюю вёрстку, поэтому без сохранённых
 * настроек страница выглядит ровно как раньше.
 */

export const WHOLESALE_ICON_KEYS = [
  "boxes",
  "shield",
  "truck",
  "factory",
  "shirt",
  "badge",
  "wallet",
] as const;

export type WholesaleIconKey = (typeof WHOLESALE_ICON_KEYS)[number];

export interface WholesaleStat {
  value: string;
  label: string;
}

export interface WholesaleCondition {
  icon: WholesaleIconKey;
  title: string;
  points: string[];
}

export interface WholesaleAdvantage {
  icon: WholesaleIconKey;
  title: string;
  desc: string;
}

export interface WholesaleStep {
  title: string;
  desc: string;
}

export interface WholesaleFaqItem {
  q: string;
  a: string;
}

export interface WholesaleContent {
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCta: string;
    secondaryCta: string;
  };
  stats: WholesaleStat[];
  conditions: {
    eyebrow: string;
    title: string;
    items: WholesaleCondition[];
  };
  advantages: {
    eyebrow: string;
    title: string;
    items: WholesaleAdvantage[];
  };
  steps: {
    title: string;
    ctaLabel: string;
    items: WholesaleStep[];
  };
  contacts: {
    managerPhone: string;
    salesPhone: string;
    email: string;
  };
  faq: {
    title: string;
    items: WholesaleFaqItem[];
  };
}

export const DEFAULT_WHOLESALE_CONTENT: WholesaleContent = {
  hero: {
    eyebrow: "Оптовым партнёрам",
    title: "Оптовые продажи BOOOMERANGS",
    subtitle:
      "Носки и одежда с собственного производства в Туле — для розничных магазинов, маркетплейсов и дистрибьюторов по всей России.",
    primaryCta: "Стать оптовым партнёром",
    secondaryCta: "Условия сотрудничества",
  },
  stats: [
    { value: "5 000 ₽", label: "Носки от" },
    { value: "10 000 ₽", label: "Одежда от" },
    { value: "~15 мин", label: "Одобрение" },
  ],
  conditions: {
    eyebrow: "Условия сотрудничества",
    title: "Простые и понятные условия",
    items: [
      {
        icon: "boxes",
        title: "Минимальный заказ",
        points: ["Носки — от 5 000 ₽", "От 2 штук на один артикул", "Одежда — от 10 000 ₽"],
      },
      {
        icon: "shield",
        title: "Маркировка",
        points: ["Работаем с «Честным знаком»", "Коды маркировки на товаре", "Готовы к поставкам по РФ"],
      },
      {
        icon: "truck",
        title: "Доставка",
        points: ["СДЭК", "ПЭК и Деловые линии", "Байкал, Почта России"],
      },
    ],
  },
  advantages: {
    eyebrow: "Почему BOOOMERANGS",
    title: "Производитель, а не посредник",
    items: [
      {
        icon: "factory",
        title: "Своё производство",
        desc: "Полный цикл в Туле — от дизайна и пошива до упаковки. Контролируем качество каждой партии.",
      },
      {
        icon: "shirt",
        title: "Одежда и носки",
        desc: "Куртки сложного кроя, худи, свитшоты, футболки, шорты, аксессуары и носки с 200+ авторских дизайнов.",
      },
      {
        icon: "badge",
        title: "Официальный мерч артистов и фестивалей",
        desc: "Производим мерч Гудтаймс, Молодость внутри, Драгни и МультFильмы — и официальный мерч фестиваля Дикая Мята.",
      },
      {
        icon: "wallet",
        title: "Оптовый кабинет",
        desc: "Специальные цены, персональный менеджер и заказы в несколько кликов после одобрения заявки.",
      },
    ],
  },
  steps: {
    title: "Как начать",
    ctaLabel: "Оставить заявку",
    items: [
      { title: "Оставьте заявку", desc: "Заполните форму — название компании, ИНН и контакты." },
      { title: "Одобрение ~15 минут", desc: "Менеджер проверит данные и откроет доступ к оптовым ценам." },
      { title: "Заказывайте", desc: "Собирайте заказ в оптовом кабинете — отгрузим транспортной компанией." },
    ],
  },
  contacts: {
    managerPhone: "+7 905 116-29-02",
    salesPhone: "8 960 600 00 47",
    email: "info@booomerangs.ru",
  },
  faq: {
    title: "Частые вопросы",
    items: [
      {
        q: "Какая минимальная сумма оптового заказа?",
        a: "Носки — от 5 000 ₽ (от 2 штук на один артикул). Одежда — от 10 000 ₽.",
      },
      {
        q: "Кто может стать оптовым покупателем BOOOMERANGS?",
        a: "Индивидуальные предприниматели и юридические лица. Оставьте заявку — одобрение занимает около 15 минут.",
      },
      {
        q: "Вы работаете с маркировкой «Честный знак»?",
        a: "Да. Поставляем товар с кодами маркировки «Честный знак».",
      },
      {
        q: "Как вы отправляете оптовые заказы?",
        a: "Транспортными компаниями: СДЭК, ПЭК, Деловые линии, Байкал и Почта России.",
      },
      {
        q: "Есть ли специальные оптовые цены?",
        a: "Да. После одобрения заявки вы получаете доступ к оптовому кабинету со специальными ценами и персональным менеджером.",
      },
    ],
  },
};

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function iconKey(value: unknown, fallback: WholesaleIconKey): WholesaleIconKey {
  return typeof value === "string" && (WHOLESALE_ICON_KEYS as readonly string[]).includes(value)
    ? (value as WholesaleIconKey)
    : fallback;
}

/** Ровно столько элементов, сколько в дефолтах: вёрстка рассчитана на фиксированные сетки. */
function fixedList<T>(value: unknown, defaults: T[], map: (raw: any, fallback: T) => T): T[] {
  const list = Array.isArray(value) ? value : [];
  return defaults.map((fallback, index) => map(list[index], fallback));
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return items.length > 0 ? items : fallback;
}

/**
 * Приводит сохранённый JSON к полному объекту контента.
 * Любое битое/отсутствующее поле подменяется дефолтом — страница никогда не падает.
 */
export function mergeWholesaleContent(raw: unknown): WholesaleContent {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const d = DEFAULT_WHOLESALE_CONTENT;

  const hero = source.hero ?? {};
  const conditions = source.conditions ?? {};
  const advantages = source.advantages ?? {};
  const steps = source.steps ?? {};
  const contacts = source.contacts ?? {};
  const faq = source.faq ?? {};

  const faqItems: WholesaleFaqItem[] = Array.isArray(faq.items)
    ? faq.items
        .map((item: any) => ({ q: text(item?.q, ""), a: text(item?.a, "") }))
        .filter((item: WholesaleFaqItem) => item.q !== "" || item.a !== "")
    : [];

  return {
    hero: {
      eyebrow: text(hero.eyebrow, d.hero.eyebrow),
      title: text(hero.title, d.hero.title),
      subtitle: text(hero.subtitle, d.hero.subtitle),
      primaryCta: text(hero.primaryCta, d.hero.primaryCta),
      secondaryCta: text(hero.secondaryCta, d.hero.secondaryCta),
    },
    stats: fixedList<WholesaleStat>(source.stats, d.stats, (item, fallback) => ({
      value: text(item?.value, fallback.value),
      label: text(item?.label, fallback.label),
    })),
    conditions: {
      eyebrow: text(conditions.eyebrow, d.conditions.eyebrow),
      title: text(conditions.title, d.conditions.title),
      items: fixedList<WholesaleCondition>(conditions.items, d.conditions.items, (item, fallback) => ({
        icon: iconKey(item?.icon, fallback.icon),
        title: text(item?.title, fallback.title),
        points: stringList(item?.points, fallback.points),
      })),
    },
    advantages: {
      eyebrow: text(advantages.eyebrow, d.advantages.eyebrow),
      title: text(advantages.title, d.advantages.title),
      items: fixedList<WholesaleAdvantage>(advantages.items, d.advantages.items, (item, fallback) => ({
        icon: iconKey(item?.icon, fallback.icon),
        title: text(item?.title, fallback.title),
        desc: text(item?.desc, fallback.desc),
      })),
    },
    steps: {
      title: text(steps.title, d.steps.title),
      ctaLabel: text(steps.ctaLabel, d.steps.ctaLabel),
      items: fixedList<WholesaleStep>(steps.items, d.steps.items, (item, fallback) => ({
        title: text(item?.title, fallback.title),
        desc: text(item?.desc, fallback.desc),
      })),
    },
    contacts: {
      managerPhone: text(contacts.managerPhone, d.contacts.managerPhone),
      salesPhone: text(contacts.salesPhone, d.contacts.salesPhone),
      email: text(contacts.email, d.contacts.email),
    },
    faq: {
      title: text(faq.title, d.faq.title),
      items: faqItems.length > 0 ? faqItems : d.faq.items,
    },
  };
}

/** Телефон для href="tel:": 8 960 600 00 47 → tel:+79606000047 */
export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits === "") return "tel:";
  if (digits.length === 11 && (digits[0] === "8" || digits[0] === "7")) return `tel:+7${digits.slice(1)}`;
  if (digits.length === 10) return `tel:+7${digits}`;
  return `tel:+${digits}`;
}
