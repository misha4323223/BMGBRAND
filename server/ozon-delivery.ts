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

// ─── Haversine ────────────────────────────────────────────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── DaData geocoding ─────────────────────────────────────────────────────────
async function geocodeCity(city: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.DADATA_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Token ${apiKey}`,
      },
      body: JSON.stringify({
        query: city,
        count: 1,
        from_bound: { value: "city" },
        to_bound: { value: "city" },
      }),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const s = data?.suggestions?.[0]?.data;
    if (s?.geo_lat && s?.geo_lon) {
      return { lat: parseFloat(s.geo_lat), lng: parseFloat(s.geo_lon) };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── PVZ coordinate cache ─────────────────────────────────────────────────────
interface PvzCacheEntry { map_point_id: number; lat: number; lng: number }
let pvzCache: { points: PvzCacheEntry[]; loadedAt: number } | null = null;
const PVZ_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов

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

  private async doRequest<T>(
    path: string,
    body: object,
    token: string,
  ): Promise<{ status: number; ok: boolean; data: any }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    };
    if (this.clientId) headers["Client-Id"] = this.clientId;

    const resp = await fetch(`${OZON_SELLER_API}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    let data: any;
    try { data = await resp.json(); } catch { data = {}; }
    return { status: resp.status, ok: resp.ok, data };
  }

  private async request<T>(
    path: string,
    body: object,
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    let token = await ozonDeliveryOAuth.getAccessToken();
    if (!token) {
      return { success: false, error: "Ozon Delivery: нет OAuth-токена. Авторизуйте приложение в Admin → Интеграции." };
    }

    try {
      let { status, ok, data } = await this.doRequest(path, body, token);

      // Если 401 — токен мог быть отозван или истечь раньше сохранённого expiresAt.
      // Пробуем принудительный рефреш и один повтор.
      if (status === 401) {
        console.warn(`[OzonDelivery] ${path} → 401, принудительный refresh токена...`);
        const refreshResult = await ozonDeliveryOAuth.refreshAccessToken();
        const newToken = refreshResult.success ? await ozonDeliveryOAuth.getAccessToken() : null;
        if (newToken) {
          // Retry с новым токеном
          const retryResp = await this.doRequest(path, body, newToken);
          if (!retryResp.ok) {
            const errMsg = retryResp.data?.message || retryResp.data?.error || `HTTP ${retryResp.status}`;
            console.error(`[OzonDelivery] ${path} error after refresh ${retryResp.status}:`, JSON.stringify(retryResp.data));
            return { success: false, error: String(errMsg) };
          }
          return { success: true, data: retryResp.data as T };
        } else {
          const reason = refreshResult.error || "refresh_token истёк — переавторизуйтесь в Admin → Интеграции";
          console.error(`[OzonDelivery] ${path} refresh failed:`, reason);
          return { success: false, error: reason };
        }
      }

      if (!ok) {
        const errMsg = data?.message || data?.error?.message || data?.error || `HTTP ${status}`;
        console.error(`[OzonDelivery] ${path} error ${status}:`, JSON.stringify(data));
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
   * Загружает и кеширует все ПВЗ (map_point_id + координаты) с 6-часовым TTL.
   * /v1/delivery/point/list возвращает ~92k точек без адресов и без фильтра по городу.
   */
  private async loadAllPvz(): Promise<PvzCacheEntry[]> {
    if (pvzCache && Date.now() - pvzCache.loadedAt < PVZ_CACHE_TTL_MS) {
      return pvzCache.points;
    }
    console.log("[OzonDelivery] Загружаем все ПВЗ (может занять несколько секунд)...");
    const result = await this.request<any>("/v1/delivery/point/list", { limit: 999999 });
    if (!result.success) {
      console.error("[OzonDelivery] Не удалось загрузить список ПВЗ:", result.error);
      return pvzCache?.points ?? [];
    }
    const raw: any[] = result.data?.points ?? result.data?.result ?? (Array.isArray(result.data) ? result.data : []);
    const points: PvzCacheEntry[] = raw
      .filter((p: any) => p.coordinate?.lat && p.coordinate?.long)
      .map((p: any) => ({
        map_point_id: p.map_point_id,
        lat: p.coordinate.lat,
        lng: p.coordinate.long,
      }));
    pvzCache = { points, loadedAt: Date.now() };
    console.log(`[OzonDelivery] Кеш ПВЗ загружен: ${points.length} точек`);
    return points;
  }

  /**
   * Получает полные данные нескольких ПВЗ за один запрос.
   * Endpoint: POST /v1/delivery/point/info — принимает map_point_ids (массив, до 100)
   */
  private async getPvzInfoBatch(mapPointIds: number[]): Promise<OzonPvzPoint[]> {
    if (mapPointIds.length === 0) return [];
    const result = await this.request<any>("/v1/delivery/point/info", { map_point_ids: mapPointIds });
    if (!result.success) return [];

    const rawData = result.data;
    // Ответ: { points: [{ delivery_method: { address, address_details, coordinates, description }, enabled }] }
    // Индекс ответа соответствует индексу в запросе (map_point_ids[i] → points[i])
    const raw: any[] =
      rawData?.points ?? rawData?.result ?? rawData?.items ??
      (Array.isArray(rawData) ? rawData : []);

    return raw
      .map((item: any, idx: number) => {
        const dm = item?.delivery_method ?? item;
        const id = String(
          dm.map_point_id ?? dm.id ?? dm.point_id ??
          item.map_point_id ?? item.id ??
          mapPointIds[idx] ?? ""
        );
        if (!id) return null;

        // Адрес — вложен в delivery_method
        const address =
          dm.address ??
          dm.address_comment ?? dm.full_address ??
          [dm.address_details?.city, dm.address_details?.street, dm.address_details?.house]
            .filter(Boolean).join(", ");
        if (!address) return null;

        const city = dm.address_details?.city ?? dm.city ?? dm.location?.city ?? "";
        // Часы работы: schedule — массив [{date, periods:[{min,max}]}]
        // Берём первый entry чтобы показать формат "10:00–22:00"
        const sched = dm.work_schedule ?? dm.schedule ?? dm.work_time ?? dm.working_hours;
        let workingHours: string | undefined;
        if (Array.isArray(sched) && sched[0]?.periods?.[0]) {
          const p = sched[0].periods[0];
          const fmt = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          workingHours = `${fmt(p.min.hours, p.min.minutes)}–${fmt(p.max.hours, p.max.minutes)}`;
        } else if (typeof sched === "string" && sched) {
          workingHours = sched;
        }

        return {
          id,
          name: dm.name ?? dm.title ?? dm.delivery_type?.name ?? `Ozon ПВЗ ${id}`,
          address,
          city,
          lat: dm.coordinates?.lat ?? dm.coordinate?.lat ?? dm.lat,
          lng: dm.coordinates?.long ?? dm.coordinate?.long ?? dm.lng,
          workingHours: workingHours || undefined,
        } as OzonPvzPoint;
      })
      .filter((p): p is OzonPvzPoint => p !== null);
  }

  /**
   * Возвращает список ПВЗ Ozon рядом с указанным городом.
   * Алгоритм: геокодинг (DaData) → Haversine фильтр ≤25 км →
   * топ-N ближайших → /v1/delivery/point/info (батч до 100 ID).
   */
  async getPvzList(city?: string, limit = 50): Promise<{
    success: boolean;
    points?: OzonPvzPoint[];
    error?: string;
  }> {
    if (!city?.trim()) return { success: true, points: [] };

    // 1. Геокодируем город через DaData
    const coords = await geocodeCity(city.trim());
    if (!coords) {
      return { success: false, error: `Не удалось определить координаты города «${city}»` };
    }
    console.log(`[OzonDelivery] Город «${city}» → lat=${coords.lat}, lng=${coords.lng}`);

    // 2. Загружаем (или берём из кеша) все ПВЗ (координаты)
    const allPvz = await this.loadAllPvz();
    if (allPvz.length === 0) {
      return { success: false, error: "Не удалось загрузить список ПВЗ Ozon" };
    }

    // 3. Фильтруем по расстоянию — 100 км, расширяем до 300 км если < 3 результатов
    let MAX_KM = 100;
    const withDist = allPvz.map(p => ({
      ...p, distKm: haversineKm(coords.lat, coords.lng, p.lat, p.lng),
    }));
    let nearby = withDist.filter(p => p.distKm <= MAX_KM).sort((a, b) => a.distKm - b.distKm).slice(0, limit);

    if (nearby.length < 3) {
      MAX_KM = 300;
      nearby = withDist.filter(p => p.distKm <= MAX_KM).sort((a, b) => a.distKm - b.distKm).slice(0, limit);
    }

    console.log(`[OzonDelivery] В радиусе ${MAX_KM}км от «${city}»: ${nearby.length} ПВЗ (из ${allPvz.length})`);
    if (nearby.length === 0) return { success: true, points: [] };

    // 4. Один батч-запрос на все ID (API принимает до 100)
    const ids = nearby.map(p => p.map_point_id);
    const points = await this.getPvzInfoBatch(ids);

    console.log(`[OzonDelivery] getPvzList: вернули ${points.length} ПВЗ для «${city}»`);
    return { success: true, points };
  }

  /**
   * Возвращает только координаты всех ПВЗ рядом с городом — без вызовов Ozon API.
   * Используется для быстрого отображения всех маркеров на карте.
   * Детали (адрес, часы) подгружаются отдельно по клику через getPvzPointDetail.
   */
  async getPvzMapPoints(city?: string): Promise<{
    success: boolean;
    points: Array<{ id: string; lat: number; lng: number }>;
    error?: string;
  }> {
    if (!city?.trim()) return { success: true, points: [] };

    const coords = await geocodeCity(city.trim());
    if (!coords) {
      return { success: false, points: [], error: `Не удалось определить координаты города «${city}»` };
    }
    console.log(`[OzonDelivery] getPvzMapPoints: «${city}» → lat=${coords.lat}, lng=${coords.lng}`);

    const allPvz = await this.loadAllPvz();
    if (allPvz.length === 0) {
      return { success: false, points: [], error: "Кэш ПВЗ пуст" };
    }

    // Ограничиваем 500 ближайшими — этого достаточно для города, кластер на фронте справится
    const MAX_POINTS = 500;
    let MAX_KM = 50;
    const withDist = allPvz.map(p => ({ ...p, distKm: haversineKm(coords.lat, coords.lng, p.lat, p.lng) }));
    let nearby = withDist.filter(p => p.distKm <= MAX_KM).sort((a, b) => a.distKm - b.distKm).slice(0, MAX_POINTS);
    if (nearby.length < 3) {
      MAX_KM = 200;
      nearby = withDist.filter(p => p.distKm <= MAX_KM).sort((a, b) => a.distKm - b.distKm).slice(0, MAX_POINTS);
    }

    console.log(`[OzonDelivery] getPvzMapPoints: ${nearby.length} точек в радиусе ${MAX_KM}км`);
    return {
      success: true,
      points: nearby.map(p => ({ id: String(p.map_point_id), lat: p.lat, lng: p.lng })),
    };
  }

  /**
   * Возвращает полные данные одного ПВЗ по его map_point_id.
   * Вызывается по клику на маркер карты для отображения адреса и часов работы.
   */
  async getPvzPointDetail(id: string): Promise<{ success: boolean; point?: OzonPvzPoint; error?: string }> {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, error: "Неверный ID" };
    const points = await this.getPvzInfoBatch([numId]);
    if (!points.length) return { success: false, error: "ПВЗ не найден" };
    return { success: true, point: points[0] };
  }

  /**
   * Проверяет доступность и стоимость доставки для покупателя по телефону.
   * Endpoint: POST /v1/delivery/check
   */
  async checkDelivery(
    customerPhone: string,
    items?: Array<{ offerId: string; quantity: number }>,
  ): Promise<OzonDeliveryCheckResult> {
    // Ozon требует только цифры (10–15), паттерн: ^\d{10,15}$
    const cleanPhone = customerPhone.replace(/\D/g, "");
    console.log(`[OzonDelivery] checkDelivery: raw="${customerPhone}" clean="${cleanPhone}" len=${cleanPhone.length}`);
    const body: Record<string, unknown> = { client_phone: cleanPhone };
    if (items && items.length > 0) {
      body.items = items.map(i => ({ offer_id: i.offerId, quantity: i.quantity }));
    }

    const result = await this.request<any>("/v1/delivery/check", body);
    if (!result.success) {
      return { available: false, cost: 0, error: result.error };
    }

    // Ozon /v1/delivery/check возвращает только признак возможности доставки.
    // Отдельного API для расчёта тарифа нет — используем фиксированную цену.
    const OZON_FIXED_DELIVERY_COST_KOPEKS = 35_000; // 350 ₽

    const r = result.data?.result ?? result.data ?? {};
    const isAvailable =
      r.is_possible === true ||
      r.is_available === true ||
      r.available === true;

    return {
      available: isAvailable,
      cost: isAvailable ? OZON_FIXED_DELIVERY_COST_KOPEKS : 0,
      deliveryDateFrom: r.delivery_date_from ?? r.date_from,
      deliveryDateTo: r.delivery_date_to ?? r.date_to,
    };
  }

  /**
   * Создаёт заказ в Ozon Logistics после успешной оплаты.
   * Передаёт выбранный покупателем ПВЗ (pvz_id).
   *
   * Правильный порядок:
   *   1. v2/delivery/checkout — проверка товаров + расчёт сроков (не создаёт заказ)
   *   2. v2/order/create     — фактическое создание заказа (этот метод)
   *
   * Endpoint: POST /v2/order/create
   */
  async createOrder(params: OzonCreateOrderParams): Promise<OzonCreateOrderResult> {
    // Ozon API v2 требует вложенный объект buyer (protobuf OrderCreateRequestV2.Buyer).
    // Плоские customer_name/customer_phone на верхнем уровне не принимаются — поле buyer обязательно.
    const body: Record<string, unknown> = {
      external_order_id: params.externalOrderId,
      buyer: {
        name: params.customerName,
        phone: params.customerPhone,
      },
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

    const result = await this.request<any>("/v2/order/create", body);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // v2/order/create возвращает order_number + postings
    const ozonOrderId =
      result.data?.result?.order_number ??
      result.data?.result?.order_id ??
      result.data?.order_number ??
      result.data?.order_id ??
      "";

    console.log(`[OzonDelivery] Order created: ozon_order_id=${ozonOrderId}`);
    return { success: true, ozonOrderId: String(ozonOrderId) };
  }

  /**
   * Проверяет доступность доставки для покупателя ПЕРЕД созданием платежа.
   *
   * Использует /v1/delivery/check (работающий endpoint) вместо /v2/delivery/checkout,
   * который не принимает delivery_type ни как число ни как строку (proto syntax error).
   *
   * Вызывается в POST /api/orders до инициализации платежа.
   */
  async checkoutDelivery(params: {
    items: Array<{ offerId: string; quantity: number; price: number; name: string }>;
    pvzId?: string;
    customerPhone: string;
  }): Promise<{ success: boolean; checkoutId?: string; error?: string; unavailableItems?: string[] }> {
    console.log(
      `[OzonDelivery] checkoutDelivery (via /v1/delivery/check): ${params.items.length} items`,
      `pvz_id=${params.pvzId ?? "не указан"}`,
      `phone=${params.customerPhone}`,
    );

    // /v1/delivery/check принимает client_phone и опционально items
    const checkItems = params.items.map(i => ({ offerId: i.offerId, quantity: i.quantity }));
    const result = await this.checkDelivery(params.customerPhone, checkItems);

    if (!result.available) {
      const err = result.error ?? "Доставка Ozon недоступна для этого номера телефона";
      console.warn(`[OzonDelivery] checkoutDelivery: недоступно — ${err}`);
      return { success: false, error: err, unavailableItems: [] };
    }

    console.log(`[OzonDelivery] checkoutDelivery OK (available=true)`);
    return { success: true };
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
