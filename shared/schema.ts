import { pgTable, text, serial, integer, boolean, timestamp, jsonb, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Category structure for navigation
export const CATEGORIES = {
  clothing: {
    name: "Одежда",
    slug: "clothing",
    subcategories: ["Толстовки", "Свитшоты", "Свитера", "Шорты", "Футболки", "Куртки", "Брюки"]
  },
  socks: {
    name: "Носки",
    slug: "socks",
    subcategories: [
      "Классические (40-45)", 
      "Классические (34-39)", 
      "На спорт Резинке (40-45)", 
      "На спорт Резинке (34-39)", 
      "Короткие (40-45)", 
      "Короткие (34-39)", 
      "Детские"
    ]
  },
  accessories: {
    name: "Аксессуары",
    slug: "accessories",
    subcategories: ["Кружки", "Ремни", "Сумки", "Шапки"]
  },
  merch: {
    name: "Мерч",
    slug: "merch",
    subcategories: ["JDM", "Тульские Дизайнеры", "ДИКАЯ МЯТА", "ГУДТАЙМС"]
  },
  sale: {
    name: "Распродажа",
    slug: "sale",
    subcategories: []
  }
} as const;

export type CategorySlug = keyof typeof CATEGORIES;

// Products
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").unique(), // ID from 1C
  sku: text("sku").unique(), // Article/SKU
  name: text("name").notNull(),
  description: text("description").notNull(),
  price: integer("price").notNull(), // stored in cents/kopeks
  imageUrl: text("image_url").notNull(),
  thumbnailUrl: text("thumbnail_url"), // 300px thumbnail for catalog
  category: text("category").notNull(), // Main category slug: clothing, socks, accessories, merch, sale
  subcategory: text("subcategory"), // Subcategory name
  sizes: jsonb("sizes").$type<string[]>().notNull(), // e.g. ["S", "M", "L", "XL"]
  colors: jsonb("colors").$type<string[]>().notNull(), // e.g. ["Black", "White"]
  isNew: boolean("is_new").default(false),
  onSale: boolean("on_sale").default(false), // For sale category
  createdAt: timestamp("created_at").defaultNow(),
});

// Cart Items (Guest session based)
export const cartItems = pgTable("cart_items", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  productId: bigint("product_id", { mode: "number" }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  size: text("size"),
  color: text("color"),
});

// Orders
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  address: text("address").notNull(),
  total: integer("total").notNull(),
  items: jsonb("items").$type<any[]>().notNull(), // Snapshot of items
  status: text("status").notNull().default("pending"), // pending, confirmed, shipped
  createdAt: timestamp("created_at").defaultNow(),
});

// Newsletter Subscribers
export const subscribers = pgTable("subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Schemas
export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true });
export const insertCartItemSchema = createInsertSchema(cartItems).omit({ id: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true, status: true, items: true, total: true });
export const insertSubscriberSchema = createInsertSchema(subscribers).omit({ id: true, createdAt: true });

// Types
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type CartItem = typeof cartItems.$inferSelect;
export type InsertCartItem = z.infer<typeof insertCartItemSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Subscriber = typeof subscribers.$inferSelect;
export type InsertSubscriber = z.infer<typeof insertSubscriberSchema>;
