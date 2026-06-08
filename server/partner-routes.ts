import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { storage } from './storage';
import { authMiddleware, requirePartnerRole, AuthRequest } from './auth-routes';
import { uploadPayoutDocument, downloadPayoutDocument } from './lib/storage-s3';
import { notifyPayoutInvoiceUploaded, notifyPartnerFeedback } from './telegram';
import { vkNotifyPartnerFeedback } from './vk';
import { generatePartnerPayoutInvoicePDF } from './invoice';
import {
  PARTNER_COOKIE_NAME,
  PARTNER_COOKIE_MAX_AGE_DAYS,
  PARTNER_DEFAULT_COMMISSION_PERCENT,
  PARTNER_PAYOUT_MIN_KOPEKS,
  PARTNER_DEFAULT_HOLD_DAYS,
  PARTNER_PROGRESSIVE_TIERS,
  getProgressiveCommissionRate,
} from '@shared/schema';

// Multer для приёма счетов и чеков самозанятых (in-memory, до 25 MB).
// PDF/JPG/PNG/WebP — стандартные форматы «Мой налог»; HEIC/HEIF — фото с iPhone
// (часто пользователи просто фотографируют чек прямо в приложении).
const PAYOUT_DOC_MAX_SIZE = 25 * 1024 * 1024; // 25 MB
const PAYOUT_DOC_MAX_SIZE_LABEL = "25 МБ";
const PAYOUT_DOC_ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const PAYOUT_DOC_EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};
const payoutDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PAYOUT_DOC_MAX_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (PAYOUT_DOC_ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new Error("Разрешены только PDF, JPG, PNG, WebP, HEIC или HEIF"));
  },
});

// In-memory lock для защиты от race-condition при двойной загрузке
// одного и того же документа (TOCTOU между getPayoutById и updatePartnerPayoutFields).
// Структура: payoutId → kind ("invoice" | "receipt"). Один контейнер = одна Map,
// этого достаточно для production single-instance в Yandex Cloud Container.
const payoutUploadLocks = new Map<string, number>(); // key = `${payoutId}:${kind}`, value = ts
const PAYOUT_UPLOAD_LOCK_TTL_MS = 60_000;
type PayoutDocKind = 'invoice' | 'receipt' | 'act';
function acquirePayoutLock(payoutId: number, kind: PayoutDocKind): boolean {
  const key = `${payoutId}:${kind}`;
  const now = Date.now();
  const existing = payoutUploadLocks.get(key);
  if (existing && now - existing < PAYOUT_UPLOAD_LOCK_TTL_MS) return false;
  payoutUploadLocks.set(key, now);
  return true;
}
function releasePayoutLock(payoutId: number, kind: PayoutDocKind) {
  payoutUploadLocks.delete(`${payoutId}:${kind}`);
}

// Мьютекс против двойного создания выплаты при двойном нажатии «Запросить выплату».
const payoutRequestLocks = new Map<number, number>(); // partnerId → ts
const PAYOUT_REQUEST_LOCK_TTL_MS = 60_000;
function acquirePayoutRequestLock(partnerId: number): boolean {
  const now = Date.now();
  const existing = payoutRequestLocks.get(partnerId);
  if (existing && now - existing < PAYOUT_REQUEST_LOCK_TTL_MS) return false;
  payoutRequestLocks.set(partnerId, now);
  return true;
}
function releasePayoutRequestLock(partnerId: number) {
  payoutRequestLocks.delete(partnerId);
}

const router = Router();

const PROD_COOKIE_DOMAIN = process.env.NODE_ENV === 'production' ? '.booomerangs.ru' : undefined;

function refCookieOptions(isSecure: boolean): object {
  return {
    httpOnly: false,
    secure: isSecure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: PARTNER_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    ...(PROD_COOKIE_DOMAIN ? { domain: PROD_COOKIE_DOMAIN } : {}),
  };
}

function isSecureRequest(req: Request): boolean {
  return process.env.NODE_ENV === 'production'
    || req.protocol === 'https'
    || req.headers['x-forwarded-proto'] === 'https';
}

const SLUG_RE = /^[a-z0-9-]{3,32}$/;
const slugCheckCache = new Map<string, { ok: boolean; ts: number }>();
const SLUG_CACHE_TTL_MS = 60 * 1000;

// Cache for full Partner object — used by hot path POST /api/orders to avoid YDB fullscan
const partnerObjectCache = new Map<string, { partner: any; ts: number }>();
const PARTNER_OBJECT_CACHE_TTL_MS = 60 * 1000;

// Cache for global commission percent — bonus_settings lookup is slow
let globalCommissionPercentCache: { value: number; ts: number } | null = null;
const GLOBAL_PERCENT_CACHE_TTL_MS = 60 * 1000;

// Cache for global hold-period (in days) — read by webhooks (hot path)
let globalHoldDaysCache: { value: number; ts: number } | null = null;
const GLOBAL_HOLD_DAYS_CACHE_TTL_MS = 60 * 1000;

export function invalidatePartnerSlugCache(slug?: string) {
  if (slug) {
    slugCheckCache.delete(slug);
    partnerObjectCache.delete(slug);
  } else {
    slugCheckCache.clear();
    partnerObjectCache.clear();
  }
}

export function invalidateGlobalCommissionPercentCache() {
  globalCommissionPercentCache = null;
}

export function invalidateGlobalHoldDaysCache() {
  globalHoldDaysCache = null;
}

/**
 * Cached partner-hold-days. Called by payment webhooks to compute hold_until on attribution.
 * Default = 14 days.
 */
export async function getGlobalPartnerHoldDaysCached(): Promise<number> {
  const now = Date.now();
  if (globalHoldDaysCache && now - globalHoldDaysCache.ts < GLOBAL_HOLD_DAYS_CACHE_TTL_MS) {
    return globalHoldDaysCache.value;
  }
  try {
    const value = await storage.getGlobalPartnerHoldDays();
    globalHoldDaysCache = { value, ts: now };
    return value;
  } catch (e) {
    console.error('[Partner] getGlobalPartnerHoldDaysCached error:', (e as any)?.message);
    return PARTNER_DEFAULT_HOLD_DAYS;
  }
}

/**
 * Returns approved Partner object (full record) for the given slug, or null.
 * Used by POST /api/orders hot path. Cached for 60s to avoid fullscan on every order.
 */
export async function getApprovedPartnerCached(slug: string): Promise<any | null> {
  if (!SLUG_RE.test(slug)) return null;
  const now = Date.now();
  const cached = partnerObjectCache.get(slug);
  if (cached && now - cached.ts < PARTNER_OBJECT_CACHE_TTL_MS) {
    return cached.partner;
  }
  let partner: any = null;
  try {
    const p = await storage.getPartnerBySlug(slug);
    partner = (p && p.status === 'approved') ? p : null;
  } catch (e) {
    // On error, don't cache — let next call retry
    console.error('[Partner] getApprovedPartnerCached error:', (e as any)?.message);
    return null;
  }
  partnerObjectCache.set(slug, { partner, ts: now });
  return partner;
}

