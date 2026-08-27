import type { Express } from "express";
import { storage } from "../storage";

// Admin popup-promo routes extracted from routes.ts:
// - GET /api/admin/popup-promo (popup + homepage promo + settings)
// - PUT /api/admin/popup-promo (update promos + settings, invalidate cache)
export function registerAdminPromoRoutes(
  app: Express,
  getAdminKey: () => string | undefined,
  invalidateSubscriptionPromosCache: () => void
) {
  // Admin: Get popup promo settings
  app.get("/api/admin/popup-promo", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const popupPromoId = await storage.getBonusSetting("popup_promo_id");
      const homepagePromoId = await storage.getBonusSetting("homepage_promo_id");
      const popupEnabled = (await storage.getBonusSetting("popup_enabled")) || "true";
      
      const allPromos = await storage.getPromoCodes();
      
      const popupPromo = popupPromoId 
        ? allPromos.find((p: any) => String(p.id) === popupPromoId)
        : allPromos.find((p: any) => p.code === "WELCOME10");
      const homepagePromo = homepagePromoId 
        ? allPromos.find((p: any) => String(p.id) === homepagePromoId)
        : allPromos.find((p: any) => p.code === "WELCOME7");
      
      const settings = {
        enabled: popupEnabled === "true",
        title: (await storage.getBonusSetting("popup_title")) || "ЭКСКЛЮЗИВНОЕ ПРЕДЛОЖЕНИЕ",
        subtitle: (await storage.getBonusSetting("popup_subtitle")) || "NEW_MEMBER_BONUS",
        description: (await storage.getBonusSetting("popup_description")) || "Скидка на первый заказ при подписке на рассылку. Будьте первыми, кто узнаёт о новых дропах.",
        buttonText: (await storage.getBonusSetting("popup_button_text")) || "ПОЛУЧИТЬ СКИДКУ",
        successTitle: (await storage.getBonusSetting("popup_success_title")) || "ДОБРО ПОЖАЛОВАТЬ!",
        successText: (await storage.getBonusSetting("popup_success_text")) || "Ваш промокод на скидку",
        delay: parseInt((await storage.getBonusSetting("popup_delay")) || "4000"),
        placeholder: (await storage.getBonusSetting("popup_placeholder")) || "Ваш email",
        closeText: (await storage.getBonusSetting("popup_close_text")) || "Продолжить покупки",
      };

      res.json({ 
        popup: popupPromo || null, 
        homepage: homepagePromo || null,
        settings
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Update popup promo code settings
  app.put("/api/admin/popup-promo", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { popup, homepage, settings } = req.body;
      
      // Update popup promo by ID (not by code - code may have been changed)
      if (popup && popup.id) {
        await storage.updatePromoCode(popup.id, {
          code: popup.code,
          discountPercent: popup.discountPercent,
          isActive: popup.isActive,
        });
      }
      
      // Update homepage promo by ID
      if (homepage && homepage.id) {
        await storage.updatePromoCode(homepage.id, {
          code: homepage.code,
          discountPercent: homepage.discountPercent,
          isActive: homepage.isActive,
        });
      }

      if (settings) {
        const settingKeys = {
          enabled: "popup_enabled",
          title: "popup_title",
          subtitle: "popup_subtitle",
          description: "popup_description",
          buttonText: "popup_button_text",
          successTitle: "popup_success_title",
          successText: "popup_success_text",
          delay: "popup_delay",
          placeholder: "popup_placeholder",
          closeText: "popup_close_text"
        };

        for (const [key, value] of Object.entries(settings)) {
          const dbKey = settingKeys[key as keyof typeof settingKeys];
          if (dbKey) {
            await storage.setBonusSetting(dbKey, String(value));
          }
        }
      }

      invalidateSubscriptionPromosCache();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
