// Legal docs + consent signatures + pending submissions storage (2.4.5f).
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { DatabaseStorage } from "./core";
import { createHash } from "crypto";
import type { LegalDocument, ConsentSignature, InsertConsentSignature } from "@shared/schema";

declare module "./core" {
  interface DatabaseStorage {
    mapLegalDocumentRow(data: Record<string, any>): LegalDocument;
    createLegalDocument(input: { slug: string; version: string; title: string; body: string; createdBy?: string | null }): Promise<LegalDocument>;
    getActiveLegalDocument(slug: string): Promise<LegalDocument | null>;
    getLegalDocumentById(id: string): Promise<LegalDocument | null>;
    listLegalDocuments(slug?: string): Promise<LegalDocument[]>;
    mapConsentSignatureRow(data: Record<string, any>): ConsentSignature;
    createConsentSignature(input: InsertConsentSignature): Promise<ConsentSignature>;
    listConsentSignaturesByPartnerId(partnerId: number): Promise<ConsentSignature[]>;
    createPartnerPendingSubmission(input: { token: string; payload: any; formHashes: any; ip: string; remoteIp: string | null; userAgent: string; geoCountry: string | null; geoRegion: string | null; geoCity: string | null; expiresAt: Date; }): Promise<boolean>;
    getPartnerPendingSubmission(token: string): Promise<{ token: string; payload: any; formHashes: any; ip: string; remoteIp: string | null; userAgent: string; geoCountry: string | null; geoRegion: string | null; geoCity: string | null; createdAt: Date; expiresAt: Date; } | null>;
    deletePartnerPendingSubmission(token: string): Promise<void>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.mapLegalDocumentRow = function (this: DatabaseStorage, data: Record<string, any>): LegalDocument {
    const toDate = (v: any): Date | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    // parseResultSet уже конвертирует snake_case → camelCase
    return {
      id: String(data.id),
      slug: String(data.slug),
      version: String(data.version),
      title: String(data.title),
      body: String(data.body),
      bodyHash: String(data.bodyHash ?? data.body_hash ?? ""),
      isActive: Boolean(data.isActive ?? data.is_active),
      createdAt: toDate(data.createdAt ?? data.created_at) || new Date(),
      createdBy: (data.createdBy ?? data.created_by) ? String(data.createdBy ?? data.created_by) : null,
    } as LegalDocument;
  }
;

DatabaseStorage.prototype.createLegalDocument = async function (this: DatabaseStorage, input: { slug: string; version: string; title: string; body: string; createdBy?: string | null }): Promise<LegalDocument> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const now = new Date();
    const bodyHash = createHash("sha256").update(input.body, "utf8").digest("hex");

    // Сначала помечаем все предыдущие версии этого slug как неактивные
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $slug AS Utf8;
        UPDATE legal_documents SET is_active = false WHERE slug = $slug;
      `, {
        $slug: TypedValues.utf8(input.slug),
      });
    });

    // Затем вставляем новую активную версию
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DECLARE $slug AS Utf8;
        DECLARE $version AS Utf8;
        DECLARE $title AS Utf8;
        DECLARE $body AS Utf8;
        DECLARE $body_hash AS Utf8;
        DECLARE $is_active AS Bool;
        DECLARE $created_at AS Timestamp;
        DECLARE $created_by AS Utf8?;
        UPSERT INTO legal_documents
          (id, slug, version, title, body, body_hash, is_active, created_at, created_by)
        VALUES
          ($id, $slug, $version, $title, $body, $body_hash, $is_active, $created_at, $created_by);
      `, {
        $id: TypedValues.utf8(id),
        $slug: TypedValues.utf8(input.slug),
        $version: TypedValues.utf8(input.version),
        $title: TypedValues.utf8(input.title),
        $body: TypedValues.utf8(input.body),
        $body_hash: TypedValues.utf8(bodyHash),
        $is_active: TypedValues.bool(true),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, now),
        $created_by: input.createdBy
          ? TypedValues.optional(TypedValues.utf8(input.createdBy))
          : TypedValues.optionalNull(Types.UTF8),
      });
    });

    return {
      id,
      slug: input.slug,
      version: input.version,
      title: input.title,
      body: input.body,
      bodyHash,
      isActive: true,
      createdAt: now,
      createdBy: input.createdBy ?? null,
    } as LegalDocument;
  }