/**
 * Cached version of storage.getGlobalPartnerCommissionPercent() for hot path.
 */
export async function getGlobalPartnerCommissionPercentCached(): Promise<number> {
  const now = Date.now();
  if (globalCommissionPercentCache && now - globalCommissionPercentCache.ts < GLOBAL_PERCENT_CACHE_TTL_MS) {
    return globalCommissionPercentCache.value;
  }
  try {
    const value = await storage.getGlobalPartnerCommissionPercent();
    globalCommissionPercentCache = { value, ts: now };
    return value;
  } catch (e) {
    console.error('[Partner] getGlobalPartnerCommissionPercentCached error:', (e as any)?.message);
    return PARTNER_DEFAULT_COMMISSION_PERCENT;
  }
}

async function setRefCookieIfApproved(req: Request, res: Response, slug: string): Promise<boolean> {
  if (!SLUG_RE.test(slug)) return false;

  const cached = slugCheckCache.get(slug);
  let approved: boolean;
  if (cached && Date.now() - cached.ts < SLUG_CACHE_TTL_MS) {
    approved = cached.ok;
  } else {
    const partner = await storage.getPartnerBySlug(slug);
    approved = !!partner && partner.status === 'approved';
    slugCheckCache.set(slug, { ok: approved, ts: Date.now() });
    // Also warm up the partner object cache
    if (approved && partner) {
      partnerObjectCache.set(slug, { partner, ts: Date.now() });
    }
  }
  if (!approved) return false;

  res.cookie(PARTNER_COOKIE_NAME, slug, refCookieOptions(isSecureRequest(req)));
  storage.incrementPartnerClicksBySlug(slug).catch(err => {
    console.error('[Partner] click increment error:', err);
  });
  return true;
}

export async function partnerRefQueryMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const refRaw = req.query.ref;
    if (typeof refRaw === 'string' && refRaw.length > 0) {
      const slug = refRaw.toLowerCase();
      const currentCookie = (req as any).cookies?.[PARTNER_COOKIE_NAME];
      if (currentCookie !== slug) {
        await setRefCookieIfApproved(req, res, slug);
      }
    }
  } catch (err) {
    console.error('[Partner] ref query middleware error:', err);
  }
  next();
}

export async function partnerRefRedirectHandler(req: Request, res: Response) {
  const slug = String(req.params.slug || '').toLowerCase();
  const to = typeof req.query.to === 'string' && req.query.to.startsWith('/') ? req.query.to : '/';

  if (!SLUG_RE.test(slug)) {
    return res.redirect(302, '/');
  }

  await setRefCookieIfApproved(req, res, slug);
  res.redirect(302, to);
}

router.get('/me', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner) {
      return res.status(404).json({ error: 'Партнёр не найден' });
    }

    let effectiveCommissionPercent: number;
    // progressiveInfo — только для обычных реф-партнёров (не артисты, нет override)
    let progressiveInfo: {
      monthlyTotal: number;       // накоплено за месяц (копейки)
      currentRate: number;        // текущая ставка
      nextTierAt: number | null;  // порог следующей ступени (копейки)
      nextTierRate: number | null;// ставка на следующей ступени
    } | null = null;

    if (partner.commissionOverride != null) {
      // Индивидуальный override — единая ставка, без прогрессии
      effectiveCommissionPercent = partner.commissionOverride;
    } else if (partner.isArtist) {
      // Артист — ставка из artistRate или globalPercent
      const globalPercent = await storage.getGlobalPartnerCommissionPercent();
      effectiveCommissionPercent = partner.artistRate ?? globalPercent ?? PARTNER_DEFAULT_COMMISSION_PERCENT;
    } else {
      // Обычный реф-партнёр — прогрессивная накопительная шкала
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth() + 1;
      const monthlyCommissions = await storage.getMonthlyRefCommissions(partner.id, year, month);
      const monthlyTotal = monthlyCommissions.reduce((s, c) => s + c.orderItemsTotal, 0);
      effectiveCommissionPercent = getProgressiveCommissionRate(monthlyTotal);

      // Определяем прогресс до следующей ступени
      const TIER1 = PARTNER_PROGRESSIVE_TIERS[1].minTotal; // 1 000 000 копеек = 10 000 ₽
      const TIER2 = PARTNER_PROGRESSIVE_TIERS[0].minTotal; // 2 000 000 копеек = 20 000 ₽
      progressiveInfo = {
        monthlyTotal,
        currentRate: effectiveCommissionPercent,
        nextTierAt: monthlyTotal < TIER1 ? TIER1 : monthlyTotal < TIER2 ? TIER2 : null,
        nextTierRate: monthlyTotal < TIER1 ? 20 : monthlyTotal < TIER2 ? 25 : null,
      };
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({
      partner,
      effectiveCommissionPercent,
      progressiveInfo,
      payoutMinKopeks: PARTNER_PAYOUT_MIN_KOPEKS,
    });
  } catch (error) {
    console.error('[Partner] me error:', error);
    res.status(500).json({ error: 'Ошибка получения данных партнёра' });
  }
});

router.get('/stats', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partnerId = req.user!.partnerId!;
    const hiddenKey = `partner_hidden_commissions_${partnerId}`;
    const hiddenRaw = await storage.getBonusSetting(hiddenKey);
    const hiddenIds: number[] = hiddenRaw ? JSON.parse(hiddenRaw) : [];
    const stats = await storage.getPartnerStats(partnerId, hiddenIds);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(stats);
  } catch (error) {
    console.error('[Partner] stats error:', error);
    res.status(500).json({ error: 'Ошибка получения статистики' });
  }
});

// List of partner's commissions (for "Заказы и комиссии" tab)
router.get('/commissions', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const commissions = await storage.getCommissionsByPartner(req.user!.partnerId!, status ? { status } : undefined);

    // Enrich each commission with the list of purchased items from the linked order.
    // Security: commissions are already filtered by partner_id, so orderId is always
    // the partner's own order — no cross-partner data leakage is possible here.
    const uniqueOrderIds = [...new Set(commissions.map((c) => c.orderId))];
    const orderMap = new Map<number, { name: string; qty: number; price: number }[]>();
    await Promise.all(
      uniqueOrderIds.map(async (orderId) => {
        try {
          const order = await storage.getOrder(orderId);
          if (order?.items && Array.isArray(order.items)) {
            orderMap.set(
              orderId,
              order.items.map((item: any) => ({
                name: item.name ?? item.productName ?? '',
                qty: item.quantity ?? item.qty ?? 1,
                price: item.price ?? 0,
              })),
            );
          }
        } catch {
          // Non-fatal: if order fetch fails, commission still appears without items
        }
      }),
    );

    const enriched = commissions.map((c) => ({
      ...c,
      orderItems: orderMap.get(c.orderId) ?? [],
    }));

    // Filter out commissions hidden by this partner
    const hiddenKey = `partner_hidden_commissions_${req.user!.partnerId!}`;
    const hiddenRaw = await storage.getBonusSetting(hiddenKey);
    const hiddenIds: number[] = hiddenRaw ? JSON.parse(hiddenRaw) : [];
    const hiddenSet = new Set(hiddenIds.map(Number));

    const visible = enriched.filter((c) => {
      // Скрываем комиссии вручную скрытые партнёром
      if (hiddenSet.has(Number(c.id))) return false;
      // Скрываем «Ожидает оплаты» — pending без holdUntil означает что покупатель
      // перешёл на страницу оплаты, но так и не оплатил (брошенный заказ).
      // Такие записи остаются в БД и видны администратору, но не должны
      // засорять список партнёра. Показываем только когда оплата подтверждена
      // (holdUntil выставлен вебхуком) либо статус уже выше pending.
      if (c.status === 'pending' && !c.holdUntil) return false;
      return true;
    });

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ commissions: visible });
  } catch (error) {
    console.error('[Partner] commissions error:', error);
    res.status(500).json({ error: 'Ошибка получения комиссий' });
  }
});

