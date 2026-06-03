// Admin endpoints for partner program: moderation, commissions, payouts, global %
import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import PDFDocument from 'pdfkit';
import { createHash } from 'crypto';
import { storage } from './storage';
import { authStorage } from './auth-storage';
import { authMiddleware, type AuthRequest } from './auth-routes';
import { invalidatePartnerSlugCache, invalidateGlobalCommissionPercentCache, invalidateGlobalHoldDaysCache } from './partner-routes';
import { downloadPayoutDocument } from './lib/storage-s3';
import { sendEmail, getPayoutPaidEmailHtml, getPayoutCompletedEmailHtml, getPayoutRejectedEmailHtml, getPartnerApprovedEmailHtml, getPartnerRejectedEmailHtml } from './email';
import { isYandexCloudOrPrivateIp } from './lib/yandex-cloud-ip';
import { PARTNER_STATUSES, LEGAL_DOCUMENT_SLUGS, type LegalDocumentSlug } from '@shared/schema';

const router = Router();

function fmtRubEmail(kopeks: number): string {
  return (kopeks / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

// In-memory lock: защита от двойного клика "Создать выплату" в админке.
// Сценарий: два админа (или один админ в двух вкладках) почти одновременно
// жмут кнопку "Создать выплату" по одному и тому же партнёру. Без замка
// оба запроса увидят комиссии в статусе confirmed, оба пройдут валидацию
// и оба создадут payout по тем же commissionIds — у партнёра окажутся
// две выплаты вместо одной, totalEarned и статистика разъедутся.
//
// Замок per-partnerId с TTL 60 секунд. Тот же подход уже используется в
// partner-routes.ts для загрузки счёта/чека (см. payoutUploadLocks). Здесь
// отдельный Map, потому что ключ другой (partnerId vs payoutId:kind).
//
// ВНИМАНИЕ: in-memory — работает только в single-instance Yandex Cloud
// Container. Для multi-instance потребуется DB-replicated lock (см. список
// "Что осталось" в replit.md).
const payoutCreateLocks = new Map<number, number>(); // partnerId → ts(ms)
const PAYOUT_CREATE_LOCK_TTL_MS = 60_000;
function acquirePayoutCreateLock(partnerId: number): boolean {
  const now = Date.now();
  const existing = payoutCreateLocks.get(partnerId);
  if (existing && now - existing < PAYOUT_CREATE_LOCK_TTL_MS) return false;
  payoutCreateLocks.set(partnerId, now);
  return true;
}
function releasePayoutCreateLock(partnerId: number) {
  payoutCreateLocks.delete(partnerId);
}

function checkAdminKey(key: string | undefined): boolean {
  const adminKey = process.env.ADMIN_API_KEY || process.env.SYNC_API_KEY;
  if (!adminKey) return false;
  return key === adminKey;
}

function adminMiddleware(req: AuthRequest, res: Response, next: any) {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  if (!checkAdminKey(apiKey as string)) {
    return res.status(403).json({ error: 'Forbidden: Invalid API key' });
  }
  // В dev-режиме допускаем доступ только по API-ключу (для E2E-тестов).
  // В production требуем обязательную admin-сессию.
  if (process.env.NODE_ENV !== 'development') {
    if (!req.user) {
      return res.status(401).json({ error: 'Требуется авторизация администратора' });
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Требуются права администратора' });
    }
  }
  next();
}

/**
 * Структурированный audit-лог админских действий по выплатам.
 * Один формат строки → удобно искать в Yandex Cloud Logging:
 *   ([AUDIT] payout=…) ИЛИ ((action AND admin AND payoutId)).
 */
function auditPayout(
  req: AuthRequest,
  action: string,
  payoutId: number,
  extra: Record<string, unknown> = {},
) {
  const adminEmail = req.user?.email || 'unknown';
  const adminId = req.user?.id ?? null;
  // Anti-spoof (30.04.2026): req.ip = последний хоп XFF после trust proxy=1.
  // Сырой XFF позволял подделку клиентом при прямом обращении к публичному URL контейнера.
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  console.log(
    `[AUDIT] payout action=${action} payoutId=${payoutId} admin=${adminEmail} adminId=${adminId} ip=${ip} ` +
    Object.entries(extra).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' '),
  );
}

// List partners (with optional status filter) — also returns aggregated stats per partner
router.get('/partners', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' && req.query.status !== 'all'
      ? req.query.status
      : undefined;
    const partners = await storage.listPartners(status ? { status } : undefined);

    // Hydrate each partner with stats + emailVerified status from users table
    // + флаг "remote_ip из доверенных диапазонов?" для форензики ПЭП:
    //   true  — IP TCP-сокета подписания принадлежит публичным диапазонам YC
    //           или приватным сетям (норма: запрос пришёл через API Gateway).
    //   false — IP внешний и не из YC: возможен обход Gateway, требует внимания.
    //   null  — remote_ip не записан (legacy-партнёры до 30.04.2026) либо не оценим.
    const partnersWithStats = await Promise.all(
      partners.map(async (p) => {
        const [statsResult, emailVerifiedResult] = await Promise.allSettled([
          storage.getPartnerStats(p.id),
          authStorage.getEmailVerifiedByUserId(p.userId),
        ]);
        return {
          ...p,
          stats: statsResult.status === 'fulfilled' ? statsResult.value : null,
          emailVerified: emailVerifiedResult.status === 'fulfilled' ? emailVerifiedResult.value : null,
          consentRemoteIpInYandex: isYandexCloudOrPrivateIp((p as any).consentRemoteIp),
        };
      }),
    );

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ partners: partnersWithStats });
  } catch (error: any) {
    console.error('[Admin Partners] list error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка получения списка' });
  }
});

