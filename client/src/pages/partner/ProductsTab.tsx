import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Search, Package, Info, Copy, Link as LinkIcon } from "lucide-react";
import type { Product, CategoryConfig } from "@shared/schema";

interface PartnerProductsData {
  productIds: number[];
}

interface PartnerProductsTabProps {
  partnerSlug: string;
}

const partnerProductsKey = ["/api/partner/products"] as const;

export function PartnerProductsTab({ partnerSlug }: PartnerProductsTabProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showProducts, setShowProducts] = useState(false);

  const selectedQuery = useQuery<PartnerProductsData>({
    queryKey: partnerProductsKey,
  });

  const productsQuery = useQuery<{ products: Product[] }>({
    queryKey: ["/api/products", "partner-select"],
    queryFn: async () => {
      const res = await fetch(`/api/products?limit=5000`);
      if (!res.ok) throw new Error("Не удалось загрузить товары");
      return res.json();
    },
    enabled: showProducts,
    staleTime: 5 * 60 * 1000,
  });

  const categoriesQuery = useQuery<Record<string, CategoryConfig>>({
    queryKey: ["/api/categories"],
    staleTime: 5 * 60 * 1000,
  });

  const selectedSet = useMemo(
    () => new Set(selectedQuery.data?.productIds ?? []),
    [selectedQuery.data?.productIds],
  );

  const addMutation = useMutation({
    mutationFn: async (productId: number) => {
      await apiRequest("POST", "/api/partner/products", { productId });
    },
    onMutate: async (productId: number) => {
      await queryClient.cancelQueries({ queryKey: partnerProductsKey });
      const prev = queryClient.getQueryData<PartnerProductsData>(partnerProductsKey);
      if (prev) {
        queryClient.setQueryData<PartnerProductsData>(partnerProductsKey, {
          productIds: prev.productIds.includes(productId) ? prev.productIds : [...prev.productIds, productId],
        });
      }
      return { prev };
    },
    onError: (err: any, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(partnerProductsKey, ctx.prev);
      toast({ title: "Ошибка", description: err?.message || "Не удалось добавить", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (productId: number) => {
      await apiRequest("DELETE", `/api/partner/products/${productId}`);
    },
    onMutate: async (productId: number) => {
      await queryClient.cancelQueries({ queryKey: partnerProductsKey });
      const prev = queryClient.getQueryData<PartnerProductsData>(partnerProductsKey);
      if (prev) {
        queryClient.setQueryData<PartnerProductsData>(partnerProductsKey, {
          productIds: prev.productIds.filter((id) => id !== productId),
        });
      }
      return { prev };
    },
    onError: (err: any, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(partnerProductsKey, ctx.prev);
      toast({ title: "Ошибка", description: err?.message || "Не удалось удалить", variant: "destructive" });
    },
  });

  const products = productsQuery.data?.products ?? [];

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
    return products.filter((p) => {
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

  if (selectedQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground">Товары для продвижения</p>
            <p className="text-sm text-muted-foreground">
              Отметьте товары, которые хотите показать на вашей публичной странице и в виджете.
              Покупки этих товаров со ссылкой ?ref=<span className="font-mono">slug</span> будут засчитываться вам.
            </p>
            <div className="flex items-start gap-2 mt-3 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Выбрано: <Badge variant="secondary" data-testid="badge-partner-products-count">{selectedSet.size}</Badge>
                {selectedSet.size === 0 && " — на публичной странице ничего не отображается"}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <p className="font-medium text-foreground">Каталог BMGBRAND</p>
            <p className="text-sm text-muted-foreground">Выберите товары для продвижения</p>
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
                  data-testid="input-partner-search-products"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="border border-input bg-background rounded-md px-3 h-9 text-sm w-full sm:w-auto"
                data-testid="select-partner-category-filter"
              >
                <option value="all">Все категории</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{categoryLabel(c)}</option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowProducts(false)}
                className="w-full sm:w-auto"
                data-testid="button-partner-hide-products"
              >
                Свернуть
              </Button>
            </div>
          )}
        </div>

        {!showProducts ? (
          <div className="flex flex-col items-center justify-center text-center py-8 px-4 border border-dashed rounded-md">
            <p className="text-sm text-muted-foreground mb-3">
              Нажмите кнопку, чтобы открыть каталог и выбрать товары для продвижения.
            </p>
            <Button
              type="button"
              onClick={() => setShowProducts(true)}
              className="w-full sm:w-auto"
              data-testid="button-partner-show-products"
            >
              <Search className="w-4 h-4 mr-2" />
              Показать каталог
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
              filteredProducts.map((p) => {
                const checked = selectedSet.has(p.id);
                return (
                  <label
                    key={p.id}
                    className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer"
                    data-testid={`row-partner-product-${p.id}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleProduct(p.id, v === true)}
                      data-testid={`checkbox-partner-product-${p.id}`}
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
                      <p className="text-sm font-medium truncate" data-testid={`text-partner-product-name-${p.id}`}>
                        {p.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.sku ? `Арт. ${p.sku} · ` : ""}{categoryLabel(p.category)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <p className="text-sm font-medium" data-testid={`text-partner-product-price-${p.id}`}>
                        {(p.price / 100).toLocaleString("ru-RU")} ₽
                      </p>
                      <button
                        type="button"
                        title="Скопировать ссылку на товар"
                        data-testid={`button-copy-product-link-${p.id}`}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const url = `${window.location.origin}/${p.slug || p.id}?ref=${partnerSlug}`;
                          navigator.clipboard.writeText(url).then(
                            () => toast({ title: "Ссылка скопирована", description: p.name }),
                            () => toast({ title: "Ошибка", description: "Не удалось скопировать", variant: "destructive" }),
                          );
                        }}
                      >
                        <Copy className="w-3 h-3" />
                        <span>ссылка</span>
                      </button>
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
