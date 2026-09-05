import * as XLSX from "xlsx";
import { transportCompanyName } from "@shared/transport-companies";

export function isPickupOrder(order: any): boolean {
  if (String(order.address || "").startsWith("Самовывоз")) return true;
  if (!order.cdekData) return false;
  try {
    const d = typeof order.cdekData === "string" ? JSON.parse(order.cdekData) : order.cdekData;
    return d?.deliveryService === "pickup";
  } catch {
    return false;
  }
}

export function paymentMethodLabel(method?: string): string {
  if (!method) return '';
  const map: Record<string, string> = {
    yookassa: 'ЮKassa',
    tbank: 'Т-Банк',
    ozon: 'Ozon Доставка',
    cash: 'Наличные',
    transfer: 'Перевод',
    invoice: 'Счёт',
    yandex: 'Яндекс (Кнопка «Купить»)',
  };
  return map[method] || method;
}

export function downloadOrderExcel(order: any) {
  const statusMap: Record<string, string> = {
    pending: 'Ожидает оплаты',
    paid: 'Оплачен',
    shipped: 'Отправлен',
    ready_for_pickup: 'Готов к выдаче',
    delivered: 'Доставлен',
    cancelled: 'Отменён',
  };

  // Разбираем cdekData для доставки
  let deliveryService = '';
  let deliveryType = '';
  let deliveryPoint = '';
  let deliveryAddress = '';
  let trackingNumber = '';
  let cdekDeliveryCost = 0;
  if (order.cdekData) {
    try {
      const d = typeof order.cdekData === 'string' ? JSON.parse(order.cdekData) : order.cdekData;
      deliveryService = d.deliveryService === 'yandex' ? 'Яндекс Доставка' : d.deliveryService === 'cdek' ? 'СДЭК' : d.deliveryService === 'ozon' ? 'Ozon Доставка' : d.deliveryService || '';
      deliveryType = d.deliveryType === 'door' ? 'Курьер до двери' : d.deliveryType === 'pickup' ? 'ПВЗ' : d.deliveryType || '';
      deliveryPoint = d.ydPointName || d.pointCode || '';
      if (d.doorAddress) {
        deliveryAddress = [d.doorAddress.street, d.doorAddress.house, d.doorAddress.flat && `кв. ${d.doorAddress.flat}`, d.doorAddress.entrance && `подъезд ${d.doorAddress.entrance}`, d.doorAddress.floor && `эт. ${d.doorAddress.floor}`].filter(Boolean).join(', ');
      }
      trackingNumber = d.cdekTrackingNumber || d.trackingNumber || '';
      cdekDeliveryCost = Number(d.deliveryCost) || 0;
    } catch { /* ignore */ }
  }

  // Разбираем состав заказа и скидки
  const allOrderItems: any[] = Array.isArray(order.items) ? order.items : [];
  const visibleOrderItems = allOrderItems.filter((i: any) => !i._discountDetails);
  const discountEntry = allOrderItems.find((i: any) => i._discountDetails);
  const totalDiscount = (Number(discountEntry?._discountDetails?.promoDiscountAmount) || 0)
    + (Number(discountEntry?._discountDetails?.loyaltyDiscountAmount) || 0);
  const effectivePromoCode = discountEntry?._discountDetails?.promoCode || (order as any).promoCode || '';
  const effectiveDeliveryCost = cdekDeliveryCost || (order as any).deliveryCost || 0;

  // Лист 1 — основная информация о заказе + товары
  const infoData: (string | number)[][] = [
    ['Заказ №', String(order.id)],
    ['Дата', order.createdAt ? new Date(order.createdAt).toLocaleString('ru-RU') : ''],
    ['Статус', statusMap[order.status] || order.status],
    ['', ''],
    ['ПОКУПАТЕЛЬ', ''],
    ['Имя', order.customerName || ''],
    ['Email', order.customerEmail || ''],
    ['Телефон', order.customerPhone || ''],
    ['Адрес', order.address || ''],
    ['', ''],
    ['ДОСТАВКА', ''],
    ['Служба доставки', deliveryService],
    ['Тип доставки', deliveryType],
    ['ПВЗ / точка выдачи', deliveryPoint],
    ['Адрес курьера', deliveryAddress],
    ['Трек-номер', trackingNumber],
    ['ТК (опт)', transportCompanyName(order.transportCompany)],
    ['', ''],
    ['ОПЛАТА', ''],
    ['Способ оплаты', paymentMethodLabel((order as any).paymentMethod) || ''],
    ['', ''],
    ['ИТОГ', ''],
    ['Сумма заказа', Number((order.total / 100).toFixed(2))],
    ['Скидка', totalDiscount > 0 ? Number((totalDiscount / 100).toFixed(2)) : 0],
    ['Промокод', effectivePromoCode],
    ['Стоимость доставки', effectiveDeliveryCost > 0 ? Number((effectiveDeliveryCost / 100).toFixed(2)) : 0],
    ['', ''],
    ['КОММЕНТАРИЙ', ''],
    ['Комментарий', (order as any).comment || ''],
    ['', ''],
    ['ТОВАРЫ', ''],
    ['Артикул/ID', 'Название', 'Размер', 'Цвет', 'Кол-во', 'Цена, ₽', 'Сумма, ₽'],
    ...visibleOrderItems.map((item: any) => {
      const p = item.price != null ? Number((item.price / 100).toFixed(2)) : 0;
      const qty = item.quantity ?? 1;
      return [
        String(item.sku || item.productId || ''),
        item.name || item.productName || '',
        item.size || '',
        item.color || '',
        qty,
        p,
        Number((p * qty).toFixed(2)),
      ] as (string | number)[];
    }),
  ];

  const wsInfo = XLSX.utils.aoa_to_sheet(infoData);
  wsInfo['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 12 }];

  // Лист 2 — товары (детальная разбивка)
  const itemRows: (string | number)[][] = [['Артикул / ID', 'Название', 'Размер', 'Цвет', 'Кол-во', 'Цена за шт., ₽', 'Сумма, ₽']];
  for (const item of visibleOrderItems) {
    const price = item.price != null ? Number((item.price / 100).toFixed(2)) : '';
    const qty = item.quantity ?? 1;
    const total = price !== '' ? Number((price * qty).toFixed(2)) : '';
    itemRows.push([
      item.sku || item.productId || '',
      item.name || item.productName || '',
      item.size || '',
      item.color || '',
      qty,
      price,
      total,
    ]);
  }
  // Итоговая строка
  if (visibleOrderItems.length > 0) {
    const grandTotal = visibleOrderItems.reduce((sum: number, item: any) => {
      const p = item.price != null ? item.price / 100 : 0;
      return sum + p * (item.quantity ?? 1);
    }, 0);
    itemRows.push(['', '', '', '', '', 'ИТОГО:', Number(grandTotal.toFixed(2))]);
  }

  const wsItems = XLSX.utils.aoa_to_sheet(itemRows);
  wsItems['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 16 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Заказ');
  XLSX.utils.book_append_sheet(wb, wsItems, 'Товары');

  XLSX.writeFile(wb, `order_${order.id}.xlsx`);
}

