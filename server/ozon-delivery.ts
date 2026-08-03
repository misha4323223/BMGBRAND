/**
 * Ozon Delivery (Ozon Logistics) Service
 *
 * Интеграция с логистикой Ozon через Seller API с OAuth 2.0.
 * Bearer token получается через ozonDeliveryOAuth (dev.ozon.ru → private app).
 *
 * Base URL: https://api-seller.ozon.ru
 * Docs: https://docs.ozon.ru/api/seller/
 *
 * Переменные окружения:
 *   OZON_CLIENT_ID     — Client-Id продавца из ЛК Ozon
 *   OZON_CLIENT_SECRET — OAuth client_secret из dev.ozon.ru
 */

import { ozonDeliveryOAuth } from "./ozon-delivery-oauth";

const OZON_SELLER_API = "https://api-seller.ozon.ru";

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface OzonPvzPoint {
  id: string;
  name: string;
  address: string;
  city: string;
  lat?: number;
  lng?: number;
  workingHours?: string;
}

export interface OzonDeliveryCheckResult {
  available: boolean;
  /** Стоимость доставки в копейках (0 если недоступна или неизвестна) */
  cost: number;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  error?: string;
}

export interface OzonOrderItem {
  /** offer_id товара на Ozon (article || sku || String(productId)) */
  offerId: string;
  quantity: number;
  /** Цена в копейках */
  price: number;
  name: string;
}

export interface OzonCreateOrderParams {
  externalOrderId: string;
  customerPhone: string;
  customerName: string;
  items: OzonOrderItem[];
  amount: number;
  /** ID выбранного покупателем ПВЗ (из /v1/delivery/point/list) */
  pvzId?: string;
}

export interface OzonCreateOrderResult {
  success: boolean;
  ozonOrderId?: string;
  error?: string;
}

// ─── Сервис ──────────────────────────────────────────────────────────────────

class OzonDeliveryService {
  private clientId: string | null = null;
  /** Показывать в чекауте (управляется флагом ozon_delivery_enabled) */
  private _enabled = false;

  /**
   * Инициализация из переменных окружения.
   * clientId используется как заголовок Client-Id при запросах.
   * OAuth credentials (clientId + clientSecret) переданы в ozonDeliveryOAuth.
   */
  initialize(clientId: string): void {
    this.clientId = clientId;
    console.log("[OzonDelivery] Инициализирован, Client-Id:", clientId.slice(0, 6) + "...");
  }

  /** Credentials настроены (OAuth) */
  isConfigured(): boolean {
    return ozonDeliveryOAuth.isConfigured();
  }

  /**
   * Доставка активна = OAuth авторизован + credentials есть + флаг включён.
   */
  isEnabled(): boolean {
    if (!this._enabled || !this.isConfigured()) return false;
    const status = ozonDeliveryOAuth.getStatus();
    return status.authenticated && !status.isExpired;
  }

  setEnabled(value: boolean): void {
    this._enabled = value;
  }

  getStatus() {
    const oauthStatus = ozonDeliveryOAuth.getStatus();
    return {
      configured: oauthStatus.configured,
      enabled: this._enabled,
      serviceReady: this._enabled && oauthStatus.authenticated && !oauthStatus.isExpired,
      oauthStatus,
    };
  }

  // ─── Внутренний метод запроса ─────────────────────────────────────────────

