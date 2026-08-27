import type { Express } from "express";
import { logError } from "../logger";
import { storage } from "../storage";
import { authStorage } from "../auth-storage";

// Admin users / loyalty routes extracted from routes.ts:
// - loyalty-users, loyalty/recalculate-all
// - favorites (per-user + popular products)
// - users list (retail clients with order stats), users/:id (client card)
export function registerAdminUsersRoutes(
  app: Express,
  getAdminKey: () => string | undefined
) {
  // Admin: Get users with loyalty data
  app.get("/api/admin/loyalty-users", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const users = await storage.getUsersWithLoyalty();
      res.json({ users: users || [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Полный пересчёт лояльности по истории заказов
  app.post("/api/admin/loyalty/recalculate-all", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const result = await storage.recalculateAllUsersLoyalty();
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Get all users' favorites
  app.get("/api/admin/favorites", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const allFavorites = await authStorage.getAllFavorites();
      
      const userFavoritesMap: Record<number, { productIds: number[], count: number }> = {};
      const productFavoritesCount: Record<number, number> = {};
      
      for (const fav of allFavorites) {
        if (!userFavoritesMap[fav.userId]) {
          userFavoritesMap[fav.userId] = { productIds: [], count: 0 };
        }
        userFavoritesMap[fav.userId].productIds.push(fav.productId);
        userFavoritesMap[fav.userId].count++;
        
        productFavoritesCount[fav.productId] = (productFavoritesCount[fav.productId] || 0) + 1;
      }

      const usersWithFavorites = await Promise.all(
        Object.entries(userFavoritesMap).map(async ([userId, data]) => {
          const user = await authStorage.getUserById(Number(userId));
          return {
            userId: Number(userId),
            userName: user?.name || user?.email || "Unknown",
            userEmail: user?.email || "",
            productIds: data.productIds,
            count: data.count,
          };
        })
      );

      const popularProducts = Object.entries(productFavoritesCount)
        .map(([productId, count]) => ({ productId: Number(productId), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      res.json({
        users: usersWithFavorites.sort((a, b) => b.count - a.count),
        popularProducts,
        totalFavorites: allFavorites.length,
        totalUsers: usersWithFavorites.length,
      });
    } catch (err: any) {
      logError("[Admin] Get favorites error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Список всех розничных клиентов
  app.get("/api/admin/users", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const users = await authStorage.getAllRetailUsers();
      const allOrders = await storage.getOrders();
      const allFavorites = await authStorage.getAllFavorites();

      const favCountByUser: Record<number, number> = {};
      for (const f of allFavorites) {
        favCountByUser[f.userId] = (favCountByUser[f.userId] || 0) + 1;
      }

      const ordersByUser: Record<number, any[]> = {};
      for (const o of allOrders) {
        if (o.status === 'awaiting_payment') continue;
        if (o.userId) {
          if (!ordersByUser[o.userId]) ordersByUser[o.userId] = [];
          ordersByUser[o.userId].push(o);
        }
      }
      // Также индексируем по email для заказов без userId
      const ordersByEmail: Record<string, any[]> = {};
      for (const o of allOrders) {
        if (o.status === 'awaiting_payment') continue;
        if (o.customerEmail) {
          const key = o.customerEmail.toLowerCase();
          if (!ordersByEmail[key]) ordersByEmail[key] = [];
          ordersByEmail[key].push(o);
        }
      }

      const result = users.map(u => {
        const byId = ordersByUser[u.id] || [];
        const byEmail = u.email ? (ordersByEmail[u.email.toLowerCase()] || []) : [];
        const seen = new Set<number>();
        const userOrders: any[] = [];
        for (const o of [...byId, ...byEmail]) {
          if (!seen.has(o.id)) { seen.add(o.id); userOrders.push(o); }
        }
        const lastOrder = userOrders.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        const paidOrders = userOrders.filter((o: any) => !['cancelled', 'awaiting_payment'].includes(o.status));
        const computedTotalSpent = paidOrders.reduce((sum: number, o: any) => sum + (o.total || 0), 0);
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone || null,
          createdAt: u.createdAt,
          totalSpent: computedTotalSpent,
          loyaltyDiscount: u.loyaltyDiscount || 0,
          orderCount: userOrders.length,
          lastOrderAt: lastOrder?.createdAt || null,
          favoritesCount: favCountByUser[u.id] || 0,
          emailVerified: u.emailVerified,
        };
      });

      res.json({ users: result });
    } catch (err: any) {
      logError("[Admin] Get users error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Карточка конкретного клиента
  app.get("/api/admin/users/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const userId = Number(req.params.id);
      if (!userId) return res.status(400).json({ error: "Invalid id" });

      const [user, ordersByUserId, ordersByEmail, favoriteIds, cartItems] = await Promise.all([
        authStorage.getUserById(userId),
        storage.getOrdersByUserId(userId),
        (async () => {
          const u = await authStorage.getUserById(userId);
          if (!u?.email) return [];
          return storage.getOrdersByEmail(u.email);
        })(),
        authStorage.getFavorites(userId),
        storage.getCartByUserId(userId),
      ]);

      // Объединяем заказы по id (убираем дубликаты)
      const ordersMap = new Map<number, any>();
      for (const o of [...ordersByUserId, ...ordersByEmail]) {
        ordersMap.set(o.id, o);
      }
      const orders = Array.from(ordersMap.values()).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      if (!user) return res.status(404).json({ error: "User not found" });

      // Промокоды использованные этим пользователем (из заказов)
      const usedPromoCodes = orders
        .filter((o: any) => o.promoCode)
        .map((o: any) => ({ code: o.promoCode, orderId: o.id, orderDate: o.createdAt, orderTotal: o.total }));

      // Подписка на рассылку
      let newsletterSubscribed = false;
      try {
        const newsletters = await storage.getAllNewsletterSubscriptions();
        newsletterSubscribed = newsletters.some((s: any) => s.email?.toLowerCase() === user.email?.toLowerCase());
      } catch { }

      // Подписки на снижение цены
      let priceDropSubs: any[] = [];
      try {
        priceDropSubs = await storage.getPriceDropSubscriptionsByEmail(user.email);
      } catch { }

      // Товары из избранного с деталями
      const favoriteProducts = await Promise.all(
        favoriteIds.slice(0, 50).map(async (pid: number) => {
          const p = await storage.getProduct(pid);
          return p ? { id: p.id, name: p.name, price: p.price, thumbnailUrl: p.thumbnailUrl || p.imageUrl } : null;
        })
      ).then(r => r.filter(Boolean));

      const paidOrders = orders.filter((o: any) => !['cancelled', 'awaiting_payment'].includes(o.status));
      const computedTotalSpent = paidOrders.reduce((sum: number, o: any) => sum + (o.total || 0), 0);

      res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone || null,
          createdAt: user.createdAt,
          emailVerified: user.emailVerified,
          totalSpent: computedTotalSpent,
          loyaltyDiscount: user.loyaltyDiscount || 0,
        },
        orders: orders.slice(0, 100),
        favorites: favoriteProducts,
        cart: cartItems.map(ci => ({
          productId: ci.productId,
          name: ci.product?.name || "",
          price: ci.product?.price || 0,
          thumbnailUrl: ci.product?.thumbnailUrl || ci.product?.imageUrl || "",
          size: ci.size,
          color: ci.color,
          quantity: ci.quantity,
        })),
        usedPromoCodes,
        newsletterSubscribed,
        priceDropSubs,
      });
    } catch (err: any) {
      logError("[Admin] Get user detail error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
