import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { WholesaleNavbar } from "@/components/WholesaleNavbar";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";
import WholesaleSlideViewer from "@/components/WholesaleSlideViewer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Package, Minus, Plus, ShoppingBag, ArrowRight,
  Clock, Truck, Building2, FileText, X, Calendar,
  AlertCircle, CheckCircle2, ChevronRight, Lock, ChevronDown,
  ChevronLeft, ZoomIn
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

interface SizeMeasurement {
  size: string;
  length?: string;
  chest?: string;
  shoulders?: string;
  sleeves?: string;
  waist?: string;
  hips?: string;
}

interface WholesalePreorderProduct {
  id: number;
  name: string;
  slug?: string;
  price: number;
  wholesalePrice?: number | null;
  images?: string[];
  imageUrl?: string;
  thumbnailUrl?: string;
  sku?: string;
  category?: string;
  sizes?: string[];
  sizeStock?: Record<string, number>;
  preorderEnabled: boolean;
  preorderDeadline?: string | null;
  preorderProductionDate?: string | null;
  preorderShippingDate?: string | null;
  preorderStatus?: string | null;
  wholesalePreorderSizes?: string[];
  wholesalePreorderRrp?: number | null;
  wholesalePreorderPrice?: number | null;
  description?: string | null;
  composition?: string | null;
  measurements?: SizeMeasurement[] | null;
  careInstructions?: string | null;
}

interface SelectionEntry {
  productId: number;
  productName: string;
  sku: string;
  size: string;
  quantity: number;
  price: number;
  category?: string;
}

const TC_OPTIONS = [
  { value: "cdek",   label: "СДЭК" },
  { value: "dellin", label: "Деловые Линии" },
  { value: "pek",    label: "ПЭК" },
  { value: "pochta", label: "Почта России" },
  { value: "baikal", label: "ТК Байкал" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  collecting: { label: "Сбор заявок", color: "bg-primary text-primary-foreground" },
  production: { label: "Производство", color: "bg-amber-500 text-white" },
  shipping:   { label: "Отправка", color: "bg-blue-500 text-white" },
  shipped:    { label: "Доставлено", color: "bg-green-600 text-white" },
  cancelled:  { label: "Отменено", color: "bg-muted text-muted-foreground" },
};

function formatPrice(kopeks: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
  }).format(kopeks / 100);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getProductImage(p: WholesalePreorderProduct): string {
  return p.thumbnailUrl || p.imageUrl || (p.images && p.images.length > 0 ? p.images[0] : "") || "";
}

function getProductSizes(p: WholesalePreorderProduct): string[] {
  if (p.wholesalePreorderSizes && p.wholesalePreorderSizes.length > 0) return p.wholesalePreorderSizes;
  if (p.sizes && p.sizes.length > 0) return p.sizes;
  return ["One Size"];
}

