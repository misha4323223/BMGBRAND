import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Package, Bell, CheckCircle2, ShoppingCart, X, ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
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

function ProductSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[3/4] bg-muted rounded-sm mb-4" />
      <div className="h-4 bg-muted rounded w-3/4 mb-2" />
      <div className="h-4 bg-muted rounded w-1/3" />
    </div>
  );
}

export default function ConceptPage() {
  const { data: products, isLoading } = useQuery<PreorderProduct[]>({
    queryKey: ["/api/preorder/products"],
  });

  const { data: conceptSettings } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/concept"],
  });

  const heroBannerDesktop: string = conceptSettings?.hero?.heroImage || "";
  const heroBannerMobile: string = conceptSettings?.hero?.heroImageMobile || "";

  const [subEmail, setSubEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const { addOrUpdateItem, items: cartPreorderItems } = usePreorderCart();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [sizePopupId, setSizePopupId] = useState<number | null>(null);
  const [popupSizes, setPopupSizes] = useState<string[]>([]);
  const [popupLoadingId, setPopupLoadingId] = useState<number | null>(null);

  const SIZE_ORDER = ["XXS","XS","S","M","L","XL","XXL","XXXL","ONE SIZE","OS"];

  function getEffectivePrice(p: PreorderProduct): number {
    const d = p.discountPercent;
    return d && d > 0 ? Math.round(p.price * (1 - d / 100)) : p.price;
  }

  async function openSizePopup(e: React.MouseEvent, product: PreorderProduct) {
    e.preventDefault();
    e.stopPropagation();
    const already = cartPreorderItems.find(i => i.productId === product.id);
    if (already) {
      setLocation("/predrop/checkout");
      return;
    }
    setPopupLoadingId(product.id);
    const effectivePrice = getEffectivePrice(product);
    try {
      const res = await fetch(`/api/products/${product.id}`);
      const data = await res.json();
      const sizeStockData = data.sizeStock || {};
      const fromStock = Object.keys(sizeStockData).filter(k => (sizeStockData[k] ?? 0) > 0);
      const fromSizes: string[] = data.sizes || [];
      const all = Array.from(new Set([...fromSizes, ...fromStock]));
      const sorted = all.sort((a, b) => {
        const ia = SIZE_ORDER.indexOf(a), ib = SIZE_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1; if (ib === -1) return -1;
        return ia - ib;
      });
      if (sorted.length <= 1) {
        const onlySize = sorted[0] || "ONE SIZE";
        addOrUpdateItem({
          productId: product.id,
          productName: product.name,
          price: effectivePrice,
          imageUrl: product.images?.[0] || product.thumbnailUrl || product.imageUrl || "",
          selectedSizes: { [onlySize]: 1 },
        });
        toast({ title: "Добавлено в корзину предзаказов", description: product.name });
      } else {
        setPopupSizes(sorted);
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
      toast({ title: "Добавлено в корзину предзаказов", description: product.name });
    } finally {
      setPopupLoadingId(null);
    }
  }

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/preorder-subscribers/subscribe", { email: subEmail });
    },
    onSuccess: () => {
      setSubscribed(true);
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="page-concept">
      <SEO
        title="Pre-drop | BOOOMERANGS"
        description="Pre-drop BOOOMERANGS — поддержи создание новых моделей одежды с авторскими принтами. Голосуй рублём за то, что хочешь носить."
        keywords="предзаказ, pre-drop, российский бренд одежды с авторскими принтами, BOOOMERANGS"
      />
      {/* Hero banner с оверлеями */}
      <section className="bg-black relative overflow-hidden">
        {/* Desktop image */}
        {heroBannerDesktop && (
          <img
            src={heroBannerDesktop}
            alt="Предзаказ — твой доступ к будущим релизам"
            className="hidden sm:block w-full object-cover"
          />
        )}
        {/* Mobile image */}
        {heroBannerMobile && (
          <img
            src={heroBannerMobile}
            alt="Предзаказ — твой доступ к будущим релизам"
            className="block sm:hidden w-full object-cover"
          />
        )}

        {/* Кнопка «назад» — верхний левый угол */}
        <button
          onClick={() => window.history.length > 1 ? window.history.back() : window.location.href = '/'}
          className="absolute top-4 left-4 z-20 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm text-white px-2 py-2 sm:px-3 rounded-full text-sm font-medium hover:bg-black/70 transition-colors"
          data-testid="button-back-hero"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Назад</span>
        </button>

        {/* Форма подписки — левый нижний угол */}
        <div className="absolute bottom-0 left-0 right-0 sm:right-auto px-4 sm:px-6 pb-0 pt-4 sm:pt-6 sm:max-w-sm md:max-w-md z-10">
          <div className="bg-black/60 backdrop-blur-md rounded-xl p-4 sm:p-5">
            {subscribed ? (
              <div className="flex items-center gap-3" data-testid="preorder-subscribed-message">
                <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-white">Ты подписан!</p>
                  <p className="text-xs text-white/50 mt-0.5">Пришлём письмо при запуске нового предзаказа</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 shrink-0" style={{ color: "#D7FF00" }} />
                  <span className="text-sm font-semibold text-white tracking-tight">
                    Узнай первым о новом предзаказе
                  </span>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="Твой email"
                    value={subEmail}
                    onChange={e => setSubEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && subEmail && agreed && subscribeMutation.mutate()}
                    className="bg-white/10 border-white/15 text-white placeholder:text-white/30 focus-visible:ring-0 h-9 text-sm"
                    style={{ borderColor: "rgba(200,241,58,0.3)" }}
                    data-testid="input-preorder-email"
                  />
                  <Button
                    size="sm"
                    onClick={() => subscribeMutation.mutate()}
                    disabled={!subEmail || !agreed || subscribeMutation.isPending}
                    className="shrink-0 h-9 px-4 text-xs font-semibold text-black hover:opacity-90"
                    style={{ backgroundColor: "#D7FF00" }}
                    data-testid="button-preorder-subscribe"
                  >
                    {subscribeMutation.isPending ? "..." : "Подписаться"}
                  </Button>
                </div>
                <label className="flex items-start gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={e => setAgreed(e.target.checked)}
                    className="mt-0.5 shrink-0" style={{ accentColor: "#D7FF00" }}
                    data-testid="checkbox-preorder-agree"
                  />
                  <span className="text-[11px] text-white/40 group-hover:text-white/60 transition-colors leading-relaxed">
                    Соглашаюсь получать уведомления о новых предзаказах. Отписаться можно в любой момент в личном кабинете.
                  </span>
                </label>
                {subscribeMutation.isError && (
                  <p className="text-red-400 text-xs">Ошибка. Попробуй ещё раз.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Products */}
      <section className="py-14 sm:py-20 relative overflow-hidden">
        {/* Watermark logo */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <img
            src="/images/boomerangs-logo.webp"
            alt=""
            className="w-[90%] max-w-[1000px] opacity-[0.04]"
            draggable="false"
          />
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8">
              {Array.from({ length: 3 }).map((_, i) => (
                <ProductSkeleton key={i} />
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
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8">
              {products.map((product) => {
                const imageUrl =
                  product.images && product.images.length > 0
                    ? product.images[0]
                    : product.thumbnailUrl || product.imageUrl || "";
                const status = product.preorderStatus || "collecting";
                const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.collecting;
                const isCancelled = status === "cancelled";
                const isLocked = status !== "collecting";

                const inCart = !!cartPreorderItems.find(i => i.productId === product.id);
                const discountPct = product.discountPercent;
                const hasDiscount = !!discountPct && discountPct > 0;
                const salePrice = hasDiscount ? Math.round(product.price * (1 - discountPct / 100)) : product.price;

                return (
                  <Link
                    key={product.id}
                    href={isLocked ? "#" : `/${product.slug || product.id}`}
                    data-testid={`card-preorder-${product.id}`}
                    className={`block ${isLocked ? "pointer-events-none cursor-default" : "group"}`}
                  >
                    {/* Image — чистое, без оверлеев */}
                    <div className={`relative aspect-[3/4] bg-muted overflow-hidden rounded-sm mb-3 ${isLocked ? "opacity-70" : ""}`}>
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={product.name}
                          loading="lazy"
                          className={`w-full h-full object-cover ${isLocked ? "" : "transition-transform duration-500 group-hover:scale-105"}`}
                        />
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
                      <div className="space-y-1">
                        {hasDiscount ? (
                          <>
                            <p className="text-[10px] font-medium text-foreground uppercase tracking-wide">Предпродажная цена</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-base font-bold text-foreground">{formatPrice(salePrice)}</span>
                              <span className="text-[13px] font-semibold line-through text-red-400">{formatPrice(product.price)}</span>
                            </div>
                            <p className="text-[10px] text-foreground">Цена после релиза — {formatPrice(product.price)}</p>
                          </>
                        ) : (
                          <span className="text-base font-bold text-foreground">{formatPrice(product.price)}</span>
                        )}
                        {!isCancelled && (
                          <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full ${
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
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Выберите размер</p>
                              <div className="flex flex-wrap gap-1.5">
                                {popupSizes.map((size) => (
                                  <button
                                    key={size}
                                    className="px-2.5 py-1.5 text-xs font-medium border rounded-lg hover:border-primary hover:text-primary transition-colors"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      addOrUpdateItem({
                                        productId: product.id,
                                        productName: product.name,
                                        price: salePrice,
                                        imageUrl,
                                        selectedSizes: { [size]: 1 },
                                      });
                                      setSizePopupId(null);
                                      toast({ title: "Добавлено в корзину предзаказов", description: `${product.name} — ${size}` });
                                    }}
                                    data-testid={`size-option-${product.id}-${size}`}
                                  >
                                    {size}
                                  </button>
                                ))}
                              </div>
                              <button
                                className="mt-2 w-full text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                onClick={() => setSizePopupId(null)}
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
