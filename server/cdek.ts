const CDEK_TEST_URL = "https://api.edu.cdek.ru/v2";
const CDEK_PROD_URL = "https://api.cdek.ru/v2";

const CDEK_TEST_ACCOUNT = "wqGwiQx0gg8mLtiEKsUinjVSICCjtTEP";
const CDEK_TEST_SECRET = "RmAmgvSgSl1yirlz9QupbzOJVqhCxcP5";

interface CdekToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  jti: string;
  expiresAt: number;
}

interface CdekLocation {
  code?: number;
  postal_code?: string;
  city?: string;
  address?: string;
}

interface CdekPackage {
  weight: number;
  length?: number;
  width?: number;
  height?: number;
}

interface TariffRequest {
  from_location: CdekLocation;
  to_location: CdekLocation;
  packages: CdekPackage[];
  tariff_code?: number;
}

interface TariffResult {
  tariff_code: number;
  tariff_name: string;
  tariff_description: string;
  delivery_mode: number;
  delivery_sum: number;
  period_min: number;
  period_max: number;
  calendar_min?: number;
  calendar_max?: number;
}

interface DeliveryPoint {
  code: string;
  name: string;
  location: {
    country_code: string;
    region_code: number;
    region: string;
    city_code: number;
    city: string;
    postal_code: string;
    longitude: number;
    latitude: number;
    address: string;
    address_full: string;
  };
  address_comment?: string;
  work_time: string;
  phones?: { number: string }[];
  type: string;
  owner_code: string;
  is_handout: boolean;
  is_reception: boolean;
  is_dressing_room: boolean;
  have_cashless: boolean;
  have_cash: boolean;
  allowed_cod: boolean;
}

let tokenCache: CdekToken | null = null;

interface CachedCity {
  code: number;
  city: string;
  region?: string;
  country_code: string;
  latitude?: number;
  longitude?: number;
  cityLower: string;
}

let citiesCache: CachedCity[] = [];
let citiesCacheLoadedAt = 0;
let citiesCacheLoading: Promise<void> | null = null;
const CITIES_CACHE_TTL = 24 * 60 * 60 * 1000;

export class CdekService {
  private baseUrl: string;
  private account: string;
  private secret: string;

  constructor() {
    const isProduction = process.env.CDEK_ACCOUNT && process.env.CDEK_SECRET;
    this.baseUrl = isProduction ? CDEK_PROD_URL : CDEK_TEST_URL;
    this.account = process.env.CDEK_ACCOUNT || CDEK_TEST_ACCOUNT;
    this.secret = process.env.CDEK_SECRET || CDEK_TEST_SECRET;
    
    console.log(`[CDEK] Initialized in ${isProduction ? 'PRODUCTION' : 'TEST'} mode`);
  }

  async loadCitiesCache(): Promise<void> {
    if (citiesCache.length > 0 && Date.now() - citiesCacheLoadedAt < CITIES_CACHE_TTL) {
      return;
    }
    if (citiesCacheLoading) {
      return citiesCacheLoading;
    }
    citiesCacheLoading = this._doLoadCities();
    try {
      await citiesCacheLoading;
    } finally {
      citiesCacheLoading = null;
    }
  }

  private async _doLoadCities(): Promise<void> {
    console.log("[CDEK] Loading cities cache...");
    try {
      const allCities: CachedCity[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;
      while (hasMore) {
        const result = await this.request<any[]>(
          "GET",
          `/location/cities?country_codes=RU&size=${pageSize}&page=${page}`
        );
        if (!result || result.length === 0) {
          hasMore = false;
        } else {
          for (const c of result) {
            allCities.push({
              code: c.code,
              city: c.city,
              region: c.region,
              country_code: c.country_code,
              latitude: c.latitude,
              longitude: c.longitude,
              cityLower: c.city.toLowerCase(),
            });
          }
          page++;
          if (result.length < pageSize) hasMore = false;
        }
      }
      citiesCache = allCities;
      citiesCacheLoadedAt = Date.now();
      console.log(`[CDEK] Cities cache loaded: ${citiesCache.length} cities`);
    } catch (error) {
      console.error("[CDEK] Failed to load cities cache:", error);
    }
  }

  isCitiesCacheReady(): boolean {
    return citiesCache.length > 0 && Date.now() - citiesCacheLoadedAt < CITIES_CACHE_TTL;
  }

  searchCitiesLocal(query: string, limit: number = 20): CachedCity[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const startsWithResults: CachedCity[] = [];
    const containsResults: CachedCity[] = [];
    for (const city of citiesCache) {
      if (city.cityLower.startsWith(q)) {
        startsWithResults.push(city);
      } else if (city.cityLower.includes(q)) {
        containsResults.push(city);
      }
      if (startsWithResults.length >= limit) break;
    }
    return [...startsWithResults, ...containsResults].slice(0, limit);
  }

  private async getToken(): Promise<string> {
    if (tokenCache && tokenCache.expiresAt > Date.now()) {
      return tokenCache.access_token;
    }

    console.log("[CDEK] Fetching new OAuth token...");
    
    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.account,
        client_secret: this.secret,
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[CDEK] Auth error:", error);
      throw new Error(`CDEK auth failed: ${response.status}`);
    }

    const data = await response.json() as CdekToken;
    tokenCache = {
      ...data,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };

    console.log("[CDEK] Token obtained successfully");
    return tokenCache.access_token;
  }

