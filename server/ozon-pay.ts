import crypto from "crypto";

const OZON_PAY_API = "https://payapi.ozon.ru";

interface OzonPayConfig {
  accessKey: string;
  secretKey: string;
  notificationSecret: string;
}

interface OzonPayItem {
  extId: string;
  name: string;
  quantity: number;
  price: number;
  sku?: number;
  color?: string;
  size?: string;
}

interface CreateOzonOrderParams {
  extId: string;
  amount: number;
  items: OzonPayItem[];
  successUrl: string;
  failUrl: string;
  receiptEmail?: string;
  notificationUrl?: string;
  withDelivery?: boolean;
}

interface OzonOrderResult {
  success: boolean;
  payLink?: string;
  ozonOrderId?: string;
  error?: string;
}

function buildSignCreateOrder(params: {
  accessKey: string;
  expiresAt: string;
  extId: string;
  fiscalizationType: string;
  paymentAlgorithm: string;
  currencyCode: string;
  value: string;
  secretKey: string;
}): string {
  const str =
    params.accessKey +
    params.expiresAt +
    params.extId +
    params.fiscalizationType +
    params.paymentAlgorithm +
    params.currencyCode +
    params.value +
    params.secretKey;
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function buildSignGetOrder(params: {
  id: string;
  extId: string;
  accessKey: string;
  secretKey: string;
}): string {
  const str = params.id + params.extId + params.accessKey + params.secretKey;
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function buildSignCancelOrder(params: {
  id: string;
  accessKey: string;
  secretKey: string;
}): string {
  const str = params.id + params.accessKey + params.secretKey;
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function buildSignRefundOrder(params: {
  id: string;
  extId: string;
  accessKey: string;
  currencyCode: string;
  value: string;
  secretKey: string;
}): string {
  const str =
    params.id +
    params.extId +
    params.accessKey +
    params.currencyCode +
    params.value +
    params.secretKey;
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

class OzonPayService {
  private config: OzonPayConfig | null = null;

  initialize(config: OzonPayConfig) {
    this.config = config;
    console.log("[OzonPay] Service initialized");
  }

  isEnabled(): boolean {
    return !!(
      this.config?.accessKey &&
      this.config?.secretKey &&
      this.config?.notificationSecret
    );
  }

  async createOrder(params: CreateOzonOrderParams): Promise<OzonOrderResult> {
    if (!this.config) return { success: false, error: "Ozon Pay not configured" };

    // FIX: set real expiry time (24 hours from now) instead of empty string
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const fiscalizationType = "FISCAL_TYPE_SINGLE";
    const paymentAlgorithm = "PAY_ALGO_SMS";
    const currencyCode = "643";
    const valueKopecks = String(params.amount);

    const requestSign = buildSignCreateOrder({
      accessKey: this.config.accessKey,
      expiresAt,
      extId: params.extId,
      fiscalizationType,
      paymentAlgorithm,
      currencyCode,
      value: valueKopecks,
      secretKey: this.config.secretKey,
    });

    // Ozon Pay requires: sum(item.price × quantity) === amount.value exactly.
    // Order-level discounts (loyalty, promo, gift card) reduce the total but not
    // individual prices — so we must distribute the discount proportionally across
    // items before sending. The last item absorbs any kopeck rounding remainder.
    const rawItemsTotal = params.items.reduce((s, item) => {
      const qty = Math.max(1, Math.floor(item.quantity || 1));
      return s + item.price * qty;
    }, 0);

    const totalAmount = params.amount;
    let adjustedItems = params.items;

    if (rawItemsTotal > 0 && rawItemsTotal !== totalAmount) {
      console.log(`[OzonPay] Distributing order discount: itemsTotal=${rawItemsTotal} → amount=${totalAmount} (diff=${rawItemsTotal - totalAmount} kopecks)`);
      let allocated = 0;
      adjustedItems = params.items.map((item, idx) => {
        const qty = Math.max(1, Math.floor(item.quantity || 1));
        if (idx === params.items.length - 1) {
          const remaining = totalAmount - allocated;
          const adjustedPrice = Math.max(1, Math.round(remaining / qty));
          return { ...item, price: adjustedPrice };
        }
        const proportion = (item.price * qty) / rawItemsTotal;
        const lineTotal = Math.round(totalAmount * proportion);
        const adjustedPrice = Math.max(1, Math.round(lineTotal / qty));
        allocated += adjustedPrice * qty;
        return { ...item, price: adjustedPrice };
      });
    }

    const body: any = {
      accessKey: this.config.accessKey,
      requestSign,
      extId: params.extId,
      expiresAt,
      amount: { currencyCode, value: valueKopecks },
      paymentAlgorithm,
      fiscalizationType,
      mode: "MODE_FULL",
      successUrl: params.successUrl,
      failUrl: params.failUrl,
      items: adjustedItems.map((item) => {
        const qty = Math.max(1, Math.floor(item.quantity || 1));
        const attributes: Record<string, string> = {};
        if (item.color) attributes.color = item.color;
        if (item.size) attributes.size = item.size;
        return {
          extId: item.extId,
          name: item.name,
          quantity: qty,
          price: { currencyCode, value: String(item.price) },
          type: "TYPE_PRODUCT",
          vat: "VAT_NONE",
          needMark: false,
          ...(item.sku ? { sku: item.sku } : {}),
          ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
        };
      }),
    };

    if (params.withDelivery) {
      body.deliverySettings = { isEnabled: true };
      // enableFiscalization changes item validation to FFD 1.2 format — skip for now
    }

    if (params.notificationUrl) {
      body.notificationUrl = params.notificationUrl;
    }

    if (params.receiptEmail) {
      body.receiptEmail = params.receiptEmail;
    }

    try {
      const response = await fetch(`${OZON_PAY_API}/v1/createOrder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error(
          "[OzonPay] createOrder error:",
          JSON.stringify(data, null, 2),
        );
        console.error(
          "[OzonPay] Request body was:",
          JSON.stringify(body, null, 2),
        );
        return { success: false, error: data.message || "Ozon Pay error" };
      }

      const payLink = data.order?.payLink;
      const ozonOrderId = data.order?.id;

      if (!payLink) {
        console.error("[OzonPay] No payLink in response:", data);
        return { success: false, error: "No payLink returned from Ozon Pay" };
      }

      console.log(`[OzonPay] Order created: extId=${params.extId}, ozonOrderId=${ozonOrderId}`);
      return { success: true, payLink, ozonOrderId };
    } catch (err: any) {
      const cause = err?.cause ? ` cause=${err.cause.code || err.cause.message || err.cause}` : "";
      console.error(`[OzonPay] createOrder network error: ${err.message}${cause}`);
      return { success: false, error: err.message };
    }
  }

  // FIX: accept optional extId so callers can pass it for correct signature
  async getOrderStatus(ozonOrderId: string, extId = ""): Promise<{ status?: string; error?: string }> {
    if (!this.config) return { error: "Ozon Pay not configured" };

    const requestSign = buildSignGetOrder({
      id: ozonOrderId,
      extId,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
    });

    try {
      const response = await fetch(`${OZON_PAY_API}/v1/getOrderStatus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessKey: this.config.accessKey,
          id: ozonOrderId,
          ...(extId ? { extId } : {}),
          requestSign,
        }),
      });

      const data = await response.json();
      return { status: data.status };
    } catch (err: any) {
      const cause = err?.cause ? ` cause=${err.cause.code || err.cause.message || err.cause}` : "";
      console.error(`[OzonPay] getOrderStatus network error: ${err.message}${cause}`);
      return { error: err.message };
    }
  }

  // FIX: added missing cancelOrder method (was only a sign helper before)
  async cancelOrder(ozonOrderId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.config) return { success: false, error: "Ozon Pay not configured" };

    const requestSign = buildSignCancelOrder({
      id: ozonOrderId,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
    });

    try {
      const response = await fetch(`${OZON_PAY_API}/v1/cancelOrder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessKey: this.config.accessKey,
          id: ozonOrderId,
          requestSign,
        }),
      });

      if (response.ok) {
        console.log(`[OzonPay] Order cancelled: ozonOrderId=${ozonOrderId}`);
        return { success: true };
      }
      const data = await response.json();
      return { success: false, error: data.message };
    } catch (err: any) {
      const cause = err?.cause ? ` cause=${err.cause.code || err.cause.message || err.cause}` : "";
      console.error(`[OzonPay] cancelOrder network error: ${err.message}${cause}`);
      return { success: false, error: err.message };
    }
  }

  async refundOrder(params: {
    ozonOrderId: string;
    extId: string;
    amount: number;
  }): Promise<{ success: boolean; error?: string }> {
    if (!this.config) return { success: false, error: "Ozon Pay not configured" };

    const currencyCode = "643";
    const value = String(params.amount);

    const requestSign = buildSignRefundOrder({
      id: params.ozonOrderId,
      extId: params.extId,
      accessKey: this.config.accessKey,
      currencyCode,
      value,
      secretKey: this.config.secretKey,
    });

    try {
      const response = await fetch(`${OZON_PAY_API}/v1/refundOrder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessKey: this.config.accessKey,
          id: params.ozonOrderId,
          extId: params.extId,
          amount: { currencyCode, value },
          requestSign,
        }),
      });

      if (response.ok) return { success: true };
      const data = await response.json();
      return { success: false, error: data.message };
    } catch (err: any) {
      const cause = err?.cause ? ` cause=${err.cause.code || err.cause.message || err.cause}` : "";
      console.error(`[OzonPay] refundOrder network error: ${err.message}${cause}`);
      return { success: false, error: err.message };
    }
  }

  verifyWebhookSignature(body: any): boolean {
    if (!this.config) return false;
    const {
      accessKey,
      orderID,
      transactionID,
      transactionUid,
      extOrderID,
      extTransactionID,
      amount,
      currencyCode,
      requestSign,
    } = body;

    if (!requestSign) return false;

    const tid = transactionID != null ? String(transactionID) : (transactionUid || "");
    const extOrd = orderID ? (extOrderID || "") : (extTransactionID || "");

    const digest = `${accessKey}|${orderID || ""}|${tid}|${extOrd}|${amount}|${currencyCode}|${this.config.notificationSecret}`;
    const expected = crypto.createHash("sha256").update(digest, "utf8").digest("hex");

    return expected === requestSign;
  }
}

export const ozonPayService = new OzonPayService();