// Approve / reject / block / pending again
router.patch('/partners/:id/status', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный ID' });
    const { status } = req.body || {};
    if (!PARTNER_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Недопустимый статус' });
    }
    const partner = await storage.getPartnerById(id);
    if (!partner) return res.status(404).json({ error: 'Партнёр не найден' });

    await storage.updatePartnerStatus(id, status);
    invalidatePartnerSlugCache(partner.partnerSlug);

    const updated = await storage.getPartnerById(id);
    res.json({ success: true, partner: updated });

    // Email партнёру при одобрении или отказе (non-blocking)
    if (status === 'approved' || status === 'rejected') {
      try {
        if (partner.contactEmail) {
          const name = partner.contactName || 'Партнёр';
          if (status === 'approved') {
            await sendEmail({
              to: partner.contactEmail,
              subject: 'Ваш партнёрский аккаунт активирован — BOOOMERANGS',
              html: getPartnerApprovedEmailHtml(name, partner.partnerSlug),
            });
          } else {
            await sendEmail({
              to: partner.contactEmail,
              subject: 'Решение по вашей партнёрской заявке — BOOOMERANGS',
              html: getPartnerRejectedEmailHtml(name),
            });
          }
        }
      } catch (emailErr: any) {
        console.error('[Admin Partners] status email error:', emailErr?.message);
      }
    }
  } catch (error: any) {
    console.error('[Admin Partners] status error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка изменения статуса' });
  }
});

// Set per-partner commission override (or null = use global)
router.patch('/partners/:id/commission', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный ID' });
    const { percent } = req.body || {};
    let value: number | null = null;
    if (percent !== null && percent !== undefined && percent !== '') {
      const n = Number(percent);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: 'Процент должен быть от 0 до 100' });
      }
      value = Math.round(n);
    }
    await storage.updatePartnerCommissionOverride(id, value);
    const updated = await storage.getPartnerById(id);
    res.json({ success: true, partner: updated });
  } catch (error: any) {
    console.error('[Admin Partners] commission override error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка обновления процента' });
  }
});

// List all partner commissions (with optional filters)
router.get('/partner-commissions', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const filter: { status?: string; partnerId?: number } = {};
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      filter.status = req.query.status;
    }
    if (req.query.partnerId) {
      const pid = Number(req.query.partnerId);
      if (Number.isFinite(pid)) filter.partnerId = pid;
    }
    const commissions = await storage.listAllCommissions(filter);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ commissions });
  } catch (error: any) {
    console.error('[Admin Partners] commissions error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка получения комиссий' });
  }
});

// Confirm pending commissions (admin presses "Подтвердить" after hold period).
// Body: { ids: number[], force?: boolean }.
// - Normal flow (force=false): only confirms when holdUntil is set AND has expired.
// - Force flow (force=true, "Подтвердить досрочно"): bypasses both checks, including
//   legacy commissions without holdUntil. Caller is expected to require a justification.
router.post('/partner-commissions/confirm', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n: number) => Number.isFinite(n)) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Не выбрано ни одной комиссии' });
    const force = !!req.body?.force;
    const now = Date.now();

    const results: { id: number; ok: boolean; reason?: string }[] = [];
    for (const id of ids) {
      try {
        const c = await storage.getCommissionById(id);
        if (!c) { results.push({ id, ok: false, reason: 'not found' }); continue; }
        if (c.status !== 'pending') { results.push({ id, ok: false, reason: `status=${c.status}` }); continue; }
        if (!force) {
          if (!c.holdUntil) { results.push({ id, ok: false, reason: 'awaiting payment (no hold)' }); continue; }
          const holdMs = c.holdUntil instanceof Date ? c.holdUntil.getTime() : new Date(c.holdUntil).getTime();
          if (holdMs > now) { results.push({ id, ok: false, reason: 'hold not expired' }); continue; }
        }
        await storage.updateCommissionStatus(id, 'confirmed');
        results.push({ id, ok: true });
      } catch (e: any) {
        results.push({ id, ok: false, reason: e?.message || 'error' });
      }
    }

    const okCount = results.filter(r => r.ok).length;
    res.json({ success: true, count: okCount, results });
  } catch (error: any) {
    console.error('[Admin Partners] confirm error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка подтверждения' });
  }
});

// Cancel a single commission (e.g. order refunded). Reverts totalEarned if was confirmed.
router.post('/partner-commissions/:id/cancel', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный ID' });
    const c = await storage.getCommissionById(id);
    if (!c) return res.status(404).json({ error: 'Комиссия не найдена' });
    if (c.status === 'cancelled') return res.json({ success: true });
    if (c.status === 'paid') return res.status(400).json({ error: 'Нельзя отменить уже выплаченную комиссию' });
    await storage.updateCommissionStatus(id, 'cancelled');
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Admin Partners] cancel error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка отмены' });
  }
});

// Delete a cancelled commission permanently (admin only)
router.delete('/partner-commissions/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный ID' });
    const c = await storage.getCommissionById(id);
    if (!c) return res.status(404).json({ error: 'Комиссия не найдена' });
    if (c.status !== 'cancelled') return res.status(400).json({ error: 'Можно удалять только отменённые комиссии' });
    await storage.deleteCommission(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Admin Partners] deleteCommission error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка удаления' });
  }
});

// Mark commissions as paid (legacy bulk action — DOES NOT create payout history record).
// Kept for backwards-compat. New flow uses /partner-commissions/payout below.
router.post('/partner-commissions/mark-paid', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n: number) => Number.isFinite(n)) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Не выбрано ни одной комиссии' });

    const affectedPartnerIds = new Set<number>();
    for (const id of ids) {
      try {
        const c = await storage.getCommissionById(id);
        if (c?.partnerId) affectedPartnerIds.add(c.partnerId);
      } catch {}
    }

    await storage.markCommissionsPaid(ids);

    for (const pid of Array.from(affectedPartnerIds)) {
      try { await storage.setPartnerPayoutRequested(pid, false); } catch {}
    }

    res.json({ success: true, count: ids.length });
  } catch (error: any) {
    console.error('[Admin Partners] mark-paid error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка отметки выплаты' });
  }
});

