// Category mapping based on SKU prefix and product name
// Maps products from 1C to our category structure

interface CategoryMapping {
  category: string;
  subcategory: string | null;
}

export interface GroupHierarchy {
  rootGroup: string;
  subGroup: string | null;
}

const ALLOWED_ROOT_GROUPS: Record<string, string> = {
  "носки": "socks",
  "одежда": "clothing",
  "мерч": "merch",
  "аксессуары": "accessories",
};

const IGNORED_ROOT_GROUPS = [
  "архив", "услуги", "бланковые изделия", "бланковые издел",
  "ткани", "фурнитура", "11",
];

export function isAllowedRootGroup(groupName: string): boolean {
  const lower = (groupName || '').toLowerCase().trim();
  return Object.keys(ALLOWED_ROOT_GROUPS).some(k => lower.includes(k));
}

export function isIgnoredRootGroup(groupName: string): boolean {
  const lower = (groupName || '').toLowerCase().trim();
  return IGNORED_ROOT_GROUPS.some(k => lower.includes(k));
}

export function getRootGroupCategorySlug(groupName: string): string | null {
  const lower = (groupName || '').toLowerCase().trim();
  for (const [key, slug] of Object.entries(ALLOWED_ROOT_GROUPS)) {
    if (lower.includes(key)) return slug;
  }
  return null;
}

export function mapGroupHierarchyToCategory(hierarchy: GroupHierarchy): CategoryMapping | null {
  const categorySlug = getRootGroupCategorySlug(hierarchy.rootGroup);
  if (!categorySlug) return null;

  if (categorySlug === "socks") {
    return { category: "socks", subcategory: null };
  }

  return {
    category: categorySlug,
    subcategory: hierarchy.subGroup || null,
  };
}

// SKU prefix mappings
const SKU_PREFIXES: Record<string, CategoryMapping> = {
  // Носки
  "N": { category: "socks", subcategory: "Классические (40-45)" }, // Default for N prefix
  "№": { category: "socks", subcategory: "Классические (40-45)" }, // Default for № prefix
  "&": { category: "socks", subcategory: "Классические (40-45)" }, // Symbol from screenshot
  
  // Одежда
  "H": { category: "clothing", subcategory: "Толстовки" }, // Hoodies
  "SW": { category: "clothing", subcategory: "Свитшоты" },
  "SV": { category: "clothing", subcategory: "Свитера" },
  "SH": { category: "clothing", subcategory: "Шорты" },
  "T": { category: "clothing", subcategory: "Футболки" },
  "J": { category: "clothing", subcategory: "Куртки" },
  "P": { category: "clothing", subcategory: "Брюки" },
  
  // Аксессуары
  "M": { category: "accessories", subcategory: "Кружки" },
  "B": { category: "accessories", subcategory: "Ремни" },
  "BG": { category: "accessories", subcategory: "Сумки" },
  "C": { category: "accessories", subcategory: "Шапки" },
  
  // Мерч
  "R": { category: "socks", subcategory: null }, // Special socks
};

