/**
 * Admin wholesale endpoints — self-contained Router module.
 * Mounted at /api/admin from routes.ts (alongside admin-partner-routes).
 *
 * Purpose:
 *   - POST /api/admin/wholesale-users — create wholesale user directly from
 *     admin panel (verified instantly, no email confirmation required).
 *
 * Existing wholesale admin endpoints (in routes.ts / auth-routes.ts) handle
 * read/approve/reject/discount/password operations. This module adds CREATE.
 */
import { Router, Request, Response } from 'express';
import { logError } from "./logger";
import bcrypt from 'bcryptjs';
import { authStorage } from './auth-storage';

const router = Router();

/** Same check as adminMiddleware in auth-routes.ts — looks for admin API key in header. */
function adminGuard(req: Request, res: Response, next: Function) {
  const apiKey = req.headers['x-api-key'];
  const adminKey = process.env.ADMIN_API_KEY || process.env.SYNC_API_KEY;
  if (!adminKey || apiKey !== adminKey) {
    return res.status(403).json({ error: 'Forbidden: Invalid API key' });
  }
  next();
}

// ─── POST /api/admin/wholesale-users ───────────────────────────────────────
// Admin creates a wholesale user instantly: no email verification, pre-approved.
// Body: { email, password, name, companyName, inn, kpp?, legalAddress, storeName,
//         storeAddress, contactPerson, contactPhone }
router.post('/wholesale-users', adminGuard, async (req: Request, res: Response) => {
  try {
    const {
      email: rawEmail,
      password,
      name,
      companyName,
      inn,
      kpp,
      legalAddress,
      storeName,
      storeAddress,
      contactPerson,
      contactPhone,
    } = req.body;

    const email = (rawEmail || '').toLowerCase().trim();

    // ── Validation ──────────────────────────────────────────────────────
    if (!email || !password || !name || !companyName || !inn) {
      return res.status(400).json({ error: 'Заполните email, пароль, имя, компанию и ИНН' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }

    if (inn.length < 10 || inn.length > 12) {
      return res.status(400).json({ error: 'ИНН должен быть 10 или 12 цифр' });
    }

    // Check for duplicate
    const existing = await authStorage.getUserByEmailAndRole(email, 'wholesale');
    if (existing) {
      return res.status(400).json({ error: 'Оптовый аккаунт с таким email уже существует' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await authStorage.createWholesaleUserAdmin({
      email,
      passwordHash,
      name,
      companyName,
      inn,
      kpp: kpp || '',
      legalAddress: legalAddress || '',
      storeName: storeName || '',
      storeAddress: storeAddress || '',
      contactPerson: contactPerson || name,
      contactPhone: contactPhone || '',
    });

    if (!user) {
      return res.status(500).json({ error: 'Ошибка создания пользователя' });
    }

    console.log(`[Admin] Wholesale user created by admin: ${email} (id=${user.id})`);

    res.status(201).json({
      message: 'Оптовый покупатель создан',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        wholesaleApproved: true,
        wholesaleDiscount: 0,
      },
    });
  } catch (error: any) {
    logError('[Admin] Create wholesale user error:', error);
    res.status(500).json({ error: 'Ошибка создания оптового покупателя' });
  }
});

export default router;