;

DatabaseStorage.prototype.getActiveLegalDocument = async function (this: DatabaseStorage, slug: string): Promise<LegalDocument | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      return session.executeQuery(`
        DECLARE $slug AS Utf8;
        SELECT id, slug, version, title, body, body_hash, is_active, created_at, created_by
        FROM legal_documents
        WHERE slug = $slug AND is_active = true
        ORDER BY created_at DESC
        LIMIT 1;
      `, { $slug: TypedValues.utf8(slug) });
    });
    const rows = result?.resultSets?.[0] ? this.parseResultSet(result.resultSets[0]) : [];
    return rows.length > 0 ? this.mapLegalDocumentRow(rows[0] as Record<string, any>) : null;
  }
;

DatabaseStorage.prototype.getLegalDocumentById = async function (this: DatabaseStorage, id: string): Promise<LegalDocument | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      return session.executeQuery(`
        DECLARE $id AS Utf8;
        SELECT id, slug, version, title, body, body_hash, is_active, created_at, created_by
        FROM legal_documents
        WHERE id = $id
        LIMIT 1;
      `, { $id: TypedValues.utf8(id) });
    });
    const rows = result?.resultSets?.[0] ? this.parseResultSet(result.resultSets[0]) : [];
    return rows.length > 0 ? this.mapLegalDocumentRow(rows[0] as Record<string, any>) : null;
  }
;

DatabaseStorage.prototype.listLegalDocuments = async function (this: DatabaseStorage, slug?: string): Promise<LegalDocument[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      if (slug) {
        return session.executeQuery(`
          DECLARE $slug AS Utf8;
          SELECT id, slug, version, title, body, body_hash, is_active, created_at, created_by
          FROM legal_documents
          WHERE slug = $slug
          ORDER BY created_at DESC;
        `, { $slug: TypedValues.utf8(slug) });
      }
      return session.executeQuery(`
        SELECT id, slug, version, title, body, body_hash, is_active, created_at, created_by
        FROM legal_documents
        ORDER BY slug ASC, created_at DESC;
      `);
    });
    const rows = result?.resultSets?.[0] ? this.parseResultSet(result.resultSets[0]) : [];
    return rows.map((r) => this.mapLegalDocumentRow(r as Record<string, any>));
  }
;

DatabaseStorage.prototype.mapConsentSignatureRow = function (this: DatabaseStorage, data: Record<string, any>): ConsentSignature {
    const toNum = (v: any): number => {
      if (v === null || v === undefined) return 0;
      if (typeof v === "bigint") return Number(v);
      const n = Number(v);
      return isNaN(n) ? 0 : n;
    };
    const toDate = (v: any): Date => {
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d.getTime()) ? new Date() : d;
    };
    // parseResultSet уже конвертирует snake_case → camelCase
    const remoteIpRaw = data.remoteIp ?? data.remote_ip;
    const s = (v: any): string | null => (v === null || v === undefined) ? null : String(v);
    return {
      id: String(data.id),
      partnerId: toNum(data.partnerId ?? data.partner_id),
      documentId: String(data.documentId ?? data.document_id),
      documentSlug: String(data.documentSlug ?? data.document_slug),
      documentVersion: String(data.documentVersion ?? data.document_version),
      documentHash: String(data.documentHash ?? data.document_hash),
      signedAt: toDate(data.signedAt ?? data.signed_at),
      ip: String(data.ip || ""),
      // Anti-spoof (30.04.2026): nullable — для legacy-строк до релиза будет null.
      remoteIp: remoteIpRaw === null || remoteIpRaw === undefined ? null : String(remoteIpRaw),
      // GeoIP (30.04.2026): nullable — для legacy-строк будет null.
      consentCountry: s(data.consentCountry ?? data.consent_country),
      consentRegion: s(data.consentRegion ?? data.consent_region),
      consentCity: s(data.consentCity ?? data.consent_city),
      userAgent: String(data.userAgent ?? data.user_agent ?? ""),
      method: String(data.method || "checkbox"),
    } as ConsentSignature;
  }
;

