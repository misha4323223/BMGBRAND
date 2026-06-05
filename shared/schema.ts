import { pgTable, text, serial, integer, boolean, timestamp, jsonb, bigint, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Transliteration map for generating URL slugs
const TRANSLIT_MAP: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i',
  'й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
  'у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y',
  'ь':'','э':'e','ю':'yu','я':'ya',
};

export function transliterateToSlug(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map(ch => TRANSLIT_MAP[ch] !== undefined ? TRANSLIT_MAP[ch] : ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export interface SubcategoryConfig {
  name: string;
  slug: string;
}

export interface CategoryConfig {
  name: string;
  slug: string;
  subcategories: SubcategoryConfig[];
}

function sub(name: string, slug?: string): SubcategoryConfig {
  return { name, slug: slug || transliterateToSlug(name) };
}

// Category structure for navigation
export const CATEGORIES: Record<string, CategoryConfig> = {
  clothing: {
    name: "Одежда",
    slug: "clothing",
    subcategories: [sub("Толстовки"), sub("Свитшоты"), sub("Свитера"), sub("Шорты"), sub("Футболки"), sub("Куртки"), sub("Брюки")]
  },
  socks: {
    name: "Носки",
    slug: "socks",
    subcategories: [
      sub("Классические (40-45)", "klassicheskie-40-45"),
      sub("Классические (34-39)", "klassicheskie-34-39"),
      sub("Спортивные (40-45)", "sportivnye-40-45"),
      sub("Спортивные (34-39)", "sportivnye-34-39"),
      sub("Короткие (40-45)", "korotkie-40-45"),
      sub("Короткие (34-39)", "korotkie-34-39"),
      sub("Детские"),
      sub("Подарочные наборы"),
    ]
  },
  accessories: {
    name: "Аксессуары",
    slug: "accessories",
    subcategories: [sub("Кружки"), sub("Ремни"), sub("Сумки"), sub("Шапки")]
  },
  merch: {
    name: "Мерч",
    slug: "merch",
    subcategories: [sub("formula", "formula"), sub("JDM", "jdm"), sub("ГУДТАЙМС", "gudtajms"), sub("ДИКАЯ МЯТА", "dikaya-myata"), sub("Драгни", "dragni"), sub("Мультfильмы", "multfilmy"), sub("Тульские Дизайнеры", "tulskie-dizajnery")]
  },
  sale: {
    name: "Распродажа",
    slug: "sale",
    subcategories: []
  }
};

export type CategorySlug = string;

export function normalizeCategories(cats: any): Record<string, CategoryConfig> {
  if (!cats || typeof cats !== 'object') return CATEGORIES;
  const result: Record<string, CategoryConfig> = {};
  for (const [slug, cat] of Object.entries(cats)) {
    const c = cat as any;
    if (!c || !c.name) continue;
    const subs: SubcategoryConfig[] = [];
    if (Array.isArray(c.subcategories)) {
      for (const s of c.subcategories) {
        if (typeof s === 'string') {
          subs.push({ name: s, slug: transliterateToSlug(s) });
        } else if (s && typeof s === 'object' && s.name) {
          subs.push({ name: s.name, slug: s.slug || transliterateToSlug(s.name) });
        }
      }
    }
    result[slug] = { name: c.name, slug: c.slug || slug, subcategories: subs };
  }
  return Object.keys(result).length > 0 ? result : CATEGORIES;
}

export function findCategoryBySubcategorySlug(cats: Record<string, CategoryConfig>, subSlug: string): { category: CategoryConfig; subcategory: SubcategoryConfig } | null {
  for (const cat of Object.values(cats)) {
    const sub = cat.subcategories.find(s => s.slug === subSlug);
    if (sub) return { category: cat, subcategory: sub };
  }
  return null;
}

// Products
// Type for size measurements table
export type SizeMeasurement = {
  size: string;
  length?: string;      // Длина
  chest?: string;       // Обхват груди
  shoulders?: string;   // Ширина плеч
  sleeves?: string;     // Длина рукава
  waist?: string;       // Обхват талии
  hips?: string;        // Обхват бёдер
};

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").unique(), // ID from 1C - UNIQUE identifier
  sku: text("sku"), // Article/SKU - NOT unique, same SKU for different colors
  name: text("name").notNull(),
  description: text("description").notNull(),
  price: integer("price").notNull(), // stored in cents/kopeks (retail price)
  wholesalePrice: integer("wholesale_price"), // wholesale price from 1C in cents/kopeks
  imageUrl: text("image_url").notNull(),
  thumbnailUrl: text("thumbnail_url"), // 450px thumbnail for catalog
  hoverThumbnailUrl: text("hover_thumbnail_url"), // 450px thumbnail for hover effect (second image)
  images: jsonb("images").$type<string[]>().default([]), // All product images (1C sends 3-4 per product)
  imageThumbnails: jsonb("image_thumbnails").$type<string[]>().default([]), // 450px thumbnails for ALL images
  category: text("category").notNull(), // Main category slug: clothing, socks, accessories, merch, sale
  subcategory: text("subcategory"), // Subcategory name
  additionalCategories: jsonb("additional_categories").$type<Array<{category: string, subcategory: string}>>().default([]), // Extra category+subcategory pairs for cross-listing
  color: text("color"), // Color of THIS variant (extracted from name)
  sizes: jsonb("sizes").$type<string[]>().notNull(), // e.g. ["S", "M", "L", "XL"]
  colors: jsonb("colors").$type<string[]>().notNull(), // e.g. ["Black", "White"] - legacy, keep for compatibility
  isNew: boolean("is_new").default(false),
  badgeText: text("badge_text"), // Custom badge text: "NEW", "ХИТ", "SALE", etc.
  discountPercent: integer("discount_percent"), // Discount percentage (0-100), stored in old_price column in YDB
  onSale: boolean("on_sale").default(false), // For sale category
  isHidden: boolean("is_hidden").default(false), // Hide product from public catalog
  autoHideOverride: boolean("auto_hide_override").default(false), // If true, auto-hide will not affect this product (admin manually showed it)
  stock: integer("stock").default(0), // Stock quantity from 1C offers.xml (total)
  sizeStock: jsonb("size_stock").$type<Record<string, number>>(), // Stock per size: {"XS": 1, "S": 4, "M": 6}
  sizeDiscounts: jsonb("size_discounts").$type<Record<string, number>>(), // Discounts per size in %: {"XS": 30, "L": 20}
  // Measurements & Care info (for clothing only)
  measurements: jsonb("measurements").$type<SizeMeasurement[]>(), // Size chart with measurements
  composition: text("composition"), // e.g. "100% хлопок" - состав
  careInstructions: text("care_instructions"), // e.g. "Машинная стирка при 30°" - уход
  note: text("note"), // Примечание к товару
  delivery: text("delivery"), // Custom delivery text (optional, uses default if null)
  returnPolicy: text("return_policy"), // Custom return policy text (optional, uses default if null)
  lookProducts: jsonb("look_products").$type<number[]>().default([]), // IDs of products for "Complete your look" section
  lookCategory: text("look_category"), // Category slug for "Complete your look" - shows first 4 products from this category
  lookSubcategory: text("look_subcategory"), // Subcategory name for "Complete your look" - filters within selected category
  noSize: boolean("no_size").default(false), // If true, size selection is hidden and (OneSize) is auto-selected
  slug: text("slug"), // URL slug for SEO-friendly URLs (auto-generated from name, manually overridable)
  seoTitle: text("seo_title"), // Custom SEO title override (auto-generated if empty)
  seoDescription: text("seo_description"), // Custom SEO meta description override (auto-generated if empty)
  imageAlts: jsonb("image_alts").$type<string[]>().default([]), // Custom alt texts per image (auto-generated if empty)
  // Артикул (1С) и обложка карточки
  article: text("article"), // Артикул товара из 1С (отдельно от sku)
  cardImageUrl: text("card_image_url"), // Кастомная обложка карточки в каталоге (если задана — используется вместо thumbnail)
  // Размеры — таблица id характеристик из 1С (для SOAP-выгрузки)
  sizeCharacteristicIds: jsonb("size_characteristic_ids").$type<Record<string, string>>(), // {"M": "uuid-1c", "L": "uuid-1c"}
  // Розничный предзаказ (краудфандинг — собираем заявки до запуска производства)
  preorderEnabled: boolean("preorder_enabled").default(false), // Включён ли предзаказ для товара
  preorderGoal: integer("preorder_goal"), // Сколько заявок нужно набрать для запуска
  preorderCurrent: integer("preorder_current").default(0), // Текущее число заявок
  preorderDeadline: text("preorder_deadline"), // Дата окончания сбора заявок (YYYY-MM-DD)
  preorderProductionDate: text("preorder_production_date"), // Планируемая дата производства
  preorderShippingDate: text("preorder_shipping_date"), // Планируемая дата отгрузки
  preorderStatus: text("preorder_status"), // collecting | confirmed | shipped | cancelled
  artistSlug: text("artist_slug"), // Slug артиста-партнёра (если товар принадлежит артисту)
  artistOnly: boolean("artist_only").default(false), // Товар создан артистом — виден только на его странице, не в общем каталоге
  // Оптовый предзаказ (отдельный B2B-флоу с РРЦ и оптовой ценой)
  wholesalePreorderEnabled: boolean("wholesale_preorder_enabled").default(false),
  wholesalePreorderSizes: jsonb("wholesale_preorder_sizes").$type<string[]>(), // Размеры, доступные на оптовый предзаказ
  wholesalePreorderRrp: integer("wholesale_preorder_rrp"), // РРЦ для предзаказа (kopeks)
  wholesalePreorderPrice: integer("wholesale_preorder_price"), // Оптовая цена для предзаказа (kopeks)
  // Аудит обновлений
  updatedAt: timestamp("updated_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Cart Items (User based or guest session)
export const cartItems = pgTable("cart_items", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id"), // For guest users (nullable now)
  userId: bigint("user_id", { mode: "number" }), // For logged in users
  productId: bigint("product_id", { mode: "number" }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  size: text("size"),
  color: text("color"),
});

// Orders
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  userId: bigint("user_id", { mode: "number" }), // Link to authenticated user
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  address: text("address").notNull(),
  total: integer("total").notNull(),
  items: jsonb("items").$type<any[]>().notNull(), // Snapshot of items
  status: text("status").notNull().default("pending"), // pending, confirmed, shipped
  promoCode: text("promo_code"), // Applied promo code
  isWholesale: boolean("is_wholesale").default(false), // Wholesale order flag
  transportCompany: text("transport_company"), // Transport company for wholesale: cdek, dellin, pek, pochta
  invoiceNumber: integer("invoice_number"), // Saved invoice number for wholesale orders
  // Платёжная интеграция
  paymentId: text("payment_id"), // YooKassa/T-Bank payment ID для основного платежа
  // СДЭК / интеграции
  cdekData: text("cdek_data"), // JSON-строка: данные о выбранном пункте/способе доставки СДЭК
  bitrixDealId: text("bitrix_deal_id"), // ID сделки в Bitrix24 после синхронизации
  syncedTo1c: boolean("synced_to_1c").default(false), // Флаг — заказ выгружен в 1С
  // Предзаказ (модель «депозит сейчас, остаток при поступлении товара»)
  isPreorder: boolean("is_preorder").default(false), // Заказ-предзаказ
  depositPaid: boolean("deposit_paid").default(false), // Депозит за предзаказ оплачен
  remainingAmount: integer("remaining_amount"), // Остаток к доплате после поступления товара (kopeks)
  preorderPaymentId: text("preorder_payment_id"), // payment_id для платежа за остаток предзаказа
  // ⚠ ВНИМАНИЕ: в продовой YDB эта колонка хранится как Utf8?, а НЕ Uint64?
  // (legacy-схема, ALTER на смену типа в YDB невозможен).
  // На запись/чтение всегда использовать serializeOrderPartnerId /
  // deserializeOrderPartnerId из server/storage.ts. Подробности — в replit.md.
  partnerId: bigint("partner_id", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Newsletter Subscribers
export const subscribers = pgTable("subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Gift Cards
export const giftCards = pgTable("gift_cards", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // Unique code like BOOO-XXXX-XXXX-XXXX
  amount: integer("amount").notNull(), // Amount in kopeks
  balance: integer("balance").notNull(), // Remaining balance in kopeks
  purchaserEmail: text("purchaser_email").notNull(), // Who bought the card
  purchaserName: text("purchaser_name"), // Buyer's name
  recipientEmail: text("recipient_email"), // Who receives the card (optional)
  recipientName: text("recipient_name"), // Recipient's name (optional)
  message: text("message"), // Personal message
  status: text("status").notNull().default("pending"), // pending, active, used, expired
  cardColor: text("card_color").default("black"), // Design color: black, red, purple, emerald, blue
  paymentId: text("payment_id"), // YooKassa/T-Bank payment ID
  paymentMethod: text("payment_method"), // yookassa, tbank
  redeemedByUserId: bigint("redeemed_by_user_id", { mode: "number" }), // Who activated
  redeemedAt: timestamp("redeemed_at"), // When activated
  expiresAt: timestamp("expires_at").notNull(), // Expiration date (1 year from purchase)
  createdAt: timestamp("created_at").defaultNow(),
});

// Gift Card Denominations (predefined amounts)
export const GIFT_CARD_AMOUNTS = [
  { value: 50000, label: "500 ₽" },
  { value: 100000, label: "1 000 ₽" },
  { value: 200000, label: "2 000 ₽" },
  { value: 500000, label: "5 000 ₽" },
  { value: 1000000, label: "10 000 ₽" },
] as const;

// Users for authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  emailVerified: boolean("email_verified").default(false),
  verificationToken: text("verification_token"),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  // Wholesale fields
  role: text("role").default("retail"), // 'retail' | 'wholesale'
  companyName: text("company_name"), // Название компании
  inn: text("inn"), // ИНН
  kpp: text("kpp"), // КПП
  legalAddress: text("legal_address"), // Юридический адрес
  contactPerson: text("contact_person"), // Контактное лицо
  contactPhone: text("contact_phone"), // Телефон для связи
  wholesaleApproved: boolean("wholesale_approved").default(false), // Подтверждён ли опт
  wholesaleDiscount: integer("wholesale_discount").default(30), // Скидка в процентах (по умолчанию 30%)
  // Loyalty/Bonus system
  totalSpent: integer("total_spent").default(0), // Total amount spent in kopeks
  loyaltyDiscount: integer("loyalty_discount").default(0), // Current loyalty discount %
  yandexId: text("yandex_id"), // Yandex OAuth user ID
  yandexLogin: text("yandex_login"), // Yandex username/login
  yandexAvatar: text("yandex_avatar"), // Yandex avatar ID (for building avatar URL)
  phone: text("phone"), // Phone number (from profile or Yandex)
  birthday: text("birthday"), // Date of birth YYYY-MM-DD (from Yandex)
  gender: text("gender"), // Gender: male / female (from Yandex)
  // Профиль покупателя
  storeName: text("store_name"), // Название магазина/площадки (для оптовиков/партнёров)
  storeAddress: text("store_address"), // Юридический адрес магазина (опт)
  savedAddresses: jsonb("saved_addresses").$type<any[]>(), // Сохранённые адреса доставки в кабинете
  shippingData: jsonb("shipping_data").$type<any>(), // Последние данные доставки (snapshot из чекаута)
  // Связь с партнёрской программой (если у пользователя есть partner-аккаунт)
  partnerSlug: text("partner_slug"), // Денормализованный slug партнёра — для быстрого поиска без JOIN
  // Legacy дубль resetTokenExpiry в виде unix-ms (старый код мог писать сюда). Использовать resetTokenExpiry.
  resetTokenExpires: bigint("reset_token_expires", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Promo codes (managed in admin panel)
export const promoCodes = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // e.g. "WELCOME10", "SALE20"
  discountPercent: integer("discount_percent"), // % discount (e.g. 10 for 10%)
  discountAmount: integer("discount_amount"), // Fixed amount in kopeks (alternative to %)
  minOrderAmount: integer("min_order_amount").default(0), // Minimum order to apply
  maxUses: integer("max_uses"), // null = unlimited
  usedCount: integer("used_count").default(0),
  canCombineWithLoyalty: boolean("can_combine_with_loyalty").default(true), // Can stack with loyalty discount
  isActive: boolean("is_active").default(true),
  applicableCategories: text("applicable_categories"), // JSON array of subcategory/category names, null = all
  startsAt: timestamp("starts_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Loyalty tiers (configurable thresholds)
export const loyaltyTiers = pgTable("loyalty_tiers", {
  id: serial("id").primaryKey(),
  minSpent: integer("min_spent").notNull(), // Minimum total_spent in kopeks
  discountPercent: integer("discount_percent").notNull(), // Discount for this tier
  name: text("name"), // Optional tier name (e.g. "Серебро", "Золото")
  sortOrder: integer("sort_order").default(0), // For ordering tiers
});

// Newsletter subscriptions (persisted, was in-memory before)
export const newsletterSubscriptions = pgTable("newsletter_subscriptions", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  promoCodeGiven: text("promo_code_given"), // Which promo code was shown
  subscribedAt: timestamp("subscribed_at").defaultNow(),
});

// Bonus system settings (key-value store)
export const bonusSettings = pgTable("bonus_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // e.g. "popup_enabled", "popup_promo_code", "combine_discounts"
  value: text("value").notNull(), // Stored as string, parsed by code
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Favorites / Wishlist
export const favorites = pgTable("favorites", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  productId: bigint("product_id", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Product reviews
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  productId: bigint("product_id", { mode: "number" }).notNull(),
  userId: bigint("user_id", { mode: "number" }),
  authorName: text("author_name").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  photos: text("photos"),
  isApproved: boolean("is_approved").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Wholesale XML feed — products selected by a wholesaler for export to their own site
export const wholesaleFeedProducts = pgTable("wholesale_feed_products", {
  id: text("id").primaryKey(), // "{userId}_{productId}"
  userId: text("user_id").notNull(),
  productId: text("product_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Token for accessing the public XML feed
export const wholesaleFeedTokens = pgTable("wholesale_feed_tokens", {
  userId: text("user_id").primaryKey(),
  token: text("token").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type WholesaleFeedProduct = typeof wholesaleFeedProducts.$inferSelect;
export type WholesaleFeedToken = typeof wholesaleFeedTokens.$inferSelect;

// =====================================================================
// Дополнительные таблицы YDB, которые раньше отсутствовали в schema.ts
// (с ними работают сырыми YQL-запросами в server/storage.ts).
// =====================================================================

// Новая таблица избранного (вместо legacy `favorites`).
// id хранится как Utf8 PK (формат: "{userId}_{productId}"), userId/productId — Utf8.
// Миграция со старой `favorites` выполняется автоматически при старте сервера.
export const userFavorites = pgTable("user_favorites", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  productId: text("product_id"),
});

// Настройки страниц для админки (главная, лукбук, sale-страница и т.д.).
// Хранятся как pageName + sectionId → произвольный JSON. UPSERT идёт по составному ключу
// (pageName, sectionId) на уровне приложения — в YDB PK по id.
export const pageSettings = pgTable("page_settings", {
  id: serial("id").primaryKey(),
  pageName: text("page_name"), // Например: "home", "lookbook", "sale"
  sectionId: text("section_id"), // Идентификатор секции на странице
  settings: jsonb("settings").$type<any>(), // Произвольный JSON-конфиг секции
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Подписчики розничного предзаказа (см. products.preorderEnabled).
// Подписываются на конкретный товар, чтобы получить уведомление, когда он поступит.
// ⚠ Все timestamp-поля здесь — Utf8 (ISO-строка), а не TIMESTAMP. Историческое решение.
export const preorderSubscribers = pgTable("preorder_subscribers", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  subscribedAt: text("subscribed_at"), // ISO-строка
  isActive: boolean("is_active").default(true),
});

// «Сообщить о поступлении» — подписки на возврат конкретного размера товара в наличие.
// ⚠ created_at / notified_at хранятся как Utf8 (ISO-строки), не TIMESTAMP.
export const stockNotifications = pgTable("stock_notifications", {
  id: text("id").primaryKey(),
  productId: bigint("product_id", { mode: "number" }),
  productName: text("product_name"),
  size: text("size"),
  email: text("email"),
  createdAt: text("created_at"), // ISO-строка
  notified: boolean("notified").default(false),
  notifiedAt: text("notified_at"), // ISO-строка
});

// «Сообщить о снижении цены» — подписки на конкретный товар, уведомление при понижении price.
// ⚠ created_at / notified_at — Utf8 (ISO-строка).
export const priceDropSubscriptions = pgTable("price_drop_subscriptions", {
  id: text("id").primaryKey(),
  productId: bigint("product_id", { mode: "number" }),
  productName: text("product_name"),
  email: text("email"),
  priceAtSubscription: bigint("price_at_subscription", { mode: "number" }), // Цена на момент подписки (kopeks)
  createdAt: text("created_at"), // ISO-строка
  notified: boolean("notified").default(false),
  notifiedAt: text("notified_at"), // ISO-строка
});

// Сообщения чата поддержки (двусторонний чат с Telegram-ботом).
// ⚠ Композитный PK: (session_id, timestamp, message_id). timestamp — INT64 (unix-ms).
// tg_message_id — ID сообщения в Telegram (для редактирования/удаления через бота).
export const chatMessages = pgTable("chat_messages", {
  messageId: text("message_id"),
  sessionId: text("session_id").notNull(),
  sender: text("sender").notNull(), // "user" | "admin" | "bot"
  text: text("text").notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(), // unix-ms
  userId: text("user_id"), // ID авторизованного пользователя (если есть)
  userName: text("user_name"), // Имя для отображения
  tgMessageId: bigint("tg_message_id", { mode: "number" }), // ID соответствующего сообщения в Telegram
  imageUrl: text("image_url"), // Если в сообщении прикреплена картинка
  isRead: boolean("is_read").default(false),
});

// Partner platform — partners promote BMGBRAND products and earn commission on attributed orders
//
// ⚠ В продовой YDB у этой таблицы 44 колонки. Базовые 14 + KYC/реквизиты/согласия (см. ниже).
// Раньше эти поля добавлялись через ALTER TABLE и в схеме отсутствовали — что приводило к тому,
// что INSERT-как-объект через `Partner` тип молча терял ~30 полей. Теперь они описаны явно.
export const partners = pgTable("partners", {
  // === Базовые поля ===
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(), // Linked user account
  partnerSlug: text("partner_slug").notNull().unique(), // URL slug, e.g. "blogger-john"
  storeName: text("store_name").notNull(), // Display name of partner / their channel / site
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | blocked
  commissionOverride: integer("commission_override"), // Custom commission % for this partner (overrides global). NULL = use global
  clicksCount: integer("clicks_count").notNull().default(0), // Total clicks on referral link
  totalEarned: integer("total_earned").notNull().default(0), // Lifetime confirmed commission, in kopeks
  payoutRequested: boolean("payout_requested").notNull().default(false), // Partner requested payout
  createdAt: timestamp("created_at").defaultNow(),
  approvedAt: timestamp("approved_at"),
  // === Реквизиты для выплат (минимальный набор) ===
  payoutMethod: text("payout_method"), // card | sbp | bank | yoomoney | ...
  payoutDetails: text("payout_details"), // Номер карты / телефон СБП / счёт — что вписал партнёр
  payoutFullName: text("payout_full_name"), // ФИО получателя (как в реквизитах)
  payoutInn: text("payout_inn"), // ИНН для выплат (может отличаться от kyc inn)
  payoutLegalStatus: text("payout_legal_status"), // self_employed | individual | ip | ooo
  // === KYC / юридические данные партнёра ===
  legalStatus: text("legal_status"), // Юридический статус: self_employed | individual | ip | ooo
  lastName: text("last_name"), // Фамилия
  firstName: text("first_name"), // Имя
  middleName: text("middle_name"), // Отчество
  inn: text("inn"), // ИНН партнёра
  birthDate: timestamp("birth_date"), // Дата рождения (YDB Date)
  citizenship: text("citizenship"), // Гражданство
  platformDescription: text("platform_description"), // Описание площадки/канала партнёра
  // === Банковские реквизиты ===
  bankAccount: text("bank_account"), // Расчётный счёт
  bankBik: text("bank_bik"), // БИК банка
  bankName: text("bank_name"), // Название банка
  bankCorrAccount: text("bank_corr_account"), // Корреспондентский счёт
  // === Согласия (юридический трейл — фиксируем версию документа на момент подписания) ===
  offerAcceptedAt: timestamp("offer_accepted_at"), // Принята оферта
  offerVersion: text("offer_version"), // Версия оферты (например, "2025-09-15")
  privacyAcceptedAt: timestamp("privacy_accepted_at"), // Принята политика конфиденциальности
  privacyVersion: text("privacy_version"),
  selfEmployedAcceptedAt: timestamp("self_employed_accepted_at"), // Подтверждение статуса самозанятого
  selfEmployedVersion: text("self_employed_version"),
  adultAcceptedAt: timestamp("adult_accepted_at"), // Подтверждение совершеннолетия
  adultVersion: text("adult_version"),
  marketingAcceptedAt: timestamp("marketing_accepted_at"), // Согласие на маркетинговые рассылки
  marketingVersion: text("marketing_version"),
  // === Аудит подписания согласий ===
  consentIp: text("consent_ip"), // IP клиента (из X-Forwarded-For после trust proxy — может быть подделан при прямом доступе к контейнеру)
  consentRemoteIp: text("consent_remote_ip"), // IP последнего хопа TCP-сокета (req.socket.remoteAddress) — нельзя подделать. Должен попадать в диапазоны Yandex Cloud Gateway.
  consentCountry: text("consent_country"), // Страна по GeoIP (ip-api.com) на момент подписания — для фиксации юрисдикции.
  consentRegion: text("consent_region"),   // Регион/область по GeoIP.
  consentCity: text("consent_city"),       // Город по GeoIP.
  consentUserAgent: text("consent_user_agent"), // User-Agent на момент подписания
  consentSignedAt: timestamp("consent_signed_at"), // Когда был подписан полный пакет согласий
  // === Реквизиты ИП и Юр. лица (для договора и закрывающих документов) ===
  companyName: text("company_name"), // ИП: «ИП Иванов И.И.», ЮЛ: полное наименование организации
  kpp: text("kpp"), // КПП (только ЮЛ, 9 цифр)
  ogrn: text("ogrn"), // ОГРН (13 цифр для ЮЛ) или ОГРНИП (15 цифр для ИП)
  legalAddress: text("legal_address"), // Юридический адрес (ИП и ЮЛ)
  signerPosition: text("signer_position"), // Должность подписанта (ЮЛ)
  signerBasis: text("signer_basis"), // Основание полномочий подписанта (Устав / Доверенность)
  // === Хэши подписанных документов (юридическая фиксация ПЭП по 63-ФЗ) ===
  // На момент подписания — снимок sha256 от тела соответствующего документа из legal_documents.
  // Если позже текст подменят — хэши не сойдутся, и мы это докажем.
  offerHash: text("offer_hash"),
  privacyHash: text("privacy_hash"),
  adultHash: text("adult_hash"),
  selfEmployedHash: text("self_employed_hash"),
  marketingHash: text("marketing_hash"),
  isArtist: boolean("is_artist").default(false), // Является ли партнёр артистом
  artistRate: doublePrecision("artist_rate").default(0), // Процент артиста от оборота его товаров (0 = не задан)
});

// Архив версий юридических документов (оферта, политика, согласия).
// Append-only: при публикации новой версии прежняя помечается is_active=false и НЕ удаляется.
// Хэш sha256 считается от body на момент создания записи и используется для подписи.
export const legalDocuments = pgTable("legal_documents", {
  id: text("id").primaryKey(), // "{slug}:{version}", напр. "offer:2025-09-15"
  slug: text("slug").notNull(), // "offer" | "privacy" | "adult" | "self_employed" | "marketing"
  version: text("version").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(), // полный текст документа на момент публикации
  bodyHash: text("body_hash").notNull(), // hex sha256 от body
  createdAt: timestamp("created_at"),
  createdBy: text("created_by"), // email админа, опубликовавшего версию
  isActive: boolean("is_active").notNull().default(false),
});

// Журнал подписей (audit trail). Append-only.
// Одна строка = один поставленный чекбокс согласия одного типа документа одним партнёром.
export const consentSignatures = pgTable("consent_signatures", {
  id: text("id").primaryKey(),
  partnerId: bigint("partner_id", { mode: "number" }).notNull(),
  documentId: text("document_id").notNull(), // ссылка на legal_documents.id
  documentSlug: text("document_slug").notNull(), // offer | privacy | ...
  documentVersion: text("document_version").notNull(),
  documentHash: text("document_hash").notNull(),
  signedAt: timestamp("signed_at").notNull(),
  ip: text("ip").notNull(), // IP клиента (через X-Forwarded-For, после trust proxy)
  remoteIp: text("remote_ip"), // настоящий IP TCP-сокета (req.socket.remoteAddress). Append-only форензик-поле для криминалистической сверки с диапазонами Yandex Cloud Gateway.
  consentCountry: text("consent_country"), // Страна по GeoIP (ip-api.com) на момент подписания — для фиксации юрисдикции.
  consentRegion: text("consent_region"),   // Регион/область по GeoIP.
  consentCity: text("consent_city"),       // Город по GeoIP.
  userAgent: text("user_agent").notNull(),
  method: text("method").notNull().default("checkbox"), // checkbox | otp-sms | otp-email
});

// Products selected by partner to promote (used by widget; public partner page can show all selected)
export const partnerProducts = pgTable("partner_products", {
  id: text("id").primaryKey(), // "{partnerId}_{productId}"
  partnerId: bigint("partner_id", { mode: "number" }).notNull(),
  productId: bigint("product_id", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Commission record per attributed order
export const partnerCommissions = pgTable("partner_commissions", {
  id: serial("id").primaryKey(),
  partnerId: bigint("partner_id", { mode: "number" }).notNull(),
  orderId: bigint("order_id", { mode: "number" }).notNull(),
  orderItemsTotal: integer("order_items_total").notNull(), // Discounted items total (no delivery), in kopeks
  commissionPercent: integer("commission_percent").notNull(), // % at the moment of order
  commissionAmount: integer("commission_amount").notNull(), // In kopeks
  status: text("status").notNull().default("pending"), // pending | confirmed | cancelled | paid
  confirmedAt: timestamp("confirmed_at"),
  paidAt: timestamp("paid_at"),
  // Manual-hold model: webhook sets hold_until = paidAt + holdDays when payment lands
  // (status STAYS "pending"). Admin manually moves to "confirmed" via /confirm endpoint.
  // hold_until IS NULL → still awaiting payment. hold_until > now → in hold period.
  // hold_until <= now → ready for admin confirmation (UI shows "Готово к подтверждению").
  holdUntil: timestamp("hold_until"),
  createdAt: timestamp("created_at").defaultNow(),
  commissionType: text("commission_type"), // 'artist' | 'referral' | null (legacy)
});

// Payout history — one row per actual payout to partner (created via admin /payout endpoint)
export const partnerPayouts = pgTable("partner_payouts", {
  id: serial("id").primaryKey(),
  partnerId: bigint("partner_id", { mode: "number" }).notNull(),
  amount: integer("amount").notNull(), // total payout amount in kopeks
  commissionCount: integer("commission_count").notNull(), // how many commission rows are covered
  commissionIds: text("commission_ids").notNull(), // JSON array of commission IDs paid in this payout
  method: text("method").notNull(), // free-form: "card" | "sbp" | "bank" | "yoomoney" | etc
  recipientName: text("recipient_name").notNull(), // ФИО получателя
  recipientDetails: text("recipient_details").notNull(), // карта/телефон/счёт — что вписал партнёр/админ
  note: text("note"), // optional admin note
  createdBy: text("created_by"), // admin email (audit trail)
  createdAt: timestamp("created_at").defaultNow(),
  // ─── Машина состояний выплат самозанятым (НПД) ─────────────────────────
  // awaiting_invoice → invoice_uploaded → paid_pending_receipt → completed
  //                                                            ↘ rejected
  status: text("status").notNull().default("awaiting_invoice"),
  // Счёт от самозанятого (формируется в приложении «Мой налог»)
  invoiceUrl: text("invoice_url"), // Приватная ссылка в S3 (скачивание через сервер)
  invoiceUploadedAt: timestamp("invoice_uploaded_at"),
  invoiceNumber: text("invoice_number"), // Номер счёта (опционально)
  // Отметка админа об оплате
  paidAt: timestamp("paid_at"),
  paidReference: text("paid_reference"), // Номер платёжного поручения / референс перевода
  // Чек от самозанятого (НПД) — обязателен по закону для подтверждения (legalStatus = self_employed)
  receiptUrl: text("receipt_url"),
  receiptUploadedAt: timestamp("receipt_uploaded_at"),
  receiptNumber: text("receipt_number"), // Номер чека из «Мой налог»
  // Акт оказанных услуг — для ИП и ЮЛ (legalStatus = ip | ooo).
  // Для самозанятых вместо акта используется чек НПД из «Мой налог» (см. поля receipt_*).
  actUrl: text("act_url"),
  actUploadedAt: timestamp("act_uploaded_at"),
  actNumber: text("act_number"), // Номер акта (например, "АКТ-100/2026-04")
  // Финализация / отклонение
  completedAt: timestamp("completed_at"),
  rejectedReason: text("rejected_reason"),
});

export const PARTNER_PAYOUT_STATUSES = [
  "awaiting_invoice",
  "invoice_uploaded",
  "paid_pending_receipt", // СЗ: деньги переведены, ждём чек НПД
  "paid_pending_act",     // ИП/ЮЛ: деньги переведены, ждём акт оказанных услуг
  "completed",
  "rejected",
] as const;
export type PartnerPayoutStatus = (typeof PARTNER_PAYOUT_STATUSES)[number];

export type Partner = typeof partners.$inferSelect;
export type PartnerProduct = typeof partnerProducts.$inferSelect;
export type PartnerCommission = typeof partnerCommissions.$inferSelect;
export type PartnerPayout = typeof partnerPayouts.$inferSelect;

export const insertPartnerSchema = createInsertSchema(partners).omit({
  id: true,
  status: true,
  clicksCount: true,
  totalEarned: true,
  payoutRequested: true,
  createdAt: true,
  approvedAt: true,
  // Аудит подписания согласий заполняется на сервере, не из формы
  consentIp: true,
  consentUserAgent: true,
  consentSignedAt: true,
});
export type InsertPartner = z.infer<typeof insertPartnerSchema>;

// === Типы и insert-схемы для дополнительных таблиц ===
export type UserFavorite = typeof userFavorites.$inferSelect;
export type PageSetting = typeof pageSettings.$inferSelect;
export type PreorderSubscriber = typeof preorderSubscribers.$inferSelect;
export type StockNotification = typeof stockNotifications.$inferSelect;
export type PriceDropSubscription = typeof priceDropSubscriptions.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;

export const insertUserFavoriteSchema = createInsertSchema(userFavorites);
export const insertPageSettingSchema = createInsertSchema(pageSettings).omit({ id: true, updatedAt: true });
export const insertPreorderSubscriberSchema = createInsertSchema(preorderSubscribers).omit({ id: true, subscribedAt: true, isActive: true });
export const insertStockNotificationSchema = createInsertSchema(stockNotifications).omit({ id: true, createdAt: true, notified: true, notifiedAt: true });
export const insertPriceDropSubscriptionSchema = createInsertSchema(priceDropSubscriptions).omit({ id: true, createdAt: true, notified: true, notifiedAt: true });
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ messageId: true, isRead: true, tgMessageId: true });

export type InsertUserFavorite = z.infer<typeof insertUserFavoriteSchema>;
export type InsertPageSetting = z.infer<typeof insertPageSettingSchema>;
export type InsertPreorderSubscriber = z.infer<typeof insertPreorderSubscriberSchema>;
export type InsertStockNotification = z.infer<typeof insertStockNotificationSchema>;
export type InsertPriceDropSubscription = z.infer<typeof insertPriceDropSubscriptionSchema>;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;

// === Юридические документы и согласия партнёров ===
// 5 типов документов, под каждый — отдельная запись в legal_documents (с версией, текстом, хэшем).
// При регистрации партнёр подписывает: оферту, политику, 18+, маркетинг (опционально).
// Дополнительно для самозанятых — подтверждение статуса самозанятого.
export const LEGAL_DOCUMENT_SLUGS = ["offer", "privacy", "adult", "self_employed", "marketing"] as const;
export type LegalDocumentSlug = (typeof LEGAL_DOCUMENT_SLUGS)[number];

export const PARTNER_LEGAL_STATUSES = ["self_employed", "ip", "ooo"] as const;
export type PartnerLegalStatus = (typeof PARTNER_LEGAL_STATUSES)[number];

export type LegalDocument = typeof legalDocuments.$inferSelect;
export type ConsentSignature = typeof consentSignatures.$inferSelect;
export const insertLegalDocumentSchema = createInsertSchema(legalDocuments).omit({ id: true, bodyHash: true, createdAt: true });
export type InsertLegalDocument = z.infer<typeof insertLegalDocumentSchema>;
export const insertConsentSignatureSchema = createInsertSchema(consentSignatures).omit({ id: true });
export type InsertConsentSignature = z.infer<typeof insertConsentSignatureSchema>;

// === Валидаторы российских реквизитов (контрольные суммы по официальным алгоритмам) ===
// ИНН 10 цифр (ЮЛ) — алгоритм ФНС
function isValidInn10(inn: string): boolean {
  if (!/^\d{10}$/.test(inn)) return false;
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(inn[i], 10) * w[i];
  return ((s % 11) % 10) === parseInt(inn[9], 10);
}
// ИНН 12 цифр (физ.лицо / ИП / самозанятый) — двойной контроль
function isValidInn12(inn: string): boolean {
  if (!/^\d{12}$/.test(inn)) return false;
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  let s1 = 0, s2 = 0;
  for (let i = 0; i < 10; i++) s1 += parseInt(inn[i], 10) * w1[i];
  for (let i = 0; i < 11; i++) s2 += parseInt(inn[i], 10) * w2[i];
  return ((s1 % 11) % 10) === parseInt(inn[10], 10) && ((s2 % 11) % 10) === parseInt(inn[11], 10);
}
// ОГРН 13 цифр (ЮЛ): сумма первых 12 цифр, делённая на 11, последняя цифра суммы — контрольная
function isValidOgrn(ogrn: string): boolean {
  if (!/^\d{13}$/.test(ogrn)) return false;
  const n = BigInt(ogrn.slice(0, 12));
  const ctl = Number(n % 11n) % 10;
  return ctl === parseInt(ogrn[12], 10);
}
// ОГРНИП 15 цифр (ИП): первые 14 цифр / 13, остаток — контрольная
function isValidOgrnip(ogrnip: string): boolean {
  if (!/^\d{15}$/.test(ogrnip)) return false;
  const n = BigInt(ogrnip.slice(0, 14));
  const ctl = Number(n % 13n) % 10;
  return ctl === parseInt(ogrnip[14], 10);
}
// БИК — 9 цифр, начинается с 04 (территория РФ) или 00/01/02/03 (тех. коды), но в общем достаточно проверить длину и цифры
function isValidBik(bik: string): boolean {
  return /^\d{9}$/.test(bik);
}
// КПП — 9 знаков (5-я и 6-я могут быть буквами латиницы для иностранных орг., у российских — цифры)
function isValidKpp(kpp: string): boolean {
  return /^[0-9]{4}[0-9A-Z]{2}[0-9]{3}$/.test(kpp);
}
// Расчётный счёт — 20 цифр + контрольная сумма с БИК (алгоритм ЦБ)
function isValidBankAccount(account: string, bik: string): boolean {
  if (!/^\d{20}$/.test(account)) return false;
  if (!isValidBik(bik)) return false;
  const bikRs = bik.slice(-3) + account;
  const weights = [7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1];
  let s = 0;
  for (let i = 0; i < 23; i++) s += (parseInt(bikRs[i], 10) * weights[i]) % 10;
  return s % 10 === 0;
}

const phoneSchema = z.string().min(10, "Введите телефон");
const fioPart = z.string().min(1, "Обязательное поле").max(60);

// Общие поля любой партнёрской заявки
const partnerCommonFields = {
  email: z.string().email("Некорректный email"),
  password: z.string().min(6, "Минимум 6 символов"),
  contactName: z.string().min(2, "Введите имя"),
  storeName: z.string().min(2, "Введите название площадки/канала"),
  partnerSlug: z.string()
    .min(3, "Минимум 3 символа")
    .max(40, "Максимум 40 символов")
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Только латинские буквы в нижнем регистре, цифры и дефисы"),
  contactPhone: phoneSchema,
  platformDescription: z.string().min(1, "Выберите хотя бы одну площадку").max(2000),
  // Банковские реквизиты — опциональны при регистрации, заполняются в ЛК
  bankBik: z.string().refine(isValidBik, "БИК должен состоять из 9 цифр").optional().or(z.literal("")),
  bankAccount: z.string().regex(/^\d{20}$/, "Расчётный счёт — 20 цифр").optional().or(z.literal("")),
  bankName: z.string().min(2, "Название банка").optional().or(z.literal("")),
  bankCorrAccount: z.string().regex(/^\d{20}$/, "Корр. счёт — 20 цифр").optional().or(z.literal("")),
  // Согласия (булевы галочки на форме). На сервере фиксируется *AcceptedAt + *Version + *Hash.
  acceptOffer: z.literal(true, { errorMap: () => ({ message: "Нужно принять оферту" }) }),
  acceptPrivacy: z.literal(true, { errorMap: () => ({ message: "Нужно согласиться с политикой конфиденциальности" }) }),
  acceptMarketing: z.boolean().optional().default(false),
  isArtist: z.boolean().optional().default(false),
} as const;

// Самозанятый — ФИО, ИНН (12), дата рождения, гражданство, подтверждение статуса
const partnerSelfEmployedSchema = z.object({
  legalStatus: z.literal("self_employed"),
  ...partnerCommonFields,
  lastName: fioPart,
  firstName: fioPart,
  middleName: z.string().max(60).optional().or(z.literal("")),
  inn: z.string().refine(isValidInn12, "Некорректный ИНН (12 цифр + контрольная сумма)"),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата рождения в формате YYYY-MM-DD"),
  citizenship: z.string().min(2, "Гражданство"),
  acceptAdult: z.literal(true, { errorMap: () => ({ message: "Подтвердите, что вам исполнилось 18 лет" }) }),
  acceptSelfEmployed: z.literal(true, { errorMap: () => ({ message: "Подтвердите статус самозанятого" }) }),
});

// ИП — ФИО + companyName + ИНН (12) + ОГРНИП (15) + legalAddress + банк
const partnerIpSchema = z.object({
  legalStatus: z.literal("ip"),
  ...partnerCommonFields,
  lastName: fioPart,
  firstName: fioPart,
  middleName: z.string().max(60).optional().or(z.literal("")),
  companyName: z.string().min(3, "Например: «ИП Иванов И.И.»"),
  inn: z.string().refine(isValidInn12, "ИНН ИП — 12 цифр с контрольной суммой"),
  ogrn: z.string().refine(isValidOgrnip, "ОГРНИП — 15 цифр с контрольной суммой"),
  legalAddress: z.string().min(5, "Юридический адрес"),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата рождения").optional().or(z.literal("")),
});

// Юр. лицо — companyName + ИНН (10) + КПП + ОГРН (13) + legalAddress + ФИО подписанта + signerPosition + signerBasis + банк
const partnerOooSchema = z.object({
  legalStatus: z.literal("ooo"),
  ...partnerCommonFields,
  companyName: z.string().min(3, "Полное наименование организации"),
  inn: z.string().refine(isValidInn10, "ИНН юрлица — 10 цифр с контрольной суммой"),
  kpp: z.string().refine(isValidKpp, "КПП — 9 знаков"),
  ogrn: z.string().refine(isValidOgrn, "ОГРН — 13 цифр с контрольной суммой"),
  legalAddress: z.string().min(5, "Юридический адрес"),
  lastName: fioPart, // ФИО подписанта
  firstName: fioPart,
  middleName: z.string().max(60).optional().or(z.literal("")),
  signerPosition: z.string().min(2, "Должность подписанта (например, Генеральный директор)"),
  signerBasis: z.string().min(2, "Основание полномочий (Устав / Доверенность № …)"),
});

// Дискриминированный union: одна форма — три варианта валидации в зависимости от выбранного типа.
// Дополнительно — кросс-проверка контрольной суммы счёта против БИК после парсинга.
export const partnerRegisterSchema = z.discriminatedUnion("legalStatus", [
  partnerSelfEmployedSchema,
  partnerIpSchema,
  partnerOooSchema,
]).superRefine((data, ctx) => {
  // Проверяем контрольную сумму только если оба поля заполнены (реквизиты опциональны при регистрации)
  if (data.bankAccount && data.bankBik && !isValidBankAccount(data.bankAccount, data.bankBik)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bankAccount"],
      message: "Расчётный счёт не проходит контрольную сумму с указанным БИК",
    });
  }
});
export type PartnerRegister = z.infer<typeof partnerRegisterSchema>;
export type PartnerSelfEmployedRegister = z.infer<typeof partnerSelfEmployedSchema>;
export type PartnerIpRegister = z.infer<typeof partnerIpSchema>;
export type PartnerOooRegister = z.infer<typeof partnerOooSchema>;

// Partner platform constants
export const PARTNER_DEFAULT_COMMISSION_PERCENT = 25; // fallback для артистов без artistRate
export const PARTNER_PAYOUT_MIN_KOPEKS = 0; // без минимальной суммы
export const PARTNER_COOKIE_NAME = "ref";
export const PARTNER_COOKIE_MAX_AGE_DAYS = 30;
export const PARTNER_GLOBAL_COMMISSION_SETTING_KEY = "partner_global_commission_percent";
export const PARTNER_HOLD_DAYS_SETTING_KEY = "partner_hold_days";
export const PARTNER_DEFAULT_HOLD_DAYS = 14; // hold period after payment before admin can confirm
export const PARTNER_STATUSES = ["pending", "approved", "rejected", "blocked"] as const;
export const PARTNER_COMMISSION_STATUSES = ["pending", "confirmed", "cancelled", "paid"] as const;

/**
 * Прогрессивная шкала комиссии для Реф-партнёров (без commissionOverride, без isArtist).
 * Пороги задаются накопленной суммой orderItemsTotal за календарный месяц (в копейках).
 * При переходе порога ВСЕ комиссии за месяц пересчитываются по новой ставке.
 */
export const PARTNER_PROGRESSIVE_TIERS = [
  { minTotal: 2_000_000, rate: 25 }, // накоплено >= 20 000 ₽ → 25%
  { minTotal: 1_000_000, rate: 20 }, // накоплено >= 10 000 ₽ → 20%
  { minTotal: 0,         rate: 15 }, // накоплено < 10 000 ₽  → 15%
] as const;

/**
 * Возвращает ставку комиссии Реф-партнёра по накопленной сумме продаж за месяц.
 * @param monthlyTotal накопленная сумма orderItemsTotal за месяц в копейках
 */
export function getProgressiveCommissionRate(monthlyTotal: number): number {
  for (const tier of PARTNER_PROGRESSIVE_TIERS) {
    if (monthlyTotal >= tier.minTotal) return tier.rate;
  }
  return 15;
}

// Settings keys for documentation and validation
export const BONUS_SETTING_KEYS = {
  POPUP_ENABLED: "popup_enabled",
  POPUP_PROMO_ID: "popup_promo_id",
  POPUP_TITLE: "popup_title",
  POPUP_SUBTITLE: "popup_subtitle",
  POPUP_DESCRIPTION: "popup_description",
  POPUP_BUTTON_TEXT: "popup_button_text",
  POPUP_SUCCESS_TITLE: "popup_success_title",
  POPUP_SUCCESS_TEXT: "popup_success_text",
  POPUP_DELAY: "popup_delay",
  POPUP_PLACEHOLDER: "popup_placeholder",
  POPUP_CLOSE_TEXT: "popup_close_text",
  HOMEPAGE_PROMO_ID: "homepage_promo_id",
} as const;

// Schemas
export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true });
export const insertCartItemSchema = createInsertSchema(cartItems).omit({ id: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true, status: true, items: true, total: true });
export const insertSubscriberSchema = createInsertSchema(subscribers).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, emailVerified: true, verificationToken: true, resetToken: true, resetTokenExpiry: true, resetTokenExpires: true, wholesaleApproved: true, totalSpent: true, loyaltyDiscount: true, yandexId: true, yandexLogin: true, yandexAvatar: true, phone: true, birthday: true, gender: true, storeName: true, storeAddress: true, savedAddresses: true, shippingData: true, partnerSlug: true });
export const insertGiftCardSchema = createInsertSchema(giftCards).omit({ id: true, createdAt: true, status: true, redeemedByUserId: true, redeemedAt: true });
export const insertPromoCodeSchema = createInsertSchema(promoCodes).omit({ id: true, createdAt: true, usedCount: true });
export const insertLoyaltyTierSchema = createInsertSchema(loyaltyTiers).omit({ id: true });
export const insertNewsletterSubscriptionSchema = createInsertSchema(newsletterSubscriptions).omit({ id: true, subscribedAt: true });
export const insertBonusSettingSchema = createInsertSchema(bonusSettings).omit({ id: true, updatedAt: true });
export const insertReviewSchema = createInsertSchema(reviews).omit({ id: true, createdAt: true, isApproved: true });
export const insertFavoriteSchema = createInsertSchema(favorites).omit({ id: true, createdAt: true });

// Schema for purchasing a gift card
export const purchaseGiftCardSchema = z.object({
  amount: z.number().refine(val => GIFT_CARD_AMOUNTS.some(a => a.value === val), "Выберите номинал карты"),
  purchaserEmail: z.string().email("Некорректный email"),
  purchaserName: z.string().min(2, "Введите имя"),
  recipientEmail: z.string().email("Некорректный email").optional().or(z.literal("")),
  recipientName: z.string().optional(),
  message: z.string().max(500, "Сообщение не более 500 символов").optional(),
});
export type PurchaseGiftCard = z.infer<typeof purchaseGiftCardSchema>;

// Schema for wholesale registration
export const wholesaleRegisterSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(6, "Минимум 6 символов"),
  name: z.string().min(2, "Введите имя"),
  companyName: z.string().min(2, "Введите название компании"),
  inn: z.string().min(10, "ИНН должен быть 10 или 12 цифр").max(12),
  kpp: z.string().optional(),
  legalAddress: z.string().min(5, "Введите юридический адрес"),
  contactPerson: z.string().min(2, "Введите контактное лицо"),
  contactPhone: z.string().min(10, "Введите телефон"),
});
export type WholesaleRegister = z.infer<typeof wholesaleRegisterSchema>;

// Types
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type CartItem = typeof cartItems.$inferSelect;
export type InsertCartItem = z.infer<typeof insertCartItemSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Subscriber = typeof subscribers.$inferSelect;
export type InsertSubscriber = z.infer<typeof insertSubscriberSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type GiftCard = typeof giftCards.$inferSelect;
export type InsertGiftCard = z.infer<typeof insertGiftCardSchema>;
export type PromoCode = typeof promoCodes.$inferSelect;
export type InsertPromoCode = z.infer<typeof insertPromoCodeSchema>;
export type LoyaltyTier = typeof loyaltyTiers.$inferSelect;
export type InsertLoyaltyTier = z.infer<typeof insertLoyaltyTierSchema>;
export type NewsletterSubscription = typeof newsletterSubscriptions.$inferSelect;
export type InsertNewsletterSubscription = z.infer<typeof insertNewsletterSubscriptionSchema>;
export type BonusSetting = typeof bonusSettings.$inferSelect;
export type InsertBonusSetting = z.infer<typeof insertBonusSettingSchema>;
export type Review = typeof reviews.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Favorite = typeof favorites.$inferSelect;
export type InsertFavorite = z.infer<typeof insertFavoriteSchema>;
