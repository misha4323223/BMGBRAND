import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import artistBannerDesktop from "@assets/artist-banner-desktop.webp";
import artistBannerMobile from "@assets/artist-banner-mobile.webp";
import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";
import { ChevronRight, ChevronLeft, ArrowLeft, BookOpen, Star } from "lucide-react";
import { ProgramInfoDialog, MediaInfoDialog } from "./partner/ProgramInfoDialog";

const PARTNER_SLIDES = [
  {
    desktop: "/partner-banner-desktop.webp",
    mobile: "/partner-banner-mobile.webp",
    alt: "Рекламируй BOOOMERANGS и зарабатывай",
    desktopAspect: "1739/904",
    mobileAspect: "1254/1254",
  },
  {
    desktop: artistBannerDesktop,
    mobile: artistBannerMobile,
    alt: "Создавай вместе с BOOOMERANGS — креаторская программа",
    desktopAspect: "1280/665",
    mobileAspect: "1254/1254",
  },
];

function PartnerBannerSlider({ firstSlideOverride }: { firstSlideOverride?: { desktop?: string; mobile?: string; alt?: string } }) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const next = useCallback(() => {
    setCurrent(c => (c + 1) % PARTNER_SLIDES.length);
  }, []);

  const prev = useCallback(() => {
    setCurrent(c => (c - 1 + PARTNER_SLIDES.length) % PARTNER_SLIDES.length);
  }, []);

  useEffect(() => {
    if (paused) return;
    timerRef.current = setTimeout(next, 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [current, paused, next]);

  const slides = PARTNER_SLIDES.map((s, i) => i === 0 ? {
    ...s,
    desktop: firstSlideOverride?.desktop || s.desktop,
    mobile: firstSlideOverride?.mobile || s.mobile,
    alt: firstSlideOverride?.alt || s.alt,
  } : s);

  const slide = slides[current];

  return (
    <div className="w-full relative select-none overflow-hidden">
      <button
        onClick={() => window.history.length > 1 ? window.history.back() : window.location.href = '/'}
        className="absolute top-4 left-4 z-20 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm text-white px-2 py-2 sm:px-3 rounded-full text-sm font-medium hover:bg-black/70 transition-colors"
        data-testid="button-back-hero"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="hidden sm:inline">Назад</span>
      </button>

      {slides.map((s, i) => (
        <div
          key={i}
          className={`transition-opacity duration-700 ${i === current ? "opacity-100" : "opacity-0 absolute inset-0"}`}
        >
          <img
            src={s.desktop}
            alt={s.alt}
            className="w-full h-auto hidden sm:block bg-zinc-100 dark:bg-zinc-900"
            style={{ aspectRatio: s.desktopAspect }}
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
          />
          <img
            src={s.mobile}
            alt={s.alt}
            className="w-full h-auto block sm:hidden bg-zinc-100 dark:bg-zinc-900"
            style={{ aspectRatio: s.mobileAspect }}
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
          />
        </div>
      ))}

      <button
        onClick={() => { prev(); setPaused(true); }}
        className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-20 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white rounded-full w-9 h-9 items-center justify-center transition-colors"
        aria-label="Предыдущий слайд"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        onClick={() => { next(); setPaused(true); }}
        className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-20 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white rounded-full w-9 h-9 items-center justify-center transition-colors"
        aria-label="Следующий слайд"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
        {PARTNER_SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => { setCurrent(i); setPaused(true); }}
            className={`rounded-full transition-all ${i === current ? "bg-white w-5 h-2" : "bg-white/50 w-2 h-2"}`}
            aria-label={`Слайд ${i + 1}`}
          />
        ))}
        <button
          onClick={() => setPaused(v => !v)}
          className="ml-1 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white rounded-full w-6 h-6 flex items-center justify-center transition-colors text-xs"
          aria-label={paused ? "Запустить" : "Пауза"}
        >
          {paused ? "▶" : "⏸"}
        </button>
      </div>
    </div>
  );
}

