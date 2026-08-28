import { Router, Request, Response, NextFunction } from 'express';
import { logError, logWarn } from "./logger";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { authStorage } from './auth-storage';
import { storage } from './storage';
import { sendEmail, getVerificationEmailHtml, getPasswordResetEmailHtml, getOrderCancelledAdminEmailHtml, getWholesaleRegistrationEmailHtml, getPartnerSignatureConfirmEmailHtml, getWholesaleApprovedEmailHtml, getWholesaleRejectedEmailHtml } from './email';
import { sendWholesaleRegistrationToBitrix, syncOrderStatusToBitrix } from './bitrix24';
import { notifyWholesaleRegistration, notifyPartnerRegistration, answerCallbackQuery, editMessageText } from './telegram';
import { vkNotifyWholesaleRegistration } from './vk';
import { cdekService } from './cdek';
import { paymentService } from './payments';

import { generateInvoicePDF, generateUpdPDF, generateTorg12PDF } from './invoice';
import { partnerRegisterSchema, LEGAL_DOCUMENT_SLUGS, type LegalDocumentSlug } from '@shared/schema';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Anti-spoof (30.04.2026): убрали заглушку validate.trustProxy=false.
  // Теперь app.set('trust proxy', 1) корректно задаёт ровно один доверенный хоп
  // (Yandex Cloud API Gateway), и express-rate-limit будет защищён от обхода
  // через подделанный X-Forwarded-For при прямом доступе к контейнеру.
});

interface JwtPayload {
  userId: number;
  email: string;
}

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    name: string;
    emailVerified: boolean;
    role?: string;
    companyName?: string | null;
    inn?: string | null;
    kpp?: string | null;
    legalAddress?: string | null;
    contactPerson?: string | null;
    contactPhone?: string | null;
    wholesaleApproved?: boolean;
    wholesaleDiscount?: number;
    totalSpent?: number;
    loyaltyDiscount?: number;
    partnerId?: number;
    partnerSlug?: string;
    partnerStatus?: string;
  };
}

function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn } as jwt.SignOptions);
}

function generateRandomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

const PROD_COOKIE_DOMAIN = process.env.NODE_ENV === 'production' ? '.booomerangs.ru' : undefined;

function authCookieOptions(isSecure: boolean): object {
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    ...(PROD_COOKIE_DOMAIN ? { domain: PROD_COOKIE_DOMAIN } : {}),
  };
}

function authClearCookieOptions(): object {
  return {
    httpOnly: true,
    secure: !!PROD_COOKIE_DOMAIN,
    sameSite: 'lax' as const,
    path: '/',
    ...(PROD_COOKIE_DOMAIN ? { domain: PROD_COOKIE_DOMAIN } : {}),
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return next();
  }
  
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    authStorage.getUserById(decoded.userId).then(async user => {
      if (user) {
        (req as any).user = {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified || false,
          role: user.role || 'retail',
          companyName: user.companyName,
          inn: user.inn,
          kpp: user.kpp,
          legalAddress: user.legalAddress,
          contactPerson: user.contactPerson,
          contactPhone: user.contactPhone,
          wholesaleApproved: user.wholesaleApproved || false,
          wholesaleDiscount: user.wholesaleDiscount ?? 0,
          wholesaleMarkup: (user as any).wholesaleMarkup ?? 0,
          totalSpent: user.totalSpent || 0,
          loyaltyDiscount: user.loyaltyDiscount || 0,
        };

        if (user.role === 'partner') {
          try {
            const partner = await storage.getPartnerByUserId(user.id);
            if (partner) {
              (req as any).user.partnerId = partner.id;
              (req as any).user.partnerSlug = partner.partnerSlug;
              (req as any).user.partnerStatus = partner.status;
            }
          } catch (err) {
            logError('[Auth] Failed to load partner data:', err);
          }
        }
      }
      next();
    }).catch(() => next());
  } catch {
    res.clearCookie('auth_token', authClearCookieOptions());
    next();
  }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

export function requireAdminRole(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Требуются права администратора' });
  }
  next();
}

export function requirePartnerRole(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  if (req.user.role !== 'partner') {
    return res.status(403).json({ error: 'Доступ только для партнёров' });
  }
  if (!req.user.partnerId) {
    return res.status(403).json({ error: 'Партнёрская запись не найдена' });
  }
  if (req.user.partnerStatus !== 'approved') {
    return res.status(403).json({
      error: req.user.partnerStatus === 'pending'
        ? 'Заявка ещё на модерации'
        : req.user.partnerStatus === 'rejected'
          ? 'Заявка отклонена'
          : 'Аккаунт заблокирован',
      partnerStatus: req.user.partnerStatus,
    });
  }
  next();
}

router.post('/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const { password, name } = req.body;
    const email = (req.body.email || '').toLowerCase().trim();
    
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }
    
    const existingUser = await authStorage.getUserByEmailAndRole(email, 'retail');
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = generateRandomToken();
    
    const user = await authStorage.createUser({
      email,
      passwordHash,
      name,
      verificationToken,
    });
    
    if (!user) {
      return res.status(500).json({ error: 'Ошибка создания пользователя' });
    }
    
    // Подтягиваем гостевые заказы к аккаунту и начисляем за них лояльность
    try {
      await storage.mergeGuestOrdersToUser(user.id, email);
    } catch (mergeErr: any) {
      logError('[Auth] Guest order merge failed:', mergeErr?.message);
    }
    
    const verificationUrl = `${config.app.domain}/verify-email?token=${verificationToken}`;
    await sendEmail({
      to: email,
      subject: 'Подтверждение регистрации в BMGBRAND',
      html: getVerificationEmailHtml(name, verificationUrl),
    });
    
    res.json({ 
      message: 'Регистрация успешна! Проверьте почту для подтверждения email.',
      requiresVerification: true,
    });
  } catch (error) {
    logError('[Auth] Register error:', error);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { password, role } = req.body;
    const email = (req.body.email || '').toLowerCase().trim();
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Введите email и пароль' });
    }
    
    const loginRole = role === 'wholesale' ? 'wholesale' : 'retail';
    const user = await authStorage.getUserByEmailAndRole(email, loginRole);
    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    
    // Для оптовиков: требуется одобрение админа (email подтверждается автоматически при approve)
    // Для розничных: требуется подтверждение email
    if (user.role === 'wholesale') {
      if (!user.wholesaleApproved) {
        return res.status(403).json({ 
          error: 'Ваша заявка на оптовый доступ ещё не одобрена администратором.',
          requiresApproval: true,
        });
      }
    } else if (user.role !== 'admin') {
      if (!user.emailVerified) {
        return res.status(403).json({ 
          error: 'Email не подтверждён. Проверьте почту.',
          requiresVerification: true,
        });
      }
    }
    
    // Подтягиваем гостевые заказы к аккаунту и начисляем за них лояльность
    if (loginRole === 'retail' && user.role !== 'admin') {
      try {
        await storage.mergeGuestOrdersToUser(user.id, email);
      } catch (mergeErr: any) {
        logError('[Auth] Guest order merge failed:', mergeErr?.message);
      }
    }

    const token = generateToken({ userId: user.id, email: user.email });
    
    const isProduction = process.env.NODE_ENV === 'production';
    const isSecure = isProduction || req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('auth_token', token, authCookieOptions(isSecure));
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        role: user.role || 'retail',
        companyName: user.companyName,
        inn: user.inn,
        kpp: user.kpp,
        legalAddress: user.legalAddress,
        contactPerson: user.contactPerson,
        contactPhone: user.contactPhone,
        wholesaleApproved: user.wholesaleApproved || false,
        wholesaleDiscount: user.wholesaleDiscount ?? 0,
        wholesaleMarkup: (user as any).wholesaleMarkup ?? 0,
      },
    });
  } catch (error) {
    logError('[Auth] Login error:', error);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  
  try {
    const recalculatedDiscount = await storage.recalculateUserLoyaltyDiscount(req.user.id);
    if (recalculatedDiscount !== req.user.loyaltyDiscount) {
      console.log(`[Auth] User ${req.user.id} loyalty recalculated: ${req.user.loyaltyDiscount}% -> ${recalculatedDiscount}%`);
      req.user.loyaltyDiscount = recalculatedDiscount;
    }
  } catch (err) {
    logError(`[Auth] Loyalty recalc error for user ${req.user.id}:`, err);
  }
  
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.json({ user: req.user });
});

router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('auth_token', authClearCookieOptions());
  res.json({ message: 'Выход выполнен' });
});

