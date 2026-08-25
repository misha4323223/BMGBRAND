import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw, Loader2, Eye, EyeOff, Trash2, AlertTriangle, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const adminFetch = async (url: string, apiKey: string, options: RequestInit = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: { "x-api-key": apiKey, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
};

interface Props {
  apiKey: string;
  isActive: boolean;
}

interface DuplicateItem {
  id: number;
  name: string;
  slug: string;
  price: number;
  stock: number;
  imageCount: number;
  isHidden: boolean;
  autoHideOverride: boolean;
  inStock: boolean;
  updatedAt: string | null;
  externalId: string | null;
  danger?: boolean;
}

interface DuplicateGroup {
  key: string;
  reason: "name" | "slug";
  nameDiffers?: boolean;
  canonicalId: number | null;
  items: DuplicateItem[];
}

function fmtPrice(p: number): string {
  return `${(p / 100).toLocaleString("ru-RU")} ₽`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export default function ProductDuplicatesPanel({ apiKey, isActive }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const query = useQuery<{ groups: DuplicateGroup[]; total: number }>({
    queryKey: ["/api/admin/products/duplicates"],
    queryFn: () => adminFetch("/api/admin/products/duplicates", apiKey),
    enabled: !!apiKey && isActive,
  });

  const setBusy = (id: number, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const runAction = async (id: number, fn: () => Promise<any>, okMsg: string) => {
    setBusy(id, true);
    try {
      await fn();
      toast({ title: okMsg });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products/duplicates"] });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setBusy(id, false);
    }
  };

  const toggleVisibility = (item: DuplicateItem, hidden: boolean) =>
    runAction(
      item.id,
      () =>
        adminFetch(`/api/admin/products/${item.id}`, apiKey, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            hidden
              ? { isHidden: true, autoHideOverride: true, inStock: false }
              : { isHidden: false, autoHideOverride: true, inStock: true }
          ),
        }),
      hidden ? "Товар скрыт" : "Товар показан"
    );

  const addSlugRedirect = async (from: string, to: string) => {
    if (!from || !to || from === to) return;
    const settings: any = await adminFetch("/api/bonus-settings", apiKey);
    let map: { from: string; to: string }[] = [];
    try {
      const parsed = JSON.parse(settings.slug_redirects || "[]");
      if (Array.isArray(parsed)) map = parsed;
    } catch { /* keep empty */ }
    if (map.some((r) => r.from === from)) return;
    map.push({ from, to });
    await adminFetch("/api/bonus-settings", apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "slug_redirects", value: JSON.stringify(map) }),
    });
  };

  const deleteItem = (item: DuplicateItem, group: DuplicateGroup) => {
    const canonical = group.items.find((g) => g.id === group.canonicalId);
    const extra = item.danger
      ? "\n\n⚠️ Цена этого дубля отличается от канона (в 1С две номенклатуры).\nПосле удаления 1С переподцепит эту номенклатуру к канону — цена канона может измениться."
      : "";
    if (
      !confirm(
        `Удалить дубль «${item.name}»?\nURL /${item.slug} продолжит 301-редирект${canonical ? ` на /${canonical.slug}` : ""}.\nТовар удалится из БД вместе с изображениями.${extra}`
      )
    ) {
      return;
    }
    runAction(
      item.id,
      async () => {
        await adminFetch("/api/admin/products/bulk-delete", apiKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [item.id] }),
        });
        // Автоматически добавляем 301 с удалённого слага на канон,
        // чтобы старый URL не отдавал 404.
        if (canonical) await addSlugRedirect(item.slug, canonical.slug);
      },
      "Дубль удалён"
    );
  };

  const groups = query.data?.groups ?? [];
  const totalDups = groups.reduce((acc, g) => acc + g.items.filter((it) => it.id !== g.canonicalId).length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Copy className="w-4 h-4" />
          Дубли товаров
        </CardTitle>
        <CardDescription>
          Группы товаров, которые выглядят как один и тот же товар (одинаковое название или слаг с суффиксом{" "}
          <code>-2/-3</code>). Канон — видимый товар, остальные — дубли. Можно скрыть, показать или удалить вручную.
          <span className="block mt-1 text-muted-foreground">
            Автоматически скрытые в рамках SEO-чистки дубли тоже здесь.
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <span className="text-sm text-muted-foreground">Групп-дублей:</span>
            <span className="text-lg font-bold" data-testid="text-duplicates-count">
              {query.isLoading ? "…" : groups.length}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <span className="text-sm text-muted-foreground">Дублей:</span>
            <span className="text-lg font-bold">{query.isLoading ? "…" : totalDups}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isLoading}
            data-testid="button-refresh-duplicates"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${query.isLoading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
        </div>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Дублей не найдено — всё чисто ✅</p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const canonical = group.items.find((g) => g.id === group.canonicalId);
              const title = canonical?.name || group.items[0]?.name || group.key;
              const dupCount = group.items.filter((it) => it.id !== group.canonicalId).length;
              return (
                <div key={group.key} className="border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-muted/40 border-b flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {dupCount} дубль(я) · группа найдена по{" "}
                        {group.reason === "name" ? "названию" : "слагу"}
                        {group.nameDiffers && (
                          <span className="text-amber-600"> · ⚠️ имена записей различаются — проверьте, что это действительно дубль</span>
                        )}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {group.items.length} записи
                    </Badge>
                  </div>

                  <div className="divide-y">
                    {group.items.map((item) => {
                      const isCanonical = item.id === group.canonicalId;
                      const busy = busyIds.has(item.id);
                      return (
                        <div key={item.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium truncate">{item.name}</p>
                              {isCanonical && (
                                <Badge variant="default" className="shrink-0 gap-1">
                                  <Check className="w-3 h-3" /> канон
                                </Badge>
                              )}
                              {item.isHidden ? (
                                <Badge variant="outline" className="shrink-0">скрыт</Badge>
                              ) : (
                                <Badge variant="secondary" className="shrink-0">виден</Badge>
                              )}
                              {item.danger && (
                                <span
                                  className="inline-flex items-center gap-1 text-xs text-amber-600 shrink-0"
                                  title="В 1С две номенклатуры с разными ценами. Удаление переподцепит номенклатуру дубля к канону, цена канона может измениться."
                                >
                                  <AlertTriangle className="w-3.5 h-3.5" /> цена отличается
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">/{item.slug}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {fmtPrice(item.price)} · склад: {item.stock} · фото: {item.imageCount} · обновлён:{" "}
                              {fmtDate(item.updatedAt)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => toggleVisibility(item, !item.isHidden)}
                              data-testid={`button-duplicate-toggle-${item.id}`}
                            >
                              {item.isHidden ? (
                                <><Eye className="w-4 h-4 mr-1.5" /> Показать</>
                              ) : (
                                <><EyeOff className="w-4 h-4 mr-1.5" /> Скрыть</>
                              )}
                            </Button>
                            {!isCanonical && (
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={busy}
                                onClick={() => deleteItem(item, group)}
                                data-testid={`button-duplicate-delete-${item.id}`}
                              >
                                <Trash2 className="w-4 h-4 mr-1.5" /> Удалить
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Удаление дубля не ломает старые ссылки: URL скрытого дубля продолжает отдавать 301 на канон.
        </p>
      </CardContent>
    </Card>
  );
}
