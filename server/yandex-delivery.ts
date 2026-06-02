const YD_PROD_URL = "https://b2b-authproxy.taxi.yandex.net";

interface YdPickupPoint {
  id: string;
  name: string;
  type: string;
  position: {
    latitude: number;
    longitude: number;
  };
  address: {
    geoId?: number;
    country?: string;
    region?: string;
    locality?: string;
    street?: string;
    house?: string;
    full_address?: string;
    postal_code?: string;
    comment?: string;
  };
  instruction?: string;
  payment_methods?: string[];
  schedule?: {
    time_zone?: number;
    restrictions?: Array<{
      days?: number[];
      time_from?: { hours: number; minutes: number };
      time_to?: { hours: number; minutes: number };
    }>;
  };
  is_yandex_branded?: boolean;
  pickup_services?: {
    is_fitting_allowed?: boolean;
    is_partial_refuse_allowed?: boolean;
    is_paperless_pickup_allowed?: boolean;
    is_unboxing_allowed?: boolean;
  };
  available_for_dropoff?: boolean;
}

interface YdGeoVariant {
  geo_id: number;
  address: string;
}

interface YdPricingResult {
  pricing_total: string;
  delivery_days: number;
}

interface YdOfferResult {
  offer_id: string;
  request_id?: string;
  pricing?: {
    total?: { value: string; currency: string };
  };
  delivery_interval?: {
    from: string;
    to: string;
  };
  pickup_interval?: any;
}

let pickupPointsCache: Map<number, { points: YdPickupPoint[]; loadedAt: number }> = new Map();
const CACHE_TTL = 60 * 60 * 1000;

export class YandexDeliveryService {
  private baseUrl: string;
  private token: string;
  private platformStationId: string;

  constructor() {
    if (!process.env.YANDEX_DELIVERY_TOKEN || !process.env.YANDEX_DELIVERY_PLATFORM_STATION_ID) {
      console.warn("[YandexDelivery] Missing YANDEX_DELIVERY_TOKEN or YANDEX_DELIVERY_PLATFORM_STATION_ID. Yandex Delivery will not work.");
    }
    this.baseUrl = YD_PROD_URL;
    this.token = process.env.YANDEX_DELIVERY_TOKEN || "";
    this.platformStationId = process.env.YANDEX_DELIVERY_PLATFORM_STATION_ID || "";

    console.log(`[YandexDelivery] Initialized, station: ${this.platformStationId.substring(0, 8)}...`);
  }

  private async request<T>(method: string, endpoint: string, body?: any): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Accept-Language": "ru",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    console.log(`[YandexDelivery] ${method} ${endpoint}`);

