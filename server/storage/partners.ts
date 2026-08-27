// Partners storage (2.4.5a): row mappers + createPartner.
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { DatabaseStorage, productsCache } from "./core";
import type { Partner, InsertPartner, PartnerCommission, PartnerPayout, ConsentSignature, InsertConsentSignature, Product } from "@shared/schema";
import { driver } from "../db";
import { logError } from "../logger";

declare module "./core" {
  interface DatabaseStorage {
    mapPartnerRow(data: Record<string, any>): Partner;
    mapCommissionRow(data: Record<string, any>): PartnerCommission;
    mapPartnerPayoutRow(data: Record<string, any>): PartnerPayout;
    createPartner( data: InsertPartner, signatures?: Array<Omit<InsertConsentSignature, "partnerId">>, ): Promise<Partner>;
    getPartnerById(id: number): Promise<Partner | null>;
    getPartnerByUserId(userId: number): Promise<Partner | null>;
    getPartnerBySlug(slug: string): Promise<Partner | null>;
    isPartnerSlugTaken(slug: string): Promise<boolean>;
    listPartners(filter?: { status?: string }): Promise<Partner[]>;
    updatePartnerContacts(id: number, data: { contactName?: string; contactPhone?: string; storeName?: string }): Promise<void>;
    updatePartnerStatus(id: number, status: "pending" | "approved" | "rejected" | "blocked"): Promise<void>;
    deletePartner(id: number): Promise<void>;
    updatePartnerCommissionOverride(id: number, percent: number | null): Promise<void>;
    setPartnerPayoutRequested(id: number, requested: boolean): Promise<void>;
    updatePartnerBankDetails(id: number, data: { bankBik: string; bankAccount: string; bankName: string; bankCorrAccount: string }): Promise<void>;
    updatePartnerIsArtist(id: number, isArtist: boolean): Promise<void>;
    updatePartnerArtistRate(id: number, rate: number | null): Promise<void>;
    getArtistPartners(): Promise<Partner[]>;
    incrementPartnerClicksBySlug(slug: string): Promise<void>;
    getPartnerProductIds(partnerId: number): Promise<number[]>;
    addPartnerProduct(partnerId: number, productId: number): Promise<void>;
    removePartnerProduct(partnerId: number, productId: number): Promise<void>;
    getArtistProductsBySlug(partnerSlug: string): Promise<Product[]>;
    createArtistProduct(partnerSlug: string, data: { name: string; description: string; price: number; images: string[]; sizes: string[]; sizeStock: Record<string, number>; category: string; composition?: string }): Promise<Product>;
    updateArtistProduct(productId: number, partnerSlug: string, data: Partial<{ name: string; description: string; price: number; images: string[]; sizes: string[]; sizeStock: Record<string, number>; category: string; composition: string; isHidden: boolean }>): Promise<Product>;
    deleteArtistProduct(productId: number, partnerSlug: string): Promise<void>;
    getArtistStatsBySlug(partnerSlug: string, excludeOrderIds?: Set<number>): Promise<{ revenue: number; orders: number; items: number; monthlyRevenue: { month: string; revenue: number }[]; topProducts: { name: string; revenue: number; items: number }[]; }>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.mapPartnerRow = function (this: DatabaseStorage, data: Record<string, any>): Partner {
    const toNum = (v: any): number => {
      if (v === null || v === undefined) return 0;
      const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const toDate = (v: any): Date | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v;
      // YDB Date может возвращаться как кол-во дней с эпохи (число) — переводим в мс.
      if (typeof v === "number" && v > 0 && v < 100000) {
        return new Date(v * 86400000);
      }
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    const s = (v: any) => (v === null || v === undefined ? null : String(v));
    return {
      id: toNum(data.id),
      userId: toNum(data.user_id),
      partnerSlug: String(data.partner_slug || ""),
      storeName: String(data.store_name || ""),
      contactName: String(data.contact_name || ""),
      contactEmail: String(data.contact_email || ""),
      contactPhone: data.contact_phone ? String(data.contact_phone) : null,
      status: String(data.status || "pending"),
      commissionOverride: data.commission_override === null || data.commission_override === undefined ? null : toNum(data.commission_override),
      clicksCount: toNum(data.clicks_count),
      totalEarned: toNum(data.total_earned),
      payoutRequested: Boolean(data.payout_requested),
      createdAt: toDate(data.created_at),
      approvedAt: toDate(data.approved_at),
      // Реквизиты выплат
      payoutMethod: s(data.payout_method),
      payoutDetails: s(data.payout_details),
      payoutFullName: s(data.payout_full_name),
      payoutInn: s(data.payout_inn),
      payoutLegalStatus: s(data.payout_legal_status),
      // KYC
      legalStatus: s(data.legal_status),
      lastName: s(data.last_name),
      firstName: s(data.first_name),
      middleName: s(data.middle_name),
      inn: s(data.inn),
      birthDate: toDate(data.birth_date),
      citizenship: s(data.citizenship),
      platformDescription: s(data.platform_description),
      // Банк
      bankAccount: s(data.bank_account),
      bankBik: s(data.bank_bik),
      bankName: s(data.bank_name),
      bankCorrAccount: s(data.bank_corr_account),
      // Согласия
      offerAcceptedAt: toDate(data.offer_accepted_at),
      offerVersion: s(data.offer_version),
      privacyAcceptedAt: toDate(data.privacy_accepted_at),
      privacyVersion: s(data.privacy_version),
      selfEmployedAcceptedAt: toDate(data.self_employed_accepted_at),
      selfEmployedVersion: s(data.self_employed_version),
      adultAcceptedAt: toDate(data.adult_accepted_at),
      adultVersion: s(data.adult_version),
      marketingAcceptedAt: toDate(data.marketing_accepted_at),
      marketingVersion: s(data.marketing_version),
      consentIp: s(data.consent_ip),
      consentRemoteIp: s(data.consent_remote_ip),
      consentCountry: s(data.consent_country),
      consentRegion: s(data.consent_region),
      consentCity: s(data.consent_city),
      consentUserAgent: s(data.consent_user_agent),
      consentSignedAt: toDate(data.consent_signed_at),
      // Реквизиты ИП/ЮЛ
      companyName: s(data.company_name),
      kpp: s(data.kpp),
      ogrn: s(data.ogrn),
      legalAddress: s(data.legal_address),
      signerPosition: s(data.signer_position),
      signerBasis: s(data.signer_basis),
      // Хэши документов
      offerHash: s(data.offer_hash),
      privacyHash: s(data.privacy_hash),
      adultHash: s(data.adult_hash),
      selfEmployedHash: s(data.self_employed_hash),
      marketingHash: s(data.marketing_hash),
      isArtist: Boolean(data.is_artist) || false,
      artistRate: data.artist_rate !== null && data.artist_rate !== undefined ? Number(data.artist_rate) : null,
    } as Partner;
  }
;

DatabaseStorage.prototype.mapCommissionRow = function (this: DatabaseStorage, data: Record<string, any>): PartnerCommission {
    const toNum = (v: any): number => {
      if (v === null || v === undefined) return 0;
      const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const toDate = (v: any): Date | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    return {
      id: toNum(data.id),
      partnerId: toNum(data.partner_id),
      orderId: toNum(data.order_id),
      orderItemsTotal: toNum(data.order_items_total),
      commissionPercent: toNum(data.commission_percent),
      commissionAmount: toNum(data.commission_amount),
      status: String(data.status || "pending"),
      confirmedAt: toDate(data.confirmed_at),
      paidAt: toDate(data.paid_at),
      holdUntil: toDate(data.hold_until),
      createdAt: toDate(data.created_at),
      commissionType: data.commission_type ? String(data.commission_type) : null,
    } as PartnerCommission;
  }
;

DatabaseStorage.prototype.mapPartnerPayoutRow = function (this: DatabaseStorage, data: Record<string, any>): PartnerPayout {
    const toNum = (v: any): number => {
      if (v === null || v === undefined) return 0;
      const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const toDate = (v: any): Date | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    const toStrOrNull = (v: any): string | null => {
      if (v === null || v === undefined) return null;
      const s = String(v);
      return s.length === 0 ? null : s;
    };
    // Старые записи могут не иметь status — считаем их "awaiting_invoice"
    // (новый дефолт по схеме). Это безопасно: переходы по статусам всё равно
    // проверяются в endpoints, и у старых записей нет invoice_url.
    const status = toStrOrNull(data.status) || "awaiting_invoice";
    return {
      id: toNum(data.id),
      partnerId: toNum(data.partner_id),
      amount: toNum(data.amount),
      commissionCount: toNum(data.commission_count),
      commissionIds: data.commission_ids ? String(data.commission_ids) : "[]",
      method: String(data.method || ""),
      recipientName: String(data.recipient_name || ""),
      recipientDetails: String(data.recipient_details || ""),
      note: data.note ? String(data.note) : null,
      createdBy: data.created_by ? String(data.created_by) : null,
      createdAt: toDate(data.created_at),
      status,
      invoiceUrl: toStrOrNull(data.invoice_url),
      invoiceUploadedAt: toDate(data.invoice_uploaded_at),
      invoiceNumber: toStrOrNull(data.invoice_number),
      paidAt: toDate(data.paid_at),
      paidReference: toStrOrNull(data.paid_reference),
      receiptUrl: toStrOrNull(data.receipt_url),
      receiptUploadedAt: toDate(data.receipt_uploaded_at),
      receiptNumber: toStrOrNull(data.receipt_number),
      // Поля акта (ИП/ЮЛ) — null-safe для старых записей без этих колонок
      actUrl: toStrOrNull(data.act_url),
      actUploadedAt: toDate(data.act_uploaded_at),
      actNumber: toStrOrNull(data.act_number),
      completedAt: toDate(data.completed_at),
      rejectedReason: toStrOrNull(data.rejected_reason),
    } as PartnerPayout;
  }
;

DatabaseStorage.prototype.createPartner = async function (this: DatabaseStorage, 
    data: InsertPartner,
    signatures?: Array<Omit<InsertConsentSignature, "partnerId">>,
  ): Promise<Partner> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const now = new Date();

    const optStr = (v: any) => (v === null || v === undefined || v === "" ? TypedValues.optionalNull(Types.UTF8) : TypedValues.optional(TypedValues.utf8(String(v))));
    const optDate = (v: any) => {
      if (v === null || v === undefined || v === "") return TypedValues.optionalNull(Types.TIMESTAMP);
      const d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return TypedValues.optionalNull(Types.TIMESTAMP);
      return TypedValues.optional(TypedValues.fromNative(Types.TIMESTAMP, d));
    };
    // YDB Date — это «дата без времени», колонка birth_date в проде имеет тип Date.
    const optDateOnly = (v: any) => {
      if (v === null || v === undefined || v === "") return TypedValues.optionalNull(Types.DATE);
      const d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return TypedValues.optionalNull(Types.DATE);
      // Нормализуем до UTC-полуночи дня — так YDB корректно расценит как Date.
      const dateOnly = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      return TypedValues.optional(TypedValues.fromNative(Types.DATE, dateOnly));
    };

    // ─────────────────────────────────────────────────────────────────────
    // Атомарная транзакция: партнёр + строки журнала consent_signatures
    // в одном executeQuery. YDB неявно выполняет все UPSERT в одной
    // serializableReadWrite-транзакции с автокоммитом — либо применятся
    // все, либо ни один. Это закрывает дыру, когда партнёр был создан,
    // а журнал подписей оставался пуст из-за silently-caught ошибки.
    // ─────────────────────────────────────────────────────────────────────
    const sigs = signatures ?? [];
    const sigDeclares: string[] = [];
    const sigUpserts: string[] = [];
    const sigParams: Record<string, any> = {};
    sigs.forEach((sig, i) => {
      const sigId = `${Date.now()}_${i}_${Math.floor(Math.random() * 1e6)}`;
      const signedAtVal = sig.signedAt instanceof Date ? sig.signedAt : new Date(sig.signedAt as any);
      const p = (k: string) => `$sig_${i}_${k}`;
      sigDeclares.push(
        `DECLARE ${p("id")} AS Utf8;`,
        `DECLARE ${p("partner_id")} AS Uint64;`,
        `DECLARE ${p("document_id")} AS Utf8;`,
        `DECLARE ${p("document_slug")} AS Utf8;`,
        `DECLARE ${p("document_version")} AS Utf8;`,
        `DECLARE ${p("document_hash")} AS Utf8;`,
        `DECLARE ${p("signed_at")} AS Timestamp;`,
        `DECLARE ${p("ip")} AS Utf8;`,
        // Anti-spoof (30.04.2026): nullable, чтобы не сломать при отсутствии socket-адреса
        `DECLARE ${p("remote_ip")} AS Utf8?;`,
        // GeoIP (30.04.2026): страна/регион/город для фиксации юрисдикции
        `DECLARE ${p("consent_country")} AS Utf8?;`,
        `DECLARE ${p("consent_region")} AS Utf8?;`,
        `DECLARE ${p("consent_city")} AS Utf8?;`,
        `DECLARE ${p("user_agent")} AS Utf8;`,
        `DECLARE ${p("method")} AS Utf8;`,
      );
      sigUpserts.push(
        `UPSERT INTO consent_signatures
          (id, partner_id, document_id, document_slug, document_version, document_hash, signed_at, ip, remote_ip, consent_country, consent_region, consent_city, user_agent, method)
         VALUES
          (${p("id")}, ${p("partner_id")}, ${p("document_id")}, ${p("document_slug")}, ${p("document_version")}, ${p("document_hash")}, ${p("signed_at")}, ${p("ip")}, ${p("remote_ip")}, ${p("consent_country")}, ${p("consent_region")}, ${p("consent_city")}, ${p("user_agent")}, ${p("method")});`,
      );
      sigParams[p("id")] = TypedValues.utf8(sigId);
      sigParams[p("partner_id")] = TypedValues.uint64(id);
      sigParams[p("document_id")] = TypedValues.utf8(sig.documentId);
      sigParams[p("document_slug")] = TypedValues.utf8(sig.documentSlug);
      sigParams[p("document_version")] = TypedValues.utf8(sig.documentVersion);
      sigParams[p("document_hash")] = TypedValues.utf8(sig.documentHash);
      sigParams[p("signed_at")] = TypedValues.fromNative(Types.TIMESTAMP, signedAtVal);
      sigParams[p("ip")] = TypedValues.utf8(sig.ip);
      sigParams[p("remote_ip")] = (sig as any).remoteIp
        ? TypedValues.optional(TypedValues.utf8(String((sig as any).remoteIp)))
        : TypedValues.optionalNull(Types.UTF8);
      sigParams[p("consent_country")] = (sig as any).geoCountry
        ? TypedValues.optional(TypedValues.utf8(String((sig as any).geoCountry)))
        : TypedValues.optionalNull(Types.UTF8);
      sigParams[p("consent_region")] = (sig as any).geoRegion
        ? TypedValues.optional(TypedValues.utf8(String((sig as any).geoRegion)))
        : TypedValues.optionalNull(Types.UTF8);
      sigParams[p("consent_city")] = (sig as any).geoCity
        ? TypedValues.optional(TypedValues.utf8(String((sig as any).geoCity)))
        : TypedValues.optionalNull(Types.UTF8);
      sigParams[p("user_agent")] = TypedValues.utf8(sig.userAgent);
      sigParams[p("method")] = TypedValues.utf8(sig.method || "checkbox");
    });

    const txResult = await this.safeQuery(async (session) => {
      await session.executeQuery(`
        ${sigDeclares.join("\n        ")}
        DECLARE $id AS Uint64;
        DECLARE $user_id AS Uint64;
        DECLARE $partner_slug AS Utf8;
        DECLARE $store_name AS Utf8;
        DECLARE $contact_name AS Utf8;
        DECLARE $contact_email AS Utf8;
        DECLARE $contact_phone AS Utf8?;
        DECLARE $status AS Utf8;
        DECLARE $commission_override AS Int32?;
        DECLARE $clicks_count AS Int32;
        DECLARE $total_earned AS Int64;
        DECLARE $payout_requested AS Bool;
        DECLARE $created_at AS Timestamp;
        DECLARE $legal_status AS Utf8?;
        DECLARE $last_name AS Utf8?;
        DECLARE $first_name AS Utf8?;
        DECLARE $middle_name AS Utf8?;
        DECLARE $inn AS Utf8?;
        DECLARE $birth_date AS Date?;
        DECLARE $citizenship AS Utf8?;
        DECLARE $platform_description AS Utf8?;
        DECLARE $bank_account AS Utf8?;
        DECLARE $bank_bik AS Utf8?;
        DECLARE $bank_name AS Utf8?;
        DECLARE $bank_corr_account AS Utf8?;
        DECLARE $offer_accepted_at AS Timestamp?;
        DECLARE $offer_version AS Utf8?;
        DECLARE $privacy_accepted_at AS Timestamp?;
        DECLARE $privacy_version AS Utf8?;
        DECLARE $self_employed_accepted_at AS Timestamp?;
        DECLARE $self_employed_version AS Utf8?;
        DECLARE $adult_accepted_at AS Timestamp?;
        DECLARE $adult_version AS Utf8?;
        DECLARE $marketing_accepted_at AS Timestamp?;
        DECLARE $marketing_version AS Utf8?;
        DECLARE $consent_ip AS Utf8?;
        DECLARE $consent_remote_ip AS Utf8?;
        DECLARE $consent_country AS Utf8?;
        DECLARE $consent_region AS Utf8?;
        DECLARE $consent_city AS Utf8?;
        DECLARE $consent_user_agent AS Utf8?;
        DECLARE $consent_signed_at AS Timestamp?;
        DECLARE $company_name AS Utf8?;
        DECLARE $kpp AS Utf8?;
        DECLARE $ogrn AS Utf8?;
        DECLARE $legal_address AS Utf8?;
        DECLARE $signer_position AS Utf8?;
        DECLARE $signer_basis AS Utf8?;
        DECLARE $offer_hash AS Utf8?;
        DECLARE $privacy_hash AS Utf8?;
        DECLARE $adult_hash AS Utf8?;
        DECLARE $self_employed_hash AS Utf8?;
        DECLARE $marketing_hash AS Utf8?;
        DECLARE $is_artist AS Bool?;
        UPSERT INTO partners
          (id, user_id, partner_slug, store_name, contact_name, contact_email, contact_phone,
           status, commission_override, clicks_count, total_earned, payout_requested, created_at,
           legal_status, last_name, first_name, middle_name, inn, birth_date, citizenship, platform_description,
           bank_account, bank_bik, bank_name, bank_corr_account,
           offer_accepted_at, offer_version, privacy_accepted_at, privacy_version,
           self_employed_accepted_at, self_employed_version, adult_accepted_at, adult_version,
           marketing_accepted_at, marketing_version,
           consent_ip, consent_remote_ip, consent_country, consent_region, consent_city, consent_user_agent, consent_signed_at,
           company_name, kpp, ogrn, legal_address, signer_position, signer_basis,
           offer_hash, privacy_hash, adult_hash, self_employed_hash, marketing_hash,
           is_artist)
        VALUES
          ($id, $user_id, $partner_slug, $store_name, $contact_name, $contact_email, $contact_phone,
           $status, $commission_override, $clicks_count, $total_earned, $payout_requested, $created_at,
           $legal_status, $last_name, $first_name, $middle_name, $inn, $birth_date, $citizenship, $platform_description,
           $bank_account, $bank_bik, $bank_name, $bank_corr_account,
           $offer_accepted_at, $offer_version, $privacy_accepted_at, $privacy_version,
           $self_employed_accepted_at, $self_employed_version, $adult_accepted_at, $adult_version,
           $marketing_accepted_at, $marketing_version,
           $consent_ip, $consent_remote_ip, $consent_country, $consent_region, $consent_city, $consent_user_agent, $consent_signed_at,
           $company_name, $kpp, $ogrn, $legal_address, $signer_position, $signer_basis,
           $offer_hash, $privacy_hash, $adult_hash, $self_employed_hash, $marketing_hash,
           $is_artist);
        ${sigUpserts.join("\n        ")}
      `, {
        ...sigParams,
        $id: TypedValues.uint64(id),
        $user_id: TypedValues.uint64(data.userId),
        $partner_slug: TypedValues.utf8(data.partnerSlug),
        $store_name: TypedValues.utf8(data.storeName),
        $contact_name: TypedValues.utf8(data.contactName),
        $contact_email: TypedValues.utf8(data.contactEmail),
        $contact_phone: data.contactPhone ? TypedValues.optional(TypedValues.utf8(data.contactPhone)) : TypedValues.optionalNull(Types.UTF8),
        $status: TypedValues.utf8("pending"),
        $commission_override: data.commissionOverride !== null && data.commissionOverride !== undefined
          ? TypedValues.optional(TypedValues.int32(data.commissionOverride))
          : TypedValues.optionalNull(Types.INT32),
        $clicks_count: TypedValues.int32(0),
        $total_earned: TypedValues.int64(0),
        $payout_requested: TypedValues.bool(false),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, now),
        $legal_status: optStr((data as any).legalStatus),
        $last_name: optStr((data as any).lastName),
        $first_name: optStr((data as any).firstName),
        $middle_name: optStr((data as any).middleName),
        $inn: optStr((data as any).inn),
        $birth_date: optDateOnly((data as any).birthDate),
        $citizenship: optStr((data as any).citizenship),
        $platform_description: optStr((data as any).platformDescription),
        $bank_account: optStr((data as any).bankAccount),
        $bank_bik: optStr((data as any).bankBik),
        $bank_name: optStr((data as any).bankName),
        $bank_corr_account: optStr((data as any).bankCorrAccount),
        $offer_accepted_at: optDate((data as any).offerAcceptedAt),
        $offer_version: optStr((data as any).offerVersion),
        $privacy_accepted_at: optDate((data as any).privacyAcceptedAt),
        $privacy_version: optStr((data as any).privacyVersion),
        $self_employed_accepted_at: optDate((data as any).selfEmployedAcceptedAt),
        $self_employed_version: optStr((data as any).selfEmployedVersion),
        $adult_accepted_at: optDate((data as any).adultAcceptedAt),
        $adult_version: optStr((data as any).adultVersion),
        $marketing_accepted_at: optDate((data as any).marketingAcceptedAt),
        $marketing_version: optStr((data as any).marketingVersion),
        $consent_ip: optStr((data as any).consentIp),
        $consent_remote_ip: optStr((data as any).consentRemoteIp),
        $consent_country: optStr((data as any).consentCountry),
        $consent_region: optStr((data as any).consentRegion),
        $consent_city: optStr((data as any).consentCity),
        $consent_user_agent: optStr((data as any).consentUserAgent),
        $consent_signed_at: optDate((data as any).consentSignedAt),
        $company_name: optStr((data as any).companyName),
        $kpp: optStr((data as any).kpp),
        $ogrn: optStr((data as any).ogrn),
        $legal_address: optStr((data as any).legalAddress),
        $signer_position: optStr((data as any).signerPosition),
        $signer_basis: optStr((data as any).signerBasis),
        $offer_hash: optStr((data as any).offerHash),
        $privacy_hash: optStr((data as any).privacyHash),
        $adult_hash: optStr((data as any).adultHash),
        $self_employed_hash: optStr((data as any).selfEmployedHash),
        $marketing_hash: optStr((data as any).marketingHash),
        $is_artist: TypedValues.optional(TypedValues.fromNative(Types.BOOL, Boolean((data as any).isArtist))),
      });
      return true;
    });
    // safeQuery возвращает null, если транзакция не выполнилась после всех retry
    // или если драйвер недоступен. Раньше код в этом случае шёл дальше и возвращал
    // «фейкового» партнёра — теперь явная ошибка, чтобы вызывающий маршрут отдал 500
    // и не было «полупартнёров» в системе.
    if (txResult !== true) {
      throw new Error("createPartner: транзакция не выполнена (БД недоступна)");
    }
    // Возвращаем созданного партнёра (читаем из БД, чтобы получить все актуальные поля)
    const created = await this.getPartnerById(id);
    return created || ({
      id,
      userId: data.userId,
      partnerSlug: data.partnerSlug,
      storeName: data.storeName,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone ?? null,
      status: "pending",
      commissionOverride: data.commissionOverride ?? null,
      clicksCount: 0,
      totalEarned: 0,
      payoutRequested: false,
      createdAt: now,
      approvedAt: null,
    } as Partner);
  }
;

DatabaseStorage.prototype.getPartnerById = async function (this: DatabaseStorage, id: number): Promise<Partner | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $id AS Uint64;
        SELECT * FROM partners WHERE id = $id;
      `, { $id: TypedValues.uint64(id) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.mapPartnerRow(this.parseRowWithColumns(rs.rows[0], rs.columns));
    });
    return result || null;
  }
;

DatabaseStorage.prototype.getPartnerByUserId = async function (this: DatabaseStorage, userId: number): Promise<Partner | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $user_id AS Uint64;
        SELECT * FROM partners WHERE user_id = $user_id LIMIT 1;
      `, { $user_id: TypedValues.uint64(userId) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.mapPartnerRow(this.parseRowWithColumns(rs.rows[0], rs.columns));
    });
    return result || null;
  }
;

DatabaseStorage.prototype.getPartnerBySlug = async function (this: DatabaseStorage, slug: string): Promise<Partner | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $slug AS Utf8;
        SELECT * FROM partners WHERE partner_slug = $slug LIMIT 1;
      `, { $slug: TypedValues.utf8(slug) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.mapPartnerRow(this.parseRowWithColumns(rs.rows[0], rs.columns));
    });
    return result || null;
  }
;

DatabaseStorage.prototype.isPartnerSlugTaken = async function (this: DatabaseStorage, slug: string): Promise<boolean> {
    const existing = await this.getPartnerBySlug(slug);
    return !!existing;
  }
;

DatabaseStorage.prototype.listPartners = async function (this: DatabaseStorage, filter?: { status?: string }): Promise<Partner[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      // ORDER BY id DESC: id is Date.now()-monotonic Uint64 (always present),
      // safer than ORDER BY created_at (Optional Timestamp can fail in YDB sort).
      let query: string;
      const params: Record<string, any> = {};
      if (filter?.status) {
        query = `
          DECLARE $status AS Utf8;
          SELECT * FROM partners WHERE status = $status ORDER BY id DESC LIMIT 1000;
        `;
        params.$status = TypedValues.utf8(filter.status);
      } else {
        query = `SELECT * FROM partners ORDER BY id DESC LIMIT 1000;`;
      }
      const { resultSets } = await session.executeQuery(query, params);
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapPartnerRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }
;

DatabaseStorage.prototype.updatePartnerContacts = async function (this: DatabaseStorage, id: number, data: { contactName?: string; contactPhone?: string; storeName?: string }): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    const sets: string[] = [];
    const declares: string[] = ["DECLARE $id AS Uint64;"];
    const params: Record<string, any> = { $id: TypedValues.uint64(id) };
    if (typeof data.contactName === "string") {
      declares.push("DECLARE $contact_name AS Utf8;");
      sets.push("contact_name = $contact_name");
      params.$contact_name = TypedValues.utf8(data.contactName);
    }
    if (typeof data.contactPhone === "string") {
      declares.push("DECLARE $contact_phone AS Utf8;");
      sets.push("contact_phone = $contact_phone");
      params.$contact_phone = TypedValues.utf8(data.contactPhone);
    }
    if (typeof data.storeName === "string") {
      declares.push("DECLARE $store_name AS Utf8;");
      sets.push("store_name = $store_name");
      params.$store_name = TypedValues.utf8(data.storeName);
    }
    if (sets.length === 0) return;
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `${declares.join(" ")} UPDATE partners SET ${sets.join(", ")} WHERE id = $id;`,
        params,
      );
    });
  }
;

DatabaseStorage.prototype.updatePartnerStatus = async function (this: DatabaseStorage, id: number, status: "pending" | "approved" | "rejected" | "blocked"): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      const setApproved = status === "approved";
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $status AS Utf8;
        DECLARE $approved_at AS Timestamp?;
        UPDATE partners SET status = $status, approved_at = $approved_at WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $status: TypedValues.utf8(status),
        $approved_at: setApproved
          ? TypedValues.optional(TypedValues.fromNative(Types.TIMESTAMP, new Date()))
          : TypedValues.optionalNull(Types.TIMESTAMP),
      });
    });
  }
;

DatabaseStorage.prototype.deletePartner = async function (this: DatabaseStorage, id: number): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    const params = { $id: TypedValues.uint64(id) };
    const declare = `DECLARE $id AS Uint64;`;
    // 1. Обнуляем partner_id в заказах (историю не удаляем)
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} UPDATE orders SET partner_id = NULL WHERE partner_id = $id;`, params);
    });
    // 2. Удаляем комиссии
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM partner_commissions WHERE partner_id = $id;`, params);
    });
    // 3. Удаляем выплаты
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM partner_payouts WHERE partner_id = $id;`, params);
    });
    // 4. Удаляем связанные товары
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM partner_products WHERE partner_id = $id;`, params);
    });
    // 5. Удаляем подписи документов
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM consent_signatures WHERE partner_id = $id;`, params);
    });
    // 6. Удаляем промокоды
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM promo_codes WHERE partner_id = $id;`, params);
    });
    // 7. Удаляем саму запись партнёра
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM partners WHERE id = $id;`, params);
    });
  }
