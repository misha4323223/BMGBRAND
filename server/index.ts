// Normalize env var names: strip leading invisible Unicode chars (e.g. U+200E Left-to-Right Mark)
// that get injected when secrets are pasted from certain editors or Replit's secret manager.
for (const key of Object.keys(process.env)) {
  const clean = key.replace(/^[\u200e\u200f\u200b\u200c\u200d\ufeff\u00a0]+/, "");
  if (clean !== key) {
    process.env[clean] = process.env[key];
    delete process.env[key];
  }
}

import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import helmet from "helmet";
import cors from "cors";
import { registerRoutes } from "./routes";
import { migrateAiKnowledgeDefaults } from "./ai-chat";
import { serveStatic } from "./static";
import { botSsrMiddleware } from "./bot-ssr";
import { createServer } from "http";
import { reconnectYdb, shouldReconnectYdb } from "./db";
import { startAbandonedCartJob } from "./abandoned-cart";
import { initPostPurchaseEmailJob } from "./post-purchase-email";
import { initAutonomousAgent } from "./autonomous-agent";
import { startNewProductsNotifierJob } from "./new-products-notifier";
import { startPreorderNotifierJob } from "./preorder-notifier";
import { notifyError } from "./error-monitor";

// Last-resort safety net: if a YDB-related promise escapes try/catch (e.g.
// a fire-and-forget background task), proactively trigger driver reconnect
// so subsequent queries don't pile up against a dead grpc channel. Without
// this, a single transport blip can stall the whole app for ~150 seconds
// while the SDK keeps retrying internally.
process.on('unhandledRejection', (reason: any) => {
  const message = reason?.message || String(reason);
  console.error('[Process] Unhandled rejection:', message);

  if (shouldReconnectYdb(reason)) {
    console.log('[Process] Detected YDB transport/auth failure → triggering reconnect');
    reconnectYdb().catch(err => {
      const errMsg = err?.message || String(err);
      console.error('[Process] YDB reconnect from unhandledRejection failed:', errMsg);
      notifyError('YDB: сбой переподключения', errMsg);
    });
  } else {
    // Не-YDB необработанный reject — сообщаем в мессенджеры
    notifyError('Необработанная ошибка', message);
  }
});

process.on('uncaughtException', (err: Error) => {
  console.error('[Process] Uncaught exception:', err.message, err.stack);
  notifyError('💥 Критический сбой', err.message, err.stack?.slice(0, 400));
  // Даём 2 секунды чтобы уведомление успело отправиться, потом завершаем процесс
  setTimeout(() => process.exit(1), 2000);
});

const app = express();
// Anti-spoof (30.04.2026): доверяем ровно одному прокси-хопу — Yandex Cloud API Gateway.
// `true` бы означало "доверять всему X-Forwarded-For" — тогда любой клиент,
// бьющий напрямую в публичный URL контейнера, мог бы подменить req.ip через свой XFF-заголовок.
// `1` = берём только последний (самый правый) хоп XFF, который действительно поставил наш Gateway.
// req.socket.remoteAddress всё равно сохраняем отдельно (consent_remote_ip) для криминалистики.
app.set('trust proxy', 1);
const httpServer = createServer(app);

app.use((req: Request, res: Response, next: NextFunction) => {
  const host = req.headers.host || '';
  if (host.startsWith('www.')) {
    const newUrl = `https://booomerangs.ru${req.originalUrl}`;
    return res.redirect(301, newUrl);
  }
  next();
});