// Create a payout: marks selected commissions as paid AND writes a row to partner_payouts.
// Body: { partnerId, commissionIds: number[], method, recipientName, recipientDetails, note? }
// All commissions must belong to the same partner and be in "confirmed" status.
router.post('/partner-commissions/payout', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  // Парсим partnerId ДО try, чтобы замок ставить под верифицированный ключ.
  // Если partnerId невалидный — отдаём 400 сразу, без замка (нечего блокировать).
  const partnerId = Number(req.body?.partnerId);
  if (!Number.isFinite(partnerId)) {
    return res.status(400).json({ error: 'Неверный partnerId' });
  }

  // Single-session lock: защита от двойного клика "Создать выплату".
  // Если по этому партнёру уже идёт создание выплаты — отвечаем 409 и НЕ
  // выполняем второй запрос. Замок снимается в finally ниже либо по TTL.
  if (!acquirePayoutCreateLock(partnerId)) {
    return res.status(409).json({
      error: 'Создание выплаты по этому партнёру уже выполняется. Подождите несколько секунд и обновите страницу.',
    });
  }

  try {
    const commissionIds: number[] = Array.isArray(req.body?.commissionIds)
      ? req.body.commissionIds.map(Number).filter((n: number) => Number.isFinite(n))
      : [];
    const method = String(req.body?.method || '').trim();
    const recipientName = String(req.body?.recipientName || '').trim();
    const recipientDetails = String(req.body?.recipientDetails || '').trim();
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 1000) : null;

    if (commissionIds.length === 0) return res.status(400).json({ error: 'Не выбрано ни одной комиссии' });
    if (!method) return res.status(400).json({ error: 'Укажите способ выплаты' });
    if (!recipientName) return res.status(400).json({ error: 'Укажите ФИО получателя' });
    if (recipientName.length > 256) return res.status(400).json({ error: 'ФИО слишком длинное (макс 256 символов)' });
    if (!recipientDetails) return res.status(400).json({ error: 'Укажите реквизиты' });
    if (recipientDetails.length < 10) return res.status(400).json({ error: 'Реквизиты слишком короткие (мин 10 символов)' });
    if (recipientDetails.length > 1024) return res.status(400).json({ error: 'Реквизиты слишком длинные (макс 1024 символа)' });

    // Validate all commissions belong to partner & are confirmed; sum amount
    let totalAmount = 0;
    for (const id of commissionIds) {
      const c = await storage.getCommissionById(id);
      if (!c) return res.status(400).json({ error: `Комиссия #${id} не найдена` });
      if (c.partnerId !== partnerId) return res.status(400).json({ error: `Комиссия #${id} принадлежит другому партнёру` });
      if (c.status !== 'confirmed') return res.status(400).json({ error: `Комиссия #${id}: статус "${c.status}", нужен "confirmed"` });
      totalAmount += c.commissionAmount;
    }

    // 1) Mark all paid (sequentially — preserves totalEarned consistency)
    await storage.markCommissionsPaid(commissionIds);

    // 2) Create payout history record
    const payout = await storage.createPartnerPayout({
      partnerId,
      amount: totalAmount,
      commissionIds,
      method,
      recipientName,
      recipientDetails,
      note,
      createdBy: req.user?.email || null,
    });

    // 3) Clear payoutRequested flag
    try { await storage.setPartnerPayoutRequested(partnerId, false); } catch {}

    auditPayout(req, 'create', payout.id, {
      partnerId,
      amount: totalAmount,
      commissionsCount: commissionIds.length,
      method,
    });
    res.json({ success: true, payout, count: commissionIds.length });
  } catch (error: any) {
    console.error('[Admin Partners] payout error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка создания выплаты' });
  } finally {
    // Замок снимаем ВСЕГДА — и при успехе, и при 4xx-ответе валидации,
    // и при 5xx-исключении. Иначе партнёр будет залочен на 60 секунд зря.
    releasePayoutCreateLock(partnerId);
  }
});

// List payouts (optionally filtered by partnerId)
router.get('/partner-payouts', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const partnerId = req.query.partnerId ? Number(req.query.partnerId) : undefined;
    const payouts = await storage.listPartnerPayouts(Number.isFinite(partnerId as number) ? (partnerId as number) : undefined);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ payouts });
  } catch (error: any) {
    console.error('[Admin Partners] payouts list error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка получения выплат' });
  }
});

// Скачать счёт партнёра (admin). X-API-Key передаётся через ?key= в URL,
// потому что браузер сам не шлёт заголовок при переходе по <a href>.
router.get('/partner-payouts/:id/invoice', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный id' });
    const payout = await storage.getPayoutById(id);
    if (!payout) return res.status(404).json({ error: 'Выплата не найдена' });
    if (!payout.invoiceUrl) return res.status(404).json({ error: 'Счёт не загружен' });
    const file = await downloadPayoutDocument(payout.invoiceUrl);
    if (!file) return res.status(500).json({ error: 'Файл недоступен' });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${id}"`);
    res.send(file.buffer);
  } catch (error: any) {
    console.error('[Admin Partners] invoice download error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка' });
  }
});

// Скачать акт партнёра (admin). X-API-Key через ?key= в URL.
// Используется для ИП и ЮЛ — у самозанятых вместо акта чек НПД (см. /receipt ниже).
router.get('/partner-payouts/:id/act', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный id' });
    const payout = await storage.getPayoutById(id);
    if (!payout) return res.status(404).json({ error: 'Выплата не найдена' });
    if (!payout.actUrl) return res.status(404).json({ error: 'Акт не загружен' });
    const file = await downloadPayoutDocument(payout.actUrl);
    if (!file) return res.status(500).json({ error: 'Файл недоступен' });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Content-Disposition', `inline; filename="act-${id}"`);
    res.send(file.buffer);
  } catch (error: any) {
    console.error('[Admin Partners] act download error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка' });
  }
});

