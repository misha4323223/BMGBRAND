import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  CheckCircle,
  Factory,
  Mail,
  Phone,
  ShieldCheck,
  Shirt,
  Truck,
  Wallet,
} from "lucide-react";

const WHOLESALE_FAQ = [
  {
    q: "Какая минимальная сумма оптового заказа?",
    a: "Носки — от 5 000 ₽ (от 2 штук на один артикул). Одежда — от 10 000 ₽.",
  },
  {
    q: "Кто может стать оптовым покупателем BOOOMERANGS?",
    a: "Индивидуальные предприниматели и юридические лица. Оставьте заявку — одобрение занимает около 15 минут.",
  },
  {
    q: "Вы работаете с маркировкой «Честный знак»?",
    a: "Да. Поставляем товар с кодами маркировки «Честный знак».",
  },
  {
    q: "Как вы отправляете оптовые заказы?",
    a: "Транспортными компаниями: СДЭК, ПЭК, Деловые линии, Байкал и Почта России.",
  },
  {
    q: "Есть ли специальные оптовые цены?",
    a: "Да. После одобрения заявки вы получаете доступ к оптовому кабинету со специальными ценами и персональным менеджером.",
  },
];

const CONDITIONS = [
  {
    icon: Boxes,
    title: "Минимальный заказ",
    points: ["Носки — от 5 000 ₽", "От 2 штук на один артикул", "Одежда — от 10 000 ₽"],
  },
  {
    icon: ShieldCheck,
    title: "Маркировка",
    points: ["Работаем с «Честным знаком»", "Коды маркировки на товаре", "Готовы к поставкам по РФ"],
  },
  {
    icon: Truck,
    title: "Доставка",
    points: ["СДЭК", "ПЭК и Деловые линии", "Байкал, Почта России"],
  },
];

const WHY_US = [
  {
    icon: Factory,
    title: "Своё производство",
    desc: "Полный цикл в Туле — от дизайна и пошива до упаковки. Контролируем качество каждой партии.",
  },
  {
    icon: Shirt,
    title: "Одежда и носки",
    desc: "Куртки сложного кроя, худи, свитшоты, футболки, шорты, аксессуары и носки с 200+ авторских дизайнов.",
  },
  {
    icon: BadgeCheck,
    title: "Официальный мерч артистов и фестивалей",
    desc: "Производим мерч Гудтаймс, Молодость внутри, Драгни и МультFильмы — и официальный мерч фестиваля Дикая Мята.",
  },
  {
    icon: Wallet,
    title: "Оптовый кабинет",
    desc: "Специальные цены, персональный менеджер и заказы в несколько кликов после одобрения заявки.",
  },
];

const STEPS = [
  { title: "Оставьте заявку", desc: "Заполните форму — название компании, ИНН и контакты." },
  { title: "Одобрение ~15 минут", desc: "Менеджер проверит данные и откроет доступ к оптовым ценам." },
  { title: "Заказывайте", desc: "Собирайте заказ в оптовом кабинете — отгрузим транспортной компанией." },
];

