import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import express from "express";
import path from "path";
import fs from "fs";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { uploadToYandexStorage, downloadFromYandexStorage, listObjectsFromYandexStorage, downloadBinaryFromYandexStorage, deleteFromYandexStorage } from "./lib/storage-s3";
import sharp from "sharp";

// Cache for Object Storage URLs (local path -> Object Storage URL)
const imageUrlCache: Map<string, string> = new Map();

// Helper to get image URL (Object Storage or fallback) - uses original format
function getImageUrl(imgPath: string | null): string {
  const fallback = "/attached_assets/generated_images/oversized_black_t-shirt_streetwear.png";
  if (!imgPath) return fallback;
  
  // Check cache first
  const cachedUrl = imageUrlCache.get(imgPath);
  if (cachedUrl) return cachedUrl;
  
  // Construct Object Storage URL if bucket is configured
  const bucket = process.env.YANDEX_STORAGE_BUCKET_NAME;
  if (bucket) {
    // Keep original path structure and extension (import_files/XX/file.jpg)
    const cleanPath = imgPath.replace(/\\/g, '/');
    return `https://storage.yandexcloud.net/${bucket}/products/${cleanPath}`;
  }
  
  // Fallback to local path (won't work in production)
  return `/api/1c-images/${imgPath}`;
}

// Background sync every 30 minutes
const SYNC_INTERVAL = 30 * 60 * 1000;
let isSyncing = false;

