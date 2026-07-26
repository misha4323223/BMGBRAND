import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp,
  ExternalLink, Search, RefreshCw, Code2, Globe, FileText,
  ShoppingBag, Mic2, BookOpen, Tag, Layers
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type AuditProduct = { id: number; slug: string; name: string; category: string };

type AuditData = {
  products: {
    total: number; visible: number; hidden: number;
    withSeoTitle: number; withSeoDesc: number; withSeoBody: number; withImage: number;
    pctTitle: number; pctDesc: number; pctBody: number;
    missingTitle: AuditProduct[]; missingDesc: AuditProduct[]; missingBody: AuditProduct[];
  };
};

function PctBar({ pct, label }: { pct: number; label: string }) {
  const color = pct >= 80 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium text-foreground">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
    : <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
}

const SCHEMA_COVERAGE = [
  {
    icon: Globe,
    page: "Главная (/)",
    schemas: ["Organization", "WebSite", "SearchAction", "WebPage", "SpeakableSpecification"],
    botSsr: true,
  },
  {
    icon: Tag,
    page: "Каталог (/products)",
    schemas: ["BreadcrumbList", "WebPage", "CollectionPage + ItemList"],
    botSsr: true,
  },
  {
    icon: Tag,
    page: "Категория (/products/:cat)",
    schemas: ["BreadcrumbList", "WebPage", "ItemList с Product"],
    botSsr: true,
  },
  {
    icon: ShoppingBag,
    page: "Товар (/:slug)",
    schemas: ["Product", "ImageObject[]", "BreadcrumbList", "WebPage", "SpeakableSpecification", "AggregateRating", "Review", "MerchantReturnPolicy", "OfferShippingDetails"],
    botSsr: true,
  },
  {
    icon: Mic2,
    page: "Артист (/@:slug)",
    schemas: ["BreadcrumbList", "WebPage", "Person"],
    botSsr: false,
  },
  {
    icon: BookOpen,
    page: "Статья блога (/blog/:slug)",
    schemas: ["BlogPosting", "BreadcrumbList", "Person (author)"],
    botSsr: false,
  },
  {
    icon: BookOpen,
    page: "Блог (/blog)",
    schemas: ["Blog", "BreadcrumbList"],
    botSsr: false,
  },
  {
    icon: Layers,
    page: "Мерч на заказ (/merch-na-zakaz)",
    schemas: ["LocalBusiness", "Service", "HowTo", "FAQPage", "BreadcrumbList"],
    botSsr: true,
  },
  {
    icon: FileText,
    page: "Статические страницы",
    schemas: ["WebPage", "BreadcrumbList"],
    botSsr: false,
  },
];

const TECH_FIXES = [
  {
    title: "Дублирование JSON-LD",
    status: "fixed",
    desc: "server/static.ts и vite.ts инжектировали JSON-LD в <head>, React Helmet добавлял ещё один блок. Исправлено: атрибут data-rh=\"true\" — Helmet удаляет серверные теги при маунте.",
  },
  {
    title: "max-snippet / max-image-preview",
    status: "fixed",
    desc: "Добавлены директивы max-snippet:-1, max-image-preview:large, max-video-preview:-1 в robots meta для расширенных сниппетов в Google.",
  },
  {
    title: "Bot SSR для поисковиков",
    status: "fixed",
    desc: "Яндекс и Google получают полный HTML вместо пустого <div id='root'>. Охват: главная, каталог, категории, товары, мерч-на-заказ.",
  },
  {
    title: "ImageObject (полная разметка)",
    status: "ok",
    desc: "Каждый товар передаёт изображения как ImageObject с url, contentUrl, name, representativeOfPage — а не просто строками.",
  },
  {
    title: "SpeakableSpecification",
    status: "ok",
    desc: "Главная и страницы товаров разметили xpath для голосовых ассистентов (Алиса, Google Assistant).",
  },
  {
    title: "MerchantReturnPolicy + ShippingDetails",
    status: "ok",
    desc: "В Offer каждого товара: hasMerchantReturnPolicy (30-дневный возврат) и shippingDetails (СДЭК по России).",
  },
];

