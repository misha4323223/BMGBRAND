import YooKassa from "yookassa";
import crypto from "crypto";
import { Agent } from "undici";

// T-Bank использует российский национальный УЦ (Минцифры), которому
// Node.js не доверяет по умолчанию — отключаем проверку только для T-Bank.
const tbankTlsAgent = new Agent({ connect: { rejectUnauthorized: false } });

function uuidv4(): string {
  return crypto.randomUUID();
}

interface PaymentConfig {
  yookassa?: {
    shopId: string;
    secretKey: string;
  };
  tbank?: {
    terminalKey: string;
    secretKey: string;
    testMode?: boolean; // Use test API URL for proper decline testing
  };
}

interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
  tax?: string;
}

interface CreatePaymentParams {
  amount: number;
  description: string;
  orderId: string;
  returnUrl: string;
  metadata?: Record<string, string>;
  paymentMethod?: "yookassa" | "tbank";
  useWidget?: boolean;
  receiptEmail?: string;
  receiptItems?: ReceiptItem[];
}

interface PaymentResult {
  success: boolean;
  paymentId?: string;
  confirmationUrl?: string;
  confirmationToken?: string;
  error?: string;
}

interface PaymentStatus {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  paid: boolean;
  amount: number;
  metadata?: Record<string, string>;
}

class PaymentService {
  private yookassa: YooKassa | null = null;
  private tbankConfig: { terminalKey: string; secretKey: string; testMode: boolean } | null = null;

  // T-Bank API URLs
  private readonly TBANK_PROD_URL = "https://securepay.tinkoff.ru/v2";
  private readonly TBANK_TEST_URL = "https://rest-api-test.tinkoff.ru/v2";

  initialize(config: PaymentConfig) {
    if (config.yookassa?.shopId && config.yookassa?.secretKey) {
      this.yookassa = new YooKassa({
        shopId: config.yookassa.shopId,
        secretKey: config.yookassa.secretKey,
      });
      console.log("[Payments] YooKassa initialized");
    }

    if (config.tbank?.terminalKey && config.tbank?.secretKey) {
      const testMode = config.tbank.testMode || false;
      this.tbankConfig = {
        terminalKey: config.tbank.terminalKey.trim(),
        secretKey: config.tbank.secretKey.trim(),
        testMode,
      };
      const mode = testMode ? "TEST" : "PRODUCTION";
      console.log(`[Payments] T-Bank initialized in ${mode} mode, terminal:`, this.tbankConfig.terminalKey);
    }
  }

  isYooKassaEnabled(): boolean {
    return this.yookassa !== null;
  }

  isTBankEnabled(): boolean {
    return this.tbankConfig !== null;
  }

  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    const method = params.paymentMethod || "yookassa";

    if (method === "yookassa") {
      const result = await this.createYooKassaPayment(params);
      if (!result.success) {
        console.error("[Payments] YooKassa payment failed:", result.error);
      }
      return result;
    } else if (method === "tbank") {
      const result = await this.createTBankPayment(params);
      if (!result.success) {
        console.error("[Payments] T-Bank payment failed:", result.error);
      }
      return result;
    }