// Keyword mappings for more precise categorization
const NAME_KEYWORDS: Record<string, CategoryMapping> = {
  // Носки подкатегории
  "спортивн": { category: "socks", subcategory: null }, // Size determined separately
  "классическ": { category: "socks", subcategory: null },
  "коротк": { category: "socks", subcategory: null },
  "детск": { category: "socks", subcategory: "Детские" },
  "подарочн": { category: "socks", subcategory: "Подарочные наборы" },
  "набор носк": { category: "socks", subcategory: "Подарочные наборы" },
  "gift set": { category: "socks", subcategory: "Подарочные наборы" },
  
  // Одежда
  "худи": { category: "clothing", subcategory: "Толстовки" },
  "толстов": { category: "clothing", subcategory: "Толстовки" },
  "свитшот": { category: "clothing", subcategory: "Свитшоты" },
  "свитер": { category: "clothing", subcategory: "Свитера" },
  "шорт": { category: "clothing", subcategory: "Шорты" },
  "футболк": { category: "clothing", subcategory: "Футболки" },
  "лонгслив": { category: "clothing", subcategory: "Футболки" },
  "олимпийк": { category: "clothing", subcategory: "Свитшоты" },
  "куртк": { category: "clothing", subcategory: "Куртки" },
  "анорак": { category: "clothing", subcategory: "Куртки" },
  "брюк": { category: "clothing", subcategory: "Брюки" },
  "джоггер": { category: "clothing", subcategory: "Брюки" },
  "мантия": { category: "clothing", subcategory: "Толстовки" },
  
  // Аксессуары - головные уборы
  "шапк": { category: "accessories", subcategory: "Шапки" },
  "бини": { category: "accessories", subcategory: "Шапки" },
  "балаклав": { category: "accessories", subcategory: "Шапки" },
  "бафф": { category: "accessories", subcategory: "Шапки" },
  "баф ": { category: "accessories", subcategory: "Шапки" },
  "панам": { category: "accessories", subcategory: "Шапки" },
  "кепк": { category: "accessories", subcategory: "Шапки" },
  "бейсболк": { category: "accessories", subcategory: "Шапки" },
  // Аксессуары - другое
  "кружк": { category: "accessories", subcategory: "Кружки" },
  "ремен": { category: "accessories", subcategory: "Ремни" },
  "ремн": { category: "accessories", subcategory: "Ремни" },
  "сумк": { category: "accessories", subcategory: "Сумки" },
  "шоппер": { category: "accessories", subcategory: "Сумки" },
  "бочка": { category: "accessories", subcategory: "Сумки" },
  "бочк": { category: "accessories", subcategory: "Сумки" },
  
  // Мерч
  "jdm": { category: "merch", subcategory: "JDM" },
  "тульск": { category: "merch", subcategory: "Тульские Дизайнеры" },
  // "oversize ur" removed - these are t-shirts in clothing category, not merch
  "дикая мята": { category: "merch", subcategory: "ДИКАЯ МЯТА" },
  "wild mint": { category: "merch", subcategory: "ДИКАЯ МЯТА" },
  "vashana": { category: "merch", subcategory: "ДИКАЯ МЯТА" },
  "стикерпак": { category: "merch", subcategory: "ДИКАЯ МЯТА" },
  "гудтаймс": { category: "merch", subcategory: "ГУДТАЙМС" },
  "goodtimes": { category: "merch", subcategory: "ГУДТАЙМС" },
  "зож": { category: "merch", subcategory: "ГУДТАЙМС" },
  "принц": { category: "merch", subcategory: "ГУДТАЙМС" },
  "драгни": { category: "merch", subcategory: "Драгни" },
  "мультфильм": { category: "merch", subcategory: "Мультfильмы" },
  "мультfильм": { category: "merch", subcategory: "Мультfильмы" },
  "formula": { category: "merch", subcategory: "formula" },
  "bear with me": { category: "merch", subcategory: "formula" },
};

// Extract SKU/article from product name (e.g., "Носки BOOOMERANGS (Шок-кот) R037 Черный" -> "R037")
function extractSkuFromProductName(name: string): string | null {
  if (!name) return null;
  
  // First try to find 2-3 letter prefixes (GKR, NKR, GR, GK, NK, SC) - these are reliable and can be inside parentheses
  // Note: G[KК] handles both Latin K and Russian К
  const multiLetterMatch = name.match(/\b(G[KК]R\d+|NKR\d+|GR\d+|G[KК]\d+|NK\d+|SC\d+)\b/i);
  if (multiLetterMatch) {
    // Normalize Russian К to Latin K
    return multiLetterMatch[1].toUpperCase().replace('К', 'K');
  }
  
  // For single-letter prefixes (R, N), only match OUTSIDE parentheses
  // to avoid capturing print names like "(Котёнок G178)"
  const nameWithoutParens = name.replace(/\([^)]*\)/g, ' ');
  const singleLetterMatch = nameWithoutParens.match(/\b(R\d+|N\d+|№\d+|&\d+)\b/i);
  if (singleLetterMatch) {
    return singleLetterMatch[1].toUpperCase();
  }
  
  return null;
}

