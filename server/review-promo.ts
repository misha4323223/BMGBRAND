import { storage } from './storage';
import { authStorage } from './auth-storage';
import { sendEmail, getReviewPromoEmailHtml } from './email';

// Промокод «за отзыв».
// Выдаётся автоматически при ОДОБРЕНИИ отзыва покупателя, который реально
// получил заказ с этим товаром (статус delivered / ready_for_pickup).
// Правила:
//   - скидка 10%, действует 7 дней, одноразовый (maxUses: 1 + проверка по email);
//   - суммируется со скидкой лояльности (canCombineWithLoyalty: true);
//   - НЕ суммируется с другими промокодами (в заказе один промокод) и не
//     применяется к товарам со скидкой (существующая логика checkout);
//   - один код на ОДИН заказ (не на каждый товар отзыва);
//   - привязан к email покупателя (isPromoUsedByEmail в checkout).
//
// Факты выдачи храним в bonus_settings (без миграций схемы):
//   review_promo:{reviewId}       → JSON { code, email, orderId, issuedAt }
//   review_promo_order:{orderId}  → reviewId  (заказ уже награждён)

const REVIEW_PROMO_PREFIX = 'RVW-';
const REVIEW_PROMO_DISCOUNT_PERCENT = 10;
const REVIEW_PROMO_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней
const REVIEW_PROMO_REWARDED_ORDER_STATUSES = ['delivered', 'ready_for_pickup'];

function randomCodeSuffix(): string {
  // Без похожих символов (0/O, 1/I) — удобно вводить вручную
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

async function generateUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${REVIEW_PROMO_PREFIX}${randomCodeSuffix()}`;
    const existing = await storage.getPromoCodeByCode(code);
    if (!existing) return code;
  }
  throw new Error('Не удалось сгенерировать уникальный промокод');
}

function orderHasProduct(order: any, productId: number): boolean {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.some((it: any) => {
    if (!it || it._discountDetails) return false;
    const pid = Number(it?.productId ?? it?.id);
    return Number.isFinite(pid) && pid === productId;
  });
}

async function findRewardableOrder(userId: number, email: string, productId: number): Promise<any | null> {
  const orders: any[] = [];
  try {
    const byUser = await storage.getOrdersByUserId(userId);
    if (Array.isArray(byUser)) orders.push(...byUser);
  } catch (e: any) {
    console.error('[ReviewPromo] getOrdersByUserId failed:', e?.message);
  }
  try {
    const byEmail = await storage.getOrdersByEmail(email);
    if (Array.isArray(byEmail)) {
      for (const o of byEmail) {
        if (!orders.some((x: any) => x.id === o.id)) orders.push(o);
      }
    }
  } catch (e: any) {
    console.error('[ReviewPromo] getOrdersByEmail failed:', e?.message);
  }

  // getOrdersBy* уже сортируют по created_at DESC — берём первый подходящий
  return (
    orders.find(
      (o: any) =>
        REVIEW_PROMO_REWARDED_ORDER_STATUSES.includes(String(o?.status)) &&
        !o?.isWholesale &&
        orderHasProduct(o, productId),
    ) || null
  );
}

/**
 * Вызывается после одобрения отзыва (админка / VK / Telegram).
 * Идемпотентно: повторный вызов для того же отзыва или того же заказа — no-op.
 */
export async function onReviewApproved(
  reviewId: number,
): Promise<{ issued: boolean; reason: string; code?: string }> {
  try {
    console.log(`[ReviewPromo] onReviewApproved called for review ${reviewId}`);
    const review = await storage.getReviewById(reviewId);
    if (!review) return { issued: false, reason: 'review-not-found' };
    if (!review.userId) return { issued: false, reason: 'review-has-no-user' };

    // Уже наградили за этот отзыв?
    const issuedKey = `review_promo:${reviewId}`;
    if (await storage.getBonusSetting(issuedKey)) {
      return { issued: false, reason: 'already-rewarded-review' };
    }

    const user = await authStorage.getUserById(review.userId);
    if (!user?.email) return { issued: false, reason: 'user-not-found' };
    const email = String(user.email).toLowerCase().trim();

    const order = await findRewardableOrder(review.userId, email, review.productId);
    if (!order) {
      return { issued: false, reason: 'no-delivered-order-with-product' };
    }

    // Один код на один заказ (защита от накрутки по нескольким товарам)
    const orderKey = `review_promo_order:${order.id}`;
    if (await storage.getBonusSetting(orderKey)) {
      return { issued: false, reason: 'already-rewarded-order' };
    }

    // Создаём код
    const code = await generateUniqueCode();
    const expiresAt = new Date(Date.now() + REVIEW_PROMO_VALIDITY_MS);
    await storage.createPromoCode({
      code,
      discountPercent: REVIEW_PROMO_DISCOUNT_PERCENT,
      maxUses: 1,
      expiresAt,
      canCombineWithLoyalty: true, // суммируется со скидкой лояльности
      isActive: true,
      allowForWholesale: false,
    });

    // Фиксируем выдачу; если запись не удастся — откатываем код
    const record = JSON.stringify({
      code,
      email,
      orderId: order.id,
      issuedAt: new Date().toISOString(),
    });
    try {
      await storage.setBonusSetting(issuedKey, record);
      await storage.setBonusSetting(orderKey, String(reviewId));
    } catch (e: any) {
      try {
        const created = await storage.getPromoCodeByCode(code);
        if (created) await storage.deletePromoCode(created.id);
      } catch { /* ignore */ }
      throw e;
    }

    // Письмо — best effort (код уже создан и сохранён)
    try {
      const firstName = String(user.name || email).split(' ')[0] || 'Покупатель';
      const ok = await sendEmail({
        to: email,
        subject: `Спасибо за отзыв! Ваш промокод −${REVIEW_PROMO_DISCOUNT_PERCENT}%`,
        html: getReviewPromoEmailHtml({
          name: firstName,
          code,
          discountPercent: REVIEW_PROMO_DISCOUNT_PERCENT,
          expiresAt,
        }),
      });
      if (!ok) console.error(`[ReviewPromo] Email failed for ${email} (code ${code})`);
    } catch (e: any) {
      console.error(`[ReviewPromo] Email error for ${email}:`, e?.message);
    }

    console.log(
      `[ReviewPromo] Issued ${code} → ${email} (review ${reviewId}, order ${order.id}, expires ${expiresAt.toISOString()})`,
    );
    return { issued: true, reason: 'ok', code };
  } catch (e: any) {
    console.error(`[ReviewPromo] Failed for review ${reviewId}:`, e?.message);
    return { issued: false, reason: 'error' };
  }
}

/**
 * Проверка права на промокод «за отзыв» для показа подсказки в форме отзыва.
 * True — если у пользователя есть доставленный/готовый к выдаче заказ с этим
 * товаром и за этот заказ промокод ещё не выдавался.
 */
export async function canEarnReviewPromo(
  userId: number,
  email: string,
  productId: number,
): Promise<boolean> {
  try {
    const order = await findRewardableOrder(userId, email, productId);
    if (!order) return false;
    const orderKey = `review_promo_order:${order.id}`;
    if (await storage.getBonusSetting(orderKey)) return false;
    return true;
  } catch (e: any) {
    console.error('[ReviewPromo] canEarnReviewPromo failed:', e?.message);
    return false;
  }
}