    return { success: false, error: "Unsupported payment method" };
  }

  private async createYooKassaPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    if (!this.yookassa) {
      return { success: false, error: "YooKassa not configured" };
    }

    try {
      const idempotenceKey = uuidv4();
      const amountRub = (params.amount / 100).toFixed(2);

      const useWidget = params.useWidget === true;
      const confirmation: any = useWidget
        ? { type: "embedded" }
        : { type: "redirect", return_url: params.returnUrl };

      const payment = await this.yookassa.createPayment({
        amount: {
          value: amountRub,
          currency: "RUB",
        },
        confirmation,
        capture: true,
        description: params.description,
        metadata: {
          order_id: params.orderId,
          ...params.metadata,
        },
      }, idempotenceKey);

      const result: PaymentResult = {
        success: true,
        paymentId: payment.id,
      };

      if (useWidget) {
        result.confirmationToken = payment.confirmation?.confirmation_token;
      } else {
        result.confirmationUrl = payment.confirmation?.confirmation_url;
      }

      return result;
    } catch (err: any) {
      console.error("[YooKassa] Payment error:", err.message);
      return { success: false, error: err.message };
    }
  }

  private generateTBankToken(params: Record<string, any>): string {
    // Добавляем пароль к параметрам
    const allParams: Record<string, any> = { ...params, Password: this.tbankConfig!.secretKey };
    
    // Сортируем ключи и собираем значения
    const sortedKeys = Object.keys(allParams).sort();
    console.log('[T-Bank] Token generation - sorted keys:', sortedKeys);
    
    const values = sortedKeys.map(key => {
      const value = allParams[key];
      // Пропускаем объекты и массивы
      if (typeof value === 'object' && value !== null) return '';
      return String(value);
    }).filter(v => v !== '');
    
    const concatenated = values.join('');
    console.log('[T-Bank] Token generation - concatenated length:', concatenated.length);
    
    // Используем явную UTF-8 кодировку
    const token = crypto.createHash('sha256').update(concatenated, 'utf8').digest('hex');
    console.log('[T-Bank] Generated token:', token);
    return token;
  }

  private async createTBankPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    if (!this.tbankConfig) {
      return { success: false, error: "T-Bank not configured" };
    }

    try {
      // Все параметры запроса ДОЛЖНЫ участвовать в формировании токена
      const successUrl = params.returnUrl;
      const failUrl = params.returnUrl.replace('/order-success/', '/order-failed/').replace('/gift-cards/success', '/gift-cards/failed');
      
      // Формируем NotificationURL для вебхука - извлекаем базовый URL из returnUrl
      // Strip www. — T-Bank does not follow 301 redirects, www→non-www redirect breaks payment notifications
      const urlObj = new URL(params.returnUrl);
      const hostWithoutWww = urlObj.host.replace(/^www\./, '');
      const baseUrl = `${urlObj.protocol}//${hostWithoutWww}`;
      const notificationUrl = `${baseUrl}/api/webhooks/tbank`;
      
      const requestParams: Record<string, any> = {
        TerminalKey: this.tbankConfig.terminalKey,
        Amount: params.amount,
        OrderId: params.orderId,
        Description: params.description,
        SuccessURL: successUrl,
        FailURL: failUrl,
        NotificationURL: notificationUrl,
      };

      if (params.receiptItems && params.receiptItems.length > 0 && params.receiptEmail) {
        const receiptItems = params.receiptItems.map(item => ({
          Name: item.name.substring(0, 128),
          Price: item.price,
          Quantity: item.quantity,
          Amount: item.price * item.quantity,
          Tax: item.tax || "none",
          PaymentMethod: "full_payment",
          PaymentObject: "commodity",
        }));

        const receiptTotal = receiptItems.reduce((sum, it) => sum + it.Amount, 0);
        if (receiptTotal !== params.amount) {
          const diff = params.amount - receiptTotal;
          if (diff > 0) {
            receiptItems.push({
              Name: "Корректировка",
              Price: diff,
              Quantity: 1,
              Amount: diff,
              Tax: "none",
              PaymentMethod: "full_payment",
              PaymentObject: "commodity",
            });
          } else {
            let remaining = Math.abs(diff);
            for (let i = receiptItems.length - 1; i >= 0 && remaining > 0; i--) {
              const item = receiptItems[i];
              const maxDeduct = item.Amount - 1;
              if (maxDeduct <= 0) continue;
              const deduct = Math.min(remaining, maxDeduct);
              item.Amount -= deduct;
              if (item.Quantity === 1) {
                item.Price = item.Amount;
              }
              remaining -= deduct;
            }
          }
        }

        requestParams.Receipt = {
          Email: params.receiptEmail,
          Taxation: "usn_income",
          Items: receiptItems,
        };
      }
      
      requestParams.Token = this.generateTBankToken(requestParams);
      
      // Use test or production URL based on config
      const apiBaseUrl = this.tbankConfig.testMode ? this.TBANK_TEST_URL : this.TBANK_PROD_URL;
      const initUrl = `${apiBaseUrl}/Init`;
      
      console.log(`[T-Bank] Init request to ${initUrl}:`, JSON.stringify(requestParams, null, 2));
      
      const response = await fetch(initUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestParams),
        // @ts-ignore — undici dispatcher, встроен в Node.js 20
        dispatcher: tbankTlsAgent,
      });

      const data = await response.json();
      console.log('[T-Bank] Init response:', JSON.stringify(data, null, 2));

      if (data.Success) {
        return {
          success: true,
          paymentId: String(data.PaymentId),
          confirmationUrl: data.PaymentURL,
        };
      }

      return { success: false, error: data.Message || data.Details || "T-Bank payment error" };
    } catch (err: any) {
      const cause = (err as any)?.cause;
      console.error("[T-Bank] Payment error:", err.message,
        cause ? `| cause: ${cause.message} (code=${cause.code})` : "");
      return { success: false, error: err.message };
    }
  }

  async getPaymentStatus(paymentId: string, method: "yookassa" | "tbank" = "yookassa"): Promise<PaymentStatus | null> {
    if (method === "yookassa" && this.yookassa) {
      try {
        const payment = await this.yookassa.getPayment(paymentId);
        return {
          id: payment.id,
          status: payment.status,
          paid: payment.paid,
          amount: Math.round(parseFloat(payment.amount.value) * 100),
          metadata: payment.metadata,
        };
      } catch (err: any) {
        console.error("[YooKassa] Get payment error:", err.message);
        return null;
      }
    }

    if (method === "tbank" && this.tbankConfig) {
      try {
        const baseUrl = this.tbankConfig.testMode ? this.TBANK_TEST_URL : this.TBANK_PROD_URL;
        const response = await fetch(`${baseUrl}/GetState`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            TerminalKey: this.tbankConfig.terminalKey,
            PaymentId: paymentId,
          }),
          // @ts-ignore — undici dispatcher
          dispatcher: tbankTlsAgent,
        });

        const data = await response.json();
        if (data.Success) {
          const statusMap: Record<string, PaymentStatus["status"]> = {
            NEW: "pending",
            AUTHORIZED: "waiting_for_capture",
            CONFIRMED: "succeeded",
            CANCELED: "canceled",
            REJECTED: "canceled",
            REFUNDED: "canceled",
          };

          return {
            id: data.PaymentId,
            status: statusMap[data.Status] || "pending",
            paid: data.Status === "CONFIRMED",
            amount: data.Amount,
          };
        }
        return null;
      } catch (err: any) {
        console.error("[T-Bank] Get status error:", err.message);
        return null;
      }
    }

    return null;
  }

  verifyYooKassaWebhook(body: any, ip: string): boolean {
    if (!body || !body.event || !body.object) return false;
    return true;
  }

  verifyTBankWebhook(body: any): boolean {
    if (!this.tbankConfig || !body.Token) return false;

    const { Token, ...params } = body;
    params.Password = this.tbankConfig.secretKey;

    const sortedKeys = Object.keys(params).sort();
    const values = sortedKeys.map(key => {
      const value = params[key];
      if (typeof value === 'object' && value !== null) return '';
      return String(value);
    }).filter(v => v !== '');

    const concatenated = values.join('');
    const calculatedToken = crypto.createHash('sha256').update(concatenated, 'utf8').digest('hex');

    console.log('[T-Bank Webhook] Token verify - sorted keys:', sortedKeys);
    console.log('[T-Bank Webhook] Token verify - expected:', Token);
    console.log('[T-Bank Webhook] Token verify - calculated:', calculatedToken);

    return Token === calculatedToken;
  }
}

export const paymentService = new PaymentService();
