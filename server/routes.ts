import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import express from "express";
import path from "path";
import fs from "fs";

import { XMLParser } from "fast-xml-parser";

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
      if (type === "catalog" && mode === "import") {
        // According to CommerceML, import success should return "success"
        // but some 1C versions expect it on the first line.
        // We already return "success", but let's ensure it's clean.
        console.log(`[1C] GET Import command received. Filename: ${filename || "not specified"}`);
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
          xml += `        <Ид>${order.email}</Ид>\n`;
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

  app.post("/api/1c-exchange", express.raw({ type: "*/*", limit: "500mb" }), async (req, res) => {
    const { type, mode, filename } = req.query;
    
    if (type === "catalog" && mode === "file") {
      const uploadPath = path.resolve(import.meta.dirname, "..", "1c_uploads", filename as string);
      const dir = path.dirname(uploadPath);
      
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(uploadPath, req.body);
        console.log(`[1C] Saved file: ${filename}`);
        return res.send("success");
      } catch (err) {
        console.error(`[1C] Failed to save file ${filename}:`, err);
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
            
            const existing = await storage.getProductByExternalId(externalId);
            if (!existing) {
              await storage.createProduct({
                externalId,
                sku,
                name,
                description,
                price: 0,
                imageUrl: "/attached_assets/generated_images/oversized_black_t-shirt_streetwear.png",
                category: "1C Import",
                sizes: [],
                colors: [],
                isNew: true
              });
            } else {
              await storage.updateProduct(existing.id, { name, description, sku });
            }
          }
        }

        // Handle Offers (Prices)
        if (result?.["КоммерческаяИнформация"]?.["ПакетПредложений"]?.["Предложения"]?.["Предложение"]) {
          const offers = result["КоммерческаяИнформация"]["ПакетПредложений"]["Предложения"]["Предложение"];
          const offersArray = Array.isArray(offers) ? offers : [offers];
          
          for (const offer of offersArray) {
            const externalId = offer["Ид"];
            const priceVal = offer["Цены"]?.["Цена"]?.["ЦенаЗаЕдиницу"];
            
            if (externalId && priceVal) {
              const existing = await storage.getProductByExternalId(externalId);
              if (existing) {
                await storage.updateProduct(existing.id, { price: Math.round(parseFloat(priceVal) * 100) });
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

  // Serve attached assets
  app.use("/attached_assets", express.static(path.resolve(import.meta.dirname, "..", "attached_assets")));

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
    await storage.removeFromCart(Number(req.params.id));
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
    await storage.createProduct({
      name: "Худи 'NO FUTURE'",
      description: "Плотное худи с вышитыми деталями. База уличного стиля.",
      price: 6500,
      imageUrl: "/attached_assets/generated_images/heavyweight_black_hoodie_streetwear.png",
      category: "Худи",
      sizes: ["M", "L", "XL"],
      colors: ["Черный"],
      isNew: true
    });
     await storage.createProduct({
      name: "Брюки-карго 'TACTICAL'",
      description: "Функциональные брюки-карго с множеством карманов и стропами.",
      price: 5500,
      imageUrl: "/attached_assets/generated_images/black_cargo_pants_techwear.png",
      category: "Брюки",
      sizes: ["S", "M", "L"],
      colors: ["Черный", "Камуфляж"],
      isNew: false
    });
    await storage.createProduct({
      name: "Кепка 'BMG'",
      description: "Классический снэпбэк с 3D вышивкой.",
      price: 2000,
      imageUrl: "/attached_assets/generated_images/black_streetwear_snapback_cap.png",
      category: "Аксессуары",
      sizes: ["One Size"],
      colors: ["Черный", "Красный"],
      isNew: false
    });
  }

  return httpServer;
}
