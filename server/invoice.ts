import PDFDocument from 'pdfkit';
import { logError } from "./logger";
import { sendEmail } from './email';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { transportCompanyName } from '../shared/transport-companies';

interface InvoiceItem {
  name: string;
  sku: string;
  quantity: number;
  price: number; // in kopeks
}

interface InvoiceData {
  invoiceNumber: number;
  date: Date;
  customerName: string;
  customerInn?: string;
  customerPhone: string;
  customerEmail: string;
  items: InvoiceItem[];
  transportCompany?: string;
  vatRate?: number;
  vatMode?: 'included' | 'on_top';
  promoCode?: string;
  promoDiscount?: number;
  subjectOverride?: string;
  noteText?: string;
  depositPercent?: number;
}

// Company details from the example
const COMPANY = {
  name: 'ИП Соболев Д. А.',
  inn: '711614027971',
  address: '301650, Тульская обл, Городской округ город Новомосковск, Новомосковск г, Трудовые Резервы ул, дом 33Б',
  phone: '89606000047',
  bank: 'ФИЛИАЛ "ЦЕНТРАЛЬНЫЙ" БАНКА ВТБ (ПАО) г. Москва',
  bik: '044525411',
  corrAccount: '30101810145250000411',
  account: '40802810411730000043',
};

// A4: 595.28 x 841.89 pt. With margin=40, usable bottom = ~795
const PAGE_MARGIN = 40;
const PAGE_BOTTOM = 795;
const PAGE_WIDTH = 515; // 595.28 - 2*40

function numberToWordsRu(num: number): string {
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять',
    'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
    'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

  if (num === 0) return 'ноль';

  let result = '';

  const th = Math.floor(num / 1000);
  if (th > 0) {
    if (th === 1) result += 'одна тысяча ';
    else if (th === 2) result += 'две тысячи ';
    else if (th >= 3 && th <= 4) result += ones[th] + ' тысячи ';
    else if (th >= 5 && th <= 20) result += ones[th] + ' тысяч ';
    else {
      const thTens = Math.floor(th / 10);
      const thOnes = th % 10;
      if (thTens > 0) result += tens[thTens] + ' ';
      if (thOnes === 1) result += 'одна тысяча ';
      else if (thOnes === 2) result += 'две тысячи ';
      else if (thOnes >= 3 && thOnes <= 4) result += ones[thOnes] + ' тысячи ';
      else result += (thOnes > 0 ? ones[thOnes] + ' ' : '') + 'тысяч ';
    }
  }

  const h = Math.floor((num % 1000) / 100);
  if (h > 0) result += hundreds[h] + ' ';

  const remainder = num % 100;
  if (remainder >= 20) {
    result += tens[Math.floor(remainder / 10)] + ' ';
    if (remainder % 10 > 0) result += ones[remainder % 10] + ' ';
  } else if (remainder > 0) {
    result += ones[remainder] + ' ';
  }

  return result.trim();
}