// Hide a commission from partner's view (doesn't delete from DB — admin can still see it)
router.post('/commissions/:id/hide', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Неверный ID' });
    const c = await storage.getCommissionById(id);
    if (!c) return res.status(404).json({ error: 'Комиссия не найдена' });
    if (c.partnerId !== req.user!.partnerId!) return res.status(403).json({ error: 'Нет доступа' });

    const partnerId = req.user!.partnerId!;
    const hiddenKey = `partner_hidden_commissions_${partnerId}`;
    const hiddenRaw = await storage.getBonusSetting(hiddenKey);
    const hiddenIds: number[] = hiddenRaw ? JSON.parse(hiddenRaw) : [];
    if (!hiddenIds.includes(id)) {
      hiddenIds.push(id);
      await storage.setBonusSetting(hiddenKey, JSON.stringify(hiddenIds));
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Partner] hideCommission error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка скрытия' });
  }
});

// Partner's own payout history (read-only)
router.get('/payouts', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const payouts = await storage.listPartnerPayouts(req.user!.partnerId!);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ payouts });
  } catch (error: any) {
    console.error('[Partner] payouts list error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка получения выплат' });
  }
});

// Save partner bank payout details (ИП / ООО only — самозанятые не нужны)
router.patch('/payout-details', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partnerId = req.user!.partnerId!;
    const partner = await storage.getPartnerById(partnerId);
    if (!partner) return res.status(404).json({ error: 'Партнёр не найден' });

    const { bankBik, bankAccount, bankName, bankCorrAccount } = req.body || {};

    // Валидация
    const bikStr = String(bankBik || '').trim();
    const accountStr = String(bankAccount || '').trim();
    const nameStr = String(bankName || '').trim();
    const corrStr = String(bankCorrAccount || '').trim();

    if (!/^\d{9}$/.test(bikStr)) return res.status(400).json({ error: 'БИК должен состоять из 9 цифр' });
    if (!/^\d{20}$/.test(accountStr)) return res.status(400).json({ error: 'Расчётный счёт — 20 цифр' });
    if (nameStr.length < 2) return res.status(400).json({ error: 'Укажите название банка' });
    if (!/^\d{20}$/.test(corrStr)) return res.status(400).json({ error: 'Корреспондентский счёт — 20 цифр' });

    await storage.updatePartnerBankDetails(partnerId, {
      bankBik: bikStr,
      bankAccount: accountStr,
      bankName: nameStr,
      bankCorrAccount: corrStr,
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Partner] payout-details update error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка сохранения реквизитов' });
  }
});

// Request payout — автоматически создаёт карточку выплаты.
// Для ИП/ООО также генерирует PDF-счёт и сразу переводит карточку в invoice_uploaded.
// Для самозанятых — карточка создаётся в статусе awaiting_invoice (они сами грузят чек из «Мой налог»).
router.post('/payout/request', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  const partnerId = req.user!.partnerId!;

  if (!acquirePayoutRequestLock(partnerId)) {
    return res.status(409).json({ error: 'Создание выплаты уже выполняется. Подождите несколько секунд и обновите страницу.' });
  }

  try {
    // 1. Получаем подтверждённые комиссии
    const confirmedCommissions = await storage.getCommissionsByPartner(partnerId, { status: 'confirmed' });
    if (confirmedCommissions.length === 0) {
      return res.status(400).json({
        error: 'Нет доступной суммы для выплаты. Дождитесь подтверждения комиссий после 14-дневного холда.',
      });
    }

    // 1а. Исключаем комиссии, уже зарезервированные в активных (незавершённых) выплатах.
    //     Без этой проверки повторный запрос выплаты включил бы те же комиссии дважды.
    const existingPayouts = await storage.listPartnerPayouts(partnerId);
    const activePayouts = existingPayouts.filter(
      (p) => p.status !== 'completed' && p.status !== 'rejected',
    );
    const reservedIds = new Set<number>();
    for (const p of activePayouts) {
      try {
        const parsed: unknown = JSON.parse(p.commissionIds || '[]');
        if (Array.isArray(parsed)) {
          (parsed as unknown[]).forEach((cid) => {
            const n = Number(cid);
            if (Number.isFinite(n)) reservedIds.add(n);
          });
        }
      } catch {}
    }
    const freeCommissions = reservedIds.size > 0
      ? confirmedCommissions.filter((c) => !reservedIds.has(c.id))
      : confirmedCommissions;

    if (freeCommissions.length === 0) {
      return res.status(400).json({
        error: 'Все подтверждённые комиссии уже включены в активную выплату. Дождитесь её завершения или обратитесь к администратору.',
      });
    }

    const commissionIds = freeCommissions.map((c) => c.id);
    const totalAmount   = freeCommissions.reduce((sum, c) => sum + c.commissionAmount, 0);

    // 2. Данные партнёра (для реквизитов и legalStatus)
    const partner = await storage.getPartnerById(partnerId);
    if (!partner) {
      return res.status(400).json({ error: 'Партнёр не найден' });
    }

    const isLegalEntity = partner.legalStatus === 'ip' || partner.legalStatus === 'ooo';

    // Формируем recipientDetails из банковских реквизитов (ИП/ООО) или пустая строка
    let method          = 'bank_account';
    let recipientName   = partner.companyName || partner.contactName || '';
    let recipientDetails = '';

    if (isLegalEntity) {
      if (!partner.bankBik || !partner.bankAccount || !partner.bankName || !partner.bankCorrAccount) {
        return res.status(400).json({ error: 'Заполните банковские реквизиты перед запросом выплаты.' });
      }
      recipientDetails = [
        `Банк: ${partner.bankName}`,
        `БИК: ${partner.bankBik}`,
        `Р/с: ${partner.bankAccount}`,
        `К/с: ${partner.bankCorrAccount}`,
      ].join('\n');
    } else {
      // Самозанятые: способ выплаты может быть переводом по реквизитам карты
      method = partner.payoutMethod || 'bank_account';
      recipientName = partner.payoutFullName || partner.contactName || '';
      recipientDetails = partner.payoutDetails || partner.contactPhone || '';
      if (!recipientDetails) recipientDetails = partner.contactEmail || '';
    }

    if (!recipientName) recipientName = partner.contactName || `Партнёр #${partnerId}`;
    if (recipientDetails.length < 3) recipientDetails = `ИНН: ${partner.inn || '—'}`;

    // 3. Создаём карточку выплаты.
    //    Комиссии НЕ переводятся в paid здесь — это произойдёт только когда
    //    администратор реально завершит выплату (POST /admin/partner-payouts/:id/complete).
    const payout = await storage.createPartnerPayout({
      partnerId,
      amount: totalAmount,
      commissionIds,
      method,
      recipientName,
      recipientDetails,
      note: null,
      createdBy: 'partner-self',
    });

    // 4. Для ИП/ООО — генерируем PDF-счёт и сразу переводим в invoice_uploaded
    if (isLegalEntity && partner.bankBik && partner.bankAccount && partner.bankName && partner.bankCorrAccount) {
      try {
        const partnerDisplayName = partner.companyName || [
          partner.legalStatus === 'ip' ? 'ИП' : 'ООО',
          partner.lastName,
          partner.firstName,
          partner.middleName,
        ].filter(Boolean).join(' ') || partner.contactName;

        const pdfBuffer = await generatePartnerPayoutInvoicePDF({
          payoutId:              payout.id,
          date:                  new Date(),
          partnerName:           partnerDisplayName,
          partnerInn:            partner.inn || '',
          partnerBankBik:        partner.bankBik,
          partnerBankAccount:    partner.bankAccount,
          partnerBankName:       partner.bankName,
          partnerBankCorrAccount: partner.bankCorrAccount,
          amount:                totalAmount,
          commissionCount:       commissionIds.length,
        });

        const s3Key = await uploadPayoutDocument(
          pdfBuffer,
          payout.id,
          partnerId,
          'invoice',
          'pdf',
          'application/pdf',
        );

        if (s3Key) {
          await storage.updatePartnerPayoutFields(payout.id, {
            invoiceUrl:        s3Key,
            invoiceUploadedAt: new Date(),
            invoiceNumber:     `АВТ-${payout.id}`,
            status:            'invoice_uploaded',
          });
        } else {
          console.warn(`[Partner] payout #${payout.id}: S3 not configured, invoice not saved. Staying at awaiting_invoice.`);
        }
      } catch (invoiceErr: any) {
        // Генерация/загрузка счёта не должна ломать создание выплаты
        console.error(`[Partner] payout #${payout.id}: invoice generation failed:`, invoiceErr?.message);
      }
    }

    // 5. Сбрасываем флаг payoutRequested (карточка уже создана)
    try { await storage.setPartnerPayoutRequested(partnerId, false); } catch {}

    res.json({ success: true, payoutId: payout.id, message: 'Карточка выплаты создана.' });
  } catch (error: any) {
    console.error('[Partner] payout request error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка создания заявки' });
  } finally {
    releasePayoutRequestLock(partnerId);
  }
});