export default function PartnerLanding() {
  const { data: partnerRegisterSettings } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/partner_register"],
  });
  const { data: seoOverrides } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/seo"],
  });
  const partnerSeo = seoOverrides?.partner_register || {};
  const partnerHero = partnerRegisterSettings?.hero || {};
  const partnerSeoTitle = partnerSeo.title || "Партнёрская программа BOOOMERANGS — комиссия 15–25% и мерч для артистов";
  const partnerSeoDescription = partnerSeo.description || "Реферальная программа с комиссией 15–25% с каждого заказа и авторский мерч для артистов, блогеров и брендов. Своя ссылка, личный кабинет, выплаты без минимальной суммы.";
  const partnerFirstSlideOverride = (partnerHero.heroImage || partnerHero.heroImageMobile || partnerHero.heroImageAlt) ? {
    desktop: partnerHero.heroImage,
    mobile: partnerHero.heroImageMobile,
    alt: partnerHero.heroImageAlt,
  } : undefined;

  const [programInfoOpen, setProgramInfoOpen] = useState(false);
  const [mediaInfoOpen, setMediaInfoOpen] = useState(false);

  return (
    <>
      <SEO
        title={partnerSeoTitle}
        description={partnerSeoDescription}
        keywords="партнёрская программа одежда, заработок на рекомендациях, реферальная программа магазин одежды, партнёрка для самозанятых, комиссия с продаж одежды, партнёр бренда одежды, мерч для артистов, реферальная программа Россия, стать амбассадором бренда, партнёрская программа для блогеров, партнёрка для ИП, авторский мерч"
        canonical="https://booomerangs.ru/partner"
        ogImage="/og-partner.png"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": "Партнёрская программа BOOOMERANGS — комиссия 15–25% и мерч для артистов",
            "description": "Реферальная программа с комиссией 15–25% и авторский мерч для артистов, блогеров и брендов.",
            "url": "https://booomerangs.ru/partner",
            "publisher": {
              "@type": "Organization",
              "name": "BOOOMERANGS",
              "url": "https://booomerangs.ru",
              "logo": "https://booomerangs.ru/og-image.png"
            }
          },
          {
            "@context": "https://schema.org",
            "@type": "Service",
            "name": "Партнёрская программа BOOOMERANGS",
            "description": "Зарабатывайте 15–25% комиссии, рекомендуя одежду российского бренда BOOOMERANGS, или запустите свой мерч как артист, блогер или бренд. Программа доступна для самозанятых, ИП и юридических лиц.",
            "provider": {
              "@type": "Organization",
              "name": "BOOOMERANGS",
              "url": "https://booomerangs.ru"
            },
            "areaServed": "RU",
            "serviceType": "Партнёрская программа и производство мерча",
            "offers": {
              "@type": "Offer",
              "description": "Комиссия 15–25% с каждого оплаченного заказа по реферальной ссылке",
              "priceCurrency": "RUB"
            },
            "audience": {
              "@type": "Audience",
              "audienceType": "Самозанятые, ИП, юридические лица, блогеры, артисты, бренды"
            }
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
              {
                "@type": "Question",
                "name": "Сколько можно заработать в партнёрской программе BOOOMERANGS?",
                "acceptedAnswer": { "@type": "Answer", "text": "Комиссия составляет от 15% до 25% с каждого оплаченного заказа. Процент растёт в зависимости от объёма продаж за месяц. Потолка нет." }
              },
              {
                "@type": "Question",
                "name": "Кто может стать партнёром BOOOMERANGS?",
                "acceptedAnswer": { "@type": "Answer", "text": "Партнёром может стать самозанятый, индивидуальный предприниматель или юридическое лицо. Регистрация занимает несколько минут." }
              },
              {
                "@type": "Question",
                "name": "Как работает реферальная ссылка?",
                "acceptedAnswer": { "@type": "Answer", "text": "Вы получаете уникальную ссылку и промокод. Делитесь ими в соцсетях, блоге или мессенджерах. С каждого заказа по вашей ссылке начисляется комиссия в личном кабинете." }
              },
              {
                "@type": "Question",
                "name": "Есть ли минимальная сумма для вывода комиссии?",
                "acceptedAnswer": { "@type": "Answer", "text": "Минимальной суммы нет. После 14-дневного холда подайте заявку — выплатим на карту или расчётный счёт за 5 рабочих дней." }
              },
              {
                "@type": "Question",
                "name": "Что такое партнёрская программа для артистов и блогеров?",
                "acceptedAnswer": { "@type": "Answer", "text": "Артисты и блогеры получают персональную страницу на booomerangs.ru/@slug, собственную витрину мерча и договорной процент комиссии. Мы уже работаем с Гудтаймс, Молодостью внутри, Дикой Мятой и другими артистами." }
              },
              {
                "@type": "Question",
                "name": "Можно ли создать свой мерч через партнёрскую программу?",
                "acceptedAnswer": { "@type": "Answer", "text": "Да. Артисты и бренды могут заказать авторский мерч на нашем производстве и продавать его через свою страницу на BOOOMERANGS. Условия обсуждаются индивидуально." }
              },
              {
                "@type": "Question",
                "name": "Когда я получу деньги после продажи?",
                "acceptedAnswer": { "@type": "Answer", "text": "После оплаты заказа покупателем начинается 14-дневный холд (на случай возврата). После его окончания средства доступны к выводу. Выплата — 5 рабочих дней." }
              }
            ]
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Главная", "item": "https://booomerangs.ru" },
              { "@type": "ListItem", "position": 2, "name": "Партнёрская программа", "item": "https://booomerangs.ru/partner" }
            ]
          }
        ]}
      />
      <Helmet>
        <link rel="preload" as="image" href="/partner-banner-desktop.webp" media="(min-width: 640px)" />
        <link rel="preload" as="image" href="/partner-banner-mobile.webp" media="(max-width: 639px)" />
      </Helmet>

      {/* ── Hero: реальный текст + баннер ── */}
      <section className="bg-zinc-950 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-12 pb-8 text-center">
          <p className="text-[11px] font-black tracking-[0.25em] uppercase text-red-500 mb-4">
            Партнёрская программа
          </p>
          <h1 className="text-4xl sm:text-6xl font-black leading-[1.02] tracking-tight mb-5">
            Зарабатывай с BOOOMERANGS
          </h1>
          <p className="text-zinc-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed mb-7">
            Реферальная программа с комиссией 15–25% и авторский мерч для артистов, блогеров и брендов — на одном производстве и одном сайте.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/partner/register"
              data-testid="link-partner-register-hero"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
            >
              Стать партнёром
            </Link>
            <a
              href="#media-partners"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg border border-white/25 text-white text-sm font-semibold hover:bg-white hover:text-black transition-colors"
            >
              Для артистов и брендов
            </a>
          </div>
        </div>

        {/* Баннер-слайдер — визуальная поддержка */}
        <PartnerBannerSlider firstSlideOverride={partnerFirstSlideOverride} />
      </section>

      {/* ── REFERRAL PROGRAM — тёмная секция ── */}
      <section className="bg-zinc-950 text-white" data-testid="partner-program-benefits">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-10 text-center">
          <p className="text-[11px] font-black tracking-[0.25em] uppercase text-zinc-300 mb-5">
            Реферальная программа
          </p>
          <h2 className="text-3xl sm:text-5xl font-black leading-[1.05] tracking-tight mb-5">
            Ваш контент&nbsp;—&nbsp;ваш бизнес
          </h2>
          <p className="text-zinc-200 text-base max-w-md mx-auto leading-relaxed">
            Рекламируй BOOOMERANGS и зарабатывай комиссию с каждого заказа по твоей ссылке
          </p>
        </div>

        <div className="border-t border-zinc-800">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 grid grid-cols-3 divide-x divide-zinc-800">
            {[
              { value: "15–25%", label: "Комиссия" },
              { value: "30 дн.", label: "Атрибуция" },
              { value: "5 дн.",  label: "Выплата" },
            ].map(({ value, label }) => (
              <div key={label} className="py-10 sm:py-12 flex flex-col items-center justify-center text-center px-2">
                <div className="text-3xl sm:text-5xl font-black text-white tabular-nums mb-1.5">{value}</div>
                <div className="text-[10px] sm:text-xs font-bold tracking-[0.2em] uppercase text-zinc-400">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-zinc-800">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12">
            {[
              { label: "Личный кабинет",        desc: "Статистика кликов, заказов и комиссий в реальном времени. Всегда видишь, сколько заработал." },
              { label: "Своя ссылка и витрина", desc: "Реферальная ссылка /r/ваш-slug и витрина /partner/ваш-slug — делись где угодно." },
              { label: "Выплаты без минималки", desc: "Подай заявку после холда — выплатим на карту или расчётный счёт за 5 рабочих дней." },
            ].map(({ label, desc }) => (
              <div key={label}>
                <div className="w-8 h-0.5 bg-red-500 mb-5" />
                <h3 className="font-black text-white text-lg mb-2 leading-tight">{label}</h3>
                <p className="text-sm text-zinc-300 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-zinc-800">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-400">Уже есть аккаунт?</span>
              <a
                href="/partner/login"
                data-testid="link-partner-login"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-white text-white text-sm font-semibold hover:bg-white hover:text-black transition-colors duration-150"
              >
                Войти
              </a>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setProgramInfoOpen(true)}
              data-testid="button-program-info"
              className="gap-2 border-zinc-700 text-white bg-transparent hover:bg-zinc-800 hover:text-white hover:border-zinc-600"
            >
              <BookOpen className="w-4 h-4" />
              Подробнее об условиях
            </Button>
          </div>
        </div>
      </section>

      {/* ── MEDIA PARTNERS — контрастная красная секция ── */}
      <section id="media-partners" className="bg-white dark:bg-zinc-900 border-t-[3px] border-red-500">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-0.5 bg-red-500" />
            <span className="text-[10px] font-black tracking-[0.25em] uppercase text-red-500">
              Для артистов, блогеров, сообществ и брендов
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-12 sm:gap-16 items-start mb-10">
            <div>
              <h2 className="text-3xl sm:text-4xl font-black leading-[1.05] tracking-tight text-zinc-950 dark:text-white mb-5">
                Своя страница.<br />Свой мерч.<br />Свои правила.
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-xs">
                Персональная страница на BOOOMERANGS, авторская коллекция и договорной процент — подключись как медийный партнёр.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6">
              {[
                { label: "Своя страница",  desc: "Персональный лендинг с галереей, описанием и соцсетями — booomerangs.ru/@ваш-slug" },
                { label: "Витрина мерча",  desc: "Все товары коллаборации на твоей странице — покупатели приходят напрямую к тебе." },
                { label: "Авторский мерч", desc: "Совместные коллекции под своим именем — зарабатывай с каждой продажи." },
              ].map(({ label, desc }) => (
                <div key={label} className="flex gap-4">
                  <div className="w-0.5 bg-red-500 shrink-0 self-stretch" />
                  <div>
                    <div className="font-black text-zinc-950 dark:text-white text-base mb-1">{label}</div>
                    <div className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}

              <a href="/merch-na-zakaz" className="flex gap-4 group mt-2 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors" data-testid="link-merch-order">
                <div className="w-0.5 bg-zinc-300 dark:bg-zinc-600 group-hover:bg-red-500 shrink-0 self-stretch transition-colors" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="font-black text-zinc-950 dark:text-white text-base">Мерч под заказ</div>
                    <span className="text-[10px] font-bold tracking-wider uppercase text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded-full">Производство</span>
                  </div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">Нет готового мерча? Производим под ключ — дизайн, тираж, контроль качества. Размещаем на сайте, ты зарабатываешь.</div>
                  <div className="text-xs font-bold text-red-500 mt-2 group-hover:underline">Узнать о производстве →</div>
                </div>
              </a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-8 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center shrink-0 mt-0.5">
                <Star className="w-3 h-3 text-white fill-white" />
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-snug max-w-sm">
                <strong className="text-zinc-950 dark:text-white">Процент комиссии — договорной.</strong>{" "}
                Обсуждается индивидуально в зависимости от формата сотрудничества.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setMediaInfoOpen(true)}
              data-testid="button-media-info"
              className="gap-2 bg-red-600 hover:bg-red-700 text-white shrink-0"
            >
              <Star className="w-4 h-4" />
              Для медийных партнёров
            </Button>
          </div>
        </div>
      </section>

      <ProgramInfoDialog open={programInfoOpen} onOpenChange={setProgramInfoOpen} />
      <MediaInfoDialog open={mediaInfoOpen} onOpenChange={setMediaInfoOpen} />

      <Footer />
    </>
  );
}