function determineSocksSubcategory(sku: string, name: string): string {
  const nameLower = (name || '').toLowerCase();
  // Normalize Russian К to Latin K in DB SKU
  const skuFromDb = String(sku || '').toUpperCase().replace(/К/g, 'K');
  
  // PRIORITY: Extract SKU from product name first (more reliable than DB field)
  const skuFromName = extractSkuFromProductName(name);
  // Use name-extracted SKU if available, otherwise fallback to DB SKU (already normalized)
  const skuUpper = skuFromName || skuFromDb;

  // 0. Подарочные наборы - проверяем в первую очередь
  if (nameLower.includes("подарочн") || nameLower.includes("набор носк") || nameLower.includes("gift set")) {
    return "Подарочные наборы";
  }

  // 1. Предварительная проверка на детские носки по имени или артикулу
  if (nameLower.includes("детск") || nameLower.includes("kids") || skuUpper.includes("KIDS")) return "Детские";
  
  // Размеры 29-33 - детские
  if (nameLower.includes("29-33") || nameLower.includes("29/33")) return "Детские";

  // 2. Логика на основе артикула (SKU) - now using extracted SKU from name
  // GR - Спортивные 34-39р
  if (skuUpper.startsWith("GR")) return "Спортивные (34-39)";
  // GK, GKR - короткие 34-39р
  if (skuUpper.startsWith("GKR") || skuUpper.startsWith("GK")) return "Короткие (34-39)";
  // NK, NKR - короткие 40-45р
  if (skuUpper.startsWith("NKR") || skuUpper.startsWith("NK")) return "Короткие (40-45)";
  
  // SC - Спортивные (SC = Sport Classic или подобное)
  if (skuUpper.startsWith("SC")) {
    const is3439 = nameLower.includes("34-39") || nameLower.includes("34/39") || nameLower.includes("34 39");
    return is3439 ? "Спортивные (34-39)" : "Спортивные (40-45)";
  }
  
  // R - Спортивные 40-45р (CHECK BEFORE N to avoid NR confusion)
  if (skuUpper.startsWith("R")) return "Спортивные (40-45)";
  
  // ХАРДКОД для конкретного товара N024, чтобы никакое описание его не перебило
  if (skuUpper.includes("N024") || (name || '').toUpperCase().includes("N024")) return "Классические (40-45)";

  // N - Классические (after R check)
  if (skuUpper.startsWith("N") && !skuUpper.startsWith("NK")) {
    const is3439 = nameLower.includes("34-39") || nameLower.includes("34/39") || nameLower.includes("34 39");
    return is3439 ? "Классические (34-39)" : "Классические (40-45)";
  }
  // G - Классические 34-39р
  if (skuUpper.startsWith("G") && !skuUpper.startsWith("GR") && !skuUpper.startsWith("GK")) return "Классические (34-39)";
  // № - Классические 40-45р (но & идёт в логику по названию, т.к. бывает "КЛАССИКА СПОРТ")
  if (skuUpper.startsWith("№") || nameLower.includes("№") || skuUpper.includes("N024")) return "Классические (40-45)";

  // 3. Резервная логика по ключевым словам в названии (если SKU не подошел)
  // ВАЖНО: "спорт" и "071" должны проверяться ДО "классическ", т.к. бывают названия "КЛАССИКА СПОРТ"
  let type = "";
  // 071 - спортивные носки (например "Носки BOOOMERANGS (САМУРАЙ) 071 ЧЕРНЫЙ 34-39")
  if (nameLower.includes("071")) type = "Спортивные";
  // "спорт" в любом контексте = спортивные (проверяем regex для надёжности)
  else if (/спорт/i.test(name) || nameLower.includes("резинк") || nameLower.includes("теннис")) type = "Спортивные";
  else if (nameLower.includes("коротк") || nameLower.includes("занижен")) type = "Короткие";
  else if (nameLower.includes("классическ") || nameLower.includes("классика") || nameLower.includes("№")) type = "Классические";
  
  // Определение размера по названию
  const is4045 = nameLower.includes("40-45") || nameLower.includes("40/45") || nameLower.includes("o/s") || nameLower.includes("one size") || nameLower.includes("40 45");
  const is3439 = nameLower.includes("34-39") || nameLower.includes("34/39") || nameLower.includes("34 39");

  if (is4045) {
    return type ? `${type} (40-45)` : "Классические (40-45)";
  }
  if (is3439) {
    return type ? `${type} (34-39)` : "Классические (34-39)";
  }
  
  // Default fallback if no size in name but it's clearly a sock
  return type ? `${type} (40-45)` : "Классические (40-45)";
}