// === Партнёрские документы выплат (счета и чеки самозанятых) ===
//
// State machine:
//   awaiting_invoice  ─[партнёр загружает счёт]→  invoice_uploaded
//   invoice_uploaded  ─[админ нажал «Оплачено»]→  paid_pending_receipt
//   paid_pending_receipt ─[партнёр загружает чек]→ (status не меняется,
//                                                  фронт показывает «ожидает завершения»)
//                       ─[админ нажал «Завершить»]→ completed
//   * → rejected (админ может отклонить на любом этапе с причиной)
//
// Что проверяется:
//   • payout принадлежит текущему партнёру
//   • status соответствует разрешённому переходу
//   • файл уже не загружен (повторная загрузка запрещена — иначе старый файл
//     остаётся в S3 и непонятно какой актуальный; перезагрузка только через reject)

// Загрузить счёт от самозанятого
router.post(
  '/payouts/:id/invoice',
  authMiddleware,
  requirePartnerRole,
  payoutDocUpload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = req.user!.partnerId!;
      const payoutId = Number(req.params.id);
      if (!Number.isFinite(payoutId)) {
        return res.status(400).json({ error: 'Неверный id выплаты' });
      }
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ error: 'Файл не передан' });
      }
      const invoiceNumber = req.body?.invoiceNumber
        ? String(req.body.invoiceNumber).trim().slice(0, 64)
        : null;

      // Race-protection: один и тот же payout не должен загружаться параллельно.
      if (!acquirePayoutLock(payoutId, 'invoice')) {
        return res.status(409).json({ error: 'Загрузка этого счёта уже выполняется. Подождите несколько секунд и обновите страницу.' });
      }
      try {
        const payout = await storage.getPayoutById(payoutId);
        if (!payout || payout.partnerId !== partnerId) {
          return res.status(404).json({ error: 'Выплата не найдена' });
        }
        if (payout.status !== 'awaiting_invoice') {
          return res.status(400).json({
            error: `Счёт нельзя загрузить: текущий статус «${payout.status}». Если нужно перезагрузить — попросите администратора отклонить выплату.`,
          });
        }
        if (payout.invoiceUrl) {
          return res.status(400).json({ error: 'Счёт уже загружен' });
        }

        const ext = PAYOUT_DOC_EXT_BY_MIME[file.mimetype] || 'pdf';
        const key = await uploadPayoutDocument(file.buffer, payoutId, partnerId, 'invoice', ext, file.mimetype);
        if (!key) {
          console.error('[Partner] invoice upload failed: S3 not configured (YC_OBJECT_STORAGE_* env vars missing)');
          return res.status(500).json({ error: 'Не удалось сохранить файл: хранилище документов не настроено. Сообщите администратору.' });
        }

        const now = new Date();
        await storage.updatePartnerPayoutFields(payoutId, {
          invoiceUrl: key,
          invoiceUploadedAt: now,
          invoiceNumber,
          status: 'invoice_uploaded',
        });
        res.json({ success: true, status: 'invoice_uploaded' });

        // Уведомить команду в Telegram (оптовый бот) — нужна оплата
        try {
          const partner = await storage.getPartnerById(payout.partnerId);
          notifyPayoutInvoiceUploaded({
            partnerName: payout.recipientName || partner?.contactName || 'Партнёр',
            contactEmail: partner?.contactEmail || '',
            payoutId,
            amount: payout.amount,
            invoiceNumber,
          });
        } catch (notifyErr: any) {
          console.error('[Partner] notifyPayoutInvoiceUploaded error:', notifyErr?.message);
        }
      } finally {
        releasePayoutLock(payoutId, 'invoice');
      }
    } catch (error: any) {
      console.error('[Partner] invoice upload error:', error);
      const msg = error?.message || 'Ошибка загрузки счёта';
      // multer LIMIT_FILE_SIZE / fileFilter
      if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Файл слишком большой (макс ${PAYOUT_DOC_MAX_SIZE_LABEL})` });
      res.status(400).json({ error: msg });
    }
  },
);

// Загрузить чек самозанятого («Мой налог»)
router.post(
  '/payouts/:id/receipt',
  authMiddleware,
  requirePartnerRole,
  payoutDocUpload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = req.user!.partnerId!;
      const payoutId = Number(req.params.id);
      if (!Number.isFinite(payoutId)) {
        return res.status(400).json({ error: 'Неверный id выплаты' });
      }
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ error: 'Файл не передан' });
      const receiptNumber = req.body?.receiptNumber
        ? String(req.body.receiptNumber).trim().slice(0, 64)
        : null;

      if (!acquirePayoutLock(payoutId, 'receipt')) {
        return res.status(409).json({ error: 'Загрузка этого чека уже выполняется. Подождите несколько секунд и обновите страницу.' });
      }
      try {
        const payout = await storage.getPayoutById(payoutId);
        if (!payout || payout.partnerId !== partnerId) {
          return res.status(404).json({ error: 'Выплата не найдена' });
        }
        // Чек НПД («Мой налог») загружают только самозанятые. ИП и ЮЛ
        // вместо чека прикладывают акт оказанных услуг через POST /payouts/:id/act.
        if (payout.status !== 'paid_pending_receipt') {
          return res.status(400).json({
            error: `Чек можно загрузить только после оплаты администратором. Текущий статус: «${payout.status}».`,
          });
        }
        if (payout.receiptUrl) {
          return res.status(400).json({ error: 'Чек уже загружен' });
        }

        const ext = PAYOUT_DOC_EXT_BY_MIME[file.mimetype] || 'pdf';
        const key = await uploadPayoutDocument(file.buffer, payoutId, partnerId, 'receipt', ext, file.mimetype);
        if (!key) {
          console.error('[Partner] receipt upload failed: S3 not configured (YC_OBJECT_STORAGE_* env vars missing)');
          return res.status(500).json({ error: 'Не удалось сохранить файл: хранилище документов не настроено. Сообщите администратору.' });
        }

        await storage.updatePartnerPayoutFields(payoutId, {
          receiptUrl: key,
          receiptUploadedAt: new Date(),
          receiptNumber,
          // status НЕ меняем — админ должен вручную нажать «Завершить» после проверки чека.
        });
        res.json({ success: true });
      } finally {
        releasePayoutLock(payoutId, 'receipt');
      }
    } catch (error: any) {
      console.error('[Partner] receipt upload error:', error);
      if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Файл слишком большой (макс ${PAYOUT_DOC_MAX_SIZE_LABEL})` });
      res.status(400).json({ error: error?.message || 'Ошибка загрузки чека' });
    }
  },
);