router.post('/wholesale/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const { password, companyName, inn, kpp, legalAddress, storeName, storeAddress, contactPerson, contactPhone } = req.body;
    const email = (req.body.email || '').toLowerCase().trim();
    
    if (!email || !password || !companyName || !inn || !legalAddress || !storeName || !storeAddress || !contactPerson || !contactPhone) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }
    
    if (inn.length < 10 || inn.length > 12) {
      return res.status(400).json({ error: 'ИНН должен быть 10 или 12 цифр' });
    }
    
    const existingUser = await authStorage.getUserByEmailAndRole(email, 'wholesale');
    if (existingUser) {
      return res.status(400).json({ error: 'Оптовый аккаунт с таким email уже существует' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = generateRandomToken();
    
    const user = await authStorage.createWholesaleUser({
      email,
      passwordHash,
      name: contactPerson,
      verificationToken,
      companyName,
      inn,
      kpp: kpp || '',
      legalAddress,
      storeName,
      storeAddress,
      contactPerson,
      contactPhone,
    });
    
    if (!user) {
      return res.status(500).json({ error: 'Ошибка создания пользователя' });
    }
    
    await sendEmail({
      to: email,
      subject: 'Заявка на оптовое сотрудничество — BOOOMERANGS',
      html: getWholesaleRegistrationEmailHtml(contactPerson),
    });

    sendWholesaleRegistrationToBitrix({
      email,
      companyName,
      inn,
      kpp: kpp || '',
      legalAddress,
      storeName,
      storeAddress,
      contactPerson,
      contactPhone,
    }).catch(err => {
      logError('[Auth] Failed to send wholesale registration to Bitrix24:', err);
    });

    notifyWholesaleRegistration({
      userId: user.id,
      email,
      contactPerson,
      companyName,
      inn,
      kpp: kpp || '',
      legalAddress,
      storeName,
      storeAddress,
      contactPhone,
    });
    vkNotifyWholesaleRegistration({
      userId: user.id,
      email,
      contactPerson,
      companyName,
      inn,
      kpp: kpp || '',
      legalAddress,
      storeName,
      storeAddress,
      contactPhone,
    });
    
    res.json({ 
      message: 'Заявка отправлена! Проверьте почту для подтверждения email. После подтверждения менеджер рассмотрит вашу заявку.',
      requiresVerification: true,
    });
  } catch (error) {
    logError('[Auth] Wholesale register error:', error);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// УНЭП «email-link first» (30.04.2026)
// ─────────────────────────────────────────────────────────────────────
// До 30.04.2026 партнёр + строки consent_signatures создавались сразу
// при сабмите формы — это было ПЭП по 63-ФЗ. Для УНЭП нужен
// аутентификационный фактор «второй контур», подтверждающий, что
// подписант реально владеет указанным email. Поэтому теперь:
//
//   POST /partner/register  →  валидация → хэширование пароля
//                            → запись в partner_pending_submissions
//                            → отправка письма со ссылкой
//                            (НИЧЕГО в users/partners/consent_signatures
//                             пока НЕ создаётся)
//
//   POST /partner/confirm-signature { token }  →  атомарное создание
//                            user + partner + всех подписей
//                            с method='email-link' и signedAt=NOW()
//                            (момент клика, не сабмита формы).
//
// Преимущества:
// - Email-фактор идентификации (УНЭП-ready);
// - Сообщения для левых email никого ни к чему не привязывают;
// - signedAt = моменту выражения волеизъявления (клик), а не заполнения;
// - Свежий IP/UA/Geo, зафиксированный именно на момент подписания.
// ─────────────────────────────────────────────────────────────────────

// Помощник: вытащить IP/UA/GeoIP из запроса.
// Используется и в /partner/register (контекст сабмита формы — уходит в payload
// pending-таблицы для аналитики), и в /partner/confirm-signature (контекст самого
// акта подписания — попадает в consent_signatures и в partners.consent_*).
async function getRequestSignatureContext(req: Request): Promise<{
  ip: string;
  remoteIp: string;
  userAgent: string;
  geoCountry: string | null;
  geoRegion: string | null;
  geoCity: string | null;
}> {
  const ip = req.ip || '';
  const remoteIp = req.socket?.remoteAddress || '';
  const userAgent = req.headers['user-agent']?.toString().slice(0, 500) || '';
  let geoCountry: string | null = null;
  let geoRegion: string | null = null;
  let geoCity: string | null = null;
  if (ip) {
    try {
      const geoRes = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (geoRes.ok) {
        const geoData = await geoRes.json() as any;
        if (geoData.status === 'success') {
          geoCountry = geoData.country || null;
          geoRegion = geoData.regionName || null;
          geoCity = geoData.city || null;
        }
      }
    } catch (geoErr: any) {
      logWarn('[Partner] GeoIP lookup failed (non-blocking):', geoErr?.message?.substring(0, 120));
    }
  }
  return { ip, remoteIp, userAgent, geoCountry, geoRegion, geoCity };
}

router.post('/partner/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = partnerRegisterSchema.safeParse({
      ...req.body,
      email: (req.body.email || '').toLowerCase().trim(),
      partnerSlug: (req.body.partnerSlug || '').toLowerCase().trim(),
    });

    if (!parsed.success) {
      const firstError = parsed.error.errors[0];
      return res.status(400).json({ error: firstError?.message || 'Некорректные данные' });
    }

    const data = parsed.data;
    const { email, password, contactName, storeName, partnerSlug, contactPhone, legalStatus } = data as any;

    const existingUser = await authStorage.getUserByEmailAndRole(email, 'partner');
    console.log(`[Partner Register] email="${email}" existingUser=${existingUser ? `id=${existingUser.id} email=${existingUser.email}` : 'null'}`);
    if (existingUser) {
      return res.status(400).json({ error: 'Партнёрский аккаунт с таким email уже существует' });
    }

    const slugTaken = await storage.isPartnerSlugTaken(partnerSlug);
    if (slugTaken) {
      return res.status(400).json({ error: 'Этот идентификатор уже занят, выберите другой' });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Сверяем актуальные версии всех документов, требующих подписи.
    // Хэши пишем в payload pending-сабмита и проверяем заново на confirm —
    // если документ обновится за время ожидания клика, будет 409 stale.
    // ─────────────────────────────────────────────────────────────────────
    const requiredSlugs: LegalDocumentSlug[] = ['offer', 'privacy'];
    if (legalStatus === 'self_employed') { requiredSlugs.push('adult'); requiredSlugs.push('self_employed'); }

    const docs: Record<string, { id: string; version: string; hash: string }> = {};
    for (const slug of requiredSlugs) {
      const doc = await storage.getActiveLegalDocument(slug);
      if (!doc) {
        return res.status(500).json({ error: `Не найдена активная версия документа "${slug}". Свяжитесь с поддержкой.` });
      }
      docs[slug] = { id: doc.id, version: doc.version, hash: doc.bodyHash };
    }
    let marketingDoc: { id: string; version: string; hash: string } | null = null;
    if ((data as any).acceptMarketing === true) {
      const m = await storage.getActiveLegalDocument('marketing');
      if (m) marketingDoc = { id: m.id, version: m.version, hash: m.bodyHash };
    }

    // Сверка хэшей с присланными клиентом — защита от подмены текста между
    // показом и сабмитом.
    const clientHashes: Record<string, string | undefined> = {
      offer: (data as any).offerHash,
      privacy: (data as any).privacyHash,
      adult: (data as any).adultHash,
      self_employed: (data as any).selfEmployedHash,
      marketing: (data as any).marketingHash,
    };
    for (const slug of requiredSlugs) {
      const ch = clientHashes[slug];
      if (ch && ch !== docs[slug].hash) {
        return res.status(409).json({
          error: `Документ "${slug}" обновился, пока вы заполняли форму. Перезагрузите страницу и подпишите заново.`,
          stale: slug,
        });
      }
    }

    // Контекст САБМИТА формы (уходит в payload pending для аудита)
    const submitCtx = await getRequestSignatureContext(req);

    // Хэш пароля кладём в payload — на confirm-эндпойнте создадим user
    // напрямую с этим passwordHash, плэйнтекст пароля нигде больше не оседает.
    const passwordHash = await bcrypt.hash(password, 10);

    // Полезная нагрузка: всё, что нужно для атомарного создания user+partner+signatures
    // в момент клика по ссылке. Версии/хэши документов фиксируем как СНИМОК
    // на момент сабмита; на confirm сверим с активными ещё раз (чтобы поймать
    // обновление документа за время ожидания клика).
    const payload: any = {
      email,
      passwordHash,
      contactName,
      storeName,
      partnerSlug,
      contactPhone: contactPhone || null,
      legalStatus,
      lastName: (data as any).lastName,
      firstName: (data as any).firstName,
      middleName: (data as any).middleName ?? null,
      inn: (data as any).inn,
      birthDate: (data as any).birthDate ?? null,
      citizenship: (data as any).citizenship ?? 'RU',
      platformDescription: (data as any).platformDescription ?? null,
      bankAccount: (data as any).bankAccount ?? null,
      bankBik: (data as any).bankBik ?? null,
      bankName: (data as any).bankName ?? null,
      bankCorrAccount: (data as any).bankCorrAccount ?? null,
      acceptMarketing: (data as any).acceptMarketing === true,
      isArtist: Boolean((data as any).isArtist),
      // ИП/ООО доп. поля
      companyName: (data as any).companyName ?? null,
      kpp: (data as any).kpp ?? null,
      ogrn: (data as any).ogrn ?? null,
      legalAddress: (data as any).legalAddress ?? null,
      signerPosition: (data as any).signerPosition ?? null,
      signerBasis: (data as any).signerBasis ?? null,
      // Снимок версий документов (используется на confirm для построения signatures)
      docsSnapshot: {
        offer:    { id: docs.offer.id,    version: docs.offer.version,    hash: docs.offer.hash },
        privacy:  { id: docs.privacy.id,  version: docs.privacy.version,  hash: docs.privacy.hash },
        adult: legalStatus === 'self_employed'
          ? { id: docs.adult.id, version: docs.adult.version, hash: docs.adult.hash }
          : null,
        self_employed: legalStatus === 'self_employed'
          ? { id: docs.self_employed.id, version: docs.self_employed.version, hash: docs.self_employed.hash }
          : null,
        marketing: marketingDoc
          ? { id: marketingDoc.id, version: marketingDoc.version, hash: marketingDoc.hash }
          : null,
      },
      // Контекст сабмита (для криминалистики: «сабмитили с одного IP, кликнули с другого»)
      submitContext: submitCtx,
    };

    const formHashes = clientHashes;

    const token = generateRandomToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час

    const ok = await storage.createPartnerPendingSubmission({
      token,
      payload,
      formHashes,
      ip: submitCtx.ip,
      remoteIp: submitCtx.remoteIp || null,
      userAgent: submitCtx.userAgent,
      geoCountry: submitCtx.geoCountry,
      geoRegion: submitCtx.geoRegion,
      geoCity: submitCtx.geoCity,
      expiresAt,
    });

    if (!ok) {
      return res.status(500).json({ error: 'Не удалось создать заявку. Попробуйте ещё раз через минуту.' });
    }

    // Письмо со ссылкой — это фактор «второй контур» для УНЭП.
    const confirmUrl = `${config.app.domain}/partner/confirm-signature?token=${token}`;
    try {
      await sendEmail({
        to: email,
        subject: 'Подтвердите подписание партнёрского договора — BMG BRAND',
        html: getPartnerSignatureConfirmEmailHtml(contactName, confirmUrl),
      });
    } catch (e: any) {
      logError('[Partner Register] Не удалось отправить письмо-подтверждение', e?.message);
      // Не валим регистрацию: pending уже создан, пользователь увидит сообщение.
      // На прод-проверке придётся вручную пересоздать заявку.
    }

    // Dev-лог: помогает отлаживать поток подписания, когда ссылка в письме ведёт
    // на прод-домен (а тестируем мы в dev/Replit). На проде НЕ выводим — там
    // токен попадает только в письмо.
    if (process.env.NODE_ENV !== 'production') {
      const replitDev = process.env.REPLIT_DEV_DOMAIN;
      const devUrl = replitDev ? `https://${replitDev}/partner/confirm-signature?token=${token}` : null;
      console.log(`[Partner Register] Pending создан для ${email}. PROD-link: ${confirmUrl}` +
        (devUrl ? ` | DEV-link: ${devUrl}` : ''));
    }

    res.json({
      message: 'Мы отправили письмо со ссылкой подтверждения. Перейдите по ссылке в письме — это и есть ваша подпись под документами BMG BRAND. Ссылка действует 1 час.',
      requiresEmailConfirmation: true,
      expiresInMinutes: 60,
    });
  } catch (error) {
    logError('[Auth] Partner register error:', error);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// УНЭП «email-link first» (30.04.2026): подтверждение клика по ссылке
// ─────────────────────────────────────────────────────────────────────
// Идempotent-семантика: после успешного создания партнёра pending-строка
// удаляется, так что повторный клик по ссылке вернёт 404. SPA-страница
// /partner/confirm-signature ловит это и показывает осмысленное сообщение.
router.post('/partner/confirm-signature', authLimiter, async (req: Request, res: Response) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token || token.length < 16 || token.length > 256) {
      return res.status(400).json({ error: 'Некорректная ссылка подтверждения.' });
    }

    const pending = await storage.getPartnerPendingSubmission(token);
    if (!pending) {
      return res.status(404).json({ error: 'Ссылка устарела или уже была использована. Подайте заявку заново.', code: 'token_not_found' });
    }
    if (pending.expiresAt.getTime() < Date.now()) {
      // YDB-TTL может ещё не успеть удалить — подчищаем синхронно
      await storage.deletePartnerPendingSubmission(token);
      return res.status(410).json({ error: 'Срок действия ссылки истёк (1 час). Подайте заявку заново.', code: 'expired' });
    }

    const p = pending.payload || {};
    const email = String(p.email || '').toLowerCase().trim();
    const partnerSlug = String(p.partnerSlug || '').toLowerCase().trim();
    const legalStatus = p.legalStatus;

    if (!email || !partnerSlug || !legalStatus) {
      await storage.deletePartnerPendingSubmission(token);
      return res.status(400).json({ error: 'Повреждённая заявка, подайте её заново.' });
    }

    // Re-check: за время ожидания клика email/slug могли занять
    const existingUser = await authStorage.getUserByEmailAndRole(email, 'partner');
    if (existingUser) {
      await storage.deletePartnerPendingSubmission(token);
      return res.status(409).json({ error: 'Пока вы ждали письмо, этот email уже зарегистрирован. Войдите или восстановите пароль.', code: 'email_taken' });
    }
    const slugTaken = await storage.isPartnerSlugTaken(partnerSlug);
    if (slugTaken) {
      await storage.deletePartnerPendingSubmission(token);
      return res.status(409).json({ error: 'Пока вы ждали письмо, этот идентификатор магазина был занят. Подайте заявку заново.', code: 'slug_taken' });
    }

    // Re-check: версии активных документов могли поменяться — тогда отказ
    const requiredSlugs: LegalDocumentSlug[] = ['offer', 'privacy'];
    if (legalStatus === 'self_employed') { requiredSlugs.push('adult'); requiredSlugs.push('self_employed'); }
    const liveDocs: Record<string, { id: string; version: string; hash: string }> = {};
    for (const slug of requiredSlugs) {
      const doc = await storage.getActiveLegalDocument(slug);
      if (!doc) {
        return res.status(500).json({ error: `Не найдена активная версия документа "${slug}". Свяжитесь с поддержкой.` });
      }
      liveDocs[slug] = { id: doc.id, version: doc.version, hash: doc.bodyHash };
    }
    let liveMarketing: { id: string; version: string; hash: string } | null = null;
    if (p.acceptMarketing === true) {
      const m = await storage.getActiveLegalDocument('marketing');
      if (m) liveMarketing = { id: m.id, version: m.version, hash: m.bodyHash };
    }
    const snap = p.docsSnapshot || {};
    for (const slug of requiredSlugs) {
      const sn = (snap as any)[slug];
      if (!sn || sn.hash !== liveDocs[slug].hash) {
        await storage.deletePartnerPendingSubmission(token);
        return res.status(409).json({
          error: `За время ожидания подтверждения документ "${slug}" обновился. Подайте заявку заново и подпишите актуальную версию.`,
          stale: slug,
          code: 'stale',
        });
      }
    }
    if (p.acceptMarketing === true && liveMarketing) {
      const sn = snap.marketing;
      if (sn && sn.hash !== liveMarketing.hash) {
        await storage.deletePartnerPendingSubmission(token);
        return res.status(409).json({
          error: 'За время ожидания подтверждения согласие на маркетинг обновилось. Подайте заявку заново.',
          stale: 'marketing',
          code: 'stale',
        });
      }
    }

    // Контекст КЛИКА (момент подписания) — это и есть signedAt/IP/UA для УНЭП
    const clickCtx = await getRequestSignatureContext(req);
    const signedAt = new Date();

    // Сначала создаём user (он отдельной транзакцией к partners)
    const user = await authStorage.createPartnerUser({
      email,
      passwordHash: String(p.passwordHash),
      name: String(p.contactName || email),
      verificationToken: generateRandomToken(),
    });
    if (!user) {
      return res.status(500).json({ error: 'Ошибка создания пользователя' });
    }

    const kycCommon: any = {
      userId: user.id,
      partnerSlug,
      storeName: String(p.storeName || ''),
      contactName: String(p.contactName || ''),
      contactEmail: email,
      contactPhone: p.contactPhone || null,
      commissionOverride: null,
      legalStatus,
      lastName: p.lastName,
      firstName: p.firstName,
      middleName: p.middleName ?? null,
      inn: p.inn,
      birthDate: p.birthDate ? new Date(p.birthDate) : null,
      citizenship: p.citizenship ?? 'RU',
      platformDescription: p.platformDescription ?? null,
      bankAccount: p.bankAccount ?? null,
      bankBik: p.bankBik ?? null,
      bankName: p.bankName ?? null,
      bankCorrAccount: p.bankCorrAccount ?? null,
      offerAcceptedAt: signedAt,
      offerVersion: liveDocs.offer.version,
      privacyAcceptedAt: signedAt,
      privacyVersion: liveDocs.privacy.version,
      adultAcceptedAt: legalStatus === 'self_employed' ? signedAt : null,
      adultVersion: legalStatus === 'self_employed' ? liveDocs.adult?.version ?? null : null,
      selfEmployedAcceptedAt: legalStatus === 'self_employed' ? signedAt : null,
      selfEmployedVersion: legalStatus === 'self_employed' ? liveDocs.self_employed?.version ?? null : null,
      marketingAcceptedAt: liveMarketing ? signedAt : null,
      marketingVersion: liveMarketing ? liveMarketing.version : null,
      consentIp: clickCtx.ip,
      consentRemoteIp: clickCtx.remoteIp,
      consentCountry: clickCtx.geoCountry,
      consentRegion: clickCtx.geoRegion,
      consentCity: clickCtx.geoCity,
      consentUserAgent: clickCtx.userAgent,
      consentSignedAt: signedAt,
      offerHash: liveDocs.offer.hash,
      privacyHash: liveDocs.privacy.hash,
      adultHash: legalStatus === 'self_employed' ? liveDocs.adult?.hash ?? null : null,
      selfEmployedHash: legalStatus === 'self_employed' ? liveDocs.self_employed?.hash ?? null : null,
      marketingHash: liveMarketing ? liveMarketing.hash : null,
      isArtist: Boolean(p.isArtist),
    };
    if (legalStatus === 'ip') {
      kycCommon.ogrn = p.ogrn;
    }
    if (legalStatus === 'ooo') {
      kycCommon.companyName = p.companyName;
      kycCommon.kpp = p.kpp;
      kycCommon.ogrn = p.ogrn;
      kycCommon.legalAddress = p.legalAddress;
      kycCommon.signerPosition = p.signerPosition;
      kycCommon.signerBasis = p.signerBasis;
    }

    const signedDocs: Array<{ slug: LegalDocumentSlug; id: string; version: string; hash: string }> = [
      { slug: 'offer',   id: liveDocs.offer.id,   version: liveDocs.offer.version,   hash: liveDocs.offer.hash },
      { slug: 'privacy', id: liveDocs.privacy.id, version: liveDocs.privacy.version, hash: liveDocs.privacy.hash },
    ];
    if (legalStatus === 'self_employed') {
      if (liveDocs.adult) signedDocs.push({ slug: 'adult', id: liveDocs.adult.id, version: liveDocs.adult.version, hash: liveDocs.adult.hash });
      if (liveDocs.self_employed) signedDocs.push({ slug: 'self_employed', id: liveDocs.self_employed.id, version: liveDocs.self_employed.version, hash: liveDocs.self_employed.hash });
    }
    if (liveMarketing) {
      signedDocs.push({ slug: 'marketing', id: liveMarketing.id, version: liveMarketing.version, hash: liveMarketing.hash });
    }
    const signatures = signedDocs.map((sd) => ({
      documentId: sd.id,
      documentSlug: sd.slug,
      documentVersion: sd.version,
      documentHash: sd.hash,
      signedAt,
      ip: clickCtx.ip,
      remoteIp: clickCtx.remoteIp,
      geoCountry: clickCtx.geoCountry,
      geoRegion: clickCtx.geoRegion,
      geoCity: clickCtx.geoCity,
      userAgent: clickCtx.userAgent,
      // УНЭП «email-link first»: метод подписания — переход по одноразовой ссылке из письма
      method: 'email-link',
    }));

    const partner = await storage.createPartner(kycCommon, signatures as any);

    if (!partner) {
      // Компенсирующий откат: убираем созданного user, чтобы заявку можно было подать заново
      try { await authStorage.deletePartnerUser(user.id); } catch (rb: any) {
        logError('[Partner Confirm] Откат учётки не удался, требуется ручная очистка users.id =', user.id, rb?.message);
      }
      return res.status(500).json({ error: 'Ошибка создания партнёра' });
    }

    // Удаляем pending-строку (одноразовость ссылки + чистота)
    await storage.deletePartnerPendingSubmission(token);

    // Telegram-уведомление команде о новой заявке (fire-and-forget) — переехало с register
    notifyPartnerRegistration({
      contactName: String(p.contactName || ''),
      email,
      partnerSlug,
      contactPhone: p.contactPhone || null,
      legalStatus: legalStatus || null,
      storeName: String(p.storeName || '') || null,
      platformDescription: p.platformDescription || null,
      geoCity: clickCtx.geoCity,
      geoRegion: clickCtx.geoRegion,
      geoCountry: clickCtx.geoCountry,
    });

    res.json({
      ok: true,
      message: 'Подпись зафиксирована. Заявка передана менеджеру на рассмотрение.',
      partnerSlug,
      contactName: String(p.contactName || ''),
    });
  } catch (error: any) {
    logError('[Auth] Partner confirm-signature error:', error);
    res.status(500).json({ error: 'Ошибка подтверждения подписи' });
  }
});