export default function WholesaleLanding() {
  const { data: seoOverrides } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/seo"],
  });
  const wholesaleSeo = seoOverrides?.wholesale_register || {};
  const title = wholesaleSeo.title || "Оптовые продажи — носки и одежда BOOOMERANGS";
  const description =
    wholesaleSeo.description ||
    "Оптовые поставки носков и одежды BOOOMERANGS: носки от 5 000 ₽, одежда от 10 000 ₽. Собственное производство в Туле, маркировка «Честный знак», доставка СДЭК, ПЭК, Деловые линии, Байкал, Почта России.";

  return (
    <>
      <SEO
        title={title}
        description={description}
        keywords="опт носки, опт одежда, оптовые продажи носков, поставщик носков оптом, мерч оптом, оптовые цены на одежду, опт BOOOMERANGS, опт BMGBRAND, оптовый кабинет, маркировка честный знак опт, доставка СДЭК опт, опт для ИП, опт для юридических лиц"
        canonical="https://booomerangs.ru/wholesale"
        ogImage="/og-image.png"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": title,
            "description": description,
            "url": "https://booomerangs.ru/wholesale",
            "publisher": {
              "@type": "Organization",
              "name": "BOOOMERANGS",
              "url": "https://booomerangs.ru",
              "logo": "https://booomerangs.ru/og-image.png",
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "Service",
            "name": "Оптовые продажи BOOOMERANGS",
            "description": "Оптовые поставки носков и одежды BOOOMERANGS. Минимальный заказ: носки от 5 000 ₽, одежда от 10 000 ₽. Собственное производство, маркировка «Честный знак», доставка СДЭК, ПЭК, Деловые линии, Байкал, Почта России.",
            "provider": {
              "@type": "Organization",
              "name": "BOOOMERANGS",
              "url": "https://booomerangs.ru",
            },
            "areaServed": "RU",
            "serviceType": "Оптовые продажи",
            "audience": {
              "@type": "Audience",
              "audienceType": "Индивидуальные предприниматели, юридические лица",
            },
            "offers": {
              "@type": "Offer",
              "description": "Специальные оптовые цены после одобрения заявки",
              "priceCurrency": "RUB",
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": WHOLESALE_FAQ.map((f) => ({
              "@type": "Question",
              "name": f.q,
              "acceptedAnswer": { "@type": "Answer", "text": f.a },
            })),
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Главная", "item": "https://booomerangs.ru" },
              { "@type": "ListItem", "position": 2, "name": "Оптовые продажи", "item": "https://booomerangs.ru/wholesale" },
            ],
          },
        ]}
      />

      {/* ── Hero ── */}
      <section className="bg-zinc-950 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-14 pb-10 text-center">
          <p className="text-[11px] font-black tracking-[0.25em] uppercase text-red-500 mb-4">
            Оптовым партнёрам
          </p>
          <h1 className="text-4xl sm:text-6xl font-black leading-[1.02] tracking-tight mb-5">
            Оптовые продажи BOOOMERANGS
          </h1>
          <p className="text-zinc-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed mb-7">
            Носки и одежда с собственного производства в Туле — для розничных магазинов, маркетплейсов и дистрибьюторов по всей России.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/wholesale/register"
              data-testid="link-wholesale-register-hero"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
            >
              Стать оптовым партнёром
            </Link>
            <a
              href="#conditions"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg border border-white/25 text-white text-sm font-semibold hover:bg-white hover:text-black transition-colors"
            >
              Условия сотрудничества
            </a>
          </div>
        </div>

        <div className="border-t border-zinc-800">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 grid grid-cols-3 divide-x divide-zinc-800">
            {[
              { value: "5 000 ₽", label: "Носки от" },
              { value: "10 000 ₽", label: "Одежда от" },
              { value: "~15 мин", label: "Одобрение" },
            ].map(({ value, label }) => (
              <div key={label} className="py-8 sm:py-10 flex flex-col items-center justify-center text-center px-2">
                <div className="text-[10px] sm:text-xs font-bold tracking-[0.2em] uppercase text-zinc-400 mb-1.5">{label}</div>
                <div className="text-2xl sm:text-4xl font-black text-white tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Условия сотрудничества ── */}
      <section id="conditions" className="bg-white dark:bg-zinc-900 border-t-[3px] border-red-500">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-0.5 bg-red-500" />
            <span className="text-[10px] font-black tracking-[0.25em] uppercase text-red-500">
              Условия сотрудничества
            </span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-black leading-[1.05] tracking-tight text-zinc-950 dark:text-white mb-8">
            Простые и понятные условия
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {CONDITIONS.map(({ icon: Icon, title, points }) => (
              <div key={title} className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-6">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-black text-zinc-950 dark:text-white text-lg mb-3">{title}</h3>
                <ul className="space-y-1.5">
                  {points.map((p) => (
                    <li key={p} className="text-sm text-zinc-600 dark:text-zinc-400 leading-snug flex gap-2">
                      <CheckCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Почему BOOOMERANGS ── */}
      <section className="bg-zinc-950 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div className="text-center mb-10">
            <p className="text-[11px] font-black tracking-[0.25em] uppercase text-zinc-300 mb-4">
              Почему BOOOMERANGS
            </p>
            <h2 className="text-3xl sm:text-5xl font-black leading-[1.05] tracking-tight">
              Производитель, а не посредник
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {WHY_US.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-4 p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <div className="w-10 h-10 rounded-lg bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-black text-white text-base mb-1.5">{title}</div>
                  <div className="text-sm text-zinc-400 leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Как начать ── */}
      <section className="bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-black leading-tight tracking-tight text-zinc-950 dark:text-white">
              Как начать
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {STEPS.map((s, i) => (
              <div key={s.title} className="relative p-6 rounded-2xl border border-zinc-200 dark:border-zinc-700">
                <div className="w-9 h-9 rounded-full bg-red-600 text-white font-black flex items-center justify-center mb-4">
                  {i + 1}
                </div>
                <h3 className="font-black text-zinc-950 dark:text-white text-lg mb-2">{s.title}</h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center gap-6">
            <Button asChild className="gap-2 bg-red-600 hover:bg-red-700 text-white">
              <Link href="/wholesale/register" data-testid="link-wholesale-register-cta">
                Оставить заявку
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-3xl">
              <a
                href="tel:+79051162902"
                className="flex flex-col items-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4 text-center hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground">
                  <Phone className="w-3.5 h-3.5" />
                  Связаться с менеджером
                </span>
                <span className="text-sm font-black text-zinc-950 dark:text-white">+7 905 116-29-02</span>
              </a>
              <a
                href="mailto:info@booomerangs.ru"
                className="flex flex-col items-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4 text-center hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground">
                  <Mail className="w-3.5 h-3.5" />
                  Почта
                </span>
                <span className="text-sm font-black text-zinc-950 dark:text-white break-all">info@booomerangs.ru</span>
              </a>
              <a
                href="tel:+79606000044"
                className="flex flex-col items-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4 text-center hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground">
                  <Phone className="w-3.5 h-3.5" />
                  Отдел продаж
                </span>
                <span className="text-sm font-black text-zinc-950 dark:text-white">8 960 600 00 44</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <h2 className="text-3xl sm:text-4xl font-black leading-tight tracking-tight text-zinc-950 dark:text-white text-center mb-8">
            Частые вопросы
          </h2>
          <div className="space-y-3">
            {WHOLESALE_FAQ.map((f) => (
              <div key={f.q} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
                <h3 className="font-black text-zinc-950 dark:text-white text-base mb-1.5">{f.q}</h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