async function runAutoSync() {
  if (isSyncing) return;
  isSyncing = true;
  console.log("[1C] Background auto-sync check...");
  try {
    const uploadDir = path.resolve(process.cwd(), "1c_uploads");
    if (!fs.existsSync(uploadDir)) return;

    const files = fs.readdirSync(uploadDir);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

    for (const filename of files) {
      if (filename === "import.xml" || filename === "offers.xml") {
        const filePath = path.join(uploadDir, filename);
        const xmlData = fs.readFileSync(filePath, "utf-8");
        const result = parser.parse(xmlData);
        
        if (filename === "import.xml") {
          const items = result?.["КоммерческаяИнформация"]?.["Каталог"]?.["Товары"]?.["Товар"];
          if (items) {
            const productsArray = Array.isArray(items) ? items : [items];
            for (const item of productsArray) {
              const externalId = item["Ид"];
              const name = item["Наименование"];
              const description = item["Описание"] || "";
              const sku = item["Артикул"] || "";
              
              let sizes: string[] = [];
              let colors: string[] = [];
              if (item["ЗначенияРеквизитов"]?.["ЗначениеРеквизита"]) {
                 const props = Array.isArray(item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]) 
                   ? item["ЗначенияРеквизитов"]["ЗначениеРеквизита"] 
                   : [item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]];
                 for (const prop of props) {
                   if (prop["Наименование"] === "Размер") sizes.push(prop["Значение"]);
                   if (prop["Наименование"] === "Цвет") colors.push(prop["Значение"]);
                 }
              }

              const imgPath = Array.isArray(item["Картинка"]) ? item["Картинка"][0] : (typeof item["Картинка"] === 'string' ? item["Картинка"] : null);
              const imageUrl = getImageUrl(imgPath);

              const existing = await storage.getProductByExternalId(externalId);
              if (!existing) {
                const existingBySku = sku ? await storage.getProductBySku(sku) : null;
                if (existingBySku) {
                  await storage.updateProduct(existingBySku.id, { externalId, name, description, imageUrl, sizes, colors });
                } else {
                  await storage.createProduct({
                    externalId,
                    name,
                    sku,
                    description,
                    price: 0,
                    imageUrl,
                    category: "1C Import",
                    sizes,
                    colors,
                    isNew: true
                  });
                }
              } else {
                await storage.updateProduct(existing.id, { name, description, sku, imageUrl, sizes, colors });
              }
            }
          }
        } else if (filename === "offers.xml") {
          const offers = result?.["КоммерческаяИнформация"]?.["ПакетПредложений"]?.["Предложения"]?.["Предложение"];
          if (offers) {
            const offerList = Array.isArray(offers) ? offers : [offers];
            for (const offer of offerList) {
              const externalId = offer["Ид"];
              let priceVal = offer["Цены"]?.["Цена"]?.["ЦенаЗаЕдиницу"];
              if (!priceVal && Array.isArray(offer["Цены"]?.["Цена"])) {
                priceVal = offer["Цены"]["Цена"][0]["ЦенаЗаЕдиницу"];
              }
              if (externalId && priceVal) {
                const existing = await storage.getProductByExternalId(externalId);
                if (existing) {
                  const price = Math.round(parseFloat(String(priceVal).replace(',', '.')) * 100);
                  await storage.updateProduct(existing.id, { price });
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("[1C] Background sync error:", e);
  } finally {
    isSyncing = false;
  }
}

// Start auto-sync interval
setInterval(runAutoSync, SYNC_INTERVAL);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // 1C CommerceML Exchange (Standard Protocol)
  app.all("/api/1c-exchange", async (req, res, next) => {
    console.log(`[1C DEBUG] Request: ${req.method} ${req.url}`);
    console.log(`[1C DEBUG] Headers: ${JSON.stringify(req.headers)}`);
    console.log(`[1C DEBUG] Query: ${JSON.stringify(req.query)}`);
    
    const { type, mode, filename } = req.query;
    const auth = req.headers.authorization;
    const expectedAuth = "Basic " + Buffer.from("admin:bmg-secret-123").toString("base64");

    if (auth !== expectedAuth) {
      console.log("[1C DEBUG] Auth failed or missing");
      res.set("WWW-Authenticate", 'Basic realm="1C Exchange"');
      return res.status(401).send("failure\nUnauthorized");
    }
    
    // Continue to specific handlers or handle simple GETs here
    if (req.method === "GET") {
      if (type === "catalog" && mode === "checkauth") {
        return res.send("success\nPHPSESSID\nreplit-session-id");
      }
      if (type === "catalog" && mode === "init") {
        return res.send("zip=no\nfile_limit=104857600");
      }
      if (type === "sale" && mode === "checkauth") {
        return res.send("success\nPHPSESSID\nreplit-session-id");
      }
      if (type === "sale" && mode === "init") {
        return res.send("zip=no\nfile_limit=104857600");
      }
      if (type === "sale" && mode === "query") {
        try {
          const orders = await storage.getOrders(); // You'll need to implement this in storage
          const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_" });
          
          const xmlObj = {
            "КоммерческаяИнформация": {
              "@_ВерсияСхемы": "2.03",
              "@_ДатаФормирования": new Date().toISOString().split('T')[0],
              "Документ": orders.map(order => ({
                "Ид": order.id.toString(),
                "Номер": `SITE-${order.id}`,
                "Дата": new Date(order.createdAt || Date.now()).toISOString().split('T')[0],
                "ХозОперация": "Заказ товара",
                "Роль": "Продавец",
                "Валюта": "руб",
                "Курс": "1",
                "Сумма": (order.total / 100).toString(),
                "Контрагенты": {
                  "Контрагент": {
                    "Наименование": order.customerName,
                    "Роль": "Покупатель",
                    "ПолноеНаименование": order.customerName,
                    "Адрес": { "Представление": order.address },
                    "Контакты": {
                      "Контакт": [
                        { "Тип": "ТелефонРабочий", "Значение": order.customerPhone },
                        { "Тип": "Почта", "Значение": order.customerEmail }
                      ]
                    }
                  }
                },
                "Товары": {
                  "Товар": order.items.map((item: any) => ({
                    "Ид": item.productExternalId,
                    "Наименование": item.productName,
                    "ЦенаЗаЕдиницу": (item.price / 100).toString(),
                    "Количество": item.quantity.toString(),
                    "Сумма": ((item.price * item.quantity) / 100).toString()
                  }))
                }
              }))
            }
          };
          
          const xmlData = builder.build(xmlObj);
          res.set("Content-Type", "application/xml");
          return res.send(xmlData);
        } catch (e) {
          console.error("[1C] Order export error:", e);
          return res.status(500).send("failure");
        }
      }
      if (type === "sale" && mode === "success") {
        return res.send("success");
      }
      if (type === "catalog" && mode === "import") {
      const uploadPath = path.resolve(process.cwd(), "1c_uploads", filename as string);
      console.log(`[1C] GET Import command received. Filename: ${filename}. Reading from: ${uploadPath}`);
      
      if (fs.existsSync(uploadPath)) {
        const xmlData = fs.readFileSync(uploadPath, "utf-8");
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: "@_"
        });
        
        try {
          const result = parser.parse(xmlData);
          console.log(`[1C] Manually triggering parse for ${filename}`);
          
          // Handle Products
          if (result?.["КоммерческаяИнформация"]?.["Каталог"]?.["Товары"]?.["Товар"]) {
            const items = result["КоммерческаяИнформация"]["Каталог"]["Товары"]["Товар"];
            const productsArray = Array.isArray(items) ? items : [items];
            for (const item of productsArray) {
              const externalId = item["Ид"];
              const name = item["Наименование"];
              const description = item["Описание"] || "";
              const sku = item["Артикул"] || "";
              
              // Extract sizes and colors from properties if available
              let sizes: string[] = [];
              let colors: string[] = [];
              if (item["ЗначенияРеквизитов"]?.["ЗначениеРеквизита"]) {
                 const props = Array.isArray(item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]) 
                   ? item["ЗначенияРеквизитов"]["ЗначениеРеквизита"] 
                   : [item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]];
                 for (const prop of props) {
                   if (prop["Наименование"] === "Размер") sizes.push(prop["Значение"]);
                   if (prop["Наименование"] === "Цвет") colors.push(prop["Значение"]);
                 }
              }

              const imgPath = Array.isArray(item["Картинка"]) ? item["Картинка"][0] : (typeof item["Картинка"] === 'string' ? item["Картинка"] : null);
              const imageUrl = getImageUrl(imgPath);
              
              const existing = await storage.getProductByExternalId(externalId);
              if (!existing) {
                // Check if SKU exists to avoid duplicate key error
                const existingBySku = sku ? await storage.getProductBySku(sku) : null;
                if (existingBySku) {
                  console.log(`[1C] SKU ${sku} already exists for product ${existingBySku.id}, updating by SKU instead`);
                  await storage.updateProduct(existingBySku.id, { externalId, name, description, imageUrl, sizes, colors });
                } else {
                  await storage.createProduct({ externalId, sku, name, description, price: 0, imageUrl, category: "1C Import", sizes, colors, isNew: true });
                }
              } else {
                await storage.updateProduct(existing.id, { name, description, sku, imageUrl, sizes, colors });
              }
            }
          }

          // Handle Offers (Prices)
          if (result?.["КоммерческаяИнформация"]?.["ПакетПредложений"]?.["Предложения"]?.["Предложение"]) {
            const offers = result["КоммерческаяИнформация"]["ПакетПредложений"]["Предложения"]["Предложение"];
            const offersArray = Array.isArray(offers) ? offers : [offers];
            for (const offer of offersArray) {
              const externalId = offer["Ид"];
              // 1C often uses Price structure: Цены -> Цена -> ЦенаЗаЕдиницу
              let priceVal = offer["Цены"]?.["Цена"]?.["ЦенаЗаЕдиницу"];
              
              // If nested differently
              if (!priceVal && Array.isArray(offer["Цены"]?.["Цена"])) {
                priceVal = offer["Цены"]["Цена"][0]["ЦенаЗаЕдиницу"];
              }

              if (externalId && priceVal) {
                const existing = await storage.getProductByExternalId(externalId);
                if (existing) {
                  const priceString = String(priceVal).replace(',', '.');
                  // 1C prices are usually in rubles. We store them in cents.
                  const price = Math.round(parseFloat(priceString) * 100);
                  await storage.updateProduct(existing.id, { price });
                }
              }
            }
          }
        } catch (e) {
          console.error(`[1C] Manual parse error for ${filename}:`, e);
        }
      }
      return res.send("success");
    }
      if (type === "sale" && mode === "checkauth") {
        return res.send("success\nPHPSESSID\nreplit-session-id");
      }
      if (type === "sale" && mode === "init") {
        return res.send("zip=no\nfile_limit=104857600");
      }
      if (type === "sale" && mode === "query") {
        console.log("[1C] Sale query received. Fetching pending orders...");
        const orders = await storage.getOrdersByStatus("pending");
        
        // Generate CommerceML XML for orders
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<КоммерческаяИнформация ВерсияСхемы="2.04" ДатаФормирования="' + new Date().toISOString() + '">\n';
        
        for (const order of orders) {
          xml += '  <Документ>\n';
          xml += `    <Ид>${order.id}</Ид>\n`;
          xml += `    <Номер>${order.id}</Номер>\n`;
          xml += `    <Дата>${new Date(order.createdAt || Date.now()).toISOString().split('T')[0]}</Дата>\n`;
          xml += `    <ХозОперация>Заказ товара</ХозОперация>\n`;
          xml += `    <Роль>Продавец</Роль>\n`;
          xml += `    <Валюта>RUB</Валюта>\n`;
          xml += `    <Курс>1</Курс>\n`;
          xml += `    <Сумма>${order.total / 100}</Сумма>\n`;
          xml += `    <Контрагенты>\n`;
          xml += `      <Контрагент>\n`;
          xml += `        <Ид>${order.customerEmail}</Ид>\n`;
          xml += `        <Наименование>${order.customerName}</Наименование>\n`;
          xml += `        <Роль>Покупатель</Роль>\n`;
          xml += `        <ПолноеНаименование>${order.customerName}</ПолноеНаименование>\n`;
          xml += `      </Контрагент>\n`;
          xml += `    </Контрагенты>\n`;
          xml += `    <Товары>\n`;
          
          const items = order.items as any[];
          for (const item of items) {
            xml += `      <Товар>\n`;
            xml += `        <Ид>${item.productId}</Ид>\n`;
            xml += `        <Наименование>${item.name}</Наименование>\n`;
            xml += `        <ЦенаЗаЕдиницу>${item.price / 100}</ЦенаЗаЕдиницу>\n`;
            xml += `        <Количество>${item.quantity}</Количество>\n`;
            xml += `        <Сумма>${(item.price * item.quantity) / 100}</Сумма>\n`;
            xml += `      </Товар>\n`;
          }
          
          xml += `    </Товары>\n`;
          xml += '  </Документ>\n';
        }
        
        xml += '</КоммерческаяИнформация>';
        
        res.set("Content-Type", "application/xml; charset=utf-8");
        return res.send(xml);
      }
    }
    
    // For POST requests with body, let the next handler take over or handle here
    if (req.method === "POST") {
      if (type === "catalog" && (mode === "file" || mode === "import")) {
        return next();
      }
      if (type === "sale" && mode === "success") {
        console.log("[1C] Sale exchange finished successfully");
        return res.send("success");
      }
    }

    res.send("success");
  });

  // Sync products from Object Storage (for production where 1c_uploads is not available)
  app.post("/api/sync-from-storage", async (req, res) => {
    console.log("[Sync] Starting sync from Object Storage...");
    
    try {
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
      
      // Download import.xml from Object Storage
      const importXml = await downloadFromYandexStorage("products/import.xml");
      if (!importXml) {
        return res.status(404).json({ error: "import.xml not found in Object Storage" });
      }
      
      console.log("[Sync] Downloaded import.xml, parsing...");
      const importResult = parser.parse(importXml);
      
      let productsCreated = 0;
      let productsUpdated = 0;
      
      // Parse products from import.xml
      const items = importResult?.["КоммерческаяИнформация"]?.["Каталог"]?.["Товары"]?.["Товар"];
      if (items) {
        const productsArray = Array.isArray(items) ? items : [items];
        console.log(`[Sync] Found ${productsArray.length} products in import.xml`);
        
        for (const item of productsArray) {
          const externalId = item["Ид"];
          const name = item["Наименование"];
          const description = item["Описание"] || "";
          const sku = item["Артикул"] || "";
          
          let sizes: string[] = [];
          let colors: string[] = [];
          if (item["ЗначенияРеквизитов"]?.["ЗначениеРеквизита"]) {
            const props = Array.isArray(item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]) 
              ? item["ЗначенияРеквизитов"]["ЗначениеРеквизита"] 
              : [item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]];
            for (const prop of props) {
              const propName = prop["Наименование"];
              const propValue = prop["Значение"];
              if (propName === "Размер" && propValue) sizes.push(propValue);
              if (propName === "Цвет" && propValue) colors.push(propValue);
            }
          }
          
          const imgPath = Array.isArray(item["Картинка"]) ? item["Картинка"][0] : (typeof item["Картинка"] === 'string' ? item["Картинка"] : null);
          const imageUrl = getImageUrl(imgPath);
          
          try {
            const existing = await storage.getProductByExternalId(externalId);
            if (!existing) {
              const existingBySku = sku ? await storage.getProductBySku(sku) : null;
              if (existingBySku) {
                await storage.updateProduct(existingBySku.id, { externalId, name, description, imageUrl, sizes, colors });
                productsUpdated++;
              } else {
                await storage.createProduct({
                  externalId,
                  sku,
                  name,
                  description,
                  price: 0,
                  imageUrl,
                  category: "1C Import",
                  sizes,
                  colors,
                  isNew: true
                });
                productsCreated++;
              }
            } else {
              await storage.updateProduct(existing.id, { name, description, sku, imageUrl, sizes, colors });
              productsUpdated++;
            }
          } catch (err: any) {
            console.error(`[Sync] Failed to save product ${name}:`, err.message);
          }
        }
      }
      
      // Download and parse offers.xml for prices
      console.log("[Sync] Attempting to download offers.xml from products/offers.xml...");
      const offersXml = await downloadFromYandexStorage("products/offers.xml");
      console.log(`[Sync] offers.xml download result: ${offersXml ? `${offersXml.length} bytes` : 'NOT FOUND'}`);
      
      if (offersXml) {
        console.log("[Sync] Downloaded offers.xml, parsing prices...");
        const offersResult = parser.parse(offersXml);
        
        const offers = offersResult?.["КоммерческаяИнформация"]?.["ПакетПредложений"]?.["Предложения"]?.["Предложение"];
        if (offers) {
          const offersArray = Array.isArray(offers) ? offers : [offers];
          console.log(`[Sync] Found ${offersArray.length} price offers`);
          
          let pricesUpdated = 0;
          let notFound = 0;
          for (const offer of offersArray) {
            const offerId = offer["Ид"];
            const externalId = offerId?.split("#")[0] || offerId;
            
            const prices = offer["Цены"]?.["Цена"];
            let price = 0;
            if (prices) {
              const priceArr = Array.isArray(prices) ? prices : [prices];
              const mainPrice = priceArr[0];
              price = Math.round(parseFloat(mainPrice["ЦенаЗаЕдиницу"] || 0) * 100);
            }
            
            if (externalId && price > 0) {
              const product = await storage.getProductByExternalId(externalId);
              if (product) {
                console.log(`[Sync] Updating price: ${product.name} -> ${price / 100} RUB (id: ${product.id}, extId: ${externalId})`);
                try {
                  await storage.updateProduct(product.id, { price });
                  pricesUpdated++;
                } catch (err: any) {
                  console.error(`[Sync] Failed to update price for ${product.name}:`, err.message);
                }
              } else {
                notFound++;
                if (notFound <= 5) console.log(`[Sync] Product not found for offer: ${externalId}`);
              }
            }
          }
          console.log(`[Sync] Prices: ${pricesUpdated} updated, ${notFound} not found`);
        } else {
          console.log("[Sync] WARNING: offers.xml parsed but no Предложение entries found");
        }
      } else {
        console.log("[Sync] WARNING: offers.xml NOT FOUND in Object Storage at products/offers.xml");
        console.log("[Sync] Prices will NOT be updated. Please upload offers.xml to Object Storage.");
      }
      
      console.log(`[Sync] Complete: ${productsCreated} created, ${productsUpdated} updated`);
      res.json({ 
        success: true, 
        message: `Synced from Object Storage: ${productsCreated} created, ${productsUpdated} updated` 
      });
      
    } catch (error) {
      console.error("[Sync] Error:", error);
      res.status(500).json({ error: "Sync failed", details: String(error) });
    }
  });

  // Convert existing images in Object Storage to WebP format
  // Use ?limit=20 to process in batches (default 20, max 50)
  app.post("/api/convert-images-to-webp", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      console.log(`[WebP] Starting image conversion (limit: ${limit})...`);
      
      // List all images in products folder
      const allKeys = await listObjectsFromYandexStorage("products/import_files/");
      const allWebpKeys = new Set(allKeys.filter(key => /\.webp$/i.test(key)));
      
      // Only process images that don't have a WebP version yet
      const imageKeys = allKeys
        .filter(key => /\.(jpg|jpeg|png)$/i.test(key))
        .filter(key => {
          const webpKey = key.replace(/\.(jpg|jpeg|png)$/i, '.webp');
          return !allWebpKeys.has(webpKey);
        })
        .slice(0, limit);
      
      const totalRemaining = allKeys.filter(key => /\.(jpg|jpeg|png)$/i.test(key)).filter(key => {
        const webpKey = key.replace(/\.(jpg|jpeg|png)$/i, '.webp');
        return !allWebpKeys.has(webpKey);
      }).length;
      
      console.log(`[WebP] Found ${totalRemaining} images needing conversion, processing ${imageKeys.length}`);
      
      let converted = 0;
      let failed = 0;
      
      for (const key of imageKeys) {
        try {
          const webpKey = key.replace(/\.(jpg|jpeg|png)$/i, '.webp');
          
          // Download original image
          const imageBuffer = await downloadBinaryFromYandexStorage(key);
          if (!imageBuffer) {
            console.log(`[WebP] Could not download: ${key}`);
            failed++;
            continue;
          }
          
          // Convert to WebP
          const webpBuffer = await sharp(imageBuffer)
            .webp({ quality: 85 })
            .toBuffer();
          
          // Upload WebP version
          const webpFilename = webpKey.replace('products/', '');
          await uploadToYandexStorage(webpBuffer, webpFilename, 'image/webp');
          
          console.log(`[WebP] Converted: ${key} -> ${webpKey}`);
          converted++;
          
        } catch (err: any) {
          console.error(`[WebP] Failed to convert ${key}:`, err.message);
          failed++;
        }
      }
      
      const remaining = totalRemaining - converted;
      console.log(`[WebP] Batch complete: ${converted} converted, ${failed} failed, ${remaining} remaining`);
      res.json({
        success: true,
        message: `Converted ${converted} images to WebP`,
        details: { converted, failed, remaining, hint: remaining > 0 ? "Run again to convert more" : "All done!" }
      });
      
    } catch (error) {
      console.error("[WebP] Error:", error);
      res.status(500).json({ error: "Conversion failed", details: String(error) });
    }
  });

  // Update product image URLs to use WebP versions
  app.post("/api/update-images-to-webp", async (req, res) => {
    try {
      console.log("[WebP URLs] Updating product image URLs to WebP...");
      
      const products = await storage.getProducts();
      let updated = 0;
      
      for (const product of products) {
        // Check if image URL ends with jpg/jpeg/png
        if (product.imageUrl && /\.(jpg|jpeg|png)$/i.test(product.imageUrl)) {
          const webpUrl = product.imageUrl.replace(/\.(jpg|jpeg|png)$/i, '.webp');
          
          await storage.updateProduct(product.id, { 
            imageUrl: webpUrl 
          } as any);
          
          console.log(`[WebP URLs] Updated: ${product.name} -> ${webpUrl}`);
          updated++;
        }
      }
      
      console.log(`[WebP URLs] Complete: ${updated} products updated`);
      res.json({
        success: true,
        message: `Updated ${updated} product image URLs to WebP`,
        details: { updated, total: products.length }
      });
      
    } catch (error) {
      console.error("[WebP URLs] Error:", error);
      res.status(500).json({ error: "Update failed", details: String(error) });
    }
  });

  app.post("/api/1c-exchange", express.raw({ type: "*/*", limit: "500mb" }), async (req, res) => {
    const { type, mode, filename } = req.query;
    
    if (type === "catalog" && mode === "file") {
      const filenameStr = filename as string;
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(filenameStr);
      
      // Upload images to Object Storage (convert to WebP for better compression)
      if (isImage && process.env.YANDEX_STORAGE_BUCKET_NAME) {
        try {
          // Convert to WebP format for better compression (except GIF which may be animated)
          const isGif = filenameStr.toLowerCase().endsWith('.gif');
          let imageBuffer: Buffer;
          let contentType: string;
          let finalFilename: string;
          
          if (isGif) {
            imageBuffer = req.body;
            contentType = 'image/gif';
            finalFilename = filenameStr.replace(/[\/\\]/g, '_');
          } else {
            // Convert to WebP
            imageBuffer = await sharp(req.body)
              .webp({ quality: 85 })
              .toBuffer();
            contentType = 'image/webp';
            // Change extension to .webp
            finalFilename = filenameStr.replace(/[\/\\]/g, '_').replace(/\.(jpg|jpeg|png)$/i, '.webp');
          }
          
          const s3Url = await uploadToYandexStorage(imageBuffer, finalFilename, contentType);
          if (s3Url) {
            imageUrlCache.set(filenameStr, s3Url);
            console.log(`[1C] Uploaded image to Object Storage (WebP): ${filenameStr} -> ${s3Url}`);
          }
          return res.send("success");
        } catch (err) {
          console.error(`[1C] Failed to upload to Object Storage ${filenameStr}:`, err);
          return res.send("failure\nError uploading to storage");
        }
      }
      
      // For XML files, save locally temporarily for parsing
      const uploadPath = path.resolve(process.cwd(), "1c_uploads", filenameStr);
      const dir = path.dirname(uploadPath);
      
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(uploadPath, req.body);
        console.log(`[1C] Saved file: ${filenameStr}`);
        return res.send("success");
      } catch (err) {
        console.error(`[1C] Failed to save file ${filenameStr}:`, err);
        return res.send("failure\nError saving file");
      }
    }
    
    if (type === "catalog" && mode === "import") {
      const xmlData = req.body.toString();
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
      });
      
      try {
        const result = parser.parse(xmlData);
        console.log(`[1C] Parsing XML for mode=import, filename: ${filename}`);
        
        // Basic CommerceML parsing logic
        const catalog = result?.["КоммерческаяИнформация"]?.["Классификатор"] || result?.["КоммерческаяИнформация"]?.["ПакетПредложений"];
        
        // Handle Products
        if (result?.["КоммерческаяИнформация"]?.["Каталог"]?.["Товары"]?.["Товар"]) {
          const items = result["КоммерческаяИнформация"]["Каталог"]["Товары"]["Товар"];
          const productsArray = Array.isArray(items) ? items : [items];
          
          for (const item of productsArray) {
            const externalId = item["Ид"];
            const name = item["Наименование"];
            const description = item["Описание"] || "";
            const sku = item["Артикул"] || "";
            const categoryName = "1C Import"; // We can refine this if we parse groups
            
            // Extract sizes and colors from properties if available
            let sizes: string[] = [];
            let colors: string[] = [];
            if (item["ЗначенияРеквизитов"]?.["ЗначениеРеквизита"]) {
               const props = Array.isArray(item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]) 
                 ? item["ЗначенияРеквизитов"]["ЗначениеРеквизита"] 
                 : [item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]];
               for (const prop of props) {
                 if (prop["Наименование"] === "Размер") sizes.push(prop["Значение"]);
                 if (prop["Наименование"] === "Цвет") colors.push(prop["Значение"]);
               }
            }

            // Image parsing - use Object Storage URL
            const imgPath = Array.isArray(item["Картинка"]) ? item["Картинка"][0] : item["Картинка"];
            const imageUrl = getImageUrl(imgPath);
            
            const existing = await storage.getProductByExternalId(externalId);
            if (!existing) {
              // Check if SKU exists to avoid duplicate key error
              const existingBySku = sku ? await storage.getProductBySku(sku) : null;
              if (existingBySku) {
                console.log(`[1C] SKU ${sku} already exists for product ${existingBySku.id}, updating by SKU instead`);
                await storage.updateProduct(existingBySku.id, { externalId, name, description, imageUrl, sizes, colors });
              } else {
                console.log(`[1C] Creating new product: ${name} (${externalId})`);
                await storage.createProduct({
                  externalId,
                  sku,
                  name,
                  description,
                  price: 0,
                  imageUrl,
                  category: categoryName,
                  sizes,
                  colors,
                  isNew: true
                });
              }
            } else {
              console.log(`[1C] Updating existing product: ${name} (${externalId})`);
              await storage.updateProduct(existing.id, { name, description, sku, imageUrl, sizes, colors });
            }
          }
        }

        // Handle Offers (Prices)
        if (result?.["КоммерческаяИнформация"]?.["ПакетПредложений"]?.["Предложения"]?.["Предложение"]) {
          const offers = result["КоммерческаяИнформация"]["ПакетПредложений"]["Предложения"]["Предложение"];
          const offersArray = Array.isArray(offers) ? offers : [offers];
          
          for (const offer of offersArray) {
            const externalId = offer["Ид"];
            let priceVal = offer["Цены"]?.["Цена"]?.["ЦенаЗаЕдиницу"];
            
            // If nested differently
            if (!priceVal && Array.isArray(offer["Цены"]?.["Цена"])) {
              priceVal = offer["Цены"]["Цена"][0]["ЦенаЗаЕдиницу"];
            }

            if (externalId && priceVal) {
              const existing = await storage.getProductByExternalId(externalId);
              if (existing) {
                const priceString = String(priceVal).replace(',', '.');
                // 1C prices are usually in rubles. We store them in cents.
                const price = Math.round(parseFloat(priceString) * 100);
                await storage.updateProduct(existing.id, { price });
              }
            }
          }
        }
        
        console.log("[1C] Import successful");
        return res.send("success");
      } catch (err) {
        console.error("[1C] Import failed:", err);
        return res.send("failure\nError parsing XML");
      }
    }
    
    res.send("success");
  });

  // Serve 1C images
  app.get("/api/1c-images/*", (req, res) => {
    const filePath = req.params[0];
    const fullPath = path.resolve(process.cwd(), "1c_uploads", filePath);
    if (fs.existsSync(fullPath)) {
      res.sendFile(fullPath);
    } else {
      res.status(404).send("Image not found");
    }
  });

  // Serve attached assets
  app.use("/attached_assets", express.static(path.resolve(process.cwd(), "attached_assets")));

  // Products
  app.get(api.products.list.path, async (req, res) => {
    const products = await storage.getProducts();
    res.json(products);
  });

  app.get(api.products.get.path, async (req, res) => {
    const product = await storage.getProduct(Number(req.params.id));
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(product);
  });

  // 1C Sync API
  app.post("/api/sync/products", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.SYNC_API_KEY || "bmg-secret-key-123";

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const items = z.array(z.object({
        externalId: z.string(),
        sku: z.string().optional(),
        name: z.string(),
        description: z.string(),
        price: z.number(),
        imageUrl: z.string(),
        category: z.string(),
        sizes: z.array(z.string()),
        colors: z.array(z.string()),
        isNew: z.boolean().optional()
      })).parse(req.body);

      const results = [];
      for (const item of items) {
        const existing = await storage.getProductByExternalId(item.externalId);
        if (existing) {
          const updated = await storage.updateProduct(existing.id, item);
          results.push({ id: updated.id, status: "updated" });
        } else {
          const created = await storage.createProduct(item as any);
          results.push({ id: created.id, status: "created" });
        }
      }

      res.json({ success: true, results });
    } catch (err) {
      res.status(400).json({ message: "Invalid data format" });
    }
  });

  app.get("/api/sync/orders", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.SYNC_API_KEY || "bmg-secret-key-123";

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const orders = await storage.getOrdersByStatus("pending");
    res.json(orders);
  });

  app.patch("/api/sync/orders/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.SYNC_API_KEY || "bmg-secret-key-123";

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const { status } = z.object({ status: z.string() }).parse(req.body);
      const order = await storage.updateOrderStatus(Number(req.params.id), status);
      res.json(order);
    } catch (err) {
      res.status(400).json({ message: "Invalid data" });
    }
  });

  // 1C Inventory Sync API (Update stock only)
  app.post("/api/sync/inventory", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.SYNC_API_KEY || "bmg-secret-key-123";

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const updates = z.array(z.object({
        externalId: z.string(),
        price: z.number().optional(),
        sizes: z.array(z.string()).optional()
      })).parse(req.body);

      const results = [];
      for (const update of updates) {
        const existing = await storage.getProductByExternalId(update.externalId);
        if (existing) {
          const updated = await storage.updateProduct(existing.id, update);
          results.push({ id: updated.id, status: "updated" });
        } else {
          results.push({ externalId: update.externalId, status: "not_found" });
        }
      }

      res.json({ success: true, results });
    } catch (err) {
      res.status(400).json({ message: "Invalid data format" });
    }
  });

  app.post(api.products.create.path, async (req, res) => {
    try {
      const input = api.products.create.input.parse(req.body);
      const product = await storage.createProduct(input);
      res.status(201).json(product);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Cart
  app.get(api.cart.list.path, async (req, res) => {
    const items = await storage.getCartItems(req.params.sessionId);
    res.json(items);
  });

  app.post(api.cart.addItem.path, async (req, res) => {
    try {
      const input = api.cart.addItem.input.parse(req.body);
      const item = await storage.addToCart(input);
      res.json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.cart.removeItem.path, async (req, res) => {
    // For YDB we need composite key: sessionId, productId, size, color
    const { sessionId, productId, size, color } = req.query;
    await storage.removeFromCart(
      Number(req.params.id),
      sessionId as string,
      Number(productId),
      size as string,
      color as string
    );
    res.status(200).send();
  });
  
  app.delete(api.cart.clear.path, async (req, res) => {
      await storage.clearCart(req.params.sessionId);
      res.status(200).send();
  });

  // Orders
  app.post(api.orders.create.path, async (req, res) => {
    try {
      const input = api.orders.create.input.parse(req.body);
      
      // Calculate total and get items from cart
      const cartItems = await storage.getCartItems(input.sessionId);
      if (cartItems.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      const total = cartItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
      
      const order = await storage.createOrder({
        ...input,
        total,
        items: cartItems.map(item => ({
            productId: item.productId,
            name: item.product.name,
            quantity: item.quantity,
            price: item.product.price,
            size: item.size,
            color: item.color
        }))
      });

      // Clear cart
      await storage.clearCart(input.sessionId);

      res.status(201).json(order);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Seed data
  if ((await storage.getProducts()).length === 0) {
    await runAutoSync();
    
    // If after 1C sync we still have no products (e.g. 1c_uploads is empty), add fallback samples
    if ((await storage.getProducts()).length === 0) {
      await storage.createProduct({
        name: "Футболка 'CHAOS'",
        description: "Оверсайз футболка с фирменным принтом CHAOS. 100% хлопок.",
        price: 3500,
        imageUrl: "/attached_assets/generated_images/oversized_black_t-shirt_streetwear.png",
        category: "Футболки",
        sizes: ["S", "M", "L", "XL"],
        colors: ["Черный", "Белый"],
        isNew: true
      });
      // ... other samples
    }
  }

  return httpServer;
}
