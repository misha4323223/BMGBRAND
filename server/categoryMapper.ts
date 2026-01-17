// Category mapping based on SKU prefix and product name
// Maps products from 1C to our category structure

interface CategoryMapping {
  category: string;
  subcategory: string | null;
}

// SKU prefix mappings
const SKU_PREFIXES: Record<string, CategoryMapping> = {
  // Носки
  "N": { category: "socks", subcategory: null }, // Will be refined by name
  
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
  
  // Одежда
  "худи": { category: "clothing", subcategory: "Толстовки" },
  "толстов": { category: "clothing", subcategory: "Толстовки" },
  "свитшот": { category: "clothing", subcategory: "Свитшоты" },
  "свитер": { category: "clothing", subcategory: "Свитера" },
  "шорт": { category: "clothing", subcategory: "Шорты" },
  "футболк": { category: "clothing", subcategory: "Футболки" },
  "куртк": { category: "clothing", subcategory: "Куртки" },
  "брюк": { category: "clothing", subcategory: "Брюки" },
  
  // Аксессуары
  "кружк": { category: "accessories", subcategory: "Кружки" },
  "ремен": { category: "accessories", subcategory: "Ремни" },
  "ремн": { category: "accessories", subcategory: "Ремни" },
  "сумк": { category: "accessories", subcategory: "Сумки" },
  "шапк": { category: "accessories", subcategory: "Шапки" },
  
  // Мерч
  "jdm": { category: "merch", subcategory: "JDM" },
  "тульск": { category: "merch", subcategory: "Тульские Дизайнеры" },
  "дикая мята": { category: "merch", subcategory: "ДИКАЯ МЯТА" },
  "гудтаймс": { category: "merch", subcategory: "ГУДТАЙМС" },
  "goodtimes": { category: "merch", subcategory: "ГУДТАЙМС" },
};

function determineSocksSubcategory(sku: string, name: string): string {
  const nameLower = name.toLowerCase();
  const skuUpper = sku.toUpperCase();

  // 1. Предварительная проверка на детские носки по имени
  if (nameLower.includes("детск")) return "Детские";

  // 2. Логика на основе артикула (SKU)
  // GR - на Спорт Резинке 34-39р
  if (skuUpper.startsWith("GR")) return "На спорт Резинке (34-39)";
  // GK - короткие 34-39р
  if (skuUpper.startsWith("GK")) return "Короткие (34-39)";
  // NK - короткие 40-45р
  if (skuUpper.startsWith("NK")) return "Короткие (40-45)";
  // R - На спорт Резинке 40-45р
  if (skuUpper.startsWith("R")) return "На спорт Резинке (40-45)";
  // G - Классические 34-39р
  if (skuUpper.startsWith("G")) return "Классические (34-39)";
  // N - Классические 40-45р
  if (skuUpper.startsWith("N")) return "Классические (40-45)";

  // 3. Резервная логика по ключевым словам в названии (если SKU не подошел)
  let type = "";
  if (nameLower.includes("спортивн") || nameLower.includes("резинк")) type = "На спорт Резинке";
  else if (nameLower.includes("классическ")) type = "Классические";
  else if (nameLower.includes("коротк")) type = "Короткие";
  
  // Определение размера по названию
  if (nameLower.includes("40-45") || nameLower.includes("40/45") || nameLower.includes("o/s") || nameLower.includes("one size")) {
    return type ? `${type} (40-45)` : "Классические (40-45)";
  }
  if (nameLower.includes("34-39") || nameLower.includes("34/39")) {
    return type ? `${type} (34-39)` : "Классические (34-39)";
  }
  
  // Default
  return type ? `${type} (40-45)` : "Классические (40-45)";
}

export function mapProductCategory(sku: string, name: string): CategoryMapping {
  const nameLower = name.toLowerCase();
  const skuUpper = sku.toUpperCase();
  
  // Special handling for socks
  if (skuUpper.startsWith("N") || skuUpper.startsWith("R") || skuUpper.startsWith("G") || 
      skuUpper.startsWith("GR") || skuUpper.startsWith("NK") || skuUpper.startsWith("GK") ||
      nameLower.includes("носк") || nameLower.includes("sock")) {
    return {
      category: "socks",
      subcategory: determineSocksSubcategory(sku, name)
    };
  }

  // First, check name keywords for other categories
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
  
  // Ultimate fallback
  return { category: "socks", subcategory: "Классические (40-45)" };
}

export function isOnSale(name: string, price: number, originalPrice?: number): boolean {
  const nameLower = name.toLowerCase();
  if (nameLower.includes("распродаж") || nameLower.includes("sale") || nameLower.includes("скидк")) {
    return true;
  }
  if (originalPrice && price < originalPrice * 0.8) {
    return true;
  }
  return false;
}
