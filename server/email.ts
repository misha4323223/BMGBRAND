import { config } from './config';
import { createHmac } from 'crypto';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!config.email.enabled) {
    console.log(`[Email] Sending disabled (SMTP_HOST not set). Would send to ${options.to}:`);
    console.log(`[Email] Subject: ${options.subject}`);
    
    const linkMatch = options.html.match(/href="([^"]*(?:verify-email|reset-password|confirm-signature)[^"]*)"/);
    if (linkMatch) {
      console.log(`[Email] *** ACTION LINK: ${linkMatch[1]} ***`);
      return true;
    }
    return false;
  }

  try {
    const nodemailer = await import('nodemailer');
    
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });

    const info = await transporter.sendMail({
      from: `"${config.app.name}" <${config.email.from}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    console.log(`[Email] Sent to ${options.to}: ${options.subject}`);
    console.log(`[Email] Server response: messageId=${info.messageId}, response=${info.response}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send:', error);
    return false;
  }
}

export function getVerificationEmailHtml(name: string, verificationUrl: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #E53935; }
        .button { display: inline-block; padding: 12px 24px; background: #1C1C1C; color: #fff; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { margin-top: 40px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">BOOOMERANGS</div>
        <h2>Подтверждение email</h2>
        <p>Привет, ${name}!</p>
        <p>Спасибо за регистрацию в BOOOMERANGS. Для завершения регистрации подтвердите ваш email:</p>
        <a href="${verificationUrl}" class="button">Подтвердить email</a>
        <p>Или скопируйте эту ссылку в браузер:</p>
        <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
        <p>Если вы не регистрировались на нашем сайте, просто проигнорируйте это письмо.</p>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// УНЭП «email-link first» (30.04.2026): письмо для подписания партнёрской заявки
// после клика по ссылке. До этого момента partner+signatures ещё НЕ созданы.
export function getPartnerSignatureConfirmEmailHtml(name: string, confirmUrl: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #E53935; }
        .button { display: inline-block; padding: 14px 28px; background: #1C1C1C; color: #fff; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: bold; }
        .warn { background: #FFF8E1; border-left: 4px solid #FFA000; padding: 10px 14px; margin: 14px 0; font-size: 14px; }
        .footer { margin-top: 40px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">BOOOMERANGS</div>
        <h2>Подтверждение подписания партнёрского договора</h2>
        <p>Здравствуйте, ${name}!</p>
        <p>Мы получили вашу заявку на участие в партнёрской программе BMG BRAND. Для завершения регистрации необходимо подтвердить подписание документов (оферта, политика конфиденциальности и сопутствующие согласия).</p>
        <p style="text-align: center;">
          <a href="${confirmUrl}" class="button">Подписать и подтвердить заявку</a>
        </p>
        <p>Или скопируйте ссылку в браузер:</p>
        <p style="word-break: break-all; color: #666; font-size: 13px;">${confirmUrl}</p>
        <div class="warn">
          <strong>Важно (юридически значимо):</strong> переход по этой ссылке является вашей электронной подписью под документами BMG BRAND (УНЭП по 63-ФЗ). Время и IP-адрес клика будут зафиксированы в журнале согласий. Ссылка действует <strong>1 час</strong> и одноразовая.
        </div>
        <p>Если вы не отправляли заявку — просто проигнорируйте это письмо, никаких действий выполнено не будет.</p>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} BOOOMERANGS / BMG BRAND. Все права защищены.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export function getWholesaleRegistrationEmailHtml(name: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #1C1C1C; }
        .footer { margin-top: 40px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">BOOOMERANGS</div>
        <h2>Заявка принята</h2>
        <p>Привет, ${name}!</p>
        <p>Спасибо за регистрацию в BOOOMERANGS! Для завершения регистрации в течение 24 часов с вами свяжутся наши менеджеры и подтвердят ваш аккаунт. Отличного настроения!</p>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function getGiftCardEmailStyle(cardColor?: string | null): { gradient: string; codeColor: string; accentColor: string; chipColor: string } {
  switch (cardColor) {
    case 'red':     return { gradient: 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 60%, #450a0a 100%)', codeColor: '#fca5a5', accentColor: '#fca5a5', chipColor: 'rgba(252,165,165,0.3)' };
    case 'gold':    return { gradient: 'linear-gradient(135deg, #78350f 0%, #d97706 60%, #92400e 100%)', codeColor: '#fde68a', accentColor: '#fde68a', chipColor: 'rgba(253,230,138,0.3)' };
    case 'purple':  return { gradient: 'linear-gradient(135deg, #2e1065 0%, #6d28d9 60%, #1e1b4b 100%)', codeColor: '#c4b5fd', accentColor: '#c4b5fd', chipColor: 'rgba(196,181,253,0.3)' };
    case 'emerald': return { gradient: 'linear-gradient(135deg, #022c22 0%, #065f46 60%, #064e3b 100%)', codeColor: '#6ee7b7', accentColor: '#6ee7b7', chipColor: 'rgba(110,231,183,0.3)' };
    default:        return { gradient: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 60%, #16213e 100%)', codeColor: '#a5b4fc', accentColor: '#E53935', chipColor: 'rgba(165,180,252,0.3)' };
  }
}

function buildGiftCardBlock(code: string, formattedAmount: string, cardColor?: string | null): string {
  const { gradient, codeColor, chipColor } = getGiftCardEmailStyle(cardColor);
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
      <tr>
        <td>
          <div style="background: ${gradient}; border-radius: 16px; padding: 0; color: #fff; overflow: hidden; max-width: 480px;">
            <!-- Top section -->
            <div style="padding: 22px 24px 18px; display: flex; justify-content: space-between; align-items: flex-start;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align: top;">
                    <!-- Chip -->
                    <div style="width: 32px; height: 22px; background: ${chipColor}; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2);"></div>
                  </td>
                  <td style="vertical-align: top; text-align: right;">
                    <div style="font-size: 10px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.5; font-family: 'Courier New', monospace; margin-bottom: 4px;">Номинал</div>
                    <div style="font-size: 22px; font-weight: 900; letter-spacing: -0.5px; color: #ffffff;">${formattedAmount}</div>
                  </td>
                </tr>
              </table>
            </div>
            <!-- Logo area -->
            <div style="padding: 8px 24px; text-align: center;">
              <div style="font-family: Arial Black, sans-serif; font-size: 28px; font-weight: 900; letter-spacing: 4px; opacity: 0.85; text-transform: uppercase;">BOOOMERANGS</div>
            </div>
            <!-- Bottom section -->
            <div style="padding: 18px 24px 22px; border-top: 1px solid rgba(255,255,255,0.08); margin-top: 8px;">
              <div style="font-size: 9px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.4; margin-bottom: 8px; font-family: 'Courier New', monospace;">Подарочный сертификат</div>
              <div style="font-size: 20px; font-weight: 800; letter-spacing: 4px; color: ${codeColor}; font-family: 'Courier New', monospace;">${code}</div>
              <div style="margin-top: 8px; font-size: 9px; opacity: 0.35; font-family: 'Courier New', monospace; letter-spacing: 2px; text-transform: uppercase;">BOOOMERANGS.RU</div>
            </div>
          </div>
        </td>
      </tr>
    </table>
  `;
}

export function getGiftCardPaidEmailHtml(
  name: string, 
  code: string, 
  amount: number,
  recipientName?: string | null,
  recipientEmail?: string | null,
  message?: string | null,
  cardColor?: string | null
): string {
  const formattedAmount = (amount / 100).toLocaleString('ru-RU') + ' ₽';
  const isForSelf = !recipientEmail || recipientEmail === '';
  const { accentColor } = getGiftCardEmailStyle(cardColor);
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background: #f9f9f9; margin: 0; padding: 0; }
        .container { max-width: 560px; margin: 0 auto; padding: 32px 20px; background: #fff; }
        .logo { font-size: 22px; font-weight: 900; color: #1C1C1C; letter-spacing: -0.5px; margin-bottom: 24px; }
        .logo span { color: #E53935; }
        .info { background: #f5f5f5; padding: 16px 18px; border-radius: 10px; margin: 16px 0; font-size: 14px; }
        .footer { margin-top: 40px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }
        a { color: ${accentColor}; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">BOOOMERANGS</div>
        <h2 style="font-size: 20px; font-weight: 800; margin: 0 0 8px;">Подарочная карта оплачена!</h2>
        <p style="color: #555; margin: 0 0 4px;">Привет, <strong>${name}</strong>!</p>
        <p style="color: #555;">Ваша подарочная карта успешно оплачена и активирована.</p>
        
        ${buildGiftCardBlock(code, formattedAmount, cardColor)}
        
        ${isForSelf ? `
          <div class="info">
            <strong>Как использовать:</strong><br>
            Введите код карты при оформлении заказа на сайте <a href="https://www.booomerangs.ru">booomerangs.ru</a>
          </div>
        ` : `
          <div class="info">
            <strong>Получатель:</strong> ${recipientName || 'Не указан'}<br>
            Подарочная карта будет отправлена на: <strong>${recipientEmail}</strong>
            ${message ? `<br><br><em>"${message}"</em>` : ''}
          </div>
        `}
        
        <div class="footer">
          &copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.
        </div>
      </div>
    </body>
    </html>
  `;
}

export function getGiftCardReceivedEmailHtml(
  recipientName: string,
  senderName: string,
  code: string,
  amount: number,
  message?: string | null,
  cardColor?: string | null
): string {
  const formattedAmount = (amount / 100).toLocaleString('ru-RU') + ' ₽';
  const { accentColor } = getGiftCardEmailStyle(cardColor);
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background: #f9f9f9; margin: 0; padding: 0; }
        .container { max-width: 560px; margin: 0 auto; padding: 32px 20px; background: #fff; }
        .logo { font-size: 22px; font-weight: 900; color: #1C1C1C; letter-spacing: -0.5px; margin-bottom: 24px; }
        .logo span { color: #E53935; }
        .message-block { background: #fff8f0; padding: 16px 18px; border-radius: 10px; margin: 16px 0; border-left: 3px solid #E53935; font-style: italic; }
        .info { background: #f5f5f5; padding: 16px 18px; border-radius: 10px; margin: 16px 0; font-size: 14px; }
        .footer { margin-top: 40px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }
        a { color: ${accentColor}; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">BOOOMERANGS</div>
        <h2 style="font-size: 20px; font-weight: 800; margin: 0 0 8px;">Вам подарили подарочную карту! 🎁</h2>
        <p style="color: #555; margin: 0 0 4px;">Привет, <strong>${recipientName}</strong>!</p>
        <p style="color: #555;"><strong>${senderName}</strong> отправил вам подарочную карту BOOOMERANGS.</p>
        
        ${message ? `
          <div class="message-block">
            <p style="margin: 0 0 8px;">"${message}"</p>
            <p style="margin: 0; font-size: 13px; text-align: right; opacity: 0.7;">— ${senderName}</p>
          </div>
        ` : ''}
        
        ${buildGiftCardBlock(code, formattedAmount, cardColor)}
        
        <div class="info">
          <strong>Как использовать:</strong><br>
          Введите код карты при оформлении заказа на сайте <a href="https://www.booomerangs.ru">booomerangs.ru</a>
        </div>
        
        <div class="footer">
          &copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.
        </div>
      </div>
    </body>
    </html>
  `;
}


export function getOrderPaidEmailHtml(order: {
  id: number;
  customerName: string;
  total: number;
  items: any[];
  address?: string;
}): string {
  const fmt = (v: number) => (v / 100).toLocaleString('ru-RU') + ' \u20BD';

  const discountEntry = order.items.find((item: any) => item._discountDetails);
  const dd = discountEntry?._discountDetails || null;
  const productItems = order.items.filter((item: any) => !item._discountDetails);

  const subtotal = dd?.subtotal || productItems.reduce((sum: number, item: any) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
  const deliveryCost = dd?.deliveryCost || 0;
  const promoDiscount = dd?.promoDiscountAmount || 0;
  const promoCode = dd?.promoCode || null;
  const promoPercent = dd?.promoDiscountPercent || null;
  const loyaltyPercent = dd?.loyaltyPercent || 0;
  const loyaltyDiscount = dd?.loyaltyDiscountAmount || 0;
  const giftCardCode = dd?.giftCardCode || null;
  const giftCardAmount = dd?.giftCardAmount || 0;

  const hasDiscounts = promoDiscount > 0 || loyaltyDiscount > 0 || giftCardAmount > 0;

  const itemsHtml = productItems.map((item: any) => `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
        ${item.productName || 'Товар'}
        ${item.size ? ` <span style="color: #666;">(${item.size})</span>` : ''}
        ${item.color && item.color !== 'Default' ? ` <span style="color: #666;">— ${item.color}</span>` : ''}
      </td>
      <td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: center;">${item.quantity || 1}</td>
      <td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; white-space: nowrap;">${fmt((item.price || 0) * (item.quantity || 1))}</td>
    </tr>
  `).join('');

  let breakdownHtml = '';
  
  breakdownHtml += `
    <tr>
      <td style="padding: 6px 0; color: #666;">Товары</td>
      <td style="padding: 6px 0; text-align: right;">${fmt(subtotal)}</td>
    </tr>`;

  if (deliveryCost > 0) {
    breakdownHtml += `
    <tr>
      <td style="padding: 6px 0; color: #666;">Доставка</td>
      <td style="padding: 6px 0; text-align: right;">${fmt(deliveryCost)}</td>
    </tr>`;
  }

  if (promoDiscount > 0) {
    const promoLabel = promoCode 
      ? `Промокод <strong>${promoCode}</strong>${promoPercent ? ` (${promoPercent}%)` : ''}`
      : 'Скидка по промокоду';
    breakdownHtml += `
    <tr>
      <td style="padding: 6px 0; color: #2e7d32;">${promoLabel}</td>
      <td style="padding: 6px 0; text-align: right; color: #2e7d32;">-${fmt(promoDiscount)}</td>
    </tr>`;
  }

  if (loyaltyDiscount > 0) {
    breakdownHtml += `
    <tr>
      <td style="padding: 6px 0; color: #2e7d32;">Скидка постоянного клиента (${loyaltyPercent}%)</td>
      <td style="padding: 6px 0; text-align: right; color: #2e7d32;">-${fmt(loyaltyDiscount)}</td>
    </tr>`;
  }

  if (giftCardAmount > 0) {
    breakdownHtml += `
    <tr>
      <td style="padding: 6px 0; color: #2e7d32;">Подарочная карта${giftCardCode ? ` (${giftCardCode})` : ''}</td>
      <td style="padding: 6px 0; text-align: right; color: #2e7d32;">-${fmt(giftCardAmount)}</td>
    </tr>`;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #1C1C1C; }
        .logo span { color: #E53935; }
        .status { background: #e8f5e9; color: #2e7d32; padding: 12px 20px; border-radius: 8px; text-align: center; font-weight: bold; margin: 20px 0; }
        .order-info { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th { text-align: left; padding: 8px 0; border-bottom: 2px solid #1C1C1C; font-size: 13px; text-transform: uppercase; color: #666; }
        .total-row td { border-top: 2px solid #1C1C1C; padding-top: 12px; font-weight: bold; font-size: 16px; }
        .breakdown { background: #fafafa; border-radius: 8px; padding: 15px; margin: 15px 0; }
        .breakdown table { margin: 0; }
        .breakdown td { font-size: 14px; }
        .savings { background: #e8f5e9; border-radius: 8px; padding: 12px 15px; margin: 15px 0; text-align: center; color: #2e7d32; font-weight: 500; }
        .button { display: inline-block; padding: 12px 24px; background: #1C1C1C; color: #fff; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { margin-top: 40px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">BOOOMERANGS</div>
        
        <div class="status">Оплата подтверждена</div>
        
        <p>Привет, ${order.customerName}!</p>
        <p>Ваш заказ <strong>#${order.id}</strong> успешно оплачен. Мы начинаем его обработку.</p>
        
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th style="text-align: center;">Кол-во</th>
              <th style="text-align: right;">Сумма</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
        
        <div class="breakdown">
          <table>
            <tbody>
              ${breakdownHtml}
              <tr>
                <td style="padding: 10px 0 0; border-top: 2px solid #1C1C1C; font-weight: bold; font-size: 16px;">Итого к оплате</td>
                <td style="padding: 10px 0 0; border-top: 2px solid #1C1C1C; text-align: right; font-weight: bold; font-size: 16px; color: #E53935;">${fmt(order.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        ${hasDiscounts ? `
        <div class="savings">
          Ваша выгода: ${fmt(promoDiscount + loyaltyDiscount + giftCardAmount)}
        </div>
        ` : ''}
        
        ${order.address ? `
        <div class="order-info">
          <p style="margin: 0;"><strong>Адрес доставки:</strong></p>
          <p style="margin: 5px 0 0;">${order.address}</p>
        </div>
        ` : ''}
        
        <p>Вы можете отслеживать статус заказа в <a href="https://www.booomerangs.ru/profile" style="color: #E53935;">личном кабинете</a>.</p>
        
        <p>Если у вас есть вопросы, напишите нам в ответ на это письмо или в Telegram.</p>
        
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</p>
          <p>booomerangs.ru</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export function getOrderShippedEmailHtml(order: {
  id: number;
  customerName: string;
  trackNumber: string;
  pointAddress?: string;
}): string {
  const cdekTrackUrl = `https://www.cdek.ru/ru/tracking?order_id=${order.trackNumber}`;
  const profileUrl = `https://www.booomerangs.ru/profile`;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #1C1C1C; }
        .logo span { color: #E53935; }
        .status { background: #e3f2fd; color: #1565c0; padding: 12px 20px; border-radius: 8px; text-align: center; font-weight: bold; margin: 20px 0; }
        .track-box { background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
        .track-number { font-size: 22px; font-weight: bold; letter-spacing: 2px; color: #1C1C1C; margin: 8px 0; }
        .button { display: inline-block; padding: 12px 24px; background: #1C1C1C; color: #fff !important; text-decoration: none; border-radius: 6px; margin: 10px 5px; font-size: 14px; }
        .button-outline { display: inline-block; padding: 12px 24px; background: #fff; color: #1C1C1C !important; text-decoration: none; border-radius: 6px; margin: 10px 5px; font-size: 14px; border: 2px solid #1C1C1C; }
        .footer { margin-top: 40px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">BOOOMERANGS</div>
        
        <div class="status">📦 Ваш заказ отправлен!</div>
        
        <p>Привет, ${order.customerName}!</p>
        <p>Ваш заказ <strong>#${order.id}</strong> передан в службу доставки СДЭК.</p>
        
        <div class="track-box">
          <p style="margin: 0 0 5px; color: #666; font-size: 13px;">Трек-номер для отслеживания:</p>
          <div class="track-number">${order.trackNumber}</div>
          ${order.pointAddress ? `<p style="margin: 10px 0 0; color: #666; font-size: 13px;">Пункт выдачи: ${order.pointAddress}</p>` : ''}
        </div>
        
        <div style="text-align: center; margin: 25px 0;">
          <a href="${cdekTrackUrl}" class="button">Отследить на СДЭК</a>
          <a href="${profileUrl}" class="button-outline">Личный кабинет</a>
        </div>
        
        <p style="color: #666; font-size: 13px;">Вы также можете отслеживать статус заказа в <a href="${profileUrl}" style="color: #E53935;">личном кабинете</a> на нашем сайте.</p>
        
        <p>Если у вас есть вопросы, напишите нам в ответ на это письмо или в Telegram.</p>
        
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</p>
          <p>booomerangs.ru</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export function getOrderCancelledAdminEmailHtml(order: {
  id: number;
  customerName: string;
  customerEmail: string;
  total: number;
  items: any[];
  status: string;
}): string {
  const fmt = (v: number) => (v / 100).toLocaleString('ru-RU') + ' \u20BD';
  const statusLabels: Record<string, string> = {
    pending: 'Ожидал оплаты',
    paid: 'Был оплачен',
    processing: 'Собирался',
  };
  const prevStatus = statusLabels[order.status] || order.status;

  const productItems = order.items.filter((item: any) => !item._discountDetails);
  const itemsHtml = productItems.map((item: any) => `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
        ${item.productName || 'Товар'}
        ${item.size ? ` <span style="color: #666;">(${item.size})</span>` : ''}
        ${item.color && item.color !== 'Default' ? ` — ${item.color}` : ''}
      </td>
      <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: center;">${item.quantity || 1}</td>
      <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; white-space: nowrap;">${fmt((item.price || 0) * (item.quantity || 1))}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #1C1C1C; }
        .logo span { color: #E53935; }
        .alert { background: #ffebee; color: #c62828; padding: 12px 20px; border-radius: 8px; text-align: center; font-weight: bold; margin: 20px 0; }
        .info { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th { text-align: left; padding: 8px 0; border-bottom: 2px solid #1C1C1C; font-size: 13px; text-transform: uppercase; color: #666; }
        .footer { margin-top: 40px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">BOOOMERANGS</div>
        
        <div class="alert">Заказ #${order.id} отменён покупателем</div>
        
        <div class="info">
          <p style="margin: 0 0 5px;"><strong>Покупатель:</strong> ${order.customerName}</p>
          <p style="margin: 0 0 5px;"><strong>Email:</strong> ${order.customerEmail}</p>
          <p style="margin: 0 0 5px;"><strong>Сумма заказа:</strong> ${fmt(order.total)}</p>
          <p style="margin: 0;"><strong>Статус до отмены:</strong> ${prevStatus}</p>
        </div>
        
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th style="text-align: center;">Кол-во</th>
              <th style="text-align: right;">Сумма</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
        
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} BOOOMERANGS. Автоматическое уведомление.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export function getPreorderPaidEmailHtml(order: {
  id: number;
  customerName: string;
  total: number;
  items: any[];
  deliveryType?: string;
  deliveryAddress?: string;
}): string {
  const fmt = (v: number) => (v / 100).toLocaleString('ru-RU') + ' \u20BD';
  const productItems = order.items.filter((item: any) => !item._discountDetails);

  const itemsHtml = productItems.map((item: any) => `
    <tr>
      <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-size: 14px;">
        <strong>${item.productName || 'Товар'}</strong>
        ${item.size ? `<br><span style="color: #888; font-size: 13px;">Размер: ${item.size}</span>` : ''}
        ${item.color && item.color !== 'Default' ? `<br><span style="color: #888; font-size: 13px;">Цвет: ${item.color}</span>` : ''}
      </td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; text-align: center; font-size: 14px;">${item.quantity || 1}</td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #f0f0f0; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmt((item.price || 0) * (item.quantity || 1))}</td>
    </tr>
  `).join('');

  const isPickup = order.deliveryType === 'pickup';

  const deliveryBlock = order.deliveryAddress ? `
    <div style="background: #fafafa; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;">
      <div style="font-size: 12px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">
        ${isPickup ? '🎪 Место выдачи' : '📦 Пункт выдачи СДЭК'}
      </div>
      <p style="font-size: 14px; color: #333; margin: 0;">${order.deliveryAddress}</p>
    </div>
  ` : '';

  const nextStepText = isPickup
    ? 'Как только он будет готов к выдаче, мы напишем вам.'
    : 'Как только он будет готов, мы передадим его в СДЭК и пришлём вам трек-номер.';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1C1C1C; margin: 0; padding: 0; background-color: #f7f7f7;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">

          <div style="background: linear-gradient(135deg, #1C1C1C 0%, #2d2d2d 100%); padding: 32px 24px; text-align: center;">
            <div style="font-size: 28px; font-weight: 800; letter-spacing: 2px; color: #ffffff;">BOOOMERANGS</div>
          </div>

          <div style="padding: 0 24px;">
            <div style="background: linear-gradient(135deg, #1C1C1C 0%, #333 100%); color: #ffffff; padding: 16px 24px; border-radius: 12px; text-align: center; margin: -20px 0 24px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 2px; opacity: 0.7; margin-bottom: 4px;">PRE-ORDER</div>
              <div style="font-size: 18px; font-weight: 700;">Предзаказ оформлен ✓</div>
            </div>

            <p style="font-size: 15px; color: #333; margin: 0 0 8px 0;">Привет, <strong>${order.customerName}</strong>!</p>
            <p style="font-size: 15px; color: #555; margin: 0 0 24px 0;">Ваш предзаказ <strong style="color: #1C1C1C;">#${order.id}</strong> оплачен и ждёт своего часа.</p>

            <div style="background: #fafafa; border-radius: 12px; padding: 4px 0; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr>
                    <th style="text-align: left; padding: 12px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 600;">Товар</th>
                    <th style="text-align: center; padding: 12px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 600;">Кол-во</th>
                    <th style="text-align: right; padding: 12px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 600;">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
            </div>

            <div style="background: linear-gradient(135deg, #1C1C1C 0%, #333 100%); border-radius: 12px; padding: 20px 24px; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="color: #ccc; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Итого оплачено</td>
                  <td style="text-align: right; color: #ffffff; font-size: 24px; font-weight: 800;">${fmt(order.total)}</td>
                </tr>
              </table>
            </div>

            ${deliveryBlock}

            <div style="border: 2px dashed #ccc; border-radius: 12px; padding: 20px; margin-bottom: 24px; text-align: center;">
              <div style="font-size: 13px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px;">Что дальше?</div>
              <p style="font-size: 14px; color: #555; margin: 0;">${nextStepText}</p>
            </div>

            <div style="text-align: center; margin-bottom: 32px;">
              <a href="https://www.booomerangs.ru/profile" style="display: inline-block; padding: 14px 40px; background: #1C1C1C; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; letter-spacing: 0.5px;">Личный кабинет</a>
            </div>
          </div>

          <div style="padding: 24px; background: #fafafa; border-top: 1px solid #f0f0f0; text-align: center;">
            <p style="margin: 0 0 4px 0; font-size: 12px; color: #999;">&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</p>
            <p style="margin: 0; font-size: 12px;"><a href="https://www.booomerangs.ru" style="color: #E53935; text-decoration: none;">booomerangs.ru</a></p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

export function getPreorderStatusEmailHtml(params: {
  customerName: string;
  productName: string;
  newStatus: string;
  trackNumber?: string;
  pointAddress?: string;
  productUrl?: string;
}): string {
  const { customerName, productName, newStatus, trackNumber, pointAddress, productUrl } = params;
  const statusLabels: Record<string, { label: string; color: string; icon: string; desc: string }> = {
    production: { label: 'Производство', color: '#1565C0', icon: '🏭', desc: 'Ваш предзаказ передан в производство. Мы приступили к изготовлению товара.' },
    shipping:   { label: 'Отправка', color: '#E65100', icon: '📦', desc: 'Отличные новости! Ваш предзаказ укомплектован и готовится к отправке через СДЭК.' },
    shipped:    { label: 'Отправлено', color: '#2E7D32', icon: '🚚', desc: 'Ваш предзаказ отправлен! Посылка уже в пути.' },
    cancelled:  { label: 'Отменён', color: '#C62828', icon: '❌', desc: 'К сожалению, предзаказ был отменён. Свяжитесь с нами если у вас есть вопросы.' },
  };
  const s = statusLabels[newStatus] || { label: newStatus, color: '#333', icon: '🔄', desc: 'Статус вашего предзаказа обновлён.' };
  const firstName = customerName?.split(' ')[0] || customerName || 'Покупатель';
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #1C1C1C; }
        .logo span { color: #E53935; }
        .status-box { background: ${s.color}18; border-left: 4px solid ${s.color}; padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 20px 0; }
        .status-label { font-size: 18px; font-weight: bold; color: ${s.color}; margin-bottom: 6px; }
        .info-box { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .track { background: #1C1C1C; color: #fff; padding: 12px 20px; border-radius: 8px; font-family: monospace; font-size: 18px; letter-spacing: 2px; text-align: center; margin: 15px 0; }
        .btn { display: inline-block; background: #1C1C1C; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 10px; }
        .footer { margin-top: 40px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">BOOOMERANGS</div>
        <h2 style="margin-top:20px;">${s.icon} Обновление по вашему предзаказу</h2>
        <p>Здравствуйте, ${firstName}!</p>
        <p>Статус вашего предзаказа на товар <strong>${productName}</strong> изменился:</p>
        <div class="status-box">
          <div class="status-label">${s.label}</div>
          <div>${s.desc}</div>
        </div>
        ${trackNumber ? `
        <div class="info-box">
          <strong>Трек-номер СДЭК:</strong>
          <div class="track">${trackNumber}</div>
          <p style="text-align:center;margin:0;">
            <a href="https://www.cdek.ru/ru/tracking?order_id=${trackNumber}" class="btn">Отследить посылку</a>
          </p>
        </div>
        ` : ''}
        ${pointAddress ? `
        <div class="info-box">
          <strong>📍 Пункт выдачи СДЭК:</strong><br>
          <span style="color:#555;">${pointAddress}</span>
        </div>
        ` : ''}
        ${productUrl ? `<p><a href="${productUrl}" style="color:#E53935;">Перейти к товару →</a></p>` : ''}
        <div class="footer">
          <p>Это письмо отправлено автоматически. Если у вас есть вопросы — ответьте на это письмо или напишите нам.</p>
          <p>© BOOOMERANGS</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export function getPasswordResetEmailHtml(name: string, resetUrl: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #E53935; }
        .button { display: inline-block; padding: 12px 24px; background: #1C1C1C; color: #fff; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { margin-top: 40px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">BOOOMERANGS</div>
        <h2>Сброс пароля</h2>
        <p>Привет, ${name}!</p>
        <p>Мы получили запрос на сброс пароля для вашего аккаунта. Нажмите кнопку ниже для установки нового пароля:</p>
        <a href="${resetUrl}" class="button">Сбросить пароль</a>
        <p>Или скопируйте эту ссылку в браузер:</p>
        <p style="word-break: break-all; color: #666;">${resetUrl}</p>
        <p>Ссылка действительна 1 час.</p>
        <p>Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export function getStockNotificationEmailHtml(productName: string, size: string, productUrl: string, imageUrl?: string): string {
  const year = new Date().getFullYear();
  const imageBlock = imageUrl ? `
        <div style="text-align: center; margin-bottom: 24px;">
          <a href="${productUrl}" style="text-decoration: none;">
            <img src="${imageUrl}" alt="${productName}" style="max-width: 280px; width: 100%; height: auto; border-radius: 12px; object-fit: cover;" />
          </a>
        </div>` : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin: 0; padding: 0; background-color: #f2f2f2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f2f2f2;">
        <tr>
          <td align="center" style="padding: 32px 16px;">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
              
              <!-- Header -->
              <tr>
                <td style="background-color: #1A1A1A; padding: 28px 32px; text-align: center;">
                  <span style="font-size: 22px; font-weight: 800; letter-spacing: 3px; color: #ffffff;">BOOOMERANGS</span>
                </td>
              </tr>

              <!-- Badge -->
              <tr>
                <td style="padding: 32px 32px 0; text-align: center;">
                  <div style="display: inline-block; background-color: #E8F5E9; color: #2E7D32; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 6px 16px; border-radius: 20px;">
                    Снова в наличии
                  </div>
                </td>
              </tr>

              <!-- Title -->
              <tr>
                <td style="padding: 20px 32px 8px; text-align: center;">
                  <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #1A1A1A; line-height: 1.3;">
                    Отличные новости!
                  </h1>
                </td>
              </tr>

              <!-- Subtitle -->
              <tr>
                <td style="padding: 0 32px 24px; text-align: center;">
                  <p style="margin: 0; font-size: 15px; color: #666; line-height: 1.5;">
                    Товар, на который вы подписались, снова доступен для заказа
                  </p>
                </td>
              </tr>

              <!-- Product Image -->
              <tr>
                <td style="padding: 0 32px;">
                  ${imageBlock}
                </td>
              </tr>

              <!-- Product Info -->
              <tr>
                <td style="padding: 0 32px;">
                  <div style="background-color: #FAFAFA; border-radius: 12px; padding: 20px 24px; text-align: center;">
                    <p style="margin: 0 0 6px; font-size: 17px; font-weight: 700; color: #1A1A1A;">
                      ${productName}
                    </p>
                    <p style="margin: 0; font-size: 14px; color: #888;">
                      Размер: <strong style="color: #1A1A1A;">${size}</strong>
                    </p>
                  </div>
                </td>
              </tr>

              <!-- Warning -->
              <tr>
                <td style="padding: 16px 32px 0; text-align: center;">
                  <p style="margin: 0; font-size: 13px; color: #E53935; font-weight: 600;">
                    Количество ограничено — не упустите!
                  </p>
                </td>
              </tr>

              <!-- CTA Button -->
              <tr>
                <td style="padding: 24px 32px 32px; text-align: center;">
                  <a href="${productUrl}" style="display: inline-block; padding: 14px 40px; background-color: #1A1A1A; color: #ffffff; text-decoration: none; border-radius: 30px; font-size: 15px; font-weight: 700; letter-spacing: 0.5px;">
                    Перейти к товару
                  </a>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color: #FAFAFA; padding: 20px 32px; text-align: center; border-top: 1px solid #eee;">
                  <p style="margin: 0 0 4px; font-size: 11px; color: #999;">
                    Вы получили это письмо, потому что подписались на уведомление о поступлении товара.
                  </p>
                  <p style="margin: 0 0 4px; font-size: 11px; color: #bbb;">
                    &copy; ${year} BOOOMERANGS. Все права защищены.
                  </p>
                  <p style="margin: 0; font-size: 11px;">
                    <a href="https://www.booomerangs.ru/profile" style="color:#bbb;text-decoration:underline;">Управлять уведомлениями</a>
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export async function sendPriceDropEmail(
  email: string,
  productName: string,
  oldPrice: number,
  newPrice: number,
  productUrl: string,
  imageUrl?: string
): Promise<boolean> {
  const oldPriceStr = (oldPrice / 100).toLocaleString('ru-RU');
  const newPriceStr = (newPrice / 100).toLocaleString('ru-RU');
  const discountPercent = Math.round((1 - newPrice / oldPrice) * 100);
  const year = new Date().getFullYear();

  const imageBlock = imageUrl ? `
        <div style="text-align: center; margin-bottom: 24px;">
          <a href="${productUrl}" style="text-decoration: none;">
            <img src="${imageUrl}" alt="${productName}" style="max-width: 280px; width: 100%; height: auto; border-radius: 12px; object-fit: cover;" />
          </a>
        </div>` : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin: 0; padding: 0; background-color: #f2f2f2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f2f2f2;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
          
          <!-- Header -->
          <tr>
            <td style="background-color: #1A1A1A; padding: 28px 32px; text-align: center;">
              <span style="font-size: 22px; font-weight: 800; letter-spacing: 3px; color: #ffffff;">BOOOMERANGS</span>
            </td>
          </tr>

          <!-- Badge -->
          <tr>
            <td style="padding: 32px 32px 0; text-align: center;">
              <div style="display: inline-block; background-color: #FFF3E0; color: #E65100; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 6px 16px; border-radius: 20px;">
                Цена снижена на ${discountPercent}%
              </div>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding: 20px 32px 8px; text-align: center;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #1A1A1A; line-height: 1.3;">
                Цена снизилась!
              </h1>
            </td>
          </tr>

          <!-- Subtitle -->
          <tr>
            <td style="padding: 0 32px 24px; text-align: center;">
              <p style="margin: 0; font-size: 15px; color: #666; line-height: 1.5;">
                Товар, на который вы подписались, стал дешевле
              </p>
            </td>
          </tr>

          <!-- Product Image -->
          <tr>
            <td style="padding: 0 32px;">
              ${imageBlock}
            </td>
          </tr>

          <!-- Product Info -->
          <tr>
            <td style="padding: 0 32px;">
              <div style="background-color: #FAFAFA; border-radius: 12px; padding: 20px 24px; text-align: center;">
                <p style="margin: 0 0 12px; font-size: 17px; font-weight: 700; color: #1A1A1A;">
                  ${productName}
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                  <tr>
                    <td style="padding-right: 16px; text-align: center;">
                      <p style="margin: 0 0 2px; font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 0.5px;">Было</p>
                      <p style="margin: 0; font-size: 18px; color: #999; text-decoration: line-through;">${oldPriceStr} ₽</p>
                    </td>
                    <td style="padding-left: 16px; text-align: center;">
                      <p style="margin: 0 0 2px; font-size: 11px; color: #E53935; text-transform: uppercase; letter-spacing: 0.5px;">Стало</p>
                      <p style="margin: 0; font-size: 22px; font-weight: 800; color: #E53935;">${newPriceStr} ₽</p>
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- Urgency -->
          <tr>
            <td style="padding: 16px 32px 0; text-align: center;">
              <p style="margin: 0; font-size: 13px; color: #E53935; font-weight: 600;">
                Предложение ограничено — успейте купить!
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 24px 32px 32px; text-align: center;">
              <a href="${productUrl}" style="display: inline-block; padding: 14px 40px; background-color: #1A1A1A; color: #ffffff; text-decoration: none; border-radius: 30px; font-size: 15px; font-weight: 700; letter-spacing: 0.5px;">
                Перейти к товару
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #FAFAFA; padding: 20px 32px; text-align: center; border-top: 1px solid #eee;">
              <p style="margin: 0 0 4px; font-size: 11px; color: #999;">
                Вы получили это письмо, потому что подписались на уведомление о снижении цены.
              </p>
              <p style="margin: 0; font-size: 11px; color: #bbb;">
                &copy; ${year} BOOOMERANGS. Все права защищены.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmail({
    to: email,
    subject: `Цена снижена: "${productName}" — теперь ${newPriceStr} ₽`,
    html,
  });
}

export function getPreorderNotificationEmailHtml(productName: string, productImage?: string, productUrl?: string): string {
  const siteUrl = 'https://www.booomerangs.ru';
  const preorderUrl = productUrl ? `${siteUrl}${productUrl}` : `${siteUrl}/predrop`;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 0 auto; background: #fff; }
    .header { background: #1C1C1C; padding: 24px 32px; }
    .logo { font-size: 22px; font-weight: 900; color: #fff; letter-spacing: 2px; text-transform: uppercase; }
    .logo span { color: #E53935; }
    .badge { display: inline-block; background: #E53935; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; padding: 4px 10px; border-radius: 3px; margin-bottom: 16px; }
    .body { padding: 32px; }
    .product-image { width: 100%; max-height: 320px; object-fit: cover; display: block; }
    .product-name { font-size: 20px; font-weight: 800; color: #1C1C1C; margin: 20px 0 8px; text-transform: uppercase; }
    .cta { display: inline-block; margin-top: 24px; padding: 14px 32px; background: #1C1C1C; color: #fff; text-decoration: none; font-weight: 700; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; border-radius: 4px; }
    .footer { padding: 20px 32px; border-top: 1px solid #eee; font-size: 11px; color: #999; }
    .unsubscribe { color: #999; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">BOO<span>O</span>MERANGS</div>
    </div>
    ${productImage ? `<img src="${productImage}" alt="${productName}" class="product-image" />` : ''}
    <div class="body">
      <div class="badge">Новый предзаказ</div>
      <div class="product-name">${productName}</div>
      <p style="color:#555; margin: 0;">Открылся новый предзаказ — успей забронировать раньше всех.<br>Количество мест ограничено.</p>
      <a href="${preorderUrl}" class="cta">Перейти к предзаказу</a>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.<br>
      <a href="${siteUrl}/profile" class="unsubscribe">Отписаться от уведомлений о предзаказах</a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Письмо «Деньги переведены — пришлите подтверждающий документ».
 *
 * documentKind определяет какой документ нужен:
 *   • 'receipt' — чек НПД из «Мой налог» (для самозанятых)
 *   • 'act'     — акт оказанных услуг (для ИП и ЮЛ)
 */
export function getPayoutPaidEmailHtml(
  partnerName: string,
  amountRub: string,
  documentKind: 'receipt' | 'act' = 'receipt',
): string {
  const isReceipt = documentKind === 'receipt';
  const docWord = isReceipt ? 'чек' : 'акт';
  const heading = isReceipt
    ? 'Деньги переведены — загрузите чек'
    : 'Деньги переведены — загрузите акт';
  const intro = isReceipt
    ? 'Чтобы завершить выплату, пожалуйста, загрузите чек из приложения <b>«Мой налог»</b>:'
    : 'Чтобы завершить выплату, пожалуйста, загрузите акт оказанных услуг (или иной закрывающий документ) на сумму выплаты:';
  const stepsHtml = isReceipt
    ? `<li>Откройте приложение «Мой налог»</li>
      <li>Сформируйте чек на сумму <b>${amountRub} ₽</b> (покупатель — ООО «БУМЕРАНГ»)</li>
      <li>Войдите в <a href="https://booomerangs.ru/partner">личный кабинет партнёра</a></li>
      <li>Загрузите чек в раздел «Выплаты»</li>`
    : `<li>Сформируйте акт оказанных услуг на сумму <b>${amountRub} ₽</b> (заказчик — ООО «БУМЕРАНГ»)</li>
      <li>Подпишите его и сохраните в PDF (или сфотографируйте подписанный экземпляр)</li>
      <li>Войдите в <a href="https://booomerangs.ru/partner">личный кабинет партнёра</a></li>
      <li>Загрузите акт в раздел «Выплаты»</li>`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .head{background:#1C1C1C;padding:24px 32px}
  .logo{font-size:22px;font-weight:900;color:#fff;letter-spacing:2px}
  .logo span{color:#E53935}
  .body{padding:32px}
  h2{margin:0 0 16px;font-size:20px}
  .amount{font-size:28px;font-weight:700;color:#1C1C1C;margin:16px 0}
  .steps{background:#f9f9f9;border-radius:6px;padding:20px 24px;margin:24px 0}
  .steps li{margin-bottom:10px}
  .btn{display:inline-block;margin-top:20px;padding:13px 28px;background:#1C1C1C;color:#fff!important;text-decoration:none;border-radius:5px;font-weight:700;font-size:13px;letter-spacing:.5px}
  .foot{padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999}
</style></head>
<body><div class="wrap">
  <div class="head"><div class="logo">BOO<span>O</span>MERANGS</div></div>
  <div class="body">
    <h2>${heading}</h2>
    <p>Привет, ${partnerName}!</p>
    <p>Мы перевели вам выплату:</p>
    <div class="amount">${amountRub} ₽</div>
    <p>${intro}</p>
    <ol class="steps">
      ${stepsHtml}
    </ol>
    <a href="https://booomerangs.ru/partner" class="btn">Открыть личный кабинет</a>
    <p style="font-size:12px;color:#666;margin-top:16px">Если ${docWord} не будет загружен в течение 7 дней, мы напомним вам об этом ещё раз.</p>
  </div>
  <div class="foot">&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</div>
</div></body></html>`;
}

export function getPayoutCompletedEmailHtml(partnerName: string, amountRub: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .head{background:#1C1C1C;padding:24px 32px}
  .logo{font-size:22px;font-weight:900;color:#fff;letter-spacing:2px}
  .logo span{color:#E53935}
  .body{padding:32px}
  h2{margin:0 0 16px;font-size:20px}
  .amount{font-size:28px;font-weight:700;color:#1C1C1C;margin:16px 0}
  .badge{display:inline-block;background:#d1fae5;color:#065f46;border-radius:4px;padding:4px 12px;font-weight:700;font-size:13px;margin-bottom:16px}
  .btn{display:inline-block;margin-top:20px;padding:13px 28px;background:#1C1C1C;color:#fff!important;text-decoration:none;border-radius:5px;font-weight:700;font-size:13px;letter-spacing:.5px}
  .foot{padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999}
</style></head>
<body><div class="wrap">
  <div class="head"><div class="logo">BOO<span>O</span>MERANGS</div></div>
  <div class="body">
    <div class="badge">✓ Выплата завершена</div>
    <h2>Выплата успешно закрыта</h2>
    <p>Привет, ${partnerName}!</p>
    <p>Ваша выплата на сумму:</p>
    <div class="amount">${amountRub} ₽</div>
    <p>успешно завершена. Деньги уже у вас, чек принят — всё оформлено.</p>
    <p>Продолжайте делиться реферальными ссылками, и новые комиссии будут накапливаться в вашем кабинете.</p>
    <a href="https://booomerangs.ru/partner" class="btn">Открыть личный кабинет</a>
  </div>
  <div class="foot">&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</div>
</div></body></html>`;
}

export function getPayoutRejectedEmailHtml(partnerName: string, amountRub: string, reason: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .head{background:#1C1C1C;padding:24px 32px}
  .logo{font-size:22px;font-weight:900;color:#fff;letter-spacing:2px}
  .logo span{color:#E53935}
  .body{padding:32px}
  h2{margin:0 0 16px;font-size:20px}
  .amount{font-size:24px;font-weight:700;color:#1C1C1C;margin:12px 0}
  .reason{background:#fff5f5;border-left:4px solid #E53935;padding:14px 18px;border-radius:0 6px 6px 0;margin:20px 0;color:#7f1d1d}
  .btn{display:inline-block;margin-top:20px;padding:13px 28px;background:#1C1C1C;color:#fff!important;text-decoration:none;border-radius:5px;font-weight:700;font-size:13px;letter-spacing:.5px}
  .foot{padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999}
</style></head>
<body><div class="wrap">
  <div class="head"><div class="logo">BOO<span>O</span>MERANGS</div></div>
  <div class="body">
    <h2>Выплата отклонена</h2>
    <p>Привет, ${partnerName}!</p>
    <p>К сожалению, заявка на выплату</p>
    <div class="amount">${amountRub} ₽</div>
    <p>была отклонена. Причина:</p>
    <div class="reason">${reason}</div>
    <p>Если у вас есть вопросы, напишите нам — разберёмся вместе. Если выплата была отклонена из-за проблемы с документами, вы можете подать новую заявку после исправления.</p>
    <a href="https://booomerangs.ru/partner" class="btn">Открыть личный кабинет</a>
  </div>
  <div class="foot">&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</div>
</div></body></html>`;
}

export function getWholesaleApprovedEmailHtml(name: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .head{background:#1C1C1C;padding:24px 32px}
  .logo{font-size:22px;font-weight:900;color:#fff;letter-spacing:2px}
  .logo span{color:#E53935}
  .body{padding:32px}
  h2{margin:0 0 16px;font-size:20px}
  .badge{display:inline-block;background:#e8f5e9;color:#2e7d32;font-weight:700;padding:8px 18px;border-radius:20px;font-size:14px;margin-bottom:20px}
  .info{background:#f5f5f5;padding:16px 18px;border-radius:6px;margin:20px 0;font-size:14px}
  .btn{display:inline-block;margin-top:20px;padding:13px 28px;background:#1C1C1C;color:#fff!important;text-decoration:none;border-radius:5px;font-weight:700;font-size:13px;letter-spacing:.5px}
  .foot{padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999}
</style></head>
<body><div class="wrap">
  <div class="head"><div class="logo">BOO<span>O</span>MERANGS</div></div>
  <div class="body">
    <div class="badge">✅ Заявка одобрена</div>
    <h2>Добро пожаловать в оптовый клуб BOOOMERANGS!</h2>
    <p>Привет, ${name}!</p>
    <p>Ваша заявка на оптовое сотрудничество рассмотрена и <strong>одобрена</strong>. Теперь вам доступен вход в личный кабинет оптового покупателя.</p>
    <div class="info">
      Войдите на <a href="https://www.booomerangs.ru/wholesale/register?mode=login" style="color:#E53935;">booomerangs.ru</a> в раздел <strong>«Оптовый вход»</strong>, используя email и пароль, указанные при регистрации.
    </div>
    <p>Если у вас появятся вопросы по работе с кабинетом или ассортименту — пишите нам, всегда поможем.</p>
    <a href="https://www.booomerangs.ru/wholesale/register?mode=login" class="btn">Войти в кабинет</a>
  </div>
  <div class="foot">&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</div>
</div></body></html>`;
}

export function getWholesaleRejectedEmailHtml(name: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .head{background:#1C1C1C;padding:24px 32px}
  .logo{font-size:22px;font-weight:900;color:#fff;letter-spacing:2px}
  .logo span{color:#E53935}
  .body{padding:32px}
  h2{margin:0 0 16px;font-size:20px}
  .notice{background:#fff5f5;border-left:4px solid #E53935;padding:14px 18px;border-radius:0 6px 6px 0;margin:20px 0}
  .foot{padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999}
</style></head>
<body><div class="wrap">
  <div class="head"><div class="logo">BOO<span>O</span>MERANGS</div></div>
  <div class="body">
    <h2>Решение по вашей заявке</h2>
    <p>Привет, ${name}!</p>
    <p>К сожалению, после рассмотрения вашей заявки на оптовое сотрудничество мы вынуждены отказать.</p>
    <div class="notice">
      Если вы считаете, что произошла ошибка, или хотите уточнить причину — напишите нам на <a href="mailto:info@booomerangs.ru" style="color:#E53935;">info@booomerangs.ru</a>, мы разберёмся.
    </div>
    <p>Вы также можете воспользоваться нашим розничным магазином на <a href="https://www.booomerangs.ru" style="color:#E53935;">booomerangs.ru</a>.</p>
  </div>
  <div class="foot">&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</div>
</div></body></html>`;
}

export function getPartnerApprovedEmailHtml(contactName: string, partnerSlug: string): string {
  const profileUrl = `https://www.booomerangs.ru/partner`;
  const publicUrl = `https://www.booomerangs.ru/@${partnerSlug}`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .head{background:#1C1C1C;padding:24px 32px}
  .logo{font-size:22px;font-weight:900;color:#fff;letter-spacing:2px}
  .logo span{color:#E53935}
  .body{padding:32px}
  h2{margin:0 0 16px;font-size:20px}
  .badge{display:inline-block;background:#e8f5e9;color:#2e7d32;font-weight:700;padding:8px 18px;border-radius:20px;font-size:14px;margin-bottom:20px}
  .info{background:#f5f5f5;padding:16px 18px;border-radius:6px;margin:20px 0;font-size:14px;line-height:1.8}
  .link{color:#E53935;word-break:break-all}
  .btn{display:inline-block;margin-top:20px;padding:13px 28px;background:#1C1C1C;color:#fff!important;text-decoration:none;border-radius:5px;font-weight:700;font-size:13px;letter-spacing:.5px}
  .foot{padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999}
</style></head>
<body><div class="wrap">
  <div class="head"><div class="logo">BOO<span>O</span>MERANGS</div></div>
  <div class="body">
    <div class="badge">✅ Партнёрский аккаунт активирован</div>
    <h2>Добро пожаловать в партнёрскую программу!</h2>
    <p>Привет, ${contactName}!</p>
    <p>Ваша заявка на участие в партнёрской программе BOOOMERANGS <strong>одобрена</strong>. Ваш личный кабинет партнёра активирован.</p>
    <div class="info">
      <strong>Ваша партнёрская страница:</strong><br>
      <a href="${publicUrl}" class="link">${publicUrl}</a><br><br>
      <strong>Личный кабинет партнёра:</strong><br>
      <a href="${profileUrl}" class="link">${profileUrl}</a>
    </div>
    <p>В личном кабинете вы найдёте реферальные ссылки, QR-код, статистику продаж и управление выплатами.</p>
    <a href="${profileUrl}" class="btn">Открыть личный кабинет</a>
  </div>
  <div class="foot">&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</div>
</div></body></html>`;
}

export function getPartnerRejectedEmailHtml(contactName: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .head{background:#1C1C1C;padding:24px 32px}
  .logo{font-size:22px;font-weight:900;color:#fff;letter-spacing:2px}
  .logo span{color:#E53935}
  .body{padding:32px}
  h2{margin:0 0 16px;font-size:20px}
  .notice{background:#fff5f5;border-left:4px solid #E53935;padding:14px 18px;border-radius:0 6px 6px 0;margin:20px 0}
  .foot{padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999}
</style></head>
<body><div class="wrap">
  <div class="head"><div class="logo">BOO<span>O</span>MERANGS</div></div>
  <div class="body">
    <h2>Решение по вашей партнёрской заявке</h2>
    <p>Привет, ${contactName}!</p>
    <p>Мы рассмотрели вашу заявку на участие в партнёрской программе BOOOMERANGS и, к сожалению, вынуждены отказать.</p>
    <div class="notice">
      Если вы хотите уточнить причину или считаете, что произошла ошибка — напишите нам на <a href="mailto:info@booomerangs.ru" style="color:#E53935;">info@booomerangs.ru</a>. Мы всегда рады помочь разобраться.
    </div>
    <p>Спасибо, что проявили интерес к нашей партнёрской программе.</p>
  </div>
  <div class="foot">&copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.</div>
</div></body></html>`;
}

export async function sendPreorderNotifications(productName: string, subscribers: Array<{ email: string }>, productImage?: string, productUrl?: string): Promise<void> {
  const html = getPreorderNotificationEmailHtml(productName, productImage, productUrl);
  for (const sub of subscribers) {
    try {
      await sendEmail({
        to: sub.email,
        subject: `Новый предзаказ: ${productName} — BOOOMERANGS`,
        html,
      });
    } catch (e) {
      console.error(`[PreorderNotify] Failed to send to ${sub.email}:`, e);
    }
  }
}

export function getPostPurchaseEmailHtml(opts: {
  customerName: string;
  aiText: string;
  recommendations: Array<{ name: string; slug?: string; price: number; imageUrl?: string; thumbnailUrl?: string }>;
  promoCode: string;
  discountPercent: number;
  validityHours: number;
}): string {
  const siteUrl = 'https://www.booomerangs.ru';
  const { customerName, aiText, recommendations, promoCode, discountPercent, validityHours } = opts;
  const firstName = (customerName || '').split(' ')[0] || '';

  const recsHtml = recommendations.map(rec => {
    const img = rec.imageUrl || rec.thumbnailUrl || '';
    const priceRub = Math.round(rec.price / 100).toLocaleString('ru-RU');
    const url = rec.slug ? `${siteUrl}/${rec.slug}` : `${siteUrl}/products`;
    return `
      <td width="33%" style="padding:0 6px;vertical-align:top;text-align:center;">
        <a href="${url}" style="text-decoration:none;color:inherit;display:block;">
          ${img ? `<img src="${img}" width="140" height="140" style="border-radius:8px;object-fit:cover;display:block;margin:0 auto 8px;" />` : ''}
          <div style="font-size:12px;font-weight:700;color:#1C1C1C;margin-bottom:4px;line-height:1.3;">${rec.name}</div>
          <div style="font-size:13px;color:#E53935;font-weight:800;">${priceRub} ₽</div>
        </a>
      </td>`;
  }).join('');

  const defaultText = firstName
    ? `${firstName}, ваш заказ уже в пути. Пока вы ждёте, мы подобрали кое-что, что отлично дополнит вашу покупку.`
    : 'Ваш заказ уже в пути. Пока вы ждёте, мы подобрали кое-что, что отлично дополнит вашу покупку.';
  const bodyText = aiText || defaultText;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:#1C1C1C;padding:24px 32px;">
          <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:2px;text-transform:uppercase;">
            BOO<span style="color:#E53935;">O</span>MERANGS
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 32px 0;">
          <div style="font-size:22px;font-weight:800;color:#1C1C1C;margin-bottom:8px;">
            Спасибо за покупку! &#x1F64C;
          </div>
          <p style="font-size:14px;color:#555;margin:0 0 28px;line-height:1.6;">
            ${bodyText}
          </p>

          ${recommendations.length > 0 ? `
          <div style="font-size:12px;font-weight:700;color:#1C1C1C;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">
            Вам может понравиться
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr>${recsHtml}</tr>
          </table>` : ''}

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr>
              <td style="background:#F8F5F0;border-radius:10px;padding:24px;text-align:center;">
                <div style="font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;">
                  Ваш подарок — скидка ${discountPercent}%
                </div>
                <div style="font-size:26px;font-weight:900;color:#1C1C1C;letter-spacing:4px;background:#fff;border:2px dashed #1C1C1C;border-radius:8px;padding:14px 20px;display:inline-block;margin-bottom:10px;">
                  ${promoCode}
                </div>
                <div style="font-size:12px;color:#999;margin-top:8px;">
                  Действует ${validityHours} часов &middot; Только для вас &middot; Один раз
                </div>
              </td>
            </tr>
          </table>

          <div style="text-align:center;margin:0 0 32px;">
            <a href="${siteUrl}/products?promo=${encodeURIComponent(promoCode)}" style="display:inline-block;padding:14px 40px;background:#E53935;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;border-radius:6px;">
              Использовать скидку
            </a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999;">
          &copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.<br>
          <a href="${siteUrl}" style="color:#999;">booomerangs.ru</a>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function getAbandonedCartEmailHtml(
  userName: string,
  cartItems: Array<{ product: { name: string; imageUrl?: string; thumbnailUrl?: string; price: number }; quantity: number; size: string | null; color: string | null }>,
  totalKopecks: number,
  email: string = ''
): string {
  const siteUrl = 'https://www.booomerangs.ru';
  const cartUrl = `${siteUrl}/cart`;
  const jwtSecret = process.env.JWT_SECRET || 'bmgbrand-jwt-secret-change-in-production';
  const cartUnsubToken = email ? createHmac('sha256', jwtSecret).update(email.toLowerCase()).digest('hex').slice(0, 32) : '';
  const cartUnsubUrl = email ? `${siteUrl}/api/abandoned-cart/unsubscribe?email=${encodeURIComponent(email)}&token=${cartUnsubToken}` : `${siteUrl}/profile`;
  const totalRub = Math.round(totalKopecks / 100).toLocaleString('ru-RU');

  const itemsHtml = cartItems.map(item => {
    const img = item.product.thumbnailUrl || item.product.imageUrl || '';
    const priceRub = Math.round(item.product.price / 100).toLocaleString('ru-RU');
    const meta = [item.size, item.color].filter(Boolean).join(', ');
    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${img ? `<td width="72" style="vertical-align:top;padding-right:14px;">
                <a href="${cartUrl}"><img src="${img}" width="72" height="72" style="border-radius:8px;object-fit:cover;display:block;" /></a>
              </td>` : ''}
              <td style="vertical-align:top;">
                <div style="font-size:14px;font-weight:700;color:#1C1C1C;margin-bottom:4px;">${item.product.name}</div>
                ${meta ? `<div style="font-size:12px;color:#888;margin-bottom:4px;">${meta}</div>` : ''}
                <div style="font-size:13px;color:#555;">
                  ${item.quantity > 1 ? `${item.quantity} × ` : ''}${priceRub} ₽
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:#1C1C1C;padding:24px 32px;">
          <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:2px;text-transform:uppercase;">
            BOO<span style="color:#E53935;">O</span>MERANGS
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 32px 0;">
          <div style="font-size:22px;font-weight:800;color:#1C1C1C;margin-bottom:8px;">
            Вы кое-что забыли 🛒
          </div>
          <p style="font-size:14px;color:#555;margin:0 0 24px;">
            ${userName ? `${userName}, у` : 'У'} вас в корзине остались товары. Не дайте им уйти к кому-то другому — размеры ограничены.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${itemsHtml}
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:2px solid #1C1C1C;padding-top:14px;">
            <tr>
              <td style="font-size:14px;color:#555;font-weight:600;">Итого:</td>
              <td align="right" style="font-size:18px;font-weight:900;color:#1C1C1C;">${totalRub} ₽</td>
            </tr>
          </table>
          <div style="text-align:center;margin:28px 0;">
            <a href="${cartUrl}" style="display:inline-block;padding:14px 40px;background:#1C1C1C;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;border-radius:6px;">
              Завершить покупку
            </a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999;">
          &copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.<br>
          Вы получили это письмо, потому что оставили товары в корзине на <a href="${siteUrl}" style="color:#999;">booomerangs.ru</a><br>
          <a href="${cartUnsubUrl}" style="color:#bbb;text-decoration:underline;">Отписаться от напоминаний о корзине</a>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function getCartPromoEmailHtml({
  userName,
  promoCode,
  discountPercent,
  validityHours,
  topItem,
  customBody,
}: {
  userName: string;
  promoCode: string;
  discountPercent: number;
  validityHours: number;
  topItem: string;
  customBody?: string;
}): string {
  const siteUrl = 'https://www.booomerangs.ru';
  const cartUrl = `${siteUrl}/cart`;
  const validDays = validityHours >= 24 ? `${Math.round(validityHours / 24)} дня` : `${validityHours} часов`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:#1C1C1C;padding:24px 32px;">
          <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:2px;text-transform:uppercase;">
            BOO<span style="color:#E53935;">O</span>MERANGS
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 32px 0;">
          <div style="font-size:22px;font-weight:800;color:#1C1C1C;margin-bottom:8px;">
            Персональная скидка для вас 🎁
          </div>
          <p style="font-size:14px;color:#555;margin:0 0 24px;">
            ${customBody
              ? customBody
              : `${userName ? `${userName}, мы` : 'Мы'} заметили, что вы присматривались к <b>${topItem}</b>. Держите персональный промокод — только для вас.`}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border:2px dashed #1C1C1C;border-radius:10px;margin-bottom:24px;">
            <tr>
              <td style="padding:20px;text-align:center;">
                <div style="font-size:12px;color:#888;margin-bottom:8px;letter-spacing:1px;text-transform:uppercase;">Ваш промокод</div>
                <div style="font-size:28px;font-weight:900;color:#1C1C1C;letter-spacing:4px;">${promoCode}</div>
                <div style="font-size:13px;color:#E53935;font-weight:700;margin-top:8px;">Скидка ${discountPercent}% на весь заказ</div>
                <div style="font-size:11px;color:#999;margin-top:4px;">Действует ${validDays} · Однократное применение</div>
              </td>
            </tr>
          </table>
          <div style="text-align:center;margin:0 0 28px;">
            <a href="${cartUrl}" style="display:inline-block;padding:14px 40px;background:#1C1C1C;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;border-radius:6px;">
              Вернуться в корзину
            </a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999;">
          &copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.<br>
          <a href="${siteUrl}" style="color:#999;">booomerangs.ru</a>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function getNewProductsNewsletterHtml(
  products: any[],
  totalNewCount: number
): (email: string) => string {
  const MAX = 3;
  const siteUrl = 'https://www.booomerangs.ru';
  const displayProducts = products.slice(0, MAX);
  const hasMore = totalNewCount > MAX;

  function formatPrice(product: any): string {
    const price = Number(product.price || 0);
    const discount = Number(product.discountPercent || 0);
    const final = discount > 0 ? Math.round(price * (1 - discount / 100)) : price;
    const formatNum = (n: number) => Math.round(n / 100).toLocaleString('ru-RU');
    if (discount > 0) {
      return `<span style="text-decoration:line-through;color:#aaa;font-size:12px;">${formatNum(price)}&nbsp;&#8381;</span>&nbsp;<span style="color:#E53935;font-weight:700;">${formatNum(final)}&nbsp;&#8381;</span>`;
    }
    return `<span style="font-weight:700;color:#1C1C1C;">${formatNum(final)}&nbsp;&#8381;</span>`;
  }

  function productRow(p: any): string {
    const slug = p.slug || String(p.id);
    const productUrl = `${siteUrl}/product/${slug}`;
    const rawImg = p.thumbnailUrl || p.imageUrl || '';
    const imgSrc = rawImg.startsWith('http') ? rawImg : rawImg ? `${siteUrl}${rawImg}` : '';
    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${imgSrc ? `<td width="72" style="vertical-align:top;padding-right:14px;">
                <a href="${productUrl}"><img src="${imgSrc}" width="72" height="72" style="border-radius:8px;object-fit:cover;display:block;" /></a>
              </td>` : ''}
              <td style="vertical-align:middle;">
                <a href="${productUrl}" style="font-size:14px;font-weight:700;color:#1C1C1C;text-decoration:none;display:block;margin-bottom:4px;line-height:1.3;">${p.name}</a>
                <div style="font-size:13px;color:#555;">${formatPrice(p)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  const count = displayProducts.length;
  const countWord = count === 1 ? 'новый товар' : count < 5 ? 'новых товара' : 'новых товаров';
  const appeared = count === 1 ? 'появился' : 'появилось';
  const bodyText = hasMore
    ? `В магазине появилось ${totalNewCount} новых товаров — вот несколько из них.`
    : `В магазине ${appeared} ${count} ${countWord}.`;

  return (email: string): string => {
    const jwtSecret = process.env.JWT_SECRET || 'bmgbrand-jwt-secret-change-in-production';
    const token = createHmac('sha256', jwtSecret).update(email.toLowerCase()).digest('hex').slice(0, 32);
    const unsubUrl = `${siteUrl}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:#1C1C1C;padding:24px 32px;">
          <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:2px;text-transform:uppercase;">
            BOO<span style="color:#E53935;">O</span>MERANGS
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 32px 0;">
          <div style="font-size:22px;font-weight:800;color:#1C1C1C;margin-bottom:8px;">
            Смотри, что появилось
          </div>
          <p style="font-size:14px;color:#555;margin:0 0 24px;">
            ${bodyText}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${displayProducts.map(productRow).join('')}
          </table>
          <div style="text-align:center;margin:28px 0;">
            <a href="${siteUrl}/products" style="display:inline-block;padding:14px 40px;background:#1C1C1C;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;border-radius:6px;">
              Смотреть весь каталог
            </a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999;">
          &copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.<br>
          Вы получили это письмо, потому что подписались на обновления на <a href="${siteUrl}" style="color:#999;">booomerangs.ru</a><br>
          <a href="${unsubUrl}" style="color:#bbb;text-decoration:underline;">Отписаться</a>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  };
}

export function getPreorderNewsletterHtml(
  products: any[],
  totalNewCount: number
): (email: string) => string {
  const MAX = 3;
  const siteUrl = 'https://www.booomerangs.ru';
  const displayProducts = products.slice(0, MAX);
  const hasMore = totalNewCount > MAX;

  function formatPrice(product: any): string {
    const price = Number(product.price || 0);
    const discount = Number(product.discountPercent || 0);
    const final = discount > 0 ? Math.round(price * (1 - discount / 100)) : price;
    const formatNum = (n: number) => Math.round(n / 100).toLocaleString('ru-RU');
    if (discount > 0) {
      return `<span style="text-decoration:line-through;color:#aaa;font-size:12px;">${formatNum(price)}&nbsp;&#8381;</span>&nbsp;<span style="color:#E53935;font-weight:700;">${formatNum(final)}&nbsp;&#8381;</span>`;
    }
    return `<span style="font-weight:700;color:#1C1C1C;">${formatNum(final)}&nbsp;&#8381;</span>`;
  }

  function productRow(p: any): string {
    const slug = p.slug || String(p.id);
    const productUrl = `${siteUrl}/products/${slug}`;
    const rawImg = p.thumbnailUrl || p.imageUrl || '';
    const imgSrc = rawImg.startsWith('http') ? rawImg : rawImg ? `${siteUrl}${rawImg}` : '';
    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${imgSrc ? `<td width="72" style="vertical-align:top;padding-right:14px;">
                <a href="${productUrl}"><img src="${imgSrc}" width="72" height="72" style="border-radius:8px;object-fit:cover;display:block;" /></a>
              </td>` : ''}
              <td style="vertical-align:middle;">
                <a href="${productUrl}" style="font-size:14px;font-weight:700;color:#1C1C1C;text-decoration:none;display:block;margin-bottom:4px;line-height:1.3;">${p.name}</a>
                <div style="font-size:13px;color:#555;margin-bottom:4px;">${formatPrice(p)}</div>
                <span style="display:inline-block;background:#E53935;color:#fff;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:3px 8px;border-radius:3px;">Предзаказ</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  const count = displayProducts.length;
  const countWord = count === 1 ? 'предзаказ' : count < 5 ? 'предзаказа' : 'предзаказов';
  const opened = count === 1 ? 'открылся' : 'открылось';
  const bodyText = hasMore
    ? `Открылось ${totalNewCount} новых предзаказов — вот несколько из них.`
    : `В магазине ${opened} ${count} новых ${countWord}. Количество мест ограничено — успей забронировать раньше всех.`;

  return (email: string): string => {
    const jwtSecret = process.env.JWT_SECRET || 'bmgbrand-jwt-secret-change-in-production';
    const token = createHmac('sha256', jwtSecret).update(email.toLowerCase()).digest('hex').slice(0, 32);
    const unsubUrl = `${siteUrl}/api/preorder/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:#1C1C1C;padding:24px 32px;">
          <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:2px;text-transform:uppercase;">
            BOO<span style="color:#E53935;">O</span>MERANGS
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 32px 0;">
          <div style="display:inline-block;background:#E53935;color:#fff;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:4px 10px;border-radius:3px;margin-bottom:16px;">Новый предзаказ</div>
          <div style="font-size:22px;font-weight:800;color:#1C1C1C;margin-bottom:8px;">
            Успей забронировать
          </div>
          <p style="font-size:14px;color:#555;margin:0 0 24px;">
            ${bodyText}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${displayProducts.map(productRow).join('')}
          </table>
          <div style="text-align:center;margin:28px 0;">
            <a href="${siteUrl}/predrop" style="display:inline-block;padding:14px 40px;background:#1C1C1C;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;border-radius:6px;">
              Смотреть все предзаказы
            </a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999;">
          &copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.<br>
          Вы получили это письмо, потому что подписались на уведомления о предзаказах на <a href="${siteUrl}" style="color:#999;">booomerangs.ru</a><br>
          <a href="${unsubUrl}" style="color:#bbb;text-decoration:underline;">Отписаться</a>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  };
}
