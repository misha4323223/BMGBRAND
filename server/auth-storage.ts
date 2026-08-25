import { driver } from "./db";
import { type User, type InsertUser } from "@shared/schema";
import ydb from "ydb-sdk";

export interface WholesaleData {
  companyName: string;
  inn: string;
  kpp?: string;
  legalAddress: string;
  storeName: string;
  storeAddress: string;
  contactPerson: string;
  contactPhone: string;
}

export interface WholesaleUser {
  id: number;
  email: string;
  name: string;
  emailVerified: boolean;
  companyName: string | null;
  inn: string | null;
  kpp: string | null;
  legalAddress: string | null;
  storeName: string | null;
  storeAddress: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  wholesaleApproved: boolean;
  wholesaleDiscount: number;
  wholesaleMarkup: number;
  createdAt: Date | null;
}

export interface ShippingData {
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  address?: string;
  transportCompany?: string;
}

export interface SavedAddress {
  id: string;
  label: string;
  city: string;
  address: string;
  postalCode?: string;
  street?: string;
  house?: string;
  apartment?: string;
  entrance?: string;
  floor?: string;
  lastName?: string;
  firstName?: string;
  patronymic?: string;
  phone?: string;
  isDefault: boolean;
}

export interface IAuthStorage {
  createUser(user: InsertUser & { verificationToken: string }): Promise<User | null>;
  createWholesaleUser(user: InsertUser & { verificationToken: string } & WholesaleData): Promise<User | null>;
  createWholesaleUserAdmin(user: InsertUser & WholesaleData): Promise<User | null>;
  createPartnerUser(user: InsertUser & { verificationToken: string }): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserByEmailAndRole(email: string, role: 'retail' | 'wholesale' | 'partner'): Promise<User | null>;
  getUserById(id: number): Promise<User | null>;
  verifyEmail(token: string): Promise<User | null>;
  setResetToken(userId: number, token: string, expiry: Date): Promise<boolean>;
  resetPassword(token: string, passwordHash: string): Promise<User | null>;
  updatePassword(userId: number, passwordHash: string): Promise<boolean>;
  updateProfile(userId: number, data: { name?: string; phone?: string }): Promise<boolean>;
  getSavedAddresses(userId: number): Promise<SavedAddress[]>;
  updateSavedAddresses(userId: number, addresses: SavedAddress[]): Promise<boolean>;
  updateWholesaleData(userId: number, data: Partial<WholesaleData>): Promise<boolean>;
  approveWholesale(userId: number, approved: boolean, discount?: number): Promise<boolean>;
  getWholesaleUsers(): Promise<WholesaleUser[]>;
  deleteWholesaleUser(userId: number): Promise<boolean>;
  deletePartnerUser(userId: number): Promise<boolean>;
  addWholesaleColumns(): Promise<{ success: boolean; message: string }>;
  updateShippingData(userId: number, data: ShippingData): Promise<boolean>;
  getShippingData(userId: number): Promise<ShippingData | null>;
  getFavorites(userId: number): Promise<number[]>;
  addFavorite(userId: number, productId: number): Promise<boolean>;
  removeFavorite(userId: number, productId: number): Promise<boolean>;
  getAllFavorites(): Promise<{ userId: number; productId: number }[]>;
  getAllRetailUsers(): Promise<User[]>;
  getUserByYandexId(yandexId: string): Promise<User | null>;
  linkYandexId(userId: number, yandexId: string): Promise<boolean>;
  saveYandexProfile(userId: number, profile: {
    yandexId?: string;
    yandexLogin?: string;
    yandexAvatar?: string;
    phone?: string;
    birthday?: string;
    gender?: string;
  }): Promise<boolean>;
  getEmailVerifiedByUserId(userId: number): Promise<boolean>;
}