;

DatabaseStorage.prototype.updatePartnerCommissionOverride = async function (this: DatabaseStorage, id: number, percent: number | null): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $override AS Int32?;
        UPDATE partners SET commission_override = $override WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $override: percent === null
          ? TypedValues.optionalNull(Types.INT32)
          : TypedValues.optional(TypedValues.int32(percent)),
      });
    });
  }
;

DatabaseStorage.prototype.setPartnerPayoutRequested = async function (this: DatabaseStorage, id: number, requested: boolean): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $requested AS Bool;
        UPDATE partners SET payout_requested = $requested WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $requested: TypedValues.bool(requested),
      });
    });
  }
;

DatabaseStorage.prototype.updatePartnerBankDetails = async function (this: DatabaseStorage, id: number, data: { bankBik: string; bankAccount: string; bankName: string; bankCorrAccount: string }): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const optStr = (v: string | null | undefined) =>
      v != null ? TypedValues.optional(TypedValues.utf8(v)) : TypedValues.optional(TypedValues.fromNative(Types.UTF8, ''));
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $bank_bik AS Utf8?;
        DECLARE $bank_account AS Utf8?;
        DECLARE $bank_name AS Utf8?;
        DECLARE $bank_corr_account AS Utf8?;
        UPDATE partners SET
          bank_bik = $bank_bik,
          bank_account = $bank_account,
          bank_name = $bank_name,
          bank_corr_account = $bank_corr_account
        WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $bank_bik: optStr(data.bankBik),
        $bank_account: optStr(data.bankAccount),
        $bank_name: optStr(data.bankName),
        $bank_corr_account: optStr(data.bankCorrAccount),
      });
    });
  }
