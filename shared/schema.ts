import { pgTable, text, serial, integer, boolean, timestamp, jsonb, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

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
  category: text("category").notNull(),
  sizes: jsonb("sizes").$type<string[]>().notNull(), // e.g. ["S", "M", "L", "XL"]
  colors: jsonb("colors").$type<string[]>().notNull(), // e.g. ["Black", "White"]
  isNew: boolean("is_new").default(false),
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

// Schemas
export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true });
export const insertCartItemSchema = createInsertSchema(cartItems).omit({ id: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true, status: true, items: true, total: true });

// Types
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type CartItem = typeof cartItems.$inferSelect;
export type InsertCartItem = z.infer<typeof insertCartItemSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
