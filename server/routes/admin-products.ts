import type { Express } from "express";
import { logError, logInfo } from "../logger";
import { storage } from "../storage";
import { uploadToYandexStorage, deleteFromYandexStorage } from "../lib/storage-s3";
import { sanitizeHtmlBlock, sanitizeJsonLd, canonicalizeSizeKey } from "../lib/product-utils";
import { enqueueNewProduct } from "../new-products-notifier";
import { enqueuePreorderProduct } from "../preorder-notifier";
import { sendPriceDropEmail } from "../email";

// Admin products management routes extracted from routes.ts verbatim.
export function registerAdminProductsRoutes(
  app: Express,
  getAdminKey: () => string | undefined,
  processStockNotifications: (
    productId: number, productName: string, oldSizeStock: Record<string, number> | null,
    newSizeStock: Record<string, number>, imageUrl?: string, slug?: string
  ) => Promise<void>
) {
  // ============ ADMIN PRODUCT MANAGEMENT ============
  
  // Create new product (admin only)
  app.post("/api/admin/products", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const { 
        name, description, price, category, subcategory,
        sizes, colors, composition, careInstructions, delivery, returnPolicy,
        measurements, images, imageUrl, sku, color, stock, sizeStock,
        wholesalePrice, wholesaleDiscountPercent, discountPercent, sizeDiscounts, seoTitle, seoDescription, seoBody, specsHtml, imageAlts, featureBadgeIds,
        additionalCategories,
        preorderEnabled, preorderGoal, preorderDeadline, preorderProductionDate, preorderShippingDate, preorderNote,
        preorderGroup,
      } = req.body;
      
      if (!name || !price || !category) {
        return res.status(400).json({ error: "Missing required fields: name, price, category" });
      }
      
      const { generateUniqueSlug } = await import("../slugify");
      const allProducts = await storage.getProducts();
      const existingSlugs = allProducts.map((p: any) => p.slug).filter(Boolean);
      const autoSlug = req.body.slug || generateUniqueSlug(name, existingSlugs);

      const sizesArray: string[] = Array.isArray(sizes) ? sizes : [];
      const generatedExternalId = crypto.randomUUID();
      const generatedSizeCharIds: Record<string, string> = {};
      for (const s of sizesArray) {
        generatedSizeCharIds[s] = crypto.randomUUID();
      }

      const productData: any = {
        name,
        description: description || '',
        price: parseInt(price),
        category,
        subcategory: subcategory || null,
        sizes: sizesArray,
        colors: colors || [],
        imageUrl: imageUrl || images?.[0] || "/placeholder.svg",
        thumbnailUrl: (() => {
          const firstImg = imageUrl || images?.[0];
          if (firstImg && firstImg.includes('.webp') && !firstImg.includes('_thumb.webp')) {
            return firstImg.replace('.webp', '_thumb.webp');
          }
          return firstImg || null;
        })(),
        images: images || [],
        sku: sku || `MANUAL-${Date.now()}`,
        color: color || null,
        composition: composition || null,
        careInstructions: careInstructions || null,
        delivery: delivery || null,
        returnPolicy: returnPolicy || null,
        measurements: measurements || null,
        isNew: true,
        inStock: true,
        isHidden: false,
        stock: stock !== undefined ? parseInt(stock) : 0,
        sizeStock: sizeStock || {},
        slug: autoSlug,
        wholesalePrice: wholesalePrice ? parseInt(wholesalePrice) : null,
        wholesaleDiscountPercent: wholesaleDiscountPercent ? parseInt(wholesaleDiscountPercent) : 0,
        discountPercent: discountPercent ? parseInt(discountPercent) : 0,
        sizeDiscounts: (sizeDiscounts && typeof sizeDiscounts === 'object') ? sizeDiscounts : {},
        seoTitle: seoTitle || '',
        seoDescription: seoDescription || '',
        seoBody: sanitizeHtmlBlock(seoBody || ''),
        specsHtml: sanitizeHtmlBlock(specsHtml || ''),
        imageAlts: Array.isArray(imageAlts) ? imageAlts : [],
        featureBadgeIds: Array.isArray(featureBadgeIds) ? featureBadgeIds : [],
        additionalCategories: Array.isArray(additionalCategories) ? additionalCategories : [],
        preorderEnabled: preorderEnabled === true || preorderEnabled === 'true' || false,
        preorderGoal: preorderGoal ? parseInt(preorderGoal) : null,
        preorderDeadline: preorderDeadline || null,
        preorderProductionDate: preorderProductionDate || null,
        preorderShippingDate: preorderShippingDate || null,
        preorderNote: preorderNote || null,
        preorderGroup: preorderGroup || null,
        preorderStatus: (preorderEnabled === true || preorderEnabled === 'true') ? 'collecting' : null,
        externalId: generatedExternalId,
        sizeCharacteristicIds: generatedSizeCharIds,
      };
      
      const product = await storage.createProduct(productData);
      logInfo(`[Admin] Created new product: ${name} (ID: ${product.id})`);
      if (preorderEnabled === true || preorderEnabled === 'true') {
        enqueuePreorderProduct(product.id).catch(() => {});
      } else {
        enqueueNewProduct(product.id).catch(() => {});
      }
      res.json({ success: true, product });
    } catch (error) {
      logError("[Admin] Error creating product:", error);
      res.status(500).json({ error: "Failed to create product" });
    }
  });

  // Admin API - Update product category (move between categories)
  // IMPORTANT: Must be registered BEFORE /api/admin/products/:id to avoid Express treating "category" as :id
  app.patch("/api/admin/products/bulk-badges", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) return res.status(503).json({ message: "Admin API not configured" });
    if (apiKey !== expectedKey) return res.status(401).json({ message: "Unauthorized" });

    const { ids, isNew, badgeText } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "ids array required" });
    }

    let updated = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        await storage.updateProduct(id, { isNew: !!isNew, badgeText: badgeText || null } as any);
        updated++;
      } catch (err: any) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    storage.clearCache();
    logInfo(`[Admin] Bulk badge update: ${updated}/${ids.length} products, isNew=${isNew}, badgeText="${badgeText || ''}"`);
    res.json({ updated, total: ids.length, errors: errors.length > 0 ? errors.slice(0, 5) : undefined });
  });

  app.patch("/api/admin/products/bulk-discount", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) return res.status(503).json({ message: "Admin API not configured" });
    if (apiKey !== expectedKey) return res.status(401).json({ message: "Unauthorized" });

    const { ids, discountPercent } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "ids array required" });
    }
    const dp = parseInt(discountPercent);
    const discount = isNaN(dp) ? 0 : Math.max(0, Math.min(dp, 99));

    let updated = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        await storage.updateProduct(id, { discountPercent: discount } as any);
        updated++;
      } catch (err: any) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    storage.clearCache();
    logInfo(`[Admin] Bulk discount: ${updated}/${ids.length} products, discount=${discount}%`);
    res.json({ updated, total: ids.length, errors: errors.length > 0 ? errors.slice(0, 5) : undefined });
  });

  app.patch("/api/admin/products/bulk-measurements", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) return res.status(503).json({ message: "Admin API not configured" });
    if (apiKey !== expectedKey) return res.status(401).json({ message: "Unauthorized" });

    const { ids, measurements } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "ids array required" });
    }
    if (!Array.isArray(measurements)) {
      return res.status(400).json({ message: "measurements array required" });
    }

    let updated = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        await storage.updateProduct(id, { measurements: measurements.length > 0 ? measurements : null } as any);
        updated++;
      } catch (err: any) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    storage.clearCache();
    logInfo(`[Admin] Bulk measurements: ${updated}/${ids.length} products, rows=${measurements.length}`);
    res.json({ updated, total: ids.length, errors: errors.length > 0 ? errors.slice(0, 5) : undefined });
  });

  app.patch("/api/admin/products/category", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const { productIds, category, subcategory, subSubcategory: bulkSubSubcategory } = req.body;
      
      if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ message: "productIds array required" });
      }
      
      if (!category) {
        return res.status(400).json({ message: "category required" });
      }

      let updated = 0;
      for (const id of productIds) {
        try {
          await storage.updateProduct(id, { 
            category, 
            subcategory: subcategory || null,
            subSubcategory: bulkSubSubcategory || null,
          } as any);
          updated++;
        } catch (err) {
          logError(`[Admin] Failed to update product ${id}:`, err);
        }
      }

      logInfo(`[Admin] Moved ${updated} products to category: ${category}/${subcategory || 'none'}/${bulkSubSubcategory || 'none'}`);
      res.json({ success: true, updated, category, subcategory, subSubcategory: bulkSubSubcategory || null });
    } catch (err) {
      logError("[Admin] Update category error:", err);
      res.status(500).json({ success: false, message: "Update failed" });
    }
  });

  // Bulk add/remove additional category (admin only)
  app.patch("/api/admin/products/additional-category", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const { productIds, category, subcategory, subSubcategory, action } = req.body;

      if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ message: "productIds array required" });
      }
      if (!category) {
        return res.status(400).json({ message: "category required" });
      }

      let updated = 0;
      for (const id of productIds) {
        try {
          const product = await storage.getProduct(id);
          if (!product) continue;

          const existing: Array<{ category: string; subcategory: string; subSubcategory?: string }> =
            (product as any).additionalCategories || [];

          let newList: Array<{ category: string; subcategory: string; subSubcategory?: string }>;

          const normSubSub = (s: any) => (s == null ? "" : String(s));
          if (action === "remove") {
            newList = existing.filter(
              (ac) => !(
                ac.category === category &&
                (ac.subcategory || "") === (subcategory || "") &&
                normSubSub(ac.subSubcategory) === normSubSub(subSubcategory)
              )
            );
          } else {
            const alreadyExists = existing.some(
              (ac) => ac.category === category &&
                (ac.subcategory || "") === (subcategory || "") &&
                normSubSub(ac.subSubcategory) === normSubSub(subSubcategory)
            );
            if (alreadyExists) {
              updated++;
              continue;
            }
            newList = [...existing, {
              category,
              subcategory: subcategory || "",
              ...(subSubcategory ? { subSubcategory: String(subSubcategory) } : {}),
            }];
          }

          await storage.updateProduct(id, { additionalCategories: newList } as any);
          updated++;
        } catch (err) {
          logError(`[Admin] Failed to update additional category for product ${id}:`, err);
        }
      }

      logInfo(`[Admin] Bulk ${action || "add"} additional category: ${category}/${subcategory || "none"}/${subSubcategory || "none"} for ${updated} products`);
      res.json({ success: true, updated, category, subcategory, subSubcategory: subSubcategory || null });
    } catch (err) {
      logError("[Admin] Bulk additional category error:", err);
      res.status(500).json({ success: false, message: "Update failed" });
    }
  });

  // Update product (admin only)
  app.patch("/api/admin/products/:id", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const id = parseInt(req.params.id);
      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      
      const { 
        name, description, price, category, subcategory, subSubcategory, additionalCategories,
        sizes, colors, composition, careInstructions, note, delivery, returnPolicy,
        measurements, measurementSections, images, imageUrl, sku, color, wholesalePrice, wholesaleDiscountPercent,
        isNew, badgeText, lookProducts, lookCategory, lookSubcategory,
        preorderEnabled, preorderGoal, preorderDeadline, preorderProductionDate, preorderShippingDate,
        stock, sizeStock, slug, discountPercent, noSize, sizeDiscounts, salePrice, videoUrl, disabledNotifySizes,
        seoTitle, seoDescription, seoBody, seoJsonLd, specsHtml, imageAlts, featureBadgeIds,
        isHidden, autoHideOverride, inStock
      } = req.body;
      
      const updateData: any = {};
      
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (price !== undefined) updateData.price = parseInt(price);
      if (isHidden !== undefined) updateData.isHidden = isHidden === true;
      if (autoHideOverride !== undefined) updateData.autoHideOverride = autoHideOverride === true;
      if (inStock !== undefined) updateData.inStock = inStock === true;
      if (category !== undefined) updateData.category = category;
      if (subcategory !== undefined) updateData.subcategory = subcategory;
      if (subSubcategory !== undefined) updateData.subSubcategory = subSubcategory || null;
      if (additionalCategories !== undefined) {
        updateData.additionalCategories = Array.isArray(additionalCategories) ? additionalCategories : [];
      }
      if (sizes !== undefined) {
        updateData.sizes = sizes;
        const existingCharIds = ((product as any).sizeCharacteristicIds || {}) as Record<string, string>;
        const newCharIds: Record<string, string> = {};
        for (const s of (sizes as string[])) {
          newCharIds[s] = existingCharIds[s] || crypto.randomUUID();
        }
        updateData.sizeCharacteristicIds = newCharIds;
        if (!(product as any).externalId) {
          updateData.externalId = crypto.randomUUID();
        }
      }
      if (colors !== undefined) updateData.colors = colors;
      if (composition !== undefined) updateData.composition = composition;
      if (careInstructions !== undefined) updateData.careInstructions = careInstructions;
      if (note !== undefined) updateData.note = note;
      if (delivery !== undefined) updateData.delivery = delivery;
      if (returnPolicy !== undefined) updateData.returnPolicy = returnPolicy;
      if (measurements !== undefined) updateData.measurements = measurements;
      if (measurementSections !== undefined) updateData.measurementSections = Array.isArray(measurementSections) ? measurementSections : [];
      if (sku !== undefined) updateData.sku = sku;
      if (color !== undefined) updateData.color = color;
      if (wholesalePrice !== undefined) updateData.wholesalePrice = parseInt(wholesalePrice);
      if (wholesaleDiscountPercent !== undefined) {
        const wdp = parseInt(wholesaleDiscountPercent);
        updateData.wholesaleDiscountPercent = isNaN(wdp) || wdp <= 0 ? 0 : Math.min(wdp, 99);
      }
      if (discountPercent !== undefined) {
        const dp = parseInt(discountPercent);
        updateData.discountPercent = isNaN(dp) || dp <= 0 ? 0 : Math.min(dp, 99);
      }
      if (salePrice !== undefined) {
        const sp = parseInt(salePrice);
        updateData.salePrice = (isNaN(sp) || sp <= 0) ? 0 : sp;
      }
      if (isNew !== undefined) updateData.isNew = isNew;
      if (badgeText !== undefined) updateData.badgeText = badgeText || null;
      if (lookProducts !== undefined) {
        const validLookProducts = Array.isArray(lookProducts) 
          ? lookProducts.filter((id: any) => typeof id === 'number' && id > 0).slice(0, 6)
          : [];
        updateData.lookProducts = [...new Set(validLookProducts)];
        logInfo(`[Admin] lookProducts update for product ${id}: received=${JSON.stringify(lookProducts)}, saved=${JSON.stringify(updateData.lookProducts)}`);
      }
      if (lookCategory !== undefined) {
        updateData.lookCategory = lookCategory || null;
        logInfo(`[Admin] lookCategory update for product ${id}: ${lookCategory}`);
      }
      if (lookSubcategory !== undefined) {
        updateData.lookSubcategory = lookSubcategory || null;
        logInfo(`[Admin] lookSubcategory update for product ${id}: ${lookSubcategory}`);
      }
      if (stock !== undefined) {
        const parsedStock = parseInt(stock);
        updateData.stock = isNaN(parsedStock) || parsedStock < 0 ? 0 : parsedStock;
        logInfo(`[Admin] Stock update for product ${id}: ${updateData.stock}`);
      }
      if (sizeStock !== undefined && typeof sizeStock === 'object') {
        const cleanedSizeStock: Record<string, number> = {};
        for (const [k, v] of Object.entries(sizeStock)) {
          const num = parseInt(String(v));
          const canonicalKey = canonicalizeSizeKey(k);
          cleanedSizeStock[canonicalKey] = Math.max(cleanedSizeStock[canonicalKey] ?? 0, isNaN(num) || num < 0 ? 0 : num);
        }
        updateData.sizeStock = cleanedSizeStock;
        logInfo(`[Admin] SizeStock update for product ${id}: ${JSON.stringify(cleanedSizeStock)}`);
      }
      // Единый источник остатка: если у товара есть остатки по размерам,
      // «Общий остаток» не хранится как независимое число — всегда равен сумме
      // размеров. Исключает расхождение двух полей в админке и «молчаливое»
      // скрытие товара при ненулевых остатках по размерам.
      const finalSizeStock: Record<string, number> = (updateData.sizeStock !== undefined && updateData.sizeStock !== null)
        ? updateData.sizeStock
        : (((product as any).sizeStock as Record<string, number> | null) || {});
      if (
        Object.keys(finalSizeStock).length > 0 &&
        (updateData.stock !== undefined || updateData.sizeStock !== undefined)
      ) {
        updateData.stock = Object.values(finalSizeStock).reduce((sum, v) => sum + (Number(v) || 0), 0);
        logInfo(`[Admin] Stock recomputed from sizeStock for product ${id}: ${updateData.stock}`);
      }
      if (sizeDiscounts !== undefined && typeof sizeDiscounts === 'object') {
        const cleanedSizeDiscounts: Record<string, number> = {};
        for (const [k, v] of Object.entries(sizeDiscounts)) {
          const num = parseInt(String(v));
          if (!isNaN(num) && num > 0 && num <= 99) {
            cleanedSizeDiscounts[k] = num;
          }
        }
        updateData.sizeDiscounts = cleanedSizeDiscounts;
        logInfo(`[Admin] SizeDiscounts update for product ${id}: ${JSON.stringify(cleanedSizeDiscounts)}`);
      }
      if (disabledNotifySizes !== undefined && Array.isArray(disabledNotifySizes)) {
        updateData.disabledNotifySizes = disabledNotifySizes.filter((s: any) => typeof s === 'string');
        logInfo(`[Admin] DisabledNotifySizes update for product ${id}: ${JSON.stringify(updateData.disabledNotifySizes)}`);
      }
      if (preorderEnabled !== undefined) updateData.preorderEnabled = preorderEnabled;
      if (preorderGoal !== undefined) updateData.preorderGoal = parseInt(preorderGoal) || 0;
      if (preorderDeadline !== undefined) updateData.preorderDeadline = preorderDeadline || null;
      if (preorderProductionDate !== undefined) updateData.preorderProductionDate = preorderProductionDate || null;
      if (preorderShippingDate !== undefined) updateData.preorderShippingDate = preorderShippingDate || null;
      if (req.body.preorderGroup !== undefined) updateData.preorderGroup = req.body.preorderGroup || null;
      if (preorderEnabled && !product.preorderStatus) updateData.preorderStatus = "collecting";
      if (preorderEnabled && product.isHidden) {
        updateData.isHidden = false;
        logInfo(`[Admin] Auto-showing product ${id} because preorder was enabled`);
      }
      if (slug !== undefined) {
        updateData.slug = slug;
      } else if (!(product as any).slug) {
        // Product has no slug — auto-generate from current (or new) name
        const currentName = name || product.name;
        const { generateUniqueSlug } = await import("../slugify");
        const allProducts = await storage.getProducts();
        const existingSlugs = allProducts.map((p: any) => p.slug).filter(Boolean);
        updateData.slug = generateUniqueSlug(currentName, existingSlugs);
        logInfo(`[Admin] Auto-generated slug for product ${id}: ${updateData.slug}`);
      }
      if (noSize !== undefined) updateData.noSize = noSize;
      if (videoUrl !== undefined) updateData.videoUrl = videoUrl || null;
      if (seoTitle !== undefined) updateData.seoTitle = seoTitle || '';
      if (seoDescription !== undefined) updateData.seoDescription = seoDescription || '';
      if (seoBody !== undefined) updateData.seoBody = sanitizeHtmlBlock(seoBody || '');
      if (seoJsonLd !== undefined) updateData.seoJsonLd = sanitizeJsonLd(seoJsonLd || '');
      if (specsHtml !== undefined) updateData.specsHtml = sanitizeHtmlBlock(specsHtml || '');
      if (imageAlts !== undefined) updateData.imageAlts = Array.isArray(imageAlts) ? imageAlts : [];
      if (featureBadgeIds !== undefined) updateData.featureBadgeIds = Array.isArray(featureBadgeIds) ? featureBadgeIds : [];
      if (req.body.artistSlug !== undefined) {
        // Normalize: trim whitespace and lowercase to prevent casing/spacing variants
        const rawSlug = req.body.artistSlug;
        updateData.artistSlug = rawSlug ? rawSlug.trim().toLowerCase() : null;
        logInfo(`[Admin] product ${id} artistSlug from request: "${rawSlug}" → stored as: "${updateData.artistSlug}"`);
      }

      // Handle images
      if (images !== undefined) {
        // Find images removed from the array → delete from Object Storage
        const oldImages: string[] = Array.isArray((product as any).images) ? (product as any).images : (product.imageUrl ? [product.imageUrl] : []);
        const newImageSet = new Set(images);
        const removedImages = oldImages.filter(url => !newImageSet.has(url));
        if (removedImages.length > 0 && process.env.YANDEX_STORAGE_BUCKET_NAME) {
          const bucketBase = `https://storage.yandexcloud.net/${process.env.YANDEX_STORAGE_BUCKET_NAME}/`;
          for (const url of removedImages) {
            if (url.startsWith(bucketBase)) {
              const key = url.slice(bucketBase.length);
              deleteFromYandexStorage(key).then(ok => {
                logInfo(`[Admin] Deleted image from storage: ${key} → ${ok}`);
              }).catch(() => {});
              // Also delete _thumb version
              const thumbKey = key.replace(/\.webp$/i, '_thumb.webp');
              if (thumbKey !== key) {
                deleteFromYandexStorage(thumbKey).then(ok => {
                  logInfo(`[Admin] Deleted thumb from storage: ${thumbKey} → ${ok}`);
                }).catch(() => {});
              }
            }
          }
        }

        updateData.images = images;
        if (images.length > 0) {
          updateData.imageUrl = images[0];
          const firstImg = images[0];
          updateData.thumbnailUrl = (firstImg && firstImg.includes('.webp') && !firstImg.includes('_thumb.webp'))
            ? firstImg.replace('.webp', '_thumb.webp')
            : firstImg;
          const secondImg = images.length > 1 ? images[1] : null;
          updateData.hoverThumbnailUrl = secondImg && secondImg.includes('.webp') && !secondImg.includes('_thumb.webp')
            ? secondImg.replace('.webp', '_thumb.webp')
            : secondImg;
        } else {
          updateData.imageUrl = '';
          updateData.thumbnailUrl = '';
          updateData.hoverThumbnailUrl = null;
        }
      }
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
      
      await storage.updateProduct(id, updateData);
      storage.clearCache();
      const updated = await storage.getProduct(id);
      
      if (product) {
        const oldStock = (product as any).stock ?? 0;
        const oldSizeStock = (product as any).sizeStock || null;
        const newStock = updateData.stock !== undefined ? updateData.stock : oldStock;
        const newSizeStock = updateData.sizeStock || null;
        
        const prodImages = Array.isArray((product as any).images) && (product as any).images.length > 0 ? (product as any).images[0] : undefined;
        const prodSlug = (product as any).slug || undefined;
        if (newSizeStock && typeof newSizeStock === 'object') {
          processStockNotifications(id, product.name, oldSizeStock, newSizeStock as Record<string, number>, prodImages, prodSlug).catch(() => {});
        } else if (newStock > 0 && oldStock <= 0 && !newSizeStock) {
          const notifySize = product.sizes?.length > 0 ? product.sizes[0] : "one-size";
          processStockNotifications(id, product.name, { [notifySize]: 0 }, { [notifySize]: newStock }, prodImages, prodSlug).catch(() => {});
        }

        // Preorder notifications — ставим в очередь при включении предзаказа (дайджест раз в 5 часов)
        if (preorderEnabled === true && !(product as any).preorderEnabled) {
          enqueuePreorderProduct(id).catch(() => {});
        }

        // Price drop notifications — учитываем и прямое изменение цены, и скидку процентом
        const oldBasePrice = product.price || 0;
        const oldDiscountPct = (product as any).discountPercent || 0;
        const oldEffectivePrice = oldDiscountPct > 0 ? Math.round(oldBasePrice * (1 - oldDiscountPct / 100)) : oldBasePrice;

        const newBasePrice = updateData.price !== undefined ? updateData.price : oldBasePrice;
        const newDiscountPct = updateData.discountPercent !== undefined ? updateData.discountPercent : oldDiscountPct;
        const newEffectivePrice = newDiscountPct > 0 ? Math.round(newBasePrice * (1 - newDiscountPct / 100)) : newBasePrice;

        logInfo(`[PriceDrop] old effective=${oldEffectivePrice} (base=${oldBasePrice}, disc=${oldDiscountPct}%), new effective=${newEffectivePrice} (base=${newBasePrice}, disc=${newDiscountPct}%)`);

        if (newEffectivePrice < oldEffectivePrice) {
          logInfo(`[PriceDrop] Price dropped from ${oldEffectivePrice} to ${newEffectivePrice} for product ${id}`);
          (async () => {
            try {
              const subscribers = await storage.getPriceDropSubscribersByProduct(id);
              logInfo(`[PriceDrop] Found ${subscribers.length} subscribers for product ${id}`);
              const eligible = subscribers.filter(s => s.priceAtSubscription > newEffectivePrice);
              logInfo(`[PriceDrop] ${eligible.length} eligible (subscribed at > ${newEffectivePrice})`);
              if (eligible.length === 0) return;
              const baseUrl = process.env.SITE_URL || 'https://www.booomerangs.ru';
              const prodSlugForUrl = (updated as any)?.slug || id;
              const productUrl = `${baseUrl}/${prodSlugForUrl}`;
              const notifiedIds: string[] = [];
              for (const sub of eligible) {
                try {
                  await sendPriceDropEmail(sub.email, product.name, oldEffectivePrice, newEffectivePrice, productUrl, (product as any).imageUrl || undefined);
                  notifiedIds.push(sub.id);
                  logInfo(`[PriceDrop] Email sent to ${sub.email}`);
                } catch (e) {
                  logError(`[PriceDrop] Failed to send email to ${sub.email}:`, e);
                }
              }
              if (notifiedIds.length > 0) {
                await storage.markPriceDropSubscriptionsNotified(notifiedIds, newEffectivePrice);
                logInfo(`[PriceDrop] Notified ${notifiedIds.length} subscribers for product ${id}`);
              }
            } catch (e) {
              logError("[PriceDrop] Notification error:", e);
            }
          })();
        }
      }
      
      logInfo(`[Admin] Updated product ${id}: ${updated?.name}`);
      res.json({ success: true, product: updated });
    } catch (error) {
      logError("[Admin] Error updating product:", error);
      res.status(500).json({ error: "Failed to update product" });
    }
  });

  // Upload product image (admin only)
  app.post("/api/admin/products/:id/images", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const rawId = req.params.id;
      const id = parseInt(rawId);
      const isNewProduct = rawId === "new" || isNaN(id);

      if (!isNewProduct) {
        const product = await storage.getProduct(id);
        if (!product) {
          return res.status(404).json({ error: "Product not found" });
        }
      }
      
      // Expect base64 image data in body
      const { imageData, filename, index } = req.body;
      if (!imageData) {
        return res.status(400).json({ error: "Missing imageData" });
      }
      
      // Convert base64 to buffer
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Convert to WebP using sharp
      const sharp = await import('sharp');
      const webpBuffer = await sharp.default(buffer)
        .resize(2000, 2600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 92 })
        .toBuffer();
      
      // Generate unique filename
      const timestamp = Date.now();
      const fileId = isNewProduct ? `new_${timestamp}` : id;
      const safeFilename = `admin_${fileId}_${index || 0}_${timestamp}.webp`;
      
      // Upload to S3
      const url = await uploadToYandexStorage(webpBuffer, safeFilename, 'image/webp');
      
      if (!url) {
        return res.status(500).json({ error: "Failed to upload image to storage" });
      }
      
      // Also generate and upload thumbnail (used in product cards)
      const thumbBuffer = await sharp.default(buffer)
        .resize(800, null, { withoutEnlargement: true, kernel: 'lanczos3' })
        .sharpen()
        .webp({ quality: 88 })
        .toBuffer();
      const thumbFilename = safeFilename.replace('.webp', '_thumb.webp');
      await uploadToYandexStorage(thumbBuffer, thumbFilename, 'image/webp');
      
      logInfo(`[Admin] Uploaded image for product ${rawId}: ${url}`);
      res.json({ success: true, url, thumbnailUrl: url.replace('.webp', '_thumb.webp') });
    } catch (error) {
      logError("[Admin] Error uploading image:", error);
      res.status(500).json({ error: "Failed to upload image" });
    }
  });

  // Get single product for editing (admin only)
  app.get("/api/admin/products/:id", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const id = parseInt(req.params.id);
      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      logError("[Admin] Error getting product:", error);
      res.status(500).json({ error: "Failed to get product" });
    }
  });
}

