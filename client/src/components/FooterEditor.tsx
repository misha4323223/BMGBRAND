import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Save, Plus, Trash2, ArrowUp, ArrowDown, Loader2, RotateCcw, Eye, EyeOff, Link as LinkIcon } from "lucide-react";
import { DEFAULT_FOOTER_SETTINGS } from "./footer-settings";
import type { FooterSocialLink, FooterNavLink, FooterNavColumn, FooterSettings } from "./footer-settings";
export type { FooterSocialLink, FooterNavLink, FooterNavColumn, FooterSettings };
export { DEFAULT_FOOTER_SETTINGS };

const SOCIAL_PLATFORMS = [
  { value: "vk", label: "ВКонтакте" },
  { value: "telegram", label: "Telegram" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "whatsapp", label: "WhatsApp" },
];

const STYLE_PRESETS: { value: FooterSettings["style"]; label: string; description: string }[] = [
  { value: "classic", label: "Классический", description: "Логотип слева, колонки справа" },
  { value: "minimal", label: "Минимальный", description: "Компактный в одну строку" },
  { value: "centered", label: "Центрированный", description: "Всё по центру, соцсети внизу" },
];

const COLOR_SCHEMES: { value: FooterSettings["colorScheme"]; label: string; description: string; preview: string }[] = [
  { value: "dark", label: "Тёмный", description: "Тёмный фон, светлый текст", preview: "bg-secondary" },
  { value: "light", label: "Светлый", description: "Светлый фон, тёмный текст", preview: "bg-card" },
  { value: "brand", label: "Фирменный", description: "Акцентный фон, белый текст", preview: "bg-primary" },
];

