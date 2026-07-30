import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowRight, ArrowLeft, Package, ShoppingCart, AlertTriangle, Info, Megaphone, Flame } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";
import { PreorderSubscribeWidget } from "@/components/PreorderSubscribeWidget";
import { DolyameWidget } from "@/components/DolyameWidget";
import { usePreorderCartDrawer } from "@/components/PreorderCartDrawer";
import { usePreorderCart } from "@/context/PreorderCartContext";
import { useToast } from "@/hooks/use-toast";
import { useWholesalePrice } from "@/hooks/use-auth";

interface PreorderProduct {
  id: number;
  slug?: string;
  name: string;
  price: number;
  discountPercent?: number;
  wholesalePrice?: number | null;
  wholesaleDiscountPercent?: number | null;
  images?: string[];
  imageUrl?: string;
  thumbnailUrl?: string;
  preorderEnabled: boolean;
  preorderDeadline: string | null;
  preorderProductionDate: string | null;
  preorderShippingDate: string | null;
  preorderStatus: string | null;
  preorderGroup: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; step: number }> = {
  collecting:  { label: "Сбор заявок",   step: 1 },
  production:  { label: "Производство",  step: 2 },
  shipping:    { label: "Отправка",      step: 3 },
  shipped:     { label: "Отправлено",    step: 4 },
  cancelled:   { label: "Отменено",      step: 0 },
};

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatShortDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
}