export function mapProductCategory(sku: string, name: string, group1c?: string): CategoryMapping {
  const nameLower = (name || '').toLowerCase();
  const skuUpper = String(sku || '').toUpperCase();
  const groupLower = (group1c || '').toLowerCase();
  
  // ZERO: Check 1C group first - SALE and Мерч have priority
  if (groupLower === 'sale' || groupLower.includes('sale')) {
    return { category: "sale", subcategory: null };
  }
  if (groupLower.includes('мерч')) {
    return { category: "merch", subcategory: null };
  }
  
  // FIRST: Check name keywords for accessories, clothing, merch BEFORE socks
  // This ensures "шапка", "панама", "кружка" etc. are not incorrectly classified as socks
  // Головные уборы ДОЛЖНЫ проверяться в первую очередь!
  const accessoryKeywords = ["шапк", "бини", "балаклав", "бафф", "баф ", "панам", "кепк", "бейсболк", "кружк", "ремен", "ремн", "сумк", "шоппер", "бочка", "бочк"];
  const clothingKeywords = ["худи", "толстов", "свитшот", "свитер", "шорт", "футболк", "куртк", "анорак", "брюк", "джоггер", "мантия"];
  const merchKeywords = ["jdm", "тульск", "дикая мята", "wild mint", "vashana", "стикерпак", "гудтаймс", "goodtimes", "зож", "принц", "драгни", "мультфильм", "мультfильм", "formula", "bear with me"];
  
  // Check MERCH FIRST - before clothing, so "Футболка ГУДТАЙМС" goes to merch, not clothing
  for (const keyword of merchKeywords) {
    if (nameLower.includes(keyword)) {
      return NAME_KEYWORDS[keyword] || { category: "merch", subcategory: null };
    }
  }
  
  // Special check for ДИКАЯ МЯТА prints: Девочка, Русалка, Планета, Квадраты, Цветок, UFO with "2-х нитка" or "3-х нитка"
  const dikayaMyataPrints = ["девочка", "русалка", "планета", "квадраты", "цветок", "ufo"];
  const nitkaPattern = nameLower.includes("2-х нитка") || nameLower.includes("3-х нитка") || 
                       nameLower.includes("2-х(нитка)") || nameLower.includes("2х нитка") || 
                       nameLower.includes("3-х нитк");
  if (nitkaPattern) {
    for (const print of dikayaMyataPrints) {
      if (nameLower.includes(print)) {
        return { category: "merch", subcategory: "ДИКАЯ МЯТА" };
      }
    }
  }
  
  // Special check for ДИКАЯ МЯТА shoppers: Винил, Готика, Сердце
  const dikayaMyataShoppers = ["винил", "готика", "сердце"];
  if (nameLower.includes("шоппер")) {
    for (const shopper of dikayaMyataShoppers) {
      if (nameLower.includes(shopper)) {
        return { category: "merch", subcategory: "ДИКАЯ МЯТА" };
      }
    }
  }
  
  // Check accessories
  for (const keyword of accessoryKeywords) {
    if (nameLower.includes(keyword)) {
      return NAME_KEYWORDS[keyword] || { category: "accessories", subcategory: "Шапки" };
    }
  }
  
  // Check clothing
  for (const keyword of clothingKeywords) {
    if (nameLower.includes(keyword)) {
      return NAME_KEYWORDS[keyword] || { category: "clothing", subcategory: null };
    }
  }
  
  // Check SKU prefix for accessories (C = Caps/Шапки)
  if (skuUpper.startsWith("C")) {
    return { category: "accessories", subcategory: "Шапки" };
  }
  
  // NOW check for socks (after other categories are excluded)
  if (skuUpper.startsWith("N") || skuUpper.startsWith("№") || skuUpper.startsWith("&") || skuUpper.startsWith("R") || skuUpper.startsWith("G") || 
      skuUpper.startsWith("GR") || skuUpper.startsWith("NK") || skuUpper.startsWith("GK") ||
      nameLower.includes("носк") || nameLower.includes("sock") || nameLower.includes("№")) {
    return {
      category: "socks",
      subcategory: determineSocksSubcategory(sku, name)
    };
  }

  // Check remaining name keywords
  for (const [keyword, mapping] of Object.entries(NAME_KEYWORDS)) {
    if (nameLower.includes(keyword.toLowerCase())) {
      return mapping;
    }
  }
  
  // Check SKU prefix for other categories
  for (const [prefix, mapping] of Object.entries(SKU_PREFIXES).sort((a, b) => b[0].length - a[0].length)) {
    if (skuUpper.startsWith(prefix)) {
      return mapping;
    }
  }
  
  // Ultimate fallback - use "1C Import" for uncategorized items
  return { category: "1C Import", subcategory: null };
}