router.post('/partner/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    const email = (req.body.email || '').toLowerCase().trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Введите email и пароль' });
    }

    const user = await authStorage.getUserByEmailAndRole(email, 'partner');
    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    // Email обязательно должен быть подтверждён (юр. требование 152-ФЗ:
    // подтверждение, что согласия дал именно владелец email)
    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Подтвердите email по ссылке в письме, которое мы отправили при регистрации.',
        requiresEmailVerification: true,
        email: user.email,
      });
    }

    const partner = await storage.getPartnerByUserId(user.id);
    if (!partner) {
      return res.status(403).json({ error: 'Партнёрская запись не найдена' });
    }

    if (partner.status === 'pending') {
      return res.status(403).json({
        error: 'Ваша заявка ещё на модерации. Дождитесь одобрения менеджером.',
        partnerStatus: 'pending',
      });
    }
    if (partner.status === 'rejected') {
      return res.status(403).json({
        error: 'К сожалению, ваша заявка отклонена.',
        partnerStatus: 'rejected',
      });
    }
    if (partner.status === 'blocked') {
      return res.status(403).json({
        error: 'Аккаунт заблокирован. Свяжитесь с поддержкой.',
        partnerStatus: 'blocked',
      });
    }

    const token = generateToken({ userId: user.id, email: user.email });

    const isProduction = process.env.NODE_ENV === 'production';
    const isSecure = isProduction || req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('auth_token', token, authCookieOptions(isSecure));

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: 'partner',
        partnerId: partner.id,
        partnerSlug: partner.partnerSlug,
        partnerStatus: partner.status,
      },
    });
  } catch (error) {
    logError('[Auth] Partner login error:', error);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

router.patch('/wholesale/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    
    if (req.user.role !== 'wholesale') {
      return res.status(403).json({ error: 'Доступ только для оптовых покупателей' });
    }
    
    const { companyName, inn, kpp, legalAddress, contactPerson, contactPhone } = req.body;
    
    const success = await authStorage.updateWholesaleData(req.user.id, {
      companyName,
      inn,
      kpp,
      legalAddress,
      contactPerson,
      contactPhone,
    });
    
    if (!success) {
      return res.status(500).json({ error: 'Ошибка обновления данных' });
    }
    
    res.json({ message: 'Данные обновлены' });
  } catch (error) {
    logError('[Auth] Update wholesale profile error:', error);
    res.status(500).json({ error: 'Ошибка обновления профиля' });
  }
});