// Скачать чек партнёра (admin). X-API-Key через ?key= в URL (см. выше).
router.get('/partner-payouts/:id/receipt', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный id' });
    const payout = await storage.getPayoutById(id);
    if (!payout) return res.status(404).json({ error: 'Выплата не найдена' });
    if (!payout.receiptUrl) return res.status(404).json({ error: 'Чек не загружен' });
    const file = await downloadPayoutDocument(payout.receiptUrl);
    if (!file) return res.status(500).json({ error: 'Файл недоступен' });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${id}"`);
    res.send(file.buffer);
  } catch (error: any) {
    console.error('[Admin Partners] receipt download error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка' });
  }
});

// Админ отмечает: «Я оплатил».
// Переход invoice_uploaded → paid_pending_receipt (СЗ) | paid_pending_act (ИП/ЮЛ).
// Решение принимается по partner.legalStatus (см. shared/schema.ts: PARTNER_LEGAL_STATUSES).
// Body: { paidReference?: string } — номер платёжного поручения (опционально, для аудита).
router.post('/partner-payouts/:id/mark-paid', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный id' });
    const paidReference = req.body?.paidReference
      ? String(req.body.paidReference).trim().slice(0, 128)
      : null;

    const payout = await storage.getPayoutById(id);
    if (!payout) return res.status(404).json({ error: 'Выплата не найдена' });
    if (payout.status !== 'invoice_uploaded') {
      return res.status(400).json({ error: `Нельзя отметить оплаченной: текущий статус «${payout.status}»` });
    }

    // Определяем следующий статус и тип закрывающего документа по статусу партнёра.
    // ip / ooo → акт; всё остальное (включая legacy NULL и self_employed) → чек НПД.
    const partner = await storage.getPartnerById(payout.partnerId);
    const isLegalEntity = partner?.legalStatus === 'ip' || partner?.legalStatus === 'ooo';
    const nextStatus = isLegalEntity ? 'paid_pending_act' : 'paid_pending_receipt';
    const documentKind: 'receipt' | 'act' = isLegalEntity ? 'act' : 'receipt';

    await storage.updatePartnerPayoutFields(id, {
      status: nextStatus,
      paidAt: new Date(),
      paidReference,
    });
    auditPayout(req, 'mark-paid', id, {
      partnerId: payout.partnerId,
      amount: payout.amount,
      paidReference,
      legalStatus: partner?.legalStatus || null,
      nextStatus,
    });
    res.json({ success: true, status: nextStatus });

    // Email партнёру: деньги переведены, нужен чек/акт
    try {
      if (partner?.contactEmail) {
        const amountRub = fmtRubEmail(payout.amount);
        const partnerName = payout.recipientName || partner.contactName || 'Партнёр';
        const docWord = isLegalEntity ? 'акт' : 'чек';
        await sendEmail({
          to: partner.contactEmail,
          subject: `Выплата ${amountRub} ₽ переведена — загрузите ${docWord} — BOOOMERANGS`,
          html: getPayoutPaidEmailHtml(partnerName, amountRub, documentKind),
        });
      }
    } catch (notifyErr: any) {
      console.error('[Admin Partners] mark-paid email error:', notifyErr?.message);
    }
  } catch (error: any) {
    console.error('[Admin Partners] mark-paid error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка' });
  }
});

// Админ завершает выплату после проверки закрывающего документа.
// Переход paid_pending_receipt (+ receiptUrl) | paid_pending_act (+ actUrl) → completed.
router.post('/partner-payouts/:id/complete', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный id' });
    const payout = await storage.getPayoutById(id);
    if (!payout) return res.status(404).json({ error: 'Выплата не найдена' });

    if (payout.status === 'paid_pending_receipt') {
      if (!payout.receiptUrl) {
        return res.status(400).json({ error: 'Партнёр ещё не загрузил чек из «Мой налог»' });
      }
    } else if (payout.status === 'paid_pending_act') {
      if (!payout.actUrl) {
        return res.status(400).json({ error: 'Партнёр ещё не загрузил акт оказанных услуг' });
      }
    } else {
      return res.status(400).json({ error: `Нельзя завершить: текущий статус «${payout.status}»` });
    }

    await storage.updatePartnerPayoutFields(id, {
      status: 'completed',
      completedAt: new Date(),
    });

    // Переводим комиссии в paid только здесь — когда выплата реально завершена.
    // (До этого момента комиссии остаются confirmed, чтобы партнёр видел корректный
    //  статус "Доступно к выплате" → а не ложное "Выплачено".)
    try {
      const parsedIds: unknown = JSON.parse(payout.commissionIds || '[]');
      if (Array.isArray(parsedIds)) {
        const commIds = (parsedIds as unknown[]).map(Number).filter((n) => Number.isFinite(n));
        if (commIds.length > 0) {
          await storage.markCommissionsPaid(commIds);
        }
      }
    } catch (e: any) {
      console.error('[Admin Partners] complete: markCommissionsPaid error:', e?.message);
    }

    auditPayout(req, 'complete', id, {
      partnerId: payout.partnerId,
      amount: payout.amount,
      previousStatus: payout.status,
      receiptNumber: payout.receiptNumber,
      actNumber: payout.actNumber,
    });
    res.json({ success: true, status: 'completed' });

    // Email партнёру: выплата полностью завершена
    try {
      const partner = await storage.getPartnerById(payout.partnerId);
      if (partner?.contactEmail) {
        const amountRub = fmtRubEmail(payout.amount);
        const partnerName = payout.recipientName || partner.contactName || 'Партнёр';
        await sendEmail({
          to: partner.contactEmail,
          subject: `Выплата ${amountRub} ₽ завершена — BOOOMERANGS`,
          html: getPayoutCompletedEmailHtml(partnerName, amountRub),
        });
      }
    } catch (notifyErr: any) {
      console.error('[Admin Partners] complete email error:', notifyErr?.message);
    }
  } catch (error: any) {
    console.error('[Admin Partners] complete error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка' });
  }
});

