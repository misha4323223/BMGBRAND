import { useMemo } from "react";
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
import type { LucideIcon } from "lucide-react";
import { mergeWholesaleContent, telHref } from "@/lib/wholesale-content";
import type { WholesaleIconKey } from "@/lib/wholesale-content";

const ICON_COMPONENTS: Record<WholesaleIconKey, LucideIcon> = {
  boxes: Boxes,
  shield: ShieldCheck,
  truck: Truck,
  factory: Factory,
  shirt: Shirt,
  badge: BadgeCheck,
  wallet: Wallet,
};

export default function WholesaleLanding() {
  const { data: seoOverrides } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/seo"],
  });
  const { data: wholesaleSettings } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/wholesale"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/wholesale");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const content = useMemo(() => mergeWholesaleContent(wholesaleSettings?.content), [wholesaleSettings]);

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
            "mainEntity": content.faq.items.map((f) => ({
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
            {content.hero.eyebrow}
          </p>
          <h1 className="text-4xl sm:text-6xl font-black leading-[1.02] tracking-tight mb-5">
            {content.hero.title}
          </h1>
          <p className="text-zinc-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed mb-7">
            {content.hero.subtitle}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/wholesale/register"
              data-testid="link-wholesale-register-hero"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
            >
              {content.hero.primaryCta}
            </Link>
            <a
              href="#conditions"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg border border-white/25 text-white text-sm font-semibold hover:bg-white hover:text-black transition-colors"
            >
              {content.hero.secondaryCta}
            </a>
          </div>
        </div>

        <div className="border-t border-zinc-800">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 grid grid-cols-3 divide-x divide-zinc-800">
            {content.stats.map(({ value, label }) => (
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
              {content.conditions.eyebrow}
            </span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-black leading-[1.05] tracking-tight text-zinc-950 dark:text-white mb-8">
            {content.conditions.title}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {content.conditions.items.map(({ icon, title, points }, index) => {
              const Icon = ICON_COMPONENTS[icon] ?? Boxes;
              return (
                <div key={`${title}-${index}`} className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-6">
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
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Почему BOOOMERANGS ── */}
      <section className="bg-zinc-950 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div className="text-center mb-10">
            <p className="text-[11px] font-black tracking-[0.25em] uppercase text-zinc-300 mb-4">
              {content.advantages.eyebrow}
            </p>
            <h2 className="text-3xl sm:text-5xl font-black leading-[1.05] tracking-tight">
              {content.advantages.title}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {content.advantages.items.map(({ icon, title: itemTitle, desc }, index) => {
              const Icon = ICON_COMPONENTS[icon] ?? Factory;
              return (
                <div key={`${itemTitle}-${index}`} className="flex gap-4 p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
                  <div className="w-10 h-10 rounded-lg bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-black text-white text-base mb-1.5">{itemTitle}</div>
                    <div className="text-sm text-zinc-400 leading-relaxed">{desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Как начать ── */}
      <section className="bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-black leading-tight tracking-tight text-zinc-950 dark:text-white">
              {content.steps.title}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {content.steps.items.map((s, i) => (
              <div key={`${s.title}-${i}`} className="relative p-6 rounded-2xl border border-zinc-200 dark:border-zinc-700">
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
                {content.steps.ctaLabel}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-3xl">
              <a
                href={telHref(content.contacts.managerPhone)}
                className="flex flex-col items-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4 text-center hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground">
                  <Phone className="w-3.5 h-3.5" />
                  Связаться с менеджером
                </span>
                <span className="text-sm font-black text-zinc-950 dark:text-white">{content.contacts.managerPhone}</span>
              </a>
              <a
                href={`mailto:${content.contacts.email}`}
                className="flex flex-col items-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4 text-center hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground">
                  <Mail className="w-3.5 h-3.5" />
                  Почта
                </span>
                <span className="text-sm font-black text-zinc-950 dark:text-white break-all">{content.contacts.email}</span>
              </a>
              <a
                href={telHref(content.contacts.salesPhone)}
                className="flex flex-col items-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4 text-center hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground">
                  <Phone className="w-3.5 h-3.5" />
                  Отдел продаж
                </span>
                <span className="text-sm font-black text-zinc-950 dark:text-white">{content.contacts.salesPhone}</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <h2 className="text-3xl sm:text-4xl font-black leading-tight tracking-tight text-zinc-950 dark:text-white text-center mb-8">
            {content.faq.title}
          </h2>
          <div className="space-y-3">
            {content.faq.items.map((f, index) => (
              <div key={`${f.q}-${index}`} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
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