// Скачать СВОЙ счёт (партнёр видит только свои документы)
router.get(
  '/payouts/:id/invoice',
  authMiddleware,
  requirePartnerRole,
  async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = req.user!.partnerId!;
      const payoutId = Number(req.params.id);
      if (!Number.isFinite(payoutId)) return res.status(400).json({ error: 'Неверный id' });
      const payout = await storage.getPayoutById(payoutId);
      if (!payout || payout.partnerId !== partnerId) return res.status(404).json({ error: 'Не найдено' });
      if (!payout.invoiceUrl) return res.status(404).json({ error: 'Счёт не загружен' });
      const file = await downloadPayoutDocument(payout.invoiceUrl);
      if (!file) return res.status(500).json({ error: 'Файл недоступен' });
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Content-Disposition', `inline; filename="invoice-${payoutId}"`);
      res.send(file.buffer);
    } catch (error: any) {
      console.error('[Partner] invoice download error:', error);
      res.status(500).json({ error: error?.message || 'Ошибка' });
    }
  },
);

// Загрузить акт оказанных услуг (для ИП и ЮЛ — вместо чека НПД).
// Доступно только когда статус выплаты paid_pending_act, т.е. админ уже
// перевёл деньги и установил соответствующий статус по legalStatus партнёра.
router.post(
  '/payouts/:id/act',
  authMiddleware,
  requirePartnerRole,
  payoutDocUpload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = req.user!.partnerId!;
      const payoutId = Number(req.params.id);
      if (!Number.isFinite(payoutId)) {
        return res.status(400).json({ error: 'Неверный id выплаты' });
      }
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ error: 'Файл не передан' });
      const actNumber = req.body?.actNumber
        ? String(req.body.actNumber).trim().slice(0, 64)
        : null;

      if (!acquirePayoutLock(payoutId, 'act')) {
        return res.status(409).json({ error: 'Загрузка этого акта уже выполняется. Подождите несколько секунд и обновите страницу.' });
      }
      try {
        const payout = await storage.getPayoutById(payoutId);
        if (!payout || payout.partnerId !== partnerId) {
          return res.status(404).json({ error: 'Выплата не найдена' });
        }
        if (payout.status !== 'paid_pending_act') {
          return res.status(400).json({
            error: `Акт можно загрузить только после оплаты администратором. Текущий статус: «${payout.status}».`,
          });
        }
        if (payout.actUrl) {
          return res.status(400).json({ error: 'Акт уже загружен' });
        }

        const ext = PAYOUT_DOC_EXT_BY_MIME[file.mimetype] || 'pdf';
        const key = await uploadPayoutDocument(file.buffer, payoutId, partnerId, 'act', ext, file.mimetype);
        if (!key) {
          console.error('[Partner] act upload failed: S3 not configured (YC_OBJECT_STORAGE_* env vars missing)');
          return res.status(500).json({ error: 'Не удалось сохранить файл: хранилище документов не настроено. Сообщите администратору.' });
        }

        await storage.updatePartnerPayoutFields(payoutId, {
          actUrl: key,
          actUploadedAt: new Date(),
          actNumber,
          // status НЕ меняем — админ должен вручную нажать «Завершить» после проверки акта.
        });
        res.json({ success: true });
      } finally {
        releasePayoutLock(payoutId, 'act');
      }
    } catch (error: any) {
      console.error('[Partner] act upload error:', error);
      if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Файл слишком большой (макс ${PAYOUT_DOC_MAX_SIZE_LABEL})` });
      res.status(400).json({ error: error?.message || 'Ошибка загрузки акта' });
    }
  },
);

// Скачать СВОЙ чек
router.get(
  '/payouts/:id/receipt',
  authMiddleware,
  requirePartnerRole,
  async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = req.user!.partnerId!;
      const payoutId = Number(req.params.id);
      if (!Number.isFinite(payoutId)) return res.status(400).json({ error: 'Неверный id' });
      const payout = await storage.getPayoutById(payoutId);
      if (!payout || payout.partnerId !== partnerId) return res.status(404).json({ error: 'Не найдено' });
      if (!payout.receiptUrl) return res.status(404).json({ error: 'Чек не загружен' });
      const file = await downloadPayoutDocument(payout.receiptUrl);
      if (!file) return res.status(500).json({ error: 'Файл недоступен' });
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Content-Disposition', `inline; filename="receipt-${payoutId}"`);
      res.send(file.buffer);
    } catch (error: any) {
      console.error('[Partner] receipt download error:', error);
      res.status(500).json({ error: error?.message || 'Ошибка' });
    }
  },
);

// Скачать СВОЙ акт
router.get(
  '/payouts/:id/act',
  authMiddleware,
  requirePartnerRole,
  async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = req.user!.partnerId!;
      const payoutId = Number(req.params.id);
      if (!Number.isFinite(payoutId)) return res.status(400).json({ error: 'Неверный id' });
      const payout = await storage.getPayoutById(payoutId);
      if (!payout || payout.partnerId !== partnerId) return res.status(404).json({ error: 'Не найдено' });
      if (!payout.actUrl) return res.status(404).json({ error: 'Акт не загружен' });
      const file = await downloadPayoutDocument(payout.actUrl);
      if (!file) return res.status(500).json({ error: 'Файл недоступен' });
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Content-Disposition', `inline; filename="act-${payoutId}"`);
      res.send(file.buffer);
    } catch (error: any) {
      console.error('[Partner] act download error:', error);
      res.status(500).json({ error: error?.message || 'Ошибка' });
    }
  },
);

// === Partner products (selection for public page / widget) ===

// Get list of selected product IDs for current partner
router.get('/products', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const ids = await storage.getPartnerProductIds(req.user!.partnerId!);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ productIds: ids });
  } catch (error: any) {
    console.error('[Partner] products list error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка получения списка товаров' });
  }
});

// Add a product to partner's selection
router.post('/products', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const productId = Number(req.body?.productId);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Некорректный productId' });
    }
    await storage.addPartnerProduct(req.user!.partnerId!, productId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Partner] add product error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка добавления товара' });
  }
});

// Remove a product from partner's selection
router.delete('/products/:productId', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Некорректный productId' });
    }
    await storage.removePartnerProduct(req.user!.partnerId!, productId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Partner] remove product error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка удаления товара' });
  }
});

// === Public partner page / widget data (no auth) ===
// Returns partner info + selected products. 404 if partner not approved.
router.get('/public/:slug', async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    if (!SLUG_RE.test(slug)) {
      return res.status(404).json({ error: 'Партнёр не найден' });
    }
    const partner = await storage.getPartnerBySlug(slug);
    if (!partner || partner.status !== 'approved') {
      return res.status(404).json({ error: 'Партнёр не найден' });
    }
    const ids = await storage.getPartnerProductIds(partner.id);
    let products: any[] = [];
    if (ids.length > 0) {
      const idSet = new Set(ids);
      const all = await storage.getProducts();
      products = all
        .filter(p => idSet.has(p.id) && !p.isHidden)
        .map(p => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          price: p.price,
          discountPercent: p.discountPercent,
          imageUrl: p.thumbnailUrl || p.imageUrl,
          category: p.category,
          subcategory: p.subcategory,
          sku: p.sku,
          stock: typeof p.stock === 'number' ? p.stock : null,
        }));
    }
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      partner: {
        partnerSlug: partner.partnerSlug,
        storeName: partner.storeName,
      },
      products,
    });
  } catch (error: any) {
    console.error('[Partner] public page error:', error);
    res.status(500).json({ error: 'Ошибка загрузки страницы партнёра' });
  }
});

// GET /promo-code — get partner's own promo code
router.get('/promo-code', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partnerId = req.user!.partnerId!;
    const promo = await storage.getPartnerPromoCode(partnerId);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ promoCode: promo || null });
  } catch (error: any) {
    console.error('[Partner] get promo-code error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка получения промокода' });
  }
});

// POST /promo-code — create or update partner's promo code
router.post('/promo-code', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partnerId = req.user!.partnerId!;
    const { code, discountPercent } = req.body || {};

    if (typeof code !== 'string' || !/^[A-Za-z0-9]{4,16}$/.test(code.trim())) {
      return res.status(400).json({ error: 'Код должен содержать от 4 до 16 символов (латинские буквы и цифры)' });
    }

    const pct = Number(discountPercent);
    if (!Number.isFinite(pct) || pct < 5 || pct > 15) {
      return res.status(400).json({ error: 'Скидка должна быть от 5 до 15%' });
    }

    const promo = await storage.setPartnerPromoCode(partnerId, code.trim(), Math.round(pct));
    res.json({ success: true, promoCode: promo });
  } catch (error: any) {
    console.error('[Partner] set promo-code error:', error);
    res.status(400).json({ error: error?.message || 'Ошибка сохранения промокода' });
  }
});

// DELETE /promo-code — delete partner's promo code
router.delete('/promo-code', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partnerId = req.user!.partnerId!;
    await storage.deletePartnerPromoCode(partnerId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Partner] delete promo-code error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка удаления промокода' });
  }
});

// === Artist endpoints (only for partners with isArtist=true) ===

router.get('/artist/products', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Products tagged with artist_slug via admin.
    // Uses direct YDB query first; falls back to in-memory product cache
    // to handle cases where YDB returns stale data right after an admin update.
    const ydbProducts = await storage.getArtistProductsBySlug(partner.partnerSlug);

    let products: any[] = ydbProducts;

    // Fallback to cached product list if YDB returned nothing
    if (ydbProducts.length === 0) {
      const allProducts = await storage.getProducts();
      products = allProducts.filter(
        (p: any) => p.artistSlug === partner.partnerSlug && !p.isHidden
      );
    }

    console.log(`[Artist] products for ${partner.partnerSlug}: ${products.length} (${ydbProducts.length} from YDB, ${ydbProducts.length === 0 ? products.length + ' from cache' : 'cache skipped'})`);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({ products });
  } catch (error: any) {
    console.error('[Artist] products error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка получения товаров' });
  }
});

router.get('/artist/stats', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Exclude orders that belong to hidden commissions
    const hiddenKey = `partner_hidden_commissions_${req.user!.partnerId!}`;
    const hiddenRaw = await storage.getBonusSetting(hiddenKey);
    const hiddenCommissionIds: number[] = hiddenRaw ? JSON.parse(hiddenRaw) : [];
    let excludeOrderIds = new Set<number>();
    if (hiddenCommissionIds.length > 0) {
      const allCommissions = await storage.getCommissionsByPartner(req.user!.partnerId!);
      for (const c of allCommissions) {
        if (hiddenCommissionIds.map(Number).includes(Number(c.id))) {
          excludeOrderIds.add(Number(c.orderId));
        }
      }
    }

    const stats = await storage.getArtistStatsBySlug(partner.partnerSlug, excludeOrderIds);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(stats);
  } catch (error: any) {
    console.error('[Artist] stats error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка получения статистики' });
  }
});

// POST upload image for artist page (to Yandex S3, artist subfolder)
router.post('/artist/upload-image', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist || !partner.partnerSlug) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const rawFilename = (req.headers['x-filename'] as string) || `upload_${Date.now()}.webp`;
    const filename = (() => { try { return decodeURIComponent(rawFilename); } catch { return rawFilename; } })();

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'Пустой файл' });
    }

    const sharp = (await import('sharp')).default;
    const webpBuffer = await sharp(buffer).webp({ quality: 88 }).toBuffer();
    // Thumbnail (800px) — нужен для getOptimizedImageUrl на главной
    const thumbBuffer = await sharp(buffer).resize(800, null, { withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();

    const ts = Date.now();
    const cleanName = filename.replace(/\.[^.]+$/, '.webp').replace(/[^a-zA-Z0-9._-]/g, '_');
    const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || 'bmg';
    const s3Key = `site/artist/${partner.partnerSlug}/${ts}_${cleanName}`;
    const s3ThumbKey = s3Key.replace('.webp', '_thumb.webp');

    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: 'ru-central1',
      endpoint: 'https://storage.yandexcloud.net',
      credentials: {
        accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || '',
        secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || '',
      },
    });
    await Promise.all([
      s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: webpBuffer,
        ContentType: 'image/webp',
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable',
      })),
      s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3ThumbKey,
        Body: thumbBuffer,
        ContentType: 'image/webp',
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable',
      })),
    ]);

    const url = `https://storage.yandexcloud.net/${bucketName}/${s3Key}`;
    console.log(`[Artist Upload] ${partner.partnerSlug}: ${url}`);
    res.json({ url, success: true });
  } catch (error: any) {
    console.error('[Artist Upload] error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка загрузки' });
  }
});