// Bots (Yandex, Google, ahrefs, etc.) keep crawling URLs left over from the
// old WordPress / Tilda (Tproduct) site. Each request used to fall through
// the entire middleware stack (helmet/cors/cookieParser/compression/Vite
// catch-all) and end up hitting React-router 404, which is wasteful CPU and
// — more importantly — adds load to YDB through any request-scoped lookups.
// Short-circuit them as early as possible with HTTP 410 Gone, which tells
// search engines to drop these URLs from their index permanently. We also
// set a long Cache-Control so well-behaved bots back off entirely.
const DEAD_URL_PREFIXES = ['/wp-content/', '/tproduct/', '/noski/tproduct/'];
app.use((req: Request, res: Response, next: NextFunction) => {
  const p = req.path.toLowerCase();
  if (DEAD_URL_PREFIXES.some(prefix => p.startsWith(prefix))) {
    res.set('Cache-Control', 'public, max-age=86400');
    return res.status(410).type('text/plain').send('410 Gone — this URL was removed during migration from the old platform.');
  }
  next();
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const allowedOrigins = [
  process.env.SITE_URL,
  'https://booomerangs.ru',
  'https://www.booomerangs.ru',
  'https://bba6fol2jvub7mr2uahi.containers.yandexcloud.net',
  process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : undefined,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin
      || allowedOrigins.some(allowed => origin === allowed)
      || origin.endsWith('.replit.dev')
      || origin.endsWith('.pike.replit.dev')
      || origin.startsWith('http://localhost:')
      || origin.startsWith('http://127.0.0.1:')
      || origin.startsWith('http://0.0.0.0:')
    ) {
      callback(null, true);
    } else {
      console.log(`[CORS] Blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
}));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

app.use(compression({
  level: 6,
  filter: (req, res) => {
    const type = res.getHeader('content-type') as string || '';
    if (/image\/(webp|jpeg|png|gif|avif)|video\/|audio\//.test(type)) return false;
    return compression.filter(req, res);
  },
  threshold: 256,
}));
app.use(cookieParser());


app.use((req, res, next) => {
  if (req.method === 'PATCH' || req.method === 'PUT' || req.method === 'DELETE') {
    console.log(`[RAW] ${req.method} ${req.url} Content-Length: ${req.headers['content-length']} Content-Type: ${req.headers['content-type']}`);
  }
  const origRedirect = res.redirect.bind(res);
  (res as any).redirect = function(statusOrUrl: any, url?: string) {
    const target = url || statusOrUrl;
    const status = url ? statusOrUrl : 302;
    if ((req.url.includes('/product/') || req.url.match(/^\/[a-z0-9-]+$/)) && !req.url.startsWith('/api/')) {
      console.log(`[DEBUG-REDIRECT] ${req.method} ${req.url} → ${status} ${target}`);
    }
    return url !== undefined ? origRedirect(statusOrUrl, url as any) : origRedirect(statusOrUrl);
  };
  next();
});

app.use(
  express.json({
    limit: '20mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const summary = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${summary.length > 200 ? summary.slice(0, 200) + '...' : summary}`;
      }

      log(logLine);
    }
  });

  next();
});

import { initYdb } from "./db";
import { storage } from "./storage";
import { LEGAL_DOCUMENT_SLUGS } from "@shared/schema";