// Админ отклоняет выплату с указанием причины. Возможен на любом этапе кроме completed.
// Body: { reason: string, confirmPaidExternally?: boolean } (reason: 3..500 символов).
//
// Поведение по статусам:
//   • awaiting_invoice / invoice_uploaded — деньги ещё не отправлены, поэтому
//     все комиссии этой выплаты ОТКАТЫВАЮТСЯ из 'paid' в 'confirmed' и снова
//     становятся доступны партнёру для повторного вывода.
//   • paid_pending_receipt / paid_pending_act — деньги уже переведены партнёру
//     (нажимали «Я оплатил»). Комиссии НЕ откатываются — они остаются 'paid'.
//     Чтобы избежать случайного отклонения «оплаченной» выплаты, требуем явный
//     флаг confirmPaidExternally=true.
router.post('/partner-payouts/:id/reject', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный id' });
    const reason = req.body?.reason ? String(req.body.reason).trim() : '';
    if (reason.length < 3) return res.status(400).json({ error: 'Укажите причину (не менее 3 символов)' });
    if (reason.length > 500) return res.status(400).json({ error: 'Причина слишком длинная (макс 500 символов)' });
    const confirmPaidExternally = req.body?.confirmPaidExternally === true;

    const payout = await storage.getPayoutById(id);
    if (!payout) return res.status(404).json({ error: 'Выплата не найдена' });
    if (payout.status === 'completed') {
      return res.status(400).json({ error: 'Завершённую выплату отклонить нельзя' });
    }
    if (payout.status === 'rejected') {
      return res.status(400).json({ error: 'Выплата уже отклонена' });
    }

    // Если деньги уже отправлены — без явного подтверждения не даём отклонить.
    const moneyAlreadySent =
      payout.status === 'paid_pending_receipt' || payout.status === 'paid_pending_act';
    if (moneyAlreadySent && !confirmPaidExternally) {
      const docLabel = payout.status === 'paid_pending_act' ? 'акт' : 'чек';
      return res.status(409).json({
        code: 'PAID_EXTERNALLY_CONFIRMATION_REQUIRED',
        error: `Деньги по этой выплате уже переведены партнёру (статус «Оплачено, ждём ${docLabel}»). При отклонении комиссии НЕ вернутся в "Доступно к выплате" — они останутся со статусом "Выплачено". Если вы уверены, передайте confirmPaidExternally=true.`,
      });
    }

    // Откат комиссий (только когда деньги ещё не уходили)
    let revertedIds: number[] = [];
    if (payout.status === 'awaiting_invoice' || payout.status === 'invoice_uploaded') {
      try {
        const ids: unknown = JSON.parse(payout.commissionIds || '[]');
        if (Array.isArray(ids)) {
          for (const cid of ids) {
            const n = Number(cid);
            if (!Number.isFinite(n)) continue;
            try {
              await storage.updateCommissionStatus(n, 'confirmed');
              revertedIds.push(n);
            } catch (e: any) {
              console.error(`[Admin Partners] reject: failed to revert commission #${n}:`, e?.message);
            }
          }
        }
      } catch (e: any) {
        console.error('[Admin Partners] reject: failed to parse commissionIds JSON:', e?.message);
      }
    }

    await storage.updatePartnerPayoutFields(id, {
      status: 'rejected',
      rejectedReason: reason.slice(0, 500),
    });

    auditPayout(req, 'reject', id, {
      partnerId: payout.partnerId,
      amount: payout.amount,
      previousStatus: payout.status,
      reason: reason.slice(0, 200),
      revertedCommissions: revertedIds.length,
      moneyAlreadySent,
      confirmPaidExternally,
    });

    res.json({
      success: true,
      status: 'rejected',
      revertedCommissions: revertedIds.length,
      moneyAlreadySent,
    });

    // Email партнёру: выплата отклонена + причина
    try {
      const partner = await storage.getPartnerById(payout.partnerId);
      if (partner?.contactEmail) {
        const amountRub = fmtRubEmail(payout.amount);
        const partnerName = payout.recipientName || partner.contactName || 'Партнёр';
        await sendEmail({
          to: partner.contactEmail,
          subject: `Выплата ${amountRub} ₽ отклонена — BOOOMERANGS`,
          html: getPayoutRejectedEmailHtml(partnerName, amountRub, reason),
        });
      }
    } catch (notifyErr: any) {
      console.error('[Admin Partners] reject email error:', notifyErr?.message);
    }
  } catch (error: any) {
    console.error('[Admin Partners] reject error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка' });
  }
});

// Get / set global commission percent + hold-period
router.get('/partner-settings', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const [globalPercent, holdDays] = await Promise.all([
      storage.getGlobalPartnerCommissionPercent(),
      storage.getGlobalPartnerHoldDays(),
    ]);
    res.json({ globalPercent, holdDays });
  } catch (error: any) {
    console.error('[Admin Partners] settings get error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка получения настроек' });
  }
});

