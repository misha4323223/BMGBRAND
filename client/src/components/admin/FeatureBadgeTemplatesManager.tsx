import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "@/lib/admin-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FEATURE_BADGE_ICONS, getFeatureBadgeIcon, type FeatureBadgeTemplate } from "@/lib/featureBadgeIcons";
import { Sparkles, ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";

export function FeatureBadgeTemplatesManager({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftIcon, setDraftIcon] = useState("Sparkles");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");

  const { data: templatesRaw, refetch } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/product_feature_templates"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/product_feature_templates");
      if (!res.ok) return {};
      return res.json();
    },
  });

  const templates: FeatureBadgeTemplate[] = Object.entries(templatesRaw || {}).map(([id, t]: [string, any]) => ({
    id,
    icon: t.icon || "Sparkles",
    title: t.title || "",
    description: t.description || "",
  }));

  const resetDraft = () => {
    setEditingId(null);
    setDraftIcon("Sparkles");
    setDraftTitle("");
    setDraftDescription("");
  };

  const startEdit = (t: FeatureBadgeTemplate) => {
    setEditingId(t.id);
    setDraftIcon(t.icon);
    setDraftTitle(t.title);
    setDraftDescription(t.description);
  };

  const handleSave = async () => {
    if (!draftTitle.trim()) {
      toast({ title: "Укажите заголовок", variant: "destructive" });
      return;
    }
    const id = editingId || `badge_${Date.now()}`;
    try {
      await adminFetch(`/api/admin/page-settings/product_feature_templates/${id}`, apiKey, {
        method: "POST",
        body: JSON.stringify({ icon: draftIcon, title: draftTitle.trim(), description: draftDescription.trim() }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/page-settings/product_feature_templates"] });
      await refetch();
      resetDraft();
      toast({ title: editingId ? "Шаблон обновлён" : "Шаблон создан" });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить шаблон? Он перестанет отображаться на товарах, где выбран.")) return;
    try {
      await adminFetch(`/api/admin/page-settings/product_feature_templates/${id}`, apiKey, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["/api/page-settings/product_feature_templates"] });
      await refetch();
      toast({ title: "Шаблон удалён" });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="border rounded-lg mb-4">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
        onClick={() => setOpen(!open)}
        data-testid="button-toggle-feature-badge-templates"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          Шаблоны характеристик товара ({templates.length})
        </span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Шаблон — это иконка + заголовок + подпись (например «100% хлопок» / «Приятная к телу»).
            Создайте один раз, дальше просто отмечайте нужные шаблоны у каждого товара — иконку каждый раз выбирать не нужно.
          </p>

          {/* Existing templates */}
          <div className="space-y-2">
            {templates.map((t) => {
              const Icon = getFeatureBadgeIcon(t.icon);
              return (
                <div key={t.id} className="flex items-center gap-3 border rounded-md p-2" data-testid={`row-feature-badge-template-${t.id}`}>
                  <Icon className="w-5 h-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.title}</div>
                    {t.description && <div className="text-xs text-muted-foreground truncate">{t.description}</div>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(t)} data-testid={`button-edit-feature-badge-${t.id}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(t.id)} data-testid={`button-delete-feature-badge-${t.id}`}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              );
            })}
            {templates.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Пока нет ни одного шаблона.</p>
            )}
          </div>

          {/* Create / edit form */}
          <div className="border-t pt-3 space-y-2">
            <label className="text-xs font-medium text-muted-foreground block">
              {editingId ? "Редактировать шаблон" : "Новый шаблон"}
            </label>
            <div className="flex flex-wrap gap-1.5" data-testid="grid-feature-badge-icon-picker">
              {FEATURE_BADGE_ICONS.map(({ name, label, Icon }) => (
                <button
                  key={name}
                  type="button"
                  title={label}
                  onClick={() => setDraftIcon(name)}
                  className={`w-9 h-9 flex items-center justify-center rounded-md border transition-colors ${
                    draftIcon === name ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:text-foreground"
                  }`}
                  data-testid={`button-pick-icon-${name}`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
            <Input
              placeholder="Заголовок, например: 100% хлопок"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              data-testid="input-feature-badge-title"
            />
            <Input
              placeholder="Подпись, например: Приятная к телу"
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              data-testid="input-feature-badge-description"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} data-testid="button-save-feature-badge-template">
                {editingId ? "Сохранить изменения" : "Добавить шаблон"}
              </Button>
              {editingId && (
                <Button size="sm" variant="ghost" onClick={resetDraft} data-testid="button-cancel-feature-badge-edit">
                  Отмена
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

