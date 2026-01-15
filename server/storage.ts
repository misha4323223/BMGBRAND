import { driver } from "./db";
import { type Product, type InsertProduct, type CartItem, type InsertCartItem, type Order, type InsertOrder } from "@shared/schema";
import ydb from "ydb-sdk";
const { TypedValues, Types } = ydb;

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
  async getProducts(): Promise<Product[]> {
    return await driver.tableClient.withSession(async (session) => {
      const { resultSets } = await session.executeQuery("SELECT * FROM products");
      return resultSets[0].rows ? resultSets[0].rows.map(row => row as unknown as Product) : [];
    });
  }

  async getProduct(id: number): Promise<Product | undefined> {
    return await driver.tableClient.withSession(async (session) => {
      const query = "DECLARE $id AS Int32; SELECT * FROM products WHERE id = $id";
      const { resultSets } = await session.executeQuery(query, { $id: TypedValues.fromNative(Types.INT32, id) });
      return resultSets[0].rows?.[0] as unknown as Product;
    });
  }

  async getProductByExternalId(externalId: string): Promise<Product | undefined> {
    return await driver.tableClient.withSession(async (session) => {
      const query = "DECLARE $externalId AS Utf8; SELECT * FROM products WHERE external_id = $externalId";
      const { resultSets } = await session.executeQuery(query, { $externalId: TypedValues.fromNative(Types.UTF8, externalId) });
      return resultSets[0].rows?.[0] as unknown as Product;
    });
  }

  async getProductBySku(sku: string): Promise<Product | undefined> {
    return await driver.tableClient.withSession(async (session) => {
      const query = "DECLARE $sku AS Utf8; SELECT * FROM products WHERE sku = $sku";
      const { resultSets } = await session.executeQuery(query, { $sku: TypedValues.fromNative(Types.UTF8, sku) });
      return resultSets[0].rows?.[0] as unknown as Product;
    });
  }

  async createProduct(p: InsertProduct): Promise<Product> {
    // Basic implementation for MVP, in real app would need auto-inc or UUID logic for YDB
    return p as any; 
  }

  async updateProduct(id: number, p: Partial<InsertProduct>): Promise<Product> {
    return p as any;
  }

  async getCartItems(sessionId: string): Promise<(CartItem & { product: Product })[]> {
    return [];
  }

  async addToCart(item: InsertCartItem): Promise<CartItem> {
    return item as any;
  }

  async removeFromCart(id: number): Promise<void> {}
  async clearCart(sessionId: string): Promise<void> {}
  async getOrders(): Promise<Order[]> { return []; }
  async getOrdersByStatus(status: string): Promise<Order[]> { return []; }
  async updateOrderStatus(id: number, status: string): Promise<Order> { return {} as any; }
  async createOrder(order: InsertOrder & { items: any[], total: number }): Promise<Order> { return {} as any; }
}

export const storage = new DatabaseStorage();
