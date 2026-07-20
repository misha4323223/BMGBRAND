import { useState, useMemo, useEffect, useRef } from "react";
import * as XLSX from 'xlsx';
import PushNotificationsPanel from "@/components/admin/PushNotificationsPanel";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Trash2, RefreshCw, Lock, Search, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Image, MoveRight, MoreVertical, Settings, CheckSquare, Building2, Check, X, Users, Package, EyeOff, Eye, Gift, ShoppingCart, Clock, Truck, CreditCard, Ban, Star, Mail, TrendingUp, TrendingDown, Tag, Save, Plus, Pencil, Loader2, Layout, Type, ImageIcon, DollarSign, Upload, MessageSquare, Send, CheckCircle2, LogOut, Heart, Copy, Target, GripVertical, Bell, Phone, User, ChevronDown, ChevronRight, PlusCircle, MinusCircle, FileText, Ruler, Download, Music, Headphones, Play, Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Briefcase, MapPin, BarChart3, Handshake } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AnalyticsTab } from "@/pages/admin/AnalyticsTab";
import { PartnersTab } from "@/pages/admin/PartnersTab";
import { AiKnowledgeTab } from "@/pages/admin/AiKnowledgeTab";
import { SeoTab } from "@/pages/admin/SeoTab";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES, normalizeCategories, type Product, type CategorySlug } from "@shared/schema";
import SEO from "@/components/SEO";
import { NavbarEditor } from "@/components/NavbarEditor";
import { FooterEditor } from "@/components/FooterEditor";
import { CheckoutEditor } from "@/components/CheckoutEditor";
import EmailEditor from "@/components/EmailEditor";
import { MediaUploadField, ImageUploadField, VideoUploadField } from "@/components/admin/MediaUploadField";
import { FEATURE_BADGE_ICONS, getFeatureBadgeIcon, type FeatureBadgeTemplate } from "@/lib/featureBadgeIcons";

interface WholesaleUser {
  id: number;
  email: string;
  name: string;
  emailVerified: boolean;
  companyName: string | null;
  inn: string | null;
  kpp: string | null;
  legalAddress: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  wholesaleApproved: boolean;
  wholesaleDiscount: number;
  createdAt: string | null;
}

async function adminFetch(url: string, apiKey: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    ...(options.headers as Record<string, string>),
  };
  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  
  console.log(`[adminFetch] ${options.method || 'GET'} ${url} body-length: ${options.body ? (options.body as string).length : 0}`);
  
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (networkErr: any) {
    console.error(`[adminFetch] Network error for ${options.method || 'GET'} ${url}:`, networkErr.message);
    throw networkErr;
  }
  
  console.log(`[adminFetch] Response: ${response.status} ${response.statusText}`);
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error(`[adminFetch] Non-JSON response from ${url}:`, text.substring(0, 200));
    throw new Error("Server returned non-JSON response");
  }
}

function InvoiceVatSettings({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const [vatRate, setVatRate] = useState<string>("5");
  const [vatMode, setVatMode] = useState<string>("included");
  const [vatLoaded, setVatLoaded] = useState(false);

  const { data: settingsData } = useQuery<Record<string, string>>({
    queryKey: ["/api/bonus-settings", "vat"],
    queryFn: async () => adminFetch("/api/bonus-settings", apiKey),
    enabled: !!apiKey,
  });

  useEffect(() => {
    if (settingsData && !vatLoaded) {
      const storedRate = settingsData["invoice_vat_rate"];
      if (storedRate) setVatRate(storedRate);
      const storedMode = settingsData["invoice_vat_mode"];
      if (storedMode === "on_top" || storedMode === "included") setVatMode(storedMode);
      setVatLoaded(true);
    }
  }, [settingsData, vatLoaded]);

  const saveVatMutation = useMutation({
    mutationFn: async ({ rate, mode }: { rate: string; mode: string }) => {
      const num = parseFloat(rate);
      if (isNaN(num) || num < 0 || num > 100) {
        throw new Error("Значение НДС должно быть от 0 до 100");
      }
      await adminFetch("/api/bonus-settings", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "invoice_vat_rate", value: String(num) }),
      });
      await adminFetch("/api/bonus-settings", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "invoice_vat_mode", value: mode }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bonus-settings"] });
      toast({ title: "Сохранено", description: "Настройки НДС обновлены" });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Ошибка", description: "Не удалось сохранить настройки НДС" });
    },
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">Настройки НДС в счетах</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="vat-rate" className="text-sm text-muted-foreground whitespace-nowrap">Ставка:</Label>
            <Input
              id="vat-rate"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
              className="w-20 text-center"
              data-testid="input-vat-rate"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">Режим:</Label>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={vatMode === "included" ? "default" : "outline"}
                onClick={() => setVatMode("included")}
                data-testid="button-vat-included"
              >
                В том числе
              </Button>
              <Button
                size="sm"
                variant={vatMode === "on_top" ? "default" : "outline"}
                onClick={() => setVatMode("on_top")}
                data-testid="button-vat-on-top"
              >
                Сверху
              </Button>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => saveVatMutation.mutate({ rate: vatRate, mode: vatMode })}
            disabled={saveVatMutation.isPending}
            data-testid="button-save-vat"
          >
            {saveVatMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
            Сохранить
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {vatMode === "included"
            ? "НДС включён в сумму — итоговая сумма не меняется, НДС выделяется из неё"
            : "НДС сверху суммы — к итогу добавляется сумма НДС, покупатель платит больше"}
        </p>
      </CardContent>
    </Card>
  );
}

interface VacancyItem {
  id: string;
  title: string;
  location: string;
  type: string;
  description: string;
  visible: boolean;
}

const DEFAULT_VACANCIES: VacancyItem[] = [
  {
    id: "1",
    title: "Менеджер по продажам",
    location: "Тула",
    type: "Полная занятость",
    description: "Ищем активного менеджера для работы с клиентами и развития продаж в онлайн и офлайн каналах.",
    visible: true,
  },
  {
    id: "2",
    title: "SMM-специалист",
    location: "Удалённо",
    type: "Частичная занятость",
    description: "Ведение социальных сетей бренда, создание контента, взаимодействие с аудиторией.",
    visible: true,
  },
  {
    id: "3",
    title: "Дизайнер одежды",
    location: "Тула",
    type: "Полная занятость",
    description: "Разработка новых коллекций, работа с принтами и паттернами, подбор материалов.",
    visible: true,
  },
];

function FeatureBadgeTemplatesManager({ apiKey }: { apiKey: string }) {
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

function ConceptPageEditor({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const { data: settings, refetch } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/concept"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/concept");
      if (!res.ok) return {};
      return res.json();
    },
  });

  const [initialized, setInitialized] = useState(false);

  // ── Hero slides ──────────────────────────────────────────────────────────
  const EMPTY_SLIDE = { heroImage: "", heroImageMobile: "", heroImageAlt: "", bgType: "image", heroVideo: "", tagline1: "", tagline2: "", buttonText: "", buttonLink: "" };
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const [heroSlides, setHeroSlides] = useState<any[]>([{ ...EMPTY_SLIDE }, { ...EMPTY_SLIDE }, { ...EMPTY_SLIDE }]);

  // ── Promo banner ─────────────────────────────────────────────────────────
  const [bannerEnabled, setBannerEnabled] = useState(false);
  const [bannerStyle, setBannerStyle] = useState<string>("neutral");
  const [bannerTitle, setBannerTitle] = useState<string>("");
  const [bannerText, setBannerText] = useState<string>("");
  const [bannerButtonText, setBannerButtonText] = useState<string>("");
  const [bannerButtonUrl, setBannerButtonUrl] = useState<string>("");

  useEffect(() => {
    if (settings && !initialized) {
      // Hero slides — обратная совместимость с одиночным hero.heroImage
      const hero = settings?.hero || {};
      const raw = hero.slides || (hero.heroImage ? [{ heroImage: hero.heroImage, heroImageMobile: hero.heroImageMobile || "", heroImageAlt: hero.heroImageAlt || "", bgType: "image", heroVideo: "", tagline1: "", tagline2: "", buttonText: "", buttonLink: "" }] : []);
      const normalized = [...raw];
      while (normalized.length < 3) normalized.push({ ...EMPTY_SLIDE });
      setHeroSlides(normalized);

      // Promo banner
      const b = settings?.promo_banner || {};
      setBannerEnabled(!!b.enabled);
      setBannerStyle(b.style || "neutral");
      setBannerTitle(b.title || "");
      setBannerText(b.text || "");
      setBannerButtonText(b.buttonText || "");
      setBannerButtonUrl(b.buttonUrl || "");
      setInitialized(true);
    }
  }, [settings, initialized]);

  const handleSaveHero = async () => {
    try {
      await adminFetch("/api/admin/page-settings/concept/hero", apiKey, {
        method: "POST",
        body: JSON.stringify({ slides: heroSlides }),
      });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/page-settings/concept"] });
      toast({ title: "Сохранено", description: "Баннеры страницы Pre-drop обновлены" });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  };

  const handleSaveBanner = async () => {
    try {
      await adminFetch("/api/admin/page-settings/concept/promo_banner", apiKey, {
        method: "POST",
        body: JSON.stringify({
          enabled: bannerEnabled,
          style: bannerStyle,
          title: bannerTitle,
          text: bannerText,
          buttonText: bannerButtonText,
          buttonUrl: bannerButtonUrl,
        }),
      });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/page-settings/concept"] });
      toast({ title: "Сохранено", description: "Промо-баннер обновлён" });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  };

  const BANNER_STYLE_OPTIONS = [
    { value: "neutral",     label: "Нейтральный",     desc: "Тёмный фон — для общих объявлений" },
    { value: "urgent",      label: "Срочный",          desc: "Красный — для важных предупреждений" },
    { value: "info",        label: "Информационный",   desc: "Синий — для пояснений и уведомлений" },
    { value: "highlight",   label: "Акцентный",        desc: "Жёлто-зелёный (фирменный) — для анонсов" },
  ];

  return (
    <div className="space-y-10">
      {/* Hero slides editor */}
      <div className="space-y-6">
        <div>
          <h3 className="text-base font-medium mb-1">Слайды баннера «Pre-drop»</h3>
          <p className="text-sm text-muted-foreground">
            До 3 слайдов. Слайды с заполненным изображением или видео показываются на странице.
            Один слайд — статичный баннер, несколько — слайдер (смена каждые 7 с).
          </p>
        </div>

        {/* Переключатель слайдов */}
        <div className="flex gap-2">
          {[0, 1, 2].map(i => {
            const s = heroSlides[i] || EMPTY_SLIDE;
            const isFilled = !!(s.heroImage || s.heroVideo);
            return (
              <div key={i} className="flex-1">
                <button
                  onClick={() => setHeroSlideIndex(i)}
                  className={`w-full py-2 px-2 rounded-md text-sm font-medium border transition-colors ${
                    heroSlideIndex === i
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-foreground border-border hover:bg-muted"
                  }`}
                >
                  Слайд {i + 1}
                  {isFilled && <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-green-500 inline-block align-middle" />}
                </button>
              </div>
            );
          })}
        </div>

        {/* Редактор текущего слайда */}
        {(() => {
          const currentSlide = heroSlides[heroSlideIndex] || EMPTY_SLIDE;
          const updateSlide = (updates: Record<string, any>) => {
            setHeroSlides(prev => prev.map((s, i) => i === heroSlideIndex ? { ...s, ...updates } : s));
          };
          return (
            <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
              {/* Тип фона */}
              <div className="flex gap-2">
                <Button size="sm" variant={currentSlide.bgType !== "video" ? "default" : "outline"} onClick={() => updateSlide({ bgType: "image" })}>Изображение</Button>
                <Button size="sm" variant={currentSlide.bgType === "video" ? "default" : "outline"} onClick={() => updateSlide({ bgType: "video" })}>Видео</Button>
              </div>

              {currentSlide.bgType !== "video" ? (
                <div className="space-y-3">
                  <div>
                    <Label className="text-sm">Изображение (десктоп)</Label>
                    <ImageUploadField value={currentSlide.heroImage || ""} onChange={url => updateSlide({ heroImage: url })} apiKey={apiKey} placeholder="URL или перетащите изображение" hint="Широкий формат — 2560×900 px, WebP/JPG" />
                  </div>
                  <div>
                    <Label className="text-sm">Изображение (мобильный) <span className="text-muted-foreground font-normal">— опционально</span></Label>
                    <ImageUploadField value={currentSlide.heroImageMobile || ""} onChange={url => updateSlide({ heroImageMobile: url })} apiKey={apiKey} placeholder="Если не загружено — используется десктопное" hint="1080×720 px, WebP/JPG" />
                  </div>
                  <div>
                    <Label className="text-sm">Alt-текст (SEO)</Label>
                    <Input value={currentSlide.heroImageAlt || ""} onChange={e => updateSlide({ heroImageAlt: e.target.value })} placeholder="Краткое описание изображения" />
                  </div>
                </div>
              ) : (
                <div>
                  <Label className="text-sm">Видео (MP4 / WebM)</Label>
                  <VideoUploadField value={currentSlide.heroVideo || ""} onChange={url => updateSlide({ heroVideo: url })} apiKey={apiKey} placeholder="URL или перетащите видео" />
                  <p className="text-xs text-muted-foreground mt-1">Видео воспроизводится в цикле без звука</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Слоган — строка 1 <span className="text-muted-foreground font-normal">— опционально</span></Label>
                  <Input value={currentSlide.tagline1 || ""} onChange={e => updateSlide({ tagline1: e.target.value })} placeholder="Текст поверх баннера" />
                </div>
                <div>
                  <Label className="text-sm">Слоган — строка 2 <span className="text-muted-foreground font-normal">— опционально</span></Label>
                  <Input value={currentSlide.tagline2 || ""} onChange={e => updateSlide({ tagline2: e.target.value })} placeholder="Вторая строка" />
                </div>
                <div>
                  <Label className="text-sm">Текст кнопки <span className="text-muted-foreground font-normal">— опционально</span></Label>
                  <Input value={currentSlide.buttonText || ""} onChange={e => updateSlide({ buttonText: e.target.value })} placeholder="Например: Смотреть коллекцию" />
                </div>
                <div>
                  <Label className="text-sm">Ссылка кнопки</Label>
                  <Input value={currentSlide.buttonLink || ""} onChange={e => updateSlide({ buttonLink: e.target.value })} placeholder="/concept или /products" />
                </div>
              </div>

              {(currentSlide.heroImage || currentSlide.heroVideo) && (
                <button
                  type="button"
                  onClick={() => updateSlide({ ...EMPTY_SLIDE })}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  Очистить слайд {heroSlideIndex + 1}
                </button>
              )}
            </div>
          );
        })()}

        <Button onClick={handleSaveHero}>
          <Save className="w-4 h-4 mr-2" /> Сохранить баннеры
        </Button>
      </div>

      {/* Promo banner */}
      <div className="space-y-6 border-t pt-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-medium mb-1">Промо-баннер</h3>
            <p className="text-sm text-muted-foreground">
              Небольшой информационный блок между хиро и сеткой товаров. Используйте для объявлений, предупреждений о досрочном закрытии предзаказа и т.п.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            <Label htmlFor="banner-enabled" className="text-sm">{bannerEnabled ? "Включён" : "Выключен"}</Label>
            <Switch
              id="banner-enabled"
              checked={bannerEnabled}
              onCheckedChange={setBannerEnabled}
            />
          </div>
        </div>

        {/* Style picker */}
        <div className="space-y-2">
          <Label>Стиль баннера</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {BANNER_STYLE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setBannerStyle(opt.value)}
                className={`text-left rounded-lg border-2 p-3 transition-all ${
                  bannerStyle === opt.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40"
                }`}
              >
                <div className={`w-full h-2 rounded-full mb-2 ${
                  opt.value === "neutral"   ? "bg-zinc-700" :
                  opt.value === "urgent"    ? "bg-red-500" :
                  opt.value === "info"      ? "bg-blue-500" :
                  "bg-[#D7FF00]"
                }`} />
                <p className="text-xs font-medium">{opt.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="banner-title">Заголовок</Label>
            <Input
              id="banner-title"
              value={bannerTitle}
              onChange={e => setBannerTitle(e.target.value)}
              placeholder="Например: Важное объявление"
              maxLength={80}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="banner-text">Текст</Label>
            <Textarea
              id="banner-text"
              value={bannerText}
              onChange={e => setBannerText(e.target.value)}
              placeholder="Например: Мы вынуждены закрыть предзаказ раньше запланированного срока — все оформившие получат свои заказы в полном объёме."
              rows={3}
              maxLength={400}
            />
            <p className="text-xs text-muted-foreground text-right">{bannerText.length}/400</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="banner-btn-text">Текст кнопки <span className="text-muted-foreground">(опционально)</span></Label>
            <Input
              id="banner-btn-text"
              value={bannerButtonText}
              onChange={e => setBannerButtonText(e.target.value)}
              placeholder="Например: Подробнее"
              maxLength={40}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="banner-btn-url">Ссылка кнопки <span className="text-muted-foreground">(опционально)</span></Label>
            <Input
              id="banner-btn-url"
              value={bannerButtonUrl}
              onChange={e => setBannerButtonUrl(e.target.value)}
              placeholder="Например: /concept или https://..."
              maxLength={200}
            />
          </div>
        </div>

        {/* Live preview */}
        {(bannerTitle || bannerText) && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Предпросмотр</Label>
            <div className={`rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 ${
              bannerStyle === "urgent"    ? "bg-red-950/60 border border-red-800/50" :
              bannerStyle === "info"     ? "bg-blue-950/60 border border-blue-800/50" :
              bannerStyle === "highlight"? "bg-[#1a1f00] border border-[#D7FF00]/30" :
              "bg-zinc-900 border border-zinc-700/50"
            }`}>
              <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
                bannerStyle === "urgent"    ? "bg-red-500/20" :
                bannerStyle === "info"     ? "bg-blue-500/20" :
                bannerStyle === "highlight"? "bg-[#D7FF00]/20" :
                "bg-white/10"
              }`}>
                <span className="text-base">
                  {bannerStyle === "urgent" ? "⚠️" : bannerStyle === "info" ? "ℹ️" : bannerStyle === "highlight" ? "🔥" : "📢"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                {bannerTitle && <p className="text-sm font-semibold text-white">{bannerTitle}</p>}
                {bannerText  && <p className="text-xs text-white/70 mt-0.5 leading-relaxed">{bannerText}</p>}
              </div>
              {bannerButtonText && (
                <span className={`shrink-0 text-xs font-semibold px-4 py-1.5 rounded-full ${
                  bannerStyle === "urgent"    ? "bg-red-500 text-white" :
                  bannerStyle === "info"     ? "bg-blue-500 text-white" :
                  bannerStyle === "highlight"? "bg-[#D7FF00] text-black" :
                  "bg-white text-black"
                }`}>{bannerButtonText}</span>
              )}
            </div>
          </div>
        )}

        <Button onClick={handleSaveBanner} data-testid="button-save-concept-promo-banner">
          <Save className="w-4 h-4 mr-2" /> Сохранить промо-баннер
        </Button>
      </div>
    </div>
  );
}

function VacanciesEditor({ pageSettingsQuery, savePageSectionMutation }: {
  pageSettingsQuery: any;
  savePageSectionMutation: any;
}) {
  const data = pageSettingsQuery.data?.vacancies_data || {};
  
  const [pageTitle, setPageTitle] = useState(data.pageTitle || "Вакансии");
  const [pageSubtitle, setPageSubtitle] = useState(data.pageSubtitle || "Присоединяйся к команде BMGBRAND! Мы всегда в поиске талантливых и увлечённых людей.");
  const [hrEmail, setHrEmail] = useState(data.hrEmail || "hr@booomerangs.ru");
  const [resumeText, setResumeText] = useState(data.resumeText || "Не нашли подходящую вакансию? Отправьте резюме, и мы свяжемся с вами!");
  const [emptyText, setEmptyText] = useState(data.emptyText || "Сейчас открытых вакансий нет, но вы можете отправить резюме");
  const [pageVisible, setPageVisible] = useState(data.pageVisible !== false);
  const [vacancies, setVacancies] = useState<VacancyItem[]>(data.vacancies || DEFAULT_VACANCIES);
  const [editingVacancyId, setEditingVacancyId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (isInitialized) return;
    const d = pageSettingsQuery.data?.vacancies_data;
    if (!d) return;
    setPageTitle(d.pageTitle || "Вакансии");
    setPageSubtitle(d.pageSubtitle || "Присоединяйся к команде BMGBRAND! Мы всегда в поиске талантливых и увлечённых людей.");
    setHrEmail(d.hrEmail || "hr@booomerangs.ru");
    setResumeText(d.resumeText || "Не нашли подходящую вакансию? Отправьте резюме, и мы свяжемся с вами!");
    setEmptyText(d.emptyText || "Сейчас открытых вакансий нет, но вы можете отправить резюме");
    if (d.pageVisible !== undefined) setPageVisible(d.pageVisible);
    setVacancies(d.vacancies || DEFAULT_VACANCIES);
    setIsInitialized(true);
  }, [pageSettingsQuery.data, isInitialized]);

  const handleSave = () => {
    savePageSectionMutation.mutate({
      sectionId: "vacancies_data",
      settings: {
        pageTitle,
        pageSubtitle,
        hrEmail,
        resumeText,
        emptyText,
        pageVisible,
        vacancies,
      },
    }, {
      onSuccess: () => {
        setIsInitialized(false);
      },
    });
  };

  const addVacancy = () => {
    const newVacancy: VacancyItem = {
      id: String(Date.now()),
      title: "",
      location: "",
      type: "Полная занятость",
      description: "",
      visible: true,
    };
    setVacancies([...vacancies, newVacancy]);
    setEditingVacancyId(newVacancy.id);
  };

  const updateVacancy = (id: string, updates: Partial<VacancyItem>) => {
    setVacancies(vacancies.map(v => v.id === id ? { ...v, ...updates } : v));
  };

  const removeVacancy = (id: string) => {
    setVacancies(vacancies.filter(v => v.id !== id));
    if (editingVacancyId === id) setEditingVacancyId(null);
  };

  const editingVacancy = vacancies.find(v => v.id === editingVacancyId);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Настройки страницы</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-sm">Заголовок</Label>
                <Input
                  value={pageTitle}
                  onChange={(e) => setPageTitle(e.target.value)}
                  placeholder="Вакансии"
                  data-testid="input-vacancies-title"
                />
              </div>
              <div>
                <Label className="text-sm">Подзаголовок</Label>
                <Textarea
                  value={pageSubtitle}
                  onChange={(e) => setPageSubtitle(e.target.value)}
                  placeholder="Присоединяйся к команде..."
                  rows={2}
                  className="resize-none"
                  data-testid="input-vacancies-subtitle"
                />
              </div>
              <div>
                <Label className="text-sm">Email для откликов</Label>
                <Input
                  value={hrEmail}
                  onChange={(e) => setHrEmail(e.target.value)}
                  placeholder="hr@booomerangs.ru"
                  data-testid="input-vacancies-hr-email"
                />
              </div>
              <div>
                <Label className="text-sm">Текст "Отправить резюме"</Label>
                <Textarea
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder="Не нашли подходящую вакансию?..."
                  rows={2}
                  className="resize-none"
                  data-testid="input-vacancies-resume-text"
                />
              </div>
              <div>
                <Label className="text-sm">Текст при отсутствии вакансий</Label>
                <Textarea
                  value={emptyText}
                  onChange={(e) => setEmptyText(e.target.value)}
                  placeholder="Сейчас открытых вакансий нет..."
                  rows={2}
                  className="resize-none"
                  data-testid="input-vacancies-empty-text"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={pageVisible}
                  onCheckedChange={setPageVisible}
                  data-testid="switch-vacancies-visible"
                />
                <Label className="text-sm">Показывать страницу</Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
                <span>Вакансии ({vacancies.length})</span>
                <Button size="sm" variant="outline" onClick={addVacancy} data-testid="button-add-vacancy">
                  <Plus className="w-4 h-4 mr-1" /> Добавить
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {vacancies.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Нет вакансий. Нажмите "Добавить".</p>
              ) : (
                vacancies.map((vacancy) => (
                  <Card
                    key={vacancy.id}
                    className={`cursor-pointer transition-colors hover-elevate ${editingVacancyId === vacancy.id ? 'border-primary bg-primary/5' : ''} ${!vacancy.visible ? 'opacity-60' : ''}`}
                    onClick={() => setEditingVacancyId(vacancy.id)}
                    data-testid={`card-admin-vacancy-${vacancy.id}`}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{vacancy.title || "Без названия"}</p>
                        <p className="text-xs text-muted-foreground truncate">{vacancy.location || "Не указан"} · {vacancy.type}</p>
                      </div>
                      {!vacancy.visible && (
                        <Badge variant="secondary" className="text-xs shrink-0">скрыта</Badge>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {!editingVacancy ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Briefcase className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Выберите вакансию слева для редактирования или создайте новую</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base">Редактирование вакансии</CardTitle>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (confirm("Удалить эту вакансию?")) {
                      removeVacancy(editingVacancy.id);
                    }
                  }}
                  data-testid="button-delete-vacancy"
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Удалить
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-sm">Название должности</Label>
                  <Input
                    value={editingVacancy.title}
                    onChange={(e) => updateVacancy(editingVacancy.id, { title: e.target.value })}
                    placeholder="Менеджер по продажам"
                    data-testid="input-vacancy-title"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm">Город / Локация</Label>
                    <Input
                      value={editingVacancy.location}
                      onChange={(e) => updateVacancy(editingVacancy.id, { location: e.target.value })}
                      placeholder="Тула"
                      data-testid="input-vacancy-location"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">Тип занятости</Label>
                    <Select
                      value={editingVacancy.type}
                      onValueChange={(v) => updateVacancy(editingVacancy.id, { type: v })}
                    >
                      <SelectTrigger data-testid="select-vacancy-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Полная занятость">Полная занятость</SelectItem>
                        <SelectItem value="Частичная занятость">Частичная занятость</SelectItem>
                        <SelectItem value="Удалённая работа">Удалённая работа</SelectItem>
                        <SelectItem value="Стажировка">Стажировка</SelectItem>
                        <SelectItem value="Проектная работа">Проектная работа</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Описание вакансии</Label>
                  <Textarea
                    value={editingVacancy.description}
                    onChange={(e) => updateVacancy(editingVacancy.id, { description: e.target.value })}
                    placeholder="Опишите обязанности, требования и условия работы..."
                    rows={5}
                    className="resize-none"
                    data-testid="input-vacancy-description"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editingVacancy.visible}
                    onCheckedChange={(checked) => updateVacancy(editingVacancy.id, { visible: checked })}
                    data-testid="switch-vacancy-visible"
                  />
                  <Label className="text-sm">Показывать вакансию</Label>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="mt-4">
            <Button
              onClick={handleSave}
              disabled={savePageSectionMutation.isPending}
              data-testid="button-save-vacancies"
            >
              {savePageSectionMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Сохранить всё
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AbandonedCartTriggerButton() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleTrigger = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/admin/trigger-abandoned-cart");
      const data = await res.json();
      toast({ title: "Запущено", description: data.message });
    } catch {
      toast({ title: "Ошибка", description: "Не удалось запустить проверку", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleClearReminders = async () => {
    if (!confirm("Сбросить все cooldown-записи? После этого письма будут отправлены повторно всем пользователям с непустой корзиной.")) return;
    setClearing(true);
    try {
      const res = await apiRequest("POST", "/api/admin/clear-cart-reminders");
      const data = await res.json();
      toast({ title: "Готово", description: data.message });
    } catch {
      toast({ title: "Ошибка", description: "Не удалось сбросить cooldown", variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={handleTrigger} disabled={loading} data-testid="button-trigger-abandoned-cart">
        {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShoppingCart className="w-4 h-4 mr-2" />}
        Запустить проверку сейчас
      </Button>
      <Button variant="outline" onClick={handleClearReminders} disabled={clearing} data-testid="button-clear-cart-reminders">
        {clearing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
        Сбросить cooldown (38 заблокированы)
      </Button>
      <p className="text-sm text-muted-foreground">Результат появится в логах сервера</p>
    </div>
  );
}

function downloadOrderExcel(order: any) {
  const statusMap: Record<string, string> = {
    pending: 'Ожидает оплаты',
    paid: 'Оплачен',
    shipped: 'Отправлен',
    delivered: 'Доставлен',
    cancelled: 'Отменён',
  };
  const paymentMap: Record<string, string> = {
    yookassa: 'ЮKassa',
    tbank: 'Т-Банк',
    ozon: 'Ozon Pay',
    cash: 'Наличные',
    transfer: 'Перевод',
    invoice: 'Счёт',
  };

  // Разбираем cdekData для доставки
  let deliveryService = '';
  let deliveryType = '';
  let deliveryPoint = '';
  let deliveryAddress = '';
  let trackingNumber = '';
  if (order.cdekData) {
    try {
      const d = typeof order.cdekData === 'string' ? JSON.parse(order.cdekData) : order.cdekData;
      deliveryService = d.deliveryService === 'yandex' ? 'Яндекс Доставка' : d.deliveryService === 'cdek' ? 'СДЭК' : d.deliveryService || '';
      deliveryType = d.deliveryType === 'door' ? 'Курьер до двери' : d.deliveryType === 'pickup' ? 'ПВЗ' : d.deliveryType || '';
      deliveryPoint = d.ydPointName || d.pointCode || '';
      if (d.doorAddress) {
        deliveryAddress = [d.doorAddress.street, d.doorAddress.house, d.doorAddress.flat && `кв. ${d.doorAddress.flat}`, d.doorAddress.entrance && `подъезд ${d.doorAddress.entrance}`, d.doorAddress.floor && `эт. ${d.doorAddress.floor}`].filter(Boolean).join(', ');
      }
      trackingNumber = d.cdekTrackingNumber || d.trackingNumber || '';
    } catch { /* ignore */ }
  }

  // Лист 1 — основная информация о заказе
  const infoData = [
    ['Заказ №', String(order.id)],
    ['Дата', order.createdAt ? new Date(order.createdAt).toLocaleString('ru-RU') : ''],
    ['Статус', statusMap[order.status] || order.status],
    ['', ''],
    ['ПОКУПАТЕЛЬ', ''],
    ['Имя', order.customerName || ''],
    ['Email', order.customerEmail || ''],
    ['Телефон', order.customerPhone || ''],
    ['Адрес', order.address || ''],
    ['', ''],
    ['ДОСТАВКА', ''],
    ['Служба доставки', deliveryService],
    ['Тип доставки', deliveryType],
    ['ПВЗ / точка выдачи', deliveryPoint],
    ['Адрес курьера', deliveryAddress],
    ['Трек-номер', trackingNumber],
    ['ТК (опт)', order.transportCompany || ''],
    ['', ''],
    ['ОПЛАТА', ''],
    ['Способ оплаты', paymentMap[order.paymentMethod] || order.paymentMethod || ''],
    ['', ''],
    ['ИТОГ', ''],
    ['Сумма заказа', Number((order.total / 100).toFixed(2))],
    ['Скидка', order.discount ? Number((order.discount / 100).toFixed(2)) : 0],
    ['Промокод', order.promoCode || ''],
    ['Стоимость доставки', order.deliveryCost ? Number((order.deliveryCost / 100).toFixed(2)) : 0],
    ['', ''],
    ['КОММЕНТАРИЙ', ''],
    ['Комментарий', order.comment || ''],
  ];

  const wsInfo = XLSX.utils.aoa_to_sheet(infoData);
  wsInfo['!cols'] = [{ wch: 22 }, { wch: 45 }];

  // Лист 2 — товары
  const items: any[] = Array.isArray(order.items) ? order.items : [];
  const itemRows: (string | number)[][] = [['Артикул / ID', 'Название', 'Размер', 'Цвет', 'Кол-во', 'Цена за шт., ₽', 'Сумма, ₽']];
  for (const item of items) {
    const price = item.price != null ? Number((item.price / 100).toFixed(2)) : '';
    const qty = item.quantity ?? 1;
    const total = price !== '' ? Number((price * qty).toFixed(2)) : '';
    itemRows.push([
      item.sku || item.productId || '',
      item.name || '',
      item.size || '',
      item.color || '',
      qty,
      price,
      total,
    ]);
  }
  // Итоговая строка
  if (items.length > 0) {
    const grandTotal = items.reduce((sum: number, item: any) => {
      const p = item.price != null ? item.price / 100 : 0;
      return sum + p * (item.quantity ?? 1);
    }, 0);
    itemRows.push(['', '', '', '', '', 'ИТОГО:', Number(grandTotal.toFixed(2))]);
  }

  const wsItems = XLSX.utils.aoa_to_sheet(itemRows);
  wsItems['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 16 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Заказ');
  XLSX.utils.book_append_sheet(wb, wsItems, 'Товары');

  XLSX.writeFile(wb, `order_${order.id}.xlsx`);
}

export default function Admin() {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem("admin_api_key") || "");
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!sessionStorage.getItem("admin_api_key"));
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  const [badgeDialogOpen, setBadgeDialogOpen] = useState(false);
  const [badgeDialogProductId, setBadgeDialogProductId] = useState<number | null>(null);
  const [badgeDialogText, setBadgeDialogText] = useState("NEW");
  const [targetCategory, setTargetCategory] = useState<CategorySlug | "">("");
  const [targetSubcategory, setTargetSubcategory] = useState<string>("");
  const [targetSubSubcategory, setTargetSubSubcategory] = useState<string>("");
  const [addlCategory, setAddlCategory] = useState<string>("");
  const [addlSubcategory, setAddlSubcategory] = useState<string>("");
  const VALID_TABS = ["products","orders","wholesale","problems","bonuses","pages","reviews","favorites","preorders","security","clients","analytics","partners","ai","seo"] as const;
  type AdminTab = typeof VALID_TABS[number];
  const [activeTab, setActiveTabRaw] = useState<AdminTab>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("admin_active_tab") : null;
    return (saved && (VALID_TABS as readonly string[]).includes(saved) ? saved : "products") as AdminTab;
  });
  const setActiveTab = (tab: AdminTab) => { localStorage.setItem("admin_active_tab", tab); setActiveTabRaw(tab); };
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [clientsTypeTab, setClientsTypeTab] = useState<"retail" | "wholesale">("retail");
  const [selectedWholesaleClientId, setSelectedWholesaleClientId] = useState<number | null>(null);
  const [problemsFilter, setProblemsFilter] = useState<"all" | "hidden" | "noimage" | "zeroprice">("all");
  const [problemsSearch, setProblemsSearch] = useState("");
  const [selectedProblems, setSelectedProblems] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [thumbProgress, setThumbProgress] = useState<{ generated: number; failed: number; remaining: number; nextOffset: number } | null>(null);
  const [filterCategory, setFilterCategory] = useState<CategorySlug | "all">("all");
  const [filterSubcategory, setFilterSubcategory] = useState<string | null>(null);
  const [filterSubSubcategory, setFilterSubSubcategory] = useState<string | null>(null);
  const [productsVisible, setProductsVisible] = useState(false);
  const [ordersSubTab, setOrdersSubTab] = useState<"retail" | "wholesale" | "drafts">("retail");
  const [expandedOrderItems, setExpandedOrderItems] = useState<Set<string | number>>(new Set());
  const [wholesalePreorderSearch, setWholesalePreorderSearch] = useState("");
  const [pdfUploading, setPdfUploading] = useState(false);
  const [wholesalePreorderDates, setWholesalePreorderDates] = useState<Record<number, { deadline: string; shipping: string; production: string }>>({});
  const [wholesalePreorderLocalState, setWholesalePreorderLocalState] = useState<Record<number, boolean>>({});
  const [wholesalePreorderSizesState, setWholesalePreorderSizesState] = useState<Record<number, string[]>>({});
  const [wholesalePreorderPricesState, setWholesalePreorderPricesState] = useState<Record<number, { rrp: string; wholesale: string; preorder: string }>>({});
  const [setPasswordDialog, setSetPasswordDialog] = useState<{ open: boolean; userId: number | null; userName: string }>({ open: false, userId: null, userName: "" });
  const [setPasswordValue, setSetPasswordValue] = useState("");
  const [inlinePasswordUserId, setInlinePasswordUserId] = useState<number | null>(null);
  const [inlinePasswordValue, setInlinePasswordValue] = useState("");
  const [bonusesSubTab, setBonusesSubTab] = useState<"promo" | "giftcards" | "loyalty" | "newsletter" | "stock-notify" | "price-drop" | "preorder-subscribers" | "mailings" | "settings">("promo");
  const [popupPromoForm, setPopupPromoForm] = useState({
    popupId: null as number | null,
    popupCode: "",
    popupDiscount: 10,
    popupActive: true,
    homepageId: null as number | null,
    homepageCode: "",
    homepageDiscount: 7,
    homepageActive: true,
    settings: {
      title: "",
      subtitle: "",
      description: "",
      buttonText: "",
      successTitle: "",
      successText: "",
      delay: 4000,
      placeholder: "",
      closeText: "",
    }
  });
  const [popupPromoFormLoaded, setPopupPromoFormLoaded] = useState(false);
  // Page editor state
  const [selectedPage, setSelectedPage] = useState<string>("home");
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [sectionSettings, setSectionSettings] = useState<Record<string, any>>({});
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const [homeSectionOrder, setHomeSectionOrder] = useState<string[] | null>(null);
  const [pinnedSearchQuery, setPinnedSearchQuery] = useState("");
  const [addSectionDialog, setAddSectionDialog] = useState(false);
  const [customHitsPinnedSearch, setCustomHitsPinnedSearch] = useState("");
  
  // Static pages editor state
  const [staticPageTab, setStaticPageTab] = useState<string>("privacy");
  const [staticPageContent, setStaticPageContent] = useState<string>("");
  const [faqItems, setFaqItems] = useState<Array<{question: string; answer: string}>>([]);
  const [aboutFields, setAboutFields] = useState<{
    title: string; titleAccent: string; description: string;
    image1: string; image1Alt: string; image2: string; image2Alt: string; quote: string;
  }>({
    title: "Мы —", titleAccent: "Boomerangs",
    description: "Базируясь в Туле — городе мастеров, пряников и самоваров — мы создаем вещи для повседневной жизни. На нашем счету более 200 моделей носков (мемных и просто ярких), а также собственная линейка качественной одежды, в которую входят куртки, худи, джоггеры, футболки, шорты и аксессуары.",
    image1: "https://images.unsplash.com/photo-1523398002811-999ca8dec234?q=80&w=800&auto=format&fit=crop",
    image1Alt: "Студия",
    image2: "", image2Alt: "Процесс",
    quote: "Делаем вещи\nКоторые носим сами",
  });
  
  // Artist page editor state
  const [editingArtistSlug, setEditingArtistSlug] = useState<string | null>(null);
  const [artistPageSettings, setArtistPageSettings] = useState<Record<string, any>>({});
  const [trackFormOpen, setTrackFormOpen] = useState(false);
  const [trackNewTitle, setTrackNewTitle] = useState("");
  const [trackNewSubtitle, setTrackNewSubtitle] = useState("");
  const [trackNewOrder, setTrackNewOrder] = useState(1);
  const [trackUploading, setTrackUploading] = useState(false);
  const [trackAudioFile, setTrackAudioFile] = useState<File | null>(null);
  const [trackCoverFile, setTrackCoverFile] = useState<File | null>(null);
  const [trackEditingId, setTrackEditingId] = useState<number | null>(null);
  const [trackEditTitle, setTrackEditTitle] = useState("");
  const [trackEditSubtitle, setTrackEditSubtitle] = useState("");
  const [trackEditOrder, setTrackEditOrder] = useState(1);
  const [trackEditSaving, setTrackEditSaving] = useState(false);

  // Blog post detail editor state
  const [editingBlogIndex, setEditingBlogIndex] = useState<number | null>(null);
  const [blogPostSettings, setBlogPostSettings] = useState<Record<string, any>>({});
  
  // Category editor state
  type AdminSubSubcategoryConfig = { name: string; slug: string };
  type AdminSubcategoryConfig = { name: string; slug: string; subSubcategories?: AdminSubSubcategoryConfig[] };
  type AdminCategoryConfig = { name: string; slug: string; subcategories: AdminSubcategoryConfig[] };
  const [editingCategories, setEditingCategories] = useState<Record<string, AdminCategoryConfig>>({});
  const [editingCategorySlug, setEditingCategorySlug] = useState<string | null>(null);
  const [newCategoryForm, setNewCategoryForm] = useState({ slug: "", name: "" });
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newSubcategory, setNewSubcategory] = useState("");
  const [expandedSubcategoryIdx, setExpandedSubcategoryIdx] = useState<number | null>(null);
  const [newSubSubcategory, setNewSubSubcategory] = useState("");
  
  // Product editor state
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [browseCategory, setBrowseCategory] = useState<string | null>(null);
  const [browseSubcategory, setBrowseSubcategory] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<{
    name: string;
    description: string;
    price: string;
    wholesalePrice: string;
    category: string;
    subcategory: string;
    sku: string;
    color: string;
    sizes: string[];
    composition: string;
    careInstructions: string;
    note: string;
    delivery: string;
    returnPolicy: string;
    images: string[];
    measurements: Array<{ size: string; length?: string; chest?: string; shoulders?: string; sleeves?: string; waist?: string; hips?: string; sideLength?: string; bottomWidth?: string }>;
    measurementSections: Array<{ title: string; rows: Array<{ size: string; length?: string; chest?: string; shoulders?: string; sleeves?: string; waist?: string; hips?: string; sideLength?: string; bottomWidth?: string }> }>;
    measurementLabels: Record<string, string>;
    lookProducts: number[];
    lookCategory: string;
    lookSubcategory: string;
    seoTitle: string;
    seoDescription: string;
    seoBody: string;
    specsHtml: string;
    imageAlts: string[];
    featureBadgeIds: string[];
    slug: string;
    preorderEnabled: boolean;
    preorderDeadline: string;
    preorderProductionDate: string;
    preorderShippingDate: string;
    preorderGroup: string;
    discountPercent: string;
    salePrice: string;
    stock: string;
    sizeStock: Record<string, number>;
    sizeDiscounts: Record<string, number>;
    disabledNotifySizes: string[];
    noSize: boolean;
    additionalCategories: Array<{category: string, subcategory: string}>;
    subSubcategory: string;
    artistSlug: string;
    videoUrl: string;
  }>({
    name: "",
    description: "",
    price: "",
    wholesalePrice: "",
    discountPercent: "",
    category: "clothing",
    subcategory: "",
    subSubcategory: "",
    sku: "",
    color: "",
    sizes: [],
    composition: "",
    careInstructions: "",
    note: "",
    delivery: "",
    returnPolicy: "",
    images: [],
    measurements: [],
    measurementSections: [],
    measurementLabels: {},
    lookProducts: [],
    lookCategory: "",
    lookSubcategory: "",
    seoTitle: "",
    seoDescription: "",
    seoBody: "",
    specsHtml: "",
    imageAlts: [],
    featureBadgeIds: [],
    slug: "",
    preorderEnabled: false,
    preorderDeadline: "",
    preorderProductionDate: "",
    preorderShippingDate: "",
    preorderGroup: "",
    salePrice: "",
    stock: "",
    sizeStock: {},
    sizeDiscounts: {},
    disabledNotifySizes: [],
    noSize: false,
    additionalCategories: [],
    artistSlug: "",
    videoUrl: "",
  });
  const [uploadingImages, setUploadingImages] = useState(false);
  const dragImageIdxRef = useRef<number | null>(null);
  const browseListRef = useRef<HTMLDivElement | null>(null);
  const browseScrollSaveRef = useRef<number>(0);
  const [dragVisualSrc, setDragVisualSrc] = useState<number | null>(null);
  const [dragOverImageIdx, setDragOverImageIdx] = useState<number | null>(null);
  const [lookSearchQuery, setLookSearchQuery] = useState("");
  const [blogProductSearchQuery, setBlogProductSearchQuery] = useState("");
  const [measurementCopySearch, setMeasurementCopySearch] = useState("");
  const [showMeasurementCopy, setShowMeasurementCopy] = useState(false);
  const [bulkMeasurementsCopyOpen, setBulkMeasurementsCopyOpen] = useState(false);
  const [bulkMeasurementsCopySearch, setBulkMeasurementsCopySearch] = useState("");

  const MEASUREMENT_TEMPLATES: Record<string, { label: string; columns: string[]; sizes: Array<{ size: string; length?: string; chest?: string; shoulders?: string; sleeves?: string; waist?: string; hips?: string; sideLength?: string; bottomWidth?: string }> }> = {
    tshirt: {
      label: "Футболки",
      columns: ["length", "chest", "shoulders", "sleeves"],
      sizes: [
        { size: "XS", length: "64", chest: "96", shoulders: "42", sleeves: "19" },
        { size: "S", length: "66", chest: "100", shoulders: "44", sleeves: "20" },
        { size: "M", length: "68", chest: "104", shoulders: "46", sleeves: "21" },
        { size: "L", length: "70", chest: "110", shoulders: "48", sleeves: "22" },
        { size: "XL", length: "72", chest: "116", shoulders: "50", sleeves: "23" },
        { size: "XXL", length: "74", chest: "122", shoulders: "52", sleeves: "24" },
      ],
    },
    hoodie: {
      label: "Худи / Свитшоты",
      columns: ["length", "chest", "shoulders", "sleeves"],
      sizes: [
        { size: "XS", length: "64", chest: "104", shoulders: "44", sleeves: "60" },
        { size: "S", length: "66", chest: "108", shoulders: "46", sleeves: "62" },
        { size: "M", length: "68", chest: "112", shoulders: "48", sleeves: "63" },
        { size: "L", length: "70", chest: "118", shoulders: "50", sleeves: "64" },
        { size: "XL", length: "72", chest: "124", shoulders: "52", sleeves: "65" },
        { size: "XXL", length: "74", chest: "130", shoulders: "54", sleeves: "66" },
      ],
    },
    jacket: {
      label: "Куртки",
      columns: ["length", "chest", "shoulders", "sleeves"],
      sizes: [
        { size: "S", length: "66", chest: "110", shoulders: "46", sleeves: "63" },
        { size: "M", length: "68", chest: "114", shoulders: "48", sleeves: "64" },
        { size: "L", length: "70", chest: "120", shoulders: "50", sleeves: "65" },
        { size: "XL", length: "72", chest: "126", shoulders: "52", sleeves: "66" },
        { size: "XXL", length: "74", chest: "132", shoulders: "54", sleeves: "67" },
      ],
    },
    pants: {
      label: "Брюки / Джоггеры",
      columns: ["waist", "hips", "length", "shoulders", "chest"],
      sizes: [
        { size: "XS", waist: "34", hips: "46", length: "71", shoulders: "96", chest: "16" },
        { size: "S",  waist: "36", hips: "48", length: "72", shoulders: "98", chest: "17" },
        { size: "M",  waist: "38", hips: "50", length: "73", shoulders: "100", chest: "18" },
        { size: "L",  waist: "41", hips: "53", length: "74", shoulders: "102", chest: "19" },
        { size: "XL", waist: "44", hips: "56", length: "75", shoulders: "104", chest: "20" },
        { size: "XXL",waist: "47", hips: "59", length: "76", shoulders: "106", chest: "21" },
      ],
    },
    shorts: {
      label: "Шорты",
      columns: ["waist", "hips", "length", "shoulders", "chest"],
      sizes: [
        { size: "XS", waist: "34", hips: "46", length: "18", shoulders: "44", chest: "22" },
        { size: "S",  waist: "36", hips: "48", length: "19", shoulders: "46", chest: "23" },
        { size: "M",  waist: "38", hips: "50", length: "20", shoulders: "48", chest: "24" },
        { size: "L",  waist: "41", hips: "53", length: "22", shoulders: "50", chest: "26" },
        { size: "XL", waist: "44", hips: "56", length: "23", shoulders: "52", chest: "27" },
        { size: "XXL",waist: "47", hips: "59", length: "24", shoulders: "54", chest: "28" },
      ],
    },
    pants_suit: {
      label: "Низ костюма / Брюки",
      columns: ["waist", "hips", "sideLength", "bottomWidth"],
      sizes: [
        { size: "XS", waist: "34", hips: "46", sideLength: "98", bottomWidth: "20" },
        { size: "S",  waist: "36", hips: "48", sideLength: "100", bottomWidth: "21" },
        { size: "M",  waist: "38", hips: "50", sideLength: "102", bottomWidth: "22" },
        { size: "L",  waist: "41", hips: "53", sideLength: "104", bottomWidth: "23" },
        { size: "XL", waist: "44", hips: "56", sideLength: "106", bottomWidth: "24" },
        { size: "XXL",waist: "47", hips: "59", sideLength: "108", bottomWidth: "25" },
      ],
    },
  };
  
  const { toast } = useToast();

  const giftCardsQuery = useQuery<any[]>({
    queryKey: ["/api/admin/gift-cards"],
    queryFn: async () => adminFetch("/api/admin/gift-cards", apiKey),
    enabled: isAuthenticated && activeTab === "bonuses",
  });

  const activateGiftCardMutation = useMutation({
    mutationFn: async (id: number) => {
      return adminFetch(`/api/gift-cards/${id}/activate`, apiKey, { method: "POST" });
    },
    onSuccess: () => {
      giftCardsQuery.refetch();
      toast({ title: "Сертификат активирован" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteGiftCardMutation = useMutation({
    mutationFn: async (id: number) => {
      return adminFetch(`/api/admin/gift-cards/${id}`, apiKey, { method: "DELETE" });
    },
    onSuccess: () => {
      giftCardsQuery.refetch();
      toast({ title: "Сертификат удален" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  // Orders query
  const { data: ordersData, isLoading: ordersLoading, refetch: refetchOrders } = useQuery<any[]>({
    queryKey: ["/api/admin/orders"],
    queryFn: async () => adminFetch("/api/admin/orders", apiKey),
    enabled: isAuthenticated && activeTab === "orders",
  });

  // Draft/unpaid orders query
  const { data: draftOrdersData, isLoading: draftOrdersLoading, refetch: refetchDraftOrders } = useQuery<any[]>({
    queryKey: ["/api/admin/draft-orders"],
    queryFn: async () => adminFetch("/api/admin/draft-orders", apiKey),
    enabled: isAuthenticated && activeTab === "orders" && ordersSubTab === "drafts",
  });

  const deleteDraftOrderMutation = useMutation({
    mutationFn: async (id: number) => {
      return adminFetch(`/api/admin/draft-orders/${id}`, apiKey, { method: "DELETE" });
    },
    onSuccess: () => {
      refetchDraftOrders();
      toast({ title: "Черновик удалён" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  // Partners (для отображения бейджа "Партнёр" в строке заказа)
  const { data: ordersPartnersData } = useQuery<{ partners: any[] }>({
    queryKey: ["/api/admin/partners", "for-orders"],
    queryFn: async () => adminFetch("/api/admin/partners?status=approved", apiKey),
    enabled: isAuthenticated && activeTab === "orders",
  });

  const { data: artistPartnersData } = useQuery<{ artists: Array<{ id: number; partnerSlug: string; storeName: string; contactName: string }> }>({
    queryKey: ["/api/admin/partners/artists"],
    queryFn: async () => adminFetch("/api/admin/partners/artists", apiKey),
    enabled: isAuthenticated,
  });
  const { data: preorderProductsForSections } = useQuery<any[]>({
    queryKey: ["/api/preorder/products"],
    queryFn: async () => {
      const res = await fetch("/api/preorder/products");
      if (!res.ok) throw new Error("Failed to fetch preorder products");
      return res.json();
    },
    enabled: isAuthenticated,
  });
  const artistPartnersList = artistPartnersData?.artists || [];
  const partnersById = new Map<number, { storeName: string; partnerSlug: string }>();
  for (const p of (ordersPartnersData?.partners || [])) {
    partnersById.set(Number(p.id), { storeName: p.storeName || "", partnerSlug: p.partnerSlug || "" });
  }

  const allOrders = ordersData || [];
  
  // Filter orders by type (retail vs wholesale)
  const retailOrders = allOrders.filter((o: any) => !o.isWholesale);
  const wholesaleOrders = allOrders.filter((o: any) => o.isWholesale);

  const updateOrderStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return adminFetch(`/api/admin/orders/${id}/status`, apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      refetchOrders();
      toast({ title: "Статус обновлен" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (id: number) => {
      return adminFetch(`/api/admin/orders/${id}`, apiKey, { method: "DELETE" });
    },
    onSuccess: () => {
      refetchOrders();
      toast({ title: "Заказ удален" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const { data, isLoading, refetch } = useQuery<{ products: Product[] }>({
    queryKey: ["/api/products", "admin"],
    queryFn: async () => {
      const response = await fetch(`/api/products?limit=5000&admin=true&_t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: preorderCampaignsList = [] } = useQuery<any[]>({
    queryKey: ["/api/preorder/campaigns"],
    queryFn: () => fetch("/api/preorder/campaigns").then((r) => r.json()),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const { data: artistProductsData, refetch: refetchArtistProducts } = useQuery<{ products: any[] }>({
    queryKey: ["/api/admin/artist-only-products"],
    queryFn: async () => {
      const response = await fetch("/api/admin/artist-only-products", {
        headers: { "x-api-key": apiKey },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json();
    },
    enabled: isAuthenticated && !!apiKey,
    staleTime: 0,
  });

  const products = data?.products || [];

  // Wholesale users query
  const { data: wholesaleData, isLoading: wholesaleLoading, refetch: refetchWholesale } = useQuery<{ users: WholesaleUser[] }>({
    queryKey: ["/api/auth/admin/wholesale"],
    queryFn: async () => {
      return adminFetch("/api/auth/admin/wholesale", apiKey);
    },
    enabled: isAuthenticated && activeTab === "wholesale",
    staleTime: 0,
  });

  const wholesaleUsers = wholesaleData?.users || [];

  const approveWholesaleMutation = useMutation({
    mutationFn: async ({ userId, discount }: { userId: number; discount: number }) => {
      return adminFetch(`/api/auth/admin/wholesale/${userId}/approve`, apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discount }),
      });
    },
    onSuccess: () => {
      refetchWholesale();
      toast({ title: "Оптовик подтверждён" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const rejectWholesaleMutation = useMutation({
    mutationFn: async (userId: number) => {
      return adminFetch(`/api/auth/admin/wholesale/${userId}/reject`, apiKey, {
        method: "POST",
      });
    },
    onSuccess: () => {
      refetchWholesale();
      toast({ title: "Заявка отклонена" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const deleteWholesaleMutation = useMutation({
    mutationFn: async (userId: number) => {
      return adminFetch(`/api/auth/admin/wholesale/${userId}`, apiKey, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      refetchWholesale();
      toast({ title: "Оптовик удалён" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const setPasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: number; password: string }) => {
      return adminFetch(`/api/admin/wholesale-users/${userId}/set-password`, apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
    },
    onSuccess: () => {
      setSetPasswordDialog({ open: false, userId: null, userName: "" });
      setSetPasswordValue("");
      toast({ title: "Пароль успешно изменён" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const updateDiscountMutation = useMutation({
    mutationFn: async ({ userId, discount }: { userId: number; discount: number }) => {
      return adminFetch(`/api/auth/admin/wholesale/${userId}/discount`, apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discount }),
      });
    },
    onSuccess: () => {
      refetchWholesale();
      toast({ title: "Скидка обновлена" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const toggleWholesalePreorderMutation = useMutation({
    mutationFn: async ({ productId, enabled, preorderDeadline, preorderShippingDate, preorderProductionDate, wholesalePreorderSizes, wholesalePreorderRrp, wholesalePreorderPrice, wholesalePrice }: { productId: number; enabled: boolean; preorderDeadline?: string; preorderShippingDate?: string; preorderProductionDate?: string; wholesalePreorderSizes?: string[]; wholesalePreorderRrp?: number; wholesalePreorderPrice?: number; wholesalePrice?: number }) => {
      return adminFetch(`/api/admin/wholesale-preorder/products/${productId}/toggle`, apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, preorderDeadline, preorderShippingDate, preorderProductionDate, wholesalePreorderSizes, wholesalePreorderRrp, wholesalePreorderPrice, wholesalePrice }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale-preorder/products"] });
      toast({ title: "Сохранено" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  // Hidden products query
  const { data: hiddenData, isLoading: hiddenLoading, refetch: refetchHidden } = useQuery<{ products: Product[], total: number }>({
    queryKey: ["/api/products/hidden"],
    queryFn: async () => {
      return adminFetch("/api/products/hidden", apiKey);
    },
    enabled: isAuthenticated && activeTab === "problems",
    staleTime: 0,
  });

  const hiddenProducts = hiddenData?.products || [];

  // Products without images query
  const { data: noImageData, isLoading: noImageLoading, refetch: refetchNoImage } = useQuery<{ products: Product[], total: number }>({
    queryKey: ["/api/products/no-image"],
    queryFn: async () => {
      return adminFetch("/api/products/no-image", apiKey);
    },
    enabled: isAuthenticated && activeTab === "problems",
    staleTime: 0,
  });

  const noImageProducts = noImageData?.products || [];

  // Products with zero price query
  const { data: zeroPriceData, isLoading: zeroPriceLoading, refetch: refetchZeroPrice } = useQuery<{ products: Product[], total: number }>({
    queryKey: ["/api/products/zero-price"],
    queryFn: async () => {
      return adminFetch("/api/products/zero-price", apiKey);
    },
    enabled: isAuthenticated && activeTab === "problems",
    staleTime: 0,
  });

  const zeroPriceProducts = zeroPriceData?.products || [];

  // Hide product mutation
  const hideProductMutation = useMutation({
    mutationFn: async ({ productId, hidden }: { productId: number; hidden: boolean }) => {
      return adminFetch(`/api/products/${productId}/hide`, apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      refetchHidden();
      refetchNoImage();
      refetchZeroPrice();
      toast({ title: variables.hidden ? "Товар скрыт" : "Товар показан" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const toggleBadgeMutation = useMutation({
    mutationFn: async ({ productId, isNew, badgeText }: { productId: number; isNew: boolean; badgeText?: string }) => {
      return adminFetch(`/api/admin/products/${productId}`, apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isNew, badgeText: badgeText || "" }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      refetchHidden();
      toast({ title: "Бейдж обновлён" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const bulkToggleBadgeMutation = useMutation({
    mutationFn: async ({ ids, isNew, badgeText }: { ids: number[]; isNew: boolean; badgeText?: string }) => {
      const res = await adminFetch(`/api/admin/products/bulk-badges`, apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, isNew, badgeText: badgeText || "" }),
      });
      const data = await res.json();
      if (data.errors && data.errors.length > 0) {
        throw new Error(`Обновлено ${data.updated} из ${data.total}. Ошибки: ${data.errors.slice(0, 3).join("; ")}`);
      }
      return data.updated;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      refetchHidden();
      toast({ title: `Бейдж обновлён у ${count} товаров` });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      refetchHidden();
      toast({ title: "Частичное обновление", description: error.message, variant: "destructive" });
    },
  });

  // Auto-hide all problematic products mutation
  const autoHideProblematicMutation = useMutation({
    mutationFn: async (filter?: "noimage" | "zeroprice") => {
      return adminFetch("/api/products/auto-hide-problematic", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter }),
      });
    },
    onSuccess: (data: any) => {
      refetch();
      refetchHidden();
      refetchNoImage();
      refetchZeroPrice();
      toast({ 
        title: "Товары скрыты", 
        description: `Скрыто: ${data.total} товаров` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const [thumbForce, setThumbForce] = useState(false);
  const regenThumbnailsMutation = useMutation({
    mutationFn: async (offset: number) => {
      return adminFetch(`/api/update-thumbnail-urls?limit=50&offset=${offset}${thumbForce ? '&force=true' : ''}`, apiKey, {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      const d = data.details;
      setThumbProgress(prev => {
        const newState = {
          generated: (prev?.generated || 0) + d.generated,
          failed: (prev?.failed || 0) + d.failed,
          remaining: d.remaining,
          nextOffset: d.nextOffset,
        };
        if (d.remaining === 0) {
          toast({ title: "Миниатюры готовы", description: `Создано: ${newState.generated}` });
          refetch();
        } else {
          toast({ title: "Батч завершён", description: `+${d.generated} создано, осталось ~${d.remaining}` });
        }
        return newState;
      });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const promoCodesQuery = useQuery<{ promoCodes: any[] }>({
    queryKey: ["/api/promo-codes"],
    queryFn: async () => adminFetch("/api/promo-codes", apiKey),
    enabled: isAuthenticated && activeTab === "bonuses",
  });

  // Bonuses tab queries
  const loyaltyTiersQuery = useQuery<any[]>({
    queryKey: ["/api/loyalty-tiers"],
    queryFn: async () => adminFetch("/api/loyalty-tiers", apiKey),
    enabled: isAuthenticated && activeTab === "bonuses",
  });

  const stockNotificationsQuery = useQuery<Array<{ id: string; productId: string; productName: string; size: string; email: string; createdAt: string; notified: boolean; notifiedAt: string | null }>>({
    queryKey: ["/api/admin/stock-notifications"],
    queryFn: async () => adminFetch("/api/admin/stock-notifications", apiKey),
    enabled: !!apiKey,
  });

  const priceDropQuery = useQuery<Array<{ id: string; productId: string; productName: string; email: string; priceAtSubscription: number; createdAt: string; notified: boolean; notifiedAt: string | null }>>({
    queryKey: ["/api/admin/price-drop-notify"],
    queryFn: async () => adminFetch("/api/admin/price-drop-notify", apiKey),
    enabled: !!apiKey && activeTab === "bonuses" && bonusesSubTab === "price-drop",
  });

  const newsletterStatsQuery = useQuery<{ subscriptions: any[]; count: number }>({
    queryKey: ["/api/admin/newsletter-stats"],
    queryFn: async () => adminFetch("/api/admin/newsletter-stats", apiKey),
    enabled: isAuthenticated && activeTab === "bonuses",
  });

  const preorderSubscribersQuery = useQuery<{ subscribers: Array<{ id: string; email: string; name: string | null; subscribedAt: string; isActive: boolean }>; count: number }>({
    queryKey: ["/api/admin/preorder-subscribers"],
    queryFn: async () => adminFetch("/api/admin/preorder-subscribers", apiKey),
    enabled: !!apiKey && activeTab === "bonuses" && (bonusesSubTab === "preorder-subscribers" || bonusesSubTab === "mailings"),
  });

  const loyaltyUsersQuery = useQuery<{ users: any[] }>({
    queryKey: ["/api/admin/loyalty-users"],
    queryFn: async () => adminFetch("/api/admin/loyalty-users", apiKey),
    enabled: isAuthenticated && activeTab === "bonuses",
  });

  const newsletterQueueStatusQuery = useQuery<{ count: number; firstAddedAt: string | null; lastAddedAt: string | null; minutesUntilSend: number | null; productIds: number[] }>({
    queryKey: ["/api/admin/newsletter-queue-status"],
    queryFn: async () => adminFetch("/api/admin/newsletter-queue-status", apiKey),
    enabled: !!apiKey && activeTab === "bonuses" && bonusesSubTab === "mailings",
    refetchInterval: 30000,
  });

  const preorderQueueStatusQuery = useQuery<{ count: number; firstAddedAt: string | null; lastAddedAt: string | null; minutesUntilSend: number | null; productIds: number[] }>({
    queryKey: ["/api/admin/preorder-queue-status"],
    queryFn: async () => adminFetch("/api/admin/preorder-queue-status", apiKey),
    enabled: !!apiKey && activeTab === "bonuses" && bonusesSubTab === "mailings",
    refetchInterval: 30000,
  });

  const mailingsSettingsQuery = useQuery<{ newProductsEnabled: boolean; preorderEnabled: boolean }>({
    queryKey: ["/api/admin/mailings-settings"],
    queryFn: async () => adminFetch("/api/admin/mailings-settings", apiKey),
    enabled: !!apiKey && activeTab === "bonuses" && bonusesSubTab === "mailings",
  });

  // Page settings query
  const pageSettingsQuery = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings", selectedPage],
    queryFn: async () => {
      const res = await fetch(`/api/page-settings/${selectedPage}`);
      return res.json();
    },
    enabled: isAuthenticated && activeTab === "pages",
  });

  const homeSettingsForArtists = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/home", "for-artists"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/home");
      return res.json();
    },
    enabled: isAuthenticated && activeTab === "pages" && selectedPage === "artist_pages",
  });

  const artistPagesQuery = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/artist_pages"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/artist_pages");
      return res.json();
    },
    enabled: isAuthenticated && activeTab === "pages" && selectedPage === "artist_pages",
  });

  const artistTracksQuery = useQuery<{ tracks: any[] }>({
    queryKey: ["/api/admin/artists", editingArtistSlug ?? "_none_", "tracks"],
    queryFn: async () => {
      if (!editingArtistSlug) return { tracks: [] };
      const res = await fetch(`/api/admin/artists/${editingArtistSlug}/tracks`, {
        headers: { "x-api-key": apiKey || "" },
      });
      if (!res.ok) throw new Error("Ошибка загрузки треков");
      return res.json();
    },
    enabled: !!editingArtistSlug && isAuthenticated,
  });

  const deleteTrackMutation = useMutation({
    mutationFn: async (trackId: number) => {
      return adminFetch(`/api/admin/artists/tracks/${trackId}`, apiKey, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/artists", editingArtistSlug ?? "_none_", "tracks"] });
      toast({ title: "Трек удалён" });
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const toggleTrackMutation = useMutation({
    mutationFn: async ({ trackId, isActive }: { trackId: number; isActive: boolean }) => {
      return adminFetch(`/api/admin/artists/tracks/${trackId}`, apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/artists", editingArtistSlug ?? "_none_", "tracks"] });
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const saveArtistPageMutation = useMutation({
    mutationFn: async ({ slug, settings }: { slug: string; settings: any }) => {
      return adminFetch(`/api/admin/page-settings/artist_pages/${slug}`, apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
    },
    onSuccess: () => {
      artistPagesQuery.refetch();
      toast({ title: "Страница артиста сохранена" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const blogPagesQuery = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/blog_pages"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/blog_pages");
      return res.json();
    },
    enabled: isAuthenticated && activeTab === "pages" && selectedPage === "blog_pages",
  });

  const homeSettingsForBlog = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/home", "for-blog"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/home");
      return res.json();
    },
    enabled: isAuthenticated && activeTab === "pages" && selectedPage === "blog_pages",
  });

  const saveBlogPostMutation = useMutation({
    mutationFn: async ({ postIndex, settings }: { postIndex: number; settings: any }) => {
      return adminFetch(`/api/admin/page-settings/blog_pages/${postIndex}`, apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
    },
    onSuccess: () => {
      blogPagesQuery.refetch();
      toast({ title: "Страница поста сохранена" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const staticPageQuery = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings", "static_pages"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/static_pages");
      if (!res.ok) return {};
      return res.json();
    },
    enabled: isAuthenticated && activeTab === "pages" && selectedPage === "static_pages",
  });

  const DEFAULT_FAQ_ITEMS = [
    { question: "Как оформить заказ?", answer: "Выберите понравившиеся товары, добавьте их в корзину, перейдите к оформлению и заполните данные для доставки. После оформления заказа вам придёт уведомление на электронную почту. Отследить статус заказа и местонахождение посылки можно в личном кабинете." },
    { question: "Какие способы оплаты доступны?", answer: "Мы принимаем оплату банковскими картами через ЮKassa и Т-Банк. Доступны банковские карты (Visa, MasterCard, МИР), СБП (Система быстрых платежей), а также Т-Pay." },
    { question: "Сколько стоит доставка?", answer: "Доставка по России осуществляется через СДЭК и Яндекс Доставку. Стоимость рассчитывается автоматически при оформлении заказа в зависимости от региона и веса посылки." },
    { question: "Сколько времени занимает доставка?", answer: "Срок доставки зависит от вашего региона и выбранного способа доставки — обычно от 1 до 10 рабочих дней по России." },
    { question: "Можно ли вернуть или обменять товар?", answer: "Да, вы можете вернуть или обменять товар в течение 14 дней с момента получения. Товар должен сохранить товарный вид, бирки и упаковку." },
    { question: "Как подобрать размер?", answer: "На странице каждого товара есть таблица размеров с точными замерами. Если у вас остались вопросы, напишите нам в Telegram или на почту — поможем с выбором." },
    { question: "Есть ли у вас офлайн-магазин?", answer: "Мы работаем онлайн, но наша одежда уже представлена у дистрибьюторов более чем в 40 городах России. Также планируем открытие собственного шоурума — следите за новостями в наших соцсетях!" },
    { question: "Как связаться с поддержкой?", answer: "Напишите нам на info@booomerangs.ru, в Telegram @bmg_booomerangs или в группу ВКонтакте vk.com/bmgbrand. Мы отвечаем в течение 24 часов." },
  ];

  const DEFAULT_ABOUT_FIELDS = {
    title: "Мы —", titleAccent: "Boomerangs",
    description: "Базируясь в Туле — городе мастеров, пряников и самоваров — мы создаем вещи для повседневной жизни. На нашем счету более 200 моделей носков (мемных и просто ярких), а также собственная линейка качественной одежды, в которую входят куртки, худи, джоггеры, футболки, шорты и аксессуары.",
    image1: "https://images.unsplash.com/photo-1523398002811-999ca8dec234?q=80&w=800&auto=format&fit=crop",
    image1Alt: "Студия", image2: "", image2Alt: "Процесс",
    quote: "Делаем вещи\nКоторые носим сами",
  };

  const DEFAULT_PRIVACY_CONTENT = `<h1 class="text-3xl font-bold mb-4 uppercase">Политика конфиденциальности</h1>
<p class="text-muted-foreground mb-8">Дата последнего обновления: 01 сентября 2025 г.</p>
<p class="mb-8 text-foreground/80">Настоящая Политика конфиденциальности (далее – «Политика») действует в отношении всей информации, которую сайт booomerangs.ru (далее – «Сайт») может получить о Пользователе во время использования Сайта, его сервисов, программ и продуктов.</p>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">1. Общие положения</h2>
  <div class="space-y-4 text-foreground/80">
    <p>1.1. Настоящая Политика составлена в соответствии с требованиями Федерального закона от 27.07.2006 №152-ФЗ «О персональных данных».</p>
    <p>1.2. Использование Сайта Пользователем означает согласие с настоящей Политикой и условиями обработки персональных данных.</p>
    <p>1.3. В случае несогласия с условиями Политики Пользователь обязан прекратить использование Сайта.</p>
  </div>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">2. Персональные данные, которые обрабатывает Сайт</h2>
  <ul class="list-disc pl-6 space-y-2 text-foreground/80">
    <li>ФИО (при указании Пользователем);</li>
    <li>контактный телефон, адрес электронной почты;</li>
    <li>данные, автоматически передаваемые при посещении Сайта (IP-адрес, cookies, данные браузера, характеристики устройства и ПО, время доступа, адреса страниц);</li>
    <li>технические cookie, необходимые для работы функций сайта и сохранения сессий.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">3. Цели обработки персональных данных</h2>
  <ul class="list-disc pl-6 space-y-2 text-foreground/80">
    <li>идентификация Пользователя;</li>
    <li>связь с Пользователем (уведомления, запросы, информация);</li>
    <li>предоставление услуг и улучшение их качества;</li>
    <li>проведение маркетинговых и статистических исследований;</li>
    <li>обеспечение корректной работы Сайта и сохранение пользовательских настроек.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">4. Использование аналитики и cookie</h2>
  <div class="space-y-4 text-foreground/80">
    <p>4.1. На Сайте используется сервис аналитики Яндекс.Метрика, который автоматически собирает обезличенные данные о действиях Пользователей с помощью файлов cookie и иных технологий.</p>
    <p>4.2. Технические cookie используются исключительно для корректной работы сайта, сохранения сессий и пользовательских настроек.</p>
    <p>4.3. Сбор и обработка данных осуществляется в целях анализа активности посетителей и улучшения качества сервиса.</p>
    <p>4.4. Пользователь может отключить использование файлов cookie в настройках браузера.</p>
  </div>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">5. Правовые основания обработки</h2>
  <div class="space-y-4 text-foreground/80">
    <p>5.1. Персональные данные обрабатываются только при их самостоятельном указании Пользователем.</p>
    <p>5.2. Согласие Пользователя выражается при отправке форм на сайте, при установке галочки согласия, при нажатии кнопки «Оформить заказ», при нажатии кнопки «Согласен» в баннере cookie.</p>
  </div>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">6. Условия обработки и хранения</h2>
  <div class="space-y-4 text-foreground/80">
    <p>6.1. Сайт принимает меры для защиты персональных данных от неправомерного или случайного доступа, изменения, блокирования, уничтожения или распространения.</p>
    <p>6.2. Данные хранятся до достижения целей обработки или до отзыва согласия Пользователем.</p>
  </div>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">7. Передача персональных данных</h2>
  <div class="space-y-4 text-foreground/80">
    <p>7.1. Передача персональных данных третьим лицам не осуществляется, за исключением случаев, предусмотренных законом.</p>
    <p>7.2. Данные могут быть переданы государственным органам РФ по законным основаниям.</p>
  </div>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">8. Права Пользователя</h2>
  <ul class="list-disc pl-6 space-y-2 text-foreground/80">
    <li>получать информацию об обработке своих персональных данных;</li>
    <li>требовать уточнения, блокировки или уничтожения данных;</li>
    <li>отозвать согласие на обработку данных, направив письменное уведомление Администрации Сайта.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">9. Изменение Политики</h2>
  <div class="space-y-4 text-foreground/80">
    <p>9.1. Администрация Сайта вправе изменять Политику без предварительного уведомления.</p>
    <p>9.2. Новая редакция вступает в силу с момента размещения на Сайте.</p>
  </div>
</section>

<section class="mt-12 p-6 border rounded-lg bg-accent/30 text-foreground/80">
  <h2 class="text-xl font-bold mb-4">10. Контакты</h2>
  <p class="mb-4">По всем вопросам, связанным с Политикой и обработкой персональных данных, обращаться:</p>
  <div class="space-y-1 text-sm">
    <p><strong>E-mail:</strong> info@booomerangs.ru</p>
    <p><strong>Телефон:</strong> +7 (960) 600-00-47</p>
    <p><strong>Почтовый адрес:</strong> 301666, Тульская область, г. Новомосковск, ул. Генерала Белова, дом 21 кв 48</p>
  </div>
</section>`;

  const DEFAULT_TERMS_CONTENT = `<h1 class="text-3xl font-bold mb-8">Публичная оферта</h1>
<p class="text-muted-foreground mb-6">Публичная оферта о продаже товаров через интернет-магазин<br />г. Новомосковск</p>

<p class="mb-8">Настоящая публичная оферта (далее — Оферта) является официальным предложением индивидуального предпринимателя Соболев Дмитрий Анатольевич, ИНН 711614027971, ОГРНИП 316715400111210 (далее — Продавец), любому физическому лицу (далее — Покупатель) заключить договор купли-продажи товаров через интернет-магазин Продавца.</p>

<p class="mb-8">Размещение текста настоящей Оферты на сайте https://booomerangs.ru является публичным предложением в соответствии со статьей 437 Гражданского кодекса Российской Федерации.</p>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">1. Общие положения</h2>
  <ul class="list-disc pl-6 space-y-2">
    <li>Заказ Покупателем товара означает полное и безоговорочное принятие условий настоящей Оферты.</li>
    <li>Настоящая Оферта является договором, заключаемым между Продавцом и Покупателем в момент оформления заказа.</li>
    <li>Продавец оставляет за собой право изменять условия Оферты без предварительного уведомления.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">2. Предмет договора</h2>
  <ul class="list-disc pl-6 space-y-2">
    <li>Продавец обязуется передать Покупателю товар, представленный в интернет-магазине, а Покупатель обязуется оплатить и принять товар на условиях настоящей Оферты.</li>
    <li>Характеристики, изображения и описание товара размещены на сайте и соответствуют имеющимся у Продавца данным.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">3. Оформление заказа и оплата</h2>
  <ul class="list-disc pl-6 space-y-2">
    <li>Покупатель оформляет заказ самостоятельно на сайте, добавляя выбранные товары в корзину.</li>
    <li>Оплата товара осуществляется безналичным способом через платёжные системы (Т-Банк, ЮKassa).</li>
    <li>Цены указаны в российских рублях и включают все действующие налоги.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">4. Доставка товара</h2>
  <ul class="list-disc pl-6 space-y-2">
    <li>Доставка осуществляется по России службой СДЭК.</li>
    <li>Сроки и стоимость доставки зависят от региона и рассчитываются автоматически при оформлении заказа.</li>
    <li>Обязанность Продавца по передаче товара считается исполненной в момент передачи товара службе доставки.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">5. Возврат и обмен товара</h2>
  <ul class="list-disc pl-6 space-y-2">
    <li>Покупатель вправе отказаться от товара надлежащего качества в течение 14 календарных дней после получения.</li>
    <li>Возврат товара ненадлежащего качества осуществляется в порядке, установленном законодательством РФ.</li>
    <li>Для оформления возврата необходимо связаться с Продавцом через электронную почту.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">6. Ответственность сторон</h2>
  <ul class="list-disc pl-6 space-y-2">
    <li>Продавец не несёт ответственности за неправильный выбор характеристик товара.</li>
    <li>Продавец не несёт ответственности за задержки в доставке, возникшие по вине транспортных компаний.</li>
    <li>Покупатель несёт ответственность за достоверность предоставленных данных при оформлении заказа.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">7. Конфиденциальность и защита данных</h2>
  <ul class="list-disc pl-6 space-y-2">
    <li>Продавец обрабатывает персональные данные Покупателя в соответствии со ст. 152-ФЗ «О персональных данных».</li>
    <li>Предоставленные данные используются исключительно для выполнения заказа.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">8. Заключительные положения</h2>
  <ul class="list-disc pl-6 space-y-2">
    <li>Настоящая Оферта вступает в силу с момента её размещения на сайте и действует до её отзыва Продавцом.</li>
    <li>Стороны руководствуются законодательством Российской Федерации.</li>
  </ul>
</section>

<section class="mt-12 p-6 border rounded-lg bg-accent/30">
  <h2 class="text-xl font-bold mb-4">Реквизиты Продавца</h2>
  <div class="space-y-1 text-sm">
    <p><strong>ИП Соболев Дмитрий Анатольевич</strong></p>
    <p>ИНН 711614027971</p>
    <p>ОГРНИП 316715400111210</p>
    <p>E-mail: info@booomerangs.ru</p>
    <p>Сайт: booomerangs.ru</p>
  </div>
</section>`;

  useEffect(() => {
    if (!staticPageTab) return;
    const key = `${staticPageTab}_data`;
    const raw = staticPageQuery.data?.[key];
    let parsed: any = null;
    try {
      parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
    } catch { parsed = null; }

    if (staticPageTab === "faq") {
      setFaqItems(parsed?.items && parsed.items.length > 0 ? parsed.items : DEFAULT_FAQ_ITEMS);
    } else if (staticPageTab === "about") {
      setAboutFields({ ...DEFAULT_ABOUT_FIELDS, ...(parsed || {}) });
    } else if (staticPageTab === "privacy") {
      setStaticPageContent(parsed?.content || DEFAULT_PRIVACY_CONTENT);
    } else if (staticPageTab === "terms") {
      setStaticPageContent(parsed?.content || DEFAULT_TERMS_CONTENT);
    } else if (staticPageTab === "care") {
      setStaticPageContent(parsed?.content || "");
    }
  }, [staticPageQuery.data, staticPageTab]);

  const saveStaticPageMutation = useMutation({
    mutationFn: async ({ pageKey, settings }: { pageKey: string; settings: any }) => {
      return adminFetch(`/api/admin/page-settings/static_pages/${pageKey}_data`, apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
    },
    onSuccess: () => {
      staticPageQuery.refetch();
      toast({ title: "Страница сохранена" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const adminFavoritesQuery = useQuery<{
    users: Array<{ userId: number; userName: string; userEmail: string; productIds: number[]; count: number }>;
    popularProducts: Array<{ productId: number; count: number }>;
    totalFavorites: number;
    totalUsers: number;
  }>({
    queryKey: ["/api/admin/favorites"],
    queryFn: async () => adminFetch("/api/admin/favorites", apiKey),
    enabled: isAuthenticated && activeTab === "favorites",
  });

  const adminReviewsQuery = useQuery<any[]>({
    queryKey: ["/api/admin/reviews"],
    queryFn: async () => adminFetch("/api/admin/reviews", apiKey),
    enabled: isAuthenticated && activeTab === "reviews",
  });

  const clientsQuery = useQuery<{ users: any[] }>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => adminFetch("/api/admin/users", apiKey),
    enabled: isAuthenticated && activeTab === "clients",
  });

  const wholesaleClientsQuery = useQuery<{ users: any[] }>({
    queryKey: ["/api/admin/wholesale-users"],
    queryFn: async () => adminFetch("/api/admin/wholesale-users", apiKey),
    enabled: isAuthenticated && activeTab === "clients" && clientsTypeTab === "wholesale",
  });

  const wholesaleClientDetailQuery = useQuery<{ user: any; orders: any[] }>({
    queryKey: ["/api/admin/wholesale-users", selectedWholesaleClientId],
    queryFn: async () => adminFetch(`/api/admin/wholesale-users/${selectedWholesaleClientId}`, apiKey),
    enabled: isAuthenticated && !!selectedWholesaleClientId,
  });

  const clientDetailQuery = useQuery<any>({
    queryKey: ["/api/admin/users", selectedClientId],
    queryFn: async () => adminFetch(`/api/admin/users/${selectedClientId}`, apiKey),
    enabled: isAuthenticated && !!selectedClientId,
  });


  const approveReviewMutation = useMutation({
    mutationFn: async ({ id, isApproved }: { id: number; isApproved: boolean }) => {
      return adminFetch(`/api/admin/reviews/${id}`, apiKey, {
        method: "PATCH",
        body: JSON.stringify({ isApproved }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reviews"] });
    },
  });

  const deleteReviewMutation = useMutation({
    mutationFn: async (id: number) => {
      return adminFetch(`/api/admin/reviews/${id}`, apiKey, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reviews"] });
    },
  });

  const categoriesQuery = useQuery({
    queryKey: ["/api/admin/categories"],
    queryFn: async () => adminFetch("/api/admin/categories", apiKey),
    enabled: isAuthenticated,
  });

  const featureBadgeTemplatesQuery = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/product_feature_templates"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/product_feature_templates");
      if (!res.ok) return {};
      return res.json();
    },
    enabled: isAuthenticated && activeTab === "products",
  });
  const featureBadgeTemplatesList: FeatureBadgeTemplate[] = Object.entries(featureBadgeTemplatesQuery.data || {}).map(([id, t]: [string, any]) => ({
    id,
    icon: t.icon || "Sparkles",
    title: t.title || "",
    description: t.description || "",
  }));

  useEffect(() => {
    if (categoriesQuery.data?.categories) {
      const normalized = normalizeCategories(categoriesQuery.data.categories);
      setEditingCategories(normalized as Record<string, AdminCategoryConfig>);
      setEditingCategorySlug(null);
    }
  }, [categoriesQuery.data]);

  useEffect(() => {
    if (editingProductId === null && browseListRef.current && browseScrollSaveRef.current > 0) {
      const saved = browseScrollSaveRef.current;
      requestAnimationFrame(() => {
        if (browseListRef.current) browseListRef.current.scrollTop = saved;
      });
    }
  }, [editingProductId]);

  const saveCategoriesMutation = useMutation({
    mutationFn: async (categories: Record<string, AdminCategoryConfig>) => {
      return adminFetch("/api/admin/categories", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories }),
      });
    },
    onSuccess: () => {
      categoriesQuery.refetch();
      toast({ title: "Категории сохранены" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const savePageSectionMutation = useMutation({
    mutationFn: async ({ sectionId, settings }: { sectionId: string; settings: any }) => {
      return adminFetch(`/api/admin/page-settings/${selectedPage}/${sectionId}`, apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
    },
    onSuccess: () => {
      pageSettingsQuery.refetch();
      toast({ title: "Настройки сохранены" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  // Product editor mutations
  const createProductMutation = useMutation({
    mutationFn: async (data: any) => {
      return adminFetch("/api/admin/products", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      const p = result.product;
      toast({
        title: "Товар создан",
        description: p.images?.length ? `ID: ${p.id}` : "Добавьте фотографию — без неё товар не появится в каталоге для покупателей.",
      });
      setIsCreatingProduct(false);
      setProductForm({
        name: p.name || "",
        description: p.description || "",
        price: p.price ? String(p.price) : "",
        wholesalePrice: p.wholesalePrice ? String(p.wholesalePrice) : "",
        discountPercent: p.discountPercent ? String(p.discountPercent) : "",
        salePrice: (p as any).salePrice ? String((p as any).salePrice) : "",
        category: p.category || "clothing",
        subcategory: p.subcategory || "",
        sku: p.sku || "",
        color: p.color || "",
        sizes: p.sizes || [],
        composition: p.composition || "",
        careInstructions: p.careInstructions || "",
        note: p.note || "",
        delivery: p.delivery || "",
        returnPolicy: p.returnPolicy || "",
        images: p.images || [],
        measurements: p.measurements || [],
        lookProducts: p.lookProducts || [],
        lookCategory: p.lookCategory || "",
        lookSubcategory: p.lookSubcategory || "",
        seoTitle: p.seoTitle || "",
        seoDescription: p.seoDescription || "",
        seoBody: (p as any).seoBody || "",
        specsHtml: (p as any).specsHtml || "",
        imageAlts: p.imageAlts || [],
        featureBadgeIds: (p as any).featureBadgeIds || [],
        slug: p.slug || "",
        preorderEnabled: p.preorderEnabled || false,
        preorderDeadline: p.preorderDeadline || "",
        preorderProductionDate: p.preorderProductionDate || "",
        preorderShippingDate: p.preorderShippingDate || "",
        preorderGroup: (p as any).preorderGroup || "",
        stock: p.stock !== undefined && p.stock !== null ? String(p.stock) : "",
        sizeStock: p.sizeStock || {},
        sizeDiscounts: p.sizeDiscounts || {},
        disabledNotifySizes: (p as any).disabledNotifySizes || [],
        noSize: p.noSize || false,
        additionalCategories: p.additionalCategories || [],
        subSubcategory: (p as any).subSubcategory || "",
        artistSlug: (p as any).artistSlug || "",
        videoUrl: (p as any).videoUrl || "",
        measurementSections: (p as any).measurementSections || [],
        measurementLabels: (p as any).measurementLabels || {},
      });
      setEditingProductId(p.id);
    },
    onError: (err: any) => {
      toast({ title: "Ошибка создания", description: err.message, variant: "destructive" });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return adminFetch(`/api/admin/products/${id}`, apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products", variables.id, "look"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/by-slug"] });
      toast({ title: "Товар обновлён" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка обновления", description: err.message, variant: "destructive" });
    },
  });

  const uploadProductImageMutation = useMutation({
    mutationFn: async ({ productId, imageData, index }: { productId: number; imageData: string; index: number }) => {
      return adminFetch(`/api/admin/products/${productId}/images`, apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData, index }),
      });
    },
    onSuccess: (result) => {
      setProductForm(prev => ({
        ...prev,
        images: [...prev.images, result.url],
      }));
      toast({ title: "Фото загружено" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка загрузки", description: err.message, variant: "destructive" });
    },
  });

  const resetProductForm = () => {
    setProductForm({
      name: "",
      description: "",
      price: "",
      wholesalePrice: "",
      discountPercent: "",
      category: "clothing",
      subcategory: "",
      sku: "",
      color: "",
      sizes: [] as string[],
      composition: "",
      careInstructions: "",
      note: "",
      delivery: "",
      returnPolicy: "",
      images: [] as string[],
      measurements: [] as any[],
      measurementSections: [] as any[],
      measurementLabels: {} as Record<string, string>,
      lookProducts: [] as number[],
      lookCategory: "",
      lookSubcategory: "",
      seoTitle: "",
      seoDescription: "",
      seoBody: "",
      specsHtml: "",
      imageAlts: [],
      featureBadgeIds: [],
      slug: "",
      preorderEnabled: false,
      preorderDeadline: "",
      preorderProductionDate: "",
      preorderShippingDate: "",
      preorderGroup: "",
      salePrice: "",
      stock: "",
      sizeStock: {},
      sizeDiscounts: {},
      disabledNotifySizes: [],
      noSize: false,
      additionalCategories: [],
      subSubcategory: "",
      artistSlug: "",
      videoUrl: "",
    });
    setEditingProductId(null);
    setLookSearchQuery("");
  };

  const loadProductForEdit = async (productId: number) => {
    try {
      const product = await adminFetch(`/api/admin/products/${productId}`, apiKey);
      setProductForm({
        name: product.name || "",
        description: product.description || "",
        price: product.price ? String(product.price) : "",
        wholesalePrice: product.wholesalePrice ? String(product.wholesalePrice) : "",
        discountPercent: product.discountPercent ? String(product.discountPercent) : "",
        category: product.category || "clothing",
        subcategory: product.subcategory || "",
        sku: product.sku || "",
        color: product.color || "",
        sizes: product.sizes || [],
        composition: product.composition || "",
        careInstructions: product.careInstructions || "",
        note: product.note || "",
        delivery: product.delivery || "",
        returnPolicy: product.returnPolicy || "",
        images: product.images || (product.imageUrl ? [product.imageUrl] : []),
        measurements: product.measurements || [],
        measurementSections: product.measurementSections || [],
        measurementLabels: (product as any).measurementLabels || {},
        lookProducts: product.lookProducts || [],
        lookCategory: product.lookCategory || "",
        lookSubcategory: product.lookSubcategory || "",
        seoTitle: product.seoTitle || "",
        seoDescription: product.seoDescription || "",
        seoBody: (product as any).seoBody || "",
        specsHtml: (product as any).specsHtml || "",
        imageAlts: product.imageAlts || [],
        featureBadgeIds: (product as any).featureBadgeIds || [],
        slug: product.slug || "",
        preorderEnabled: product.preorderEnabled || false,
        preorderDeadline: product.preorderDeadline || "",
        preorderProductionDate: product.preorderProductionDate || "",
        preorderShippingDate: product.preorderShippingDate || "",
        preorderGroup: (product as any).preorderGroup || "",
        salePrice: product.salePrice ? String(product.salePrice) : "",
        stock: product.stock !== undefined && product.stock !== null ? String(product.stock) : "",
        sizeStock: product.sizeStock || {},
        sizeDiscounts: product.sizeDiscounts || {},
        disabledNotifySizes: (product as any).disabledNotifySizes || [],
        noSize: product.noSize || false,
        additionalCategories: product.additionalCategories || [],
        subSubcategory: (product as any).subSubcategory || "",
        artistSlug: product.artistSlug || "",
        videoUrl: (product as any).videoUrl || "",
      });
      setEditingProductId(productId);
      setIsCreatingProduct(false);
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setUploadingImages(true);
    
    for (let i = 0; i < Math.min(files.length, 10 - productForm.images.length); i++) {
      const file = files[i];
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener("load", () => {
          try {
            const result = JSON.parse(xhr.responseText);
            if (result?.url) {
              setProductForm(prev => ({
                ...prev,
                images: [...prev.images, result.url],
              }));
              if (editingProductId) {
                toast({ title: "Фото загружено" });
              }
            } else {
              toast({ title: "Ошибка загрузки фото", description: result?.error || "Нет URL", variant: "destructive" });
            }
          } catch {
            toast({ title: "Ошибка загрузки фото", description: "Ошибка разбора ответа", variant: "destructive" });
          }
          resolve();
        });
        xhr.addEventListener("error", () => {
          toast({ title: "Ошибка загрузки фото", description: "Сетевая ошибка", variant: "destructive" });
          resolve();
        });
        xhr.open("POST", "/api/admin/upload-image");
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.setRequestHeader("X-API-Key", apiKey);
        xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
        file.arrayBuffer().then(buf => xhr.send(buf));
      });
    }
    
    setUploadingImages(false);
  };

  // Loyalty tier form state
  const [loyaltyTierForm, setLoyaltyTierForm] = useState<{
    id: number | null;
    name: string;
    minSpent: number;
    discountPercent: number;
  }>({ id: null, name: "", minSpent: 0, discountPercent: 0 });
  const [showLoyaltyTierForm, setShowLoyaltyTierForm] = useState(false);

  const createLoyaltyTierMutation = useMutation({
    mutationFn: async (data: { name: string; minSpent: number; discountPercent: number }) => {
      return adminFetch("/api/loyalty-tiers", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      loyaltyTiersQuery.refetch();
      setShowLoyaltyTierForm(false);
      setLoyaltyTierForm({ id: null, name: "", minSpent: 0, discountPercent: 0 });
      toast({ title: "Уровень создан" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const updateLoyaltyTierMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; name: string; minSpent: number; discountPercent: number }) => {
      return adminFetch(`/api/loyalty-tiers/${id}`, apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      loyaltyTiersQuery.refetch();
      setShowLoyaltyTierForm(false);
      setLoyaltyTierForm({ id: null, name: "", minSpent: 0, discountPercent: 0 });
      toast({ title: "Уровень обновлен" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteLoyaltyTierMutation = useMutation({
    mutationFn: async (id: number) => {
      return adminFetch(`/api/loyalty-tiers/${id}`, apiKey, { method: "DELETE" });
    },
    onSuccess: () => {
      loyaltyTiersQuery.refetch();
      toast({ title: "Уровень удален" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const popupPromoQuery = useQuery<{ popup: any; homepage: any }>({
    queryKey: ["/api/admin/popup-promo"],
    queryFn: async () => {
      const data = await adminFetch("/api/admin/popup-promo", apiKey);
      if (data && !popupPromoFormLoaded) {
        setPopupPromoForm({
          popupId: data.popup?.id || null,
          popupCode: data.popup?.code || "WELCOME10",
          popupDiscount: data.popup?.discountPercent || 10,
          popupActive: data.popup?.isActive ?? true,
          homepageId: data.homepage?.id || null,
          homepageCode: data.homepage?.code || "WELCOME7",
          homepageDiscount: data.homepage?.discountPercent || 7,
          homepageActive: data.homepage?.isActive ?? true,
          settings: {
            title: data.settings?.title || "",
            subtitle: data.settings?.subtitle || "",
            description: data.settings?.description || "",
            buttonText: data.settings?.buttonText || "",
            successTitle: data.settings?.successTitle || "",
            successText: data.settings?.successText || "",
            delay: data.settings?.delay || 4000,
            placeholder: data.settings?.placeholder || "",
            closeText: data.settings?.closeText || "",
          }
        });
        setPopupPromoFormLoaded(true);
      }
      return data;
    },
    enabled: isAuthenticated && activeTab === "bonuses",
  });

  const updatePopupPromoMutation = useMutation({
    mutationFn: async (formData: typeof popupPromoForm) => {
      return adminFetch("/api/admin/popup-promo", apiKey, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          popup: {
            id: formData.popupId,
            code: formData.popupCode,
            discountPercent: formData.popupDiscount,
            isActive: formData.popupActive,
          },
          homepage: {
            id: formData.homepageId,
            code: formData.homepageCode,
            discountPercent: formData.homepageDiscount,
            isActive: formData.homepageActive,
          },
          settings: formData.settings,
        }),
      });
    },
    onSuccess: () => {
      setPopupPromoFormLoaded(false);
      popupPromoQuery.refetch();
      toast({ title: "Настройки промокодов сохранены" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const triggerNewProductsMutation = useMutation({
    mutationFn: async () => adminFetch("/api/admin/newsletter-trigger-now", apiKey, { method: "POST" }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/newsletter-queue-status"] });
      toast({ title: "Рассылка новинок отправлена", description: `Отправлено: ${data.sent}, товаров: ${data.products}` });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const triggerPreorderMutation = useMutation({
    mutationFn: async () => adminFetch("/api/admin/preorder-trigger-now", apiKey, { method: "POST" }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/preorder-queue-status"] });
      toast({ title: "Рассылка предзаказов отправлена", description: `Отправлено: ${data.sent}, товаров: ${data.products}` });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const updateMailingsSettingsMutation = useMutation({
    mutationFn: async (settings: { newProductsEnabled?: boolean; preorderEnabled?: boolean }) =>
      adminFetch("/api/admin/mailings-settings", apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/mailings-settings"] });
      toast({ title: "Настройки рассылок сохранены" });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const createPromoMutation = useMutation({
    mutationFn: async (promo: any) => {
      // Parse applicableCategories from comma-separated string to JSON array
      const cats = promo.applicableCategories
        ? promo.applicableCategories.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      // Ensure numeric fields are numbers and dates are properly formatted
      const formattedPromo = {
        ...promo,
        discountPercent: Number(promo.discountPercent) || 0,
        discountAmount: Number(promo.discountAmount) || 0,
        minOrderAmount: Number(promo.minOrderAmount) || 0,
        maxUses: Number(promo.maxUses) || 0,
        startsAt: promo.startsAt ? new Date(promo.startsAt).toISOString() : null,
        expiresAt: promo.expiresAt ? new Date(promo.expiresAt).toISOString() : null,
        applicableCategories: cats.length > 0 ? JSON.stringify(cats) : null,
      };
      return adminFetch("/api/promo-codes", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formattedPromo),
      });
    },
    onSuccess: () => {
      promoCodesQuery.refetch();
      toast({ title: "Промокод создан" });
      setNewPromo({
        code: "",
        discountPercent: 0,
        discountAmount: 0,
        minOrderAmount: 0,
        maxUses: 0,
        isActive: true,
        allowForWholesale: false,
        startsAt: "",
        expiresAt: "",
        applicableCategories: "",
      });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deletePromoMutation = useMutation({
    mutationFn: async (id: number) => {
      return adminFetch(`/api/promo-codes/${id}`, apiKey, { method: "DELETE" });
    },
    onSuccess: () => {
      promoCodesQuery.refetch();
      toast({ title: "Промокод удален" });
    },
  });

  const deleteNewsletterMutation = useMutation({
    mutationFn: async (id: number) => {
      return adminFetch(`/api/admin/newsletter-subscriptions/${id}`, apiKey, { method: "DELETE" });
    },
    onSuccess: () => {
      newsletterStatsQuery.refetch();
      toast({ title: "Подписка удалена" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const [broadcastSubject, setBroadcastSubject] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const broadcastMutation = useMutation({
    mutationFn: async (data: { subject: string; html: string; emails: string[] }) => {
      return adminFetch("/api/admin/newsletter-broadcast", apiKey, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data: any) => {
      toast({ title: `Рассылка отправлена: ${data.sent} из ${data.total}` });
      setBroadcastSubject("");
      setBroadcastBody("");
      setSelectedEmails(new Set());
    },
    onError: (err: any) => {
      toast({ title: "Ошибка отправки", description: err.message, variant: "destructive" });
    },
  });

  const [newPromo, setNewPromo] = useState({
    code: "",
    discountPercent: 0,
    discountAmount: 0,
    minOrderAmount: 0,
    maxUses: 0,
    isActive: true,
    allowForWholesale: false,
    startsAt: "",
    expiresAt: "",
    applicableCategories: "",
  });
  const [promoCatOpen, setPromoCatOpen] = useState(false);

  // Filter by category/subcategory/subSubcategory first, then by search
  const filteredProducts = products.filter(p => {
    // Category filter
    if (filterCategory !== "all") {
      const inMainCat = p.category === filterCategory;
      const inAddlCat = (p.additionalCategories || []).some((ac: any) => ac.category === filterCategory);
      if (!inMainCat && !inAddlCat) return false;
      // Subcategory filter
      if (filterSubcategory) {
        const norm = (s: string) => s.toLowerCase().trim();
        const subNorm = norm(filterSubcategory);
        const mainSubMatch = inMainCat && p.subcategory && norm(p.subcategory) === subNorm;
        const addlSubMatch = (p.additionalCategories || []).some((ac: any) =>
          ac.category === filterCategory && ac.subcategory && norm(ac.subcategory) === subNorm
        );
        if (!mainSubMatch && !addlSubMatch) return false;
        // Sub-subcategory filter
        if (filterSubSubcategory) {
          const subSubNorm = norm(filterSubSubcategory);
          const mainSubSubMatch = inMainCat && (p as any).subSubcategory && norm((p as any).subSubcategory) === subSubNorm;
          if (!mainSubSubMatch) return false;
        }
      }
    }
    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q);
    }
    return true;
  });

  const browseCategoryProducts = useMemo(() => {
    if (!browseCategory) return [];
    return products.filter(p => {
      const matchesCat = p.category === browseCategory;
      const matchesAddCat = (p.additionalCategories || []).some((ac: any) => ac.category === browseCategory);
      if (!matchesCat && !matchesAddCat) return false;
      if (browseSubcategory) {
        const norm = (s: string) => s.toLowerCase().trim();
        const subNorm = norm(browseSubcategory);
        const matchesSub = p.subcategory && norm(p.subcategory) === subNorm;
        const matchesAddSub = (p.additionalCategories || []).some((ac: any) => 
          ac.category === browseCategory && ac.subcategory && norm(ac.subcategory) === subNorm
        );
        return matchesSub || matchesAddSub;
      }
      return true;
    });
  }, [browseCategory, browseSubcategory, products]);

  // Search results for product editor (search by name/SKU)
  const editorSearchResults = useMemo(() => {
    if (!productSearchQuery || productSearchQuery.length < 2) return [];
    const q = productSearchQuery.toLowerCase();
    return products
      .filter(p => 
        p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        String(p.id).includes(q)
      )
      .slice(0, 10); // Limit to 10 results
  }, [productSearchQuery, products]);

  const lookSearchResults = useMemo(() => {
    if (!lookSearchQuery || lookSearchQuery.length < 2) return [];
    const q = lookSearchQuery.toLowerCase();
    return products
      .filter(p => 
        !productForm.lookProducts.includes(p.id) &&
        p.id !== editingProductId &&
        (p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        String(p.id).includes(q))
      )
      .slice(0, 8);
  }, [lookSearchQuery, products, productForm.lookProducts, editingProductId]);

  const lookProductDetails = useMemo(() => {
    return productForm.lookProducts
      .map(id => products.find(p => p.id === id))
      .filter(Boolean);
  }, [productForm.lookProducts, products]);

  const blogProductSearchResults = useMemo(() => {
    if (!blogProductSearchQuery || blogProductSearchQuery.length < 2) return [];
    const q = blogProductSearchQuery.toLowerCase();
    const linked = blogPostSettings.linkedProducts || [];
    return products
      .filter(p =>
        !linked.includes(p.id) &&
        (p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        String(p.id).includes(q))
      )
      .slice(0, 8);
  }, [blogProductSearchQuery, products, blogPostSettings.linkedProducts]);

  const blogLinkedProductDetails = useMemo(() => {
    const linked = blogPostSettings.linkedProducts || [];
    return linked
      .map((id: number) => products.find((p: any) => p.id === id))
      .filter(Boolean);
  }, [blogPostSettings.linkedProducts, products]);

  // Calculate product counts per category
  const categoryCounts = products.reduce((acc, p) => {
    if (p.category) {
      acc[p.category] = (acc[p.category] || 0) + 1;
    }
    (p.additionalCategories || []).forEach((ac: any) => {
      if (ac.category) {
        acc[ac.category] = (acc[ac.category] || 0) + 1;
      }
    });
    return acc;
  }, {} as Record<string, number>);

  // Get subcategories for current filter category (from dynamic server data)
  const filterSubcategories = filterCategory !== "all" ? editingCategories[filterCategory]?.subcategories || [] : [];

  // Build product-derived subcategory map (all products, all categories) — used to augment config subcategories
  const productSubcategoryMap = products.reduce((acc, p) => {
    if (p.category && p.subcategory) {
      if (!acc[p.category]) acc[p.category] = new Set<string>();
      acc[p.category].add(p.subcategory);
    }
    (p.additionalCategories || []).forEach((ac: any) => {
      if (ac.category && ac.subcategory) {
        if (!acc[ac.category]) acc[ac.category] = new Set<string>();
        acc[ac.category].add(ac.subcategory);
      }
    });
    return acc;
  }, {} as Record<string, Set<string>>);

  // Returns subcategories for a given category: config list + any product-derived ones not yet in config
  const mergedSubcategoriesFor = (categorySlug: string): AdminSubcategoryConfig[] => {
    const configSubs: AdminSubcategoryConfig[] = editingCategories[categorySlug]?.subcategories || [];
    const configNames = new Set(configSubs.map((s) => s.name));
    const fromProducts = Array.from(productSubcategoryMap[categorySlug] || [])
      .filter((name) => !configNames.has(name))
      .map((name) => ({ name, slug: name }));
    return [...configSubs, ...fromProducts];
  };

  // Calculate subcategory counts (including additional categories)
  const subcategoryCounts = products.reduce((acc, p) => {
    if (p.category === filterCategory && p.subcategory) {
      acc[p.subcategory] = (acc[p.subcategory] || 0) + 1;
    }
    (p.additionalCategories || []).forEach((ac: any) => {
      if (ac.category === filterCategory && ac.subcategory) {
        acc[ac.subcategory] = (acc[ac.subcategory] || 0) + 1;
      }
    });
    return acc;
  }, {} as Record<string, number>);

  // Calculate sub-subcategory counts for the selected subcategory
  const subSubcategoryCounts = products.reduce((acc, p) => {
    const norm = (s: string) => s.toLowerCase().trim();
    if (
      p.category === filterCategory &&
      filterSubcategory &&
      p.subcategory && norm(p.subcategory) === norm(filterSubcategory) &&
      (p as any).subSubcategory
    ) {
      const ss = (p as any).subSubcategory as string;
      acc[ss] = (acc[ss] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const deleteProductMutation = useMutation({
    mutationFn: async (id: number) => {
      return adminFetch(`/api/admin/products/${id}`, apiKey, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      toast({ title: "Товар удалён" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка удаления", description: error.message, variant: "destructive" });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      return adminFetch("/api/admin/products", apiKey, { method: "DELETE" });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      toast({ title: `Удалено ${data.count} товаров` });
      setSelectedProducts(new Set());
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка удаления", description: error.message, variant: "destructive" });
    },
  });

  const deleteSelectedMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      let deleted = 0;
      const errors: string[] = [];
      
      for (const id of ids) {
        try {
          await adminFetch(`/api/admin/products/${id}`, apiKey, { method: "DELETE" });
          deleted++;
        } catch (err: any) {
          errors.push(`ID ${id}: ${err.message}`);
        }
      }
      
      if (errors.length > 0) {
        throw new Error(`Удалено ${deleted} из ${ids.length}. Ошибки: ${errors.slice(0, 3).join("; ")}`);
      }
      
      return deleted;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      toast({ title: `Удалено ${count} товаров` });
      setSelectedProducts(new Set());
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      toast({ title: "Частичное удаление", description: error.message, variant: "destructive" });
      setSelectedProducts(new Set());
    },
  });

  const moveCategoryMutation = useMutation({
    mutationFn: async ({ ids, category, subcategory, subSubcategory }: { ids: number[], category: string, subcategory?: string, subSubcategory?: string }) => {
      return adminFetch("/api/admin/products/category", apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ productIds: ids, category, subcategory, subSubcategory }),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      const catName = CATEGORIES[data.category as CategorySlug]?.name || data.category;
      const subName = data.subcategory ? ` / ${data.subcategory}` : "";
      toast({ 
        title: "Товары перемещены", 
        description: `${data.updated} товаров перемещено в "${catName}${subName}"` 
      });
      setSelectedProducts(new Set());
      setTargetCategory("");
      setTargetSubcategory("");
      setTargetSubSubcategory("");
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка перемещения", description: error.message, variant: "destructive" });
    },
  });

  const availableSubcategories = targetCategory ? mergedSubcategoriesFor(targetCategory) : [];
  const availableTargetSubSubcategories: Array<{name: string; slug: string}> = (() => {
    if (!targetSubcategory || targetSubcategory === "_none_") return [];
    const sub = availableSubcategories.find((s) => (typeof s === 'string' ? s : s.name) === targetSubcategory);
    return (sub as any)?.subSubcategories || [];
  })();

  const bulkAddlCategoryMutation = useMutation({
    mutationFn: async ({ ids, category, subcategory, action }: { ids: number[], category: string, subcategory?: string, action?: string }) => {
      return adminFetch("/api/admin/products/additional-category", apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ productIds: ids, category, subcategory, action }),
      });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      const catName = editingCategories[data.category]?.name || data.category;
      const subName = data.subcategory ? ` / ${data.subcategory}` : "";
      const actionLabel = variables.action === "remove" ? "убрано из" : "добавлено в";
      toast({
        title: "Доп. категория обновлена",
        description: `${data.updated} товаров ${actionLabel} "${catName}${subName}"`,
      });
      setSelectedProducts(new Set());
      setAddlCategory("");
      setAddlSubcategory("");
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const availableAddlSubcategories = addlCategory ? mergedSubcategoriesFor(addlCategory) : [];

  const [bulkDiscountInput, setBulkDiscountInput] = useState("");
  const bulkDiscountMutation = useMutation({
    mutationFn: async ({ ids, discountPercent }: { ids: number[], discountPercent: number }) => {
      return adminFetch("/api/admin/products/bulk-discount", apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ids, discountPercent }),
      });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      const label = variables.discountPercent === 0 ? "убрана" : `${variables.discountPercent}% установлена`;
      toast({
        title: "Скидка обновлена",
        description: `Скидка ${label} для ${data.updated} товаров`,
      });
      setSelectedProducts(new Set());
      setBulkDiscountInput("");
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const bulkMeasurementsMutation = useMutation({
    mutationFn: async ({ ids, measurements }: { ids: number[], measurements: any[] }) => {
      return adminFetch("/api/admin/products/bulk-measurements", apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ids, measurements }),
      });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      refetch();
      const label = variables.measurements.length === 0 ? "очищена" : "применена";
      toast({
        title: "Размерная таблица обновлена",
        description: `Таблица ${label} для ${data.updated} товаров`,
      });
      setSelectedProducts(new Set());
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const convertToWebpMutation = useMutation({
    mutationFn: async () => {
      // Step 1: Convert images to WebP
      const convertResult = await adminFetch("/api/convert-images-to-webp", apiKey, { method: "POST" });
      
      // Step 2: Update URLs in database automatically
      if (convertResult.converted > 0) {
        await adminFetch("/api/update-images-to-webp", apiKey, { method: "POST" });
      }
      
      return convertResult;
    },
    onSuccess: (data) => {
      const remaining = data.details?.remaining || 0;
      toast({ 
        title: remaining > 0 ? "Конвертация выполнена" : "Конвертация завершена", 
        description: remaining > 0 
          ? `Конвертировано: ${data.details?.converted || 0}, осталось: ${remaining}. Нажмите ещё раз.`
          : `Конвертировано: ${data.details?.converted || 0}. ${data.details?.hint || ''}`
      });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка конвертации", description: error.message, variant: "destructive" });
    },
  });

  const updateWebpUrlsMutation = useMutation({
    mutationFn: async () => {
      return adminFetch("/api/update-images-to-webp", apiKey, { method: "POST" });
    },
    onSuccess: (data) => {
      toast({ 
        title: data.details?.updated > 0 ? "Ссылки обновлены" : "Статус WebP", 
        description: data.message || `Обновлено: ${data.details?.updated || 0} товаров`
      });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка обновления", description: error.message, variant: "destructive" });
    },
  });

  const rollbackToJpgMutation = useMutation({
    mutationFn: async () => {
      return adminFetch("/api/rollback-images-to-jpg", apiKey, { method: "POST" });
    },
    onSuccess: (data) => {
      toast({ 
        title: "Откат выполнен", 
        description: `Откачено: ${data.details?.updated || 0} товаров на JPG` 
      });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка отката", description: error.message, variant: "destructive" });
    },
  });

  const deleteJpgMutation = useMutation({
    mutationFn: async () => {
      return adminFetch("/api/delete-jpg-with-webp", apiKey, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 })
      });
    },
    onSuccess: (data) => {
      toast({ 
        title: "JPG файлы удалены", 
        description: `Удалено: ${data.details?.deleted || 0} из 100` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка удаления", description: error.message, variant: "destructive" });
    },
  });

  const backfillSlugsMutation = useMutation({
    mutationFn: async () => {
      return adminFetch("/api/backfill-slugs", apiKey, { method: "POST" });
    },
    onSuccess: (data) => {
      toast({ 
        title: "Slug сгенерированы", 
        description: `Обновлено: ${data.updated}, пропущено: ${data.skipped}` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка генерации slug", description: error.message, variant: "destructive" });
    },
  });

  const [storageInfo, setStorageInfo] = useState<{ images: number; total: number; imageFiles?: string[] } | null>(null);
  
  const checkStorageMutation = useMutation({
    mutationFn: async () => {
      return adminFetch("/api/storage-files", apiKey);
    },
    onSuccess: (data) => {
      setStorageInfo(data);
      toast({ 
        title: "Файлы в хранилище", 
        description: `Всего: ${data.total}, изображений: ${data.images}` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка проверки", description: error.message, variant: "destructive" });
    },
  });

  const handleLogin = async () => {
    if (!apiKey.trim()) return;
    setLoginError("");
    setLoginLoading(true);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "x-api-key": apiKey.trim() },
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        sessionStorage.setItem("admin_api_key", apiKey.trim());
        setIsAuthenticated(true);
      } else {
        setLoginError(data.error || "Неверный ключ");
      }
    } catch {
      setLoginError("Ошибка соединения с сервером");
    } finally {
      setLoginLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedProducts);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedProducts(newSet);
  };

  const selectAll = () => {
    if (selectedProducts.size === filteredProducts.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(filteredProducts.map(p => p.id)));
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Админ-панель
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Введите ключ администратора для доступа
            </p>
            <PasswordInput
              placeholder="Ключ администратора"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setLoginError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              disabled={loginLoading}
              data-testid="input-api-key"
            />
            {loginError && (
              <p className="text-sm text-destructive" data-testid="text-login-error">{loginError}</p>
            )}
            <Button onClick={handleLogin} className="w-full" disabled={loginLoading || !apiKey.trim()} data-testid="button-login">
              {loginLoading ? "Проверка..." : "Войти"}
            </Button>
            <Link href="/">
              <Button variant="ghost" className="w-full" data-testid="link-back-home">
                <ArrowLeft className="w-4 h-4 mr-2" />
                На главную
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Админ-панель" noindex={true} />
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="link-back-home-2">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="flex gap-1">
              <Button
                variant={activeTab === "products" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("products")}
                className="h-8"
              >
                <Package className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Товары</span>
                <span className="text-xs text-muted-foreground ml-1">({products.length})</span>
              </Button>
              <Button
                variant={activeTab === "orders" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("orders")}
                className="h-8"
                data-testid="button-tab-orders"
              >
                <ShoppingCart className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Заказы</span>
                {allOrders.length > 0 && (
                  <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">
                    {allOrders.length}
                  </Badge>
                )}
              </Button>
              <Button
                variant={activeTab === "wholesale" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("wholesale")}
                className="h-8"
              >
                <Building2 className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Оптовики</span>
                {wholesaleUsers.filter(u => !u.wholesaleApproved).length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
                    {wholesaleUsers.filter(u => !u.wholesaleApproved).length}
                  </Badge>
                )}
              </Button>
              <Button
                variant={activeTab === "problems" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("problems")}
                className="h-8"
                data-testid="button-tab-problems"
              >
                <Ban className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Проблемные</span>
                {(hiddenProducts.length + noImageProducts.length + zeroPriceProducts.length) > 0 && (
                  <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">
                    {hiddenProducts.length + noImageProducts.length + zeroPriceProducts.length}
                  </Badge>
                )}
              </Button>
              <Button
                variant={activeTab === "bonuses" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("bonuses")}
                className="h-8"
                data-testid="button-tab-bonuses"
              >
                <Tag className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Бонусы</span>
              </Button>
              <Button
                variant={activeTab === "reviews" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("reviews")}
                className="h-8"
                data-testid="button-tab-reviews"
              >
                <MessageSquare className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Отзывы</span>
              </Button>
              <Button
                variant={activeTab === "favorites" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("favorites")}
                className="h-8"
                data-testid="button-tab-favorites"
              >
                <Heart className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Избранное</span>
              </Button>
              <Button
                variant={activeTab === "preorders" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("preorders")}
                className="h-8"
                data-testid="button-tab-preorders"
              >
                <Target className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Предзаказы</span>
              </Button>
              <Button
                variant={activeTab === "pages" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("pages")}
                className="h-8"
                data-testid="button-tab-pages"
              >
                <Layout className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Страницы</span>
              </Button>
              <Button
                variant={activeTab === "security" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("security")}
                className="h-8"
                data-testid="button-tab-security"
              >
                <Lock className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Безопасность</span>
              </Button>
              <Button
                variant={activeTab === "clients" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("clients")}
                className="h-8"
                data-testid="button-tab-clients"
              >
                <Users className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Клиенты</span>
                {clientsQuery.data?.users && (
                  <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">
                    {clientsQuery.data.users.length}
                  </Badge>
                )}
              </Button>
              <Button
                variant={activeTab === "analytics" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("analytics")}
                className="h-8"
                data-testid="button-tab-analytics"
              >
                <BarChart3 className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Аналитика</span>
              </Button>
              <Button
                variant={activeTab === "partners" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("partners")}
                className="h-8"
                data-testid="button-tab-partners"
              >
                <Handshake className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Партнёры</span>
              </Button>
              <Button
                variant={activeTab === "ai" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("ai")}
                className="h-8"
                data-testid="button-tab-ai"
              >
                <MessageSquare className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">AI-чат</span>
              </Button>
              <Button
                variant={activeTab === "seo" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("seo")}
                className="h-8"
                data-testid="button-tab-seo"
              >
                <Search className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">SEO</span>
              </Button>
            </div>
          </div>
          
          <div className="flex items-center gap-2 flex-1 max-w-md mx-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-sm"
                data-testid="input-search"
              />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => {
              sessionStorage.removeItem("admin_api_key");
              setApiKey("");
              setIsAuthenticated(false);
            }} data-testid="button-logout" title="Выйти">
              <LogOut className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => refetch()} data-testid="button-refresh">
              <RefreshCw className="w-4 h-4" />
            </Button>
            
            {/* Tools dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="button-tools-menu">
                  <Settings className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-zinc-900 border-zinc-700 text-zinc-100">
                <DropdownMenuItem onClick={() => checkStorageMutation.mutate()} disabled={checkStorageMutation.isPending} className="text-zinc-100 focus:bg-zinc-800 focus:text-white">
                  <Search className="w-4 h-4 mr-2" />
                  Проверить хранилище
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => confirm("Сгенерировать slug для товаров без slug?") && backfillSlugsMutation.mutate()}
                  disabled={backfillSlugsMutation.isPending}
                  className="text-zinc-100 focus:bg-zinc-800 focus:text-white"
                >
                  <Type className="w-4 h-4 mr-2" />
                  Сгенерировать slug
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-zinc-700" />
                <DropdownMenuItem 
                  onClick={() => confirm("Конвертировать все изображения в WebP?") && convertToWebpMutation.mutate()}
                  disabled={convertToWebpMutation.isPending}
                  className="text-zinc-100 focus:bg-zinc-800 focus:text-white"
                >
                  <Image className="w-4 h-4 mr-2" />
                  Конвертировать в WebP
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => confirm("Обновить ссылки на WebP?") && updateWebpUrlsMutation.mutate()}
                  disabled={updateWebpUrlsMutation.isPending}
                  className="text-zinc-100 focus:bg-zinc-800 focus:text-white"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Умное обновление WebP
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => confirm("Откатить на JPG?") && rollbackToJpgMutation.mutate()}
                  disabled={rollbackToJpgMutation.isPending}
                  className="text-red-400 focus:bg-zinc-800 focus:text-red-300"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Откатить на JPG
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => confirm("Удалить JPG с WebP версией?") && deleteJpgMutation.mutate()}
                  disabled={deleteJpgMutation.isPending}
                  className="text-red-400 focus:bg-zinc-800 focus:text-red-300"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Удалить JPG (умно)
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-zinc-700" />
                <DropdownMenuItem 
                  onClick={() => confirm("УДАЛИТЬ ВСЕ ТОВАРЫ? Это необратимо!") && deleteAllMutation.mutate()}
                  disabled={deleteAllMutation.isPending}
                  className="text-red-400 focus:bg-zinc-800 focus:text-red-300"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Удалить ВСЕ товары
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Selection toolbar */}
      {selectedProducts.size > 0 && (
        <div className="sticky top-[49px] z-20 bg-primary/10 border-b px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">Выбрано: {selectedProducts.size}</span>
            <div className="flex items-center gap-1 flex-wrap flex-1">
              <Select 
                value={targetCategory} 
                onValueChange={(v) => {
                  setTargetCategory(v as CategorySlug);
                  setTargetSubcategory("");
                  setTargetSubSubcategory("");
                }}
              >
                <SelectTrigger className="w-32 h-8 text-xs" data-testid="select-target-category">
                  <SelectValue placeholder="Категория" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700 text-zinc-100">
                  {Object.entries(editingCategories).map(([slug, cat]) => (
                    <SelectItem key={slug} value={slug} className="text-zinc-100 focus:bg-zinc-800 focus:text-white">
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableSubcategories.length > 0 && (
                <Select value={targetSubcategory} onValueChange={(v) => { setTargetSubcategory(v); setTargetSubSubcategory(""); }}>
                  <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-target-subcategory">
                    <SelectValue placeholder="Подкатегория" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700 text-zinc-100">
                    <SelectItem value="_none_" className="text-zinc-100 focus:bg-zinc-800 focus:text-white">Без подкатегории</SelectItem>
                    {availableSubcategories.map((sub) => (
                      <SelectItem key={typeof sub === 'string' ? sub : sub.name} value={typeof sub === 'string' ? sub : sub.name} className="text-zinc-100 focus:bg-zinc-800 focus:text-white">{typeof sub === 'string' ? sub : sub.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {availableTargetSubSubcategories.length > 0 && (
                <Select value={targetSubSubcategory} onValueChange={setTargetSubSubcategory}>
                  <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-target-subsubcategory">
                    <SelectValue placeholder="Под-подкатегория" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700 text-zinc-100">
                    <SelectItem value="_none_" className="text-zinc-100 focus:bg-zinc-800 focus:text-white">Без под-подкатегории</SelectItem>
                    {availableTargetSubSubcategories.map((ss) => (
                      <SelectItem key={ss.name} value={ss.name} className="text-zinc-100 focus:bg-zinc-800 focus:text-white">{ss.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                size="sm"
                className="h-8"
                onClick={() => {
                  if (targetCategory && selectedProducts.size > 0) {
                    moveCategoryMutation.mutate({ 
                      ids: Array.from(selectedProducts), 
                      category: targetCategory,
                      subcategory: targetSubcategory === "_none_" ? undefined : targetSubcategory || undefined,
                      subSubcategory: targetSubSubcategory === "_none_" ? undefined : targetSubSubcategory || undefined,
                    });
                  }
                }}
                disabled={!targetCategory || moveCategoryMutation.isPending}
                data-testid="button-move-category"
              >
                <MoveRight className="w-3 h-3 mr-1" />
                Переместить
              </Button>

              <span className="text-muted-foreground text-xs">|</span>

              <Select
                value={addlCategory}
                onValueChange={(v) => {
                  setAddlCategory(v);
                  setAddlSubcategory("");
                }}
              >
                <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-addl-category">
                  <SelectValue placeholder="Доп. категория" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700 text-zinc-100">
                  {Object.entries(editingCategories).map(([slug, cat]) => (
                    <SelectItem key={slug} value={slug} className="text-zinc-100 focus:bg-zinc-800 focus:text-white">
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {availableAddlSubcategories.length > 0 && (
                <Select value={addlSubcategory} onValueChange={setAddlSubcategory}>
                  <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-addl-subcategory">
                    <SelectValue placeholder="Подкатегория" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700 text-zinc-100">
                    <SelectItem value="_none_" className="text-zinc-100 focus:bg-zinc-800 focus:text-white">Без подкатегории</SelectItem>
                    {availableAddlSubcategories.map((sub) => (
                      <SelectItem key={typeof sub === 'string' ? sub : sub.name} value={typeof sub === 'string' ? sub : sub.name} className="text-zinc-100 focus:bg-zinc-800 focus:text-white">
                        {typeof sub === 'string' ? sub : sub.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Button
                size="sm"
                className="h-8"
                variant="outline"
                onClick={() => {
                  if (addlCategory && selectedProducts.size > 0) {
                    bulkAddlCategoryMutation.mutate({
                      ids: Array.from(selectedProducts),
                      category: addlCategory,
                      subcategory: addlSubcategory === "_none_" ? undefined : addlSubcategory || undefined,
                      action: "add",
                    });
                  }
                }}
                disabled={!addlCategory || bulkAddlCategoryMutation.isPending}
                data-testid="button-addl-category-add"
              >
                <PlusCircle className="w-3 h-3 mr-1" />
                Доп. категория
              </Button>

              <Button
                size="sm"
                className="h-8"
                variant="outline"
                onClick={() => {
                  if (addlCategory && selectedProducts.size > 0) {
                    if (confirm(`Убрать доп. категорию у ${selectedProducts.size} товаров?`)) {
                      bulkAddlCategoryMutation.mutate({
                        ids: Array.from(selectedProducts),
                        category: addlCategory,
                        subcategory: addlSubcategory === "_none_" ? undefined : addlSubcategory || undefined,
                        action: "remove",
                      });
                    }
                  }
                }}
                disabled={!addlCategory || bulkAddlCategoryMutation.isPending}
                data-testid="button-addl-category-remove"
              >
                <MinusCircle className="w-3 h-3 mr-1" />
                Убрать
              </Button>
            </div>
            <Button
              size="sm"
              className="h-8"
              variant="outline"
              onClick={() => {
                const ids = Array.from(selectedProducts);
                setBadgeDialogProductId(-1);
                setBadgeDialogText("NEW");
                setBadgeDialogOpen(true);
              }}
              disabled={bulkToggleBadgeMutation.isPending}
              data-testid="button-bulk-badge-on"
            >
              <Tag className="w-3 h-3 mr-1 text-primary" />
              Бейдж всем
            </Button>
            <Button
              size="sm"
              className="h-8"
              variant="outline"
              onClick={() => {
                if (confirm(`Убрать бейдж у ${selectedProducts.size} товаров?`)) {
                  bulkToggleBadgeMutation.mutate({ ids: Array.from(selectedProducts), isNew: false, badgeText: "" });
                }
              }}
              disabled={bulkToggleBadgeMutation.isPending}
              data-testid="button-bulk-badge-off"
            >
              <Tag className="w-3 h-3 mr-1 text-muted-foreground" />
              Убрать бейдж
            </Button>

            <span className="text-muted-foreground text-xs">|</span>

            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0"
                max="99"
                placeholder="Скидка %"
                value={bulkDiscountInput}
                onChange={(e) => setBulkDiscountInput(e.target.value)}
                className="w-24 h-8 px-2 text-xs rounded border bg-background text-foreground"
                data-testid="input-bulk-discount"
              />
              <Button
                size="sm"
                className="h-8"
                variant="outline"
                onClick={() => {
                  const val = parseInt(bulkDiscountInput);
                  if (isNaN(val) || val < 1 || val > 99) {
                    toast({ title: "Введите скидку от 1 до 99%", variant: "destructive" });
                    return;
                  }
                  bulkDiscountMutation.mutate({ ids: Array.from(selectedProducts), discountPercent: val });
                }}
                disabled={bulkDiscountMutation.isPending}
                data-testid="button-bulk-discount-apply"
              >
                <Tag className="w-3 h-3 mr-1 text-orange-500" />
                Скидка
              </Button>
              <Button
                size="sm"
                className="h-8"
                variant="outline"
                onClick={() => {
                  if (confirm(`Убрать скидку у ${selectedProducts.size} товаров?`)) {
                    bulkDiscountMutation.mutate({ ids: Array.from(selectedProducts), discountPercent: 0 });
                  }
                }}
                disabled={bulkDiscountMutation.isPending}
                data-testid="button-bulk-discount-remove"
              >
                <Tag className="w-3 h-3 mr-1 text-muted-foreground" />
                Убрать скидку
              </Button>
            </div>

            <span className="text-muted-foreground text-xs">|</span>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="h-8"
                  variant="outline"
                  disabled={bulkMeasurementsMutation.isPending}
                  data-testid="button-bulk-measurements"
                >
                  <Ruler className="w-3 h-3 mr-1" />
                  {bulkMeasurementsMutation.isPending ? "Применяю..." : "Размерная таблица"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-zinc-900 border-zinc-700 text-zinc-100">
                {Object.entries(MEASUREMENT_TEMPLATES).map(([key, tmpl]) => (
                  <DropdownMenuItem
                    key={key}
                    className="text-zinc-100 focus:bg-zinc-800 focus:text-white cursor-pointer"
                    data-testid={`menu-bulk-tmpl-${key}`}
                    onClick={() => {
                      if (confirm(`Применить шаблон «${tmpl.label}» к ${selectedProducts.size} товарам?\n\nЭто перезапишет уже заполненные таблицы.`)) {
                        bulkMeasurementsMutation.mutate({ ids: Array.from(selectedProducts), measurements: tmpl.sizes });
                      }
                    }}
                  >
                    {tmpl.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator className="bg-zinc-700" />
                <DropdownMenuItem
                  className="text-zinc-100 focus:bg-zinc-800 focus:text-white cursor-pointer"
                  data-testid="menu-bulk-tmpl-copy"
                  onClick={() => { setBulkMeasurementsCopySearch(""); setBulkMeasurementsCopyOpen(true); }}
                >
                  <Copy className="w-3 h-3 mr-2" />
                  Скопировать с товара...
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-zinc-700" />
                <DropdownMenuItem
                  className="text-red-400 focus:bg-zinc-800 focus:text-red-300 cursor-pointer"
                  data-testid="menu-bulk-tmpl-clear"
                  onClick={() => {
                    if (confirm(`Очистить размерную таблицу у ${selectedProducts.size} товаров?`)) {
                      bulkMeasurementsMutation.mutate({ ids: Array.from(selectedProducts), measurements: [] });
                    }
                  }}
                >
                  Очистить таблицу
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="destructive"
              size="sm"
              className="h-8"
              onClick={() => deleteSelectedMutation.mutate(Array.from(selectedProducts))}
              disabled={deleteSelectedMutation.isPending}
              data-testid="button-delete-selected"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Удалить
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setSelectedProducts(new Set())}
            >
              Отмена
            </Button>
          </div>
        </div>
      )}

      {/* Storage info */}
      {storageInfo && (
        <div className="px-3 py-2 bg-muted/50 border-b text-sm">
          <span className="text-muted-foreground">Хранилище: {storageInfo.total} файлов, {storageInfo.images} изображений</span>
        </div>
      )}

      {/* Content */}
      <div className="p-2">
        {/* Unified Bonuses Tab */}
        {activeTab === "bonuses" && (
          <div className="space-y-4">
            {/* Sub-tabs navigation */}
            <div className="flex flex-wrap gap-2 border-b pb-3">
              <Button
                variant={bonusesSubTab === "promo" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBonusesSubTab("promo")}
                className="h-8"
              >
                <Tag className="w-4 h-4 mr-1" />
                Промокоды
              </Button>
              <Button
                variant={bonusesSubTab === "giftcards" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBonusesSubTab("giftcards")}
                className="h-8"
              >
                <Gift className="w-4 h-4 mr-1" />
                Сертификаты
                {giftCardsQuery.data && giftCardsQuery.data.length > 0 && (
                  <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">
                    {giftCardsQuery.data.length}
                  </Badge>
                )}
              </Button>
              <Button
                variant={bonusesSubTab === "loyalty" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBonusesSubTab("loyalty")}
                className="h-8"
              >
                <TrendingUp className="w-4 h-4 mr-1" />
                Лояльность
              </Button>
              <Button
                variant={bonusesSubTab === "newsletter" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBonusesSubTab("newsletter")}
                className="h-8"
              >
                <Mail className="w-4 h-4 mr-1" />
                Рассылка
                {newsletterStatsQuery.data && newsletterStatsQuery.data.count > 0 && (
                  <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">
                    {newsletterStatsQuery.data.count}
                  </Badge>
                )}
              </Button>
              <Button
                variant={bonusesSubTab === "stock-notify" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBonusesSubTab("stock-notify")}
                className="h-8"
                data-testid="button-subtab-stock-notify"
              >
                <Bell className="w-4 h-4 mr-1" />
                Подписки на товар
                {stockNotificationsQuery.data && stockNotificationsQuery.data.filter(n => !n.notified).length > 0 && (
                  <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">
                    {stockNotificationsQuery.data.filter(n => !n.notified).length}
                  </Badge>
                )}
              </Button>
              <Button
                variant={bonusesSubTab === "price-drop" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBonusesSubTab("price-drop")}
                className="h-8"
                data-testid="button-subtab-price-drop"
              >
                <TrendingDown className="w-4 h-4 mr-1" />
                Снижение цены
                {priceDropQuery.data && priceDropQuery.data.filter(n => !n.notified).length > 0 && (
                  <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">
                    {priceDropQuery.data.filter(n => !n.notified).length}
                  </Badge>
                )}
              </Button>
              <Button
                variant={bonusesSubTab === "preorder-subscribers" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBonusesSubTab("preorder-subscribers")}
                className="h-8"
                data-testid="button-subtab-preorder-subscribers"
              >
                <Bell className="w-4 h-4 mr-1" />
                Предзаказ
                {preorderSubscribersQuery.data && preorderSubscribersQuery.data.count > 0 && (
                  <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">
                    {preorderSubscribersQuery.data.count}
                  </Badge>
                )}
              </Button>
              <Button
                variant={bonusesSubTab === "mailings" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBonusesSubTab("mailings")}
                className="h-8"
                data-testid="button-subtab-mailings"
              >
                <Send className="w-4 h-4 mr-1" />
                Рассылки новинок
                {((newsletterQueueStatusQuery.data?.count ?? 0) + (preorderQueueStatusQuery.data?.count ?? 0)) > 0 && bonusesSubTab !== "mailings" && (
                  <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">
                    {(newsletterQueueStatusQuery.data?.count ?? 0) + (preorderQueueStatusQuery.data?.count ?? 0)}
                  </Badge>
                )}
              </Button>
              <Button
                variant={bonusesSubTab === "settings" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBonusesSubTab("settings")}
                className="h-8"
              >
                <Settings className="w-4 h-4 mr-1" />
                Настройки
              </Button>
            </div>

            {/* Promo Codes Sub-tab */}
            {bonusesSubTab === "promo" && (
              <div className="space-y-6">
                <Card className="bg-zinc-900 border-zinc-800 text-white">
                  <CardHeader>
                    <CardTitle>Создать новый промокод</CardTitle>
                  </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm text-zinc-400">Код</label>
                    <Input 
                      placeholder="BMG-SUMMER" 
                      value={newPromo.code} 
                      onChange={(e) => setNewPromo({...newPromo, code: e.target.value.toUpperCase()})}
                      className="bg-zinc-800 border-zinc-700 focus:border-primary text-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm text-zinc-400">Скидка (%)</label>
                      <Input 
                        type="number"
                        value={newPromo.discountPercent} 
                        onChange={(e) => setNewPromo({...newPromo, discountPercent: Number(e.target.value)})}
                        className="bg-zinc-800 border-zinc-700 focus:border-primary text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-zinc-400">Скидка (₽)</label>
                      <Input 
                        type="number"
                        value={newPromo.discountAmount / 100} 
                        onChange={(e) => setNewPromo({...newPromo, discountAmount: Number(e.target.value) * 100})}
                        className="bg-zinc-800 border-zinc-700 focus:border-primary text-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm text-zinc-400">Начало действия</label>
                      <Input 
                        type="date"
                        value={newPromo.startsAt} 
                        onChange={(e) => setNewPromo({...newPromo, startsAt: e.target.value})}
                        className="bg-zinc-800 border-zinc-700 focus:border-primary text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-zinc-400">Конец действия</label>
                      <Input 
                        type="date"
                        value={newPromo.expiresAt} 
                        onChange={(e) => setNewPromo({...newPromo, expiresAt: e.target.value})}
                        className="bg-zinc-800 border-zinc-700 focus:border-primary text-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm text-zinc-400">Мин. заказ (₽)</label>
                      <Input 
                        type="number"
                        value={newPromo.minOrderAmount / 100} 
                        onChange={(e) => setNewPromo({...newPromo, minOrderAmount: Number(e.target.value) * 100})}
                        className="bg-zinc-800 border-zinc-700 focus:border-primary text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-zinc-400">Макс. использований (0 = безлимит)</label>
                      <Input 
                        type="number"
                        value={newPromo.maxUses} 
                        onChange={(e) => setNewPromo({...newPromo, maxUses: Number(e.target.value)})}
                        className="bg-zinc-800 border-zinc-700 focus:border-primary text-white"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 sm:col-span-2 py-1">
                    <Checkbox
                      id="promo-allow-wholesale"
                      checked={newPromo.allowForWholesale}
                      onCheckedChange={(v) => setNewPromo({...newPromo, allowForWholesale: !!v})}
                      className="border-zinc-500"
                    />
                    <label htmlFor="promo-allow-wholesale" className="text-sm text-zinc-300 cursor-pointer select-none">
                      Доступен для оптовых покупателей
                    </label>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm text-zinc-400">Применять только к категориям (пусто = на весь заказ)</label>
                    {(() => {
                      const selectedCats = newPromo.applicableCategories
                        ? newPromo.applicableCategories.split(',').map(s => s.trim()).filter(Boolean)
                        : [];
                      const catSlugs = Object.keys(editingCategories).length > 0
                        ? Object.keys(editingCategories)
                        : Object.keys(CATEGORIES);
                      const toggleCat = (value: string) => {
                        const next = selectedCats.includes(value)
                          ? selectedCats.filter(c => c !== value)
                          : [...selectedCats, value];
                        setNewPromo({...newPromo, applicableCategories: next.join(', ')});
                      };
                      return (
                        <Popover open={promoCatOpen} onOpenChange={setPromoCatOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-start min-h-[40px] h-auto bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-white font-normal"
                            >
                              {selectedCats.length === 0 ? (
                                <span className="text-zinc-400">Все категории</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {selectedCats.map(cat => (
                                    <span key={cat} className="bg-primary/20 text-primary px-1.5 py-0.5 rounded text-xs font-medium">{cat}</span>
                                  ))}
                                </div>
                              )}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 p-0 bg-zinc-900 border-zinc-700" align="start">
                            <ScrollArea className="h-72">
                              <div className="p-2">
                                {catSlugs.map(slug => {
                                  const catConfig = editingCategories[slug] || CATEGORIES[slug as CategorySlug];
                                  if (!catConfig) return null;
                                  const catName = typeof catConfig.name === 'string' ? catConfig.name : slug;
                                  const subs = mergedSubcategoriesFor(slug);
                                  return (
                                    <div key={slug} className="mb-2">
                                      <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-zinc-800/60">
                                        <Checkbox
                                          id={`pc-main-${slug}`}
                                          checked={selectedCats.includes(slug)}
                                          onCheckedChange={() => toggleCat(slug)}
                                          className="border-zinc-500"
                                        />
                                        <label htmlFor={`pc-main-${slug}`} className="text-sm font-semibold text-white cursor-pointer select-none">
                                          {catName} (весь раздел)
                                        </label>
                                      </div>
                                      {subs.map(sub => (
                                        <div key={sub.name} className="flex items-center gap-2 px-4 py-1 ml-2">
                                          <Checkbox
                                            id={`pc-sub-${sub.name}`}
                                            checked={selectedCats.includes(sub.name)}
                                            onCheckedChange={() => toggleCat(sub.name)}
                                            className="border-zinc-500"
                                          />
                                          <label htmlFor={`pc-sub-${sub.name}`} className="text-sm text-zinc-300 cursor-pointer select-none">
                                            {sub.name}
                                          </label>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                            {selectedCats.length > 0 && (
                              <div className="p-2 border-t border-zinc-700">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-full text-zinc-400 hover:text-white text-xs"
                                  onClick={() => setNewPromo({...newPromo, applicableCategories: ""})}
                                >
                                  Сбросить выбор
                                </Button>
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      );
                    })()}
                  </div>
                  <div className="flex items-end">
                    <Button 
                      onClick={() => createPromoMutation.mutate(newPromo)} 
                      disabled={createPromoMutation.isPending || !newPromo.code}
                      className="w-full"
                    >
                      Создать
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900 border-zinc-800 text-white">
              <CardHeader>
                <CardTitle>Список промокодов</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {promoCodesQuery.data?.promoCodes?.map((promo: any) => (
                    <div key={promo.id} className="flex items-center justify-between p-3 border border-zinc-800 rounded-md hover:bg-zinc-800/50 transition-colors">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="font-bold text-lg text-white">{promo.code}</div>
                          {promo.allowForWholesale && (
                            <span className="text-xs bg-blue-600/30 text-blue-300 border border-blue-600/40 px-1.5 py-0.5 rounded">Опт</span>
                          )}
                        </div>
                        <div className="text-sm text-zinc-400">
                          {promo.discountPercent ? `${promo.discountPercent}%` : `${promo.discountAmount / 100} ₽`} скидка
                          {promo.minOrderAmount > 0 && ` • от ${promo.minOrderAmount / 100} ₽`}
                          {promo.maxUses > 0 && ` • использовано: ${promo.usedCount || 0}/${promo.maxUses}`}
                          {promo.applicableCategories && (() => {
                            try {
                              const cats: string[] = typeof promo.applicableCategories === 'string'
                                ? JSON.parse(promo.applicableCategories)
                                : promo.applicableCategories;
                              return cats.length > 0 ? ` • только: ${cats.join(', ')}` : null;
                            } catch { return null; }
                          })()}
                        </div>
                      </div>
                      <Button 
                        variant="destructive" 
                        size="icon" 
                        onClick={() => confirm("Удалить промокод?") && deletePromoMutation.mutate(promo.id)}
                        className="h-8 w-8"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {(!promoCodesQuery.data?.promoCodes || promoCodesQuery.data.promoCodes.length === 0) && !promoCodesQuery.isLoading && (
                    <div className="text-center py-8 text-zinc-500">Промокоды не найдены</div>
                  )}
                  {promoCodesQuery.isLoading && (
                    <div className="text-center py-8 text-zinc-500">Загрузка...</div>
                  )}
                </div>
              </CardContent>
            </Card>
              </div>
            )}

            {/* Gift Cards Sub-tab */}
            {bonusesSubTab === "giftcards" && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Подарочные сертификаты</h3>
                <div className="grid gap-4">
                  {giftCardsQuery.data?.map((card: any) => (
                    <Card key={card.id}>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-lg">{card.code}</span>
                              <Badge variant={card.status === "active" ? "default" : card.status === "pending" ? "secondary" : "outline"}>
                                {card.status === "active" ? "Активен" : card.status === "pending" ? "Ожидает" : "Использован"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Номинал: {card.amount / 100} ₽ | Баланс: {card.balance / 100} ₽
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Покупатель: {card.purchaserName} ({card.purchaserEmail})
                            </p>
                            {card.recipientEmail && (
                              <p className="text-xs text-muted-foreground">
                                Получатель: {card.recipientName} ({card.recipientEmail})
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {card.status === "pending" && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => activateGiftCardMutation.mutate(card.id)}
                                disabled={activateGiftCardMutation.isPending}
                              >
                                Активировать
                              </Button>
                            )}
                            <Button 
                              size="sm" 
                              variant="destructive"
                              onClick={() => confirm("Удалить сертификат?") && deleteGiftCardMutation.mutate(card.id)}
                              disabled={deleteGiftCardMutation.isPending}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {(!giftCardsQuery.data || giftCardsQuery.data.length === 0) && (
                    <div className="text-center py-12 text-muted-foreground">
                      Сертификатов пока нет
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Loyalty Sub-tab */}
            {bonusesSubTab === "loyalty" && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                        <Star className="w-4 h-4" />
                        Уровней лояльности
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {loyaltyTiersQuery.data?.length || 0}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        Клиентов с бонусами
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {loyaltyUsersQuery.data?.users?.filter((u: any) => u.totalSpent > 0).length || 0}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5" />
                      Уровни накопительной скидки
                    </CardTitle>
                    <Button 
                      size="sm" 
                      onClick={() => {
                        setLoyaltyTierForm({ id: null, name: "", minSpent: 0, discountPercent: 0 });
                        setShowLoyaltyTierForm(true);
                      }}
                      data-testid="button-add-loyalty-tier"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Добавить
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {showLoyaltyTierForm && (
                      <div className="mb-4 p-4 border rounded-lg bg-muted/50">
                        <h4 className="font-medium mb-3">
                          {loyaltyTierForm.id ? "Редактировать уровень" : "Новый уровень"}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                          <div>
                            <label className="text-sm text-muted-foreground">Название</label>
                            <Input
                              placeholder="Например: Серебро"
                              value={loyaltyTierForm.name}
                              onChange={(e) => setLoyaltyTierForm({ ...loyaltyTierForm, name: e.target.value })}
                              data-testid="input-loyalty-tier-name"
                            />
                          </div>
                          <div>
                            <label className="text-sm text-muted-foreground">Сумма покупок от (₽)</label>
                            <Input
                              type="number"
                              placeholder="5000"
                              value={loyaltyTierForm.minSpent / 100 || ""}
                              onChange={(e) => setLoyaltyTierForm({ ...loyaltyTierForm, minSpent: Number(e.target.value) * 100 })}
                              data-testid="input-loyalty-tier-min-spent"
                            />
                          </div>
                          <div>
                            <label className="text-sm text-muted-foreground">Скидка (%)</label>
                            <Input
                              type="number"
                              placeholder="5"
                              value={loyaltyTierForm.discountPercent || ""}
                              onChange={(e) => setLoyaltyTierForm({ ...loyaltyTierForm, discountPercent: Number(e.target.value) })}
                              data-testid="input-loyalty-tier-discount"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              if (loyaltyTierForm.id) {
                                updateLoyaltyTierMutation.mutate({
                                  id: loyaltyTierForm.id,
                                  name: loyaltyTierForm.name,
                                  minSpent: loyaltyTierForm.minSpent,
                                  discountPercent: loyaltyTierForm.discountPercent,
                                });
                              } else {
                                createLoyaltyTierMutation.mutate({
                                  name: loyaltyTierForm.name,
                                  minSpent: loyaltyTierForm.minSpent,
                                  discountPercent: loyaltyTierForm.discountPercent,
                                });
                              }
                            }}
                            disabled={createLoyaltyTierMutation.isPending || updateLoyaltyTierMutation.isPending}
                            data-testid="button-save-loyalty-tier"
                          >
                            {(createLoyaltyTierMutation.isPending || updateLoyaltyTierMutation.isPending) ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-1" />
                            ) : null}
                            Сохранить
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShowLoyaltyTierForm(false)}
                            data-testid="button-cancel-loyalty-tier"
                          >
                            Отмена
                          </Button>
                        </div>
                      </div>
                    )}
                    
                    {loyaltyTiersQuery.isLoading ? (
                      <div className="text-center py-4">Загрузка...</div>
                    ) : loyaltyTiersQuery.data?.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">
                        Уровни лояльности не настроены. Нажмите "Добавить" чтобы создать первый уровень.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {loyaltyTiersQuery.data
                          ?.slice()
                          .sort((a: any, b: any) => a.minSpent - b.minSpent)
                          .map((tier: any) => (
                          <div key={tier.id} className="flex items-center justify-between p-3 border rounded-lg">
                            <div className="flex items-center gap-3">
                              <Badge variant="secondary">{tier.name || `Уровень ${tier.id}`}</Badge>
                              <span className="text-sm text-muted-foreground">
                                от {(tier.minSpent / 100).toLocaleString()} ₽
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="default" className="bg-green-600">
                                {tier.discountPercent}% скидка
                              </Badge>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  setLoyaltyTierForm({
                                    id: tier.id,
                                    name: tier.name || "",
                                    minSpent: tier.minSpent,
                                    discountPercent: tier.discountPercent,
                                  });
                                  setShowLoyaltyTierForm(true);
                                }}
                                data-testid={`button-edit-tier-${tier.id}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => {
                                  if (confirm("Удалить этот уровень?")) {
                                    deleteLoyaltyTierMutation.mutate(tier.id);
                                  }
                                }}
                                data-testid={`button-delete-tier-${tier.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      Клиенты с накопительной скидкой
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {loyaltyUsersQuery.isLoading ? (
                      <div className="text-center py-4">Загрузка...</div>
                    ) : loyaltyUsersQuery.data?.users?.filter((u: any) => u.totalSpent > 0).length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">
                        Клиентов с покупками пока нет
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {loyaltyUsersQuery.data?.users
                          ?.filter((u: any) => u.totalSpent > 0)
                          .sort((a: any, b: any) => b.totalSpent - a.totalSpent)
                          .slice(0, 50)
                          .map((user: any) => (
                            <div key={user.id} className="flex items-center justify-between p-3 border rounded-lg">
                              <div>
                                <div className="font-medium">{user.name}</div>
                                <div className="text-sm text-muted-foreground">{user.email}</div>
                              </div>
                              <div className="text-right">
                                <div className="font-semibold text-green-600">
                                  {(user.totalSpent / 100).toLocaleString()} ₽
                                </div>
                                <Badge variant="secondary">
                                  {user.loyaltyDiscount || 0}% скидка
                                </Badge>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Newsletter Sub-tab */}
            {bonusesSubTab === "newsletter" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                      <Mail className="w-4 h-4" />
                      Всего подписчиков
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {newsletterStatsQuery.data?.count || 0}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Send className="w-5 h-5" />
                      Отправить рассылку
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-1 block">Тема письма</label>
                      <Input
                        value={broadcastSubject}
                        onChange={(e) => setBroadcastSubject(e.target.value)}
                        placeholder="Тема рассылки..."
                        data-testid="input-broadcast-subject"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Содержание письма</label>
                      <EmailEditor
                        value={broadcastBody}
                        onChange={setBroadcastBody}
                        apiKey={apiKey}
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium">Получатели</label>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const allEmails = newsletterStatsQuery.data?.subscriptions?.map((s: any) => s.email) || [];
                              if (selectedEmails.size === allEmails.length) {
                                setSelectedEmails(new Set());
                              } else {
                                setSelectedEmails(new Set(allEmails));
                              }
                            }}
                            data-testid="button-select-all-subscribers"
                          >
                            <CheckSquare className="w-3.5 h-3.5 mr-1" />
                            {selectedEmails.size === (newsletterStatsQuery.data?.subscriptions?.length || 0) && selectedEmails.size > 0
                              ? "Снять все" : "Выбрать все"}
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            Выбрано: {selectedEmails.size}
                          </span>
                        </div>
                      </div>

                      {newsletterStatsQuery.isLoading ? (
                        <div className="text-center py-4">Загрузка...</div>
                      ) : newsletterStatsQuery.data?.subscriptions?.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground">
                          Подписчиков пока нет
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-60 overflow-y-auto border rounded p-2">
                          {newsletterStatsQuery.data?.subscriptions?.map((sub: any) => (
                            <label
                              key={sub.id}
                              className="flex items-center gap-2 p-1.5 rounded cursor-pointer hover-elevate"
                              data-testid={`label-subscriber-${sub.id}`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedEmails.has(sub.email)}
                                onChange={(e) => {
                                  const next = new Set(selectedEmails);
                                  if (e.target.checked) {
                                    next.add(sub.email);
                                  } else {
                                    next.delete(sub.email);
                                  }
                                  setSelectedEmails(next);
                                }}
                                className="rounded"
                                data-testid={`checkbox-subscriber-${sub.id}`}
                              />
                              <span className="font-mono text-sm flex-1">{sub.email}</span>
                              <span className="text-xs text-muted-foreground">
                                {sub.subscribedAt ? new Date(sub.subscribedAt).toLocaleDateString('ru-RU') : ''}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    <Button
                      onClick={() => {
                        const bodyText = broadcastBody.replace(/<[^>]*>/g, "").trim();
                        if (!broadcastSubject.trim() || !bodyText) {
                          toast({ title: "Заполните тему и текст письма", variant: "destructive" });
                          return;
                        }
                        if (selectedEmails.size === 0) {
                          toast({ title: "Выберите хотя бы одного получателя", variant: "destructive" });
                          return;
                        }
                        if (!confirm(`Отправить рассылку ${selectedEmails.size} подписчикам?`)) return;

                        const wrapperHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .logo { font-size: 24px; font-weight: bold; color: #1C1C1C; }
  .logo span { color: #E53935; }
  .footer { margin-top: 40px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 15px; }
</style></head><body>
<div class="container">
  <div class="logo">BMG<span>BRAND</span></div>
  <div style="margin-top: 20px;">${broadcastBody}</div>
  <div class="footer">
    <p>&copy; ${new Date().getFullYear()} BMGBRAND. Все права защищены.</p>
  </div>
</div>
</body></html>`;

                        broadcastMutation.mutate({
                          subject: broadcastSubject.trim(),
                          html: wrapperHtml,
                          emails: Array.from(selectedEmails),
                        });
                      }}
                      disabled={broadcastMutation.isPending || !broadcastSubject.trim() || !broadcastBody.replace(/<[^>]*>/g, "").trim() || selectedEmails.size === 0}
                      data-testid="button-send-broadcast"
                    >
                      {broadcastMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 mr-1" />
                      )}
                      Отправить ({selectedEmails.size})
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Mail className="w-5 h-5" />
                      Подписки на рассылку
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {newsletterStatsQuery.isLoading ? (
                      <div className="text-center py-4">Загрузка...</div>
                    ) : newsletterStatsQuery.data?.subscriptions?.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">
                        Подписок пока нет
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {newsletterStatsQuery.data?.subscriptions?.map((sub: any) => (
                          <div key={sub.id} className="flex items-center justify-between p-2 border rounded text-sm">
                            <span className="font-mono">{sub.email}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{sub.promoCodeGiven || 'N/A'}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {sub.subscribedAt ? new Date(sub.subscribedAt).toLocaleDateString('ru-RU') : ''}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={() => confirm(`Удалить подписку ${sub.email}?`) && deleteNewsletterMutation.mutate(sub.id)}
                                disabled={deleteNewsletterMutation.isPending}
                                data-testid={`button-delete-sub-${sub.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Bell className="w-4 h-4" />
                    Push-уведомления
                  </h3>
                  <PushNotificationsPanel
                    apiKey={apiKey}
                    isActive={bonusesSubTab === "newsletter"}
                  />
                </div>
              </div>
            )}

            {/* Stock Notifications Sub-tab */}
            {bonusesSubTab === "stock-notify" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                      <Bell className="w-4 h-4" />
                      Подписки на поступление товара
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 mb-4">
                      <div>
                        <span className="text-2xl font-bold">{stockNotificationsQuery.data?.length || 0}</span>
                        <span className="text-sm text-muted-foreground ml-2">всего</span>
                      </div>
                      <div>
                        <span className="text-lg font-semibold text-primary">{stockNotificationsQuery.data?.filter(n => !n.notified).length || 0}</span>
                        <span className="text-sm text-muted-foreground ml-2">ожидают</span>
                      </div>
                      <div>
                        <span className="text-lg font-semibold text-green-600">{stockNotificationsQuery.data?.filter(n => n.notified).length || 0}</span>
                        <span className="text-sm text-muted-foreground ml-2">уведомлены</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      Список подписок
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {stockNotificationsQuery.isLoading ? (
                      <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
                    ) : !stockNotificationsQuery.data?.length ? (
                      <p className="text-sm text-muted-foreground text-center py-8">Пока нет подписок на поступление товара</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" data-testid="table-stock-notifications">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Email</th>
                              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Товар</th>
                              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Размер</th>
                              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Дата</th>
                              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Статус</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stockNotificationsQuery.data.map((n) => (
                              <tr key={n.id} className="border-b last:border-0">
                                <td className="py-2 px-2">{n.email}</td>
                                <td className="py-2 px-2">
                                  <span className="font-medium">{n.productName || '—'}</span>
                                  <span className="text-xs text-muted-foreground ml-1">#{n.productId}</span>
                                </td>
                                <td className="py-2 px-2">
                                  <Badge variant="outline">{n.size}</Badge>
                                </td>
                                <td className="py-2 px-2 text-muted-foreground">
                                  {n.createdAt ? new Date(n.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : '—'}
                                </td>
                                <td className="py-2 px-2">
                                  {n.notified ? (
                                    <Badge variant="outline" className="text-green-600 border-green-500/30">
                                      <Check className="w-3 h-3 mr-1" />
                                      Уведомлён
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                                      <Clock className="w-3 h-3 mr-1" />
                                      Ожидает
                                    </Badge>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Price Drop Subscriptions Sub-tab */}
            {bonusesSubTab === "price-drop" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                      <TrendingDown className="w-4 h-4" />
                      Подписки на снижение цены
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 mb-4">
                      <div>
                        <span className="text-2xl font-bold">{priceDropQuery.data?.length || 0}</span>
                        <span className="text-sm text-muted-foreground ml-2">всего</span>
                      </div>
                      <div>
                        <span className="text-lg font-semibold text-primary">{priceDropQuery.data?.filter(n => !n.notified).length || 0}</span>
                        <span className="text-sm text-muted-foreground ml-2">ожидают</span>
                      </div>
                      <div>
                        <span className="text-lg font-semibold text-green-600">{priceDropQuery.data?.filter(n => n.notified).length || 0}</span>
                        <span className="text-sm text-muted-foreground ml-2">уведомлены</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Список подписок</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {priceDropQuery.isLoading ? (
                      <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
                    ) : !priceDropQuery.data?.length ? (
                      <p className="text-sm text-muted-foreground text-center py-8">Пока нет подписок на снижение цены</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" data-testid="table-price-drop-subscriptions">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Email</th>
                              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Товар</th>
                              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Цена при подписке</th>
                              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Дата</th>
                              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Статус</th>
                            </tr>
                          </thead>
                          <tbody>
                            {priceDropQuery.data.map((n) => (
                              <tr key={n.id} className="border-b last:border-0">
                                <td className="py-2 px-2">{n.email}</td>
                                <td className="py-2 px-2">
                                  <span className="font-medium">{n.productName || '—'}</span>
                                  <span className="text-xs text-muted-foreground ml-1">#{n.productId}</span>
                                </td>
                                <td className="py-2 px-2 font-medium">{(n.priceAtSubscription / 100).toLocaleString('ru-RU')} ₽</td>
                                <td className="py-2 px-2 text-muted-foreground">
                                  {n.createdAt ? new Date(n.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : '—'}
                                </td>
                                <td className="py-2 px-2">
                                  {n.notified ? (
                                    <Badge variant="outline" className="text-green-600 border-green-500/30">
                                      <Check className="w-3 h-3 mr-1" />
                                      Уведомлён
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                                      <Clock className="w-3 h-3 mr-1" />
                                      Ожидает
                                    </Badge>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Preorder Subscribers Sub-tab */}
            {bonusesSubTab === "preorder-subscribers" && (
              <div className="space-y-4" data-testid="section-preorder-subscribers">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-base">Подписчики на предзаказы</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Пользователи, которые подписались на уведомления о новых предзаказах
                    </p>
                  </div>
                  {preorderSubscribersQuery.data && (
                    <Badge variant="secondary" className="text-sm px-3 py-1">
                      {preorderSubscribersQuery.data.count} подписчиков
                    </Badge>
                  )}
                </div>
                <Card>
                  <CardContent className="p-0">
                    {preorderSubscribersQuery.isLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : !preorderSubscribersQuery.data?.subscribers?.length ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Bell className="w-8 h-8 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">Подписчиков пока нет</p>
                      </div>
                    ) : (
                      <table className="w-full text-sm" data-testid="table-preorder-subscribers">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Имя</th>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Дата подписки</th>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Статус</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preorderSubscribersQuery.data.subscribers.map((sub, idx) => (
                            <tr key={sub.id} className={`border-b last:border-0 ${idx % 2 === 0 ? '' : 'bg-muted/10'}`} data-testid={`row-preorder-subscriber-${sub.id}`}>
                              <td className="px-4 py-3 font-medium text-foreground">{sub.email}</td>
                              <td className="px-4 py-3 text-muted-foreground">{sub.name || '—'}</td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {new Date(sub.subscribedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </td>
                              <td className="px-4 py-3">
                                {sub.isActive ? (
                                  <Badge variant="default" className="bg-green-600 text-xs">Активна</Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-xs">Отписан</Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Mailings Sub-tab */}
            {bonusesSubTab === "mailings" && (
              <div className="space-y-6" data-testid="section-mailings">
                {/* Новинки */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Package className="w-5 h-5 text-primary" />
                        <div>
                          <CardTitle className="text-base">Новинки</CardTitle>
                          <CardDescription className="text-xs mt-0.5">
                            Автоматическая рассылка новых товаров подписчикам. Отправка через 5 ч тишины (макс. 12 ч).
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="new-products-enabled" className="text-sm text-muted-foreground">
                          {mailingsSettingsQuery.data?.newProductsEnabled !== false ? "Вкл" : "Выкл"}
                        </Label>
                        <Switch
                          id="new-products-enabled"
                          checked={mailingsSettingsQuery.data?.newProductsEnabled !== false}
                          disabled={updateMailingsSettingsMutation.isPending || mailingsSettingsQuery.isLoading}
                          onCheckedChange={(checked) => updateMailingsSettingsMutation.mutate({ newProductsEnabled: checked })}
                          data-testid="switch-new-products-enabled"
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {newsletterQueueStatusQuery.isLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
                      </div>
                    ) : newsletterQueueStatusQuery.data?.count === 0 ? (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/40 text-sm text-muted-foreground">
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                        Очередь пуста — нет новинок для отправки
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
                            <Package className="w-3.5 h-3.5" />
                            {newsletterQueueStatusQuery.data?.count} товаров в очереди
                          </div>
                          {newsletterQueueStatusQuery.data?.minutesUntilSend !== null && newsletterQueueStatusQuery.data?.minutesUntilSend !== undefined && (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-600 text-sm">
                              <Clock className="w-3.5 h-3.5" />
                              До отправки: ~{newsletterQueueStatusQuery.data.minutesUntilSend < 60
                                ? `${newsletterQueueStatusQuery.data.minutesUntilSend} мин`
                                : `${Math.round(newsletterQueueStatusQuery.data.minutesUntilSend / 60)} ч`}
                            </div>
                          )}
                        </div>
                        {newsletterQueueStatusQuery.data?.firstAddedAt && (
                          <div className="text-xs text-muted-foreground">
                            Первый товар добавлен: {new Date(newsletterQueueStatusQuery.data.firstAddedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {newsletterQueueStatusQuery.data.lastAddedAt && newsletterQueueStatusQuery.data.lastAddedAt !== newsletterQueueStatusQuery.data.firstAddedAt && (
                              <span className="ml-2">· Последний: {new Date(newsletterQueueStatusQuery.data.lastAddedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                            )}
                          </div>
                        )}
                        {newsletterQueueStatusQuery.data?.productIds && newsletterQueueStatusQuery.data.productIds.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            ID товаров: {newsletterQueueStatusQuery.data.productIds.slice(0, 8).join(', ')}{newsletterQueueStatusQuery.data.productIds.length > 8 ? ` +${newsletterQueueStatusQuery.data.productIds.length - 8} ещё` : ''}
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => triggerNewProductsMutation.mutate()}
                          disabled={triggerNewProductsMutation.isPending}
                          data-testid="button-trigger-new-products"
                        >
                          {triggerNewProductsMutation.isPending ? (
                            <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Отправляем...</>
                          ) : (
                            <><Send className="w-3.5 h-3.5 mr-1.5" />Отправить сейчас</>
                          )}
                        </Button>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground border-t pt-3">
                      Подписчиков: <span className="font-medium text-foreground">{newsletterStatsQuery.data?.count ?? '—'}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Предзаказы */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bell className="w-5 h-5 text-primary" />
                        <div>
                          <CardTitle className="text-base">Предзаказы</CardTitle>
                          <CardDescription className="text-xs mt-0.5">
                            Уведомление подписчиков при открытии нового предзаказа. Отправка через 5 ч тишины (макс. 12 ч).
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="preorder-enabled" className="text-sm text-muted-foreground">
                          {mailingsSettingsQuery.data?.preorderEnabled !== false ? "Вкл" : "Выкл"}
                        </Label>
                        <Switch
                          id="preorder-enabled"
                          checked={mailingsSettingsQuery.data?.preorderEnabled !== false}
                          disabled={updateMailingsSettingsMutation.isPending || mailingsSettingsQuery.isLoading}
                          onCheckedChange={(checked) => updateMailingsSettingsMutation.mutate({ preorderEnabled: checked })}
                          data-testid="switch-preorder-enabled"
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {preorderQueueStatusQuery.isLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
                      </div>
                    ) : preorderQueueStatusQuery.data?.count === 0 ? (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/40 text-sm text-muted-foreground">
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                        Очередь пуста — нет предзаказов для отправки
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
                            <Bell className="w-3.5 h-3.5" />
                            {preorderQueueStatusQuery.data?.count} предзаказов в очереди
                          </div>
                          {preorderQueueStatusQuery.data?.minutesUntilSend !== null && preorderQueueStatusQuery.data?.minutesUntilSend !== undefined && (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-600 text-sm">
                              <Clock className="w-3.5 h-3.5" />
                              До отправки: ~{preorderQueueStatusQuery.data.minutesUntilSend < 60
                                ? `${preorderQueueStatusQuery.data.minutesUntilSend} мин`
                                : `${Math.round(preorderQueueStatusQuery.data.minutesUntilSend / 60)} ч`}
                            </div>
                          )}
                        </div>
                        {preorderQueueStatusQuery.data?.firstAddedAt && (
                          <div className="text-xs text-muted-foreground">
                            Первый товар добавлен: {new Date(preorderQueueStatusQuery.data.firstAddedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {preorderQueueStatusQuery.data.lastAddedAt && preorderQueueStatusQuery.data.lastAddedAt !== preorderQueueStatusQuery.data.firstAddedAt && (
                              <span className="ml-2">· Последний: {new Date(preorderQueueStatusQuery.data.lastAddedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                            )}
                          </div>
                        )}
                        {preorderQueueStatusQuery.data?.productIds && preorderQueueStatusQuery.data.productIds.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            ID товаров: {preorderQueueStatusQuery.data.productIds.slice(0, 8).join(', ')}{preorderQueueStatusQuery.data.productIds.length > 8 ? ` +${preorderQueueStatusQuery.data.productIds.length - 8} ещё` : ''}
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => triggerPreorderMutation.mutate()}
                          disabled={triggerPreorderMutation.isPending}
                          data-testid="button-trigger-preorder"
                        >
                          {triggerPreorderMutation.isPending ? (
                            <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Отправляем...</>
                          ) : (
                            <><Send className="w-3.5 h-3.5 mr-1.5" />Отправить сейчас</>
                          )}
                        </Button>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground border-t pt-3">
                      Подписчиков предзаказов: <span className="font-medium text-foreground">{preorderSubscribersQuery.data?.count ?? '—'}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Settings Sub-tab */}
            {bonusesSubTab === "settings" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ShoppingCart className="w-5 h-5" />
                      Брошенные корзины
                    </CardTitle>
                    <CardDescription>Ручной запуск рассылки напоминаний о брошенных корзинах</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <AbandonedCartTriggerButton />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Tag className="w-5 h-5" />
                      Промокоды за подписку
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {popupPromoQuery.isLoading ? (
                      <div className="text-center py-4">Загрузка...</div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="p-4 border rounded-lg space-y-4">
                            <div className="flex items-center justify-between">
                              <h4 className="font-medium">Popup (всплывающее окно)</h4>
                              <div className="flex items-center gap-2">
                                <Label htmlFor="popup-active" className="text-sm text-muted-foreground">
                                  {popupPromoForm.popupActive ? "Вкл" : "Выкл"}
                                </Label>
                                <Switch
                                  id="popup-active"
                                  checked={popupPromoForm.popupActive}
                                  onCheckedChange={(checked) => setPopupPromoForm(prev => ({ ...prev, popupActive: checked }))}
                                  data-testid="switch-popup-active"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>Код промокода</Label>
                              <Input
                                value={popupPromoForm.popupCode}
                                onChange={(e) => setPopupPromoForm(prev => ({ ...prev, popupCode: e.target.value.toUpperCase() }))}
                                placeholder="WELCOME10"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Скидка (%)</Label>
                              <Input
                                type="number"
                                value={popupPromoForm.popupDiscount}
                                onChange={(e) => setPopupPromoForm(prev => ({ ...prev, popupDiscount: Number(e.target.value) }))}
                              />
                            </div>
                            
                            <div className="pt-4 border-t space-y-4">
                              <h5 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Кастомизация текстов</h5>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label className="text-xs">Заголовок</Label>
                                  <Input 
                                    value={popupPromoForm.settings.title}
                                    onChange={(e) => setPopupPromoForm(prev => ({ ...prev, settings: { ...prev.settings, title: e.target.value } }))}
                                    placeholder="ЭКСКЛЮЗИВНОЕ ПРЕДЛОЖЕНИЕ"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-xs">Подзаголовок</Label>
                                  <Input 
                                    value={popupPromoForm.settings.subtitle}
                                    onChange={(e) => setPopupPromoForm(prev => ({ ...prev, settings: { ...prev.settings, subtitle: e.target.value } }))}
                                    placeholder="NEW_MEMBER_BONUS"
                                  />
                                </div>
                              </div>
                              
                              <div className="space-y-2">
                                <Label className="text-xs">Описание</Label>
                                <textarea
                                  className="w-full min-h-[80px] px-3 py-2 border rounded-md text-sm bg-background"
                                  value={popupPromoForm.settings.description}
                                  onChange={(e) => setPopupPromoForm(prev => ({ ...prev, settings: { ...prev.settings, description: e.target.value } }))}
                                  placeholder="Скидка на первый заказ..."
                                />
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label className="text-xs">Текст кнопки</Label>
                                  <Input 
                                    value={popupPromoForm.settings.buttonText}
                                    onChange={(e) => setPopupPromoForm(prev => ({ ...prev, settings: { ...prev.settings, buttonText: e.target.value } }))}
                                    placeholder="ПОЛУЧИТЬ СКИДКУ"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-xs">Плейсхолдер email</Label>
                                  <Input 
                                    value={popupPromoForm.settings.placeholder}
                                    onChange={(e) => setPopupPromoForm(prev => ({ ...prev, settings: { ...prev.settings, placeholder: e.target.value } }))}
                                    placeholder="Ваш email"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label className="text-xs">Заголовок успеха</Label>
                                  <Input 
                                    value={popupPromoForm.settings.successTitle}
                                    onChange={(e) => setPopupPromoForm(prev => ({ ...prev, settings: { ...prev.settings, successTitle: e.target.value } }))}
                                    placeholder="ДОБРО ПОЖАЛОВАТЬ!"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-xs">Текст успеха</Label>
                                  <Input 
                                    value={popupPromoForm.settings.successText}
                                    onChange={(e) => setPopupPromoForm(prev => ({ ...prev, settings: { ...prev.settings, successText: e.target.value } }))}
                                    placeholder="Ваш промокод на скидку"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label className="text-xs">Текст кнопки закрытия</Label>
                                  <Input 
                                    value={popupPromoForm.settings.closeText}
                                    onChange={(e) => setPopupPromoForm(prev => ({ ...prev, settings: { ...prev.settings, closeText: e.target.value } }))}
                                    placeholder="Продолжить покупки"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-xs">Задержка показа (мс)</Label>
                                  <Input 
                                    type="number"
                                    value={popupPromoForm.settings.delay}
                                    onChange={(e) => setPopupPromoForm(prev => ({ ...prev, settings: { ...prev.settings, delay: Number(e.target.value) } }))}
                                    placeholder="4000"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="p-4 border rounded-lg space-y-4">
                            <div className="flex items-center justify-between">
                              <h4 className="font-medium">Главная страница</h4>
                              <div className="flex items-center gap-2">
                                <Label htmlFor="homepage-active" className="text-sm text-muted-foreground">
                                  {popupPromoForm.homepageActive ? "Вкл" : "Выкл"}
                                </Label>
                                <Switch
                                  id="homepage-active"
                                  checked={popupPromoForm.homepageActive}
                                  onCheckedChange={(checked) => setPopupPromoForm(prev => ({ ...prev, homepageActive: checked }))}
                                  data-testid="switch-homepage-active"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>Код промокода</Label>
                              <Input
                                value={popupPromoForm.homepageCode}
                                onChange={(e) => setPopupPromoForm(prev => ({ ...prev, homepageCode: e.target.value.toUpperCase() }))}
                                placeholder="WELCOME7"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Скидка (%)</Label>
                              <Input
                                type="number"
                                value={popupPromoForm.homepageDiscount}
                                onChange={(e) => setPopupPromoForm(prev => ({ ...prev, homepageDiscount: Number(e.target.value) }))}
                              />
                            </div>
                          </div>
                        </div>
                        <Button
                          onClick={() => updatePopupPromoMutation.mutate(popupPromoForm)}
                          disabled={updatePopupPromoMutation.isPending}
                        >
                          <Save className="w-4 h-4 mr-2" />
                          Сохранить настройки
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* Page Editor Tab */}
        {activeTab === "pages" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Layout className="w-5 h-5" />
                Редактор страниц
              </h2>
              <Select value={selectedPage} onValueChange={(v) => {
                setSelectedPage(v);
                setSelectedSection(null);
                if (v !== "product") {
                  resetProductForm();
                }
              }}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Выберите страницу" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="navbar">Шапка сайта</SelectItem>
                  <SelectItem value="footer">Подвал сайта</SelectItem>
                  <SelectItem value="home">Главная</SelectItem>
                  <SelectItem value="product">Товары</SelectItem>
                  <SelectItem value="categories">Категории</SelectItem>
                  <SelectItem value="vacancies">Вакансии</SelectItem>
                  <SelectItem value="artist_pages">Страницы артистов</SelectItem>
                  <SelectItem value="blog_pages">Страницы блога</SelectItem>
                  <SelectItem value="checkout">Оформление заказа</SelectItem>
                  <SelectItem value="static_pages">Статические страницы</SelectItem>
                  <SelectItem value="concept">Концепт (Предзаказ)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedPage === "navbar" && (
              <NavbarEditor apiKey={apiKey} />
            )}

            {selectedPage === "footer" && (
              <FooterEditor apiKey={apiKey} />
            )}

            {selectedPage === "checkout" && (
              <CheckoutEditor apiKey={apiKey} />
            )}

            {selectedPage === "home" && (() => {
              const DEFAULT_SECTION_ORDER = ["hero", "reels", "categories", "popular", "featuredDrop", "benefits", "philosophy", "blog", "promo_banner", "newsletter", "marquee"];

              const CUSTOM_SECTION_TYPES: Record<string, { name: string; icon: any }> = {
                custom_hits: { name: "Хиты продаж", icon: TrendingUp },
                custom_promo_banner: { name: "Промо-баннер", icon: ImageIcon },
                custom_text: { name: "Текстовый блок", icon: Type },
              };

              const ALL_SECTIONS: Record<string, { name: string; icon: any }> = {
                hero: { name: "Hero (Главный баннер)", icon: ImageIcon },
                categories: { name: "Категории", icon: Layout },
                popular: { name: "Популярное", icon: TrendingUp },
                featuredDrop: { name: "Капсула времени (Pre-drop)", icon: Clock },
                benefits: { name: "Преимущества", icon: Star },
                philosophy: { name: "Философия", icon: Type },
                blog: { name: "Блог", icon: Tag },
                promo_banner: { name: "Промо-баннер", icon: ImageIcon },
                newsletter: { name: "Подписка", icon: Mail },
                marquee: { name: "Бегущая строка", icon: Type },
                reels: { name: "Обзоры (Видео-рилсы)", icon: Play },
              };
              // Динамически добавляем кастомные секции из настроек страницы
              Object.keys(pageSettingsQuery.data || {}).forEach(id => {
                if (id.startsWith("custom_")) {
                  const s = pageSettingsQuery.data?.[id];
                  const typeKey = (s?.type as string) || "custom_hits";
                  const typeInfo = CUSTOM_SECTION_TYPES[typeKey] || CUSTOM_SECTION_TYPES.custom_hits;
                  ALL_SECTIONS[id] = { name: (s?.title as string) || typeInfo.name, icon: typeInfo.icon };
                }
              });
              
              const computeOrder = () => {
                const saved: string[] = homeSectionOrder || pageSettingsQuery.data?.sectionOrder?.order || DEFAULT_SECTION_ORDER;
                const filtered = saved.filter((id: string) => ALL_SECTIONS[id]);
                DEFAULT_SECTION_ORDER.forEach(id => { if (!filtered.includes(id)) filtered.push(id); });
                return filtered;
              };
              const sectionOrder = computeOrder();

              const addCustomSection = async (type: string) => {
                const id = `${type}_${Date.now()}`;
                const defaults: Record<string, any> = {
                  custom_hits: { type: "custom_hits", title: "Хиты продаж", subtitle: "Лучшие товары", count: "8", mode: "manual", pinnedProductIds: [], visible: true },
                  custom_promo_banner: { type: "custom_promo_banner", title: "НОВАЯ КОЛЛЕКЦИЯ", subtitle: "Описание акции", buttonText: "Смотреть", buttonLink: "/products", bgImage: "", bgColor: "black", textColor: "light", size: "medium", rounded: false, effect: "gradient-overlay", visible: true },
                  custom_text: { type: "custom_text", title: "Заголовок", text: "", image: "", visible: true },
                };
                const settings = defaults[type] || defaults.custom_hits;
                try {
                  await adminFetch(`/api/admin/page-settings/home/${id}`, apiKey, {
                    method: "POST",
                    body: JSON.stringify(settings),
                  });
                  const newOrder = [...sectionOrder, id];
                  setHomeSectionOrder(newOrder);
                  await adminFetch(`/api/admin/page-settings/home/sectionOrder`, apiKey, {
                    method: "POST",
                    body: JSON.stringify({ order: newOrder }),
                  });
                  await pageSettingsQuery.refetch();
                  setSelectedSection(id);
                  setSectionSettings(settings);
                  setAddSectionDialog(false);
                } catch (e) {
                  console.error("Failed to add custom section", e);
                }
              };

              const deleteCustomSection = async (sectionId: string) => {
                if (!confirm("Удалить эту секцию? Это действие нельзя отменить.")) return;
                const newOrder = sectionOrder.filter(id => id !== sectionId);
                setHomeSectionOrder(newOrder);
                try {
                  await adminFetch(`/api/admin/page-settings/home/sectionOrder`, apiKey, {
                    method: "POST",
                    body: JSON.stringify({ order: newOrder }),
                  });
                  await adminFetch(`/api/admin/page-settings/home/${sectionId}`, apiKey, { method: "DELETE" });
                  if (selectedSection === sectionId) setSelectedSection(null);
                  await pageSettingsQuery.refetch();
                } catch (e) {
                  console.error("Failed to delete custom section", e);
                  setHomeSectionOrder(null);
                }
              };
              
              const moveSectionOrder = async (fromIndex: number, toIndex: number) => {
                const newOrder = [...sectionOrder];
                const [moved] = newOrder.splice(fromIndex, 1);
                newOrder.splice(toIndex, 0, moved);
                setHomeSectionOrder(newOrder);
                try {
                  await adminFetch(`/api/admin/page-settings/home/sectionOrder`, apiKey, {
                    method: "POST",
                    body: JSON.stringify({ order: newOrder }),
                  });
                  pageSettingsQuery.refetch();
                } catch (e) {
                  console.error("Failed to save section order", e);
                  setHomeSectionOrder(null);
                }
              };
              
              return (
              <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-1 space-y-2">
                  <h3 className="font-medium text-sm text-muted-foreground mb-3">Секции страницы <span className="text-xs">(↑↓ для порядка)</span></h3>
                  {sectionOrder.map((sectionId: string, idx: number) => {
                    const section = ALL_SECTIONS[sectionId];
                    if (!section) return null;
                    const SectionIcon = section.icon;
                    return (
                    <Card 
                      key={sectionId}
                      className={`cursor-pointer transition-colors hover-elevate ${selectedSection === sectionId ? 'border-primary bg-primary/5' : ''}`}
                      onClick={() => {
                        setSelectedSection(sectionId);
                        const defaults: Record<string, any> = {
                          hero: { heroImage: "", heroVideo: "", bgType: "image", tagline1: "МЫ ДЕЛАЕМ ТО, ЧТО НОСИМ САМИ.", tagline2: "РОССИЙСКИЙ БРЕНД ОДЕЖДЫ И АКСЕССУАРОВ.", buttonText: "Смотреть каталог", buttonLink: "/products", heroOpacity: "0.6", typingEffect: true, visible: true },
                          categories: { title: "Категории", items: [
                            { name: "Одежда", slug: "clothing", image: "", span: "1" },
                            { name: "Носки", slug: "socks", image: "", span: "1" },
                            { name: "Аксессуары", slug: "accessories", image: "", span: "1" },
                            { name: "Мерч", slug: "merch", image: "", span: "1" },
                          ], visible: true },
                          popular: { title: "Популярное", subtitle: "Хиты продаж", count: "8", linkText: "Все товары", linkUrl: "/products", visible: true },
                          featuredDrop: { productId: null, title: "", subtitle: "", ctaText: "", terminalLabel: "", visible: true },
                          benefits: { benefit0Title: "Доставка по всей РФ", benefit0Desc: "Отправляем в любой город", benefit1Title: "Сделано в России", benefit1Desc: "Собственное производство", benefit2Title: "Уникальные принты", benefit2Desc: "Авторский дизайн", visible: true },
                          philosophy: { title: "Больше чем одежда", text: "Базируясь в Туле — городе мастеров, пряников и самоваров — мы создаем вещи для повседневной жизни. На нашем счету более 200 моделей носков: от ироничных мемных дизайнов до оригинальных ярких пар. Мы объединяем традиции качества и современный стиль в каждой детали нашего ассортимента.", linkText: "Узнать о нас", linkUrl: "/about", desktopMediaType: "video", videoUrl: "", desktopImage: "", mobileMediaType: "image", mobileImage: "", mobileVideo: "", visible: true },
                          blog: { title: "Культура и стиль", subtitle: "BMG Журнал", items: [
                            { title: "SS'26: Новая эстетика уличной моды", date: "15 января 2026", category: "Коллекции", excerpt: "Исследуем грани между российской уличной модой и современным искусством в новом дропе.", image: "/attached_assets/generated_images/blog_post_image_for_new_collection_drop.webp" },
                            { title: "Лукбук: Urban Vibes в ритме города", date: "10 января 2026", category: "Лукбук", excerpt: "Как сочетать комфорт и стиль в динамичной городской среде. Наш взгляд на повседневность.", image: "/attached_assets/generated_images/blog_post_image_for_urban_vibes_lookbook.webp" },
                            { title: "Коллаб: BMG x Tula Artists", date: "5 января 2026", category: "Коллаборации", excerpt: "Лимитированная серия, созданная совместно с локальными художниками Тулы.", image: "/attached_assets/generated_images/blog_post_image_for_artist_collaboration.webp" },
                          ], visible: true },
                          promo_banner: { visible: true, title: "НОВАЯ КОЛЛЕКЦИЯ SS'26", subtitle: "Российский бренд одежды для тех, кто ценит стиль и качество", buttonText: "Смотреть", buttonLink: "/products", bgImage: "", bgColor: "black", textColor: "light", size: "medium", rounded: false, effect: "gradient-overlay", position: "after_categories" },
                          newsletter: { title: "Подпишитесь на рассылку", subtitle: "Получайте первыми информацию о новых дропах и эксклюзивных акциях.", buttonText: "Подписаться", successText: "Спасибо за подписку!", visible: true },
                          marquee: { text: "Новая коллекция уже в продаже • Бесплатная доставка при заказе от 5000₽ •", visible: true },
                          reels: { title: "Обзоры", items: [], visible: true },
                        };
                        const existing = pageSettingsQuery.data?.[sectionId] || {};
                        const merged = { ...(defaults[sectionId] || {}), ...existing };
                        setSectionSettings(merged);
                      }}
                    >
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); if (idx > 0) moveSectionOrder(idx, idx - 1); }}
                            disabled={idx === 0}
                            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                            data-testid={`button-section-up-${sectionId}`}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); if (idx < sectionOrder.length - 1) moveSectionOrder(idx, idx + 1); }}
                            disabled={idx === sectionOrder.length - 1}
                            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                            data-testid={`button-section-down-${sectionId}`}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <SectionIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate">{section.name}</span>
                        <div className="ml-auto flex items-center gap-1 shrink-0">
                          {sectionId.startsWith("custom_") ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteCustomSection(sectionId); }}
                              className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                              title="Удалить секцию"
                              data-testid={`button-section-delete-${sectionId}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            pageSettingsQuery.data?.[sectionId] && (
                              <Badge variant="secondary" className="text-xs">настроено</Badge>
                            )
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    );
                  })}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 border-dashed"
                    onClick={() => setAddSectionDialog(true)}
                    data-testid="button-add-custom-section"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Добавить секцию
                  </Button>
                </div>

                {/* Section editor */}
                <div className="lg:col-span-2">
                  {!selectedSection ? (
                    <Card>
                      <CardContent className="p-8 text-center text-muted-foreground">
                        <Layout className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>Выберите секцию слева для редактирования</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Настройки секции: {selectedSection === "hero" ? "Hero" : 
                            selectedSection === "categories" ? "Категории" :
                            selectedSection === "popular" ? "Популярное" :
                            selectedSection === "featuredDrop" ? "Капсула времени (Pre-drop)" :
                            selectedSection === "benefits" ? "Преимущества" :
                            selectedSection === "philosophy" ? "Философия" :
                            selectedSection === "blog" ? "Блог" :
                            selectedSection === "promo_banner" ? "Промо-баннер" :
                            selectedSection === "newsletter" ? "Подписка" :
                            selectedSection === "marquee" ? "Бегущая строка" :
                            selectedSection === "reels" ? "Обзоры (Видео-рилсы)" :
                            (selectedSection?.startsWith("custom_") ? (sectionSettings.title || ALL_SECTIONS[selectedSection!]?.name || selectedSection) : selectedSection)}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Hero section settings */}
                        {selectedSection === "hero" && (() => {
                          const emptySlide = { heroImage: "", heroImageMobile: "", heroImageAlt: "", heroVideo: "", bgType: "image", tagline1: "", tagline2: "", buttonText: "", buttonLink: "", heroOpacity: "0.6" };
                          const rawSlides: any[] = sectionSettings.slides || [
                            { heroImage: sectionSettings.heroImage || "", heroImageMobile: sectionSettings.heroImageMobile || "", heroImageAlt: sectionSettings.heroImageAlt || "", heroVideo: sectionSettings.heroVideo || "", bgType: sectionSettings.bgType || "image", tagline1: sectionSettings.tagline1 || "", tagline2: sectionSettings.tagline2 || "", buttonText: sectionSettings.buttonText || "", buttonLink: sectionSettings.buttonLink || "", heroOpacity: sectionSettings.heroOpacity || "0.6" },
                          ];
                          // Всегда нормализуем до 4 слотов — чтобы legacy-данные с 3 слайдами корректно расширялись
                          const heroSlides: any[] = [...rawSlides];
                          while (heroSlides.length < 4) heroSlides.push({ ...emptySlide });
                          const safeIndex = Math.max(0, Math.min(heroSlideIndex, heroSlides.length - 1));
                          const currentSlide = heroSlides[safeIndex] || emptySlide;
                          const updateSlide = (updates: Record<string, any>) => {
                            const newSlides = heroSlides.map((s, i) => i === safeIndex ? { ...s, ...updates } : s);
                            setSectionSettings({ ...sectionSettings, slides: newSlides });
                          };
                          const moveSlide = (from: number, to: number) => {
                            const newSlides = [...heroSlides];
                            [newSlides[from], newSlides[to]] = [newSlides[to], newSlides[from]];
                            setSectionSettings({ ...sectionSettings, slides: newSlides });
                            setHeroSlideIndex(to);
                          };
                          return (
                          <div className="space-y-4">
                            <div className="flex flex-col gap-2 p-3 bg-muted/40 rounded-lg">
                              <Label className="text-sm font-medium">Показывать секцию</Label>
                              <div className="flex items-center gap-2">
                                <input type="checkbox" id="hero-show-mobile" checked={sectionSettings.showOnMobile !== false} onChange={(e) => setSectionSettings({...sectionSettings, showOnMobile: e.target.checked})} className="w-4 h-4 accent-primary" />
                                <Label htmlFor="hero-show-mobile" className="text-sm font-normal cursor-pointer">На мобильных</Label>
                              </div>
                              <div className="flex items-center gap-2">
                                <input type="checkbox" id="hero-show-desktop" checked={sectionSettings.showOnDesktop !== false} onChange={(e) => setSectionSettings({...sectionSettings, showOnDesktop: e.target.checked})} className="w-4 h-4 accent-primary" />
                                <Label htmlFor="hero-show-desktop" className="text-sm font-normal cursor-pointer">На десктопе</Label>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <Switch checked={sectionSettings.visible !== false} onCheckedChange={(checked) => setSectionSettings({...sectionSettings, visible: checked})} />
                                <Label className="text-sm">Секция активна</Label>
                              </div>
                            </div>

                            <div className="flex flex-col gap-2 p-3 bg-muted/40 rounded-lg">
                              <Label className="text-sm font-medium">Слайды баннера</Label>
                              <p className="text-xs text-muted-foreground">Слайды с заполненным изображением/видео будут показаны как слайдер. Один слайд — статичный баннер.</p>
                              <div className="flex gap-2">
                                {[0, 1, 2, 3].map((i) => {
                                  const s = heroSlides[i] || emptySlide;
                                  const isFilled = !!(s.heroImage || s.heroVideo);
                                  const isActive = safeIndex === i;
                                  return (
                                    <div key={i} className="flex-1 flex flex-col gap-1">
                                      <button
                                        onClick={() => setHeroSlideIndex(i)}
                                        className={`w-full py-2 px-2 rounded-md text-sm font-medium border transition-colors ${isActive ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted"}`}
                                      >
                                        Слайд {i + 1}
                                        {isFilled && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-500 inline-block align-middle" />}
                                      </button>
                                      {isActive && (
                                        <div className="flex gap-1">
                                          <button
                                            disabled={i === 0}
                                            onClick={() => moveSlide(i, i - 1)}
                                            className="flex-1 py-0.5 rounded text-xs border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                            title="Переместить влево"
                                          >←</button>
                                          <button
                                            disabled={i === heroSlides.length - 1}
                                            onClick={() => moveSlide(i, i + 1)}
                                            className="flex-1 py-0.5 rounded text-xs border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                            title="Переместить вправо"
                                          >→</button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            <div>
                              <Label className="text-sm font-medium">Тип фона — Слайд {safeIndex + 1}</Label>
                              <div className="flex gap-2 mt-1">
                                <Button size="sm" variant={currentSlide.bgType !== "video" ? "default" : "outline"} onClick={() => updateSlide({ bgType: "image" })}>Изображение</Button>
                                <Button size="sm" variant={currentSlide.bgType === "video" ? "default" : "outline"} onClick={() => updateSlide({ bgType: "video" })}>Видео</Button>
                              </div>
                            </div>

                            {currentSlide.bgType !== "video" ? (
                              <div className="space-y-4">
                                <div>
                                  <Label className="text-sm">Фоновое изображение (десктоп)</Label>
                                  <ImageUploadField value={currentSlide.heroImage || ""} onChange={(url) => updateSlide({ heroImage: url })} apiKey={apiKey} placeholder="URL или перетащите изображение" hint="2560×1440 px, горизонтальное (landscape), WebP/JPG" />
                                  <p className="text-xs text-muted-foreground mt-1">Горизонтальное фото — для компьютера и планшета</p>
                                </div>
                                <div>
                                  <Label className="text-sm">Фоновое изображение (мобильный)</Label>
                                  <ImageUploadField value={currentSlide.heroImageMobile || ""} onChange={(url) => updateSlide({ heroImageMobile: url })} apiKey={apiKey} placeholder="URL или перетащите изображение" hint="1080×1920 px, вертикальное (portrait), WebP/JPG" />
                                  <p className="text-xs text-muted-foreground mt-1">Вертикальное фото — только для телефонов. Если не загружено — используется десктопное</p>
                                </div>
                                <div>
                                  <Label className="text-sm">Alt-текст изображения (для SEO и скринридеров)</Label>
                                  <Input value={currentSlide.heroImageAlt || ""} onChange={(e) => updateSlide({ heroImageAlt: e.target.value })} placeholder="Например: Модель в свитшоте BMGBRAND на фоне города" />
                                  <p className="text-xs text-muted-foreground mt-1">Описывает, что на фото. Если пусто — используется общее описание бренда</p>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <Label className="text-sm">Фоновое видео</Label>
                                <VideoUploadField value={currentSlide.heroVideo || ""} onChange={(url) => updateSlide({ heroVideo: url })} apiKey={apiKey} placeholder="URL или перетащите видео (MP4, WebM)" />
                                <p className="text-xs text-muted-foreground mt-1">Видео будет проигрываться в цикле без звука</p>
                              </div>
                            )}

                            <div>
                              <Label className="text-sm">Прозрачность фона (0-1)</Label>
                              <Input type="number" min="0" max="1" step="0.1" value={currentSlide.heroOpacity ?? "0.6"} onChange={(e) => updateSlide({ heroOpacity: e.target.value })} />
                            </div>
                            <div>
                              <Label className="text-sm">Текст слогана (строка 1)</Label>
                              <Input value={currentSlide.tagline1 || ""} onChange={(e) => updateSlide({ tagline1: e.target.value })} placeholder="МЫ ДЕЛАЕМ ТО, ЧТО НОСИМ САМИ." />
                            </div>
                            <div>
                              <Label className="text-sm">Текст слогана (строка 2)</Label>
                              <Input value={currentSlide.tagline2 || ""} onChange={(e) => updateSlide({ tagline2: e.target.value })} placeholder="РОССИЙСКИЙ БРЕНД ОДЕЖДЫ И АКСЕССУАРОВ." />
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch checked={sectionSettings.typingEffect !== false} onCheckedChange={(checked) => setSectionSettings({...sectionSettings, typingEffect: checked})} />
                              <Label className="text-sm">Эффект печатной машинки для слогана</Label>
                            </div>
                            <div>
                              <Label className="text-sm">Текст кнопки</Label>
                              <Input value={currentSlide.buttonText || ""} onChange={(e) => updateSlide({ buttonText: e.target.value })} placeholder="Смотреть каталог" />
                            </div>
                            <div>
                              <Label className="text-sm">Ссылка кнопки</Label>
                              <Input value={currentSlide.buttonLink || ""} onChange={(e) => updateSlide({ buttonLink: e.target.value })} placeholder="/products" />
                            </div>
                          </div>
                          );
                        })()}

                        {/* Benefits section settings */}
                        {selectedSection === "benefits" && (
                          <div className="space-y-4">
                            {[0, 1, 2].map((index) => (
                              <div key={index} className="p-3 border rounded-md space-y-2">
                                <Label className="text-sm font-medium">Преимущество {index + 1}</Label>
                                <Input
                                  value={sectionSettings[`benefit${index}Title`] || ""}
                                  onChange={(e) => setSectionSettings({...sectionSettings, [`benefit${index}Title`]: e.target.value})}
                                  placeholder="Заголовок"
                                />
                                <Input
                                  value={sectionSettings[`benefit${index}Desc`] || ""}
                                  onChange={(e) => setSectionSettings({...sectionSettings, [`benefit${index}Desc`]: e.target.value})}
                                  placeholder="Описание"
                                />
                              </div>
                            ))}
                            <div>
                              <Label className="text-sm">Цвет фона секции</Label>
                              <Select
                                value={sectionSettings.bgColor || "default"}
                                onValueChange={(v) => setSectionSettings({...sectionSettings, bgColor: v})}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="default">По умолчанию</SelectItem>
                                  <SelectItem value="muted">Серый (muted)</SelectItem>
                                  <SelectItem value="card">Карточка (card)</SelectItem>
                                  <SelectItem value="primary">Акцент (primary)</SelectItem>
                                  <SelectItem value="dark">Темный</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sectionSettings.visible !== false}
                                onCheckedChange={(checked) => setSectionSettings({...sectionSettings, visible: checked})}
                              />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                          </div>
                        )}

                        {/* Philosophy section settings */}
                        {selectedSection === "philosophy" && (
                          <div className="space-y-4">
                            <div>
                              <Label className="text-sm">Заголовок</Label>
                              <Input
                                value={sectionSettings.title || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, title: e.target.value})}
                                placeholder="Больше чем одежда"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Текст</Label>
                              <Textarea
                                className="resize-none"
                                rows={4}
                                value={sectionSettings.text || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, text: e.target.value})}
                                placeholder="Текст философии бренда..."
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Текст ссылки</Label>
                              <Input
                                value={sectionSettings.linkText || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, linkText: e.target.value})}
                                placeholder="Узнать о нас"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">URL ссылки</Label>
                              <Input
                                value={sectionSettings.linkUrl || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, linkUrl: e.target.value})}
                                placeholder="/about"
                              />
                            </div>

                            <div className="p-3 border rounded-md space-y-3">
                              <Label className="text-sm font-medium">Десктоп: медиа</Label>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant={sectionSettings.desktopMediaType !== "image" ? "default" : "outline"}
                                  onClick={() => setSectionSettings({...sectionSettings, desktopMediaType: "video"})}
                                >
                                  Видео
                                </Button>
                                <Button
                                  size="sm"
                                  variant={sectionSettings.desktopMediaType === "image" ? "default" : "outline"}
                                  onClick={() => setSectionSettings({...sectionSettings, desktopMediaType: "image"})}
                                >
                                  Изображение
                                </Button>
                              </div>
                              {sectionSettings.desktopMediaType === "image" ? (
                                <div>
                                  <Label className="text-xs text-muted-foreground">Изображение для десктопа</Label>
                                  <ImageUploadField
                                    value={sectionSettings.desktopImage || ""}
                                    onChange={(url) => setSectionSettings({...sectionSettings, desktopImage: url})}
                                    apiKey={apiKey}
                                    placeholder="URL или перетащите изображение"
                                    hint="1000×1000 px, 1:1, JPG/WebP"
                                  />
                                </div>
                              ) : (
                                <div>
                                  <Label className="text-xs text-muted-foreground">Видео для десктопа</Label>
                                  <VideoUploadField
                                    value={sectionSettings.videoUrl || ""}
                                    onChange={(url) => setSectionSettings({...sectionSettings, videoUrl: url})}
                                    apiKey={apiKey}
                                    placeholder="URL или перетащите видео (MP4, WebM)"
                                  />
                                </div>
                              )}
                            </div>

                            <div className="p-3 border rounded-md space-y-3">
                              <Label className="text-sm font-medium">Мобильный: медиа</Label>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant={sectionSettings.mobileMediaType !== "video" ? "default" : "outline"}
                                  onClick={() => setSectionSettings({...sectionSettings, mobileMediaType: "image"})}
                                >
                                  Изображение
                                </Button>
                                <Button
                                  size="sm"
                                  variant={sectionSettings.mobileMediaType === "video" ? "default" : "outline"}
                                  onClick={() => setSectionSettings({...sectionSettings, mobileMediaType: "video"})}
                                >
                                  Видео
                                </Button>
                              </div>
                              {sectionSettings.mobileMediaType === "video" ? (
                                <div>
                                  <Label className="text-xs text-muted-foreground">Видео для мобильных</Label>
                                  <VideoUploadField
                                    value={sectionSettings.mobileVideo || ""}
                                    onChange={(url) => setSectionSettings({...sectionSettings, mobileVideo: url})}
                                    apiKey={apiKey}
                                    placeholder="URL или перетащите видео (MP4, WebM)"
                                  />
                                </div>
                              ) : (
                                <div>
                                  <Label className="text-xs text-muted-foreground">Изображение для мобильных</Label>
                                  <ImageUploadField
                                    value={sectionSettings.mobileImage || ""}
                                    onChange={(url) => setSectionSettings({...sectionSettings, mobileImage: url})}
                                    apiKey={apiKey}
                                    placeholder="URL или перетащите изображение"
                                    hint="600×800 px, 3:4, JPG/WebP"
                                  />
                                </div>
                              )}
                            </div>

                            <div>
                              <Label className="text-sm">Цвет фона секции</Label>
                              <Select
                                value={sectionSettings.bgColor || "default"}
                                onValueChange={(v) => setSectionSettings({...sectionSettings, bgColor: v})}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="default">По умолчанию</SelectItem>
                                  <SelectItem value="muted">Серый (muted)</SelectItem>
                                  <SelectItem value="card">Карточка (card)</SelectItem>
                                  <SelectItem value="primary">Акцент (primary)</SelectItem>
                                  <SelectItem value="dark">Темный</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sectionSettings.visible !== false}
                                onCheckedChange={(checked) => setSectionSettings({...sectionSettings, visible: checked})}
                              />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                          </div>
                        )}

                        {/* Newsletter section settings */}
                        {selectedSection === "newsletter" && (
                          <div className="space-y-4">
                            <div>
                              <Label className="text-sm">Заголовок</Label>
                              <Input
                                value={sectionSettings.title || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, title: e.target.value})}
                                placeholder="Подпишитесь на рассылку"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Подзаголовок</Label>
                              <Input
                                value={sectionSettings.subtitle || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, subtitle: e.target.value})}
                                placeholder="Получайте первыми информацию о новых дропах..."
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Текст кнопки</Label>
                              <Input
                                value={sectionSettings.buttonText || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, buttonText: e.target.value})}
                                placeholder="Подписаться"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Текст после подписки</Label>
                              <Input
                                value={sectionSettings.successText || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, successText: e.target.value})}
                                placeholder="Спасибо за подписку!"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Цвет фона секции</Label>
                              <Select
                                value={sectionSettings.bgColor || "default"}
                                onValueChange={(v) => setSectionSettings({...sectionSettings, bgColor: v})}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="default">По умолчанию</SelectItem>
                                  <SelectItem value="muted">Серый (muted)</SelectItem>
                                  <SelectItem value="card">Карточка (card)</SelectItem>
                                  <SelectItem value="primary">Акцент (primary)</SelectItem>
                                  <SelectItem value="dark">Темный</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sectionSettings.visible !== false}
                                onCheckedChange={(checked) => setSectionSettings({...sectionSettings, visible: checked})}
                              />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                          </div>
                        )}

                        {/* Blog section settings */}
                        {selectedSection === "blog" && (
                          <div className="space-y-4">
                            <div>
                              <Label className="text-sm">Заголовок секции</Label>
                              <Input
                                value={sectionSettings.title || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, title: e.target.value})}
                                placeholder="Культура и стиль"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Подзаголовок</Label>
                              <Input
                                value={sectionSettings.subtitle || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, subtitle: e.target.value})}
                                placeholder="BMG Журнал"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Вариант раскладки</Label>
                              <Select
                                value={sectionSettings.layout || "grid"}
                                onValueChange={(v) => setSectionSettings({...sectionSettings, layout: v})}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="grid">Сетка (равномерная)</SelectItem>
                                  <SelectItem value="bento">Бенто (акцент на первом)</SelectItem>
                                  <SelectItem value="carousel">Карусель (горизонтальная)</SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-muted-foreground mt-1">
                                {sectionSettings.layout === "bento" ? "Первый пост крупно, остальные компактно сбоку" : 
                                 sectionSettings.layout === "carousel" ? "Горизонтальная прокрутка карточек блога" :
                                 "Три карточки в ряд"}
                              </p>
                            </div>
                            <div className="space-y-3">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <Label className="text-sm font-medium">Посты на главной</Label>
                                <Button size="sm" variant="outline" onClick={() => {
                                  const items = sectionSettings.items || [];
                                  setSectionSettings({...sectionSettings, items: [...items, { title: "", date: "", category: "", excerpt: "", image: "" }]});
                                }}>
                                  <Plus className="w-4 h-4 mr-1" /> Добавить
                                </Button>
                              </div>
                              {(sectionSettings.items || []).map((item: any, idx: number) => (
                                <div key={idx} className="p-3 border rounded-md space-y-2">
                                  <div className="flex items-center justify-between flex-wrap gap-2">
                                    <Label className="text-sm font-medium">{item.title || `Пост ${idx + 1}`}</Label>
                                    <Button size="sm" variant="destructive" onClick={() => {
                                      const items = [...(sectionSettings.items || [])];
                                      items.splice(idx, 1);
                                      setSectionSettings({...sectionSettings, items});
                                    }}>
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                  <Input
                                    value={item.title || ""}
                                    onChange={(e) => {
                                      const items = [...(sectionSettings.items || [])];
                                      items[idx] = {...items[idx], title: e.target.value};
                                      setSectionSettings({...sectionSettings, items});
                                    }}
                                    placeholder="Заголовок поста"
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <Input
                                      value={item.date || ""}
                                      onChange={(e) => {
                                        const items = [...(sectionSettings.items || [])];
                                        items[idx] = {...items[idx], date: e.target.value};
                                        setSectionSettings({...sectionSettings, items});
                                      }}
                                      placeholder="Дата (15 января 2026)"
                                    />
                                    <Input
                                      value={item.category || ""}
                                      onChange={(e) => {
                                        const items = [...(sectionSettings.items || [])];
                                        items[idx] = {...items[idx], category: e.target.value};
                                        setSectionSettings({...sectionSettings, items});
                                      }}
                                      placeholder="Категория"
                                    />
                                  </div>
                                  <Textarea
                                    className="resize-none"
                                    rows={2}
                                    value={item.excerpt || ""}
                                    onChange={(e) => {
                                      const items = [...(sectionSettings.items || [])];
                                      items[idx] = {...items[idx], excerpt: e.target.value};
                                      setSectionSettings({...sectionSettings, items});
                                    }}
                                    placeholder="Краткое описание"
                                  />
                                  <ImageUploadField
                                    value={item.image || ""}
                                    onChange={(url) => {
                                      const items = [...(sectionSettings.items || [])];
                                      items[idx] = {...items[idx], image: url};
                                      setSectionSettings({...sectionSettings, items});
                                    }}
                                    apiKey={apiKey}
                                    placeholder="URL или перетащите изображение"
                                    hint="600×800 px, 3:4, JPG/WebP"
                                  />
                                </div>
                              ))}
                            </div>
                            <div>
                              <Label className="text-sm">Цвет фона секции</Label>
                              <Select
                                value={sectionSettings.bgColor || "default"}
                                onValueChange={(v) => setSectionSettings({...sectionSettings, bgColor: v})}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="default">По умолчанию</SelectItem>
                                  <SelectItem value="muted">Серый (muted)</SelectItem>
                                  <SelectItem value="card">Карточка (card)</SelectItem>
                                  <SelectItem value="primary">Акцент (primary)</SelectItem>
                                  <SelectItem value="dark">Темный</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sectionSettings.visible !== false}
                                onCheckedChange={(checked) => setSectionSettings({...sectionSettings, visible: checked})}
                              />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                          </div>
                        )}

                        {/* Marquee section settings */}
                        {selectedSection === "marquee" && (
                          <div className="space-y-4">
                            <div>
                              <Label className="text-sm">Текст бегущей строки</Label>
                              <Input
                                value={sectionSettings.text || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, text: e.target.value})}
                                placeholder="Новая коллекция уже в продаже • Бесплатная доставка при заказе от 5000₽ •"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sectionSettings.visible !== false}
                                onCheckedChange={(checked) => setSectionSettings({...sectionSettings, visible: checked})}
                              />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                          </div>
                        )}

                        {/* Promo Banner section settings */}
                        {selectedSection === "promo_banner" && (
                          <div className="space-y-4">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sectionSettings.visible !== false}
                                onCheckedChange={(checked) => setSectionSettings({...sectionSettings, visible: checked})}
                                data-testid="switch-promo-visible"
                              />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                            <div>
                              <Label className="text-sm">Заголовок</Label>
                              <Input
                                value={sectionSettings.title || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, title: e.target.value})}
                                placeholder="НОВАЯ КОЛЛЕКЦИЯ SS'26"
                                data-testid="input-promo-title"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Подзаголовок</Label>
                              <Textarea
                                value={sectionSettings.subtitle || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, subtitle: e.target.value})}
                                placeholder="Описание промо-акции"
                                data-testid="input-promo-subtitle"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label className="text-sm">Текст кнопки</Label>
                                <Input
                                  value={sectionSettings.buttonText || ""}
                                  onChange={(e) => setSectionSettings({...sectionSettings, buttonText: e.target.value})}
                                  placeholder="Смотреть"
                                  data-testid="input-promo-button-text"
                                />
                              </div>
                              <div>
                                <Label className="text-sm">Ссылка кнопки</Label>
                                <Input
                                  value={sectionSettings.buttonLink || ""}
                                  onChange={(e) => setSectionSettings({...sectionSettings, buttonLink: e.target.value})}
                                  placeholder="/products"
                                  data-testid="input-promo-button-link"
                                />
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm">Фоновое изображение</Label>
                              <ImageUploadField
                                value={sectionSettings.bgImage || ""}
                                onChange={(url) => setSectionSettings({...sectionSettings, bgImage: url})}
                                apiKey="promo_banner_bg"
                                placeholder="Загрузите изображение для фона баннера"
                                hint="1920×600 px, горизонтальное, JPG/WebP"
                              />
                              <p className="text-xs text-muted-foreground mt-1">Оставьте пустым для использования цвета фона</p>
                            </div>
                            <div>
                              <Label className="text-sm">Цвет фона</Label>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {[
                                  { value: "black", label: "Чёрный" },
                                  { value: "white", label: "Белый" },
                                  { value: "red", label: "Красный" },
                                  { value: "gray", label: "Серый" },
                                  { value: "gradient", label: "Градиент" },
                                ].map((opt) => (
                                  <Button
                                    key={opt.value}
                                    size="sm"
                                    variant={sectionSettings.bgColor === opt.value ? "default" : "outline"}
                                    onClick={() => setSectionSettings({...sectionSettings, bgColor: opt.value})}
                                    data-testid={`button-promo-bg-${opt.value}`}
                                  >
                                    {opt.label}
                                  </Button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm">Цвет текста</Label>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {[
                                  { value: "light", label: "Светлый" },
                                  { value: "dark", label: "Тёмный" },
                                ].map((opt) => (
                                  <Button
                                    key={opt.value}
                                    size="sm"
                                    variant={sectionSettings.textColor === opt.value ? "default" : "outline"}
                                    onClick={() => setSectionSettings({...sectionSettings, textColor: opt.value})}
                                    data-testid={`button-promo-text-${opt.value}`}
                                  >
                                    {opt.label}
                                  </Button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm">Размер</Label>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {[
                                  { value: "compact", label: "Компактный" },
                                  { value: "medium", label: "Средний" },
                                  { value: "large", label: "Большой" },
                                ].map((opt) => (
                                  <Button
                                    key={opt.value}
                                    size="sm"
                                    variant={sectionSettings.size === opt.value ? "default" : "outline"}
                                    onClick={() => setSectionSettings({...sectionSettings, size: opt.value})}
                                    data-testid={`button-promo-size-${opt.value}`}
                                  >
                                    {opt.label}
                                  </Button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sectionSettings.rounded === true}
                                onCheckedChange={(checked) => setSectionSettings({...sectionSettings, rounded: checked})}
                                data-testid="switch-promo-rounded"
                              />
                              <Label className="text-sm">Скруглённые углы</Label>
                            </div>
                            <div>
                              <Label className="text-sm">Эффект</Label>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {[
                                  { value: "none", label: "Нет" },
                                  { value: "gradient-overlay", label: "Градиент" },
                                  { value: "blur", label: "Размытие" },
                                  { value: "parallax", label: "Параллакс" },
                                  { value: "animate", label: "Анимация" },
                                ].map((opt) => (
                                  <Button
                                    key={opt.value}
                                    size="sm"
                                    variant={sectionSettings.effect === opt.value ? "default" : "outline"}
                                    onClick={() => setSectionSettings({...sectionSettings, effect: opt.value})}
                                    data-testid={`button-promo-effect-${opt.value}`}
                                  >
                                    {opt.label}
                                  </Button>
                                ))}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">Размытие и параллакс работают только с фоновым изображением</p>
                            </div>
                            <div>
                              <Label className="text-sm">Позиция на странице</Label>
                              <Select
                                value={sectionSettings.position || "after_categories"}
                                onValueChange={(val) => setSectionSettings({...sectionSettings, position: val})}
                              >
                                <SelectTrigger data-testid="select-promo-position">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="after_hero">После Hero</SelectItem>
                                  <SelectItem value="after_categories">После категорий</SelectItem>
                                  <SelectItem value="before_popular">Перед популярными</SelectItem>
                                  <SelectItem value="after_artists">После артистов</SelectItem>
                                  <SelectItem value="after_benefits">После преимуществ</SelectItem>
                                  <SelectItem value="after_philosophy">После философии</SelectItem>
                                  <SelectItem value="after_blog">После блога</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-sm mb-2 block">Предпросмотр</Label>
                              <div
                                className={`relative overflow-hidden p-8 text-center ${
                                  sectionSettings.rounded ? "rounded-2xl" : "rounded-md"
                                } ${
                                  sectionSettings.bgImage
                                    ? ""
                                    : sectionSettings.bgColor === "black" ? "bg-[#111111]"
                                    : sectionSettings.bgColor === "white" ? "bg-white border border-neutral-200"
                                    : sectionSettings.bgColor === "gray" ? "bg-neutral-700"
                                    : ""
                                }`}
                                style={sectionSettings.bgImage ? {
                                  backgroundImage: `url(${sectionSettings.bgImage})`,
                                  backgroundSize: "cover",
                                  backgroundPosition: "center",
                                } : (
                                  sectionSettings.bgColor === "red" ? { backgroundColor: "#E53935" }
                                  : sectionSettings.bgColor === "gradient" ? { background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a1a 100%)" }
                                  : {}
                                )}
                                data-testid="promo-preview"
                              >
                                {sectionSettings.bgImage && <div className="absolute inset-0 bg-black/50" />}
                                <div className="relative z-10">
                                  <h3 className={`text-lg font-bold ${
                                    sectionSettings.textColor === "dark" || (!sectionSettings.bgImage && sectionSettings.bgColor === "white") 
                                      ? "text-neutral-900" : "text-white"
                                  }`}>
                                    {sectionSettings.title || "Заголовок"}
                                  </h3>
                                  <p className={`text-sm mt-1 ${
                                    sectionSettings.textColor === "dark" || (!sectionSettings.bgImage && sectionSettings.bgColor === "white")
                                      ? "text-neutral-600" : "text-white/70"
                                  }`}>
                                    {sectionSettings.subtitle || "Подзаголовок"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Categories section settings */}
                        {selectedSection === "categories" && (
                          <div className="space-y-4">
                            <div>
                              <Label className="text-sm">Заголовок секции</Label>
                              <Input
                                value={sectionSettings.title || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, title: e.target.value})}
                                placeholder="Категории"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Вариант раскладки</Label>
                              <Select
                                value={sectionSettings.layout || "bento"}
                                onValueChange={(v) => setSectionSettings({...sectionSettings, layout: v})}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="grid">Сетка (равномерная)</SelectItem>
                                  <SelectItem value="bento">Бенто (ассиметричная)</SelectItem>
                                  <SelectItem value="carousel">Карусель (горизонтальная)</SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-muted-foreground mt-1">
                                {sectionSettings.layout === "grid" ? "Карточки в ровной сетке 2×4" : 
                                 sectionSettings.layout === "carousel" ? "Горизонтальная прокрутка карточек" :
                                 "Крупная + мелкие карточки в стиле бенто"}
                              </p>
                            </div>
                            <div className="space-y-3">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <Label className="text-sm font-medium">Категории на главной</Label>
                                <Button size="sm" variant="outline" onClick={() => {
                                  const items = sectionSettings.items || [];
                                  setSectionSettings({...sectionSettings, items: [...items, { name: "", slug: "", image: "", span: "1" }]});
                                }}>
                                  <Plus className="w-4 h-4 mr-1" /> Добавить
                                </Button>
                              </div>
                              {(sectionSettings.items || []).map((item: any, idx: number) => (
                                <div key={idx} className="p-3 border rounded-md space-y-2">
                                  <div className="flex items-center justify-between flex-wrap gap-2">
                                    <Label className="text-sm font-medium">Категория {idx + 1}</Label>
                                    <Button size="sm" variant="destructive" onClick={() => {
                                      const items = [...(sectionSettings.items || [])];
                                      items.splice(idx, 1);
                                      setSectionSettings({...sectionSettings, items});
                                    }}>
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                  <Input
                                    value={item.name || ""}
                                    onChange={(e) => {
                                      const items = [...(sectionSettings.items || [])];
                                      items[idx] = {...items[idx], name: e.target.value};
                                      setSectionSettings({...sectionSettings, items});
                                    }}
                                    placeholder="Название (например: Одежда)"
                                  />
                                  <Input
                                    value={item.slug || ""}
                                    onChange={(e) => {
                                      const items = [...(sectionSettings.items || [])];
                                      items[idx] = {...items[idx], slug: e.target.value};
                                      setSectionSettings({...sectionSettings, items});
                                    }}
                                    placeholder="Slug (например: clothing)"
                                  />
                                  <ImageUploadField
                                    value={item.image || ""}
                                    onChange={(url) => {
                                      const items = [...(sectionSettings.items || [])];
                                      items[idx] = {...items[idx], image: url};
                                      setSectionSettings({...sectionSettings, items});
                                    }}
                                    apiKey={apiKey}
                                    placeholder="URL или перетащите изображение"
                                    hint="800×800 px (1:1), для 2 колонок — 1200×900 px (4:3), JPG/WebP"
                                  />
                                  <Select
                                    value={item.span || "1"}
                                    onValueChange={(v) => {
                                      const items = [...(sectionSettings.items || [])];
                                      items[idx] = {...items[idx], span: v};
                                      setSectionSettings({...sectionSettings, items});
                                    }}
                                  >
                                    <SelectTrigger><SelectValue placeholder="Ширина" /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="1">1 колонка</SelectItem>
                                      <SelectItem value="2">2 колонки (широкая)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              ))}
                            </div>
                            <div>
                              <Label className="text-sm">Цвет фона секции</Label>
                              <Select
                                value={sectionSettings.bgColor || "default"}
                                onValueChange={(v) => setSectionSettings({...sectionSettings, bgColor: v})}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="default">По умолчанию</SelectItem>
                                  <SelectItem value="muted">Серый (muted)</SelectItem>
                                  <SelectItem value="card">Карточка (card)</SelectItem>
                                  <SelectItem value="primary">Акцент (primary)</SelectItem>
                                  <SelectItem value="dark">Темный</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sectionSettings.visible !== false}
                                onCheckedChange={(checked) => setSectionSettings({...sectionSettings, visible: checked})}
                              />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                          </div>
                        )}

                        {/* Popular section settings */}
                        {selectedSection === "popular" && (
                          <div className="space-y-4">
                            <div>
                              <Label className="text-sm">Заголовок</Label>
                              <Input
                                value={sectionSettings.title || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, title: e.target.value})}
                                placeholder="Популярное"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Подзаголовок</Label>
                              <Input
                                value={sectionSettings.subtitle || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, subtitle: e.target.value})}
                                placeholder="Хиты продаж"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Текст ссылки</Label>
                              <Input
                                value={sectionSettings.linkText || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, linkText: e.target.value})}
                                placeholder="Все товары"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">URL ссылки</Label>
                              <Input
                                value={sectionSettings.linkUrl || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, linkUrl: e.target.value})}
                                placeholder="/products"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Количество товаров</Label>
                              <Input
                                type="number"
                                min="1"
                                max="20"
                                value={sectionSettings.count || "8"}
                                onChange={(e) => setSectionSettings({...sectionSettings, count: e.target.value})}
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Цвет фона секции</Label>
                              <Select
                                value={sectionSettings.bgColor || "default"}
                                onValueChange={(v) => setSectionSettings({...sectionSettings, bgColor: v})}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="default">По умолчанию</SelectItem>
                                  <SelectItem value="muted">Серый (muted)</SelectItem>
                                  <SelectItem value="card">Карточка (card)</SelectItem>
                                  <SelectItem value="primary">Акцент (primary)</SelectItem>
                                  <SelectItem value="dark">Темный</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sectionSettings.visible !== false}
                                onCheckedChange={(checked) => setSectionSettings({...sectionSettings, visible: checked})}
                              />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                            <div className="space-y-3 border-t pt-4">
                              <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">Выбор товаров</Label>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">{sectionSettings.mode === "manual" ? "Вручную" : "Авто"}</span>
                                  <Switch
                                    checked={sectionSettings.mode === "manual"}
                                    onCheckedChange={(checked) => {
                                      setSectionSettings({...sectionSettings, mode: checked ? "manual" : "auto"});
                                      setPinnedSearchQuery("");
                                    }}
                                  />
                                </div>
                              </div>
                              {sectionSettings.mode !== "manual" ? (
                                <div className="space-y-2">
                                  <p className="text-xs text-muted-foreground">Автоматически — последние {sectionSettings.count || 8} добавленных товаров. Сейчас в секции:</p>
                                  <div className="space-y-1">
                                    {(data?.products || [])
                                      .filter((p: any) => !p.isHidden)
                                      .sort((a: any, b: any) => (b.id || 0) - (a.id || 0))
                                      .slice(0, parseInt(sectionSettings.count || "8"))
                                      .map((p: any, idx: number) => (
                                        <div key={p.id} className="flex items-center gap-2 p-2 bg-muted/30 rounded border" data-testid={`row-auto-product-${p.id}`}>
                                          <span className="text-xs text-muted-foreground w-4 text-center shrink-0">{idx + 1}</span>
                                          {p.images?.[0] && <img src={p.images[0]} className="w-7 h-7 object-cover rounded shrink-0" />}
                                          <div className="flex-1 min-w-0">
                                            <div className="truncate text-xs font-medium">{p.name}</div>
                                            <div className="text-xs text-muted-foreground">{p.sku || `ID: ${p.id}`}</div>
                                          </div>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="relative">
                                    <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                                    <Input
                                      className="pl-8 text-sm h-9"
                                      placeholder="Найти товар по названию или артикулу..."
                                      value={pinnedSearchQuery}
                                      onChange={(e) => setPinnedSearchQuery(e.target.value)}
                                      data-testid="input-pinned-product-search"
                                    />
                                  </div>
                                  {pinnedSearchQuery.trim().length >= 1 && (
                                    <div className="border rounded-md overflow-hidden max-h-48 overflow-y-auto bg-background">
                                      {(() => {
                                        const q = pinnedSearchQuery.toLowerCase();
                                        const pinnedIds: number[] = sectionSettings.pinnedProductIds || [];
                                        const results = (data?.products || []).filter((p: any) =>
                                          !p.isHidden &&
                                          !pinnedIds.includes(p.id) &&
                                          (p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q))
                                        ).slice(0, 8);
                                        if (results.length === 0) return <div className="px-3 py-2 text-xs text-muted-foreground">Ничего не найдено</div>;
                                        return results.map((p: any) => (
                                          <div
                                            key={p.id}
                                            className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer border-b last:border-0"
                                            onClick={() => {
                                              const ids: number[] = sectionSettings.pinnedProductIds || [];
                                              setSectionSettings({...sectionSettings, pinnedProductIds: [...ids, p.id]});
                                              setPinnedSearchQuery("");
                                            }}
                                            data-testid={`item-pinned-search-${p.id}`}
                                          >
                                            {p.images?.[0] && <img src={p.images[0]} className="w-8 h-8 object-cover rounded shrink-0" />}
                                            <div className="flex-1 min-w-0">
                                              <div className="truncate text-xs font-medium">{p.name}</div>
                                              <div className="text-xs text-muted-foreground">{p.sku || `ID: ${p.id}`}</div>
                                            </div>
                                            <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                          </div>
                                        ));
                                      })()}
                                    </div>
                                  )}
                                  <div className="space-y-1">
                                    {((sectionSettings.pinnedProductIds as number[]) || []).length === 0 ? (
                                      <p className="text-xs text-muted-foreground text-center py-3 border rounded-md border-dashed">Добавьте товары через поиск выше</p>
                                    ) : (
                                      ((sectionSettings.pinnedProductIds as number[]) || []).map((id, idx) => {
                                        const p = (data?.products || []).find((pr: any) => pr.id === id);
                                        return (
                                          <div
                                            key={id}
                                            draggable
                                            onDragStart={(e) => e.dataTransfer.setData("text/plain", String(idx))}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => {
                                              e.preventDefault();
                                              const fromIdx = parseInt(e.dataTransfer.getData("text/plain"));
                                              if (fromIdx === idx) return;
                                              const ids = [...((sectionSettings.pinnedProductIds as number[]) || [])];
                                              const [moved] = ids.splice(fromIdx, 1);
                                              ids.splice(idx, 0, moved);
                                              setSectionSettings({...sectionSettings, pinnedProductIds: ids});
                                            }}
                                            className="flex items-center gap-2 p-2 bg-muted/40 rounded border cursor-grab active:cursor-grabbing active:opacity-60 active:bg-muted"
                                            data-testid={`row-pinned-product-${id}`}
                                          >
                                            <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                            <span className="text-xs text-muted-foreground w-4 text-center shrink-0">{idx + 1}</span>
                                            {p?.images?.[0] && <img src={p.images[0]} className="w-7 h-7 object-cover rounded shrink-0" />}
                                            <div className="flex-1 min-w-0">
                                              <div className="truncate text-xs font-medium">{p?.name || `Товар #${id}`}</div>
                                              <div className="text-xs text-muted-foreground">{p?.sku || `ID: ${id}`}</div>
                                            </div>
                                            <button
                                              onClick={() => {
                                                const ids = ((sectionSettings.pinnedProductIds as number[]) || []).filter((_, i) => i !== idx);
                                                setSectionSettings({...sectionSettings, pinnedProductIds: ids});
                                              }}
                                              className="p-0.5 rounded text-muted-foreground hover:text-red-500 shrink-0"
                                              data-testid={`button-pinned-remove-${id}`}
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Featured Drop (Капсула времени) section settings */}
                        {selectedSection === "featuredDrop" && (() => {
                          const fdProducts = preorderProductsForSections || [];
                          const selectedFdProduct = fdProducts.find((p: any) => p.id === sectionSettings.productId);
                          return (
                          <div className="space-y-4">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sectionSettings.visible !== false}
                                onCheckedChange={(checked) => setSectionSettings({...sectionSettings, visible: checked})}
                                data-testid="switch-featured-drop-visible"
                              />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                            <div>
                              <Label className="text-sm">Товар из Pre-drop</Label>
                              <Select
                                value={sectionSettings.productId ? String(sectionSettings.productId) : "auto"}
                                onValueChange={(v) => setSectionSettings({...sectionSettings, productId: v === "auto" ? null : Number(v)})}
                              >
                                <SelectTrigger data-testid="select-featured-drop-product"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="auto">Автоматически (первый со статусом "Сбор заказов")</SelectItem>
                                  {fdProducts.map((p: any) => (
                                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {fdProducts.length === 0 && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Нет товаров с предзаказом. Отметьте товар как pre-drop на странице товара.
                                </p>
                              )}
                              {selectedFdProduct && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Статус: {selectedFdProduct.preorderStatus || "collecting"}
                                  {selectedFdProduct.preorderDeadline && ` · до ${new Date(selectedFdProduct.preorderDeadline).toLocaleDateString("ru-RU")}`}
                                </p>
                              )}
                            </div>
                            <div>
                              <Label className="text-sm">Заголовок (необязательно)</Label>
                              <Input
                                value={sectionSettings.title || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, title: e.target.value})}
                                placeholder={selectedFdProduct?.name || "Название товара по умолчанию"}
                                data-testid="input-featured-drop-title"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Подзаголовок (необязательно)</Label>
                              <Input
                                value={sectionSettings.subtitle || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, subtitle: e.target.value})}
                                placeholder="Из pre-drop"
                                data-testid="input-featured-drop-subtitle"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Текст кнопки (необязательно)</Label>
                              <Input
                                value={sectionSettings.ctaText || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, ctaText: e.target.value})}
                                placeholder="Забронировать место в партии"
                                data-testid="input-featured-drop-cta"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Строка терминала (необязательно)</Label>
                              <Input
                                value={sectionSettings.terminalLabel || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, terminalLabel: e.target.value})}
                                placeholder="booomerangs://терминал_предзаказа"
                                data-testid="input-featured-drop-terminal-label"
                              />
                              <p className="text-xs text-muted-foreground mt-1">
                                Строка в «шапке» терминала на карточке дропа
                              </p>
                            </div>
                          </div>
                          );
                        })()}

                        {/* Reels section editor */}
                        {selectedSection === "reels" && (
                          <div className="space-y-4">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sectionSettings.visible !== false}
                                onCheckedChange={(checked) => setSectionSettings({...sectionSettings, visible: checked})}
                              />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                            <div>
                              <Label className="text-sm">Название секции</Label>
                              <Input
                                value={sectionSettings.title || ""}
                                onChange={(e) => setSectionSettings({...sectionSettings, title: e.target.value})}
                                placeholder="Обзоры"
                              />
                            </div>
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">Видео ({(sectionSettings.items || []).length})</Label>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const items = [...(sectionSettings.items || [])];
                                    items.push({ id: `reel_${Date.now()}`, videoUrl: "", label: "", link: "" });
                                    setSectionSettings({...sectionSettings, items});
                                  }}
                                >
                                  <Plus className="w-3.5 h-3.5 mr-1" /> Добавить
                                </Button>
                              </div>
                              {(sectionSettings.items || []).length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-4">Нет видео. Нажмите «Добавить».</p>
                              )}
                              {(sectionSettings.items || []).map((item: any, idx: number) => (
                                <div key={item.id || idx} className="p-3 border rounded-md space-y-2">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-medium text-muted-foreground">Ролик {idx + 1}</span>
                                    <button
                                      className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                                      onClick={() => {
                                        const items = (sectionSettings.items || []).filter((_: any, i: number) => i !== idx);
                                        setSectionSettings({...sectionSettings, items});
                                      }}
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Обложка (превью)</Label>
                                    <ImageUploadField
                                      value={item.thumbnailUrl || ""}
                                      onChange={(url) => {
                                        const items = [...(sectionSettings.items || [])];
                                        items[idx] = { ...items[idx], thumbnailUrl: url };
                                        setSectionSettings({...sectionSettings, items});
                                      }}
                                      apiKey={apiKey}
                                      placeholder="Картинка-обложка ролика"
                                      hint="Вертикальное фото товара, ~68×108"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Видео</Label>
                                    <VideoUploadField
                                      value={item.videoUrl || ""}
                                      onChange={(url) => {
                                        const items = [...(sectionSettings.items || [])];
                                        items[idx] = { ...items[idx], videoUrl: url };
                                        setSectionSettings({...sectionSettings, items});
                                      }}
                                      apiKey={apiKey}
                                      placeholder="URL или загрузить видео"
                                    />
                                  </div>
                                  <Input
                                    value={item.label || ""}
                                    onChange={(e) => {
                                      const items = [...(sectionSettings.items || [])];
                                      items[idx] = { ...items[idx], label: e.target.value };
                                      setSectionSettings({...sectionSettings, items});
                                    }}
                                    placeholder="Название товара"
                                  />
                                  <Input
                                    value={item.link || ""}
                                    onChange={(e) => {
                                      const items = [...(sectionSettings.items || [])];
                                      items[idx] = { ...items[idx], link: e.target.value };
                                      setSectionSettings({...sectionSettings, items});
                                    }}
                                    placeholder="/products/slug-tovara"
                                  />
                                </div>
                              ))}
                            </div>
                            <Button
                              className="w-full"
                              onClick={async () => {
                                try {
                                  await adminFetch(`/api/admin/page-settings/home/reels`, apiKey, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify(sectionSettings),
                                  });
                                  pageSettingsQuery.refetch();
                                  toast({ title: "Сохранено", description: "Настройки секции «Обзоры» сохранены" });
                                } catch (err: any) {
                                  toast({ title: "Ошибка", description: err.message, variant: "destructive" });
                                }
                              }}
                            >
                              <Save className="w-4 h-4 mr-2" /> Сохранить
                            </Button>
                          </div>
                        )}

                        {/* Custom Hits section editor */}
                        {selectedSection?.startsWith("custom_") && sectionSettings.type === "custom_hits" && (() => {
                          const pinnedIds: number[] = sectionSettings.pinnedProductIds || [];
                          const allProds: any[] = data?.products || [];
                          return (
                            <div className="space-y-4">
                              <div className="flex items-center gap-2">
                                <Switch checked={sectionSettings.visible !== false} onCheckedChange={(c) => setSectionSettings({...sectionSettings, visible: c})} />
                                <Label className="text-sm">Показывать секцию</Label>
                              </div>
                              <div>
                                <Label className="text-sm">Заголовок</Label>
                                <Input value={sectionSettings.title || ""} onChange={(e) => setSectionSettings({...sectionSettings, title: e.target.value})} placeholder="Хиты продаж" data-testid="input-custom-hits-title" />
                              </div>
                              <div>
                                <Label className="text-sm">Подзаголовок</Label>
                                <Input value={sectionSettings.subtitle || ""} onChange={(e) => setSectionSettings({...sectionSettings, subtitle: e.target.value})} placeholder="Лучшие товары" data-testid="input-custom-hits-subtitle" />
                              </div>
                              <div>
                                <Label className="text-sm">Режим выбора товаров</Label>
                                <div className="flex gap-2 mt-1">
                                  {[{ value: "manual", label: "Ручной выбор" }, { value: "auto", label: "Авто (по популярности)" }].map(opt => (
                                    <Button key={opt.value} size="sm" variant={sectionSettings.mode === opt.value ? "default" : "outline"} onClick={() => setSectionSettings({...sectionSettings, mode: opt.value})} data-testid={`button-custom-hits-mode-${opt.value}`}>{opt.label}</Button>
                                  ))}
                                </div>
                              </div>
                              {sectionSettings.mode !== "manual" ? (
                                <div>
                                  <Label className="text-sm">Количество товаров</Label>
                                  <Input type="number" min="1" max="24" value={sectionSettings.count || "8"} onChange={(e) => setSectionSettings({...sectionSettings, count: e.target.value})} className="w-24 mt-1" data-testid="input-custom-hits-count" />
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <Label className="text-sm">Товары в секции</Label>
                                  <div className="relative">
                                    <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                                    <Input
                                      className="pl-8 text-sm h-9"
                                      placeholder="Найти товар по названию..."
                                      value={customHitsPinnedSearch}
                                      onChange={(e) => setCustomHitsPinnedSearch(e.target.value)}
                                      data-testid="input-custom-hits-search"
                                    />
                                  </div>
                                  {customHitsPinnedSearch.trim().length >= 1 && (
                                    <div className="border rounded-md overflow-hidden max-h-48 overflow-y-auto bg-background">
                                      {(() => {
                                        const q = customHitsPinnedSearch.toLowerCase();
                                        const results = allProds.filter((p: any) => !p.isHidden && !pinnedIds.includes(p.id) && p.name?.toLowerCase().includes(q)).slice(0, 8);
                                        if (results.length === 0) return <div className="px-3 py-2 text-xs text-muted-foreground">Ничего не найдено</div>;
                                        return results.map((p: any) => (
                                          <div key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer border-b last:border-0"
                                            onClick={() => { setSectionSettings({...sectionSettings, pinnedProductIds: [...pinnedIds, p.id]}); setCustomHitsPinnedSearch(""); }}
                                            data-testid={`item-custom-hits-product-${p.id}`}
                                          >
                                            {p.images?.[0] && <img src={p.images[0]} className="w-8 h-8 object-cover rounded shrink-0" />}
                                            <div className="flex-1 min-w-0">
                                              <div className="truncate text-xs font-medium">{p.name}</div>
                                              <div className="text-xs text-muted-foreground">{p.sku || `ID: ${p.id}`}</div>
                                            </div>
                                            <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                          </div>
                                        ));
                                      })()}
                                    </div>
                                  )}
                                  <div className="space-y-1">
                                    {pinnedIds.length === 0 ? (
                                      <p className="text-xs text-muted-foreground text-center py-3 border rounded-md border-dashed">Добавьте товары через поиск выше</p>
                                    ) : pinnedIds.map((pid, idx) => {
                                      const p = allProds.find((pr: any) => pr.id === pid);
                                      return (
                                        <div
                                          key={pid}
                                          draggable
                                          onDragStart={(e) => e.dataTransfer.setData("text/plain", String(idx))}
                                          onDragOver={(e) => e.preventDefault()}
                                          onDrop={(e) => {
                                            e.preventDefault();
                                            const fromIdx = parseInt(e.dataTransfer.getData("text/plain"));
                                            if (fromIdx === idx) return;
                                            const ids = [...pinnedIds];
                                            const [moved] = ids.splice(fromIdx, 1);
                                            ids.splice(idx, 0, moved);
                                            setSectionSettings({...sectionSettings, pinnedProductIds: ids});
                                          }}
                                          className="flex items-center gap-2 p-2 bg-muted/40 rounded border cursor-grab active:cursor-grabbing active:opacity-60 active:bg-muted"
                                          data-testid={`row-custom-hits-pinned-${pid}`}
                                        >
                                          <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                          <span className="text-xs text-muted-foreground w-4 text-center shrink-0">{idx + 1}</span>
                                          {p?.images?.[0] && <img src={p.images[0]} className="w-7 h-7 object-cover rounded shrink-0" />}
                                          <span className="flex-1 text-xs truncate">{p?.name || `ID: ${pid}`}</span>
                                          <button onClick={() => setSectionSettings({...sectionSettings, pinnedProductIds: pinnedIds.filter(i => i !== pid)})} className="text-muted-foreground hover:text-destructive shrink-0" data-testid={`button-remove-custom-hits-${pid}`}><X className="w-3.5 h-3.5" /></button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              <div>
                                <Label className="text-sm">Текст кнопки «Все товары»</Label>
                                <Input value={sectionSettings.linkText || ""} onChange={(e) => setSectionSettings({...sectionSettings, linkText: e.target.value})} placeholder="Смотреть всё" data-testid="input-custom-hits-link-text" />
                              </div>
                              <div>
                                <Label className="text-sm">Ссылка кнопки</Label>
                                <Input value={sectionSettings.linkUrl || ""} onChange={(e) => setSectionSettings({...sectionSettings, linkUrl: e.target.value})} placeholder="/products" data-testid="input-custom-hits-link-url" />
                              </div>
                              <div>
                                <Label className="text-sm">Цвет фона</Label>
                                <Select value={sectionSettings.bgColor || "default"} onValueChange={(v) => setSectionSettings({...sectionSettings, bgColor: v})}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="default">По умолчанию</SelectItem>
                                    <SelectItem value="muted">Серый</SelectItem>
                                    <SelectItem value="card">Карточка</SelectItem>
                                    <SelectItem value="dark">Тёмный</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Custom Promo Banner editor */}
                        {selectedSection?.startsWith("custom_") && sectionSettings.type === "custom_promo_banner" && (
                          <div className="space-y-4">
                            <div className="flex items-center gap-2">
                              <Switch checked={sectionSettings.visible !== false} onCheckedChange={(c) => setSectionSettings({...sectionSettings, visible: c})} />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                            <div>
                              <Label className="text-sm">Заголовок</Label>
                              <Input value={sectionSettings.title || ""} onChange={(e) => setSectionSettings({...sectionSettings, title: e.target.value})} placeholder="НОВАЯ КОЛЛЕКЦИЯ" data-testid="input-custom-banner-title" />
                            </div>
                            <div>
                              <Label className="text-sm">Подзаголовок</Label>
                              <Textarea value={sectionSettings.subtitle || ""} onChange={(e) => setSectionSettings({...sectionSettings, subtitle: e.target.value})} placeholder="Описание акции" data-testid="input-custom-banner-subtitle" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label className="text-sm">Текст кнопки</Label>
                                <Input value={sectionSettings.buttonText || ""} onChange={(e) => setSectionSettings({...sectionSettings, buttonText: e.target.value})} placeholder="Смотреть" data-testid="input-custom-banner-btn-text" />
                              </div>
                              <div>
                                <Label className="text-sm">Ссылка кнопки</Label>
                                <Input value={sectionSettings.buttonLink || ""} onChange={(e) => setSectionSettings({...sectionSettings, buttonLink: e.target.value})} placeholder="/products" data-testid="input-custom-banner-btn-link" />
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm">Фоновое изображение</Label>
                              <ImageUploadField
                                value={sectionSettings.bgImage || ""}
                                onChange={(url) => setSectionSettings({...sectionSettings, bgImage: url})}
                                apiKey={`${selectedSection}_bg`}
                                placeholder="Загрузите изображение для фона"
                                hint="1920×600 px, JPG/WebP"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Цвет фона</Label>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {[{ value: "black", label: "Чёрный" }, { value: "white", label: "Белый" }, { value: "red", label: "Красный" }, { value: "gray", label: "Серый" }, { value: "gradient", label: "Градиент" }].map(opt => (
                                  <Button key={opt.value} size="sm" variant={sectionSettings.bgColor === opt.value ? "default" : "outline"} onClick={() => setSectionSettings({...sectionSettings, bgColor: opt.value})} data-testid={`button-custom-banner-bg-${opt.value}`}>{opt.label}</Button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm">Цвет текста</Label>
                              <div className="flex gap-2 mt-1">
                                {[{ value: "light", label: "Светлый" }, { value: "dark", label: "Тёмный" }].map(opt => (
                                  <Button key={opt.value} size="sm" variant={sectionSettings.textColor === opt.value ? "default" : "outline"} onClick={() => setSectionSettings({...sectionSettings, textColor: opt.value})} data-testid={`button-custom-banner-text-${opt.value}`}>{opt.label}</Button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm">Размер</Label>
                              <div className="flex gap-2 mt-1">
                                {[{ value: "compact", label: "Компактный" }, { value: "medium", label: "Средний" }, { value: "large", label: "Большой" }].map(opt => (
                                  <Button key={opt.value} size="sm" variant={sectionSettings.size === opt.value ? "default" : "outline"} onClick={() => setSectionSettings({...sectionSettings, size: opt.value})} data-testid={`button-custom-banner-size-${opt.value}`}>{opt.label}</Button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch checked={sectionSettings.rounded === true} onCheckedChange={(c) => setSectionSettings({...sectionSettings, rounded: c})} />
                              <Label className="text-sm">Скруглённые углы</Label>
                            </div>
                          </div>
                        )}

                        {/* Custom Text Block editor */}
                        {selectedSection?.startsWith("custom_") && sectionSettings.type === "custom_text" && (
                          <div className="space-y-4">
                            <div className="flex items-center gap-2">
                              <Switch checked={sectionSettings.visible !== false} onCheckedChange={(c) => setSectionSettings({...sectionSettings, visible: c})} />
                              <Label className="text-sm">Показывать секцию</Label>
                            </div>
                            <div>
                              <Label className="text-sm">Заголовок</Label>
                              <Input value={sectionSettings.title || ""} onChange={(e) => setSectionSettings({...sectionSettings, title: e.target.value})} placeholder="Заголовок секции" data-testid="input-custom-text-title" />
                            </div>
                            <div>
                              <Label className="text-sm">Текст</Label>
                              <Textarea rows={5} value={sectionSettings.text || ""} onChange={(e) => setSectionSettings({...sectionSettings, text: e.target.value})} placeholder="Введите текст..." data-testid="input-custom-text-body" />
                            </div>
                            <div>
                              <Label className="text-sm">Текст кнопки (необязательно)</Label>
                              <Input value={sectionSettings.buttonText || ""} onChange={(e) => setSectionSettings({...sectionSettings, buttonText: e.target.value})} placeholder="Подробнее" data-testid="input-custom-text-btn-text" />
                            </div>
                            <div>
                              <Label className="text-sm">Ссылка кнопки</Label>
                              <Input value={sectionSettings.buttonLink || ""} onChange={(e) => setSectionSettings({...sectionSettings, buttonLink: e.target.value})} placeholder="/about" data-testid="input-custom-text-btn-link" />
                            </div>
                            <div>
                              <Label className="text-sm">Изображение (необязательно)</Label>
                              <ImageUploadField
                                value={sectionSettings.image || ""}
                                onChange={(url) => setSectionSettings({...sectionSettings, image: url})}
                                apiKey={`${selectedSection}_img`}
                                placeholder="Загрузите изображение"
                                hint="Рекомендуется горизонтальное изображение"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Цвет фона</Label>
                              <Select value={sectionSettings.bgColor || "default"} onValueChange={(v) => setSectionSettings({...sectionSettings, bgColor: v})}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="default">По умолчанию</SelectItem>
                                  <SelectItem value="muted">Серый</SelectItem>
                                  <SelectItem value="card">Карточка</SelectItem>
                                  <SelectItem value="dark">Тёмный</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}

                        {/* Save button */}
                        <div className="pt-4 border-t">
                          <Button
                            onClick={() => {
                              savePageSectionMutation.mutate({
                                sectionId: selectedSection,
                                settings: sectionSettings,
                              });
                            }}
                            disabled={savePageSectionMutation.isPending}
                          >
                            {savePageSectionMutation.isPending ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4 mr-2" />
                            )}
                            Сохранить настройки
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>

              {/* Add Custom Section Dialog */}
              <Dialog open={addSectionDialog} onOpenChange={setAddSectionDialog}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Добавить новую секцию</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <p className="text-sm text-muted-foreground">Выберите тип секции для добавления на главную страницу:</p>
                    <div className="grid gap-3">
                      <button
                        className="flex items-start gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors text-left"
                        onClick={() => addCustomSection("custom_hits")}
                        data-testid="button-add-section-hits"
                      >
                        <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                          <TrendingUp className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <div className="font-medium text-sm">Хиты продаж</div>
                          <div className="text-xs text-muted-foreground mt-0.5">Сетка товаров — выбираешь вручную или автоматически по популярности</div>
                        </div>
                      </button>
                      <button
                        className="flex items-start gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors text-left"
                        onClick={() => addCustomSection("custom_promo_banner")}
                        data-testid="button-add-section-banner"
                      >
                        <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                          <ImageIcon className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <div className="font-medium text-sm">Промо-баннер</div>
                          <div className="text-xs text-muted-foreground mt-0.5">Широкий баннер с фото/цветом, заголовком и кнопкой</div>
                        </div>
                      </button>
                      <button
                        className="flex items-start gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors text-left"
                        onClick={() => addCustomSection("custom_text")}
                        data-testid="button-add-section-text"
                      >
                        <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                          <Type className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <div className="font-medium text-sm">Текстовый блок</div>
                          <div className="text-xs text-muted-foreground mt-0.5">Заголовок, текст и необязательное изображение</div>
                        </div>
                      </button>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setAddSectionDialog(false)}>Отмена</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              </>
            );
            })()}

            {/* Categories Manager */}
            {selectedPage === "categories" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-medium text-sm text-muted-foreground">
                      Управление категориями каталога
                    </h3>
                    {categoriesQuery.data?.source === "default" && (
                      <p className="text-xs text-muted-foreground mt-1">Используются категории по умолчанию. Внесите изменения и сохраните.</p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsAddingCategory(true)}
                      data-testid="button-add-category"
                    >
                      <Plus className="w-4 h-4 mr-1" /> Добавить
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => saveCategoriesMutation.mutate(editingCategories)}
                      disabled={saveCategoriesMutation.isPending}
                      data-testid="button-save-categories"
                    >
                      {saveCategoriesMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-1" />
                      )}
                      Сохранить все
                    </Button>
                  </div>
                </div>

                {isAddingCategory && (
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <h4 className="font-medium text-sm">Новая категория</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Slug (латиницей, без пробелов)</Label>
                          <Input
                            value={newCategoryForm.slug}
                            onChange={(e) => setNewCategoryForm({...newCategoryForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')})}
                            placeholder="new-category"
                            data-testid="input-new-category-slug"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Название</Label>
                          <Input
                            value={newCategoryForm.name}
                            onChange={(e) => setNewCategoryForm({...newCategoryForm, name: e.target.value})}
                            placeholder="Новая категория"
                            data-testid="input-new-category-name"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          size="sm"
                          onClick={() => {
                            if (!newCategoryForm.slug || !newCategoryForm.name) {
                              toast({ title: "Заполните slug и название", variant: "destructive" });
                              return;
                            }
                            if (editingCategories[newCategoryForm.slug]) {
                              toast({ title: "Категория с таким slug уже существует", variant: "destructive" });
                              return;
                            }
                            setEditingCategories({
                              ...editingCategories,
                              [newCategoryForm.slug]: {
                                name: newCategoryForm.name,
                                slug: newCategoryForm.slug,
                                subcategories: [],
                              }
                            });
                            setNewCategoryForm({ slug: "", name: "" });
                            setIsAddingCategory(false);
                            toast({ title: "Категория добавлена. Не забудьте сохранить." });
                          }}
                          data-testid="button-confirm-add-category"
                        >
                          <Check className="w-4 h-4 mr-1" /> Добавить
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setIsAddingCategory(false);
                            setNewCategoryForm({ slug: "", name: "" });
                          }}
                          data-testid="button-cancel-add-category"
                        >
                          Отмена
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-1 space-y-2">
                    <h3 className="font-medium text-sm text-muted-foreground mb-3">Список категорий</h3>
                    {Object.entries(editingCategories).map(([slug, cat]) => (
                      <Card
                        key={slug}
                        className={`cursor-pointer transition-colors hover-elevate ${editingCategorySlug === slug ? 'border-primary bg-primary/5' : ''}`}
                        onClick={() => {
                          setEditingCategorySlug(slug);
                          setNewSubcategory("");
                        }}
                      >
                        <CardContent className="p-3 flex items-center gap-3">
                          <Tag className="w-4 h-4 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium">{cat.name}</span>
                            <span className="text-xs text-muted-foreground ml-2">({slug})</span>
                          </div>
                          {(categoriesQuery.data?.productCounts?.[slug] ?? 0) > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {categoriesQuery.data?.productCounts[slug]} тов.
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-xs">
                            {cat.subcategories.length} подкат.
                          </Badge>
                        </CardContent>
                      </Card>
                    ))}
                    {Object.keys(editingCategories).length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">Нет категорий</p>
                    )}
                  </div>

                  <div className="lg:col-span-2">
                    {!editingCategorySlug ? (
                      <Card>
                        <CardContent className="p-8 text-center text-muted-foreground">
                          <Tag className="w-12 h-12 mx-auto mb-4 opacity-50" />
                          <p>Выберите категорию слева для редактирования</p>
                        </CardContent>
                      </Card>
                    ) : editingCategories[editingCategorySlug] ? (
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between gap-2">
                          <CardTitle className="text-base">
                            {editingCategories[editingCategorySlug].name}
                          </CardTitle>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              const count = categoriesQuery.data?.productCounts?.[editingCategorySlug] ?? 0;
                              if (count > 0) {
                                const confirmed = window.confirm(
                                  `В категории "${editingCategories[editingCategorySlug].name}" находится ${count} товар(ов). ` +
                                  `Удаление категории не удалит товары, но они останутся без привязки к категории. Продолжить?`
                                );
                                if (!confirmed) return;
                              }
                              if (Object.keys(editingCategories).length <= 1) {
                                toast({ title: "Нельзя удалить последнюю категорию", variant: "destructive" });
                                return;
                              }
                              const updated = { ...editingCategories };
                              delete updated[editingCategorySlug];
                              setEditingCategories(updated);
                              setEditingCategorySlug(null);
                              toast({ title: "Категория удалена. Не забудьте сохранить." });
                            }}
                            data-testid="button-delete-category"
                          >
                            <Trash2 className="w-4 h-4 mr-1" /> Удалить
                          </Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs">Slug</Label>
                              <Input
                                value={editingCategorySlug}
                                disabled
                                className="text-muted-foreground"
                                data-testid="input-category-slug"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Название</Label>
                              <Input
                                value={editingCategories[editingCategorySlug].name}
                                onChange={(e) => {
                                  setEditingCategories({
                                    ...editingCategories,
                                    [editingCategorySlug]: {
                                      ...editingCategories[editingCategorySlug],
                                      name: e.target.value,
                                    }
                                  });
                                }}
                                data-testid="input-category-name"
                              />
                            </div>
                          </div>

                          <div>
                            <Label className="text-xs mb-2 block">Подкатегории ({editingCategories[editingCategorySlug].subcategories.length})</Label>
                            <div className="space-y-2">
                              {editingCategories[editingCategorySlug].subcategories.map((sub, idx) => (
                                <div key={idx} className="border border-border/50 rounded-md p-2 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 grid grid-cols-2 gap-2">
                                      <Input
                                        value={typeof sub === 'string' ? sub : sub.name}
                                        onChange={(e) => {
                                          const subs = [...editingCategories[editingCategorySlug].subcategories];
                                          const current = subs[idx];
                                          subs[idx] = { ...(typeof current === 'string' ? { name: current, slug: '' } : current), name: e.target.value };
                                          setEditingCategories({ ...editingCategories, [editingCategorySlug]: { ...editingCategories[editingCategorySlug], subcategories: subs } });
                                        }}
                                        placeholder="Название"
                                        data-testid={`input-subcategory-name-${idx}`}
                                      />
                                      <Input
                                        value={typeof sub === 'string' ? '' : sub.slug}
                                        onChange={(e) => {
                                          const subs = [...editingCategories[editingCategorySlug].subcategories];
                                          const current = subs[idx];
                                          subs[idx] = { ...(typeof current === 'string' ? { name: current, slug: '' } : current), slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '') };
                                          setEditingCategories({ ...editingCategories, [editingCategorySlug]: { ...editingCategories[editingCategorySlug], subcategories: subs } });
                                        }}
                                        placeholder="slug (латиница)"
                                        className="font-mono text-xs"
                                        data-testid={`input-subcategory-slug-${idx}`}
                                      />
                                    </div>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => {
                                        setExpandedSubcategoryIdx(null);
                                        const subs = editingCategories[editingCategorySlug].subcategories.filter((_, i) => i !== idx);
                                        setEditingCategories({ ...editingCategories, [editingCategorySlug]: { ...editingCategories[editingCategorySlug], subcategories: subs } });
                                      }}
                                      data-testid={`button-delete-subcategory-${idx}`}
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      title="Под-подкатегории"
                                      onClick={() => setExpandedSubcategoryIdx(expandedSubcategoryIdx === idx ? null : idx)}
                                      className="relative"
                                    >
                                      <ChevronDown className={`w-4 h-4 transition-transform ${expandedSubcategoryIdx === idx ? '' : '-rotate-90'}`} />
                                      {((sub as any).subSubcategories || []).length > 0 && (
                                        <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold leading-none">
                                          {((sub as any).subSubcategories || []).length}
                                        </span>
                                      )}
                                    </Button>
                                  </div>
                                  {/* Sub-subcategories */}
                                  {expandedSubcategoryIdx === idx && (
                                    <div className="ml-2 pl-2 border-l border-border space-y-1.5">
                                      <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Под-подкатегории (3-й уровень)</p>
                                      {((sub as any).subSubcategories || []).map((ss: any, ssIdx: number) => (
                                        <div key={ssIdx} className="flex items-center gap-2">
                                          <Input
                                            value={ss.name || ''}
                                            onChange={(e) => {
                                              const subs = [...editingCategories[editingCategorySlug].subcategories];
                                              const subSubs = [...((subs[idx] as any).subSubcategories || [])];
                                              subSubs[ssIdx] = { ...subSubs[ssIdx], name: e.target.value };
                                              (subs[idx] as any) = { ...subs[idx], subSubcategories: subSubs };
                                              setEditingCategories({ ...editingCategories, [editingCategorySlug]: { ...editingCategories[editingCategorySlug], subcategories: subs } });
                                            }}
                                            placeholder="Название"
                                            className="text-xs"
                                          />
                                          <Input
                                            value={ss.slug || ''}
                                            onChange={(e) => {
                                              const subs = [...editingCategories[editingCategorySlug].subcategories];
                                              const subSubs = [...((subs[idx] as any).subSubcategories || [])];
                                              subSubs[ssIdx] = { ...subSubs[ssIdx], slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '') };
                                              (subs[idx] as any) = { ...subs[idx], subSubcategories: subSubs };
                                              setEditingCategories({ ...editingCategories, [editingCategorySlug]: { ...editingCategories[editingCategorySlug], subcategories: subs } });
                                            }}
                                            placeholder="slug"
                                            className="font-mono text-xs"
                                          />
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() => {
                                              const subs = [...editingCategories[editingCategorySlug].subcategories];
                                              const subSubs = ((subs[idx] as any).subSubcategories || []).filter((_: any, i: number) => i !== ssIdx);
                                              (subs[idx] as any) = { ...subs[idx], subSubcategories: subSubs };
                                              setEditingCategories({ ...editingCategories, [editingCategorySlug]: { ...editingCategories[editingCategorySlug], subcategories: subs } });
                                            }}
                                          >
                                            <X className="w-3 h-3" />
                                          </Button>
                                        </div>
                                      ))}
                                      <div className="flex gap-2">
                                        <Input
                                          value={newSubSubcategory}
                                          onChange={(e) => setNewSubSubcategory(e.target.value)}
                                          placeholder="Новая под-подкатегория..."
                                          className="text-xs"
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newSubSubcategory.trim()) {
                                              const subs = [...editingCategories[editingCategorySlug].subcategories];
                                              const subSubs = [...((subs[idx] as any).subSubcategories || [])];
                                              subSubs.push({ name: newSubSubcategory.trim(), slug: '' });
                                              (subs[idx] as any) = { ...subs[idx], subSubcategories: subSubs };
                                              setEditingCategories({ ...editingCategories, [editingCategorySlug]: { ...editingCategories[editingCategorySlug], subcategories: subs } });
                                              setNewSubSubcategory('');
                                            }
                                          }}
                                        />
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => {
                                            if (!newSubSubcategory.trim()) return;
                                            const subs = [...editingCategories[editingCategorySlug].subcategories];
                                            const subSubs = [...((subs[idx] as any).subSubcategories || [])];
                                            subSubs.push({ name: newSubSubcategory.trim(), slug: '' });
                                            (subs[idx] as any) = { ...subs[idx], subSubcategories: subSubs };
                                            setEditingCategories({ ...editingCategories, [editingCategorySlug]: { ...editingCategories[editingCategorySlug], subcategories: subs } });
                                            setNewSubSubcategory('');
                                          }}
                                        >
                                          <Plus className="w-3 h-3 mr-1" /> Добавить
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2 mt-2">
                              <Input
                                value={newSubcategory}
                                onChange={(e) => setNewSubcategory(e.target.value)}
                                placeholder="Новая подкатегория..."
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && newSubcategory.trim()) {
                                    const name = newSubcategory.trim();
                                    setEditingCategories({
                                      ...editingCategories,
                                      [editingCategorySlug]: {
                                        ...editingCategories[editingCategorySlug],
                                        subcategories: [...editingCategories[editingCategorySlug].subcategories, { name, slug: "" }],
                                      }
                                    });
                                    setNewSubcategory("");
                                  }
                                }}
                                data-testid="input-new-subcategory"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (newSubcategory.trim()) {
                                    const name = newSubcategory.trim();
                                    setEditingCategories({
                                      ...editingCategories,
                                      [editingCategorySlug]: {
                                        ...editingCategories[editingCategorySlug],
                                        subcategories: [...editingCategories[editingCategorySlug].subcategories, { name, slug: "" }],
                                      }
                                    });
                                    setNewSubcategory("");
                                  }
                                }}
                                data-testid="button-add-subcategory"
                              >
                                <Plus className="w-4 h-4 mr-1" /> Добавить
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Slug автоматически генерируется из названия если оставить пустым</p>
                          </div>
                        </CardContent>
                      </Card>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {/* Artist Pages Editor */}
            {selectedPage === "artist_pages" && (
              <div className="space-y-4">
                {!editingArtistSlug ? (
                  <>
                    {/* Блок партнёров-артистов с тоглом видимости на главной */}
                    {artistPartnersList.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-medium">Партнёры-артисты</h3>
                          <span className="text-xs text-muted-foreground">Показывать на главной странице</span>
                        </div>
                        <div className="space-y-2">
                          {artistPartnersList.map((partner: any) => {
                            const homeItems: any[] = homeSettingsForArtists.data?.artists?.items || [];
                            const isOnHomepage = homeItems.some((a: any) => a.slug === partner.partnerSlug);
                            const pageData = artistPagesQuery.data?.[partner.partnerSlug];
                            const displayName = pageData?.name || partner.storeName || partner.contactName || partner.partnerSlug;
                            const displayRole = pageData?.role || "";
                            const displayImage = pageData?.heroImage || "";
                            const hasPage = !!pageData;
                            return (
                              <div key={partner.id} className="flex items-center gap-3 p-2.5 rounded-lg border bg-card">
                                <div className="w-10 h-10 rounded-md bg-muted flex-shrink-0 overflow-hidden">
                                  {displayImage ? (
                                    <img src={displayImage} alt={displayName} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                      <Users className="w-4 h-4" />
                                    </div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{displayName}</div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {displayRole || `/${partner.partnerSlug}`}
                                    {!hasPage && <span className="ml-1 text-amber-500">· страница не заполнена</span>}
                                  </div>
                                </div>
                                <Switch
                                  checked={isOnHomepage}
                                  data-testid={`switch-artist-homepage-${partner.partnerSlug}`}
                                  onCheckedChange={async (checked) => {
                                    const qKey = ["/api/page-settings/home", "for-artists"];
                                    const prev = queryClient.getQueryData<Record<string, any>>(qKey);
                                    // Оптимистичное обновление — меняем UI немедленно
                                    queryClient.setQueryData<Record<string, any>>(qKey, (old) => {
                                      if (!old) return old;
                                      const items: any[] = old.artists?.items || [];
                                      const newItems = checked
                                        ? items.some((a: any) => a.slug === partner.partnerSlug)
                                          ? items
                                          : [...items, { slug: partner.partnerSlug, name: partner.storeName || partner.partnerSlug, role: "", image: "" }]
                                        : items.filter((a: any) => a.slug !== partner.partnerSlug);
                                      return { ...old, artists: { ...(old.artists || {}), items: newItems } };
                                    });
                                    try {
                                      await adminFetch(`/api/admin/partners/${partner.id}/homepage`, apiKey, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ visible: checked }),
                                      });
                                      homeSettingsForArtists.refetch();
                                    } catch (err: any) {
                                      // Откат при ошибке
                                      queryClient.setQueryData(qKey, prev);
                                      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
                                    }
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                        <hr className="border-border" />
                      </div>
                    )}

                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="font-medium">Страницы артистов</h3>
                      <Button size="sm" variant="outline" onClick={() => artistPagesQuery.refetch()}>
                        <RefreshCw className="w-4 h-4 mr-1" /> Обновить
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Управляйте артистами: создавайте новых и настраивайте их персональные страницы.
                    </p>
                    {(() => {
                      const homePageData = homeSettingsForArtists.data;
                      const artistItems = homePageData?.artists?.items || [];
                      const artistsWithSlug = artistItems.filter((a: any) => a.slug);

                      const addNewArtist = async () => {
                        const currentItems = homePageData?.artists?.items || [];
                        const slugBase = `artist-${Date.now()}`;
                        const newItem = {
                          name: "Новый артист",
                          role: "",
                          image: "",
                          collection: "",
                          slug: slugBase,
                        };
                        const updatedArtists = {
                          ...(homePageData?.artists || { title: "Наши артисты", subtitle: "Коллаборации", linkText: "Весь мерч", linkUrl: "/products?category=merch", visible: true }),
                          items: [newItem, ...currentItems],
                        };
                        try {
                          await adminFetch("/api/admin/page-settings/home/artists", apiKey, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(updatedArtists),
                          });
                          homeSettingsForArtists.refetch();
                          setEditingArtistSlug(slugBase);
                          setArtistPageSettings({
                            heroImage: "",
                            heroVideo: "",
                            heroBgType: "image",
                            heroOpacity: "0.5",
                            name: "Новый артист",
                            role: "",
                            shortDescription: "",
                            aboutTitle: "О коллаборации",
                            aboutText: "",
                            aboutImages: [],
                            galleryTitle: "Галерея",
                            galleryImages: [],
                            productsTitle: "Товары коллекции",
                            productsSubcategory: "",
                            productsCategory: "merch",
                            productsLinkText: "Все товары",
                            quoteText: "",
                            quoteAuthor: "",
                            videoUrl: "",
                            videoTitle: "Видео",
                            socialTelegram: "",
                            socialVk: "",
                            socialYoutube: "",
                            socialInstagram: "",
                            socialOther: "",
                            socialOtherLabel: "",
                            heroVisible: true,
                            aboutVisible: true,
                            galleryVisible: true,
                            productsVisible: true,
                            quoteVisible: true,
                            videoVisible: true,
                            socialsVisible: true,
                            seoTitle: "",
                            seoDescription: "",
                            slug: "",
                            featuredPartnerSlug: "",
                            featuredPartnerTitle: "",
                            featuredPartnerDescription: "",
                            featuredPartnerImage: "",
                            featuredPartnerVisible: false,
                          });
                          toast({ title: "Артист создан", description: "Заполните настройки нового артиста" });
                        } catch (err: any) {
                          toast({ title: "Ошибка", description: err.message, variant: "destructive" });
                        }
                      };
                      
                      return (
                        <div className="space-y-3">
                          <Button onClick={addNewArtist} data-testid="button-add-artist">
                            <Plus className="w-4 h-4 mr-2" /> Добавить артиста
                          </Button>

                          {artistsWithSlug.length === 0 && (
                            <div className="text-center py-8 text-muted-foreground">
                              Нет артистов. Нажмите "Добавить артиста" чтобы создать первого.
                            </div>
                          )}

                          <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: "x mandatory" }}>
                            {artistsWithSlug.map((artist: any) => {
                              const pageData = artistPagesQuery.data?.[artist.slug];
                              const isConfigured = !!pageData;
                              return (
                                <Card key={artist.slug} className={`flex-shrink-0 w-48 ${isConfigured ? "" : "border-amber-500/50"}`} style={{ scrollSnapAlign: "start" }}>
                                  <CardContent className="p-0">
                                    <div className="relative w-full h-28 bg-muted rounded-t-md">
                                      {artist.image ? (
                                        <img src={artist.image} alt={artist.name} className="w-full h-28 rounded-t-md object-cover" />
                                      ) : (
                                        <div className="w-full h-28 flex items-center justify-center text-muted-foreground">
                                          <Users className="w-8 h-8" />
                                        </div>
                                      )}
                                      <Badge variant={isConfigured ? "secondary" : "outline"} className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0">
                                        {isConfigured ? "OK" : "—"}
                                      </Badge>
                                    </div>
                                    <div className="p-2.5 space-y-2">
                                      <div>
                                        <div className="font-medium text-sm leading-tight line-clamp-2">{artist.name || artist.slug}</div>
                                        <div className="text-[11px] text-muted-foreground mt-0.5">{artist.role || `/@${artist.slug}`}</div>
                                      </div>
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-[10px] text-muted-foreground">Порядок</span>
                                        <div className="flex gap-0.5">
                                          <button
                                            disabled={artistsWithSlug.findIndex((a: any) => a.slug === artist.slug) === 0}
                                            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                                            data-testid={`button-artist-left-${artist.slug}`}
                                            onClick={async () => {
                                              const current = homeSettingsForArtists.data;
                                              const items = [...(current?.artists?.items || [])];
                                              const idx = items.findIndex((a: any) => a.slug === artist.slug);
                                              if (idx <= 0) return;
                                              [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
                                              const updated = { ...(current?.artists || {}), items };
                                              queryClient.setQueryData(["/api/page-settings/home", "for-artists"], { ...current, artists: updated });
                                              adminFetch("/api/admin/page-settings/home/artists", apiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
                                            }}
                                          ><ArrowLeft className="w-3 h-3" /></button>
                                          <button
                                            disabled={artistsWithSlug.findIndex((a: any) => a.slug === artist.slug) === artistsWithSlug.length - 1}
                                            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                                            data-testid={`button-artist-right-${artist.slug}`}
                                            onClick={async () => {
                                              const current = homeSettingsForArtists.data;
                                              const items = [...(current?.artists?.items || [])];
                                              const idx = items.findIndex((a: any) => a.slug === artist.slug);
                                              if (idx < 0 || idx >= items.length - 1) return;
                                              [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
                                              const updated = { ...(current?.artists || {}), items };
                                              queryClient.setQueryData(["/api/page-settings/home", "for-artists"], { ...current, artists: updated });
                                              adminFetch("/api/admin/page-settings/home/artists", apiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
                                            }}
                                          ><ArrowRight className="w-3 h-3" /></button>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <Button
                                          size="sm"
                                          variant="default"
                                          className="flex-1 text-xs"
                                          onClick={() => {
                                            setEditingArtistSlug(artist.slug);
                                            const existing = artistPagesQuery.data?.[artist.slug] || {};
                                            setArtistPageSettings({
                                              heroImage: artist.image || "",
                                              heroVideo: "",
                                              heroBgType: "image",
                                              heroOpacity: "0.5",
                                              name: artist.name || "",
                                              role: artist.role || "",
                                              shortDescription: "",
                                              aboutTitle: "О коллаборации",
                                              aboutText: "",
                                              aboutImages: [],
                                              galleryTitle: "Галерея",
                                              galleryImages: [],
                                              productsTitle: "Товары коллекции",
                                              productsSubcategory: "",
                                              productsCategory: "merch",
                                              productsLinkText: "Все товары",
                                              quoteText: "",
                                              quoteAuthor: "",
                                              videoUrl: "",
                                              videoTitle: "Видео",
                                              socialTelegram: "",
                                              socialVk: "",
                                              socialYoutube: "",
                                              socialInstagram: "",
                                              socialOther: "",
                                              socialOtherLabel: "",
                                              heroVisible: true,
                                              aboutVisible: true,
                                              galleryVisible: true,
                                              productsVisible: true,
                                              quoteVisible: true,
                                              videoVisible: true,
                                              socialsVisible: true,
                                              seoTitle: "",
                                              seoDescription: "",
                                              slug: "",
                                              featuredPartnerSlug: "",
                                              featuredPartnerTitle: "",
                                              featuredPartnerDescription: "",
                                              featuredPartnerImage: "",
                                              featuredPartnerVisible: false,
                                              ...existing,
                                            });
                                          }}
                                          data-testid={`button-edit-artist-${artist.slug}`}
                                        >
                                          <Pencil className="w-3 h-3 mr-1" /> Настроить
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          onClick={async () => {
                                            if (!confirm(`Удалить артиста "${artist.name || artist.slug}"?`)) return;
                                            const currentItems = [...(homePageData?.artists?.items || [])];
                                            const artistIdx = currentItems.findIndex((a: any) => a.slug === artist.slug);
                                            if (artistIdx >= 0) currentItems.splice(artistIdx, 1);
                                            const updatedArtists = {
                                              ...(homePageData?.artists || {}),
                                              items: currentItems,
                                            };
                                            try {
                                              await adminFetch("/api/admin/page-settings/home/artists", apiKey, {
                                                method: "POST",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify(updatedArtists),
                                              });
                                              await adminFetch(`/api/admin/page-settings/artist_pages/${artist.slug}`, apiKey, {
                                                method: "DELETE",
                                              });
                                              homeSettingsForArtists.refetch();
                                              artistPagesQuery.refetch();
                                              toast({ title: "Артист удалён" });
                                            } catch (err: any) {
                                              toast({ title: "Ошибка", description: err.message, variant: "destructive" });
                                            }
                                          }}
                                          data-testid={`button-delete-artist-${artist.slug}`}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditingArtistSlug(null)}>
                          <ArrowLeft className="w-4 h-4" />
                        </Button>
                        <h3 className="font-medium">Страница: {artistPageSettings.name || editingArtistSlug}</h3>
                      </div>
                      <Button
                        size="sm"
                        onClick={async () => {
                          saveArtistPageMutation.mutate({
                            slug: editingArtistSlug!,
                            settings: artistPageSettings,
                          });
                          try {
                            const homeData = homeSettingsForArtists.data;
                            const currentItems = [...(homeData?.artists?.items || [])];
                            const aIdx = currentItems.findIndex((a: any) => a.slug === editingArtistSlug);
                            if (aIdx >= 0) {
                              currentItems[aIdx] = {
                                ...currentItems[aIdx],
                                name: artistPageSettings.name,
                                role: artistPageSettings.role,
                                image: artistPageSettings.heroImage || currentItems[aIdx].image,
                              };
                              await adminFetch("/api/admin/page-settings/home/artists", apiKey, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ ...(homeData?.artists || {}), items: currentItems }),
                              });
                              homeSettingsForArtists.refetch();
                            }
                          } catch {}
                        }}
                        disabled={saveArtistPageMutation.isPending}
                        data-testid="button-save-artist-page"
                      >
                        <Save className="w-4 h-4 mr-1" />
                        {saveArtistPageMutation.isPending ? "Сохранение..." : "Сохранить"}
                      </Button>
                    </div>

                    <div className="space-y-6">
                      {/* Hero Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Hero баннер</Label>
                            <Switch
                              checked={artistPageSettings.heroVisible !== false}
                              onCheckedChange={(v) => setArtistPageSettings({...artistPageSettings, heroVisible: v})}
                            />
                          </div>
                          <Input
                            value={artistPageSettings.name || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, name: e.target.value})}
                            placeholder="Имя артиста"
                          />
                          <Input
                            value={artistPageSettings.role || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, role: e.target.value})}
                            placeholder="Роль (Музыкант, DJ и т.д.)"
                          />
                          <Input
                            value={artistPageSettings.shortDescription || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, shortDescription: e.target.value})}
                            placeholder="Краткое описание"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" variant={artistPageSettings.heroBgType !== "video" ? "default" : "outline"}
                              onClick={() => setArtistPageSettings({...artistPageSettings, heroBgType: "image"})}>
                              Изображение
                            </Button>
                            <Button size="sm" variant={artistPageSettings.heroBgType === "video" ? "default" : "outline"}
                              onClick={() => setArtistPageSettings({...artistPageSettings, heroBgType: "video"})}>
                              Видео
                            </Button>
                          </div>
                          {artistPageSettings.heroBgType !== "video" ? (
                            <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2.5">
                              Фоновое изображение баннера (десктоп/моб.) и alt-текст теперь редактируются в разделе
                              {" "}<span className="font-medium">SEO → Артисты → {artistPageSettings.name || "этот артист"}</span>.
                            </p>
                          ) : (
                            <MediaUploadField
                              type="video"
                              value={artistPageSettings.heroVideo || ""}
                              onChange={(url) => setArtistPageSettings({...artistPageSettings, heroVideo: url})}
                              apiKey={apiKey}
                              placeholder="URL видео баннера"
                            />
                          )}
                          <div>
                            <Label className="text-sm">Затемнение фона (0-1)</Label>
                            <Input
                              type="number" min="0" max="1" step="0.1"
                              value={artistPageSettings.heroOpacity ?? "0.5"}
                              onChange={(e) => setArtistPageSettings({...artistPageSettings, heroOpacity: e.target.value})}
                            />
                          </div>
                        </CardContent>
                      </Card>

                      {/* About Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">О коллаборации</Label>
                            <Switch
                              checked={artistPageSettings.aboutVisible !== false}
                              onCheckedChange={(v) => setArtistPageSettings({...artistPageSettings, aboutVisible: v})}
                            />
                          </div>
                          <Input
                            value={artistPageSettings.aboutTitle || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, aboutTitle: e.target.value})}
                            placeholder="Заголовок секции"
                          />
                          <Textarea
                            value={artistPageSettings.aboutText || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, aboutText: e.target.value})}
                            placeholder="Текст о коллаборации (каждый абзац с новой строки)"
                            rows={5}
                          />
                          <div>
                            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                              <Label className="text-sm">Изображения</Label>
                              <Button size="sm" variant="outline" onClick={() => {
                                setArtistPageSettings({
                                  ...artistPageSettings,
                                  aboutImages: [...(artistPageSettings.aboutImages || []), ""],
                                });
                              }}>
                                <Plus className="w-3 h-3 mr-1" /> Добавить
                              </Button>
                            </div>
                            {(artistPageSettings.aboutImages || []).map((img: string, idx: number) => (
                              <div key={idx} className="flex items-start gap-2 mb-2">
                                <div className="flex-1">
                                  <MediaUploadField
                                    type="image"
                                    value={img}
                                    onChange={(url) => {
                                      const imgs = [...(artistPageSettings.aboutImages || [])];
                                      imgs[idx] = url;
                                      setArtistPageSettings({...artistPageSettings, aboutImages: imgs});
                                    }}
                                    apiKey={apiKey}
                                    placeholder="URL изображения"
                                  />
                                </div>
                                <Button size="sm" variant="destructive" onClick={() => {
                                  const imgs = [...(artistPageSettings.aboutImages || [])];
                                  imgs.splice(idx, 1);
                                  setArtistPageSettings({...artistPageSettings, aboutImages: imgs});
                                }}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Quote Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Цитата</Label>
                            <Switch
                              checked={artistPageSettings.quoteVisible !== false}
                              onCheckedChange={(v) => setArtistPageSettings({...artistPageSettings, quoteVisible: v})}
                            />
                          </div>
                          <Textarea
                            value={artistPageSettings.quoteText || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, quoteText: e.target.value})}
                            placeholder="Текст цитаты"
                            rows={2}
                          />
                          <Input
                            value={artistPageSettings.quoteAuthor || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, quoteAuthor: e.target.value})}
                            placeholder="Автор цитаты"
                          />
                        </CardContent>
                      </Card>

                      {/* Gallery Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Галерея</Label>
                            <Switch
                              checked={artistPageSettings.galleryVisible !== false}
                              onCheckedChange={(v) => setArtistPageSettings({...artistPageSettings, galleryVisible: v})}
                            />
                          </div>
                          <Input
                            value={artistPageSettings.galleryTitle || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, galleryTitle: e.target.value})}
                            placeholder="Заголовок галереи"
                          />
                          <div>
                            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                              <Label className="text-sm">Фотографии</Label>
                              <Button size="sm" variant="outline" onClick={() => {
                                setArtistPageSettings({
                                  ...artistPageSettings,
                                  galleryImages: [...(artistPageSettings.galleryImages || []), ""],
                                });
                              }}>
                                <Plus className="w-3 h-3 mr-1" /> Добавить
                              </Button>
                            </div>
                            {(artistPageSettings.galleryImages || []).map((img: string, idx: number) => (
                              <div key={idx} className="flex items-start gap-2 mb-2">
                                <div className="flex-1">
                                  <MediaUploadField
                                    type="image"
                                    value={img}
                                    onChange={(url) => {
                                      const imgs = [...(artistPageSettings.galleryImages || [])];
                                      imgs[idx] = url;
                                      setArtistPageSettings({...artistPageSettings, galleryImages: imgs});
                                    }}
                                    apiKey={apiKey}
                                    placeholder="URL фото"
                                  />
                                </div>
                                <Button size="sm" variant="destructive" onClick={() => {
                                  const imgs = [...(artistPageSettings.galleryImages || [])];
                                  imgs.splice(idx, 1);
                                  setArtistPageSettings({...artistPageSettings, galleryImages: imgs});
                                }}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Video Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Видео</Label>
                            <Switch
                              checked={artistPageSettings.videoVisible !== false}
                              onCheckedChange={(v) => setArtistPageSettings({...artistPageSettings, videoVisible: v})}
                            />
                          </div>
                          <Input
                            value={artistPageSettings.videoTitle || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, videoTitle: e.target.value})}
                            placeholder="Заголовок"
                          />
                          <MediaUploadField
                            type="video"
                            value={artistPageSettings.videoUrl || ""}
                            onChange={(url) => setArtistPageSettings({...artistPageSettings, videoUrl: url})}
                            apiKey={apiKey}
                            placeholder="YouTube/VK URL или загрузите видео"
                          />
                          <p className="text-xs text-muted-foreground">Поддержка: YouTube, VK Video или прямая ссылка</p>
                        </CardContent>
                      </Card>

                      {/* Products Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Товары коллекции</Label>
                            <Switch
                              checked={artistPageSettings.productsVisible !== false}
                              onCheckedChange={(v) => setArtistPageSettings({...artistPageSettings, productsVisible: v})}
                            />
                          </div>
                          <Input
                            value={artistPageSettings.productsTitle || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, productsTitle: e.target.value})}
                            placeholder="Заголовок"
                          />
                          <div>
                            <Label className="text-sm">Категория</Label>
                            <Select
                              value={artistPageSettings.productsCategory || "merch"}
                              onValueChange={(v) => setArtistPageSettings({...artistPageSettings, productsCategory: v, productsSubcategory: ""})}
                            >
                              <SelectTrigger data-testid="select-artist-products-category">
                                <SelectValue placeholder="Выберите категорию" />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.keys(Object.keys(editingCategories).length > 0 ? editingCategories : CATEGORIES).map((slug) => (
                                  <SelectItem key={slug} value={slug}>{(editingCategories[slug] || CATEGORIES[slug as CategorySlug])?.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {artistPageSettings.productsCategory && (() => {
                            const activeCats = Object.keys(editingCategories).length > 0 ? editingCategories : CATEGORIES;
                            const subs = activeCats[artistPageSettings.productsCategory]?.subcategories || [];
                            return subs.length > 0 ? (
                              <div>
                                <Label className="text-sm">Подкатегория</Label>
                                <Select
                                  value={artistPageSettings.productsSubcategory || "__all__"}
                                  onValueChange={(v) => setArtistPageSettings({...artistPageSettings, productsSubcategory: v === "__all__" ? "" : v})}
                                >
                                  <SelectTrigger data-testid="select-artist-products-subcategory">
                                    <SelectValue placeholder="Все подкатегории" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__all__">Все подкатегории</SelectItem>
                                    {subs.map((sub: any) => (
                                      <SelectItem key={sub.name} value={sub.name}>{sub.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ) : null;
                          })()}
                          <Input
                            value={artistPageSettings.productsLinkText || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, productsLinkText: e.target.value})}
                            placeholder="Текст ссылки (Все товары)"
                          />
                        </CardContent>
                      </Card>

                      {/* Featured Partner Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Партнёрский бренд</Label>
                            <Switch
                              checked={artistPageSettings.featuredPartnerVisible !== false && !!artistPageSettings.featuredPartnerSlug}
                              onCheckedChange={(v) => setArtistPageSettings({...artistPageSettings, featuredPartnerVisible: v})}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">Кликабельная карточка со ссылкой на страницу другого артиста. Отображается после товаров коллекции.</p>
                          <Input
                            value={artistPageSettings.featuredPartnerSlug || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, featuredPartnerSlug: e.target.value})}
                            placeholder="Слаг артиста (например: mark-i-monti)"
                          />
                          <Input
                            value={artistPageSettings.featuredPartnerTitle || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, featuredPartnerTitle: e.target.value})}
                            placeholder="Название бренда (Марк и Монти)"
                          />
                          <textarea
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            value={artistPageSettings.featuredPartnerDescription || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, featuredPartnerDescription: e.target.value})}
                            placeholder="Описание (например: продукция будет представлена на фестивале)"
                          />
                          <ImageUploadField
                            value={artistPageSettings.featuredPartnerImage || ""}
                            onChange={(url) => setArtistPageSettings({...artistPageSettings, featuredPartnerImage: url})}
                            apiKey={apiKey}
                            placeholder="Фото коллаба (опционально)"
                            hint="Рекомендуется 800×600 px, JPG/WebP"
                          />
                        </CardContent>
                      </Card>

                      {/* Social Links Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Соцсети</Label>
                            <Switch
                              checked={artistPageSettings.socialsVisible !== false}
                              onCheckedChange={(v) => setArtistPageSettings({...artistPageSettings, socialsVisible: v})}
                            />
                          </div>
                          <Input
                            value={artistPageSettings.socialTelegram || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, socialTelegram: e.target.value})}
                            placeholder="Telegram URL"
                          />
                          <Input
                            value={artistPageSettings.socialVk || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, socialVk: e.target.value})}
                            placeholder="VK URL"
                          />
                          <Input
                            value={artistPageSettings.socialYoutube || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, socialYoutube: e.target.value})}
                            placeholder="YouTube URL"
                          />
                          <Input
                            value={artistPageSettings.socialInstagram || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, socialInstagram: e.target.value})}
                            placeholder="Instagram URL"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              value={artistPageSettings.socialOtherLabel || ""}
                              onChange={(e) => setArtistPageSettings({...artistPageSettings, socialOtherLabel: e.target.value})}
                              placeholder="Название (Сайт, Spotify)"
                            />
                            <Input
                              value={artistPageSettings.socialOther || ""}
                              onChange={(e) => setArtistPageSettings({...artistPageSettings, socialOther: e.target.value})}
                              placeholder="URL"
                            />
                          </div>
                        </CardContent>
                      </Card>

                      {/* SEO */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <Label className="font-medium">SEO</Label>
                          <Input
                            value={artistPageSettings.seoTitle || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, seoTitle: e.target.value})}
                            placeholder="SEO заголовок (title)"
                          />
                          <Textarea
                            value={artistPageSettings.seoDescription || ""}
                            onChange={(e) => setArtistPageSettings({...artistPageSettings, seoDescription: e.target.value})}
                            placeholder="SEO описание (meta description)"
                            rows={2}
                          />
                        </CardContent>
                      </Card>

                      {/* ── Треки артиста ── */}
                      <Card>
                        <CardContent className="p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Music className="w-4 h-4" />
                              <Label className="font-medium">Треки</Label>
                              {artistTracksQuery.data?.tracks?.length ? (
                                <span className="text-xs text-muted-foreground">({artistTracksQuery.data.tracks.length})</span>
                              ) : null}
                            </div>
                            <Button
                              size="sm"
                              variant={trackFormOpen ? "secondary" : "outline"}
                              onClick={() => setTrackFormOpen(v => !v)}
                              data-testid="button-track-form-toggle"
                            >
                              <Plus className="w-3.5 h-3.5 mr-1" />
                              {trackFormOpen ? "Отмена" : "Добавить трек"}
                            </Button>
                          </div>

                          {/* Add track form */}
                          {trackFormOpen && (
                            <div className="space-y-3 p-3 rounded-lg border border-dashed bg-muted/30">
                              <div className="grid grid-cols-2 gap-2">
                                <div className="col-span-2">
                                  <Label className="text-xs mb-1 block">Название трека *</Label>
                                  <Input
                                    value={trackNewTitle}
                                    onChange={e => setTrackNewTitle(e.target.value)}
                                    placeholder="Например: Под дождём"
                                    data-testid="input-track-title"
                                  />
                                </div>
                                <div className="col-span-2">
                                  <Label className="text-xs mb-1 block">Исполнитель</Label>
                                  <Input
                                    value={trackNewSubtitle}
                                    onChange={e => setTrackNewSubtitle(e.target.value)}
                                    placeholder="Например: МОЛОДОСТЬ ВНУТРИ"
                                    data-testid="input-track-subtitle"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs mb-1 block">Порядок</Label>
                                  <Input
                                    type="number"
                                    min={1}
                                    value={trackNewOrder}
                                    onChange={e => setTrackNewOrder(Number(e.target.value))}
                                    data-testid="input-track-order"
                                  />
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label className="text-xs">Аудио файл * (MP3 / M4A)</Label>
                                <div className="flex items-center gap-2">
                                  <label className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border border-dashed cursor-pointer hover:bg-accent/10 transition-colors text-sm">
                                    <Upload className="w-4 h-4 shrink-0" />
                                    <span className="truncate text-muted-foreground">
                                      {trackAudioFile ? trackAudioFile.name : "Выбрать MP3/M4A"}
                                    </span>
                                    <input
                                      type="file"
                                      accept="audio/mpeg,audio/mp4,audio/x-m4a,.mp3,.m4a,.aac"
                                      className="sr-only"
                                      data-testid="input-track-audio"
                                      onChange={e => setTrackAudioFile(e.target.files?.[0] || null)}
                                    />
                                  </label>
                                  {trackAudioFile && (
                                    <button onClick={() => setTrackAudioFile(null)} className="text-muted-foreground hover:text-destructive">
                                      <X className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label className="text-xs">Обложка (необязательно)</Label>
                                <div className="flex items-center gap-2">
                                  <label className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border border-dashed cursor-pointer hover:bg-accent/10 transition-colors text-sm">
                                    <Image className="w-4 h-4 shrink-0" />
                                    <span className="truncate text-muted-foreground">
                                      {trackCoverFile ? trackCoverFile.name : "Выбрать обложку"}
                                    </span>
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="sr-only"
                                      data-testid="input-track-cover"
                                      onChange={e => setTrackCoverFile(e.target.files?.[0] || null)}
                                    />
                                  </label>
                                  {trackCoverFile && (
                                    <button onClick={() => setTrackCoverFile(null)} className="text-muted-foreground hover:text-destructive">
                                      <X className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              <Button
                                size="sm"
                                className="w-full"
                                disabled={!trackNewTitle.trim() || !trackAudioFile || trackUploading}
                                data-testid="button-track-upload"
                                onClick={async () => {
                                  if (!trackAudioFile || !trackNewTitle.trim() || !editingArtistSlug) return;
                                  setTrackUploading(true);
                                  try {
                                    // 1. Upload audio (presigned URL on production, direct upload on dev)
                                    const isProduction = window.location.hostname === "booomerangs.ru";
                                    let audioData: { url: string };
                                    if (isProduction) {
                                      // Production: upload directly to S3 via presigned URL (bypasses API Gateway 3MB limit)
                                      const presignResp = await fetch(`/api/admin/artists/${editingArtistSlug}/presign-audio`, {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": "application/json",
                                          "x-api-key": apiKey || "",
                                        },
                                        body: JSON.stringify({
                                          filename: trackAudioFile.name,
                                          contentType: trackAudioFile.type || "audio/mpeg",
                                        }),
                                      });
                                      const presignData = await presignResp.json();
                                      if (!presignResp.ok || presignData.error) throw new Error(presignData.error || "Ошибка получения URL для загрузки");
                                      const s3Resp = await fetch(presignData.uploadUrl, {
                                        method: "PUT",
                                        headers: { "Content-Type": trackAudioFile.type || "audio/mpeg" },
                                        body: trackAudioFile,
                                      });
                                      if (!s3Resp.ok) throw new Error(`Ошибка загрузки в хранилище: ${s3Resp.status}`);
                                      audioData = { url: presignData.publicUrl };
                                    } else {
                                      // Dev (Replit): send file through server as before (up to 20MB)
                                      const audioResp = await fetch(`/api/admin/artists/${editingArtistSlug}/upload-audio`, {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": trackAudioFile.type || "audio/mpeg",
                                          "x-api-key": apiKey || "",
                                          "x-filename": encodeURIComponent(trackAudioFile.name),
                                        },
                                        body: trackAudioFile,
                                      });
                                      audioData = await audioResp.json();
                                      if (!audioResp.ok || (audioData as any).error) throw new Error((audioData as any).error || "Ошибка загрузки аудио");
                                    }

                                    // 3. Get duration via HTML5 Audio
                                    const duration = await new Promise<number>((resolve) => {
                                      const a = new Audio();
                                      const url = URL.createObjectURL(trackAudioFile);
                                      a.src = url;
                                      a.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Math.round(a.duration) || 0); };
                                      a.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
                                      setTimeout(() => { URL.revokeObjectURL(url); resolve(0); }, 8000);
                                    });

                                    // 3. Upload cover (optional)
                                    let coverUrl = "";
                                    if (trackCoverFile) {
                                      const coverResp = await fetch(`/api/admin/artists/${editingArtistSlug}/upload-track-cover`, {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": trackCoverFile.type || "image/jpeg",
                                          "x-api-key": apiKey || "",
                                        },
                                        body: trackCoverFile,
                                      });
                                      const coverData = await coverResp.json();
                                      if (coverResp.ok && !coverData.error) coverUrl = coverData.url || "";
                                    }

                                    // 4. Create track record
                                    await adminFetch(`/api/admin/artists/${editingArtistSlug}/tracks`, apiKey, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ title: trackNewTitle.trim(), subtitle: trackNewSubtitle.trim(), audioUrl: audioData.url, coverUrl, duration, trackOrder: trackNewOrder }),
                                    });

                                    queryClient.invalidateQueries({ queryKey: ["/api/admin/artists", editingArtistSlug, "tracks"] });
                                    queryClient.invalidateQueries({ queryKey: [`/api/artists/${editingArtistSlug}/tracks`] });
                                    toast({ title: "Трек добавлен" });
                                    setTrackNewTitle(""); setTrackNewSubtitle(""); setTrackNewOrder(prev => prev + 1); setTrackAudioFile(null); setTrackCoverFile(null); setTrackFormOpen(false);
                                  } catch (err: any) {
                                    toast({ title: "Ошибка загрузки", description: err.message, variant: "destructive" });
                                  } finally {
                                    setTrackUploading(false);
                                  }
                                }}
                              >
                                {trackUploading ? (
                                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Загрузка...</>
                                ) : (
                                  <><Upload className="w-4 h-4 mr-2" />Загрузить и сохранить</>
                                )}
                              </Button>
                            </div>
                          )}

                          {/* Tracks list */}
                          {artistTracksQuery.isLoading ? (
                            <div className="text-sm text-muted-foreground text-center py-2">
                              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />Загрузка треков...
                            </div>
                          ) : artistTracksQuery.data?.tracks?.length === 0 ? (
                            <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                              <Music className="w-6 h-6 mx-auto mb-1 opacity-30" />
                              Треков пока нет. Добавьте первый.
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {(artistTracksQuery.data?.tracks || []).map((track: any) => (
                                <div key={track.id} data-testid={`admin-track-row-${track.id}`}>
                                  {trackEditingId === track.id ? (
                                    /* ── Inline edit form ── */
                                    <div className="p-3 rounded-lg border border-primary/30 bg-muted/30 space-y-3">
                                      <div className="flex items-center gap-2 mb-1">
                                        <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0 bg-muted">
                                          {track.coverUrl ? (
                                            <img src={track.coverUrl} alt="" className="w-full h-full object-cover" />
                                          ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                              <Music className="w-3 h-3 text-muted-foreground" />
                                            </div>
                                          )}
                                        </div>
                                        <span className="text-xs text-muted-foreground">Редактирование трека</span>
                                      </div>
                                      <div className="grid grid-cols-[1fr_80px] gap-2">
                                        <div>
                                          <Label className="text-xs mb-1 block">Название</Label>
                                          <Input
                                            value={trackEditTitle}
                                            onChange={e => setTrackEditTitle(e.target.value)}
                                            autoFocus
                                            data-testid={`input-track-edit-title-${track.id}`}
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs mb-1 block">Порядок</Label>
                                          <Input
                                            type="number"
                                            min={1}
                                            value={trackEditOrder}
                                            onChange={e => setTrackEditOrder(Number(e.target.value))}
                                            data-testid={`input-track-edit-order-${track.id}`}
                                          />
                                        </div>
                                        <div className="col-span-2">
                                          <Label className="text-xs mb-1 block">Исполнитель</Label>
                                          <Input
                                            value={trackEditSubtitle}
                                            onChange={e => setTrackEditSubtitle(e.target.value)}
                                            placeholder="Например: МОЛОДОСТЬ ВНУТРИ"
                                            data-testid={`input-track-edit-subtitle-${track.id}`}
                                          />
                                        </div>
                                      </div>
                                      <div className="flex gap-2">
                                        <Button
                                          size="sm"
                                          className="flex-1"
                                          disabled={!trackEditTitle.trim() || trackEditSaving}
                                          data-testid={`button-track-edit-save-${track.id}`}
                                          onClick={async () => {
                                            setTrackEditSaving(true);
                                            try {
                                              await adminFetch(`/api/admin/artists/tracks/${track.id}`, apiKey, {
                                                method: "PATCH",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({ title: trackEditTitle.trim(), subtitle: trackEditSubtitle.trim(), trackOrder: trackEditOrder }),
                                              });
                                              queryClient.invalidateQueries({ queryKey: ["/api/admin/artists", editingArtistSlug, "tracks"] });
                                              queryClient.invalidateQueries({ queryKey: [`/api/artists/${editingArtistSlug}/tracks`] });
                                              toast({ title: "Трек обновлён" });
                                              setTrackEditingId(null);
                                            } catch (err: any) {
                                              toast({ title: "Ошибка", description: err.message, variant: "destructive" });
                                            } finally {
                                              setTrackEditSaving(false);
                                            }
                                          }}
                                        >
                                          {trackEditSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                                          Сохранить
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => setTrackEditingId(null)}
                                          data-testid={`button-track-edit-cancel-${track.id}`}
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    /* ── Normal row ── */
                                    <div className="flex items-center gap-3 p-2.5 rounded-lg border bg-card">
                                      {/* Cover */}
                                      <div className="w-10 h-10 rounded-md overflow-hidden flex-shrink-0 bg-muted">
                                        {track.coverUrl ? (
                                          <img src={track.coverUrl} alt={track.title} className="w-full h-full object-cover" />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center">
                                            <Music className="w-4 h-4 text-muted-foreground" />
                                          </div>
                                        )}
                                      </div>

                                      {/* Info */}
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{track.title}</p>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                          {track.duration > 0 && (
                                            <span>{Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, "0")}</span>
                                          )}
                                          <span className="flex items-center gap-0.5">
                                            <Headphones className="w-3 h-3" />{track.plays}
                                          </span>
                                          <span>#{track.trackOrder}</span>
                                        </div>
                                      </div>

                                      {/* Active toggle */}
                                      <Switch
                                        checked={track.isActive}
                                        onCheckedChange={(checked) => toggleTrackMutation.mutate({ trackId: track.id, isActive: checked })}
                                        data-testid={`switch-track-active-${track.id}`}
                                      />

                                      {/* Edit */}
                                      <button
                                        className="text-muted-foreground hover:text-foreground transition-colors"
                                        onClick={() => {
                                          setTrackEditingId(track.id);
                                          setTrackEditTitle(track.title);
                                          setTrackEditSubtitle(track.subtitle || "");
                                          setTrackEditOrder(track.trackOrder);
                                        }}
                                        data-testid={`button-edit-track-${track.id}`}
                                        title="Редактировать"
                                      >
                                        <Pencil className="w-4 h-4" />
                                      </button>

                                      {/* Delete */}
                                      <button
                                        className="text-muted-foreground hover:text-destructive transition-colors"
                                        onClick={() => {
                                          if (confirm(`Удалить трек "${track.title}"?`)) {
                                            deleteTrackMutation.mutate(track.id);
                                          }
                                        }}
                                        data-testid={`button-delete-track-${track.id}`}
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Blog Pages Editor */}
            {selectedPage === "blog_pages" && (
              <div className="space-y-4">
                {editingBlogIndex === null ? (
                  <>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="font-medium">Страницы блога</h3>
                      <Button size="sm" variant="outline" onClick={() => blogPagesQuery.refetch()} data-testid="button-refresh-blog-pages">
                        <RefreshCw className="w-4 h-4 mr-1" /> Обновить
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Управляйте постами блога: создавайте новые и настраивайте детальные страницы.
                    </p>
                    {(() => {
                      const homePageData = homeSettingsForBlog.data;
                      const blogItems = homePageData?.blog?.items || [];
                      
                      const addNewBlogPost = async () => {
                        const currentItems = homePageData?.blog?.items || [];
                        const today = new Date();
                        const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
                        const dateStr = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;
                        const newItem = {
                          title: "Новый пост",
                          date: dateStr,
                          category: "",
                          excerpt: "",
                          image: "",
                        };
                        const updatedBlog = {
                          ...(homePageData?.blog || { title: "Культура и стиль", subtitle: "BMG Журнал", visible: true }),
                          items: [...currentItems, newItem],
                        };
                        try {
                          await adminFetch("/api/admin/page-settings/home/blog", apiKey, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(updatedBlog),
                          });
                          homeSettingsForBlog.refetch();
                          const newIdx = currentItems.length;
                          setEditingBlogIndex(newIdx);
                          setBlogPostSettings({
                            title: "Новый пост",
                            date: dateStr,
                            category: "",
                            badgeColor: "black",
                            author: "BMG Team",
                            excerpt: "",
                            image: "",
                            content: "",
                            contentImages: [],
                            tags: [],
                            quoteText: "",
                            quoteAuthor: "",
                            quoteVisible: false,
                            galleryTitle: "Галерея",
                            galleryImages: [],
                            galleryVisible: false,
                            videoUrl: "",
                            videoTitle: "Видео",
                            videoVisible: false,
                            productsTitle: "Товары из статьи",
                            productsCategory: "",
                            productsSubcategory: "",
                            productsLinkText: "Все товары",
                            productsVisible: false,
                            linkedProducts: [],
                            seoTitle: "",
                            seoDescription: "",
                            slug: "",
                            visible: true,
                          });
                          toast({ title: "Пост создан", description: "Заполните настройки нового поста" });
                        } catch (err: any) {
                          toast({ title: "Ошибка", description: err.message, variant: "destructive" });
                        }
                      };

                      return (
                        <div className="space-y-3">
                          <Button onClick={addNewBlogPost} data-testid="button-add-blog-post">
                            <Plus className="w-4 h-4 mr-2" /> Добавить пост
                          </Button>

                          {blogItems.length === 0 && (
                            <div className="text-center py-8 text-muted-foreground">
                              Нет постов в блоге. Нажмите "Добавить пост" чтобы создать первый.
                            </div>
                          )}

                          <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: "x mandatory" }}>
                            {blogItems.map((post: any, idx: number) => {
                              const pageData = blogPagesQuery.data?.[String(idx)];
                              const isConfigured = !!pageData;
                              return (
                                <Card key={idx} className={`flex-shrink-0 w-48 ${isConfigured ? "" : "border-amber-500/50"}`} style={{ scrollSnapAlign: "start" }}>
                                  <CardContent className="p-0">
                                    <div className="relative w-full h-28 bg-muted rounded-t-md">
                                      {post.image ? (
                                        <img src={post.image} alt={post.title} className="w-full h-28 rounded-t-md object-cover" />
                                      ) : (
                                        <div className="w-full h-28 flex items-center justify-center text-muted-foreground">
                                          <ImageIcon className="w-8 h-8" />
                                        </div>
                                      )}
                                      <Badge variant={isConfigured ? "secondary" : "outline"} className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0">
                                        {isConfigured ? "OK" : "—"}
                                      </Badge>
                                    </div>
                                    <div className="p-2.5 space-y-2">
                                      <div>
                                        <div className="font-medium text-sm leading-tight line-clamp-2">{post.title || `Пост ${idx + 1}`}</div>
                                        <div className="text-[11px] text-muted-foreground mt-0.5">{post.date || `/blog/${idx}`}</div>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <Button
                                          size="sm"
                                          variant="default"
                                          className="flex-1 text-xs"
                                          onClick={() => {
                                            setEditingBlogIndex(idx);
                                            const existing = blogPagesQuery.data?.[String(idx)] || {};
                                            setBlogPostSettings({
                                              title: post.title || "",
                                              date: post.date || "",
                                              category: post.category || "",
                                              badgeColor: "black",
                                              author: post.author || "BMG Team",
                                              excerpt: post.excerpt || "",
                                              image: post.image || "",
                                              content: "",
                                              contentImages: [],
                                              tags: ["Streetwear", "Style", "BMG"],
                                              quoteText: "",
                                              quoteAuthor: "",
                                              quoteVisible: false,
                                              galleryTitle: "Галерея",
                                              galleryImages: [],
                                              galleryVisible: false,
                                              videoUrl: "",
                                              videoTitle: "Видео",
                                              videoVisible: false,
                                              productsTitle: "Товары из статьи",
                                              productsCategory: "",
                                              productsSubcategory: "",
                                              productsLinkText: "Все товары",
                                              productsVisible: false,
                                              linkedProducts: [],
                                              seoTitle: "",
                                              seoDescription: "",
                                              slug: "",
                                              visible: true,
                                              ...existing,
                                            });
                                          }}
                                          data-testid={`button-edit-blog-${idx}`}
                                        >
                                          <Pencil className="w-3 h-3 mr-1" /> Настроить
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          onClick={async () => {
                                            if (!confirm(`Удалить пост "${post.title || `Пост ${idx + 1}`}"?`)) return;
                                            const currentItems = [...(homePageData?.blog?.items || [])];
                                            currentItems.splice(idx, 1);
                                            const updatedBlog = {
                                              ...(homePageData?.blog || {}),
                                              items: currentItems,
                                            };
                                            try {
                                              await adminFetch("/api/admin/page-settings/home/blog", apiKey, {
                                                method: "POST",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify(updatedBlog),
                                              });
                                              const allPageData = blogPagesQuery.data || {};
                                              const totalOld = blogItems.length;
                                              for (let i = idx; i < totalOld - 1; i++) {
                                                const nextData = allPageData[String(i + 1)];
                                                if (nextData) {
                                                  await adminFetch(`/api/admin/page-settings/blog_pages/${i}`, apiKey, {
                                                    method: "POST",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify(nextData),
                                                  });
                                                }
                                              }
                                              const lastIdx = totalOld - 1;
                                              await adminFetch(`/api/admin/page-settings/blog_pages/${lastIdx}`, apiKey, {
                                                method: "POST",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({}),
                                              });
                                              homeSettingsForBlog.refetch();
                                              blogPagesQuery.refetch();
                                              toast({ title: "Пост удалён" });
                                            } catch (err: any) {
                                              toast({ title: "Ошибка", description: err.message, variant: "destructive" });
                                            }
                                          }}
                                          data-testid={`button-delete-blog-${idx}`}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditingBlogIndex(null)} data-testid="button-back-blog-list">
                          <ArrowLeft className="w-4 h-4" />
                        </Button>
                        <h3 className="font-medium">Пост: {blogPostSettings.title || `Пост ${editingBlogIndex + 1}`}</h3>
                      </div>
                      <Button
                        size="sm"
                        onClick={async () => {
                          saveBlogPostMutation.mutate({
                            postIndex: editingBlogIndex!,
                            settings: blogPostSettings,
                          });
                          try {
                            const homeData = homeSettingsForBlog.data;
                            const currentItems = [...(homeData?.blog?.items || [])];
                            if (editingBlogIndex !== null && editingBlogIndex < currentItems.length) {
                              currentItems[editingBlogIndex] = {
                                ...currentItems[editingBlogIndex],
                                title: blogPostSettings.title,
                                date: blogPostSettings.date,
                                category: blogPostSettings.category,
                                excerpt: blogPostSettings.excerpt,
                                image: blogPostSettings.image,
                              };
                              await adminFetch("/api/admin/page-settings/home/blog", apiKey, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ ...(homeData?.blog || {}), items: currentItems }),
                              });
                              homeSettingsForBlog.refetch();
                            }
                          } catch {}
                        }}
                        disabled={saveBlogPostMutation.isPending}
                        data-testid="button-save-blog-post"
                      >
                        <Save className="w-4 h-4 mr-1" />
                        {saveBlogPostMutation.isPending ? "Сохранение..." : "Сохранить"}
                      </Button>
                    </div>

                    <div className="space-y-6">
                      {/* Basic Info */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Основная информация</Label>
                            <Switch
                              checked={blogPostSettings.visible !== false}
                              onCheckedChange={(v) => setBlogPostSettings({...blogPostSettings, visible: v})}
                              data-testid="switch-blog-visible"
                            />
                          </div>
                          <div>
                            <Label className="text-sm">Заголовок</Label>
                            <Input
                              value={blogPostSettings.title || ""}
                              onChange={(e) => setBlogPostSettings({...blogPostSettings, title: e.target.value})}
                              placeholder="Заголовок статьи"
                              data-testid="input-blog-title"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-sm">Дата</Label>
                              <Input
                                value={blogPostSettings.date || ""}
                                onChange={(e) => setBlogPostSettings({...blogPostSettings, date: e.target.value})}
                                placeholder="15 января 2026"
                                data-testid="input-blog-date"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Категория / Бейдж</Label>
                              <Input
                                value={blogPostSettings.category || ""}
                                onChange={(e) => setBlogPostSettings({...blogPostSettings, category: e.target.value})}
                                placeholder="Коллекции"
                                maxLength={20}
                                data-testid="input-blog-category"
                              />
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {["Коллекции", "Лукбук", "Коллаборации", "Новости", "Стиль"].map((preset) => (
                                  <Button
                                    key={preset}
                                    variant={blogPostSettings.category === preset ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setBlogPostSettings({...blogPostSettings, category: preset})}
                                    data-testid={`button-blog-badge-preset-${preset}`}
                                  >
                                    {preset}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div>
                            <Label className="text-sm">Цвет бейджа</Label>
                            <div className="flex flex-wrap items-center gap-3 mt-2">
                              {[
                                { id: "black", label: "Чёрный", bg: "#1C1C1C", text: "#FFFFFF" },
                                { id: "white", label: "Белый", bg: "#FFFFFF", text: "#1C1C1C" },
                                { id: "red", label: "Красный", bg: "#E53935", text: "#FFFFFF" },
                                { id: "gray", label: "Серый", bg: "#6B7280", text: "#FFFFFF" },
                                { id: "beige", label: "Бежевый", bg: "#D4C5A9", text: "#1C1C1C" },
                              ].map((color) => (
                                <button
                                  key={color.id}
                                  type="button"
                                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md border-2 transition-all ${
                                    (blogPostSettings.badgeColor || "black") === color.id 
                                      ? "border-primary ring-2 ring-primary/20" 
                                      : "border-transparent hover:border-muted-foreground/30"
                                  }`}
                                  onClick={() => setBlogPostSettings({...blogPostSettings, badgeColor: color.id})}
                                  data-testid={`button-blog-badge-color-${color.id}`}
                                >
                                  <span
                                    className="w-6 h-6 rounded-full border border-muted-foreground/20 flex-shrink-0"
                                    style={{ backgroundColor: color.bg }}
                                  />
                                  <span className="text-xs">{color.label}</span>
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                              Предпросмотр:
                              {(() => {
                                const colors: Record<string, { bg: string; text: string }> = {
                                  black: { bg: "#1C1C1C", text: "#FFFFFF" },
                                  white: { bg: "#FFFFFF", text: "#1C1C1C" },
                                  red: { bg: "#E53935", text: "#FFFFFF" },
                                  gray: { bg: "#6B7280", text: "#FFFFFF" },
                                  beige: { bg: "#D4C5A9", text: "#1C1C1C" },
                                };
                                const c = colors[blogPostSettings.badgeColor || "black"] || colors.black;
                                return (
                                  <span
                                    className="px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider border border-white/20"
                                    style={{ backgroundColor: c.bg, color: c.text }}
                                    data-testid="text-blog-badge-preview"
                                  >
                                    {blogPostSettings.category || "Коллекции"}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                          <div>
                            <Label className="text-sm">Автор</Label>
                            <Input
                              value={blogPostSettings.author || ""}
                              onChange={(e) => setBlogPostSettings({...blogPostSettings, author: e.target.value})}
                              placeholder="BMG Team"
                              data-testid="input-blog-author"
                            />
                          </div>
                          <div>
                            <Label className="text-sm">Краткое описание (для карточки)</Label>
                            <Textarea
                              value={blogPostSettings.excerpt || ""}
                              onChange={(e) => setBlogPostSettings({...blogPostSettings, excerpt: e.target.value})}
                              placeholder="Краткое описание поста для карточки на главной"
                              rows={2}
                              data-testid="input-blog-excerpt"
                            />
                          </div>
                        </CardContent>
                      </Card>

                      {/* Hero Image */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <Label className="font-medium">Главное изображение</Label>
                          <MediaUploadField
                            type="image"
                            value={blogPostSettings.image || ""}
                            onChange={(url) => setBlogPostSettings({...blogPostSettings, image: url})}
                            apiKey={apiKey}
                            placeholder="URL изображения статьи"
                          />
                        </CardContent>
                      </Card>

                      {/* Content */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <Label className="font-medium">Содержание статьи (HTML)</Label>
                          <p className="text-xs text-muted-foreground">
                            Используйте HTML-теги для форматирования: &lt;p&gt; для абзацев, &lt;h3&gt; для подзаголовков, &lt;blockquote&gt; для цитат, &lt;strong&gt; для жирного текста, &lt;ul&gt;&lt;li&gt; для списков.
                          </p>
                          <Textarea
                            value={blogPostSettings.content || ""}
                            onChange={(e) => setBlogPostSettings({...blogPostSettings, content: e.target.value})}
                            placeholder="<p>Текст статьи...</p>&#10;&#10;<h3>Подзаголовок</h3>&#10;<p>Продолжение текста...</p>"
                            rows={15}
                            className="font-mono text-sm"
                            data-testid="input-blog-content"
                          />
                          {blogPostSettings.content && (
                            <div className="border rounded-md p-4">
                              <Label className="text-sm text-muted-foreground mb-2 block">Предпросмотр:</Label>
                              <div
                                className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-p:text-muted-foreground"
                                dangerouslySetInnerHTML={{ __html: blogPostSettings.content }}
                              />
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      {/* Additional Content Images */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Дополнительные изображения</Label>
                            <Button size="sm" variant="outline" onClick={() => {
                              setBlogPostSettings({
                                ...blogPostSettings,
                                contentImages: [...(blogPostSettings.contentImages || []), ""],
                              });
                            }}>
                              <Plus className="w-3 h-3 mr-1" /> Добавить
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Загруженные изображения автоматически отображаются под текстом статьи в виде сетки.
                          </p>
                          {(blogPostSettings.contentImages || []).map((img: string, idx: number) => (
                            <div key={idx} className="flex items-start gap-2">
                              <div className="flex-1">
                                <MediaUploadField
                                  type="image"
                                  value={img}
                                  onChange={(url) => {
                                    const imgs = [...(blogPostSettings.contentImages || [])];
                                    imgs[idx] = url;
                                    setBlogPostSettings({...blogPostSettings, contentImages: imgs});
                                  }}
                                  apiKey={apiKey}
                                  placeholder="URL изображения"
                                />
                              </div>
                              <Button size="sm" variant="destructive" onClick={() => {
                                const imgs = [...(blogPostSettings.contentImages || [])];
                                imgs.splice(idx, 1);
                                setBlogPostSettings({...blogPostSettings, contentImages: imgs});
                              }}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </CardContent>
                      </Card>

                      {/* Quote Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Цитата</Label>
                            <Switch
                              checked={blogPostSettings.quoteVisible === true}
                              onCheckedChange={(v) => setBlogPostSettings({...blogPostSettings, quoteVisible: v})}
                              data-testid="switch-blog-quote-visible"
                            />
                          </div>
                          <Textarea
                            value={blogPostSettings.quoteText || ""}
                            onChange={(e) => setBlogPostSettings({...blogPostSettings, quoteText: e.target.value})}
                            placeholder="Текст цитаты"
                            rows={3}
                            data-testid="input-blog-quote-text"
                          />
                          <Input
                            value={blogPostSettings.quoteAuthor || ""}
                            onChange={(e) => setBlogPostSettings({...blogPostSettings, quoteAuthor: e.target.value})}
                            placeholder="Автор цитаты"
                            data-testid="input-blog-quote-author"
                          />
                        </CardContent>
                      </Card>

                      {/* Gallery Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Галерея</Label>
                            <Switch
                              checked={blogPostSettings.galleryVisible === true}
                              onCheckedChange={(v) => setBlogPostSettings({...blogPostSettings, galleryVisible: v})}
                              data-testid="switch-blog-gallery-visible"
                            />
                          </div>
                          <Input
                            value={blogPostSettings.galleryTitle || ""}
                            onChange={(e) => setBlogPostSettings({...blogPostSettings, galleryTitle: e.target.value})}
                            placeholder="Заголовок галереи"
                            data-testid="input-blog-gallery-title"
                          />
                          <div>
                            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                              <Label className="text-sm">Фотографии</Label>
                              <Button size="sm" variant="outline" onClick={() => {
                                setBlogPostSettings({
                                  ...blogPostSettings,
                                  galleryImages: [...(blogPostSettings.galleryImages || []), ""],
                                });
                              }} data-testid="button-blog-gallery-add">
                                <Plus className="w-3 h-3 mr-1" /> Добавить
                              </Button>
                            </div>
                            {(blogPostSettings.galleryImages || []).map((img: string, idx: number) => (
                              <div key={idx} className="flex items-start gap-2 mb-2">
                                <div className="flex-1">
                                  <MediaUploadField
                                    type="image"
                                    value={img}
                                    onChange={(url) => {
                                      const imgs = [...(blogPostSettings.galleryImages || [])];
                                      imgs[idx] = url;
                                      setBlogPostSettings({...blogPostSettings, galleryImages: imgs});
                                    }}
                                    apiKey={apiKey}
                                    placeholder="URL фото"
                                  />
                                </div>
                                <Button size="sm" variant="destructive" onClick={() => {
                                  const imgs = [...(blogPostSettings.galleryImages || [])];
                                  imgs.splice(idx, 1);
                                  setBlogPostSettings({...blogPostSettings, galleryImages: imgs});
                                }}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Video Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Видео</Label>
                            <Switch
                              checked={blogPostSettings.videoVisible === true}
                              onCheckedChange={(v) => setBlogPostSettings({...blogPostSettings, videoVisible: v})}
                              data-testid="switch-blog-video-visible"
                            />
                          </div>
                          <Input
                            value={blogPostSettings.videoTitle || ""}
                            onChange={(e) => setBlogPostSettings({...blogPostSettings, videoTitle: e.target.value})}
                            placeholder="Заголовок"
                            data-testid="input-blog-video-title"
                          />
                          <MediaUploadField
                            type="video"
                            value={blogPostSettings.videoUrl || ""}
                            onChange={(url) => setBlogPostSettings({...blogPostSettings, videoUrl: url})}
                            apiKey={apiKey}
                            placeholder="YouTube/VK URL или загрузите видео"
                          />
                          <p className="text-xs text-muted-foreground">Поддержка: YouTube, VK Video или прямая ссылка</p>
                        </CardContent>
                      </Card>

                      {/* Products Section */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Товары из статьи</Label>
                            <Switch
                              checked={blogPostSettings.productsVisible === true}
                              onCheckedChange={(v) => setBlogPostSettings({...blogPostSettings, productsVisible: v})}
                              data-testid="switch-blog-products-visible"
                            />
                          </div>
                          <Input
                            value={blogPostSettings.productsTitle || ""}
                            onChange={(e) => setBlogPostSettings({...blogPostSettings, productsTitle: e.target.value})}
                            placeholder="Заголовок секции товаров"
                            data-testid="input-blog-products-title"
                          />
                          <div>
                            <Label className="text-sm">Категория</Label>
                            <Select
                              value={blogPostSettings.productsCategory || ""}
                              onValueChange={(v) => setBlogPostSettings({...blogPostSettings, productsCategory: v, productsSubcategory: ""})}
                            >
                              <SelectTrigger data-testid="select-blog-products-category">
                                <SelectValue placeholder="Выберите категорию" />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(CATEGORIES) as CategorySlug[]).map((slug) => (
                                  <SelectItem key={slug} value={slug}>{CATEGORIES[slug].name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {blogPostSettings.productsCategory && CATEGORIES[blogPostSettings.productsCategory as CategorySlug]?.subcategories?.length > 0 && (
                            <div>
                              <Label className="text-sm">Подкатегория</Label>
                              <Select
                                value={blogPostSettings.productsSubcategory || "__all__"}
                                onValueChange={(v) => setBlogPostSettings({...blogPostSettings, productsSubcategory: v === "__all__" ? "" : v})}
                              >
                                <SelectTrigger data-testid="select-blog-products-subcategory">
                                  <SelectValue placeholder="Все подкатегории" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__all__">Все подкатегории</SelectItem>
                                  {CATEGORIES[blogPostSettings.productsCategory as CategorySlug]?.subcategories.map((sub) => (
                                    <SelectItem key={sub.name} value={sub.name}>{sub.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          <Input
                            value={blogPostSettings.productsLinkText || ""}
                            onChange={(e) => setBlogPostSettings({...blogPostSettings, productsLinkText: e.target.value})}
                            placeholder="Текст ссылки (Все товары)"
                            data-testid="input-blog-products-link-text"
                          />

                          <div className="pt-2 border-t">
                            <Label className="text-sm font-medium">Привязанные товары</Label>
                            <p className="text-xs text-muted-foreground mb-2">Конкретные товары, которые будут показаны в статье</p>

                            {blogLinkedProductDetails.length > 0 && (
                              <div className="space-y-2 mb-3">
                                {blogLinkedProductDetails.map((p: any) => (
                                  <div key={p.id} className="flex items-center gap-3 p-2 border rounded-md bg-muted/30">
                                    <img
                                      src={p.thumbnailUrl || p.imageUrl}
                                      alt={p.name}
                                      className="w-10 h-12 object-cover rounded"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate" data-testid={`text-blog-linked-product-${p.id}`}>{p.name}</p>
                                      <p className="text-xs text-muted-foreground">{p.price ? `${(p.price / 100).toLocaleString('ru-RU')} ₽` : ''}</p>
                                      <Input
                                        value={(blogPostSettings.linkedProductButtons || {})[p.id] || ""}
                                        onChange={(e) => setBlogPostSettings({
                                          ...blogPostSettings,
                                          linkedProductButtons: {
                                            ...(blogPostSettings.linkedProductButtons || {}),
                                            [p.id]: e.target.value
                                          }
                                        })}
                                        placeholder={p.name}
                                        className="mt-1"
                                        data-testid={`input-blog-linked-button-text-${p.id}`}
                                      />
                                      <p className="text-xs text-muted-foreground mt-0.5">Текст кнопки (если пусто — название товара)</p>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        const newButtons = { ...(blogPostSettings.linkedProductButtons || {}) };
                                        delete newButtons[p.id];
                                        setBlogPostSettings({
                                          ...blogPostSettings,
                                          linkedProducts: (blogPostSettings.linkedProducts || []).filter((id: number) => id !== p.id),
                                          linkedProductButtons: newButtons
                                        });
                                      }}
                                      data-testid={`button-remove-blog-linked-${p.id}`}
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="relative">
                              <div className="flex items-center gap-2">
                                <Search className="w-4 h-4 text-muted-foreground" />
                                <Input
                                  value={blogProductSearchQuery}
                                  onChange={(e) => setBlogProductSearchQuery(e.target.value)}
                                  placeholder="Поиск товара по названию, артикулу или ID..."
                                  className="flex-1"
                                  data-testid="input-blog-product-search"
                                />
                              </div>
                              {blogProductSearchResults.length > 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
                                  {blogProductSearchResults.map((p: any) => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      className="w-full flex items-center gap-3 p-2 text-left hover-elevate transition-colors"
                                      onClick={() => {
                                        setBlogPostSettings({
                                          ...blogPostSettings,
                                          linkedProducts: [...(blogPostSettings.linkedProducts || []), p.id]
                                        });
                                        setBlogProductSearchQuery("");
                                      }}
                                      data-testid={`button-add-blog-linked-${p.id}`}
                                    >
                                      <img
                                        src={p.thumbnailUrl || p.imageUrl}
                                        alt={p.name}
                                        className="w-8 h-10 object-cover rounded"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm truncate">{p.name}</p>
                                        <p className="text-xs text-muted-foreground">{p.category} · {p.price ? `${(p.price / 100).toLocaleString('ru-RU')} ₽` : ''}</p>
                                      </div>
                                      <Plus className="w-4 h-4 text-muted-foreground" />
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Tags */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Label className="font-medium">Теги</Label>
                            <Button size="sm" variant="outline" onClick={() => {
                              setBlogPostSettings({
                                ...blogPostSettings,
                                tags: [...(blogPostSettings.tags || []), ""],
                              });
                            }}>
                              <Plus className="w-3 h-3 mr-1" /> Добавить
                            </Button>
                          </div>
                          {(blogPostSettings.tags || []).map((tag: string, idx: number) => (
                            <div key={idx} className="flex items-center gap-2">
                              <Input
                                value={tag}
                                onChange={(e) => {
                                  const tags = [...(blogPostSettings.tags || [])];
                                  tags[idx] = e.target.value;
                                  setBlogPostSettings({...blogPostSettings, tags});
                                }}
                                placeholder="Тег"
                                data-testid={`input-blog-tag-${idx}`}
                              />
                              <Button size="sm" variant="destructive" onClick={() => {
                                const tags = [...(blogPostSettings.tags || [])];
                                tags.splice(idx, 1);
                                setBlogPostSettings({...blogPostSettings, tags});
                              }}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </CardContent>
                      </Card>

                      {/* SEO */}
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <Label className="font-medium">SEO</Label>
                          <div>
                            <Label className="text-sm">SEO заголовок</Label>
                            <Input
                              value={blogPostSettings.seoTitle || ""}
                              onChange={(e) => setBlogPostSettings({...blogPostSettings, seoTitle: e.target.value})}
                              placeholder="SEO заголовок (title)"
                              data-testid="input-blog-seo-title"
                            />
                          </div>
                          <div>
                            <Label className="text-sm">SEO описание</Label>
                            <Textarea
                              value={blogPostSettings.seoDescription || ""}
                              onChange={(e) => setBlogPostSettings({...blogPostSettings, seoDescription: e.target.value})}
                              placeholder="SEO описание (meta description)"
                              rows={2}
                              data-testid="input-blog-seo-description"
                            />
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Vacancies Manager */}
            {selectedPage === "vacancies" && (
              <VacanciesEditor 
                pageSettingsQuery={pageSettingsQuery}
                savePageSectionMutation={savePageSectionMutation}
              />
            )}

            {/* Concept Page (Pre-drop) Banner Editor */}
            {selectedPage === "concept" && (
              <ConceptPageEditor apiKey={apiKey} />
            )}

            {selectedPage === "static_pages" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { id: "privacy", label: "Политика конфиденциальности" },
                    { id: "terms", label: "Публичная оферта" },
                    { id: "faq", label: "Частые вопросы" },
                    { id: "about", label: "О бренде" },
                    { id: "care", label: "Уход за товаром" },
                  ].map(tab => (
                    <Button
                      key={tab.id}
                      size="sm"
                      variant={staticPageTab === tab.id ? "secondary" : "ghost"}
                      onClick={() => setStaticPageTab(tab.id)}
                      data-testid={`button-static-page-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  ))}
                </div>

                {staticPageQuery.isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : staticPageTab === "faq" ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground">Вопросы и ответы ({faqItems.length})</h3>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setFaqItems([...faqItems, { question: "", answer: "" }])}
                          data-testid="button-add-faq"
                        >
                          <Plus className="w-4 h-4 mr-1" /> Добавить вопрос
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveStaticPageMutation.mutate({ pageKey: "faq", settings: { items: faqItems } })}
                          disabled={saveStaticPageMutation.isPending}
                          data-testid="button-save-faq"
                        >
                          {saveStaticPageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                          Сохранить
                        </Button>
                      </div>
                    </div>
                    {faqItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">Нет вопросов. Нажмите "Добавить вопрос" для начала.</p>
                    ) : (
                      <div className="space-y-3">
                        {faqItems.map((item, idx) => (
                          <Card key={idx}>
                            <CardContent className="p-4 space-y-3">
                              <div className="flex items-start gap-2">
                                <div className="flex-1 space-y-3">
                                  <div>
                                    <Label className="text-xs text-muted-foreground mb-1 block">Вопрос</Label>
                                    <Input
                                      value={item.question}
                                      onChange={e => {
                                        const updated = [...faqItems];
                                        updated[idx] = { ...updated[idx], question: e.target.value };
                                        setFaqItems(updated);
                                      }}
                                      placeholder="Введите вопрос..."
                                      data-testid={`input-faq-question-${idx}`}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-muted-foreground mb-1 block">Ответ</Label>
                                    <Textarea
                                      value={item.answer}
                                      onChange={e => {
                                        const updated = [...faqItems];
                                        updated[idx] = { ...updated[idx], answer: e.target.value };
                                        setFaqItems(updated);
                                      }}
                                      placeholder="Введите ответ..."
                                      rows={3}
                                      data-testid={`input-faq-answer-${idx}`}
                                    />
                                  </div>
                                </div>
                                <div className="flex flex-col gap-1 pt-5">
                                  {idx > 0 && (
                                    <Button size="icon" variant="ghost" onClick={() => {
                                      const updated = [...faqItems];
                                      [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
                                      setFaqItems(updated);
                                    }} data-testid={`button-faq-up-${idx}`}>
                                      <ArrowUp className="w-4 h-4" />
                                    </Button>
                                  )}
                                  {idx < faqItems.length - 1 && (
                                    <Button size="icon" variant="ghost" onClick={() => {
                                      const updated = [...faqItems];
                                      [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
                                      setFaqItems(updated);
                                    }} data-testid={`button-faq-down-${idx}`}>
                                      <ArrowDown className="w-4 h-4" />
                                    </Button>
                                  )}
                                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => {
                                    setFaqItems(faqItems.filter((_, i) => i !== idx));
                                  }} data-testid={`button-faq-delete-${idx}`}>
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                ) : staticPageTab === "about" ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground">О бренде</h3>
                      <Button
                        size="sm"
                        onClick={() => saveStaticPageMutation.mutate({ pageKey: "about", settings: aboutFields })}
                        disabled={saveStaticPageMutation.isPending}
                        data-testid="button-save-about"
                      >
                        {saveStaticPageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                        Сохранить
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Заголовок (основной)</Label>
                        <Input
                          value={aboutFields.title}
                          onChange={e => setAboutFields(prev => ({ ...prev, title: e.target.value }))}
                          placeholder="Мы —"
                          data-testid="input-about-title"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Заголовок (акцент, красным)</Label>
                        <Input
                          value={aboutFields.titleAccent}
                          onChange={e => setAboutFields(prev => ({ ...prev, titleAccent: e.target.value }))}
                          placeholder="Boomerangs"
                          data-testid="input-about-title-accent"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Описание</Label>
                      <Textarea
                        value={aboutFields.description}
                        onChange={e => setAboutFields(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Описание бренда..."
                        rows={5}
                        data-testid="textarea-about-description"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground block">Изображение 1</Label>
                        <MediaUploadField
                          value={aboutFields.image1}
                          onChange={(url) => setAboutFields(prev => ({ ...prev, image1: url }))}
                          apiKey={apiKey}
                          placeholder="URL или перетащите изображение"
                        />
                        <Input
                          value={aboutFields.image1Alt}
                          onChange={e => setAboutFields(prev => ({ ...prev, image1Alt: e.target.value }))}
                          placeholder="Alt-текст изображения 1"
                          data-testid="input-about-image1-alt"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground block">Изображение 2</Label>
                        <MediaUploadField
                          value={aboutFields.image2}
                          onChange={(url) => setAboutFields(prev => ({ ...prev, image2: url }))}
                          apiKey={apiKey}
                          placeholder="URL или перетащите изображение"
                        />
                        <Input
                          value={aboutFields.image2Alt}
                          onChange={e => setAboutFields(prev => ({ ...prev, image2Alt: e.target.value }))}
                          placeholder="Alt-текст изображения 2"
                          data-testid="input-about-image2-alt"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Цитата</Label>
                      <Input
                        value={aboutFields.quote}
                        onChange={e => setAboutFields(prev => ({ ...prev, quote: e.target.value }))}
                        placeholder="Текст цитаты..."
                        data-testid="input-about-quote"
                      />
                    </div>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-3">Предпросмотр:</p>
                        <div className="space-y-4">
                          <div className="text-center">
                            <h2 className="text-2xl font-bold uppercase tracking-tight">
                              {aboutFields.title} <span className="text-primary">{aboutFields.titleAccent}</span>
                            </h2>
                          </div>
                          <p className="text-sm text-muted-foreground">{aboutFields.description}</p>
                          <div className="grid grid-cols-2 gap-3">
                            {aboutFields.image1 && <img src={aboutFields.image1} alt={aboutFields.image1Alt} className="w-full h-24 object-cover rounded-md" />}
                            {aboutFields.image2 && <img src={aboutFields.image2} alt={aboutFields.image2Alt} className="w-full h-24 object-cover rounded-md" />}
                          </div>
                          {aboutFields.quote && (
                            <blockquote className="border-l-4 border-primary pl-4 text-sm italic text-muted-foreground">
                              "{aboutFields.quote}"
                            </blockquote>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground">
                        {staticPageTab === "privacy" && "Политика конфиденциальности"}
                        {staticPageTab === "terms" && "Публичная оферта"}
                        {staticPageTab === "care" && "Уход за товаром"}
                      </h3>
                      <Button
                        size="sm"
                        onClick={() => saveStaticPageMutation.mutate({ pageKey: staticPageTab, settings: { content: staticPageContent } })}
                        disabled={saveStaticPageMutation.isPending}
                        data-testid="button-save-static-page"
                      >
                        {saveStaticPageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                        Сохранить
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Поддерживается HTML-разметка. Контент отображается внутри блока с классом prose.</p>
                    {staticPageTab === "care" && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2">
                        💡 Если поле пустое — на странице /care отображается встроенный красивый дизайн с карточками по умолчанию. Заполните поле, чтобы заменить его на свой HTML.
                      </p>
                    )}
                    <Textarea
                      value={staticPageContent}
                      onChange={e => setStaticPageContent(e.target.value)}
                      placeholder={staticPageTab === "care" ? "Оставьте пустым для стандартного дизайна или введите HTML-контент..." : "Введите HTML-контент страницы..."}
                      rows={20}
                      className="font-mono text-sm"
                      data-testid="textarea-static-page-content"
                    />
                    {staticPageContent && (
                      <div className="border rounded-md p-4">
                        <p className="text-xs text-muted-foreground mb-2">Предпросмотр:</p>
                        <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: staticPageContent }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Product Editor */}
            {selectedPage === "product" && (
              <div className="space-y-4">
                {/* Search and Create buttons */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                    <Input
                      placeholder="Введите название товара или ID..."
                      value={productSearchQuery}
                      onChange={(e) => setProductSearchQuery(e.target.value)}
                      className="pl-9"
                      data-testid="input-product-search"
                    />
                    {/* Search results dropdown */}
                    {editorSearchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg z-50 max-h-80 overflow-y-auto">
                        {editorSearchResults.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center gap-3 p-2 hover-elevate cursor-pointer border-b last:border-b-0"
                            onClick={() => {
                              loadProductForEdit(p.id);
                              setProductSearchQuery("");
                            }}
                            data-testid={`search-result-${p.id}`}
                          >
                            <img 
                              src={p.thumbnailUrl || p.imageUrl || "/placeholder.svg"} 
                              alt="" 
                              className="w-10 h-10 object-cover rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{p.name}</div>
                              <div className="text-xs text-muted-foreground">
                                ID: {p.id} {p.sku && `• SKU: ${p.sku}`}
                              </div>
                            </div>
                            <div className="text-sm font-medium">
                              {(p.price / 100).toLocaleString('ru-RU')} ₽
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={() => {
                      resetProductForm();
                      setIsCreatingProduct(true);
                      setEditingProductId(null);
                    }}
                    data-testid="button-create-product"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Создать товар
                  </Button>
                </div>

                {/* Editor form */}
                {(editingProductId || isCreatingProduct) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Pencil className="w-4 h-4" />
                          {isCreatingProduct ? "Создание товара" : `Редактирование товара #${editingProductId}`}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            resetProductForm();
                            setIsCreatingProduct(false);
                          }}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Basic info */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <Label className="text-sm">Название товара *</Label>
                          <Input
                            value={productForm.name}
                            onChange={(e) => setProductForm({...productForm, name: e.target.value})}
                            placeholder="Футболка BOOO Classic"
                            data-testid="input-product-name"
                          />
                        </div>
                        <div>
                          <Label className="text-sm">Артикул (SKU)</Label>
                          <Input
                            value={productForm.sku}
                            onChange={(e) => setProductForm({...productForm, sku: e.target.value})}
                            placeholder="T-001"
                            data-testid="input-product-sku"
                          />
                        </div>
                        <div>
                          <Label className="text-sm">Цвет</Label>
                          <Input
                            value={productForm.color}
                            onChange={(e) => setProductForm({...productForm, color: e.target.value})}
                            placeholder="Черный"
                            data-testid="input-product-color"
                          />
                        </div>
                        <div>
                          <Label className="text-sm">Цена (в рублях) *</Label>
                          <Input
                            type="number"
                            value={productForm.price ? String(parseInt(productForm.price) / 100) : ""}
                            onChange={(e) => setProductForm({...productForm, price: String(parseInt(e.target.value || "0") * 100)})}
                            placeholder="2990"
                            data-testid="input-product-price"
                          />
                        </div>
                        <div>
                          <Label className="text-sm">Оптовая цена (в рублях)</Label>
                          <Input
                            type="number"
                            value={productForm.wholesalePrice ? String(parseInt(productForm.wholesalePrice) / 100) : ""}
                            onChange={(e) => setProductForm({...productForm, wholesalePrice: String(parseInt(e.target.value || "0") * 100)})}
                            placeholder="1990"
                            data-testid="input-product-wholesale-price"
                          />
                        </div>
                        <div>
                          <Label className="text-sm">Скидка (%)</Label>
                          <Input
                            type="number"
                            value={productForm.discountPercent}
                            onChange={(e) => setProductForm({...productForm, discountPercent: e.target.value})}
                            placeholder="0"
                            min="0"
                            max="99"
                            data-testid="input-product-discount"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            {productForm.discountPercent && parseInt(productForm.discountPercent) > 0 && productForm.price
                              ? `Цена со скидкой: ${Math.round(parseInt(productForm.price) / 100 * (1 - parseInt(productForm.discountPercent) / 100))} ₽`
                              : "Введите процент скидки (например 20). Цена будет зачёркнута."
                            }
                          </p>
                        </div>
                        <div>
                          <Label className="text-sm">Цена со скидкой точно (₽)</Label>
                          <Input
                            type="number"
                            value={productForm.salePrice ? String(parseInt(productForm.salePrice) / 100) : ""}
                            onChange={(e) => setProductForm({...productForm, salePrice: String(parseInt(e.target.value || "0") * 100)})}
                            placeholder="2500"
                            min="0"
                            data-testid="input-product-sale-price"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            {productForm.salePrice && parseInt(productForm.salePrice) > 0
                              ? `Перекрывает % скидки. Покупатель платит ровно ${parseInt(productForm.salePrice) / 100} ₽.`
                              : "Фиксированная цена после скидки (например 2500). Если задана — % скидки игнорируется."
                            }
                          </p>
                        </div>
                        <div>
                          <Label className="text-sm">Общий остаток (шт)</Label>
                          <Input
                            type="number"
                            value={productForm.stock}
                            onChange={(e) => setProductForm({...productForm, stock: e.target.value})}
                            placeholder="0"
                            min="0"
                            data-testid="input-product-stock"
                          />
                          <p className="text-xs text-muted-foreground mt-1">Суммарный остаток по всем размерам</p>
                        </div>
                        <div>
                          <Label className="text-sm">Категория *</Label>
                          <Select value={productForm.category} onValueChange={(v) => setProductForm({...productForm, category: v})}>
                            <SelectTrigger data-testid="select-product-category"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(CATEGORIES).map(([slug, cat]) => (
                                <SelectItem key={slug} value={slug}>{cat.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-sm">Подкатегория</Label>
                          {productForm.category && mergedSubcategoriesFor(productForm.category).length > 0 ? (
                            <Select
                              value={productForm.subcategory || "__none__"}
                              onValueChange={(v) => setProductForm({...productForm, subcategory: v === "__none__" ? "" : v, subSubcategory: ""})}
                            >
                              <SelectTrigger data-testid="select-product-subcategory">
                                <SelectValue placeholder="Без подкатегории" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Без подкатегории</SelectItem>
                                {mergedSubcategoriesFor(productForm.category).map((sub) => (
                                  <SelectItem key={sub.name} value={sub.name}>{sub.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              value={productForm.subcategory}
                              onChange={(e) => setProductForm({...productForm, subcategory: e.target.value})}
                              placeholder="Футболки"
                              data-testid="input-product-subcategory"
                            />
                          )}
                        </div>
                        {/* Sub-subcategory — only shown when current subcategory has sub-subcategories */}
                        {(() => {
                          const cat = productForm.category ? (editingCategories[productForm.category] || CATEGORIES[productForm.category as keyof typeof CATEGORIES]) : null;
                          const sub = (cat as any)?.subcategories?.find((s: any) => s.name === productForm.subcategory);
                          const subSubs: Array<{name: string; slug: string}> = (sub as any)?.subSubcategories || [];
                          if (!productForm.subcategory || subSubs.length === 0) return null;
                          return (
                            <div>
                              <Label className="text-sm">Под-подкатегория</Label>
                              <Select
                                value={productForm.subSubcategory || "__none__"}
                                onValueChange={(v) => setProductForm({...productForm, subSubcategory: v === "__none__" ? "" : v})}
                              >
                                <SelectTrigger data-testid="select-product-subsubcategory">
                                  <SelectValue placeholder="Без под-подкатегории" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Без под-подкатегории</SelectItem>
                                  {subSubs.map((ss) => (
                                    <SelectItem key={ss.name} value={ss.name}>{ss.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Additional Categories */}
                      <div className="border border-dashed border-zinc-600 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">Дополнительные категории</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              setProductForm({
                                ...productForm,
                                additionalCategories: [
                                  ...productForm.additionalCategories,
                                  { category: "", subcategory: "" }
                                ]
                              });
                            }}
                            data-testid="button-add-additional-category"
                          >
                            <Plus className="w-3 h-3 mr-1" /> Добавить
                          </Button>
                        </div>
                        {productForm.additionalCategories.length === 0 && (
                          <p className="text-xs text-muted-foreground">Товар отображается только в основной категории. Нажмите «Добавить», чтобы показать его в другой категории.</p>
                        )}
                        {productForm.additionalCategories.map((ac, idx) => (
                          <div key={idx} className="flex gap-2 items-end" data-testid={`additional-category-row-${idx}`}>
                            <div className="flex-1">
                              {idx === 0 && <Label className="text-xs text-muted-foreground mb-1">Категория</Label>}
                              <Select
                                value={ac.category}
                                onValueChange={(v) => {
                                  const updated = [...productForm.additionalCategories];
                                  updated[idx] = { ...updated[idx], category: v, subcategory: "" };
                                  setProductForm({ ...productForm, additionalCategories: updated });
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs" data-testid={`select-additional-category-${idx}`}>
                                  <SelectValue placeholder="Выберите категорию" />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(CATEGORIES).map(([slug, cat]) => (
                                    <SelectItem key={slug} value={slug}>{cat.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex-1">
                              {idx === 0 && <Label className="text-xs text-muted-foreground mb-1">Подкатегория</Label>}
                              {ac.category && (mergedSubcategoriesFor(ac.category).length > 0) ? (
                                <Select
                                  value={ac.subcategory || "__none__"}
                                  onValueChange={(v) => {
                                    const updated = [...productForm.additionalCategories];
                                    updated[idx] = { ...updated[idx], subcategory: v === "__none__" ? "" : v };
                                    setProductForm({ ...productForm, additionalCategories: updated });
                                  }}
                                >
                                  <SelectTrigger className="h-8 text-xs" data-testid={`select-additional-subcategory-${idx}`}>
                                    <SelectValue placeholder="Все" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">— Без подкатегории —</SelectItem>
                                    {mergedSubcategoriesFor(ac.category).map((sub) => (
                                      <SelectItem key={sub.slug} value={sub.name}>{sub.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input
                                  className="h-8 text-xs"
                                  value={ac.subcategory}
                                  onChange={(e) => {
                                    const updated = [...productForm.additionalCategories];
                                    updated[idx] = { ...updated[idx], subcategory: e.target.value };
                                    setProductForm({ ...productForm, additionalCategories: updated });
                                  }}
                                  placeholder={ac.category ? "Нет подкатегорий" : "Сначала выберите категорию"}
                                  disabled={!ac.category}
                                  data-testid={`input-additional-subcategory-${idx}`}
                                />
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-400 hover:text-red-300 flex-shrink-0"
                              onClick={() => {
                                const updated = productForm.additionalCategories.filter((_, i) => i !== idx);
                                setProductForm({ ...productForm, additionalCategories: updated });
                              }}
                              data-testid={`button-remove-additional-category-${idx}`}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>

                      {/* Description */}
                      <div>
                        <Label className="text-sm">Описание *</Label>
                        <textarea
                          className="w-full min-h-24 p-3 rounded-md border border-input bg-background text-sm resize-y"
                          value={productForm.description}
                          onChange={(e) => setProductForm({...productForm, description: e.target.value})}
                          placeholder="Описание товара..."
                          data-testid="textarea-product-description"
                        />
                      </div>

                      {/* Composition & Care */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm">Состав</Label>
                          <Input
                            value={productForm.composition}
                            onChange={(e) => setProductForm({...productForm, composition: e.target.value})}
                            placeholder="100% хлопок"
                            data-testid="input-product-composition"
                          />
                        </div>
                        <div>
                          <Label className="text-sm">Уход</Label>
                          <Input
                            value={productForm.careInstructions}
                            onChange={(e) => setProductForm({...productForm, careInstructions: e.target.value})}
                            placeholder="Машинная стирка при 30°"
                            data-testid="input-product-care"
                          />
                        </div>
                      </div>

                      {/* Characteristics HTML block — overrides Состав/Уход display on the product page when filled */}
                      <div>
                        <Label className="text-sm">Характеристики (HTML-блок)</Label>
                        <textarea
                          className="w-full min-h-32 p-3 rounded-md border border-input bg-background text-sm resize-y font-mono text-xs"
                          value={productForm.specsHtml}
                          onChange={(e) => setProductForm({...productForm, specsHtml: e.target.value})}
                          placeholder={'Вставьте HTML-список характеристик: <ul><li>Материал: ...</li></ul>. Если оставить пустым, на странице товара покажутся обычные поля «Состав» и «Уход» выше.'}
                          data-testid="textarea-product-specs-html"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Если заполнено — на странице товара блок «Характеристики» покажет этот HTML вместо «Состав»/«Уход». Тег &lt;h1&gt; станет &lt;h2&gt;, &lt;title&gt; будет удалён.
                        </p>
                      </div>

                      {/* Note */}
                      <div>
                        <Label className="text-sm">Примечание</Label>
                        <textarea
                          className="w-full min-h-16 p-3 rounded-md border border-input bg-background text-sm resize-y"
                          value={productForm.note}
                          onChange={(e) => setProductForm({...productForm, note: e.target.value})}
                          placeholder="Дополнительная информация о товаре..."
                          data-testid="textarea-product-note"
                        />
                      </div>

                      {/* Images */}
                      <div>
                        <Label className="text-sm mb-2 block">Фотографии (до 10 шт, WebP) <span className="text-[11px] text-muted-foreground/70 font-normal">— 900×1200 px, 3:4, JPG/WebP</span></Label>
                        {productForm.images.length === 0 && (
                          <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            <span>⚠️</span>
                            <span>Без фотографии товар <strong>не будет виден</strong> в каталоге для покупателей.</span>
                          </div>
                        )}
                        <p className="text-[11px] text-muted-foreground mb-2">Перетащите фото чтобы изменить порядок, или используйте стрелки</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                          {productForm.images.map((img, idx) => {
                            const adminThumb = img.includes('storage.yandexcloud') && img.endsWith('.webp') 
                              ? img.replace(/\.webp$/i, '_thumb.webp') 
                              : img;
                            const isDragging = dragVisualSrc === idx;
                            const isOver = dragOverImageIdx === idx && dragVisualSrc !== idx;
                            return (
                            <div
                              key={img + idx}
                              className={`relative aspect-[3/4] rounded-lg overflow-hidden border group cursor-grab active:cursor-grabbing transition-all ${
                                isDragging ? 'opacity-40 scale-95' : ''
                              } ${isOver ? 'ring-2 ring-primary scale-105' : ''}`}
                              draggable
                              onDragStart={(e) => {
                                dragImageIdxRef.current = idx;
                                setDragVisualSrc(idx);
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragEnter={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (dragImageIdxRef.current !== idx) setDragOverImageIdx(idx);
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                              }}
                              onDragLeave={(e) => {
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                  setDragOverImageIdx(null);
                                }
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const srcIdx = dragImageIdxRef.current;
                                if (srcIdx === null || srcIdx === idx) {
                                  setDragVisualSrc(null);
                                  setDragOverImageIdx(null);
                                  dragImageIdxRef.current = null;
                                  return;
                                }
                                setProductForm(prev => {
                                  const newImages = [...prev.images];
                                  const [moved] = newImages.splice(srcIdx, 1);
                                  newImages.splice(idx, 0, moved);
                                  return { ...prev, images: newImages };
                                });
                                dragImageIdxRef.current = null;
                                setDragVisualSrc(null);
                                setDragOverImageIdx(null);
                              }}
                              onDragEnd={() => {
                                dragImageIdxRef.current = null;
                                setDragVisualSrc(null);
                                setDragOverImageIdx(null);
                              }}
                              data-testid={`image-product-${idx}`}
                            >
                              <img 
                                src={adminThumb} 
                                alt={`Фото ${idx + 1}`} 
                                className="w-full h-full object-cover pointer-events-none"
                                loading="lazy"
                                decoding="async"
                                onError={(e) => { (e.target as HTMLImageElement).src = img; }}
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                              <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <GripVertical className="w-4 h-4 text-white drop-shadow" />
                              </div>
                              <button
                                type="button"
                                onClick={() => setProductForm({
                                  ...productForm,
                                  images: productForm.images.filter((_, i) => i !== idx)
                                })}
                                className="absolute top-1 right-1 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                              >
                                <X className="w-3 h-3" />
                              </button>
                              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-1 pb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => {
                                    const newImages = [...productForm.images];
                                    [newImages[idx - 1], newImages[idx]] = [newImages[idx], newImages[idx - 1]];
                                    setProductForm({ ...productForm, images: newImages });
                                  }}
                                  className="w-6 h-6 bg-background/90 rounded flex items-center justify-center disabled:opacity-30 hover:bg-background transition-colors"
                                >
                                  <ArrowLeft className="w-3 h-3" />
                                </button>
                                <span className="bg-background/80 text-xs px-1.5 rounded font-medium">{idx + 1}</span>
                                <button
                                  type="button"
                                  disabled={idx === productForm.images.length - 1}
                                  onClick={() => {
                                    const newImages = [...productForm.images];
                                    [newImages[idx + 1], newImages[idx]] = [newImages[idx], newImages[idx + 1]];
                                    setProductForm({ ...productForm, images: newImages });
                                  }}
                                  className="w-6 h-6 bg-background/90 rounded flex items-center justify-center disabled:opacity-30 hover:bg-background transition-colors"
                                >
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );})}
                          {productForm.images.length < 10 && (
                            <label className="aspect-[3/4] rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors">
                              {uploadingImages ? (
                                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                              ) : (
                                <>
                                  <Plus className="w-6 h-6 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground mt-1">Добавить</span>
                                </>
                              )}
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={handleImageUpload}
                                disabled={uploadingImages}
                                data-testid="input-product-images"
                              />
                            </label>
                          )}
                        </div>
                      </div>

                      {/* Video Upload */}
                      <div>
                        <Label className="text-sm mb-1.5 block">Видео товара (MP4/WebM)</Label>
                        <MediaUploadField
                          value={productForm.videoUrl}
                          onChange={(url) => setProductForm({ ...productForm, videoUrl: url })}
                          apiKey={apiKey}
                          type="video"
                          placeholder="Вставьте ссылку или загрузите файл"
                          hint="Перетащите файл или нажмите для выбора (MP4, WebM, до 100 MB)"
                        />
                      </div>

                      {/* Sizes */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm">Размеры</Label>
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-primary"
                              checked={productForm.noSize}
                              onChange={(e) => setProductForm({ ...productForm, noSize: e.target.checked })}
                              data-testid="checkbox-no-size"
                            />
                            <span className="text-xs text-muted-foreground">Без размера (авто-выбор OneSize)</span>
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {["XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "OneSize", "40-45", "34-39"].map((size) => (
                            <Button
                              key={size}
                              type="button"
                              variant={productForm.sizes.includes(size) ? "default" : "outline"}
                              size="sm"
                              onClick={() => {
                                if (productForm.sizes.includes(size)) {
                                  const newSizes = productForm.sizes.filter(s => s !== size);
                                  const newSizeStock = { ...productForm.sizeStock };
                                  delete newSizeStock[size];
                                  const totalStock = Object.values(newSizeStock).reduce((sum, v) => sum + v, 0);
                                  setProductForm({...productForm, sizes: newSizes, sizeStock: newSizeStock, stock: Object.keys(newSizeStock).length > 0 ? String(totalStock) : productForm.stock});
                                } else {
                                  setProductForm({...productForm, sizes: [...productForm.sizes, size]});
                                }
                              }}
                              data-testid={`button-size-${size}`}
                            >
                              {size}
                            </Button>
                          ))}
                        </div>
                        {productForm.sizes.length > 0 && (
                          <div className="mt-3 space-y-4">
                            <div>
                              <Label className="text-sm mb-2 block">Остаток по размерам</Label>
                              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                                {productForm.sizes.map((size) => (
                                  <div key={size} className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground text-center">{size}</span>
                                    <Input
                                      type="number"
                                      min="0"
                                      value={productForm.sizeStock[size] !== undefined ? String(productForm.sizeStock[size]) : ""}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        const newSizeStock = { ...productForm.sizeStock };
                                        if (e.target.value === "" || isNaN(val)) {
                                          delete newSizeStock[size];
                                        } else {
                                          newSizeStock[size] = val;
                                        }
                                        const totalStock = Object.values(newSizeStock).reduce((sum, v) => sum + v, 0);
                                        setProductForm({...productForm, sizeStock: newSizeStock, stock: String(totalStock)});
                                      }}
                                      placeholder="0"
                                      className="text-center text-sm"
                                      data-testid={`input-size-stock-${size}`}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm mb-1 block">Скидка по размеру (%)</Label>
                              <p className="text-xs text-muted-foreground mb-2">Скидка на конкретный размер перекрывает общую скидку на товар. Оставьте 0 — без скидки.</p>
                              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                                {productForm.sizes.map((size) => (
                                  <div key={size} className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground text-center">{size}</span>
                                    <Input
                                      type="number"
                                      min="0"
                                      max="99"
                                      value={productForm.sizeDiscounts[size] !== undefined ? String(productForm.sizeDiscounts[size]) : ""}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        const newSizeDiscounts = { ...productForm.sizeDiscounts };
                                        if (e.target.value === "" || isNaN(val) || val <= 0) {
                                          delete newSizeDiscounts[size];
                                        } else {
                                          newSizeDiscounts[size] = Math.min(val, 99);
                                        }
                                        setProductForm({...productForm, sizeDiscounts: newSizeDiscounts});
                                      }}
                                      placeholder="0"
                                      className="text-center text-sm"
                                      data-testid={`input-size-discount-${size}`}
                                    />
                                  </div>
                                ))}
                              </div>
                              {Object.keys(productForm.sizeDiscounts).length > 0 && productForm.price && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {Object.entries(productForm.sizeDiscounts).map(([size, pct]) => (
                                    <span key={size} className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-2 py-0.5 rounded">
                                      {size}: {Math.round(parseInt(productForm.price) / 100 * (1 - pct / 100))} ₽ (-{pct}%)
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {productForm.sizes.length > 0 && (
                              <div className="mt-3">
                                <Label className="text-sm mb-1 block">Уведомления о наличии</Label>
                                <p className="text-xs text-muted-foreground mb-2">Размер с выключённым уведомлением не показывается покупателям, когда отсутствует в наличии</p>
                                <div className="flex flex-wrap gap-2">
                                  {productForm.sizes.map((size) => {
                                    const isDisabled = productForm.disabledNotifySizes.includes(size);
                                    return (
                                      <button
                                        key={size}
                                        type="button"
                                        onClick={() => {
                                          const newDisabled = isDisabled
                                            ? productForm.disabledNotifySizes.filter(s => s !== size)
                                            : [...productForm.disabledNotifySizes, size];
                                          setProductForm({...productForm, disabledNotifySizes: newDisabled});
                                        }}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                                          isDisabled
                                            ? "bg-gray-100 border-gray-300 text-gray-400 line-through"
                                            : "bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
                                        }`}
                                        data-testid={`button-notify-toggle-${size}`}
                                        title={isDisabled ? "Уведомление выключено — нажмите чтобы включить" : "Уведомление включено — нажмите чтобы выключить"}
                                      >
                                        {isDisabled ? "🔕" : "🔔"} {size}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Delivery & Return */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm">Доставка (кастомный текст)</Label>
                          <Input
                            value={productForm.delivery}
                            onChange={(e) => setProductForm({...productForm, delivery: e.target.value})}
                            placeholder="По умолчанию: По всей России от 2-х дней"
                            data-testid="input-product-delivery"
                          />
                        </div>
                        <div>
                          <Label className="text-sm">Возврат (кастомный текст)</Label>
                          <Input
                            value={productForm.returnPolicy}
                            onChange={(e) => setProductForm({...productForm, returnPolicy: e.target.value})}
                            placeholder="По умолчанию: 14 дней"
                            data-testid="input-product-return"
                          />
                        </div>
                      </div>

                      {/* Measurements table */}
                      <div>
                        {/* Mode toggle */}
                        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                          <Label className="text-sm">Таблица обмеров</Label>
                          <div className="flex border rounded-md overflow-hidden text-xs">
                            <button
                              type="button"
                              className={`px-3 py-1.5 transition-colors ${productForm.measurementSections.length === 0 ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                              onClick={() => setProductForm({ ...productForm, measurementSections: [] })}
                            >Одна таблица</button>
                            <button
                              type="button"
                              className={`px-3 py-1.5 border-l transition-colors ${productForm.measurementSections.length > 0 ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                              onClick={() => {
                                if (productForm.measurementSections.length === 0) {
                                  setProductForm({ ...productForm, measurements: [], measurementSections: [{ title: "Верх", rows: [] }, { title: "Низ", rows: [] }] });
                                }
                              }}
                            >Верх + Низ (костюм)</button>
                          </div>
                        </div>

                        {/* ── Single table mode ── */}
                        {productForm.measurementSections.length === 0 && (() => {
                          const rows = productForm.measurements;
                          const hasCol = (col: string) => rows.some((r: any) => r[col]);
                          const hasAnyData = hasCol("length") || hasCol("chest") || hasCol("shoulders") || hasCol("sleeves") || hasCol("waist") || hasCol("hips");
                          const isPants = hasCol("waist") && !hasCol("sleeves");
                          const showLength = hasCol("length") || !hasAnyData;
                          const showChest = hasCol("chest") || (!isPants && !hasAnyData);
                          const showShoulders = hasCol("shoulders") || (!isPants && !hasAnyData);
                          const showSleeves = hasCol("sleeves") || (!isPants && !hasAnyData);
                          const showWaist = hasCol("waist") || !hasAnyData;
                          const showHips = hasCol("hips") || !hasAnyData;
                          const showSideLength = hasCol("sideLength");
                          const showBottomWidth = hasCol("bottomWidth");
                          const lbl = (field: string, def: string) => (productForm.measurementLabels as any)?.[field] || def;
                          const setLbl = (field: string, val: string) => setProductForm({ ...productForm, measurementLabels: { ...(productForm.measurementLabels || {}), [field]: val } });
                          return (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button type="button" variant="outline" size="sm" data-testid="button-measurement-template">
                                      <Layout className="w-3 h-3 mr-1" />Шаблон
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent>
                                    {Object.entries(MEASUREMENT_TEMPLATES).map(([key, tmpl]) => (
                                      <DropdownMenuItem key={key} onClick={() => setProductForm({ ...productForm, measurements: tmpl.sizes.map(s => ({ ...s })) })} data-testid={`menu-template-${key}`}>
                                        {tmpl.label}
                                      </DropdownMenuItem>
                                    ))}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => setProductForm({ ...productForm, measurements: [] })} className="text-destructive" data-testid="menu-template-clear">
                                      Очистить таблицу
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                                <Button type="button" variant="outline" size="sm" onClick={() => { setShowMeasurementCopy(true); setMeasurementCopySearch(""); }} data-testid="button-copy-measurements">
                                  <Copy className="w-3 h-3 mr-1" />Скопировать
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => setProductForm({ ...productForm, measurements: [...productForm.measurements, { size: "" }] })} data-testid="button-add-measurement">
                                  <Plus className="w-3 h-3 mr-1" />Строка
                                </Button>
                              </div>
                              {rows.length > 0 ? (
                                <div className="border rounded-lg overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead className="bg-muted">
                                      <tr>
                                        <th className="p-2 text-left font-medium min-w-[70px]">Размер</th>
                                        {showWaist && <th className="p-2 text-left font-medium min-w-[110px]"><input value={lbl("waist","Шир. в поясе")} onChange={e=>setLbl("waist",e.target.value)} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                        {showHips && <th className="p-2 text-left font-medium min-w-[110px]"><input value={lbl("hips","Шир. в бёдрах")} onChange={e=>setLbl("hips",e.target.value)} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                        {showSideLength && <th className="p-2 text-left font-medium min-w-[110px]"><input value={lbl("sideLength","Дл. по боковому")} onChange={e=>setLbl("sideLength",e.target.value)} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                        {showBottomWidth && <th className="p-2 text-left font-medium min-w-[110px]"><input value={lbl("bottomWidth","Шир. входа в низу")} onChange={e=>setLbl("bottomWidth",e.target.value)} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                        {showLength && <th className="p-2 text-left font-medium min-w-[80px]"><input value={lbl("length","Длина")} onChange={e=>setLbl("length",e.target.value)} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                        {showShoulders && !isPants && <th className="p-2 text-left font-medium min-w-[80px]"><input value={lbl("shoulders","Плечи")} onChange={e=>setLbl("shoulders",e.target.value)} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                        {showChest && !isPants && <th className="p-2 text-left font-medium min-w-[80px]"><input value={lbl("chest","Грудь")} onChange={e=>setLbl("chest",e.target.value)} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                        {showSleeves && !isPants && <th className="p-2 text-left font-medium min-w-[70px]"><input value={lbl("sleeves","Рукав")} onChange={e=>setLbl("sleeves",e.target.value)} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                        <th className="p-2 w-10"></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rows.map((row: any, idx: number) => {
                                        const updateRow = (field: string, value: string) => {
                                          const newM = [...productForm.measurements];
                                          newM[idx] = { ...row, [field]: value };
                                          setProductForm({ ...productForm, measurements: newM });
                                        };
                                        return (
                                          <tr key={idx} className="border-t">
                                            <td className="p-1"><Input value={row.size} onChange={(e) => updateRow("size", e.target.value)} className="h-8" data-testid={`input-measurement-size-${idx}`} /></td>
                                            {showWaist && <td className="p-1"><Input value={row.waist || ""} onChange={(e) => updateRow("waist", e.target.value)} className="h-8" placeholder="см" /></td>}
                                            {showHips && <td className="p-1"><Input value={row.hips || ""} onChange={(e) => updateRow("hips", e.target.value)} className="h-8" placeholder="см" /></td>}
                                            {showSideLength && <td className="p-1"><Input value={row.sideLength || ""} onChange={(e) => updateRow("sideLength", e.target.value)} className="h-8" placeholder="см" /></td>}
                                            {showBottomWidth && <td className="p-1"><Input value={row.bottomWidth || ""} onChange={(e) => updateRow("bottomWidth", e.target.value)} className="h-8" placeholder="см" /></td>}
                                            {showLength && <td className="p-1"><Input value={row.length || ""} onChange={(e) => updateRow("length", e.target.value)} className="h-8" placeholder="см" /></td>}
                                            {showShoulders && !isPants && <td className="p-1"><Input value={row.shoulders || ""} onChange={(e) => updateRow("shoulders", e.target.value)} className="h-8" placeholder="см" /></td>}
                                            {showChest && !isPants && <td className="p-1"><Input value={row.chest || ""} onChange={(e) => updateRow("chest", e.target.value)} className="h-8" placeholder="см" /></td>}
                                            {showSleeves && !isPants && <td className="p-1"><Input value={row.sleeves || ""} onChange={(e) => updateRow("sleeves", e.target.value)} className="h-8" placeholder="см" /></td>}
                                            <td className="p-1">
                                              <Button type="button" variant="ghost" size="icon" onClick={() => setProductForm({ ...productForm, measurements: productForm.measurements.filter((_, i) => i !== idx) })}>
                                                <Trash2 className="w-3 h-3" />
                                              </Button>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">Выберите шаблон или добавьте строки вручную</p>
                              )}
                            </div>
                          );
                        })()}

                        {/* ── Multi-section mode (suits: top + bottom) ── */}
                        {productForm.measurementSections.length > 0 && (
                          <div className="space-y-4">
                            <div>
                              <Button type="button" variant="outline" size="sm" onClick={() => { setShowMeasurementCopy(true); setMeasurementCopySearch(""); }} data-testid="button-copy-measurements-sections">
                                <Copy className="w-3 h-3 mr-1" />Скопировать из другого товара
                              </Button>
                            </div>
                            {productForm.measurementSections.map((section: any, sIdx: number) => {
                              const updateSection = (patch: any) => {
                                const newSections = [...productForm.measurementSections];
                                newSections[sIdx] = { ...section, ...patch };
                                setProductForm({ ...productForm, measurementSections: newSections });
                              };
                              const updateSectionRow = (rIdx: number, field: string, value: string) => {
                                const newRows = [...section.rows];
                                newRows[rIdx] = { ...newRows[rIdx], [field]: value };
                                updateSection({ rows: newRows });
                              };
                              const isBottom = section.rows.some((r: any) => r.waist || r.hips || r.sideLength || r.bottomWidth) && !section.rows.some((r: any) => r.sleeves || r.chest);
                              const hasAny = section.rows.some((r: any) => r.waist || r.hips || r.sideLength || r.bottomWidth || r.length || r.chest || r.shoulders || r.sleeves);
                              const showWaist = section.rows.some((r: any) => r.waist) || isBottom || !hasAny;
                              const showHips = section.rows.some((r: any) => r.hips) || isBottom || !hasAny;
                              const showSideLength = section.rows.some((r: any) => r.sideLength) || isBottom || !hasAny;
                              const showBottomWidth = section.rows.some((r: any) => r.bottomWidth) || isBottom || !hasAny;
                              const showLength = section.rows.some((r: any) => r.length) || (!isBottom && !hasAny);
                              const showShoulders = section.rows.some((r: any) => r.shoulders) || (!isBottom && !hasAny);
                              const showChest = section.rows.some((r: any) => r.chest) || (!isBottom && !hasAny);
                              const showSleeves = section.rows.some((r: any) => r.sleeves) || (!isBottom && !hasAny);
                              return (
                                <div key={sIdx} className="border rounded-lg p-3 space-y-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Input
                                      value={section.title}
                                      onChange={(e) => updateSection({ title: e.target.value })}
                                      className="h-8 w-32 font-medium text-sm"
                                      placeholder="Название секции"
                                    />
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button type="button" variant="outline" size="sm">
                                          <Layout className="w-3 h-3 mr-1" />Шаблон
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent>
                                        {Object.entries(MEASUREMENT_TEMPLATES).map(([key, tmpl]) => (
                                          <DropdownMenuItem key={key} onClick={() => updateSection({ rows: tmpl.sizes.map(s => ({ ...s })) })}>
                                            {tmpl.label}
                                          </DropdownMenuItem>
                                        ))}
                                        <DropdownMenuItem onClick={() => updateSection({ rows: MEASUREMENT_TEMPLATES.pants_suit.sizes.map(s => ({ ...s })) })}>
                                          {MEASUREMENT_TEMPLATES.pants_suit.label}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => updateSection({ rows: [] })} className="text-destructive">
                                          Очистить
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                    <Button type="button" variant="outline" size="sm" onClick={() => updateSection({ rows: [...section.rows, { size: "" }] })}>
                                      <Plus className="w-3 h-3 mr-1" />Строка
                                    </Button>
                                    <Button
                                      type="button" variant="ghost" size="sm" className="ml-auto text-destructive"
                                      onClick={() => setProductForm({ ...productForm, measurementSections: productForm.measurementSections.filter((_: any, i: number) => i !== sIdx) })}
                                    >
                                      <Trash2 className="w-3 h-3 mr-1" />Удалить секцию
                                    </Button>
                                  </div>
                                  {section.rows.length > 0 ? (
                                    <div className="border rounded overflow-x-auto">
                                      <table className="w-full text-sm">
                                        <thead className="bg-muted">
                                          <tr>
                                            <th className="p-2 text-left font-medium min-w-[70px]">Размер</th>
                                            {showWaist && <th className="p-2 text-left font-medium min-w-[110px]"><input value={(productForm.measurementLabels as any)?.waist||"Шир. в поясе"} onChange={e=>setProductForm({...productForm,measurementLabels:{...(productForm.measurementLabels||{}),waist:e.target.value}})} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                            {showHips && <th className="p-2 text-left font-medium min-w-[110px]"><input value={(productForm.measurementLabels as any)?.hips||"Шир. в бёдрах"} onChange={e=>setProductForm({...productForm,measurementLabels:{...(productForm.measurementLabels||{}),hips:e.target.value}})} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                            {showSideLength && <th className="p-2 text-left font-medium min-w-[120px]"><input value={(productForm.measurementLabels as any)?.sideLength||"Дл. по боковому"} onChange={e=>setProductForm({...productForm,measurementLabels:{...(productForm.measurementLabels||{}),sideLength:e.target.value}})} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                            {showBottomWidth && <th className="p-2 text-left font-medium min-w-[130px]"><input value={(productForm.measurementLabels as any)?.bottomWidth||"Шир. входа в низу"} onChange={e=>setProductForm({...productForm,measurementLabels:{...(productForm.measurementLabels||{}),bottomWidth:e.target.value}})} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                            {showLength && <th className="p-2 text-left font-medium min-w-[80px]"><input value={(productForm.measurementLabels as any)?.length||"Длина"} onChange={e=>setProductForm({...productForm,measurementLabels:{...(productForm.measurementLabels||{}),length:e.target.value}})} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                            {showShoulders && <th className="p-2 text-left font-medium min-w-[80px]"><input value={(productForm.measurementLabels as any)?.shoulders||"Плечи"} onChange={e=>setProductForm({...productForm,measurementLabels:{...(productForm.measurementLabels||{}),shoulders:e.target.value}})} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                            {showChest && <th className="p-2 text-left font-medium min-w-[80px]"><input value={(productForm.measurementLabels as any)?.chest||"Грудь"} onChange={e=>setProductForm({...productForm,measurementLabels:{...(productForm.measurementLabels||{}),chest:e.target.value}})} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                            {showSleeves && <th className="p-2 text-left font-medium min-w-[70px]"><input value={(productForm.measurementLabels as any)?.sleeves||"Рукав"} onChange={e=>setProductForm({...productForm,measurementLabels:{...(productForm.measurementLabels||{}),sleeves:e.target.value}})} className="bg-transparent border-b border-transparent hover:border-muted-foreground/40 focus:border-primary outline-none font-medium w-full text-sm p-0" title="Редактировать название" /></th>}
                                            <th className="p-2 w-10"></th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {section.rows.map((row: any, rIdx: number) => (
                                            <tr key={rIdx} className="border-t">
                                              <td className="p-1"><Input value={row.size} onChange={(e) => updateSectionRow(rIdx, "size", e.target.value)} className="h-8" /></td>
                                              {showWaist && <td className="p-1"><Input value={row.waist || ""} onChange={(e) => updateSectionRow(rIdx, "waist", e.target.value)} className="h-8" placeholder="см" /></td>}
                                              {showHips && <td className="p-1"><Input value={row.hips || ""} onChange={(e) => updateSectionRow(rIdx, "hips", e.target.value)} className="h-8" placeholder="см" /></td>}
                                              {showSideLength && <td className="p-1"><Input value={row.sideLength || ""} onChange={(e) => updateSectionRow(rIdx, "sideLength", e.target.value)} className="h-8" placeholder="см" /></td>}
                                              {showBottomWidth && <td className="p-1"><Input value={row.bottomWidth || ""} onChange={(e) => updateSectionRow(rIdx, "bottomWidth", e.target.value)} className="h-8" placeholder="см" /></td>}
                                              {showLength && <td className="p-1"><Input value={row.length || ""} onChange={(e) => updateSectionRow(rIdx, "length", e.target.value)} className="h-8" placeholder="см" /></td>}
                                              {showShoulders && <td className="p-1"><Input value={row.shoulders || ""} onChange={(e) => updateSectionRow(rIdx, "shoulders", e.target.value)} className="h-8" placeholder="см" /></td>}
                                              {showChest && <td className="p-1"><Input value={row.chest || ""} onChange={(e) => updateSectionRow(rIdx, "chest", e.target.value)} className="h-8" placeholder="см" /></td>}
                                              {showSleeves && <td className="p-1"><Input value={row.sleeves || ""} onChange={(e) => updateSectionRow(rIdx, "sleeves", e.target.value)} className="h-8" placeholder="см" /></td>}
                                              <td className="p-1">
                                                <Button type="button" variant="ghost" size="icon" onClick={() => updateSection({ rows: section.rows.filter((_: any, i: number) => i !== rIdx) })}>
                                                  <Trash2 className="w-3 h-3" />
                                                </Button>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className="text-xs text-muted-foreground">Выберите шаблон или добавьте строки вручную</p>
                                  )}
                                </div>
                              );
                            })}
                            <Button
                              type="button" variant="outline" size="sm"
                              onClick={() => setProductForm({ ...productForm, measurementSections: [...productForm.measurementSections, { title: "Секция", rows: [] }] })}
                            >
                              <Plus className="w-3 h-3 mr-1" />Добавить секцию
                            </Button>
                          </div>
                        )}

                        {showMeasurementCopy && (
                          <div className="mt-3 border rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-sm">Скопировать обмеры из товара</Label>
                              <Button type="button" variant="ghost" size="icon" onClick={() => setShowMeasurementCopy(false)}>
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                            <Input
                              placeholder="Поиск по названию товара..."
                              value={measurementCopySearch}
                              onChange={(e) => setMeasurementCopySearch(e.target.value)}
                              data-testid="input-measurement-copy-search"
                            />
                            <div className="max-h-48 overflow-y-auto space-y-1">
                              {products
                                .filter((p: any) => {
                                  const hasFlat = p.measurements && (p.measurements as any[]).length > 0;
                                  const hasSections = p.measurementSections && (p.measurementSections as any[]).length > 0 &&
                                    (p.measurementSections as any[]).some((s: any) => s.rows && s.rows.length > 0);
                                  return (hasFlat || hasSections) &&
                                    p.id !== editingProductId &&
                                    (measurementCopySearch === "" || p.name.toLowerCase().includes(measurementCopySearch.toLowerCase()));
                                })
                                .slice(0, 50)
                                .map((p: any) => {
                                  const hasFlat = p.measurements && (p.measurements as any[]).length > 0;
                                  const sections = (p.measurementSections as any[]) || [];
                                  const sectionCount = sections.reduce((n: number, s: any) => n + (s.rows?.length || 0), 0);
                                  const count = hasFlat ? (p.measurements as any[]).length : sectionCount;
                                  const label = hasFlat ? `${count} разм.` : `${sections.length} секц. · ${count} разм.`;
                                  return (
                                    <button
                                      key={p.id}
                                      type="button"
                                      className="w-full text-left p-2 rounded text-sm hover-elevate flex items-center justify-between gap-2"
                                      onClick={() => {
                                        if (hasFlat) {
                                          setProductForm({ ...productForm, measurements: (p.measurements as any[]).map((m: any) => ({ ...m })), measurementSections: [] });
                                        } else {
                                          setProductForm({ ...productForm, measurements: [], measurementSections: sections.map((s: any) => ({ ...s, rows: s.rows.map((r: any) => ({ ...r })) })) });
                                        }
                                        setShowMeasurementCopy(false);
                                        toast({ title: `Обмеры скопированы из "${p.name}"` });
                                      }}
                                      data-testid={`button-copy-from-${p.id}`}
                                    >
                                      <span className="truncate">{p.name}</span>
                                      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
                                    </button>
                                  );
                                })}
                              {products.filter((p: any) => {
                                const hasFlat = p.measurements && (p.measurements as any[]).length > 0;
                                const hasSections = p.measurementSections && (p.measurementSections as any[]).length > 0 &&
                                  (p.measurementSections as any[]).some((s: any) => s.rows && s.rows.length > 0);
                                return (hasFlat || hasSections) &&
                                  p.id !== editingProductId &&
                                  (measurementCopySearch === "" || p.name.toLowerCase().includes(measurementCopySearch.toLowerCase()));
                              }).length === 0 && (
                                <p className="text-xs text-muted-foreground text-center py-2">Нет товаров с заполненными обмерами</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Look Products - Complete your look */}
                      <div>
                        <Label className="text-sm mb-2 block">Дополните свой образ (сочетания)</Label>
                        <p className="text-xs text-muted-foreground mb-3">Добавьте конкретные товары или выберите целую категорию</p>

                        <div className="mb-3 p-3 border rounded-md bg-muted/20 space-y-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">Категория (показывает первые 4 товара из категории)</Label>
                            <Select
                              value={productForm.lookCategory || "__none__"}
                              onValueChange={(v) => setProductForm({...productForm, lookCategory: v === "__none__" ? "" : v, lookSubcategory: ""})}
                            >
                              <SelectTrigger data-testid="select-look-category">
                                <SelectValue placeholder="Не выбрана" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Не выбрана</SelectItem>
                                {(Object.keys(CATEGORIES) as CategorySlug[]).map((slug) => (
                                  <SelectItem key={slug} value={slug}>{CATEGORIES[slug].name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {productForm.lookCategory && (
                            <>
                              {mergedSubcategoriesFor(productForm.lookCategory).length > 0 && (
                                <div>
                                  <Label className="text-xs text-muted-foreground">Подкатегория (опционально — сузить выборку)</Label>
                                  <Select
                                    value={productForm.lookSubcategory || "__none__"}
                                    onValueChange={(v) => setProductForm({...productForm, lookSubcategory: v === "__none__" ? "" : v})}
                                  >
                                    <SelectTrigger data-testid="select-look-subcategory">
                                      <SelectValue placeholder="Все подкатегории" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">Все подкатегории</SelectItem>
                                      {mergedSubcategoriesFor(productForm.lookCategory).map((sub) => (
                                        <SelectItem key={sub.name} value={sub.name}>{sub.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              <p className="text-xs text-muted-foreground">
                                На странице товара покажутся первые 4 товара из категории «{editingCategories[productForm.lookCategory]?.name || CATEGORIES[productForm.lookCategory as CategorySlug]?.name || productForm.lookCategory}»{productForm.lookSubcategory ? ` → «${productForm.lookSubcategory}»` : ''} со стрелкой для перехода в каталог
                              </p>
                            </>
                          )}
                        </div>

                        <div className="mb-2">
                          <Label className="text-xs text-muted-foreground">Конкретные товары (дополнительно к категории)</Label>
                        </div>
                        
                        {lookProductDetails.length > 0 && (
                          <div className="space-y-2 mb-3">
                            {lookProductDetails.map((p: any, idx: number) => (
                              <div key={p.id} className="flex items-center gap-3 p-2 border rounded-md bg-muted/30">
                                <img 
                                  src={p.thumbnailUrl || p.imageUrl} 
                                  alt={p.name} 
                                  className="w-10 h-12 object-cover rounded"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate" data-testid={`text-look-product-name-${p.id}`}>{p.name}</p>
                                  <p className="text-xs text-muted-foreground">{p.price ? `${(p.price / 100).toLocaleString('ru-RU')} ₽` : ''}</p>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setProductForm({
                                    ...productForm,
                                    lookProducts: productForm.lookProducts.filter(id => id !== p.id)
                                  })}
                                  data-testid={`button-remove-look-${p.id}`}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {productForm.lookProducts.length < 6 && (
                          <div className="relative">
                            <div className="flex items-center gap-2">
                              <Search className="w-4 h-4 text-muted-foreground" />
                              <Input
                                value={lookSearchQuery}
                                onChange={(e) => setLookSearchQuery(e.target.value)}
                                placeholder="Поиск товара по названию, артикулу или ID..."
                                className="flex-1"
                                data-testid="input-look-search"
                              />
                            </div>
                            {lookSearchResults.length > 0 && (
                              <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
                                {lookSearchResults.map((p: any) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className="w-full flex items-center gap-3 p-2 text-left hover-elevate transition-colors"
                                    onClick={() => {
                                      setProductForm({
                                        ...productForm,
                                        lookProducts: [...productForm.lookProducts, p.id]
                                      });
                                      setLookSearchQuery("");
                                    }}
                                    data-testid={`button-add-look-${p.id}`}
                                  >
                                    <img 
                                      src={p.thumbnailUrl || p.imageUrl} 
                                      alt={p.name} 
                                      className="w-8 h-10 object-cover rounded"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm truncate">{p.name}</p>
                                      <p className="text-xs text-muted-foreground">{p.category} · {p.price ? `${(p.price / 100).toLocaleString('ru-RU')} ₽` : ''}</p>
                                    </div>
                                    <Plus className="w-4 h-4 text-muted-foreground" />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {productForm.lookProducts.length >= 6 && (
                          <p className="text-xs text-muted-foreground">Максимум 6 товаров для образа</p>
                        )}
                      </div>

                      {/* Preorder Settings */}
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="preorder" className="border rounded-md px-3">
                          <AccordionTrigger className="text-sm font-medium py-3" data-testid="accordion-preorder-settings">
                            <div className="flex items-center gap-2">
                              <Target className="w-4 h-4 text-muted-foreground" />
                              Предзаказ
                              {productForm.preorderEnabled && (
                                <span className="text-[10px] bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded">включён</span>
                              )}
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="space-y-4 pb-4">
                            <div className="flex items-center gap-3">
                              <Switch
                                checked={productForm.preorderEnabled}
                                onCheckedChange={(checked) => setProductForm({...productForm, preorderEnabled: checked})}
                                data-testid="switch-preorder-enabled"
                              />
                              <Label className="text-sm">Включить предзаказ</Label>
                            </div>

                            {productForm.preorderEnabled && (
                              <div className="space-y-3 pt-2">
                                <div>
                                  <label className="text-xs font-medium text-muted-foreground block mb-1">Сбор до</label>
                                  <Input
                                    type="date"
                                    value={productForm.preorderDeadline}
                                    onChange={(e) => setProductForm({...productForm, preorderDeadline: e.target.value})}
                                    data-testid="input-preorder-deadline"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-muted-foreground block mb-1">В производстве</label>
                                  <Input
                                    type="date"
                                    value={productForm.preorderProductionDate}
                                    onChange={(e) => setProductForm({...productForm, preorderProductionDate: e.target.value})}
                                    data-testid="input-preorder-production-date"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-muted-foreground block mb-1">Отправка</label>
                                  <Input
                                    type="date"
                                    value={productForm.preorderShippingDate}
                                    onChange={(e) => setProductForm({...productForm, preorderShippingDate: e.target.value})}
                                    data-testid="input-preorder-shipping-date"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-muted-foreground block mb-1">Коллаборация</label>
                                  <Select
                                    value={productForm.preorderGroup || "__none__"}
                                    onValueChange={(v) => setProductForm({...productForm, preorderGroup: v === "__none__" ? "" : v})}
                                  >
                                    <SelectTrigger data-testid="input-preorder-group">
                                      <SelectValue placeholder="Выберите кампанию…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">— Не привязан —</SelectItem>
                                      {preorderCampaignsList.map((c: any) => (
                                        <SelectItem key={c.slug} value={c.slug}>
                                          {c.title} ({c.slug})
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Покупатель оплачивает полную стоимость при оформлении предзаказа.
                                </p>
                              </div>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>

                      {/* Feature Badge Block */}
                      <div className="border rounded-md px-3 py-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Значки-характеристики</span>
                          {productForm.featureBadgeIds.length > 0 && (
                            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">{productForm.featureBadgeIds.length} выбрано</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          Отметьте блоки, которые покажутся под кнопкой «В корзину». Шаблоны создаются в разделе «Шаблоны значков» над списком товаров. Если ничего не выбрано — блок не показывается.
                        </p>
                        {featureBadgeTemplatesList.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground italic">Шаблонов пока нет — создайте их в разделе «Шаблоны характеристик товара» над списком товаров.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {featureBadgeTemplatesList.map((t) => {
                              const Icon = getFeatureBadgeIcon(t.icon);
                              const active = productForm.featureBadgeIds.includes(t.id);
                              return (
                                <button
                                  key={t.id}
                                  type="button"
                                  onClick={() => {
                                    setProductForm({
                                      ...productForm,
                                      featureBadgeIds: active
                                        ? productForm.featureBadgeIds.filter((id) => id !== t.id)
                                        : [...productForm.featureBadgeIds, t.id],
                                    });
                                  }}
                                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs transition-colors ${
                                    active ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:text-foreground"
                                  }`}
                                  data-testid={`button-toggle-feature-badge-${t.id}`}
                                >
                                  <Icon className="w-3.5 h-3.5" />
                                  {t.title}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* SEO Settings */}
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="seo" className="border rounded-md px-3">
                          <AccordionTrigger className="text-sm font-medium py-3" data-testid="accordion-seo-settings">
                            <div className="flex items-center gap-2">
                              <Search className="w-4 h-4 text-muted-foreground" />
                              SEO-настройки
                              {(productForm.seoTitle || productForm.seoDescription || productForm.seoBody || productForm.imageAlts.some(a => a.trim())) && (
                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">заполнено</span>
                              )}
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="space-y-4 pb-4">
                            <p className="text-xs text-muted-foreground">
                              Если поля пустые, SEO-данные генерируются автоматически из данных товара. Заполните вручную для максимального результата.
                            </p>
                            
                            <div>
                              <label className="text-sm font-medium">URL Slug</label>
                              <div className="flex gap-2">
                                <Input
                                  value={productForm.slug}
                                  onChange={(e) => setProductForm({...productForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')})}
                                  placeholder="auto-generated-from-name"
                                  data-testid="input-product-slug"
                                  className="flex-1"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const map: Record<string,string> = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'};
                                    const slug = productForm.name.split('').map((c: string) => map[c.toLowerCase()] ?? c).join('').toLowerCase().replace(/[()]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
                                    setProductForm({...productForm, slug});
                                  }}
                                  data-testid="button-generate-slug"
                                >
                                  Сгенерировать
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">URL-адрес товара для совместимости со старыми ссылками. Генерируется автоматически, но можно изменить вручную.</p>
                            </div>

                            <div>
                              <label className="text-sm font-medium">Артист</label>
                              <Select
                                value={productForm.artistSlug || "__none__"}
                                onValueChange={(v) => setProductForm({...productForm, artistSlug: v === "__none__" ? "" : v})}
                              >
                                <SelectTrigger data-testid="select-artist-slug">
                                  <SelectValue placeholder="Не выбран" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">— Не выбран —</SelectItem>
                                  {artistPartnersList.map((a) => (
                                    <SelectItem key={a.partnerSlug} value={a.partnerSlug}>
                                      {a.storeName || a.contactName} <span className="text-muted-foreground text-xs ml-1">({a.partnerSlug})</span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-muted-foreground mt-1">Выберите артиста-партнёра, которому принадлежит товар. Отображаются только одобренные партнёры с флагом «Артист».</p>
                            </div>

                            <div>
                              <label className="text-xs font-medium text-muted-foreground block mb-1">SEO-заголовок (Title)</label>
                              <Input
                                placeholder="Оставьте пустым — будет применён авто-заголовок"
                                value={productForm.seoTitle}
                                onChange={(e) => setProductForm({...productForm, seoTitle: e.target.value})}
                                data-testid="input-seo-title"
                              />
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {productForm.seoTitle.length}/70 символов (рекомендуется 50-70)
                              </p>
                              {productForm.name && (
                                <div className="mt-1 flex items-start gap-2 rounded-md bg-muted/50 border px-3 py-2">
                                  <p className="text-[11px] text-muted-foreground flex-1 select-text cursor-text leading-relaxed">
                                    {[
                                      CATEGORIES[productForm.category as CategorySlug]?.name,
                                      productForm.name,
                                      productForm.color
                                    ].filter(Boolean).join(" ") + " — купить"}
                                  </p>
                                  <button
                                    type="button"
                                    className="text-[11px] text-primary font-medium whitespace-nowrap hover:underline shrink-0"
                                    onClick={() => setProductForm({...productForm, seoTitle: [
                                      CATEGORIES[productForm.category as CategorySlug]?.name,
                                      productForm.name,
                                      productForm.color
                                    ].filter(Boolean).join(" ") + " — купить"})}
                                  >
                                    Использовать
                                  </button>
                                </div>
                              )}
                            </div>

                            <div>
                              <label className="text-xs font-medium text-muted-foreground block mb-1">SEO-описание (Meta Description)</label>
                              <Textarea
                                placeholder="Оставьте пустым — будет применено авто-описание"
                                value={productForm.seoDescription}
                                onChange={(e) => setProductForm({...productForm, seoDescription: e.target.value})}
                                rows={3}
                                className="resize-none"
                                data-testid="input-seo-description"
                              />
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {productForm.seoDescription.length}/160 символов (рекомендуется 120-160)
                              </p>
                              {productForm.name && (
                                <div className="mt-1 flex items-start gap-2 rounded-md bg-muted/50 border px-3 py-2">
                                  <p className="text-[11px] text-muted-foreground flex-1 select-text cursor-text leading-relaxed">
                                    {[
                                      `${productForm.name} BOOOMERANGS`,
                                      CATEGORIES[productForm.category as CategorySlug]?.name ? `(${CATEGORIES[productForm.category as CategorySlug].name})` : "",
                                      productForm.color ? `цвет: ${productForm.color}` : "",
                                      productForm.sizes?.length > 0 ? `Размеры: ${productForm.sizes.join(", ")}.` : "",
                                      "Доставка по России СДЭК.",
                                      productForm.description ? productForm.description.slice(0, 80) : "",
                                    ].filter(Boolean).join(" ").slice(0, 220)}
                                  </p>
                                  <button
                                    type="button"
                                    className="text-[11px] text-primary font-medium whitespace-nowrap hover:underline shrink-0"
                                    onClick={() => setProductForm({...productForm, seoDescription: [
                                      `${productForm.name} BOOOMERANGS`,
                                      CATEGORIES[productForm.category as CategorySlug]?.name ? `(${CATEGORIES[productForm.category as CategorySlug].name})` : "",
                                      productForm.color ? `цвет: ${productForm.color}` : "",
                                      productForm.sizes?.length > 0 ? `Размеры: ${productForm.sizes.join(", ")}.` : "",
                                      "Доставка по России СДЭК.",
                                      productForm.description ? productForm.description.slice(0, 80) : "",
                                    ].filter(Boolean).join(" ").slice(0, 220)})}
                                  >
                                    Использовать
                                  </button>
                                </div>
                              )}
                            </div>

                            <div>
                              <label className="text-xs font-medium text-muted-foreground block mb-1">SEO-текст на странице (HTML)</label>
                              <Textarea
                                placeholder={'Вставьте HTML-блок с описанием: <p>, <strong>, <ul>/<li>. Тег <h1> будет автоматически понижен до <h2>, <title> — вырезан.'}
                                value={productForm.seoBody}
                                onChange={(e) => setProductForm({...productForm, seoBody: e.target.value})}
                                rows={8}
                                className="font-mono text-xs"
                                data-testid="input-seo-body"
                              />
                              <p className="text-[10px] text-muted-foreground mt-1">
                                Показывается на странице товара под описанием (для этого конкретного цвета/варианта). Если оставить пустым — блок не появится. Из вставленного HTML тег &lt;h1&gt; автоматически станет &lt;h2&gt;, а &lt;title&gt; будет удалён — незачем их вырезать вручную.
                              </p>
                            </div>

                            {productForm.images.length > 0 && (
                              <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-2">Alt-тексты для изображений</label>
                                <p className="text-[10px] text-muted-foreground mb-2">
                                  Опишите что на каждом фото: "общий вид спереди", "деталь принта", "примерка на модели" и т.д.
                                </p>
                                <div className="space-y-2">
                                  {productForm.images.map((img, idx) => {
                                    const defaultLabels = ["вид спереди", "детальная вид спереди", "детальная вид сзади", "общий вид с левого бока", "общий вид с правого бока", "общий вид сзади", "бирка и размерная сетка", "дополнительный ракурс"];
                                    return (
                                      <div key={idx} className="flex gap-2 items-start">
                                        <img 
                                          src={img.includes('storage.yandexcloud') ? img.replace(/\.webp/i, '_thumb.webp') : img}
                                          alt={`Фото ${idx + 1}`}
                                          className="w-10 h-12 object-cover rounded flex-shrink-0 bg-muted"
                                        />
                                        <div className="flex-1">
                                          <Input
                                            placeholder={`Авто: ${productForm.name} BOOOMERANGS, ${defaultLabels[idx] || `фото ${idx + 1}`}`}
                                            value={productForm.imageAlts[idx] || ""}
                                            onChange={(e) => {
                                              const newAlts = [...productForm.imageAlts];
                                              while (newAlts.length <= idx) newAlts.push("");
                                              newAlts[idx] = e.target.value;
                                              setProductForm({...productForm, imageAlts: newAlts});
                                            }}
                                            data-testid={`input-image-alt-${idx}`}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>

                      {/* Save button */}
                      <div className="pt-4 border-t flex gap-3">
                        <Button
                          onClick={() => {
                            const data = {
                              ...productForm,
                              price: parseInt(productForm.price) || 0,
                              wholesalePrice: parseInt(productForm.wholesalePrice) || undefined,
                              discountPercent: productForm.discountPercent ? parseInt(productForm.discountPercent) : 0,
                              salePrice: productForm.salePrice ? parseInt(productForm.salePrice) : null,
                              measurements: productForm.measurementSections.length > 0 ? [] : (productForm.measurements.length > 0 ? productForm.measurements : undefined),
                              measurementSections: productForm.measurementSections.length > 0 ? productForm.measurementSections : [],
                              lookProducts: productForm.lookProducts.length > 0 ? productForm.lookProducts : [],
                              lookCategory: productForm.lookCategory || null,
                              lookSubcategory: productForm.lookSubcategory || null,
                              seoTitle: productForm.seoTitle || "",
                              seoDescription: productForm.seoDescription || "",
                              imageAlts: productForm.imageAlts.filter(a => a.trim() !== ""),
                              preorderEnabled: productForm.preorderEnabled,
                              preorderDeadline: productForm.preorderDeadline || null,
                              preorderProductionDate: productForm.preorderProductionDate || null,
                              preorderShippingDate: productForm.preorderShippingDate || null,
                              preorderGroup: productForm.preorderGroup || null,
                              stock: productForm.stock !== "" ? parseInt(productForm.stock) : undefined,
                              sizeStock: Object.keys(productForm.sizeStock).length > 0 ? productForm.sizeStock : undefined,
                              sizeDiscounts: productForm.sizeDiscounts,
                              disabledNotifySizes: productForm.disabledNotifySizes.length > 0 ? productForm.disabledNotifySizes : undefined,
                              artistSlug: productForm.artistSlug || null,
                              videoUrl: productForm.videoUrl || null,
                            };
                            
                            console.log('[Save] isCreating:', isCreatingProduct, 'editingId:', editingProductId, 'lookProducts:', data.lookProducts, 'lookCategory:', data.lookCategory, 'lookSubcategory:', data.lookSubcategory);
                            
                            if (isCreatingProduct) {
                              createProductMutation.mutate(data);
                            } else if (editingProductId) {
                              console.log('[Save] Sending PATCH for product', editingProductId);
                              updateProductMutation.mutate({ id: editingProductId, data });
                            } else {
                              console.log('[Save] ERROR: No editingProductId, cannot save!');
                            }
                          }}
                          disabled={createProductMutation.isPending || updateProductMutation.isPending || !productForm.name || !productForm.price || (isCreatingProduct && !productForm.category)}
                          data-testid="button-save-product"
                        >
                          {(createProductMutation.isPending || updateProductMutation.isPending) ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4 mr-2" />
                          )}
                          {isCreatingProduct ? "Создать товар" : "Сохранить изменения"}
                        </Button>
                        {editingProductId && (
                          <Link href={`/${productForm.slug || editingProductId}`} target="_blank">
                            <Button variant="outline" type="button">
                              <Eye className="w-4 h-4 mr-2" />
                              Открыть страницу
                            </Button>
                          </Link>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Category browser when nothing selected */}
                {!editingProductId && !isCreatingProduct && (
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Package className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Навигация по категориям</span>
                        {browseCategory && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs ml-auto"
                            onClick={() => { setBrowseCategory(null); setBrowseSubcategory(null); }}
                            data-testid="button-browse-reset"
                          >
                            Сбросить
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {Object.entries(CATEGORIES).map(([slug, cat]) => {
                          const count = products.filter(p => p.category === slug || (p.additionalCategories || []).some((ac: any) => ac.category === slug)).length;
                          return (
                            <Button
                              key={slug}
                              variant={browseCategory === slug ? "secondary" : "outline"}
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                setBrowseCategory(browseCategory === slug ? null : slug);
                                setBrowseSubcategory(null);
                              }}
                              data-testid={`button-browse-category-${slug}`}
                            >
                              {browseCategory === slug ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                              {cat.name} ({count})
                            </Button>
                          );
                        })}
                      </div>

                      {browseCategory && mergedSubcategoriesFor(browseCategory).length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3 pl-4 border-l-2 border-muted">
                          <Button
                            variant={browseSubcategory === null ? "secondary" : "ghost"}
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => setBrowseSubcategory(null)}
                            data-testid="button-browse-subcategory-all"
                          >
                            Все
                          </Button>
                          {mergedSubcategoriesFor(browseCategory).map((sub) => {
                            const subNorm = sub.name.toLowerCase().trim();
                            const subCount = products.filter(p => {
                              const mainMatch = p.category === browseCategory && p.subcategory?.toLowerCase().trim() === subNorm;
                              const addMatch = (p.additionalCategories || []).some((ac: any) => ac.category === browseCategory && ac.subcategory?.toLowerCase().trim() === subNorm);
                              return mainMatch || addMatch;
                            }).length;
                            return (
                              <Button
                                key={sub.slug}
                                variant={browseSubcategory === sub.name ? "secondary" : "ghost"}
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() => setBrowseSubcategory(browseSubcategory === sub.name ? null : sub.name)}
                                data-testid={`button-browse-subcategory-${sub.slug}`}
                              >
                                {sub.name} ({subCount})
                              </Button>
                            );
                          })}
                        </div>
                      )}

                      {browseCategory && (
                        <div ref={browseListRef} className="border rounded-md overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
                          {browseCategoryProducts.length === 0 ? (
                            <div className="p-4 text-center text-sm text-muted-foreground">
                              Нет товаров в этой категории
                            </div>
                          ) : (
                            <>
                              <div className="p-2 bg-muted/50 text-xs text-muted-foreground border-b sticky top-0">
                                Найдено: {browseCategoryProducts.length} товаров
                              </div>
                              {browseCategoryProducts.map((p) => (
                                <div
                                  key={p.id}
                                  className="flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer border-b last:border-b-0 transition-colors"
                                  onClick={() => {
                                    if (browseListRef.current) browseScrollSaveRef.current = browseListRef.current.scrollTop;
                                    loadProductForEdit(p.id);
                                    setProductSearchQuery("");
                                  }}
                                  data-testid={`browse-product-${p.id}`}
                                >
                                  <img
                                    src={p.thumbnailUrl || p.imageUrl || "/placeholder.svg"}
                                    alt=""
                                    className="w-10 h-12 object-cover rounded flex-shrink-0 bg-muted"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{p.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {p.sku && `${p.sku} • `}{p.subcategory || "Без подкатегории"}
                                      {(p.additionalCategories || []).length > 0 && (
                                        <span className="ml-1 text-blue-400">+{(p.additionalCategories || []).length} кат.</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <div className="text-sm font-medium">{(p.price / 100).toLocaleString('ru-RU')} ₽</div>
                                    {p.discountPercent && p.discountPercent > 0 && (
                                      <div className="text-xs text-red-400">-{p.discountPercent}%</div>
                                    )}
                                  </div>
                                  <div className="flex-shrink-0">
                                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                                  </div>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      )}

                      {!browseCategory && (
                        <p className="text-xs text-muted-foreground text-center mt-2">
                          Выберите категорию выше или используйте поиск для быстрого нахождения товара
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        )}

        {/* Wholesale Tab */}
        {activeTab === "wholesale" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Users className="w-5 h-5" />
                Оптовые покупатели
              </h2>
              <Button variant="ghost" size="sm" onClick={() => refetchWholesale()}>
                <RefreshCw className="w-4 h-4 mr-1" />
                Обновить
              </Button>
            </div>

            <InvoiceVatSettings apiKey={apiKey} />

            {wholesaleLoading ? (
              <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
            ) : wholesaleUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">Заявок нет</div>
            ) : (
              <div className="space-y-3">
                {wholesaleUsers.map((user) => (
                  <Card key={user.id} className={user.wholesaleApproved ? "" : "border-amber-500/50"}>
                    <CardContent className="p-4">
                      <div className="flex flex-col md:flex-row md:items-start gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{user.name}</span>
                            <span className="text-sm text-muted-foreground">{user.email}</span>
                            {user.emailVerified ? (
                              <Badge variant="secondary" className="text-xs">Email подтверждён</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-amber-500">Email не подтверждён</Badge>
                            )}
                            {user.wholesaleApproved ? (
                              <Badge className="bg-green-600 text-xs">Подтверждён</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-xs">Ожидает</Badge>
                            )}
                          </div>
                          
                          {user.companyName && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                              <div><span className="text-muted-foreground">Компания:</span> {user.companyName}</div>
                              {user.inn && <div><span className="text-muted-foreground">ИНН:</span> {user.inn}</div>}
                              {user.kpp && <div><span className="text-muted-foreground">КПП:</span> {user.kpp}</div>}
                              {user.contactPerson && <div><span className="text-muted-foreground">Контакт:</span> {user.contactPerson}</div>}
                              {user.contactPhone && <div><span className="text-muted-foreground">Телефон:</span> {user.contactPhone}</div>}
                              {user.legalAddress && <div className="md:col-span-2"><span className="text-muted-foreground">Адрес:</span> {user.legalAddress}</div>}
                            </div>
                          )}
                          
                          {user.createdAt && (
                            <div className="text-xs text-muted-foreground">
                              Зарегистрирован: {new Date(user.createdAt).toLocaleDateString('ru-RU')}
                            </div>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-2 shrink-0">
                          {user.wholesaleApproved ? (
                            <>
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  defaultValue={user.wholesaleDiscount}
                                  min={0}
                                  max={100}
                                  className="w-20 h-8 text-center"
                                  onBlur={(e) => {
                                    const newDiscount = parseInt(e.target.value);
                                    if (!isNaN(newDiscount) && newDiscount !== user.wholesaleDiscount) {
                                      updateDiscountMutation.mutate({ userId: user.id, discount: newDiscount });
                                    }
                                  }}
                                  data-testid={`input-discount-${user.id}`}
                                />
                                <span className="text-sm text-muted-foreground">%</span>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { setSetPasswordValue(""); setSetPasswordDialog({ open: true, userId: user.id, userName: user.name || user.email }); }}
                                data-testid={`button-set-password-${user.id}`}
                              >
                                <Lock className="w-4 h-4 mr-1" />
                                Пароль
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive"
                                onClick={() => confirm("Отозвать доступ?") && rejectWholesaleMutation.mutate(user.id)}
                                disabled={rejectWholesaleMutation.isPending}
                                data-testid={`button-revoke-${user.id}`}
                              >
                                <X className="w-4 h-4 mr-1" />
                                Отозвать
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => confirm("Удалить оптовика? Это действие необратимо.") && deleteWholesaleMutation.mutate(user.id)}
                                disabled={deleteWholesaleMutation.isPending}
                                data-testid={`button-delete-wholesale-${user.id}`}
                              >
                                <Trash2 className="w-4 h-4 mr-1" />
                                Удалить
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => approveWholesaleMutation.mutate({ userId: user.id, discount: 30 })}
                                disabled={approveWholesaleMutation.isPending}
                                data-testid={`button-approve-${user.id}`}
                              >
                                <Check className="w-4 h-4 mr-1" />
                                Подтвердить
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => rejectWholesaleMutation.mutate(user.id)}
                                disabled={rejectWholesaleMutation.isPending}
                                data-testid={`button-reject-${user.id}`}
                              >
                                <X className="w-4 h-4 mr-1" />
                                Отклонить
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { setSetPasswordValue(""); setSetPasswordDialog({ open: true, userId: user.id, userName: user.name || user.email }); }}
                                data-testid={`button-set-password-pending-${user.id}`}
                              >
                                <Lock className="w-4 h-4 mr-1" />
                                Пароль
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => confirm("Удалить оптовика? Это действие необратимо.") && deleteWholesaleMutation.mutate(user.id)}
                                disabled={deleteWholesaleMutation.isPending}
                                data-testid={`button-delete-wholesale-${user.id}`}
                              >
                                <Trash2 className="w-4 h-4 mr-1" />
                                Удалить
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Wholesale Preorder Products */}
            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Товары для оптового предзаказа
                </h2>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск товара..."
                    value={wholesalePreorderSearch}
                    onChange={e => setWholesalePreorderSearch(e.target.value)}
                    className="pl-8 w-56 h-9 text-sm"
                    data-testid="input-wholesale-preorder-search"
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Включите товары, которые должны отображаться на странице <code>/wholesale/preorder</code>. Розничный предзаказ — отдельная настройка в карточке товара.</p>
              {isLoading ? (
                <div className="text-sm text-muted-foreground">Загрузка...</div>
              ) : (
                <div className="space-y-2">
                  {(data?.products || [])
                    .filter(p => !wholesalePreorderSearch || p.name.toLowerCase().includes(wholesalePreorderSearch.toLowerCase()) || (p.sku || "").toLowerCase().includes(wholesalePreorderSearch.toLowerCase()))
                    .map(p => {
                      const serverEnabled = !!(p as any).wholesalePreorderEnabled;
                      const isEnabled = wholesalePreorderLocalState[p.id] !== undefined ? wholesalePreorderLocalState[p.id] : serverEnabled;
                      const dates = wholesalePreorderDates[p.id] || {
                        deadline: (p as any).preorderDeadline || "",
                        shipping: (p as any).preorderShippingDate || "",
                        production: (p as any).preorderProductionDate || "",
                      };
                      return (
                        <Card key={p.id} className={`border ${isEnabled ? "border-primary/40 bg-primary/5" : ""}`} data-testid={`card-wholesale-preorder-product-${p.id}`}>
                          <CardContent className="p-3">
                            <div className="flex items-start gap-3">
                              {p.thumbnailUrl || p.imageUrl ? (
                                <img src={p.thumbnailUrl || p.imageUrl} alt={p.name} className="w-12 h-12 object-cover rounded shrink-0" />
                              ) : (
                                <div className="w-12 h-12 bg-muted rounded shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">{p.name}</p>
                                    {p.sku && <p className="text-xs text-muted-foreground">Арт: {p.sku}</p>}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {isEnabled && <Badge variant="outline" className="text-xs border-primary text-primary">Оптовый предзаказ</Badge>}
                                    <Switch
                                      checked={isEnabled}
                                      onCheckedChange={checked => {
                                        setWholesalePreorderLocalState(prev => ({ ...prev, [p.id]: checked }));
                                        const _prices = wholesalePreorderPricesState[p.id];
                                        toggleWholesalePreorderMutation.mutate({
                                          productId: p.id,
                                          enabled: checked,
                                          preorderDeadline: dates.deadline || undefined,
                                          preorderShippingDate: dates.shipping || undefined,
                                          preorderProductionDate: dates.production || undefined,
                                          wholesalePreorderSizes: wholesalePreorderSizesState[p.id] !== undefined
                                            ? wholesalePreorderSizesState[p.id]
                                            : ((p as any).wholesalePreorderSizes?.length > 0
                                                ? (p as any).wholesalePreorderSizes
                                                : (Array.isArray(p.sizes) && p.sizes.length > 0
                                                    ? p.sizes as string[]
                                                    : ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"])),
                                          wholesalePreorderRrp: _prices?.rrp ? Math.round(parseFloat(_prices.rrp) * 100) : undefined,
                                          wholesalePrice: _prices?.wholesale ? Math.round(parseFloat(_prices.wholesale) * 100) : undefined,
                                          wholesalePreorderPrice: _prices?.preorder ? Math.round(parseFloat(_prices.preorder) * 100) : undefined,
                                        });
                                      }}
                                      data-testid={`switch-wholesale-preorder-${p.id}`}
                                    />
                                  </div>
                                </div>
                                {isEnabled && (
                                  <div className="mt-3 grid grid-cols-3 gap-2">
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-muted-foreground">Сбор до</label>
                                      <Input
                                        type="date"
                                        value={dates.deadline}
                                        className="h-7 text-xs"
                                        onChange={e => setWholesalePreorderDates(prev => ({ ...prev, [p.id]: { ...dates, deadline: e.target.value } }))}
                                        data-testid={`input-wholesale-deadline-${p.id}`}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-muted-foreground">Производство</label>
                                      <Input
                                        type="date"
                                        value={dates.production}
                                        className="h-7 text-xs"
                                        onChange={e => setWholesalePreorderDates(prev => ({ ...prev, [p.id]: { ...dates, production: e.target.value } }))}
                                        data-testid={`input-wholesale-production-${p.id}`}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-muted-foreground">Отгрузка</label>
                                      <Input
                                        type="date"
                                        value={dates.shipping}
                                        className="h-7 text-xs"
                                        onChange={e => setWholesalePreorderDates(prev => ({ ...prev, [p.id]: { ...dates, shipping: e.target.value } }))}
                                        data-testid={`input-wholesale-shipping-${p.id}`}
                                      />
                                    </div>
                                    {/* Prices for wholesale preorder */}
                                    {(() => {
                                      const prices = wholesalePreorderPricesState[p.id] || {
                                        rrp: (p as any).wholesalePreorderRrp ? String(Math.round((p as any).wholesalePreorderRrp / 100)) : String(Math.round((p.price || 0) / 100)),
                                        wholesale: (p as any).wholesalePrice ? String(Math.round((p as any).wholesalePrice / 100)) : "",
                                        preorder: (p as any).wholesalePreorderPrice ? String(Math.round((p as any).wholesalePreorderPrice / 100)) : "",
                                      };
                                      const setPrice = (field: "rrp" | "wholesale" | "preorder", val: string) =>
                                        setWholesalePreorderPricesState(prev => ({ ...prev, [p.id]: { ...prices, [field]: val } }));
                                      return (
                                        <>
                                          <div className="space-y-1">
                                            <label className="text-[11px] text-muted-foreground">РРЦ, ₽</label>
                                            <Input
                                              type="number"
                                              value={prices.rrp}
                                              className="h-7 text-xs"
                                              placeholder="0"
                                              onChange={e => setPrice("rrp", e.target.value)}
                                              data-testid={`input-wholesale-rrp-${p.id}`}
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <label className="text-[11px] text-muted-foreground">Опт, ₽</label>
                                            <Input
                                              type="number"
                                              value={prices.wholesale}
                                              className="h-7 text-xs"
                                              placeholder="0"
                                              onChange={e => setPrice("wholesale", e.target.value)}
                                              data-testid={`input-wholesale-opt-${p.id}`}
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <label className="text-[11px] text-muted-foreground">Предзаказ, ₽</label>
                                            <Input
                                              type="number"
                                              value={prices.preorder}
                                              className="h-7 text-xs"
                                              placeholder="0"
                                              onChange={e => setPrice("preorder", e.target.value)}
                                              data-testid={`input-wholesale-preorder-price-${p.id}`}
                                            />
                                          </div>
                                        </>
                                      );
                                    })()}

                                    {/* Sizes for wholesale preorder */}
                                    {(() => {
                                      const productSizes: string[] = Array.isArray(p.sizes) && p.sizes.length > 0
                                        ? (p.sizes as string[])
                                        : ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
                                      const savedSizes: string[] = (p as any).wholesalePreorderSizes?.length > 0
                                        ? (p as any).wholesalePreorderSizes
                                        : productSizes;
                                      const activeSizes: string[] = wholesalePreorderSizesState[p.id] !== undefined
                                        ? wholesalePreorderSizesState[p.id]
                                        : savedSizes;
                                      const allSizes = Array.from(new Set([...productSizes, ...activeSizes]));
                                      return (
                                        <div className="col-span-3 space-y-1.5">
                                          <label className="text-[11px] text-muted-foreground">
                                            Размеры в предзаказе
                                            {!(Array.isArray(p.sizes) && p.sizes.length > 0) && (
                                              <span className="ml-1 text-muted-foreground/50">(стандартные)</span>
                                            )}
                                          </label>
                                          <div className="flex flex-wrap gap-1.5">
                                            {allSizes.map(size => {
                                              const isActive = activeSizes.includes(size);
                                              return (
                                                <button
                                                  key={size}
                                                  type="button"
                                                  onClick={() => {
                                                    const next = activeSizes.includes(size)
                                                      ? activeSizes.filter((s: string) => s !== size)
                                                      : [...activeSizes, size];
                                                    setWholesalePreorderSizesState(prev => ({ ...prev, [p.id]: next }));
                                                  }}
                                                  className={`px-2.5 py-0.5 text-xs rounded border font-medium transition-colors ${
                                                    isActive
                                                      ? "bg-primary text-primary-foreground border-primary"
                                                      : "bg-background text-muted-foreground border-border hover:border-primary/50"
                                                  }`}
                                                  data-testid={`btn-size-${p.id}-${size}`}
                                                >
                                                  {size}
                                                </button>
                                              );
                                            })}
                                          </div>
                                          <p className="text-[10px] text-muted-foreground/60">Нажмите на размер чтобы включить/выключить. Нажмите «Сохранить» для применения.</p>
                                        </div>
                                      );
                                    })()}

                                    <div className="col-span-3 flex justify-end">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        onClick={() => {
                                          const _prices = wholesalePreorderPricesState[p.id] || {
                                            rrp: (p as any).wholesalePreorderRrp ? String(Math.round((p as any).wholesalePreorderRrp / 100)) : String(Math.round((p.price || 0) / 100)),
                                            wholesale: (p as any).wholesalePrice ? String(Math.round((p as any).wholesalePrice / 100)) : "",
                                            preorder: (p as any).wholesalePreorderPrice ? String(Math.round((p as any).wholesalePreorderPrice / 100)) : "",
                                          };
                                          toggleWholesalePreorderMutation.mutate({
                                            productId: p.id,
                                            enabled: true,
                                            preorderDeadline: dates.deadline || undefined,
                                            preorderShippingDate: dates.shipping || undefined,
                                            preorderProductionDate: dates.production || undefined,
                                            wholesalePreorderSizes: wholesalePreorderSizesState[p.id] !== undefined
                                              ? wholesalePreorderSizesState[p.id]
                                              : ((p as any).wholesalePreorderSizes?.length > 0
                                                  ? (p as any).wholesalePreorderSizes
                                                  : (Array.isArray(p.sizes) && p.sizes.length > 0
                                                      ? p.sizes as string[]
                                                      : ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"])),
                                            wholesalePreorderRrp: _prices.rrp ? Math.round(parseFloat(_prices.rrp) * 100) : undefined,
                                            wholesalePrice: _prices.wholesale ? Math.round(parseFloat(_prices.wholesale) * 100) : undefined,
                                            wholesalePreorderPrice: _prices.preorder ? Math.round(parseFloat(_prices.preorder) * 100) : undefined,
                                          });
                                        }}
                                        disabled={toggleWholesalePreorderMutation.isPending}
                                        data-testid={`button-save-wholesale-dates-${p.id}`}
                                      >
                                        Сохранить
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Problems Tab - Combined view for hidden, no image, zero price products */}
        {activeTab === "problems" && (
          <div className="space-y-4">
            {/* Header with filters */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Ban className="w-5 h-5" />
                Проблемные товары
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Filter buttons */}
                <div className="flex gap-1 bg-muted/50 p-1 rounded-lg">
                  <Button
                    variant={problemsFilter === "all" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setProblemsFilter("all")}
                    className="h-7 text-xs"
                  >
                    Все
                    <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                      {hiddenProducts.length + noImageProducts.length + zeroPriceProducts.length}
                    </Badge>
                  </Button>
                  <Button
                    variant={problemsFilter === "hidden" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setProblemsFilter("hidden")}
                    className="h-7 text-xs"
                  >
                    <X className="w-3 h-3 mr-1" />
                    Скрытые
                    <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                      {hiddenProducts.length}
                    </Badge>
                  </Button>
                  <Button
                    variant={problemsFilter === "noimage" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setProblemsFilter("noimage")}
                    className="h-7 text-xs"
                  >
                    <Image className="w-3 h-3 mr-1" />
                    Без фото
                    <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                      {noImageProducts.length}
                    </Badge>
                  </Button>
                  <Button
                    variant={problemsFilter === "zeroprice" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setProblemsFilter("zeroprice")}
                    className="h-7 text-xs"
                  >
                    <DollarSign className="w-3 h-3 mr-1" />
                    Без цены
                    <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                      {zeroPriceProducts.length}
                    </Badge>
                  </Button>
                </div>
                
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Поиск по названию..."
                    value={problemsSearch}
                    onChange={(e) => setProblemsSearch(e.target.value)}
                    className="h-8 pl-8 pr-3 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-48"
                    data-testid="input-problems-search"
                  />
                </div>

                {/* Bulk actions */}
                {(problemsFilter === "all" || problemsFilter === "noimage") && noImageProducts.filter(p => !p.isHidden).length > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => autoHideProblematicMutation.mutate("noimage")}
                    disabled={autoHideProblematicMutation.isPending}
                  >
                    <EyeOff className="w-3 h-3 mr-1" />
                    Скрыть без фото ({noImageProducts.filter(p => !p.isHidden).length})
                  </Button>
                )}
                {(problemsFilter === "all" || problemsFilter === "zeroprice") && zeroPriceProducts.filter(p => !p.isHidden).length > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => autoHideProblematicMutation.mutate("zeroprice")}
                    disabled={autoHideProblematicMutation.isPending}
                  >
                    <EyeOff className="w-3 h-3 mr-1" />
                    Скрыть без цены ({zeroPriceProducts.filter(p => !p.isHidden).length})
                  </Button>
                )}
                
                <Button variant="ghost" size="sm" className="h-7" onClick={() => { refetchHidden(); refetchNoImage(); refetchZeroPrice(); }}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Selection toolbar */}
            {(() => {
              const allVisible = [
                ...(problemsFilter === "all" || problemsFilter === "hidden" ? hiddenProducts : []),
                ...(problemsFilter === "all" || problemsFilter === "noimage" ? noImageProducts : []),
                ...(problemsFilter === "all" || problemsFilter === "zeroprice" ? zeroPriceProducts : []),
              ].filter(p => !problemsSearch || p.name?.toLowerCase().includes(problemsSearch.toLowerCase()));
              const uniqueVisible = [...new Map(allVisible.map(p => [p.id, p])).values()];
              const allSelected = uniqueVisible.length > 0 && uniqueVisible.every(p => selectedProblems.has(p.id));
              return (
                <div className="flex items-center gap-2 flex-wrap py-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      if (allSelected) {
                        setSelectedProblems(new Set());
                      } else {
                        setSelectedProblems(new Set(uniqueVisible.map(p => p.id)));
                      }
                    }}
                    data-testid="button-select-all-problems"
                  >
                    {allSelected ? "Снять выбор" : `Выбрать все (${uniqueVisible.length})`}
                  </Button>
                  {selectedProblems.size > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground">Выбрано: {selectedProblems.size}</span>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setBulkDeleteConfirm(true)}
                        data-testid="button-bulk-delete-problems"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Удалить выбранные ({selectedProblems.size})
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setSelectedProblems(new Set())}
                      >
                        <X className="w-3 h-3 mr-1" />
                        Сбросить
                      </Button>
                    </>
                  )}
                </div>
              );
            })()}

            {/* Bulk delete confirmation dialog */}
            {bulkDeleteConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="bg-background rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                      <Trash2 className="w-5 h-5 text-destructive" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Удалить {selectedProblems.size} товар(ов)?</h3>
                      <p className="text-sm text-muted-foreground">Записи из БД и файлы из S3-хранилища будут удалены безвозвратно.</p>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setBulkDeleteConfirm(false)} disabled={bulkDeleting}>
                      Отмена
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={bulkDeleting}
                      data-testid="button-confirm-bulk-delete"
                      onClick={async () => {
                        setBulkDeleting(true);
                        try {
                          const result = await adminFetch("/api/admin/products/bulk-delete", apiKey, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ids: [...selectedProblems] }),
                          });
                          toast({ title: `Удалено ${result.deleted} товаров, файлов из S3: ${result.s3Deleted}` });
                          setSelectedProblems(new Set());
                          setBulkDeleteConfirm(false);
                          refetchHidden();
                          refetchNoImage();
                          refetchZeroPrice();
                        } catch (err: any) {
                          toast({ title: "Ошибка удаления", description: err.message, variant: "destructive" });
                        } finally {
                          setBulkDeleting(false);
                        }
                      }}
                    >
                      {bulkDeleting ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Удаление...</> : "Удалить"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Thumbnail Regeneration Card */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <ImageIcon className="w-4 h-4" />
                      Миниатюры каталога
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Создаёт оптимизированные миниатюры (800px, WebP quality 100) для карточек товаров. Улучшает скорость загрузки.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {thumbProgress && (
                      <div className="text-xs text-muted-foreground flex items-center gap-2" data-testid="text-thumb-progress">
                        <span>Создано: {thumbProgress.generated}</span>
                        {thumbProgress.failed > 0 && <span className="text-destructive">Ошибок: {thumbProgress.failed}</span>}
                        <span>Осталось: ~{thumbProgress.remaining}</span>
                      </div>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none" data-testid="label-thumb-force">
                      <input
                        type="checkbox"
                        checked={thumbForce}
                        onChange={(e) => setThumbForce(e.target.checked)}
                        className="rounded border-border"
                        data-testid="checkbox-thumb-force"
                      />
                      Перезаписать
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const offset = thumbProgress?.remaining === 0 ? 0 : (thumbProgress?.nextOffset || 0);
                        if (offset === 0) setThumbProgress(null);
                        regenThumbnailsMutation.mutate(offset);
                      }}
                      disabled={regenThumbnailsMutation.isPending}
                      data-testid="button-regen-thumbnails"
                    >
                      {regenThumbnailsMutation.isPending ? (
                        <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Обработка...</>
                      ) : thumbProgress && thumbProgress.remaining > 0 ? (
                        <>Продолжить (ещё ~{thumbProgress.remaining})</>
                      ) : (
                        <><RefreshCw className="w-3 h-3 mr-1" />Создать миниатюры</>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Loading state */}
            {(hiddenLoading || noImageLoading || zeroPriceLoading) ? (
              <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
            ) : (
              <>
                {/* Unified problematic product card renderer with reason badges */}
                {(() => {
                  const getProductReasons = (product: Product) => {
                    const reasons: { label: string; icon: 'hidden' | 'noimage' | 'noprice' | 'nostock' }[] = [];
                    if (product.isHidden) reasons.push({ label: 'Скрыт', icon: 'hidden' });
                    if (!product.imageUrl || product.imageUrl === '') reasons.push({ label: 'Нет фото', icon: 'noimage' });
                    if (!product.price || product.price <= 0) reasons.push({ label: 'Нет цены', icon: 'noprice' });
                    const stock = (product as any).stock ?? 0;
                    if (stock <= 0) reasons.push({ label: 'Нет в наличии', icon: 'nostock' });
                    return reasons;
                  };

                  const renderReasonBadges = (product: Product) => {
                    const reasons = getProductReasons(product);
                    if (reasons.length === 0) return null;
                    return (
                      <div className="flex flex-wrap gap-1" data-testid={`reasons-${product.id}`}>
                        {reasons.map((r, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              r.icon === 'hidden' ? 'bg-destructive/10 text-destructive' :
                              r.icon === 'noimage' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400' :
                              r.icon === 'noprice' ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' :
                              'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            }`}
                          >
                            {r.icon === 'hidden' && <EyeOff className="w-2.5 h-2.5" />}
                            {r.icon === 'noimage' && <Image className="w-2.5 h-2.5" />}
                            {r.icon === 'noprice' && <DollarSign className="w-2.5 h-2.5" />}
                            {r.icon === 'nostock' && <Package className="w-2.5 h-2.5" />}
                            {r.label}
                          </span>
                        ))}
                      </div>
                    );
                  };

                  const renderProductCard = (product: Product, keyPrefix: string) => {
                    const isSelected = selectedProblems.has(product.id);
                    return (
                      <Card
                        key={`${keyPrefix}-${product.id}`}
                        className={`overflow-hidden cursor-pointer transition-all ${isSelected ? 'ring-2 ring-destructive' : ''}`}
                        data-testid={`card-problem-${product.id}`}
                        onClick={() => setSelectedProblems(prev => {
                          const next = new Set(prev);
                          if (next.has(product.id)) next.delete(product.id); else next.add(product.id);
                          return next;
                        })}
                      >
                        <div className="relative aspect-square bg-muted">
                          {product.imageUrl ? (
                            <img src={product.thumbnailUrl || product.imageUrl} alt={product.name} className={`w-full h-full object-cover ${product.isHidden ? 'opacity-50' : ''}`} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                              <Package className="w-12 h-12 opacity-50" />
                            </div>
                          )}
                          {/* Checkbox indicator */}
                          <div className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-destructive border-destructive' : 'bg-background/80 border-muted-foreground/50'}`}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          {product.isHidden && <Badge variant="destructive" className="absolute top-2 right-2">Скрыт</Badge>}
                          {(!product.price || product.price <= 0) && <Badge variant="secondary" className="absolute bottom-2 left-2">0 ₽</Badge>}
                        </div>
                        <CardContent className="p-3">
                          <div className="space-y-2">
                            <h3 className="font-medium text-sm line-clamp-2">{product.name}</h3>
                            {problemsFilter === "all" && renderReasonBadges(product)}
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{product.sku}</span>
                              {keyPrefix === 'zeroprice' ? (
                                <span>Остаток: {(product as any).stock || 0}</span>
                              ) : (
                                <span>{(product.price / 100).toLocaleString('ru-RU')} ₽</span>
                              )}
                            </div>
                            <div className="flex gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={async (e) => { e.stopPropagation(); await loadProductForEdit(product.id); setActiveTab("pages"); setSelectedPage("product"); }}
                              >
                                <Pencil className="w-3.5 h-3.5 mr-1" />Изменить
                              </Button>
                              <Button
                                variant={product.isHidden ? "default" : "outline"}
                                size="sm"
                                className="flex-1"
                                onClick={(e) => { e.stopPropagation(); hideProductMutation.mutate({ productId: product.id, hidden: !product.isHidden }); }}
                                disabled={hideProductMutation.isPending}
                                data-testid={`button-toggle-visibility-${product.id}`}
                              >
                                {product.isHidden ? <><Eye className="w-3.5 h-3.5 mr-1" />Показать</> : <><EyeOff className="w-3.5 h-3.5 mr-1" />Скрыть</>}
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  };

                  return (
                    <>
                      {/* Hidden Products Section */}
                      {(problemsFilter === "all" || problemsFilter === "hidden") && (() => {
                        const filtered = hiddenProducts.filter(p => !problemsSearch || p.name?.toLowerCase().includes(problemsSearch.toLowerCase()));
                        return filtered.length > 0 && (
                          <div className="space-y-3">
                            {problemsFilter === "all" && (
                              <h3 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                                <X className="w-4 h-4" />
                                Скрытые товары ({filtered.length})
                              </h3>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                              {filtered.map((product) => renderProductCard(product, 'hidden'))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* No Image Products Section */}
                      {(problemsFilter === "all" || problemsFilter === "noimage") && (() => {
                        const filtered = noImageProducts.filter(p => !problemsSearch || p.name?.toLowerCase().includes(problemsSearch.toLowerCase()));
                        return filtered.length > 0 && (
                          <div className="space-y-3">
                            {problemsFilter === "all" && (
                              <h3 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                                <Image className="w-4 h-4" />
                                Без изображений ({filtered.length})
                              </h3>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                              {filtered.map((product) => renderProductCard(product, 'noimage'))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Zero Price Products Section */}
                      {(problemsFilter === "all" || problemsFilter === "zeroprice") && (() => {
                        const filtered = zeroPriceProducts.filter(p => !problemsSearch || p.name?.toLowerCase().includes(problemsSearch.toLowerCase()));
                        return filtered.length > 0 && (
                          <div className="space-y-3">
                            {problemsFilter === "all" && (
                              <h3 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                                <DollarSign className="w-4 h-4" />
                                Без цены ({filtered.length})
                              </h3>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                              {filtered.map((product) => renderProductCard(product, 'zeroprice'))}
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  );
                })()}

                {/* Empty state */}
                {hiddenProducts.length === 0 && noImageProducts.length === 0 && zeroPriceProducts.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Check className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Проблемных товаров нет</p>
                  </div>
                )}
                
                {problemsFilter === "hidden" && hiddenProducts.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">Скрытых товаров нет</div>
                )}
                {problemsFilter === "noimage" && noImageProducts.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">Все товары имеют изображения</div>
                )}
                {problemsFilter === "zeroprice" && zeroPriceProducts.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">Все товары имеют цену</div>
                )}
              </>
            )}
          </div>
        )}

        {/* Products Tab */}
        {activeTab === "products" && (
          <>
            <FeatureBadgeTemplatesManager apiKey={apiKey} />
          <div className="flex gap-4">
            {/* Category sidebar */}
            <div className="w-48 shrink-0 space-y-1">
              <Button
                variant={filterCategory === "all" ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start h-8"
                onClick={() => { setFilterCategory("all"); setFilterSubcategory(null); setFilterSubSubcategory(null); setProductsVisible(true); }}
                data-testid="button-category-all"
              >
                Все товары
                <Badge variant="outline" className="ml-auto">{products.length}</Badge>
              </Button>
              
              {Object.entries(editingCategories).map(([slug, cat]) => (
                <div key={slug}>
                  <Button
                    variant={filterCategory === slug && !filterSubcategory ? "secondary" : "ghost"}
                    size="sm"
                    className="w-full justify-start h-8"
                    onClick={() => { setFilterCategory(slug as CategorySlug); setFilterSubcategory(null); setFilterSubSubcategory(null); setProductsVisible(true); }}
                    data-testid={`button-category-${slug}`}
                  >
                    {cat.name}
                    <Badge variant="outline" className="ml-auto">{categoryCounts[slug] || 0}</Badge>
                  </Button>
                  
                  {/* Subcategories */}
                  {filterCategory === slug && cat.subcategories.length > 0 && (
                    <div className="ml-3 mt-1 space-y-0.5">
                      {cat.subcategories.map(sub => {
                        const subName = typeof sub === 'string' ? sub : sub.name;
                        const subSubcategories: AdminSubSubcategoryConfig[] = (sub as any).subSubcategories || [];
                        return (
                          <div key={subName}>
                            <Button
                              variant={filterSubcategory === subName ? "secondary" : "ghost"}
                              size="sm"
                              className="w-full justify-start h-7 text-xs"
                              onClick={() => { setFilterSubcategory(subName); setFilterSubSubcategory(null); setProductsVisible(true); }}
                              data-testid={`button-subcategory-${subName}`}
                            >
                              {subName}
                              <Badge variant="outline" className="ml-auto text-xs">
                                {subcategoryCounts[subName] || 0}
                              </Badge>
                            </Button>
                            {/* Sub-subcategories */}
                            {filterSubcategory === subName && subSubcategories.length > 0 && (
                              <div className="ml-3 mt-0.5 space-y-0.5">
                                {subSubcategories.map(ss => (
                                  <Button
                                    key={ss.name}
                                    variant={filterSubSubcategory === ss.name ? "secondary" : "ghost"}
                                    size="sm"
                                    className="w-full justify-start h-6 text-xs"
                                    onClick={() => { setFilterSubSubcategory(ss.name); setProductsVisible(true); }}
                                    data-testid={`button-subsubcategory-${ss.name}`}
                                  >
                                    <span className="truncate">{ss.name}</span>
                                    <Badge variant="outline" className="ml-auto text-xs shrink-0">
                                      {subSubcategoryCounts[ss.name] || 0}
                                    </Badge>
                                  </Button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Products list */}
            <div className="flex-1 min-w-0">
              {!productsVisible ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground select-none">
                  <span className="text-5xl mb-4">📦</span>
                  <p className="font-medium text-base mb-1">Выберите категорию</p>
                  <p className="text-sm">Нажмите на категорию слева, чтобы загрузить товары</p>
                </div>
              ) : isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
              ) : filteredProducts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Товары не найдены
                  {filterCategory !== "all" && (
                    <Button variant="ghost" onClick={() => { setFilterCategory("all"); setFilterSubcategory(null); setFilterSubSubcategory(null); }}>
                      Показать все
                    </Button>
                  )}
                </div>
              ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="p-2 text-left w-8">
                      <input
                        type="checkbox"
                        checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0}
                        onChange={selectAll}
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    <th className="p-2 text-left w-12"></th>
                    <th className="p-2 text-left">Название</th>
                    <th className="p-2 text-left w-24">Артикул</th>
                    <th className="p-2 text-left w-28">Категория</th>
                    <th className="p-2 text-left w-20">Цена</th>
                    <th className="p-2 text-left w-16">Остаток</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => (
                    <tr key={product.id} className="border-b hover:bg-muted/30">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selectedProducts.has(product.id)}
                          onChange={() => toggleSelect(product.id)}
                          data-testid={`checkbox-product-${product.id}`}
                        />
                      </td>
                      <td className="p-1">
                        <img
                          src={product.thumbnailUrl || product.imageUrl}
                          alt=""
                          className="w-10 h-10 object-cover rounded"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "/attached_assets/generated_images/oversized_black_t-shirt_streetwear.png";
                          }}
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-1.5 max-w-xs">
                          <span className="truncate" title={typeof product.name === 'string' ? product.name : 'Unknown'}>
                            {typeof product.name === 'string' ? product.name : JSON.stringify(product.name)}
                          </span>
                          {product.isNew && (
                            <span
                              className="shrink-0 bg-primary text-white px-1.5 py-0.5 text-[9px] font-medium rounded-sm uppercase cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                setBadgeDialogProductId(product.id);
                                const currentBadge = (product as any).badgeText;
                                let initialText = "NEW";
                                if (typeof currentBadge === 'string') {
                                  initialText = currentBadge;
                                } else if (currentBadge && typeof currentBadge === 'object' && 'data' in currentBadge) {
                                  initialText = new TextDecoder().decode(new Uint8Array(currentBadge.data));
                                }
                                setBadgeDialogText(initialText);
                                setBadgeDialogOpen(true);
                              }}
                              title="Нажмите чтобы изменить текст бейджа"
                              data-testid={`badge-text-${product.id}`}
                            >
                              {(() => {
                                const bt = (product as any).badgeText;
                                if (typeof bt === 'string') return bt;
                                if (bt && typeof bt === 'object' && 'data' in bt) {
                                  try {
                                    return new TextDecoder().decode(new Uint8Array(bt.data));
                                  } catch (e) {
                                    return "NEW";
                                  }
                                }
                                return "NEW";
                              })()}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-2 font-mono text-xs text-muted-foreground">{product.sku || "-"}</td>
                      <td className="p-2">
                        <div className="text-xs">
                          {typeof product.category === 'string' ? (editingCategories[product.category]?.name || product.category) : 'Unknown'}
                          {product.subcategory && typeof product.subcategory === 'string' && (
                            <span className="text-muted-foreground block">{product.subcategory}</span>
                          )}
                          {product.colors && Array.isArray(product.colors) && product.colors.length > 0 && (
                            <span className="text-muted-foreground block text-[10px]">Цвета: {product.colors.filter(c => typeof c === 'string').join(', ')}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-sm">{product.price ? `${(product.price / 100).toLocaleString()} ₽` : "-"}</td>
                      <td className="p-2 text-sm">
                        {(product as any).stock !== undefined && (product as any).stock !== null 
                          ? <span className={(product as any).stock <= 0 ? "text-destructive" : "text-muted-foreground"}>{(product as any).stock}</span>
                          : "-"}
                      </td>
                      <td className="p-1 flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            if (product.isNew) {
                              toggleBadgeMutation.mutate({ productId: product.id, isNew: false, badgeText: "" });
                            } else {
                              setBadgeDialogProductId(product.id);
                              const currentBadge = (product as any).badgeText;
                              let initialText = "NEW";
                              if (typeof currentBadge === 'string') {
                                initialText = currentBadge;
                              } else if (currentBadge && typeof currentBadge === 'object' && 'data' in currentBadge) {
                                initialText = new TextDecoder().decode(new Uint8Array(currentBadge.data));
                              }
                              setBadgeDialogText(initialText);
                              setBadgeDialogOpen(true);
                            }
                          }}
                          disabled={toggleBadgeMutation.isPending}
                          data-testid={`button-badge-${product.id}`}
                          title={product.isNew ? "Убрать бейдж" : "Добавить бейдж"}
                        >
                          <Tag className={`w-3 h-3 ${product.isNew ? "text-primary" : "text-muted-foreground"}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => hideProductMutation.mutate({ productId: product.id, hidden: !(product as any).isHidden })}
                          disabled={hideProductMutation.isPending}
                          data-testid={`button-hide-${product.id}`}
                          title={(product as any).isHidden ? "Показать" : "Скрыть"}
                        >
                          {(product as any).isHidden ? (
                            <Eye className="w-3 h-3 text-muted-foreground hover:text-primary" />
                          ) : (
                            <EyeOff className="w-3 h-3 text-muted-foreground hover:text-amber-500" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => confirm(`Удалить "${product.name}"?`) && deleteProductMutation.mutate(product.id)}
                          disabled={deleteProductMutation.isPending}
                          data-testid={`button-delete-${product.id}`}
                        >
                          <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Artist-only products section */}
            {(artistProductsData?.products?.length ?? 0) > 0 && (
              <div className="mt-6 border rounded-lg overflow-hidden">
                <div className="bg-muted/40 px-4 py-2.5 flex items-center gap-2 border-b">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Товары артистов</span>
                  <Badge variant="secondary" className="text-[10px]">{artistProductsData!.products.length}</Badge>
                  <span className="text-[11px] text-muted-foreground ml-1">— созданы партнёрами, не в общем каталоге</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/20">
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Товар</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Артист</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Цена</th>
                      <th className="text-center px-4 py-2 text-xs font-medium text-muted-foreground">Статус</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(artistProductsData?.products ?? []).map((p: any) => (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {p.imageUrl && <img src={p.thumbnailUrl || p.imageUrl} className="w-8 h-8 rounded object-cover" />}
                            <span className="text-xs font-medium line-clamp-1 max-w-[200px]" title={p.name}>{p.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">@{p.artistSlug}</td>
                        <td className="px-4 py-2 text-xs text-right">{p.price ? `${(p.price / 100).toLocaleString("ru-RU")} ₽` : "—"}</td>
                        <td className="px-4 py-2 text-center">
                          {p.isHidden
                            ? <Badge variant="outline" className="text-[10px] text-muted-foreground">Скрыт</Badge>
                            : <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-600">Активен</Badge>}
                        </td>
                        <td className="px-2 py-2">
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            title="Удалить полностью"
                            onClick={() => confirm(`Удалить "${p.name}" из базы?`) && deleteProductMutation.mutate(p.id, { onSuccess: () => refetchArtistProducts() })}
                            disabled={deleteProductMutation.isPending}
                            data-testid={`btn-delete-artist-product-${p.id}`}
                          >
                            <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Mobile cards - grid like website */}
            <div className="md:hidden">
              <div className="flex gap-2 mb-3">
                <Button
                  variant={selectedProducts.size > 0 ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={selectAll}
                  data-testid="button-select-all-mobile"
                >
                  <CheckSquare className="w-4 h-4 mr-2" />
                  {selectedProducts.size > 0
                    ? selectedProducts.size === filteredProducts.length
                      ? `Снять выделение (${selectedProducts.size})`
                      : `Выбрано: ${selectedProducts.size} — выбрать все`
                    : `☑ Выбрать товары (${filteredProducts.length})`}
                </Button>
                {selectedProducts.size > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedProducts(new Set())}
                  >
                    ✕
                  </Button>
                )}
              </div>
              <div className="space-y-2">
              {filteredProducts.map((product) => (
                <div 
                  key={product.id} 
                  className={`flex bg-card rounded-lg overflow-hidden border ${selectedProducts.has(product.id) ? 'ring-2 ring-primary' : ''}`}
                  onClick={() => toggleSelect(product.id)}
                >
                  {/* Checkbox */}
                  <div className="flex items-center justify-center w-10 shrink-0 bg-muted/30">
                    <input
                      type="checkbox"
                      checked={selectedProducts.has(product.id)}
                      onChange={() => {}}
                      onClick={(e) => e.stopPropagation()}
                      className="w-5 h-5 cursor-pointer"
                      data-testid={`checkbox-product-mobile-${product.id}`}
                    />
                  </div>
                  {/* Image */}
                  <div className="w-24 h-24 shrink-0">
                    <img
                      src={product.thumbnailUrl || product.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/attached_assets/generated_images/oversized_black_t-shirt_streetwear.png";
                      }}
                    />
                  </div>
                  {/* Info */}
                  <div className="flex-1 p-3 min-w-0">
                    <div className="font-medium text-sm line-clamp-2 leading-tight">
                      {typeof product.name === 'string' ? product.name : JSON.stringify(product.name)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {typeof product.sku === 'string' ? product.sku : JSON.stringify(product.sku)}
                    </div>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>{typeof product.category === 'string' ? (editingCategories[product.category]?.name || product.category) : 'Unknown'}</span>
                      {(product as any).stock !== undefined && (product as any).stock !== null && (
                        <span className={(product as any).stock <= 0 ? "text-destructive" : ""}>• {(product as any).stock} шт</span>
                      )}
                      {product.colors && Array.isArray(product.colors) && product.colors.length > 0 && (
                        <span>• {product.colors.filter(c => typeof c === 'string').join(', ')}</span>
                      )}
                    </div>
                  </div>
                  {/* Action buttons */}
                  <div className="flex flex-col justify-center gap-1 p-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (product.isNew) {
                          toggleBadgeMutation.mutate({ productId: product.id, isNew: false, badgeText: "" });
                        } else {
                          setBadgeDialogProductId(product.id);
                          const currentBadge = (product as any).badgeText;
                          let initialText = "NEW";
                          if (typeof currentBadge === 'string') {
                            initialText = currentBadge;
                          } else if (currentBadge && typeof currentBadge === 'object' && 'data' in currentBadge) {
                            initialText = new TextDecoder().decode(new Uint8Array(currentBadge.data));
                          }
                          setBadgeDialogText(initialText);
                          setBadgeDialogOpen(true);
                        }
                      }}
                      data-testid={`button-badge-mobile-${product.id}`}
                    >
                      <Tag className={`w-4 h-4 ${product.isNew ? "text-primary" : ""}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => { e.stopPropagation(); hideProductMutation.mutate({ productId: product.id, hidden: !(product as any).isHidden }); }}
                      data-testid={`button-hide-mobile-${product.id}`}
                    >
                      {(product as any).isHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => { e.stopPropagation(); confirm(`Удалить "${product.name}"?`) && deleteProductMutation.mutate(product.id); }}
                      data-testid={`button-delete-mobile-${product.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
              </div>
            </div>
            </>
              )}
            </div>
          </div>
          </>
        )}
        {/* Floating bottom bar — mobile only, appears when products selected */}
        {selectedProducts.size > 0 && (
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t shadow-lg p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Выбрано: {selectedProducts.size} товаров</span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedProducts(new Set())}>✕ Отмена</Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="flex-1" disabled={bulkMeasurementsMutation.isPending} data-testid="button-bulk-measurements-mobile">
                    <Ruler className="w-4 h-4 mr-2" />
                    {bulkMeasurementsMutation.isPending ? "Применяю..." : "Размерная таблица ▾"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="bg-zinc-900 border-zinc-700 text-zinc-100 mb-1">
                  {Object.entries(MEASUREMENT_TEMPLATES).map(([key, tmpl]) => (
                    <DropdownMenuItem
                      key={key}
                      className="text-zinc-100 focus:bg-zinc-800 focus:text-white cursor-pointer"
                      onClick={() => {
                        if (confirm(`Применить шаблон «${tmpl.label}» к ${selectedProducts.size} товарам?\n\nЭто перезапишет уже заполненные таблицы.`)) {
                          bulkMeasurementsMutation.mutate({ ids: Array.from(selectedProducts), measurements: tmpl.sizes });
                        }
                      }}
                    >
                      {tmpl.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator className="bg-zinc-700" />
                  <DropdownMenuItem
                    className="text-zinc-100 focus:bg-zinc-800 focus:text-white cursor-pointer"
                    onClick={() => { setBulkMeasurementsCopySearch(""); setBulkMeasurementsCopyOpen(true); }}
                  >
                    <Copy className="w-3 h-3 mr-2" />
                    Скопировать с товара...
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-zinc-700" />
                  <DropdownMenuItem
                    className="text-red-400 focus:bg-zinc-800 focus:text-red-300 cursor-pointer"
                    onClick={() => {
                      if (confirm(`Очистить размерную таблицу у ${selectedProducts.size} товаров?`)) {
                        bulkMeasurementsMutation.mutate({ ids: Array.from(selectedProducts), measurements: [] });
                      }
                    }}
                  >
                    Очистить таблицу
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => { if (confirm(`Удалить ${selectedProducts.size} товаров?`)) deleteSelectedMutation.mutate(Array.from(selectedProducts)); }}
                disabled={deleteSelectedMutation.isPending}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Dialog: копировать замеры с товара для bulk-применения */}
        <Dialog open={bulkMeasurementsCopyOpen} onOpenChange={setBulkMeasurementsCopyOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Ruler className="w-5 h-5" />
                Скопировать замеры с товара
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Выберите товар, замеры которого будут применены к {selectedProducts.size} выбранным товарам.
            </p>
            <Input
              placeholder="Поиск по названию..."
              value={bulkMeasurementsCopySearch}
              onChange={(e) => setBulkMeasurementsCopySearch(e.target.value)}
              autoFocus
              data-testid="input-bulk-copy-search"
            />
            <div className="max-h-72 overflow-y-auto space-y-1 mt-1">
              {(products as any[])
                .filter((p: any) => {
                  const hasFlat = p.measurements && (p.measurements as any[]).length > 0;
                  const hasSections = p.measurementSections && (p.measurementSections as any[]).length > 0 &&
                    (p.measurementSections as any[]).some((s: any) => s.rows && s.rows.length > 0);
                  return (hasFlat || hasSections) &&
                    (bulkMeasurementsCopySearch === "" ||
                      p.name.toLowerCase().includes(bulkMeasurementsCopySearch.toLowerCase()) ||
                      (p.sku && p.sku.toLowerCase().includes(bulkMeasurementsCopySearch.toLowerCase())));
                })
                .slice(0, 50)
                .map((p: any) => {
                  const hasFlat = p.measurements && (p.measurements as any[]).length > 0;
                  const ms: any[] = hasFlat ? p.measurements : (p.measurementSections as any[]).flatMap((s: any) => s.rows || []);
                  const cols = [
                    ms.some((r: any) => r.chest) ? "грудь" : null,
                    ms.some((r: any) => r.shoulders) ? "плечи" : null,
                    ms.some((r: any) => r.length) ? "длина" : null,
                    ms.some((r: any) => r.sleeves) ? "рукав" : null,
                    ms.some((r: any) => r.waist) ? "талия" : null,
                    ms.some((r: any) => r.hips) ? "бёдра" : null,
                    ms.some((r: any) => r.sideLength) ? "бок. шов" : null,
                    ms.some((r: any) => r.bottomWidth) ? "шир. низа" : null,
                  ].filter(Boolean).join(", ");
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left p-2 rounded-md text-sm hover:bg-muted flex items-center gap-3"
                      data-testid={`button-bulk-copy-from-${p.id}`}
                      onClick={() => {
                        const count = selectedProducts.size;
                        if (confirm(`Применить замеры из «${p.name}» к ${count} товарам?\n\nЭто перезапишет уже заполненные таблицы.`)) {
                          bulkMeasurementsMutation.mutate({
                            ids: Array.from(selectedProducts),
                            measurements: ms.map((m: any) => ({ ...m })),
                          });
                          setBulkMeasurementsCopyOpen(false);
                        }
                      }}
                    >
                      {p.thumbnailUrl || p.imageUrl ? (
                        <img src={p.thumbnailUrl || p.imageUrl} alt="" className="w-10 h-10 object-cover rounded shrink-0" />
                      ) : (
                        <div className="w-10 h-10 bg-muted rounded shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{ms.length} размеров · {cols}</div>
                      </div>
                    </button>
                  );
                })}
              {(products as any[]).filter((p: any) =>
                p.measurements && (p.measurements as any[]).length > 0 &&
                (bulkMeasurementsCopySearch === "" ||
                  p.name.toLowerCase().includes(bulkMeasurementsCopySearch.toLowerCase()) ||
                  (p.sku && p.sku.toLowerCase().includes(bulkMeasurementsCopySearch.toLowerCase())))
              ).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {bulkMeasurementsCopySearch ? "Ничего не найдено" : "Нет товаров с заполненными замерами"}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBulkMeasurementsCopyOpen(false)}>Отмена</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={badgeDialogOpen} onOpenChange={setBadgeDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Tag className="w-5 h-5" />
                {badgeDialogProductId === -1 ? `Бейдж для ${selectedProducts.size} товаров` : "Настройка бейджа"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Текст бейджа</Label>
                <Input
                  value={badgeDialogText}
                  onChange={(e) => setBadgeDialogText(e.target.value)}
                  placeholder="NEW, ХИТ, SALE..."
                  maxLength={15}
                  data-testid="input-badge-text"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {["NEW", "ХИТ", "SALE", "ТОП", "НОВИНКА"].map((preset) => (
                  <Button
                    key={preset}
                    variant={badgeDialogText === preset ? "default" : "outline"}
                    size="sm"
                    onClick={() => setBadgeDialogText(preset)}
                    data-testid={`button-preset-${preset}`}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                Предпросмотр:
                <span className="bg-primary text-white px-2 py-1 text-[10px] font-medium rounded-sm uppercase">
                  {badgeDialogText || "NEW"}
                </span>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setBadgeDialogOpen(false)} data-testid="button-badge-cancel">
                Отмена
              </Button>
              <Button
                onClick={() => {
                  if (badgeDialogProductId === -1) {
                    bulkToggleBadgeMutation.mutate({ ids: Array.from(selectedProducts), isNew: true, badgeText: badgeDialogText || "NEW" });
                    setBadgeDialogOpen(false);
                  } else if (badgeDialogProductId !== null) {
                    toggleBadgeMutation.mutate({ productId: badgeDialogProductId, isNew: true, badgeText: badgeDialogText || "NEW" });
                    setBadgeDialogOpen(false);
                  }
                }}
                disabled={toggleBadgeMutation.isPending || bulkToggleBadgeMutation.isPending}
                data-testid="button-badge-save"
              >
                <Tag className="w-4 h-4 mr-1" />
                {badgeDialogProductId === -1 ? `Применить ко всем (${selectedProducts.size})` : "Применить"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {activeTab === "reviews" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h2 className="text-xl font-bold text-foreground">Отзывы покупателей</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => adminReviewsQuery.refetch()}
                disabled={adminReviewsQuery.isLoading}
                data-testid="button-refresh-reviews"
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${adminReviewsQuery.isLoading ? 'animate-spin' : ''}`} />
                Обновить
              </Button>
            </div>

            {adminReviewsQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : !adminReviewsQuery.data || adminReviewsQuery.data.length === 0 ? (
              <Card className="p-8 text-center">
                <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Пока нет отзывов</p>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground">Всего отзывов</div>
                      <div className="text-2xl font-bold text-foreground" data-testid="text-total-reviews">{adminReviewsQuery.data.length}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground">Ожидают модерации</div>
                      <div className="text-2xl font-bold text-foreground" data-testid="text-pending-reviews">
                        {adminReviewsQuery.data.filter((r: any) => !r.isApproved && !r.is_approved).length}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground">Одобрено</div>
                      <div className="text-2xl font-bold text-foreground" data-testid="text-approved-reviews">
                        {adminReviewsQuery.data.filter((r: any) => r.isApproved || r.is_approved).length}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-3">
                  {adminReviewsQuery.data.map((review: any) => {
                    const productId = review.productId || review.product_id;
                    const product = products?.find((p: any) => p.id === Number(productId));
                    const isApproved = review.isApproved || review.is_approved;
                    const authorName = review.authorName || review.author_name || 'Аноним';
                    const createdAt = review.createdAt || review.created_at;
                    return (
                      <Card key={review.id} className={`${!isApproved ? 'border-yellow-500/50' : ''}`} data-testid={`card-review-${review.id}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-medium text-foreground text-sm">{authorName}</span>
                                <div className="flex items-center gap-0.5">
                                  {[1, 2, 3, 4, 5].map(s => (
                                    <Star key={s} className={`w-3.5 h-3.5 ${s <= (review.rating || 0) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
                                  ))}
                                </div>
                                <Badge variant={isApproved ? "default" : "secondary"} className="text-[10px]">
                                  {isApproved ? 'Одобрен' : 'На модерации'}
                                </Badge>
                              </div>
                              {product && (
                                <p className="text-xs text-muted-foreground mb-1.5">
                                  Товар: {product.name}
                                </p>
                              )}
                              {(review.comment || review.text) && (
                                <p className="text-sm text-foreground">{review.comment || review.text}</p>
                              )}
                              {createdAt && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {new Date(createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {!isApproved ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => approveReviewMutation.mutate({ id: Number(review.id), isApproved: true })}
                                  disabled={approveReviewMutation.isPending}
                                  data-testid={`button-approve-review-${review.id}`}
                                >
                                  <Check className="w-4 h-4 mr-1" />
                                  Одобрить
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => approveReviewMutation.mutate({ id: Number(review.id), isApproved: false })}
                                  disabled={approveReviewMutation.isPending}
                                  data-testid={`button-reject-review-${review.id}`}
                                >
                                  <EyeOff className="w-4 h-4 mr-1" />
                                  Скрыть
                                </Button>
                              )}
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  if (confirm('Удалить отзыв?')) {
                                    deleteReviewMutation.mutate(Number(review.id));
                                  }
                                }}
                                disabled={deleteReviewMutation.isPending}
                                data-testid={`button-delete-review-${review.id}`}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "favorites" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h2 className="text-xl font-bold text-foreground">Избранное клиентов</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => adminFavoritesQuery.refetch()}
                disabled={adminFavoritesQuery.isLoading}
                data-testid="button-refresh-favorites"
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${adminFavoritesQuery.isLoading ? 'animate-spin' : ''}`} />
                Обновить
              </Button>
            </div>

            {adminFavoritesQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : adminFavoritesQuery.data ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground">Всего добавлений</div>
                      <div className="text-2xl font-bold text-foreground" data-testid="text-total-favorites">{adminFavoritesQuery.data.totalFavorites}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground">Клиентов с избранным</div>
                      <div className="text-2xl font-bold text-foreground" data-testid="text-total-users-favorites">{adminFavoritesQuery.data.totalUsers}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground">Среднее на клиента</div>
                      <div className="text-2xl font-bold text-foreground">
                        {adminFavoritesQuery.data.totalUsers > 0 ? Math.round(adminFavoritesQuery.data.totalFavorites / adminFavoritesQuery.data.totalUsers * 10) / 10 : 0}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground">Уникальных товаров</div>
                      <div className="text-2xl font-bold text-foreground">{adminFavoritesQuery.data.popularProducts.length}</div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        Популярные товары в избранном
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {adminFavoritesQuery.data.popularProducts.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">Нет данных</p>
                      ) : (
                        <div className="space-y-2">
                          {adminFavoritesQuery.data.popularProducts.map((item, idx) => {
                            const product = products?.find((p: any) => p.id === item.productId);
                            return (
                              <div key={item.productId} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0" data-testid={`row-popular-product-${item.productId}`}>
                                <span className="text-xs font-medium text-muted-foreground w-5">{idx + 1}</span>
                                {product?.thumbnailUrl ? (
                                  <img src={product.thumbnailUrl} alt="" className="w-8 h-8 object-cover rounded-md" />
                                ) : (
                                  <div className="w-8 h-8 bg-muted rounded-md flex items-center justify-center">
                                    <Package className="w-4 h-4 text-muted-foreground" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">
                                    {product?.name || `Товар #${item.productId}`}
                                  </p>
                                </div>
                                <Badge variant="secondary" className="text-xs">
                                  <Heart className="w-3 h-3 mr-1 fill-primary text-primary" />
                                  {item.count}
                                </Badge>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        Клиенты и их избранное
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {adminFavoritesQuery.data.users.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">Нет данных</p>
                      ) : (
                        <div className="space-y-2">
                          {adminFavoritesQuery.data.users.map((user) => (
                            <details key={user.userId} className="group border border-border rounded-md" data-testid={`row-user-favorites-${user.userId}`}>
                              <summary className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground">{user.userName}</p>
                                  <p className="text-xs text-muted-foreground truncate">{user.userEmail}</p>
                                </div>
                                <Badge variant="secondary" className="text-xs">
                                  <Heart className="w-3 h-3 mr-1 fill-primary text-primary" />
                                  {user.count}
                                </Badge>
                              </summary>
                              <div className="px-3 pb-3 pt-1 border-t border-border">
                                <div className="space-y-1.5">
                                  {user.productIds.map(productId => {
                                    const product = products?.find((p: any) => p.id === productId);
                                    return (
                                      <div key={productId} className="flex items-center gap-2 text-sm">
                                        {product?.thumbnailUrl ? (
                                          <img src={product.thumbnailUrl} alt="" className="w-6 h-6 object-cover rounded" />
                                        ) : (
                                          <div className="w-6 h-6 bg-muted rounded flex items-center justify-center">
                                            <Package className="w-3 h-3 text-muted-foreground" />
                                          </div>
                                        )}
                                        <span className="text-foreground truncate flex-1">
                                          {product?.name || `Товар #${productId}`}
                                        </span>
                                        {product?.price && (
                                          <span className="text-xs text-muted-foreground">
                                            {new Intl.NumberFormat('ru-RU').format(product.price / 100)} ₽
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </details>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-muted-foreground">Нет данных об избранном</div>
            )}
          </div>
        )}

        {activeTab === "preorders" && (
          <AdminPreordersTab apiKey={apiKey} />
        )}

        {activeTab === "security" && (
          <SecurityTab adminKey={apiKey} />
        )}

        {activeTab === "analytics" && (
          <AnalyticsTab apiKey={apiKey} />
        )}

        {activeTab === "partners" && (
          <div className="p-4">
            <PartnersTab apiKey={apiKey} />
          </div>
        )}

        {activeTab === "ai" && (
          <AiKnowledgeTab apiKey={apiKey} adminFetch={adminFetch} />
        )}

        {activeTab === "seo" && (
          <SeoTab apiKey={apiKey} adminFetch={adminFetch} />
        )}

        {activeTab === "clients" && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Users className="w-5 h-5" />
                Клиенты
              </h2>
              <Button variant="ghost" size="sm" onClick={() => { clientsQuery.refetch(); wholesaleClientsQuery.refetch(); }}>
                <RefreshCw className="w-4 h-4 mr-1" />
                Обновить
              </Button>
            </div>

            {/* Переключатель Розница / Опт */}
            <div className="flex gap-2 border-b pb-2">
              <Button
                variant={clientsTypeTab === "retail" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setClientsTypeTab("retail")}
                data-testid="button-clients-retail-tab"
              >
                <User className="w-4 h-4 mr-1" />
                Розница {clientsQuery.data?.users ? `(${clientsQuery.data.users.length})` : ""}
              </Button>
              <Button
                variant={clientsTypeTab === "wholesale" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setClientsTypeTab("wholesale")}
                data-testid="button-clients-wholesale-tab"
              >
                <Building2 className="w-4 h-4 mr-1" />
                Опт {wholesaleClientsQuery.data?.users ? `(${wholesaleClientsQuery.data.users.length})` : ""}
              </Button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={clientsTypeTab === "retail" ? "Поиск по имени, email или телефону..." : "Поиск по компании, email, ИНН..."}
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                className="pl-9"
                data-testid="input-client-search"
              />
            </div>

            {/* РОЗНИЧНЫЕ клиенты */}
            {clientsTypeTab === "retail" && (
              clientsQuery.isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-1">
                  {(clientsQuery.data?.users || [])
                    .filter(u => {
                      if (!clientSearch.trim()) return true;
                      const q = clientSearch.toLowerCase();
                      return (
                        u.name?.toLowerCase().includes(q) ||
                        u.email?.toLowerCase().includes(q) ||
                        u.phone?.toLowerCase().includes(q)
                      );
                    })
                    .map((u: any) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => setSelectedClientId(u.id)}
                        data-testid={`card-client-${u.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="w-4 h-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">{u.name || "Без имени"}</div>
                            <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-right">
                          <div className="hidden sm:block">
                            <div className="text-sm font-medium">{((u.totalSpent || 0) / 100).toLocaleString("ru-RU")} ₽</div>
                            <div className="text-xs text-muted-foreground">{u.orderCount} заказ.</div>
                          </div>
                          {u.loyaltyDiscount > 0 && (
                            <Badge variant="secondary" className="text-xs">−{u.loyaltyDiscount}%</Badge>
                          )}
                          {u.favoritesCount > 0 && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Heart className="w-3 h-3" />
                              {u.favoritesCount}
                            </div>
                          )}
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  {(clientsQuery.data?.users || []).length === 0 && !clientsQuery.isLoading && (
                    <div className="text-center py-8 text-muted-foreground">Клиентов пока нет</div>
                  )}
                </div>
              )
            )}

            {/* ОПТОВЫЕ клиенты */}
            {clientsTypeTab === "wholesale" && (
              wholesaleClientsQuery.isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-1">
                  {(wholesaleClientsQuery.data?.users || [])
                    .filter(u => {
                      if (!clientSearch.trim()) return true;
                      const q = clientSearch.toLowerCase();
                      return (
                        u.name?.toLowerCase().includes(q) ||
                        u.email?.toLowerCase().includes(q) ||
                        u.companyName?.toLowerCase().includes(q) ||
                        u.inn?.toLowerCase().includes(q) ||
                        u.contactPerson?.toLowerCase().includes(q)
                      );
                    })
                    .map((u: any) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => setSelectedWholesaleClientId(u.id)}
                        data-testid={`card-wholesale-client-${u.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                            <Building2 className="w-4 h-4 text-blue-600" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">{u.companyName || u.name || "Без названия"}</div>
                            <div className="text-xs text-muted-foreground truncate">{u.email} {u.inn ? `• ИНН ${u.inn}` : ""}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-right">
                          <div className="hidden sm:block">
                            <div className="text-sm font-medium">{((u.totalSpent || 0) / 100).toLocaleString("ru-RU")} ₽</div>
                            <div className="text-xs text-muted-foreground">{u.orderCount} заявок</div>
                          </div>
                          {u.wholesaleApproved ? (
                            <Badge className="text-xs bg-green-500/10 text-green-700 border-green-200">Одобрен</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-orange-600 border-orange-200">Ожидает</Badge>
                          )}
                          {u.wholesaleDiscount > 0 && (
                            <Badge variant="secondary" className="text-xs">−{u.wholesaleDiscount}%</Badge>
                          )}
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  {(wholesaleClientsQuery.data?.users || []).length === 0 && !wholesaleClientsQuery.isLoading && (
                    <div className="text-center py-8 text-muted-foreground">Оптовых клиентов пока нет</div>
                  )}
                </div>
              )
            )}

            {/* Карточка клиента — диалог */}
            <Dialog open={!!selectedClientId} onOpenChange={open => { if (!open) setSelectedClientId(null); }}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                {clientDetailQuery.isLoading && (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                )}
                {clientDetailQuery.data && (() => {
                  const cd = clientDetailQuery.data;
                  const u = cd.user;
                  const fmt = (cents: number) => ((cents || 0) / 100).toLocaleString("ru-RU") + " ₽";
                  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
                  return (
                    <>
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <div>{u.name || "Без имени"}</div>
                            <div className="text-sm font-normal text-muted-foreground">{u.email}</div>
                          </div>
                        </DialogTitle>
                      </DialogHeader>

                      <div className="space-y-4">
                        {/* Основные данные */}
                        <Card>
                          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Основные данные</CardTitle></CardHeader>
                          <CardContent className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <div className="text-xs text-muted-foreground">Телефон</div>
                              <div>{u.phone || "—"}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Зарегистрирован</div>
                              <div>{fmtDate(u.createdAt)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Потрачено</div>
                              <div className="font-semibold text-green-600">{fmt(u.totalSpent)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Скидка лояльности</div>
                              <div>{u.loyaltyDiscount > 0 ? `${u.loyaltyDiscount}%` : "нет"}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Email подтверждён</div>
                              <div>{u.emailVerified ? <span className="text-green-600">Да</span> : <span className="text-amber-500">Нет</span>}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Рассылка</div>
                              <div>{cd.newsletterSubscribed ? <span className="text-green-600">Подписан</span> : "Не подписан"}</div>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Заказы */}
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                              <ShoppingCart className="w-4 h-4" />
                              Заказы ({cd.orders?.length || 0})
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {cd.orders?.length === 0 ? (
                              <div className="text-sm text-muted-foreground text-center py-2">Заказов нет</div>
                            ) : (
                              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                {cd.orders?.map((o: any) => (
                                  <div key={o.id} className="text-sm border rounded px-3 py-2 space-y-1" data-testid={`text-client-order-${o.id}`}>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-mono text-xs">#{o.id}</span>
                                        <Badge variant={o.status === "paid" || o.status === "delivered" ? "default" : o.status === "cancelled" ? "destructive" : "secondary"} className="text-xs h-5">
                                          {o.status === "pending" ? "Ожидает" : o.status === "paid" ? "Оплачен" : o.status === "processing" ? "В обработке" : o.status === "shipped" ? "Отправлен" : o.status === "delivered" ? "Доставлен" : o.status === "cancelled" ? "Отменён" : o.status}
                                        </Badge>
                                        {o.isPreorder && (
                                          <Badge variant="outline" className="text-xs h-5 border-orange-400 text-orange-500">Предзаказ</Badge>
                                        )}
                                        {o.promoCode && <span className="text-xs text-muted-foreground">🏷 {o.promoCode}</span>}
                                      </div>
                                      <div className="text-right shrink-0">
                                        <div className="font-medium">{fmt(o.total)}</div>
                                        <div className="text-xs text-muted-foreground">{fmtDate(o.createdAt)}</div>
                                      </div>
                                    </div>
                                    {o.isPreorder && (
                                      <div className="flex gap-4 text-xs pt-0.5 border-t border-dashed border-orange-200 mt-1">
                                        <span className={`flex items-center gap-1 ${o.depositPaid ? "text-green-600" : "text-orange-500"}`}>
                                          {o.depositPaid ? "✓" : "○"} Залог: {fmt(Math.round(o.total * 0.3))}
                                        </span>
                                        {o.remainingAmount > 0 && (
                                          <span className="text-muted-foreground">Остаток: {fmt(o.remainingAmount)}</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        {/* Корзина */}
                        {cd.cart?.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                                <ShoppingCart className="w-4 h-4" />
                                Сейчас в корзине ({cd.cart.length})
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-1.5">
                                {cd.cart.map((ci: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between text-sm border rounded px-3 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      {ci.thumbnailUrl && (
                                        <img src={ci.thumbnailUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                                      )}
                                      <div className="min-w-0">
                                        <div className="truncate font-medium">{ci.name}</div>
                                        <div className="text-xs text-muted-foreground">{ci.size && `${ci.size}`}{ci.color && ` · ${ci.color}`}</div>
                                      </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                      <div>{ci.quantity} шт.</div>
                                      <div className="text-xs text-muted-foreground">{fmt(ci.price * ci.quantity)}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Избранное */}
                        {cd.favorites?.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                                <Heart className="w-4 h-4" />
                                Избранное ({cd.favorites.length})
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {cd.favorites.map((p: any) => (
                                  <div key={p.id} className="border rounded-lg p-2 text-xs">
                                    {p.thumbnailUrl && (
                                      <img src={p.thumbnailUrl} alt="" className="w-full h-20 object-cover rounded mb-1" />
                                    )}
                                    <div className="font-medium truncate">{p.name}</div>
                                    <div className="text-muted-foreground">{fmt(p.price)}</div>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Промокоды */}
                        {cd.usedPromoCodes?.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                                <Tag className="w-4 h-4" />
                                Использованные промокоды
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-1">
                                {cd.usedPromoCodes.map((pc: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between text-sm border rounded px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="font-mono text-xs">{pc.code}</Badge>
                                      <span className="text-xs text-muted-foreground">заказ #{pc.orderId}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">{fmtDate(pc.orderDate)}</div>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Подписки на снижение цены */}
                        {cd.priceDropSubs?.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                                <TrendingDown className="w-4 h-4" />
                                Ждёт снижения цены ({cd.priceDropSubs.length} тов.)
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-1">
                                {cd.priceDropSubs.map((s: any) => (
                                  <div key={s.id} className="flex items-center justify-between text-sm border rounded px-3 py-2">
                                    <span className="truncate">{s.productName}</span>
                                    <span className="text-xs text-muted-foreground shrink-0 ml-2">было {fmt(s.priceAtSubscription)}</span>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    </>
                  );
                })()}
              </DialogContent>
            </Dialog>

            {/* Карточка оптового клиента — диалог */}
            <Dialog open={!!selectedWholesaleClientId} onOpenChange={open => { if (!open) { setSelectedWholesaleClientId(null); setInlinePasswordUserId(null); setInlinePasswordValue(""); } }}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                {wholesaleClientDetailQuery.isLoading && (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                )}
                {wholesaleClientDetailQuery.data && (() => {
                  const cd = wholesaleClientDetailQuery.data;
                  const u = cd.user;
                  const orders = cd.orders || [];
                  const fmt = (cents: number) => ((cents || 0) / 100).toLocaleString("ru-RU") + " ₽";
                  const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
                  const totalSpent = orders.reduce((s: number, o: any) => s + (o.total || 0), 0);
                  return (
                    <>
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center">
                            <Building2 className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <div>{u.companyName || u.name || "Без названия"}</div>
                            <div className="text-sm font-normal text-muted-foreground">{u.email}</div>
                          </div>
                        </DialogTitle>
                      </DialogHeader>

                      <div className="space-y-4">
                        {/* Реквизиты */}
                        <Card>
                          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Реквизиты компании</CardTitle></CardHeader>
                          <CardContent className="grid grid-cols-2 gap-3 text-sm">
                            <div><div className="text-xs text-muted-foreground">Компания</div><div>{u.companyName || "—"}</div></div>
                            <div><div className="text-xs text-muted-foreground">ИНН</div><div>{u.inn || "—"}</div></div>
                            <div><div className="text-xs text-muted-foreground">КПП</div><div>{u.kpp || "—"}</div></div>
                            <div><div className="text-xs text-muted-foreground">Юр. адрес</div><div className="break-words">{u.legalAddress || "—"}</div></div>
                            <div><div className="text-xs text-muted-foreground">Магазин</div><div>{u.storeName || "—"}</div></div>
                            <div><div className="text-xs text-muted-foreground">Адрес магазина</div><div className="break-words">{u.storeAddress || "—"}</div></div>
                            <div><div className="text-xs text-muted-foreground">Контактное лицо</div><div>{u.contactPerson || "—"}</div></div>
                            <div><div className="text-xs text-muted-foreground">Телефон</div><div>{u.contactPhone || "—"}</div></div>
                          </CardContent>
                        </Card>

                        {/* Статус и скидка */}
                        <Card>
                          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Статус аккаунта</CardTitle></CardHeader>
                          <CardContent className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <div className="text-xs text-muted-foreground">Статус</div>
                              <div>{u.wholesaleApproved
                                ? <span className="text-green-600 font-medium">Одобрен</span>
                                : <span className="text-orange-600 font-medium">Ожидает одобрения</span>}
                              </div>
                            </div>
                            <div><div className="text-xs text-muted-foreground">Скидка</div><div>{u.wholesaleDiscount ? `${u.wholesaleDiscount}%` : "—"}</div></div>
                            <div><div className="text-xs text-muted-foreground">Зарегистрирован</div><div>{fmtDate(u.createdAt)}</div></div>
                            <div><div className="text-xs text-muted-foreground">Всего заявок</div><div className="font-semibold">{orders.length}</div></div>
                            <div><div className="text-xs text-muted-foreground">Сумма заявок</div><div className="font-semibold text-green-600">{fmt(totalSpent)}</div></div>
                          </CardContent>
                        </Card>

                        {/* Смена пароля */}
                        {inlinePasswordUserId === u.id ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <PasswordInput
                              placeholder="Новый пароль (мин. 6 символов)"
                              value={inlinePasswordValue}
                              onChange={(e) => setInlinePasswordValue(e.target.value)}
                              className="h-8 max-w-xs"
                              autoFocus
                              data-testid={`input-inline-password-${u.id}`}
                            />
                            <Button
                              size="sm"
                              disabled={setPasswordMutation.isPending || inlinePasswordValue.length < 6}
                              onClick={() => setPasswordMutation.mutate({ userId: u.id, password: inlinePasswordValue }, { onSuccess: () => { setInlinePasswordUserId(null); setInlinePasswordValue(""); } })}
                              data-testid={`button-inline-password-save-${u.id}`}
                            >
                              {setPasswordMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Сохранить"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setInlinePasswordUserId(null); setInlinePasswordValue(""); }}>
                              Отмена
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { setInlinePasswordValue(""); setInlinePasswordUserId(u.id); }}
                              data-testid={`button-set-password-detail-${u.id}`}
                            >
                              <Lock className="w-4 h-4 mr-1" />
                              Сменить пароль
                            </Button>
                          </div>
                        )}

                        {/* История заявок */}
                        {orders.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">История оптовых заявок</CardTitle></CardHeader>
                            <CardContent className="space-y-2">
                              {orders.slice(0, 20).map((o: any) => {
                                const items = typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items); } catch { return []; } })() : (o.items || []);
                                return (
                                  <div key={o.id} className="flex items-center justify-between text-sm border rounded-lg px-3 py-2.5">
                                    <div>
                                      <div className="font-medium">Заявка #{o.invoiceNumber || o.id}</div>
                                      <div className="text-xs text-muted-foreground">{fmtDate(o.createdAt)} • {items.length} поз.</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="font-semibold">{fmt(o.total)}</div>
                                      <div className="text-xs text-muted-foreground">{o.status}</div>
                                    </div>
                                  </div>
                                );
                              })}
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    </>
                  );
                })()}
              </DialogContent>
            </Dialog>
          </div>
        )}

        {activeTab === "orders" && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" />
                Управление заказами
              </h2>
              <Button variant="ghost" size="sm" onClick={() => refetchOrders()}>
                <RefreshCw className="w-4 h-4 mr-1" />
                Обновить
              </Button>
            </div>
            
            {/* Sub-tabs for retail vs wholesale vs drafts */}
            <div className="flex gap-2 border-b pb-2 flex-wrap">
              <Button
                variant={ordersSubTab === "retail" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setOrdersSubTab("retail")}
              >
                <ShoppingCart className="w-4 h-4 mr-1" />
                Розничные ({retailOrders.length})
              </Button>
              <Button
                variant={ordersSubTab === "wholesale" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setOrdersSubTab("wholesale")}
              >
                <Building2 className="w-4 h-4 mr-1" />
                Оптовые ({wholesaleOrders.length})
              </Button>
              <Button
                variant={ordersSubTab === "drafts" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setOrdersSubTab("drafts")}
                className={ordersSubTab !== "drafts" ? "text-yellow-600 hover:text-yellow-700" : ""}
              >
                <Clock className="w-4 h-4 mr-1" />
                Неоплаченные {draftOrdersData ? `(${draftOrdersData.length})` : ""}
              </Button>
            </div>

            {ordersSubTab === "drafts" ? (
              draftOrdersLoading ? (
                <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
              ) : !draftOrdersData || draftOrdersData.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>Неоплаченных заказов нет</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  <div className="text-xs text-muted-foreground bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                    Заказы со статусом <strong>awaiting_payment</strong> и <strong>expired</strong>. Хранятся 30 дней, затем помечаются как expired. Удаляй вручную при необходимости.
                  </div>
                  {draftOrdersData.map((order: any) => (
                    <Card key={order.id} className="border-yellow-200">
                      <CardContent className="pt-4">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold">#{order.id}</span>
                              <Badge variant={order.status === "expired" ? "destructive" : "outline"} className={order.status === "awaiting_payment" ? "border-yellow-400 text-yellow-700" : ""}>
                                <Clock className="w-3 h-3 mr-1" />
                                {order.status === "awaiting_payment" ? "Ожидает оплаты" : "Истёк срок"}
                              </Badge>
                              <span className="text-sm font-semibold">{((order.total || 0) / 100).toLocaleString()} ₽</span>
                            </div>
                            <div className="text-sm text-muted-foreground space-y-0.5">
                              <p><strong>Клиент:</strong> {order.customerName || "—"}</p>
                              <p><strong>Email:</strong> {order.customerEmail || "—"}</p>
                              <p><strong>Телефон:</strong> {order.customerPhone || "—"}</p>
                              {order.paymentId && <p><strong>ID платежа:</strong> <span className="font-mono text-xs">{order.paymentId}</span></p>}
                              {order.createdAt && <p><strong>Создан:</strong> {new Date(order.createdAt).toLocaleString("ru-RU")}</p>}
                              {Array.isArray(order.items) && order.items.length > 0 && (
                                <p><strong>Товары:</strong> {order.items.map((it: any) => `${it.name || it.productName || it.id} × ${it.quantity}`).join(", ")}</p>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                            onClick={() => { if (confirm(`Удалить черновик #${order.id}?`)) deleteDraftOrderMutation.mutate(order.id); }}
                            disabled={deleteDraftOrderMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )
            ) : ordersLoading ? (
              <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
            ) : (
              <div className="grid gap-4">
                {(ordersSubTab === "retail" ? retailOrders : wholesaleOrders).map((order: any) => (
                  <Card key={order.id}>
                    <CardContent className="pt-4">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold">#{order.id}</span>
                            <Badge variant={
                              order.status === "paid" ? "default" : 
                              order.status === "shipped" ? "secondary" : 
                              order.status === "cancelled" ? "destructive" : 
                              "outline"
                            }>
                              {order.status === "pending" && <Clock className="w-3 h-3 mr-1" />}
                              {order.status === "paid" && <CreditCard className="w-3 h-3 mr-1" />}
                              {order.status === "shipped" && <Truck className="w-3 h-3 mr-1" />}
                              {order.status === "cancelled" && <Ban className="w-3 h-3 mr-1" />}
                              {order.status === "pending" ? "Ожидает оплаты" : 
                               order.status === "paid" ? "Оплачен" : 
                               order.status === "shipped" ? "Отправлен" : 
                               order.status === "cancelled" ? "Отменен" : 
                               order.status}
                            </Badge>
                            <span className="text-sm font-semibold">{(order.total / 100).toLocaleString()} ₽</span>
                            {order.partnerId && (() => {
                              const p = partnersById.get(Number(order.partnerId));
                              const label = p ? (p.storeName || p.partnerSlug) : `#${order.partnerId}`;
                              return (
                                <Badge
                                  variant="outline"
                                  className="border-purple-300 text-purple-700 dark:text-purple-300"
                                  data-testid={`badge-partner-order-${order.id}`}
                                >
                                  Партнёр: {label}
                                </Badge>
                              );
                            })()}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            <p><strong>Клиент:</strong> {order.customerName}</p>
                            <p><strong>Email:</strong> {order.customerEmail}</p>
                            <p><strong>Телефон:</strong> {order.customerPhone}</p>
                            <p><strong>Адрес:</strong> {order.address}</p>
                            {(() => {
                              if (!order.cdekData) return null;
                              let d: any = {};
                              try { d = typeof order.cdekData === 'string' ? JSON.parse(order.cdekData) : order.cdekData; } catch { return null; }
                              const svc = d.deliveryService === 'yandex' ? '🟡 Яндекс Доставка' : d.deliveryService === 'cdek' ? '🟢 СДЭК' : null;
                              const type = d.deliveryType === 'door' ? 'Курьер до двери' : d.deliveryType === 'pickup' ? 'ПВЗ' : null;
                              const point = d.ydPointName || d.pointCode || null;
                              const door = d.doorAddress ? [d.doorAddress.street, d.doorAddress.house, d.doorAddress.flat && `кв. ${d.doorAddress.flat}`, d.doorAddress.entrance && `подъезд ${d.doorAddress.entrance}`, d.doorAddress.floor && `эт. ${d.doorAddress.floor}`].filter(Boolean).join(', ') : null;
                              const tracking = d.cdekTrackingNumber || d.trackingNumber || null;
                              if (!svc && !type && !point && !door) return null;
                              return (
                                <div className="mt-1 p-2 bg-muted/40 rounded text-xs space-y-0.5">
                                  {svc && <p><strong>Доставка:</strong> {svc}{type ? ` — ${type}` : ''}</p>}
                                  {point && <p><strong>ПВЗ:</strong> {point}</p>}
                                  {door && <p><strong>Адрес курьера:</strong> {door}</p>}
                                  {tracking && <p><strong>Трек-номер:</strong> {tracking}</p>}
                                </div>
                              );
                            })()}
                            {order.isWholesale && order.transportCompany && (
                              <p className="flex items-center gap-2 mt-1">
                                <strong>ТК:</strong>
                                <span 
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-white text-xs font-bold"
                                  style={{ 
                                    backgroundColor: 
                                      order.transportCompany === 'cdek' ? '#00A94B' :
                                      order.transportCompany === 'dellin' ? '#ED1C24' :
                                      order.transportCompany === 'pek' ? '#00599D' :
                                      order.transportCompany === 'pochta' ? '#004D9E' : '#666'
                                  }}
                                >
                                  {order.transportCompany === 'cdek' && 'СДЭК'}
                                  {order.transportCompany === 'dellin' && 'Деловые Линии'}
                                  {order.transportCompany === 'pek' && 'ПЭК'}
                                  {order.transportCompany === 'pochta' && 'Почта России'}
                                </span>
                              </p>
                            )}
                          </div>
                          {order.items && (
                            <div className="text-xs text-muted-foreground mt-2">
                              <strong>Товары:</strong>
                              <ul className="list-disc list-inside">
                                {(() => {
                                  const visibleItems = order.items.filter((i: any) => !i._discountDetails);
                                  const isExpanded = expandedOrderItems.has(order.id);
                                  const displayItems = isExpanded ? visibleItems : visibleItems.slice(0, 3);
                                  const hiddenCount = visibleItems.length - 3;
                                  return (
                                    <>
                                      {displayItems.map((item: any, idx: number) => (
                                        <li key={idx}>
                                          {item.name || item.productName}
                                          {(item.size || item.color) && (
                                            <span className="text-muted-foreground"> ({[item.size, item.color].filter(Boolean).join(', ')})</span>
                                          )}
                                          {' '}x{item.quantity}
                                        </li>
                                      ))}
                                      {!isExpanded && hiddenCount > 0 && (
                                        <li
                                          className="cursor-pointer text-primary hover:underline select-none"
                                          onClick={() => setExpandedOrderItems(prev => new Set([...prev, order.id]))}
                                        >
                                          … и ещё {hiddenCount}
                                        </li>
                                      )}
                                      {isExpanded && visibleItems.length > 3 && (
                                        <li
                                          className="cursor-pointer text-primary hover:underline select-none"
                                          onClick={() => setExpandedOrderItems(prev => { const s = new Set(prev); s.delete(order.id); return s; })}
                                        >
                                          Свернуть
                                        </li>
                                      )}
                                    </>
                                  );
                                })()}
                              </ul>
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Создан: {order.createdAt ? new Date(order.createdAt).toLocaleString('ru-RU') : 'N/A'}
                          </p>
                        </div>
                        
                        <div className="flex flex-col gap-2 sm:items-end">
                          <Select
                            value={order.status}
                            onValueChange={(value) => updateOrderStatusMutation.mutate({ id: order.id, status: value })}
                          >
                            <SelectTrigger className="w-[160px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Ожидает оплаты</SelectItem>
                              <SelectItem value="paid">Оплачен</SelectItem>
                              <SelectItem value="shipped">Отправлен</SelectItem>
                              <SelectItem value="delivered">Доставлен</SelectItem>
                              <SelectItem value="cancelled">Отменен</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadOrderExcel(order)}
                            data-testid={`button-download-order-${order.id}`}
                          >
                            <Download className="w-4 h-4 mr-1" />
                            Excel
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => confirm(`Удалить заказ #${order.id}?`) && deleteOrderMutation.mutate(order.id)}
                            disabled={deleteOrderMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Удалить
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {(ordersSubTab === "retail" ? retailOrders : wholesaleOrders).length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    {ordersSubTab === "retail" ? "Розничных заказов нет" : "Оптовых заказов нет"}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Диалог смены пароля оптовика */}
      <Dialog open={setPasswordDialog.open} onOpenChange={(open) => { if (!open) { setSetPasswordDialog({ open: false, userId: null, userName: "" }); setSetPasswordValue(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Сменить пароль</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{setPasswordDialog.userName}</p>
          <div className="space-y-3">
            <PasswordInput
              placeholder="Новый пароль (минимум 6 символов)"
              value={setPasswordValue}
              onChange={(e) => setSetPasswordValue(e.target.value)}
              data-testid="input-admin-set-password"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setSetPasswordDialog({ open: false, userId: null, userName: "" }); setSetPasswordValue(""); }}
            >
              Отмена
            </Button>
            <Button
              onClick={() => { if (setPasswordDialog.userId) setPasswordMutation.mutate({ userId: setPasswordDialog.userId, password: setPasswordValue }); }}
              disabled={setPasswordMutation.isPending || setPasswordValue.length < 6}
              data-testid="button-admin-set-password-confirm"
            >
              {setPasswordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdminPreordersTab({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const [subTab, setSubTab] = useState<"products" | "customers" | "wholesale" | "pickup" | "campaigns">("products");

  // Campaigns state
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [editingCampaignSlug, setEditingCampaignSlug] = useState<string | null>(null);
  const [campaignForm, setCampaignForm] = useState({ slug: "", title: "", subtitle: "", description: "", heroImage: "", heroImageMobile: "", seoTitle: "", seoDescription: "", visible: true, cardStyle: "vinyl" as "vinyl" | "poster" });
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [deletingCampaignSlug, setDeletingCampaignSlug] = useState<string | null>(null);
  const { data: adminCampaigns = [], isLoading: campaignsLoading, refetch: refetchCampaigns } = useQuery<any[]>({
    queryKey: ["/api/admin/preorder/campaigns"],
    queryFn: () => adminFetch("/api/admin/preorder/campaigns", apiKey),
    enabled: !!apiKey,
  });

  const [wholesaleOrderSearch, setWholesaleOrderSearch] = useState("");
  const [wholesaleOrderStatusFilter, setWholesaleOrderStatusFilter] = useState<string>("all");
  const [wholesaleOrderTypeFilter, setWholesaleOrderTypeFilter] = useState<"all" | "preorder" | "order">("all");
  const [expandedOrderItems, setExpandedOrderItems] = useState<Set<string | number>>(new Set());
  const [expandedWholesaleOrderId, setExpandedWholesaleOrderId] = useState<number | null>(null);

  const { data: preorderProducts, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/preorder/products"],
  });

  const { data: preorderData, isLoading: ordersLoading, refetch: refetchOrders } = useQuery<any>({
    queryKey: ["/api/admin/preorder/orders"],
    queryFn: () => adminFetch("/api/admin/preorder/orders", apiKey),
  });

  const { data: wholesaleOrdersData, isLoading: wholesaleOrdersLoading, refetch: refetchWholesaleOrders } = useQuery<{ orders: any[]; total: number }>({
    queryKey: ["/api/admin/wholesale-preorder/orders"],
    queryFn: () => adminFetch("/api/admin/wholesale-preorder/orders", apiKey),
    enabled: subTab === "wholesale",
  });

  const { data: slidesData, refetch: refetchSlides } = useQuery<{ slides: string[] }>({
    queryKey: ["/api/wholesale-preorder/slides"],
    enabled: subTab === "wholesale",
  });
  const adminSlides = slidesData?.slides || [];
  const [slidesUploading, setSlidesUploading] = useState(false);
  const [slideDeletingIdx, setSlideDeletingIdx] = useState<number | null>(null);

  const { data: pickupPoints = [], refetch: refetchPickupPoints } = useQuery<any[]>({
    queryKey: ["/api/admin/preorder/pickup-points"],
    queryFn: () => adminFetch("/api/admin/preorder/pickup-points", apiKey),
    enabled: subTab === "pickup",
  });
  const [pickupForm, setPickupForm] = useState({ name: "", date: "", city: "", address: "", isActive: true });
  const [savingPickup, setSavingPickup] = useState(false);
  const [editingPickupId, setEditingPickupId] = useState<string | null>(null);

  const handleSlideUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSlidesUploading(true);
    let uploaded = 0;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const fileData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const res = await fetch("/api/admin/wholesale-preorder/slides", {
          method: "POST",
          headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ fileData }),
        });
        if (res.ok) uploaded++;
        else {
          const d = await res.json();
          toast({ title: "Ошибка", description: d.error || "Не удалось загрузить слайд", variant: "destructive" });
        }
      } catch {
        toast({ title: "Ошибка при чтении файла", variant: "destructive" });
      }
    }
    if (uploaded > 0) toast({ title: `Загружено слайдов: ${uploaded}` });
    refetchSlides();
    setSlidesUploading(false);
  };

  const handleSlideDelete = async (idx: number) => {
    setSlideDeletingIdx(idx);
    const res = await fetch(`/api/admin/wholesale-preorder/slides/${idx}`, {
      method: "DELETE",
      headers: { "x-api-key": apiKey },
    });
    if (res.ok) {
      toast({ title: "Слайд удалён" });
      refetchSlides();
    }
    setSlideDeletingIdx(null);
  };

  const handleSlideMoveUp = async (idx: number) => {
    if (idx === 0) return;
    const newSlides = [...adminSlides];
    [newSlides[idx - 1], newSlides[idx]] = [newSlides[idx], newSlides[idx - 1]];
    await fetch("/api/admin/wholesale-preorder/slides/reorder", {
      method: "PUT",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ slides: newSlides }),
    });
    refetchSlides();
  };

  const handleSlideMoveDown = async (idx: number) => {
    if (idx >= adminSlides.length - 1) return;
    const newSlides = [...adminSlides];
    [newSlides[idx], newSlides[idx + 1]] = [newSlides[idx + 1], newSlides[idx]];
    await fetch("/api/admin/wholesale-preorder/slides/reorder", {
      method: "PUT",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ slides: newSlides }),
    });
    refetchSlides();
  };

  const queryClient = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: async ({ productId, status }: { productId: number; status: string }) => {
      return adminFetch(`/api/admin/preorder/${productId}/status`, apiKey, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    },
    onMutate: async ({ productId, status }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/preorder/products"] });
      const previous = queryClient.getQueryData<any[]>(["/api/preorder/products"]);
      queryClient.setQueryData<any[]>(["/api/preorder/products"], (old) =>
        old?.map((p: any) => p.id === productId ? { ...p, preorderStatus: status } : p)
      );
      return { previous };
    },
    onSuccess: () => {
      refetchOrders();
      toast({ title: "Статус обновлен" });
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/preorder/products"], context.previous);
      }
      toast({ title: "Ошибка", description: "Не удалось обновить статус", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preorder/products"] });
    },
  });

  const disablePreorderMutation = useMutation({
    mutationFn: async (productId: number) => {
      return adminFetch(`/api/admin/products/${productId}`, apiKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preorderEnabled: false, preorderGoal: 0, preorderCurrent: 0, preorderStatus: null, preorderDeadline: null, preorderProductionDate: null, preorderShippingDate: null }),
      });
    },
    onSuccess: () => {
      refetch();
      refetchOrders();
      toast({ title: "Предзаказ отключен" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось отключить предзаказ", variant: "destructive" });
    },
  });

  const [deletingOrderIds, setDeletingOrderIds] = useState<Set<number>>(new Set());
  const [editingCdekOrderId, setEditingCdekOrderId] = useState<number | null>(null);
  const [cdekEditAddress, setCdekEditAddress] = useState("");
  const [cdekEditTrack, setCdekEditTrack] = useState("");
  const [savingPreorderStatusId, setSavingPreorderStatusId] = useState<number | null>(null);
  const changeOrderPreorderStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: number; status: string }) => {
      setSavingPreorderStatusId(orderId);
      return adminFetch(`/api/admin/preorder/order/${orderId}/status`, apiKey, { method: "POST", body: JSON.stringify({ status }) });
    },
    onSuccess: (_data, { orderId }) => {
      setSavingPreorderStatusId(null);
      refetchOrders();
      toast({ title: "Статус обновлён", description: "Email клиенту отправлен" });
    },
    onError: (_err, { orderId }) => {
      setSavingPreorderStatusId(null);
      toast({ title: "Ошибка", description: "Не удалось обновить статус", variant: "destructive" });
    },
  });
  const saveCdekDataMutation = useMutation({
    mutationFn: async ({ orderId, pointAddress, cdekNumber }: { orderId: number; pointAddress: string; cdekNumber: string }) =>
      adminFetch(`/api/admin/orders/${orderId}/cdek-data`, apiKey, { method: "PATCH", body: JSON.stringify({ pointAddress: pointAddress || undefined, cdekNumber: cdekNumber || undefined }) }),
    onSuccess: () => { setEditingCdekOrderId(null); refetchOrders(); toast({ title: "Данные доставки сохранены" }); },
    onError: () => toast({ title: "Ошибка", description: "Не удалось сохранить данные доставки", variant: "destructive" }),
  });
  const deletePreorderMutation = useMutation({
    mutationFn: async (orderId: number) => {
      setDeletingOrderIds(prev => new Set(prev).add(orderId));
      return adminFetch(`/api/admin/orders/${orderId}`, apiKey, { method: "DELETE" });
    },
    onSuccess: (_data, orderId) => {
      setDeletingOrderIds(prev => { const next = new Set(prev); next.delete(orderId); return next; });
      refetchOrders();
      toast({ title: "Предзаказ удален" });
    },
    onError: (_err, orderId) => {
      setDeletingOrderIds(prev => { const next = new Set(prev); next.delete(orderId); return next; });
      toast({ title: "Ошибка", description: "Не удалось удалить предзаказ", variant: "destructive" });
    },
  });

  const statusOptions = [
    { value: "collecting", label: "Сбор" },
    { value: "production", label: "В производстве" },
    { value: "shipping", label: "Отправка" },
    { value: "shipped", label: "Отправлено" },
    { value: "cancelled", label: "Отменено" },
  ];

  const formatPrice = (v: number) => new Intl.NumberFormat("ru-RU").format(v / 100) + " \u20BD";

  return (
    <div className="space-y-4" data-testid="section-admin-preorders">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Target className="w-5 h-5" />
          Управление предзаказами
        </h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            data-testid="button-preorders-csv"
            onClick={() => {
              fetch("/api/admin/preorder/orders/xlsx", { headers: { "x-api-key": apiKey } })
                .then(r => r.blob())
                .then(blob => {
                  const blobUrl = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = blobUrl;
                  const date = new Date().toISOString().slice(0, 10);
                  link.download = `preorders-${date}.xlsx`;
                  link.click();
                  URL.revokeObjectURL(blobUrl);
                });
            }}
          >
            <FileText className="w-4 h-4 mr-1" />
            Скачать Excel
          </Button>
          <Button size="sm" variant="outline" onClick={() => { refetch(); refetchOrders(); }} data-testid="button-refresh-preorders">
            <RefreshCw className="w-4 h-4 mr-1" />
            Обновить
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b pb-2 flex-wrap">
        <Button
          variant={subTab === "products" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setSubTab("products")}
          data-testid="button-preorders-products-tab"
        >
          <Package className="w-4 h-4 mr-1" />
          Товары ({preorderProducts?.length || 0})
        </Button>
        <Button
          variant={subTab === "customers" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setSubTab("customers")}
          data-testid="button-preorders-customers-tab"
        >
          <Users className="w-4 h-4 mr-1" />
          Клиенты ({preorderData?.totalUsers || 0})
        </Button>
        <Button
          variant={subTab === "wholesale" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setSubTab("wholesale")}
          data-testid="button-preorders-wholesale-tab"
        >
          <Building2 className="w-4 h-4 mr-1" />
          Опт. заявки {wholesaleOrdersData?.total != null ? `(${wholesaleOrdersData.total})` : ""}
        </Button>
        <Button
          variant={subTab === "pickup" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setSubTab("pickup")}
          data-testid="button-preorders-pickup-tab"
        >
          <MapPin className="w-4 h-4 mr-1" />
          Точки выдачи ({pickupPoints.length})
        </Button>
        <Button
          variant={subTab === "campaigns" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setSubTab("campaigns")}
          data-testid="button-preorders-campaigns-tab"
        >
          <Layout className="w-4 h-4 mr-1" />
          Коллаборации
        </Button>
      </div>

      {subTab === "products" && (
        <>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !preorderProducts || preorderProducts.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-muted-foreground text-sm">Нет товаров с предзаказом</p>
              <p className="text-xs text-muted-foreground mt-1">Включите предзаказ в настройках товара</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {preorderProducts.map((product: any) => {
                return (
                  <Card key={product.id} className="p-4" data-testid={`card-admin-preorder-${product.id}`}>
                    <div className="flex items-start gap-3">
                      {product.thumbnailUrl || product.imageUrl ? (
                        <img src={product.thumbnailUrl || product.imageUrl} alt="" className="w-12 h-12 object-cover rounded-md flex-shrink-0" />
                      ) : (
                        <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
                          <Package className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{product.name}</p>
                        <p className="text-xs text-muted-foreground">{(product.price / 100).toLocaleString("ru-RU")} &#8381;</p>
                        <div className="mt-2 space-y-0.5">
                          {product.preorderDeadline && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Сбор до {new Date(product.preorderDeadline).toLocaleDateString("ru-RU")}
                            </p>
                          )}
                          {product.preorderProductionDate && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              В производстве до {new Date(product.preorderProductionDate).toLocaleDateString("ru-RU")}
                            </p>
                          )}
                          {product.preorderShippingDate && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Отправка {new Date(product.preorderShippingDate).toLocaleDateString("ru-RU")}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-2">
                        <Select
                          value={product.preorderStatus || "collecting"}
                          onValueChange={(value) => {
                            const current = product.preorderStatus || "collecting";
                            if (value === current) return;
                            statusMutation.mutate({ productId: product.id, status: value });
                          }}
                          disabled={statusMutation.isPending}
                        >
                          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid={`select-preorder-status-${product.id}`}>
                            {statusMutation.isPending ? (
                              <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Сохранение...</span>
                            ) : (
                              <SelectValue />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            {statusOptions.map(opt => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm(`Отключить предзаказ для "${product.name}"?`)) {
                              disablePreorderMutation.mutate(product.id);
                            }
                          }}
                          disabled={disablePreorderMutation.isPending}
                          data-testid={`button-disable-preorder-${product.id}`}
                          title="Удалить предзаказ"
                        >
                          {disablePreorderMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {subTab === "customers" && (
        <>
          {ordersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !preorderData ? (
            <div className="text-center py-12 text-muted-foreground">Нет данных о предзаказах</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">Всего предзаказов</div>
                    <div className="text-2xl font-bold text-foreground" data-testid="text-total-preorders">{preorderData.totalOrders}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">Клиентов</div>
                    <div className="text-2xl font-bold text-foreground" data-testid="text-total-preorder-users">{preorderData.totalUsers}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">Оплачено</div>
                    <div className="text-2xl font-bold text-foreground" data-testid="text-total-deposits">{formatPrice(preorderData.totalDeposits)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">Оплачено полностью</div>
                    <div className="text-2xl font-bold text-foreground" data-testid="text-paid-full">{preorderData.paidFull}</div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Клиенты и их предзаказы
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {preorderData.users.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">Нет клиентов с предзаказами</p>
                  ) : (
                    <div className="space-y-2">
                      {preorderData.users.map((user: any, idx: number) => (
                        <details key={user.userEmail || idx} className="group border border-border rounded-md" data-testid={`row-user-preorder-${idx}`}>
                          <summary className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground">{user.userName}</p>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                {user.userEmail && (
                                  <span className="flex items-center gap-1">
                                    <Mail className="w-3 h-3" />
                                    {user.userEmail}
                                  </span>
                                )}
                                {user.userPhone && (
                                  <span className="flex items-center gap-1">
                                    {user.userPhone}
                                  </span>
                                )}
                              </div>
                            </div>
                            <Badge variant="secondary" className="text-xs">
                              <Target className="w-3 h-3 mr-1" />
                              {user.orders.length}
                            </Badge>
                          </summary>
                          <div className="px-3 pb-3 pt-1 border-t border-border">
                            <div className="space-y-2">
                              {user.orders.map((order: any) => (
                                <div key={order.orderId} className="flex items-start gap-3 p-2 rounded-md bg-muted/30" data-testid={`row-preorder-order-${order.orderId}`}>
                                  {order.product?.thumbnailUrl ? (
                                    <img src={order.product.thumbnailUrl} alt="" className="w-10 h-10 object-cover rounded-md flex-shrink-0" />
                                  ) : (
                                    <div className="w-10 h-10 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
                                      <Package className="w-4 h-4 text-muted-foreground" />
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">
                                      {order.product?.name || `Заказ #${order.orderId}`}
                                    </p>
                                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                      {order.orderItems && order.orderItems.length > 0 ? (
                                        order.orderItems.filter((i: any) => i.quantity > 0).map((i: any) => (
                                          <span key={i.size || "no-size"} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-xs font-medium text-foreground">
                                            {i.size || "—"}
                                            {i.quantity > 1 && <span className="text-muted-foreground">×{i.quantity}</span>}
                                          </span>
                                        ))
                                      ) : (
                                        order.size && (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-xs font-medium text-foreground">{order.size}</span>
                                        )
                                      )}
                                      {order.color && <span className="text-xs text-muted-foreground">· {order.color}</span>}
                                    </div>
                                    <div className="flex flex-col gap-0.5 mt-1.5 text-xs text-muted-foreground">
                                      {order.customerName && (
                                        <span className="flex items-center gap-1">
                                          <User className="w-3 h-3 flex-shrink-0" />
                                          {order.customerName}
                                        </span>
                                      )}
                                      {order.customerPhone && (
                                        <span className="flex items-center gap-1">
                                          <Phone className="w-3 h-3 flex-shrink-0" />
                                          {order.customerPhone}
                                        </span>
                                      )}
                                      {order.customerEmail && (
                                        <span className="flex items-center gap-1">
                                          <Mail className="w-3 h-3 flex-shrink-0" />
                                          {order.customerEmail}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1.5 text-xs flex-wrap">
                                      <span className="text-foreground font-medium">Сумма: {formatPrice(order.total)}</span>
                                      {["paid", "processing", "shipped", "delivered"].includes(order.status) ? (
                                        <Badge variant="default" className="text-xs">
                                          <Check className="w-3 h-3 mr-0.5" />
                                          Оплачен
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="text-xs">
                                          <Clock className="w-3 h-3 mr-0.5" />
                                          Ожидает оплаты
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1.5">
                                      <select
                                        className="text-xs border border-border rounded px-1.5 py-0.5 bg-background text-foreground flex-1 min-w-0"
                                        value={order.orderPreorderStatus || ""}
                                        onChange={e => { if (e.target.value) changeOrderPreorderStatusMutation.mutate({ orderId: order.orderId, status: e.target.value }); }}
                                        disabled={savingPreorderStatusId === order.orderId}
                                        data-testid={`select-preorder-status-${order.orderId}`}
                                      >
                                        <option value="">— Статус доставки —</option>
                                        <option value="production">В производстве</option>
                                        <option value="shipping">Отправка</option>
                                        <option value="shipped">Отправлено</option>
                                        <option value="cancelled">Отменено</option>
                                      </select>
                                      {savingPreorderStatusId === order.orderId && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />}
                                    </div>
                                    {(order.cdekPointAddress || order.address) && (
                                      <span className="flex items-start gap-1 mt-0.5">
                                        <MapPin className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                        <span className="text-xs text-muted-foreground">{order.cdekPointAddress || order.address}</span>
                                      </span>
                                    )}
                                    {order.cdekDeliveryCost > 0 && (
                                      <span className="text-xs text-muted-foreground mt-0.5">
                                        Доставка: {(order.cdekDeliveryCost / 100).toFixed(0)} ₽
                                      </span>
                                    )}
                                    {order.cdekTrackNumber && (
                                      <span className="flex items-center gap-1 mt-0.5">
                                        <Truck className="w-3 h-3 flex-shrink-0" />
                                        <span className="text-xs font-mono text-foreground">{order.cdekTrackNumber}</span>
                                      </span>
                                    )}
                                    {editingCdekOrderId === order.orderId ? (
                                      <div className="mt-1.5 space-y-1.5">
                                        <input
                                          className="w-full text-xs border border-border rounded px-2 py-1 bg-background text-foreground placeholder:text-muted-foreground"
                                          placeholder="Адрес ПВЗ"
                                          value={cdekEditAddress}
                                          onChange={e => setCdekEditAddress(e.target.value)}
                                          data-testid={`input-cdek-address-${order.orderId}`}
                                        />
                                        <input
                                          className="w-full text-xs border border-border rounded px-2 py-1 bg-background text-foreground placeholder:text-muted-foreground"
                                          placeholder="Трек-номер СДЭК"
                                          value={cdekEditTrack}
                                          onChange={e => setCdekEditTrack(e.target.value)}
                                          data-testid={`input-cdek-track-${order.orderId}`}
                                        />
                                        <div className="flex gap-1">
                                          <Button size="sm" className="h-6 text-xs px-2" onClick={() => saveCdekDataMutation.mutate({ orderId: order.orderId, pointAddress: cdekEditAddress, cdekNumber: cdekEditTrack })} disabled={saveCdekDataMutation.isPending} data-testid={`button-save-cdek-${order.orderId}`}>Сохранить</Button>
                                          <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setEditingCdekOrderId(null)} data-testid={`button-cancel-cdek-${order.orderId}`}>Отмена</Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <button
                                        className="text-xs text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1 transition-colors"
                                        onClick={() => { setEditingCdekOrderId(order.orderId); setCdekEditAddress(order.cdekPointAddress || ""); setCdekEditTrack(order.cdekTrackNumber || ""); }}
                                        data-testid={`button-edit-cdek-${order.orderId}`}
                                      >
                                        <Pencil className="w-3 h-3" />
                                        {order.cdekPointAddress || order.cdekTrackNumber ? "Изменить доставку" : "Ввести данные доставки"}
                                      </button>
                                    )}
                                    {order.createdAt && (
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        {new Date(order.createdAt).toLocaleDateString("ru-RU")}
                                      </p>
                                    )}
                                  </div>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="flex-shrink-0 text-destructive"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (confirm(`Удалить предзаказ #${order.orderId}?`)) {
                                        deletePreorderMutation.mutate(order.orderId);
                                      }
                                    }}
                                    disabled={deletingOrderIds.has(order.orderId)}
                                    data-testid={`button-delete-preorder-${order.orderId}`}
                                  >
                                    {deletingOrderIds.has(order.orderId) ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="w-4 h-4" />
                                    )}
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {/* ОПТОВЫЕ ЗАЯВКИ */}
      {subTab === "wholesale" && (
        <>
          {/* Slides Presentation Upload */}
          <div className="border rounded-xl p-4 space-y-3 bg-muted/30 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Слайды презентации</h3>
                {adminSlides.length > 0 && (
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{adminSlides.length} шт.</span>
                )}
              </div>
              <label className="cursor-pointer" data-testid="label-slides-upload">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => { handleSlideUpload(e.target.files); e.target.value = ""; }}
                  data-testid="input-slides-upload"
                  disabled={slidesUploading}
                />
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${slidesUploading ? "opacity-50 cursor-not-allowed bg-muted" : "bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"}`}>
                  {slidesUploading ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Загрузка...</>
                  ) : (
                    <><Upload className="w-3.5 h-3.5" /> Добавить слайды</>
                  )}
                </div>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Изображения показываются как пролистываемый слайдер. Можно добавить сразу несколько файлов. Порядок — кнопками ↑↓.
            </p>

            {adminSlides.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Слайды не загружены</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {adminSlides.map((url, idx) => (
                  <div key={url} className="relative group rounded-lg overflow-hidden border bg-muted aspect-video">
                    <img src={url} alt={`Слайд ${idx + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5">
                      <span className="text-white text-xs font-medium">#{idx + 1}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleSlideMoveUp(idx)}
                          disabled={idx === 0}
                          className="w-7 h-7 rounded-md bg-white/20 hover:bg-white/40 disabled:opacity-30 flex items-center justify-center text-white transition-colors"
                          title="Вверх"
                          data-testid={`btn-slide-up-${idx}`}
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => handleSlideMoveDown(idx)}
                          disabled={idx === adminSlides.length - 1}
                          className="w-7 h-7 rounded-md bg-white/20 hover:bg-white/40 disabled:opacity-30 flex items-center justify-center text-white transition-colors"
                          title="Вниз"
                          data-testid={`btn-slide-down-${idx}`}
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => handleSlideDelete(idx)}
                          disabled={slideDeletingIdx === idx}
                          className="w-7 h-7 rounded-md bg-red-500/70 hover:bg-red-500 flex items-center justify-center text-white transition-colors"
                          title="Удалить"
                          data-testid={`btn-slide-delete-${idx}`}
                        >
                          {slideDeletingIdx === idx ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "×"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {wholesaleOrdersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Миграция старых заказов — всегда видна для ручного запуска */}
              <div className="flex justify-end">
                <button
                  data-testid="button-migrate-ispreorder"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/admin/wholesale-preorder/migrate-ispreorder", {
                        method: "POST",
                        headers: { "x-api-key": apiKey },
                      });
                      const data = await res.json();
                      if (res.ok) {
                        toast({
                          title: `Миграция выполнена`,
                          description: `Предзаказов помечено: ${data.migrated}, статус исправлен: ${data.statusFixed}`,
                        });
                        queryClient.invalidateQueries({ queryKey: ["/api/admin/wholesale-preorder/orders"] });
                      } else {
                        toast({ title: "Ошибка", description: data.error, variant: "destructive" });
                      }
                    } catch {
                      toast({ title: "Ошибка сети", variant: "destructive" });
                    }
                  }}
                  className="px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  Исправить старые заказы
                </button>
              </div>

              {/* Тип: предзаказы / заказы */}
              <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
                {([["all", "Все"], ["preorder", "Предзаказы"], ["order", "Заказы"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setWholesaleOrderTypeFilter(val)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${wholesaleOrderTypeFilter === val ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    data-testid={`button-wholesale-type-${val}`}
                  >
                    {label}
                    {wholesaleOrdersData?.orders && (
                      <span className="ml-1 opacity-60">
                        ({wholesaleOrdersData.orders.filter((o: any) =>
                          val === "all" ? true : val === "preorder" ? o.isPreorder : !o.isPreorder
                        ).length})
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск по компании, email, товару..."
                    value={wholesaleOrderSearch}
                    onChange={e => setWholesaleOrderSearch(e.target.value)}
                    className="pl-9"
                    data-testid="input-wholesale-order-search"
                  />
                </div>
                <Select value={wholesaleOrderStatusFilter} onValueChange={setWholesaleOrderStatusFilter}>
                  <SelectTrigger className="w-[160px]" data-testid="select-wholesale-order-status-filter">
                    <SelectValue placeholder="Все статусы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все статусы</SelectItem>
                    <SelectItem value="pending">Ожидает</SelectItem>
                    <SelectItem value="confirmed">Подтверждён</SelectItem>
                    <SelectItem value="processing">В обработке</SelectItem>
                    <SelectItem value="shipped">Отправлено</SelectItem>
                    <SelectItem value="delivered">Доставлено</SelectItem>
                    <SelectItem value="cancelled">Отменено</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(() => {
                const allWholesaleOrders = wholesaleOrdersData?.orders || [];
                const filtered = allWholesaleOrders.filter((o: any) => {
                  if (wholesaleOrderTypeFilter === "preorder" && !o.isPreorder) return false;
                  if (wholesaleOrderTypeFilter === "order" && o.isPreorder) return false;
                  if (wholesaleOrderStatusFilter !== "all" && o.status !== wholesaleOrderStatusFilter) return false;
                  if (!wholesaleOrderSearch.trim()) return true;
                  const q = wholesaleOrderSearch.toLowerCase();
                  const customer = o.customer || {};
                  const items = o.items || [];
                  return (
                    customer.name?.toLowerCase().includes(q) ||
                    customer.email?.toLowerCase().includes(q) ||
                    customer.companyName?.toLowerCase().includes(q) ||
                    String(o.id).includes(q) ||
                    String(o.invoiceNumber || "").includes(q) ||
                    items.some((i: any) => i.productName?.toLowerCase().includes(q))
                  );
                });

                const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
                const fmtPrice = (v: number) => new Intl.NumberFormat("ru-RU").format(v / 100) + " ₽";

                const statusLabel: Record<string, string> = {
                  pending: "Ожидает", confirmed: "Подтверждён", processing: "В обработке",
                  shipped: "Отправлено", delivered: "Доставлено", cancelled: "Отменено",
                };
                const statusColor: Record<string, string> = {
                  pending: "text-orange-600 bg-orange-50 border-orange-200",
                  confirmed: "text-blue-600 bg-blue-50 border-blue-200",
                  processing: "text-purple-600 bg-purple-50 border-purple-200",
                  shipped: "text-green-600 bg-green-50 border-green-200",
                  delivered: "text-green-700 bg-green-100 border-green-300",
                  cancelled: "text-red-600 bg-red-50 border-red-200",
                };

                if (filtered.length === 0) {
                  return (
                    <Card className="p-8 text-center">
                      <p className="text-muted-foreground text-sm">
                        {allWholesaleOrders.length === 0 ? "Оптовых заявок пока нет" : "Ничего не найдено"}
                      </p>
                    </Card>
                  );
                }

                return (
                  <div className="space-y-2">
                    {filtered.map((o: any) => {
                      const customer = o.customer || {};
                      const items: any[] = typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items); } catch { return []; } })() : (o.items || []);
                      const isExpanded = expandedWholesaleOrderId === o.id;
                      return (
                        <Card key={o.id} className="overflow-hidden" data-testid={`card-wholesale-order-${o.id}`}>
                          <div
                            className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                            onClick={() => setExpandedWholesaleOrderId(isExpanded ? null : o.id)}
                          >
                            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                              <Building2 className="w-4 h-4 text-blue-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm">
                                  {customer.companyName || customer.name || "—"}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${o.isPreorder ? "text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-950/40 dark:border-violet-800" : "text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-800"}`}>
                                  {o.isPreorder ? "Предзаказ" : "Заказ"}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[o.status] || "text-muted-foreground bg-muted border-border"}`}>
                                  {statusLabel[o.status] || o.status}
                                </span>
                                {o.invoiceNumber && (
                                  <span className="text-xs text-muted-foreground">Счёт #{o.invoiceNumber}</span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {customer.email} • {fmtDate(o.createdAt)} • {items.length} поз.
                                {customer.contactPerson ? ` • ${customer.contactPerson}` : ""}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-bold text-sm">{fmtPrice(o.total)}</div>
                              {customer.wholesaleDiscount > 0 && (
                                <div className="text-xs text-muted-foreground">−{customer.wholesaleDiscount}%</div>
                              )}
                            </div>
                            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 mt-1 ${isExpanded ? "rotate-180" : ""}`} />
                          </div>

                          {isExpanded && (
                            <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/20">
                              {/* Позиции */}
                              <div>
                                <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Позиции заявки</div>
                                <div className="space-y-1">
                                  {items.map((item: any, idx: number) => (
                                    <div key={idx} className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0">
                                      <div className="min-w-0">
                                        <div className="font-medium truncate">{item.productName || "Товар"}</div>
                                        <div className="text-xs text-muted-foreground">
                                          {item.sku ? `Арт: ${item.sku} • ` : ""}Размер: {item.size} • {item.quantity} шт.
                                        </div>
                                      </div>
                                      <div className="text-right shrink-0 ml-3">
                                        <div className="font-medium">{fmtPrice(item.price * item.quantity)}</div>
                                        <div className="text-xs text-muted-foreground">{fmtPrice(item.price)} × {item.quantity}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex justify-between items-center pt-2 font-bold text-sm border-t border-border mt-1">
                                  <span>Итого</span>
                                  <span>{fmtPrice(o.total)}</span>
                                </div>
                              </div>

                              {/* Детали */}
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                {customer.contactPhone && (
                                  <div><div className="text-xs text-muted-foreground">Телефон</div><div>{customer.contactPhone}</div></div>
                                )}
                                {o.transportCompany && (
                                  <div><div className="text-xs text-muted-foreground">Транспортная компания</div><div className="capitalize">{o.transportCompany}</div></div>
                                )}
                                {o.shippingAddress && (
                                  <div className="col-span-2"><div className="text-xs text-muted-foreground">Адрес доставки</div><div>{o.shippingAddress}</div></div>
                                )}
                                {o.trackingNumber && (
                                  <div><div className="text-xs text-muted-foreground">Трек-номер</div><div className="font-mono text-xs">{o.trackingNumber}</div></div>
                                )}
                                {o.comment && (
                                  <div className="col-span-2"><div className="text-xs text-muted-foreground">Комментарий</div><div>{o.comment}</div></div>
                                )}
                              </div>

                              {/* Финальный счёт (только для предзаказов) */}
                              {o.isPreorder && (
                                <div className="pt-1">
                                  <button
                                    data-testid={`button-final-invoice-${o.id}`}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if (!confirm(`Отправить финальный счёт (50%) на ${o.customer?.email}?`)) return;
                                      try {
                                        const data = await adminFetch(`/api/admin/wholesale-orders/${o.id}/final-invoice`, apiKey, { method: "POST" });
                                        toast({ title: "Финальный счёт отправлен", description: `Счёт №${data.invoiceNumber} отправлен на ${o.customer?.email}` });
                                      } catch (err: any) {
                                        toast({ title: "Ошибка", description: err?.message || "Не удалось отправить счёт", variant: "destructive" });
                                      }
                                    }}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                    Выставить финальный счёт (50%)
                                  </button>
                                </div>
                              )}

                              {/* Смена статуса и типа */}
                              <div className="flex items-center gap-3 pt-1 flex-wrap">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">Статус:</span>
                                  <Select
                                    defaultValue={o.status}
                                    onValueChange={async (status) => {
                                      try {
                                        await adminFetch(`/api/admin/orders/${o.id}/status`, apiKey, {
                                          method: "PATCH",
                                          body: JSON.stringify({ status }),
                                        });
                                        refetchWholesaleOrders();
                                        toast({ title: "Статус обновлён" });
                                      } catch {
                                        toast({ title: "Ошибка обновления статуса", variant: "destructive" });
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="w-[160px] h-8 text-xs" data-testid={`select-ws-status-${o.id}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="pending">Ожидает</SelectItem>
                                      <SelectItem value="confirmed">Подтверждён</SelectItem>
                                      <SelectItem value="processing">В обработке</SelectItem>
                                      <SelectItem value="shipped">Отправлено</SelectItem>
                                      <SelectItem value="delivered">Доставлено</SelectItem>
                                      <SelectItem value="cancelled">Отменено</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">Тип:</span>
                                  <div className="flex gap-1 p-0.5 bg-muted rounded-md">
                                    {([true, false] as const).map((val) => (
                                      <button
                                        key={String(val)}
                                        data-testid={`button-ws-type-${val ? "preorder" : "order"}-${o.id}`}
                                        onClick={async () => {
                                          try {
                                            await adminFetch(`/api/admin/wholesale-orders/${o.id}/type`, apiKey, {
                                              method: "PATCH",
                                              body: JSON.stringify({ isPreorder: val }),
                                            });
                                            refetchWholesaleOrders();
                                            toast({ title: `Тип изменён на «${val ? "Предзаказ" : "Заказ"}»` });
                                          } catch {
                                            toast({ title: "Ошибка смены типа", variant: "destructive" });
                                          }
                                        }}
                                        className={`px-2 py-0.5 text-xs rounded transition-colors ${o.isPreorder === val ? "bg-background shadow font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                      >
                                        {val ? "Предзаказ" : "Заказ"}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          )}
        </>
      )}

      {/* ТОЧКИ ВЫДАЧИ */}
      {subTab === "pickup" && (
        <div className="space-y-4">
          {/* Форма добавления */}
          <Card className="p-4 space-y-3">
            <h3 className="font-semibold text-sm">{editingPickupId ? "Редактировать точку" : "Добавить точку выдачи"}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                className="border border-border rounded-md px-3 py-2 text-sm bg-background w-full"
                placeholder="Название (напр. Дикая Мята 2026)"
                value={pickupForm.name}
                onChange={e => setPickupForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-pickup-name"
              />
              <input
                className="border border-border rounded-md px-3 py-2 text-sm bg-background w-full"
                placeholder="Город"
                value={pickupForm.city}
                onChange={e => setPickupForm(f => ({ ...f, city: e.target.value }))}
                data-testid="input-pickup-city"
              />
              <input
                className="border border-border rounded-md px-3 py-2 text-sm bg-background w-full"
                placeholder="Адрес / локация"
                value={pickupForm.address}
                onChange={e => setPickupForm(f => ({ ...f, address: e.target.value }))}
                data-testid="input-pickup-address"
              />
              <input
                className="border border-border rounded-md px-3 py-2 text-sm bg-background w-full"
                placeholder="Дата (напр. 28–29 июня 2026)"
                value={pickupForm.date}
                onChange={e => setPickupForm(f => ({ ...f, date: e.target.value }))}
                data-testid="input-pickup-date"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={pickupForm.isActive}
                  onChange={e => setPickupForm(f => ({ ...f, isActive: e.target.checked }))}
                  className="accent-primary"
                  data-testid="checkbox-pickup-active"
                />
                Активна (показывается покупателям)
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={savingPickup || !pickupForm.name || !pickupForm.city || !pickupForm.address}
                onClick={async () => {
                  setSavingPickup(true);
                  try {
                    if (editingPickupId) {
                      await adminFetch(`/api/admin/preorder/pickup-points/${editingPickupId}`, apiKey, {
                        method: "PUT",
                        body: JSON.stringify(pickupForm),
                      });
                      toast({ title: "Точка обновлена" });
                      setEditingPickupId(null);
                    } else {
                      await adminFetch("/api/admin/preorder/pickup-points", apiKey, {
                        method: "POST",
                        body: JSON.stringify(pickupForm),
                      });
                      toast({ title: "Точка добавлена" });
                    }
                    setPickupForm({ name: "", date: "", city: "", address: "", isActive: true });
                    refetchPickupPoints();
                  } catch {
                    toast({ title: "Ошибка", variant: "destructive" });
                  }
                  setSavingPickup(false);
                }}
                data-testid="button-pickup-save"
              >
                {savingPickup ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                {editingPickupId ? "Сохранить" : "Добавить"}
              </Button>
              {editingPickupId && (
                <Button size="sm" variant="ghost" onClick={() => { setEditingPickupId(null); setPickupForm({ name: "", date: "", city: "", address: "", isActive: true }); }}>
                  Отмена
                </Button>
              )}
            </div>
          </Card>

          {/* Список точек */}
          {pickupPoints.length === 0 ? (
            <Card className="p-6 text-center">
              <MapPin className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Нет точек выдачи</p>
              <p className="text-xs text-muted-foreground mt-1">Добавьте точки для самовывоза на фестивалях</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {pickupPoints.map((point: any) => (
                <Card key={point.id} className="p-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{point.name}</span>
                      <Badge variant={point.isActive ? "default" : "secondary"} className="text-[10px]">
                        {point.isActive ? "Активна" : "Скрыта"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{point.city} — {point.address}</p>
                    {point.date && <p className="text-xs text-muted-foreground">{point.date}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => { setEditingPickupId(point.id); setPickupForm({ name: point.name, date: point.date || "", city: point.city, address: point.address, isActive: point.isActive }); }}
                      data-testid={`button-pickup-edit-${point.id}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={async () => {
                        if (!confirm(`Удалить «${point.name}»?`)) return;
                        try {
                          await adminFetch(`/api/admin/preorder/pickup-points/${point.id}`, apiKey, { method: "DELETE" });
                          toast({ title: "Точка удалена" });
                          refetchPickupPoints();
                        } catch {
                          toast({ title: "Ошибка", variant: "destructive" });
                        }
                      }}
                      data-testid={`button-pickup-delete-${point.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* КОЛЛАБОРАЦИИ */}
      {subTab === "campaigns" && (
        <div className="space-y-4">
          {!showCampaignForm && (
            <Button size="sm" onClick={() => {
              setShowCampaignForm(true);
              setEditingCampaignSlug(null);
              setCampaignForm({ slug: "", title: "", subtitle: "", description: "", heroImage: "", heroImageMobile: "", seoTitle: "", seoDescription: "", visible: true, cardStyle: "vinyl" });
            }} data-testid="button-create-campaign">
              <Plus className="w-4 h-4 mr-1" /> Создать коллаборацию
            </Button>
          )}

          {showCampaignForm && (
            <Card className="p-4 space-y-3">
              <h3 className="font-semibold text-sm">{editingCampaignSlug ? `Редактировать: ${editingCampaignSlug}` : "Создать коллаборацию"}</h3>
              {!editingCampaignSlug && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Slug * (латиница, цифры, дефисы)</label>
                  <Input
                    value={campaignForm.slug}
                    onChange={e => setCampaignForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                    placeholder="molodost-vnutri"
                    data-testid="input-campaign-slug"
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Название</label>
                <Input value={campaignForm.title} onChange={e => setCampaignForm(f => ({ ...f, title: e.target.value }))} placeholder="Молодость внутри" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Подзаголовок</label>
                <Input value={campaignForm.subtitle} onChange={e => setCampaignForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="Коллаборация BOOOMERANGS" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Баннер десктоп</label>
                <ImageUploadField
                  value={campaignForm.heroImage}
                  onChange={url => setCampaignForm(f => ({ ...f, heroImage: url }))}
                  apiKey={apiKey}
                  placeholder="Вставьте URL или загрузите файл"
                  hint="1200×800 px, соотношение 3:2, JPEG/WebP до 300 KB"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Баннер мобайл</label>
                <ImageUploadField
                  value={campaignForm.heroImageMobile}
                  onChange={url => setCampaignForm(f => ({ ...f, heroImageMobile: url }))}
                  apiKey={apiKey}
                  placeholder="Вставьте URL или загрузите файл"
                  hint="800×1067 px, соотношение 3:4 (вертикальное), JPEG/WebP до 200 KB"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">SEO заголовок (необязательно)</label>
                <Input value={campaignForm.seoTitle} onChange={e => setCampaignForm(f => ({ ...f, seoTitle: e.target.value }))} placeholder={`${campaignForm.title || "Название"} | Pre-drop BOOOMERANGS`} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">SEO описание (необязательно)</label>
                <Input value={campaignForm.seoDescription} onChange={e => setCampaignForm(f => ({ ...f, seoDescription: e.target.value }))} placeholder="Предзаказ..." />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-2">Стиль карточки на главной странице предзаказа</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCampaignForm(f => ({ ...f, cardStyle: "vinyl" }))}
                    className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-md border text-xs transition-all ${campaignForm.cardStyle === "vinyl" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}
                  >
                    <span className="text-xl">🎵</span>
                    <span className="font-medium">Пластинка</span>
                    <span className="text-[10px] opacity-70">Для артистов</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCampaignForm(f => ({ ...f, cardStyle: "poster" }))}
                    className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-md border text-xs transition-all ${campaignForm.cardStyle === "poster" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}
                  >
                    <span className="text-xl">🎪</span>
                    <span className="font-medium">Постер</span>
                    <span className="text-[10px] opacity-70">Для фестивалей</span>
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={campaignForm.visible} onCheckedChange={v => setCampaignForm(f => ({ ...f, visible: v }))} />
                <Label className="text-sm">Показывать на странице /concept</Label>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  disabled={savingCampaign || (!editingCampaignSlug && !campaignForm.slug)}
                  onClick={async () => {
                    setSavingCampaign(true);
                    try {
                      const slug = editingCampaignSlug || campaignForm.slug;
                      await adminFetch("/api/admin/preorder/campaigns", apiKey, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ slug, title: campaignForm.title, subtitle: campaignForm.subtitle, description: campaignForm.description, heroImage: campaignForm.heroImage, heroImageMobile: campaignForm.heroImageMobile, seoTitle: campaignForm.seoTitle, seoDescription: campaignForm.seoDescription, visible: campaignForm.visible, cardStyle: campaignForm.cardStyle }),
                      });
                      toast({ title: "Сохранено" });
                      setShowCampaignForm(false);
                      setEditingCampaignSlug(null);
                      refetchCampaigns();
                    } catch (e: any) {
                      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
                    } finally {
                      setSavingCampaign(false);
                    }
                  }}
                  data-testid="button-save-campaign"
                >
                  {savingCampaign ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                  Сохранить
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowCampaignForm(false); setEditingCampaignSlug(null); }}>Отмена</Button>
              </div>
            </Card>
          )}

          {campaignsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : adminCampaigns.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-muted-foreground text-sm">Коллаборации не созданы</p>
              <p className="text-xs text-muted-foreground mt-1">Создайте первую коллаборацию и назначьте товарам Коллаборацию в редакторе товара (раздел Предзаказ)</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {adminCampaigns.map((c: any) => (
                <Card key={c.slug} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3">
                      {c.coverImage && (
                        <img src={c.coverImage} alt={c.title} className="w-14 h-14 object-cover rounded-md shrink-0 bg-muted" />
                      )}
                      <div>
                        <p className="font-semibold text-sm">{c.title || c.slug}</p>
                        <p className="text-xs text-muted-foreground">/concept/{c.slug}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted-foreground">{c.productCount} товаров · {c.activeProductCount} активных</span>
                          {!c.visible && <span className="text-[10px] bg-orange-500/10 text-orange-500 px-1.5 py-0.5 rounded">скрыта</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingCampaignSlug(c.slug);
                          setCampaignForm({ slug: c.slug, title: c.title || "", subtitle: c.subtitle || "", description: c.description || "", heroImage: c.coverImage || "", heroImageMobile: c.heroImageMobile || "", seoTitle: c.seoTitle || "", seoDescription: c.seoDescription || "", visible: c.visible, cardStyle: c.cardStyle === "poster" ? "poster" : "vinyl" });
                          setShowCampaignForm(true);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deletingCampaignSlug === c.slug}
                        onClick={async () => {
                          if (!confirm(`Удалить коллаборацию «${c.title || c.slug}»? Товары останутся, но будут отвязаны от неё.`)) return;
                          setDeletingCampaignSlug(c.slug);
                          try {
                            await adminFetch(`/api/admin/preorder/campaigns/${c.slug}`, apiKey, { method: "DELETE" });
                            toast({ title: "Коллаборация удалена" });
                            refetchCampaigns();
                          } catch (e: any) {
                            toast({ title: "Ошибка", description: e.message, variant: "destructive" });
                          } finally {
                            setDeletingCampaignSlug(null);
                          }
                        }}
                      >
                        {deletingCampaignSlug === c.slug ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground pt-2">
            Страница коллаборации: <span className="font-mono">/concept/[slug]</span>. Назначьте товарам коллаборацию в редакторе товара → раздел «Предзаказ».
          </p>
        </div>
      )}
    </div>
  );
}

function SecurityTab({ adminKey }: { adminKey: string }) {
  const { toast } = useToast();

  const syncStatusQuery = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/admin/1c-sync-status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/1c-sync-status", {
        headers: { "x-api-key": adminKey },
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to fetch sync status");
      return res.json();
    },
  });

  const toggleSyncMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/admin/1c-sync-toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": adminKey,
        },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle sync");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/1c-sync-status"] });
      toast({
        title: data.enabled ? "1С синхронизация включена" : "1С синхронизация отключена",
        description: data.enabled
          ? "Сервер принимает данные от 1С"
          : "Все запросы от 1С будут отклонены",
      });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось изменить статус", variant: "destructive" });
    },
  });

  const isEnabled = syncStatusQuery.data?.enabled ?? false;

  return (
    <div className="space-y-6">
      <Card className="bg-zinc-900 border-zinc-800 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Безопасность
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-zinc-400" />
                <span className="font-medium">Приём данных из 1С</span>
              </div>
              <p className="text-sm text-zinc-400">
                {isEnabled
                  ? "Сервер принимает данные от 1С. Отключите после завершения синхронизации."
                  : "Сервер отклоняет все запросы от 1С. Включите перед синхронизацией."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={isEnabled ? "default" : "outline"} className={isEnabled ? "bg-green-600" : ""}>
                {isEnabled ? "ВКЛ" : "ВЫКЛ"}
              </Badge>
              <Switch
                checked={isEnabled}
                onCheckedChange={(checked) => toggleSyncMutation.mutate(checked)}
                disabled={toggleSyncMutation.isPending}
                data-testid="switch-1c-sync"
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">Активные меры защиты</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                "Двухфакторная админ-авторизация (JWT + API-ключ)",
                "CORS — ограничение разрешённых доменов",
                "Secure cookies — httpOnly, secure, sameSite",
                "Helmet — security-заголовки (XSS, HSTS и др.)",
                "Rate-limit — логин/регистрация (10 попыток / 15 мин)",
                "Rate-limit — админ-верификация (5 попыток / 15 мин, блокировка IP)",
                "bcrypt — хеширование паролей (salt rounds: 10)",
                "JWT — авторизация через httpOnly cookie",
                "Подтверждение email — обязательная верификация при регистрации",
                "YooKassa — проверка IP-адреса webhook",
                "T-Bank — проверка SHA-256 подписи webhook",
                "1C — доступ только через переключатель в админке",
                "Zod — валидация входящих данных на сервере",
                "API-ключ — защита эндпоинтов синхронизации",
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 p-3 rounded-lg bg-zinc-800/30 border border-zinc-700/50">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-sm">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