function formatDate(date: Date): string {
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} г.`;
}

function formatMoney(kopeks: number): string {
  return (kopeks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  // Pre-calculate payable total for QR (mirrors the PDF summary block logic)
  const _totalSum = data.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const _promoDiscount = data.promoDiscount ?? 0;
  const _afterDiscount = _totalSum - _promoDiscount;
  const _vatRate = data.vatRate ?? 5;
  const _vatMode = data.vatMode ?? 'included';
  const _grandTotal = _vatMode === 'on_top'
    ? _afterDiscount + Math.round(_afterDiscount * _vatRate / 100)
    : _afterDiscount;
  const _payableTotal = (data.depositPercent && data.depositPercent > 0)
    ? Math.round(_grandTotal * data.depositPercent / 100)
    : _grandTotal;

  // Build QR payload per ГОСТ Р 56042-2014 (Russian bank transfer)
  const qrPayload = [
    'ST00012',
    `Name=${COMPANY.name}`,
    `PersonalAcc=${COMPANY.account}`,
    `BankName=${COMPANY.bank}`,
    `BIC=${COMPANY.bik}`,
    `CorrespAcc=${COMPANY.corrAccount}`,
    `PayeeINN=${COMPANY.inn}`,
    `Sum=${_payableTotal}`,
    `Purpose=Оплата по счёту №${data.invoiceNumber}`,
  ].join('|');

  let qrImageBuffer: Buffer | null = null;
  try {
    qrImageBuffer = await QRCode.toBuffer(qrPayload, { type: 'png', width: 110, margin: 1 });
  } catch (e) {
    logError('[Invoice] QR generation failed:', e);
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, autoFirstPage: true });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fontDir = path.join(process.cwd(), 'server', 'fonts');
    doc.registerFont('Roboto', path.join(fontDir, 'Roboto-Regular.ttf'));
    doc.registerFont('Roboto-Bold', path.join(fontDir, 'Roboto-Bold.ttf'));
    doc.font('Roboto');

    const colWidths = [30, 200, 60, 50, 50, 60, 65];
    const colX = [40, 70, 270, 330, 380, 430, 490];

    // ── Helper: draw table header row ──────────────────────────────────────
    function drawTableHeader(y: number): number {
      doc.font('Roboto-Bold').fontSize(8);
      doc.rect(40, y, PAGE_WIDTH, 20).stroke();
      doc.text('№',              colX[0] + 5, y + 6);
      doc.text('Товар (Услуга)', colX[1] + 5, y + 6);
      doc.text('Код',            colX[2] + 5, y + 6);
      doc.text('Кол-во',         colX[3] + 5, y + 6);
      doc.text('Ед.',            colX[4] + 5, y + 6);
      doc.text('Цена',           colX[5] + 5, y + 6);
      doc.text('Сумма',          colX[6] + 5, y + 6);
      doc.font('Roboto').fontSize(8);
      return y + 20;
    }

    // ── Helper: new page + table header ───────────────────────────────────
    function newPageWithHeader(): number {
      doc.addPage();
      return drawTableHeader(PAGE_MARGIN);
    }

    // ── Page 1 header block ────────────────────────────────────────────────
    doc.fontSize(8);
    doc.text(COMPANY.bank, 40, 40, { width: 300 });
    doc.text(`БИК  ${COMPANY.bik}`, 400, 40);
    doc.text(`Сч. № ${COMPANY.corrAccount}`, 400, 52);

    doc.text('Банк получателя', 40, 65);
    doc.text(`ИНН ${COMPANY.inn}     КПП`, 40, 80);
    doc.text(`Сч. № ${COMPANY.account}`, 400, 80);
    doc.text(COMPANY.name, 40, 95);
    doc.text('Получатель', 40, 110);

    doc.moveTo(40, 130).lineTo(555, 130).stroke();

    doc.fontSize(14).font('Roboto-Bold');
    doc.text(`Счет на оплату № ${data.invoiceNumber} от ${formatDate(data.date)}`, 40, 145, { align: 'center' });

    doc.fontSize(9).font('Roboto');
    doc.text(`Поставщик (исполнитель): ${COMPANY.name}, ИНН ${COMPANY.inn}, ${COMPANY.address}, тел.: ${COMPANY.phone}`, 40, 175, { width: PAGE_WIDTH });
    doc.text(`Покупатель (заказчик): ${data.customerName}${data.customerInn ? `, ИНН ${data.customerInn}` : ''}, тел.: ${data.customerPhone}`, 40, 200, { width: PAGE_WIDTH });
    doc.text('Основание: Основной договор', 40, 225);

    // ── Table ──────────────────────────────────────────────────────────────
    let y = drawTableHeader(250);

    let totalQty = 0;
    let totalSum = 0;

    data.items.forEach((item, idx) => {
      const itemSum = item.price * item.quantity;
      totalQty += item.quantity;
      totalSum += itemSum;

      doc.font('Roboto').fontSize(8);
      const nameTextHeight = doc.heightOfString(item.name, { width: 193 });
      const rowHeight = Math.max(20, nameTextHeight + 10);

      // Page break before this row if it won't fit
      if (y + rowHeight > PAGE_BOTTOM) {
        y = newPageWithHeader();
      }

      doc.rect(40, y, PAGE_WIDTH, rowHeight).stroke();
      const midY = y + Math.max(6, (rowHeight - 8) / 2);
      doc.text(String(idx + 1),        colX[0] + 5, midY);
      doc.text(item.name,              colX[1] + 5, y + 5, { width: 193 });
      doc.text(item.sku,               colX[2] + 5, midY);
      doc.text(String(item.quantity),  colX[3] + 5, midY);
      doc.text('Штука',                colX[4] + 5, midY);
      doc.text(formatMoney(item.price),colX[5] + 5, midY);
      doc.text(formatMoney(itemSum),   colX[6] + 5, midY);

      y += rowHeight;
    });

    // Totals row — page break if needed
    if (y + 20 > PAGE_BOTTOM) {
      y = newPageWithHeader();
    }
    doc.font('Roboto-Bold').fontSize(8);
    doc.rect(40, y, PAGE_WIDTH, 20).stroke();
    doc.text(String(totalQty),        colX[3] + 5, y + 6);
    doc.text(formatMoney(totalSum),   colX[6] + 5, y + 6);
    y += 25;

    // ── Summary block ──────────────────────────────────────────────────────
    // Estimate how much space the summary needs (~120 pt), add page if needed
    if (y + 120 > PAGE_BOTTOM) {
      doc.addPage();
      y = PAGE_MARGIN;
    }

    doc.fontSize(9);
    const vatPercent = data.vatRate ?? 5;
    const vatMode = data.vatMode ?? 'included';
    const promoDiscount = data.promoDiscount ?? 0;

    let afterDiscount = totalSum;
    if (promoDiscount > 0 && data.promoCode) {
      doc.font('Roboto');
      doc.text(`Итого по товарам: ${formatMoney(totalSum)}`, 400, y, { align: 'right', width: 155 });
      y += 15;
      doc.text(`Скидка по промокоду "${data.promoCode}": -${formatMoney(promoDiscount)}`, 300, y, { align: 'right', width: 255 });
      y += 15;
      afterDiscount = totalSum - promoDiscount;
    }

    let vatAmount: number;
    let grandTotal: number;

    if (vatMode === 'on_top') {
      vatAmount = Math.round(afterDiscount * vatPercent / 100);
      grandTotal = afterDiscount + vatAmount;
      doc.font('Roboto');
      doc.text(`Итого без НДС: ${formatMoney(afterDiscount)}`, 400, y, { align: 'right', width: 155 });
      y += 15;
      doc.text(`НДС (${vatPercent}%): ${formatMoney(vatAmount)}`, 400, y, { align: 'right', width: 155 });
      y += 15;
    } else {
      vatAmount = Math.round(afterDiscount * vatPercent / (100 + vatPercent));
      grandTotal = afterDiscount;
      doc.font('Roboto');
      doc.text(`Итого: ${formatMoney(afterDiscount)}`, 400, y, { align: 'right', width: 155 });
      y += 15;
      doc.text(`В том числе НДС (${vatPercent}%): ${formatMoney(vatAmount)}`, 400, y, { align: 'right', width: 155 });
      y += 15;
    }

    let payableTotal = grandTotal;
    if (data.depositPercent && data.depositPercent > 0) {
      const depositAmount = Math.round(grandTotal * data.depositPercent / 100);
      doc.font('Roboto');
      doc.text(`Итого (полная стоимость): ${formatMoney(grandTotal)}`, 300, y, { align: 'right', width: 255 });
      y += 15;
      doc.text(`Предоплата ${data.depositPercent}%: ${formatMoney(depositAmount)}`, 300, y, { align: 'right', width: 255 });
      y += 15;
      payableTotal = depositAmount;
    }

    doc.font('Roboto-Bold');
    doc.text(`Всего к оплате: ${formatMoney(payableTotal)}`, 400, y, { align: 'right', width: 155 });
    y += 25;

    // ── Sum in words ───────────────────────────────────────────────────────
    const rubles = Math.floor(payableTotal / 100);
    const kopeksAmt = payableTotal % 100;
    const rublesWord = rubles === 1 ? 'рубль' : (rubles >= 2 && rubles <= 4) ? 'рубля' : 'рублей';
    const kopeksWord = kopeksAmt === 1 ? 'копейка' : (kopeksAmt >= 2 && kopeksAmt <= 4) ? 'копейки' : 'копеек';

    doc.font('Roboto').fontSize(9);
    doc.text(`Всего наименований ${data.items.length}, на сумму ${formatMoney(payableTotal)} руб.`, 40, y);
    y += 12;

    const sumWords = numberToWordsRu(rubles);
    const capitalizedSum = sumWords.charAt(0).toUpperCase() + sumWords.slice(1);
    doc.text(`${capitalizedSum} ${rublesWord} ${String(kopeksAmt).padStart(2, '0')} ${kopeksWord}`, 40, y);
    y += 25;

    // ── QR code for payment ────────────────────────────────────────────────
    if (qrImageBuffer) {
      if (y + 110 > PAGE_BOTTOM) { doc.addPage(); y = PAGE_MARGIN; }
      doc.font('Roboto-Bold').fontSize(8).text('Оплата по QR-коду:', 40, y);
      y += 12;
      doc.image(qrImageBuffer, 40, y, { width: 90, height: 90 });
      doc.font('Roboto').fontSize(7)
        .text('Отсканируйте QR-код приложением\nвашего банка для оплаты\nпо реквизитам счёта', 138, y + 20, { width: 160 });
      y += 100;
    }

    // ── Terms ──────────────────────────────────────────────────────────────
    const terms = [
      'Оплата данного счета означает согласие Покупателя с условиями поставки товара:',
      '1. Покупатель обязуется оплатить и принять товары, указанные в настоящем счете.',
      '2. Покупатель проинформирован о виде, количестве, ассортименте, комплектности, характеристиках товара.',
      '3. Покупатель обязуется оплатить товары в течение 3 рабочих дней.',
      `4. Доставка товаров Покупателю осуществляется силами Транспортной компании${data.transportCompany ? ` (${transportCompanyName(data.transportCompany)})` : ''}. Поставщик осуществляет доставку до ТК за свой счет в течение 5 рабочих дней со дня оплаты.`,
      '5. При получении товара Покупатель обязан осмотреть товар, проверить его количество, качество и ассортимент. В случае отсутствия претензий к количеству, качеству или ассортименту товара уполномоченный представитель Покупателя подписывает товарную накладную. В случае наличия претензий к количеству, качеству или ассортименту товара, уполномоченные представители Поставщика и Покупателя подписывают акт об обнаружении недостатков товара в течении 5 (Пяти) календарных дней с даты получения товара.',
      'Положения ст. 317.1 ГК РФ к поставке товаров, указанных в настоящем счете, не применяются.',
    ];

    doc.fontSize(8);
    terms.forEach(term => {
      const textHeight = doc.heightOfString(term, { width: PAGE_WIDTH });
      // Page break if this term won't fit
      if (y + textHeight + 4 > PAGE_BOTTOM) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
      doc.text(term, 40, y, { width: PAGE_WIDTH });
      y += textHeight + 4;
    });

    y += 10;

    // ── Signature ──────────────────────────────────────────────────────────
    // Signature block needs ~45 pt; add page if needed
    if (y + 45 > PAGE_BOTTOM) {
      doc.addPage();
      y = PAGE_MARGIN;
    }

    doc.fontSize(10);
    doc.text('Предприниматель', 40, y);
    doc.text('_______________', 150, y);
    doc.text('Соболев Д.А.', 280, y);
    y += 15;
    doc.fontSize(8);
    doc.text('подпись', 165, y);
    doc.text('расшифровка подписи', 280, y);
    y += 15;
    doc.text('М.П.', 200, y);

    doc.end();
  });
}

export async function sendInvoiceEmail(data: InvoiceData): Promise<boolean> {
  try {
    const pdfBuffer = await generateInvoicePDF(data);

    const nodemailer = await import('nodemailer');
    const { config } = await import('./config');

    if (!config.email.enabled) {
      console.log(`[Invoice] Email disabled. Would send invoice #${data.invoiceNumber} to ${data.customerEmail}`);
      const testPath = `/tmp/invoice_${data.invoiceNumber}.pdf`;
      fs.writeFileSync(testPath, pdfBuffer);
      console.log(`[Invoice] Saved test PDF to ${testPath}`);
      return true;
    }

    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });

    await transporter.sendMail({
      from: `"BMGBRAND" <${config.email.from}>`,
      to: data.customerEmail,
      subject: data.subjectOverride || `Счет на оплату № ${data.invoiceNumber} от ${formatDate(data.date)} - BMGBRAND`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .logo { font-size: 24px; font-weight: bold; }
            .footer { margin-top: 40px; font-size: 12px; color: #666; }
            .note { background: #fff8e1; border-left: 4px solid #E53935; padding: 12px 16px; margin: 16px 0; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">BMG<span style="color:#E53935">BRAND</span></div>
            <h2>Счет на оплату № ${data.invoiceNumber}</h2>
            <p>Здравствуйте, ${data.customerName}!</p>
            ${data.noteText ? `<div class="note">${data.noteText}</div>` : `<p>Благодарим вас за оптовый заказ в BMGBRAND.</p>`}
            <p>Во вложении счет на оплату. После оплаты мы отправим ваш заказ ${data.transportCompany ? `через ${transportCompanyName(data.transportCompany)}` : 'транспортной компанией'}.</p>
            ${(data.promoDiscount && data.promoDiscount > 0 && data.promoCode) ? `
            <p><strong>Сумма товаров:</strong> ${formatMoney(data.items.reduce((sum, i) => sum + i.price * i.quantity, 0))} ₽</p>
            <p><strong>Скидка по промокоду "${data.promoCode}":</strong> -${formatMoney(data.promoDiscount)} ₽</p>
            <p><strong>Сумма к оплате:</strong> ${formatMoney(data.items.reduce((sum, i) => sum + i.price * i.quantity, 0) - data.promoDiscount)} ₽</p>
            ` : `
            <p><strong>Сумма к оплате:</strong> ${formatMoney(data.items.reduce((sum, i) => sum + i.price * i.quantity, 0))} ₽</p>
            `}
            <p>Реквизиты для оплаты указаны в счете.</p>
            <p>Если у вас есть вопросы, свяжитесь с нами по телефону ${COMPANY.phone}</p>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} BMGBRAND. Все права защищены.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      attachments: [
        {
          filename: `Счет_${data.invoiceNumber}_${formatDate(data.date).replace(/ /g, '_')}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    console.log(`[Invoice] Sent invoice #${data.invoiceNumber} to ${data.customerEmail}`);
    return true;
  } catch (error) {
    logError('[Invoice] Failed to send:', error);
    return false;
  }
}

export interface DocOrderData {
  invoiceNumber: number;
  orderId: number;
  date: Date;
  customerName: string;
  customerInn?: string;
  customerKpp?: string;
  customerAddress?: string;
  customerPhone: string;
  items: InvoiceItem[];
  vatRate?: number;
  vatMode?: 'included' | 'on_top';
}

export async function generateUpdPDF(data: DocOrderData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fontDir = path.join(process.cwd(), 'server', 'fonts');
    doc.registerFont('Roboto', path.join(fontDir, 'Roboto-Regular.ttf'));
    doc.registerFont('Roboto-Bold', path.join(fontDir, 'Roboto-Bold.ttf'));

    const vatRate = data.vatRate ?? 5;
    const vatMode = data.vatMode ?? 'included';
    const W = PAGE_WIDTH;
    const FONT_SIZE = 7;

    function hline(yPos: number) {
      doc.moveTo(PAGE_MARGIN, yPos).lineTo(PAGE_MARGIN + W, yPos).stroke();
    }

    // Helper: render two-column info row, returns new Y
    function infoBlock(leftLabel: string, leftVal: string, rightLabel: string, rightVal: string, startY: number): number {
      const half = W / 2 - 5;
      const rightX = PAGE_MARGIN + W / 2 + 5;
      doc.font('Roboto-Bold').fontSize(FONT_SIZE).text(leftLabel, PAGE_MARGIN, startY, { width: half });
      const afterLL = doc.y;
      doc.font('Roboto').fontSize(FONT_SIZE).text(leftVal, PAGE_MARGIN, afterLL, { width: half });
      const afterLV = doc.y;
      doc.font('Roboto-Bold').fontSize(FONT_SIZE).text(rightLabel, rightX, startY, { width: half });
      const afterRL = doc.y;
      doc.font('Roboto').fontSize(FONT_SIZE).text(rightVal, rightX, afterRL, { width: half });
      const afterRV = doc.y;
      return Math.max(afterLV, afterRV) + 6;
    }

    let y = PAGE_MARGIN;

    doc.font('Roboto-Bold').fontSize(10).text('УНИВЕРСАЛЬНЫЙ ПЕРЕДАТОЧНЫЙ ДОКУМЕНТ', PAGE_MARGIN, y, { width: W, align: 'center' });
    y += 14;
    doc.font('Roboto').fontSize(8).text('(счёт-фактура и передаточный документ)', PAGE_MARGIN, y, { width: W, align: 'center' });
    y += 12;
    doc.font('Roboto-Bold').fontSize(8).text(`Статус: 1          Счёт-фактура № ${data.invoiceNumber}    от ${formatDate(data.date)}`, PAGE_MARGIN, y, { width: W });
    y += 14;

    hline(y); y += 5;

    y = infoBlock('Продавец:', COMPANY.name, 'Покупатель:', data.customerName, y);
    y = infoBlock('Адрес продавца:', COMPANY.address, 'Адрес покупателя:', data.customerAddress || '—', y);

    doc.font('Roboto-Bold').fontSize(FONT_SIZE).text(`ИНН продавца: ${COMPANY.inn}`, PAGE_MARGIN, y, { width: W / 2 - 5 });
    doc.font('Roboto-Bold').fontSize(FONT_SIZE).text(
      `ИНН покупателя: ${data.customerInn || '—'}${data.customerKpp ? `  КПП: ${data.customerKpp}` : ''}`,
      PAGE_MARGIN + W / 2 + 5, y, { width: W / 2 - 5 }
    );
    y = doc.y + 8;

    hline(y); y += 6;

    // Table columns: №, Наименование, Ед., Кол-во, Цена, %НДС, НДС, Сумма без НДС, Всего с НДС
    const colW = [18, 190, 26, 30, 58, 36, 44, 56, 57];
    const colX: number[] = [];
    let cx = PAGE_MARGIN;
    colW.forEach(w => { colX.push(cx); cx += w; });

    const hdrs = ['№', 'Наименование товара', 'Ед.', 'Кол-во', 'Цена, ₽', '%НДС', 'НДС, ₽', 'Сумма, ₽', 'Итого с НДС'];
    const hdrH = 24;
    doc.font('Roboto-Bold').fontSize(6);
    doc.rect(PAGE_MARGIN, y, W, hdrH).stroke();
    hdrs.forEach((h, i) => {
      if (i > 0) doc.moveTo(colX[i], y).lineTo(colX[i], y + hdrH).stroke();
      doc.text(h, colX[i] + 2, y + 3, { width: colW[i] - 4, lineBreak: true });
    });
    y += hdrH;

    doc.font('Roboto').fontSize(6);
    let grandTotal = 0;
    let grandVat = 0;

    data.items.forEach((item, idx) => {
      const subtotal = item.price * item.quantity;
      let vatAmt: number;
      let priceNoVat: number;
      if (vatMode === 'included') {
        vatAmt = Math.round(subtotal * vatRate / (100 + vatRate));
        priceNoVat = subtotal - vatAmt;
      } else {
        vatAmt = Math.round(subtotal * vatRate / 100);
        priceNoVat = subtotal;
      }
      const total = subtotal + (vatMode === 'on_top' ? vatAmt : 0);
      grandTotal += total;
      grandVat += vatAmt;

      const nameH = doc.heightOfString(item.name, { width: colW[1] - 4 });
      const rowH = Math.max(14, nameH + 4);

      if (y + rowH > PAGE_BOTTOM - 100) {
        doc.addPage(); y = PAGE_MARGIN;
      }

      doc.rect(PAGE_MARGIN, y, W, rowH).stroke();
      const vals = [
        String(idx + 1), item.name, 'шт', String(item.quantity),
        formatMoney(item.price), `${vatRate}%`, formatMoney(vatAmt),
        formatMoney(priceNoVat), formatMoney(total),
      ];
      vals.forEach((val, i) => {
        if (i > 0) doc.moveTo(colX[i], y).lineTo(colX[i], y + rowH).stroke();
        doc.text(val, colX[i] + 2, y + 3, { width: colW[i] - 4, lineBreak: true });
      });
      y += rowH;
    });

    y += 6;
    doc.font('Roboto-Bold').fontSize(8);
    doc.text(`Итого без НДС: ${formatMoney(grandTotal - grandVat)} ₽`, PAGE_MARGIN, y); y += 12;
    doc.text(`НДС ${vatRate}%: ${formatMoney(grandVat)} ₽`, PAGE_MARGIN, y); y += 12;
    doc.text(`Итого с НДС: ${formatMoney(grandTotal)} ₽`, PAGE_MARGIN, y); y += 20;

    if (y + 80 > PAGE_BOTTOM) { doc.addPage(); y = PAGE_MARGIN; }
    hline(y); y += 6;
    doc.font('Roboto').fontSize(8);
    doc.text('Товар (груз) передал / права сдал:', PAGE_MARGIN, y); y += 12;
    doc.text(`ИП Соболев Д. А.        Подпись: _________________    Дата: ${formatDate(data.date)}`, PAGE_MARGIN, y, { width: W }); y += 20;
    hline(y); y += 6;
    doc.text('Товар (груз) получил / права принял:', PAGE_MARGIN, y); y += 12;
    doc.text('Подпись: _________________    Дата: __________', PAGE_MARGIN, y, { width: W }); y += 20;
    hline(y); y += 6;
    doc.font('Roboto-Bold').fontSize(6).text('Документ составлен в соответствии с Письмом ФНС России от 21.10.2013 № ММВ-20-3/96@', PAGE_MARGIN, y, { width: W, align: 'center' });

    doc.end();
  });
}

export async function generateTorg12PDF(data: DocOrderData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fontDir = path.join(process.cwd(), 'server', 'fonts');
    doc.registerFont('Roboto', path.join(fontDir, 'Roboto-Regular.ttf'));
    doc.registerFont('Roboto-Bold', path.join(fontDir, 'Roboto-Bold.ttf'));

    const vatRate = data.vatRate ?? 5;
    const vatMode = data.vatMode ?? 'included';
    const W = PAGE_WIDTH;
    const FONT_SIZE = 8;

    let y = PAGE_MARGIN;

    doc.font('Roboto-Bold').fontSize(11).text('ТОВАРНАЯ НАКЛАДНАЯ', PAGE_MARGIN, y, { width: W, align: 'center' });
    y += 14;
    doc.font('Roboto-Bold').fontSize(9).text(`№ ${data.invoiceNumber}    от ${formatDate(data.date)}`, PAGE_MARGIN, y, { width: W, align: 'center' });
    y += 18;

    // Info rows with dynamic height
    const labelW = 155;
    const valW = W - labelW;
    const valX = PAGE_MARGIN + labelW;

    function infoRow(label: string, value: string) {
      const startY = y;
      doc.font('Roboto-Bold').fontSize(FONT_SIZE).text(label, PAGE_MARGIN, startY, { width: labelW });
      const afterLabel = doc.y;
      doc.font('Roboto').fontSize(FONT_SIZE).text(value, valX, startY, { width: valW });
      const afterValue = doc.y;
      y = Math.max(afterLabel, afterValue) + 3;
    }

    infoRow('Организация (продавец):', `${COMPANY.name}, ИНН ${COMPANY.inn}`);
    infoRow('Адрес продавца:', COMPANY.address);
    infoRow('Грузоотправитель:', COMPANY.name);
    infoRow('Грузополучатель (покупатель):', data.customerName + (data.customerInn ? `, ИНН ${data.customerInn}` : ''));
    if (data.customerAddress) infoRow('Адрес покупателя:', data.customerAddress);
    infoRow('Основание:', `Заказ № ${data.orderId}`);
    y += 6;

    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + W, y).stroke();
    y += 6;

    // Table columns: №, Наименование, Ед., Кол-во, Цена, Сумма, %НДС, НДС
    const colW = [18, 220, 26, 30, 62, 68, 46, 45];
    const colX: number[] = [];
    let cx = PAGE_MARGIN;
    colW.forEach(w => { colX.push(cx); cx += w; });

    const hdrs = ['№', 'Наименование', 'Ед.', 'Кол-во', 'Цена, ₽', 'Сумма, ₽', '%НДС', 'НДС, ₽'];
    const hdrH = 22;
    doc.font('Roboto-Bold').fontSize(7);
    doc.rect(PAGE_MARGIN, y, W, hdrH).stroke();
    hdrs.forEach((h, i) => {
      if (i > 0) doc.moveTo(colX[i], y).lineTo(colX[i], y + hdrH).stroke();
      doc.text(h, colX[i] + 2, y + 4, { width: colW[i] - 4, lineBreak: true });
    });
    y += hdrH;

    doc.font('Roboto').fontSize(7);
    let grandTotal = 0;
    let grandVat = 0;

    data.items.forEach((item, idx) => {
      const subtotal = item.price * item.quantity;
      let vatAmt: number;
      if (vatMode === 'included') {
        vatAmt = Math.round(subtotal * vatRate / (100 + vatRate));
      } else {
        vatAmt = Math.round(subtotal * vatRate / 100);
      }
      grandTotal += subtotal;
      grandVat += vatAmt;

      const nameH = doc.heightOfString(item.name, { width: colW[1] - 4 });
      const rowH = Math.max(14, nameH + 4);

      if (y + rowH > PAGE_BOTTOM - 100) {
        doc.addPage(); y = PAGE_MARGIN;
      }

      doc.rect(PAGE_MARGIN, y, W, rowH).stroke();
      const vals = [
        String(idx + 1), item.name, 'шт', String(item.quantity),
        formatMoney(item.price), formatMoney(subtotal), `${vatRate}%`, formatMoney(vatAmt),
      ];
      vals.forEach((val, i) => {
        if (i > 0) doc.moveTo(colX[i], y).lineTo(colX[i], y + rowH).stroke();
        doc.text(val, colX[i] + 2, y + 3, { width: colW[i] - 4, lineBreak: true });
      });
      y += rowH;
    });

    y += 6;
    doc.font('Roboto-Bold').fontSize(8);
    doc.text(`Итого: ${formatMoney(grandTotal)} ₽    в т.ч. НДС ${vatRate}%: ${formatMoney(grandVat)} ₽`, PAGE_MARGIN, y, { width: W });
    y += 20;

    if (y + 60 > PAGE_BOTTOM) { doc.addPage(); y = PAGE_MARGIN; }
    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + W, y).stroke(); y += 6;
    doc.font('Roboto').fontSize(8);
    doc.text(`Отпуск груза произвёл: ИП Соболев Д. А.        Подпись: _________________    Дата: ${formatDate(data.date)}`, PAGE_MARGIN, y, { width: W });
    y += 20;
    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + W, y).stroke(); y += 6;
    doc.text('Груз получил: _______________________    Подпись: _________________    Дата: __________', PAGE_MARGIN, y, { width: W });
    y += 20;
    doc.font('Roboto-Bold').fontSize(7).text('Форма ТОРГ-12. Товарная накладная.', PAGE_MARGIN, y, { width: W, align: 'center' });

    doc.end();
  });
}

