import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
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
      imageUrl: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800&q=80",
      category: "Футболки",
      sizes: ["S", "M", "L", "XL"],
      colors: ["Черный", "Белый"],
      isNew: true
    });
    await storage.createProduct({
      name: "Худи 'NO FUTURE'",
      description: "Плотное худи с вышитыми деталями. База уличного стиля.",
      price: 6500,
      imageUrl: "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&q=80",
      category: "Худи",
      sizes: ["M", "L", "XL"],
      colors: ["Черный"],
      isNew: true
    });
     await storage.createProduct({
      name: "Брюки-карго 'TACTICAL'",
      description: "Функциональные брюки-карго с множеством карманов и стропами.",
      price: 5500,
      imageUrl: "https://images.unsplash.com/photo-1517438476312-10d79c077509?w=800&q=80",
      category: "Брюки",
      sizes: ["S", "M", "L"],
      colors: ["Черный", "Камуфляж"],
      isNew: false
    });
    await storage.createProduct({
      name: "Кепка 'BMG'",
      description: "Классический снэпбэк с 3D вышивкой.",
      price: 2000,
      imageUrl: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=800&q=80",
      category: "Аксессуары",
      sizes: ["One Size"],
      colors: ["Черный", "Красный"],
      isNew: false
    });
  }

  return httpServer;
}
