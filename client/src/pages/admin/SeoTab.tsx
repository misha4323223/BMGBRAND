import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Save, Loader2, ChevronRight, Globe, Tag, Shirt, Mic2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type SeoFieldState = { default: string; value: string };
type SeoPage = {
  type: "home" | "category" | "subcategory" | "artist";
  key: string;
  label: string;
  fields: { title: SeoFieldState; description: SeoFieldState };
};

const TYPE_LABELS: Record<SeoPage["type"], string> = {
  home: "Главная",
  category: "Категории",
  subcategory: "Подкатегории",
  artist: "Артисты",
};

const TYPE_ICONS: Record<SeoPage["type"], typeof Globe> = {
  home: Globe,
  category: Tag,
  subcategory: Shirt,
  artist: Mic2,
};

export function SeoTab({ apiKey, adminFetch }: { apiKey: string; adminFetch: (url: string, apiKey: string, opts?: RequestInit) => Promise<any> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; description: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<{ pages: SeoPage[] }>({
    queryKey: ["admin-seo-pages"],
    queryFn: () => adminFetch("/api/admin/seo/pages", apiKey),
    enabled: !!apiKey,
  });

  const pages = data?.pages || [];
  const grouped = useMemo(() => {
    const groups: Record<SeoPage["type"], SeoPage[]> = { home: [], category: [], subcategory: [], artist: [] };
    for (const p of pages) groups[p.type].push(p);
    return groups;
  }, [pages]);

  const selectedPage = pages.find(p => `${p.type}:${p.key}` === selectedKey) || null;

  const selectPage = (p: SeoPage) => {
    setSelectedKey(`${p.type}:${p.key}`);
    setDraft({ title: p.fields.title.value, description: p.fields.description.value });
  };

  const handleSave = async () => {
    if (!selectedPage || !draft) return;
    setSaving(true);
    try {
      if (selectedPage.type === "artist") {
        await adminFetch(`/api/admin/page-settings/artist_pages/${selectedPage.key}`, apiKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seoTitle: draft.title, seoDescription: draft.description }),
        });
      } else {
        const sectionId = selectedPage.type === "home" ? "home" : selectedPage.type === "category" ? `category:${selectedPage.key}` : `subcategory:${selectedPage.key}`;
        await adminFetch(`/api/admin/page-settings/seo/${sectionId}`, apiKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: draft.title, description: draft.description }),
        });
      }
      toast({ title: "SEO-текст сохранён" });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/page-settings/seo"] });
    } catch (err: any) {
      toast({ title: "Ошибка сохранения", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка страниц…
      </div>
    );
  }

  if (isError) {
    return <div className="p-8 text-destructive">Не удалось загрузить список страниц.</div>;
  }

  return (
    <div className="p-4 flex flex-col lg:flex-row gap-4">
      <div className="lg:w-80 shrink-0 space-y-4">
        <div className="flex items-center gap-2">
          <Search className="w-5 h-5" />
          <h2 className="text-xl font-bold">SEO</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Выберите страницу слева, чтобы увидеть и отредактировать её текущие SEO-заголовок и описание —
          те же, что видят поисковые боты и попадают в мета-теги страницы.
        </p>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          {(Object.keys(grouped) as SeoPage["type"][]).map(type => {
            const items = grouped[type];
            if (items.length === 0) return null;
            const Icon = TYPE_ICONS[type];
            return (
              <div key={type}>
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground mb-1 px-1">
                  <Icon className="w-3.5 h-3.5" /> {TYPE_LABELS[type]}
                </div>
                <div className="space-y-0.5">
                  {items.map(p => {
                    const isSelected = selectedKey === `${p.type}:${p.key}`;
                    const isOverridden = p.fields.title.value !== p.fields.title.default || p.fields.description.value !== p.fields.description.default;
                    return (
                      <button
                        key={`${p.type}:${p.key}`}
                        onClick={() => selectPage(p)}
                        data-testid={`button-seo-page-${p.type}-${p.key}`}
                        className={`w-full flex items-center justify-between gap-2 text-left px-2 py-1.5 rounded text-sm transition-colors ${
                          isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                        }`}
                      >
                        <span className="truncate">{p.label}</span>
                        <span className="flex items-center gap-1 shrink-0">
                          {isOverridden && <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Отредактировано" />}
                          <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {!selectedPage || !draft ? (
          <div className="h-full flex items-center justify-center text-muted-foreground border rounded-lg p-12 text-center">
            Выберите страницу слева, чтобы редактировать её SEO
          </div>
        ) : (
          <div className="border rounded-lg p-5 space-y-5 max-w-2xl">
            <div>
              <h3 className="font-semibold text-lg">{selectedPage.label}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedPage.type === "home" && "Мета-теги главной страницы (title, description)."}
                {selectedPage.type === "category" && "Мета-теги категории — видны и людям (в <head>), и поисковым ботам."}
                {selectedPage.type === "subcategory" && "Мета-теги подкатегории каталога."}
                {selectedPage.type === "artist" && "То же поле, что и в разделе «Артисты» → SEO — изменения синхронизированы."}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Title (заголовок вкладки/страницы)</label>
              <Input
                value={draft.title}
                onChange={e => setDraft({ ...draft, title: e.target.value })}
                placeholder={selectedPage.fields.title.default || "Не задано"}
                data-testid="input-seo-title"
              />
              <p className="text-xs text-muted-foreground">{draft.title.length} символов (рекомендуется 50–70)</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description (мета-описание)</label>
              <Textarea
                value={draft.description}
                onChange={e => setDraft({ ...draft, description: e.target.value })}
                placeholder={selectedPage.fields.description.default || "Не задано"}
                rows={4}
                data-testid="input-seo-description"
              />
              <p className="text-xs text-muted-foreground">{draft.description.length} символов (рекомендуется 120–160)</p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving} data-testid="button-seo-save">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Сохранить
              </Button>
              {(draft.title !== selectedPage.fields.title.default || draft.description !== selectedPage.fields.description.default) && (
                <Button
                  variant="ghost"
                  onClick={() => setDraft({ title: selectedPage.fields.title.default, description: selectedPage.fields.description.default })}
                  data-testid="button-seo-reset"
                >
                  Сбросить к значению по умолчанию
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
