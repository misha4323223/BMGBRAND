import type { Express } from "express";
import {
  getPushSubs,
  savePushSubs,
  sendPushToAll as sendPushToAllSvc,
  getAdminPushSubs,
  saveAdminPushSubs,
  sendPushToAdmins as sendPushToAdminsSvc,
  acquirePushLock,
  releasePushLock,
  getPushHistory,
} from "../push-service";
import { logWarn, logInfo, logError } from "../logger";

// Web Push: публичные (подписка/отписка) + admin (рассылки, баннер, статистика).
// Вынесено из server/routes.ts без изменения поведения.
// requireAdminOrApiKey передаётся из routes.ts (используется и другими доменами).

export function registerPushRoutes(
  app: Express,
  requireAdminOrApiKey: (req: any, res: any, next: any) => void,
): void {
  // Публичный — отдаём VAPID public key браузеру
  app.get('/api/push/vapid-public-key', (_req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return res.status(503).json({ error: 'Push не настроен' });
    res.json({ publicKey: key });
  });

  // Сохраняем подписку браузера
  app.post('/api/push/subscribe', async (req, res) => {
    if (!acquirePushLock('client')) {
      return res.status(429).json({ error: 'Подождите, идёт сохранение подписки' });
    }
    try {
      const { subscription } = req.body;
      if (!subscription?.endpoint || !subscription?.keys) {
        return res.status(400).json({ error: 'Некорректная подписка' });
      }

      // Принимаем подписки только с продакшн-домена
      const origin = req.headers['origin'] || req.headers['referer'] || '';
      const isProduction = origin.includes('booomerangs.ru');
      if (origin && !isProduction) {
        logWarn(`[WebPush] Blocked subscription from non-production origin: ${origin}`);
        return res.json({ success: true }); // не сохраняем, но не ругаемся
      }

      const subs = await getPushSubs();
      const idx = subs.findIndex((s: any) => s.endpoint === subscription.endpoint);
      const userId = (req as any).user?.id || null;
      const entry = { ...subscription, userId, origin: 'https://booomerangs.ru', createdAt: Date.now() };
      if (idx >= 0) subs[idx] = entry; else subs.push(entry);
      await savePushSubs(subs);
      logInfo(`[WebPush] Subscription saved. Total: ${subs.length}`);
      res.json({ success: true });
    } catch (err: any) {
      logError('[WebPush] Subscribe error:', err.message);
      res.status(500).json({ error: 'Ошибка сервера' });
    } finally {
      releasePushLock('client');
    }
  });

  // Удаляем подписку (отписка)
  app.delete('/api/push/unsubscribe', async (req, res) => {
    if (!acquirePushLock('client')) {
      return res.status(429).json({ error: 'Подождите, идёт обновление подписок' });
    }
    try {
      const { endpoint } = req.body;
      if (!endpoint) return res.status(400).json({ error: 'endpoint обязателен' });
      const subs = await getPushSubs();
      await savePushSubs(subs.filter((s: any) => s.endpoint !== endpoint));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: 'Ошибка сервера' });
    } finally {
      releasePushLock('client');
    }
  });

  // Admin: разослать пуш всем подписчикам
  app.post('/api/admin/push/send', requireAdminOrApiKey, async (req, res) => {
    if (!process.env.VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push не настроен (нет VAPID ключей)' });
    try {
      const { title, body, url, tag, image } = req.body;
      if (!title || !body) return res.status(400).json({ error: 'title и body обязательны' });
      const subs = await getPushSubs();
      const total = subs.length;
      if (total === 0) return res.json({ sent: 0, failed: 0, total: 0 });
      const result = await sendPushToAllSvc({ title, body, url, tag, image });
      res.json({ sent: result.sent, failed: result.failed, total });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: статистика подписчиков
  app.get('/api/admin/push/stats', requireAdminOrApiKey, async (_req, res) => {
    try {
      const subs = await getPushSubs();
      res.json({ total: subs.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: загрузить push-баннер в S3 (фиксированный ключ push/push-banner.png)
  app.post('/api/admin/push/upload-banner', requireAdminOrApiKey, async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) return res.status(400).json({ error: 'Пустой файл' });

      const sharp = (await import('sharp')).default;
      // Оптимальный размер push-баннера: ширина 1080px, соотношение ~2:1, PNG
      const pngBuffer = await sharp(buffer)
        .resize(1080, null, { withoutEnlargement: true, kernel: 'lanczos3' })
        .png({ quality: 90, compressionLevel: 8 })
        .toBuffer();

      const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || 'bmg';
      const s3Key = 'push/push-banner.png'; // фиксированный ключ — каждая загрузка перезаписывает

      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: 'ru-central1',
        endpoint: 'https://storage.yandexcloud.net',
        credentials: {
          accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || '',
          secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || '',
        },
      });

      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: pngBuffer,
        ContentType: 'image/png',
        ACL: 'public-read',
        CacheControl: 'public, max-age=3600',
      }));

      // Добавляем cache-buster чтобы браузер не отдавал старый кэш
      const url = `https://storage.yandexcloud.net/${bucketName}/${s3Key}?v=${Date.now()}`;
      logInfo(`[WebPush] Banner uploaded: ${url}`);
      res.json({ url, success: true });
    } catch (err: any) {
      logError('[WebPush] Banner upload error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: история последних рассылок (in-memory, max 20)
  app.get('/api/admin/push/history', requireAdminOrApiKey, (_req, res) => {
    res.json(getPushHistory());
  });

  // Admin: тест-пуш только на admin-браузеры (не трогает клиентов)
  app.post('/api/admin/push/test', requireAdminOrApiKey, async (req, res) => {
    if (!process.env.VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push не настроен (нет VAPID ключей)' });
    try {
      const { title, body, url, image } = req.body;
      if (!title || !body) return res.status(400).json({ error: 'title и body обязательны' });
      const result = await sendPushToAdminsSvc({
        title: `[ТЕСТ] ${title}`,
        body,
        url: url || 'https://booomerangs.ru',
        image,
        tag: 'booom-push-test',
      });
      res.json({ sent: result.sent, failed: result.failed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Admin Push (owner devices) ──────────────────────────────────────────────
  // Отдельный список подписок для владельцев/администраторов сайта.
  // Используется автономным агентом для алертов (низкий сток, дайджест, очередь).

  // Подписать браузер администратора
  app.post('/api/admin/push/admin-subscribe', requireAdminOrApiKey, async (req, res) => {
    if (!acquirePushLock('admin')) {
      return res.status(429).json({ error: 'Подождите, идёт сохранение подписки' });
    }
    try {
      const { subscription } = req.body;
      if (!subscription?.endpoint || !subscription?.keys) {
        return res.status(400).json({ error: 'Некорректная подписка' });
      }
      const subs = await getAdminPushSubs();
      const idx = subs.findIndex((s: any) => s.endpoint === subscription.endpoint);
      const entry = { ...subscription, createdAt: Date.now() };
      if (idx >= 0) subs[idx] = entry; else subs.push(entry);
      await saveAdminPushSubs(subs);
      logInfo(`[WebPush] Admin subscription saved. Total admins: ${subs.length}`);
      res.json({ success: true });
    } catch (err: any) {
      logError('[WebPush] Admin subscribe error:', err.message);
      res.status(500).json({ error: 'Ошибка сервера' });
    } finally {
      releasePushLock('admin');
    }
  });

  // Отписать браузер администратора
  app.delete('/api/admin/push/admin-unsubscribe', requireAdminOrApiKey, async (req, res) => {
    if (!acquirePushLock('admin')) {
      return res.status(429).json({ error: 'Подождите, идёт обновление подписок' });
    }
    try {
      const { endpoint } = req.body;
      if (!endpoint) return res.status(400).json({ error: 'endpoint обязателен' });
      const subs = await getAdminPushSubs();
      await saveAdminPushSubs(subs.filter((s: any) => s.endpoint !== endpoint));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: 'Ошибка сервера' });
    } finally {
      releasePushLock('admin');
    }
  });

  // Статистика подписок администраторов
  app.get('/api/admin/push/admin-stats', requireAdminOrApiKey, async (_req, res) => {
    try {
      const subs = await getAdminPushSubs();
      res.json({ total: subs.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Очистка кривых подписок (не с booomerangs.ru)
  app.post('/api/admin/push/clean-dev-subs', requireAdminOrApiKey, async (_req, res) => {
    try {
      const subs = await getPushSubs();
      const before = subs.length;
      // Оставляем только те, у которых origin = booomerangs.ru или origin не задан (старые легаси)
      const cleaned = subs.filter((s: any) => {
        if (!s.origin) return true; // легаси без поля — оставляем
        return s.origin.includes('booomerangs.ru');
      });
      await savePushSubs(cleaned);
      const removed = before - cleaned.length;
      logInfo(`[WebPush] Cleaned ${removed} dev subscriptions. Remaining: ${cleaned.length}`);
      res.json({ before, after: cleaned.length, removed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
