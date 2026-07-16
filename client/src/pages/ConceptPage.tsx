import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Package, ShoppingCart, ArrowLeft, AlertTriangle, Info, Megaphone, Flame } from "lucide-react";
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
  productCount: number;
  activeProductCount: number;
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

  const heroBannerDesktop: string = conceptSettings?.hero?.heroImage || "";
  const heroBannerMobile: string = conceptSettings?.hero?.heroImageMobile || "";
  const heroBannerAlt: string = conceptSettings?.hero?.heroImageAlt || "Предзаказ — твой доступ к будущим релизам";
  const [heroImgLoaded, setHeroImgLoaded] = useState(false);
  // Пока идёт запрос настроек ИЛИ картинка баннера ещё не отрисовалась — держим скелет,
  // чтобы баннер не «выпрыгивал» и не сдвигал контент после открытия страницы.
  const showHeroSkeleton = heroLoading || (!heroImgLoaded && !!(heroBannerDesktop || heroBannerMobile));

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
  const { toast } = useToast();
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
    <div className="min-h-screen bg-background text-foreground" data-testid="page-concept">
      <SEO
        title={conceptSeo.title || "Pre-drop | BOOOMERANGS"}
        description={conceptSeo.description || "Pre-drop BOOOMERANGS — поддержи создание новых моделей одежды с авторскими принтами. Голосуй рублём за то, что хочешь носить."}
        keywords="предзаказ, pre-drop, российский бренд одежды с авторскими принтами, BOOOMERANGS"
      />
      {/* Hero banner — резервируем место сразу и держим скелет, пока картинка не отрисуется,
          чтобы баннер не «выпрыгивал» и не сдвигал контент после открытия страницы */}
      <section
        className={`bg-black relative overflow-hidden ${
          showHeroSkeleton ? "h-[52vw] max-h-[480px] min-h-[200px] sm:h-[34vw] sm:max-h-[560px]" : ""
        }`}
      >
        {showHeroSkeleton && (
          <div className="absolute inset-0 bg-zinc-900 animate-pulse" />
        )}

        {/* Desktop image */}
        {!heroLoading && heroBannerDesktop && (
          <img
            src={heroBannerDesktop}
            alt={heroBannerAlt}
            loading="eager"
            // @ts-ignore fetchpriority is valid on <img> but missing from current @types/react
            fetchpriority="high"
            onLoad={() => setHeroImgLoaded(true)}
            className={`hidden sm:block w-full object-cover transition-opacity duration-300 ${
              heroImgLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
        {/* Mobile image */}
        {!heroLoading && heroBannerMobile && (
          <img
            src={heroBannerMobile}
            alt={heroBannerAlt}
            loading="eager"
            // @ts-ignore fetchpriority is valid on <img> but missing from current @types/react
            fetchpriority="high"
            onLoad={() => setHeroImgLoaded(true)}
            className={`block sm:hidden w-full object-cover transition-opacity duration-300 ${
              heroImgLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}

        {/* Кнопка «назад» — верхний левый угол, видна всегда независимо от баннера */}
        <button
          onClick={() => window.history.length > 1 ? window.history.back() : window.location.href = '/'}
          className="absolute top-4 left-4 z-20 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm text-white px-2 py-2 sm:px-3 rounded-full text-sm font-medium hover:bg-black/70 transition-colors"
          data-testid="button-back-hero"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Назад</span>
        </button>
      </section>

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
        className="py-14 sm:py-20 relative overflow-hidden"
        style={{ background: "#F2F2F2" }}
      >
        {/* Отголосок космических свечений из секции подписки */}
        <div
          className="absolute -top-20 -left-20 w-[45vw] h-[45vw] max-w-[460px] max-h-[460px] rounded-full opacity-[0.07] blur-[110px] pointer-events-none"
          style={{ background: "radial-gradient(circle, #E53935 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-24 -right-16 w-[40vw] h-[40vw] max-w-[420px] max-h-[420px] rounded-full opacity-[0.06] blur-[110px] pointer-events-none"
          style={{ background: "radial-gradient(circle, #7C4DFF 0%, transparent 70%)" }}
        />

        {/* Едва заметная звёздная пыль */}
        <div
          className="absolute inset-0 opacity-[0.5] pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(30,25,20,0.05) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        />

        {/* Watermark logo */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <img
            src="/images/boomerangs-logo.webp"
            alt=""
            className="w-[90%] max-w-[1000px] opacity-[0.04]"
            draggable="false"
          />
        </div>

        <div className="px-4 sm:px-6 lg:px-12 relative z-10">
          {(isLoading || campaignsLoading) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-14 sm:gap-x-10 sm:gap-y-20">
              {Array.from({ length: 3 }).map((_, i) => (
                <ProductSkeleton key={i} />
              ))}
            </div>
          ) : hasCampaigns ? (
            /* ── Список коллабораций ── */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {campaigns!.map((c) => (
                <Link
                  key={c.slug}
                  href={`/concept/${c.slug}`}
                  className="group relative block overflow-hidden rounded-xl bg-zinc-900 aspect-[4/5]"
                  data-testid={`card-campaign-${c.slug}`}
                >
                  {c.coverImage ? (
                    <img
                      src={c.coverImage}
                      alt={c.title}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-zinc-800">
                      <Package className="w-12 h-12 text-zinc-600" />
                    </div>
                  )}
                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                  {/* Badge */}
                  <div className="absolute top-4 left-4">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono tracking-[0.2em] uppercase px-3 py-1.5 rounded-full text-white/90" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(4px)" }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                      {c.activeProductCount > 0 ? "Сбор заявок" : "Предзаказ"}
                    </span>
                  </div>
                  {/* Info */}
                  <div className="absolute bottom-0 left-0 right-0 p-5">
                    {c.subtitle && <p className="text-[10px] uppercase tracking-[0.2em] text-white/50 mb-1">{c.subtitle}</p>}
                    <h3 className="text-xl sm:text-2xl font-bold uppercase tracking-tight text-white leading-tight">{c.title}</h3>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-white/50">{c.productCount} {c.productCount === 1 ? "товар" : c.productCount < 5 ? "товара" : "товаров"}</span>
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white group-hover:gap-2.5 transition-all">
                        Смотреть <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : !products || products.length === 0 ? (
            <div className="text-center py-32">
              <Package className="w-10 h-10 text-muted-foreground/40 mx-auto mb-5" />
              <p className="text-sm uppercase tracking-widest text-muted-foreground/50">
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
                    <div className={`relative aspect-[3/4] bg-muted overflow-hidden rounded-sm mb-3 ${isLocked ? "opacity-70" : ""}`}>
                      {cardImages.length > 0 ? (
                        <SwipeableCardImages images={cardImages} alt={product.name} isLocked={isLocked} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="w-10 h-10 text-muted-foreground/30" />
                        </div>
                      )}

                      {/* Оверлей «Отменено» */}
                      {isCancelled && (
                        <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                          <span className="text-xs uppercase tracking-widest text-foreground/60">Отменено</span>
                        </div>
                      )}

                      {/* Hover CTA */}
                      {!isLocked && (
                        <div className="absolute bottom-0 left-0 right-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 bg-foreground/90 backdrop-blur-sm text-background text-xs font-semibold uppercase tracking-widest flex items-center justify-center gap-2 py-3">
                          Подробнее <ArrowRight className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="space-y-2.5">
                      <h3 className={`text-sm font-medium text-foreground leading-tight line-clamp-2 ${isLocked ? "" : "group-hover:text-primary transition-colors"}`}>
                        {product.name}
                      </h3>

                      {/* Цена */}
                      <div className="space-y-1 text-center mt-2">
                        {hasDiscount ? (
                          <>
                            <p className="text-[10px] font-medium text-foreground uppercase tracking-wide">Предпродажная цена</p>
                            <p className="text-base font-bold text-foreground">{formatPrice(salePrice)}</p>
                            <p className="text-[10px] text-foreground">Цена после релиза — {formatPrice(product.price)}</p>
                          </>
                        ) : (
                          <span className="text-base font-bold text-foreground">{formatPrice(product.price)}</span>
                        )}
                        {salePrice >= 300000 && salePrice <= 3000000 && (
                          <div className="flex justify-center" onClick={(e) => e.preventDefault()}>
                            <DolyameWidget price={salePrice} productId={product.id} />
                          </div>
                        )}
                        {!isCancelled && (
                          <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full mx-auto ${
                            status === "collecting"
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === "collecting" ? "bg-primary" : "bg-muted-foreground/50"}`} />
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
                                : "bg-foreground text-background border-foreground hover:bg-foreground/85"
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
                              className="absolute bottom-full mb-2 left-0 right-0 z-30 bg-background border border-border rounded-xl shadow-xl p-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Размер и количество</p>
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
                                        isExhausted ? "opacity-40 border-border" : qty > 0 ? "border-primary bg-primary/5" : "border-border"
                                      }`}
                                    >
                                      <span className={`text-xs font-semibold ${isExhausted ? "line-through text-muted-foreground" : qty > 0 ? "text-primary" : ""}`}>
                                        {size}
                                        {isExhausted && <span className="text-[9px] ml-1 font-normal">нет</span>}
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPopupSizeQty(prev => { const n = Math.max(0, (prev[size] || 0) - 1); const u = { ...prev, [size]: n }; if (n === 0) delete u[size]; return u; }); }}
                                          disabled={qty === 0}
                                          className="w-5 h-5 flex items-center justify-center rounded-full text-sm leading-none bg-muted disabled:opacity-20 hover:bg-muted/70 transition-colors"
                                          data-testid={`qty-minus-${product.id}-${size}`}
                                        >−</button>
                                        <span className="w-4 text-center text-xs font-bold tabular-nums">{qty}</span>
                                        <button
                                          type="button"
                                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (isExhausted || qty >= maxAllowed) return; setPopupSizeQty(prev => ({ ...prev, [size]: (prev[size] || 0) + 1 })); }}
                                          disabled={isExhausted || qty >= maxAllowed}
                                          className="w-5 h-5 flex items-center justify-center rounded-full text-sm leading-none bg-muted disabled:opacity-20 hover:bg-muted/70 transition-colors"
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
                                        ? "bg-foreground text-background hover:bg-foreground/85"
                                        : "bg-muted text-muted-foreground cursor-not-allowed"
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
                                className="mt-1 w-full text-[10px] text-muted-foreground hover:text-foreground transition-colors"
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
                                  done ? "bg-foreground" : active ? "bg-primary" : "bg-muted-foreground/20"
                                }`} />
                                <span className={`text-[9px] uppercase tracking-wide truncate text-foreground ${
                                  active ? "font-semibold" : "opacity-70"
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
                        <div className="text-[10px] text-foreground space-y-0.5">
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
