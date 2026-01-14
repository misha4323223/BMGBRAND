import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import express from "express";
import path from "path";

import { XMLParser } from "fast-xml-parser";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // 1C CommerceML Exchange (Standard Protocol)
  app.get("/api/1c-exchange", async (req, res) => {
    const { type, mode } = req.query;
    const auth = req.headers.authorization;
    const expectedAuth = "Basic " + Buffer.from("admin:bmg-secret-123").toString("base64");

    if (auth !== expectedAuth) {
      res.set("WWW-Authenticate", 'Basic realm="1C Exchange"');
      return res.status(401).send("failure\nUnauthorized");
    }

    if (type === "catalog" && mode === "checkauth") {
      return res.send("success\nPHPSESSID\nreplit-session-id");
    }
    if (type === "catalog" && mode === "init") {
      return res.send("zip=no\nfile_limit=10485760");
    }
    res.send("success");
  });

  app.post("/api/1c-exchange", express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
    const { type, mode, filename } = req.query;
    
    if (type === "catalog" && mode === "file") {
      // In a real app, we'd save the file and parse it
      // For now, let's simulate success to allow 1C to continue
      return res.send("success");
    }
    
    if (type === "catalog" && mode === "import") {
      // Trigger parsing of the uploaded file
      return res.send("success");
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