router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Токен не указан' });
    }
    
    const user = await authStorage.verifyEmail(token);
    if (!user) {
      return res.status(400).json({ error: 'Недействительный или истёкший токен' });
    }
    
    const authToken = generateToken({ userId: user.id, email: user.email });
    
    const isSecureVerify = process.env.NODE_ENV === 'production' || req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('auth_token', authToken, authCookieOptions(isSecureVerify));
    
    res.json({ 
      message: 'Email подтверждён!',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: true,
      },
      token: authToken,
    });
  } catch (error) {
    logError('[Auth] Verify email error:', error);
    res.status(500).json({ error: 'Ошибка подтверждения email' });
  }
});

router.post('/forgot-password', authLimiter, async (req: Request, res: Response) => {
  try {
    const { role } = req.body;
    const email = (req.body.email || '').toLowerCase().trim();
    
    if (!email) {
      return res.status(400).json({ error: 'Введите email' });
    }
    
    // Support all three account types: retail, wholesale, partner.
    // For unknown role values, default to retail to preserve existing behavior.
    const lookupRole: 'retail' | 'wholesale' | 'partner' =
      role === 'wholesale' ? 'wholesale' :
      role === 'partner' ? 'partner' :
      'retail';
    const user = await authStorage.getUserByEmailAndRole(email, lookupRole);
    if (!user) {
      return res.json({ message: 'Если email зарегистрирован, вы получите письмо.' });
    }
    
    const resetToken = generateRandomToken();
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    
    await authStorage.setResetToken(user.id, resetToken, expiry);
    
    const resetUrl = `${config.app.domain}/reset-password?token=${resetToken}`;
    await sendEmail({
      to: email,
      subject: 'Сброс пароля в BMGBRAND',
      html: getPasswordResetEmailHtml(user.name, resetUrl),
    });
    
    res.json({ message: 'Если email зарегистрирован, вы получите письмо.' });
  } catch (error) {
    logError('[Auth] Forgot password error:', error);
    res.status(500).json({ error: 'Ошибка отправки письма' });
  }
});

router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await authStorage.resetPassword(token, passwordHash);
    
    if (!user) {
      return res.status(400).json({ error: 'Недействительный или истёкший токен' });
    }
    
    res.json({ message: 'Пароль успешно изменён!' });
  } catch (error) {
    logError('[Auth] Reset password error:', error);
    res.status(500).json({ error: 'Ошибка сброса пароля' });
  }
});

router.post('/resend-verification', async (req: Request, res: Response) => {
  try {
    const { email, role } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Введите email' });
    }
    
    const lookupRole = role === 'wholesale' ? 'wholesale' : 'retail';
    const user = await authStorage.getUserByEmailAndRole(email, lookupRole);
    if (!user) {
      return res.json({ message: 'Если email зарегистрирован, вы получите письмо.' });
    }
    
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email уже подтверждён' });
    }
    
    const verificationToken = generateRandomToken();
    
    const verificationUrl = `${config.app.domain}/verify-email?token=${verificationToken}`;
    await sendEmail({
      to: email,
      subject: 'Подтверждение регистрации в BMGBRAND',
      html: getVerificationEmailHtml(user.name, verificationUrl),
    });
    
    res.json({ message: 'Письмо отправлено!' });
  } catch (error) {
    logError('[Auth] Resend verification error:', error);
    res.status(500).json({ error: 'Ошибка отправки письма' });
  }
});

router.get('/shipping-data', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    if (req.user.role !== 'wholesale') {
      return res.status(403).json({ error: 'Доступно только для оптовых клиентов' });
    }
    const data = await authStorage.getShippingData(req.user.id);
    if (!data) {
      return res.json({ shippingData: {
        customerName: (req.user as any).contactPerson || req.user.name || '',
        customerEmail: req.user.email || '',
        customerPhone: (req.user as any).contactPhone || '',
        address: '',
        transportCompany: 'cdek',
      }});
    }
    res.json({ shippingData: data });
  } catch (error) {
    logError('[Auth] Error getting shipping data:', error);
    res.status(500).json({ error: 'Ошибка загрузки данных доставки' });
  }
});

router.post('/shipping-data', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    if (req.user.role !== 'wholesale') {
      return res.status(403).json({ error: 'Доступно только для оптовых клиентов' });
    }
    const { customerName, customerEmail, customerPhone, address, transportCompany } = req.body;
    if (!customerName || typeof customerName !== 'string') {
      return res.status(400).json({ error: 'Укажите имя' });
    }
    if (!customerEmail || typeof customerEmail !== 'string') {
      return res.status(400).json({ error: 'Укажите email' });
    }
    const shippingData = {
      customerName: String(customerName).slice(0, 200),
      customerEmail: String(customerEmail).slice(0, 200),
      customerPhone: String(customerPhone || '').slice(0, 30),
      address: String(address || '').slice(0, 500),
      transportCompany: String(transportCompany || 'cdek').slice(0, 50),
    };
    const success = await authStorage.updateShippingData(req.user.id, shippingData);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Не удалось сохранить данные доставки' });
    }
  } catch (error) {
    logError('[Auth] Error saving shipping data:', error);
    res.status(500).json({ error: 'Ошибка сохранения данных доставки' });
  }
});

// Get user's orders
router.get('/orders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }

    const [byUserId, byEmail] = await Promise.all([
      storage.getOrdersByUserId(req.user.id),
      req.user.email ? storage.getOrdersByEmail(req.user.email) : Promise.resolve([]),
    ]);

    const ordersMap = new Map<number, any>();
    for (const o of [...byUserId, ...byEmail]) {
      ordersMap.set(o.id, o);
    }
    const orders = Array.from(ordersMap.values()).sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

    console.log(`[Auth] orders for userId=${req.user.id} email=${req.user.email}: byId=${byUserId.length}, byEmail=${byEmail.length}, total=${orders.length}, ids: ${orders.map(o => o.id).join(', ')}`);
    res.json({ orders });
  } catch (error) {
    logError('[Auth] Get orders error:', error);
    res.status(500).json({ error: 'Ошибка получения заказов' });
  }
});