// Дефолтные тексты юридических документов — заглушки, которые админ потом заменит.
// Важно: оферта содержит явный пункт про ПЭП по 63-ФЗ — это даёт юридическую силу
// чекбоксу при регистрации. Менять текст нужно через POST /api/admin/legal-documents.
// v1.1.0 — добавлен Раздел 7 для медийных партнёров (артисты/блогеры).
const OFFER_CURRENT_VERSION = '1.2.0';
const DEFAULT_LEGAL_DOCS: Record<string, { title: string; body: string }> = {
  offer: {
    title: 'Партнёрский договор-оферта BMG BRAND',
    body: `ПАРТНЁРСКИЙ ДОГОВОР-ОФЕРТА BMG BRAND (Booomerangs)
Редакция 1.1.0 от 22.05.2026

Настоящий договор является публичной офертой и регулирует условия партнёрской программы BMG BRAND. Договор распространяется на два типа партнёров: реферальных партнёров и медийных партнёров (артисты, блогеры, инфлюенсеры). Разделы 1–6 применяются ко всем партнёрам без исключения. Раздел 7 применяется исключительно к медийным партнёрам, отметившим соответствующий статус при регистрации.

1. ПРЕДМЕТ ДОГОВОРА
1.1. Партнёр привлекает покупателей через свой персональный реферальный идентификатор (реферальную ссылку) и получает вознаграждение с выкупленных заказов в размере, согласованном с Заказчиком.
1.2. Вознаграждение начисляется только с фактически выкупленных и оплаченных заказов. Отменённые, возвращённые и невыкупленные заказы не учитываются.
1.3. Ставка вознаграждения устанавливается Заказчиком и отображается в личном кабинете Партнёра. Заказчик вправе изменить ставку в одностороннем порядке с уведомлением Партнёра по email не менее чем за 7 (семь) календарных дней.

2. ЭЛЕКТРОННАЯ ПОДПИСЬ (ПЭП) ПО 63-ФЗ
В соответствии с ст. 5, 6 и 9 Федерального закона от 06.04.2011 № 63-ФЗ «Об электронной подписи», стороны признают, что:
— проставление Партнёром галочек в чекбоксах согласия при регистрации, в совокупности с фиксацией IP-адреса, User-Agent, точного времени и хэша SHA-256 текста документа на момент подписания, является простой электронной подписью (ПЭП);
— подписанные таким образом электронные документы признаются равнозначными документам на бумажном носителе, подписанным собственноручной подписью;
— выбор статуса «медийный партнёр (артист/блогер)» при регистрации также фиксируется в журнале подписаний и имеет юридическую силу наравне с иными действиями по акцепту оферты.

3. ХРАНЕНИЕ ЖУРНАЛА ПОДПИСАНИЙ
Заказчик обязуется хранить журнал подписаний (consent_signatures) и архив версий документов (legal_documents) в неизменяемом виде. Партнёр вправе по запросу получить PDF-копию подписанных им документов, направив обращение на электронный адрес Заказчика.

4. АКЦЕПТ ОФЕРТЫ И ВСТУПЛЕНИЕ ДОГОВОРА В СИЛУ
Акцепт оферты осуществляется в два последовательных этапа:
— Этап 1. Подтверждение email: Партнёр переходит по ссылке, направленной на указанный при регистрации адрес электронной почты. До выполнения этого действия простая электронная подпись не считается надлежащим образом заверенной, а настоящий договор — подписанным.
— Этап 2. Верификация Заказчиком: после подтверждения email Заказчик проверяет представленные Партнёром сведения. Договор считается заключённым, доступ к личному кабинету и участие в партнёрской программе — открытыми с момента получения Партнёром уведомления об активации аккаунта. Заказчик вправе отказать в активации без объяснения причин, уведомив Партнёра по email.

5. ВОЗРАСТ И ДЕЕСПОСОБНОСТЬ
Партнёр гарантирует, что ему исполнилось 18 (восемнадцать) лет на момент регистрации и он обладает полной гражданской дееспособностью для заключения настоящего договора. Партнёр подтверждает это отдельным согласием при регистрации.

6. ПРОЧИЕ УСЛОВИЯ
6.1. Прочие условия партнёрской программы (сроки выплат, период холда, ответственность сторон) регулируются настоящим договором в редакции, актуальной на момент акцепта.
6.2. Текст настоящего договора версионируется. При публикации новой редакции — прежняя сохраняется в архиве, и Партнёру будет предложено подписать обновлённую версию.
6.3. Стороны обязуются соблюдать требования действующего законодательства Российской Федерации, в том числе: о рекламе (38-ФЗ), о персональных данных (152-ФЗ), об электронной подписи (63-ФЗ).

7. ДОПОЛНИТЕЛЬНЫЕ УСЛОВИЯ ДЛЯ МЕДИЙНЫХ ПАРТНЁРОВ (АРТИСТЫ, БЛОГЕРЫ, ИНФЛЮЕНСЕРЫ)
Настоящий раздел применяется исключительно к Партнёрам, отметившим статус «медийный партнёр (артист/блогер)» при регистрации. Факт выбора данного статуса зафиксирован в журнале подписаний (поле isArtist) совместно с IP-адресом, User-Agent и точным временем подписания основного договора и имеет равную юридическую силу с иными действиями по акцепту оферты.

7.1. Персональная страница на сайте
Заказчик предоставляет медийному партнёру персональную страницу на сайте booomerangs.ru (адрес вида /@slug) для публикации контента партнёра. Персональная страница является инструментом партнёрского сотрудничества и не является собственностью Партнёра. При расторжении договора страница деактивируется, контент удаляется или скрывается по усмотрению Заказчика.

7.2. Контент и интеллектуальная собственность
7.2.1. Партнёр подтверждает, что обладает всеми необходимыми правами на размещаемые материалы: фотографии, тексты, видео, музыку, изображения и иные объекты интеллектуальной собственности. Размещение материалов, на которые Партнёр не имеет прав, влечёт его полную ответственность перед правообладателями.
7.2.2. Размещая материалы на персональной странице, Партнёр предоставляет Заказчику безвозмездную неисключительную лицензию на использование этих материалов в маркетинговых и рекламных целях: публикацию в социальных сетях, email-рассылках, рекламных кампаниях и на сайте Заказчика. Лицензия действует на весь срок действия договора.
7.2.3. При расторжении договора Заказчик прекращает новое использование материалов Партнёра, однако не обязан удалять уже опубликованный контент в тех случаях, когда его удаление технически невозможно (например, репосты третьих лиц в социальных сетях).

7.3. Ставка вознаграждения для медийных партнёров
Ставка вознаграждения для медийных партнёров устанавливается Заказчиком индивидуально и может отличаться от стандартной ставки реферальной программы. Актуальная ставка отображается в личном кабинете Партнёра. При реализации товаров, связанных с именем или творчеством Партнёра, ставка применяется в соответствии с условиями, согласованными при активации аккаунта.

7.4. Репутационные обязательства
7.4.1. Партнёр обязуется не допускать публичных высказываний, действий или публикаций, которые могут нанести репутационный ущерб бренду BMG BRAND, его сотрудникам или деловым партнёрам.
7.4.2. При нарушении настоящего пункта Заказчик вправе расторгнуть договор в одностороннем порядке, направив письменное уведомление по email. Вознаграждение, начисленное до выявления нарушения и находящееся на удержании (холде), выплачивается в установленные сроки. Вознаграждение за период после выявления нарушения выплате не подлежит.

7.5. Неэксклюзивность сотрудничества
Настоящий договор не является эксклюзивным. Партнёр вправе сотрудничать с иными брендами и платформами, если иное не согласовано отдельным письменным соглашением. Партнёр обязуется не использовать фирменный стиль, логотип и товарные знаки BMG BRAND в рекламных материалах, созданных для конкурирующих брендов одежды, без предварительного письменного согласия Заказчика.

7.6. Маркировка рекламы
При публикации рекламного контента о BMG BRAND в социальных сетях и иных интернет-ресурсах Партнёр обязуется соблюдать требования Федерального закона от 13.03.2006 № 38-ФЗ «О рекламе», в том числе маркировать рекламные публикации в соответствии с действующим законодательством Российской Федерации о маркировке интернет-рекламы. Ответственность за нарушение требований о маркировке несёт Партнёр.`,
  },
  privacy: {
    title: 'Политика обработки персональных данных',
    body: `ПОЛИТИКА ОБРАБОТКИ ПЕРСОНАЛЬНЫХ ДАННЫХ ПАРТНЁРОВ BMG BRAND

В соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных» Заказчик обрабатывает следующие данные Партнёра:
— ФИО, дата рождения, гражданство, ИНН, реквизиты счёта;
— для ИП и юридических лиц: ОГРН/ОГРНИП, КПП, юридический адрес, должность подписанта;
— контактные данные (email, телефон);
— технические сведения о подписании согласий (IP, User-Agent, время).

Цели обработки: исполнение партнёрского договора, выплата вознаграждения, выполнение требований законодательства РФ (бухгалтерский учёт, налоговая отчётность).

Срок хранения: в течение действия договора и 5 лет после его расторжения (требование Минфина РФ к первичным документам).

Права Партнёра: получение информации, изменение, отзыв согласия — через email-обращение к оператору. Отзыв согласия влечёт прекращение договора и удаление данных, не охваченных требованиями обязательного хранения.`,
  },
  adult: {
    title: 'Подтверждение совершеннолетия (18+)',
    body: `Я подтверждаю, что мне исполнилось 18 (восемнадцать) лет на момент регистрации в партнёрской программе BMG BRAND, и я обладаю полной гражданской дееспособностью для заключения настоящего договора.

В случае предоставления недостоверных сведений о возрасте — несу полную ответственность согласно ст. 173.1 ГК РФ; договор считается недействительным с момента его заключения.`,
  },
  self_employed: {
    title: 'Подтверждение статуса плательщика налога на профессиональный доход (НПД)',
    body: `Я подтверждаю, что зарегистрирован в качестве плательщика налога на профессиональный доход (самозанятого) в соответствии с Федеральным законом от 27.11.2018 № 422-ФЗ.

Я обязуюсь:
— самостоятельно уплачивать налог НПД с полученного партнёрского вознаграждения;
— формировать чек в приложении «Мой налог» по каждой выплате и направлять его Заказчику в течение 5 рабочих дней;
— незамедлительно уведомить Заказчика о снятии с учёта в качестве самозанятого, превышении лимита 2,4 млн ₽/год или ином основании прекращения статуса.

Заказчик не выступает налоговым агентом и не удерживает НДФЛ; обязанность по уплате НПД и подаче отчётности лежит на мне.`,
  },
  marketing: {
    title: 'Согласие на маркетинговые коммуникации',
    body: `Я даю согласие на получение от BMG BRAND информационных и рекламных рассылок (email, push, мессенджеры) о новинках, скидках и обновлениях партнёрской программы.

Согласие может быть отозвано в любой момент через ссылку «Отписаться» в письме или через email-обращение к оператору. Отзыв согласия не влияет на исполнение партнёрского договора.`,
  },
};

