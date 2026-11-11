import type { Express } from "express";
import { storage } from "../storage";
import { resolveSubscriptionPromo } from "../lib/subscription-promos";

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
      
      const popupPromo = resolveSubscriptionPromo(allPromos, popupPromoId, "WELCOME10");
      const homepagePromo = resolveSubscriptionPromo(allPromos, homepagePromoId, "WELCOME7");
      
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
      
      // Обновляем промокод и привязываем его ID к настройке. Раньше правка
      // применялась только при наличии popup.id: если привязка в bonus_settings
      // была пустой или ссылалась на удалённый код, процент молча не сохранялся,
      // а после деплоя попап возвращался к дефолтным 10 %.
      const allPromos = await storage.getPromoCodes();
      const updateBoundPromo = async (
        input: any,
        settingKey: "popup_promo_id" | "homepage_promo_id",
        fallbackCode: string,
      ) => {
        if (!input) return;
        const target = resolveSubscriptionPromo(allPromos, input.id, input.code || fallbackCode);
        if (!target) {
          throw new Error(`Промокод ${input.code || fallbackCode} не найден — создайте его в разделе «Промокоды»`);
        }
        const updates: any = {};
        if (typeof input.code === "string" && input.code.trim()) updates.code = input.code.trim().toUpperCase();
        if (input.discountPercent !== undefined) updates.discountPercent = Number(input.discountPercent);
        if (input.isActive !== undefined) updates.isActive = input.isActive;
        await storage.updatePromoCode(target.id, updates);
        if (String(target.id) !== String(input.id || "")) {
          await storage.setBonusSetting(settingKey, String(target.id));
        }
      };

      await updateBoundPromo(popup, "popup_promo_id", "WELCOME10");
      await updateBoundPromo(homepage, "homepage_promo_id", "WELCOME7");

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
