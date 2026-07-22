import { useQuery } from "@tanstack/react-query";
import { useRef, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Package, ShoppingCart, ArrowLeft, AlertTriangle, Info, Megaphone, Flame, ChevronLeft, ChevronRight } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";
import { PreorderSubscribeWidget } from "@/components/PreorderSubscribeWidget";
import { DolyameWidget } from "@/components/DolyameWidget";
import { usePreorderCartDrawer } from "@/components/PreorderCartDrawer";
import { usePreorderCart } from "@/context/PreorderCartContext";
import { useToast } from "@/hooks/use-toast";

interface PreorderProduct {
  id: number;
  slug?: string;
  name: string;
  price: number;
  discountPercent?: number;
  images?: string[];
  imageUrl?: string;
  thumbnailUrl?: string;
  preorderEnabled: boolean;
  preorderDeadline: string | null;
  preorderProductionDate: string | null;
  preorderShippingDate: string | null;
  preorderStatus: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; step: number }> = {
  collecting:  { label: "Сбор заявок",   step: 1 },
  production:  { label: "Производство",  step: 2 },
  shipping:    { label: "Отправка",      step: 3 },
  shipped:     { label: "Отправлено",    step: 4 },
  cancelled:   { label: "Отменено",      step: 0 },
};

const STEPS = ["Сбор", "Производство", "Отправка", "Доставлено"];

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Свайп изображений товара на карточке (мобильный тач-свайп + мышь на десктопе)
function SwipeableCardImages({
  images,
  alt,
  isLocked,
}: {
  images: string[];
  alt: string;
  isLocked?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const draggedRef = useRef(false);

  const count = images.length;

  function clampIndex(next: number) {
    return Math.max(0, Math.min(count - 1, next));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (count <= 1) return;
    startXRef.current = e.clientX;
    draggedRef.current = false;
    setIsDragging(true);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging || count <= 1) return;
    const delta = e.clientX - startXRef.current;
    if (Math.abs(delta) > 4) draggedRef.current = true;
    setDragX(delta);
  }

  function endDrag() {
    if (!isDragging) return;
    setIsDragging(false);
    const threshold = 40;
    if (dragX <= -threshold) {
      setIndex((i) => clampIndex(i + 1));
    } else if (dragX >= threshold) {
      setIndex((i) => clampIndex(i - 1));
    }
    setDragX(0);
  }

  function handleClickCapture(e: React.MouseEvent) {
    // Не даём свайпу навигировать по ссылке карточки
    if (draggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      draggedRef.current = false;
    }
  }

  const offsetPct = count > 0 ? -index * (100 / count) : 0;

  return (
    <div
      className="relative w-full h-full touch-pan-y select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={isDragging ? endDrag : undefined}
      onClickCapture={handleClickCapture}
    >
      <div
        className="flex h-full"
        style={{
          width: `${count * 100}%`,
          transform: `translate3d(calc(${offsetPct}% + ${isDragging ? dragX : 0}px), 0, 0)`,
          transition: isDragging ? "none" : "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {images.map((src, i) => (
          <div key={i} className="h-full shrink-0" style={{ width: `${100 / count}%` }}>
            <img
              src={src}
              alt={alt}
              loading="lazy"
              draggable={false}
              className={`w-full h-full object-cover pointer-events-none ${
                isLocked ? "" : "transition-transform duration-500 group-hover:scale-105"
              }`}
            />
          </div>
        ))}
      </div>

      {count > 1 && (
        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1 pointer-events-none">
          {images.map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === index ? "bg-white" : "bg-white/40"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[3/4] bg-muted rounded-sm mb-4" />
      <div className="h-4 bg-muted rounded w-3/4 mb-2" />
      <div className="h-4 bg-muted rounded w-1/3" />
    </div>
  );
}

interface Campaign {
  slug: string;
  title: string;
  subtitle: string;
  coverImage: string;
  badgeImage?: string;
  productCount: number;
  activeProductCount: number;
  cardStyle?: "vinyl" | "poster";
}

export default function ConceptPage() {
  const { data: products, isLoading } = useQuery<PreorderProduct[]>({
    queryKey: ["/api/preorder/products"],
  });

  const { data: campaigns, isLoading: campaignsLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/preorder/campaigns"],
  });

  const hasCampaigns = !!campaigns && campaigns.length > 0;

  const { data: conceptSettings, isLoading: heroLoading } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/concept"],
  });

  const { data: seoOverrides } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/seo"],
  });
  const conceptSeo = seoOverrides?.concept || {};

  // Слайды — обратная совместимость: если slides нет, берём одиночный hero.heroImage
  const getConceptSlides = (): any[] => {
    const hero = conceptSettings?.hero;
    if (!hero) return [];
    if (hero.slides && Array.isArray(hero.slides)) {
      return hero.slides.filter((s: any) => s.heroImage || s.heroVideo);
    }
    if (hero.heroImage) return [{ heroImage: hero.heroImage, heroImageMobile: hero.heroImageMobile || "", heroImageAlt: hero.heroImageAlt || "", bgType: "image", heroVideo: "" }];
    return [];
  };
  const conceptSlides = getConceptSlides();
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [heroAnimKey, setHeroAnimKey] = useState(0);
  const activeSlideIndex = conceptSlides.length > 0 ? heroSlideIndex % conceptSlides.length : 0;

  const promoBanner = conceptSettings?.promo_banner || {};
  const bannerEnabled: boolean = !!promoBanner.enabled;
  const bannerStyle: string = promoBanner.style || "neutral";
  const bannerTitle: string = promoBanner.title || "";
  const bannerText: string = promoBanner.text || "";
  const bannerButtonText: string = promoBanner.buttonText || "";
  const bannerButtonUrl: string = promoBanner.buttonUrl || "";

  const { addOrUpdateItem, items: cartPreorderItems } = usePreorderCart();
  const { openDrawer: openPreorderCartDrawer } = usePreorderCartDrawer();
  const [, setLocation] = useLocation();

  // Если кампания одна — сразу переходим на её страницу
  useEffect(() => {
    if (!campaignsLoading && campaigns && campaigns.length === 1) {
      setLocation(`/concept/${campaigns[0].slug}`);
    }
  }, [campaigns, campaignsLoading]);

  // Авто-смена слайдов (только при нескольких заполненных слайдах)
  useEffect(() => {
    if (conceptSlides.length <= 1) return;
    const timer = setInterval(() => {
      if (heroPaused) return;
      setHeroSlideIndex(prev => (prev + 1) % conceptSlides.length);
      setHeroAnimKey(k => k + 1);
    }, 7000);
    return () => clearInterval(timer);
  }, [conceptSettings, heroPaused]);

  // Предзагрузка следующих слайдов
  useEffect(() => {
    if (conceptSlides.length <= 1) return;
    const isMobile = window.innerWidth < 640;
    conceptSlides.slice(1).forEach((s: any) => {
      const src = isMobile && s.heroImageMobile ? s.heroImageMobile : s.heroImage;
      if (src) { const img = new Image(); img.src = src; }
    });
  }, [conceptSettings]);

  const { toast } = useToast();
  const [spinningSlug, setSpinningSlug] = useState<string | null>(null);

  // Скролл — останавливает пластинку на мобильном
  useEffect(() => {
    const stop = () => setSpinningSlug(null);
    window.addEventListener("scroll", stop, { passive: true });
    return () => window.removeEventListener("scroll", stop);
  }, []);

  const [sizePopupId, setSizePopupId] = useState<number | null>(null);
  const [popupSizes, setPopupSizes] = useState<string[]>([]);
  const [popupSizeStock, setPopupSizeStock] = useState<Record<string, number>>({});
  const [popupSizeQty, setPopupSizeQty] = useState<Record<string, number>>({});
  const [popupLoadingId, setPopupLoadingId] = useState<number | null>(null);

  const SIZE_ORDER = ["XXS","XS","S","M","L","XL","XXL","XXXL","ONE SIZE","OS"];

  function getEffectivePrice(p: PreorderProduct): number {
    const sp = (p as any).salePrice;
    if (sp && sp > 0 && sp < p.price) return sp;
    const d = p.discountPercent;
    return d && d > 0 ? Math.round(p.price * (1 - d / 100)) : p.price;
  }

  async function openSizePopup(e: React.MouseEvent, product: PreorderProduct) {
    e.preventDefault();
    e.stopPropagation();
    setPopupLoadingId(product.id);
    const effectivePrice = getEffectivePrice(product);
    try {
      const res = await fetch(`/api/products/${product.id}`);
      const data = await res.json();
      const sizeStockData: Record<string, number> = data.sizeStock || {};
      const fromStock = Object.keys(sizeStockData).filter(k => (sizeStockData[k] ?? 0) > 0);
      const fromSizes: string[] = data.sizes || [];
      const all = Array.from(new Set([...fromSizes, ...fromStock]));
      const sorted = all.sort((a, b) => {
        const ia = SIZE_ORDER.indexOf(a), ib = SIZE_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1; if (ib === -1) return -1;
        return ia - ib;
      });
      setPopupSizeStock(sizeStockData);
      if (sorted.length <= 1) {
        const onlySize = sorted[0] || "ONE SIZE";
        const stockLimit = sizeStockData[onlySize];
        const alreadyInCart = cartPreorderItems.find(i => i.productId === product.id)?.selectedSizes[onlySize] || 0;
        if (stockLimit !== undefined && alreadyInCart + 1 > stockLimit) {
          toast({ title: "Нет в наличии", description: `Доступно ${stockLimit} шт., в корзине уже ${alreadyInCart}`, variant: "destructive" });
          return;
        }
        addOrUpdateItem({
          productId: product.id,
          productName: product.name,
          price: effectivePrice,
          imageUrl: product.images?.[0] || product.thumbnailUrl || product.imageUrl || "",
          selectedSizes: { [onlySize]: 1 },
        });
        openPreorderCartDrawer();
      } else {
        setPopupSizes(sorted);
        setPopupSizeQty({});
        setSizePopupId(product.id);
      }
    } catch {
      addOrUpdateItem({
        productId: product.id,
        productName: product.name,
        price: effectivePrice,
        imageUrl: product.images?.[0] || product.thumbnailUrl || product.imageUrl || "",
        selectedSizes: { "ONE SIZE": 1 },
      });
      openPreorderCartDrawer();
    } finally {
      setPopupLoadingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative" data-testid="page-concept">
      <SEO
        title={conceptSeo.title || "Pre-drop | BOOOMERANGS"}
        description={conceptSeo.description || "Pre-drop BOOOMERANGS — поддержи создание новых моделей одежды с авторскими принтами. Голосуй рублём за то, что хочешь носить."}
        keywords="предзаказ, pre-drop, российский бренд одежды с авторскими принтами, BOOOMERANGS"
      />
      {/* Кнопка «назад» — всегда видна независимо от наличия hero */}
      <button
        onClick={() => window.history.length > 1 ? window.history.back() : (window.location.href = '/')}
        className="absolute top-4 left-4 z-20 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm text-white px-2 py-2 sm:px-3 rounded-full text-sm font-medium hover:bg-black/70 transition-colors"
        data-testid="button-back-hero"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="hidden sm:inline">Назад</span>
      </button>
      {/* Hero — слайдер до 3 слайдов, обратно совместим с одиночным баннером */}
      {(heroLoading || conceptSlides.length > 0) && (
        <section
          className="relative bg-black overflow-hidden"
          onTouchStart={() => setHeroPaused(true)}
          onTouchEnd={() => setHeroPaused(false)}
          onTouchCancel={() => setHeroPaused(false)}
        >
          {/* Skeleton пока грузятся настройки */}
          {heroLoading && (
            <div className="h-[45vw] max-h-[480px] min-h-[160px] bg-zinc-900 animate-pulse" />
          )}

          {/* Слайды */}
          {!heroLoading && conceptSlides.length > 0 && (
            <div className="relative h-[45vw] max-h-[480px] min-h-[160px]">
              {conceptSlides.map((s: any, i: number) => (
                <div
                  key={i === activeSlideIndex ? `active-${heroAnimKey}` : i}
                  className="absolute inset-0 transition-opacity duration-700"
                  style={{ opacity: i === activeSlideIndex ? 1 : 0, zIndex: i === activeSlideIndex ? 1 : 0 }}
                >
                  {s.bgType === "video" && s.heroVideo ? (
                    <video
                      src={s.heroVideo}
                      autoPlay loop muted playsInline
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <picture className="absolute inset-0 block">
                      {s.heroImageMobile && (
                        <source media="(max-width: 639px)" srcSet={s.heroImageMobile} />
                      )}
                      <img
                        src={s.heroImage || ""}
                        alt={s.heroImageAlt || "BOOOMERANGS Pre-drop"}
                        loading={i === 0 ? "eager" : "lazy"}
                        // @ts-ignore fetchpriority is valid on <img> but missing from current @types/react
                        fetchpriority={i === 0 ? "high" : "low"}
                        className="w-full h-full object-cover"
                      />
                    </picture>
                  )}

                  {/* Текст и кнопка поверх слайда */}
                  {(s.tagline1 || s.tagline2 || s.buttonText) && (
                    <>
                      <div className="absolute inset-0 bg-black/40 pointer-events-none" />
                      <div className="absolute inset-0 flex flex-col items-center justify-end pb-8 sm:pb-10 z-10 px-4">
                        {(s.tagline1 || s.tagline2) && (
                          <p className="font-mono text-[9px] sm:text-xs text-white uppercase tracking-[0.2em] text-center leading-relaxed drop-shadow-lg mb-4">
                            {s.tagline1}{s.tagline1 && s.tagline2 ? <><br />{s.tagline2}</> : s.tagline2}
                          </p>
                        )}
                        {s.buttonText && (
                          <Link href={s.buttonLink || "/concept"}>
                            <button className="bg-white/80 backdrop-blur-sm text-black hover:bg-white transition-colors px-5 py-2 rounded-full text-xs font-semibold uppercase tracking-widest">
                              {s.buttonText}
                            </button>
                          </Link>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}

              {/* Стрелки навигации — только при нескольких слайдах */}
              {conceptSlides.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Предыдущий слайд"
                    onClick={() => { setHeroSlideIndex((activeSlideIndex - 1 + conceptSlides.length) % conceptSlides.length); setHeroAnimKey(k => k + 1); }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 z-20 p-2 text-white/70 hover:text-white transition-colors"
                  >
                    <ChevronLeft className="w-6 h-6 sm:w-7 sm:h-7 stroke-[1.5]" />
                  </button>
                  <button
                    type="button"
                    aria-label="Следующий слайд"
                    onClick={() => { setHeroSlideIndex((activeSlideIndex + 1) % conceptSlides.length); setHeroAnimKey(k => k + 1); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 z-20 p-2 text-white/70 hover:text-white transition-colors"
                  >
                    <ChevronRight className="w-6 h-6 sm:w-7 sm:h-7 stroke-[1.5]" />
                  </button>
                </>
              )}

              {/* Точки-индикаторы */}
              {conceptSlides.length > 1 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
                  {conceptSlides.map((_: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => { setHeroSlideIndex(i); setHeroAnimKey(k => k + 1); }}
                      aria-label={`Слайд ${i + 1}`}
                      className={`rounded-full transition-all duration-300 ${
                        i === activeSlideIndex
                          ? "w-4 h-1.5 bg-white"
                          : "w-1.5 h-1.5 bg-white/50 hover:bg-white/80"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

        </section>
      )}

      {/* Виджет подписки */}
      <PreorderSubscribeWidget />

      {/* Promo banner */}
      {bannerEnabled && (bannerTitle || bannerText) && (() => {
        const styleMap: Record<string, { wrap: string; icon: string; iconBg: string; btn: string }> = {
          neutral:   { wrap: "bg-zinc-900 border-zinc-700/50",           icon: "text-white/80",      iconBg: "bg-white/10",         btn: "bg-white text-black hover:bg-white/90" },
          urgent:    { wrap: "bg-red-950/70 border-red-800/50",           icon: "text-red-400",       iconBg: "bg-red-500/20",       btn: "bg-red-500 text-white hover:bg-red-600" },
          info:      { wrap: "bg-blue-950/70 border-blue-800/50",         icon: "text-blue-400",      iconBg: "bg-blue-500/20",      btn: "bg-blue-500 text-white hover:bg-blue-600" },
          highlight: { wrap: "bg-[#161a00] border-[#D7FF00]/25",          icon: "text-[#D7FF00]",     iconBg: "bg-[#D7FF00]/15",     btn: "bg-[#D7FF00] text-black hover:bg-[#c8ef00]" },
        };
        const s = styleMap[bannerStyle] || styleMap.neutral;
        const IconComp = bannerStyle === "urgent" ? AlertTriangle : bannerStyle === "info" ? Info : bannerStyle === "highlight" ? Flame : Megaphone;
        return (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10">
            <div className={`rounded-2xl border px-5 py-4 sm:px-6 sm:py-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5 ${s.wrap}`}>
              <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${s.iconBg}`}>
                <IconComp className={`w-5 h-5 ${s.icon}`} />
              </div>
              <div className="flex-1 min-w-0">
                {bannerTitle && (
                  <p className="text-sm sm:text-base font-semibold text-white leading-snug">{bannerTitle}</p>
                )}
                {bannerText && (
                  <p className="text-xs sm:text-sm text-white/65 mt-1 leading-relaxed">{bannerText}</p>
                )}
              </div>
              {bannerButtonText && (
                bannerButtonUrl ? (
                  <a
                    href={bannerButtonUrl}
                    className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-full transition-colors ${s.btn}`}
                  >
                    {bannerButtonText}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className={`shrink-0 text-xs font-semibold px-5 py-2 rounded-full ${s.btn}`}>
                    {bannerButtonText}
                  </span>
                )
              )}
            </div>
          </div>
        );
      })()}

      {/* Products */}
      <section
        className="py-16 sm:py-24 relative overflow-hidden"
        style={{ background: "#1c1a1a" }}
      >
        {/* Тёплый блоб слева */}
        <div
          className="absolute top-1/4 -left-32 w-[55vw] h-[55vw] max-w-[600px] max-h-[600px] rounded-full opacity-[0.20] blur-[130px] pointer-events-none"
          style={{ background: "radial-gradient(circle, #c62828 0%, transparent 65%)" }}
        />
        {/* Холодный блоб справа */}
        <div
          className="absolute bottom-1/4 -right-32 w-[50vw] h-[50vw] max-w-[560px] max-h-[560px] rounded-full opacity-[0.15] blur-[130px] pointer-events-none"
          style={{ background: "radial-gradient(circle, #4a148c 0%, transparent 65%)" }}
        />

        {/* Тонкая сетка-текстура */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        />

        {/* Watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <img src="/images/boomerangs-logo.webp" alt="" className="w-[80%] max-w-[900px] opacity-[0.04]" draggable="false" />
        </div>

        <div className="px-4 sm:px-6 lg:px-12 relative z-10">
          {(isLoading || campaignsLoading) ? (
            <div className="flex flex-wrap justify-center gap-20">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-8">
                  <div className="w-[320px] h-[320px] sm:w-[360px] sm:h-[360px] rounded-full bg-zinc-900 animate-pulse" />
                  <div className="space-y-2 text-center">
                    <div className="h-3 w-32 bg-zinc-800 rounded mx-auto animate-pulse" />
                    <div className="h-5 w-48 bg-zinc-800 rounded mx-auto animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : hasCampaigns ? (
            /* ── Карточки кампаний ── */
            <div className="flex flex-wrap justify-center gap-x-16 gap-y-20 sm:gap-x-20 sm:gap-y-24 lg:gap-x-24 lg:gap-y-28">
              {campaigns!.map((c) => c.cardStyle === "poster" ? (
                /* ── Постер (фестивальный стиль) ── */
                <Link
                  key={c.slug}
                  href={`/concept/${c.slug}`}
                  className="poster-card group flex flex-col items-center gap-5 sm:gap-6 cursor-pointer w-full sm:w-auto"
                  data-testid={`card-campaign-${c.slug}`}
                >
                  {/* ── Прямоугольное фото ── */}
                  <div className="relative w-[72vw] sm:w-[300px] lg:w-[400px]" style={{ maxWidth: 400, aspectRatio: "1/1" }}>

                    {/* Свечение — как у пластинки, но квадратное */}
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        inset: -24,
                        background: "radial-gradient(circle, rgba(220,200,180,0.22) 0%, rgba(160,130,110,0.10) 50%, transparent 72%)",
                        filter: "blur(20px)",
                      }}
                    />

                    {/* Картинка */}
                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{
                        borderRadius: 6,
                        boxShadow: "0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05)",
                      }}
                    >
                      {c.coverImage ? (
                        <img
                          src={c.coverImage}
                          alt={c.title}
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                          style={{ filter: "saturate(1.1) brightness(1.05)" }}
                          draggable="false"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-zinc-900" />
                      )}

                      {/* Лёгкий градиент снизу */}
                      <div className="absolute inset-0 pointer-events-none" style={{
                        background: "linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 50%)",
                      }} />
                    </div>

                    {/* Изображение-билет — нижний правый угол, выходит за рамку */}
                    {c.badgeImage && (
                      <div
                        className="absolute z-20 pointer-events-none"
                        style={{
                          bottom: -18,
                          right: -14,
                          width: "42%",
                          filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.7)) drop-shadow(0 2px 6px rgba(0,0,0,0.5))",
                          transform: "rotate(4deg)",
                        }}
                      >
                        {/* Белая рамка как у физического билета */}
                        <div
                          style={{
                            background: "#fff",
                            borderRadius: 5,
                            padding: 4,
                            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
                          }}
                        >
                          <img
                            src={c.badgeImage}
                            alt=""
                            draggable={false}
                            style={{
                              width: "100%",
                              display: "block",
                              borderRadius: 3,
                              objectFit: "cover",
                              aspectRatio: "3/2",
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Бейдж — сверху над картинкой (как у пластинки) */}
                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-20">
                      <span
                        className="inline-flex items-center gap-1.5 text-[10px] font-mono tracking-[0.15em] uppercase px-3 py-1.5 rounded-full whitespace-nowrap"
                        style={{
                          background: "rgba(8,8,12,0.92)",
                          border: "1px solid rgba(255,255,255,0.18)",
                          backdropFilter: "blur(8px)",
                          color: "rgba(255,255,255,0.95)",
                          boxShadow: "0 0 12px rgba(74,222,128,0.2)",
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                        Предзаказ
                      </span>
                    </div>
                  </div>

                  {/* ── Текст — точно как у пластинки ── */}
                  <div className="vinyl-info text-center w-[72vw] sm:w-[300px] lg:w-[400px]" style={{ maxWidth: 400 }}>
                    <p className="text-[9px] font-mono uppercase tracking-[0.38em] text-white/60 mb-3">
                      BOOOMERANGS
                    </p>
                    <h3 className="text-2xl sm:text-3xl font-black uppercase tracking-wide text-white leading-none">
                      {c.title}
                    </h3>
                    {c.subtitle && (
                      <p className="text-[10px] uppercase tracking-[0.22em] text-white/70 mt-1.5 font-mono">
                        {c.subtitle}
                      </p>
                    )}
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-white/25" />
                      <span className="text-[8px] font-mono uppercase tracking-[0.3em] text-white/60">Предзаказ</span>
                      <div className="flex-1 h-px bg-white/25" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-white/70 uppercase tracking-widest">
                        {c.productCount}&nbsp;{c.productCount === 1 ? "товар" : c.productCount < 5 ? "товара" : "товаров"}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] px-3.5 py-1.5 rounded-full border border-white/40 text-white group-hover:border-white group-hover:bg-white/10 transition-all duration-300">
                        Смотреть <ArrowRight className="w-2.5 h-2.5" />
                      </span>
                    </div>
                  </div>
                </Link>
              ) : (
                /* ── Виниловая пластинка (стиль по умолчанию) ── */
                <Link
                  key={c.slug}
                  href={`/concept/${c.slug}`}
                  className={`vinyl-card group flex flex-col items-center gap-5 sm:gap-6 cursor-pointer w-full sm:w-auto${spinningSlug === c.slug ? " vinyl-spinning" : ""}`}
                  data-testid={`card-campaign-${c.slug}`}
                  onTouchStart={() => setSpinningSlug(prev => prev === c.slug ? null : c.slug)}
                >
                  {/* ── Vinyl Disc ── */}
                  <div className="relative w-[72vw] h-[72vw] sm:w-[300px] sm:h-[300px] lg:w-[400px] lg:h-[400px]" style={{ maxWidth: 400, maxHeight: 400 }}>

                    {/* Постоянное свечение — диск отрывается от фона */}
                    <div
                      className="absolute rounded-full pointer-events-none"
                      style={{
                        inset: -24,
                        background: "radial-gradient(circle, rgba(220,200,180,0.28) 0%, rgba(160,130,110,0.14) 50%, transparent 72%)",
                        filter: "blur(20px)",
                      }}
                    />

                    {/* Пластинка — вращается при ховере */}
                    <div
                      className="vinyl-disc absolute inset-0 rounded-full overflow-hidden"
                      style={{
                        boxShadow: "0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05)",
                      }}
                    >
                      {/* Постер — яркий, во весь диск */}
                      {c.coverImage && (
                        <img
                          src={c.coverImage}
                          alt={c.title}
                          className="absolute inset-0 w-full h-full object-cover"
                          style={{ opacity: 1, filter: "saturate(1.1) brightness(1.05)" }}
                          draggable="false"
                        />
                      )}

                      {/* Тонкие бороздки поверх постера */}
                      <div
                        className="absolute inset-0"
                        style={{
                          background: `repeating-radial-gradient(circle at center,
                            transparent 0px, transparent 7px,
                            rgba(0,0,0,0.18) 7px, rgba(0,0,0,0.18) 8px,
                            transparent 8px, transparent 12px,
                            rgba(255,255,255,0.04) 12px, rgba(255,255,255,0.04) 13px
                          )`,
                        }}
                      />

                      {/* Иридесцентный блик поверх постера */}
                      <div
                        className="vinyl-sheen absolute inset-0"
                        style={{
                          background: "conic-gradient(from 40deg at 50% 50%, rgba(255,0,102,0.22) 0deg, rgba(255,140,0,0.18) 65deg, rgba(64,224,208,0.20) 140deg, rgba(124,77,255,0.22) 210deg, rgba(255,255,255,0.14) 280deg, rgba(255,0,102,0.18) 360deg)",
                          mixBlendMode: "screen",
                          opacity: 0.22,
                        }}
                      />

                      {/* Блик-отражение */}
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          background: "radial-gradient(ellipse 55% 38% at 28% 22%, rgba(255,255,255,0.18) 0%, transparent 65%)",
                        }}
                      />

                      {/* Виниловый обод — тёмный край с лёгким бликом */}
                      <div
                        className="absolute inset-0 rounded-full pointer-events-none"
                        style={{
                          background: "radial-gradient(circle at center, transparent 58%, rgba(0,0,0,0.45) 72%, rgba(0,0,0,0.82) 88%, rgba(0,0,0,0.95) 100%)",
                        }}
                      />
                      {/* Тонкий светлый блик по ободу — имитация глянца края */}
                      <div
                        className="absolute inset-0 rounded-full pointer-events-none"
                        style={{
                          boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.07), inset 0 0 0 5px rgba(0,0,0,0.4)",
                        }}
                      />

                      {/* Внутренняя тень у края */}
                      <div
                        className="absolute inset-0 rounded-full pointer-events-none"
                        style={{
                          boxShadow: "inset 0 0 0 16px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(255,255,255,0.07)",
                        }}
                      />

                      {/* ── Центральный лейбл ── */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div
                          className="relative rounded-full flex flex-col items-center justify-center overflow-hidden"
                          style={{
                            width: "34%",
                            height: "34%",
                            boxShadow: "0 3px 16px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.07)",
                          }}
                        >
                          {/* Тёмный фон лейбла */}
                          <div
                            className="absolute inset-0"
                            style={{
                              background: "radial-gradient(circle at 40% 38%, #1c1c1c, #080808 80%)",
                            }}
                          />
                          {/* Тонкие бороздки на лейбле */}
                          <div
                            className="absolute inset-0"
                            style={{
                              background: `repeating-radial-gradient(circle at center,
                                transparent 0px, transparent 4px,
                                rgba(255,255,255,0.03) 4px, rgba(255,255,255,0.03) 5px
                              )`,
                            }}
                          />
                          {/* Логотип — выше центра */}
                          <div className="absolute flex flex-col items-center" style={{ top: "4%", left: 0, right: 0 }}>
                            <img
                              src="/images/boomerangs-logo.webp"
                              alt=""
                              className="object-contain"
                              style={{ width: "54%", opacity: 0.9, filter: "invert(1) brightness(0.95)" }}
                              draggable="false"
                            />
                            <span className="text-[4px] uppercase tracking-[0.22em] text-white/40 mt-0.5 font-mono leading-none">
                              BOOOMERANGS
                            </span>
                          </div>
                          {/* Отверстие шпинделя — строго по центру */}
                          <div
                            className="absolute rounded-full bg-black"
                            style={{
                              width: "13%",
                              height: "13%",
                              top: "50%",
                              left: "50%",
                              transform: "translate(-50%, -50%)",
                              boxShadow: "inset 0 1px 3px rgba(255,255,255,0.1), 0 0 0 1px rgba(255,255,255,0.07)",
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Бейдж — сверху над диском */}
                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-20">
                      <span
                        className="inline-flex items-center gap-1.5 text-[10px] font-mono tracking-[0.15em] uppercase px-3 py-1.5 rounded-full whitespace-nowrap"
                        style={{
                          background: "rgba(8,8,12,0.92)",
                          border: "1px solid rgba(255,255,255,0.18)",
                          backdropFilter: "blur(8px)",
                          color: "rgba(255,255,255,0.95)",
                          boxShadow: "0 0 12px rgba(74,222,128,0.2)",
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                        Предзаказ
                      </span>
                    </div>

                    {/* Изображение-билет — выходит снизу-справа от пластинки */}
                    {c.badgeImage && (
                      <div
                        className="absolute z-20 pointer-events-none"
                        style={{
                          bottom: -20,
                          right: -20,
                          width: "38%",
                          filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.8)) drop-shadow(0 2px 8px rgba(0,0,0,0.6))",
                          transform: "rotate(-5deg)",
                        }}
                      >
                        <div
                          style={{
                            background: "#fff",
                            borderRadius: 5,
                            padding: 4,
                            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
                          }}
                        >
                          <img
                            src={c.badgeImage}
                            alt=""
                            draggable={false}
                            style={{
                              width: "100%",
                              display: "block",
                              borderRadius: 3,
                              objectFit: "cover",
                              aspectRatio: "3/2",
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Конверт альбома — текст под пластинкой ── */}
                  <div className="vinyl-info text-center w-[72vw] sm:w-[300px] lg:w-[400px]" style={{ maxWidth: 400 }}>
                    {/* Лейбл бренда */}
                    <p className="text-[9px] font-mono uppercase tracking-[0.38em] text-white/60 mb-3">
                      BOOOMERANGS
                    </p>

                    {/* Название кампании — крупно */}
                    <h3 className="text-2xl sm:text-3xl font-black uppercase tracking-wide text-white leading-none">
                      {c.title}
                    </h3>

                    {/* Подзаголовок */}
                    {c.subtitle && (
                      <p className="text-[10px] uppercase tracking-[0.22em] text-white/70 mt-1.5 font-mono">
                        {c.subtitle}
                      </p>
                    )}

                    {/* Разделитель */}
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-white/25" />
                      <span className="text-[8px] font-mono uppercase tracking-[0.3em] text-white/60">Предзаказ</span>
                      <div className="flex-1 h-px bg-white/25" />
                    </div>

                    {/* Нижняя строка */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-white/70 uppercase tracking-widest">
                        {c.productCount}&nbsp;{c.productCount === 1 ? "товар" : c.productCount < 5 ? "товара" : "товаров"}
                      </span>
                      <span
                        className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] px-3.5 py-1.5 rounded-full border border-white/40 text-white group-hover:border-white group-hover:bg-white/10 transition-all duration-300"
                      >
                        Смотреть <ArrowRight className="w-2.5 h-2.5" />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : !products || products.length === 0 ? (

            <div className="text-center py-32">
              <Package className="w-10 h-10 text-white/30 mx-auto mb-5" />
              <p className="text-sm uppercase tracking-widest text-white/40">
                Нет активных предзаказов
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-14 sm:gap-x-10 sm:gap-y-20">
              {[...products].reverse().map((product) => {
                const cardImages: string[] =
                  product.images && product.images.length > 0
                    ? product.images
                    : [product.thumbnailUrl || product.imageUrl || ""].filter(Boolean);
                const imageUrl = cardImages[0] || "";
                const status = product.preorderStatus || "collecting";
                const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.collecting;
                const isCancelled = status === "cancelled";
                const isLocked = status !== "collecting";

                const inCart = !!cartPreorderItems.find(i => i.productId === product.id);
                const productFixedPrice: number = (product as any).salePrice || 0;
                const discountPct = product.discountPercent;
                const hasDiscount = (productFixedPrice > 0 && productFixedPrice < product.price) || (!!discountPct && discountPct > 0);
                const salePrice = productFixedPrice > 0 && productFixedPrice < product.price
                  ? productFixedPrice
                  : (discountPct && discountPct > 0 ? Math.round(product.price * (1 - discountPct / 100)) : product.price);

                return (
                  <Link
                    key={product.id}
                    href={isLocked ? "#" : `/${product.slug || product.id}`}
                    data-testid={`card-preorder-${product.id}`}
                    className={`block ${isLocked ? "pointer-events-none cursor-default" : "group"}`}
                  >
                    {/* Image — свайп в сторону между фото товара */}
                    <div className={`relative aspect-[3/4] bg-zinc-800 overflow-hidden rounded-sm mb-3 ${isLocked ? "opacity-70" : ""}`}>
                      {cardImages.length > 0 ? (
                        <SwipeableCardImages images={cardImages} alt={product.name} isLocked={isLocked} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="w-10 h-10 text-white/20" />
                        </div>
                      )}

                      {/* Оверлей «Отменено» */}
                      {isCancelled && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <span className="text-xs uppercase tracking-widest text-white/60">Отменено</span>
                        </div>
                      )}

                      {/* Hover CTA */}
                      {!isLocked && (
                        <div className="absolute bottom-0 left-0 right-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 bg-white/90 backdrop-blur-sm text-zinc-900 text-xs font-semibold uppercase tracking-widest flex items-center justify-center gap-2 py-3">
                          Подробнее <ArrowRight className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="space-y-2.5">
                      <h3 className={`text-sm font-medium text-white leading-tight line-clamp-2 ${isLocked ? "" : "group-hover:text-primary transition-colors"}`}>
                        {product.name}
                      </h3>

                      {/* Цена */}
                      <div className="space-y-1 text-center mt-2">
                        {hasDiscount ? (
                          <>
                            <p className="text-[10px] font-medium text-white/60 uppercase tracking-wide">Предпродажная цена</p>
                            <p className="text-base font-bold text-white">{formatPrice(salePrice)}</p>
                            <p className="text-[10px] text-white/50">Цена после релиза — {formatPrice(product.price)}</p>
                          </>
                        ) : (
                          <span className="text-base font-bold text-white">{formatPrice(product.price)}</span>
                        )}
                        {salePrice >= 300000 && salePrice <= 3000000 && (
                          <div className="flex justify-center" onClick={(e) => e.preventDefault()}>
                            <DolyameWidget price={salePrice} productId={product.id} isDark={true} />
                          </div>
                        )}
                        {!isCancelled && (
                          <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full mx-auto ${
                            status === "collecting"
                              ? "bg-primary/15 text-primary"
                              : "bg-white/10 text-white/50"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === "collecting" ? "bg-primary" : "bg-white/30"}`} />
                            {cfg.label}
                          </span>
                        )}
                      </div>

                      {/* Кнопка «В предзаказ» — только при сборе заявок */}
                      {!isLocked && (
                        <div className="relative" onClick={e => e.preventDefault()}>
                          <button
                            className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all border ${
                              inCart
                                ? "bg-primary text-white border-primary hover:bg-primary/90"
                                : "bg-white text-zinc-900 border-white hover:bg-white/90"
                            }`}
                            onClick={(e) => openSizePopup(e, product)}
                            data-testid={`button-preorder-cart-${product.id}`}
                            aria-label="В корзину предзаказов"
                          >
                            {popupLoadingId === product.id ? (
                              <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin block" />
                            ) : inCart ? (
                              <>
                                <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
                                Оформить предзаказ
                              </>
                            ) : (
                              <>
                                <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
                                В предзаказ
                              </>
                            )}
                          </button>

                          {/* Size picker popup */}
                          {sizePopupId === product.id && (
                            <div
                              className="absolute bottom-full mb-2 left-0 right-0 z-30 bg-zinc-900 border border-white/15 rounded-xl shadow-xl p-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50 mb-2">Размер и количество</p>
                              <div className="flex flex-col gap-1.5">
                                {popupSizes.map((size) => {
                                  const stockLimit = popupSizeStock[size];
                                  const inCartQty = cartPreorderItems.find(i => i.productId === product.id)?.selectedSizes[size] || 0;
                                  const maxAllowed = stockLimit !== undefined ? stockLimit - inCartQty : 99;
                                  const qty = popupSizeQty[size] || 0;
                                  const isExhausted = maxAllowed <= 0;
                                  return (
                                    <div
                                      key={size}
                                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-colors ${
                                        isExhausted ? "opacity-40 border-white/15" : qty > 0 ? "border-primary bg-primary/5" : "border-white/15"
                                      }`}
                                    >
                                      <span className={`text-xs font-semibold ${isExhausted ? "line-through text-white/40" : qty > 0 ? "text-primary" : "text-white"}`}>
                                        {size}
                                        {isExhausted && <span className="text-[9px] ml-1 font-normal">нет</span>}
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPopupSizeQty(prev => { const n = Math.max(0, (prev[size] || 0) - 1); const u = { ...prev, [size]: n }; if (n === 0) delete u[size]; return u; }); }}
                                          disabled={qty === 0}
                                          className="w-5 h-5 flex items-center justify-center rounded-full text-sm leading-none text-white bg-white/15 disabled:opacity-20 hover:bg-white/25 transition-colors"
                                          data-testid={`qty-minus-${product.id}-${size}`}
                                        >−</button>
                                        <span className="w-4 text-center text-xs font-bold tabular-nums text-white">{qty}</span>
                                        <button
                                          type="button"
                                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (isExhausted || qty >= maxAllowed) return; setPopupSizeQty(prev => ({ ...prev, [size]: (prev[size] || 0) + 1 })); }}
                                          disabled={isExhausted || qty >= maxAllowed}
                                          className="w-5 h-5 flex items-center justify-center rounded-full text-sm leading-none text-white bg-white/15 disabled:opacity-20 hover:bg-white/25 transition-colors"
                                          data-testid={`qty-plus-${product.id}-${size}`}
                                        >+</button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              {(() => {
                                const totalQty = Object.values(popupSizeQty).reduce((s, q) => s + q, 0);
                                return (
                                  <button
                                    className={`mt-2.5 w-full py-2 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all ${
                                      totalQty > 0
                                        ? "bg-white text-zinc-900 hover:bg-white/90"
                                        : "bg-white/10 text-white/40 cursor-not-allowed"
                                    }`}
                                    disabled={totalQty === 0}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (totalQty === 0) return;
                                      addOrUpdateItem({
                                        productId: product.id,
                                        productName: product.name,
                                        price: salePrice,
                                        imageUrl,
                                        selectedSizes: { ...popupSizeQty },
                                      });
                                      setSizePopupId(null);
                                      setPopupSizeQty({});
                                      openPreorderCartDrawer();
                                    }}
                                    data-testid={`button-popup-confirm-${product.id}`}
                                  >
                                    {totalQty > 0 ? `В предзаказ · ${totalQty} шт.` : "Выберите количество"}
                                  </button>
                                );
                              })()}
                              <button
                                className="mt-1 w-full text-[10px] text-white/40 hover:text-white transition-colors"
                                onClick={() => { setSizePopupId(null); setPopupSizeQty({}); }}
                              >
                                Отмена
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Progress steps */}
                      {!isCancelled && (
                        <div className="flex gap-1">
                          {STEPS.map((step, idx) => {
                            const stepNum = idx + 1;
                            const active = stepNum === cfg.step;
                            const done = stepNum < cfg.step;
                            return (
                              <div key={step} className="flex-1 flex flex-col gap-1 min-w-0">
                                <div className={`h-0.5 w-full rounded-full transition-colors ${
                                  done ? "bg-white" : active ? "bg-primary" : "bg-white/20"
                                }`} />
                                <span className={`text-[9px] uppercase tracking-wide truncate text-white ${
                                  active ? "font-semibold" : "opacity-50"
                                }`}>
                                  {step}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Dates */}
                      {(product.preorderDeadline || product.preorderShippingDate) && (
                        <div className="text-[10px] text-white/60 space-y-0.5">
                          {product.preorderDeadline && (
                            <p>Сбор до {formatDate(product.preorderDeadline)}</p>
                          )}
                          {product.preorderShippingDate && (
                            <p>Отправка {formatDate(product.preorderShippingDate)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
