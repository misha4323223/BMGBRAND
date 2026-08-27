import { extractColorFromName } from './categoryMapper';
import { logError, logWarn } from "./logger";

const BITRIX24_WEBHOOK_URL = process.env.BITRIX24_WEBHOOK_URL || '';

const productCache = new Map<string, number>();

interface BitrixResponse {
  result?: any;
  error?: string;
  error_description?: string;
}

interface OrderItem {
  productId?: number;
  productName: string;
  quantity: number;
  price: number;
  size?: string;
  color?: string;
  sku?: string;
  imageUrl?: string;
}

interface DiscountDetails {
  subtotal: number;
  deliveryCost: number;
  promoCode?: string | null;
  promoDiscountPercent?: number | null;
  promoDiscountAmount: number;
  loyaltyPercent?: number;
  loyaltyDiscountAmount: number;
  giftCardCode?: string | null;
  giftCardAmount: number;
  isWholesale?: boolean;
}

interface OrderForBitrix {
  id: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;
  total: number;
  items: OrderItem[];
  status: string;
  isWholesale?: boolean;
  transportCompany?: string;
  promoCode?: string;
  cdekPointCode?: string;
  deliveryService?: string;
  companyName?: string;
  inn?: string;
  kpp?: string;
  legalAddress?: string;
  contactPerson?: string;
  contactPhone?: string;
  storeName?: string;
  storeAddress?: string;
  discountDetails?: DiscountDetails;
}

const STATUS_TO_STAGE: Record<string, string> = {
  'pending': 'NEW',
  'paid': 'PREPARATION',
  'processing': 'PREPARATION',
  'shipped': 'PREPAYMENT_INVOICE',
  'delivering': 'PREPAYMENT_INVOICE',
  'delivered': 'WON',
  'completed': 'WON',
  'cancelled': 'LOSE',
  'refunded': 'LOSE',
};