    const response = await fetch(url, options);
    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[YandexDelivery] API error ${endpoint} (${response.status}):`, responseText.slice(0, 500));
      throw new Error(`Yandex Delivery API error: ${response.status} - ${responseText.slice(0, 200)}`);
    }

    try {
      return JSON.parse(responseText) as T;
    } catch (e) {
      console.error(`[YandexDelivery] Failed to parse response for ${endpoint}:`, responseText.slice(0, 200));
      throw new Error('Yandex Delivery API returned invalid JSON');
    }
  }

  private async requestGet<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}${endpoint}?${qs}`;
    console.log(`[YandexDelivery] GET ${endpoint}`);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Accept-Language": "ru",
      },
    });
    const responseText = await response.text();
    if (!response.ok) {
      console.error(`[YandexDelivery] API error ${endpoint} (${response.status}):`, responseText.slice(0, 500));
      throw new Error(`Yandex Delivery API error: ${response.status} - ${responseText.slice(0, 200)}`);
    }
    try {
      return JSON.parse(responseText) as T;
    } catch (e) {
      throw new Error('Yandex Delivery API returned invalid JSON');
    }
  }

  async detectGeoId(location: string): Promise<YdGeoVariant[]> {
    console.log(`[YandexDelivery] Detecting geo_id for: ${location}`);
    try {
      const result = await this.request<{ variants: YdGeoVariant[] }>(
        "POST",
        "/api/b2b/platform/location/detect",
        { location }
      );
      console.log(`[YandexDelivery] Found ${result.variants?.length || 0} geo variants`);
      return result.variants || [];
    } catch (error) {
      console.error("[YandexDelivery] detectGeoId error:", error);
      return [];
    }
  }

  async getPickupPoints(geoId: number): Promise<YdPickupPoint[]> {
    const cached = pickupPointsCache.get(geoId);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
      console.log(`[YandexDelivery] Returning ${cached.points.length} cached pickup points for geo_id ${geoId}`);
      return cached.points;
    }

    console.log(`[YandexDelivery] Fetching pickup points for geo_id: ${geoId}`);
    try {
      const result = await this.request<{ points: YdPickupPoint[] }>(
        "POST",
        "/api/b2b/platform/pickup-points/list",
        {
          geo_id: geoId,
          type: "pickup_point",
          payment_method: "already_paid",
        }
      );

      const points = result.points || [];
      console.log(`[YandexDelivery] Found ${points.length} pickup points for geo_id ${geoId}`);

      pickupPointsCache.set(geoId, { points, loadedAt: Date.now() });

      return points;
    } catch (error) {
      console.error("[YandexDelivery] getPickupPoints error:", error);
      return [];
    }
  }

  async listWarehouses(): Promise<any[]> {
    console.log(`[YandexDelivery] Listing warehouses...`);
    try {
      const result = await this.request<any>(
        "POST",
        "/api/b2b/platform/warehouses/list",
        { filter: {} }
      );
      console.log(`[YandexDelivery] Warehouses:`, JSON.stringify(result).slice(0, 2000));
      return result?.warehouses || result || [];
    } catch (error) {
      console.error("[YandexDelivery] listWarehouses error:", error);
      return [];
    }
  }

  async calculatePrice(params: { 
    destinationAddress?: string; 
    destinationStationId?: string;
    totalWeight?: number; 
    totalPrice?: number 
  }): Promise<YdPricingResult | null> {
    const { destinationAddress, destinationStationId, totalWeight, totalPrice } = params;
    console.log(`[YandexDelivery] Calculating price, stationId: ${destinationStationId?.slice(0, 20)}, address: ${destinationAddress?.slice(0, 50)}, weight: ${totalWeight}g`);
    try {
      const destination: any = {};
      if (destinationAddress) {
        destination.address = destinationAddress;
      } else if (destinationStationId) {
        destination.platform_station_id = destinationStationId;
      } else {
        console.error("[YandexDelivery] No destination provided for pricing");
        return null;
      }

      const body: any = {
        source: {
          platform_station_id: this.platformStationId,
        },
        destination,
        tariff: "self_pickup",
        total_weight: totalWeight || 100,
        total_assessed_price: totalPrice || 0,
        payment_method: "already_paid",
        places: [
          {
            physical_dims: {
              weight_gross: totalWeight || 100,
              dx: 29,
              dy: 5,
              dz: 20,
            },
          },
        ],
      };

      console.log(`[YandexDelivery] pricing-calculator body:`, JSON.stringify(body));

      const result = await this.request<YdPricingResult>(
        "POST",
        "/api/b2b/platform/pricing-calculator",
        body
      );

      console.log(`[YandexDelivery] Price: ${result.pricing_total}, days: ${result.delivery_days}`);
      return result;
    } catch (error) {
      console.error("[YandexDelivery] calculatePrice error:", error);
      return null;
    }
  }

  private buildOrderParams(params: {
    operatorRequestId: string;
    destinationStationId?: string;
    destinationAddress?: string;
    items: Array<{
      name: string;
      article?: string;
      count: number;
      unitPrice: number;
      weight?: number;
      dx?: number;
      dy?: number;
      dz?: number;
    }>;
    recipientName: string;
    recipientPhone: string;
    recipientEmail?: string;
    comment?: string;
  }) {
    const destination: any = {};
    if (params.destinationStationId) {
      destination.type = "platform_station";
      destination.platform_station = {
        platform_id: params.destinationStationId,
      };
    } else if (params.destinationAddress) {
      destination.type = "custom_location";
      destination.custom_location = {
        details: {
          full_address: params.destinationAddress,
        },
      };
    }

    const nameParts = params.recipientName.trim().split(/\s+/);
    const lastName = nameParts[0] || "";
    const firstName = nameParts[1] || "";
    const patronymic = nameParts[2] || "";

    let phone = params.recipientPhone.replace(/[^\d+]/g, "");
    if (!phone.startsWith("+")) phone = "+" + phone;
    if (phone.startsWith("+8")) phone = "+7" + phone.slice(2);

    const items = params.items.map((item, idx) => ({
      count: item.count,
      name: item.name,
      article: item.article || `ART-${idx}`,
      billing_details: {
        unit_price: item.unitPrice,
        assessed_unit_price: item.unitPrice,
      },
      physical_dims: {
        dx: item.dx || 30,
        dy: item.dy || 5,
        dz: item.dz || 20,
        predefined_volume: (item.dx || 30) * (item.dy || 5) * (item.dz || 20),
      },
      place_barcode: `place-${idx}`,
    }));

    const totalWeight = params.items.reduce(
      (sum, item) => sum + (item.weight || 100) * item.count, 0
    );

    return {
      info: {
        operator_request_id: params.operatorRequestId,
        comment: params.comment || "Заказ с сайта BMGBRAND",
      },
      source: {
        platform_station: {
          platform_id: this.platformStationId,
        },
      },
      destination,
      items,
      places: [
        {
          physical_dims: {
            weight_gross: totalWeight,
            dx: 40,
            dy: 10,
            dz: 30,
          },
          barcode: "place-0",
        },
      ],
      billing_info: {
        payment_method: "already_paid",
        delivery_cost: 0,
      },
      recipient_info: {
        first_name: firstName,
        last_name: lastName,
        patronymic,
        phone,
        email: params.recipientEmail || "",
      },
      last_mile_policy: params.destinationStationId ? "self_pickup" : "time_interval",
    };
  }

  async createRequest(params: {
    operatorRequestId: string;
    destinationStationId?: string;
    destinationAddress?: string;
    items: Array<{
      name: string;
      article?: string;
      count: number;
      unitPrice: number;
      weight?: number;
      dx?: number;
      dy?: number;
      dz?: number;
    }>;
    recipientName: string;
    recipientPhone: string;
    recipientEmail?: string;
    comment?: string;
  }): Promise<any> {
    console.log(`[YandexDelivery] Creating request for order: ${params.operatorRequestId}`);
    const body = this.buildOrderParams(params);
    console.log(`[YandexDelivery] request/create body:`, JSON.stringify(body).slice(0, 800));
    try {
      const result = await this.request<any>(
        "POST",
        "/api/b2b/platform/request/create",
        body
      );
      console.log(`[YandexDelivery] Request created:`, JSON.stringify(result).slice(0, 500));
      return result;
    } catch (error) {
      console.error("[YandexDelivery] createRequest error:", error);
      throw error;
    }
  }

  async createOffer(params: {
    operatorRequestId: string;
    destinationStationId?: string;
    destinationAddress?: string;
    items: Array<{
      name: string;
      article?: string;
      count: number;
      unitPrice: number;
      weight?: number;
      dx?: number;
      dy?: number;
      dz?: number;
    }>;
    recipientName: string;
    recipientPhone: string;
    recipientEmail?: string;
    comment?: string;
  }): Promise<any> {
    console.log(`[YandexDelivery] Creating offer for order: ${params.operatorRequestId}`);
    const body = this.buildOrderParams(params);
    try {
      const result = await this.request<any>(
        "POST",
        "/api/b2b/platform/offers/create",
        body
      );
      console.log(`[YandexDelivery] Offer created:`, JSON.stringify(result).slice(0, 500));
      return result;
    } catch (error) {
      console.error("[YandexDelivery] createOffer error:", error);
      throw error;
    }
  }

  async confirmOffer(offerId: string, operatorRequestId: string): Promise<any> {
    console.log(`[YandexDelivery] Confirming offer: ${offerId}`);
    try {
      const result = await this.request<any>(
        "POST",
        "/api/b2b/platform/offers/confirm",
        {
          offer_id: offerId,
          operator_request_id: operatorRequestId,
        }
      );
      console.log(`[YandexDelivery] Offer confirmed:`, JSON.stringify(result).slice(0, 300));
      return result;
    } catch (error) {
      console.error("[YandexDelivery] confirmOffer error:", error);
      throw error;
    }
  }

  async cancelRequest(requestId: string): Promise<any> {
    console.log(`[YandexDelivery] Cancelling request: ${requestId}`);
    try {
      const result = await this.request<any>(
        "POST",
        "/api/b2b/platform/request/cancel",
        { request_id: requestId }
      );
      return result;
    } catch (error) {
      console.error("[YandexDelivery] cancelRequest error:", error);
      throw error;
    }
  }

  async getRequestInfo(requestId: string): Promise<any> {
    console.log(`[YandexDelivery] Getting request info: ${requestId}`);
    try {
      return await this.requestGet<any>("/api/b2b/platform/request/info", { request_id: requestId });
    } catch (error) {
      console.error("[YandexDelivery] getRequestInfo error:", error);
      return null;
    }
  }

  async getRequestHistory(requestId: string): Promise<any[]> {
    console.log(`[YandexDelivery] Getting request history: ${requestId}`);
    try {
      const result = await this.requestGet<any>("/api/b2b/platform/request/history", { request_id: requestId });
      return result?.state_history || result?.history || [];
    } catch (error) {
      console.error("[YandexDelivery] getRequestHistory error:", error);
      return [];
    }
  }

  getPlatformStationId(): string {
    return this.platformStationId;
  }
}

export const yandexDeliveryService = new YandexDeliveryService();