// POST /artist/upload-logo — загрузка логотипа (JPG/PNG/WebP → конвертируем в WebP; SVG → как есть)
router.post('/artist/upload-logo', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist || !partner.partnerSlug) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const contentType = (req.headers['content-type'] || '').split(';')[0].trim();
    const rasterTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    const isSvg = contentType === 'image/svg+xml';
    const isRaster = rasterTypes.includes(contentType);
    if (!isSvg && !isRaster) {
      return res.status(400).json({ error: 'Допустимые форматы: JPG, PNG, WebP, SVG' });
    }

    const rawFilename = (req.headers['x-filename'] as string) || `logo_${Date.now()}`;
    const filename = (() => { try { return decodeURIComponent(rawFilename); } catch { return rawFilename; } })();

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) return res.status(400).json({ error: 'Пустой файл' });
    if (buffer.length > 10 * 1024 * 1024) return res.status(400).json({ error: 'Файл не должен превышать 10 МБ' });

    const ts = Date.now();
    const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || 'bmg';

    let uploadBuffer: Buffer;
    let uploadContentType: string;
    let ext: string;

    if (isSvg) {
      uploadBuffer = buffer;
      uploadContentType = 'image/svg+xml';
      ext = '.svg';
    } else {
      const sharp = (await import('sharp')).default;
      uploadBuffer = await sharp(buffer).webp({ quality: 90 }).toBuffer();
      uploadContentType = 'image/webp';
      ext = '.webp';
    }

    const cleanName = filename.replace(/\.[^.]+$/, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `site/artist/${partner.partnerSlug}/logo_${ts}_${cleanName}`;

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
      Body: uploadBuffer,
      ContentType: uploadContentType,
      ACL: 'public-read',
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    const url = `https://storage.yandexcloud.net/${bucketName}/${s3Key}`;
    console.log(`[Artist Logo Upload] ${partner.partnerSlug}: ${url}`);
    res.json({ url, success: true });
  } catch (error: any) {
    console.error('[Artist Logo Upload] error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка загрузки' });
  }
});