;

DatabaseStorage.prototype.updatePartnerIsArtist = async function (this: DatabaseStorage, id: number, isArtist: boolean): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $is_artist AS Bool?;
        UPDATE partners SET is_artist = $is_artist WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $is_artist: TypedValues.optional(TypedValues.fromNative(Types.BOOL, isArtist)),
      });
    });
  }
;

DatabaseStorage.prototype.updatePartnerArtistRate = async function (this: DatabaseStorage, id: number, rate: number | null): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $artist_rate AS Double?;
        UPDATE partners SET artist_rate = $artist_rate WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $artist_rate: rate === null
          ? TypedValues.optional(TypedValues.fromNative(Types.DOUBLE, 0))
          : TypedValues.optional(TypedValues.fromNative(Types.DOUBLE, rate)),
      });
    });
  }
;

DatabaseStorage.prototype.getArtistPartners = async function (this: DatabaseStorage, ): Promise<Partner[]> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `SELECT * FROM partners WHERE is_artist = true ORDER BY id DESC LIMIT 500;`,
        {},
      );
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapPartnerRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }
;

DatabaseStorage.prototype.incrementPartnerClicksBySlug = async function (this: DatabaseStorage, slug: string): Promise<void> {
    const partner = await this.getPartnerBySlug(slug);
    if (!partner) return;
    const { TypedValues } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $clicks AS Int32;
        UPDATE partners SET clicks_count = $clicks WHERE id = $id;
      `, {
        $id: TypedValues.uint64(partner.id),
        $clicks: TypedValues.int32(partner.clicksCount + 1),
      });
    });
  }
;

DatabaseStorage.prototype.getPartnerProductIds = async function (this: DatabaseStorage, partnerId: number): Promise<number[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $partner_id AS Uint64;
        SELECT product_id FROM partner_products WHERE partner_id = $partner_id;
      `, { $partner_id: TypedValues.uint64(partnerId) });
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns!);
        const pid = data.product_id;
        const n = typeof pid === "string" ? parseInt(pid, 10) : Number(pid);
        return Number.isFinite(n) ? n : 0;
      }).filter((n: number) => n > 0);
    });
    return result || [];
  }
