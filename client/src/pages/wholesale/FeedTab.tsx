import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Copy, ExternalLink, Search, Download, Info, ChevronDown, Globe, Monitor } from "lucide-react";
import { SiWordpress } from "react-icons/si";
import type { Product, CategoryConfig } from "@shared/schema";

const cmsPlatforms = [
  {
    name: "1С-Битрикс",
    icon: <Globe className="w-4 h-4" />,
    steps: [
      "Перейдите в «Магазин → Каталог → Импорт товаров».",
      "Выберите формат «XML / YML» и вставьте ссылку на ваш фид в поле «URL файла».",
      "Настройте соответствие полей: name → Название, price → Цена, picture → Изображение.",
      "Запустите импорт. Для автообновления настройте задание в «Агентах» на нужный интервал.",
    ],
  },
  {
    name: "WooCommerce (WordPress)",
    icon: <SiWordpress className="w-4 h-4" />,
    steps: [
      "Установите плагин «WP All Import» или «XML Product Import for WooCommerce» из репозитория WordPress.",
      "В меню плагина выберите «New Import» → «From a URL» и вставьте ссылку на ваш фид.",
      "Настройте маппинг полей: name → Product Title, price → Regular Price, picture → Image.",
      "Сохраните шаблон импорта и запустите. Для автообновления включите Cron в настройках плагина.",
    ],
  },
  {
    name: "OpenCart",
    icon: <Monitor className="w-4 h-4" />,
    steps: [
      "Установите расширение «XML/YML Import» (например, через marketplace.opencart.com).",
      "Перейдите в «Catalog → Import → XML» и укажите URL вашего фида.",
      "Настройте соответствие полей и выберите категорию для импортируемых товаров.",
      "Запустите импорт; для регулярного обновления настройте cron на стороне хостинга.",
    ],
  },
  {
    name: "Tilda",
    icon: <Globe className="w-4 h-4" />,
    steps: [
      "Tilda не поддерживает прямой XML-импорт. Воспользуйтесь экспортом в CSV через сторонние конвертеры (XML → CSV).",
      "Перейдите в «Каталог → Товары» и выберите «Импорт из CSV».",
      "Сопоставьте колонки CSV с полями Tilda (название, цена, изображение) и загрузите файл.",
      "Для регулярного обновления потребуется повторять конвертацию вручную или настроить скрипт автоматизации.",
    ],
  },
  {
    name: "Свой сайт / разработчик",
    icon: <Monitor className="w-4 h-4" />,
    steps: [
      "Передайте разработчику URL фида — он обновляется в реальном времени, кэш 5 минут.",
      "Фид в формате XML содержит: id, name, price (розничная), url, picture, categoryId, sku.",
      "Настройте фоновую задачу (cron) на сервере для периодического парсинга фида и обновления базы товаров.",
      "Остатки в фиде не передаются — управляйте ими в своей системе самостоятельно.",
    ],
  },
];

interface FeedData {
  productIds: number[];
  token: string;
  feedUrl: string;
}