async function seedDefaultLegalDocuments() {
  for (const slug of LEGAL_DOCUMENT_SLUGS) {
    try {
      const existing = await storage.getActiveLegalDocument(slug);
      if (!existing) {
        const tpl = DEFAULT_LEGAL_DOCS[slug];
        if (!tpl) continue;
        const version = slug === 'offer' ? OFFER_CURRENT_VERSION : '1.0.0';
        await storage.createLegalDocument({
          slug,
          version,
          title: tpl.title,
          body: tpl.body,
          createdBy: 'system:seed',
        });
        console.log(`[Legal Seed] Создан документ по умолчанию: ${slug} v${version}`);
      } else if (slug === 'offer' && (existing.version === '1.0.0' || existing.version === '1.1.0')) {
        // Авто-миграция: обновляем оферту до актуальной версии с Разделом 7 для медийных партнёров
        const tpl = DEFAULT_LEGAL_DOCS['offer'];
        await storage.createLegalDocument({
          slug: 'offer',
          version: OFFER_CURRENT_VERSION,
          title: tpl.title,
          body: tpl.body,
          createdBy: `system:migrate-${OFFER_CURRENT_VERSION}`,
        });
        console.log(`[Legal Seed] Оферта обновлена: ${existing.version} → ${OFFER_CURRENT_VERSION} (Раздел 7 — медийные партнёры)`);

      }
    } catch (e: any) {
      console.error(`[Legal Seed] Ошибка для ${slug}:`, e?.message);
    }
  }
}