export class YdbAuthStorage implements IAuthStorage {
  private async safeQuery<T>(fn: (session: ydb.Session) => Promise<T>, maxRetries: number = 3): Promise<T | null> {
    if (!driver) return null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await driver.tableClient.withSession(fn);
      } catch (err: any) {
        const errorName = err.constructor?.name || '';
        const isRetryable = errorName === 'BadSession' || 
                           err.message?.includes('Session not found') ||
                           err.message?.includes('RESOURCE_EXHAUSTED');
        
        if (isRetryable && attempt < maxRetries) {
          const isRateLimit = err.message?.includes('RESOURCE_EXHAUSTED');
          const delay = isRateLimit ? 1000 * attempt : 200 * attempt;
          console.log(`[YDB Auth] Retrying after ${errorName || 'error'} (attempt ${attempt}/${maxRetries}), wait ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        
        console.error("[YDB Auth Error]:", err.message || err);
        return null;
      }
    }
    return null;
  }

  private extractTypedValue(item: any): any {
    if (!item) return null;
    if (item.textValue !== undefined && item.textValue !== null) return item.textValue;
    if (item.boolValue !== undefined && item.boolValue !== null) return item.boolValue;
    if (item.uint64Value !== undefined && item.uint64Value !== null) return item.uint64Value;
    if (item.int64Value !== undefined && item.int64Value !== null) return item.int64Value;
    if (item.uint32Value !== undefined && item.uint32Value !== null) return item.uint32Value;
    if (item.int32Value !== undefined && item.int32Value !== null) return item.int32Value;
    if (item.doubleValue !== undefined && item.doubleValue !== null) return item.doubleValue;
    if (item.floatValue !== undefined && item.floatValue !== null) return item.floatValue;
    if (item.optionalValue !== undefined && item.optionalValue !== null) {
      return this.extractTypedValue(item.optionalValue);
    }
    if (item.nullFlagValue !== undefined) return null;
    if (item.value !== undefined) return item.value;
    return null;
  }

  private parseRowWithColumns(row: any, columns: any[]): Record<string, any> {
    const result: Record<string, any> = {};
    if (row.items && Array.isArray(row.items)) {
      for (let i = 0; i < row.items.length && i < columns.length; i++) {
        const colName = columns[i].name;
        result[colName] = this.extractTypedValue(row.items[i]);
      }
    }
    return result;
  }

  private parseUser(data: Record<string, any>): User {
    return {
      id: typeof data.id === 'string' ? parseInt(data.id) || 0 : (data.id || 0),
      email: data.email || '',
      passwordHash: data.password_hash || '',
      name: data.name || '',
      emailVerified: data.email_verified === true,
      verificationToken: data.verification_token || null,
      resetToken: data.reset_token || null,
      resetTokenExpiry: data.reset_token_expiry ? new Date(Number(data.reset_token_expiry) / 1000) : null,
      role: data.role || 'retail',
      companyName: data.company_name || null,
      inn: data.inn || null,
      kpp: data.kpp || null,
      legalAddress: data.legal_address || null,
      contactPerson: data.contact_person || null,
      contactPhone: data.contact_phone || null,
      wholesaleApproved: data.wholesale_approved === true,
      wholesaleDiscount: typeof data.wholesale_discount === 'string' ? parseInt(data.wholesale_discount) || 0 : (data.wholesale_discount ?? 0),
      wholesaleMarkup: typeof data.wholesale_markup === 'string' ? parseInt(data.wholesale_markup) || 0 : (data.wholesale_markup ?? 0),
      totalSpent: typeof data.total_spent === 'string' ? parseInt(data.total_spent) || 0 : (Number(data.total_spent) || 0),
      loyaltyDiscount: typeof data.loyalty_discount === 'string' ? parseInt(data.loyalty_discount) || 0 : (Number(data.loyalty_discount) || 0),
      phone: data.phone || null,
      yandexId: data.yandex_id || null,
      yandexLogin: data.yandex_login || null,
      yandexAvatar: data.yandex_avatar || null,
      birthday: data.birthday || null,
      gender: data.gender || null,
      createdAt: data.created_at ? new Date(Number(data.created_at) / 1000) : new Date(),
    } as User;
  }

  async createUser(user: InsertUser & { verificationToken: string }): Promise<User | null> {
    const id = Date.now();
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $email AS Utf8;
        DECLARE $password_hash AS Utf8;
        DECLARE $name AS Utf8;
        DECLARE $email_verified AS Bool;
        DECLARE $verification_token AS Utf8;
        DECLARE $created_at AS Timestamp;
        
        DECLARE $role AS Utf8;
        
        UPSERT INTO users (id, email, password_hash, name, email_verified, verification_token, role, created_at)
        VALUES ($id, $email, $password_hash, $name, $email_verified, $verification_token, $role, $created_at);
      `;
      
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(id)),
        $email: TypedValues.fromNative(Types.UTF8, user.email),
        $password_hash: TypedValues.fromNative(Types.UTF8, user.passwordHash),
        $name: TypedValues.fromNative(Types.UTF8, user.name),
        $email_verified: TypedValues.fromNative(Types.BOOL, false),
        $verification_token: TypedValues.fromNative(Types.UTF8, user.verificationToken),
        $role: TypedValues.fromNative(Types.UTF8, 'retail'),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, new Date()),
      });
      
      return this.getUserById(id);
    });
    
    return result;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = "DECLARE $email AS Utf8; SELECT * FROM users WHERE email = $email LIMIT 1";
      const { resultSets } = await session.executeQuery(query, {
        $email: TypedValues.fromNative(Types.UTF8, email.toLowerCase().trim()),
      });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return null;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseUser(data);
    });
    return result;
  }

  async getUserByEmailAndRole(email: string, role: 'retail' | 'wholesale' | 'partner'): Promise<User | null> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      let query: string;
      let params: Record<string, any>;
      
      const normalizedEmail = email.toLowerCase().trim();
      if (role === 'wholesale') {
        query = "DECLARE $email AS Utf8; SELECT * FROM users WHERE email = $email AND (role = 'wholesale' OR role = 'admin') LIMIT 1";
        params = {
          $email: TypedValues.fromNative(Types.UTF8, normalizedEmail),
        };
      } else if (role === 'partner') {
        query = "DECLARE $email AS Utf8; SELECT * FROM users WHERE email = $email AND role = 'partner' LIMIT 1";
        params = {
          $email: TypedValues.fromNative(Types.UTF8, normalizedEmail),
        };
      } else {
        query = "DECLARE $email AS Utf8; SELECT * FROM users WHERE email = $email AND (role IS NULL OR role = '' OR role = 'retail' OR role = 'admin') LIMIT 1";
        params = {
          $email: TypedValues.fromNative(Types.UTF8, normalizedEmail),
        };
      }
      
      const { resultSets } = await session.executeQuery(query, params);
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return null;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseUser(data);
    });
    return result;
  }

  async getUserById(id: number): Promise<User | null> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = "DECLARE $id AS Utf8; SELECT * FROM users WHERE id = $id LIMIT 1";
      const { resultSets } = await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(id)),
      });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return null;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseUser(data);
    });
    return result;
  }

  async verifyEmail(token: string): Promise<User | null> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      
      const findQuery = "DECLARE $token AS Utf8; SELECT * FROM users WHERE verification_token = $token LIMIT 1";
      const { resultSets } = await session.executeQuery(findQuery, {
        $token: TypedValues.fromNative(Types.UTF8, token),
      });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return null;
      const data = this.parseRowWithColumns(row, rs.columns);
      const user = this.parseUser(data);
      
      const updateQuery = `
        DECLARE $id AS Utf8;
        UPDATE users SET email_verified = true, verification_token = NULL WHERE id = $id;
      `;
      await session.executeQuery(updateQuery, {
        $id: TypedValues.fromNative(Types.UTF8, String(user.id)),
      });
      
      return { ...user, emailVerified: true, verificationToken: null };
    });
    return result;
  }

  async setResetToken(userId: number, token: string, expiry: Date): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $reset_token AS Utf8;
        DECLARE $reset_token_expiry AS Timestamp;
        UPDATE users SET reset_token = $reset_token, reset_token_expiry = $reset_token_expiry WHERE id = $id;
      `;
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
        $reset_token: TypedValues.fromNative(Types.UTF8, token),
        $reset_token_expiry: TypedValues.fromNative(Types.TIMESTAMP, expiry),
      });
      return true;
    });
    return result === true;
  }

  async resetPassword(token: string, passwordHash: string): Promise<User | null> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      
      const findQuery = "DECLARE $token AS Utf8; SELECT * FROM users WHERE reset_token = $token LIMIT 1";
      const { resultSets } = await session.executeQuery(findQuery, {
        $token: TypedValues.fromNative(Types.UTF8, token),
      });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return null;
      const data = this.parseRowWithColumns(row, rs.columns);
      const user = this.parseUser(data);
      
      if (user.resetTokenExpiry && new Date() > user.resetTokenExpiry) {
        return null;
      }
      
      const updateQuery = `
        DECLARE $id AS Utf8;
        DECLARE $password_hash AS Utf8;
        UPDATE users SET password_hash = $password_hash, reset_token = NULL, reset_token_expiry = NULL WHERE id = $id;
      `;
      await session.executeQuery(updateQuery, {
        $id: TypedValues.fromNative(Types.UTF8, String(user.id)),
        $password_hash: TypedValues.fromNative(Types.UTF8, passwordHash),
      });
      
      return { ...user, passwordHash, resetToken: null, resetTokenExpiry: null };
    });
    return result;
  }

  async updatePassword(userId: number, passwordHash: string): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $password_hash AS Utf8;
        UPDATE users SET password_hash = $password_hash WHERE id = $id;
      `;
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
        $password_hash: TypedValues.fromNative(Types.UTF8, passwordHash),
      });
      return true;
    });
    return result === true;
  }

  async updateProfile(userId: number, data: { name?: string; phone?: string }): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const updates: string[] = [];
      const declares: string[] = ['DECLARE $id AS Utf8;'];
      const params: Record<string, any> = {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
      };

      if (data.name !== undefined) {
        declares.push('DECLARE $name AS Utf8;');
        updates.push('name = $name');
        params.$name = TypedValues.fromNative(Types.UTF8, data.name);
      }
      if (data.phone !== undefined) {
        declares.push('DECLARE $phone AS Utf8;');
        updates.push('phone = $phone');
        params.$phone = TypedValues.fromNative(Types.UTF8, data.phone);
      }

      if (updates.length === 0) return true;

      const query = `${declares.join('\n')}\nUPDATE users SET ${updates.join(', ')} WHERE id = $id;`;
      await session.executeQuery(query, params);
      return true;
    });
    return result === true;
  }

  async setUserRoleByEmail(email: string, role: string): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const findQuery = `DECLARE $email AS Utf8; SELECT id FROM users WHERE email = $email LIMIT 1;`;
      const findRes = await session.executeQuery(findQuery, {
        $email: TypedValues.fromNative(Types.UTF8, email.toLowerCase()),
      });
      const rs = findRes.resultSets[0];
      if (!rs || !rs.rows || rs.rows.length === 0) return false;
      const userId = rs.rows[0].items?.[0]?.textValue || rs.rows[0].items?.[0]?.bytesValue?.toString();
      if (!userId) return false;
      const updateQuery = `DECLARE $id AS Utf8; DECLARE $role AS Utf8; UPDATE users SET role = $role WHERE id = $id;`;
      await session.executeQuery(updateQuery, {
        $id: TypedValues.fromNative(Types.UTF8, userId),
        $role: TypedValues.fromNative(Types.UTF8, role),
      });
      return true;
    });
    return result === true;
  }

  async getSavedAddresses(userId: number): Promise<SavedAddress[]> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        SELECT saved_addresses FROM users WHERE id = $id LIMIT 1;
      `;
      const res = await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
      });
      const rs = res.resultSets[0];
      if (!rs || !rs.rows || rs.rows.length === 0) return [];
      const row = this.parseRowWithColumns(rs.rows[0], rs.columns || []);
      if (!row.saved_addresses) return [];
      try {
        const parsed = typeof row.saved_addresses === 'string' ? JSON.parse(row.saved_addresses) : row.saved_addresses;
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    });
    return result || [];
  }

  async updateSavedAddresses(userId: number, addresses: SavedAddress[]): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $saved_addresses AS Json;
        UPDATE users SET saved_addresses = $saved_addresses WHERE id = $id;
      `;
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
        $saved_addresses: TypedValues.fromNative(Types.JSON, JSON.stringify(addresses)),
      });
      return true;
    });
    return result === true;
  }

  async createWholesaleUser(user: InsertUser & { verificationToken: string } & WholesaleData): Promise<User | null> {
    const id = Date.now();
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $email AS Utf8;
        DECLARE $password_hash AS Utf8;
        DECLARE $name AS Utf8;
        DECLARE $email_verified AS Bool;
        DECLARE $verification_token AS Utf8;
        DECLARE $role AS Utf8;
        DECLARE $company_name AS Utf8;
        DECLARE $inn AS Utf8;
        DECLARE $kpp AS Utf8;
        DECLARE $legal_address AS Utf8;
        DECLARE $store_name AS Utf8;
        DECLARE $store_address AS Utf8;
        DECLARE $contact_person AS Utf8;
        DECLARE $contact_phone AS Utf8;
        DECLARE $wholesale_approved AS Bool;
        DECLARE $wholesale_discount AS Uint32;
        DECLARE $wholesale_markup AS Uint32;
        DECLARE $created_at AS Timestamp;
        
        UPSERT INTO users (id, email, password_hash, name, email_verified, verification_token, role, company_name, inn, kpp, legal_address, store_name, store_address, contact_person, contact_phone, wholesale_approved, wholesale_discount, wholesale_markup, created_at)
        VALUES ($id, $email, $password_hash, $name, $email_verified, $verification_token, $role, $company_name, $inn, $kpp, $legal_address, $store_name, $store_address, $contact_person, $contact_phone, $wholesale_approved, $wholesale_discount, $wholesale_markup, $created_at);
      `;
      
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(id)),
        $email: TypedValues.fromNative(Types.UTF8, user.email),
        $password_hash: TypedValues.fromNative(Types.UTF8, user.passwordHash),
        $name: TypedValues.fromNative(Types.UTF8, user.name),
        $email_verified: TypedValues.fromNative(Types.BOOL, false),
        $verification_token: TypedValues.fromNative(Types.UTF8, user.verificationToken),
        $role: TypedValues.fromNative(Types.UTF8, 'wholesale'),
        $company_name: TypedValues.fromNative(Types.UTF8, user.companyName),
        $inn: TypedValues.fromNative(Types.UTF8, user.inn),
        $kpp: TypedValues.fromNative(Types.UTF8, user.kpp || ''),
        $legal_address: TypedValues.fromNative(Types.UTF8, user.legalAddress),
        $store_name: TypedValues.fromNative(Types.UTF8, user.storeName),
        $store_address: TypedValues.fromNative(Types.UTF8, user.storeAddress),
        $contact_person: TypedValues.fromNative(Types.UTF8, user.contactPerson),
        $contact_phone: TypedValues.fromNative(Types.UTF8, user.contactPhone),
        $wholesale_approved: TypedValues.fromNative(Types.BOOL, false),
        $wholesale_discount: TypedValues.fromNative(Types.UINT32, 30),
        $wholesale_markup: TypedValues.fromNative(Types.UINT32, 0),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, new Date()),
      });
      
      return this.getUserById(id);
    });
    
    return result;
  }

  async createWholesaleUserAdmin(user: InsertUser & WholesaleData): Promise<User | null> {
    const id = Date.now();
    // Generate a random verification token so the column is never NULL
    const verificationToken = Math.random().toString(36).substring(2, 15);
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $email AS Utf8;
        DECLARE $password_hash AS Utf8;
        DECLARE $name AS Utf8;
        DECLARE $email_verified AS Bool;
        DECLARE $verification_token AS Utf8;
        DECLARE $role AS Utf8;
        DECLARE $company_name AS Utf8;
        DECLARE $inn AS Utf8;
        DECLARE $kpp AS Utf8;
        DECLARE $legal_address AS Utf8;
        DECLARE $store_name AS Utf8;
        DECLARE $store_address AS Utf8;
        DECLARE $contact_person AS Utf8;
        DECLARE $contact_phone AS Utf8;
        DECLARE $wholesale_approved AS Bool;
        DECLARE $wholesale_discount AS Uint32;
        DECLARE $wholesale_markup AS Uint32;
        DECLARE $created_at AS Timestamp;
        
        UPSERT INTO users (id, email, password_hash, name, email_verified, verification_token, role, company_name, inn, kpp, legal_address, store_name, store_address, contact_person, contact_phone, wholesale_approved, wholesale_discount, wholesale_markup, created_at)
        VALUES ($id, $email, $password_hash, $name, $email_verified, $verification_token, $role, $company_name, $inn, $kpp, $legal_address, $store_name, $store_address, $contact_person, $contact_phone, $wholesale_approved, $wholesale_discount, $wholesale_markup, $created_at);
      `;
      
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(id)),
        $email: TypedValues.fromNative(Types.UTF8, user.email),
        $password_hash: TypedValues.fromNative(Types.UTF8, user.passwordHash),
        $name: TypedValues.fromNative(Types.UTF8, user.name),
        $email_verified: TypedValues.fromNative(Types.BOOL, true),
        $verification_token: TypedValues.fromNative(Types.UTF8, verificationToken),
        $role: TypedValues.fromNative(Types.UTF8, 'wholesale'),
        $company_name: TypedValues.fromNative(Types.UTF8, user.companyName),
        $inn: TypedValues.fromNative(Types.UTF8, user.inn),
        $kpp: TypedValues.fromNative(Types.UTF8, user.kpp || ''),
        $legal_address: TypedValues.fromNative(Types.UTF8, user.legalAddress),
        $store_name: TypedValues.fromNative(Types.UTF8, user.storeName),
        $store_address: TypedValues.fromNative(Types.UTF8, user.storeAddress),
        $contact_person: TypedValues.fromNative(Types.UTF8, user.contactPerson),
        $contact_phone: TypedValues.fromNative(Types.UTF8, user.contactPhone),
        $wholesale_approved: TypedValues.fromNative(Types.BOOL, true),
        $wholesale_discount: TypedValues.fromNative(Types.UINT32, 0),
        $wholesale_markup: TypedValues.fromNative(Types.UINT32, 0),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, new Date()),
      });
      
      return this.getUserById(id);
    });
    
    return result;
  }

  async createPartnerUser(user: InsertUser & { verificationToken: string }): Promise<User | null> {
    const id = Date.now();
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $email AS Utf8;
        DECLARE $password_hash AS Utf8;
        DECLARE $name AS Utf8;
        DECLARE $email_verified AS Bool;
        DECLARE $verification_token AS Utf8;
        DECLARE $role AS Utf8;
        DECLARE $created_at AS Timestamp;

        UPSERT INTO users (id, email, password_hash, name, email_verified, verification_token, role, created_at)
        VALUES ($id, $email, $password_hash, $name, $email_verified, $verification_token, $role, $created_at);
      `;

      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(id)),
        $email: TypedValues.fromNative(Types.UTF8, user.email),
        $password_hash: TypedValues.fromNative(Types.UTF8, user.passwordHash),
        $name: TypedValues.fromNative(Types.UTF8, user.name),
        $email_verified: TypedValues.fromNative(Types.BOOL, true),
        $verification_token: TypedValues.fromNative(Types.UTF8, user.verificationToken),
        $role: TypedValues.fromNative(Types.UTF8, 'partner'),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, new Date()),
      });

      return this.getUserById(id);
    });

    return result;
  }

  async updateWholesaleData(userId: number, data: Partial<WholesaleData>): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const updates: string[] = [];
      const params: Record<string, any> = {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
      };

      if (data.companyName !== undefined) {
        updates.push('company_name = $company_name');
        params.$company_name = TypedValues.fromNative(Types.UTF8, data.companyName);
      }
      if (data.inn !== undefined) {
        updates.push('inn = $inn');
        params.$inn = TypedValues.fromNative(Types.UTF8, data.inn);
      }
      if (data.kpp !== undefined) {
        updates.push('kpp = $kpp');
        params.$kpp = TypedValues.fromNative(Types.UTF8, data.kpp);
      }
      if (data.legalAddress !== undefined) {
        updates.push('legal_address = $legal_address');
        params.$legal_address = TypedValues.fromNative(Types.UTF8, data.legalAddress);
      }
      if (data.contactPerson !== undefined) {
        updates.push('contact_person = $contact_person');
        params.$contact_person = TypedValues.fromNative(Types.UTF8, data.contactPerson);
      }
      if (data.contactPhone !== undefined) {
        updates.push('contact_phone = $contact_phone');
        params.$contact_phone = TypedValues.fromNative(Types.UTF8, data.contactPhone);
      }

      if (updates.length === 0) return true;

      const declares = [
        'DECLARE $id AS Utf8;',
        data.companyName !== undefined ? 'DECLARE $company_name AS Utf8;' : '',
        data.inn !== undefined ? 'DECLARE $inn AS Utf8;' : '',
        data.kpp !== undefined ? 'DECLARE $kpp AS Utf8;' : '',
        data.legalAddress !== undefined ? 'DECLARE $legal_address AS Utf8;' : '',
        data.contactPerson !== undefined ? 'DECLARE $contact_person AS Utf8;' : '',
        data.contactPhone !== undefined ? 'DECLARE $contact_phone AS Utf8;' : '',
      ].filter(Boolean).join('\n');

      const query = `${declares}\nUPDATE users SET ${updates.join(', ')} WHERE id = $id;`;
      await session.executeQuery(query, params);
      return true;
    });
    return result === true;
  }

  async approveWholesale(userId: number, approved: boolean, discount: number = 30, markup: number = 0): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $wholesale_approved AS Bool;
        DECLARE $wholesale_discount AS Uint32;
        DECLARE $wholesale_markup AS Uint32;
        UPDATE users SET wholesale_approved = $wholesale_approved, wholesale_discount = $wholesale_discount, wholesale_markup = $wholesale_markup WHERE id = $id;
      `;
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
        $wholesale_approved: TypedValues.fromNative(Types.BOOL, approved),
        $wholesale_discount: TypedValues.fromNative(Types.UINT32, discount),
        $wholesale_markup: TypedValues.fromNative(Types.UINT32, markup),
      });
      return true;
    });
    return result === true;
  }

  async verifyEmailAdmin(userId: number): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        UPDATE users SET email_verified = true, verification_token = NULL WHERE id = $id;
      `;
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
      });
      return true;
    });
    return result === true;
  }

  async getWholesaleUsers(): Promise<WholesaleUser[]> {
    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, email, name, email_verified, company_name, inn, kpp, legal_address, 
               store_name, store_address, contact_person, contact_phone, wholesale_approved, wholesale_discount, wholesale_markup, created_at
        FROM users 
        WHERE role = 'wholesale'
        ORDER BY created_at DESC;
      `;
      const result = await session.executeQuery(query);
      const rows = result.resultSets[0]?.rows || [];
      return rows.map((row: any) => ({
        id: parseInt(row.items?.[0]?.textValue || '0'),
        email: row.items?.[1]?.textValue || '',
        name: row.items?.[2]?.textValue || '',
        emailVerified: row.items?.[3]?.boolValue === true,
        companyName: row.items?.[4]?.textValue || null,
        inn: row.items?.[5]?.textValue || null,
        kpp: row.items?.[6]?.textValue || null,
        legalAddress: row.items?.[7]?.textValue || null,
        storeName: row.items?.[8]?.textValue || null,
        storeAddress: row.items?.[9]?.textValue || null,
        contactPerson: row.items?.[10]?.textValue || null,
        contactPhone: row.items?.[11]?.textValue || null,
        wholesaleApproved: row.items?.[12]?.boolValue === true,
        wholesaleDiscount: parseInt(row.items?.[13]?.uint32Value || '0'),
        wholesaleMarkup: parseInt(row.items?.[14]?.uint32Value || '0'),
        createdAt: row.items?.[15]?.textValue ? new Date(row.items[15].textValue) : null,
      }));
    });
    return result || [];
  }

  async deleteWholesaleUser(userId: number): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DELETE FROM users WHERE id = $id AND role = 'wholesale';
      `;
      await session.executeQuery(query, {
        "$id": TypedValues.utf8(String(userId)),
      });
      return true;
    });
    return result === true;
  }

  async deletePartnerUser(userId: number): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DELETE FROM users WHERE id = $id AND role = 'partner';
      `;
      await session.executeQuery(query, {
        "$id": TypedValues.utf8(String(userId)),
      });
      return true;
    });
    return result === true;
  }

  async addWholesaleColumns(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      const ydbModule = await import("ydb-sdk");
      const results: string[] = [];
      
      const columnsToAdd = [
        { name: 'role', type: ydbModule.Types.optional(ydbModule.Types.UTF8) },
        { name: 'company_name', type: ydbModule.Types.optional(ydbModule.Types.UTF8) },
        { name: 'inn', type: ydbModule.Types.optional(ydbModule.Types.UTF8) },
        { name: 'kpp', type: ydbModule.Types.optional(ydbModule.Types.UTF8) },
        { name: 'legal_address', type: ydbModule.Types.optional(ydbModule.Types.UTF8) },
        { name: 'store_name', type: ydbModule.Types.optional(ydbModule.Types.UTF8) },
        { name: 'store_address', type: ydbModule.Types.optional(ydbModule.Types.UTF8) },
        { name: 'contact_person', type: ydbModule.Types.optional(ydbModule.Types.UTF8) },
        { name: 'contact_phone', type: ydbModule.Types.optional(ydbModule.Types.UTF8) },
        { name: 'wholesale_approved', type: ydbModule.Types.optional(ydbModule.Types.BOOL) },
        { name: 'wholesale_discount', type: ydbModule.Types.optional(ydbModule.Types.UINT32) },
        { name: 'wholesale_markup', type: ydbModule.Types.optional(ydbModule.Types.UINT32) },
        { name: 'shipping_data', type: ydbModule.Types.optional(ydbModule.Types.JSON) },
        { name: 'saved_addresses', type: ydbModule.Types.optional(ydbModule.Types.JSON) },
      ];
      
      await driver.tableClient.withSession(async (session) => {
        for (const col of columnsToAdd) {
          try {
            const alterTableDesc = new ydbModule.AlterTableDescription();
            alterTableDesc.addColumns = [new ydbModule.Column(col.name, col.type)];
            
            await session.alterTable("users", alterTableDesc);
            results.push(`Added column ${col.name}`);
            console.log(`[Migration] Added column ${col.name}`);
          } catch (error: any) {
            const msg = error.message || String(error);
            if (msg.includes('already exists') || msg.includes('Already exists') || msg.includes('Duplicate column')) {
              results.push(`Column ${col.name} already exists`);
              console.log(`[Migration] Column ${col.name} already exists`);
            } else {
              results.push(`Error adding ${col.name}: ${msg}`);
              console.error(`[Migration] Error adding ${col.name}:`, msg);
            }
          }
        }
      });

      return { success: true, message: results.join('; ') };
    } catch (error) {
      console.error('[Migration] Error:', error);
      return { success: false, message: String(error) };
    }
  }

  async updateShippingData(userId: number, data: ShippingData): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $shipping_data AS Json;
        UPDATE users SET shipping_data = $shipping_data WHERE id = $id;
      `;
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
        $shipping_data: TypedValues.fromNative(Types.JSON, JSON.stringify(data)),
      });
      return true;
    });
    return result === true;
  }

  async getShippingData(userId: number): Promise<ShippingData | null> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        SELECT shipping_data FROM users WHERE id = $id;
      `;
      const { resultSets } = await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
      });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row) return null;
      const jsonStr = row.items?.[0]?.textValue;
      if (!jsonStr) return null;
      try {
        return JSON.parse(jsonStr) as ShippingData;
      } catch {
        return null;
      }
    });
    return result;
  }

  private favKey(userId: number, productId: number): string {
    return `${userId}_${productId}`;
  }

  async getFavorites(userId: number): Promise<number[]> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = "DECLARE $user_id AS Utf8; SELECT product_id FROM user_favorites WHERE user_id = $user_id";
      const { resultSets } = await session.executeQuery(query, {
        $user_id: TypedValues.fromNative(Types.UTF8, String(userId)),
      });
      const rs = resultSets[0];
      if (!rs.rows) return [];
      return rs.rows.map((row: any) => {
        const product_id = this.extractTypedValue(row.items?.[0]);
        return parseInt(product_id) || 0;
      }).filter((id: number) => id > 0);
    });
    return result || [];
  }

  async addFavorite(userId: number, productId: number): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $user_id AS Utf8;
        DECLARE $product_id AS Utf8;
        UPSERT INTO user_favorites (id, user_id, product_id) VALUES ($id, $user_id, $product_id);
      `;
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, this.favKey(userId, productId)),
        $user_id: TypedValues.fromNative(Types.UTF8, String(userId)),
        $product_id: TypedValues.fromNative(Types.UTF8, String(productId)),
      });
      return true;
    });
    return result === true;
  }

  async removeFavorite(userId: number, productId: number): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DELETE FROM user_favorites WHERE id = $id;
      `;
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, this.favKey(userId, productId)),
      });
      return true;
    });
    return result === true;
  }

  async getAllFavorites(): Promise<{ userId: number; productId: number }[]> {
    const result = await this.safeQuery(async (session) => {
      const query = "SELECT user_id, product_id FROM user_favorites";
      const { resultSets } = await session.executeQuery(query);
      const rs = resultSets[0];
      if (!rs.rows) return [];
      return rs.rows.map((row: any) => {
        const userId = parseInt(this.extractTypedValue(row.items?.[0])) || 0;
        const productId = parseInt(this.extractTypedValue(row.items?.[1])) || 0;
        return { userId, productId };
      }).filter(item => item.userId > 0 && item.productId > 0);
    });
    return result || [];
  }

  async getAllRetailUsers(): Promise<User[]> {
    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, name, email, phone, role, created_at, total_spent, loyalty_discount, email_verified
        FROM users
        WHERE role != 'wholesale' OR role IS NULL
        ORDER BY created_at DESC
        LIMIT 500;
      `;
      const { resultSets } = await session.executeQuery(query);
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns!);
        return this.parseUser(data);
      });
    });
    return result || [];
  }

  async getUserByYandexId(yandexId: string): Promise<User | null> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `DECLARE $yandex_id AS Utf8; SELECT * FROM users WHERE yandex_id = $yandex_id LIMIT 1;`;
      const { resultSets } = await session.executeQuery(query, {
        $yandex_id: TypedValues.fromNative(Types.UTF8, yandexId),
      });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return null;
      return this.parseUser(this.parseRowWithColumns(row, rs.columns));
    });
    return result;
  }

  async linkYandexId(userId: number, yandexId: string): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $yandex_id AS Utf8;
        UPDATE users SET yandex_id = $yandex_id WHERE id = $id;
      `;
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
        $yandex_id: TypedValues.fromNative(Types.UTF8, yandexId),
      });
      return true;
    });
    return result === true;
  }

  async saveYandexProfile(userId: number, profile: {
    yandexId?: string;
    yandexLogin?: string;
    yandexAvatar?: string;
    phone?: string;
    birthday?: string;
    gender?: string;
  }): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");

      const declares: string[] = ['DECLARE $id AS Utf8;'];
      const updates: string[] = [];
      const params: Record<string, any> = {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
      };

      if (profile.yandexId) {
        declares.push('DECLARE $yandex_id AS Utf8;');
        updates.push('yandex_id = $yandex_id');
        params.$yandex_id = TypedValues.fromNative(Types.UTF8, profile.yandexId);
      }
      if (profile.yandexLogin) {
        declares.push('DECLARE $yandex_login AS Utf8;');
        updates.push('yandex_login = $yandex_login');
        params.$yandex_login = TypedValues.fromNative(Types.UTF8, profile.yandexLogin);
      }
      if (profile.yandexAvatar) {
        declares.push('DECLARE $yandex_avatar AS Utf8;');
        updates.push('yandex_avatar = $yandex_avatar');
        params.$yandex_avatar = TypedValues.fromNative(Types.UTF8, profile.yandexAvatar);
      }
      if (profile.phone) {
        declares.push('DECLARE $phone AS Utf8;');
        updates.push('phone = $phone');
        params.$phone = TypedValues.fromNative(Types.UTF8, profile.phone);
      }
      if (profile.birthday) {
        declares.push('DECLARE $birthday AS Utf8;');
        updates.push('birthday = $birthday');
        params.$birthday = TypedValues.fromNative(Types.UTF8, profile.birthday);
      }
      if (profile.gender) {
        declares.push('DECLARE $gender AS Utf8;');
        updates.push('gender = $gender');
        params.$gender = TypedValues.fromNative(Types.UTF8, profile.gender);
      }

      if (updates.length === 0) return true;

      const query = `${declares.join('\n')}\nUPDATE users SET ${updates.join(', ')} WHERE id = $id;`;
      await session.executeQuery(query, params);
      return true;
    });
    return result === true;
  }

  async getEmailVerifiedByUserId(userId: number): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(
        'DECLARE $id AS Utf8; SELECT email_verified FROM users WHERE id = $id LIMIT 1',
        { $id: TypedValues.fromNative(Types.UTF8, String(userId)) },
      );
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return false;
      const data = this.parseRowWithColumns(row, rs.columns);
      return data.email_verified === true;
    });
    return result === true;
  }
}

export const authStorage = new YdbAuthStorage();