// Cancel user's order (only if not yet shipped)
router.post('/orders/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const orderId = Number(req.params.id);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Некорректный ID заказа' });
    }
    
    const order = await storage.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }
    
    if (order.userId !== req.user.id) {
      return res.status(403).json({ error: 'Нет доступа к этому заказу' });
    }
    
    const cancellableStatuses = ['pending', 'paid', 'processing'];
    if (!cancellableStatuses.includes(order.status)) {
      return res.status(400).json({ error: 'Заказ уже отправлен и не может быть отменён' });
    }
    
    const previousStatus = order.status;
    await storage.updateOrderStatus(orderId, 'cancelled');
    
    storage.getOrderBitrixDealId(orderId).then(dealId => {
      if (dealId) syncOrderStatusToBitrix(orderId, 'cancelled', dealId);
    }).catch(() => {});
    
    const adminEmails = ['info@booomerangs.ru', 'dmitrij.sob@mail.ru'];
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
    const emailHtml = getOrderCancelledAdminEmailHtml({
      id: orderId,
      customerName: order.customerName || req.user.name || 'Покупатель',
      customerEmail: order.customerEmail || req.user.email,
      total: order.total || 0,
      items,
      status: previousStatus,
    });
    for (const adminEmail of adminEmails) {
      sendEmail({
        to: adminEmail,
        subject: `Заказ #${orderId} отменён покупателем`,
        html: emailHtml,
      }).catch(err => logError(`[Email] Failed to notify ${adminEmail} about cancel:`, err));
    }
    
    console.log(`[Auth] User ${req.user.id} cancelled order #${orderId}`);
    res.json({ success: true, message: 'Заказ отменён' });
  } catch (error) {
    logError('[Auth] Cancel order error:', error);
    res.status(500).json({ error: 'Ошибка отмены заказа' });
  }
});

// Оплатить неоплаченный заказ (повторная оплата) — для мобильного приложения.
router.post('/orders/:id/pay', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
    const orderId = Number(req.params.id);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Некорректный ID заказа' });

    const order = await storage.getOrder(orderId);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.userId !== req.user.id && order.customerEmail !== req.user.email) {
      return res.status(403).json({ error: 'Нет доступа к этому заказу' });
    }

    const payableStatuses = ['pending', 'awaiting_payment', 'created', 'new'];
    if (!payableStatuses.includes(order.status)) {
      return res.status(400).json({ error: 'Заказ уже оплачен или не может быть оплачен' });
    }

    const amount = Number(order.total) || 0;
    if (amount <= 0) {
      return res.status(400).json({ error: 'Сумма к оплате равна нулю' });
    }

    // Способ оплаты: уважаем выбор приложения (paymentMethod в теле), иначе как при
    // создании заказа — YooKassa (redirect, чтобы приложение могло открыть paymentUrl
    // в браузере/WebView), затем T-Bank, если YooKassa выключен.
    const requestedMethod = req.body?.paymentMethod;
    let method: 'yookassa' | 'tbank' | null = null;
    if (requestedMethod === 'yookassa' && paymentService.isYooKassaEnabled()) method = 'yookassa';
    else if (requestedMethod === 'tbank' && paymentService.isTBankEnabled()) method = 'tbank';
    if (!method) method = paymentService.isYooKassaEnabled() ? 'yookassa' : paymentService.isTBankEnabled() ? 'tbank' : null;
    if (!method) {
      return res.status(500).json({ error: 'Оплата не настроена' });
    }

    // Куда вернуть после оплаты: по умолчанию страница успеха заказа на сайте,
    // приложение может передать свой returnUrl в теле запроса.
    const bodyReturnUrl = typeof req.body?.returnUrl === 'string' && req.body.returnUrl.trim() ? req.body.returnUrl.trim() : null;
    const defaultReturnUrl = `${config.app.domain}/order-success/${orderId}`;

    const paymentResult = await paymentService.createPayment({
      amount,
      description: `Заказ #${orderId}`,
      orderId: String(orderId),
      returnUrl: bodyReturnUrl || defaultReturnUrl,
      paymentMethod: method,
      useWidget: false,
    });

    if (!paymentResult.success) {
      logError(`[Auth] Pay order #${orderId} payment failed:`, paymentResult.error);
      return res.status(500).json({ error: paymentResult.error || 'Не удалось создать платёж' });
    }

    if (paymentResult.paymentId) {
      await storage.updateOrderPaymentId(orderId, paymentResult.paymentId);
    }

    console.log(`[Auth] User ${req.user.id} started payment for order #${orderId}: ${paymentResult.confirmationUrl ? 'redirect' : 'widget'}`);
    res.json({
      paymentUrl: paymentResult.confirmationUrl,
      confirmationToken: paymentResult.confirmationToken,
    });
  } catch (error: any) {
    logError('[Auth] Pay order error:', error);
    res.status(500).json({ error: 'Ошибка при оплате' });
  }
});

async function getOrderForUser(orderId: number, user: NonNullable<AuthRequest['user']>) {
  const order = await storage.getOrder(orderId);
  if (!order) return null;
  if (order.userId !== user.id && order.customerEmail !== user.email) return null;
  if (!order.isWholesale) return null;
  return order;
}

function mapOrderItems(items: any[]) {
  return items
    .filter((i: any) => !i._discountDetails)
    .map((i: any) => ({
      name: i.name || i.productName || '',
      sku: i.sku || '',
      quantity: Number(i.quantity) || 0,
      price: Number(i.price) || 0,
    }))
    .filter((i: any) => i.quantity > 0 && i.price > 0);
}

function extractDiscountInfo(items: any[]): { promoCode?: string; promoDiscount?: number } {
  const discountItem = items.find((i: any) => i._discountDetails);
  if (!discountItem) return {};
  const d = discountItem._discountDetails;
  const total = (Number(d.promoDiscountAmount) || 0) + (Number(d.loyaltyDiscountAmount) || 0);
  return {
    promoCode: d.promoCode || undefined,
    promoDiscount: total > 0 ? total : undefined,
  };
}

async function getVatSettings() {
  let vatRate = 5;
  let vatMode: 'included' | 'on_top' = 'included';
  try {
    const vatSetting = await storage.getBonusSetting('invoice_vat_rate');
    if (vatSetting) { const p = parseFloat(vatSetting); if (!isNaN(p)) vatRate = p; }
    const modeSetting = await storage.getBonusSetting('invoice_vat_mode');
    if (modeSetting === 'on_top' || modeSetting === 'included') vatMode = modeSetting;
  } catch {}
  return { vatRate, vatMode };
}

router.get('/orders/:id/invoice', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
    const orderId = Number(req.params.id);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Некорректный ID' });
    const order = await getOrderForUser(orderId, req.user);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    const { vatRate, vatMode } = await getVatSettings();
    const invoiceNum = order.invoiceNumber ?? orderId;
    const items = (typeof order.items === 'string' ? JSON.parse(order.items) : order.items) || [];
    const { promoCode, promoDiscount } = extractDiscountInfo(items);

    const pdfBuffer = await generateInvoicePDF({
      invoiceNumber: invoiceNum,
      date: order.createdAt ? new Date(order.createdAt as any) : new Date(),
      customerName: order.customerName,
      customerInn: req.user.inn || undefined,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      vatRate,
      vatMode,
      promoCode,
      promoDiscount,
      items: mapOrderItems(items),
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Schet_${invoiceNum}_zakaz_${orderId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    logError('[Auth] Download invoice error:', error);
    res.status(500).json({ error: 'Ошибка генерации документа' });
  }
});

router.get('/orders/:id/upd', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
    const orderId = Number(req.params.id);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Некорректный ID' });
    const order = await getOrderForUser(orderId, req.user);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    const { vatRate, vatMode } = await getVatSettings();
    const invoiceNum = order.invoiceNumber ?? orderId;
    const items = (typeof order.items === 'string' ? JSON.parse(order.items) : order.items) || [];

    const pdfBuffer = await generateUpdPDF({
      invoiceNumber: invoiceNum,
      orderId,
      date: order.createdAt ? new Date(order.createdAt as any) : new Date(),
      customerName: order.customerName,
      customerInn: req.user.inn || undefined,
      customerKpp: req.user.kpp || undefined,
      customerAddress: req.user.legalAddress || undefined,
      customerPhone: order.customerPhone,
      vatRate,
      vatMode,
      items: mapOrderItems(items),
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="UPD_${invoiceNum}_zakaz_${orderId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    logError('[Auth] Download UPD error:', error);
    res.status(500).json({ error: 'Ошибка генерации документа' });
  }
});

router.get('/orders/:id/torg12', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
    const orderId = Number(req.params.id);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Некорректный ID' });
    const order = await getOrderForUser(orderId, req.user);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    const { vatRate, vatMode } = await getVatSettings();
    const invoiceNum = order.invoiceNumber ?? orderId;
    const items = (typeof order.items === 'string' ? JSON.parse(order.items) : order.items) || [];

    const pdfBuffer = await generateTorg12PDF({
      invoiceNumber: invoiceNum,
      orderId,
      date: order.createdAt ? new Date(order.createdAt as any) : new Date(),
      customerName: order.customerName,
      customerInn: req.user.inn || undefined,
      customerKpp: req.user.kpp || undefined,
      customerAddress: req.user.legalAddress || undefined,
      customerPhone: order.customerPhone,
      vatRate,
      vatMode,
      items: mapOrderItems(items),
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="TORG12_${invoiceNum}_zakaz_${orderId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    logError('[Auth] Download TORG12 error:', error);
    res.status(500).json({ error: 'Ошибка генерации документа' });
  }
});

router.post('/orders/:id/refresh-tracking', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }

    const orderId = Number(req.params.id);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Некорректный ID заказа' });
    }

    const order = await storage.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    if (order.userId !== req.user.id) {
      return res.status(403).json({ error: 'Нет доступа к этому заказу' });
    }

    if (!order.cdekData) {
      return res.status(400).json({ error: 'Нет данных СДЭК для этого заказа' });
    }

    let cdekInfo: any = {};
    try { cdekInfo = JSON.parse(typeof order.cdekData === 'string' ? order.cdekData : JSON.stringify(order.cdekData)); } catch {}

    if (!cdekInfo.orderUuid) {
      return res.status(400).json({ error: 'Заказ ещё не передан в СДЭК' });
    }

    const cdekStatus = await cdekService.getOrderStatus(cdekInfo.orderUuid);
    if (!cdekStatus) {
      return res.status(502).json({ error: 'Не удалось получить статус из СДЭК' });
    }

    const statuses = cdekStatus.entity?.statuses;
    if (statuses && Array.isArray(statuses) && statuses.length > 0) {
      const latestStatus = statuses[0];
      const cdekCode = latestStatus.code;

      if (cdekStatus.entity?.cdek_number && !cdekInfo.cdekNumber) {
        cdekInfo.cdekNumber = cdekStatus.entity.cdek_number;
      }

      let newOrderStatus: string | null = null;
      if (['CREATED', 'ACCEPTED', 'WAITING'].includes(cdekCode)) {
        if (order.status === 'paid') newOrderStatus = 'processing';
      } else if (['TAKEN_BY_TRANSPORTER', 'IN_TRANSIT', 'ARRIVED_AT_TRANSIT_CITY', 'READY_FOR_SHIPMENT_IN_TRANSIT_CITY'].includes(cdekCode)) {
        if (order.status !== 'shipped') newOrderStatus = 'shipped';
      } else if (['DELIVERED'].includes(cdekCode)) {
        newOrderStatus = 'delivered';
      }

      cdekInfo.lastCdekStatus = cdekCode;
      cdekInfo.lastCdekStatusName = latestStatus.name;
      cdekInfo.lastCdekStatusDate = latestStatus.date_time;
      cdekInfo.cdekStatuses = statuses.slice(0, 10).map((s: any) => ({
        code: s.code,
        name: s.name,
        date: s.date_time,
        city: s.city,
      }));

      await storage.updateOrderCdekData(order.id, JSON.stringify(cdekInfo));

      if (newOrderStatus && newOrderStatus !== order.status) {
        await storage.updateOrderStatus(order.id, newOrderStatus);
        order.status = newOrderStatus;
        storage.getOrderBitrixDealId(order.id).then(dealId => {
          if (dealId) syncOrderStatusToBitrix(order.id, newOrderStatus!, dealId);
        }).catch(() => {});
      }
    }

    res.json({
      success: true,
      cdekData: cdekInfo,
      status: order.status,
    });
  } catch (error: any) {
    logError('[Auth] Refresh tracking error:', error.message);
    res.status(500).json({ error: 'Ошибка обновления трекинга' });
  }
});


