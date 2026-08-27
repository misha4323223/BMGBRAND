import type { Express } from "express";
import { logError, logInfo } from "../logger";
import { storage } from "../storage";
import { sendEmail, getGiftCardPaidEmailHtml, getGiftCardReceivedEmailHtml } from "../email";
import { notifyError } from "../error-monitor";

// Admin gift-card activation/resend routes extracted from routes.ts:
// - POST /api/gift-cards/:id/activate (activate after payment, send emails)
// - POST /api/gift-cards/:id/resend-email (re-send activation emails)
export function registerAdminGiftCardRoutes(
  app: Express,
  getAdminKey: () => string | undefined
) {
  // Admin: Activate gift card after payment confirmation
  app.post("/api/gift-cards/:id/activate", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const id = parseInt(req.params.id);
      const { paymentId, paymentMethod } = req.body;
      
      const card = await storage.getGiftCardById(id);
      if (!card) {
        return res.status(404).json({ error: "Карта не найдена" });
      }
      
      const updated = await storage.updateGiftCard(id, {
        status: "active",
        paymentId: paymentId || null,
        paymentMethod: paymentMethod || null,
      });
      
      logInfo(`[GiftCards] Activated card ${card.code} for ${card.amount / 100} RUB`);
      
      if (card.purchaserEmail) {
        try {
          const purchaserHtml = getGiftCardPaidEmailHtml(
            card.purchaserName || 'Покупатель',
            card.code,
            card.amount,
            card.recipientName,
            card.recipientEmail,
            card.message,
            (card as any).cardColor || 'black'
          );
          await sendEmail({
            to: card.purchaserEmail,
            subject: `Подарочная карта BOOOMERANGS на ${(card.amount / 100).toLocaleString('ru-RU')} ₽ оплачена`,
            html: purchaserHtml
          });
          if (card.recipientEmail && card.recipientEmail !== card.purchaserEmail) {
            const recipientHtml = getGiftCardReceivedEmailHtml(
              card.recipientName || 'Друг',
              card.purchaserName || 'Друг',
              card.code,
              card.amount,
              card.message,
              (card as any).cardColor || 'black'
            );
            await sendEmail({
              to: card.recipientEmail,
              subject: `Вам подарили подарочную карту BOOOMERANGS на ${(card.amount / 100).toLocaleString('ru-RU')} ₽!`,
              html: recipientHtml
            });
          }
        } catch (emailErr: any) {
          logError(`[GiftCards] Failed to send activation email:`, emailErr.message);
          notifyError('Email активация сертификата', `Не удалось отправить письмо получателю`, `${card.recipientEmail} | ${emailErr.message}`);
        }
      }
      
      res.json({ success: true, card: updated });
    } catch (err: any) {
      logError("[GiftCards] Activate error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/gift-cards/:id/resend-email", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const id = parseInt(req.params.id);
      const card = await storage.getGiftCardById(id);
      if (!card) {
        return res.status(404).json({ error: "Карта не найдена" });
      }
      if (card.status !== "active") {
        return res.status(400).json({ error: "Карта не активна" });
      }
      
      const sent: string[] = [];
      if (card.purchaserEmail) {
        const purchaserHtml = getGiftCardPaidEmailHtml(
          card.purchaserName || 'Покупатель',
          card.code,
          card.amount,
          card.recipientName,
          card.recipientEmail,
          card.message,
          (card as any).cardColor || 'black'
        );
        await sendEmail({
          to: card.purchaserEmail,
          subject: `Подарочная карта BOOOMERANGS на ${(card.amount / 100).toLocaleString('ru-RU')} ₽ оплачена`,
          html: purchaserHtml
        });
        sent.push(card.purchaserEmail);
      }
      if (card.recipientEmail && card.recipientEmail !== card.purchaserEmail) {
        const recipientHtml = getGiftCardReceivedEmailHtml(
          card.recipientName || 'Друг',
          card.purchaserName || 'Друг',
          card.code,
          card.amount,
          card.message,
          (card as any).cardColor || 'black'
        );
        await sendEmail({
          to: card.recipientEmail,
          subject: `Вам подарили подарочную карту BOOOMERANGS на ${(card.amount / 100).toLocaleString('ru-RU')} ₽!`,
          html: recipientHtml
        });
        sent.push(card.recipientEmail);
      }
      
      logInfo(`[GiftCards] Resent emails for card ${card.code} to: ${sent.join(', ')}`);
      res.json({ success: true, sentTo: sent });
    } catch (err: any) {
      logError("[GiftCards] Resend email error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