  private async request<T>(
    path: string,
    body: object,
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    const token = await ozonDeliveryOAuth.getAccessToken();
    if (!token) {
      return { success: false, error: "Ozon Delivery: нет OAuth-токена. Авторизуйте приложение в Admin → Интеграции." };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    };
    if (this.clientId) {
      headers["Client-Id"] = this.clientId;
    }

    try {
      const resp = await fetch(`${OZON_SELLER_API}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      let data: any;
      try { data = await resp.json(); } catch { data = {}; }

      if (!resp.ok) {
        const errMsg = data?.message || data?.error?.message || data?.error || `HTTP ${resp.status}`;
        console.error(`[OzonDelivery] ${path} error ${resp.status}:`, JSON.stringify(data));
        return { success: false, error: String(errMsg) };
      }

      return { success: true, data: data as T };
    } catch (err: any) {
      console.error(`[OzonDelivery] ${path} network error:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // ─── Публичные методы ─────────────────────────────────────────────────────

  /**
   * Возвращает список доступных ПВЗ Ozon, опционально фильтруя по городу.
   * Endpoint: POST /v1/delivery/point/list
   */
  async getPvzList(city?: string, limit = 100): Promise<{
    success: boolean;
    points?: OzonPvzPoint[];
    error?: string;
  }> {
    const body: Record<string, unknown> = { limit };
    if (city && city.trim()) body.city = city.trim();

    const result = await this.request<any>("/v1/delivery/point/list", body);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    const raw: any[] =
      result.data?.result ??
      result.data?.points ??
      result.data?.items ??
      (Array.isArray(result.data) ? result.data : []);

    const points: OzonPvzPoint[] = raw.map((p: any) => ({
      id: String(p.id ?? p.pvz_id ?? p.point_id ?? ""),
      name: p.name ?? p.title ?? "",
      address: p.address ?? p.location?.address ?? p.full_address ?? "",
      city: p.city ?? p.location?.city ?? city ?? "",
      lat: p.lat ?? p.location?.lat,
      lng: p.lng ?? p.location?.lng,
      workingHours: p.work_time ?? p.working_hours ?? p.schedule,
    })).filter((p: OzonPvzPoint) => p.id && p.address);

    return { success: true, points };
  }

  /**
   * Проверяет доступность и стоимость доставки для покупателя по телефону.
   * Endpoint: POST /v1/delivery/check
   */
  async checkDelivery(
    customerPhone: string,
    items?: Array<{ offerId: string; quantity: number }>,
  ): Promise<OzonDeliveryCheckResult> {
    const body: Record<string, unknown> = { customer_phone: customerPhone };
    if (items && items.length > 0) {
      body.items = items.map(i => ({ offer_id: i.offerId, quantity: i.quantity }));
    }

    const result = await this.request<any>("/v1/delivery/check", body);
    if (!result.success) {
      return { available: false, cost: 0, error: result.error };
    }

    const r = result.data?.result ?? result.data ?? {};
    const rawCost = r.delivery_price ?? r.cost ?? r.amount ?? 0;
    const costInKopeks = rawCost > 0 && rawCost < 1000
      ? Math.round(rawCost * 100)
      : Math.round(rawCost);

    return {
      available: r.is_available === true || r.available === true,
      cost: costInKopeks,
      deliveryDateFrom: r.delivery_date_from ?? r.date_from,
      deliveryDateTo: r.delivery_date_to ?? r.date_to,
    };
  }

  /**
   * Создаёт заказ в Ozon Logistics после успешной оплаты.
   * Передаёт выбранный покупателем ПВЗ (pvz_id).
   * Endpoint: POST /v2/delivery/checkout
   */
  async createOrder(params: OzonCreateOrderParams): Promise<OzonCreateOrderResult> {
    const body: Record<string, unknown> = {
      external_order_id: params.externalOrderId,
      customer_phone: params.customerPhone,
      customer_name: params.customerName,
      items: params.items.map(item => ({
        offer_id: item.offerId,
        quantity: item.quantity,
        price: item.price,
        name: item.name,
      })),
    };
    if (params.pvzId) {
      body.pvz_id = params.pvzId;
    }

    console.log(
      `[OzonDelivery] createOrder: external_id=${params.externalOrderId}`,
      `phone=${params.customerPhone}`,
      `pvz_id=${params.pvzId ?? "не указан"}`,
      `items=${params.items.length}`,
      `amount=${(params.amount / 100).toFixed(0)}₽`,
    );

    const result = await this.request<any>("/v2/delivery/checkout", body);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    const ozonOrderId =
      result.data?.result?.order_id ??
      result.data?.result?.ozon_order_id ??
      result.data?.order_id ??
      result.data?.ozon_order_id ??
      "";

    console.log(`[OzonDelivery] Order created: ozon_order_id=${ozonOrderId}`);
    return { success: true, ozonOrderId: String(ozonOrderId) };
  }

  /**
   * Отменяет заказ Ozon Delivery.
   * Endpoint: POST /v1/delivery/order/cancel
   */
  async cancelOrder(ozonOrderId: string): Promise<{ success: boolean; error?: string }> {
    const result = await this.request<any>("/v1/delivery/order/cancel", { order_id: ozonOrderId });
    if (!result.success) {
      console.error(`[OzonDelivery] cancelOrder ${ozonOrderId} failed:`, result.error);
      return { success: false, error: result.error };
    }
    console.log(`[OzonDelivery] Order ${ozonOrderId} cancelled`);
    return { success: true };
  }

  /**
   * Получает статус заказа и трекинг-ссылку.
   * Endpoint: POST /v1/delivery/order/get
   */
  async getOrder(ozonOrderId: string): Promise<{
    success: boolean;
    status?: string;
    trackingUrl?: string;
    error?: string;
  }> {
    const result = await this.request<any>("/v1/delivery/order/get", { order_id: ozonOrderId });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    const r = result.data?.result ?? result.data ?? {};
    return {
      success: true,
      status: r.status,
      trackingUrl: r.tracking_url ?? r.barcode_url,
    };
  }
}

export const ozonDeliveryService = new OzonDeliveryService();
