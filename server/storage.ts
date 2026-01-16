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

  async getProducts(): Promise<Product[]> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery("SELECT * FROM products");
      if (!resultSets[0].rows) return [];
      return resultSets[0].rows.map((row: any) => {
        const images = row.images ? (typeof row.images === 'string' ? JSON.parse(row.images) : row.images) : [];
        const sizes = row.sizes ? (typeof row.sizes === 'string' ? JSON.parse(row.sizes) : row.sizes) : [];
        const colors = row.colors ? (typeof row.colors === 'string' ? JSON.parse(row.colors) : row.colors) : [];
        return {
          id: typeof row.id === 'string' ? parseInt(row.id) || 0 : row.id,
          externalId: row.external_id || null,
          sku: row.sku || null,
          name: row.name || '',
          description: row.description || '',
          price: typeof row.price === 'number' ? row.price : parseInt(row.price) || 0,
          imageUrl: Array.isArray(images) && images.length > 0 ? images[0] : (row.image_url || ''),
          category: row.category || '',
          sizes: Array.isArray(sizes) ? sizes : [],
          colors: Array.isArray(colors) ? colors : [],
          isNew: row.is_new === true || row.is_new === 'true',
          createdAt: row.created_at || new Date(),
        } as Product;
      });
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
      const images = row.images ? (typeof row.images === 'string' ? JSON.parse(row.images) : row.images) : [];
      const sizes = row.sizes ? (typeof row.sizes === 'string' ? JSON.parse(row.sizes) : row.sizes) : [];
      const colors = row.colors ? (typeof row.colors === 'string' ? JSON.parse(row.colors) : row.colors) : [];
      return {
        id: typeof row.id === 'string' ? parseInt(row.id) || 0 : row.id,
        externalId: row.external_id || null,
        sku: row.sku || null,
        name: row.name || '',
        description: row.description || '',
        price: typeof row.price === 'number' ? row.price : parseInt(row.price) || 0,
        imageUrl: Array.isArray(images) && images.length > 0 ? images[0] : (row.image_url || ''),
        category: row.category || '',
        sizes: Array.isArray(sizes) ? sizes : [],
        colors: Array.isArray(colors) ? colors : [],
        isNew: row.is_new === true || row.is_new === 'true',
        createdAt: row.created_at || new Date(),
      } as Product;
    });
    return result || undefined;
  }

  async getProductByExternalId(externalId: string): Promise<Product | undefined> {
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $externalId AS Utf8; SELECT * FROM products WHERE external_id = $externalId";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $externalId: TypedValues.fromNative(Types.UTF8, externalId) });
      return resultSets[0].rows?.[0] as unknown as Product;
    });
    return result || undefined;
  }

  async getProductBySku(sku: string): Promise<Product | undefined> {
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $sku AS Utf8; SELECT * FROM products WHERE sku = $sku";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $sku: TypedValues.fromNative(Types.UTF8, sku) });
      return resultSets[0].rows?.[0] as unknown as Product;
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
