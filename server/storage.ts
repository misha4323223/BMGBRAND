import { driver } from "./db";
import { type Product, type InsertProduct, type CartItem, type InsertCartItem, type Order, type InsertOrder } from "@shared/schema";
import ydb from "ydb-sdk";

export interface IStorage {
  getProductByExternalId(externalId: string): Promise<Product | undefined>;
  getProductBySku(sku: string): Promise<Product | undefined>;
  getProducts(): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product>;
  getCartItems(sessionId: string): Promise<(CartItem & { product: Product })[]>;
  addToCart(item: InsertCartItem): Promise<CartItem>;
  removeFromCart(id: number): Promise<void>;
  clearCart(sessionId: string): Promise<void>;
  getOrders(): Promise<Order[]>;
  getOrdersByStatus(status: string): Promise<Order[]>;
  updateOrderStatus(id: number, status: string): Promise<Order>;
  createOrder(order: InsertOrder & { items: any[], total: number }): Promise<Order>;
}

export class DatabaseStorage implements IStorage {
  private async safeQuery<T>(fn: (session: ydb.Session) => Promise<T>): Promise<T | null> {
    if (!driver) return null;
    try {
      return await driver.tableClient.withSession(fn);
    } catch (err: any) {
      console.error("[YDB Query Error]:", err.message || err);
      return null;
    }
  }

  private extractValue(val: any): any {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && 'value' in val) return val.value;
    return val;
  }

  private parseRow(row: any): Product {
    const getValue = (key: string) => this.extractValue(row[key]);
    
    let imagesRaw = getValue('images');
    let images: string[] = [];
    if (imagesRaw) {
      if (typeof imagesRaw === 'string') {
        try { images = JSON.parse(imagesRaw); } catch { images = []; }
      } else if (Array.isArray(imagesRaw)) {
        images = imagesRaw;
      }
    }
    
    let sizesRaw = getValue('sizes');
    let sizes: string[] = [];
    if (sizesRaw) {
      if (typeof sizesRaw === 'string') {
        try { sizes = JSON.parse(sizesRaw); } catch { sizes = []; }
      } else if (Array.isArray(sizesRaw)) {
        sizes = sizesRaw;
      }
    }
    
    let colorsRaw = getValue('colors');
    let colors: string[] = [];
    if (colorsRaw) {
      if (typeof colorsRaw === 'string') {
        try { colors = JSON.parse(colorsRaw); } catch { colors = []; }
      } else if (Array.isArray(colorsRaw)) {
        colors = colorsRaw;
      }
    }
    
    const idVal = getValue('id');
    const priceVal = getValue('price');
    
    return {
      id: typeof idVal === 'string' ? parseInt(idVal) || 0 : (idVal || 0),
      externalId: getValue('external_id') || null,
      sku: getValue('sku') || null,
      name: getValue('name') || '',
      description: getValue('description') || '',
      price: typeof priceVal === 'number' ? priceVal : parseInt(priceVal) || 0,
      imageUrl: images.length > 0 ? images[0] : (getValue('image_url') || ''),
      category: getValue('category') || '',
      sizes,
      colors,
      isNew: getValue('is_new') === true || getValue('is_new') === 'true',
      createdAt: getValue('created_at') || new Date(),
    } as Product;
  }

  async getProducts(): Promise<Product[]> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery("SELECT * FROM products");
      if (!resultSets[0].rows) return [];
      console.log("[YDB] Raw row sample:", JSON.stringify(resultSets[0].rows[0]));
      return resultSets[0].rows.map((row: any) => this.parseRow(row));
    });
    return result || [];
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $id AS Utf8; SELECT * FROM products WHERE id = $id";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $id: TypedValues.fromNative(Types.UTF8, String(id)) });
      const row: any = resultSets[0].rows?.[0];
      if (!row) return undefined;
      return this.parseRow(row);
    });
    return result || undefined;
  }

  async getProductByExternalId(externalId: string): Promise<Product | undefined> {
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $externalId AS Utf8; SELECT * FROM products WHERE external_id = $externalId";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $externalId: TypedValues.fromNative(Types.UTF8, externalId) });
      const row = resultSets[0].rows?.[0];
      if (!row) return undefined;
      return this.parseRow(row);
    });
    return result || undefined;
  }

  async getProductBySku(sku: string): Promise<Product | undefined> {
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $sku AS Utf8; SELECT * FROM products WHERE sku = $sku";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $sku: TypedValues.fromNative(Types.UTF8, sku) });
      const row = resultSets[0].rows?.[0];
      if (!row) return undefined;
      return this.parseRow(row);
    });
    return result || undefined;
  }

  async createProduct(p: InsertProduct): Promise<Product> { return { ...p, id: Math.floor(Math.random() * 1000) } as any; }
  async updateProduct(id: number, p: Partial<InsertProduct>): Promise<Product> { return { ...p, id } as any; }
  async getCartItems(sessionId: string): Promise<(CartItem & { product: Product })[]> { return []; }
  async addToCart(item: InsertCartItem): Promise<CartItem> { return { ...item, id: Math.floor(Math.random() * 1000) } as any; }
  async removeFromCart(id: number): Promise<void> {}
  async clearCart(sessionId: string): Promise<void> {}
  async getOrders(): Promise<Order[]> { return []; }
  async getOrdersByStatus(status: string): Promise<Order[]> { return []; }
  async updateOrderStatus(id: number, status: string): Promise<Order> { return { id, status } as any; }
  async createOrder(order: InsertOrder & { items: any[], total: number }): Promise<Order> { return { ...order, id: Math.floor(Math.random() * 1000) } as any; }
}

export const storage = new DatabaseStorage();
