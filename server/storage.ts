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

  private extractTypedValue(item: any): any {
    if (!item) return null;
    if ('textValue' in item) return item.textValue;
    if ('uint64Value' in item) return item.uint64Value;
    if ('int64Value' in item) return item.int64Value;
    if ('uint32Value' in item) return item.uint32Value;
    if ('int32Value' in item) return item.int32Value;
    if ('doubleValue' in item) return item.doubleValue;
    if ('floatValue' in item) return item.floatValue;
    if ('boolValue' in item) return item.boolValue;
    if ('bytesValue' in item) return item.bytesValue;
    if ('nullFlagValue' in item) return null;
    if ('value' in item) return item.value;
    return null;
  }

  private parseRowWithColumns(row: any, columns: any[]): Record<string, any> {
    const result: Record<string, any> = {};
    if (row.items && Array.isArray(row.items)) {
      for (let i = 0; i < row.items.length && i < columns.length; i++) {
        const colName = columns[i].name;
        result[colName] = this.extractTypedValue(row.items[i]);
      }
    }
    return result;
  }

  private parseProduct(data: Record<string, any>): Product {
    let images: string[] = [];
    if (data.images) {
      if (typeof data.images === 'string') {
        try { images = JSON.parse(data.images); } catch { images = []; }
      } else if (Array.isArray(data.images)) {
        images = data.images;
      }
    }
    
    let sizes: string[] = [];
    if (data.sizes) {
      if (typeof data.sizes === 'string') {
        try { sizes = JSON.parse(data.sizes); } catch { sizes = []; }
      } else if (Array.isArray(data.sizes)) {
        sizes = data.sizes;
      }
    }
    
    let colors: string[] = [];
    if (data.colors) {
      if (typeof data.colors === 'string') {
        try { colors = JSON.parse(data.colors); } catch { colors = []; }
      } else if (Array.isArray(data.colors)) {
        colors = data.colors;
      }
    }
    
    const priceVal = data.price;
    
    return {
      id: typeof data.id === 'string' ? parseInt(data.id) || 0 : (data.id || 0),
      externalId: data.external_id || null,
      sku: data.sku || null,
      name: data.name || '',
      description: data.description || '',
      price: typeof priceVal === 'number' ? priceVal : parseInt(priceVal) || 0,
      imageUrl: images.length > 0 ? images[0] : (data.image_url || ''),
      category: data.category || '',
      sizes,
      colors,
      isNew: data.is_new === true,
      createdAt: data.created_at ? new Date(Number(data.created_at) / 1000) : new Date(),
    } as Product;
  }

  async getProducts(): Promise<Product[]> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery("SELECT * FROM products");
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      console.log("[YDB] Columns:", rs.columns.map((c: any) => c.name).join(', '));
      console.log("[YDB] First row items count:", rs.rows[0]?.items?.length);
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns);
        console.log("[YDB] Parsed data:", JSON.stringify(data));
        return this.parseProduct(data);
      });
    });
    return result || [];
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $id AS Utf8; SELECT * FROM products WHERE id = $id";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $id: TypedValues.fromNative(Types.UTF8, String(id)) });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return undefined;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseProduct(data);
    });
    return result || undefined;
  }

  async getProductByExternalId(externalId: string): Promise<Product | undefined> {
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $externalId AS Utf8; SELECT * FROM products WHERE external_id = $externalId";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $externalId: TypedValues.fromNative(Types.UTF8, externalId) });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return undefined;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseProduct(data);
    });
    return result || undefined;
  }

  async getProductBySku(sku: string): Promise<Product | undefined> {
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $sku AS Utf8; SELECT * FROM products WHERE sku = $sku";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $sku: TypedValues.fromNative(Types.UTF8, sku) });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return undefined;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseProduct(data);
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