// Admin product delete routes (single + delete-all) extracted from routes.ts verbatim.
export function registerAdminProductDeleteRoutes(
  app: Express,
  getAdminKey: () => string | undefined
) {
  // Admin API - Delete single product
  app.delete("/api/admin/products/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      logError("[Admin] SYNC_API_KEY not configured");
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }
      
      // Capture slug BEFORE deletion so we can record it for HTTP 410
      const { getCachedProductSlugById } = await import("../storage");
      const slugToRecord = getCachedProductSlugById(id);

      const success = await storage.deleteProduct(id);
      if (success) {
        logInfo(`[Admin] Deleted product ${id}`);
        // Fire-and-forget: record slug so bots get 410 instead of 200 for this URL
        if (slugToRecord) storage.addDeletedProductSlug(slugToRecord).catch(() => {});
        res.json({ success: true, message: `Product ${id} deleted` });
      } else {
        res.status(404).json({ success: false, message: "Product not found" });
      }
    } catch (err) {
      logError("[Admin] Delete product error:", err);
      res.status(500).json({ success: false, message: "Delete failed" });
    }
  });

  // Admin API - Delete all products
  app.delete("/api/admin/products", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      logError("[Admin] SYNC_API_KEY not configured");
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const count = await storage.deleteAllProducts();
      logInfo(`[Admin] Deleted all products (${count} items)`);
      res.json({ success: true, message: `Deleted ${count} products`, count });
    } catch (err) {
      logError("[Admin] Delete all products error:", err);
      res.status(500).json({ success: false, message: "Delete failed" });
    }
  });
}