(async () => {
  await initYdb();
  // Засеиваем дефолтные тексты юридических документов (только если активной версии нет)
  await seedDefaultLegalDocuments().catch((e) => console.error('[Legal Seed] failed:', e?.message));
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });

    // Уведомляем только о серверных ошибках (5xx), клиентские (4xx) игнорируем
    if (status >= 500) {
      notifyError('Express 500', message, err.stack?.slice(0, 400));
    }
  });

  // Bot SSR middleware — intercept known crawlers before the SPA catch-all.
  // Serves real visible HTML from in-memory cache (no YDB calls).
  // Humans are completely unaffected — only bots with matching User-Agent hit this.
  app.use(botSsrMiddleware);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      import("./storage").then(async ({ storage, warmRatingsCache, warmReviewsCache }) => {
        try {
          const r = await (storage as any).addOldPriceColumn?.();
          if (r?.message) console.log(`[Migration] old_price: ${r.message}`);
        } catch {}
        try {
          const products = await storage.getProducts();
          log(`Cache warmup: loaded ${products.length} products`);
        } catch (err) {
          console.error("[Warmup] Failed to preload products:", err);
        }
        try {
          const { buildCoPurchaseIndex } = await import("./recommendations");
          await buildCoPurchaseIndex(storage);
        } catch (err: any) {
          console.error("[Warmup] Failed to build co-purchase index:", err?.message);
        }
        try {
          await warmRatingsCache(storage as any);
        } catch (err) {
          console.error("[Warmup] Failed to warm ratings cache:", err);
        }
        try {
          await warmReviewsCache(storage as any);
        } catch (err) {
          console.error("[Warmup] Failed to warm reviews cache:", err);
        }
        const criticalPages = ["home", "navbar", "footer", "artist_pages", "seo"];
        for (const page of criticalPages) {
          try {
            await new Promise(resolve => setTimeout(resolve, 300));
            const settings = await storage.getPageSettings(page);
            log(`Cache warmup: loaded pageSettings(${page}) with ${Object.keys(settings).length} sections`);
          } catch (err) {
            console.error(`[Warmup] Failed to preload pageSettings(${page}):`, err);
          }
        }
      });
      startAbandonedCartJob();
      initPostPurchaseEmailJob();
      initAutonomousAgent();
      startNewProductsNotifierJob();
      startPreorderNotifierJob();
      migrateAiKnowledgeDefaults();
    },
  );
})();