  private async request<T>(method: string, endpoint: string, body?: any): Promise<T> {
    const token = await this.getToken();
    
    const options: any = {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    
    const responseText = await response.text();
    
    if (!response.ok) {
      console.error(`[CDEK] API error ${endpoint} (${response.status}):`, responseText);
      throw new Error(`CDEK API error: ${response.status}`);
    }

    if (endpoint.includes('calculator')) {
      console.log(`[CDEK] Calculator response (${response.status}):`, responseText.slice(0, 500));
    }

    try {
      return JSON.parse(responseText) as T;
    } catch (e) {
      console.error(`[CDEK] Failed to parse response for ${endpoint}:`, responseText.slice(0, 200));
      throw new Error('CDEK API returned invalid JSON');
    }
  }

  async calculateTariffs(request: TariffRequest): Promise<TariffResult[]> {
    // Add required fields for CDEK calculator
    const fullRequest = {
      type: 1, // 1 = internet-shop delivery
      currency: 1, // 1 = RUB
      lang: "rus",
      ...request,
    };
    console.log("[CDEK] Calculating tariffs:", JSON.stringify(fullRequest));
    
    try {
      const result = await this.request<{ tariff_codes: TariffResult[] }>(
        "POST",
        "/calculator/tarifflist",
        fullRequest
      );
      
      console.log(`[CDEK] Found ${result.tariff_codes?.length || 0} tariffs`);
      return result.tariff_codes || [];
    } catch (error) {
      console.error("[CDEK] Calculate tariffs error:", error);
      return [];
    }
  }

  async calculateTariff(request: TariffRequest & { tariff_code: number }): Promise<TariffResult | null> {
    // Add required fields for CDEK calculator
    const fullRequest = {
      type: 1,
      currency: 1,
      lang: "rus",
      ...request,
    };
    console.log("[CDEK] Calculating specific tariff:", request.tariff_code);
    
    try {
      const result = await this.request<TariffResult>(
        "POST",
        "/calculator/tariff",
        fullRequest
      );
      return result;
    } catch (error) {
      console.error("[CDEK] Calculate tariff error:", error);
      return null;
    }
  }

  async getDeliveryPoints(params: {
    city_code?: number;
    postal_code?: string;
    type?: string;
    country_code?: string;
    size?: number;
  }): Promise<DeliveryPoint[]> {
    console.log("[CDEK] Getting delivery points:", params);
    
    try {
      const queryParams = new URLSearchParams();
      if (params.city_code) queryParams.append("city_code", String(params.city_code));
      if (params.postal_code) queryParams.append("postal_code", params.postal_code);
      if (params.type) queryParams.append("type", params.type);
      if (params.country_code) queryParams.append("country_codes", params.country_code);
      if (params.size) queryParams.append("size", String(params.size));
      
      const result = await this.request<DeliveryPoint[]>(
        "GET",
        `/deliverypoints?${queryParams.toString()}`
      );
      
      console.log(`[CDEK] Found ${result?.length || 0} delivery points`);
      return result || [];
    } catch (error) {
      console.error("[CDEK] Get delivery points error:", error);
      return [];
    }
  }

  async getCities(params: {
    country_codes?: string;
    city?: string;
    postal_code?: string;
    size?: number;
  }): Promise<any[]> {
    console.log("[CDEK] Searching cities:", params);
    
    try {
      const queryParams = new URLSearchParams();
      if (params.country_codes) queryParams.append("country_codes", params.country_codes);
      if (params.city) queryParams.append("city", params.city);
      if (params.postal_code) queryParams.append("postal_code", params.postal_code);
      if (params.size) queryParams.append("size", String(params.size || 20));
      
      const result = await this.request<any[]>(
        "GET",
        `/location/cities?${queryParams.toString()}`
      );
      
      console.log(`[CDEK] Found ${result?.length || 0} cities`);
      return result || [];
    } catch (error) {
      console.error("[CDEK] Get cities error:", error);
      return [];
    }
  }

  async createOrder(orderData: any): Promise<any> {
    console.log("[CDEK] Creating order with data:", JSON.stringify(orderData, null, 2));
    
    try {
      const token = await this.getToken();
      
      const response = await fetch(`${this.baseUrl}/orders`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderData),
      });

      const responseText = await response.text();
      console.log(`[CDEK] Create order response (${response.status}):`, responseText);
      
      let result: any;
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(`CDEK returned non-JSON response: ${responseText.substring(0, 200)}`);
      }