async function callBitrix(method: string, params: Record<string, any> = {}): Promise<BitrixResponse> {
  if (!BITRIX24_WEBHOOK_URL) {
    return { error: 'not_configured' };
  }

  const url = `${BITRIX24_WEBHOOK_URL.replace(/\/$/, '')}/${method}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const text = await response.text();
      logError(`[Bitrix24] HTTP ${response.status}: ${text}`);
      return { error: `http_${response.status}`, error_description: text };
    }

    return response.json();
  } catch (err: any) {
    logError(`[Bitrix24] Network error calling ${method}:`, err.message);
    return { error: 'network_error', error_description: err.message };
  }
}

async function downloadImageAsBase64(imageUrl: string): Promise<{ base64: string; filename: string } | null> {
  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = buffer.toString('base64');

    const urlParts = imageUrl.split('/');
    let filename = urlParts[urlParts.length - 1] || 'product.jpg';
    filename = filename.split('?')[0];
    if (!filename.includes('.')) filename += '.jpg';

    return { base64, filename };
  } catch (err: any) {
    logWarn(`[Bitrix24] Failed to download image: ${err.message}`);
    return null;
  }
}

async function findOrCreateBitrixProduct(item: OrderItem): Promise<number | null> {
  const cacheKey = `${item.productId || ''}_${item.productName}`;
  const cached = productCache.get(cacheKey);
  if (cached) return cached;

  try {
    const searchResult = await callBitrix('crm.product.list', {
      filter: item.sku ? { 'XML_ID': item.sku } : { 'NAME': item.productName },
      select: ['ID', 'NAME'],
    });

    if (searchResult.result && searchResult.result.length > 0) {
      const productId = Number(searchResult.result[0].ID);
      productCache.set(cacheKey, productId);
      return productId;
    }

    const fields: Record<string, any> = {
      NAME: item.productName,
      PRICE: item.price / 100,
      CURRENCY_ID: 'RUB',
      ACTIVE: 'Y',
    };

    if (item.sku) {
      fields.XML_ID = item.sku;
    }

    if (item.imageUrl) {
      const imageData = await downloadImageAsBase64(item.imageUrl);
      if (imageData) {
        fields.PREVIEW_PICTURE = {
          fileData: [imageData.filename, imageData.base64],
        };
      }
    }

    const createResult = await callBitrix('crm.product.add', { fields });

    if (createResult.result) {
      const productId = Number(createResult.result);
      productCache.set(cacheKey, productId);
      console.log(`[Bitrix24] Created product ID=${productId}: ${item.productName}`);
      return productId;
    }

    return null;
  } catch (err: any) {
    logWarn(`[Bitrix24] Error creating product: ${err.message}`);
    return null;
  }
}

async function findOrCreateContact(name: string, email: string, phone: string): Promise<number | null> {
  if (!email && !phone) {
    logWarn('[Bitrix24] No email or phone provided, skipping contact creation');
    return null;
  }

  try {
    if (email) {
      const searchResult = await callBitrix('crm.contact.list', {
        filter: { 'EMAIL': email },
        select: ['ID', 'NAME', 'LAST_NAME'],
      });

      if (searchResult.result && searchResult.result.length > 0) {
        const contactId = Number(searchResult.result[0].ID);
        console.log(`[Bitrix24] Found existing contact ID=${contactId} for ${email}`);
        return contactId;
      }
    }

    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const fields: Record<string, any> = {
      NAME: firstName,
      LAST_NAME: lastName,
    };
    if (email) fields.EMAIL = [{ VALUE: email, VALUE_TYPE: 'WORK' }];
    if (phone) fields.PHONE = [{ VALUE: phone, VALUE_TYPE: 'MOBILE' }];

    const createResult = await callBitrix('crm.contact.add', { fields });

    if (createResult.result) {
      const contactId = Number(createResult.result);
      console.log(`[Bitrix24] Created new contact ID=${contactId} for ${email || phone}`);
      return contactId;
    }

    logError('[Bitrix24] Failed to create contact:', createResult.error_description || createResult.error);
    return null;
  } catch (err: any) {
    logError('[Bitrix24] Error in findOrCreateContact:', err.message);
    return null;
  }
}

function resolveColor(item: OrderItem): string | null {
  const extracted = extractColorFromName(item.productName);
  if (extracted) return extracted;
  if (item.color && item.color !== 'Default' && item.color !== 'default') return item.color;
  return null;
}

function formatOrderItems(items: OrderItem[]): string {
  return items.map((item, i) => {
    let line = `${i + 1}. ${item.productName}`;
    if (item.size) line += ` | Размер: ${item.size}`;
    const color = resolveColor(item);
    if (color) line += ` | Цвет: ${color}`;
    if (item.sku) line += ` | Артикул: ${item.sku}`;
    line += ` | ${item.quantity} шт. x ${(item.price / 100).toFixed(0)} RUB`;
    return line;
  }).join('\n');
}

interface WholesaleRegistration {
  email: string;
  companyName: string;
  inn: string;
  kpp?: string;
  legalAddress: string;
  storeName: string;
  storeAddress: string;
  contactPerson: string;
  contactPhone: string;
}

export async function sendWholesaleRegistrationToBitrix(data: WholesaleRegistration): Promise<{ success: boolean; leadId?: number; error?: string }> {
  if (!BITRIX24_WEBHOOK_URL) {
    logWarn('[Bitrix24] Webhook URL not configured, skipping wholesale registration notification');
    return { success: false, error: 'not_configured' };
  }

  try {
    console.log(`[Bitrix24] Sending wholesale registration for "${data.companyName}" (${data.email})...`);

    const nameParts = data.contactPerson.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const comments = [
      `Название компании: ${data.companyName}`,
      `ИНН: ${data.inn}`,
      data.kpp ? `КПП: ${data.kpp}` : '',
      `Юр. адрес: ${data.legalAddress}`,
      `Магазин: ${data.storeName}`,
      `Адрес магазина: ${data.storeAddress}`,
      `Контактное лицо: ${data.contactPerson}`,
      `Телефон: ${data.contactPhone}`,
    ].filter(Boolean).join('\n');

    const leadFields: Record<string, any> = {
      TITLE: `Заявка на опт: ${data.companyName}`,
      NAME: firstName,
      LAST_NAME: lastName,
      COMPANY_TITLE: data.companyName,
      STATUS_ID: 'NEW',
      SOURCE_ID: 'WEB',
      COMMENTS: comments,
      PHONE: [{ VALUE: data.contactPhone, VALUE_TYPE: 'WORK' }],
      EMAIL: [{ VALUE: data.email, VALUE_TYPE: 'WORK' }],
      ADDRESS: data.legalAddress,
    };

    const result = await callBitrix('crm.lead.add', { fields: leadFields });

    if (result.result) {
      const leadId = Number(result.result);
      console.log(`[Bitrix24] Wholesale registration lead created: ID=${leadId} for "${data.companyName}"`);
      return { success: true, leadId };
    }

    logError('[Bitrix24] Failed to create wholesale lead:', result.error_description || result.error);
    return { success: false, error: result.error_description || result.error || 'unknown' };
  } catch (err: any) {
    logError('[Bitrix24] Error sending wholesale registration:', err.message);
    return { success: false, error: err.message };
  }
}

export async function sendOrderToBitrix(order: OrderForBitrix): Promise<{ success: boolean; dealId?: number; error?: string }> {
  if (!BITRIX24_WEBHOOK_URL) {
    logWarn('[Bitrix24] Webhook URL not configured, skipping order sync');
    return { success: false, error: 'not_configured' };
  }

  try {
    console.log(`[Bitrix24] Sending order #${order.id} to Bitrix24...`);

    const contactId = await findOrCreateContact(
      order.customerName,
      order.customerEmail,
      order.customerPhone
    );

    let companyId: number | null = null;

    if (contactId && order.isWholesale) {
      const contactUpdate: Record<string, any> = {};
      if (order.legalAddress) contactUpdate.ADDRESS = order.legalAddress;
      if (order.contactPerson) {
        const cp = order.contactPerson.trim().split(/\s+/);
        contactUpdate.NAME = cp[0] || '';
        contactUpdate.LAST_NAME = cp.slice(1).join(' ') || '';
      }
      if (order.contactPhone) {
        contactUpdate.PHONE = [{ VALUE: order.contactPhone, VALUE_TYPE: 'WORK' }];
      }
      if (order.companyName) contactUpdate.COMPANY_TITLE = order.companyName;

      const contactComments: string[] = [];
      if (order.inn) contactComments.push(`ИНН: ${order.inn}`);
      if (order.kpp) contactComments.push(`КПП: ${order.kpp}`);
      if (order.storeName) contactComments.push(`Магазин: ${order.storeName}`);
      if (order.storeAddress) contactComments.push(`Адрес магазина: ${order.storeAddress}`);
      if (contactComments.length > 0) {
        contactUpdate.COMMENTS = contactComments.join('\n');
      }

      contactUpdate.TYPE_ID = 'SUPPLIER';

      if (Object.keys(contactUpdate).length > 0) {
        await callBitrix('crm.contact.update', { id: contactId, fields: contactUpdate }).catch((err: any) => {
          logWarn('[Bitrix24] Failed to update contact:', err.message);
        });
        console.log(`[Bitrix24] Contact ID=${contactId} updated with wholesale data`);
      }

      if (order.companyName) {
        const companyFields: Record<string, any> = {
          TITLE: order.companyName,
          COMPANY_TYPE: 'CUSTOMER',
        };

        if (order.inn) {
          let bankingDetails = `ИНН: ${order.inn}`;
          if (order.kpp) bankingDetails += `\nКПП: ${order.kpp}`;
          companyFields.BANKING_DETAILS = bankingDetails;
        }
        if (order.legalAddress) {
          companyFields.ADDRESS = order.legalAddress;
          companyFields.ADDRESS_LEGAL = order.legalAddress;
        }
        if (order.contactPhone) {
          companyFields.PHONE = [{ VALUE: order.contactPhone, VALUE_TYPE: 'WORK' }];
        }
        if (order.customerEmail) {
          companyFields.EMAIL = [{ VALUE: order.customerEmail, VALUE_TYPE: 'WORK' }];
        }

        const companyComments: string[] = [];
        if (order.contactPerson) companyComments.push(`Контактное лицо: ${order.contactPerson}`);
        if (order.storeName) companyComments.push(`Магазин: ${order.storeName}`);
        if (order.storeAddress) companyComments.push(`Адрес магазина: ${order.storeAddress}`);
        if (companyComments.length > 0) {
          companyFields.COMMENTS = companyComments.join('\n');
        }

        const existingCompany = await callBitrix('crm.company.list', {
          filter: { 'TITLE': order.companyName },
          select: ['ID'],
        }).catch(() => ({ result: null }));

        if (existingCompany.result && existingCompany.result.length > 0) {
          companyId = Number(existingCompany.result[0].ID);
          await callBitrix('crm.company.update', { id: companyId, fields: companyFields }).catch((err: any) => {
            logWarn('[Bitrix24] Failed to update company:', err.message);
          });
          console.log(`[Bitrix24] Company ID=${companyId} updated with wholesale data`);
        } else {
          const newCompany = await callBitrix('crm.company.add', { fields: companyFields }).catch(() => ({ result: null }));
          if (newCompany.result) {
            companyId = Number(newCompany.result);
            console.log(`[Bitrix24] Company ID=${companyId} created for "${order.companyName}"`);
          }
        }

        if (companyId && contactId) {
          await callBitrix('crm.contact.update', { id: contactId, fields: { COMPANY_ID: companyId } }).catch(() => {});
        }
      }
    }

    const deliveryInfo = [];
    deliveryInfo.push(`Служба доставки: СДЭК`);
    if (order.cdekPointCode) deliveryInfo.push(`ПВЗ СДЭК: ${order.cdekPointCode}`);
    if (order.address) deliveryInfo.push(`Адрес: ${order.address}`);
    if (order.transportCompany) deliveryInfo.push(`ТК: ${order.transportCompany}`);

    const dd = order.discountDetails;

    const comments = [
      `Заказ #${order.id} с сайта BMGBRAND`,
      order.isWholesale ? '[ОПТОВЫЙ ЗАКАЗ]' : '',
      '',
      '--- Товары ---',
      formatOrderItems(order.items.filter((i: any) => !i._discountDetails)),
      '',
      '--- Стоимость ---',
      dd ? `Подытог: ${(dd.subtotal / 100).toFixed(0)} RUB` : '',
      dd && dd.deliveryCost > 0 ? `Доставка: ${(dd.deliveryCost / 100).toFixed(0)} RUB` : '',
      dd && dd.promoDiscountAmount > 0 ? `Промокод "${dd.promoCode || order.promoCode}": -${(dd.promoDiscountAmount / 100).toFixed(0)} RUB${dd.promoDiscountPercent ? ` (${dd.promoDiscountPercent}%)` : ''}` : (order.promoCode ? `Промокод: ${order.promoCode}` : ''),
      dd && dd.loyaltyDiscountAmount > 0 ? `Скидка лояльности${dd.loyaltyPercent ? ` (${dd.loyaltyPercent}%)` : ''}: -${(dd.loyaltyDiscountAmount / 100).toFixed(0)} RUB` : '',
      dd && dd.giftCardAmount > 0 ? `Подарочная карта "${dd.giftCardCode}": -${(dd.giftCardAmount / 100).toFixed(0)} RUB` : '',
      `Итого к оплате: ${(order.total / 100).toFixed(0)} RUB`,
      '',
      '--- Доставка ---',
      deliveryInfo.join('\n') || 'Не указано',
    ].filter(Boolean).join('\n');

    const dealFields: Record<string, any> = {
      TITLE: `Заказ #${order.id}${order.isWholesale ? ' (опт)' : ''}`,
      STAGE_ID: 'NEW',
      CURRENCY_ID: 'RUB',
      OPPORTUNITY: order.total / 100,
      COMMENTS: comments,
      SOURCE_ID: 'WEB',
    };

    if (contactId) {
      dealFields.CONTACT_ID = contactId;
    }

    if (companyId) {
      dealFields.COMPANY_ID = companyId;
    }

    const dealResult = await callBitrix('crm.deal.add', { fields: dealFields });

    if (!dealResult.result) {
      logError('[Bitrix24] Failed to create deal:', dealResult.error_description || dealResult.error);
      return { success: false, error: dealResult.error_description || dealResult.error || 'unknown' };
    }

    const dealId = Number(dealResult.result);
    console.log(`[Bitrix24] Deal created: ID=${dealId} for order #${order.id}`);

    const productRows = [];
    for (const item of order.items.filter((i: any) => !i._discountDetails)) {
      let productName = item.productName;
      if (item.size) productName += ` (${item.size})`;
      const itemColor = resolveColor(item);
      if (itemColor) productName += ` [${itemColor}]`;

      const row: Record<string, any> = {
        PRODUCT_NAME: productName,
        PRICE: item.price / 100,
        QUANTITY: item.quantity,
      };

      const bitrixProductId = await findOrCreateBitrixProduct(item);
      if (bitrixProductId) {
        row.PRODUCT_ID = bitrixProductId;
      }

      productRows.push(row);
    }

    if (dd && dd.deliveryCost > 0) {
      productRows.push({
        PRODUCT_NAME: order.cdekPointCode ? `Доставка СДЭК (ПВЗ: ${order.cdekPointCode})` : 'Доставка СДЭК',
        PRICE: dd.deliveryCost / 100,
        QUANTITY: 1,
      });
    }

    const totalDiscount = dd ? (dd.promoDiscountAmount + dd.loyaltyDiscountAmount + dd.giftCardAmount) : 0;
    if (totalDiscount > 0) {
      const discountParts: string[] = [];
      if (dd && dd.promoDiscountAmount > 0) discountParts.push(`Промокод: -${(dd.promoDiscountAmount / 100).toFixed(0)}`);
      if (dd && dd.loyaltyDiscountAmount > 0) discountParts.push(`Лояльность: -${(dd.loyaltyDiscountAmount / 100).toFixed(0)}`);
      if (dd && dd.giftCardAmount > 0) discountParts.push(`Подарочная карта: -${(dd.giftCardAmount / 100).toFixed(0)}`);
      productRows.push({
        PRODUCT_NAME: `Скидки (${discountParts.join(', ')})`,
        PRICE: 0,
        QUANTITY: 1,
        DISCOUNT_SUM: totalDiscount / 100,
        DISCOUNT_TYPE_ID: 1,
      });
    }

    const rowsResult = await callBitrix('crm.deal.productrows.set', {
      id: dealId,
      rows: productRows,
    });

    if (rowsResult.error) {
      logWarn(`[Bitrix24] Product rows set warning for deal ${dealId}:`, rowsResult.error_description);
    } else {
      console.log(`[Bitrix24] Product rows added to deal ${dealId}: ${productRows.length} items`);
    }

    return { success: true, dealId };
  } catch (err: any) {
    logError(`[Bitrix24] Error sending order #${order.id}:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function updateDealStage(dealId: number, stageId: string): Promise<boolean> {
  if (!BITRIX24_WEBHOOK_URL || !dealId) return false;

  try {
    const result = await callBitrix('crm.deal.update', {
      id: dealId,
      fields: { STAGE_ID: stageId },
    });
    if (result.result) {
      console.log(`[Bitrix24] Deal ${dealId} stage updated to ${stageId}`);
    }
    return !!result.result;
  } catch (err: any) {
    logError(`[Bitrix24] Error updating deal ${dealId} stage:`, err.message);
    return false;
  }
}

export function orderStatusToBitrixStage(status: string): string {
  return STATUS_TO_STAGE[status] || 'NEW';
}

export async function syncOrderStatusToBitrix(orderId: number, status: string, dealId: number | null): Promise<void> {
  if (!BITRIX24_WEBHOOK_URL || !dealId) return;

  const stage = orderStatusToBitrixStage(status);
  const updated = await updateDealStage(dealId, stage);
  if (updated) {
    console.log(`[Bitrix24] Order #${orderId} status '${status}' -> deal ${dealId} stage '${stage}'`);
  }
}

export function isConfigured(): boolean {
  return !!BITRIX24_WEBHOOK_URL;
}