// GET artist page settings
router.get('/artist/page', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist || !partner.partnerSlug) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const allPages = await storage.getPageSettings('artist_pages');
    const page = allPages[partner.partnerSlug] || {};
    res.set('Cache-Control', 'no-store');
    res.json(page);
  } catch (error: any) {
    console.error('[Artist] page get error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка получения настроек страницы' });
  }
});

// PUT artist page settings (only own page)
router.put('/artist/page', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist || !partner.partnerSlug) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const allowed = [
      'name','role','shortDescription','logoUrl','cardImage','heroImage','heroImageMobile',
      'heroTitle','heroSubtitle','heroBgType','heroVideo','heroOpacity',
      'aboutTitle','aboutText','aboutImages',
      'quoteText','quoteAuthor',
      'videoUrl','videoTitle',
      'galleryTitle','galleryImages',
      'productsTitle','productsLimit','productsLinkText','productsCategory','productsSubcategory',
      'socialTelegram','socialVk','socialYoutube','socialInstagram','socialOther','socialOtherLabel',
      'seoTitle','seoDescription',
      'heroVisible','aboutVisible','galleryVisible','productsVisible','quoteVisible','videoVisible','socialsVisible',
      'theme','marqueeText',
    ];
    const newFields: Record<string, any> = {};
    for (const key of allowed) {
      if (key in req.body) newFields[key] = req.body[key];
    }
    // Merge with existing settings so previously saved fields are not lost
    const allPages = await storage.getPageSettings('artist_pages');
    const existing = allPages[partner.partnerSlug] || {};
    const settings = { ...existing, ...newFields };
    await storage.setPageSectionSettings('artist_pages', partner.partnerSlug, settings);

    // Если партнёр уже на главной странице — обновляем image карточки как это делает админ
    const cardImg = settings.cardImage || settings.heroImage || '';
    if (cardImg) {
      try {
        const homeSettings = await storage.getPageSettings('home');
        const currentArtists = homeSettings?.artists || { items: [] };
        const currentItems: any[] = [...(currentArtists.items || [])];
        const idx = currentItems.findIndex((a: any) => a.slug === partner.partnerSlug);
        if (idx >= 0) {
          currentItems[idx] = {
            ...currentItems[idx],
            name: settings.name || currentItems[idx].name,
            role: settings.role || currentItems[idx].role,
            image: settings.cardImage || currentItems[idx].image,
          };
          await storage.setPageSectionSettings('home', 'artists', { ...currentArtists, items: currentItems });
          console.log(`[Artist] updated homepage card for ${partner.partnerSlug}`);
        }
      } catch (e: any) {
        console.error('[Artist] homepage card update error:', e?.message);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Artist] page save error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка сохранения страницы' });
  }
});

// GET /artist/views — get page view count for own artist page
router.get('/artist/views', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const raw = await storage.getBonusSetting(`artist_page_views_${partner.partnerSlug}`);
    const views = raw ? parseInt(raw, 10) : 0;
    res.json({ views: isNaN(views) ? 0 : views });
  } catch (error: any) {
    console.error('[Artist] views error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка' });
  }
});

// ─── Artist own product management ────────────────────────────────────────────

// POST upload image for artist PRODUCT (reuses same S3 pattern as page images)
router.post('/my-products/upload-image', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist || !partner.partnerSlug) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'Пустой файл' });
    }

    const sharp = (await import('sharp')).default;
    const webpBuffer = await sharp(buffer).resize(1200, null, { withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
    const thumbBuffer = await sharp(buffer).resize(800, null, { withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();

    const ts = Date.now();
    const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || 'bmg';
    const s3Key = `site/artist/${partner.partnerSlug}/products/${ts}.webp`;
    const s3ThumbKey = s3Key.replace('.webp', '_thumb.webp');

    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: 'ru-central1',
      endpoint: 'https://storage.yandexcloud.net',
      credentials: {
        accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || '',
        secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || '',
      },
    });

    if (process.env.YANDEX_STORAGE_ACCESS_KEY) {
      await Promise.all([
        s3.send(new PutObjectCommand({ Bucket: bucketName, Key: s3Key, Body: webpBuffer, ContentType: 'image/webp', ACL: 'public-read', CacheControl: 'public, max-age=31536000, immutable' })),
        s3.send(new PutObjectCommand({ Bucket: bucketName, Key: s3ThumbKey, Body: thumbBuffer, ContentType: 'image/webp', ACL: 'public-read', CacheControl: 'public, max-age=31536000, immutable' })),
      ]);
      const url = `https://storage.yandexcloud.net/${bucketName}/${s3Key}`;
      console.log(`[ArtistProduct Upload] ${partner.partnerSlug}: ${url}`);
      res.json({ url, thumbUrl: `https://storage.yandexcloud.net/${bucketName}/${s3ThumbKey}` });
    } else {
      const b64 = `data:image/webp;base64,${webpBuffer.toString('base64')}`;
      res.json({ url: b64, thumbUrl: b64 });
    }
  } catch (error: any) {
    console.error('[ArtistProduct Upload]', error);
    res.status(500).json({ error: error?.message || 'Ошибка загрузки' });
  }
});

