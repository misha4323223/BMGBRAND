import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Package, ShoppingCart } from "lucide-react";
import { usePreorderCart } from "@/context/PreorderCartContext";
import { usePreorderCartDrawer } from "@/components/PreorderCartDrawer";
import { useToast } from "@/hooks/use-toast";

export interface FeaturedDropProduct {
  id: number;
  slug?: string;
  name: string;
  price: number;
  discountPercent?: number;
  salePrice?: number;
  images?: string[];
  imageUrl?: string;
  thumbnailUrl?: string;
  preorderStatus?: string | null;
  preorderDeadline?: string | null;
  preorderGoal?: number;
  preorderCurrent?: number;
}

interface FeaturedDropSectionProps {
  product: FeaturedDropProduct;
  title?: string;
  subtitle?: string;
  ctaText?: string;
  terminalLabel?: string;
}

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "ONE SIZE", "OS"];

const STATUS_LABEL: Record<string, string> = {
  collecting: "СБОР_ЗАКАЗОВ",
  production: "В_ПРОИЗВОДСТВЕ",
  shipping: "ОТПРАВКА",
  shipped: "ОТПРАВЛЕНО",
  cancelled: "ОТМЕНЕНО",
};

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function getCountdown(deadline: string | null | undefined) {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0, expired: true };
  const d = Math.floor(diff / (1000 * 60 * 60 * 24));
  const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const m = Math.floor((diff / (1000 * 60)) % 60);
  const s = Math.floor((diff / 1000) % 60);
  return { d, h, m, s, expired: false };
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function getOptimizedImageUrl(url: string): string {
  if (!url) return url;
  if (url.includes('_thumb.webp')) return url;
  if (
    url.includes('storage.yandexcloud.net/bmg/products/') ||
    url.includes('storage.yandexcloud.net/bmg/site/')
  ) {
    const thumbUrl = url.replace(/\.(webp|jpg|jpeg|png)(\?.*)?$/i, '_thumb.webp$2');
    if (thumbUrl !== url) return thumbUrl;
  }
  return url;
}