router.patch('/partner-settings', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body || {};
    const updates: string[] = [];

    if (body.globalPercent !== undefined && body.globalPercent !== null) {
      const n = Number(body.globalPercent);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: 'Процент должен быть от 0 до 100' });
      }
      await storage.setGlobalPartnerCommissionPercent(n);
      invalidateGlobalCommissionPercentCache();
      updates.push('globalPercent');
    }

    if (body.holdDays !== undefined && body.holdDays !== null) {
      const n = Number(body.holdDays);
      if (!Number.isFinite(n) || n < 0 || n > 365) {
        return res.status(400).json({ error: 'Период удержания должен быть от 0 до 365 дней' });
      }
      await storage.setGlobalPartnerHoldDays(n);
      invalidateGlobalHoldDaysCache();
      updates.push('holdDays');
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    const [globalPercent, holdDays] = await Promise.all([
      storage.getGlobalPartnerCommissionPercent(),
      storage.getGlobalPartnerHoldDays(),
    ]);
    res.json({ success: true, globalPercent, holdDays, updated: updates });
  } catch (error: any) {
    console.error('[Admin Partners] settings set error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка обновления настроек' });
  }
});

// ============================================================================
// Юридические документы (версионируемые) — управление и просмотр
// ============================================================================

router.get('/legal-documents', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const slug = (req.query.slug as string) || undefined;
    const docs = await storage.listLegalDocuments(slug);
    // Не отдаём полное тело в списке — только метаинформацию
    const slim = docs.map((d) => ({
      id: d.id,
      slug: d.slug,
      version: d.version,
      title: d.title,
      bodyHash: d.bodyHash,
      isActive: d.isActive,
      createdAt: d.createdAt,
      createdBy: d.createdBy,
      bodyLength: (d.body || '').length,
    }));
    res.json({ items: slim });
  } catch (e: any) {
    console.error('[Admin Legal] list error:', e);
    res.status(500).json({ error: e?.message || 'Ошибка загрузки документов' });
  }
});

router.get('/legal-documents/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const doc = await storage.getLegalDocumentById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    res.json({ document: doc });
  } catch (e: any) {
    console.error('[Admin Legal] get error:', e);
    res.status(500).json({ error: e?.message || 'Ошибка' });
  }
});

router.post('/legal-documents', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug, version, title, body } = req.body || {};
    if (!slug || !LEGAL_DOCUMENT_SLUGS.includes(slug)) {
      return res.status(400).json({ error: `Некорректный slug. Допустимые: ${LEGAL_DOCUMENT_SLUGS.join(', ')}` });
    }
    if (!version || typeof version !== 'string' || version.length > 32) {
      return res.status(400).json({ error: 'Укажите version (строка ≤ 32 символов)' });
    }
    if (!title || typeof title !== 'string' || title.length > 200) {
      return res.status(400).json({ error: 'Укажите title (строка ≤ 200 символов)' });
    }
    if (!body || typeof body !== 'string' || body.length < 10) {
      return res.status(400).json({ error: 'Body не должен быть пустым' });
    }
    const created = await storage.createLegalDocument({
      slug,
      version,
      title,
      body,
      createdBy: req.user?.email || null,
    });
    res.json({ document: created });
  } catch (e: any) {
    console.error('[Admin Legal] create error:', e);
    res.status(500).json({ error: e?.message || 'Ошибка публикации документа' });
  }
});

router.get('/partners/:id/consent-signatures', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const partnerId = parseInt(req.params.id, 10);
    if (!Number.isFinite(partnerId)) return res.status(400).json({ error: 'Некорректный ID' });
    const rawSignatures = await storage.listConsentSignaturesByPartnerId(partnerId);
    // Авто-флаг для каждой подписи: true/false/null — см. /partners выше.
    const signatures = rawSignatures.map((s: any) => ({
      ...s,
      remoteIpInYandex: isYandexCloudOrPrivateIp(s.remoteIp),
    }));
    res.json({ signatures });
  } catch (e: any) {
    console.error('[Admin Legal] signatures error:', e);
    res.status(500).json({ error: e?.message || 'Ошибка' });
  }
});