DatabaseStorage.prototype.createConsentSignature = async function (this: DatabaseStorage, input: InsertConsentSignature): Promise<ConsentSignature> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const signedAt = input.signedAt instanceof Date ? input.signedAt : new Date(input.signedAt as any);
    const remoteIp = (input as any).remoteIp;
    const geoCountry = (input as any).geoCountry ?? null;
    const geoRegion = (input as any).geoRegion ?? null;
    const geoCity = (input as any).geoCity ?? null;
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DECLARE $partner_id AS Uint64;
        DECLARE $document_id AS Utf8;
        DECLARE $document_slug AS Utf8;
        DECLARE $document_version AS Utf8;
        DECLARE $document_hash AS Utf8;
        DECLARE $signed_at AS Timestamp;
        DECLARE $ip AS Utf8;
        DECLARE $remote_ip AS Utf8?;
        DECLARE $consent_country AS Utf8?;
        DECLARE $consent_region AS Utf8?;
        DECLARE $consent_city AS Utf8?;
        DECLARE $user_agent AS Utf8;
        DECLARE $method AS Utf8;
        UPSERT INTO consent_signatures
          (id, partner_id, document_id, document_slug, document_version, document_hash, signed_at, ip, remote_ip, consent_country, consent_region, consent_city, user_agent, method)
        VALUES
          ($id, $partner_id, $document_id, $document_slug, $document_version, $document_hash, $signed_at, $ip, $remote_ip, $consent_country, $consent_region, $consent_city, $user_agent, $method);
      `, {
        $id: TypedValues.utf8(id),
        $partner_id: TypedValues.uint64(input.partnerId),
        $document_id: TypedValues.utf8(input.documentId),
        $document_slug: TypedValues.utf8(input.documentSlug),
        $document_version: TypedValues.utf8(input.documentVersion),
        $document_hash: TypedValues.utf8(input.documentHash),
        $signed_at: TypedValues.fromNative(Types.TIMESTAMP, signedAt),
        $ip: TypedValues.utf8(input.ip),
        $remote_ip: remoteIp
          ? TypedValues.optional(TypedValues.utf8(String(remoteIp)))
          : TypedValues.optionalNull(Types.UTF8),
        $consent_country: geoCountry
          ? TypedValues.optional(TypedValues.utf8(String(geoCountry)))
          : TypedValues.optionalNull(Types.UTF8),
        $consent_region: geoRegion
          ? TypedValues.optional(TypedValues.utf8(String(geoRegion)))
          : TypedValues.optionalNull(Types.UTF8),
        $consent_city: geoCity
          ? TypedValues.optional(TypedValues.utf8(String(geoCity)))
          : TypedValues.optionalNull(Types.UTF8),
        $user_agent: TypedValues.utf8(input.userAgent),
        $method: TypedValues.utf8(input.method || "checkbox"),
      });
    });
    return {
      id,
      partnerId: input.partnerId,
      documentId: input.documentId,
      documentSlug: input.documentSlug,
      documentVersion: input.documentVersion,
      documentHash: input.documentHash,
      signedAt,
      ip: input.ip,
      remoteIp: remoteIp ?? null,
      consentCountry: geoCountry,
      consentRegion: geoRegion,
      consentCity: geoCity,
      userAgent: input.userAgent,
      method: input.method || "checkbox",
    } as ConsentSignature;
  }
;

DatabaseStorage.prototype.listConsentSignaturesByPartnerId = async function (this: DatabaseStorage, partnerId: number): Promise<ConsentSignature[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      return session.executeQuery(`
        DECLARE $partner_id AS Uint64;
        SELECT id, partner_id, document_id, document_slug, document_version, document_hash, signed_at, ip, remote_ip, consent_country, consent_region, consent_city, user_agent, method
        FROM consent_signatures
        WHERE partner_id = $partner_id
        ORDER BY signed_at DESC;
      `, { $partner_id: TypedValues.uint64(partnerId) });
    });
    const rows = result?.resultSets?.[0] ? this.parseResultSet(result.resultSets[0]) : [];
    return rows.map((r) => this.mapConsentSignatureRow(r as Record<string, any>));
  }
;

DatabaseStorage.prototype.createPartnerPendingSubmission = async function (this: DatabaseStorage, input: {
    token: string;
    payload: any;
    formHashes: any;
    ip: string;
    remoteIp: string | null;
    userAgent: string;
    geoCountry: string | null;
    geoRegion: string | null;
    geoCity: string | null;
    expiresAt: Date;
  }): Promise<boolean> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const now = new Date();
    const result = await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $token AS Utf8;
        DECLARE $payload AS Utf8;
        DECLARE $form_hashes AS Utf8;
        DECLARE $ip AS Utf8;
        DECLARE $remote_ip AS Utf8?;
        DECLARE $user_agent AS Utf8;
        DECLARE $consent_country AS Utf8?;
        DECLARE $consent_region AS Utf8?;
        DECLARE $consent_city AS Utf8?;
        DECLARE $created_at AS Timestamp;
        DECLARE $expires_at AS Timestamp;
        UPSERT INTO partner_pending_submissions
          (token, payload, form_hashes, ip, remote_ip, user_agent, consent_country, consent_region, consent_city, created_at, expires_at)
        VALUES
          ($token, $payload, $form_hashes, $ip, $remote_ip, $user_agent, $consent_country, $consent_region, $consent_city, $created_at, $expires_at);
      `, {
        $token: TypedValues.utf8(input.token),
        $payload: TypedValues.utf8(JSON.stringify(input.payload)),
        $form_hashes: TypedValues.utf8(JSON.stringify(input.formHashes)),
        $ip: TypedValues.utf8(input.ip || ""),
        $remote_ip: input.remoteIp
          ? TypedValues.optional(TypedValues.utf8(String(input.remoteIp)))
          : TypedValues.optionalNull(Types.UTF8),
        $user_agent: TypedValues.utf8(input.userAgent || ""),
        $consent_country: input.geoCountry
          ? TypedValues.optional(TypedValues.utf8(String(input.geoCountry)))
          : TypedValues.optionalNull(Types.UTF8),
        $consent_region: input.geoRegion
          ? TypedValues.optional(TypedValues.utf8(String(input.geoRegion)))
          : TypedValues.optionalNull(Types.UTF8),
        $consent_city: input.geoCity
          ? TypedValues.optional(TypedValues.utf8(String(input.geoCity)))
          : TypedValues.optionalNull(Types.UTF8),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, now),
        $expires_at: TypedValues.fromNative(Types.TIMESTAMP, input.expiresAt),
      });
      return true;
    });
    return result === true;
  }
