declare module "yookassa" {
  interface YooKassaConfig {
    shopId: string;
    secretKey: string;
  }

  type YooKassaStatus = "pending" | "waiting_for_capture" | "succeeded" | "canceled";

  interface YooKassaConfirmation {
    type: string;
    confirmation_url?: string;
    confirmation_token?: string;
    return_url?: string;
    [key: string]: any;
  }

  interface YooKassaPayment {
    id: string;
    status: YooKassaStatus;
    paid: boolean;
    amount: { value: string; currency: string };
    confirmation?: YooKassaConfirmation;
    metadata?: Record<string, any>;
    [key: string]: any;
  }

  class YooKassa {
    constructor(config: YooKassaConfig);
    createPayment(params: Record<string, any>, idempotenceKey?: string): Promise<YooKassaPayment>;
    getPayment(paymentId: string): Promise<YooKassaPayment>;
    capturePayment(paymentId: string, params?: Record<string, any>, idempotenceKey?: string): Promise<YooKassaPayment>;
    cancelPayment(paymentId: string, idempotenceKey?: string): Promise<YooKassaPayment>;
  }

  export default YooKassa;
}
