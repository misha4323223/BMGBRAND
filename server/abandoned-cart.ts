import crypto from 'crypto';
import { storage } from './storage';
import { sendEmail, getAbandonedCartEmailHtml } from './email';

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // каждые 24 часа
const FIRST_RUN_DELAY_MS = 1 * 60 * 1000; // первая проверка через 1 мин после старта

export function startAbandonedCartJob(): void {
  setTimeout(() => {
    runAbandonedCartCheck();
    setInterval(runAbandonedCartCheck, CHECK_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
  console.log('[AbandonedCart] Job scheduled: first run in 1 min, then every 24 hours');
}

export async function runAbandonedCartCheck(): Promise<void> {
  const db = storage as any;
  if (typeof db.getAbandonedCartUserSessions !== 'function') {
    return; // dev mode without YDB — skip
  }

  try {
    console.log('[AbandonedCart] Running check...');
    const sessions: string[] = await db.getAbandonedCartUserSessions();
    let sent = 0;
    let skipped = 0;

    let emptyCart = 0, noEmail = 0, cooldown = 0;
    for (const sessionId of sessions) {
      try {
        const userIdStr = sessionId.replace('user_', '');
        const userId = parseInt(userIdStr, 10);
        if (isNaN(userId) || userId <= 0) continue;

        // Получаем товары корзины
        const cartItems = await storage.getCartItems(sessionId);
        if (cartItems.length === 0) { emptyCart++; continue; }

        // Хэш текущей корзины (чтобы понять изменилась ли она)
        const cartHash = crypto
          .createHash('md5')
          .update(
            cartItems
              .map(i => `${i.productId}:${i.size ?? ''}:${i.color ?? ''}:${i.quantity}`)
              .sort()
              .join('|')
          )
          .digest('hex');

        // Проверяем — уже отправляли?
        const reminder = await db.getCartReminder(userId);
        if (reminder) {
          const sentAt = new Date(reminder.sentAt).getTime();
          const sameCart = reminder.cartHash === cartHash;
          const withinCooldown = Date.now() - sentAt < FIVE_DAYS_MS;
          if (sameCart && withinCooldown) {
            skipped++;
            cooldown++;
            continue;
          }
        }

        // Получаем email пользователя
        const user = await db.getUserEmailById(userId);
        if (!user?.email) { noEmail++; continue; }

        // Считаем сумму
        const totalKopecks = cartItems.reduce(
          (sum, item) => sum + item.product.price * item.quantity,
          0
        );

        // Отправляем письмо
        const html = getAbandonedCartEmailHtml(user.name || '', cartItems, totalKopecks);
        const ok = await sendEmail({
          to: user.email,
          subject: 'Вы кое-что забыли в корзине',
          html,
        });

        if (ok) {
          await db.upsertCartReminder(userId, cartHash);
          sent++;
          console.log(`[AbandonedCart] Sent to user ${userId} (${user.email}), cart: ${cartItems.length} items`);
        }

        // Пауза между отправками чтобы не перегружать SMTP
        await new Promise(r => setTimeout(r, 600));
      } catch (err: any) {
        console.error(`[AbandonedCart] Error for session ${sessionId}:`, err.message);
      }
    }

    console.log(`[AbandonedCart] Done. Sent: ${sent}, cooldown: ${cooldown}, emptyCart: ${emptyCart}, noEmail: ${noEmail}, total sessions: ${sessions.length}`);
  } catch (err: any) {
    console.error('[AbandonedCart] Job crashed:', err.message);
  }
}