;

DatabaseStorage.prototype.addPartnerProduct = async function (this: DatabaseStorage, partnerId: number, productId: number): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = `${partnerId}_${productId}`;
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DECLARE $partner_id AS Uint64;
        DECLARE $product_id AS Uint64;
        DECLARE $created_at AS Timestamp;
        UPSERT INTO partner_products (id, partner_id, product_id, created_at)
        VALUES ($id, $partner_id, $product_id, $created_at);
      `, {
        $id: TypedValues.utf8(id),
        $partner_id: TypedValues.uint64(partnerId),
        $product_id: TypedValues.uint64(productId),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, new Date()),
      });
    });
  }
;

DatabaseStorage.prototype.removePartnerProduct = async function (this: DatabaseStorage, partnerId: number, productId: number): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    const id = `${partnerId}_${productId}`;
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DELETE FROM partner_products WHERE id = $id;
      `, { $id: TypedValues.utf8(id) });
    });
  }
;

DatabaseStorage.prototype.getArtistProductsBySlug = async function (this: DatabaseStorage, partnerSlug: string): Promise<Product[]> {
    if (!driver) {
      const all = productsCache.get("all") || [];
      return all.filter((p: any) => p.artistSlug === partnerSlug && !p.isHidden);
    }
    // Direct YDB query — reliable regardless of cache state
    const parsed = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $artist_slug AS Utf8;
        SELECT * FROM products
        WHERE artist_slug = $artist_slug
          AND (is_hidden = false OR is_hidden IS NULL)
        ORDER BY id;
      `;
      const { resultSets } = await session.executeQuery(query, {
        $artist_slug: TypedValues.fromNative(Types.UTF8, partnerSlug),
      });
      const rs = resultSets[0];
      if (!rs?.rows?.length || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns!);
        return this.parseProduct(data);
      });
    });
    return (parsed || []).filter(Boolean);
  }
;

DatabaseStorage.prototype.createArtistProduct = async function (this: DatabaseStorage, partnerSlug: string, data: { name: string; description: string; price: number; images: string[]; sizes: string[]; sizeStock: Record<string, number>; category: string; composition?: string }): Promise<Product> {
    const sizeStock: Record<string, number> = data.sizeStock || {};
    const totalStock = Object.values(sizeStock).reduce((s, v) => s + (Number(v) || 0), 0);
    return this.createProduct({
      name: data.name,
      description: data.description,
      price: data.price,
      images: data.images,
      imageUrl: data.images[0] || '',
      thumbnailUrl: data.images[0] ? data.images[0].replace('.webp', '_thumb.webp') : null,
      sizes: data.sizes,
      sizeStock,
      stock: totalStock,
      category: data.category || 'merch',
      isNew: true,
      onSale: false,
      isHidden: false,
      artistSlug: partnerSlug,
      artistOnly: true,
      composition: data.composition || '',
    } as any);
  }
;

DatabaseStorage.prototype.updateArtistProduct = async function (this: DatabaseStorage, productId: number, partnerSlug: string, data: Partial<{ name: string; description: string; price: number; images: string[]; sizes: string[]; sizeStock: Record<string, number>; category: string; composition: string; isHidden: boolean }>): Promise<Product> {
    // Verify ownership
    const existing = await this.getProduct(productId);
    if (!existing || (existing as any).artistSlug !== partnerSlug) {
      throw new Error('Товар не найден или нет доступа');
    }
    const update: any = { ...data };
    if (data.sizeStock) {
      update.stock = Object.values(data.sizeStock).reduce((s, v) => s + (Number(v) || 0), 0);
    }
    if (data.images && data.images.length > 0) {
      update.imageUrl = data.images[0];
      update.thumbnailUrl = data.images[0].replace('.webp', '_thumb.webp');
    }
    return this.updateProduct(productId, update);
  }
;

DatabaseStorage.prototype.deleteArtistProduct = async function (this: DatabaseStorage, productId: number, partnerSlug: string): Promise<void> {
    const existing = await this.getProduct(productId);
    if (!existing || (existing as any).artistSlug !== partnerSlug) {
      throw new Error('Товар не найден или нет доступа');
    }
    await this.updateProduct(productId, { isHidden: true } as any);
  }
;

DatabaseStorage.prototype.getArtistStatsBySlug = async function (this: DatabaseStorage, partnerSlug: string, excludeOrderIds?: Set<number>): Promise<{
    revenue: number;
    orders: number;
    items: number;
    monthlyRevenue: { month: string; revenue: number }[];
    topProducts: { name: string; revenue: number; items: number }[];
  }> {
    const empty = { revenue: 0, orders: 0, items: 0, monthlyRevenue: [], topProducts: [] };
    if (!driver) return empty;

    // Build set of lowercase product names — direct YDB query (независимо от кэша)
    const artistProductNames = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $artist_slug AS Utf8;
        SELECT name FROM products
        WHERE artist_slug = $artist_slug
          AND (is_hidden = false OR is_hidden IS NULL);
      `;
      const { resultSets } = await session.executeQuery(query, {
        $artist_slug: TypedValues.fromNative(Types.UTF8, partnerSlug),
      });
      const rs = resultSets[0];
      const names = new Set<string>();
      for (const row of rs?.rows || []) {
        const name = this.extractTypedValue((row.items || [])[0]);
        if (name) names.add(String(name).toLowerCase());
      }
      return names;
    }) ?? (() => {
      // Fallback на кэш если YDB-запрос упал
      const all = productsCache.get("all") || [];
      return new Set<string>(
        all.filter((p: any) => p.artistSlug === partnerSlug).map((p: any) => (p.name || '').toLowerCase())
      );
    })();
    if (artistProductNames.size === 0) return empty;

    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, created_at, items
        FROM orders
        WHERE is_wholesale = false
          AND status IN ('paid', 'processing', 'shipped', 'delivered')
        ORDER BY created_at DESC
        LIMIT 3000;
      `;
      const queryResult = await session.executeQuery(query);
      return queryResult.resultSets[0]?.rows || [];
    });
    if (!result) return empty;

    let totalRevenue = 0;
    let totalOrders = 0;
    let totalItems = 0;
    const monthlyMap = new Map<string, number>();
    const productMap = new Map<string, { revenue: number; items: number }>();

    for (const row of result) {
      const cols = row.items || [];
      const orderId = Number(this.extractTypedValue(cols[0]));
      if (excludeOrderIds && excludeOrderIds.size > 0 && excludeOrderIds.has(orderId)) continue;
      const createdAt = this.extractTypedValue(cols[1]);
      const rawItems = this.extractTypedValue(cols[2]);

      let orderItems: any[] = [];
      try { orderItems = JSON.parse(rawItems || '[]'); } catch { continue; }

      let orderHasArtistItems = false;
      let orderArtistRevenue = 0;
      const month = createdAt ? new Date(createdAt).toISOString().slice(0, 7) : null;

      for (const item of orderItems) {
        if (item._discountDetails) continue;
        const nameLower = (item.productName || item.name || '').toLowerCase();
        if (!artistProductNames.has(nameLower)) continue;

        const qty = item.quantity || 1;
        const itemRevenue = (item.price || 0) * qty;
        const displayName = item.productName || item.name || '';

        orderHasArtistItems = true;
        orderArtistRevenue += itemRevenue;
        totalRevenue += itemRevenue;
        totalItems += qty;

        const pm = productMap.get(displayName) || { revenue: 0, items: 0 };
        pm.revenue += itemRevenue;
        pm.items += qty;
        productMap.set(displayName, pm);
      }

      if (orderHasArtistItems) {
        totalOrders += 1;
        if (month) monthlyMap.set(month, (monthlyMap.get(month) || 0) + orderArtistRevenue);
      }
    }

    const monthlyRevenue = Array.from(monthlyMap.entries())
      .map(([month, revenue]) => ({ month, revenue }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const topProducts = Array.from(productMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return { revenue: totalRevenue, orders: totalOrders, items: totalItems, monthlyRevenue, topProducts };
  }
;