// GET my products
router.get('/my-products', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist || !partner.partnerSlug) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    // Используем raw cache чтобы видеть скрытые товары тоже
    const raw: any[] = (storage as any).getRawProductsCache?.() || [];
    let products: any[];
    if (raw.length > 0) {
      products = raw.filter((p: any) => p.artistSlug === partner.partnerSlug && p.artistOnly === true);
    } else {
      // Fallback — запрос из YDB через обычный метод (без фильтра скрытых)
      const all = await storage.getArtistProductsBySlug(partner.partnerSlug);
      products = all.filter((p: any) => p.artistOnly === true);
    }
    console.log(`[MyProducts] slug=${partner.partnerSlug} total=${products.length} hidden=${products.filter((p:any)=>p.isHidden).length}`);
    res.json(products);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Ошибка' });
  }
});

// POST create product
router.post('/my-products', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist || !partner.partnerSlug) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const { name, description, price, images, sizes, sizeStock, category, composition } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Укажите название товара' });
    if (!price || isNaN(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: 'Укажите корректную цену' });
    const product = await storage.createArtistProduct(partner.partnerSlug, {
      name: String(name).trim(),
      description: String(description || '').trim(),
      price: Math.round(Number(price) * 100),
      images: Array.isArray(images) ? images : [],
      sizes: Array.isArray(sizes) ? sizes : [],
      sizeStock: sizeStock && typeof sizeStock === 'object' ? sizeStock : {},
      category: String(category || 'merch').trim(),
      composition: String(composition || '').trim(),
    });
    res.json(product);
  } catch (error: any) {
    console.error('[ArtistProduct] create error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка создания товара' });
  }
});

// PUT update product
router.put('/my-products/:id', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist || !partner.partnerSlug) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const productId = parseInt(req.params.id);
    if (isNaN(productId)) return res.status(400).json({ error: 'Неверный ID' });
    const { name, description, price, images, sizes, sizeStock, category, composition, isHidden } = req.body || {};
    const data: any = {};
    if (name !== undefined) data.name = String(name).trim();
    if (description !== undefined) data.description = String(description).trim();
    if (price !== undefined) data.price = Math.round(Number(price) * 100);
    if (images !== undefined) data.images = Array.isArray(images) ? images : [];
    if (sizes !== undefined) data.sizes = Array.isArray(sizes) ? sizes : [];
    if (sizeStock !== undefined) data.sizeStock = sizeStock;
    if (category !== undefined) data.category = String(category).trim();
    if (composition !== undefined) data.composition = String(composition).trim();
    if (isHidden !== undefined) data.isHidden = Boolean(isHidden);
    const product = await storage.updateArtistProduct(productId, partner.partnerSlug, data);
    res.json(product);
  } catch (error: any) {
    console.error('[ArtistProduct] update error:', error);
    res.status(error?.message?.includes('нет доступа') ? 403 : 500).json({ error: error?.message || 'Ошибка обновления' });
  }
});

// DELETE (soft) product
router.delete('/my-products/:id', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist || !partner.partnerSlug) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const productId = parseInt(req.params.id);
    if (isNaN(productId)) return res.status(400).json({ error: 'Неверный ID' });
    await storage.deleteArtistProduct(productId, partner.partnerSlug);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[ArtistProduct] delete error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка удаления' });
  }
});

// DELETE — unlink catalog/1C product from artist page (sets artist_slug = null, does NOT delete product)
router.delete('/artist/linked-products/:id', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerById(req.user!.partnerId!);
    if (!partner || !partner.isArtist || !partner.partnerSlug) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const productId = parseInt(req.params.id);
    if (isNaN(productId)) return res.status(400).json({ error: 'Неверный ID' });

    const product = await storage.getProduct(productId);
    if (!product) return res.status(404).json({ error: 'Товар не найден' });
    if ((product as any).artistSlug !== partner.partnerSlug) {
      return res.status(403).json({ error: 'Товар не принадлежит вашей странице' });
    }
    if ((product as any).artistOnly === true) {
      return res.status(400).json({ error: 'Используйте удаление для собственных товаров' });
    }

    await storage.updateProduct(productId, { artistSlug: null } as any);
    console.log(`[Artist] Unlinked catalog product ${productId} from partner ${partner.partnerSlug}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Artist] unlink product error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка отвязки товара' });
  }
});

// Update contact settings (name, phone, store name)
router.patch('/settings', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partnerId = req.user!.partnerId!;
    const { contactName, contactPhone, storeName } = req.body || {};
    const update: { contactName?: string; contactPhone?: string; storeName?: string } = {};
    if (typeof contactName === 'string' && contactName.trim().length >= 2) update.contactName = contactName.trim();
    if (typeof contactPhone === 'string') update.contactPhone = contactPhone.trim();
    if (typeof storeName === 'string' && storeName.trim().length >= 2) update.storeName = storeName.trim();
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }
    await storage.updatePartnerContacts(partnerId, update);
    const partner = await storage.getPartnerById(partnerId);
    res.json({ success: true, partner });
  } catch (error: any) {
    console.error('[Partner] settings update error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка обновления данных' });
  }
});

// POST /api/partner/feedback — обратная связь от партнёра (уходит в Telegram + ВК)
router.post('/feedback', authMiddleware, requirePartnerRole, async (req: AuthRequest, res: Response) => {
  try {
    const partner = await storage.getPartnerByUserId(req.user!.id);
    if (!partner) return res.status(404).json({ error: 'Партнёр не найден' });

    const { type, message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length < 5) {
      return res.status(400).json({ error: 'Сообщение слишком короткое' });
    }
    const allowedTypes = ['bug', 'wish', 'other'];
    const feedbackType = allowedTypes.includes(type) ? type : 'other';

    const data = {
      partnerName: partner.contactName || partner.storeName || 'Партнёр',
      partnerSlug: partner.partnerSlug,
      type: feedbackType,
      message: message.trim(),
    };

    notifyPartnerFeedback(data);
    vkNotifyPartnerFeedback(data);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Partner] feedback error:', error);
    res.status(500).json({ error: 'Ошибка отправки' });
  }
});

export default router;
