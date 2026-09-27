import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpToLine, Loader2, PinOff, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "@/lib/admin-fetch";

/**
 * Блок «Показ на главной странице» для формы товара.
 *
 * Позволяет закрепить товар первым в секции главной (popular — «Новинки»/«Популярное» —
 * либо любой custom_* с type=custom_hits) или убрать его из секции.
 * Логика на сервере: POST /api/admin/products/:id/homepage-section
 * (закрепление переводит секцию в режим «Вручную», см. server/routes/admin-products.ts).
 */

interface HomepageSectionOption {
  id: string;
  title: string;
  mode: "auto" | "manual";
  visible: boolean;
  pinned: number[];
}

interface Props {
  /** ID редактируемого товара; null — товар ещё не создан. */
  productId: number | null;
  apiKey: string;
}

const toIdArray = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
    : [];

export default function PinToHomepageButton({ productId, apiKey }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sectionId, setSectionId] = useState("popular");

  const homeQuery = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/home"],
    enabled: !!apiKey,
  });

  const sections = useMemo<HomepageSectionOption[]>(() => {
    const home = homeQuery.data || {};
    const list: HomepageSectionOption[] = [];
    const push = (id: string, settings: any, fallbackTitle: string) => {
      if (!settings) return;
      list.push({
        id,
        title: settings.title || fallbackTitle,
        mode: settings.mode === "manual" ? "manual" : "auto",
        visible: settings.visible !== false,
        pinned: toIdArray(settings.pinnedProductIds),
      });
    };
    push("popular", home.popular, "Новинки");
    Object.keys(home)
      .filter((key) => key.startsWith("custom_") && home[key]?.type === "custom_hits")
      .forEach((key) => push(key, home[key], "Хиты продаж"));
    return list;
  }, [homeQuery.data]);

  const active = sections.find((s) => s.id === sectionId) || sections[0] || null;
  const pinnedIds = active?.pinned || [];
  const isPinned = productId != null && pinnedIds.includes(productId);
  const isFirst = productId != null && pinnedIds[0] === productId;

  const mutation = useMutation({
    mutationFn: ({ action }: { action: "prepend" | "remove" }) =>
      adminFetch(`/api/admin/products/${productId}/homepage-section`, apiKey, {
        method: "POST",
        body: JSON.stringify({ sectionId: active?.id || sectionId, action }),
      }),
    onSuccess: (result: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/page-settings/home"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      if (variables.action === "remove") {
        toast({
          title: `Убрано из «${result.title}»`,
          description: result.removed === false
            ? result.message
            : `В секции осталось товаров: ${result.pinnedCount}`,
        });
      } else {
        toast({
          title: `Товар теперь первым в «${result.title}»`,
          description: result.modeWas === "auto"
            ? "Секция переведена в режим «Вручную» — показываются только закреплённые товары."
            : `Всего закреплено товаров: ${result.pinnedCount}`,
        });
      }
    },
    onError: (error: any) => {
      toast({ title: "Не удалось изменить секцию", description: error.message, variant: "destructive" });
    },
  });

  const handlePrepend = () => {
    if (!productId || !active) return;
    if (active.mode === "auto") {
      const ok = window.confirm(
        `Секция «${active.title}» сейчас в режиме «Авто».\n\n` +
        `При добавлении она переключится в режим «Вручную» и будет показывать только закреплённые товары ` +
        `(сейчас их ${active.pinned.length}).\n\nПродолжить?`,
      );
      if (!ok) return;
    }
    mutation.mutate({ action: "prepend" });
  };

  const pending = mutation.isPending;
  const disabled = !productId || !active || pending || homeQuery.isLoading;

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid="block-homepage-section">
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium">Показ на главной странице</span>
      </div>

      {!productId ? (
        <p className="text-xs text-muted-foreground">
          Сначала сохраните товар — после этого его можно закрепить в секции на главной.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={active?.id || ""}
              onValueChange={setSectionId}
              disabled={pending || sections.length === 0}
            >
              <SelectTrigger className="h-8 w-[210px] text-xs" data-testid="select-homepage-section">
                <SelectValue placeholder="Секция" />
              </SelectTrigger>
              <SelectContent>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.title} {s.mode === "auto" ? "(авто)" : `(${s.pinned.length})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handlePrepend}
              disabled={disabled || isFirst}
              data-testid="button-pin-homepage"
            >
              {pending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <ArrowUpToLine className="w-3.5 h-3.5 mr-1.5" />
              )}
              Поставить первым
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => mutation.mutate({ action: "remove" })}
              disabled={disabled || !isPinned}
              data-testid="button-unpin-homepage"
            >
              <PinOff className="w-3.5 h-3.5 mr-1.5" />
              Убрать из секции
            </Button>
          </div>

          {active && (
            <p className="text-xs text-muted-foreground" data-testid="text-homepage-section-status">
              {isPinned
                ? isFirst
                  ? `Товар показывается первым в «${active.title}».`
                  : `Товар в секции «${active.title}» на позиции ${pinnedIds.indexOf(productId as number) + 1}.`                  : active.mode === "manual"
                    ? `В секции «${active.title}» закреплено товаров: ${active.pinned.length}. Товар встанет на первое место.`
                    : `Секция «${active.title}» работает в режиме «Авто» — товары подбираются автоматически.`}
              {!active.visible && " ⚠️ Секция скрыта («Показывать секцию» выключено) — на сайте её не видно."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