// Artist slug mapping: product name keywords → partner slug
const ARTIST_SLUG_MAP: Array<{ slug: string; keywords: string[] }> = [
  { slug: "dikaya-myata", keywords: ["дикая мята", "wild mint", "vashana", "стикерпак"] },
  { slug: "gudtajms", keywords: ["гудтаймс", "goodtimes", "зож", "принц", "гуд таймс", "good times"] },
  { slug: "multfilmy", keywords: ["мультфильм", "мультfильм"] },
  { slug: "dragni", keywords: ["драгни", "dragni"] },
  { slug: "molodost-vnutri", keywords: ["молодость внутри"] },
];

export function getArtistSlugFromName(name: string): string | null {
  const lower = (name || '').toLowerCase();
  for (const entry of ARTIST_SLUG_MAP) {
    if (entry.keywords.some(k => lower.includes(k))) return entry.slug;
  }
  return null;
}

export function isOnSale(name: string, price: number, originalPrice?: number): boolean {
  const nameLower = (name || '').toLowerCase();
  if (nameLower.includes("распродаж") || nameLower.includes("sale") || nameLower.includes("скидк")) {
    return true;
  }
  if (originalPrice && price < originalPrice * 0.8) {
    return true;
  }
  return false;
}

// Common Russian color names for extraction - normalized to lowercase
const COLOR_KEYWORDS = [
  "тёмно-коричневый", "тёмно-коричневая", "тёмно-коричневые",
  "темно-коричневый", "темно-коричневая", "темно-коричневые",
  "тёмно-синий", "темно-синий", "тёмно-серый", "темно-серый",
  "тёмно-зеленый", "темно-зеленый", "тёмно-зелёный", "темно-зелёный",
  "черный", "черная", "черное", "чёрный", "чёрная", "чёрное", "черн", "черные",
  "белый", "белая", "белое", "белые",
  "серый", "серая", "серое", "серые", "т.серый", "т.серая",
  "красный", "красная", "красное", "красные", "красно",
  "синий", "синяя", "синее", "синие", "т.синий",
  "зеленый", "зеленая", "зелёный", "зелёная", "зеленые", "хаки",
  "бордовый", "бордовая", "бодовый", "бодовая", "бордо",
  "сиреневый", "сиреневая", "сиреневые",
  "розовый", "розовая", "розовые",
  "бежевый", "бежевая", "бежевые",
  "коричневый", "коричневая", "коричневые", "шоколад", "шоколадный", "шоколадная",
  "фиолетовый", "фиолетовая", "фиолетовые",
  "желтый", "желтая", "жёлтый", "жёлтая", "желтые",
  "оранжевый", "оранжевая", "оранжевые",
  "голубой", "голубая", "голубые",
  "графит", "графитовый", "графитовая",
  "песочный", "песочная", "кремовый", "кремовая",
  "бирюзовый", "бирюзовая", "мятный", "мятная",
  "кэмел", "камел", "camel", "камо", "camo",
  "койот", "койотовый",
  "фиолет",
  "салатовый", "салатовая", "светло-салатовый",
  "какао", "молочный", "молочная", "молочные",
  "малиновый", "малиновая", "малиновые",
  "оливковый", "оливковая", "оливка", "оливковые",
  "вишневый", "вишнёвый", "вишневая", "вишнёвая", "вишня",
  "лавандовый", "лавандовая", "лаванда",
  "терракотовый", "терракотовая", "терракот",
  "персиковый", "персиковая", "персиковые", "персик",
  "горчичный", "горчичная", "горчичные", "горчица",
  "лайм", "лаймовый", "лаймовая",
  "айсберг",
  "navy", "black", "white", "gray", "grey", "red", "blue", "green"
];

