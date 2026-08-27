// Product storage (2.4.3a): product reads + caches (getProducts, fetchProductsFromYdb, cart reads come later).
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { driver, waitForDriver } from "../db";
import { logError } from "../logger";
import type { InsertProduct, Product } from "@shared/schema";
import { DatabaseStorage, productsCache, productCache, devProducts } from "./core";
waitForDriver

declare module "./core" {
  interface DatabaseStorage {
    clearProductCache(productId?: number): void;
    fetchProductsFromYdb(): Promise<Product[]>;
    getProducts(): Promise<Product[]>;
    getAllProductsForAdmin(): Promise<Product[]>;
    getProduct(id: number): Promise<Product | undefined>;
    getProductByExternalId(externalId: string): Promise<Product | undefined>;
    getRawProductsCache(): Product[];
    getProductBySlug(slug: string): Promise<Product | undefined>;
    getProductBySku(sku: string): Promise<Product | undefined>;
    getProductBySlugFromDb(slug: string): Promise<Product | undefined>;
    getColorVariantsBySku(sku: string, excludeId?: number): Promise<Product[]>;
    createProduct(p: InsertProduct): Promise<Product>;
    updateProduct(id: number, p: Partial<InsertProduct>): Promise<Product>;
    deleteProduct(id: number): Promise<boolean>;
    addDeletedProductSlug(slug: string): Promise<void>;
    deleteAllProducts(): Promise<number>;
    addThumbnailColumn(): Promise<{ success: boolean; message: string }>;
    addWholesalePriceColumn(): Promise<{ success: boolean; message: string }>;
    addOnSaleColumn(): Promise<{ success: boolean; message: string }>;
    addSeoJsonLdColumn(): Promise<{ success: boolean; message: string }>;
    addOldPriceColumn(): Promise<{ success: boolean; message: string }>;
    addIsHiddenColumn(): Promise<{ success: boolean; message: string }>;
    addAutoHideOverrideColumn(): Promise<{ success: boolean; message: string }>;
    addStockColumn(): Promise<{ success: boolean; message: string }>;
    addSlugColumn(): Promise<{ success: boolean; message: string }>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.clearProductCache = function (this: DatabaseStorage, productId?: number): void {
    if (productId) {
      productCache.delete(String(productId));
    }
    productsCache.clear();
  }
;

DatabaseStorage.prototype.fetchProductsFromYdb = async function (this: DatabaseStorage, ): Promise<Product[]> {
    const allProducts: Product[] = [];
    let lastId = '';
    const PAGE_SIZE = 1000;

    while (true) {
      const chunk = await this.safeQuery(async (session) => {
        let query: string;
        let params: Record<string, any>;

        const { TypedValues, Types } = await import("ydb-sdk");

        if (!lastId) {
          query = `SELECT * FROM products ORDER BY id LIMIT ${PAGE_SIZE}`;
          params = {};
        } else {
          query = `DECLARE $last_id AS Utf8; SELECT * FROM products WHERE id > $last_id ORDER BY id LIMIT ${PAGE_SIZE}`;
          params = { $last_id: TypedValues.fromNative(Types.UTF8, lastId) };
        }

        const { resultSets } = await session.executeQuery(query, params);
        const rs = resultSets[0];
        if (!rs.rows || !rs.columns) return [];
        return rs.rows.map((row: any) => {
          const data = this.parseRowWithColumns(row, rs.columns || []);
          return this.parseProduct(data);
        });
      });

      if (!chunk || chunk.length === 0) break;
      allProducts.push(...chunk);
      if (chunk.length < PAGE_SIZE) break;
      lastId = String(chunk[chunk.length - 1].id);
    }

    return allProducts;
  }
;

DatabaseStorage.prototype.getProducts = async function (this: DatabaseStorage, ): Promise<Product[]> {
    if (!driver) {
      return devProducts;
    }
    const cached = productsCache.get("all");
    if (cached) {
      if (productsCache.isStale("all") && !productsCache.isRefreshing("all")) {
        productsCache.setRefreshing("all", true);
        console.log("[Cache] STALE - getProducts, refreshing in background");
        this.fetchProductsFromYdb().then(products => {
          if (products.length > 0) {
            productsCache.set("all", products);
          }
          productsCache.setRefreshing("all", false);
          console.log("[Cache] Background refresh complete, got", products.length, "products");
        }).catch(err => {
          productsCache.setRefreshing("all", false);
          logError("[Cache] Background refresh failed:", err);
        });
      } else {
        console.log("[Cache] HIT - getProducts");
      }
      return cached.filter((p: any) => !p.artistOnly);
    }
    
    console.log("[Cache] MISS - getProducts, fetching from YDB");
    const products = await this.fetchProductsFromYdb();
    if (products.length > 0) {
      productsCache.set("all", products);
    }
    return products.filter((p: any) => !p.artistOnly);
  }
;

DatabaseStorage.prototype.getAllProductsForAdmin = async function (this: DatabaseStorage, ): Promise<Product[]> {
    if (!driver) return devProducts;
    const cached = productsCache.get("all");
    if (cached) return cached;
    const products = await this.fetchProductsFromYdb();
    if (products.length > 0) productsCache.set("all", products);
    return products;
  }
;

DatabaseStorage.prototype.getProduct = async function (this: DatabaseStorage, id: number): Promise<Product | undefined> {
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
    
    const allCached = productsCache.get("all");
    if (allCached) {
      const found = allCached.find(p => p.id === id);
      if (found) {
        productCache.set(cacheKey, found);
        console.log(`[Cache] HIT - getProduct(${id}) from productsCache`);
        return found;
      }
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
;

DatabaseStorage.prototype.getProductByExternalId = async function (this: DatabaseStorage, externalId: string): Promise<Product | undefined> {
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
;

DatabaseStorage.prototype.getRawProductsCache = function (this: DatabaseStorage, ): Product[] {
    return productsCache.get("all") || [];
  }
;

DatabaseStorage.prototype.getProductBySlug = async function (this: DatabaseStorage, slug: string): Promise<Product | undefined> {
    if (!driver) {
      return devProducts.find(p => (p as any).slug === slug);
    }
    // Search raw cache first (includes artistOnly products)
    const raw = productsCache.get("all");
    if (raw) {
      const found = raw.find((p: any) => p.slug === slug);
      if (found) return found;
    }
    // Fallback: fetch all and search (also includes artistOnly)
    const all = await this.fetchProductsFromYdb();
    return all.find((p: any) => p.slug === slug);
  }
;

DatabaseStorage.prototype.getProductBySku = async function (this: DatabaseStorage, sku: string): Promise<Product | undefined> {
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
;

DatabaseStorage.prototype.getProductBySlugFromDb = async function (this: DatabaseStorage, slug: string): Promise<Product | undefined> {
    if (!driver) {
      return devProducts.find((p: any) => p.slug === slug);
    }
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $slug AS Utf8; SELECT * FROM products WHERE slug = $slug";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $slug: TypedValues.fromNative(Types.UTF8, slug) });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return undefined;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseProduct(data);
    });
    return result || undefined;
  }
;

DatabaseStorage.prototype.getColorVariantsBySku = async function (this: DatabaseStorage, sku: string, excludeId?: number): Promise<Product[]> {
    if (!sku) return [];
    
    if (!driver) {
      return devProducts.filter(p => p.sku === sku && (!excludeId || p.id !== excludeId));
    }
    
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $sku AS Utf8; SELECT * FROM products WHERE sku = $sku";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $sku: TypedValues.fromNative(Types.UTF8, sku) });
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      
      const products: Product[] = [];
      for (const row of rs.rows) {
        const data = this.parseRowWithColumns(row, rs.columns);
        const product = this.parseProduct(data);
        if (product && (!excludeId || product.id !== excludeId)) {
          products.push(product);
        }
      }
      return products;
    });
    
    return result || [];
  }
;

DatabaseStorage.prototype.createProduct = async function (this: DatabaseStorage, p: InsertProduct): Promise<Product> {
    const newId = String(Date.now() + Math.floor(Math.random() * 1000));

    // Always ensure a slug exists — generate from name if not provided
    if (!(p as any).slug && p.name) {
      const { generateSlug } = await import("../slugify");
      (p as any).slug = generateSlug(p.name);
    }

    // Use images array if provided, otherwise fallback to imageUrl
    const imagesArray: string[] = Array.isArray(p.images) && p.images.length > 0 
      ? (p.images as string[])
      : (p.imageUrl ? [p.imageUrl] : []);
    
    const product: any = {
      id: parseInt(newId) || 0,
      externalId: p.externalId || null,
      sku: p.sku || null,
      name: p.name || '',
      description: p.description || '',
      price: p.price || 0,
      wholesalePrice: (p as any).wholesalePrice || null,
      imageUrl: p.imageUrl || '',
      thumbnailUrl: p.thumbnailUrl || null,
      hoverThumbnailUrl: (p as any).hoverThumbnailUrl || null,
      images: imagesArray,
      category: p.category || '',
      subcategory: p.subcategory || null,
      color: (p as any).color || null,
      sizes: Array.isArray(p.sizes) ? (p.sizes as string[]) : [],
      colors: Array.isArray(p.colors) ? (p.colors as string[]) : [],
      isNew: p.isNew || false,
      discountPercent: (p as any).discountPercent || null,
      onSale: p.onSale || false,
      seoTitle: (p as any).seoTitle || null,
      seoDescription: (p as any).seoDescription || null,
      seoBody: (p as any).seoBody || null,
      imageAlts: Array.isArray((p as any).imageAlts) ? (p as any).imageAlts : [],
      featureBadgeIds: Array.isArray((p as any).featureBadgeIds) ? (p as any).featureBadgeIds : [],
      additionalCategories: Array.isArray((p as any).additionalCategories) ? (p as any).additionalCategories : [],
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
        DECLARE $old_price AS Double;
        DECLARE $images AS Json;
        DECLARE $category AS Utf8;
        DECLARE $subcategory AS Utf8;
        DECLARE $sub_subcategory AS Utf8;
        DECLARE $sizes AS Json;
        DECLARE $colors AS Json;
        DECLARE $color AS Utf8;
        DECLARE $is_new AS Bool;
        DECLARE $in_stock AS Bool;
        DECLARE $is_hidden AS Bool;
        DECLARE $badge_text AS Utf8;
        DECLARE $slug AS Utf8;
        DECLARE $wholesale_price AS Int64;
        DECLARE $stock AS Int64;
        DECLARE $size_stock AS Json;
        DECLARE $composition AS Utf8;
        DECLARE $care_instructions AS Utf8;
        DECLARE $delivery AS Utf8;
        DECLARE $return_policy AS Utf8;
        DECLARE $seo_title AS Utf8;
        DECLARE $seo_description AS Utf8;
        DECLARE $seo_body AS Utf8;
        DECLARE $seo_json_ld AS Utf8;
        DECLARE $specs_html AS Utf8;
        DECLARE $image_alts AS Json;
        DECLARE $feature_badge_ids AS Json;
        DECLARE $additional_categories AS Json;
        DECLARE $artist_slug AS Utf8;
        DECLARE $artist_only AS Bool;
        DECLARE $size_characteristic_ids AS Json;
        
        UPSERT INTO products (
          id, external_id, sku, name, description, price, old_price, images,
          category, subcategory, sub_subcategory, sizes, colors, color,
          is_new, in_stock, is_hidden, badge_text, slug,
          wholesale_price, stock, size_stock,
          composition, care_instructions, delivery, return_policy,
          seo_title, seo_description, seo_body, seo_json_ld, specs_html, image_alts, feature_badge_ids, additional_categories,
          artist_slug, artist_only, size_characteristic_ids
        )
        VALUES (
          $id, $external_id, $sku, $name, $description, $price, $old_price, $images,
          $category, $subcategory, $sub_subcategory, $sizes, $colors, $color,
          $is_new, $in_stock, $is_hidden, $badge_text, $slug,
          $wholesale_price, $stock, $size_stock,
          $composition, $care_instructions, $delivery, $return_policy,
          $seo_title, $seo_description, $seo_body, $seo_json_ld, $specs_html, $image_alts, $feature_badge_ids, $additional_categories,
          $artist_slug, $artist_only, $size_characteristic_ids
        );
      `;
      
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, newId),
        $external_id: TypedValues.fromNative(Types.UTF8, p.externalId || ''),
        $sku: TypedValues.fromNative(Types.UTF8, p.sku || ''),
        $name: TypedValues.fromNative(Types.UTF8, p.name || ''),
        $description: TypedValues.fromNative(Types.UTF8, p.description || ''),
        $price: TypedValues.fromNative(Types.DOUBLE, p.price || 0),
        $old_price: TypedValues.fromNative(Types.DOUBLE, (p as any).discountPercent || 0),
        $images: TypedValues.fromNative(Types.JSON, JSON.stringify(imagesArray)),
        $category: TypedValues.fromNative(Types.UTF8, p.category || ''),
        $subcategory: TypedValues.fromNative(Types.UTF8, p.subcategory || ''),
        $sub_subcategory: TypedValues.fromNative(Types.UTF8, (p as any).subSubcategory || ''),
        $sizes: TypedValues.fromNative(Types.JSON, JSON.stringify(p.sizes || [])),
        $colors: TypedValues.fromNative(Types.JSON, JSON.stringify(p.colors || [])),
        $color: TypedValues.fromNative(Types.UTF8, (p as any).color || ''),
        $is_new: TypedValues.fromNative(Types.BOOL, p.isNew ?? true),
        $in_stock: TypedValues.fromNative(Types.BOOL, true),
        $is_hidden: TypedValues.fromNative(Types.BOOL, (p as any).isHidden ?? false),
        $badge_text: TypedValues.fromNative(Types.UTF8, (p as any).badgeText || ''),
        $slug: TypedValues.fromNative(Types.UTF8, (p as any).slug || ''),
        $wholesale_price: TypedValues.fromNative(Types.INT64, BigInt((p as any).wholesalePrice || 0)),
        $stock: TypedValues.fromNative(Types.INT64, BigInt((p as any).stock || 0)),
        $size_stock: TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).sizeStock || {})),
        $composition: TypedValues.fromNative(Types.UTF8, (p as any).composition || ''),
        $care_instructions: TypedValues.fromNative(Types.UTF8, (p as any).careInstructions || ''),
        $delivery: TypedValues.fromNative(Types.UTF8, (p as any).delivery || ''),
        $return_policy: TypedValues.fromNative(Types.UTF8, (p as any).returnPolicy || ''),
        $seo_title: TypedValues.fromNative(Types.UTF8, (p as any).seoTitle || ''),
        $seo_description: TypedValues.fromNative(Types.UTF8, (p as any).seoDescription || ''),
        $seo_body: TypedValues.fromNative(Types.UTF8, (p as any).seoBody || ''),
        $seo_json_ld: TypedValues.fromNative(Types.UTF8, (p as any).seoJsonLd || ''),
        $specs_html: TypedValues.fromNative(Types.UTF8, (p as any).specsHtml || ''),
        $image_alts: TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).imageAlts || [])),
        $feature_badge_ids: TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).featureBadgeIds || [])),
        $additional_categories: TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).additionalCategories || [])),
        $artist_slug: TypedValues.fromNative(Types.UTF8, (p as any).artistSlug || ''),
        $artist_only: TypedValues.fromNative(Types.BOOL, (p as any).artistOnly ?? false),
        $size_characteristic_ids: TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).sizeCharacteristicIds || {})),
      });
      
      console.log(`[YDB] Created product: ${p.name} with id ${newId}`);
      return true;
    });

    // Add new product directly to the cache so it appears immediately
    // (avoids YDB scan returning only the first 1000 rows and missing the new one)
    const existingCached = productsCache.get("all");
    if (existingCached) {
      productsCache.set("all", [...existingCached, product]);
    }
    productCache.set(`product_${product.id}`, product);
    
    return product;
  }
;

DatabaseStorage.prototype.updateProduct = async function (this: DatabaseStorage, id: number, p: Partial<InsertProduct>): Promise<Product> {
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
      if ((p as any).discountPercent !== undefined) {
        declareStatements += 'DECLARE $old_price AS Double;\n';
        setClauses.push('old_price = $old_price');
        params.$old_price = TypedValues.fromNative(Types.DOUBLE, (p as any).discountPercent || 0);
      }
      if ((p as any).salePrice !== undefined) {
        declareStatements += 'DECLARE $sale_price AS Int64;\n';
        setClauses.push('sale_price = $sale_price');
        params.$sale_price = TypedValues.fromNative(Types.INT64, (p as any).salePrice || 0);
      }
      if ((p as any).wholesaleDiscountPercent !== undefined) {
        declareStatements += 'DECLARE $wholesale_discount_percent AS Double;\n';
        setClauses.push('wholesale_discount_percent = $wholesale_discount_percent');
        params.$wholesale_discount_percent = TypedValues.fromNative(Types.DOUBLE, (p as any).wholesaleDiscountPercent || 0);
      }
      // Handle images array - prefer explicit images over imageUrl
      if ((p as any).images !== undefined && Array.isArray((p as any).images)) {
        declareStatements += 'DECLARE $images AS Json;\n';
        setClauses.push('images = $images');
        params.$images = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).images));
      } else if (p.imageUrl !== undefined) {
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
      if ((p as any).subSubcategory !== undefined) {
        declareStatements += 'DECLARE $sub_subcategory AS Utf8;\n';
        setClauses.push('sub_subcategory = $sub_subcategory');
        params.$sub_subcategory = TypedValues.fromNative(Types.UTF8, (p as any).subSubcategory || '');
      }
      if ((p as any).additionalCategories !== undefined) {
        declareStatements += 'DECLARE $additional_categories AS Json;\n';
        setClauses.push('additional_categories = $additional_categories');
        params.$additional_categories = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).additionalCategories || []));
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
      if ((p as any).badgeText !== undefined) {
        declareStatements += 'DECLARE $badge_text AS Utf8;\n';
        setClauses.push('badge_text = $badge_text');
        params.$badge_text = TypedValues.fromNative(Types.UTF8, (p as any).badgeText || '');
      }
      if ((p as any).color !== undefined) {
        declareStatements += 'DECLARE $color AS Utf8;\n';
        setClauses.push('color = $color');
        params.$color = TypedValues.fromNative(Types.UTF8, (p as any).color || '');
      }
      if ((p as any).thumbnailUrl !== undefined) {
        declareStatements += 'DECLARE $thumbnail_url AS Utf8;\n';
        setClauses.push('thumbnail_url = $thumbnail_url');
        params.$thumbnail_url = TypedValues.fromNative(Types.UTF8, (p as any).thumbnailUrl || '');
      }
      if ((p as any).hoverThumbnailUrl !== undefined) {
        declareStatements += 'DECLARE $hover_thumbnail_url AS Utf8;\n';
        setClauses.push('hover_thumbnail_url = $hover_thumbnail_url');
        params.$hover_thumbnail_url = TypedValues.fromNative(Types.UTF8, (p as any).hoverThumbnailUrl || '');
      }
      if ((p as any).wholesalePrice !== undefined) {
        declareStatements += 'DECLARE $wholesale_price AS Int64;\n';
        setClauses.push('wholesale_price = $wholesale_price');
        params.$wholesale_price = TypedValues.fromNative(Types.INT64, (p as any).wholesalePrice || 0);
      }
      if ((p as any).onSale !== undefined) {
        declareStatements += 'DECLARE $on_sale AS Bool;\n';
        setClauses.push('on_sale = $on_sale');
        params.$on_sale = TypedValues.fromNative(Types.BOOL, (p as any).onSale);
      }
      if ((p as any).isHidden !== undefined) {
        declareStatements += 'DECLARE $is_hidden AS Bool;\n';
        setClauses.push('is_hidden = $is_hidden');
        params.$is_hidden = TypedValues.fromNative(Types.BOOL, (p as any).isHidden);
      }
      
      if ((p as any).inStock !== undefined) {
        declareStatements += 'DECLARE $in_stock AS Bool;\n';
        setClauses.push('in_stock = $in_stock');
        params.$in_stock = TypedValues.fromNative(Types.BOOL, (p as any).inStock);
      }
      
      if ((p as any).stock !== undefined) {
        declareStatements += 'DECLARE $stock AS Int64;\n';
        setClauses.push('stock = $stock');
        params.$stock = TypedValues.fromNative(Types.INT64, (p as any).stock);
      }
      
      if ((p as any).sizeStock !== undefined) {
        declareStatements += 'DECLARE $size_stock AS Json;\n';
        setClauses.push('size_stock = $size_stock');
        params.$size_stock = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).sizeStock));
      }

      if ((p as any).sizeCharacteristicIds !== undefined) {
        declareStatements += 'DECLARE $size_characteristic_ids AS Json;\n';
        setClauses.push('size_characteristic_ids = $size_characteristic_ids');
        params.$size_characteristic_ids = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).sizeCharacteristicIds));
      }
      
      if ((p as any).sizeDiscounts !== undefined) {
        declareStatements += 'DECLARE $size_discounts AS Json;\n';
        setClauses.push('size_discounts = $size_discounts');
        params.$size_discounts = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).sizeDiscounts));
      }
      
      if ((p as any).measurements !== undefined) {
        declareStatements += 'DECLARE $measurements AS Json;\n';
        setClauses.push('measurements = $measurements');
        params.$measurements = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).measurements));
      }

      if ((p as any).measurementSections !== undefined) {
        declareStatements += 'DECLARE $measurement_sections AS Json;\n';
        setClauses.push('measurement_sections = $measurement_sections');
        params.$measurement_sections = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).measurementSections));
      }
      
      if ((p as any).composition !== undefined) {
        declareStatements += 'DECLARE $composition AS Utf8;\n';
        setClauses.push('composition = $composition');
        params.$composition = TypedValues.fromNative(Types.UTF8, (p as any).composition || '');
      }
      
      if ((p as any).careInstructions !== undefined) {
        declareStatements += 'DECLARE $care_instructions AS Utf8;\n';
        setClauses.push('care_instructions = $care_instructions');
        params.$care_instructions = TypedValues.fromNative(Types.UTF8, (p as any).careInstructions || '');
      }

      if ((p as any).specsHtml !== undefined) {
        declareStatements += 'DECLARE $specs_html AS Utf8;\n';
        setClauses.push('specs_html = $specs_html');
        params.$specs_html = TypedValues.fromNative(Types.UTF8, (p as any).specsHtml || '');
      }

      if ((p as any).note !== undefined) {
        declareStatements += 'DECLARE $note AS Utf8;\n';
        setClauses.push('note = $note');
        params.$note = TypedValues.fromNative(Types.UTF8, (p as any).note || '');
      }
      
      if ((p as any).delivery !== undefined) {
        declareStatements += 'DECLARE $delivery AS Utf8;\n';
        setClauses.push('delivery = $delivery');
        params.$delivery = TypedValues.fromNative(Types.UTF8, (p as any).delivery || '');
      }
      
      if ((p as any).returnPolicy !== undefined) {
        declareStatements += 'DECLARE $return_policy AS Utf8;\n';
        setClauses.push('return_policy = $return_policy');
        params.$return_policy = TypedValues.fromNative(Types.UTF8, (p as any).returnPolicy || '');
      }
      
      if ((p as any).autoHideOverride !== undefined) {
        declareStatements += 'DECLARE $auto_hide_override AS Bool;\n';
        setClauses.push('auto_hide_override = $auto_hide_override');
        params.$auto_hide_override = TypedValues.fromNative(Types.BOOL, (p as any).autoHideOverride);
      }

      if ((p as any).noSize !== undefined) {
        declareStatements += 'DECLARE $no_size AS Bool;\n';
        setClauses.push('no_size = $no_size');
        params.$no_size = TypedValues.fromNative(Types.BOOL, (p as any).noSize);
      }
      
      if ((p as any).lookProducts !== undefined) {
        declareStatements += 'DECLARE $look_products AS Json;\n';
        setClauses.push('look_products = $look_products');
        params.$look_products = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).lookProducts || []));
      }
      
      if ((p as any).lookCategory !== undefined) {
        declareStatements += 'DECLARE $look_category AS Utf8;\n';
        setClauses.push('look_category = $look_category');
        params.$look_category = TypedValues.fromNative(Types.UTF8, (p as any).lookCategory || '');
      }
      
      if ((p as any).lookSubcategory !== undefined) {
        declareStatements += 'DECLARE $look_subcategory AS Utf8;\n';
        setClauses.push('look_subcategory = $look_subcategory');
        params.$look_subcategory = TypedValues.fromNative(Types.UTF8, (p as any).lookSubcategory || '');
      }
      
      if (p.seoTitle !== undefined) {
        declareStatements += 'DECLARE $seo_title AS Utf8;\n';
        setClauses.push('seo_title = $seo_title');
        params.$seo_title = TypedValues.fromNative(Types.UTF8, p.seoTitle || '');
      }
      
      if (p.seoDescription !== undefined) {
        declareStatements += 'DECLARE $seo_description AS Utf8;\n';
        setClauses.push('seo_description = $seo_description');
        params.$seo_description = TypedValues.fromNative(Types.UTF8, p.seoDescription || '');
      }
      
      if ((p as any).seoBody !== undefined) {
        declareStatements += 'DECLARE $seo_body AS Utf8;\n';
        setClauses.push('seo_body = $seo_body');
        params.$seo_body = TypedValues.fromNative(Types.UTF8, (p as any).seoBody || '');
      }

      if ((p as any).seoJsonLd !== undefined) {
        declareStatements += 'DECLARE $seo_json_ld AS Utf8;\n';
        setClauses.push('seo_json_ld = $seo_json_ld');
        params.$seo_json_ld = TypedValues.fromNative(Types.UTF8, (p as any).seoJsonLd || '');
      }
      
      if (p.imageAlts !== undefined) {
        declareStatements += 'DECLARE $image_alts AS Json;\n';
        setClauses.push('image_alts = $image_alts');
        params.$image_alts = TypedValues.fromNative(Types.JSON, JSON.stringify(p.imageAlts || []));
      }
      
      if ((p as any).featureBadgeIds !== undefined) {
        declareStatements += 'DECLARE $feature_badge_ids AS Json;\n';
        setClauses.push('feature_badge_ids = $feature_badge_ids');
        params.$feature_badge_ids = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).featureBadgeIds || []));
      }
      
      if ((p as any).preorderEnabled !== undefined) {
        declareStatements += 'DECLARE $preorder_enabled AS Bool;\n';
        setClauses.push('preorder_enabled = $preorder_enabled');
        params.$preorder_enabled = TypedValues.fromNative(Types.BOOL, (p as any).preorderEnabled);
      }
      if ((p as any).wholesalePreorderEnabled !== undefined) {
        declareStatements += 'DECLARE $wholesale_preorder_enabled AS Bool;\n';
        setClauses.push('wholesale_preorder_enabled = $wholesale_preorder_enabled');
        params.$wholesale_preorder_enabled = TypedValues.fromNative(Types.BOOL, !!(p as any).wholesalePreorderEnabled);
      }
      if ((p as any).wholesalePreorderSizes !== undefined) {
        declareStatements += 'DECLARE $wholesale_preorder_sizes AS Json;\n';
        setClauses.push('wholesale_preorder_sizes = $wholesale_preorder_sizes');
        params.$wholesale_preorder_sizes = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).wholesalePreorderSizes || []));
      }
      if ((p as any).wholesalePreorderRrp !== undefined) {
        declareStatements += 'DECLARE $wholesale_preorder_rrp AS Int64;\n';
        setClauses.push('wholesale_preorder_rrp = $wholesale_preorder_rrp');
        params.$wholesale_preorder_rrp = TypedValues.fromNative(Types.INT64, (p as any).wholesalePreorderRrp || 0);
      }
      if ((p as any).wholesalePreorderPrice !== undefined) {
        declareStatements += 'DECLARE $wholesale_preorder_price AS Int64;\n';
        setClauses.push('wholesale_preorder_price = $wholesale_preorder_price');
        params.$wholesale_preorder_price = TypedValues.fromNative(Types.INT64, (p as any).wholesalePreorderPrice || 0);
      }
      if ((p as any).preorderGoal !== undefined) {
        declareStatements += 'DECLARE $preorder_goal AS Uint32;\n';
        setClauses.push('preorder_goal = $preorder_goal');
        params.$preorder_goal = TypedValues.fromNative(Types.UINT32, (p as any).preorderGoal || 0);
      }
      if ((p as any).preorderCurrent !== undefined) {
        declareStatements += 'DECLARE $preorder_current AS Uint32;\n';
        setClauses.push('preorder_current = $preorder_current');
        params.$preorder_current = TypedValues.fromNative(Types.UINT32, (p as any).preorderCurrent || 0);
      }
      if ((p as any).preorderDeadline !== undefined) {
        declareStatements += 'DECLARE $preorder_deadline AS Utf8;\n';
        setClauses.push('preorder_deadline = $preorder_deadline');
        params.$preorder_deadline = TypedValues.fromNative(Types.UTF8, (p as any).preorderDeadline || '');
      }
      if ((p as any).preorderProductionDate !== undefined) {
        declareStatements += 'DECLARE $preorder_production_date AS Utf8;\n';
        setClauses.push('preorder_production_date = $preorder_production_date');
        params.$preorder_production_date = TypedValues.fromNative(Types.UTF8, (p as any).preorderProductionDate || '');
      }
      if ((p as any).preorderShippingDate !== undefined) {
        declareStatements += 'DECLARE $preorder_shipping_date AS Utf8;\n';
        setClauses.push('preorder_shipping_date = $preorder_shipping_date');
        params.$preorder_shipping_date = TypedValues.fromNative(Types.UTF8, (p as any).preorderShippingDate || '');
      }
      if ((p as any).preorderStatus !== undefined) {
        declareStatements += 'DECLARE $preorder_status AS Utf8;\n';
        setClauses.push('preorder_status = $preorder_status');
        params.$preorder_status = TypedValues.fromNative(Types.UTF8, (p as any).preorderStatus || '');
      }
      if ((p as any).slug !== undefined) {
        declareStatements += 'DECLARE $slug AS Utf8;\n';
        setClauses.push('slug = $slug');
        params.$slug = TypedValues.fromNative(Types.UTF8, (p as any).slug || '');
      }

      if ((p as any).artistSlug !== undefined) {
        declareStatements += 'DECLARE $artist_slug AS Utf8;\n';
        setClauses.push('artist_slug = $artist_slug');
        const artistSlugValue = (p as any).artistSlug || '';
        params.$artist_slug = TypedValues.fromNative(Types.UTF8, artistSlugValue);
        console.log(`[YDB] updateProduct id=${id}: setting artist_slug="${artistSlugValue}"`);
      }

      if ((p as any).videoUrl !== undefined) {
        declareStatements += 'DECLARE $video_url AS Utf8;\n';
        setClauses.push('video_url = $video_url');
        params.$video_url = TypedValues.fromNative(Types.UTF8, (p as any).videoUrl || '');
      }

      if ((p as any).preorderGroup !== undefined) {
        declareStatements += 'DECLARE $preorder_group AS Utf8;\n';
        setClauses.push('preorder_group = $preorder_group');
        params.$preorder_group = TypedValues.fromNative(Types.UTF8, (p as any).preorderGroup || '');
      }

      if (setClauses.length === 0) return null;

      // Всегда обновляем updated_at при реальном изменении товара — используется
      // как dateModified в Product JSON-LD (сигнал свежести для Google/Яндекса).
      declareStatements += 'DECLARE $updated_at AS Timestamp;\n';
      setClauses.push('updated_at = $updated_at');
      params.$updated_at = TypedValues.timestamp(new Date());

      const query = `
        ${declareStatements}
        UPDATE products SET ${setClauses.join(', ')} WHERE id = $id;
      `;
      
      await session.executeQuery(query, params);
      console.log(`[YDB] Updated product id ${id}`);
      return true;
    });
    
    // Update cache: replace just this product in productsCache instead of clearing everything
    // This prevents race conditions where a background refresh overwrites fresh data
    if (!(p as any).skipCacheClear) {
      const cachedList = productsCache.get("all");
      if (cachedList) {
        // Fetch the fresh product from YDB and update it in the list
        const freshProduct = await this.safeQuery(async (session) => {
          const { TypedValues, Types } = await import("ydb-sdk");
          const query = "DECLARE $id AS Utf8; SELECT * FROM products WHERE id = $id";
          const { resultSets } = await session.executeQuery(query, {
            $id: TypedValues.fromNative(Types.UTF8, String(id)),
          });
          const rs = resultSets[0];
          if (!rs.rows?.[0] || !rs.columns) return null;
          const data = this.parseRowWithColumns(rs.rows[0], rs.columns);
          return this.parseProduct(data);
        });
        if (freshProduct) {
          console.log(`[YDB] updateProduct id=${id} read-after-write: artist_slug="${(freshProduct as any).artistSlug}" isHidden=${(freshProduct as any).isHidden}`);
          const updated = cachedList.map(item => item.id === id ? freshProduct : item);
          productsCache.set("all", updated);
          productCache.set(`product_${id}`, freshProduct);
        } else {
          this.clearCache();
        }
      } else {
        productCache.delete(`product_${id}`);
      }
    }
    
    return { ...p, id } as Product;
  }
;

DatabaseStorage.prototype.deleteProduct = async function (this: DatabaseStorage, id: number): Promise<boolean> {
    const ydbDriver = await waitForDriver();
    
    if (!ydbDriver) {
      const index = devProducts.findIndex(item => item.id === id);
      if (index !== -1) {
        devProducts.splice(index, 1);
        console.log(`[DevStorage] Deleted product id ${id}`);
        return true;
      }
      return false;
    }

    const result = await ydbDriver.tableClient.withSession(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      
      const query = `
        DECLARE $id AS Utf8;
        DELETE FROM products WHERE id = $id;
      `;
      
      const params = {
        $id: TypedValues.fromNative(Types.UTF8, String(id)),
      };
      
      await session.executeQuery(query, params);
      console.log(`[YDB] Deleted product id ${id}`);
      return true;
    }).catch((err: any) => {
      logError("[YDB] Delete error:", err.message);
      return false;
    });
    
    // Clear cache after deletion
    this.clearCache();
    
    return result === true;
  }
;

DatabaseStorage.prototype.addDeletedProductSlug = async function (this: DatabaseStorage, slug: string): Promise<void> {
    if (!slug) return;
    try {
      const current = await this.getPageSettings("deleted_slugs");
      const existing: string[] = Array.isArray(current?.list?.slugs) ? current.list.slugs : [];
      if (existing.includes(slug)) return; // already recorded
      await this.setPageSectionSettings("deleted_slugs", "list", { slugs: [...existing, slug] });
      console.log(`[SEO] Recorded deleted product slug for 410: ${slug}`);
    } catch (err: any) {
      logError(`[SEO] Failed to record deleted slug ${slug}:`, err.message);
    }
  }
;

DatabaseStorage.prototype.deleteAllProducts = async function (this: DatabaseStorage, ): Promise<number> {
    const ydbDriver = await waitForDriver();
    
    if (!ydbDriver) {
      const count = devProducts.length;
      devProducts.length = 0;
      console.log(`[DevStorage] Deleted all ${count} products`);
      return count;
    }

    // First get count of products
    const products = await this.getProducts();
    const count = products.length;
    
    const result = await ydbDriver.tableClient.withSession(async (session) => {
      const query = `DELETE FROM products;`;
      await session.executeQuery(query);
      console.log(`[YDB] Deleted all products (${count} items)`);
      return count;
    }).catch((err: any) => {
      logError("[YDB] Delete all error:", err.message);
      return 0;
    });
    
    // Clear cache after deletion
    this.clearCache();
    
    return result || 0;
  }
;

DatabaseStorage.prototype.addThumbnailColumn = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    const columnsToAdd = ['thumbnail_url', 'hover_thumbnail_url'];
    const results: string[] = [];
    
    try {
      const ydb = await import('ydb-sdk');
      const colType = ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.UTF8 } } });
      
      for (const colName of columnsToAdd) {
        try {
          await driver.tableClient.withSession(async (session) => {
            await session.alterTable('products', {
              addColumns: [{ name: colName, type: colType }]
            } as any);
          });
          results.push(`${colName}: added`);
        } catch (e: any) {
          if (e.message?.includes("already exists") || e.message?.includes("Duplicate column") || e.message?.includes("Cannot alter type")) {
            results.push(`${colName}: already exists`);
          } else {
            results.push(`${colName}: error - ${e.message}`);
          }
        }
      }
      
      return { success: true, message: results.join('; ') };
    } catch (err: any) {
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;

DatabaseStorage.prototype.addWholesalePriceColumn = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'wholesale_price', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.INT64 } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column wholesale_price added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;

DatabaseStorage.prototype.addOnSaleColumn = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'on_sale', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.BOOL } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column on_sale added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;

DatabaseStorage.prototype.addSeoJsonLdColumn = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'seo_json_ld', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.UTF8 } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column seo_json_ld added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column") || err.message?.includes("Cannot alter type")) {
        return { success: true, message: "Column already exists" };
      }
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;

DatabaseStorage.prototype.addOldPriceColumn = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'old_price', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.DOUBLE } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column old_price added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column") || err.message?.includes("Cannot alter type")) {
        return { success: true, message: "Column already exists" };
      }
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;

DatabaseStorage.prototype.addIsHiddenColumn = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'is_hidden', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.BOOL } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column is_hidden added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;

DatabaseStorage.prototype.addAutoHideOverrideColumn = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'auto_hide_override', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.BOOL } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column auto_hide_override added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;

DatabaseStorage.prototype.addStockColumn = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'stock', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.INT64 } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column stock added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;

DatabaseStorage.prototype.addSlugColumn = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'slug', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.UTF8 } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column slug added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;