// Update user profile (name, phone)
router.patch('/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    const { name, phone } = req.body;
    const updateData: { name?: string; phone?: string } = {};
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (trimmed.length < 2) return res.status(400).json({ error: 'Имя должно быть не менее 2 символов' });
      updateData.name = trimmed.slice(0, 100);
    }
    if (phone !== undefined) {
      updateData.phone = String(phone).trim().slice(0, 20);
    }
    const success = await authStorage.updateProfile(req.user.id, updateData);
    if (!success) {
      return res.status(500).json({ error: 'Ошибка обновления профиля' });
    }
    res.json({ success: true, message: 'Профиль обновлён' });
  } catch (error) {
    logError('[Auth] Update profile error:', error);
    res.status(500).json({ error: 'Ошибка обновления профиля' });
  }
});

// Change password (requires current password)
router.post('/change-password', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Укажите текущий и новый пароль' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Новый пароль должен быть не менее 6 символов' });
    }
    const user = await authStorage.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      return res.status(400).json({ error: 'Неверный текущий пароль' });
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    const success = await authStorage.updatePassword(req.user.id, newHash);
    if (!success) {
      return res.status(500).json({ error: 'Ошибка смены пароля' });
    }
    res.json({ success: true, message: 'Пароль изменён' });
  } catch (error) {
    logError('[Auth] Change password error:', error);
    res.status(500).json({ error: 'Ошибка смены пароля' });
  }
});

// Get saved delivery addresses
router.get('/addresses', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    const addresses = await authStorage.getSavedAddresses(req.user.id);
    res.json({ addresses });
  } catch (error) {
    logError('[Auth] Get addresses error:', error);
    res.status(500).json({ error: 'Ошибка получения адресов' });
  }
});

// Update saved delivery addresses
router.put('/addresses', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    const { addresses } = req.body;
    if (!Array.isArray(addresses)) {
      return res.status(400).json({ error: 'Некорректный формат адресов' });
    }
    if (addresses.length > 10) {
      return res.status(400).json({ error: 'Максимум 10 адресов' });
    }
    const validated = addresses.map((a: any) => ({
      id: String(a.id || Date.now() + Math.random().toString(36).slice(2)),
      label: String(a.label || '').slice(0, 50),
      city: String(a.city || '').slice(0, 100),
      address: String(a.address || '').slice(0, 300),
      postalCode: String(a.postalCode || '').slice(0, 10),
      street: a.street ? String(a.street).slice(0, 150) : undefined,
      house: a.house ? String(a.house).slice(0, 20) : undefined,
      apartment: a.apartment ? String(a.apartment).slice(0, 20) : undefined,
      entrance: a.entrance ? String(a.entrance).slice(0, 10) : undefined,
      floor: a.floor ? String(a.floor).slice(0, 10) : undefined,
      lastName: a.lastName ? String(a.lastName).slice(0, 50) : undefined,
      firstName: a.firstName ? String(a.firstName).slice(0, 50) : undefined,
      patronymic: a.patronymic ? String(a.patronymic).slice(0, 50) : undefined,
      phone: a.phone ? String(a.phone).slice(0, 20) : undefined,
      isDefault: Boolean(a.isDefault),
    }));
    const defaultCount = validated.filter((a: any) => a.isDefault).length;
    if (defaultCount > 1) {
      validated.forEach((a: any, i: number) => { a.isDefault = i === validated.findIndex((x: any) => x.isDefault); });
    }
    const success = await authStorage.updateSavedAddresses(req.user.id, validated);
    if (!success) {
      return res.status(500).json({ error: 'Ошибка сохранения адресов' });
    }
    res.json({ success: true, addresses: validated });
  } catch (error) {
    logError('[Auth] Update addresses error:', error);
    res.status(500).json({ error: 'Ошибка сохранения адресов' });
  }
});

// Get user's gift cards (purchased or received)
router.get('/my-gift-cards', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const cards = await storage.getGiftCardsByEmail(req.user.email);
    res.json(cards.map(card => ({
      id: card.id,
      code: card.code,
      amount: card.amount,
      balance: card.balance,
      status: card.status,
      purchaserEmail: card.purchaserEmail,
      recipientEmail: card.recipientEmail,
      expiresAt: card.expiresAt,
      createdAt: card.createdAt,
    })));
  } catch (error) {
    logError('[Auth] Get gift cards error:', error);
    res.status(500).json({ error: 'Ошибка получения сертификатов' });
  }
});

// YDB хранит expires_at как Optional<Datetime> — parseResultSet отдаёт число
// (unix-секунды), а не Date, поэтому .toISOString() на нём падает.
// Нормализуем в ISO-строку или null.
function normalizePromoExpiresAt(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as any);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Get user's promo codes (from newsletter subscription and used in orders)
router.get('/my-promo-codes', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const promoCodes: Array<{ code: string; discountPercent?: number; discountAmount?: number; source: string; isActive: boolean; expiresAt?: string | null; usedByMe: boolean }> = [];
    
    const userEmail = req.user.email.toLowerCase();
    const subscription = await storage.getNewsletterSubscription(userEmail);
    
    if (subscription) {
      let resolvedPromo: any = null;
      
      if (subscription.promoCodeGiven) {
        resolvedPromo = await storage.getPromoCodeByCode(subscription.promoCodeGiven);
      }
      
      if (!resolvedPromo) {
        try {
          const popupPromoId = await storage.getBonusSetting("popup_promo_id");
          const homepagePromoId = await storage.getBonusSetting("homepage_promo_id");
          const fallbackId = popupPromoId || homepagePromoId;
          if (fallbackId) {
            const allPromos = await storage.getPromoCodes();
            resolvedPromo = allPromos.find((p: any) => String(p.id) === fallbackId);
          }
        } catch (e) {
          // ignore
        }
      }
      
      if (resolvedPromo) {
        const usedByMe = await storage.isPromoUsedByEmail(userEmail, resolvedPromo.code);
        promoCodes.push({
          code: resolvedPromo.code,
          discountPercent: resolvedPromo.discountPercent ?? undefined,
          discountAmount: resolvedPromo.discountAmount ?? undefined,
          source: 'subscription',
          isActive: resolvedPromo.isActive ?? true,
          expiresAt: normalizePromoExpiresAt(resolvedPromo.expiresAt),
          usedByMe,
        });
      }
    }
    
    const ordersByUserId = await storage.getOrdersByUserId(req.user.id);
    const ordersByEmail = await storage.getOrdersByEmail(req.user.email);
    const orderMap = new Map<number, any>();
    [...ordersByUserId, ...ordersByEmail].forEach(o => orderMap.set(o.id, o));
    const allOrders = Array.from(orderMap.values());
    
    const usedCodes: string[] = [];
    for (const order of allOrders) {
      if (order.promoCode && !usedCodes.includes(order.promoCode)) {
        usedCodes.push(order.promoCode);
        if (!promoCodes.find(p => p.code === order.promoCode)) {
          const promo = await storage.getPromoCodeByCode(order.promoCode);
          if (promo) {
            promoCodes.push({
              code: promo.code,
              discountPercent: promo.discountPercent ?? undefined,
              discountAmount: promo.discountAmount ?? undefined,
              source: 'order',
              isActive: promo.isActive ?? true,
              expiresAt: normalizePromoExpiresAt(promo.expiresAt),
              usedByMe: true,
            });
          }
        }
      }
    }
    
    // Промокоды «за отзыв» (выдаются автоматически при одобрении отзыва)
    try {
      const allSettings = await storage.getAllBonusSettings();
      for (const [key, value] of Object.entries(allSettings)) {
        if (!key.startsWith('review_promo:')) continue;
        let rec: any = null;
        try {
          rec = JSON.parse(value);
        } catch {
          continue;
        }
        if (!rec || !rec.code) continue;
        if (String(rec.email || '').toLowerCase() !== userEmail) continue;
        if (promoCodes.find((p) => p.code === rec.code)) continue;
        const promo = await storage.getPromoCodeByCode(rec.code);
        if (!promo) continue;
        const usedByMe = await storage.isPromoUsedByEmail(userEmail, promo.code);
        promoCodes.push({
          code: promo.code,
          discountPercent: promo.discountPercent ?? undefined,
          discountAmount: promo.discountAmount ?? undefined,
          source: 'review',
          isActive: promo.isActive ?? true,
          expiresAt: normalizePromoExpiresAt(promo.expiresAt),
          usedByMe,
        });
      }
    } catch (e) {
      logError('[Auth] Get review promo codes error:', e);
    }
    
    res.json(promoCodes);
  } catch (error) {
    logError('[Auth] Get promo codes error:', error);
    res.status(500).json({ error: 'Ошибка получения промокодов' });
  }
});