// Normalize color name - capitalize first letter, handle special cases
function normalizeColorName(color: string): string {
  const colorLower = color.toLowerCase().trim();
  
  // Map variations to standard names
  const colorMap: Record<string, string> = {
    "черн": "Черный", "черные": "Черный", "черный": "Черный", "чёрный": "Черный", "черная": "Черный", "чёрная": "Черный",
    "белые": "Белый", "белый": "Белый", "белая": "Белый",
    "серые": "Серый", "серый": "Серый", "серая": "Серый", "т.серый": "Т.Серый", "т.серая": "Т.Серый",
    "красные": "Красный", "красный": "Красный", "красно": "Красный",
    "синие": "Синий", "синий": "Синий", "т.синий": "Т.Синий",
    "зеленые": "Зеленый", "зеленый": "Зеленый", "зелёный": "Зеленый",
    "фиолетовые": "Фиолетовый", "фиолетовый": "Фиолетовый",
    "сиреневые": "Сиреневый", "сиреневый": "Сиреневый",
    "розовые": "Розовый", "розовый": "Розовый",
    "бежевые": "Бежевый", "бежевый": "Бежевый",
    "тёмно-коричневый": "Тёмно-Коричневый", "тёмно-коричневая": "Тёмно-Коричневый", "тёмно-коричневые": "Тёмно-Коричневый",
    "темно-коричневый": "Тёмно-Коричневый", "темно-коричневая": "Тёмно-Коричневый", "темно-коричневые": "Тёмно-Коричневый",
    "тёмно-синий": "Тёмно-Синий", "темно-синий": "Тёмно-Синий",
    "тёмно-серый": "Тёмно-Серый", "темно-серый": "Тёмно-Серый",
    "тёмно-зеленый": "Тёмно-Зеленый", "темно-зеленый": "Тёмно-Зеленый", "тёмно-зелёный": "Тёмно-Зеленый", "темно-зелёный": "Тёмно-Зеленый",
    "коричневые": "Коричневый", "коричневый": "Коричневый",
    "желтые": "Желтый", "желтый": "Желтый", "жёлтый": "Желтый",
    "оранжевые": "Оранжевый", "оранжевый": "Оранжевый",
    "голубые": "Голубой", "голубой": "Голубой",
    "хаки": "Хаки",
    "графит": "Графит", "графитовый": "Графит",
    "кэмел": "Кэмел", "камел": "Кэмел", "camel": "Кэмел",
    "камо": "Камо", "camo": "Камо",
    "койот": "Койот", "койотовый": "Койот",
    "фиолет": "Фиолетовый",
    "бодовый": "Бордовый", "бодовая": "Бордовый", "бордовый": "Бордовый", "бордо": "Бордовый",
    "какао": "Какао",
    "молочный": "Молочный", "молочная": "Молочный", "молочные": "Молочный",
    "малиновый": "Малиновый", "малиновая": "Малиновый", "малиновые": "Малиновый",
    "оливковый": "Оливковый", "оливковая": "Оливковый", "оливка": "Оливковый", "оливковые": "Оливковый",
    "вишневый": "Вишневый", "вишнёвый": "Вишневый", "вишневая": "Вишневый", "вишнёвая": "Вишневый", "вишня": "Вишневый",
    "лавандовый": "Лавандовый", "лавандовая": "Лавандовый", "лаванда": "Лавандовый",
    "терракотовый": "Терракотовый", "терракотовая": "Терракотовый", "терракот": "Терракотовый",
    "салатовый": "Салатовый", "салатовая": "Салатовый",
    "персиковый": "Персиковый", "персиковая": "Персиковый", "персиковые": "Персиковый", "персик": "Персиковый",
    "горчичный": "Горчичный", "горчичная": "Горчичный", "горчичные": "Горчичный", "горчица": "Горчичный",
    "лайм": "Лайм", "лаймовый": "Лайм", "лаймовая": "Лайм",
    "айсберг": "Айсберг",
  };
  
  return colorMap[colorLower] || color.charAt(0).toUpperCase() + color.slice(1).toLowerCase();
}

