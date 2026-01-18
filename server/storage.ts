import { driver } from "./db";
import { type Product, type InsertProduct, type CartItem, type InsertCartItem, type Order, type InsertOrder } from "@shared/schema";
import ydb from "ydb-sdk";

// Simple in-memory cache with TTL
class SimpleCache<T> {
  private cache: Map<string, { data: T; expires: number }> = new Map();
  private ttlMs: number;

  constructor(ttlSeconds: number = 60) {
    this.ttlMs = ttlSeconds * 1000;
  }

  get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }

  set(key: string, data: T): void {
    this.cache.set(key, { data, expires: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.cache.clear();
    console.log("[Cache] Cleared all cached data");
  }

  delete(key: string): void {
    this.cache.delete(key);
  }
}

// Global cache instances (5 minute TTL for better performance with large catalogs)
const productsCache = new SimpleCache<Product[]>(300);
const productCache = new SimpleCache<Product>(300);

export interface IStorage {
  getProductByExternalId(externalId: string): Promise<Product | undefined>;
  getProductBySku(sku: string): Promise<Product | undefined>;
  getProducts(): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product>;
  clearCache(): void;
  getCartItems(sessionId: string): Promise<(CartItem & { product: Product })[]>;
  addToCart(item: InsertCartItem): Promise<CartItem>;
  removeFromCart(id: number, sessionId?: string, productId?: number, size?: string, color?: string): Promise<void>;
  clearCart(sessionId: string): Promise<void>;
  getOrders(): Promise<Order[]>;
  getOrdersByStatus(status: string): Promise<Order[]>;
  updateOrderStatus(id: number, status: string): Promise<Order>;
  createOrder(order: InsertOrder & { items: any[], total: number }): Promise<Order>;
}

// Simple in-memory storage for development mode
const devProducts: Product[] = [];

export class DatabaseStorage implements IStorage {
  private async safeQuery<T>(fn: (session: ydb.Session) => Promise<T>): Promise<T | null> {
    if (!driver) return null;
    try {
      return await driver.tableClient.withSession(fn);
    } catch (err: any) {
      console.error("[YDB Query Error]:", err.message || err);
      if (err.issues) {
        console.error("[YDB Issues]:", JSON.stringify(err.issues, null, 2));
      }
      return null;
    }
  }

  private extractTypedValue(item: any): any {
    if (!item) return null;
    
    // Check concrete typed values FIRST (protobuf has all getters defined)
    if (item.textValue !== undefined && item.textValue !== null) return item.textValue;
    if (item.doubleValue !== undefined && item.doubleValue !== null) return item.doubleValue;
    if (item.floatValue !== undefined && item.floatValue !== null) return item.floatValue;
    if (item.uint64Value !== undefined && item.uint64Value !== null) return item.uint64Value;
    if (item.int64Value !== undefined && item.int64Value !== null) return item.int64Value;
    if (item.uint32Value !== undefined && item.uint32Value !== null) return item.uint32Value;
    if (item.int32Value !== undefined && item.int32Value !== null) return item.int32Value;
    if (item.boolValue !== undefined && item.boolValue !== null) return item.boolValue;
    if (item.bytesValue !== undefined && item.bytesValue !== null) return item.bytesValue;
    
    // Handle YDB Optional wrapper AFTER checking concrete types
    if (item.optionalValue !== undefined && item.optionalValue !== null) {
      return this.extractTypedValue(item.optionalValue);
    }
    
    // Null flag check
    if (item.nullFlagValue !== undefined) return null;
    
    // Fallback
    if (item.value !== undefined) return item.value;
    
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
    const parsedPrice = typeof priceVal === 'number' ? priceVal : parseFloat(priceVal) || 0;
    
    return {
      id: typeof data.id === 'string' ? parseInt(data.id) || 0 : (data.id || 0),
      externalId: data.external_id || null,
      sku: data.sku || null,
      name: data.name || '',
      description: data.description || '',
      price: parsedPrice,
      imageUrl: images.length > 0 ? images[0] : (data.image_url || ''),
      thumbnailUrl: data.thumbnail_url || null,
      category: data.category || '',
      subcategory: data.subcategory || null,
      sizes,
      colors,
      isNew: data.is_new === true,
      onSale: data.on_sale === true,
      createdAt: data.created_at ? new Date(Number(data.created_at) / 1000) : new Date(),
    } as Product;
  }

  clearCache(): void {
    productsCache.clear();
    productCache.clear();
  }

  async getProducts(): Promise<Product[]> {
    if (!driver) {
      return devProducts;
    }
    // Check cache first
    const cached = productsCache.get("all");
    if (cached) {
      console.log("[Cache] HIT - getProducts");
      return cached;
    }
    
    console.log("[Cache] MISS - getProducts, fetching from YDB");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery("SELECT * FROM products");
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns || []);
        return this.parseProduct(data);
      });
    });
    
    const products = result || [];
    if (products.length > 0) {
      productsCache.set("all", products);
    }
    return products;
  }

  async getProduct(id: number): Promise<Product | undefined> {
    if (!driver) {
      return devProducts.find(p => p.id === id);
    }
    // Check cache first
    const cacheKey = `product_${id}`;
    const cached = productCache.get(cacheKey);
    if (cached) {
      console.log(`[Cache] HIT - getProduct(${id})`);
      return cached;
    }
    
    console.log(`[Cache] MISS - getProduct(${id}), fetching from YDB`);
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
    
    if (result) {
      productCache.set(cacheKey, result);
    }
    return result || undefined;
  }

  async getProductByExternalId(externalId: string): Promise<Product | undefined> {
    if (!driver) {
      return devProducts.find(p => p.externalId === externalId);
    }
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
    if (!driver) {
      return devProducts.find(p => p.sku === sku);
    }
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

  async createProduct(p: InsertProduct): Promise<Product> {
    const newId = String(Date.now() + Math.floor(Math.random() * 1000));
    const product: Product = {
      id: parseInt(newId) || 0,
      externalId: p.externalId || null,
      sku: p.sku || null,
      name: p.name || '',
      description: p.description || '',
      price: p.price || 0,
      imageUrl: p.imageUrl || '',
      thumbnailUrl: p.thumbnailUrl || null,
      category: p.category || '',
      subcategory: p.subcategory || null,
      sizes: p.sizes || [],
      colors: p.colors || [],
      isNew: p.isNew || false,
      onSale: p.onSale || false,
      createdAt: new Date(),
    };

    if (!driver) {
      devProducts.push(product);
      console.log(`[DevStorage] Created product: ${product.name}`);
      return product;
    }

    await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      // Match actual YDB table schema with correct types: price=Double, images/sizes/colors=Json
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $external_id AS Utf8;
        DECLARE $sku AS Utf8;
        DECLARE $name AS Utf8;
        DECLARE $description AS Utf8;
        DECLARE $price AS Double;
        DECLARE $images AS Json;
        DECLARE $category AS Utf8;
        DECLARE $subcategory AS Utf8;
        DECLARE $sizes AS Json;
        DECLARE $colors AS Json;
        DECLARE $is_new AS Bool;
        DECLARE $in_stock AS Bool;
        
        UPSERT INTO products (id, external_id, sku, name, description, price, images, category, subcategory, sizes, colors, is_new, in_stock)
        VALUES ($id, $external_id, $sku, $name, $description, $price, $images, $category, $subcategory, $sizes, $colors, $is_new, $in_stock);
      `;
      
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, newId),
        $external_id: TypedValues.fromNative(Types.UTF8, p.externalId || ''),
        $sku: TypedValues.fromNative(Types.UTF8, p.sku || ''),
        $name: TypedValues.fromNative(Types.UTF8, p.name || ''),
        $description: TypedValues.fromNative(Types.UTF8, p.description || ''),
        $price: TypedValues.fromNative(Types.DOUBLE, p.price || 0),
        $images: TypedValues.fromNative(Types.JSON, JSON.stringify([p.imageUrl || ''])),
        $category: TypedValues.fromNative(Types.UTF8, p.category || ''),
        $subcategory: TypedValues.fromNative(Types.UTF8, p.subcategory || ''),
        $sizes: TypedValues.fromNative(Types.JSON, JSON.stringify(p.sizes || [])),
        $colors: TypedValues.fromNative(Types.JSON, JSON.stringify(p.colors || [])),
        $is_new: TypedValues.fromNative(Types.BOOL, p.isNew || false),
        $in_stock: TypedValues.fromNative(Types.BOOL, true),
      });
      
      console.log(`[YDB] Created product: ${p.name} with id ${newId}`);
      return true;
    });
    
    return product;
  }

  async updateProduct(id: number, p: Partial<InsertProduct>): Promise<Product> {
    if (!driver) {
      const index = devProducts.findIndex(item => item.id === id);
      if (index !== -1) {
        devProducts[index] = { ...devProducts[index], ...p } as Product;
        console.log(`[DevStorage] Updated product id ${id}`);
        return devProducts[index];
      }
      return { id } as Product;
    }

    await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      
      const setClauses: string[] = [];
      const params: Record<string, any> = {
        $id: TypedValues.fromNative(Types.UTF8, String(id)),
      };
      
      let declareStatements = 'DECLARE $id AS Utf8;\n';
      
      if (p.name !== undefined) {
        declareStatements += 'DECLARE $name AS Utf8;\n';
        setClauses.push('name = $name');
        params.$name = TypedValues.fromNative(Types.UTF8, p.name);
      }
      if (p.description !== undefined) {
        declareStatements += 'DECLARE $description AS Utf8;\n';
        setClauses.push('description = $description');
        params.$description = TypedValues.fromNative(Types.UTF8, p.description);
      }
      if (p.price !== undefined) {
        declareStatements += 'DECLARE $price AS Double;\n';
        setClauses.push('price = $price');
        params.$price = TypedValues.fromNative(Types.DOUBLE, p.price);
      }
      if (p.imageUrl !== undefined) {
        declareStatements += 'DECLARE $images AS Json;\n';
        setClauses.push('images = $images');
        params.$images = TypedValues.fromNative(Types.JSON, JSON.stringify([p.imageUrl]));
      }
      if (p.category !== undefined) {
        declareStatements += 'DECLARE $category AS Utf8;\n';
        setClauses.push('category = $category');
        params.$category = TypedValues.fromNative(Types.UTF8, p.category);
      }
      if (p.subcategory !== undefined) {
        declareStatements += 'DECLARE $subcategory AS Utf8;\n';
        setClauses.push('subcategory = $subcategory');
        params.$subcategory = TypedValues.fromNative(Types.UTF8, p.subcategory || '');
      }
      if (p.sizes !== undefined) {
        declareStatements += 'DECLARE $sizes AS Json;\n';
        setClauses.push('sizes = $sizes');
        params.$sizes = TypedValues.fromNative(Types.JSON, JSON.stringify(p.sizes));
      }
      if (p.colors !== undefined) {
        declareStatements += 'DECLARE $colors AS Json;\n';
        setClauses.push('colors = $colors');
        params.$colors = TypedValues.fromNative(Types.JSON, JSON.stringify(p.colors));
      }
      if (p.externalId !== undefined) {
        declareStatements += 'DECLARE $external_id AS Utf8;\n';
        setClauses.push('external_id = $external_id');
        params.$external_id = TypedValues.fromNative(Types.UTF8, p.externalId);
      }
      if (p.sku !== undefined) {
        declareStatements += 'DECLARE $sku AS Utf8;\n';
        setClauses.push('sku = $sku');
        params.$sku = TypedValues.fromNative(Types.UTF8, p.sku);
      }
      if (p.isNew !== undefined) {
        declareStatements += 'DECLARE $is_new AS Bool;\n';
        setClauses.push('is_new = $is_new');
        params.$is_new = TypedValues.fromNative(Types.BOOL, p.isNew);
      }
      
      if (setClauses.length === 0) return null;
      
      const query = `
        ${declareStatements}
        UPDATE products SET ${setClauses.join(', ')} WHERE id = $id;
      `;
      
      await session.executeQuery(query, params);
      console.log(`[YDB] Updated product id ${id}`);
      return true;
    });
    
    return { ...p, id } as Product;
  }
  // YDB cart storage
  async getCartItems(sessionId: string): Promise<(CartItem & { product: Product })[]> {
    if (!driver) {
      console.log("[Cart] No YDB driver, returning empty cart");
      return [];
    }
    
    const result: (CartItem & { product: Product })[] = [];
    
    await driver.tableClient.withSession(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $session_id AS Utf8;
        SELECT session_id, product_id, size, color, quantity, created_at
        FROM cart_items
        WHERE session_id = $session_id;
      `;
      
      const params = {
        $session_id: TypedValues.fromNative(Types.UTF8, sessionId),
      };
      
      const res = await session.executeQuery(query, params);
      const rows = res.resultSets[0]?.rows || [];
      
      for (const row of rows) {
        const items = row.items || [];
        // product_id is Uint64, quantity is Int32
        const productId = items[1]?.uint64Value || items[1]?.int64Value || 0;
        const product = await this.getProduct(Number(productId));
        
        if (product) {
          result.push({
            id: 0, // YDB cart uses composite key, no single id
            sessionId: items[0]?.textValue || "",
            productId: Number(productId),
            size: items[2]?.textValue || null,
            color: items[3]?.textValue || null,
            quantity: items[4]?.int32Value || items[4]?.uint32Value || 1,
            product,
          });
        }
      }
    });
    
    console.log(`[Cart] Found ${result.length} items for session ${sessionId}`);
    return result;
  }

  async addToCart(item: InsertCartItem): Promise<CartItem> {
    if (!driver) {
      console.log("[Cart] No YDB driver, returning mock cart item");
      return { ...item, id: 0 } as CartItem;
    }
    
    const cartItemId = Date.now();
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const { TypedValues, Types } = await import("ydb-sdk");
        const query = `
          DECLARE $id AS Uint64;
          DECLARE $session_id AS Utf8;
          DECLARE $product_id AS Uint64;
          DECLARE $size AS Utf8;
          DECLARE $color AS Utf8;
          DECLARE $quantity AS Int32;
          
          UPSERT INTO cart_items (id, session_id, product_id, size, color, quantity, created_at)
          VALUES ($id, $session_id, $product_id, $size, $color, $quantity, CurrentUtcTimestamp());
        `;
        
        const qty = Number(item.quantity) || 1;
        const productIdNum = Number(item.productId);
        console.log(`[Cart] Inserting: id=${cartItemId}, session=${item.sessionId}, product=${productIdNum}, qty=${qty}`);
        
        const params = {
          $id: TypedValues.fromNative(Types.UINT64, cartItemId),
          $session_id: TypedValues.fromNative(Types.UTF8, String(item.sessionId)),
          $product_id: TypedValues.fromNative(Types.UINT64, productIdNum),
          $size: TypedValues.fromNative(Types.UTF8, String(item.size || "One Size")),
          $color: TypedValues.fromNative(Types.UTF8, String(item.color || "Default")),
          $quantity: TypedValues.fromNative(Types.INT32, qty),
        };
        
        await session.executeQuery(query, params);
        console.log(`[Cart] Added/updated item in YDB: id=${cartItemId}, session=${item.sessionId}, product=${productIdNum}`);
      });
    } catch (err: any) {
      console.error(`[Cart] Error adding to cart:`, err.message || err);
      if (err.issues) {
        console.error(`[Cart] YDB Issues:`, JSON.stringify(err.issues, null, 2));
      }
      throw err;
    }
    
    return { ...item, id: cartItemId } as CartItem;
  }

  async removeFromCart(id: number, sessionId?: string, productId?: number, size?: string, color?: string): Promise<void> {
    if (!driver) {
      console.log("[Cart] No YDB driver");
      return;
    }
    
    // For YDB we need the composite key (sessionId, productId, size, color)
    if (!sessionId || !productId) {
      console.log("[Cart] Missing sessionId or productId for removal");
      return;
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const { TypedValues, Types } = await import("ydb-sdk");
        const query = `
          DECLARE $session_id AS Utf8;
          DECLARE $product_id AS Uint64;
          DECLARE $size AS Utf8;
          DECLARE $color AS Utf8;
          
          DELETE FROM cart_items
          WHERE session_id = $session_id 
            AND product_id = $product_id
            AND size = $size
            AND color = $color;
        `;
        
        const params = {
          $session_id: TypedValues.fromNative(Types.UTF8, sessionId),
          $product_id: TypedValues.fromNative(Types.UINT64, Number(productId)),
          $size: TypedValues.fromNative(Types.UTF8, size || "One Size"),
          $color: TypedValues.fromNative(Types.UTF8, color || "Default"),
        };
        
        await session.executeQuery(query, params);
        console.log(`[Cart] Removed item from YDB: session=${sessionId}, product=${productId}`);
      });
    } catch (err: any) {
      console.error(`[Cart] Error removing from cart:`, err.message || err);
    }
  }

  async clearCart(sessionId: string): Promise<void> {
    if (!driver) {
      console.log("[Cart] No YDB driver");
      return;
    }
    
    await driver.tableClient.withSession(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $session_id AS Utf8;
        DELETE FROM cart_items WHERE session_id = $session_id;
      `;
      
      const params = {
        $session_id: TypedValues.fromNative(Types.UTF8, sessionId),
      };
      
      await session.executeQuery(query, params);
      console.log(`[Cart] Cleared cart in YDB for session ${sessionId}`);
    });
  }

  async getOrders(): Promise<Order[]> { return []; }
  async getOrdersByStatus(status: string): Promise<Order[]> { return []; }
  async updateOrderStatus(id: number, status: string): Promise<Order> { return { id, status } as any; }
  async createOrder(order: InsertOrder & { items: any[], total: number }): Promise<Order> { return { ...order, id: Math.floor(Math.random() * 1000) } as any; }
}

export const storage = new DatabaseStorage();
