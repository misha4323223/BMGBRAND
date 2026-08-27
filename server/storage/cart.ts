// Cart storage (2.4.3e): getCartItems, addToCart, quantity updates, remove, clear.
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { driver } from "../db";
import { logError, logWarn } from "../logger";
import type { CartItem, InsertCartItem, Product } from "@shared/schema";
import { DatabaseStorage, devCartItems } from "./core";

declare module "./core" {
  interface DatabaseStorage {
    getCartItems(sessionId: string): Promise<(CartItem & { product: Product })[]>;
    getCartByUserId(userId: number): Promise<(CartItem & { product: Product })[]>;
    addToCart(item: InsertCartItem): Promise<CartItem>;
    updateCartItemQuantity(id: number, quantity: number, sessionId?: string, productId?: number, size?: string, color?: string): Promise<CartItem | null>;
    removeFromCart(id: number, sessionId?: string, productId?: number, size?: string, color?: string): Promise<void>;
    clearCart(sessionId: string): Promise<void>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.getCartItems = async function (this: DatabaseStorage, sessionId: string): Promise<(CartItem & { product: Product })[]> {
    if (!driver) {
      console.log(`[Cart] Local Dev: Fetching items for session ${sessionId}`);
      const items = devCartItems.filter(item => item.sessionId === sessionId);
      const result: (CartItem & { product: Product })[] = [];
      
      for (const item of items) {
        const product = await this.getProduct(item.productId);
        if (product) {
          result.push({ ...item, product });
        }
      }
      return result;
    }
    
    // Use safeQuery so a YDB transport blip doesn't escape as an unhandled
    // rejection (this method is called on every page load — header cart icon).
    // Step 1: pull raw rows inside the YDB session, fast and minimal.
    type RawCartRow = {
      sessionId: string;
      productId: number;
      size: string | null;
      color: string | null;
      quantity: number;
    };

    const rawRows = await this.safeQuery<RawCartRow[]>(async (session) => {
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

      return rows.map(row => {
        const items = row.items || [];
        const productId = items[1]?.uint64Value || items[1]?.int64Value || 0;
        return {
          sessionId: items[0]?.textValue || "",
          productId: Number(productId),
          size: items[2]?.textValue || null,
          color: items[3]?.textValue || null,
          quantity: items[4]?.int32Value || items[4]?.uint32Value || 1,
        };
      });
    });

    if (!rawRows) {
      // YDB unavailable — return empty cart instead of throwing/hanging.
      logWarn(`[Cart] YDB unavailable for session ${sessionId}, returning empty cart`);
      return [];
    }

    // Step 2: hydrate products OUTSIDE the YDB session (uses its own cache).
    const result: (CartItem & { product: Product })[] = [];
    for (const row of rawRows) {
      const product = await this.getProduct(row.productId);
      if (product) {
        result.push({
          id: 0, // YDB cart uses composite key, no single id
          sessionId: row.sessionId,
          productId: row.productId,
          size: row.size,
          color: row.color,
          quantity: row.quantity,
          userId: null,
          product,
        });
      }
    }

    const deduped = new Map<string, (CartItem & { product: Product })>();
    for (const item of result) {
      const key = `${item.productId}-${item.size}-${item.color}`;
      if (!deduped.has(key)) {
        deduped.set(key, item);
      }
    }
    const dedupedResult = Array.from(deduped.values());
    console.log(`[Cart] Found ${dedupedResult.length} items for session ${sessionId} (${result.length} raw rows)`);
    return dedupedResult;
  }
;

DatabaseStorage.prototype.getCartByUserId = async function (this: DatabaseStorage, userId: number): Promise<(CartItem & { product: Product })[]> {
    const sessionId = `user_${userId}`;
    return this.getCartItems(sessionId);
  }
;

DatabaseStorage.prototype.addToCart = async function (this: DatabaseStorage, item: InsertCartItem): Promise<CartItem> {
    if (!driver) {
      const cartItemId = Date.now();
      const newItem: CartItem = {
        id: cartItemId,
        sessionId: item.sessionId ?? null,
        productId: item.productId,
        quantity: item.quantity || 1,
        size: item.size || "One Size",
        color: item.color || "Default",
        userId: null,
      };
      
      // Check for existing item with same composite key to update quantity
      const existingIndex = devCartItems.findIndex(i => 
        i.sessionId === item.sessionId && 
        i.productId === item.productId && 
        i.size === newItem.size && 
        i.color === newItem.color
      );
      
      if (existingIndex !== -1) {
        devCartItems[existingIndex].quantity += newItem.quantity;
        console.log(`[Cart] Local Dev: Updated quantity for product ${item.productId}`);
        return devCartItems[existingIndex];
      }
      
      devCartItems.push(newItem);
      console.log(`[Cart] Local Dev: Added item ${cartItemId} for product ${item.productId}`);
      return newItem;
    }
    
    const cartItemId = Date.now();
    const qty = Number(item.quantity) || 1;
    const productIdNum = Number(item.productId);
    const sizeStr = String(item.size || "One Size");
    const colorStr = String(item.color || "Default");
    const sessionStr = String(item.sessionId);
    
    try {
      let finalQuantity = qty;
      await driver.tableClient.withSession(async (session) => {
        const { TypedValues, Types } = await import("ydb-sdk");
        
        const selectQuery = `
          DECLARE $session_id AS Utf8;
          DECLARE $product_id AS Uint64;
          DECLARE $size AS Utf8;
          DECLARE $color AS Utf8;
          
          SELECT id, quantity FROM cart_items
          WHERE session_id = $session_id
            AND product_id = $product_id
            AND size = $size
            AND color = $color
          LIMIT 1;
        `;
        
        const selectParams = {
          $session_id: TypedValues.fromNative(Types.UTF8, sessionStr),
          $product_id: TypedValues.fromNative(Types.UINT64, productIdNum),
          $size: TypedValues.fromNative(Types.UTF8, sizeStr),
          $color: TypedValues.fromNative(Types.UTF8, colorStr),
        };
        
        const result = await session.executeQuery(selectQuery, selectParams);
        const rows = result.resultSets?.[0]?.rows || [];
        
        if (rows.length > 0) {
          const existingQty = Number(rows[0]?.items?.[1]?.int32Value || rows[0]?.items?.[1]?.uint64Value || 0);
          finalQuantity = existingQty + qty;
          console.log(`[Cart] Found existing item, updating quantity: ${existingQty} + ${qty} = ${finalQuantity}`);
          
          const updateQuery = `
            DECLARE $session_id AS Utf8;
            DECLARE $product_id AS Uint64;
            DECLARE $size AS Utf8;
            DECLARE $color AS Utf8;
            DECLARE $quantity AS Int32;
            
            UPDATE cart_items SET quantity = $quantity
            WHERE session_id = $session_id
              AND product_id = $product_id
              AND size = $size
              AND color = $color;
          `;
          await session.executeQuery(updateQuery, {
            ...selectParams,
            $quantity: TypedValues.fromNative(Types.INT32, finalQuantity),
          });
        } else {
          console.log(`[Cart] Inserting new item: id=${cartItemId}, session=${sessionStr}, product=${productIdNum}, qty=${qty}`);
          const insertQuery = `
            DECLARE $id AS Uint64;
            DECLARE $session_id AS Utf8;
            DECLARE $product_id AS Uint64;
            DECLARE $size AS Utf8;
            DECLARE $color AS Utf8;
            DECLARE $quantity AS Int32;
            
            UPSERT INTO cart_items (id, session_id, product_id, size, color, quantity, created_at)
            VALUES ($id, $session_id, $product_id, $size, $color, $quantity, CurrentUtcTimestamp());
          `;
          await session.executeQuery(insertQuery, {
            $id: TypedValues.fromNative(Types.UINT64, cartItemId),
            ...selectParams,
            $quantity: TypedValues.fromNative(Types.INT32, qty),
          });
        }
      });
      console.log(`[Cart] Added/updated item in YDB: session=${sessionStr}, product=${productIdNum}, finalQty=${finalQuantity}`);
    } catch (err: any) {
      logError(`[Cart] Error adding to cart:`, err.message || err);
      if (err.issues) {
        logError(`[Cart] YDB Issues:`, JSON.stringify(err.issues, null, 2));
      }
      throw err;
    }
    
    return { ...item, id: cartItemId } as CartItem;
  }
;

DatabaseStorage.prototype.updateCartItemQuantity = async function (this: DatabaseStorage, id: number, quantity: number, sessionId?: string, productId?: number, size?: string, color?: string): Promise<CartItem | null> {
    if (!driver) {
      const item = devCartItems.find(i =>
        i.sessionId === sessionId &&
        i.productId === productId &&
        i.size === (size || "One Size") &&
        i.color === (color || "Default")
      );
      if (!item) return null;
      item.quantity = quantity;
      return item;
    }

    if (!sessionId || !productId) {
      console.log("[Cart] Missing sessionId or productId for quantity update");
      return null;
    }

    try {
      await driver.tableClient.withSession(async (session) => {
        const { TypedValues, Types } = await import("ydb-sdk");
        const query = `
          DECLARE $session_id AS Utf8;
          DECLARE $product_id AS Uint64;
          DECLARE $size AS Utf8;
          DECLARE $color AS Utf8;
          DECLARE $quantity AS Int32;

          UPDATE cart_items SET quantity = $quantity
          WHERE session_id = $session_id
            AND product_id = $product_id
            AND size = $size
            AND color = $color;
        `;
        await session.executeQuery(query, {
          $session_id: TypedValues.fromNative(Types.UTF8, sessionId),
          $product_id: TypedValues.fromNative(Types.UINT64, Number(productId)),
          $size: TypedValues.fromNative(Types.UTF8, size || "One Size"),
          $color: TypedValues.fromNative(Types.UTF8, color || "Default"),
          $quantity: TypedValues.fromNative(Types.INT32, quantity),
        });
      });
      console.log(`[Cart] Updated quantity in YDB: session=${sessionId}, product=${productId}, size=${size}, qty=${quantity}`);
      return { id, quantity, sessionId: sessionId || '', productId: productId || 0, size: size || 'One Size', color: color || 'Default' } as CartItem;
    } catch (err: any) {
      logError(`[Cart] Error updating quantity:`, err.message || err);
      throw err;
    }
  }
;

DatabaseStorage.prototype.removeFromCart = async function (this: DatabaseStorage, id: number, sessionId?: string, productId?: number, size?: string, color?: string): Promise<void> {
    if (!driver) {
      const index = devCartItems.findIndex(i => 
        i.sessionId === sessionId && 
        i.productId === productId && 
        i.size === (size || "One Size") && 
        i.color === (color || "Default")
      );
      if (index !== -1) {
        devCartItems.splice(index, 1);
        console.log(`[Cart] Local Dev: Removed item for product ${productId}`);
      }
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
      logError(`[Cart] Error removing from cart:`, err.message || err);
    }
  }
;

DatabaseStorage.prototype.clearCart = async function (this: DatabaseStorage, sessionId: string): Promise<void> {
    if (!driver) {
      let i = devCartItems.length;
      while (i--) {
        if (devCartItems[i].sessionId === sessionId) {
          devCartItems.splice(i, 1);
        }
      }
      console.log(`[Cart] Local Dev: Cleared cart for session ${sessionId}`);
      return;
    }
    
    // Wrapped in safeQuery to prevent unhandled rejections on YDB outage.
    const ok = await this.safeQuery(async (session) => {
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
      return true;
    });

    if (!ok) {
      logWarn(`[Cart] clearCart skipped (YDB unavailable) for session ${sessionId}`);
    }
  }
;