;

DatabaseStorage.prototype.getPartnerPendingSubmission = async function (this: DatabaseStorage, token: string): Promise<{
    token: string;
    payload: any;
    formHashes: any;
    ip: string;
    remoteIp: string | null;
    userAgent: string;
    geoCountry: string | null;
    geoRegion: string | null;
    geoCity: string | null;
    createdAt: Date;
    expiresAt: Date;
  } | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $token AS Utf8;
        SELECT token, payload, form_hashes, ip, remote_ip, user_agent,
               consent_country, consent_region, consent_city, created_at, expires_at
        FROM partner_pending_submissions
        WHERE token = $token
        LIMIT 1;
      `, { $token: TypedValues.utf8(token) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.parseRowWithColumns(rs.rows[0], rs.columns);
    });
    if (!result) return null;
    const toDate = (v: any): Date => {
      if (v instanceof Date) return v;
      if (typeof v === "number") {
        // YDB Timestamp в SDK обычно возвращается как мс или мкс с эпохи
        return new Date(v > 1e14 ? Math.floor(v / 1000) : v);
      }
      const d = new Date(v);
      return isNaN(d.getTime()) ? new Date(0) : d;
    };
    let payload: any = null;
    let formHashes: any = null;
    try { payload = JSON.parse(String(result.payload || "{}")); } catch { payload = null; }
    try { formHashes = JSON.parse(String(result.form_hashes || "{}")); } catch { formHashes = null; }
    return {
      token: String(result.token),
      payload,
      formHashes,
      ip: String(result.ip || ""),
      remoteIp: result.remote_ip ? String(result.remote_ip) : null,
      userAgent: String(result.user_agent || ""),
      geoCountry: result.consent_country ? String(result.consent_country) : null,
      geoRegion: result.consent_region ? String(result.consent_region) : null,
      geoCity: result.consent_city ? String(result.consent_city) : null,
      createdAt: toDate(result.created_at),
      expiresAt: toDate(result.expires_at),
    };
  }
;

DatabaseStorage.prototype.deletePartnerPendingSubmission = async function (this: DatabaseStorage, token: string): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $token AS Utf8;
        DELETE FROM partner_pending_submissions WHERE token = $token;
      `, { $token: TypedValues.utf8(token) });
    });
  }
;