// Extract color from product name
export function extractColorFromName(name: string): string | null {
  if (!name) return null;
  const nameLower = name.toLowerCase();
  
  // Special markers that indicate black color
  if (name.includes("(Б/Н)") || name.includes("Б/Н")) {
    return "Черный";
  }
  
  // Stripe/accent markers: Б/П = белая полоса, К/П = красная полоса, Ч/П = чёрная полоса
  const stripeMarkers: Record<string, string> = {
    "б/п": "Белая полоса",
    "к/п": "Красная полоса", 
    "ч/п": "Чёрная полоса",
    "с/п": "Серая полоса",
    "з/п": "Зелёная полоса",
  };
  
  let stripeSuffix = "";
  for (const [marker, label] of Object.entries(stripeMarkers)) {
    if (nameLower.includes(marker)) {
      stripeSuffix = ` ${label}`;
      break;
    }
  }
  
  // FIRST: Try to extract color from parentheses (search from right to left, as color is usually last)
  // This catches patterns like "(Черный)", "(Фиолетовый) Надпись", etc.
  const allParenMatches = name.match(/\(([^)]+)\)/g);
  if (allParenMatches) {
    // Process from right to left (reverse order) since color is usually in the last parentheses
    for (let i = allParenMatches.length - 1; i >= 0; i--) {
      const match = allParenMatches[i];
      const inParen = match.slice(1, -1).trim(); // Remove parentheses
      const inParenLower = inParen.toLowerCase();
      
      // Skip if it's a size pattern like (40-45) or (S) (M) etc
      if (/^\d{2}-\d{2}$/.test(inParen) || /^[SMLX]{1,4}$/.test(inParen.toUpperCase())) {
        continue;
      }
      
      // Skip if it's a model name pattern (too many words or has numbers with letters)
      if (inParen.split(/\s+/).length > 3 || /[A-Za-z]+\d+/.test(inParen)) {
        continue;
      }
      
      // Skip known non-color model names
      const skipPatterns = ["боковой", "тактик", "tube", "sport", "classic", "нитка", "резинка", "карман", "велюр", "raw", "logo", "надпись", "oversize"];
      if (skipPatterns.some(p => inParenLower.includes(p))) {
        continue;
      }
      
      // Check if content contains a known color
      for (const color of COLOR_KEYWORDS) {
        if (inParenLower.includes(color)) {
          // Return the full content of parentheses + stripe suffix if present
          return inParen + stripeSuffix;
        }
      }
    }
  }
  
  // SECOND: Try to find color keyword anywhere in name
  for (const color of COLOR_KEYWORDS) {
    if (nameLower.includes(color)) {
      return normalizeColorName(color) + stripeSuffix;
    }
  }
  
  return null;
}

// Size patterns for extraction from product names
const SIZE_PATTERNS = [
  // Numeric sock sizes with dash: 40-45, 34-39
  /\b(\d{2}-\d{2})\b/g,
  // Sizes in parentheses: (40-45), (34-39), (OneSize), (S), (M)
  /\((\d{2}-\d{2})\)/g,
  /\((OneSize|One Size|O\/S)\)/gi,
  /\(([SMLX]{1,3})\)/g,
  // Standard clothing sizes
  /\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL)\b/gi,
  // OneSize variants
  /\b(OneSize|One Size|O\/S|Один размер)\b/gi,
];

// Extract sizes array from product name
export function extractSizesFromName(name: string): string[] {
  const sizes = new Set<string>();
  const safeName = name || '';
  
  // Check for sock size patterns (40-45, 34-39)
  const sockSizeMatch = safeName.match(/\b(\d{2})-(\d{2})\b/);
  if (sockSizeMatch) {
    sizes.add(sockSizeMatch[0]);
  }
  
  // Check for sock sizes in parentheses
  const parenSockMatch = safeName.match(/\((\d{2}-\d{2})\)/);
  if (parenSockMatch) {
    sizes.add(parenSockMatch[1]);
  }
  
  // Check for OneSize variants
  const oneSizePatterns = [
    /\bOneSize\b/gi,
    /\bOne Size\b/gi,
    /\bO\/S\b/gi,
    /\(OneSize\)/gi,
    /\(One Size\)/gi,
  ];
  for (const pattern of oneSizePatterns) {
    if (pattern.test(safeName)) {
      sizes.add("OneSize");
    }
  }
  
  // Check for clothing sizes (S, M, L, XL, etc.)
  const clothingSizes = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL"];
  for (const size of clothingSizes) {
    // Match whole word or in parentheses
    const regex = new RegExp(`\\b${size}\\b|\\(${size}\\)`, "gi");
    if (regex.test(safeName)) {
      sizes.add(size.toUpperCase());
    }
  }
  
  return Array.from(sizes);
}