// Get next invoice number (simple implementation - in production use DB sequence)
let invoiceCounter = Math.floor(Date.now() / 1000) % 10000;
export function getNextInvoiceNumber(): number {
  return ++invoiceCounter;
}

// ── Счёт на оплату от партнёра (ИП/ООО) в адрес BMGBRAND ─────────────────
// Роли ОБРАТНЫЕ по сравнению с generateInvoicePDF:
//   Исполнитель = партнёр (ИП/ООО)
//   Заказчик    = ИП Соболев Д.А. (наша компания)
// Без НДС, без QR-кода (мы платим им).
export interface PartnerPayoutInvoiceData {
  payoutId: number;         // ID выплаты (используется как номер счёта)
  date: Date;
  partnerName: string;      // напр. «ИП Иванов Иван Иванович» или «ООО "Ромашка"»
  partnerInn: string;
  partnerBankBik: string;
  partnerBankAccount: string;
  partnerBankName: string;
  partnerBankCorrAccount: string;
  amount: number;           // сумма в копейках
  commissionCount: number;  // кол-во комиссий (для описания услуги)
}

export async function generatePartnerPayoutInvoicePDF(data: PartnerPayoutInvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fontDir = path.join(process.cwd(), 'server', 'fonts');
    doc.registerFont('Roboto', path.join(fontDir, 'Roboto-Regular.ttf'));
    doc.registerFont('Roboto-Bold', path.join(fontDir, 'Roboto-Bold.ttf'));
    doc.font('Roboto');

    // ── Реквизиты партнёра (получатель денег) ─────────────────────────────
    doc.fontSize(8);
    doc.text(data.partnerBankName, 40, 40, { width: 300 });
    doc.text(`БИК  ${data.partnerBankBik}`, 400, 40);
    doc.text(`Сч. № ${data.partnerBankCorrAccount}`, 400, 52);

    doc.text('Банк получателя', 40, 65);
    doc.text(`ИНН ${data.partnerInn}`, 40, 80);
    doc.text(`Сч. № ${data.partnerBankAccount}`, 400, 80);
    doc.text(data.partnerName, 40, 95);
    doc.text('Получатель', 40, 110);

    doc.moveTo(40, 130).lineTo(555, 130).stroke();

    // ── Заголовок ──────────────────────────────────────────────────────────
    doc.fontSize(14).font('Roboto-Bold');
    doc.text(`Счёт на оплату № АВТ-${data.payoutId} от ${formatDate(data.date)}`, 40, 145, { align: 'center' });

    doc.fontSize(9).font('Roboto');
    doc.text(
      `Исполнитель: ${data.partnerName}, ИНН ${data.partnerInn}`,
      40, 180, { width: PAGE_WIDTH },
    );
    doc.text(
      `Заказчик: ${COMPANY.name}, ИНН ${COMPANY.inn}, ${COMPANY.address}`,
      40, 200, { width: PAGE_WIDTH },
    );
    doc.text('Основание: Договор об оказании партнёрских услуг', 40, 225);

    // ── Таблица ────────────────────────────────────────────────────────────
    const colWidths = [30, 265, 60, 50, 50, 60];
    const colX      = [40,  70, 335, 395, 445, 495];

    function drawHeader(y: number): number {
      doc.font('Roboto-Bold').fontSize(8);
      doc.rect(40, y, PAGE_WIDTH, 20).stroke();
      doc.text('№',              colX[0] + 3, y + 6);
      doc.text('Наименование услуги', colX[1] + 3, y + 6);
      doc.text('Кол-во',         colX[2] + 3, y + 6);
      doc.text('Ед.',            colX[3] + 3, y + 6);
      doc.text('Цена',           colX[4] + 3, y + 6);
      doc.text('Сумма',          colX[5] + 3, y + 6);
      doc.font('Roboto').fontSize(8);
      return y + 20;
    }

    let y = drawHeader(255);

    const serviceName = `Партнёрское вознаграждение (${data.commissionCount} комис${data.commissionCount === 1 ? 'сия' : data.commissionCount < 5 ? 'сии' : 'сий'})`;
    const nameH = doc.heightOfString(serviceName, { width: 258 });
    const rowH = Math.max(20, nameH + 10);

    doc.rect(40, y, PAGE_WIDTH, rowH).stroke();
    const mid = y + Math.max(6, (rowH - 8) / 2);
    doc.text('1',                    colX[0] + 3, mid);
    doc.text(serviceName,            colX[1] + 3, y + 5, { width: 258 });
    doc.text('1',                    colX[2] + 3, mid);
    doc.text('Усл.',                 colX[3] + 3, mid);
    doc.text(formatMoney(data.amount), colX[4] + 3, mid);
    doc.text(formatMoney(data.amount), colX[5] + 3, mid);
    y += rowH;

    // Итого
    doc.font('Roboto-Bold').fontSize(8);
    doc.rect(40, y, PAGE_WIDTH, 20).stroke();
    doc.text('1',                    colX[2] + 3, y + 6);
    doc.text(formatMoney(data.amount), colX[5] + 3, y + 6);
    y += 30;

    // ── Итоговая сумма ─────────────────────────────────────────────────────
    doc.font('Roboto').fontSize(9);
    doc.text('Итого: 1 позиция', 40, y);
    y += 14;
    doc.text('НДС не облагается', 40, y);
    y += 14;
    doc.font('Roboto-Bold').fontSize(9);
    doc.text(`Всего к оплате: ${formatMoney(data.amount)} ₽`, 40, y);
    y += 20;

    // Сумма прописью
    const rubles = Math.floor(data.amount / 100);
    const kop    = data.amount % 100;
    const rubWord = rubles === 1 ? 'рубль' : (rubles % 10 >= 2 && rubles % 10 <= 4 && (rubles % 100 < 10 || rubles % 100 >= 20)) ? 'рубля' : 'рублей';
    const kopWord = kop === 1 ? 'копейка' : (kop >= 2 && kop <= 4) ? 'копейки' : 'копеек';
    const sumStr  = numberToWordsRu(rubles);
    const capitalSum = sumStr.charAt(0).toUpperCase() + sumStr.slice(1);
    doc.font('Roboto').fontSize(9);
    doc.text(`${capitalSum} ${rubWord} ${String(kop).padStart(2, '0')} ${kopWord}`, 40, y, { width: PAGE_WIDTH });
    y += 30;

    // ── Подпись исполнителя ────────────────────────────────────────────────
    if (y + 45 > PAGE_BOTTOM) { doc.addPage(); y = PAGE_MARGIN; }
    doc.fontSize(10);
    doc.text('Исполнитель', 40, y);
    doc.text('_______________', 150, y);
    doc.text(data.partnerName, 290, y, { width: 260 });
    y += 15;
    doc.fontSize(8);
    doc.text('подпись', 165, y);
    doc.text('расшифровка', 290, y);

    doc.end();
  });
}
