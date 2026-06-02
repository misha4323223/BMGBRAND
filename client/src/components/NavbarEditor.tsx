import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Save, Plus, Trash2, GripVertical, ArrowUp, ArrowDown, Eye, EyeOff, Search, ShoppingBag, User, Loader2, RotateCcw } from "lucide-react";
import { DEFAULT_NAVBAR_SETTINGS } from "./navbar-settings";
import type { NavbarLink, NavbarSettings } from "./navbar-settings";
export type { NavbarLink, NavbarSettings };
export { DEFAULT_NAVBAR_SETTINGS };

const STYLE_PRESETS: { value: NavbarSettings["style"]; label: string; description: string }[] = [
  { value: "pill", label: "Капсула", description: "Плавающая скруглённая панель" },
  { value: "classic", label: "Классика", description: "Полная ширина с тенью" },
  { value: "transparent", label: "Прозрачная", description: "Прозрачный фон с размытием" },
  { value: "minimal", label: "Минимал", description: "Тонкая линия снизу" },
];

const MAX_WIDTH_OPTIONS = [
  { value: "max-w-3xl", label: "Узкий (768px)" },
  { value: "max-w-4xl", label: "Средний (896px)" },
  { value: "max-w-5xl", label: "Широкий (1024px)" },
  { value: "max-w-6xl", label: "Очень широкий (1152px)" },
  { value: "max-w-full", label: "Полная ширина" },
];

interface NavbarEditorProps {
  apiKey: string;
}