interface FooterEditorProps {
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

export function FooterEditor({ apiKey }: FooterEditorProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<FooterSettings>(DEFAULT_FOOTER_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingSocial, setAddingSocial] = useState(false);
  const [newSocial, setNewSocial] = useState({ platform: "vk", url: "" });

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const res = await fetch("/api/page-settings/footer");
      const data = await res.json();
      if (data?.footer_data) {
        const parsed = typeof data.footer_data === "string" ? JSON.parse(data.footer_data) : data.footer_data;
        const merged = { ...DEFAULT_FOOTER_SETTINGS, ...parsed };
        if (merged.socialLinks && !merged.socialLinks.some((l: FooterSocialLink) => l.platform === "instagram")) {
          merged.socialLinks = [...merged.socialLinks, { platform: "instagram", url: "https://www.instagram.com/bmgbrand/", visible: true }];
        }
        setSettings(merged);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    try {
      setSaving(true);
      await adminFetch("/api/admin/page-settings/footer/footer_data", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/page-settings/footer"] });
      toast({ title: "Настройки подвала сохранены" });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function resetToDefaults() {
    setSettings(DEFAULT_FOOTER_SETTINGS);
  }

  function updateColumn(colIndex: number, field: string, value: any) {
    const newCols = [...settings.columns];
    newCols[colIndex] = { ...newCols[colIndex], [field]: value };
    setSettings({ ...settings, columns: newCols });
  }

  function updateColumnLink(colIndex: number, linkIndex: number, field: string, value: any) {
    const newCols = [...settings.columns];
    const newLinks = [...newCols[colIndex].links];
    newLinks[linkIndex] = { ...newLinks[linkIndex], [field]: value };
    newCols[colIndex] = { ...newCols[colIndex], links: newLinks };
    setSettings({ ...settings, columns: newCols });
  }

  function removeColumnLink(colIndex: number, linkIndex: number) {
    const newCols = [...settings.columns];
    newCols[colIndex] = { ...newCols[colIndex], links: newCols[colIndex].links.filter((_, i) => i !== linkIndex) };
    setSettings({ ...settings, columns: newCols });
  }

  function addColumnLink(colIndex: number) {
    const newCols = [...settings.columns];
    newCols[colIndex] = { ...newCols[colIndex], links: [...newCols[colIndex].links, { label: "Новая ссылка", href: "/", visible: true }] };
    setSettings({ ...settings, columns: newCols });
  }

  function moveColumnLink(colIndex: number, linkIndex: number, direction: "up" | "down") {
    const newCols = [...settings.columns];
    const newLinks = [...newCols[colIndex].links];
    const targetIndex = direction === "up" ? linkIndex - 1 : linkIndex + 1;
    if (targetIndex < 0 || targetIndex >= newLinks.length) return;
    [newLinks[linkIndex], newLinks[targetIndex]] = [newLinks[targetIndex], newLinks[linkIndex]];
    newCols[colIndex] = { ...newCols[colIndex], links: newLinks };
    setSettings({ ...settings, columns: newCols });
  }

  function addColumn() {
    setSettings({ ...settings, columns: [...settings.columns, { title: "Новая колонка", visible: true, links: [] }] });
  }

  function removeColumn(index: number) {
    setSettings({ ...settings, columns: settings.columns.filter((_, i) => i !== index) });
  }

  function addSocialLink() {
    if (!newSocial.url.trim()) return;
    setSettings({
      ...settings,
      socialLinks: [...settings.socialLinks, { platform: newSocial.platform, url: newSocial.url.trim(), visible: true }],
    });
    setNewSocial({ platform: "vk", url: "" });
    setAddingSocial(false);
  }

  function removeSocialLink(index: number) {
    setSettings({ ...settings, socialLinks: settings.socialLinks.filter((_, i) => i !== index) });
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
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-medium">Настройки подвала сайта</h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={resetToDefaults} data-testid="button-footer-reset">
            <RotateCcw className="w-4 h-4 mr-1" />
            Сбросить
          </Button>
          <Button size="sm" onClick={saveSettings} disabled={saving} data-testid="button-footer-save">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Сохранить
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <Label className="font-medium">Стиль подвала</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setSettings({ ...settings, style: preset.value })}
                className={`p-3 rounded-md border text-left transition-all ${settings.style === preset.value ? "border-primary bg-primary/5" : "border-border"}`}
                data-testid={`button-footer-style-${preset.value}`}
              >
                <div className="font-medium text-sm">{preset.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{preset.description}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-4">
          <Label className="font-medium">Цветовая схема</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {COLOR_SCHEMES.map((scheme) => (
              <button
                key={scheme.value}
                onClick={() => setSettings({ ...settings, colorScheme: scheme.value })}
                className={`p-3 rounded-md border text-left transition-all ${settings.colorScheme === scheme.value ? "border-primary bg-primary/5" : "border-border"}`}
                data-testid={`button-footer-color-${scheme.value}`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-md ${scheme.preview} border`} />
                  <div>
                    <div className="font-medium text-sm">{scheme.label}</div>
                    <div className="text-xs text-muted-foreground">{scheme.description}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <Label className="font-medium">Логотип и описание</Label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Основной текст</Label>
              <Input
                value={settings.logoText}
                onChange={(e) => setSettings({ ...settings, logoText: e.target.value })}
                placeholder="BMG"
                data-testid="input-footer-logo-text"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Акцентный текст</Label>
              <Input
                value={settings.logoAccentText}
                onChange={(e) => setSettings({ ...settings, logoAccentText: e.target.value })}
                placeholder="BRAND"
                data-testid="input-footer-logo-accent"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Описание</Label>
            <Textarea
              value={settings.description}
              onChange={(e) => setSettings({ ...settings, description: e.target.value })}
              placeholder="Описание бренда..."
              className="resize-none"
              rows={3}
              data-testid="textarea-footer-description"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label className="font-medium">Соцсети</Label>
            <Button size="sm" variant="outline" onClick={() => setAddingSocial(!addingSocial)} data-testid="button-footer-add-social">
              <Plus className="w-4 h-4 mr-1" />
              Добавить
            </Button>
          </div>

          {addingSocial && (
            <div className="flex items-end gap-2 p-3 bg-muted/50 rounded-md">
              <div className="flex-shrink-0">
                <Label className="text-xs">Платформа</Label>
                <Select value={newSocial.platform} onValueChange={(v) => setNewSocial({ ...newSocial, platform: v })}>
                  <SelectTrigger className="w-36" data-testid="select-footer-new-social-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOCIAL_PLATFORMS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label className="text-xs">URL</Label>
                <Input
                  value={newSocial.url}
                  onChange={(e) => setNewSocial({ ...newSocial, url: e.target.value })}
                  placeholder="https://..."
                  data-testid="input-footer-new-social-url"
                />
              </div>
              <Button size="sm" onClick={addSocialLink} data-testid="button-footer-confirm-social">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {settings.socialLinks.map((social, index) => (
              <div key={index} className="flex items-center gap-2 p-2 bg-muted/30 rounded-md">
                <span className="text-sm font-medium w-24 flex-shrink-0">
                  {SOCIAL_PLATFORMS.find((p) => p.value === social.platform)?.label || social.platform}
                </span>
                <Input
                  value={social.url}
                  onChange={(e) => {
                    const newLinks = [...settings.socialLinks];
                    newLinks[index] = { ...newLinks[index], url: e.target.value };
                    setSettings({ ...settings, socialLinks: newLinks });
                  }}
                  className="flex-1 text-sm"
                  data-testid={`input-footer-social-url-${index}`}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    const newLinks = [...settings.socialLinks];
                    newLinks[index] = { ...newLinks[index], visible: !newLinks[index].visible };
                    setSettings({ ...settings, socialLinks: newLinks });
                  }}
                  data-testid={`button-footer-social-toggle-${index}`}
                >
                  {social.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => removeSocialLink(index)} data-testid={`button-footer-social-remove-${index}`}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
            {settings.socialLinks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">Нет соцсетей</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label className="font-medium">Навигационные колонки</Label>
            {settings.columns.length < 4 && (
              <Button size="sm" variant="outline" onClick={addColumn} data-testid="button-footer-add-column">
                <Plus className="w-4 h-4 mr-1" />
                Добавить колонку
              </Button>
            )}
          </div>

          {settings.columns.map((col, colIndex) => (
            <div key={colIndex} className="border rounded-md p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={col.title}
                  onChange={(e) => updateColumn(colIndex, "title", e.target.value)}
                  className="font-medium flex-1"
                  placeholder="Заголовок колонки"
                  data-testid={`input-footer-col-title-${colIndex}`}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => updateColumn(colIndex, "visible", !col.visible)}
                  data-testid={`button-footer-col-toggle-${colIndex}`}
                >
                  {col.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => removeColumn(colIndex)} data-testid={`button-footer-col-remove-${colIndex}`}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>

              <div className="space-y-1">
                {col.links.map((link, linkIndex) => (
                  <div key={linkIndex} className="flex items-center gap-1.5 pl-2">
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveColumnLink(colIndex, linkIndex, "up")}
                        className="p-0.5 text-muted-foreground hover:text-foreground"
                        disabled={linkIndex === 0}
                        data-testid={`button-footer-link-up-${colIndex}-${linkIndex}`}
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => moveColumnLink(colIndex, linkIndex, "down")}
                        className="p-0.5 text-muted-foreground hover:text-foreground"
                        disabled={linkIndex === col.links.length - 1}
                        data-testid={`button-footer-link-down-${colIndex}-${linkIndex}`}
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>
                    <Input
                      value={link.label}
                      onChange={(e) => updateColumnLink(colIndex, linkIndex, "label", e.target.value)}
                      className="flex-1 text-sm"
                      placeholder="Текст"
                      data-testid={`input-footer-link-label-${colIndex}-${linkIndex}`}
                    />
                    <Input
                      value={link.href}
                      onChange={(e) => updateColumnLink(colIndex, linkIndex, "href", e.target.value)}
                      className="flex-1 text-sm"
                      placeholder="/путь или URL"
                      data-testid={`input-footer-link-href-${colIndex}-${linkIndex}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => updateColumnLink(colIndex, linkIndex, "visible", !link.visible)}
                      data-testid={`button-footer-link-toggle-${colIndex}-${linkIndex}`}
                    >
                      {link.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => removeColumnLink(colIndex, linkIndex)} data-testid={`button-footer-link-remove-${colIndex}-${linkIndex}`}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="ghost" className="w-full" onClick={() => addColumnLink(colIndex)} data-testid={`button-footer-add-link-${colIndex}`}>
                <Plus className="w-4 h-4 mr-1" />
                Добавить ссылку
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <Label className="font-medium">Нижняя строка</Label>
          <div>
            <Label className="text-xs text-muted-foreground">Текст копирайта (после &copy; год)</Label>
            <Input
              value={settings.copyrightText}
              onChange={(e) => setSettings({ ...settings, copyrightText: e.target.value })}
              placeholder="Booomerangs"
              data-testid="input-footer-copyright"
            />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch
                checked={settings.showPrivacyLink}
                onCheckedChange={(v) => setSettings({ ...settings, showPrivacyLink: v })}
                data-testid="switch-footer-privacy"
              />
              <Label className="text-sm">Политика конфиденциальности</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={settings.showTermsLink}
                onCheckedChange={(v) => setSettings({ ...settings, showTermsLink: v })}
                data-testid="switch-footer-terms"
              />
              <Label className="text-sm">Публичная оферта</Label>
            </div>
          </div>
          {settings.showPrivacyLink && (
            <Input
              value={settings.privacyLinkText}
              onChange={(e) => setSettings({ ...settings, privacyLinkText: e.target.value })}
              placeholder="Политика конфиденциальности"
              data-testid="input-footer-privacy-text"
            />
          )}
          {settings.showTermsLink && (
            <Input
              value={settings.termsLinkText}
              onChange={(e) => setSettings({ ...settings, termsLinkText: e.target.value })}
              placeholder="Публичная оферта"
              data-testid="input-footer-terms-text"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-4 h-4 text-muted-foreground" />
            <Label className="font-medium">Кредит разработчика</Label>
          </div>
          <p className="text-xs text-muted-foreground">Текст и ссылка, которые отображаются под копирайтом</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Текст</Label>
              <Input
                value={settings.creditText}
                onChange={(e) => setSettings({ ...settings, creditText: e.target.value })}
                placeholder="Разработано компанией X"
                data-testid="input-footer-credit-text"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Ссылка</Label>
              <Input
                value={settings.creditUrl}
                onChange={(e) => setSettings({ ...settings, creditUrl: e.target.value })}
                placeholder="https://example.com"
                data-testid="input-footer-credit-url"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