// ==================== ADMIN ENDPOINTS ====================

function getAdminKeyForAuth(): string | undefined {
  return process.env.ADMIN_API_KEY || process.env.SYNC_API_KEY;
}

const adminMiddleware = (req: Request, res: Response, next: Function) => {
  const apiKey = req.headers['x-api-key'];
  const adminKey = getAdminKeyForAuth();
  if (!adminKey || apiKey !== adminKey) {
    return res.status(403).json({ error: 'Forbidden: Invalid API key' });
  }
  next();
};

// Get all wholesale users
router.get('/admin/wholesale', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const users = await authStorage.getWholesaleUsers();
    res.json({ users });
  } catch (error) {
    logError('[Admin] Get wholesale users error:', error);
    res.status(500).json({ error: 'Ошибка получения списка оптовиков' });
  }
});

// Approve wholesale user
router.post('/admin/wholesale/:id/approve', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);
    const { discount = 30 } = req.body;
    
    const success = await authStorage.approveWholesale(userId, true, discount);
    if (!success) {
      return res.status(500).json({ error: 'Ошибка подтверждения оптовика' });
    }
    
    // Автоматически подтверждаем email при одобрении оптовика админом
    await authStorage.verifyEmailAdmin(userId);
    
    console.log(`[Admin] Wholesale user ${userId} approved with ${discount}% discount (email auto-verified)`);
    
    res.json({ message: 'Оптовик подтверждён', userId, discount });

    // Email оптовику об одобрении (non-blocking)
    try {
      const user = await authStorage.getUserById(userId);
      if (user?.email) {
        await sendEmail({
          to: user.email,
          subject: 'Ваша заявка на оптовое сотрудничество одобрена — BOOOMERANGS',
          html: getWholesaleApprovedEmailHtml(user.contactPerson || user.name),
        });
      }
    } catch (emailErr: any) {
      logError('[Admin] Wholesale approve email error:', emailErr?.message);
    }
  } catch (error) {
    logError('[Admin] Approve wholesale error:', error);
    res.status(500).json({ error: 'Ошибка подтверждения оптовика' });
  }
});

// Reject/revoke wholesale user
router.post('/admin/wholesale/:id/reject', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);
    
    const success = await authStorage.approveWholesale(userId, false, 0);
    if (!success) {
      return res.status(500).json({ error: 'Ошибка отклонения оптовика' });
    }
    
    console.log(`[Admin] Wholesale user ${userId} rejected`);
    
    res.json({ message: 'Заявка отклонена', userId });

    // Email оптовику об отказе (non-blocking)
    try {
      const user = await authStorage.getUserById(userId);
      if (user?.email) {
        await sendEmail({
          to: user.email,
          subject: 'Решение по вашей заявке на оптовое сотрудничество — BOOOMERANGS',
          html: getWholesaleRejectedEmailHtml(user.contactPerson || user.name),
        });
      }
    } catch (emailErr: any) {
      logError('[Admin] Wholesale reject email error:', emailErr?.message);
    }
  } catch (error) {
    logError('[Admin] Reject wholesale error:', error);
    res.status(500).json({ error: 'Ошибка отклонения оптовика' });
  }
});

// Update wholesale discount/markup
router.patch('/admin/wholesale/:id/discount', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);
    const { discount: rawDiscount, markup: rawMarkup } = req.body;
    
    // Accept either combined value in 'discount' (negative = markup) or separate discount+markup
    let discount: number;
    let markup: number;
    if (typeof rawMarkup === 'number') {
      discount = typeof rawDiscount === 'number' ? Math.max(0, rawDiscount) : 0;
      markup = rawMarkup;
    } else if (typeof rawDiscount === 'number') {
      if (rawDiscount < 0) {
        discount = 0;
        markup = Math.abs(rawDiscount);
      } else {
        discount = rawDiscount;
        markup = 0;
      }
    } else {
      return res.status(400).json({ error: 'Передайте discount (или discount+markup)' });
    }
    
    if (discount < 0 || discount > 100 || markup < 0 || markup > 99) {
      return res.status(400).json({ error: 'Скидка 0-100, наценка 0-99' });
    }
    
    if (discount > 0 && markup > 0) {
      return res.status(400).json({ error: 'Нельзя одновременно задать скидку и наценку' });
    }
    
    const success = await authStorage.approveWholesale(userId, true, discount, markup);
    if (!success) {
      return res.status(500).json({ error: 'Ошибка обновления' });
    }
    
    console.log(`[Admin] Wholesale user ${userId} discount=${discount}% markup=${markup}%`);
    
    res.json({ message: discount > 0 ? 'Скидка обновлена' : markup > 0 ? 'Наценка установлена' : 'Скидка/наценка сброшены', userId, discount, markup });
  } catch (error) {
    logError('[Admin] Update discount error:', error);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

// Delete wholesale user
router.delete('/admin/wholesale/:id', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);
    
    const success = await authStorage.deleteWholesaleUser(userId);
    if (!success) {
      return res.status(500).json({ error: 'Ошибка удаления оптовика' });
    }
    
    console.log(`[Admin] Wholesale user ${userId} deleted`);
    
    res.json({ message: 'Оптовик удалён', userId });
  } catch (error) {
    logError('[Admin] Delete wholesale error:', error);
    res.status(500).json({ error: 'Ошибка удаления оптовика' });
  }
});

// Verify email manually (admin)
router.post('/admin/wholesale/:id/verify-email', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);
    
    const success = await authStorage.verifyEmailAdmin(userId);
    if (!success) {
      return res.status(500).json({ error: 'Ошибка подтверждения email' });
    }
    
    console.log(`[Admin] Email verified for user ${userId}`);
    
    res.json({ message: 'Email подтверждён', userId });
  } catch (error) {
    logError('[Admin] Verify email error:', error);
    res.status(500).json({ error: 'Ошибка подтверждения email' });
  }
});

router.post('/admin/fix-wholesale-order-userids', adminMiddleware, async (req: Request, res: Response) => {
  try {
    console.log('[Admin] Starting wholesale orders user_id migration...');
    
    const orphanOrders = await storage.getWholesaleOrdersWithoutUserId();
    console.log(`[Admin] Found ${orphanOrders.length} wholesale orders without user_id`);
    
    if (orphanOrders.length === 0) {
      return res.json({ message: 'Нет заказов для обновления', updated: 0, failed: 0 });
    }
    
    const uniqueEmails = [...new Set(orphanOrders.map((o: any) => o.customerEmail))];
    console.log(`[Admin] Unique emails to look up: ${uniqueEmails.join(', ')}`);
    
    const emailToUser = new Map<string, number>();
    for (const email of uniqueEmails) {
      const user = await authStorage.getUserByEmail(email);
      if (user) {
        emailToUser.set(email, user.id);
        console.log(`[Admin] Found user ${user.id} for email ${email}`);
      } else {
        console.log(`[Admin] No user found for email ${email}`);
      }
    }
    
    let updated = 0;
    let failed = 0;
    const details: any[] = [];
    
    for (const order of orphanOrders) {
      const userId = emailToUser.get(order.customerEmail);
      if (userId) {
        const success = await storage.updateOrderUserId(order.id, userId);
        if (success) {
          updated++;
          details.push({ orderId: order.id, email: order.customerEmail, userId, status: 'updated' });
        } else {
          failed++;
          details.push({ orderId: order.id, email: order.customerEmail, userId, status: 'failed' });
        }
      } else {
        failed++;
        details.push({ orderId: order.id, email: order.customerEmail, status: 'no_user_found' });
      }
    }
    
    console.log(`[Admin] Migration complete: ${updated} updated, ${failed} failed/skipped`);
    res.json({ message: `Обновлено: ${updated}, не удалось: ${failed}`, updated, failed, details });
  } catch (error) {
    logError('[Admin] Fix wholesale order userids error:', error);
    res.status(500).json({ error: 'Ошибка миграции заказов' });
  }
});

// ============ FAVORITES / WISHLIST ============

router.get('/favorites', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    const favoriteIds = await authStorage.getFavorites(req.user.id);
    if (favoriteIds.length === 0) {
      return res.json([]);
    }
    const allProducts = await storage.getProducts();
    const allProductIds = new Set(allProducts.map((p: any) => p.id));
    const validIds = favoriteIds.filter(id => allProductIds.has(id));
    const deletedIds = favoriteIds.filter(id => !allProductIds.has(id));
    if (deletedIds.length > 0) {
      console.log(`[Auth] Cleaning up ${deletedIds.length} deleted-product favorites for user ${req.user.id}: [${deletedIds.join(', ')}]`);
      Promise.all(deletedIds.map(id => authStorage.removeFavorite(req.user!.id, id))).catch(err => {
        logError('[Auth] Failed to clean deleted favorites:', err);
      });
    }
    res.json(validIds);
  } catch (error) {
    logError('[Auth] Get favorites error:', error);
    res.status(500).json({ error: 'Ошибка загрузки избранного' });
  }
});

router.post('/favorites/:productId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    const productId = parseInt(req.params.productId);
    if (isNaN(productId)) {
      return res.status(400).json({ error: 'Некорректный ID товара' });
    }
    await authStorage.addFavorite(req.user.id, productId);
    res.json({ success: true });
  } catch (error) {
    logError('[Auth] Add favorite error:', error);
    res.status(500).json({ error: 'Ошибка добавления в избранное' });
  }
});

router.delete('/favorites/:productId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    const productId = parseInt(req.params.productId);
    if (isNaN(productId)) {
      return res.status(400).json({ error: 'Некорректный ID товара' });
    }
    await authStorage.removeFavorite(req.user.id, productId);
    res.json({ success: true });
  } catch (error) {
    logError('[Auth] Remove favorite error:', error);
    res.status(500).json({ error: 'Ошибка удаления из избранного' });
  }
});

