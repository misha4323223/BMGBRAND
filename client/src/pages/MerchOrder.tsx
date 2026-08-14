import { useState } from "react";
import merchBannerDesktop from "@assets/merch-banner-desktop.webp";
import merchBannerMobile from "@assets/merch-banner-mobile.webp";
import SEO from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Package, Palette, Truck, Users, Zap, ChevronRight, Store, Percent, Handshake, ArrowRight, ShieldCheck, Clock, Star } from "lucide-react";
import { Link } from "wouter";

const WHAT_WE_MAKE = [
  { name: "Футболки", desc: "Оверсайз и классика", emoji: "👕" },
  { name: "Худи, свитшоты и свитера", desc: "", emoji: "🧥" },
  { name: "Брюки, джоггеры и джинсы", desc: "", emoji: "👖" },
  { name: "Носки", desc: "Любые принты, 200+ дизайнов, от 50 пар", emoji: "🧦" },
  { name: "Аксессуары", desc: "Кружки, шапки, сумки, панамы, ремни", emoji: "🎒" },
  { name: "Упаковка", desc: "Брендированные пакеты, бирки, коробки", emoji: "📦" },
];

const STEPS = [
  { num: "01", title: "Заявка", desc: "Заполните форму. Опишите идею, тип товара и тираж." },
  { num: "02", title: "Обсуждение", desc: "Менеджер свяжется в течение 24 часов. Уточним детали и стоимость." },
  { num: "03", title: "Дизайн", desc: "Разработаем стиль с нуля или адаптируем ваши материалы." },
  { num: "04", title: "Производство", desc: "Запускаем тираж на собственном производстве — полный контроль качества." },
  { num: "05", title: "Доставка", desc: "Отправим готовый мерч по всей России." },
];

const STATS = [
  { value: "5+", label: "лет на рынке" },
  { value: "200+", label: "дизайнов носков" },
  { value: "от 20", label: "штук в тираже" },
  { value: "24 ч", label: "ответ на заявку" },
];

const CLIENTS = [
  { name: "ГУДТАЙМС", type: "Музыкальный артист", desc: "Официальный мерч - коллаборационные футболки, худи, носки" },
  { name: "ДИКАЯ МЯТА", type: "Музыкальный фестиваль", desc: "Мерч для фестиваля - одежда, аксессуары, носки" },
  { name: "МОЛОДОСТЬ ВНУТРИ", type: "Музыкальный артист", desc: "Официальный мерч - лимитированные коллекции" },
  { name: "ДРАГНИ", type: "Музыкальный артист", desc: "Официальный мерч - брендовая одежда и аксессуары" },
  { name: "МультFильмы", type: "Музыкальный артист", desc: "Мерч с уникальным авторским стилем" },
];

const FAQ_ITEMS = [
  {
    question: "Какой минимальный тираж для создания мерча на заказ?",
    answer: "Минимальный тираж зависит от типа продукции: носки - от 50 пар, футболки и худи - от 1 штуки, аксессуары - от 30 единиц.",
  },
  {
    question: "Сколько стоит мерч на заказ?",
    answer: "Стоимость зависит от типа изделия, тиража и сложности принта. Точный расчёт делаем индивидуально - после того, как вы расскажете о задаче.",
  },
  {
    question: "Вы помогаете с разработкой дизайна?",
    answer: "Да. Мы предоставляем полный цикл: от разработки концепции и дизайна до готовой продукции. Если у вас уже есть макет - адаптируем его под производство. Дизайнерская работа включена в стоимость заказа.",
  },
  {
    question: "Сколько времени занимает изготовление?",
    answer: "Одежда - от 3 дней. Носки - от 14 рабочих дней. Срочные заказы обсуждаются отдельно.",
  },
  {
    question: "Вы работаете с физическими лицами, блогерами и артистами?",
    answer: "Да. Работаем с физлицами, ИП, ООО, блогерами, музыкантами и организаторами мероприятий. Опыт: Гудтаймс, Молодость внутри, Дикая Мята, Драгни, МультFильмы.",
  },
  {
    question: "Можно ли заказать мерч с моим логотипом или фирменным стилем?",
    answer: "Конечно. Предоставьте логотип в векторном формате (AI, EPS, SVG) или в хорошем разрешении - подготовим макет. Если фирменного стиля нет - разработаем с нуля.",
  },
  {
    question: "Как выглядит качество продукции?",
    answer: "Носки — хлопок 75%, полиамид 17%, эластан 8%. Одежда выпускается из различных тканей на выбор — уточняйте у менеджера. Перед отгрузкой — контроль качества каждой партии.",
  },
  {
    question: "Вы доставляете в другие города и регионы?",
    answer: "Да, отправляем по всей России. Работаем с СДЭК, ПЭК, Почтой России, Байкал Сервисом. По другим перевозчикам — уточняйте у менеджера.",
  },
  {
    question: "Что происходит, если в партии окажется брак?",
    answer: "Мы несём полную ответственность за качество. Если обнаружен брак - перевыпускаем бракованные позиции за наш счёт или компенсируем стоимость. Перед отгрузкой каждая партия проходит контроль качества.",
  },
];