async function adminFetch(url: string, apiKey: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...options.headers, "x-api-key": apiKey },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export function NavbarEditor({ apiKey }: NavbarEditorProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<NavbarSettings>(DEFAULT_NAVBAR_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newLink, setNewLink] = useState({ label: "", href: "" });
  const [addingLink, setAddingLink] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const res = await fetch("/api/page-settings/navbar");
      const data = await res.json();
      if (data?.navbar_data) {
        const parsed = typeof data.navbar_data === "string" ? JSON.parse(data.navbar_data) : data.navbar_data;
        setSettings({ ...DEFAULT_NAVBAR_SETTINGS, ...parsed });
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    try {
      setSaving(true);
      await adminFetch("/api/admin/page-settings/navbar/navbar_data", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/page-settings/navbar"] });
      toast({ title: "Настройки шапки сохранены" });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function moveLink(index: number, direction: "up" | "down") {
    const newLinks = [...settings.links];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newLinks.length) return;
    [newLinks[index], newLinks[targetIndex]] = [newLinks[targetIndex], newLinks[index]];
    setSettings({ ...settings, links: newLinks });
  }

  function removeLink(index: number) {
    setSettings({ ...settings, links: settings.links.filter((_, i) => i !== index) });
  }

  function addLink() {
    if (!newLink.label.trim() || !newLink.href.trim()) return;
    setSettings({
      ...settings,
      links: [...settings.links, { label: newLink.label.trim(), href: newLink.href.trim(), visible: true }],
    });
    setNewLink({ label: "", href: "" });
    setAddingLink(false);
  }

  function updateLink(index: number, field: keyof NavbarLink, value: string | boolean) {
    const newLinks = [...settings.links];
    newLinks[index] = { ...newLinks[index], [field]: value };
    setSettings({ ...settings, links: newLinks });
  }

  function resetToDefaults() {
    setSettings(DEFAULT_NAVBAR_SETTINGS);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Настройки шапки сайта</h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={resetToDefaults} data-testid="button-navbar-reset">
            <RotateCcw className="w-4 h-4 mr-1" />
            Сбросить
          </Button>
          <Button size="sm" onClick={saveSettings} disabled={saving} data-testid="button-navbar-save">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Сохранить
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Логотип</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Основной текст</Label>
                <Input
                  value={settings.logoText}
                  onChange={(e) => setSettings({ ...settings, logoText: e.target.value })}
                  placeholder="BMG"
                  data-testid="input-logo-text"
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Акцентный текст</Label>
                <Input
                  value={settings.logoAccentText}
                  onChange={(e) => setSettings({ ...settings, logoAccentText: e.target.value })}
                  placeholder="BRAND"
                  data-testid="input-logo-accent"
                />
              </div>
            </div>
            <div className="p-3 bg-muted rounded-md text-center">
              <span className="text-lg font-semibold tracking-tight">
                {settings.logoText}<span className="text-primary">{settings.logoAccentText}</span>
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Стиль шапки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setSettings({ ...settings, style: preset.value })}
                  className={`p-3 rounded-md border text-left transition-colors ${
                    settings.style === preset.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover-elevate"
                  }`}
                  data-testid={`button-style-${preset.value}`}
                >
                  <div className="text-sm font-medium">{preset.label}</div>
                  <div className="text-xs text-muted-foreground">{preset.description}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Навигационные ссылки</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddingLink(true)}
                disabled={addingLink}
                data-testid="button-add-link"
              >
                <Plus className="w-4 h-4 mr-1" />
                Добавить
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {settings.links.map((link, index) => (
              <div
                key={index}
                className={`flex items-center gap-2 p-2 rounded-md border ${
                  link.visible ? "border-border" : "border-border/50 opacity-60"
                }`}
                data-testid={`link-row-${index}`}
              >
                <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => moveLink(index, "up")}
                    disabled={index === 0}
                    data-testid={`button-move-up-${index}`}
                  >
                    <ArrowUp className="w-3 h-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => moveLink(index, "down")}
                    disabled={index === settings.links.length - 1}
                    data-testid={`button-move-down-${index}`}
                  >
                    <ArrowDown className="w-3 h-3" />
                  </Button>
                </div>
                <Input
                  value={link.label}
                  onChange={(e) => updateLink(index, "label", e.target.value)}
                  className="flex-1"
                  placeholder="Название"
                  data-testid={`input-link-label-${index}`}
                />
                <Input
                  value={link.href}
                  onChange={(e) => updateLink(index, "href", e.target.value)}
                  className="flex-1"
                  placeholder="/path"
                  data-testid={`input-link-href-${index}`}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => updateLink(index, "visible", !link.visible)}
                  data-testid={`button-toggle-link-${index}`}
                >
                  {link.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeLink(index)}
                  data-testid={`button-remove-link-${index}`}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}

            {addingLink && (
              <div className="flex items-center gap-2 p-2 rounded-md border border-primary/30 bg-primary/5">
                <div className="w-4" />
                <div className="w-[68px]" />
                <Input
                  value={newLink.label}
                  onChange={(e) => setNewLink({ ...newLink, label: e.target.value })}
                  className="flex-1"
                  placeholder="Название ссылки"
                  autoFocus
                  data-testid="input-new-link-label"
                />
                <Input
                  value={newLink.href}
                  onChange={(e) => setNewLink({ ...newLink, href: e.target.value })}
                  className="flex-1"
                  placeholder="/products"
                  data-testid="input-new-link-href"
                />
                <Button size="sm" onClick={addLink} disabled={!newLink.label.trim() || !newLink.href.trim()} data-testid="button-confirm-add-link">
                  Добавить
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAddingLink(false); setNewLink({ label: "", href: "" }); }} data-testid="button-cancel-add-link">
                  Отмена
                </Button>
              </div>
            )}

            {settings.links.length === 0 && !addingLink && (
              <div className="text-center py-6 text-muted-foreground text-sm">
                Нет ссылок. Нажмите «Добавить» чтобы создать.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Элементы шапки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground" />
                <Label>Поиск</Label>
              </div>
              <Switch
                checked={settings.showSearch}
                onCheckedChange={(v) => setSettings({ ...settings, showSearch: v })}
                data-testid="switch-search"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                <Label>Корзина</Label>
              </div>
              <Switch
                checked={settings.showCart}
                onCheckedChange={(v) => setSettings({ ...settings, showCart: v })}
                data-testid="switch-cart"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <Label>Аккаунт</Label>
              </div>
              <Switch
                checked={settings.showUser}
                onCheckedChange={(v) => setSettings({ ...settings, showUser: v })}
                data-testid="switch-user"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowUp className="w-4 h-4 text-muted-foreground rotate-[-90deg]" />
                <Label>Кнопка «Назад»</Label>
              </div>
              <Switch
                checked={settings.showBackButton}
                onCheckedChange={(v) => setSettings({ ...settings, showBackButton: v })}
                data-testid="switch-back-button"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Дополнительно</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Максимальная ширина</Label>
              <Select
                value={settings.maxWidth}
                onValueChange={(v) => setSettings({ ...settings, maxWidth: v })}
              >
                <SelectTrigger data-testid="select-max-width">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAX_WIDTH_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Позиция</Label>
              <Select
                value={settings.position}
                onValueChange={(v: "floating" | "fixed-top") => setSettings({ ...settings, position: v })}
              >
                <SelectTrigger data-testid="select-position">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="floating">Плавающая (с отступом)</SelectItem>
                  <SelectItem value="fixed-top">Фиксированная сверху</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Предпросмотр</CardTitle>
        </CardHeader>
        <CardContent>
          <NavbarPreview settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}

function NavbarPreview({ settings }: { settings: NavbarSettings }) {
  const visibleLinks = settings.links.filter((l) => l.visible);

  const getNavClasses = () => {
    switch (settings.style) {
      case "pill":
        return "bg-card border border-border rounded-full shadow-md px-4 py-2.5";
      case "classic":
        return "bg-card shadow-md px-6 py-3 rounded-none";
      case "transparent":
        return "bg-card/70 backdrop-blur-md border-b border-border/50 px-6 py-3 rounded-none";
      case "minimal":
        return "bg-transparent border-b border-border px-6 py-3 rounded-none";
      default:
        return "bg-card border border-border rounded-full shadow-md px-4 py-2.5";
    }
  };

  const getActiveClasses = () => {
    switch (settings.style) {
      case "pill":
        return "bg-secondary text-secondary-foreground font-medium rounded-full";
      case "classic":
        return "border-b-2 border-primary text-foreground font-medium";
      case "transparent":
        return "bg-white/10 text-foreground font-medium rounded-md";
      case "minimal":
        return "text-primary font-medium border-b-2 border-primary";
      default:
        return "bg-secondary text-secondary-foreground font-medium rounded-full";
    }
  };

  return (
    <div className="bg-muted/50 rounded-md p-4 overflow-hidden">
      <div className={`mx-auto ${settings.maxWidth !== "max-w-full" ? "max-w-2xl" : "w-full"}`}>
        <div className={getNavClasses()}>
          <div className="flex items-center justify-between h-8">
            <div className="flex items-center gap-2">
              {settings.showBackButton && (
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground">
                  <ArrowUp className="w-4 h-4 rotate-[-90deg]" />
                </div>
              )}
              <span className="text-lg font-semibold tracking-tight">
                {settings.logoText}<span className="text-primary">{settings.logoAccentText}</span>
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-1">
              {visibleLinks.map((link, i) => (
                <span
                  key={i}
                  className={`px-3 py-1.5 text-sm transition-all ${
                    i === 0 ? getActiveClasses() : "text-muted-foreground"
                  }`}
                >
                  {link.label}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {settings.showSearch && <Search className="w-5 h-5 text-muted-foreground mx-1" />}
              {settings.showUser && <User className="w-5 h-5 text-muted-foreground mx-1" />}
              {settings.showCart && (
                <div className="relative mx-1">
                  <ShoppingBag className="w-5 h-5 text-muted-foreground" />
                  <span className="absolute -top-1 -right-1 bg-primary text-white text-[8px] font-bold w-3.5 h-3.5 flex items-center justify-center rounded-full">
                    3
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