// PDF-выгрузка всех подписанных партнёром документов
// (включает каждый текст полностью + метаданные подписания: IP, дата, версия, хэш)
router.get('/partners/:id/legal-pdf', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const partnerId = parseInt(req.params.id, 10);
    if (!Number.isFinite(partnerId)) return res.status(400).json({ error: 'Некорректный ID' });
    const partner = await storage.getPartnerById(partnerId);
    if (!partner) return res.status(404).json({ error: 'Партнёр не найден' });
    const signatures = await storage.listConsentSignaturesByPartnerId(partnerId);
    if (signatures.length === 0) {
      return res.status(404).json({ error: 'У партнёра нет подписанных документов' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="partner-${partnerId}-legal.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    doc.pipe(res);

    // Регистрируем кириллический шрифт (server/invoice.ts использует тот же подход)
    try {
      const fs = await import('fs');
      const path = await import('path');
      const fontDir = path.join(process.cwd(), 'server', 'fonts');
      const regular = path.join(fontDir, 'Roboto-Regular.ttf');
      const bold = path.join(fontDir, 'Roboto-Bold.ttf');
      if (fs.existsSync(regular)) {
        doc.registerFont('Cyr', regular);
        if (fs.existsSync(bold)) {
          doc.registerFont('Cyr-Bold', bold);
        }
        doc.font('Cyr');
      } else {
        console.warn('[Admin Legal PDF] Кириллический шрифт не найден:', regular);
      }
    } catch (e) {
      console.warn('[Admin Legal PDF] Ошибка загрузки шрифта:', (e as any)?.message);
    }

    // Шапка
    doc.fontSize(18).text('Подписанные юридические документы', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Партнёр: ${partner.contactName} (${partner.contactEmail})`);
    doc.text(`ID партнёра: ${partner.id}`);
    doc.text(`Идентификатор магазина: ${partner.partnerSlug}`);
    doc.text(`Юридический статус: ${partner.legalStatus || 'не указан'}`);
    doc.text(`ИНН: ${partner.inn || '—'}`);
    doc.text(`Сформировано: ${new Date().toLocaleString('ru-RU')}`);
    doc.moveDown(1);

    for (const sig of signatures) {
      doc.addPage();
      doc.fontSize(14).text(`Документ: ${sig.documentSlug}`, { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10);
      doc.text(`Версия: ${sig.documentVersion}`);
      doc.text(`Хэш SHA-256: ${sig.documentHash}`);
      doc.text(`Подписано: ${new Date(sig.signedAt).toLocaleString('ru-RU')}`);
      doc.text(`IP подписавшего: ${sig.ip}`);
      // Anti-spoof форензика (30.04.2026): второй независимый IP-источник.
      // sig.remoteIp = req.socket.remoteAddress на момент подписания. Подделать невозможно.
      // Должен принадлежать диапазонам Yandex Cloud Gateway. Если не указан — подпись legacy.
      if ((sig as any).remoteIp) {
        const remoteIp = (sig as any).remoteIp;
        const inYc = isYandexCloudOrPrivateIp(remoteIp);
        const verdict = inYc === true
          ? ' [OK: входит в доверенные диапазоны Yandex Cloud / приватные сети]'
          : inYc === false
            ? ' [ВНИМАНИЕ: НЕ входит в диапазоны Yandex Cloud — возможен обход API Gateway]'
            : '';
        doc.text(`Реальный IP TCP-сокета: ${remoteIp}${verdict}`);
      }
      // GeoIP (30.04.2026): страна/регион/город на момент подписания.
      const geoLine = [(sig as any).consentCountry, (sig as any).consentRegion, (sig as any).consentCity].filter(Boolean).join(', ');
      if (geoLine) {
        doc.text(`Геолокация (GeoIP): ${geoLine}`);
      }
      doc.text(`User-Agent: ${(sig.userAgent || '').substring(0, 200)}`);
      doc.text(`Способ подписания: ${sig.method}`);
      doc.moveDown(0.6);
      // Полный текст документа на момент подписания
      const fullDoc = await storage.getLegalDocumentById(sig.documentId);
      const body = fullDoc?.body || '(текст документа не найден)';
      // Контрольная проверка: пересчитываем хэш и сверяем
      const verify = createHash('sha256').update(body, 'utf8').digest('hex');
      const integrity = (fullDoc && verify === sig.documentHash) ? 'OK' : 'НАРУШЕНА';
      doc.text(`Целостность хэша: ${integrity}`);
      doc.moveDown(0.6);
      doc.fontSize(11).text('— Текст документа —', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(9).text(body, { align: 'left' });
    }

    doc.end();
  } catch (e: any) {
    console.error('[Admin Legal PDF] error:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e?.message || 'Ошибка генерации PDF' });
    }
  }
});

// Легаси-артисты: существуют как страницы /@slug, но не имеют записи в partners
const LEGACY_ARTISTS: Array<{ id: number; partnerSlug: string; storeName: string; contactName: string }> = [
  { id: -1, partnerSlug: 'molodostvnutri', storeName: 'Молодость внутри', contactName: 'Молодость внутри' },
  { id: -2, partnerSlug: 'goodtimes',      storeName: 'ГУДТАЙМС',          contactName: 'ГУДТАЙМС' },
  { id: -3, partnerSlug: 'dikaya-myata',   storeName: 'ДИКАЯ МЯТА',        contactName: 'ДИКАЯ МЯТА' },
  { id: -4, partnerSlug: 'dragni',         storeName: 'ДРАГНИ',            contactName: 'ДРАГНИ' },
  { id: -5, partnerSlug: 'multfilmy',      storeName: 'МультFильмы',       contactName: 'МультFильмы' },
];

// GET /api/admin/partners/artists — список партнёров с is_artist=true + легаси-артисты
router.get('/partners/artists', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const dbArtists = await storage.getArtistPartners();
    const dbSlugs = new Set(dbArtists.map((a: any) => a.partnerSlug));
    // Добавляем легаси-артистов которых ещё нет в БД
    const legacy = LEGACY_ARTISTS.filter((a) => !dbSlugs.has(a.partnerSlug));
    const artists = [...dbArtists, ...legacy];
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ artists });
  } catch (error: any) {
    console.error('[Admin Artists] list error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка получения списка артистов' });
  }
});

// PATCH /api/admin/partners/:id/homepage — включить/выключить артиста на главной странице
router.patch('/partners/:id/homepage', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный ID' });
    const { visible } = req.body || {};
    if (typeof visible !== 'boolean') {
      return res.status(400).json({ error: 'visible должен быть boolean' });
    }

    const partner = await storage.getPartnerById(id);
    if (!partner) return res.status(404).json({ error: 'Партнёр не найден' });
    if (!partner.isArtist || !partner.partnerSlug) {
      return res.status(400).json({ error: 'Партнёр не является артистом или не имеет slug' });
    }

    const slug = partner.partnerSlug;

    // Читаем текущие настройки главной страницы
    const homeSettings = await storage.getPageSettings('home');
    const currentArtists = homeSettings?.artists || { title: 'Наши артисты', subtitle: 'Коллаборации', linkText: 'Весь мерч', linkUrl: '/products?category=merch', visible: true, items: [] };
    const currentItems: any[] = currentArtists.items || [];

    let updatedItems: any[];

    if (visible) {
      // Проверяем что артист ещё не добавлен
      const alreadyAdded = currentItems.some((a: any) => a.slug === slug);
      if (!alreadyAdded) {
        // Берём данные со страницы артиста
        let artistPageData: any = {};
        try {
          const artistPages = await storage.getPageSettings('artist_pages');
          artistPageData = artistPages?.[slug] || {};
        } catch {}

        const name = artistPageData.name || partner.storeName || partner.contactName || slug;
        const role = artistPageData.role || '';
        const image = artistPageData.cardImage || artistPageData.heroImage || '';

        updatedItems = [...currentItems, { name, role, image, slug, collection: '', link: `/@${slug}` }];
      } else {
        updatedItems = currentItems;
      }
    } else {
      updatedItems = currentItems.filter((a: any) => a.slug !== slug);
    }

    const updatedArtists = { ...currentArtists, items: updatedItems };
    await storage.setPageSectionSettings('home', 'artists', updatedArtists);

    console.log(`[Admin Artists] Partner ${slug} homepage visibility set to ${visible} by ${req.user?.email || 'api-key'}`);
    res.json({ success: true, items: updatedItems });
  } catch (error: any) {
    console.error('[Admin Artists] homepage toggle error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка обновления видимости на главной' });
  }
});

// PATCH /api/admin/partners/:id/artist-rate — задать процент артиста
router.patch('/partners/:id/artist-rate', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный ID' });
    const { rate } = req.body || {};
    const value = rate === null || rate === undefined || rate === '' ? null : Number(rate);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
      return res.status(400).json({ error: 'rate должен быть числом от 0 до 100 или null' });
    }
    const partner = await storage.getPartnerById(id);
    if (!partner) return res.status(404).json({ error: 'Партнёр не найден' });
    await storage.updatePartnerArtistRate(id, value);
    const updated = await storage.getPartnerById(id);
    res.json({ success: true, partner: updated });
  } catch (error: any) {
    console.error('[Admin Artists] artist-rate error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка обновления процента артиста' });
  }
});

// PATCH /api/admin/partners/:id/artist — включить/выключить статус артиста
router.patch('/partners/:id/artist', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный ID' });
    const { isArtist } = req.body || {};
    if (typeof isArtist !== 'boolean') {
      return res.status(400).json({ error: 'isArtist должен быть boolean' });
    }
    const partner = await storage.getPartnerById(id);
    if (!partner) return res.status(404).json({ error: 'Партнёр не найден' });
    await storage.updatePartnerIsArtist(id, isArtist);
    const updated = await storage.getPartnerById(id);
    res.json({ success: true, partner: updated });
  } catch (error: any) {
    console.error('[Admin Artists] toggle error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка обновления статуса артиста' });
  }
});

// POST /api/admin/partners/create-artist — создать артиста вручную (минуя форму регистрации)
router.post('/partners/create-artist', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, slug, artistRate, commissionOverride } = req.body || {};

    // Валидация обязательных полей
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Укажите имя артиста' });
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Укажите email' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }
    if (!slug || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug.trim())) {
      return res.status(400).json({ error: 'Slug должен содержать только строчные латинские буквы, цифры и дефисы, и не начинаться/заканчиваться дефисом' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanSlug = slug.trim().toLowerCase();
    const cleanName = name.trim();

    // Проверяем что email не занят партнёром
    const existingUser = await authStorage.getUserByEmailAndRole(cleanEmail, 'partner');
    if (existingUser) {
      return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    }

    // Проверяем что slug не занят
    const existingPartner = await storage.getPartnerBySlug(cleanSlug);
    if (existingPartner) {
      return res.status(409).json({ error: `Slug «${cleanSlug}» уже занят другим партнёром` });
    }

    // Валидация числовых полей
    let artistRateVal = 0;
    if (artistRate !== undefined && artistRate !== null && artistRate !== '') {
      const n = Number(artistRate);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: '% артиста должен быть от 0 до 100' });
      }
      artistRateVal = n;
    }
    let commissionOverrideVal: number | null = null;
    if (commissionOverride !== undefined && commissionOverride !== null && commissionOverride !== '') {
      const n = Number(commissionOverride);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: '% комиссии должен быть от 0 до 100' });
      }
      commissionOverrideVal = Math.round(n);
    }

    // Хэшируем пароль
    const passwordHash = await bcrypt.hash(password, 12);

    // Создаём пользователя (email_verified=true сразу, без подтверждения)
    const user = await authStorage.createPartnerUser({
      email: cleanEmail,
      passwordHash,
      name: cleanName,
      verificationToken: '',
    });
    if (!user) {
      return res.status(500).json({ error: 'Не удалось создать пользователя' });
    }

    // Создаём партнёра (createPartner хардкодит status='pending')
    const partner = await storage.createPartner({
      userId: user.id,
      partnerSlug: cleanSlug,
      storeName: cleanName,
      contactName: cleanName,
      contactEmail: cleanEmail,
      isArtist: true,
      artistRate: artistRateVal,
      commissionOverride: commissionOverrideVal,
    } as any, []);

    // Сразу переводим в approved (минуем модерацию)
    await storage.updatePartnerStatus(partner.id, 'approved');

    // Инвалидируем кэш slug
    invalidatePartnerSlugCache(cleanSlug);

    console.log(`[Admin Artists] Created artist manually: slug=${cleanSlug} email=${cleanEmail} by ${req.user?.email || 'api-key'}`);

    const updated = await storage.getPartnerById(partner.id);
    res.json({ success: true, partner: updated });
  } catch (error: any) {
    console.error('[Admin Artists] create-artist error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка создания артиста' });
  }
});

// DELETE /api/admin/partners/:id — полное удаление партнёра из БД
router.delete('/partners/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный ID' });
    const partner = await storage.getPartnerById(id);
    if (!partner) return res.status(404).json({ error: 'Партнёр не найден' });
    invalidatePartnerSlugCache(partner.partnerSlug);
    await storage.deletePartner(id);
    console.log(`[Admin Partners] Partner ${id} (${partner.partnerSlug}) deleted by ${req.user?.email || 'api-key'}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Admin Partners] delete error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка удаления партнёра' });
  }
});

export default router;