function ProductMissingTable({ products, search }: { products: AuditProduct[]; search: string }) {
  const filtered = search
    ? products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.slug.includes(search.toLowerCase()))
    : products;
  if (filtered.length === 0) return <p className="text-sm text-green-600 font-medium py-2">✓ Все товары заполнены</p>;
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Товар</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Категория</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {filtered.slice(0, 30).map(p => (
            <tr key={p.id} className="hover:bg-muted/30">
              <td className="px-3 py-2">
                <span className="font-medium line-clamp-1">{p.name}</span>
                <span className="text-xs text-muted-foreground">/{p.slug}</span>
              </td>
              <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{p.category}</td>
              <td className="px-3 py-2 text-right">
                <a href={`/${p.slug}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 30 && (
        <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/30 border-t">
          Показано 30 из {filtered.length}. Используйте поиск для сужения.
        </div>
      )}
    </div>
  );
}

export function SeoAuditTab({ apiKey, adminFetch }: { apiKey: string; adminFetch: (url: string, apiKey: string, opts?: RequestInit) => Promise<any> }) {
  const [openSection, setOpenSection] = useState<string | null>("products");
  const [productSearch, setProductSearch] = useState("");
  const [activeProductTab, setActiveProductTab] = useState<"title" | "desc" | "body">("title");

  const { data, isLoading, refetch, isFetching } = useQuery<AuditData>({
    queryKey: ["admin-seo-audit"],
    queryFn: () => adminFetch("/api/admin/seo-audit", apiKey),
    enabled: !!apiKey,
    staleTime: 60_000,
  });

  const toggle = (key: string) => setOpenSection(prev => prev === key ? null : key);
  const p = data?.products;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">SEO-аудит</h2>
          <p className="text-sm text-muted-foreground">Технический анализ структурированных данных и заполненности SEO-полей</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-seo-audit-refresh">
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {/* Schema.org coverage */}
      <div className="border rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 font-medium hover:bg-muted/50 transition-colors text-left"
          onClick={() => toggle("schemas")}
          data-testid="button-audit-schemas"
        >
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-primary" />
            Schema.org покрытие по типам страниц
          </div>
          {openSection === "schemas" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {openSection === "schemas" && (
          <div className="border-t divide-y">
            {SCHEMA_COVERAGE.map(row => {
              const Icon = row.icon;
              return (
                <div key={row.page} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{row.page}</span>
                        {row.botSsr && (
                          <Badge variant="outline" className="text-xs">Bot SSR ✓</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {row.schemas.map(s => (
                          <span key={s} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-1.5 py-0.5">
                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Technical fixes */}
      <div className="border rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 font-medium hover:bg-muted/50 transition-colors text-left"
          onClick={() => toggle("tech")}
          data-testid="button-audit-tech"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Технические исправления
          </div>
          {openSection === "tech" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {openSection === "tech" && (
          <div className="border-t divide-y">
            {TECH_FIXES.map(fix => (
              <div key={fix.title} className="px-4 py-3 flex gap-3">
                {fix.status === "fixed"
                  ? <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                  : <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                }
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{fix.title}</span>
                    <Badge variant={fix.status === "fixed" ? "secondary" : "outline"} className="text-xs">
                      {fix.status === "fixed" ? "Исправлено" : "Выполнено"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{fix.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Product SEO stats */}
      <div className="border rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 font-medium hover:bg-muted/50 transition-colors text-left"
          onClick={() => toggle("products")}
          data-testid="button-audit-products"
        >
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-primary" />
            SEO-заполненность товаров
            {p && (
              <Badge variant={p.pctTitle >= 80 ? "outline" : "destructive"} className="text-xs ml-1">
                {p.pctTitle}% с seoTitle
              </Badge>
            )}
          </div>
          {openSection === "products" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {openSection === "products" && (
          <div className="border-t p-4 space-y-5">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <RefreshCw className="w-4 h-4 animate-spin" /> Загрузка...
              </div>
            ) : p ? (
              <>
                {/* Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Всего товаров", value: p.total },
                    { label: "Видимых", value: p.visible },
                    { label: "Скрытых / арт.", value: p.hidden },
                    { label: "С изображением", value: p.withImage },
                  ].map(s => (
                    <div key={s.label} className="bg-muted/40 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold">{s.value}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Progress bars */}
                <div className="space-y-3">
                  <PctBar pct={p.pctTitle} label={`seoTitle — ${p.withSeoTitle} из ${p.visible} видимых товаров`} />
                  <PctBar pct={p.pctDesc} label={`seoDescription — ${p.withSeoDesc} из ${p.visible}`} />
                  <PctBar pct={p.pctBody} label={`seoBody (SEO-текст) — ${p.withSeoBody} из ${p.visible}`} />
                </div>

                {/* Missing products tabs */}
                <div className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    {(["title", "desc", "body"] as const).map(tab => {
                      const counts = { title: p.missingTitle.length, desc: p.missingDesc.length, body: p.missingBody.length };
                      const labels = { title: `Без seoTitle (${counts[tab]})`, desc: `Без seoDesc (${counts[tab]})`, body: `Без seoBody (${counts[tab]})` };
                      return (
                        <button
                          key={tab}
                          onClick={() => setActiveProductTab(tab)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                            activeProductTab === tab
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border hover:bg-muted"
                          }`}
                          data-testid={`button-audit-product-tab-${tab}`}
                        >
                          {labels[tab]}
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      className="pl-8 h-8 text-sm"
                      placeholder="Поиск по названию или slug..."
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      data-testid="input-audit-product-search"
                    />
                  </div>

                  <ProductMissingTable
                    products={activeProductTab === "title" ? p.missingTitle : activeProductTab === "desc" ? p.missingDesc : p.missingBody}
                    search={productSearch}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            )}
          </div>
        )}
      </div>

      {/* Recommendations */}
      <div className="border rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 font-medium hover:bg-muted/50 transition-colors text-left"
          onClick={() => toggle("recs")}
          data-testid="button-audit-recs"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-500" />
            Рекомендации по дальнейшей оптимизации
          </div>
          {openSection === "recs" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {openSection === "recs" && (
          <div className="border-t divide-y text-sm">
            {[
              {
                priority: "high",
                title: "Заполнить seoTitle для всех видимых товаров",
                desc: "Google использует <title> как основной сигнал для ранжирования. Уникальный title на каждый товар — базовое требование. Редактируй в карточке товара → вкладка SEO.",
              },
              {
                priority: "high",
                title: "Заполнить seoDescription для всех видимых товаров",
                desc: "Meta description влияет на CTR в выдаче. Яндекс показывает его в сниппете, если он информативнее автоматически извлечённого.",
              },
              {
                priority: "medium",
                title: "Добавить seoBody (SEO-текст) хотя бы для топ-категорий товаров",
                desc: "Текстовый блок с ключевыми словами помогает для LSI и понимания страницы. Приоритет: носки, одежда, мерч артистов.",
              },
              {
                priority: "medium",
                title: "Верифицировать схемы в Google Rich Results Test",
                desc: "Инструмент: https://search.google.com/test/rich-results — проверить Product, BreadcrumbList, FAQPage, BlogPosting на ошибки и предупреждения.",
              },
              {
                priority: "low",
                title: "Добавить Bot SSR для страниц артистов",
                desc: "Сейчас /@:slug обрабатывается только React-компонентом (нет Bot SSR). Боты получают BreadcrumbList, но не полный контент страницы.",
              },
              {
                priority: "low",
                title: "Bot SSR для страниц блога",
                desc: "/blog и /blog/:slug не охвачены Bot SSR — поисковики обходят их в JS-режиме. Добавить renderBlog() и renderBlogPost() по аналогии с renderProduct().",
              },
            ].map((rec, i) => (
              <div key={i} className="px-4 py-3 flex gap-3">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                  rec.priority === "high" ? "bg-red-500" : rec.priority === "medium" ? "bg-yellow-500" : "bg-blue-400"
                }`} />
                <div>
                  <div className="font-medium">{rec.title}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{rec.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* External links */}
      <div className="flex flex-wrap gap-2 pt-1">
        <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm" className="gap-2">
            <ExternalLink className="w-3.5 h-3.5" /> Google Rich Results Test
          </Button>
        </a>
        <a href="https://validator.schema.org/" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm" className="gap-2">
            <ExternalLink className="w-3.5 h-3.5" /> Schema.org Validator
          </Button>
        </a>
        <a href="https://webmaster.yandex.ru/site/https:booomerangs.ru:443/indexing/pages/" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm" className="gap-2">
            <ExternalLink className="w-3.5 h-3.5" /> Яндекс Вебмастер
          </Button>
        </a>
        <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm" className="gap-2">
            <ExternalLink className="w-3.5 h-3.5" /> Google Search Console
          </Button>
        </a>
      </div>
    </div>
  );
}