      if (!response.ok) {
        throw new Error(`CDEK API error ${response.status}: ${responseText.substring(0, 500)}`);
      }

      if (result.requests && Array.isArray(result.requests)) {
        const errors = result.requests
          .filter((r: any) => r.errors && r.errors.length > 0)
          .flatMap((r: any) => r.errors);
        
        if (errors.length > 0) {
          const errorMessages = errors.map((e: any) => `${e.code}: ${e.message}`).join('; ');
          console.error(`[CDEK] Order creation validation errors: ${errorMessages}`);
          result._validationErrors = errorMessages;
        }
      }

      return result;
    } catch (error) {
      console.error("[CDEK] Create order error:", error);
      throw error;
    }
  }

  async getOrderStatus(uuid: string): Promise<any> {
    console.log("[CDEK] Getting order status:", uuid);
    
    try {
      const result = await this.request<any>("GET", `/orders/${uuid}`);
      return result;
    } catch (error) {
      console.error("[CDEK] Get order status error:", error);
      return null;
    }
  }

  async deleteOrder(uuid: string): Promise<boolean> {
    console.log("[CDEK] Deleting order:", uuid);
    try {
      const token = await this.getToken();
      const response = await fetch(`${this.baseUrl}/orders/${uuid}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
      });
      const text = await response.text();
      console.log(`[CDEK] Delete order response (${response.status}):`, text);
      return response.ok;
    } catch (error) {
      console.error("[CDEK] Delete order error:", error);
      return false;
    }
  }

  async patchOrderPackages(uuid: string, packages: any[]): Promise<{ success: boolean; error?: string }> {
    console.log("[CDEK] Patching order packages:", uuid);
    try {
      const token = await this.getToken();
      const response = await fetch(`${this.baseUrl}/orders`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uuid, packages }),
      });
      const text = await response.text();
      console.log(`[CDEK] Patch order response (${response.status}):`, text);
      if (!response.ok) {
        return { success: false, error: `CDEK PATCH ${response.status}: ${text.substring(0, 200)}` };
      }
      let result: any;
      try { result = JSON.parse(text); } catch { return { success: true }; }
      if (result.requests) {
        const errors = result.requests
          .filter((r: any) => r.errors?.length > 0)
          .flatMap((r: any) => r.errors)
          .map((e: any) => `${e.code}: ${e.message}`).join('; ');
        if (errors) return { success: false, error: errors };
      }
      return { success: true };
    } catch (error: any) {
      console.error("[CDEK] Patch order error:", error);
      return { success: false, error: error.message };
    }
  }
}

export const cdekService = new CdekService();

export const CDEK_TARIFFS = {
  PVZ_TO_PVZ: 136,
  PVZ_TO_DOOR: 137,
  DOOR_TO_PVZ: 138,
  DOOR_TO_DOOR: 139,
  EXPRESS_DOOR_DOOR: 184,
  EXPRESS_DOOR_PVZ: 185,
  ECONOMY_PVZ_PVZ: 366,
  ECONOMY_PVZ_PVZ_2: 368,
};

// Новомосковск, Тульская область, ПВЗ ул. Мира 3ж
export const CDEK_SENDER_CITY_CODE = 447;
export const CDEK_SENDER_ADDRESS = "Тульская область, г. Новомосковск, ПВЗ ул. Мира 3ж";
export const CDEK_SENDER_PVZ_CODE = process.env.CDEK_SENDER_PVZ_CODE || "NMS3";

export const CDEK_TO_DOOR_TARIFFS = [137, 139, 184];

export const CDEK_FROM_PVZ_TARIFFS = [136, 137, 366, 368];

export function isTariffToDoor(tariffCode: number): boolean {
  return CDEK_TO_DOOR_TARIFFS.includes(tariffCode);
}

export function isTariffFromPvz(tariffCode: number): boolean {
  return CDEK_FROM_PVZ_TARIFFS.includes(tariffCode);
}

// Default package dimensions for delivery calculation
export const CDEK_DEFAULT_PACKAGE = {
  weight: 100, // grams
  length: 29,  // cm
  width: 20,   // cm
  height: 5,   // cm
};