const orderSchema = z.object({
  name: z.string().min(2, "Введите имя"),
  company: z.string().optional(),
  productType: z.string().min(2, "Укажите тип товара"),
  quantity: z.string().min(1, "Укажите тираж"),
  contact: z.string().min(5, "Укажите телефон, email или Telegram"),
  message: z.string().optional(),
  wantPartner: z.boolean().optional(),
});

type OrderForm = z.infer<typeof orderSchema>;

export default function MerchOrder() {
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [wantedPartner, setWantedPartner] = useState(false);

  const { data: merchSettings } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/merch_order"],
  });
  const { data: seoOverrides } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/seo"],
  });
  const merchSeo = seoOverrides?.merch_order || {};
  const merchHero = (merchSettings?.hero as Record<string, string>) || {};
  const merchContent = (merchSettings?.content as Record<string, any>) || {};
  const seoTitle = (merchSeo as any).title || "Мерч на заказ — футболки, худи, носки с принтом от 180 ₽ | BMGBRAND";
  const seoDescription = (merchSeo as any).description || "Производство мерча на заказ от BMGBRAND: футболки от 900 ₽, худи от 1800 ₽, носки от 180 ₽/пара. Тираж от 20 шт. Разработка дизайна бесплатно. Работаем с блогерами, артистами, компаниями. Доставка по всей России — Тула, Москва, регионы.";
  const heroDesktopSrc: string = merchHero.heroImage || (merchBannerDesktop as unknown as string);
  const heroMobileSrc: string = merchHero.heroImageMobile || (merchBannerMobile as unknown as string);
  const heroAlt: string = merchHero.heroImageAlt || "Мерч на заказ — производство под ключ, доставка по всей России";
  const pageH1: string = merchContent.h1 || "Мерч на заказ — производство мерча под ключ от BMGBRAND";
  const techText: string = merchContent.techText || "";
  const b2bText: string = merchContent.b2bText || "";
  const faqItemsResolved: Array<{ question: string; answer: string }> =
    Array.isArray(merchContent.faqItems) && merchContent.faqItems.length > 0
      ? merchContent.faqItems
      : FAQ_ITEMS;

  const form = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: { name: "", company: "", productType: "", quantity: "", contact: "", message: "", wantPartner: false },
  });

  const mutation = useMutation({
    mutationFn: (data: OrderForm) => apiRequest("POST", "/api/merch-order", data),
    onSuccess: (_res, variables) => {
      setWantedPartner(!!variables.wantPartner);
      setSubmitted(true);
      form.reset();
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Попробуйте ещё раз или напишите нам напрямую.", variant: "destructive" });
    },
  });

  const onSubmit = (data: OrderForm) => mutation.mutate(data);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "name": "BMGBRAND (Booomerangs)",
      "url": "https://booomerangs.ru",
      "image": "https://booomerangs.ru/og-image.png",
      "description": "Производство мерча на заказ под ключ: футболки, худи, носки, аксессуары с авторскими принтами. Работаем по всей России.",
      "address": { "@type": "PostalAddress", "addressLocality": "Тула", "addressRegion": "Тульская область", "addressCountry": "RU" },
      "areaServed": "RU",
      "priceRange": "от 180 ₽",
      "sameAs": [
        "https://vk.com/bmgbrand",
        "https://t.me/bmg_booomerangs",
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "Мерч на заказ — BMGBRAND (Booomerangs)",
      "url": "https://booomerangs.ru/merch-na-zakaz",
      "speakable": {
        "@type": "SpeakableSpecification",
        "cssSelector": ["#merch-hero-desc", "#merch-faq"],
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      "name": "Как заказать мерч в BMGBRAND",
      "description": "Производство мерча на заказ под ключ: от заявки до доставки по всей России.",
      "step": STEPS.map((s) => ({
        "@type": "HowToStep",
        "position": parseInt(s.num),
        "name": s.title,
        "text": s.desc,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      "name": "Создание мерча на заказ",
      "provider": {
        "@type": "Organization",
        "name": "BMGBRAND",
        "url": "https://booomerangs.ru",
        "address": { "@type": "PostalAddress", "addressLocality": "Тула", "addressCountry": "RU" },
      },
      "description": "Производство мерча на заказ под ключ: футболки, худи, носки, аксессуары с авторскими принтами. Работаем с блогерами, артистами, компаниями по всей России. Тираж от 20 штук.",
      "areaServed": "RU",
      "serviceType": "Производство мерча",
      "offers": [
        { "@type": "Offer", "name": "Носки с принтом на заказ", "priceCurrency": "RUB", "price": "180", "description": "Носки с принтом от 180 ₽/пара при тираже от 50 пар. 200+ дизайнов." },
        { "@type": "Offer", "name": "Футболки на заказ", "priceCurrency": "RUB", "price": "900", "description": "Футболки с принтом от 900 ₽ при тираже от 20 штук. 100% хлопок." },
        { "@type": "Offer", "name": "Худи на заказ", "priceCurrency": "RUB", "price": "1800", "description": "Худи и свитшоты от 1 800 ₽ при тираже от 20 штук. Трёхнитка." },
        { "@type": "Offer", "name": "Брюки и джоггеры на заказ", "priceCurrency": "RUB", "price": "1500", "description": "Брюки и джоггеры от 1 500 ₽ при тираже от 20 штук." },
        { "@type": "Offer", "name": "Корпоративный мерч", "priceCurrency": "RUB", "price": "180", "description": "Мерч для компаний, мероприятий, фестивалей. Брендирование под ключ." },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqItemsResolved.map(item => ({
        "@type": "Question",
        "name": item.question,
        "acceptedAnswer": { "@type": "Answer", "text": item.answer },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": "https://booomerangs.ru" },
        { "@type": "ListItem", "position": 2, "name": "Мерч на заказ", "item": "https://booomerangs.ru/merch-na-zakaz" },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="page-merch-order">
      <SEO
        title={seoTitle}
        description={seoDescription}
        keywords="мерч на заказ, создать мерч, заказать мерч, производство мерча, мерч для блогеров, мерч для артистов, корпоративный мерч, футболки на заказ, носки на заказ, худи на заказ с принтом, мерч Тула, брендированная одежда на заказ, мерч для мероприятий, мерч для фестиваля, печать на одежде, одежда с принтом на заказ, мерч под ключ"
        ogImage="/og-image.png"
        jsonLd={jsonLd}
        canonical="https://booomerangs.ru/merch-na-zakaz"
      />
      <Navbar />
      <h1 className="sr-only">{pageH1}</h1>

      {/* ── HERO - мобильный (баннер полностью + кнопки снизу) ── */}
      <div className="block sm:hidden bg-zinc-950" data-testid="merch-order-hero">
        <img
          src={heroMobileSrc}
          alt={heroAlt}
          className="w-full h-auto"
          loading="eager"
        />
        <div className="px-4 pt-5 pb-6 flex flex-col gap-3">
          <div className="mb-1">
            <p id="merch-hero-desc" className="text-xs text-zinc-400 leading-snug">
              Собственное производство — одежда, аксессуары и носки с авторскими принтами
            </p>
          </div>
          <Button
            size="lg"
            className="uppercase tracking-wider text-sm font-bold h-12 w-full"
            data-testid="btn-order-form-mobile"
            onClick={() => document.getElementById("order-form")?.scrollIntoView({ behavior: "smooth" })}
          >
            Оставить заявку <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="uppercase tracking-wider text-sm h-12 w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white bg-zinc-900"
            data-testid="btn-catalog-link-mobile"
            asChild
          >
            <Link href="/products/merch">Смотреть примеры работ</Link>
          </Button>
        </div>
      </div>

      {/* ── HERO - десктоп (баннер как фон, заголовок + кнопки поверх) ── */}
      <section
        className="relative min-h-[92vh] flex-col justify-end bg-zinc-950 overflow-hidden hidden sm:flex"
        data-testid="merch-order-hero-desktop"
      >
        <img
          src={heroDesktopSrc}
          alt={heroAlt}
          className="absolute inset-0 w-full h-full object-cover object-center"
          loading="eager"
        />
        {/* Тёмный оверлей поверх фото */}
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/60 via-zinc-950/25 to-transparent" />

        <div className="relative z-10 max-w-6xl mx-auto px-6 pb-16 pt-40 w-full">
          <p className="text-sm sm:text-base text-zinc-300 mb-7 max-w-md leading-relaxed">
            Собственное производство — одежда, аксессуары и носки с авторскими принтами
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              size="lg"
              className="uppercase tracking-wider text-sm font-bold h-12 px-8"
              data-testid="btn-order-form"
              onClick={() => document.getElementById("order-form")?.scrollIntoView({ behavior: "smooth" })}
            >
              Оставить заявку <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="uppercase tracking-wider text-sm h-12 px-8 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white bg-transparent"
              data-testid="btn-catalog-link"
              asChild
            >
              <Link href="/products/merch">Смотреть примеры работ</Link>
            </Button>
          </div>
        </div>

        {/* Статы - полоса внизу hero */}
        <div className="relative z-10 border-t border-zinc-800 w-full">
          <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 sm:grid-cols-4">
            {STATS.map((s, i) => (
              <div
                key={i}
                className="py-5 px-4 border-r border-zinc-800 last:border-r-0 sm:[&:nth-child(2)]:border-r"
              >
                <p className="text-2xl sm:text-3xl font-black text-white leading-none mb-1">{s.value}</p>
                <p className="text-xs text-zinc-500 uppercase tracking-widest">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ЧТО МЫ ПРОИЗВОДИМ - светлая ── */}
      <section className="py-20 px-6 bg-background" data-testid="merch-order-products">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-12">
            <div>
              <p className="text-xs font-medium tracking-[0.3em] uppercase text-primary mb-2">Продукция</p>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight">
                Что мы производим
              </h2>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">Собственное производство — полный цикл без посредников</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {WHAT_WE_MAKE.map((item) => (
              <div
                key={item.name}
                className="group relative border border-border rounded-2xl p-5 sm:p-6 bg-card hover:border-primary/40 hover:bg-card/80 transition-all duration-200 cursor-default overflow-hidden"
                data-testid={`merch-product-${item.name}`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                <p className="text-2xl mb-3">{item.emoji}</p>
                <h3 className="font-black text-sm sm:text-base uppercase tracking-tight mb-1">{item.name}</h3>
                {item.desc && <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SEO-ТЕКСТОВЫЙ БЛОК - ключевые запросы + технологии + гео ── */}
      <section className="py-16 px-6 bg-zinc-950" data-testid="merch-order-seo-text">
        <div className="max-w-6xl mx-auto">
          <div className="grid sm:grid-cols-3 gap-8">
            <div>
              <h2 className="text-base font-black uppercase tracking-tight text-white mb-3">
                Футболки с логотипом на заказ
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Оверсайз и классический крой с нанесением логотипа или авторского принта — от 900&nbsp;₽. Шелкография, термотрансфер. Подходит для корпоративных подарков, мерча блогеров, фирменной одежды сотрудников.
              </p>
            </div>
            <div>
              <h2 className="text-base font-black uppercase tracking-tight text-white mb-3">
                Худи и толстовки с принтом
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Трёхнитка с начёсом, вышивка или шелкография — от 1&nbsp;800&nbsp;₽. Собственный пошив на производстве в Туле. Популярный формат мерча для музыкантов, спортивных команд и корпоративного гардероба.
              </p>
            </div>
            <div>
              <h2 className="text-base font-black uppercase tracking-tight text-white mb-3">
                Носки с символикой компании
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                От 180&nbsp;₽/пара при тираже от 50 пар. 200+ авторских дизайнов. Хлопок 75%, полиамид 17%, эластан 8%. Один из самых популярных форматов корпоративных подарков для партнёров.
              </p>
            </div>
          </div>

          <div className="mt-10 pt-8 border-t border-zinc-800 grid sm:grid-cols-2 gap-8">
            <div>
              <p className="text-xs font-medium tracking-[0.3em] uppercase text-primary mb-2">Технологии нанесения</p>
              <p className="text-sm text-zinc-400 leading-relaxed">
                {techText || <>Используем <strong className="text-zinc-200">шелкографию</strong>, <strong className="text-zinc-200">термотрансфер</strong> и <strong className="text-zinc-200">вышивку</strong> — долговечный яркий принт после многократных стирок. Подбираем технологию под ваш дизайн и тираж.</>}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium tracking-[0.3em] uppercase text-primary mb-2">Корпоративный мерч и B2B</p>
              <p className="text-sm text-zinc-400 leading-relaxed">
                {b2bText || <>Работаем с юридическими лицами и ИП — закрывающие документы, договор, счёт. Тираж от 20 штук одежды или от 50 пар носков. Доставляем по всей России: <strong className="text-zinc-200">Москва</strong>, <strong className="text-zinc-200">Санкт-Петербург</strong> и регионы.</>}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── КАК ЭТО РАБОТАЕТ - тёмная ── */}
      <section className="py-20 px-6 bg-zinc-950" data-testid="merch-order-process">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-medium tracking-[0.3em] uppercase text-zinc-500 mb-2">Процесс</p>
          <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white mb-14">
            Как это работает
          </h2>
          <div className="relative">
            {/* Линия соединения */}
            <div className="hidden sm:block absolute top-8 left-[calc(10%-8px)] right-[calc(10%-8px)] h-px bg-zinc-700" />
            <div className="grid sm:grid-cols-5 gap-6">
              {STEPS.map((step, i) => (
                <div key={step.num} className="relative flex flex-col" data-testid={`step-${step.num}`}>
                  {/* Кружок */}
                  <div className="relative z-10 w-16 h-16 rounded-full border border-zinc-700 bg-zinc-900 flex items-center justify-center mb-4 shrink-0">
                    <span className="text-lg font-black text-primary leading-none">{step.num}</span>
                  </div>
                  <p className="font-black text-sm uppercase tracking-tight text-white mb-2">{step.title}</p>
                  <p className="text-xs text-zinc-500 leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── ПОЧЕМУ BMGBRAND - светлая ── */}
      <section className="py-20 px-6 bg-background" data-testid="merch-order-why">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-12">
            <div>
              <p className="text-xs font-medium tracking-[0.3em] uppercase text-primary mb-2">Преимущества</p>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight">
                Почему BMGBRAND
              </h2>
            </div>
          </div>

          {/* Большие карточки с числами */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
            {[
              { num: "100%", label: "собственное производство", sub: "Никаких посредников" },
              { num: "2 нед", label: "стандартный срок пошива", sub: "" },
              { num: "от 1 шт", label: "минимальный тираж одежды", sub: "Носки - от 50 пар" },
              { num: "0₽", label: "предоплата за дизайн", sub: "" },
            ].map((s) => (
              <div key={s.num} className="rounded-2xl bg-zinc-950 text-white p-5 sm:p-6 flex flex-col justify-between min-h-[120px]">
                <p className="text-2xl sm:text-3xl font-black text-primary leading-none mb-2">{s.num}</p>
                <div>
                  <p className="text-xs font-semibold text-zinc-300 leading-snug mb-0.5">{s.label}</p>
                  {s.sub && <p className="text-[11px] text-zinc-600">{s.sub}</p>}
                </div>
              </div>
            ))}
          </div>

          {/* Фичи */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Package, title: "Собственное производство", desc: "Всё делаем сами. Полный контроль качества на каждом этапе." },
              { icon: Palette, title: "Разработка дизайна", desc: "Дизайнеры создадут стиль с нуля или адаптируют ваши материалы." },
              { icon: Users, title: "Опыт с артистами", desc: "Гудтаймс, Молодость внутри, Дикая Мята, Драгни, МультFильмы." },
              { icon: Clock, title: "Сжатые сроки", desc: "Носки - от 14 рабочих дней. Одежда - от 3 дней. Срочные - по договорённости." },
              { icon: Truck, title: "Доставка по всей России", desc: "СДЭК, ПЭК, Почта России, Байкал Сервис. По другим перевозчикам — уточняйте у менеджера." },
              { icon: ShieldCheck, title: "Гарантия качества", desc: "Брак - перевыпускаем за наш счёт. Каждая партия проходит контроль перед отгрузкой." },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="flex gap-4 p-5 rounded-2xl border border-border hover:border-primary/30 hover:bg-card/60 transition-all duration-200"
                data-testid={`why-${title}`}
              >
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h3 className="font-bold text-sm mb-1">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ПРОИЗВОДИМ + ПРОДАЁМ - тёмная ── */}
      <section className="py-20 px-6 bg-zinc-950" data-testid="merch-sell-together">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-medium tracking-[0.35em] uppercase text-primary mb-3">
            Партнёрская программа
          </p>
          <h2 className="text-3xl sm:text-5xl font-black uppercase tracking-tighter text-white mb-4 leading-tight">
            Мы не просто<br />производим мерч&nbsp;-<br />
            <span className="text-primary">мы помогаем его продавать</span>
          </h2>
          <p className="text-sm sm:text-base text-zinc-400 max-w-2xl mb-12 leading-relaxed">
            Закажите мерч и станьте партнёром BOOOMERANGS. Ваша аудитория - ваши проценты.
            Размещаем ваш мерч на нашем сайте, вы делитесь ссылкой, мы отправляем заказы и выплачиваем комиссию.
          </p>
          <div className="grid sm:grid-cols-3 gap-4 mb-10">
            {[
              {
                icon: Package,
                step: "01",
                title: "Производим",
                desc: "Создаём мерч под ключ на собственном производстве. Дизайн, тираж, контроль качества.",
              },
              {
                icon: Store,
                step: "02",
                title: "Размещаем",
                desc: "Ваша страница на booomerangs.ru с вашим мерчем и реферальной ссылкой. Готово к продажам.",
              },
              {
                icon: Percent,
                step: "03",
                title: "Продаём",
                desc: "Ваша аудитория покупает - вы получаете комиссию с каждого заказа. Условия обсуждаются индивидуально.",
              },
            ].map(({ icon: Icon, step, title, desc }) => (
              <div
                key={title}
                className="relative bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col gap-3 hover:border-primary/30 transition-colors duration-200"
                data-testid={`sell-step-${step}`}
              >
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-3xl font-black text-primary/20 leading-none">{step}</span>
                  <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <p className="font-black text-base uppercase tracking-tight text-white">{title}</p>
                <p className="text-sm text-zinc-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-5 bg-zinc-900 border border-zinc-700 rounded-2xl">
            <Handshake className="w-8 h-8 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-white mb-0.5">Готовы сотрудничать?</p>
              <p className="text-xs text-zinc-500">Оставьте заявку ниже и отметьте галочку - менеджер расскажет о партнёрстве при первом звонке. Или сразу регистрируйтесь.</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="text-xs uppercase tracking-wider whitespace-nowrap border-zinc-700 text-zinc-300 hover:bg-zinc-800 bg-transparent"
                data-testid="btn-sell-order"
                onClick={() => document.getElementById("order-form")?.scrollIntoView({ behavior: "smooth" })}
              >
                Заявка на мерч
              </Button>
              <Button
                size="sm"
                className="text-xs uppercase tracking-wider whitespace-nowrap"
                data-testid="btn-sell-partner"
                asChild
              >
                <Link href="/partner/register">Стать партнёром</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── НАШИ РАБОТЫ - светлая ── */}
      <section className="py-20 px-6 bg-background" data-testid="merch-order-clients">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-12">
            <div>
              <p className="text-xs font-medium tracking-[0.3em] uppercase text-primary mb-2">Портфолио</p>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight">
                Наши работы
              </h2>
            </div>
            <Link
              href="/products/merch"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
              data-testid="link-see-merch"
            >
              Весь каталог <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CLIENTS.map((client, i) => (
              <div
                key={client.name}
                className="group relative rounded-2xl border border-border bg-card p-6 overflow-hidden hover:border-primary/30 transition-all duration-200"
                data-testid={`client-${client.name}`}
              >
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/30 group-hover:bg-primary transition-colors duration-200 rounded-l-2xl" />
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-zinc-900 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                    <Star className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">{client.type}</p>
                    <p className="font-black text-sm uppercase tracking-tight">{client.name}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{client.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ЧАСТО ЗАКАЗЫВАЮТ - внутренняя перелинковка ── */}
      <section className="py-16 px-6 bg-background" data-testid="merch-order-popular">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <p className="text-xs font-medium tracking-[0.3em] uppercase text-primary mb-2">Популярное</p>
              <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">Часто заказывают</h2>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { href: "/products/clothing", label: "Футболки бланковые / с принтами", sub: "от 900 ₽" },
              { href: "/products/clothing", label: "Худи, свитшоты", sub: "от 1 800 ₽" },
              { href: "/products/socks", label: "Носки с логотипом", sub: "от 180 ₽/пара" },
              { href: "/products/accessories", label: "Аксессуары", sub: "шапки, сумки, кепки" },
              { href: "/products/merch", label: "Мерч для артистов", sub: "под ключ" },
            ].map(({ href, label, sub }) => (
              <Link
                key={label}
                href={href}
                className="group flex flex-col gap-1 p-4 rounded-2xl border border-border hover:border-primary/40 hover:bg-card/60 transition-all duration-200"
                data-testid={`popular-link-${label}`}
              >
                <span className="text-sm font-bold leading-snug group-hover:text-primary transition-colors">{label}</span>
                <span className="text-xs text-muted-foreground">{sub}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ - тёмная ── */}
      <section id="merch-faq" className="py-20 px-6 bg-zinc-950" data-testid="merch-order-faq">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-medium tracking-[0.3em] uppercase text-zinc-500 mb-2">FAQ</p>
          <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white mb-12">
            Частые вопросы
          </h2>
          <Accordion type="single" collapsible className="space-y-2">
            {faqItemsResolved.map((item, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="border border-zinc-800 rounded-xl px-5 data-[state=open]:bg-zinc-900 transition-colors duration-150"
                data-testid={`faq-item-${i}`}
              >
                <AccordionTrigger className="text-sm font-semibold text-left py-4 hover:no-underline text-zinc-200 hover:text-white">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-zinc-400 leading-relaxed pb-4">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ── ФОРМА - светлая ── */}
      <section className="py-20 px-6 bg-background" id="order-form" data-testid="merch-order-form-section">
        <div className="max-w-2xl mx-auto">
          {submitted ? (
            <div className="text-center py-6" data-testid="merch-order-success">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 mb-5">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tight mb-2">Заявка отправлена!</h2>
              <p className="text-sm text-muted-foreground mb-8 max-w-sm mx-auto">
                Менеджер свяжется в течение 24 часов. Обсудим детали, сроки и стоимость.
              </p>
              {wantedPartner ? (
                <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-left mb-6 max-w-sm mx-auto" data-testid="merch-success-partner-block">
                  <div className="flex items-center gap-2 mb-3">
                    <Handshake className="w-5 h-5 text-primary shrink-0" />
                    <p className="font-bold text-sm">Отлично! Расскажем о партнёрстве</p>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                    Менеджер знает о вашем интересе к партнёрству и расскажет всё на звонке. А пока - можете зарегистрироваться прямо сейчас.
                  </p>
                  <Button size="sm" className="w-full uppercase tracking-wider text-xs font-bold" asChild data-testid="btn-success-register-partner">
                    <Link href="/partner/register">Зарегистрироваться как партнёр</Link>
                  </Button>
                </div>
              ) : (
                <div className="bg-card border border-border rounded-2xl p-5 text-left mb-6 max-w-sm mx-auto" data-testid="merch-success-partner-hint">
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Хотите также зарабатывать на продажах своего мерча? Ваша аудитория - ваши проценты.
                  </p>
                  <Button size="sm" variant="outline" className="w-full uppercase tracking-wider text-xs" asChild data-testid="btn-success-learn-partner">
                    <Link href="/partner/register">Узнать о партнёрской программе</Link>
                  </Button>
                </div>
              )}
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setSubmitted(false)} data-testid="btn-success-new-order">
                Отправить ещё одну заявку
              </Button>
            </div>
          ) : (
            <>
              <p className="text-xs font-medium tracking-[0.3em] uppercase text-primary mb-2">Заявка</p>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight mb-2">
                Оставить заявку
              </h2>
              <p className="text-sm text-muted-foreground mb-10">Опишите задачу - ответим в течение 24 часов</p>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" data-testid="merch-order-form">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs uppercase tracking-widest text-muted-foreground">Имя *</FormLabel>
                          <FormControl>
                            <Input placeholder="Иван Иванов" {...field} data-testid="input-name" className="h-11 rounded-xl" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="company"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs uppercase tracking-widest text-muted-foreground">Компания / бренд</FormLabel>
                          <FormControl>
                            <Input placeholder="Название бренда" {...field} data-testid="input-company" className="h-11 rounded-xl" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="productType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs uppercase tracking-widest text-muted-foreground">Тип товара *</FormLabel>
                          <FormControl>
                            <Input placeholder="Носки, футболки, худи..." {...field} data-testid="input-product-type" className="h-11 rounded-xl" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs uppercase tracking-widest text-muted-foreground">Тираж *</FormLabel>
                          <FormControl>
                            <Input placeholder="100 штук / 500 пар..." {...field} data-testid="input-quantity" className="h-11 rounded-xl" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="contact"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs uppercase tracking-widest text-muted-foreground">Телефон / Email / Telegram *</FormLabel>
                        <FormControl>
                          <Input placeholder="+7 900 000 00 00 или @username" {...field} data-testid="input-contact" className="h-11 rounded-xl" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="message"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs uppercase tracking-widest text-muted-foreground">Комментарий</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Дополнительные детали, идеи, пожелания..."
                            rows={3}
                            {...field}
                            data-testid="textarea-message"
                            className="rounded-xl resize-none"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="wantPartner"
                    render={({ field }) => (
                      <FormItem className="flex items-start gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5" data-testid="form-item-want-partner">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-want-partner"
                            className="mt-0.5"
                          />
                        </FormControl>
                        <div className="flex-1 min-w-0">
                          <FormLabel className="text-sm font-semibold cursor-pointer leading-snug">
                            Хочу разместить мерч на booomerangs.ru и зарабатывать на продажах
                          </FormLabel>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            Ваша аудитория - ваши проценты. Менеджер расскажет о партнёрстве при первом звонке.
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    disabled={mutation.isPending}
                    className="w-full h-12 uppercase tracking-wider text-sm font-bold rounded-xl"
                    data-testid="btn-submit-order"
                  >
                    {mutation.isPending ? "Отправляем..." : "Отправить заявку"}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Или напишите напрямую:{" "}
                    <a href="mailto:info@booomerangs.ru" className="underline underline-offset-2 hover:text-foreground transition-colors">
                      info@booomerangs.ru
                    </a>{" "}
                    · Telegram{" "}
                    <a href="https://t.me/bmg_booomerangs" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground transition-colors">
                      @bmg_booomerangs
                    </a>
                  </p>
                </form>
              </Form>
            </>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