function ProductCardSkeleton() {
  return (
    <div className="animate-pulse bg-card border border-border rounded-xl overflow-hidden">
      <div className="aspect-[3/4] bg-muted" />
      <div className="p-5 space-y-3">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/3" />
        <div className="h-px bg-muted my-3" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex justify-between">
              <div className="h-3 bg-muted rounded w-1/4" />
              <div className="h-3 bg-muted rounded w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface PhotoLightboxProps {
  images: string[];
  initialIndex?: number;
  initialTab?: "photo" | "info";
  product: WholesalePreorderProduct;
  sizes: string[];
  rrp: number;
  optPrice: number;
  preorderPrice: number;
  selections: Record<string, SelectionEntry>;
  onQtyChange: (productId: number, productName: string, sku: string, size: string, price: number, qty: number) => void;
  onClose: () => void;
}

function PhotoLightbox({
  images,
  initialIndex = 0,
  initialTab = "photo",
  product,
  sizes,
  rrp,
  optPrice,
  preorderPrice,
  selections,
  onQtyChange,
  onClose,
}: PhotoLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [mobileTab, setMobileTab] = useState<"photo" | "info">(initialTab);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const cardTotal = sizes.reduce((sum, size) => {
    const key = `${product.id}_${size}`;
    const entry = selections[key];
    return sum + (entry ? entry.quantity * preorderPrice : 0);
  }, 0);
  const totalQty = sizes.reduce((sum, size) => {
    const key = `${product.id}_${size}`;
    return sum + (selections[key]?.quantity || 0);
  }, 0);
  const discount = rrp > 0 ? Math.round((1 - preorderPrice / rrp) * 100) : 0;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    document.body.classList.add("lb-open");
    return () => {
      document.body.style.overflow = "";
      document.body.classList.remove("lb-open");
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex(i => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIndex(i => Math.min(images.length - 1, i + 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, images.length]);

  const prev = () => setIndex(i => Math.max(0, i - 1));
  const next = () => setIndex(i => Math.min(images.length - 1, i + 1));

  const hasInfo = !!(product.description || product.composition || (product.measurements && product.measurements.length > 0) || product.careInstructions);
  const measCols = ([
    { key: "chest",     label: "Грудь" },
    { key: "shoulders", label: "Плечи" },
    { key: "length",    label: "Длина" },
    { key: "sleeves",   label: "Рукав" },
    { key: "waist",     label: "Талия" },
    { key: "hips",      label: "Бёдра" },
  ] satisfies { key: keyof SizeMeasurement; label: string }[]).filter(col => product.measurements?.some(m => m[col.key]));

  return (
    <div className="fixed inset-0 z-[200] bg-background flex flex-col lg:flex-row">

      {/* ===================== INFO PANEL: LEFT (desktop only, if data exists) ===================== */}
      {hasInfo && (
        <div className="hidden lg:flex flex-col w-[300px] shrink-0 bg-background border-r border-border overflow-y-auto">
          {/* Sticky label */}
          <div className="sticky top-0 px-6 pt-5 pb-3 bg-background/95 backdrop-blur-sm border-b border-border z-10">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground/40">О товаре</p>
          </div>

          <div className="px-6 py-4 space-y-6 flex-1">
            {/* Description */}
            {product.description && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40 mb-2">Описание</p>
                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">{product.description}</p>
              </div>
            )}

            {/* Composition */}
            {product.composition && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40 mb-2">Состав</p>
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 w-5 h-5 rounded-md bg-muted border border-border flex items-center justify-center shrink-0">
                    <span className="text-[9px] font-black text-foreground/50">%</span>
                  </div>
                  <p className="text-sm font-medium text-foreground leading-snug">{product.composition}</p>
                </div>
              </div>
            )}

            {/* Care instructions */}
            {product.careInstructions && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40 mb-2">Уход</p>
                <p className="text-sm text-foreground/70 leading-relaxed">{product.careInstructions}</p>
              </div>
            )}

            {/* Measurements table */}
            {product.measurements && product.measurements.length > 0 && measCols.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40 mb-3">Обмеры (см)</p>
                <div className="rounded-xl border border-border overflow-hidden">
                  {/* Header */}
                  <div className="grid bg-muted/60 border-b border-border"
                    style={{ gridTemplateColumns: `2.5rem repeat(${measCols.length}, 1fr)` }}>
                    <div className="px-2 py-2 text-[9px] font-black uppercase tracking-widest text-foreground/40 flex items-center">Р-р</div>
                    {measCols.map(col => (
                      <div key={col.key} className="px-1 py-2 text-[9px] font-bold uppercase tracking-wide text-foreground/40 text-center leading-tight">
                        {col.label}
                      </div>
                    ))}
                  </div>
                  {/* Rows */}
                  {product.measurements.map((m, i) => (
                    <div key={m.size}
                      className={`grid border-b border-border last:border-0 transition-colors ${i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}
                      style={{ gridTemplateColumns: `2.5rem repeat(${measCols.length}, 1fr)` }}>
                      <div className="px-2 py-2.5 text-xs font-black text-foreground">{m.size}</div>
                      {measCols.map(col => (
                        <div key={col.key} className="px-1 py-2.5 text-xs text-foreground/70 text-center tabular-nums">
                          {m[col.key] || "—"}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-foreground/30 mt-2">* все размеры в сантиметрах</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== CENTER: IMAGE VIEWER ===================== */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0">

        {/* ── MOBILE TOP BAR ── */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 shrink-0 bg-card/95 backdrop-blur-sm border-b border-border">
          <div className="flex-1 min-w-0 pr-2">
            <p className="text-foreground text-sm font-bold truncate leading-tight">{product.name}</p>
            {product.sku && <p className="text-foreground/40 text-[10px] font-mono mt-0.5">Арт: {product.sku}</p>}
          </div>
          {mobileTab === "photo" && images.length > 1 && (
            <span className="text-foreground/50 text-xs tabular-nums font-semibold mx-3 shrink-0">{index + 1}/{images.length}</span>
          )}
          <button onClick={onClose}
            className="w-9 h-9 rounded-full bg-muted border border-border flex items-center justify-center transition-colors shrink-0"
            data-testid="btn-lightbox-close">
            <X className="w-4 h-4 text-foreground" />
          </button>
        </div>

        {/* ── MOBILE TAB SWITCHER (compact, top-right of image) ── */}
        {hasInfo && mobileTab === "photo" && (
          <button
            onClick={() => setMobileTab("info")}
            className="lg:hidden absolute top-16 right-3 z-10 flex items-center gap-1.5 bg-card/90 backdrop-blur-sm border border-border rounded-full px-3 py-1.5 text-[11px] font-bold text-foreground/70 shadow-sm active:scale-95 transition-transform"
          >
            <FileText className="w-3 h-3" />
            Подробнее
          </button>
        )}
        {hasInfo && mobileTab === "info" && (
          <button
            onClick={() => setMobileTab("photo")}
            className="lg:hidden absolute top-16 right-3 z-10 flex items-center gap-1.5 bg-card/90 backdrop-blur-sm border border-border rounded-full px-3 py-1.5 text-[11px] font-bold text-foreground/70 shadow-sm active:scale-95 transition-transform"
          >
            <ZoomIn className="w-3 h-3" />
            Фото
          </button>
        )}

        {/* ── DESKTOP TOP BAR (compact) ── */}
        <div className="hidden lg:flex items-center justify-between px-5 py-2.5 shrink-0 bg-card/80 backdrop-blur-sm border-b border-border">
          <div className="flex items-center gap-3">
            {images.length > 1 && <span className="text-muted-foreground text-xs tabular-nums">{index + 1} / {images.length}</span>}
            {images.length > 1 && <span className="text-muted-foreground/40 text-xs">· стрелки ← →</span>}
          </div>
          <span className="text-muted-foreground/50 text-xs">ESC чтобы закрыть</span>
        </div>

        {/* ── PHOTO VIEW ── */}
        {mobileTab === "photo" && (
          <>
            <div
              className="flex-1 relative overflow-hidden flex items-center justify-center bg-muted/40"
              onTouchStart={e => { touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
              onTouchEnd={e => {
                if (!touchStart.current) return;
                const dx = touchStart.current.x - e.changedTouches[0].clientX;
                const dy = touchStart.current.y - e.changedTouches[0].clientY;
                touchStart.current = null;
                if (dy < -60 && Math.abs(dy) > Math.abs(dx)) { onClose(); return; }
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { if (dx > 0) next(); else prev(); }
              }}
            >
              <img
                key={index}
                src={images[index]}
                alt={`${product.name} — фото ${index + 1}`}
                className="w-full h-full object-contain select-none"
                draggable={false}
                style={{ animation: "lbFadeIn 0.2s ease" }}
              />
              {images.length > 1 && (
                <>
                  <button onClick={prev} disabled={index === 0}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-card/80 backdrop-blur-sm border border-border shadow-sm flex items-center justify-center disabled:opacity-20 hover:bg-card transition-all active:scale-90"
                    data-testid="btn-lightbox-prev">
                    <ChevronLeft className="w-6 h-6 text-foreground" />
                  </button>
                  <button onClick={next} disabled={index === images.length - 1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-card/80 backdrop-blur-sm border border-border shadow-sm flex items-center justify-center disabled:opacity-20 hover:bg-card transition-all active:scale-90"
                    data-testid="btn-lightbox-next">
                    <ChevronRight className="w-6 h-6 text-foreground" />
                  </button>
                </>
              )}
              {images.length > 1 && (
                <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5">
                  {images.map((_, i) => (
                    <button key={i} onClick={() => setIndex(i)}
                      className={`rounded-full transition-all duration-200 ${i === index ? "w-5 h-1.5 bg-foreground" : "w-1.5 h-1.5 bg-foreground/20 hover:bg-foreground/40"}`}
                    />
                  ))}
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 px-4 py-3 overflow-x-auto shrink-0 bg-card border-t border-border">
                {images.map((img, i) => (
                  <button key={i} onClick={() => setIndex(i)}
                    className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all duration-200 ${i === index ? "border-foreground scale-105" : "border-border opacity-50"}`}
                    data-testid={`btn-lightbox-thumb-${i}`}>
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── INFO VIEW (mobile) ── */}
        {mobileTab === "info" && (
          <div className="lg:hidden flex-1 overflow-y-auto bg-background">
            <div className="divide-y divide-border">

              {/* Prices quick summary */}
              <div className="px-5 py-4 flex items-center justify-between bg-card">
                <div className="space-y-0.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">Предзаказ</p>
                  <p className="text-primary text-2xl font-black tabular-nums leading-none">{formatPrice(preorderPrice)}</p>
                  {discount > 0 && <p className="text-foreground/40 text-xs">РРЦ {formatPrice(rrp)} <span className="text-primary font-bold">−{discount}%</span></p>}
                </div>
                {totalQty > 0 && (
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/40">Выбрано</p>
                    <p className="text-foreground text-xl font-black">{totalQty} шт</p>
                    <p className="text-primary text-sm font-bold">{formatPrice(cardTotal)}</p>
                  </div>
                )}
              </div>

              {/* Description */}
              {product.description && (
                <div className="px-5 py-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground/35 mb-3">Описание</p>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">{product.description}</p>
                </div>
              )}

              {/* Composition */}
              {product.composition && (
                <div className="px-5 py-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground/35 mb-3">Состав</p>
                  <div className="inline-flex items-center gap-2.5 bg-muted rounded-xl px-4 py-2.5 border border-border">
                    <span className="w-6 h-6 rounded-lg bg-background border border-border flex items-center justify-center text-[9px] font-black text-foreground/50">%</span>
                    <span className="text-sm font-semibold text-foreground">{product.composition}</span>
                  </div>
                </div>
              )}

              {/* Care instructions */}
              {product.careInstructions && (
                <div className="px-5 py-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground/35 mb-3">Уход</p>
                  <p className="text-sm text-foreground/70 leading-relaxed">{product.careInstructions}</p>
                </div>
              )}

              {/* Measurements */}
              {product.measurements && product.measurements.length > 0 && measCols.length > 0 && (
                <div className="px-5 py-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground/35 mb-3">Обмеры (см)</p>
                  <div className="overflow-x-auto -mx-1 px-1">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-muted/70">
                          <th className="text-left px-3 py-2 font-bold text-foreground/50 rounded-tl-lg border border-border text-[10px] uppercase tracking-wide">Р-р</th>
                          {measCols.map(col => (
                            <th key={col.key} className="px-3 py-2 font-bold text-foreground/50 border border-border text-[10px] uppercase tracking-wide text-center">{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {product.measurements.map((m, i) => (
                          <tr key={m.size} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                            <td className="px-3 py-2.5 font-black text-foreground border border-border">{m.size}</td>
                            {measCols.map(col => (
                              <td key={col.key} className="px-3 py-2.5 text-foreground/70 border border-border text-center tabular-nums">{m[col.key] || "—"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-foreground/30 mt-2">* все размеры в сантиметрах</p>
                </div>
              )}

              {/* Dates */}
              {(product.preorderDeadline || product.preorderShippingDate) && (
                <div className="px-5 py-5 flex gap-4">
                  {product.preorderDeadline && (
                    <div className="flex items-center gap-3 flex-1 bg-muted/50 rounded-xl px-3 py-3 border border-border">
                      <Clock className="w-4 h-4 text-foreground/50 shrink-0" />
                      <div>
                        <p className="text-[10px] text-foreground/40 font-bold uppercase tracking-wide">Сбор до</p>
                        <p className="text-sm font-bold text-foreground">{formatDate(product.preorderDeadline)}</p>
                      </div>
                    </div>
                  )}
                  {product.preorderShippingDate && (
                    <div className="flex items-center gap-3 flex-1 bg-muted/50 rounded-xl px-3 py-3 border border-border">
                      <Truck className="w-4 h-4 text-foreground/50 shrink-0" />
                      <div>
                        <p className="text-[10px] text-foreground/40 font-bold uppercase tracking-wide">Отправка</p>
                        <p className="text-sm font-bold text-foreground">{formatDate(product.preorderShippingDate)}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="h-4" />
            </div>
          </div>
        )}

        {/* ── MOBILE BOTTOM BAR ── */}
        <div className="lg:hidden shrink-0 px-4 py-3 bg-card border-t border-border flex gap-2">
          <button onClick={onClose}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-muted hover:bg-muted/70 border border-border transition-colors"
            data-testid="btn-lightbox-close-bottom">
            <X className="w-4 h-4 text-foreground/60" />
            <span className="text-foreground/60 text-sm font-semibold">Закрыть</span>
          </button>
        </div>
      </div>

      {/* ===================== RIGHT: PRODUCT PANEL (desktop only) ===================== */}
      <div className="hidden lg:flex flex-col w-[380px] shrink-0 bg-card border-l border-border overflow-y-auto">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-foreground text-lg font-black leading-snug">{product.name}</h2>
            {product.sku && (
              <p className="text-foreground/50 text-xs mt-1 font-mono">Арт: {product.sku}</p>
            )}
          </div>
          <button onClick={onClose}
            className="shrink-0 w-9 h-9 rounded-full bg-muted hover:bg-muted/70 border border-border flex items-center justify-center transition-colors mt-0.5"
            data-testid="btn-lightbox-close-desktop">
            <X className="w-4 h-4 text-foreground/60" />
          </button>
        </div>

        {/* Prices */}
        <div className="px-6 py-4 border-b border-border">
          <p className="text-foreground/60 text-[10px] font-bold uppercase tracking-[0.2em] mb-3">Цены</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-foreground/60 text-xs">РРЦ</span>
              <span className="text-foreground/40 text-sm line-through tabular-nums">{formatPrice(rrp)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground/60 text-xs">Оптовая</span>
              <span className="text-foreground text-sm font-semibold tabular-nums">{formatPrice(optPrice)}</span>
            </div>
            <div className="flex items-center justify-between pt-2.5 border-t border-border">
              <div className="flex items-center gap-2">
                <span className="text-primary text-xs font-bold uppercase tracking-wide">Предзаказ</span>
                {discount > 0 && (
                  <span className="bg-primary text-primary-foreground text-[9px] font-black px-1.5 py-0.5 rounded">−{discount}%</span>
                )}
              </div>
              <span className="text-primary text-xl font-black tabular-nums">{formatPrice(preorderPrice)}</span>
            </div>
          </div>
        </div>

        {/* Sizes */}
        <div className="px-6 py-4 flex-1 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <p className="text-foreground/60 text-[10px] font-bold uppercase tracking-[0.2em]">Размеры</p>
            {totalQty > 0 && (
              <span className="bg-primary text-primary-foreground text-[10px] font-black px-2 py-0.5 rounded-full">{totalQty} шт</span>
            )}
          </div>
          <div className="space-y-1.5">
            {sizes.map(size => {
              const key = `${product.id}_${size}`;
              const qty = selections[key]?.quantity || 0;
              return (
                <div key={size}
                  className={`flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors border ${qty > 0 ? "bg-primary/5 border-primary/30" : "bg-background border-border hover:bg-muted/50"}`}>
                  <span className={`text-sm font-bold min-w-[2.5rem] ${qty > 0 ? "text-primary" : "text-foreground"}`}>
                    {size}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onQtyChange(product.id, product.name, product.sku || "", size, preorderPrice, Math.max(0, qty - 1))}
                      disabled={qty === 0}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-25 bg-muted hover:bg-muted/60 border border-border active:scale-90 text-foreground"
                      data-testid={`btn-lb-minus-${product.id}-${size}`}>
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className={`w-8 text-center text-sm font-black tabular-nums ${qty > 0 ? "text-primary" : "text-muted-foreground"}`}>{qty}</span>
                    <button
                      onClick={() => onQtyChange(product.id, product.name, product.sku || "", size, preorderPrice, qty + 1)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all bg-muted hover:bg-primary hover:text-primary-foreground border border-border active:scale-90 text-foreground"
                      data-testid={`btn-lb-plus-${product.id}-${size}`}>
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dates */}
        {(product.preorderDeadline || product.preorderShippingDate) && (
          <div className="px-6 py-4 border-b border-border space-y-2">
            <p className="text-foreground/60 text-[10px] font-bold uppercase tracking-[0.2em] mb-3">Сроки</p>
            {product.preorderDeadline && (
              <div className="flex items-center gap-2.5 text-xs">
                <div className="w-7 h-7 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                  <Clock className="w-3.5 h-3.5 text-foreground/60" />
                </div>
                <div>
                  <p className="text-foreground/50 text-[10px]">Сбор до</p>
                  <p className="font-semibold text-foreground">{formatDate(product.preorderDeadline)}</p>
                </div>
              </div>
            )}
            {product.preorderShippingDate && (
              <div className="flex items-center gap-2.5 text-xs">
                <div className="w-7 h-7 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                  <Truck className="w-3.5 h-3.5 text-foreground/60" />
                </div>
                <div>
                  <p className="text-foreground/50 text-[10px]">Отправка</p>
                  <p className="font-semibold text-foreground">{formatDate(product.preorderShippingDate)}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Subtotal */}
        <div className="px-6 py-4 mt-auto">
          {cardTotal > 0 ? (
            <div className="rounded-xl bg-primary/5 border border-primary/25 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-foreground/60 text-[10px] uppercase tracking-widest">Итого</p>
                <p className="text-foreground/50 text-xs mt-0.5">{totalQty} шт</p>
              </div>
              <p className="text-primary text-2xl font-black tabular-nums">{formatPrice(cardTotal)}</p>
            </div>
          ) : (
            <div className="rounded-xl bg-muted/50 border border-border px-4 py-3 text-center">
              <p className="text-foreground/50 text-xs">Выберите размеры и количество</p>
            </div>
          )}
          <button onClick={onClose}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-muted hover:bg-muted/70 border border-border transition-colors"
            data-testid="btn-lightbox-close-desktop-bottom">
            <X className="w-3.5 h-3.5 text-foreground/50" />
            <span className="text-foreground/60 text-xs font-semibold uppercase tracking-wider">Закрыть</span>
          </button>
        </div>
      </div>

      <style>{`@keyframes lbFadeIn { from { opacity: 0.3; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  );
}

interface ProductCardProps {
  product: WholesalePreorderProduct;
  selections: Record<string, SelectionEntry>;
  onQtyChange: (productId: number, productName: string, sku: string, size: string, price: number, qty: number, category?: string) => void;
}

function ProductCard({ product, selections, onQtyChange }: ProductCardProps) {
  const [sizesOpen, setSizesOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxInitialTab, setLightboxInitialTab] = useState<"photo" | "info">("photo");
  const sizes = getProductSizes(product);
  const imageUrl = getProductImage(product);
  const allImages = (product.images && product.images.length > 0)
    ? product.images
    : imageUrl ? [imageUrl] : [];
  const statusCfg = STATUS_CONFIG.collecting;
  const isCollecting = true;
  const isCancelled = false;
  const rrp = product.wholesalePreorderRrp || product.price;
  const optPrice = product.wholesalePrice || product.price;
  const preorderPrice = product.wholesalePreorderPrice || product.wholesalePrice || product.price;

  const cardTotal = useMemo(() => {
    return sizes.reduce((sum, size) => {
      const key = `${product.id}_${size}`;
      const entry = selections[key];
      return sum + (entry ? entry.quantity * preorderPrice : 0);
    }, 0);
  }, [selections, sizes, product.id, preorderPrice]);

  const totalQty = useMemo(() => {
    return sizes.reduce((sum, size) => {
      const key = `${product.id}_${size}`;
      return sum + (selections[key]?.quantity || 0);
    }, 0);
  }, [selections, sizes, product.id]);

  return (
    <div
      className={`bg-card border rounded-xl overflow-hidden transition-all duration-300 ${
        totalQty > 0
          ? "border-primary shadow-md shadow-primary/10"
          : "border-border hover:border-border/80"
      } ${isCancelled ? "opacity-50" : ""}`}
      data-testid={`card-wholesale-preorder-${product.id}`}
    >
      {/* Image */}
      <div
        className={`relative aspect-[3/4] bg-muted overflow-hidden ${allImages.length > 0 ? "cursor-zoom-in" : ""}`}
        onClick={() => { if (allImages.length > 0) { setLightboxInitialTab("photo"); setLightboxIndex(0); setLightboxOpen(true); } }}
        data-testid={`img-product-${product.id}`}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-12 h-12 text-muted-foreground/30" />
          </div>
        )}

        {/* Hover zoom hint */}
        {allImages.length > 0 && (
          <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors duration-200 flex items-center justify-center opacity-0 hover:opacity-100">
            <div className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 flex items-center gap-1.5">
              <ZoomIn className="w-3.5 h-3.5 text-white" />
              {allImages.length > 1 && (
                <span className="text-white text-[11px] font-semibold">{allImages.length} фото</span>
              )}
            </div>
          </div>
        )}

        {/* Status badge */}
        <div className="absolute top-3 left-3">
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] px-2.5 py-1 rounded-full ${statusCfg.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full bg-current opacity-70 ${isCollecting ? "animate-pulse" : ""}`} />
            {statusCfg.label}
          </span>
        </div>

        {/* Photo count badge (if multiple) */}
        {allImages.length > 1 && (
          <div className="absolute bottom-3 right-3">
            <span className="inline-flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-[10px] font-semibold px-2 py-1 rounded-full">
              <ZoomIn className="w-2.5 h-2.5" />
              {allImages.length}
            </span>
          </div>
        )}

        {/* Selected qty badge */}
        {totalQty > 0 && (
          <div className="absolute top-3 right-3">
            <span className="inline-flex items-center justify-center w-7 h-7 bg-primary text-primary-foreground text-xs font-bold rounded-full shadow-lg">
              {totalQty}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-5 space-y-4">
        {/* Name + SKU */}
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{product.name}</h3>
          {product.sku && (
            <p className="text-[11px] text-muted-foreground mt-0.5">Арт: {product.sku}</p>
          )}
        </div>

        {/* Dates */}
        {(product.preorderDeadline || product.preorderShippingDate) && (
          <div className="flex flex-col gap-1">
            {product.preorderDeadline && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="w-3 h-3 shrink-0" />
                <span>Сбор до {formatDate(product.preorderDeadline)}</span>
              </div>
            )}
            {product.preorderShippingDate && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Truck className="w-3 h-3 shrink-0" />
                <span>Отправка {formatDate(product.preorderShippingDate)}</span>
              </div>
            )}
          </div>
        )}

        {/* Pricing table */}
        <div className="rounded-lg bg-muted/50 border border-border/60 overflow-hidden">
          <div className="divide-y divide-border/60">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">РРЦ</span>
              <span className="text-sm text-muted-foreground line-through">{formatPrice(rrp)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Оптовая</span>
              <span className="text-sm font-semibold text-foreground">{formatPrice(optPrice)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5 bg-primary/5">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-primary uppercase tracking-wide font-bold">Предзаказ</span>
                {preorderPrice < rrp && (
                  <span className="text-[9px] bg-primary text-primary-foreground font-bold px-1.5 py-0.5 rounded">
                    -{Math.round((1 - preorderPrice / rrp) * 100)}%
                  </span>
                )}
              </div>
              <span className="text-base font-black text-primary">{formatPrice(preorderPrice)}</span>
            </div>
          </div>
        </div>

        {/* Подробнее button */}
        {(product.description || product.composition || (product.measurements && product.measurements.length > 0)) && (
          <button
            onClick={() => { setLightboxInitialTab("info"); setLightboxIndex(0); setLightboxOpen(true); }}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-border/70 bg-muted/30 hover:bg-muted/60 transition-colors group"
            data-testid={`btn-details-${product.id}`}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground">Подробнее</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}

        {/* Size selector dropdown */}
        {isCollecting && !isCancelled && (
          <div className="rounded-xl border border-border/70 overflow-hidden">
            {/* Trigger */}
            <button
              onClick={() => setSizesOpen(v => !v)}
              className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${
                sizesOpen ? "bg-muted/60" : totalQty > 0 ? "bg-primary/5 hover:bg-primary/8" : "bg-muted/30 hover:bg-muted/50"
              }`}
              data-testid={`btn-sizes-toggle-${product.id}`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold uppercase tracking-widest ${totalQty > 0 ? "text-primary" : "text-muted-foreground"}`}>
                  Размеры
                </span>
                {totalQty > 0 && (
                  <span className="inline-flex items-center gap-1 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {totalQty} шт
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {totalQty > 0 && (
                  <span className="text-xs font-bold text-primary tabular-nums">{formatPrice(cardTotal)}</span>
                )}
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-200 ${sizesOpen ? "rotate-180 text-muted-foreground" : totalQty > 0 ? "text-primary/60" : "text-muted-foreground"}`}
                />
              </div>
            </button>

            {/* Selected sizes chips — видны когда аккордеон закрыт */}
            {!sizesOpen && totalQty > 0 && (
              <div className="px-3 pb-3 pt-1 flex flex-wrap gap-1.5 bg-primary/5 border-t border-primary/10">
                {sizes
                  .filter(s => (selections[`${product.id}_${s}`]?.quantity || 0) > 0)
                  .map(size => {
                    const qty = selections[`${product.id}_${size}`]?.quantity || 0;
                    return (
                      <span
                        key={size}
                        className="inline-flex items-center gap-1.5 bg-background border border-primary/30 text-foreground text-[11px] font-bold px-2.5 py-1 rounded-lg shadow-sm"
                      >
                        <span className="text-primary">{size}</span>
                        <span className="w-px h-3 bg-border/80" />
                        <span className="tabular-nums text-muted-foreground">{qty} шт</span>
                      </span>
                    );
                  })
                }
              </div>
            )}

            {/* Content */}
            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                sizesOpen ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <div className="border-t border-border/50">
                {/* Header row */}
                <div className="grid grid-cols-[1fr_auto] items-center px-4 py-2 bg-muted/20">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Размер</span>
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Кол-во</span>
                </div>

                {/* Size rows */}
                <div className="divide-y divide-border/30">
                  {sizes.map((size) => {
                    const key = `${product.id}_${size}`;
                    const qty = selections[key]?.quantity || 0;
                    return (
                      <div
                        key={size}
                        className={`grid grid-cols-[1fr_auto] items-center px-4 py-2.5 transition-colors ${
                          qty > 0 ? "bg-primary/5" : "hover:bg-muted/30"
                        }`}
                        data-testid={`size-row-${product.id}-${size}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center justify-center min-w-[2.5rem] h-7 rounded-md text-xs font-bold border transition-colors ${
                            qty > 0
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border/60 bg-background text-foreground"
                          }`}>
                            {size}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {product.category === "socks" && qty === 0 && (
                            <span className="text-[9px] text-muted-foreground/60 mr-0.5">мин.&nbsp;2</span>
                          )}
                          <button
                            onClick={() => onQtyChange(product.id, product.name, product.sku || "", size, preorderPrice, Math.max(0, qty - 1), product.category)}
                            disabled={qty === 0}
                            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-25 disabled:cursor-not-allowed bg-background border border-border/60 hover:border-primary/60 hover:text-primary hover:bg-primary/5 active:scale-95"
                            data-testid={`btn-minus-${product.id}-${size}`}
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className={`w-8 text-center text-sm font-bold tabular-nums ${qty > 0 ? "text-primary" : "text-muted-foreground"}`}>
                            {qty}
                          </span>
                          <button
                            onClick={() => onQtyChange(product.id, product.name, product.sku || "", size, preorderPrice, qty === 0 && product.category === "socks" ? 2 : qty + 1, product.category)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all bg-background border border-border/60 hover:border-primary/60 hover:text-primary hover:bg-primary/5 active:scale-95"
                            data-testid={`btn-plus-${product.id}-${size}`}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer subtotal */}
                {cardTotal > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-t border-border/40">
                    <span className="text-[11px] text-muted-foreground font-medium">Итого по позиции</span>
                    <span className="text-sm font-black text-foreground tabular-nums">{formatPrice(cardTotal)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Locked state */}
        {!isCollecting && !isCancelled && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2.5">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span>Сбор заявок завершён</span>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxOpen && allImages.length > 0 && (
        <PhotoLightbox
          images={allImages}
          initialIndex={lightboxIndex}
          initialTab={lightboxInitialTab}
          product={product}
          sizes={sizes}
          rrp={rrp}
          optPrice={optPrice}
          preorderPrice={preorderPrice}
          selections={selections}
          onQtyChange={onQtyChange}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}

export default function WholesalePreorder() {
  const { data: authData, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [selections, setSelections] = useState<Record<string, SelectionEntry>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [authGateOpen, setAuthGateOpen] = useState(false);
  const [transportCompany, setTransportCompany] = useState("cdek");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [phoneOverride, setPhoneOverride] = useState("");
  const [emailOverride, setEmailOverride] = useState("");
  const [comment, setComment] = useState("");
  const [successOpen, setSuccessOpen] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);

  const { data: products, isLoading } = useQuery<WholesalePreorderProduct[]>({
    queryKey: ["/api/wholesale-preorder/products"],
  });

  const { data: slidesData } = useQuery<{ slides: string[] }>({
    queryKey: ["/api/wholesale-preorder/slides"],
  });
  const slides = slidesData?.slides || [];

  const user = authData?.user;
  const isWholesale = user?.role === "wholesale";
  const isApproved = (user as any)?.wholesaleApproved === true || (user as any)?.approved === true;

  const handleQtyChange = (
    productId: number,
    productName: string,
    sku: string,
    size: string,
    price: number,
    qty: number,
    category?: string
  ) => {
    const minQty = category === "socks" ? 2 : 1;
    // Если пытаются выставить значение между 0 и минимумом — обнуляем (удаляем из корзины)
    const saveQty = qty > 0 && qty < minQty ? 0 : qty;
    const key = `${productId}_${size}`;
    setSelections(prev => {
      const next = { ...prev };
      if (saveQty <= 0) {
        delete next[key];
      } else {
        next[key] = { productId, productName, sku, size, quantity: saveQty, price, category };
      }
      return next;
    });
  };

  const selectedEntries = useMemo(() => Object.values(selections), [selections]);
  const totalQty = useMemo(() => selectedEntries.reduce((s, e) => s + e.quantity, 0), [selectedEntries]);
  const totalSum = useMemo(() => selectedEntries.reduce((s, e) => s + e.quantity * e.price, 0), [selectedEntries]);

  const productMap = useMemo(() => {
    const map: Record<number, WholesalePreorderProduct> = {};
    (products || []).forEach(p => { map[p.id] = p; });
    return map;
  }, [products]);

  const entriesByProduct = useMemo(() => {
    const groups: Record<number, SelectionEntry[]> = {};
    selectedEntries.forEach(e => {
      if (!groups[e.productId]) groups[e.productId] = [];
      groups[e.productId].push(e);
    });
    return groups;
  }, [selectedEntries]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/wholesale-preorder/order", {
        transportCompany,
        deliveryAddress: deliveryAddress.trim() || undefined,
        customerPhone: phoneOverride.trim() || undefined,
        customerEmail: emailOverride.trim() || undefined,
        comment: comment.trim() || undefined,
        items: selectedEntries.map(e => ({
          productId: e.productId,
          productName: e.productName,
          sku: e.sku,
          size: e.size,
          quantity: e.quantity,
          price: e.price,
        })),
      });
      return res;
    },
    onSuccess: (data: any) => {
      setOrderId(data?.orderId || null);
      setModalOpen(false);
      setSuccessOpen(true);
      setSelections({});
    },
    onError: (err: any) => {
      toast({
        title: "Ошибка",
        description: err.message || "Не удалось отправить заявку. Попробуйте ещё раз.",
        variant: "destructive",
      });
    },
  });

  const handleOrderClick = () => {
    if (!user) {
      setAuthGateOpen(true);
      return;
    }
    if (!isWholesale || !isApproved) {
      setAuthGateOpen(true);
      return;
    }
    setPhoneOverride((user as any)?.phone || "");
    setEmailOverride(user?.email || "");
    setModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="page-wholesale-preorder">
      <SEO
        title="Оптовый предзаказ | BMGBRAND"
        description="Эксклюзивный оптовый предзаказ BMGBRAND — бронируйте новые коллекции раньше поступления в продажу по оптовым ценам."
        keywords="оптовый предзаказ, BMGBRAND, оптовые цены, предзаказ одежда"
      />
      <WholesaleNavbar />

      {/* Hero — Editorial */}
      <section className="pt-20 pb-0 bg-black text-white overflow-hidden relative">

        {/* Top bar: tag left, brand right */}
        <div className="px-6 sm:px-10 mb-8 flex items-center justify-between relative z-10">
          <span className="inline-block text-[10px] font-bold uppercase tracking-[0.3em] text-primary border border-primary/40 rounded-full px-3 py-1">
            B2B · Exclusive
          </span>
          <span className="text-[10px] uppercase tracking-[0.25em] text-white/20 font-medium">
            Booomerangs
          </span>
        </div>

        {/* Giant outline title — edge to edge */}
        <div className="overflow-hidden relative z-10">
          <h1
            className="font-black uppercase leading-none tracking-[-0.03em] select-none w-full text-center"
            style={{
              fontSize: "clamp(52px, 15vw, 220px)",
              WebkitTextStroke: "1.5px white",
              color: "transparent",
              letterSpacing: "-0.01em",
            }}
          >
            Предзаказ
          </h1>
        </div>

        {/* Thin divider */}
        <div className="h-px bg-white/10 mx-6 sm:mx-10 mt-6 relative z-10" />

        {/* Bottom row: description left, features right */}
        <div className="px-6 sm:px-10 mt-6 pb-14 flex flex-col sm:flex-row sm:items-end justify-between gap-6 relative z-10">
          <p className="text-sm text-white/40 max-w-xs leading-relaxed">
            Бронируйте новые коллекции до начала производства по оптовым ценам. Выберите товары и размеры — мы выставим счёт.
          </p>

          <div className="flex flex-col gap-2.5 shrink-0">
            {[
              { icon: <FileText className="w-3 h-3" />, label: "Оплата по счёту" },
              { icon: <Truck className="w-3 h-3" />, label: "Ваша транспортная" },
              { icon: <Calendar className="w-3 h-3" />, label: "Сроки на каждой позиции" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-white/35">
                <span className="text-primary/60 shrink-0">{item.icon}</span>
                <span className="text-[10px] uppercase tracking-[0.15em] font-medium">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

      </section>

      {/* PDF Presentation */}
      {slides.length > 0 && <WholesaleSlideViewer slides={slides} />}

      {/* Gradient bridge: dark → cream */}
      <div className={`h-20 bg-gradient-to-b ${slides.length > 0 ? "from-black" : "from-black"} to-background`} />

      {/* Products */}
      <section className="pt-4 pb-36 relative overflow-hidden">
        {/* Watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <img
            src="/images/boomerangs-logo.webp"
            alt=""
            className="w-[90%] max-w-[1000px] opacity-[0.025]"
            draggable="false"
          />
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">

          {/* Section header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-lg font-black uppercase tracking-tight">Доступные позиции</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Выберите количество по каждому размеру
              </p>
            </div>
            {totalQty > 0 && (
              <Badge variant="secondary" className="text-xs font-semibold">
                {totalQty} шт. выбрано
              </Badge>
            )}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => <ProductCardSkeleton key={i} />)}
            </div>
          ) : !products || products.length === 0 ? (
            <div className="text-center py-32">
              <Package className="w-10 h-10 text-muted-foreground/40 mx-auto mb-5" />
              <p className="text-sm uppercase tracking-widest text-muted-foreground/50">
                Нет активных предзаказов
              </p>
              <p className="text-xs text-muted-foreground/30 mt-2">
                Следите за обновлениями — новые позиции скоро появятся
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  selections={selections}
                  onQtyChange={handleQtyChange}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Sticky bottom bar */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 transition-all duration-500 ease-out ${
          totalQty > 0 ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="border-t border-border/60 bg-background/98 backdrop-blur-xl shadow-[0_-8px_40px_rgba(0,0,0,0.12)]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5">
            <div className="flex items-center justify-between gap-4">
              {/* Left: qty + sum */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <ShoppingBag className="w-5 h-5 text-muted-foreground" />
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary text-primary-foreground text-[9px] font-black rounded-full flex items-center justify-center">
                      {totalQty}
                    </span>
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Предзаказ</p>
                    <p className="text-base font-black text-foreground leading-none tabular-nums">{formatPrice(totalSum)}</p>
                  </div>
                </div>
                {/* Mobile sum */}
                <p className="sm:hidden text-base font-black text-foreground tabular-nums">{formatPrice(totalSum)}</p>
              </div>

              {/* Right: open cart button */}
              <button
                onClick={() => setCartOpen(true)}
                className="flex items-center gap-2.5 bg-foreground text-background hover:bg-foreground/90 active:scale-[0.98] transition-all rounded-xl px-5 py-2.5 font-bold text-sm uppercase tracking-wide"
                data-testid="btn-open-cart"
              >
                <span>Корзина</span>
                <span className="bg-primary text-primary-foreground text-[10px] font-black px-1.5 py-0.5 rounded-md">
                  {totalQty}
                </span>
                <ChevronRight className="w-4 h-4 -mr-0.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── CART SLIDE PANEL ── */}
      <div className={`fixed inset-0 z-50 transition-all duration-300 ${cartOpen ? "visible" : "invisible pointer-events-none"}`}>
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${cartOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setCartOpen(false)}
        />

        {/* Panel */}
        <div
          className={`absolute right-0 top-0 h-full w-full max-w-[440px] bg-background flex flex-col shadow-[−20px_0_60px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-in-out ${cartOpen ? "translate-x-0" : "translate-x-full"}`}
          data-testid="cart-panel"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-border">
            <div>
              <h2 className="text-base font-black uppercase tracking-tight">Ваш предзаказ</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {totalQty} шт. · {formatPrice(totalSum)}
              </p>
            </div>
            <button
              onClick={() => setCartOpen(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center bg-muted/50 hover:bg-muted transition-colors"
              data-testid="btn-close-cart"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Items list */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {Object.entries(entriesByProduct).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
                <ShoppingBag className="w-10 h-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground/60 uppercase tracking-widest">Корзина пуста</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {Object.entries(entriesByProduct).map(([productIdStr, entries]) => {
                  const productId = Number(productIdStr);
                  const prod = productMap[productId];
                  const imgUrl = prod ? getProductImage(prod) : null;
                  const productTotal = entries.reduce((s, e) => s + e.quantity * e.price, 0);
                  return (
                    <div key={productId} className="px-5 py-4">
                      {/* Product header */}
                      <div className="flex gap-3 mb-3.5">
                        <div className="w-14 h-[72px] rounded-lg overflow-hidden bg-muted shrink-0">
                          {imgUrl ? (
                            <img src={imgUrl} alt={entries[0].productName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package className="w-5 h-5 text-muted-foreground/30" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-foreground line-clamp-2 leading-snug">{entries[0].productName}</p>
                          {entries[0].sku && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">Арт: {entries[0].sku}</p>
                          )}
                          <p className="text-xs font-black text-primary mt-1.5">{formatPrice(productTotal)}</p>
                        </div>
                      </div>

                      {/* Sizes */}
                      <div className="space-y-1.5">
                        {entries.map(e => (
                          <div key={e.size} className="flex items-center gap-2 group" data-testid={`cart-item-${productId}-${e.size}`}>
                            {/* Size chip */}
                            <span className="inline-flex items-center justify-center min-w-[2.5rem] h-6 rounded-md text-[11px] font-bold border border-border/70 bg-muted/60 text-foreground shrink-0">
                              {e.size}
                            </span>

                            {/* Qty stepper */}
                            <div className="flex items-center gap-1 ml-auto">
                              <button
                                onClick={() => handleQtyChange(e.productId, e.productName, e.sku, e.size, e.price, Math.max(0, e.quantity - 1), e.category)}
                                className="w-6 h-6 rounded-md flex items-center justify-center bg-muted/60 hover:bg-muted border border-border/50 hover:border-border transition-all active:scale-95"
                                data-testid={`cart-btn-minus-${productId}-${e.size}`}
                              >
                                <Minus className="w-2.5 h-2.5" />
                              </button>
                              <span className="w-7 text-center text-sm font-black text-primary tabular-nums">{e.quantity}</span>
                              <button
                                onClick={() => handleQtyChange(e.productId, e.productName, e.sku, e.size, e.price, e.quantity + 1, e.category)}
                                className="w-6 h-6 rounded-md flex items-center justify-center bg-muted/60 hover:bg-muted border border-border/50 hover:border-border transition-all active:scale-95"
                                data-testid={`cart-btn-plus-${productId}-${e.size}`}
                              >
                                <Plus className="w-2.5 h-2.5" />
                              </button>
                            </div>

                            {/* Line price */}
                            <span className="text-xs font-semibold text-muted-foreground tabular-nums w-16 text-right shrink-0">
                              {formatPrice(e.price * e.quantity)}
                            </span>

                            {/* Remove */}
                            <button
                              onClick={() => handleQtyChange(e.productId, e.productName, e.sku, e.size, e.price, 0)}
                              className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all shrink-0 opacity-0 group-hover:opacity-100"
                              data-testid={`cart-btn-remove-${productId}-${e.size}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-6 py-5 space-y-4 bg-background">
            {/* Total */}
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Итого по заявке</p>
                <p className="text-[11px] text-muted-foreground">{totalQty} шт.</p>
              </div>
              <span className="text-2xl font-black text-foreground tabular-nums">{formatPrice(totalSum)}</span>
            </div>

            {/* CTA */}
            <Button
              size="lg"
              className="w-full font-bold uppercase tracking-wide"
              onClick={() => {
                setCartOpen(false);
                setTimeout(handleOrderClick, 150);
              }}
              disabled={totalQty === 0}
              data-testid="btn-submit-from-cart"
            >
              Оформить заявку
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>

            <p className="text-[10px] text-muted-foreground/50 text-center leading-relaxed">
              После отправки на ваш email придёт счёт PDF
            </p>
          </div>
        </div>
      </div>

      {/* Confirm Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="modal-wholesale-preorder-confirm">
          <DialogHeader>
            <DialogTitle className="text-lg font-black uppercase tracking-tight">
              Подтверждение заявки
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Customer info */}
            <div className="rounded-xl bg-muted/50 border border-border p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Ваши данные
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <span className="text-muted-foreground">Имя:</span>
                <span className="font-medium">{user?.name || "—"}</span>
                {(user as any)?.companyName && (
                  <>
                    <span className="text-muted-foreground">Компания:</span>
                    <span className="font-medium">{(user as any)?.companyName}</span>
                  </>
                )}
                {(user as any)?.inn && (
                  <>
                    <span className="text-muted-foreground">ИНН:</span>
                    <span className="font-medium">{(user as any)?.inn}</span>
                  </>
                )}
              </div>

              {/* Editable phone */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Телефон для связи
                </label>
                <Input
                  value={phoneOverride}
                  onChange={e => setPhoneOverride(e.target.value)}
                  placeholder="+7 (000) 000-00-00"
                  className="h-9 text-sm"
                  data-testid="input-phone-override"
                />
              </div>

              {/* Editable email */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Email для счёта
                </label>
                <Input
                  type="email"
                  value={emailOverride}
                  onChange={e => setEmailOverride(e.target.value)}
                  placeholder="your@email.com"
                  className="h-9 text-sm"
                  data-testid="input-email-override"
                />
              </div>
            </div>

            {/* Transport company */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Транспортная компания
              </label>
              <Select value={transportCompany} onValueChange={setTransportCompany}>
                <SelectTrigger className="h-10" data-testid="select-transport-company">
                  <SelectValue placeholder="Выберите ТК" />
                </SelectTrigger>
                <SelectContent>
                  {TC_OPTIONS.map(tc => (
                    <SelectItem key={tc.value} value={tc.value} data-testid={`option-tc-${tc.value}`}>
                      {tc.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Delivery address */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Адрес доставки до ТК <span className="text-muted-foreground/50 normal-case font-normal">(если отличается от юридического)</span>
              </label>
              <Input
                value={deliveryAddress}
                onChange={e => setDeliveryAddress(e.target.value)}
                placeholder={(user as any)?.legalAddress || "Введите адрес доставки..."}
                className="h-10 text-sm"
                data-testid="input-delivery-address"
              />
            </div>

            {/* Comment */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Комментарий к заявке
              </label>
              <Textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Пожелания по упаковке, срокам, дополнительная информация..."
                className="text-sm resize-none"
                rows={3}
                data-testid="textarea-comment"
              />
            </div>

            {/* Order items */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Состав заявки
              </p>
              <div className="border border-border rounded-xl overflow-hidden divide-y divide-border/60">
                {selectedEntries.map((e, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm" data-testid={`order-item-${i}`}>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{e.productName}</p>
                      <p className="text-xs text-muted-foreground">{e.size} · {e.quantity} шт.</p>
                    </div>
                    <span className="font-bold text-foreground shrink-0 ml-3">
                      {formatPrice(e.price * e.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Total */}
            <div className="flex items-center justify-between py-3 border-t border-border">
              <div>
                <span className="text-sm text-muted-foreground">Итого</span>
                <p className="text-xs text-muted-foreground">({totalQty} шт.)</p>
              </div>
              <span className="text-2xl font-black text-foreground">{formatPrice(totalSum)}</span>
            </div>

            {/* Note */}
            <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/15 rounded-xl px-4 py-3">
              <FileText className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                После отправки заявки на email <strong className="text-foreground">{emailOverride || user?.email}</strong> придёт счёт на оплату в формате PDF.
                Оплата по реквизитам в течение 3 рабочих дней.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setModalOpen(false)}
              disabled={submitMutation.isPending}
              className="w-full sm:w-auto"
              data-testid="btn-cancel-preorder"
            >
              Назад
            </Button>
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="w-full sm:w-auto font-bold uppercase tracking-wide"
              data-testid="btn-confirm-preorder"
            >
              {submitMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  Отправляем...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Отправить заявку
                  <ChevronRight className="w-4 h-4" />
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auth Gate Modal */}
      <Dialog open={authGateOpen} onOpenChange={setAuthGateOpen}>
        <DialogContent className="max-w-sm text-center" data-testid="modal-auth-gate">
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
              {!user ? (
                <Lock className="w-7 h-7 text-muted-foreground" />
              ) : (
                <Building2 className="w-7 h-7 text-muted-foreground" />
              )}
            </div>

            <div>
              <DialogTitle className="text-lg font-black uppercase tracking-tight mb-2">
                {!user
                  ? "Нужна авторизация"
                  : !isWholesale
                  ? "Только для оптовиков"
                  : "Аккаунт на проверке"}
              </DialogTitle>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {!user
                  ? "Чтобы оформить оптовый предзаказ, войдите в существующий оптовый аккаунт или зарегистрируйтесь как оптовый покупатель."
                  : !isWholesale
                  ? "Оптовый предзаказ доступен только для покупателей с оптовым аккаунтом. Подайте заявку — мы рассмотрим её в течение 1 рабочего дня."
                  : "Ваш аккаунт ещё проходит проверку. Мы свяжемся с вами в ближайшее время."}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            {!user ? (
              <>
                <Button
                  onClick={() => { setAuthGateOpen(false); setLocation("/wholesale/register"); }}
                  className="w-full font-bold uppercase tracking-wide"
                  data-testid="btn-gate-register"
                >
                  Зарегистрироваться как оптовик
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setAuthGateOpen(false); setLocation("/wholesale/profile"); }}
                  className="w-full"
                  data-testid="btn-gate-login"
                >
                  Уже есть аккаунт — Войти
                </Button>
              </>
            ) : !isWholesale ? (
              <>
                <Button
                  onClick={() => { setAuthGateOpen(false); setLocation("/wholesale/register"); }}
                  className="w-full font-bold uppercase tracking-wide"
                  data-testid="btn-gate-register-wholesale"
                >
                  Подать заявку на опт
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAuthGateOpen(false)}
                  className="w-full"
                  data-testid="btn-gate-close"
                >
                  Закрыть
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => { setAuthGateOpen(false); setLocation("/wholesale/profile"); }}
                className="w-full"
                data-testid="btn-gate-profile"
              >
                Перейти в профиль
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Success Modal */}
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="max-w-sm text-center" data-testid="modal-wholesale-preorder-success">
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-xl font-black uppercase tracking-tight mb-2">
                Заявка принята!
              </DialogTitle>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Счёт на оплату отправлен на ваш email.
                {orderId && (
                  <> Номер заявки: <strong className="text-foreground">#{orderId}</strong>.</>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                После получения оплаты мы начнём производство и уведомим вас об отгрузке.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => { setSuccessOpen(false); setLocation("/wholesale/profile"); }}
              className="w-full font-bold uppercase tracking-wide"
              data-testid="btn-success-goto-profile"
            >
              Перейти в профиль
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
}
