import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "@/lib/admin-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ImageUploadField, VideoUploadField } from "@/components/admin/MediaUploadField";
import { Save } from "lucide-react";

export function ConceptPageEditor({ apiKey }: { apiKey: string }) {
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
  const EMPTY_SLIDE = { heroImage: "", heroImageMobile: "", heroImageAlt: "", bgType: "image", heroVideo: "", tagline1: "", tagline2: "", buttonText: "", buttonLink: "", duration: 7 };
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
                <div>
                  <Label className="text-sm">Задержка (сек)</Label>
                  <Input type="number" min="1" max="60" step="1" value={currentSlide.duration ?? 7} onChange={e => updateSlide({ duration: Number(e.target.value) || 7 })} placeholder="7" />
                  <p className="text-xs text-muted-foreground mt-1">Сколько секунд показывается этот слайд. Для видео — длина ролика.</p>
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