export function FeedTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showProducts, setShowProducts] = useState(false);
  const [openCms, setOpenCms] = useState<string | null>(null);

  const feedQuery = useQuery<FeedData>({
    queryKey: ["/api/wholesale/feed-products"],
  });

  const productsQuery = useQuery<{ products: Product[] }>({
    queryKey: ["/api/products", "feed"],
    queryFn: async () => {
      const res = await fetch(`/api/products?limit=5000`);
      if (!res.ok) throw new Error("Не удалось загрузить товары");
      return res.json();
    },
    enabled: showProducts,
    staleTime: 5 * 60 * 1000,
  });

  const selectedSet = useMemo(
    () => new Set(feedQuery.data?.productIds ?? []),
    [feedQuery.data?.productIds]
  );

  const feedKey = ["/api/wholesale/feed-products"] as const;

  const addMutation = useMutation({
    mutationFn: async (productId: number) => {
      await apiRequest("POST", "/api/wholesale/feed-products", { productId });
    },
    onMutate: async (productId: number) => {
      await queryClient.cancelQueries({ queryKey: feedKey });
      const prev = queryClient.getQueryData<FeedData>(feedKey);
      if (prev) {
        queryClient.setQueryData<FeedData>(feedKey, {
          ...prev,
          productIds: prev.productIds.includes(productId) ? prev.productIds : [...prev.productIds, productId],
        });
      }
      return { prev };
    },
    onError: (err: any, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(feedKey, ctx.prev);
      toast({ title: "Ошибка", description: err?.message || "Не удалось добавить", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (productId: number) => {
      await apiRequest("DELETE", `/api/wholesale/feed-products/${productId}`);
    },
    onMutate: async (productId: number) => {
      await queryClient.cancelQueries({ queryKey: feedKey });
      const prev = queryClient.getQueryData<FeedData>(feedKey);
      if (prev) {
        queryClient.setQueryData<FeedData>(feedKey, {
          ...prev,
          productIds: prev.productIds.filter(id => id !== productId),
        });
      }
      return { prev };
    },
    onError: (err: any, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(feedKey, ctx.prev);
      toast({ title: "Ошибка", description: err?.message || "Не удалось удалить", variant: "destructive" });
    },
  });

  const products = productsQuery.data?.products ?? [];

  const categoriesQuery = useQuery<Record<string, CategoryConfig>>({
    queryKey: ["/api/categories"],
    staleTime: 5 * 60 * 1000,
  });

  const categoryNameMap = useMemo(() => {
    const map = new Map<string, string>();
    const cats = categoriesQuery.data || {};
    for (const key of Object.keys(cats)) {
      const c = cats[key];
      if (c?.slug) map.set(c.slug, c.name);
      for (const sub of c?.subcategories ?? []) {
        if (sub?.slug) map.set(sub.slug, sub.name);
      }
    }
    return map;
  }, [categoriesQuery.data]);

  const categoryLabel = (slug: string) => categoryNameMap.get(slug) || slug;

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return Array.from(set).sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), "ru"));
  }, [products, categoryNameMap]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (p.isHidden) return false;
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [products, search, categoryFilter]);

  const toggleProduct = (productId: number, checked: boolean) => {
    if (checked) addMutation.mutate(productId);
    else removeMutation.mutate(productId);
  };

  const copyFeedUrl = async () => {
    if (!feedQuery.data?.feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedQuery.data.feedUrl);
      toast({ title: "Скопировано", description: "Ссылка на фид скопирована в буфер обмена" });
    } catch {
      toast({ title: "Ошибка", description: "Не удалось скопировать", variant: "destructive" });
    }
  };

  if (feedQuery.isLoading || productsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (feedQuery.error) {
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">
          {(feedQuery.error as any)?.message || "Не удалось загрузить данные фида"}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Download className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground">Ссылка на ваш XML-фид</p>
            <p className="text-sm text-muted-foreground mb-3">
              Используйте эту ссылку для импорта товаров в свою CMS (Битрикс, WooCommerce, Tilda, OpenCart и др.). Формат XML — стандартный, совместим с большинством плагинов импорта.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                readOnly
                value={feedQuery.data?.feedUrl ?? ""}
                className="font-mono text-xs"
                data-testid="input-feed-url"
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex gap-2 w-full sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyFeedUrl}
                  className="flex-1 sm:flex-none"
                  data-testid="button-copy-feed-url"
                >
                  <Copy className="w-4 h-4 mr-1" />
                  Копировать
                </Button>
                <Button
                  asChild
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-none"
                  data-testid="button-open-feed"
                >
                  <a
                    href={feedQuery.data?.feedUrl ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="w-4 h-4 mr-1" />
                    Открыть
                  </a>
                </Button>
              </div>
            </div>
            <div className="flex items-start gap-2 mt-3 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Остатки в фиде не передаются — проставьте их в своей системе самостоятельно. Цены — розничные (как на сайте booomerangs.ru). Ссылка обновляется в реальном времени, кэш — 5 минут.
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <p className="font-medium text-foreground mb-1">Как подключить</p>
        <p className="text-sm text-muted-foreground mb-4">Нажмите на вашу CMS или платформу, чтобы увидеть инструкцию.</p>
        <div className="divide-y">
          {cmsPlatforms.map((p) => {
            const isOpen = openCms === p.name;
            return (
              <div key={p.name} className="first:pt-0 last:pb-0">
                <button
                  type="button"
                  onClick={() => setOpenCms(isOpen ? null : p.name)}
                  className="w-full flex items-center gap-3 py-3 text-left"
                >
                  <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                    {p.icon}
                  </div>
                  <span className="flex-1 text-sm font-medium">{p.name}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && (
                  <ol className="mb-3 ml-10 space-y-1.5 list-decimal list-outside">
                    {p.steps.map((step, i) => (
                      <li key={i} className="text-xs text-muted-foreground leading-snug pl-1">
                        {step}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <p className="font-medium text-foreground">Мои товары для выгрузки</p>
            <p className="text-sm text-muted-foreground">
              Выбрано: <Badge variant="secondary" data-testid="badge-feed-count">{selectedSet.size}</Badge>
            </p>
          </div>
          {showProducts && (
            <div className="flex flex-col sm:flex-row gap-2 sm:w-auto w-full">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Поиск по названию или артикулу"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-products"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="border border-input bg-background rounded-md px-3 h-9 text-sm w-full sm:w-auto"
                data-testid="select-category-filter"
              >
                <option value="all">Все категории</option>
                {categories.map(c => (
                  <option key={c} value={c}>{categoryLabel(c)}</option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowProducts(false)}
                className="w-full sm:w-auto"
                data-testid="button-hide-products"
              >
                Свернуть
              </Button>
            </div>
          )}
        </div>

        {!showProducts ? (
          <div className="flex flex-col items-center justify-center text-center py-8 px-4 border border-dashed rounded-md">
            <p className="text-sm text-muted-foreground mb-3">
              Список товаров не загружен. Нажмите кнопку, чтобы выбрать товары для фида.
            </p>
            <Button
              type="button"
              onClick={() => setShowProducts(true)}
              className="w-full sm:w-auto"
              data-testid="button-show-products"
            >
              <Search className="w-4 h-4 mr-2" />
              Показать список товаров
            </Button>
          </div>
        ) : productsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
        <div className="border rounded-md divide-y max-h-[600px] overflow-y-auto">
          {filteredProducts.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">Товары не найдены</p>
          ) : (
            filteredProducts.map(p => {
              const checked = selectedSet.has(p.id);
              const priceKopeks = p.price;
              return (
                <label
                  key={p.id}
                  className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer"
                  data-testid={`row-feed-product-${p.id}`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => toggleProduct(p.id, v === true)}
                    data-testid={`checkbox-feed-product-${p.id}`}
                  />
                  {p.thumbnailUrl || p.imageUrl ? (
                    <img
                      src={p.thumbnailUrl || p.imageUrl}
                      alt={p.name}
                      className="w-12 h-12 object-cover rounded shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-muted rounded shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" data-testid={`text-product-name-${p.id}`}>
                      {p.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.sku ? `Арт. ${p.sku} · ` : ""}{categoryLabel(p.category)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium" data-testid={`text-product-price-${p.id}`}>
                      {(priceKopeks / 100).toLocaleString("ru-RU")} ₽
                    </p>
                  </div>
                </label>
              );
            })
          )}
        </div>
        )}
      </Card>
    </div>
  );
}