// Telegram wholesale bot webhook — handles inline button callbacks and chat replies
router.post('/telegram/webhook', async (req: Request, res: Response) => {
  res.sendStatus(200);

  try {
    const update = req.body;

    // Handle admin chat replies in wholesale group
    const message = update?.message;
    if (message?.text && message?.reply_to_message?.message_id) {
      const replyToId: number = message.reply_to_message.message_id;
      const sessionId = await (storage as any).getSessionIdByTgMessageId(replyToId);
      if (sessionId) {
        const adminName = message.from?.first_name || 'Менеджер';
        await storage.saveChatMessage({
          messageId: crypto.randomUUID(),
          sessionId,
          sender: 'admin',
          text: message.text,
          timestamp: Date.now(),
          userName: adminName,
        });
        console.log(`[Chat] Wholesale admin reply saved for session ${sessionId.slice(0, 8)}`);
      }
      return;
    }

    // Handle inline button callbacks (approve/reject wholesale applications)
    const callbackQuery = update?.callback_query;
    if (!callbackQuery) return;

    const callbackId = callbackQuery.id;
    const data: string = callbackQuery.data || '';
    const chatId = String(callbackQuery.message?.chat?.id || '');
    const messageId: number = callbackQuery.message?.message_id;
    const originalText: string = callbackQuery.message?.text || '';

    if (data.startsWith('wh_approve:')) {
      const userId = parseInt(data.split(':')[1]);
      if (isNaN(userId)) return;

      const success = await authStorage.approveWholesale(userId, true, 30);
      if (success) {
        await authStorage.verifyEmailAdmin(userId);
        console.log(`[Telegram] Wholesale user ${userId} approved via Telegram button`);
        await answerCallbackQuery(callbackId, '✅ Клиент принят!');
        await editMessageText(chatId, messageId, originalText + '\n\n✅ <b>Принят</b> (через Telegram)');
        // Email оптовику об одобрении (non-blocking)
        try {
          const user = await authStorage.getUserById(userId);
          if (user?.email) {
            await sendEmail({
              to: user.email,
              subject: 'Ваша заявка на оптовое сотрудничество одобрена — BOOOMERANGS',
              html: getWholesaleApprovedEmailHtml(user.contactPerson || user.name),
            });
          }
        } catch (emailErr: any) {
          logError('[Telegram] Wholesale approve email error:', emailErr?.message);
        }
      } else {
        logError(`[Telegram] Failed to approve wholesale user ${userId}`);
        await answerCallbackQuery(callbackId, '❌ Ошибка — попробуйте ещё раз');
        await editMessageText(chatId, messageId, originalText + '\n\n⚠️ <b>Ошибка при подтверждении — повторите</b>');
      }
    } else if (data.startsWith('wh_reject:')) {
      const userId = parseInt(data.split(':')[1]);
      if (isNaN(userId)) return;

      const success = await authStorage.approveWholesale(userId, false, 0);
      if (success) {
        console.log(`[Telegram] Wholesale user ${userId} rejected via Telegram button`);
        await answerCallbackQuery(callbackId, '❌ Заявка отклонена');
        await editMessageText(chatId, messageId, originalText + '\n\n❌ <b>Отклонено</b> (через Telegram)');
        // Email оптовику об отказе (non-blocking)
        try {
          const user = await authStorage.getUserById(userId);
          if (user?.email) {
            await sendEmail({
              to: user.email,
              subject: 'Решение по вашей заявке на оптовое сотрудничество — BOOOMERANGS',
              html: getWholesaleRejectedEmailHtml(user.contactPerson || user.name),
            });
          }
        } catch (emailErr: any) {
          logError('[Telegram] Wholesale reject email error:', emailErr?.message);
        }
      } else {
        logError(`[Telegram] Failed to reject wholesale user ${userId}`);
        await answerCallbackQuery(callbackId, '❌ Ошибка — попробуйте ещё раз');
        await editMessageText(chatId, messageId, originalText + '\n\n⚠️ <b>Ошибка при отклонении — повторите</b>');
      }
    }
  } catch (error: any) {
    logError('[Telegram] Webhook handler error:', error.message);
  }
});

// ─── Yandex OAuth ───────────────────────────────────────────────────────────
const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID || '';
const YANDEX_CLIENT_SECRET = process.env.YANDEX_CLIENT_SECRET || '';
const YANDEX_REDIRECT_URI = process.env.NODE_ENV === 'production'
  ? 'https://www.booomerangs.ru/api/auth/yandex/callback'
  : `${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000'}/api/auth/yandex/callback`;

router.get('/yandex', (req: Request, res: Response) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: YANDEX_CLIENT_ID,
    redirect_uri: YANDEX_REDIRECT_URI,
    scope: 'login:email login:info login:phone',
    force_confirm: 'no',
  });
  res.redirect(`https://oauth.yandex.ru/authorize?${params.toString()}`);
});

router.get('/yandex/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query as { code?: string; error?: string };

  if (error || !code) {
    return res.redirect('/?auth_error=yandex_denied');
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: YANDEX_CLIENT_ID,
        client_secret: YANDEX_CLIENT_SECRET,
        redirect_uri: YANDEX_REDIRECT_URI,
      }).toString(),
    });

    if (!tokenRes.ok) {
      logError('[Yandex OAuth] Token exchange failed:', await tokenRes.text());
      return res.redirect('/?auth_error=yandex_token');
    }

    const tokenData = await tokenRes.json() as { access_token: string };

    // Get user info
    const infoRes = await fetch('https://login.yandex.ru/info?format=json', {
      headers: { Authorization: `OAuth ${tokenData.access_token}` },
    });

    if (!infoRes.ok) {
      return res.redirect('/?auth_error=yandex_info');
    }

    const info = await infoRes.json() as {
      id: string;
      login: string;
      default_email?: string;
      emails?: string[];
      first_name?: string;
      last_name?: string;
      display_name?: string;
      real_name?: string;
      default_avatar_id?: string;
      sex?: string;
      birthday?: string;
      default_phone?: { number?: string };
    };

    const email = info.default_email || (info.emails?.[0]) || `${info.login}@yandex.ru`;
    const name = [info.last_name, info.first_name].filter(Boolean).join(' ') || info.display_name || info.real_name || info.login;
    const yandexId = info.id;

    const yandexProfile = {
      yandexId,
      yandexLogin: info.login || undefined,
      yandexAvatar: info.default_avatar_id || undefined,
      phone: info.default_phone?.number || undefined,
      birthday: info.birthday || undefined,
      gender: info.sex || undefined,
    };

    // 1. Try to find by Yandex ID first (most reliable)
    let user = await authStorage.getUserByYandexId(yandexId);

    if (!user) {
      // 2. Try to find by email (merge with existing account)
      user = await authStorage.getUserByEmail(email);
      if (user) {
        // Link Yandex ID and save profile to existing account
        await authStorage.saveYandexProfile(user.id, yandexProfile);
        console.log(`[Yandex OAuth] Linked yandex_id to existing user ${user.id} (${email})`);
      }
    }

    if (!user) {
      // 3. Create new user
      const verToken = generateRandomToken();
      user = await authStorage.createUser({
        email,
        passwordHash: '',
        name,
        verificationToken: verToken,
      });
      if (user) {
        await authStorage.verifyEmail(verToken);
        await authStorage.saveYandexProfile(user.id, yandexProfile);
        user = await authStorage.getUserByYandexId(yandexId);
      }
    } else {
      // Re-login: update profile data (avatar, phone, etc. may have changed)
      await authStorage.saveYandexProfile(user.id, yandexProfile);
    }

    if (!user) {
      return res.redirect('/?auth_error=yandex_create');
    }

    const token = generateToken({ userId: user.id, email: user.email });
    const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.secure;
    res.cookie('auth_token', token, authCookieOptions(isSecure));
    res.redirect('/');
  } catch (err: any) {
    logError('[Yandex OAuth] Error:', err.message);
    res.redirect('/?auth_error=yandex_server');
  }
});

// ============================================
// MOBILE AUTH ENDPOINTS
// Same logic as web, but token is included in JSON response body
// ============================================

router.post('/mobile-login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { password, role } = req.body;
    const email = (req.body.email || '').toLowerCase().trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Введите email и пароль' });
    }

    const loginRole = role === 'wholesale' ? 'wholesale' : 'retail';
    const user = await authStorage.getUserByEmailAndRole(email, loginRole);
    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    if (user.role === 'wholesale') {
      if (!user.wholesaleApproved) {
        return res.status(403).json({ error: 'Ваша заявка на оптовый доступ ещё не одобрена администратором.', requiresApproval: true });
      }
    } else if (user.role !== 'admin') {
      if (!user.emailVerified) {
        return res.status(403).json({ error: 'Email не подтверждён. Проверьте почту.', requiresVerification: true });
      }
    }

    const token = generateToken({ userId: user.id, email: user.email });
    const isSecure = process.env.NODE_ENV === 'production' || req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('auth_token', token, authCookieOptions(isSecure));

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        role: user.role || 'retail',
        companyName: user.companyName,
        inn: user.inn,
        kpp: user.kpp,
        legalAddress: user.legalAddress,
        contactPerson: user.contactPerson,
        contactPhone: user.contactPhone,
        wholesaleApproved: user.wholesaleApproved || false,
        wholesaleDiscount: user.wholesaleDiscount ?? 0,
        wholesaleMarkup: (user as any).wholesaleMarkup ?? 0,
      },
    });
  } catch (error) {
    logError('[Auth] Mobile login error:', error);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

router.post('/mobile-register', authLimiter, async (req: Request, res: Response) => {
  try {
    const { password, name } = req.body;
    const email = (req.body.email || '').toLowerCase().trim();

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }

    const existingUser = await authStorage.getUserByEmailAndRole(email, 'retail');
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = generateRandomToken();

    const user = await authStorage.createUser({ email, passwordHash, name, verificationToken });
    if (!user) {
      return res.status(500).json({ error: 'Ошибка создания пользователя' });
    }

    // Auto-verify email for mobile — mobile apps can't open email links the same way
    await authStorage.verifyEmail(verificationToken);

    const token = generateToken({ userId: user.id, email: user.email });
    const isSecure = process.env.NODE_ENV === 'production' || req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('auth_token', token, authCookieOptions(isSecure));

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: true,
        role: user.role || 'retail',
      },
    });
  } catch (error) {
    logError('[Auth] Mobile register error:', error);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

export default router;
