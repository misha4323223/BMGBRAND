/**
 * Персистентность токена Ozon Delivery API.
 *
 * Используем существующую key-value таблицу bonus_settings, чтобы не делать
 * миграцию ради одной записи. В значении лежит JSON с зашифрованным
 * access_token, сроком, правами и SHA-256 отпечатком Client ID. Сырой
 * Client ID, Client Secret и открытый токен в БД не пишем.
 */

import crypto from "crypto";
import { logWarn } from "../logger";
import { config } from "../config";
import { storage } from "../storage";
import type { OzonAccessToken } from "./token";

export const OZON_DELIVERY_TOKEN_SETTING_KEY = "ozon_delivery_api_token";
const STORE_VERSION = 1;
const TOKEN_KEY = crypto
  .createHash("sha256")
  .update(`ozon-delivery-api-token:${config.jwt.secret}`)
  .digest();

export interface OzonTokenStore {
  load(clientIdHash: string): Promise<OzonAccessToken | null>;
  save(clientIdHash: string, token: OzonAccessToken): Promise<void>;
  clear(): Promise<void>;
}

interface EncryptedValue {
  iv: string;
  tag: string;
  data: string;
}

interface StoredTokenPayload {
  version: number;
  clientIdHash: string;
  encryptedAccessToken: EncryptedValue;
  expiresAt: number;
  obtainedAt: number;
  scopes: string[];
}

export interface BonusSettingsAdapter {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export function fingerprintOzonClientId(clientId: string): string {
  return crypto.createHash("sha256").update(clientId.trim()).digest("hex");
}

function encryptAccessToken(value: string): EncryptedValue {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", TOKEN_KEY, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

function decryptAccessToken(value: EncryptedValue): string | null {
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      TOKEN_KEY,
      Buffer.from(value.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(value.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return plain.trim() || null;
  } catch {
    return null;
  }
}

function isEncryptedValue(value: any): value is EncryptedValue {
  return (
    value &&
    typeof value === "object" &&
    typeof value.iv === "string" &&
    typeof value.tag === "string" &&
    typeof value.data === "string"
  );
}

function parseStoredPayload(raw: string): StoredTokenPayload | null {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  if (data.version !== STORE_VERSION) return null;
  if (!isEncryptedValue(data.encryptedAccessToken)) return null;
  if (typeof data.clientIdHash !== "string" || !/^[a-f0-9]{64}$/i.test(data.clientIdHash)) {
    return null;
  }
  if (!Number.isFinite(data.expiresAt) || data.expiresAt <= 0) return null;
  if (!Array.isArray(data.scopes)) return null;

  const scopes = Array.from(
    new Set<string>(
      (data.scopes as unknown[])
        .filter((scope: unknown): scope is string => typeof scope === "string")
        .map((scope: string) => scope.trim())
        .filter(Boolean),
    ),
  );
  if (scopes.length === 0) return null;

  return {
    version: STORE_VERSION,
    clientIdHash: data.clientIdHash,
    encryptedAccessToken: data.encryptedAccessToken,
    expiresAt: Number(data.expiresAt),
    obtainedAt: Number.isFinite(data.obtainedAt) ? Number(data.obtainedAt) : 0,
    scopes,
  };
}

function defaultAdapter(): BonusSettingsAdapter {
  return {
    get: (key) => storage.getBonusSetting(key),
    set: (key, value) => storage.setBonusSetting(key, value),
  };
}

export class YdbOzonTokenStore implements OzonTokenStore {
  private readonly adapter: BonusSettingsAdapter;
  private readonly now: () => number;

  constructor(
    adapter: BonusSettingsAdapter = defaultAdapter(),
    now: () => number = Date.now,
  ) {
    this.adapter = adapter;
    this.now = now;
  }

  async load(clientIdHash: string): Promise<OzonAccessToken | null> {
    const raw = await this.adapter.get(OZON_DELIVERY_TOKEN_SETTING_KEY);
    if (!raw) return null;

    const payload = parseStoredPayload(raw);
    if (!payload) {
      logWarn("[OzonDeliveryAPI] Сохранённый токен повреждён — игнорируем");
      await this.clearSafely();
      return null;
    }

    if (payload.clientIdHash !== clientIdHash) {
      // Токен выдан другому приложению. Не используем и не оставляем в БД.
      logWarn(
        "[OzonDeliveryAPI] Сохранённый токен относится к другому Client ID — игнорируем",
      );
      await this.clearSafely();
      return null;
    }

    if (payload.expiresAt <= this.now()) {
      await this.clearSafely();
      return null;
    }

    const accessToken = decryptAccessToken(payload.encryptedAccessToken);
    if (!accessToken) {
      logWarn(
        "[OzonDeliveryAPI] Сохранённый токен не расшифровался (возможно, сменился JWT_SECRET) — игнорируем",
      );
      await this.clearSafely();
      return null;
    }

    return {
      accessToken,
      expiresAt: payload.expiresAt,
      obtainedAt: payload.obtainedAt,
      scopes: payload.scopes,
    };
  }

  async save(clientIdHash: string, token: OzonAccessToken): Promise<void> {
    const payload: StoredTokenPayload = {
      version: STORE_VERSION,
      clientIdHash,
      encryptedAccessToken: encryptAccessToken(token.accessToken),
      expiresAt: token.expiresAt,
      obtainedAt: token.obtainedAt,
      scopes: token.scopes,
    };
    await this.adapter.set(
      OZON_DELIVERY_TOKEN_SETTING_KEY,
      JSON.stringify(payload),
    );
  }

  async clear(): Promise<void> {
    await this.adapter.set(OZON_DELIVERY_TOKEN_SETTING_KEY, "");
  }

  private async clearSafely(): Promise<void> {
    try {
      await this.clear();
    } catch (err: any) {
      logWarn(
        "[OzonDeliveryAPI] Не удалось очистить сохранённый токен:",
        err?.message || err,
      );
    }
  }
}

export function createOzonTokenStore(): OzonTokenStore {
  return new YdbOzonTokenStore();
}
