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
  removeFromCart(id: number, sessionId?: string, productId?: number, size?: string, color?: string): Promise<void>;
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
      if (err.issues) {
        console.error("[YDB Issues]:", JSON.stringify(err.issues, null, 2));
      }
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
        const data = this.parseRowWithColumns(row, rs.columns || []);
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

  async createProduct(p: InsertProduct): Promise<Product> {
    const newId = String(Date.now());
    const result = await this.safeQuery(async (session) => {
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
        DECLARE $sizes AS Json;
        DECLARE $colors AS Json;
        DECLARE $is_new AS Bool;
        DECLARE $in_stock AS Bool;
        
        UPSERT INTO products (id, external_id, sku, name, description, price, images, category, sizes, colors, is_new, in_stock)
        VALUES ($id, $external_id, $sku, $name, $description, $price, $images, $category, $sizes, $colors, $is_new, $in_stock);
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
        $sizes: TypedValues.fromNative(Types.JSON, JSON.stringify(p.sizes || [])),
        $colors: TypedValues.fromNative(Types.JSON, JSON.stringify(p.colors || [])),
        $is_new: TypedValues.fromNative(Types.BOOL, p.isNew || false),
        $in_stock: TypedValues.fromNative(Types.BOOL, true),
      });
      
      console.log(`[YDB] Created product: ${p.name} with id ${newId}`);
      return true;
    });
    
    // In dev mode (no driver), result will be null - that's expected
    // Only throw error if we're in production and the query actually failed
    if (result === null && driver !== null) {
      throw new Error(`Failed to create product: ${p.name}`);
    }
    
    return {
      id: parseInt(newId) || 0,
      externalId: p.externalId || null,
      sku: p.sku || null,
      name: p.name || '',
      description: p.description || '',
      price: p.price || 0,
      imageUrl: p.imageUrl || '',
      category: p.category || '',
      sizes: p.sizes || [],
      colors: p.colors || [],
      isNew: p.isNew || false,
      createdAt: new Date(),
    } as Product;
  }

  async updateProduct(id: number, p: Partial<InsertProduct>): Promise<Product> {
    const result = await this.safeQuery(async (session) => {
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
        const productId = items[1]?.textValue || "";
        const product = await this.getProduct(Number(productId));
        
        if (product) {
          result.push({
            id: 0, // YDB cart uses composite key, no single id
            sessionId: items[0]?.textValue || "",
            productId: Number(productId),
            size: items[2]?.textValue || null,
            color: items[3]?.textValue || null,
            quantity: items[4]?.uint32Value || 1,
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
    
    await driver.tableClient.withSession(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      // UPSERT - will insert or update if exists
      const query = `
        DECLARE $session_id AS Utf8;
        DECLARE $product_id AS Utf8;
        DECLARE $size AS Utf8;
        DECLARE $color AS Utf8;
        DECLARE $quantity AS Uint32;
        DECLARE $created_at AS Timestamp;
        
        UPSERT INTO cart_items (session_id, product_id, size, color, quantity, created_at)
        VALUES ($session_id, $product_id, $size, $color, $quantity, $created_at);
      `;
      
      const params = {
        $session_id: TypedValues.fromNative(Types.UTF8, item.sessionId),
        $product_id: TypedValues.fromNative(Types.UTF8, String(item.productId)),
        $size: TypedValues.fromNative(Types.UTF8, item.size || "One Size"),
        $color: TypedValues.fromNative(Types.UTF8, item.color || "Default"),
        $quantity: TypedValues.fromNative(Types.UINT32, item.quantity),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, new Date()),
      };
      
      await session.executeQuery(query, params);
      console.log(`[Cart] Added/updated item in YDB: session=${item.sessionId}, product=${item.productId}`);
    });
    
    return { ...item, id: 0 } as CartItem;
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
    
    await driver.tableClient.withSession(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $session_id AS Utf8;
        DECLARE $product_id AS Utf8;
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
        $product_id: TypedValues.fromNative(Types.UTF8, String(productId)),
        $size: TypedValues.fromNative(Types.UTF8, size || "One Size"),
        $color: TypedValues.fromNative(Types.UTF8, color || "Default"),
      };
      
      await session.executeQuery(query, params);
      console.log(`[Cart] Removed item from YDB: session=${sessionId}, product=${productId}`);
    });
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