function SwipeableCardImages({
  images,
  alt,
  isLocked,
  loading = "lazy",
}: {
  images: string[];
  alt: string;
  isLocked?: boolean;
  loading?: "lazy" | "eager";
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
    if (dragX <= -40) setIndex((i) => clampIndex(i + 1));
    else if (dragX >= 40) setIndex((i) => clampIndex(i - 1));
    setDragX(0);
  }
  function handleClickCapture(e: React.MouseEvent) {
    if (draggedRef.current) { e.preventDefault(); e.stopPropagation(); draggedRef.current = false; }
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
              loading={loading}
              draggable={false}
              className={`w-full h-full object-cover pointer-events-none ${isLocked ? "" : "transition-transform duration-500 group-hover:scale-105"}`}
            />
          </div>
        ))}
      </div>
      {count > 1 && (
        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1 pointer-events-none">
          {images.map((_, i) => (
            <span key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === index ? "bg-white" : "bg-white/40"}`} />
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

export default function ConceptCampaignPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || "";

  const { data: allProducts, isLoading } = useQuery<PreorderProduct[]>({
    queryKey: ["/api/preorder/products"],
  });

  // Фильтруем только товары этой кампании
  const products = allProducts?.filter((p) => p.preorderGroup === slug) ?? [];

  const { data: campaignSettings, isLoading: heroLoading } = useQuery<Record<string, any>>({
    queryKey: [`/api/page-settings/concept_campaign_${slug}`],
    enabled: !!slug,
  });

  const hero = campaignSettings?.hero || {};
  const heroBannerDesktop: string = hero.heroImage || "";
  const heroBannerMobile: string = hero.heroImageMobile || "";
  const heroBannerAlt: string = hero.heroImageAlt || hero.title || "Предзаказ";
  const pageTitle: string = hero.title || slug;
  const pageSubtitle: string = hero.subtitle || "";
  const campaignLogoUrl: string = hero.logoUrl || "";
  const seoTitle: string = hero.seoTitle || `${pageTitle} | Pre-drop BOOOMERANGS`;
  const seoDescription: string = hero.seoDescription || `Предзаказ ${pageTitle} — BOOOMERANGS`;

  const [heroImgLoaded, setHeroImgLoaded] = useState(false);
  const showHeroSkeleton = heroLoading || (!heroImgLoaded && !!(heroBannerDesktop || heroBannerMobile));

  const promoBanner = campaignSettings?.promo_banner || {};
  const bannerEnabled: boolean = !!promoBanner.enabled;
  const bannerStyle: string = promoBanner.style || "neutral";
  const bannerTitle: string = promoBanner.title || "";
  const bannerText: string = promoBanner.text || "";
  const bannerButtonText: string = promoBanner.buttonText || "";
  const bannerButtonUrl: string = promoBanner.buttonUrl || "";

  const { addOrUpdateItem, items: cartPreorderItems } = usePreorderCart();
  const { openDrawer: openPreorderCartDrawer } = usePreorderCartDrawer();
  const { toast } = useToast();
  const { isWholesale, getWholesalePrice } = useWholesalePrice();
  const [sizePopupId, setSizePopupId] = useState<number | null>(null);
  const [popupSizes, setPopupSizes] = useState<string[]>([]);
  const [popupSizeStock, setPopupSizeStock] = useState<Record<string, number>>({});
  const [popupSizeQty, setPopupSizeQty] = useState<Record<string, number>>({});
  const [popupLoadingId, setPopupLoadingId] = useState<number | null>(null);

  const SIZE_ORDER = ["XXS","XS","S","M","L","XL","XXL","XXXL","ONE SIZE","OS"];

  function getEffectivePrice(p: PreorderProduct): number {
    const wp = isWholesale ? getWholesalePrice(p.price, p.wholesalePrice ?? null, p.wholesaleDiscountPercent ?? null) : null;
    if (wp) return wp;
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
        addOrUpdateItem({ productId: product.id, productName: product.name, price: effectivePrice, imageUrl: product.images?.[0] || product.thumbnailUrl || product.imageUrl || "", selectedSizes: { [onlySize]: 1 } });
        openPreorderCartDrawer();
      } else {
        setPopupSizes(sorted);
        setPopupSizeQty({});
        setSizePopupId(product.id);
      }
    } catch {
      addOrUpdateItem({ productId: product.id, productName: product.name, price: effectivePrice, imageUrl: product.images?.[0] || product.thumbnailUrl || product.imageUrl || "", selectedSizes: { "ONE SIZE": 1 } });
      openPreorderCartDrawer();
    } finally {
      setPopupLoadingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="page-concept-campaign">
      <SEO title={seoTitle} description={seoDescription} keywords={`предзаказ, pre-drop, ${pageTitle}, BOOOMERANGS`} />

      {/* Hero banner — рендерим только если изображения точно есть.
          Пока данные грузятся (heroLoading) — ничего не показываем,
          чтобы избежать прыжка layout когда оказывается что картинок нет. */}
      {!heroLoading && (heroBannerDesktop || heroBannerMobile) ? (
        <section className={`bg-black relative overflow-hidden ${!heroImgLoaded ? "h-[52vw] max-h-[480px] min-h-[200px] sm:h-[34vw] sm:max-h-[560px]" : ""}`}>
          {!heroImgLoaded && <div className="absolute inset-0 bg-zinc-900 animate-pulse" />}
          <picture>
            {heroBannerDesktop && <source media="(min-width: 640px)" srcSet={heroBannerDesktop} />}
            <img
              src={heroBannerMobile || heroBannerDesktop}
              alt={heroBannerAlt}
              loading="eager"
              fetchpriority="high"
              onLoad={() => setHeroImgLoaded(true)}
              className={`w-full object-cover transition-opacity duration-300 ${heroImgLoaded ? "opacity-100" : "opacity-0"}`}
            />
          </picture>
          <Link
            href="/concept"
            className="absolute top-4 left-4 z-20 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm text-white px-3 py-2 rounded-full text-sm font-medium hover:bg-black/70 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Все предзаказы</span>
          </Link>
        </section>
      ) : (
        /* Нет изображений — показываем кнопку назад сразу, не ждём heroLoading */
        <div className="bg-black px-4 pt-4 pb-2">
          <Link
            href="/concept"
            className="inline-flex items-center gap-1.5 bg-white/10 text-white px-3 py-2 rounded-full text-sm font-medium hover:bg-white/20 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Все предзаказы</span>
          </Link>
        </div>
      )}

      {/* Виджет подписки */}
      <PreorderSubscribeWidget />

      {/* Волновой переход: чёрный → светлый */}
      <div style={{ background: "#000", lineHeight: 0, marginBottom: "-1px" }}>
        <svg viewBox="0 0 1440 72" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: "72px" }}>
          <path d="M0,72 C360,0 1080,72 1440,20 L1440,72 L0,72 Z" fill="#f2f2f2" />
        </svg>
      </div>

      {/* Promo banner */}
      {bannerEnabled && (bannerTitle || bannerText) && (() => {
        const styleMap: Record<string, { wrap: string; icon: string; iconBg: string; btn: string }> = {
          neutral:   { wrap: "bg-zinc-900 border-zinc-700/50",   icon: "text-white/80",  iconBg: "bg-white/10",     btn: "bg-white text-black hover:bg-white/90" },
          urgent:    { wrap: "bg-red-950/70 border-red-800/50",  icon: "text-red-400",   iconBg: "bg-red-500/20",   btn: "bg-red-500 text-white hover:bg-red-600" },
          info:      { wrap: "bg-blue-950/70 border-blue-800/50",icon: "text-blue-400",  iconBg: "bg-blue-500/20",  btn: "bg-blue-500 text-white hover:bg-blue-600" },
          highlight: { wrap: "bg-[#161a00] border-[#D7FF00]/25", icon: "text-[#D7FF00]", iconBg: "bg-[#D7FF00]/15", btn: "bg-[#D7FF00] text-black hover:bg-[#c8ef00]" },
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
                {bannerTitle && <p className="text-sm sm:text-base font-semibold text-white leading-snug">{bannerTitle}</p>}
                {bannerText && <p className="text-xs sm:text-sm text-white/65 mt-1 leading-relaxed">{bannerText}</p>}
              </div>
              {bannerButtonText && (
                bannerButtonUrl
                  ? <a href={bannerButtonUrl} className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-full transition-colors ${s.btn}`}>{bannerButtonText}<ArrowRight className="w-3.5 h-3.5" /></a>
                  : <span className={`shrink-0 text-xs font-semibold px-5 py-2 rounded-full ${s.btn}`}>{bannerButtonText}</span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Goods grid */}
      <section className="py-14 sm:py-20 relative overflow-hidden" style={{ background: "#f2f2f2" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.06) 1px, transparent 1px)", backgroundSize: "26px 26px" }} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <img src="/images/boomerangs-logo.webp" alt="" aria-hidden="true" loading="lazy" className="w-[90%] max-w-[1000px] opacity-[0.03]" draggable="false" />
        </div>

        <div className="px-4 sm:px-6 lg:px-12 relative z-10">
          {/* Заголовок кампании */}
          {(pageTitle || pageSubtitle || campaignLogoUrl) && (
            <div className="mb-10 sm:mb-14 text-center">
              {pageSubtitle && <p className="text-xs uppercase tracking-[0.25em] text-zinc-500 mb-2">{pageSubtitle}</p>}
              {campaignLogoUrl ? (
                <div className="flex items-center justify-center gap-4 sm:gap-14">
                  <img
                    src="/images/boomerangs-logo.webp"
                    alt="BOOOMERANGS"
                    loading="eager"
                    // @ts-ignore fetchpriority is valid on <img> but missing from current @types/react
                    fetchpriority="high"
                    className="h-[72px] sm:h-[160px] w-auto object-contain"
                    style={{ maxWidth: "clamp(120px, 38vw, 360px)" }}
                  />
                  <span className="select-none leading-none" style={{ fontSize: "clamp(32px, 6vw, 64px)", fontWeight: 100, color: "#E53935", letterSpacing: "-0.05em", lineHeight: 1 }}>×</span>
                  <img
                    src={campaignLogoUrl}
                    alt={pageTitle}
                    loading="eager"
                    // @ts-ignore fetchpriority is valid on <img> but missing from current @types/react
                    fetchpriority="high"
                    className="h-[72px] sm:h-[160px] w-auto object-contain"
                    style={{ maxWidth: "clamp(120px, 38vw, 360px)" }}
                  />
                </div>
              ) : (
                pageTitle && <h1 className="text-2xl sm:text-4xl font-bold uppercase tracking-tight text-zinc-900">{pageTitle}</h1>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-14 sm:gap-x-10 sm:gap-y-20">
              {Array.from({ length: 3 }).map((_, i) => <ProductSkeleton key={i} />)}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-32">
              <Package className="w-10 h-10 text-muted-foreground/40 mx-auto mb-5" />
              <p className="text-sm uppercase tracking-widest text-muted-foreground/50">Нет активных предзаказов</p>
              <Link href="/concept" className="inline-flex items-center gap-1.5 mt-6 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> Все предзаказы
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-14 sm:gap-x-10 sm:gap-y-20">
              {[...products].reverse().map((product, idx) => {
                const cardImages: string[] = product.images && product.images.length > 0
                  ? product.images
                  : [product.thumbnailUrl || product.imageUrl || ""].filter(Boolean);
                const status = product.preorderStatus || "collecting";
                const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.collecting;
                const isCancelled = status === "cancelled";
                const isLocked = status !== "collecting";
                const inCart = !!cartPreorderItems.find(i => i.productId === product.id);
                const productFixedPrice: number = (product as any).salePrice || 0;
                const discountPct = product.discountPercent;
                const wholesalePriceVal = isWholesale ? getWholesalePrice(product.price, product.wholesalePrice ?? null, product.wholesaleDiscountPercent ?? null) : null;
                const wholesaleBasePriceVal = (wholesalePriceVal && (product.wholesaleDiscountPercent ?? 0) > 0 && (product.wholesalePrice ?? 0) > 0)
                  ? product.wholesalePrice!
                  : null;
                const hasDiscount = !wholesalePriceVal && ((productFixedPrice > 0 && productFixedPrice < product.price) || (!!discountPct && discountPct > 0));
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
                    <div className={`relative aspect-[3/4] bg-zinc-200 overflow-hidden rounded-sm mb-3 ${isLocked ? "opacity-70" : ""}`}>
                      {cardImages.length > 0
                        ? <SwipeableCardImages images={cardImages} alt={product.name} isLocked={isLocked} loading={idx < 3 ? "eager" : "lazy"} />
                        : <div className="w-full h-full flex items-center justify-center"><Package className="w-10 h-10 text-white/20" /></div>
                      }
                      {isCancelled && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <span className="text-xs uppercase tracking-widest text-white/60">Отменено</span>
                        </div>
                      )}
                      {!isLocked && (
                        <div className="absolute bottom-0 left-0 right-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 bg-white/90 backdrop-blur-sm text-zinc-900 text-xs font-semibold uppercase tracking-widest flex items-center justify-center gap-2 py-3">
                          Подробнее <ArrowRight className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>

                    <div className="space-y-2.5">
                      <h3 className={`text-sm font-medium text-zinc-900 leading-tight line-clamp-2 ${isLocked ? "" : "group-hover:text-primary transition-colors"}`}>
                        {product.name}
                      </h3>
                      <div className="space-y-1 mt-2">
                        {wholesalePriceVal ? (
                          <div className="flex justify-between items-end w-full">
                            <div className="flex flex-col items-start">
                              <span className="text-[8px] text-red-500 font-medium uppercase tracking-wide leading-none mb-0.5">РРЦ</span>
                              <span className="text-[10px] line-through text-red-400">{formatPrice(product.price)}</span>
                            </div>
                            {wholesaleBasePriceVal && (
                              <div className="flex flex-col items-center">
                                <span className="text-[8px] text-yellow-500 font-medium uppercase tracking-wide leading-none mb-0.5">ОПТ</span>
                                <span className="text-[10px] line-through text-yellow-400">{formatPrice(wholesaleBasePriceVal)}</span>
                              </div>
                            )}
                            <div className="flex flex-col items-end">
                              <span className="text-[8px] text-green-500 font-medium uppercase tracking-wide leading-none mb-0.5">Предзаказ</span>
                              <span className="text-base font-bold text-zinc-900">{formatPrice(wholesalePriceVal)}</span>
                            </div>
                          </div>
                        ) : hasDiscount ? (
                          <>
                            <p className="text-[10px] font-medium text-zinc-900 uppercase tracking-wide">Предпродажная цена</p>
                            <p className="text-base font-bold text-zinc-900">{formatPrice(salePrice)}</p>
                            <p className="text-[10px] text-zinc-900">Цена после релиза — {formatPrice(product.price)}</p>
                          </>
                        ) : (
                          <span className="text-base font-bold text-zinc-900">{formatPrice(product.price)}</span>
                        )}
                        {!wholesalePriceVal && salePrice >= 300000 && salePrice <= 3000000 && (
                          <div className="flex justify-center" onClick={(e) => e.preventDefault()}>
                            <DolyameWidget price={salePrice} productId={product.id} isDark={false} />
                          </div>
                        )}
                        {!isCancelled && (
                          <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full mx-auto ${status === "collecting" ? "bg-green-100 text-green-700" : "bg-zinc-900/10 text-zinc-500"}`}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === "collecting" ? "bg-green-500" : "bg-zinc-400"}`} />
                            {cfg.label}
                          </span>
                        )}
                        {!isCancelled && (product.preorderDeadline || product.preorderProductionDate || product.preorderShippingDate) && (
                          <div className="flex justify-between w-full pt-1 border-t border-zinc-100 mt-1">
                            {product.preorderDeadline && (
                              <div className="flex flex-col items-start">
                                <span className="text-[7px] uppercase leading-none mb-0.5 text-zinc-500 font-semibold">Сбор до</span>
                                <span className="text-[10px] font-bold text-zinc-800">{formatShortDate(product.preorderDeadline)}</span>
                              </div>
                            )}
                            {product.preorderProductionDate && (
                              <div className="flex flex-col items-center">
                                <span className="text-[7px] uppercase leading-none mb-0.5 text-zinc-500 font-semibold">Произв.</span>
                                <span className="text-[10px] font-bold text-zinc-800">{formatShortDate(product.preorderProductionDate)}</span>
                              </div>
                            )}
                            {product.preorderShippingDate && (
                              <div className="flex flex-col items-end">
                                <span className="text-[7px] uppercase leading-none mb-0.5 text-zinc-500 font-semibold">Отправка</span>
                                <span className="text-[10px] font-bold text-zinc-800">{formatShortDate(product.preorderShippingDate)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {!isLocked && (
                        <div className="relative" onClick={e => e.preventDefault()}>
                          <button
                            className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all border ${inCart ? "bg-primary text-white border-primary hover:bg-primary/90" : "bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-700"}`}
                            onClick={(e) => openSizePopup(e, product)}
                            data-testid={`button-preorder-cart-${product.id}`}
                          >
                            {popupLoadingId === product.id
                              ? <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin block" />
                              : inCart
                                ? <><ShoppingCart className="w-3.5 h-3.5 shrink-0" />Оформить предзаказ</>
                                : <><ShoppingCart className="w-3.5 h-3.5 shrink-0" />В предзаказ</>
                            }
                          </button>

                          {sizePopupId === product.id && (
                            <div className="absolute bottom-full mb-2 left-0 right-0 z-30 bg-white border border-zinc-200 rounded-xl shadow-xl p-3" onClick={(e) => e.stopPropagation()}>
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-900 mb-2">Размер и количество</p>
                              <div className="flex flex-col gap-1.5">
                                {popupSizes.map((size) => {
                                  const stockLimit = popupSizeStock[size];
                                  const inCartQty = cartPreorderItems.find(i => i.productId === product.id)?.selectedSizes[size] || 0;
                                  const maxAllowed = stockLimit !== undefined ? stockLimit - inCartQty : 99;
                                  const qty = popupSizeQty[size] || 0;
                                  const isExhausted = maxAllowed <= 0;
                                  return (
                                    <div key={size} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-colors ${isExhausted ? "opacity-40 border-zinc-200" : qty > 0 ? "border-primary bg-primary/5" : "border-zinc-200"}`}>
                                      <span className={`text-xs font-semibold ${isExhausted ? "line-through text-zinc-300" : qty > 0 ? "text-primary" : "text-zinc-900"}`}>
                                        {size}{isExhausted && <span className="text-[9px] ml-1 font-normal">нет</span>}
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPopupSizeQty(prev => { const n = Math.max(0,(prev[size]||0)-1); const u={...prev,[size]:n}; if(n===0)delete u[size]; return u; }); }} disabled={qty===0} className="w-5 h-5 flex items-center justify-center rounded-full text-sm leading-none text-zinc-900 bg-zinc-100 disabled:opacity-20 hover:bg-zinc-200 transition-colors">−</button>
                                        <span className="w-4 text-center text-xs font-bold tabular-nums text-zinc-900">{qty}</span>
                                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); if(isExhausted||qty>=maxAllowed)return; setPopupSizeQty(prev=>({...prev,[size]:(prev[size]||0)+1})); }} disabled={isExhausted||qty>=maxAllowed} className="w-5 h-5 flex items-center justify-center rounded-full text-sm leading-none text-zinc-900 bg-zinc-100 disabled:opacity-20 hover:bg-zinc-200 transition-colors">+</button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              {(() => {
                                const totalQty = Object.values(popupSizeQty).reduce((s,q)=>s+q,0);
                                return (
                                  <button
                                    className={`mt-2.5 w-full py-2 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all ${totalQty>0 ? "bg-zinc-900 text-white hover:bg-zinc-700" : "bg-zinc-100 text-zinc-900 cursor-not-allowed"}`}
                                    disabled={totalQty===0}
                                    onClick={() => {
                                      if (totalQty===0) return;
                                      addOrUpdateItem({ productId: product.id, productName: product.name, price: getEffectivePrice(product), imageUrl: cardImages[0]||"", selectedSizes: {...popupSizeQty} });
                                      setSizePopupId(null);
                                      setPopupSizeQty({});
                                      openPreorderCartDrawer();
                                    }}
                                  >
                                    {totalQty>0 ? `В предзаказ · ${totalQty} шт.` : "Выберите количество"}
                                  </button>
                                );
                              })()}
                              <button className="mt-1.5 w-full text-[10px] text-zinc-900 hover:text-zinc-600 transition-colors" onClick={() => { setSizePopupId(null); setPopupSizeQty({}); }}>Отмена</button>
                            </div>
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

      <Navbar />
      <Footer />
    </div>
  );
}
