/**
 * Ozon Delivery (Ozon Logistics) Service
 *
 * Интеграция с логистикой Ozon через Seller API.
 * Авторизация: Client-Id + Api-Key заголовки (как у СДЭК).
 * Credentials берутся из переменных окружения автоматически при старте.
 *
 * Base URL: https://api-seller.ozon.ru
 * Docs: https://docs.ozon.ru/api/seller/
 *
 * Переменные окружения:
 *   OZON_CLIENT_ID  — Client-Id (числовой ID продавца из кабинета Ozon)
 *   OZON_CLIENT_SECRET — Api-Key (ключ из кабинета Ozon → Настройки → API-ключи)
 */

const OZON_SELLER_API = "https://api-seller.ozon.ru";

// ─── Типы ────────────────────────────────────────────────────────────────────

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
  /** Наш внутренний ID заказа */
  externalOrderId: string;
  /** Телефон покупателя */
  customerPhone: string;
  customerName: string;
  items: OzonOrderItem[];
  /** Общая сумма в копейках */
  amount: number;
}

export interface OzonCreateOrderResult {
  success: boolean;
  ozonOrderId?: string;
  error?: string;
}

// ─── Сервис ──────────────────────────────────────────────────────────────────

class OzonDeliveryService {
  private clientId: string | null = null;
  private apiKey: string | null = null;
  /** Показывать в чекауте (управляется флагом ozon_delivery_enabled в bonus_settings) */
  private _enabled = false;

  /**
   * Инициализация из переменных окружения.
   * Вызывается при старте сервера — аналогично СДЭК.
   */
  initialize(clientId: string, apiKey: string): void {
    this.clientId = clientId;
    this.apiKey = apiKey;
    console.log("[OzonDelivery] Credentials загружены, Client-Id:", clientId.slice(0, 6) + "...");
  }

  /** Credentials настроены (из env) */
  isConfigured(): boolean {
    return !!this.clientId && !!this.apiKey;
  }

  /**
   * Доставка активна = credentials есть И флаг включён.
   * Флаг включается/выключается из Admin → Интеграции.
   */
  isEnabled(): boolean {
    return this._enabled && this.isConfigured();
  }

  setEnabled(value: boolean): void {
    this._enabled = value;
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      enabled: this._enabled,
      serviceReady: this.isEnabled(),
    };
  }

  // ─── Внутренний метод запроса ─────────────────────────────────────────────

  private async request<T>(
    path: string,
    body: object,
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    if (!this.clientId || !this.apiKey) {
      return { success: false, error: "Ozon Delivery не настроен: нет OZON_CLIENT_ID / OZON_CLIENT_SECRET" };
    }

    try {
      const resp = await fetch(`${OZON_SELLER_API}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Client-Id": this.clientId,
          "Api-Key": this.apiKey,
        },
        body: JSON.stringify(body),
      });

      let data: any;
      try {
        data = await resp.json();
      } catch {
        data = {};
      }

      if (!resp.ok) {
        const errMsg =
          data?.message ||
          data?.error?.message ||
          data?.error ||
          `HTTP ${resp.status}`;
        console.error(`[OzonDelivery] ${path} error ${resp.status}:`, JSON.stringify(data));
        return { success: false, error: String(errMsg) };
      }

      return { success: true, data: data as T };
    } catch (err: any) {
      console.error(`[OzonDelivery] ${path} сетевая ошибка:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // ─── Публичные методы ─────────────────────────────────────────────────────

  /**
   * Проверяет доступность и стоимость доставки Ozon для покупателя.
   * Endpoint: POST /v1/delivery/check
   */
  async checkDelivery(
    customerPhone: string,
    items?: Array<{ offerId: string; quantity: number }>,
  ): Promise<OzonDeliveryCheckResult> {
    const body: Record<string, unknown> = { customer_phone: customerPhone };
    if (items && items.length > 0) {
      body.items = items.map((i) => ({ offer_id: i.offerId, quantity: i.quantity }));
    }

    const result = await this.request<any>("/v1/delivery/check", body);
    if (!result.success) {
      return { available: false, cost: 0, error: result.error };
    }

    const r = result.data?.result ?? result.data ?? {};
    const rawCost = r.delivery_price ?? r.cost ?? r.amount ?? 0;
    // Если значение маленькое (< 1000) — скорее рубли, конвертируем в копейки
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
   * Создаёт заказ Ozon Delivery после успешной оплаты покупателем.
   * Вызывается из вебхука оплаты (ЮКасса / Т-Банк) — fire-and-forget.
   * Endpoint: POST /v1/delivery/order/create
   */
  async createOrder(params: OzonCreateOrderParams): Promise<OzonCreateOrderResult> {
    const body = {
      external_order_id: params.externalOrderId,
      customer_phone: params.customerPhone,
      customer_name: params.customerName,
      items: params.items.map((item) => ({
        offer_id: item.offerId,
        quantity: item.quantity,
        price: item.price,
        name: item.name,
      })),
    };

    console.log(
      `[OzonDelivery] createOrder: external_id=${params.externalOrderId}`,
      `phone=${params.customerPhone}`,
      `items=${params.items.length}`,
      `amount=${(params.amount / 100).toFixed(0)}₽`,
    );

    const result = await this.request<any>("/v1/delivery/order/create", body);
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
   * Получает текущий статус заказа и ссылку для трекинга.
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