export function FeaturedDropSection({ product, title, subtitle, ctaText, terminalLabel }: FeaturedDropSectionProps) {
  const { addOrUpdateItem, items: cartPreorderItems } = usePreorderCart();
  const { openDrawer: openPreorderCartDrawer } = usePreorderCartDrawer();
  const { toast } = useToast();

  const [now, setNow] = useState(() => Date.now());
  const [sizesOpen, setSizesOpen] = useState(false);
  const [popupSizes, setPopupSizes] = useState<string[]>([]);
  const [popupSizeStock, setPopupSizeStock] = useState<Record<string, number>>({});
  const [popupSizeQty, setPopupSizeQty] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const countdown = useMemo(() => getCountdown(product.preorderDeadline), [product.preorderDeadline, now]);

  const status = product.preorderStatus || "collecting";
  const isCollecting = status === "collecting";
  const statusCode = STATUS_LABEL[status] || STATUS_LABEL.collecting;

  const goal = product.preorderGoal || 0;
  const current = product.preorderCurrent || 0;
  const progressPct = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : null;

  const effectivePrice = useMemo(() => {
    const sp = product.salePrice;
    if (sp && sp > 0 && sp < product.price) return sp;
    const d = product.discountPercent;
    return d && d > 0 ? Math.round(product.price * (1 - d / 100)) : product.price;
  }, [product]);
  const hasDiscount = effectivePrice < product.price;

  const imageUrl = product.images?.[0] || product.thumbnailUrl || product.imageUrl || "";
  const productHref = `/${product.slug || product.id}`;

  async function handleReserveClick(e: React.MouseEvent) {
    e.preventDefault();
    if (!isCollecting) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${product.id}`);
      const data = await res.json();
      const sizeStockData: Record<string, number> = data.sizeStock || {};
      const fromStock = Object.keys(sizeStockData).filter((k) => (sizeStockData[k] ?? 0) > 0);
      const fromSizes: string[] = data.sizes || [];
      const all = Array.from(new Set([...fromSizes, ...fromStock]));
      const sorted = all.sort((a, b) => {
        const ia = SIZE_ORDER.indexOf(a);
        const ib = SIZE_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
      setPopupSizeStock(sizeStockData);

      if (sorted.length <= 1) {
        const onlySize = sorted[0] || "ONE SIZE";
        const stockLimit = sizeStockData[onlySize];
        const alreadyInCart = cartPreorderItems.find((i) => i.productId === product.id)?.selectedSizes[onlySize] || 0;
        if (stockLimit !== undefined && alreadyInCart + 1 > stockLimit) {
          toast({ title: "Нет в наличии", description: `Доступно ${stockLimit} шт., в корзине уже ${alreadyInCart}`, variant: "destructive" });
          return;
        }
        addOrUpdateItem({
          productId: product.id,
          productName: product.name,
          price: effectivePrice,
          imageUrl,
          selectedSizes: { [onlySize]: 1 },
        });
        openPreorderCartDrawer();
      } else {
        setPopupSizes(sorted);
        setPopupSizeQty({});
        setSizesOpen(true);
      }
    } catch {
      addOrUpdateItem({
        productId: product.id,
        productName: product.name,
        price: effectivePrice,
        imageUrl,
        selectedSizes: { "ONE SIZE": 1 },
      });
      openPreorderCartDrawer();
    } finally {
      setLoading(false);
    }
  }

  const totalPopupQty = Object.values(popupSizeQty).reduce((s, q) => s + q, 0);

  return (
    <section id="featured-drop" className="section-lazy relative bg-black overflow-hidden" data-testid="section-featured-drop">
      <div className="flex flex-col lg:flex-row lg:min-h-[680px]">
        {/* ── Левая часть: капсула ── */}
        <Link
          href={productHref}
          data-testid="link-featured-drop-image"
          className="group relative block w-full lg:w-1/2 h-[560px] sm:h-[640px] lg:h-auto overflow-hidden bg-zinc-950"
        >
          {imageUrl ? (
            <img
              src={getOptimizedImageUrl(imageUrl)}
              alt={product.name}
              loading="eager"
              decoding="async"
              fetchpriority="high"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Package className="w-14 h-14 text-white/20" />
            </div>
          )}

          {/* Затемнение по краям для читаемости рамки */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40 pointer-events-none" />

          {/* Скан-линия */}
          <div
            className="fd-scan-line absolute left-0 right-0 h-[2px] pointer-events-none"
            style={{
              background: "linear-gradient(90deg, transparent 0%, rgba(255,45,45,0.9) 50%, transparent 100%)",
              boxShadow: "0 0 12px 2px rgba(255,45,45,0.6)",
            }}
          />
          {/* Едва заметная сетка поверх фото — техно-стекло */}
          <div
            className="absolute inset-0 opacity-[0.06] pointer-events-none mix-blend-screen"
            style={{
              backgroundImage: "linear-gradient(rgba(0,229,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.6) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />

          {/* Засечки-уголки как у прицела */}
          {[
            "top-4 left-4 border-t-2 border-l-2",
            "top-4 right-4 border-t-2 border-r-2",
            "bottom-4 left-4 border-b-2 border-l-2",
            "bottom-4 right-4 border-b-2 border-r-2",
          ].map((cls, i) => (
            <span
              key={i}
              className={`fd-bracket absolute w-6 h-6 sm:w-8 sm:h-8 ${cls} pointer-events-none`}
              style={{ borderColor: "rgba(255,45,45,0.85)" }}
            />
          ))}

          {/* Верхний левый бейдж */}
          <div className="absolute top-6 left-6 sm:top-8 sm:left-8 z-10">
            <span
              className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] font-mono tracking-[0.3em] uppercase px-3 py-1.5 rounded-full text-white/90"
              style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(0,229,255,0.4)", backdropFilter: "blur(4px)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#00E5FF" }} />
              ПРЕДПРОДАЖА
            </span>
          </div>
        </Link>

        {/* ── Правая часть: терминал ── */}
        <div className="relative w-full lg:w-1/2 bg-zinc-950 text-white flex flex-col justify-center px-6 py-12 sm:px-12 sm:py-16 lg:px-16 font-mono overflow-hidden">
          {/* Фоновая звёздная пыль */}
          <div
            className="absolute inset-0 opacity-[0.35] pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(circle, rgba(0,229,255,0.35) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
          <div
            className="absolute -top-24 -right-24 w-[50vw] h-[50vw] max-w-[420px] max-h-[420px] rounded-full opacity-[0.10] blur-[110px] pointer-events-none"
            style={{ background: "radial-gradient(circle, #00E5FF 0%, transparent 70%)" }}
          />

          <div className="relative z-10 max-w-xl">
            {/* Терминал-шапка */}
            <div className="flex items-center gap-1.5 mb-6 opacity-70">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
              <span className="ml-3 text-[10px] tracking-[0.15em] text-white/40 uppercase truncate">
                {terminalLabel || "booomerangs://терминал_предзаказа"}
              </span>
            </div>

            {/* Статус-строка */}
            <div className="flex items-center gap-2 text-[11px] sm:text-xs tracking-[0.25em] uppercase mb-5" style={{ color: "#FF2D2D" }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#FF2D2D" }} />
              <span>&gt; СТАТУС: {statusCode}</span>
              <span className="fd-cursor inline-block w-[7px] h-[14px] ml-0.5" style={{ background: "#FF2D2D" }} />
            </div>

            <p className="text-[11px] font-mono tracking-[0.3em] uppercase text-white/40 mb-2">
              {subtitle || "Из pre-drop"}
            </p>
            <h2
              style={{ fontFamily: "'Oswald', sans-serif" }}
              className="text-3xl sm:text-5xl font-bold uppercase tracking-tight leading-[0.95] mb-5"
            >
              {title || product.name}
            </h2>

            <div className="flex items-baseline gap-3 mb-8">
              {hasDiscount ? (
                <>
                  <span className="text-2xl sm:text-3xl font-bold text-white">{formatPrice(effectivePrice)}</span>
                  <span className="text-sm text-white/40 line-through">{formatPrice(product.price)}</span>
                </>
              ) : (
                <span className="text-2xl sm:text-3xl font-bold text-white">{formatPrice(product.price)}</span>
              )}
            </div>

            {/* Countdown */}
            {countdown && !countdown.expired && isCollecting && (
              <div className="mb-8">
                <p className="text-[10px] tracking-[0.25em] uppercase text-white/40 mb-2">До закрытия сбора заявок</p>
                <div className="flex gap-2 sm:gap-3">
                  {[
                    { v: countdown.d, l: "ДН" },
                    { v: countdown.h, l: "Ч" },
                    { v: countdown.m, l: "МИН" },
                    { v: countdown.s, l: "СЕК" },
                  ].map((box, i) => (
                    <div
                      key={i}
                      className="flex flex-col items-center justify-center rounded-lg px-3 py-2 sm:px-4 sm:py-3 min-w-[56px] sm:min-w-[68px]"
                      style={{ background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.25)" }}
                      data-testid={`countdown-box-${i}`}
                    >
                      <span className="text-xl sm:text-2xl font-bold tabular-nums leading-none">{pad(box.v)}</span>
                      <span className="text-[9px] tracking-[0.15em] text-white/40 mt-1">{box.l}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Progress bar */}
            {progressPct !== null && (
              <div className="mb-8">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-[10px] tracking-[0.25em] uppercase text-white/40">Собрано заявок</p>
                  <p className="text-xs font-bold tabular-nums" style={{ color: "#00E5FF" }}>
                    {current} / {goal} · {progressPct}%
                  </p>
                </div>
                <div className="relative h-2.5 rounded-full overflow-hidden bg-white/10">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${progressPct}%`,
                      background: "linear-gradient(90deg, #00E5FF, #7C4DFF)",
                      boxShadow: "0 0 10px rgba(0,229,255,0.6)",
                    }}
                  />
                  {progressPct > 0 && progressPct < 100 && (
                    <div
                      className="fd-progress-shimmer absolute inset-y-0 w-1/4"
                      style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)" }}
                    />
                  )}
                </div>
              </div>
            )}

            {/* CTA */}
            {isCollecting ? (
              <div className="relative">
                <button
                  onClick={handleReserveClick}
                  disabled={loading}
                  data-testid="button-featured-drop-reserve"
                  className="fd-cta-glow w-full flex items-center justify-center gap-3 py-4 sm:py-5 rounded-xl text-sm sm:text-base font-bold uppercase tracking-[0.1em] bg-white text-black hover:bg-white/90 transition-colors disabled:opacity-60"
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  ) : (
                    <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                  {ctaText || "Забронировать место в партии"}
                </button>

                {sizesOpen && (
                  <div
                    className="absolute bottom-full mb-3 left-0 right-0 z-30 bg-white text-black rounded-xl shadow-2xl p-4"
                    data-testid="popup-featured-drop-sizes"
                  >
                    <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-black/50 mb-3">
                      Размер и количество
                    </p>
                    <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
                      {popupSizes.map((size) => {
                        const stockLimit = popupSizeStock[size];
                        const inCartQty = cartPreorderItems.find((i) => i.productId === product.id)?.selectedSizes[size] || 0;
                        const maxAllowed = stockLimit !== undefined ? stockLimit - inCartQty : 99;
                        const qty = popupSizeQty[size] || 0;
                        const isExhausted = maxAllowed <= 0;
                        return (
                          <div
                            key={size}
                            className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-colors ${
                              isExhausted ? "opacity-40 border-black/10" : qty > 0 ? "border-black bg-black/5" : "border-black/10"
                            }`}
                          >
                            <span className={`text-xs font-semibold ${isExhausted ? "line-through text-black/40" : ""}`}>
                              {size}
                              {isExhausted && <span className="text-[9px] ml-1 font-normal">нет</span>}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setPopupSizeQty((prev) => {
                                    const n = Math.max(0, (prev[size] || 0) - 1);
                                    const u = { ...prev, [size]: n };
                                    if (n === 0) delete u[size];
                                    return u;
                                  })
                                }
                                disabled={qty === 0}
                                className="w-6 h-6 flex items-center justify-center rounded-full text-sm leading-none bg-black/10 disabled:opacity-20 hover:bg-black/20 transition-colors"
                                data-testid={`fd-qty-minus-${size}`}
                              >
                                −
                              </button>
                              <span className="w-5 text-center text-xs font-bold tabular-nums">{qty}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (isExhausted || qty >= maxAllowed) return;
                                  setPopupSizeQty((prev) => ({ ...prev, [size]: (prev[size] || 0) + 1 }));
                                }}
                                disabled={isExhausted || qty >= maxAllowed}
                                className="w-6 h-6 flex items-center justify-center rounded-full text-sm leading-none bg-black/10 disabled:opacity-20 hover:bg-black/20 transition-colors"
                                data-testid={`fd-qty-plus-${size}`}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      className={`mt-3 w-full py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all ${
                        totalPopupQty > 0 ? "bg-black text-white hover:bg-black/85" : "bg-black/10 text-black/40 cursor-not-allowed"
                      }`}
                      disabled={totalPopupQty === 0}
                      onClick={() => {
                        if (totalPopupQty === 0) return;
                        addOrUpdateItem({
                          productId: product.id,
                          productName: product.name,
                          price: effectivePrice,
                          imageUrl,
                          selectedSizes: { ...popupSizeQty },
                        });
                        setSizesOpen(false);
                        setPopupSizeQty({});
                        openPreorderCartDrawer();
                      }}
                      data-testid="button-featured-drop-confirm"
                    >
                      {totalPopupQty > 0 ? `В предзаказ · ${totalPopupQty} шт.` : "Выберите количество"}
                    </button>
                    <button
                      className="mt-2 w-full text-[10px] text-black/40 hover:text-black transition-colors"
                      onClick={() => { setSizesOpen(false); setPopupSizeQty({}); }}
                    >
                      Отмена
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-4 sm:py-5 rounded-xl text-center text-sm font-bold uppercase tracking-[0.1em] bg-white/10 text-white/60">
                {status === "cancelled" ? "Сбор отменён" : "Сбор заявок завершён"}
              </div>
            )}

            <Link
              href="/concept"
              className="inline-flex items-center gap-2 mt-6 text-[11px] font-mono tracking-[0.2em] uppercase text-white/50 hover:text-white transition-colors group"
              data-testid="link-featured-drop-all"
            >
              Весь предзаказ <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
