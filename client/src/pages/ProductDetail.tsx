import { useRoute, useLocation } from "wouter";
import { Link } from "wouter";
import YooKassaWidget from "@/components/YooKassaWidget";
import { DolyameWidget } from "@/components/DolyameWidget";
import { useProduct, useProductBySlug, useColorVariants, usePrefetchProduct } from "@/hooks/use-products";
import { useAddToCart } from "@/hooks/use-cart";
import { useWholesalePrice, useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ReviewSection } from "@/components/ReviewSection";
import { AuthModal } from "@/components/AuthModal";
import { BrandLoader } from "@/components/BrandLoader";
import { Badge } from "@/components/ui/badge";
import SEO from "@/components/SEO";
import { Minus, Plus, ShoppingBag, ShoppingCart, ChevronLeft, ChevronRight, Loader2, X, Percent, Flame, ArrowRight, Target, Clock, Landmark, Share2, Check, Home, ZoomIn, ZoomOut, Bell, TrendingUp, TrendingDown, LogIn, AlertTriangle, MapPin, Truck, RotateCcw, Gift, Ruler } from "lucide-react";
import { getFeatureBadgeIcon } from "@/lib/featureBadgeIcons";
import { useRecentlyViewed } from "@/hooks/use-recently-viewed";
import { ProductCard } from "@/components/ProductCard";
import { RecommendationBlock } from "@/components/RecommendationBlock";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePreorderCart } from "@/context/PreorderCartContext";
import { usePreorderCartDrawer } from "@/components/PreorderCartDrawer";
import { CATEGORIES, transliterateToSlug, type CategorySlug, type SizeMeasurement } from "@shared/schema";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useFavoriteStatus, useFavoriteActions } from "@/hooks/use-favorites";
import { ZoomableLightboxImage } from "@/components/ZoomableLightboxImage";
import { VirtualTryOn } from "@/components/VirtualTryOn";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// Color name to hex mapping
const COLOR_MAP: Record<string, string> = {
  "белый": "#FFFFFF",
  "черный": "#1A1A1A",
  "чёрный": "#1A1A1A",
  "черний": "#1A1A1A",
  "серый": "#808080",
  "т.серый": "#5A5A5A",
  "т. серый": "#5A5A5A",
  "графит": "#4A4A4A",
  "графитовый": "#4A4A4A",
  "красный": "#DC2626",
  "синий": "#2563EB",
  "т.синий": "#1E3A5F",
  "т. синий": "#1E3A5F",
  "голубой": "#60A5FA",
  "серо-голубой": "#7B9EAF",
  "зеленый": "#16A34A",
  "зелёный": "#16A34A",
  "желтый": "#EAB308",
  "жёлтый": "#EAB308",
  "оранжевый": "#EA580C",
  "розовый": "#EC4899",
  "фиолетовый": "#9333EA",
  "коричневый": "#92400E",
  "бежевый": "#D4B896",
  "бордовый": "#881337",
  "бордо": "#881337",
  "бодовый": "#881337",
  "сиреневый": "#A855F7",
  "сиреневые": "#A855F7",
  "хаки": "#6B7B3C",
  "кэмел": "#C19A6B",
  "камел": "#C19A6B",
  "camel": "#C19A6B",
  "темно-синий": "#1E3A5F",
  "темносиний": "#1E3A5F",
  "молочный": "#FFFDD0",
  "кремовый": "#FFFDD0",
  "песочный": "#C2B280",
  "терракот": "#CC4E3F",
  "терракотовый": "#CC4E3F",
  "мятный": "#98FF98",
  "лавандовый": "#E6E6FA",
  "оливковый": "#808000",
  "горчичный": "#FFDB58",
  "индиго": "#4B0082",
  "марсала": "#8E4A49",
  "пудровый": "#E8C4C4",
  "антрацит": "#293133",
  "малиновый": "#DC143C",
  "вишневый": "#911938",
  "вишнёвый": "#911938",
  "какао": "#6B4423",
  "шоколад": "#5C3317",
  "шоколадный": "#5C3317",
  "персиковый": "#FFDAB9",
  "салатовый": "#7CFC00",
  "лайм": "#32CD32",
  "велюр": "#5D4037",
  "raw": "#C4B5A2",
  "white": "#FFFFFF",
  "black": "#1A1A1A",
  "gray": "#808080",
  "grey": "#808080",
  "red": "#DC2626",
  "blue": "#2563EB",
  "green": "#16A34A",
  "yellow": "#EAB308",
  "orange": "#EA580C",
  "pink": "#EC4899",
  "purple": "#9333EA",
  "brown": "#92400E",
  "beige": "#D4B896",
  "khaki": "#6B7B3C",
  "койот": "#9B7F55",
  "койотовый": "#9B7F55",
  "фиолет": "#7B2D8E",
  "кайот": "#9B7F55",
};

const displayName = (name: string) => name.replace(/\bBOOOMERANGS\b/gi, '').replace(/\bBMGBRAND\b/gi, '').replace(/\s{2,}/g, ' ').trim();

const STANDARD_SIZES = new Set(["XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL"]);
function isEffectivelyNoSize(product: any): boolean {
  if (product?.noSize) return true;
  const sizes: string[] = product?.sizes || [];
  const sizeStockKeys: string[] = product?.sizeStock ? Object.keys(product.sizeStock) : [];
  const allSizes = sizes.length > 0 ? sizes : sizeStockKeys;
  return allSizes.length === 1 && !STANDARD_SIZES.has(allSizes[0]);
}

function resolveColorPart(part: string): string | null {
  const p = part.toLowerCase().trim();
  if (COLOR_MAP[p]) return COLOR_MAP[p];
  const endings: [RegExp, string][] = [
    [/о$/, "ый"], [/а$/, "ый"], [/ая$/, "ый"],
    [/яя$/, "ий"], [/ое$/, "ый"], [/ее$/, "ий"],
    [/ие$/, "ий"], [/ые$/, "ый"],
  ];
  for (const [re, suffix] of endings) {
    const norm = p.replace(re, suffix);
    if (norm !== p && COLOR_MAP[norm]) return COLOR_MAP[norm];
  }
  return null;
}

function splitCompoundColor(name: string): string[] {
  return name.split(/[-–—\/\s_]+/).map(p => p.trim()).filter(Boolean);
}

function getColorHex(colorName: string): string {
  const normalized = colorName.toLowerCase().trim();
  if (COLOR_MAP[normalized]) return COLOR_MAP[normalized];
  const parts = splitCompoundColor(normalized);
  if (parts.length >= 2) {
    for (const part of parts) {
      const resolved = resolveColorPart(part);
      if (resolved) return resolved;
    }
  }
  return "#888888";
}

function getColorStyle(colorName: string): React.CSSProperties {
  const normalized = colorName.toLowerCase().trim();
  if (COLOR_MAP[normalized]) return { backgroundColor: COLOR_MAP[normalized] };
  const parts = splitCompoundColor(normalized);
  if (parts.length >= 2) {
    const colors = parts.map(resolveColorPart).filter(Boolean) as string[];
    if (colors.length >= 2) {
      return { background: `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)` };
    }
    if (colors.length === 1) {
      return { backgroundColor: colors[0] };
    }
  }
  return { backgroundColor: "#888888" };
}

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.7;
}

interface VariantThumbProps {
  variant: import("@/hooks/use-products").ColorVariant;
  isActive: boolean;
  isSoldOut: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}

function VariantThumb({ variant, isActive, isSoldOut, onClick, onMouseEnter }: VariantThumbProps) {
  const [loaded, setLoaded] = useState(false);
  const imgSrc = variant.thumbnailUrl || variant.imageUrl;
  const fallbackSrc = variant.imageUrl;
  const colorHex = getColorHex(variant.color);

  return (
    <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
      <button
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        data-testid={`button-variant-color-${variant.id}`}
        title={isSoldOut ? `${variant.color} — нет в наличии` : variant.color}
        className={`relative w-20 h-32 rounded-lg overflow-hidden transition-all cursor-pointer ${
          isActive
            ? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
            : "ring-1 ring-border/50 hover:ring-border hover:scale-105"
        } ${isSoldOut ? "opacity-60" : ""}`}
      >
        <div
          className="absolute inset-0"
          style={{ backgroundColor: colorHex }}
        />
        <img
          src={imgSrc}
          alt={variant.color}
          loading="lazy"
          decoding="async"
          width={80}
          height={80}
          onLoad={() => setLoaded(true)}
          onError={(e) => {
            if (fallbackSrc && e.currentTarget.src !== fallbackSrc) {
              e.currentTarget.src = fallbackSrc;
            }
          }}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      </button>
      <span className={`text-[10px] leading-tight text-center max-w-[80px] truncate ${isActive ? "text-foreground font-medium" : "text-muted-foreground"}`}>
        {variant.color}
      </span>
    </div>
  );
}

export default function ProductDetail() {
  const [, params] = useRoute("/:slug");
  const [, setLocation] = useLocation();
  const slug = params?.slug || "";
  const { data: product, isLoading, error } = useProductBySlug(slug);

  // Redirect from numeric ID URL (e.g. /1776863722465) to canonical slug URL (e.g. /shortyi-wide-grafit)
  useEffect(() => {
    if (product?.slug && product.slug !== slug) {
      setLocation(`/${product.slug}`, { replace: true });
    }
  }, [product, slug]);

  // Notify AI chat widget about current product context
  useEffect(() => {
    if (!product) return;
    window.dispatchEvent(new CustomEvent("set-product-context", {
      detail: {
        id: product.id,
        slug: product.slug || "",
        name: product.name,
        price: product.price ? Math.round(product.price / 100) : 0,
        description: (product as any).description || "",
        composition: (product as any).composition || "",
        color: (product as any).color || "",
        sizeStock: (product as any).sizeStock || {},
        stock: (product as any).stock ?? 0,
        category: (product as any).category || "",
        subcategory: (product as any).subcategory || "",
        measurements: (product as any).measurements || [],
        measurementSections: (product as any).measurementSections || [],
        preorderEnabled: (product as any).preorderEnabled || false,
        preorderStatus: (product as any).preorderStatus || null,
        preorderDeadline: (product as any).preorderDeadline || null,
        preorderGoal: (product as any).preorderGoal || 0,
        preorderCurrent: (product as any).preorderCurrent || 0,
      },
    }));
    return () => {
      window.dispatchEvent(new Event("clear-product-context"));
    };
  }, [product?.id]);

  const originalId = product?.id || 0;
  const { data: colorVariants } = useColorVariants(originalId);
  const addToCart = useAddToCart();
  const { toast } = useToast();
  const { data: authData } = useAuth();
  const authUser = authData?.user;
  const notifyMutation = useMutation({
    mutationFn: async (data: { productId: number; productName: string; size: string; email: string }) => {
      const res = await apiRequest("POST", "/api/stock-notify", data);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      setNotifySubmitted(prev => new Set(prev).add(variables.size));
      setNotifySize(null);
      setNotifyEmail("");
      toast({ title: "Готово!", description: "Мы уведомим вас, когда размер появится в наличии" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось оформить подписку", variant: "destructive" });
    },
  });
  const { isWholesale, getWholesalePrice } = useWholesalePrice();
  const prefetchProduct = usePrefetchProduct();
  const isFav = useFavoriteStatus(product?.id ?? 0);
  const { toggleFavorite } = useFavoriteActions();
  const isFavorite = (id: number) => isFav && id === product?.id;
  const { viewedIds, addViewed } = useRecentlyViewed();
  
  const id = product?.id || 0;

  const { data: productReviews = [] } = useQuery<{ rating: number; comment?: string | null; authorName: string; createdAt?: string }[]>({
    queryKey: ["/api/reviews", id],
    enabled: !!id,
  });

  const { data: featureBadgeTemplatesData } = useQuery<Record<string, { icon?: string; title?: string; description?: string }>>({
    queryKey: ["/api/page-settings/product_feature_templates"],
    enabled: Array.isArray((product as any)?.featureBadgeIds) && (product as any).featureBadgeIds.length > 0,
  });
  const reviewCount = productReviews.length;
  const avgRating = reviewCount > 0
    ? Math.round((productReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
    : 0;

  const { data: lookData } = useQuery<{ products: any[]; categoryProducts: any[]; lookCategory: string | null; lookSubcategory: string | null }>({
    queryKey: ['/api/products', id, 'look'],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/products/${id}/look`);
      const data = await res.json();
      if (Array.isArray(data)) return { products: data, categoryProducts: [], lookCategory: null, lookSubcategory: null };
      return data;
    },
  });
  
  const recentlyViewedOtherIds = viewedIds.filter((vid: number) => vid !== product?.id);
  const { data: recentlyViewedProducts } = useQuery<any[]>({
    queryKey: ['/api/products/by-ids', recentlyViewedOtherIds],
    enabled: recentlyViewedOtherIds.length > 0,
    queryFn: async () => {
      const idsStr = recentlyViewedOtherIds.slice(0, 12).join(',');
      const res = await fetch(`/api/products/by-ids?ids=${idsStr}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const [selectedSize, setSelectedSize] = useState<string>("");
  const [selectedColor, setSelectedColor] = useState<string>("");

  useEffect(() => {
    if (isEffectivelyNoSize(product)) {
      setSelectedSize("OneSize");
    }
  }, [(product as any)?.id, isEffectivelyNoSize(product)]);
  const isSockProduct = (product as any)?.category === 'socks';
  const tryOnCategory = useMemo<"upper" | "lower">(() => {
    const sub = ((product as any)?.subcategory || "").toString();
    if (/шорт|брюк|джинс|штаны/i.test(sub)) return "lower";
    return "upper";
  }, [product]);
  const isTryOnSupported = useMemo(() => {
    const cat = ((product as any)?.category || "").toString().toLowerCase();
    return cat !== "socks" && cat !== "accessories";
  }, [product]);
  const wholesaleSockMinQty = isWholesale && isSockProduct ? 2 : 1;
  const [quantity, setQuantity] = useState(wholesaleSockMinQty);
  // Когда auth подгружается и оказывается wholesale+носки — принудительно ставим минимум 2
  useEffect(() => {
    if (wholesaleSockMinQty > 1) {
      setQuantity(prev => Math.max(wholesaleSockMinQty, prev));
    }
  }, [wholesaleSockMinQty]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [hintCopied, setHintCopied] = useState(false);
  const isHint = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("hint") === "1";
  const [hintBannerVisible, setHintBannerVisible] = useState(true);
  const [zoomPos, setZoomPos] = useState<{ x: number; y: number } | null>(null);
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImgIdx, setLightboxImgIdx] = useState(0);
  const [lightboxZoomed, setLightboxZoomed] = useState(false);
  const [imgZoom, setImgZoom] = useState<{key: string, x: number, y: number} | null>(null);
  const [zoomLevels, setZoomLevels] = useState<Record<string, number>>({});
  const [zoomCursor, setZoomCursor] = useState<{key: string, px: number, py: number} | null>(null);
  const zoomCursorEls = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const zoomImgEls = useRef<Map<number, HTMLImageElement | null>>(new Map());
  const galleryRef = useRef<HTMLDivElement>(null);
  const lastWheelRef = useRef(0);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifySize, setNotifySize] = useState<string | null>(null);
  const [notifySubmitted, setNotifySubmitted] = useState<Set<string>>(new Set());
  const [notifyConsent, setNotifyConsent] = useState(false);
  const [localPriceDropSubscribed, setLocalPriceDropSubscribed] = useState(false);
  const [priceDropDialogOpen, setPriceDropDialogOpen] = useState(false);
  const [priceDropEmail, setPriceDropEmail] = useState("");
  const [isSubscribingPriceDrop, setIsSubscribingPriceDrop] = useState(false);

  const [sizeAdvisorOpen, setSizeAdvisorOpen] = useState(false);
  const [sizeAdvisorHeight, setSizeAdvisorHeight] = useState(() => {
    try { return localStorage.getItem('sa_height') || ''; } catch { return ''; }
  });
  const [sizeAdvisorMeasure, setSizeAdvisorMeasure] = useState(() => {
    try { return localStorage.getItem('sa_measure') || ''; } catch { return ''; }
  });
  const [sizeAdvisorHips, setSizeAdvisorHips] = useState(() => {
    try { return localStorage.getItem('sa_hips') || ''; } catch { return ''; }
  });
  const [sizeAdvisorLoading, setSizeAdvisorLoading] = useState(false);
  const [sizeAdvisorResult, setSizeAdvisorResult] = useState<string | null>(null);
  const [sizeAdvisorRecommended, setSizeAdvisorRecommended] = useState<string | null>(null);

  const { data: priceDropCheckData } = useQuery<{ subscribed: boolean }>({
    queryKey: ['/api/price-drop-notify/check', product?.id, authUser?.email],
    enabled: !!product?.id && !!authUser?.email,
    queryFn: async () => {
      const res = await fetch(`/api/price-drop-notify/check?productId=${product!.id}&email=${encodeURIComponent(authUser!.email!)}`);
      return res.json();
    },
    staleTime: 60_000,
  });
  const priceDropSubscribed = localPriceDropSubscribed || (priceDropCheckData?.subscribed ?? false);

  // Check if we have multiple color variants (different products with same SKU)
  const hasColorVariants = colorVariants && colorVariants.length > 1;
  
  // Check if variants have different size ranges (40-45 vs 34-39)
  const variantSizeRanges = useMemo(() => {
    if (!colorVariants) return [];
    const ranges = new Set(colorVariants.map(v => v.sizeRange).filter(Boolean));
    return Array.from(ranges);
  }, [colorVariants]);
  const hasMultipleSizeRanges = variantSizeRanges.length > 1;
  
  // Get current product's size range from variants
  const currentVariant = colorVariants?.find(v => v.id === id);
  const currentSizeRange = currentVariant?.sizeRange;
  
  const allImages = product?.images && product.images.length > 0 
    ? product.images 
    : product?.imageUrl ? [product.imageUrl] : [];
  
  const getThumbForImage = (imgUrl: string): string => {
    if (!imgUrl || !imgUrl.includes('.webp')) return imgUrl;
    const thumbs: string[] = (product as any)?.imageThumbnails || [];
    if (thumbs.length > 0) {
      const derivedThumb = imgUrl.replace(/\.webp(\?|$)/i, '_thumb.webp$1');
      const match = thumbs.find(t => t === derivedThumb);
      if (match) return match;
    }
    return imgUrl.replace(/\.webp(\?|$)/i, '_thumb.webp$1');
  };
  
  // Reset image index when product changes or images array changes
  useEffect(() => {
    setCurrentImageIndex(0);
    if (product?.id) addViewed(product.id);
  }, [product?.id]);

  // Reset AI size-advisor recommendation when navigating to a different product —
  // it was computed for the previous product and must not carry over.
  // Measurements (height/measure/hips) intentionally persist via localStorage.
  useEffect(() => {
    setSizeAdvisorResult(null);
    setSizeAdvisorRecommended(null);
    setSizeAdvisorOpen(false);
  }, [product?.id]);
  
  // Auto-select size from variant's sizeRange when navigating between variants
  useEffect(() => {
    if (currentSizeRange && hasMultipleSizeRanges) {
      setSelectedSize(currentSizeRange);
    }
  }, [currentSizeRange, hasMultipleSizeRanges]);
  
  // Guard against out-of-bounds index
  const safeImageIndex = allImages.length > 0 ? Math.min(currentImageIndex, allImages.length - 1) : 0;

  // Video + 2-up gallery for desktop
  const videoUrl = (product as any)?.videoUrl || null;
  
  const nextImage = () => {
    if (allImages.length > 1) {
      setCurrentImageIndex((prev) => (prev + 1) % allImages.length);
    }
  };
  
  const prevImage = () => {
    if (allImages.length > 1) {
      setCurrentImageIndex((prev) => (prev - 1 + allImages.length) % allImages.length);
    }
  };

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
      if (e.key === 'ArrowRight') setLightboxImgIdx(i => Math.min(i + 1, allImages.length - 1));
      if (e.key === 'ArrowLeft') setLightboxImgIdx(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen, allImages.length]);

  useEffect(() => {
    const el = galleryRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelRef.current < 350) return;
      lastWheelRef.current = now;
      setCurrentImageIndex(prev => {
        const maxIdx = Math.max(0, allImages.length - 2);
        if (e.deltaY > 0) return Math.min(prev + 1, maxIdx);
        return Math.max(prev - 1, 0);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [allImages.length]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <BrandLoader size="lg" />
      </div>
    );
  }

  if (!product || error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <h2 className="text-2xl font-semibold mb-4 text-foreground">Товар не найден</h2>
        <button onClick={() => setLocation("/products")} className="text-primary underline">Вернуться в магазин</button>
      </div>
    );
  }

  const handleSizeAdvisorSubmit = async () => {
    const isSuit = ((product as any).measurementSections?.length ?? 0) > 0;
    const measurements = (product.measurements as SizeMeasurement[]) || [];
    const hasWaist = measurements.some((m: SizeMeasurement) => !!m.waist);
    const hasSleeves = measurements.some((m: SizeMeasurement) => !!m.sleeves);
    const nameLow = (product.name || "").toLowerCase();
    const isBottomByName = ["шорт", "брюк", "джинс", "леггинс", "юбк", "бриджи", "бриджей"].some(kw => nameLow.includes(kw));
    const isPants = !isSuit && (isBottomByName || (hasWaist && !hasSleeves));
    const needsHips = isSuit || isPants;
    if (!sizeAdvisorHeight.trim() || !sizeAdvisorMeasure.trim() || sizeAdvisorLoading) return;
    if (needsHips && !sizeAdvisorHips.trim()) return;
    setSizeAdvisorLoading(true);
    setSizeAdvisorResult(null);
    setSizeAdvisorRecommended(null);
    try {
      localStorage.setItem('sa_height', sizeAdvisorHeight.trim());
      localStorage.setItem('sa_measure', sizeAdvisorMeasure.trim());
      if (needsHips) localStorage.setItem('sa_hips', sizeAdvisorHips.trim());
    } catch {}
    let msgText: string;
    if (isSuit) {
      msgText = `Подберите мне размер для товара "${product.name}". Мой рост: ${sizeAdvisorHeight} см, обхват груди: ${sizeAdvisorMeasure} см, обхват бёдер: ${sizeAdvisorHips} см.`;
    } else if (isPants) {
      msgText = `Подберите мне размер для товара "${product.name}". Мой рост: ${sizeAdvisorHeight} см, обхват талии: ${sizeAdvisorMeasure} см, обхват бёдер: ${sizeAdvisorHips} см.`;
    } else {
      msgText = `Подберите мне размер для товара "${product.name}". Мой рост: ${sizeAdvisorHeight} см, обхват груди: ${sizeAdvisorMeasure} см.`;
    }
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: msgText }],
          productId: product.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSizeAdvisorResult('Не удалось получить рекомендацию. Попробуйте ещё раз.'); return; }
      const text: string = data.reply || '';
      setSizeAdvisorResult(text);
      const sizeStock = (product as any).sizeStock;
      const availableSizes: string[] = product.sizes?.length > 0
        ? product.sizes
        : (sizeStock ? Object.keys(sizeStock) : []);
      const upperText = text.toUpperCase();
      const found = availableSizes.find(s => new RegExp(`\\b${s.toUpperCase()}\\b`).test(upperText));
      if (found) setSizeAdvisorRecommended(found);
    } catch {
      setSizeAdvisorResult('Не удалось получить рекомендацию. Попробуйте ещё раз.');
    } finally {
      setSizeAdvisorLoading(false);
    }
  };

  const handleAddToCart = () => {
    // If product has sizes but none are selected, block
    // BUT if we have multiple size ranges in variants, size is auto-selected
    // Also skip size requirement if noSize flag is set
    const hasSizes = product.sizes && product.sizes.length > 0;
    const needsSizeSelection = hasSizes && !selectedSize && !hasMultipleSizeRanges && !isEffectivelyNoSize(product);
    // For colors: if we have color variants (different products), color is already selected via navigation
    // Only require color selection if using legacy colors array AND no variants
    const needsColorSelection = !hasColorVariants && product.colors && product.colors.length > 0 && !selectedColor;

    if (needsSizeSelection || needsColorSelection) {
      return;
    }
    
    // Get color for cart: use product's extracted color if variants, otherwise selectedColor
    const currentProduct = colorVariants?.find(v => v.id === product.id);
    const cartColor = hasColorVariants 
      ? (currentProduct?.color || 'Default')
      : (selectedColor || "Default");
    
    addToCart.mutate({
      productId: product.id,
      quantity,
      size: selectedSize || "One Size",
      color: cartColor,
    });
  };
  
  const handlePriceDropClick = async () => {
    if (authUser?.email) {
      setIsSubscribingPriceDrop(true);
      try {
        const res = await fetch("/api/price-drop-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id, productName: product.name, email: authUser.email }),
        });
        const text = await res.text();
        let data: { success: boolean; alreadySubscribed: boolean } = { success: false, alreadySubscribed: false };
        try { data = JSON.parse(text); } catch { /* ignore */ }
        if (res.ok) {
          setLocalPriceDropSubscribed(true);
          toast({
            title: data.alreadySubscribed ? "Вы уже подписаны" : "Подписка оформлена",
            description: `Уведомим на ${authUser.email}, когда цена снизится`,
          });
        } else {
          throw new Error("Server error");
        }
      } catch {
        toast({ title: "Не удалось оформить подписку", variant: "destructive" });
      } finally {
        setIsSubscribingPriceDrop(false);
      }
    } else {
      setPriceDropDialogOpen(true);
      setPriceDropEmail("");
    }
  };

  const handlePriceDropSubmit = async () => {
    if (!priceDropEmail.trim()) return;
    setIsSubscribingPriceDrop(true);
    try {
      const res = await fetch("/api/price-drop-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, productName: product.name, email: priceDropEmail.trim() }),
      });
      const text = await res.text();
      let data: { success: boolean; alreadySubscribed: boolean } = { success: false, alreadySubscribed: false };
      try { data = JSON.parse(text); } catch { /* ignore */ }
      if (res.ok) {
        setLocalPriceDropSubscribed(true);
        setPriceDropDialogOpen(false);
        toast({
          title: data.alreadySubscribed ? "Вы уже подписаны" : "Подписка оформлена",
          description: `Уведомим на ${priceDropEmail.trim()}, когда цена снизится`,
        });
      } else {
        throw new Error("Server error");
      }
    } catch {
      toast({ title: "Не удалось оформить подписку", variant: "destructive" });
    } finally {
      setIsSubscribingPriceDrop(false);
    }
  };

  const formatPrice = (cents: number) => new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(cents / 100);
  
  const retailPrice = formatPrice(product.price);
  const wholesalePriceValue = getWholesalePrice(product.price, (product as any).wholesalePrice, (product as any).wholesaleDiscountPercent);
  const displayPrice = wholesalePriceValue ? formatPrice(wholesalePriceValue) : retailPrice;
  // Промежуточная оптовая цена БЕЗ скидки — для трёх уровней цен
  const wholesaleBasePriceFormatted = (wholesalePriceValue && (product as any).wholesaleDiscountPercent > 0 && (product as any).wholesalePrice > 0)
    ? formatPrice((product as any).wholesalePrice)
    : null;
  const discountPct = (product as any).discountPercent;
  const productSalePrice = (product as any).salePrice;
  const sizeDiscountsMap = (product as any).sizeDiscounts as Record<string, number> | null | undefined;
  const activeSizeDiscount = (sizeDiscountsMap && selectedSize && sizeDiscountsMap[selectedSize]) ? sizeDiscountsMap[selectedSize] : null;
  const effectiveDiscountPct = activeSizeDiscount ?? discountPct;
  const hasDiscount = ((productSalePrice && productSalePrice > 0 && productSalePrice < product.price) || (effectiveDiscountPct && effectiveDiscountPct > 0)) && !wholesalePriceValue;
  const salePrice = productSalePrice && productSalePrice > 0 && productSalePrice < product.price
    ? productSalePrice
    : (effectiveDiscountPct && effectiveDiscountPct > 0 ? Math.round(product.price * (1 - effectiveDiscountPct / 100)) : product.price);
  const isPreorderCollecting = (product as any).preorderEnabled && (product as any).preorderStatus === "collecting";
  const showPreorderPriceLabels = isPreorderCollecting && !!hasDiscount;
  const showWholesaleBelow = isWholesale && !!wholesalePriceValue;

  const origin = window.location.origin;
  const productUrl = `${origin}/${product.slug || product.id}`;
  const productImage = product.imageUrl?.startsWith("http") ? product.imageUrl : `${origin}${product.imageUrl || "/favicon.png"}`;

  // Human-readable category name ("Одежда", "Носки" …) — used in SEO keywords and image alts.
  // Falls back to the raw slug only when CATEGORIES doesn't have a mapping (shouldn't happen).
  const categoryName = product.category
    ? (CATEGORIES[product.category as keyof typeof CATEGORIES]?.name ?? product.category)
    : "";
  const selectedColorName = hasColorVariants
    ? (colorVariants?.find(v => v.id === product.id)?.color || "")
    : (selectedColor || "");
  const sizesText = product.sizes?.length > 0 ? product.sizes.join(", ") : "";

  const isMerchProduct = ["merch", "мерч"].includes(((product as any).category || "").toLowerCase());
  const autoSeoTitle = `${product.name}${selectedColorName ? ` ${selectedColorName}` : ""} — купить${isMerchProduct ? " мерч" : ""}`;
  const seoTitle = product.seoTitle || autoSeoTitle;

  // Truncate at word boundary so meta description never breaks mid-word
  const truncateAtWord = (str: string, maxLen: number): string => {
    if (str.length <= maxLen) return str;
    const cut = str.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(" ");
    return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  };

  const seoDescParts = [
    isMerchProduct
      ? `Купить мерч ${product.name} BOOOMERANGS`
      : `Купить ${product.name} BOOOMERANGS`,
    selectedColorName ? `цвет: ${selectedColorName}` : "",
    sizesText ? `Размеры: ${sizesText}.` : "",
    "Доставка по России СДЭК.",
    product.description ? truncateAtWord(product.description, 160) : "",
  ].filter(Boolean);
  const autoSeoDescription = truncateAtWord(seoDescParts.join(" "), 220);
  const seoDescription = product.seoDescription || autoSeoDescription;

  const seoKeywords = [
    product.name,
    isMerchProduct ? "мерч" : null,
    isMerchProduct ? "купить мерч" : null,
    "BMGBRAND",
    "BOOOMERANGS",
    "купить",
    categoryName,
    selectedColorName,
    "российский бренд одежды и аксессуаров",
    "доставка по России",
  ].filter(Boolean).join(", ");

  const IMAGE_ALT_LABELS = [
    "вид спереди",
    "детальная вид спереди",
    "детальная вид сзади",
    "общий вид с левого бока",
    "общий вид с правого бока",
    "общий вид сзади",
    "бирка и размерная сетка",
    "дополнительный ракурс",
  ];

  const customImageAlts: string[] = product.imageAlts || [];

  const getImageAlt = (index: number): string => {
    if (customImageAlts[index]?.trim()) return customImageAlts[index];
    const label = IMAGE_ALT_LABELS[index] || `фото ${index + 1}`;
    return `${product.name} BOOOMERANGS${categoryName ? `, ${categoryName}` : ""}, ${label}`;
  };

  const getImageTitle = (index: number): string => {
    const label = IMAGE_ALT_LABELS[index] || `фото ${index + 1}`;
    return `${product.name} — ${label}`;
  };

  const allProductImages = allImages.map(img =>
    img.startsWith("http") ? img : `${origin}${img}`
  );

  // Единая сущность Organization с @id — та же, что на главной странице
  // (server/static.ts, server/bot-ssr.ts). brand/seller ссылаются на неё,
  // а не создают анонимную заглушку без url/logo/sameAs.
  const organizationSchema = {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    "name": "BMGBRAND",
    "alternateName": "Booomerangs",
    "url": origin,
    "logo": `${origin}/favicon.png`,
    "sameAs": ["https://vk.com/bmgbrand", "https://t.me/bmg_booomerangs"],
    "address": { "@type": "PostalAddress", "addressLocality": "Тула", "addressCountry": "RU" },
  };
  const merchantReturnPolicy = {
    "@type": "MerchantReturnPolicy",
    "applicableCountry": "RU",
    "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
    "merchantReturnDays": 14,
    "returnMethod": "https://schema.org/ReturnByMail",
    "returnFees": "https://schema.org/ReturnFeesCustomerResponsibility",
  };

  // ─── Admin JSON-LD override (Variant B) ─────────────────────────────────────
  // If admin set seoJsonLd with @type Product → its fields merge ON TOP of the
  // auto-generated schema below (admin wins; placeholder/empty URLs are skipped).
  // Non-Product types (FAQPage, VideoObject, etc.) are collected as extra schemas.
  // Result: always exactly ONE Product schema per page.
  const isPlaceholderJsonLdValue = (v: any): boolean =>
    typeof v === "string" && (v.includes("/placeholder") || v.includes("example.com") || v.trim() === "");

  const adminSeoJsonLd = (() => {
    const raw = (product as any).seoJsonLd;
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  })();

  const extractAdminProduct = (obj: any): Record<string, any> | null => {
    if (!obj) return null;
    if (Array.isArray(obj)) { for (const x of obj) { const f = extractAdminProduct(x); if (f) return f; } return null; }
    const t = obj["@type"];
    return (t === "Product" || t === "ProductGroup") ? obj : null;
  };
  const adminProductOverride = extractAdminProduct(adminSeoJsonLd);

  const adminExtraSchemas: any[] = adminSeoJsonLd
    ? (Array.isArray(adminSeoJsonLd)
        ? adminSeoJsonLd.filter((x: any) => x && x["@type"] !== "Product" && x["@type"] !== "ProductGroup")
        : (adminSeoJsonLd["@type"] !== "Product" && adminSeoJsonLd["@type"] !== "ProductGroup"
            ? [adminSeoJsonLd] : []))
    : [];

  // Auto-generated Product schema — complete, built from live product data
  const baseProduct: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": product.name,
    "description": product.description || `${product.name} — купить в BMGBRAND`,
    "image": allProductImages.length > 0 ? allProductImages : [productImage],
    "url": productUrl,
    "sku": (product as any).article || product.sku || product.id,
    "brand": { "@id": organizationSchema["@id"] },
    "offers": {
      "@type": "Offer",
      "priceCurrency": "RUB",
      "price": (product.price / 100).toFixed(2),
      "priceValidUntil": new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split("T")[0],
      "availability": (product as any).preorderEnabled
        ? "https://schema.org/PreOrder"
        : (product.stock ?? 0) > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      "itemCondition": "https://schema.org/NewCondition",
      "url": productUrl,
      "seller": { "@id": organizationSchema["@id"] },
      "hasMerchantReturnPolicy": merchantReturnPolicy,
    },
    ...(product.category ? { "category": product.category } : {}),
    ...((product.colors?.length > 0 || selectedColorName) ? { "color": product.colors?.length > 0 ? product.colors.join(", ") : selectedColorName } : {}),
    ...((product.sizes?.length > 0 || currentSizeRange) ? { "size": product.sizes?.length > 0 ? product.sizes.join(", ") : currentSizeRange } : {}),
    ...(reviewCount > 0 ? {
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": avgRating,
        "reviewCount": reviewCount,
        "bestRating": 5,
        "worstRating": 1,
      },
      "review": productReviews.slice(0, 5).map(r => ({
        "@type": "Review",
        "author": { "@type": "Person", "name": r.authorName },
        "reviewRating": { "@type": "Rating", "ratingValue": r.rating, "bestRating": 5 },
        ...(r.comment ? { "reviewBody": r.comment } : {}),
        ...(r.createdAt ? { "datePublished": r.createdAt.split("T")[0] } : {}),
      })),
    } : {}),
  };

  // If admin has a Product override → merge its fields on top (admin wins, skip placeholders)
  if (adminProductOverride) {
    for (const [key, val] of Object.entries(adminProductOverride)) {
      if (key === "@context" || key === "@type") continue;
      if (isPlaceholderJsonLdValue(val)) continue;
      baseProduct[key] = val;
    }
  }

  // BreadcrumbList — use the proper Russian category name, not the raw slug
  const breadcrumbCategoryName = product.category
    ? (CATEGORIES[product.category as keyof typeof CATEGORIES]?.name ?? product.category)
    : null;

  const productJsonLd = [
    baseProduct,
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": origin },
        { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${origin}/products` },
        ...(breadcrumbCategoryName ? [{ "@type": "ListItem", "position": 3, "name": breadcrumbCategoryName, "item": `${origin}/products/${encodeURIComponent(product.category!)}` }] : []),
        { "@type": "ListItem", "position": breadcrumbCategoryName ? 4 : 3, "name": product.name, "item": productUrl },
      ],
    },
    ...adminExtraSchemas,
    { "@context": "https://schema.org", ...organizationSchema },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${productUrl}#webpage`,
      "url": productUrl,
      "name": seoTitle,
      "description": seoDescription,
      "inLanguage": "ru-RU",
      "isPartOf": { "@id": `${origin}/#website` },
      "speakable": {
        "@type": "SpeakableSpecification",
        "xpath": [
          "/html/head/title",
          "/html/head/meta[@name='description']/@content",
          "//h1",
        ],
      },
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={seoTitle}
        description={seoDescription}
        keywords={seoKeywords}
        ogType="product"
        ogImage={product.imageUrl || "/og-image.png"}
        jsonLd={productJsonLd}
      />
      <Navbar />
      
      {isHint && hintBannerVisible && (
        <div className="fixed top-0 left-0 right-0 z-[60] pt-[64px] sm:pt-[80px] pointer-events-none px-3 sm:px-6 lg:px-8">
          <div className="max-w-8xl mx-auto">
            <div className="pointer-events-auto relative flex items-center justify-center gap-2 sm:gap-3 bg-card/90 backdrop-blur-xl border border-border/50 shadow-lg rounded-2xl px-4 sm:px-6 py-3 mt-2">
              <Gift className="w-4 h-4 sm:w-5 sm:h-5 text-primary flex-shrink-0" />
              <p className="text-xs sm:text-sm text-foreground font-medium text-center">
                Кто-то намекает, что хочет этот товар в подарок 🎁
              </p>
              <button
                onClick={() => setHintBannerVisible(false)}
                className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Закрыть"
              >
                <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24">
        <Breadcrumb data-testid="breadcrumb-product">
          <BreadcrumbList className="text-[11px] sm:text-xs text-muted-foreground flex-nowrap">
            <BreadcrumbItem>
              <BreadcrumbLink href="/" className="flex items-center gap-0.5">
                <Home className="w-3 h-3" />
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/products">Каталог</BreadcrumbLink>
            </BreadcrumbItem>
            {product.category && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink href={`/products/${encodeURIComponent(product.category)}`}>
                    {CATEGORIES[product.category as keyof typeof CATEGORIES]?.name || product.category}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="truncate max-w-[150px] sm:max-w-[200px]">{displayName(product.name)}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="pt-3 sm:pt-5 pb-8 max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-4 gap-6">
          
          {/* Mobile Image Gallery - Top on mobile */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="lg:hidden mb-4"
          >
            <div
              className="relative aspect-[3/4] w-full overflow-hidden rounded-lg cursor-zoom-in"
              onClick={() => { setLightboxImgIdx(safeImageIndex); setLightboxZoomed(false); setLightboxOpen(true); }}
            >
              {safeImageIndex === 0 ? (
                <img
                  ref={el => { if (el) el.setAttribute('fetchpriority', 'high'); }}
                  src={allImages[0] || product.imageUrl}
                  alt={getImageAlt(0)}
                  title={getImageTitle(0)}
                  loading="eager"
                  decoding="sync"
                  sizes="(max-width: 480px) 96vw, (max-width: 768px) 94vw, (max-width: 1024px) 50vw, 40vw"
                  className="w-full h-full object-cover"
                  data-testid="img-product-mobile-0"
                />
              ) : (
                <AnimatePresence mode="wait">
                  <motion.img
                    key={currentImageIndex}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    src={allImages[safeImageIndex] || product.imageUrl}
                    alt={getImageAlt(safeImageIndex)}
                    title={getImageTitle(safeImageIndex)}
                    className="w-full h-full object-cover"
                    data-testid={`img-product-mobile-${currentImageIndex}`}
                  />
                </AnimatePresence>
              )}
              <div className="absolute bottom-3 right-3 bg-black/30 backdrop-blur-sm rounded-full p-1.5 pointer-events-none">
                <ZoomIn className="w-4 h-4 text-white/80" />
              </div>

              {/* Navigation arrows */}
              {allImages.length > 1 && (
                <>
                  <button
                    onClick={prevImage}
                    data-testid="button-prev-image-mobile"
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-foreground/10 text-foreground rounded-full flex items-center justify-center hover:bg-foreground/20 transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={nextImage}
                    data-testid="button-next-image-mobile"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-foreground/10 text-foreground rounded-full flex items-center justify-center hover:bg-foreground/20 transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
            {allImages.length > 1 && (
              <div className="grid grid-cols-4 gap-1.5 mt-3">
                {allImages.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentImageIndex(idx)}
                    data-testid={`button-thumb-mobile-${idx}`}
                    className={`h-20 rounded-md overflow-hidden border-2 transition-all ${
                      idx === safeImageIndex ? 'border-primary opacity-100' : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={getThumbForImage(img)} alt={getImageAlt(idx)} title={getImageTitle(idx)} className="w-full h-full object-cover" onError={(e) => { if (img && e.currentTarget.src !== img) e.currentTarget.src = img; }} />
                  </button>
                ))}
              </div>
            )}
            {/* Mobile video block */}
            {videoUrl && (
              <div className="mt-3">
                <video
                  src={videoUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  controls
                  className="w-full rounded-lg object-cover"
                  data-testid="video-product-mobile"
                />
              </div>
            )}
            {/* Feature badges — mobile (below image gallery) */}
            {(() => {
              const badgeIds: string[] = Array.isArray((product as any).featureBadgeIds) ? (product as any).featureBadgeIds : [];
              if (badgeIds.length === 0) return null;
              const templates = (featureBadgeTemplatesData || {}) as Record<string, { icon?: string; title?: string; description?: string }>;
              const badges = badgeIds.map((id) => templates[id]).filter((t): t is { icon?: string; title?: string; description?: string } => !!t && !!t.title);
              if (badges.length === 0) return null;
              return (
                <div className="grid grid-cols-3 gap-x-2 gap-y-2 mt-3" data-testid="section-feature-badges-mobile">
                  {badges.map((b, idx) => {
                    const Icon = getFeatureBadgeIcon(b.icon);
                    return (
                      <div key={idx} className="flex items-start gap-2" data-testid={`badge-feature-mobile-${idx}`}>
                        <div className="w-7 h-7 rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                          <Icon className="w-3.5 h-3.5 text-foreground/60" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-foreground leading-tight">{b.title}</p>
                          {b.description && <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{b.description}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </motion.div>

          {/* Details */}
          <div
            className="detail-panel flex flex-col order-1 lg:order-2 lg:bg-background/96 lg:backdrop-blur-md lg:border lg:border-border/30 lg:rounded-2xl lg:shadow-2xl lg:px-5 lg:pt-4 lg:pb-6"
          >
            <div className="flex flex-col mb-4 sm:mb-6">
              <span className="lg:hidden font-mono text-muted-foreground text-[10px] uppercase tracking-[0.3em] block mb-2" data-testid={`text-category-${product.id}`}>{categoryName}</span>

              {/* ── Мобильная раскладка: заголовок + 3 равных кнопки ── */}
              <div className="md:hidden">
                <h1 className="text-base font-semibold leading-snug text-foreground mb-3" data-testid={`text-product-name-${product.id}`}>
                  {displayName(product.name)}
                </h1>
                <div className={`grid gap-2 ${isWholesale ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  <button
                    onClick={() => toggleFavorite(product.id)}
                    className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl border border-border/60 hover:border-foreground/30 transition-all duration-200"
                    data-testid={`button-favorite-detail-${product.id}`}
                  >
                    <Flame
                      className="w-4 h-4 transition-colors duration-200"
                      style={{ color: isFavorite(product.id) ? '#f97316' : undefined }}
                      fill={isFavorite(product.id) ? '#f97316' : 'none'}
                      strokeWidth={2}
                    />
                    <span className="text-[10px] text-muted-foreground leading-none">Избранное</span>
                  </button>
                  <button
                    onClick={async () => {
                      const url = window.location.href;
                      if (navigator.share) { try { await navigator.share({ title: product.name, url }); } catch {} }
                      else { await navigator.clipboard.writeText(url); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); }
                    }}
                    className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl border border-border/60 hover:border-foreground/30 transition-all duration-200"
                    data-testid={`button-share-product-${product.id}`}
                  >
                    {linkCopied ? <Check className="w-4 h-4 text-primary" /> : <Share2 className="w-4 h-4 text-foreground/60" />}
                    <span className="text-[10px] text-muted-foreground leading-none">{linkCopied ? 'Скопировано' : 'Поделиться'}</span>
                  </button>
                  {!isWholesale && (
                    <button
                      onClick={async () => {
                        const url = `${window.location.origin}${window.location.pathname}?hint=1`;
                        await navigator.clipboard.writeText(url);
                        setHintCopied(true);
                        setTimeout(() => setHintCopied(false), 2000);
                      }}
                      className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl border border-border/60 hover:border-foreground/30 transition-all duration-200"
                      data-testid={`button-hint-product-${product.id}`}
                    >
                      {hintCopied ? <Check className="w-4 h-4 text-primary" /> : <Gift className="w-4 h-4 text-foreground/60" />}
                      <span className="text-[10px] text-muted-foreground leading-none">{hintCopied ? 'Скопировано' : 'Намекнуть'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* ── Десктопная раскладка: Вариант В — монолит ── */}
              <div className={`hidden md:flex min-w-0 ${showPreorderPriceLabels || showWholesaleBelow ? 'flex-col gap-2' : 'items-start gap-3'}`}>
                <div className={`flex items-start gap-3 min-w-0 ${showPreorderPriceLabels || showWholesaleBelow ? 'w-full' : ''}`}>
                  {/* Название — занимает всё свободное место. Не <h1>: настоящий заголовок уже отрисован выше для мобильной раскладки (skip-дубликат для SEO/AI-краулеров) */}
                  <div
                    role="heading"
                    aria-level={2}
                    className="flex-1 min-w-0 text-[13px] font-bold uppercase tracking-[0.16em] text-foreground leading-snug"
                    data-testid={`text-product-name-${product.id}`}
                  >
                    {displayName(product.name)}
                  </div>
                  {!showPreorderPriceLabels && !showWholesaleBelow && (
                    <div className="shrink-0 flex items-baseline gap-1.5 pt-px">
                      <span className="text-xl font-bold leading-none text-foreground">{displayPrice}</span>
                    </div>
                  )}
                  {/* Кнопки действий — только иконки */}
                  <div className="flex items-center gap-1 shrink-0 pt-px">
                  <button
                    onClick={() => toggleFavorite(product.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-full border border-border/50 hover:border-foreground/40 transition-all"
                    data-testid={`button-favorite-detail-${product.id}`}
                    title="В избранное"
                  >
                    <Flame
                      className="w-3.5 h-3.5 transition-colors duration-200"
                      style={{ color: isFavorite(product.id) ? '#f97316' : undefined }}
                      fill={isFavorite(product.id) ? '#f97316' : 'none'}
                      strokeWidth={2}
                    />
                  </button>
                  <button
                    onClick={async () => {
                      const url = window.location.href;
                      if (navigator.share) { try { await navigator.share({ title: product.name, url }); } catch {} }
                      else { await navigator.clipboard.writeText(url); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); }
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-full border border-border/50 hover:border-foreground/40 transition-all"
                    data-testid={`button-share-product-${product.id}`}
                    title="Поделиться"
                  >
                    {linkCopied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Share2 className="w-3.5 h-3.5 text-foreground" />}
                  </button>
                  {!isWholesale && (
                    <button
                      onClick={async () => {
                        const url = `${window.location.origin}${window.location.pathname}?hint=1`;
                        await navigator.clipboard.writeText(url);
                        setHintCopied(true);
                        setTimeout(() => setHintCopied(false), 2000);
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-full border border-border/50 hover:border-foreground/40 transition-all"
                      data-testid={`button-hint-product-${product.id}`}
                      title={hintCopied ? 'Ссылка скопирована' : 'Намекнуть'}
                    >
                      {hintCopied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Gift className="w-3.5 h-3.5 text-foreground" />}
                    </button>
                  )}
                  </div>
                </div>
                {showPreorderPriceLabels && (
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground uppercase tracking-wide self-center">Предпродажная</span>
                      <span className="text-2xl font-bold leading-none text-red-600">
                        {formatPrice(salePrice)}
                      </span>
                    </div>
                    <span className="text-base font-medium text-foreground">Цена после релиза {retailPrice}</span>
                  </div>
                )}
                {showWholesaleBelow && (
                  <div className="flex items-end gap-5 flex-wrap">
                    <div className="flex flex-col">
                      <span className="text-[9px] text-foreground/30 font-medium uppercase tracking-wide leading-none mb-1">РРЦ</span>
                      <span className="text-sm text-foreground/40 line-through">{retailPrice}</span>
                    </div>
                    {wholesaleBasePriceFormatted && (
                      <div className="flex flex-col">
                        <span className="text-[9px] text-foreground/25 font-medium uppercase tracking-wide leading-none mb-1">ОПТ</span>
                        <span className="text-xs text-foreground/30 line-through">{wholesaleBasePriceFormatted}</span>
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className={`text-[9px] font-medium uppercase tracking-wide leading-none mb-1 ${isPreorderCollecting ? "text-amber-600" : "text-foreground/35"}`}>
                        {isPreorderCollecting ? "Предзаказ" : "ОПТ"}
                      </span>
                      <span className="text-xl font-bold leading-none text-primary">{displayPrice}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="border-t border-border my-3 sm:my-2"></div>
              {/* Цена — скрыта на десктопе (переехала в шапку) */}
              <div className="md:hidden space-y-1" data-testid={`text-product-price-${product.id}`}>
                <div className={`flex flex-wrap ${isWholesale && wholesalePriceValue ? 'items-end gap-4' : 'items-center gap-3'}`}>
                  {showPreorderPriceLabels ? (
                    <>
                      <span className="text-sm font-semibold text-foreground uppercase tracking-wide self-center">Предпродажная</span>
                      <p className="text-2xl font-bold text-red-600">{formatPrice(salePrice)}</p>
                    </>
                  ) : hasDiscount ? (
                    <>
                      <span className="text-lg font-semibold text-red-400 line-through">{retailPrice}</span>
                      <p className="text-2xl font-bold text-red-600">{formatPrice(salePrice)}</p>
                    </>
                  ) : isWholesale && wholesalePriceValue ? (
                    <>
                      <div className="flex flex-col">
                        <span className="text-[9px] text-foreground/30 font-medium uppercase tracking-wide leading-none mb-1">РРЦ</span>
                        <span className="text-lg text-foreground/45 line-through">{retailPrice}</span>
                      </div>
                      {wholesaleBasePriceFormatted && (
                        <div className="flex flex-col">
                          <span className="text-[9px] text-foreground/25 font-medium uppercase tracking-wide leading-none mb-1">ОПТ</span>
                          <span className="text-base text-foreground/35 line-through">{wholesaleBasePriceFormatted}</span>
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className={`text-[9px] font-medium uppercase tracking-wide leading-none mb-1 ${isPreorderCollecting ? "text-amber-600" : "text-foreground/35"}`}>
                          {isPreorderCollecting ? "Предзаказ" : "ОПТ"}
                        </span>
                        <p className="text-2xl font-bold text-primary">{displayPrice}</p>
                      </div>
                    </>
                  ) : (
                    <p className="text-2xl font-bold text-foreground">{displayPrice}</p>
                  )}
                </div>
                {showPreorderPriceLabels && (
                  <p className="text-xs text-foreground">
                    Цена после релиза — {retailPrice} · <span className="font-medium text-foreground">экономите {formatPrice(product.price - salePrice)}</span>
                  </p>
                )}
              </div>
              {/* Dolyame на мобиле — рядом с ценой */}
              {!isWholesale && salePrice >= 300000 && salePrice <= 3000000 && (
                <div className="md:hidden">
                  <DolyameWidget
                    price={salePrice}
                    isDark={false}
                    isMinta={false}
                    productId={product.id}
                  />
                </div>
              )}
            </div>
            

            {/* Compact Selectors Grid - always show size selector */}
            {(hasColorVariants || product.colors.length > 0 || !hasMultipleSizeRanges) && (
            <div className="space-y-4 sm:space-y-3 mb-6 sm:mb-4">
              <div className="flex flex-col gap-4">
                {/* Color variants grouped by size range */}
                {hasColorVariants ? (
                  (() => {
                    // Group variants by sizeRange
                    const variantsBySizeRange = colorVariants.reduce((acc, v) => {
                      const size = v.sizeRange || 'default';
                      if (!acc[size]) acc[size] = [];
                      acc[size].push(v);
                      return acc;
                    }, {} as Record<string, typeof colorVariants>);
                    
                    const sizeRanges = Object.keys(variantsBySizeRange).sort((a, b) => {
                      // Sort: 40-45 first, then 34-39, then default
                      if (a === 'default') return 1;
                      if (b === 'default') return -1;
                      return b.localeCompare(a); // 40-45 before 34-39
                    });
                    
                    // Check if we have multiple size ranges (need to show grouped)
                    const hasMultipleSizes = sizeRanges.length > 1 || (sizeRanges.length === 1 && sizeRanges[0] !== 'default');
                    
                    if (hasMultipleSizes) {
                      return (
                        <div className="space-y-4">
                          {sizeRanges.map(sizeRange => (
                            <div key={sizeRange} className="flex flex-col sm:flex-row sm:items-start gap-3">
                              <div className="flex-1">
                                <div className="flex items-start gap-2.5">
                                  <label className="text-xs font-semibold text-foreground uppercase tracking-wider pt-2.5 flex-shrink-0">
                                    {sizeRange === 'default' ? 'Цвет' : `Размер ${sizeRange}`}
                                  </label>
                                  <div className="flex flex-wrap gap-1.5">
                                  {variantsBySizeRange[sizeRange].map(variant => {
                                    const isCurrentProduct = variant.id === product.id;
                                    const isPreorderCollecting = (product as any).preorderEnabled && (product as any).preorderStatus === "collecting";
                                    const isSoldOut = isPreorderCollecting ? false : variant.stock <= 0;
                                    return (
                                      <VariantThumb
                                        key={variant.id}
                                        variant={variant}
                                        isActive={isCurrentProduct}
                                        isSoldOut={isSoldOut}
                                        onClick={() => {
                                          if (!isCurrentProduct) {
                                            setLocation(`/${variant.slug || variant.id}`);
                                          }
                                        }}
                                        onMouseEnter={() => {
                                          if (!isCurrentProduct) {
                                            prefetchProduct(variant.id);
                                          }
                                        }}
                                      />
                                    );
                                  })}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    } else {
                      // Single size range - show simple color picker
                      return (
                        <div className="flex-1">
                          <div className="flex items-start gap-2.5">
                          <label className="text-xs font-semibold text-foreground uppercase tracking-wider pt-2.5 flex-shrink-0">Цвет</label>
                          <div className="flex flex-wrap gap-1.5">
                            {colorVariants.map(variant => {
                              const isCurrentProduct = variant.id === product.id;
                              const isPreorderCollecting = (product as any).preorderEnabled && (product as any).preorderStatus === "collecting";
                              const isSoldOut = isPreorderCollecting ? false : variant.stock <= 0;
                              return (
                                <VariantThumb
                                  key={variant.id}
                                  variant={variant}
                                  isActive={isCurrentProduct}
                                  isSoldOut={isSoldOut}
                                  onClick={() => {
                                    if (!isCurrentProduct) {
                                      setLocation(`/${variant.slug || variant.id}`);
                                    }
                                  }}
                                  onMouseEnter={() => {
                                    if (!isCurrentProduct) {
                                      prefetchProduct(variant.id);
                                    }
                                  }}
                                />
                              );
                            })}
                          </div>
                          </div>
                        </div>
                      );
                    }
                  })()
                ) : product.colors.length > 0 ? (
                  // Fallback to original colors array if no variants
                  <div className="flex-1">
                    <div className="flex items-center gap-2.5">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider flex-shrink-0">Цвет</label>
                    <div className="flex flex-wrap gap-2">
                      {product.colors.map(color => {
                        const colorHex = getColorHex(color);
                        const isLight = isLightColor(colorHex);
                        const colorStyle = getColorStyle(color);
                        return (
                          <button
                            key={color}
                            onClick={() => setSelectedColor(color)}
                            data-testid={`button-select-color-${color}`}
                            title={color}
                            className={`relative w-7 h-7 rounded-md transition-all ${
                              selectedColor === color 
                                ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" 
                                : "hover:scale-110"
                            }`}
                            style={colorStyle}
                          >
                            {isLight && (
                              <span className="absolute inset-0 rounded-md border border-border/40" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    </div>
                  </div>
                ) : null}

                {/* Size - show when product has sizes or sizeStock, but not for active preorders or noSize products */}
                {!isEffectivelyNoSize(product) && (product.sizes?.length > 0 || ((product as any).sizeStock && Object.keys((product as any).sizeStock).length > 0)) && !((product as any).preorderEnabled && (product as any).preorderStatus === "collecting") && (
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-foreground uppercase tracking-wider flex-shrink-0">Размер</label>
                      {isWholesale && (
                        <>
                          <span className="text-xs text-primary font-medium">Остаток</span>
                          {(!((product as any).sizeStock) || Object.keys((product as any).sizeStock || {}).length === 0) && (
                            <span className="text-xs text-primary font-medium">
                              {(product as any).stock ?? 0}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Inline Size Advisor */}
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const sizeStock = (product as any).sizeStock;
                      const hasSizeStock = sizeStock && Object.keys(sizeStock).length > 0;
                      const isPreorderCollecting = (product as any).preorderEnabled && (product as any).preorderStatus === "collecting";
                      const sizeOrder = ["XXS","XS","S","M","L","XL","XXL","2XL","3XL","4XL","5XL"];
                      const sortSizes = (arr: string[]) => [...arr].sort((a, b) => {
                        const ai = sizeOrder.indexOf(a.toUpperCase()), bi = sizeOrder.indexOf(b.toUpperCase());
                        if (ai !== -1 && bi !== -1) return ai - bi;
                        if (ai !== -1) return -1;
                        if (bi !== -1) return 1;
                        return a.localeCompare(b);
                      });
                      const normSzKey = (s: string) => String(s || "").toLowerCase().replace(/[()\s]/g, "");
                      const baseSizes = product.sizes?.length > 0 ? product.sizes : (hasSizeStock ? Object.keys(sizeStock) : []);
                      const allRawSizes = (product.sizes?.length > 0) ? baseSizes : (hasSizeStock ? [...baseSizes, ...Object.keys(sizeStock)] : baseSizes);
                      const seenNorm = new Map<string, string>();
                      for (const s of allRawSizes) { if (!seenNorm.has(normSzKey(s))) seenNorm.set(normSzKey(s), s); }
                      const displaySizes = sortSizes(Array.from(seenNorm.values()));
                      if (displaySizes.length === 0) {
                        return (
                          <button
                            disabled
                            data-testid="button-size-unavailable"
                            className="min-w-10 h-9 px-3 flex items-center justify-center text-sm rounded-full border border-border/50 text-muted-foreground/50 cursor-not-allowed opacity-50"
                          >
                            —
                          </button>
                        );
                      }
                      return displaySizes.map((size: string) => {
                        const normKey = normSzKey(size);
                        const szMatches = hasSizeStock ? Object.entries(sizeStock).filter(([k]) => normSzKey(k) === normKey) : [];
                        const stockCount = szMatches.length > 0 ? Math.max(...szMatches.map(([, v]) => v as number)) : sizeStock?.[size];
                        const isOutOfStock = isPreorderCollecting ? false : (hasSizeStock 
                          ? (stockCount !== undefined && stockCount <= 0) 
                          : ((product.stock ?? 0) <= 0));
                        const isLowStock = !isOutOfStock && hasSizeStock && stockCount !== undefined && stockCount > 0 && stockCount <= 3;
                        return (
                          <div key={size} className="flex flex-col items-center">
                            {isWholesale && hasSizeStock && stockCount !== undefined && (
                              <span className="text-xs text-primary font-medium mb-1">
                                {stockCount > 0 ? stockCount : '0'}
                              </span>
                            )}
                            {isOutOfStock ? (
                              <div className="relative">
                                {((product as any).disabledNotifySizes as string[] | undefined)?.includes(size) ? (
                                  <button
                                    disabled
                                    data-testid={`button-notify-size-${size}-disabled`}
                                    title="Нет в наличии"
                                    className="min-w-11 h-10 px-3 flex items-center justify-center text-sm rounded-full border border-gray-300 text-gray-300 line-through cursor-not-allowed select-none"
                                  >
                                    {size}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setNotifySize(notifySize === size ? null : size);
                                      setSelectedSize("");
                                    }}
                                    data-testid={`button-notify-size-${size}`}
                                    title="Нет в наличии — нажмите для уведомления"
                                    className={`min-w-11 h-10 px-3 flex items-center justify-center text-sm rounded-full transition-all ${
                                      notifySubmitted.has(size)
                                        ? "border border-green-500 text-green-600 bg-green-50 dark:bg-green-950/20"
                                        : notifySize === size
                                          ? "border-2 border-primary text-primary bg-primary/5"
                                          : "border border-red-500 text-muted-foreground hover:border-red-600 hover:text-foreground"
                                    }`}
                                  >
                                    {size}
                                  </button>
                                )}
                                {notifySubmitted.has(size) && <Check className="w-3 h-3 absolute -top-1 -right-1 text-green-600" />}
                              </div>
                            ) : (
                              <div className="relative">
                                <button
                                  onClick={() => setSelectedSize(size)}
                                  data-testid={`button-select-size-${size}`}
                                  className={`min-w-11 h-10 px-3 flex items-center justify-center text-sm font-semibold rounded-full border-2 transition-all ${
                                    selectedSize === size 
                                      ? "border-primary bg-primary text-primary-foreground shadow-sm" 
                                      : "border-foreground/40 bg-card text-foreground hover:border-foreground hover:bg-muted/50"
                                  }`}
                                >
                                  {size}
                                </button>
                                {!isWholesale && sizeDiscountsMap && sizeDiscountsMap[size] && (
                                  <span
                                    data-testid={`text-size-discount-${size}`}
                                    className="absolute -top-2 -right-2 min-w-[22px] h-[18px] flex items-center justify-center text-[9px] font-bold rounded-full bg-red-500 text-white px-1 pointer-events-none"
                                  >
                                    -{sizeDiscountsMap[size]}%
                                  </span>
                                )}
                                {!isWholesale && !isPreorderCollecting && isLowStock && (
                                  <span
                                    data-testid={`text-low-stock-size-${size}`}
                                    className="absolute -bottom-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center text-[9px] font-bold rounded-full border border-orange-400 bg-background text-orange-500 px-0.5 pointer-events-none"
                                  >
                                    {stockCount}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                    </div>

                  {/* Size Advisor trigger button — under size grid, not wholesale */}
                  {!isWholesale && (
                    <button
                      data-testid="button-size-advisor"
                      onClick={() => {
                        setSizeAdvisorOpen(v => !v);
                        setSizeAdvisorResult(null);
                        setSizeAdvisorRecommended(null);
                      }}
                      className="mt-2 sm:mt-1 flex items-center gap-1.5 px-3 sm:px-2.5 py-2 sm:py-1 rounded-xl sm:rounded-lg border border-border/70 hover:border-foreground/40 bg-muted/30 hover:bg-muted/60 transition-all text-xs font-medium text-foreground/70 hover:text-foreground"
                    >
                      <Ruler className="w-3.5 h-3.5 shrink-0" />
                      <span>{sizeAdvisorOpen ? 'Свернуть' : 'Не знаете размер? Подобрать с AI'}</span>
                    </button>
                  )}

                  {/* Inline Size Advisor panel */}
                  {sizeAdvisorOpen && !isWholesale && (
                    <div className="mt-2 p-4 rounded-2xl bg-muted/50 border border-border/60 space-y-3">
                      {sizeAdvisorResult ? (
                        <>
                          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Ruler className="w-3.5 h-3.5 text-primary" />
                            Рекомендация AI
                          </p>
                          <p className="text-sm text-foreground/80 leading-relaxed">{sizeAdvisorResult}</p>
                          {sizeAdvisorRecommended && (
                            <button
                              data-testid="button-size-advisor-apply"
                              onClick={() => { setSelectedSize(sizeAdvisorRecommended!); setSizeAdvisorOpen(false); }}
                              className="w-full py-2.5 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-80 active:scale-[0.98] transition-all"
                            >
                              Выбрать размер {sizeAdvisorRecommended}
                            </button>
                          )}
                          <button
                            onClick={() => { setSizeAdvisorResult(null); setSizeAdvisorRecommended(null); }}
                            className="w-full py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Ввести другие параметры
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                            <Ruler className="w-4 h-4 text-primary" />
                            Подбор размера по параметрам
                          </p>
                          {(() => {
                            const isSuit = ((product as any).measurementSections?.length ?? 0) > 0;
                            const flatMeasurements = (product.measurements as SizeMeasurement[]) || [];
                            const hasWaistInFlat = !isSuit && flatMeasurements.some((m: SizeMeasurement) => !!m.waist);
                            const hasSleeveInFlat = flatMeasurements.some((m: SizeMeasurement) => !!m.sleeves);
                            const nameLowR = (product.name || "").toLowerCase();
                            const isBottomByNameR = ["шорт", "брюк", "джинс", "леггинс", "юбк", "бриджи", "бриджей"].some(kw => nameLowR.includes(kw));
                            const isPants = isBottomByNameR || (hasWaistInFlat && !hasSleeveInFlat);
                            const needsHips = isSuit || isPants;
                            return (
                              <>
                                <div className="flex gap-2">
                                  <div className="flex-1">
                                    <label className="text-xs text-muted-foreground mb-1 block">Рост (см)</label>
                                    <input
                                      type="number"
                                      placeholder="178"
                                      value={sizeAdvisorHeight}
                                      onChange={e => setSizeAdvisorHeight(e.target.value)}
                                      data-testid="input-size-advisor-height"
                                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/60 transition-colors"
                                    />
                                  </div>
                                  <div className="flex-1">
                                    <label className="text-xs text-muted-foreground mb-1 block">
                                      {isSuit ? 'Грудь (см)' : (isPants || hasWaistInFlat) ? 'Талия (см)' : 'Грудь (см)'}
                                    </label>
                                    <input
                                      type="number"
                                      placeholder="96"
                                      value={sizeAdvisorMeasure}
                                      onChange={e => setSizeAdvisorMeasure(e.target.value)}
                                      onKeyDown={e => !needsHips && e.key === 'Enter' && handleSizeAdvisorSubmit()}
                                      data-testid="input-size-advisor-measure"
                                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/60 transition-colors"
                                    />
                                  </div>
                                </div>
                                {needsHips && (
                                  <div className="flex gap-2">
                                    <div className="flex-1">
                                      <label className="text-xs text-muted-foreground mb-1 block">Бёдра (см)</label>
                                      <input
                                        type="number"
                                        placeholder="100"
                                        value={sizeAdvisorHips}
                                        onChange={e => setSizeAdvisorHips(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleSizeAdvisorSubmit()}
                                        data-testid="input-size-advisor-hips"
                                        className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/60 transition-colors"
                                      />
                                    </div>
                                    <div className="flex-1" />
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          <button
                            onClick={handleSizeAdvisorSubmit}
                            disabled={(() => {
                              const isSuit = ((product as any).measurementSections?.length ?? 0) > 0;
                              const fm = (product.measurements as SizeMeasurement[]) || [];
                              const nlD = (product.name || "").toLowerCase();
                              const isBottomD = ["шорт", "брюк", "джинс", "леггинс", "юбк", "бриджи", "бриджей"].some(kw => nlD.includes(kw));
                              const isPants = !isSuit && (isBottomD || (fm.some((m: SizeMeasurement) => !!m.waist) && !fm.some((m: SizeMeasurement) => !!m.sleeves)));
                              return !sizeAdvisorHeight.trim() || !sizeAdvisorMeasure.trim() || ((isSuit || isPants) && !sizeAdvisorHips.trim()) || sizeAdvisorLoading;
                            })()}
                            data-testid="button-size-advisor-submit-inline"
                            className="w-full py-2.5 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-80 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          >
                            {sizeAdvisorLoading
                              ? <><Loader2 className="w-4 h-4 animate-spin" /> Подбираем…</>
                              : 'Подобрать размер'}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {notifySize && !notifySubmitted.has(notifySize) && (
                    <div className="mt-3 space-y-2" data-testid="block-stock-notify">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-primary shrink-0" />
                        <input
                          type="email"
                          value={notifyEmail}
                          onChange={(e) => setNotifyEmail(e.target.value)}
                          placeholder="Ваш email"
                          data-testid="input-notify-email"
                          className="flex-1 h-9 px-3 text-sm rounded-full border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                        />
                        <button
                          onClick={() => {
                            if (!notifyEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
                              toast({ title: "Введите корректный email", variant: "destructive" });
                              return;
                            }
                            if (!notifyConsent) {
                              toast({ title: "Необходимо дать согласие на обработку данных", variant: "destructive" });
                              return;
                            }
                            notifyMutation.mutate({
                              productId: product.id,
                              productName: product.name,
                              size: notifySize,
                              email: notifyEmail,
                            });
                          }}
                          disabled={notifyMutation.isPending}
                          data-testid="button-submit-notify"
                          className="h-9 px-4 text-sm font-medium rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {notifyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Уведомить"}
                        </button>
                      </div>
                      <label className="flex items-start gap-1.5 cursor-pointer" data-testid="label-notify-consent">
                        <input
                          type="checkbox"
                          checked={notifyConsent}
                          onChange={(e) => setNotifyConsent(e.target.checked)}
                          className="mt-0.5 accent-primary"
                          data-testid="checkbox-notify-consent"
                        />
                        <span className="text-[10px] leading-tight text-foreground/60">
                          Я соглашаюсь на обработку персональных данных и получение уведомлений в соответствии с{" "}
                          <a href="/privacy" className="underline hover:text-foreground" target="_blank">политикой конфиденциальности</a>
                        </span>
                      </label>
                    </div>
                  )}
                </div>
                )}
              </div>
            </div>
            )}

            {/* Preorder Block */}
            {(product as any).preorderEnabled && (product as any).preorderStatus === "collecting" && (() => {
              const deadline = (product as any).preorderDeadline;
              const productionDate = (product as any).preorderProductionDate;
              const shippingDate = (product as any).preorderShippingDate;
              const fmtDate = (d: string) => new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
              return (
                <div className="mb-6 p-4 rounded-md border border-primary/20 bg-primary/5" data-testid="block-preorder">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-foreground">Предзаказ</span>
                  </div>
                  <div className="space-y-1.5">
                    {deadline && (
                      <p className="text-xs text-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Сбор до {fmtDate(deadline)}
                      </p>
                    )}
                    {productionDate && (
                      <p className="text-xs text-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        В производстве до {fmtDate(productionDate)}
                      </p>
                    )}
                    {shippingDate && (
                      <p className="text-xs text-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Отправка {fmtDate(shippingDate)}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-foreground mt-3">
                    Полная оплата при оформлении предзаказа
                  </p>
                </div>
              );
            })()}

            {/* Size Advisor for Preorder — shown here because size block is hidden for active preorders */}
            {(product as any).preorderEnabled && (product as any).preorderStatus === "collecting" && !isWholesale && !isEffectivelyNoSize(product) && (product.sizes?.length > 0 || ((product as any).sizeStock && Object.keys((product as any).sizeStock).length > 0)) && (
              <div className="mb-4">
                <button
                  data-testid="button-size-advisor-preorder"
                  onClick={() => { setSizeAdvisorOpen(v => !v); setSizeAdvisorResult(null); setSizeAdvisorRecommended(null); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/70 hover:border-foreground/40 bg-muted/30 hover:bg-muted/60 transition-all text-xs font-medium text-foreground/70 hover:text-foreground"
                >
                  <Ruler className="w-3.5 h-3.5 shrink-0" />
                  <span>{sizeAdvisorOpen ? 'Свернуть' : 'Не знаете размер? Подобрать с AI'}</span>
                </button>
                {sizeAdvisorOpen && (
                  <div className="mt-2 p-4 rounded-2xl bg-muted/50 border border-border/60 space-y-3">
                    {sizeAdvisorResult ? (
                      <>
                        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Ruler className="w-3.5 h-3.5 text-primary" />
                          Рекомендация AI
                        </p>
                        <p className="text-sm text-foreground/80 leading-relaxed">{sizeAdvisorResult}</p>
                        {sizeAdvisorRecommended && (
                          <button
                            onClick={() => { setSelectedSize(sizeAdvisorRecommended!); setSizeAdvisorOpen(false); }}
                            className="w-full py-2.5 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-80 active:scale-[0.98] transition-all"
                          >
                            Выбрать размер {sizeAdvisorRecommended}
                          </button>
                        )}
                        <button
                          onClick={() => { setSizeAdvisorResult(null); setSizeAdvisorRecommended(null); }}
                          className="w-full py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Ввести другие параметры
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <Ruler className="w-4 h-4 text-primary" />
                          Подбор размера по параметрам
                        </p>
                        {(() => {
                          const isSuit = ((product as any).measurementSections?.length ?? 0) > 0;
                          const flatMeasurements = (product.measurements as SizeMeasurement[]) || [];
                          const hasWaistInFlat = !isSuit && flatMeasurements.some((m: SizeMeasurement) => !!m.waist);
                          const hasSleeveInFlat = flatMeasurements.some((m: SizeMeasurement) => !!m.sleeves);
                          const nameLowR = (product.name || "").toLowerCase();
                          const isBottomByNameR = ["шорт", "брюк", "джинс", "леггинс", "юбк", "бриджи", "бриджей"].some(kw => nameLowR.includes(kw));
                          const isPants = isBottomByNameR || (hasWaistInFlat && !hasSleeveInFlat);
                          const needsHips = isSuit || isPants;
                          return (
                            <>
                              <div className="flex gap-2">
                                <div className="flex-1">
                                  <label className="text-xs text-muted-foreground mb-1 block">Рост (см)</label>
                                  <input type="number" placeholder="178" value={sizeAdvisorHeight} onChange={e => setSizeAdvisorHeight(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/60 transition-colors" />
                                </div>
                                <div className="flex-1">
                                  <label className="text-xs text-muted-foreground mb-1 block">
                                    {isSuit ? 'Грудь (см)' : (isPants || hasWaistInFlat) ? 'Талия (см)' : 'Грудь (см)'}
                                  </label>
                                  <input type="number" placeholder="96" value={sizeAdvisorMeasure} onChange={e => setSizeAdvisorMeasure(e.target.value)}
                                    onKeyDown={e => !needsHips && e.key === 'Enter' && handleSizeAdvisorSubmit()}
                                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/60 transition-colors" />
                                </div>
                              </div>
                              {needsHips && (
                                <div className="flex gap-2">
                                  <div className="flex-1">
                                    <label className="text-xs text-muted-foreground mb-1 block">Бёдра (см)</label>
                                    <input type="number" placeholder="100" value={sizeAdvisorHips} onChange={e => setSizeAdvisorHips(e.target.value)}
                                      onKeyDown={e => e.key === 'Enter' && handleSizeAdvisorSubmit()}
                                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/60 transition-colors" />
                                  </div>
                                  <div className="flex-1" />
                                </div>
                              )}
                            </>
                          );
                        })()}
                        <button
                          onClick={handleSizeAdvisorSubmit}
                          disabled={(() => {
                            const isSuit = ((product as any).measurementSections?.length ?? 0) > 0;
                            const fm = (product.measurements as SizeMeasurement[]) || [];
                            const nlD = (product.name || "").toLowerCase();
                            const isBottomD = ["шорт", "брюк", "джинс", "леггинс", "юбк", "бриджи", "бриджей"].some(kw => nlD.includes(kw));
                            const isPants = !isSuit && (isBottomD || (fm.some((m: SizeMeasurement) => !!m.waist) && !fm.some((m: SizeMeasurement) => !!m.sleeves)));
                            return !sizeAdvisorHeight.trim() || !sizeAdvisorMeasure.trim() || ((isSuit || isPants) && !sizeAdvisorHips.trim()) || sizeAdvisorLoading;
                          })()}
                          className="w-full py-2.5 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-80 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {sizeAdvisorLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Подбираем…</> : 'Подобрать размер'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Action Area */}
            {(() => {
              const sizeStockData = (product as any).sizeStock;
              const hasSizeStockData = sizeStockData && Object.keys(sizeStockData).length > 0;
              const allSizesOutOfStock = hasSizeStockData 
                ? Object.values(sizeStockData).every((v: any) => v <= 0)
                : ((product.stock ?? 0) <= 0);
              // Normalize size lookup: legacy data may contain variant keys like
              // "(OneSize)", "One Size", "OneSize" for the same size — take the max
              // among all keys that normalize to the same form instead of an exact match.
              const normalizeSizeKeyLocal = (s: string) => String(s || "").toLowerCase().replace(/[()\s]/g, "");
              const resolveSelectedSizeStock = (): number | undefined => {
                if (!selectedSize || !hasSizeStockData) return undefined;
                if (sizeStockData[selectedSize] !== undefined) {
                  const norm = normalizeSizeKeyLocal(selectedSize);
                  const matches = Object.entries(sizeStockData).filter(([k]) => normalizeSizeKeyLocal(k) === norm);
                  if (matches.length > 1) return Math.max(...matches.map(([, v]: any) => v));
                  return sizeStockData[selectedSize];
                }
                const norm = normalizeSizeKeyLocal(selectedSize);
                const matches = Object.entries(sizeStockData).filter(([k]) => normalizeSizeKeyLocal(k) === norm);
                if (matches.length === 0) return undefined;
                return Math.max(...matches.map(([, v]: any) => v));
              };
              const resolvedSelectedStock = resolveSelectedSizeStock();
              const selectedSizeOutOfStock = selectedSize && hasSizeStockData && resolvedSelectedStock !== undefined && resolvedSelectedStock <= 0;
              const isProductUnavailable = allSizesOutOfStock || selectedSizeOutOfStock;

              if ((product as any).preorderEnabled && (product as any).preorderStatus === "collecting") {
                return <PreorderButton product={product} selectedSize={selectedSize} selectedColor={selectedColor} />;
              }

              // Предзаказ включён, но сбор заявок уже завершён — блокируем обычную покупку
              if ((product as any).preorderEnabled && (product as any).preorderStatus && (product as any).preorderStatus !== "collecting") {
                const statusLabels: Record<string, string> = {
                  production: "Товар в производстве",
                  shipping: "Товар готовится к отправке",
                  shipped: "Товар отправлен участникам предзаказа",
                  cancelled: "Предзаказ отменён",
                };
                const statusLabel = statusLabels[(product as any).preorderStatus] || "Предзаказ завершён";
                return (
                  <div className="mb-8 space-y-3" data-testid="block-preorder-closed">
                    <div className="flex items-center justify-center h-11 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium">
                      {statusLabel}
                    </div>
                    <p className="text-center text-xs text-foreground/50">
                      Приём новых заявок на предзаказ закрыт
                    </p>
                  </div>
                );
              }

              if (allSizesOutOfStock || selectedSizeOutOfStock) {
                const hasSizes = product.sizes?.length > 0;
                const sizeStockKeys = hasSizeStockData ? Object.keys(sizeStockData) : [];
                const allDisplaySizes = hasSizes ? product.sizes : sizeStockKeys;
                const isSingleSize = allDisplaySizes.length <= 1;
                const singleSizeValue = isSingleSize && allDisplaySizes.length === 1 ? allDisplaySizes[0] : null;
                const activeNotifySize = notifySize || (selectedSize && selectedSizeOutOfStock ? selectedSize : null);
                const notifyTargetSize = activeNotifySize || singleSizeValue || (!hasSizes ? "one-size" : "");
                const needsSizeSelection = !isSingleSize && allDisplaySizes.length > 1 && !activeNotifySize && allSizesOutOfStock;
                const alreadySubmitted = notifyTargetSize ? notifySubmitted.has(notifyTargetSize) : false;
                const sizeNotifyFormVisible = !isSingleSize && notifySize;
                return (
                  <div className="mb-8 space-y-3" data-testid="block-out-of-stock-notify">
                    <div className="flex items-center justify-center h-11 rounded-full bg-muted text-foreground/60 text-sm font-medium" data-testid="text-out-of-stock">
                      {activeNotifySize ? `Размер ${activeNotifySize} — нет в наличии` : "Нет в наличии"}
                    </div>
                    {needsSizeSelection ? (
                      <p className="text-center text-primary text-base font-semibold" data-testid="text-select-size-hint">
                        Нажмите на нужный размер выше, чтобы подписаться на уведомление
                      </p>
                    ) : sizeNotifyFormVisible ? null : alreadySubmitted ? (
                      <div className="flex items-center justify-center gap-2 text-sm text-green-600">
                        <Check className="w-4 h-4" />
                        <span>Вы подписаны на уведомление о поступлении — отменить можно в личном кабинете</span>
                      </div>
                    ) : (
                      <div className="space-y-2" data-testid="block-stock-notify-inline">
                        <div className="flex items-center gap-2">
                          <Bell className="w-4 h-4 text-primary shrink-0" />
                          <input
                            type="email"
                            value={notifyEmail}
                            onChange={(e) => setNotifyEmail(e.target.value)}
                            placeholder="Ваш email для уведомления"
                            data-testid="input-notify-email-inline"
                            className="flex-1 h-9 px-3 text-sm rounded-full border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                          />
                          <button
                            onClick={() => {
                              if (!notifyEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
                                toast({ title: "Введите корректный email", variant: "destructive" });
                                return;
                              }
                              if (!notifyConsent) {
                                toast({ title: "Необходимо дать согласие на обработку данных", variant: "destructive" });
                                return;
                              }
                              notifyMutation.mutate({
                                productId: product.id,
                                productName: product.name,
                                size: notifyTargetSize,
                                email: notifyEmail,
                              });
                            }}
                            disabled={notifyMutation.isPending}
                            data-testid="button-submit-notify-inline"
                            className="h-9 px-4 text-sm font-medium rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                          >
                            {notifyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Подписаться"}
                          </button>
                        </div>
                        <label className="flex items-start gap-1.5 cursor-pointer" data-testid="label-notify-consent-inline">
                          <input
                            type="checkbox"
                            checked={notifyConsent}
                            onChange={(e) => setNotifyConsent(e.target.checked)}
                            className="mt-0.5 accent-primary"
                            data-testid="checkbox-notify-consent-inline"
                          />
                          <span className="text-[10px] leading-tight text-foreground/60">
                            Я соглашаюсь на обработку персональных данных и получение уведомлений в соответствии с{" "}
                            <a href="/privacy" className="underline hover:text-foreground" target="_blank">политикой конфиденциальности</a>
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              }

              const detailSizeStock = (product as any).sizeStock as Record<string, number> | null;
              const detailSizeStr = selectedSize || "One Size";
              let detailMaxStock: number;
              if (detailSizeStock && detailSizeStock[detailSizeStr] !== undefined) {
                detailMaxStock = detailSizeStock[detailSizeStr];
              } else if (product.stock !== undefined && product.stock !== null) {
                detailMaxStock = product.stock;
              } else {
                detailMaxStock = 999;
              }
              const isSimpleProduct = !product.sizes?.length && (!detailSizeStock || Object.keys(detailSizeStock).length === 0);
              const isPreorder = (product as any).preorderEnabled && (product as any).preorderStatus === "collecting";
              const showLowStockHint = !isPreorder && isSimpleProduct && detailMaxStock > 0 && detailMaxStock <= 3;
              return (
            <>
            {showLowStockHint && (
              <p className="text-orange-500 text-sm font-medium mb-2" data-testid="text-low-stock-simple">
                Осталось {detailMaxStock} шт.
              </p>
            )}
            <div className="flex items-center gap-3 pt-4 sm:pt-0 border-t border-border sm:border-0 mb-8">
              <div className="flex items-center h-11 border border-border rounded-full bg-card px-1">
                <button 
                  onClick={() => setQuantity(Math.max(wholesaleSockMinQty, quantity - 1))}
                  data-testid="button-quantity-decrease"
                  className="w-9 h-9 flex items-center justify-center text-foreground/60 hover:text-foreground transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-8 text-center text-sm font-medium text-foreground" data-testid="text-quantity-value">{quantity}</span>
                <button 
                  onClick={() => setQuantity(Math.min(detailMaxStock, quantity + 1))}
                  disabled={quantity >= detailMaxStock}
                  data-testid="button-quantity-increase"
                  className="w-9 h-9 flex items-center justify-center text-foreground/60 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              
              <button
                onClick={handleAddToCart}
                data-testid="button-add-to-cart"
                disabled={
                  (product.sizes?.length > 0 && !selectedSize && !hasMultipleSizeRanges && !isEffectivelyNoSize(product)) || 
                  (!hasColorVariants && product.colors?.length > 0 && !selectedColor) || 
                  addToCart.isPending ||
                  !!selectedSizeOutOfStock
                }
                className={`flex-1 h-11 flex items-center justify-center gap-2 text-sm font-medium rounded-full transition-all ${
                  (product.sizes?.length > 0 && !selectedSize && !hasMultipleSizeRanges && !isEffectivelyNoSize(product)) || (!hasColorVariants && product.colors?.length > 0 && !selectedColor) || selectedSizeOutOfStock
                    ? "bg-muted text-foreground/70 cursor-not-allowed"
                    : "bg-foreground text-background hover:bg-foreground/90 active:scale-[0.98]"
                }`}
              >
                {addToCart.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : selectedSizeOutOfStock ? (
                  "Нет в наличии"
                ) : (
                  <>
                    <ShoppingBag className="w-4 h-4" />
                    В корзину
                  </>
                )}
              </button>
            </div>
            </>
              );
            })()}
            
            {((product.sizes?.length > 0 && !selectedSize && !hasMultipleSizeRanges && !isEffectivelyNoSize(product)) || (!hasColorVariants && product.colors?.length > 0 && !selectedColor)) && (
              <p className="mb-4 text-center text-primary text-sm">
                Выберите {product.sizes?.length > 0 && !selectedSize && !hasMultipleSizeRanges && !isEffectivelyNoSize(product) ? "размер" : ""}{product.sizes?.length > 0 && !selectedSize && !hasMultipleSizeRanges && !isEffectivelyNoSize(product) && !hasColorVariants && product.colors?.length > 0 && !selectedColor ? " и " : ""}{!hasColorVariants && product.colors?.length > 0 && !selectedColor ? "цвет" : ""}
              </p>
            )}

            {/* AI-примерка */}
            {allImages.length > 0 && isTryOnSupported && (
              <div className="mb-4">
                <VirtualTryOn
                  garmentImages={allImages}
                  productName={product.name}
                  defaultCategory={tryOnCategory}
                />
              </div>
            )}

            {/* Price Drop Subscription — hidden for active preorders */}
            {!((product as any).preorderEnabled && (product as any).preorderStatus === "collecting") && (
              <>
                {/* Мобиль: полноразмерная кнопка */}
                <div className="sm:hidden mb-6">
                  {priceDropSubscribed ? (
                    <div className="flex items-center justify-center gap-2 py-2 text-sm text-green-600 dark:text-green-400">
                      <Bell className="w-4 h-4 fill-current" />
                      <span>Вы подписаны на снижение цены — отменить можно в личном кабинете</span>
                    </div>
                  ) : (
                    <button
                      onClick={handlePriceDropClick}
                      disabled={isSubscribingPriceDrop}
                      data-testid="button-price-drop-notify"
                      className="w-full flex items-center justify-center gap-2 py-2.5 text-base font-medium text-foreground border border-dashed border-border/60 hover:border-foreground/40 rounded-full transition-all"
                    >
                      {isSubscribingPriceDrop ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingDown className="w-4 h-4" />}
                      Уведомить о снижении цены
                    </button>
                  )}
                </div>

                {/* Десктоп: компактная footer-строка с Dolyame + уведомление */}
                <div className="hidden sm:flex items-center gap-2 text-[11px] text-foreground/80 mb-5 mt-1 flex-wrap">
                  {!isWholesale && salePrice >= 300000 && salePrice <= 3000000 && (
                    <>
                      <span>4 × {formatPrice(Math.round(salePrice / 4))} через Долями</span>
                      <span className="text-foreground/25">·</span>
                    </>
                  )}
                  {priceDropSubscribed ? (
                    <span className="text-green-600 flex items-center gap-1">
                      <Bell className="w-3 h-3 fill-current" />
                      Подписаны на снижение цены
                    </span>
                  ) : (
                    <button
                      onClick={handlePriceDropClick}
                      disabled={isSubscribingPriceDrop}
                      data-testid="button-price-drop-notify-desktop"
                      className="flex items-center gap-1 hover:text-foreground/80 transition-colors disabled:opacity-50"
                    >
                      {isSubscribingPriceDrop ? <Loader2 className="w-3 h-3 animate-spin" /> : <TrendingDown className="w-3 h-3" />}
                      Уведомить о снижении цены
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Product Info Accordion */}
            <Accordion type="multiple" className="w-full border-t border-border">
              {/* Description — если есть seoBody, показываем его вместо plain-text описания */}
              <AccordionItem value="description" className="border-b border-border">
                <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline" data-testid="accordion-description">
                  Описание
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  {(product as any).seoBody ? (
                    <div
                      className="text-sm text-foreground/80 leading-relaxed [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_li]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mb-2 [&_strong]:font-semibold [&_strong]:text-foreground"
                      dangerouslySetInnerHTML={{ __html: (product as any).seoBody }}
                      data-testid="content-seo-body"
                    />
                  ) : (
                    <div className="max-h-[220px] overflow-y-auto pr-1">
                      <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                        {product.description}
                      </p>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Measurements - multi-section (suits) or single table */}
              {((product as any).measurementSections?.length > 0 || (product.measurements && (product.measurements as SizeMeasurement[]).length > 0)) && (
                <AccordionItem value="measurements" className="border-b border-border">
                  <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline" data-testid="accordion-measurements">
                    Таблица размеров
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    {(() => {
                      const ml = (product as any).measurementLabels || {};
                      const lbl = (field: string, def: string) => ml[field] || def;
                      return (product as any).measurementSections?.length > 0 ? (
                      /* Multi-section: Верх + Низ (костюм) */
                      <div className="space-y-4">
                        {((product as any).measurementSections as Array<{ title: string; rows: SizeMeasurement[] }>).map((section, sIdx) => {
                          const rows = section.rows;
                          const hasWaist = rows.some(r => r.waist);
                          const hasHips = rows.some(r => r.hips);
                          const hasSideLength = rows.some(r => r.sideLength);
                          const hasBottomWidth = rows.some(r => r.bottomWidth);
                          const hasLength = rows.some(r => r.length);
                          const hasShoulders = rows.some(r => r.shoulders);
                          const hasChest = rows.some(r => r.chest);
                          const hasSleeves = rows.some(r => r.sleeves);
                          return (
                            <div key={sIdx}>
                              <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wide mb-2">{section.title}</p>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-border">
                                      <th className="py-2 pr-4 text-left font-medium text-foreground">Размер</th>
                                      {hasWaist && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("waist","Шир. в поясе")}</th>}
                                      {hasHips && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("hips","Шир. в бёдрах")}</th>}
                                      {hasSideLength && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("sideLength","Дл. по боковому")}</th>}
                                      {hasBottomWidth && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("bottomWidth","Шир. входа в низу")}</th>}
                                      {hasLength && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("length","Длина")}</th>}
                                      {hasShoulders && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("shoulders","Плечи")}</th>}
                                      {hasChest && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("chest","Грудь")}</th>}
                                      {hasSleeves && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("sleeves","Рукав")}</th>}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((row, rIdx) => (
                                      <tr key={rIdx} className="border-b border-border/50">
                                        <td className="py-2 pr-4 font-medium text-foreground">{row.size}</td>
                                        {hasWaist && <td className="py-2 px-2 text-foreground/75">{row.waist || "—"}</td>}
                                        {hasHips && <td className="py-2 px-2 text-foreground/75">{row.hips || "—"}</td>}
                                        {hasSideLength && <td className="py-2 px-2 text-foreground/75">{row.sideLength || "—"}</td>}
                                        {hasBottomWidth && <td className="py-2 px-2 text-foreground/75">{row.bottomWidth || "—"}</td>}
                                        {hasLength && <td className="py-2 px-2 text-foreground/75">{row.length || "—"}</td>}
                                        {hasShoulders && <td className="py-2 px-2 text-foreground/75">{row.shoulders || "—"}</td>}
                                        {hasChest && <td className="py-2 px-2 text-foreground/75">{row.chest || "—"}</td>}
                                        {hasSleeves && <td className="py-2 px-2 text-foreground/75">{row.sleeves || "—"}</td>}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* Single table */
                      <div className="max-h-[220px] overflow-auto">
                        <table className="w-full text-sm">
                          {(() => {
                            const rows = product.measurements as SizeMeasurement[];
                            const hasLength = rows.some(r => r.length);
                            const hasChest = rows.some(r => r.chest);
                            const hasShoulders = rows.some(r => r.shoulders);
                            const hasSleeves = rows.some(r => r.sleeves);
                            const hasWaist = rows.some(r => r.waist);
                            const hasHips = rows.some(r => r.hips);
                            const hasSideLength = rows.some(r => r.sideLength);
                            const hasBottomWidth = rows.some(r => r.bottomWidth);
                            const isPants = hasWaist && !hasSleeves;
                            return (
                              <>
                                <thead>
                                  <tr className="border-b border-border">
                                    <th className="py-2 pr-4 text-left font-medium text-foreground">Размер</th>
                                    {hasWaist && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("waist","Шир. в поясе")}</th>}
                                    {hasHips && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("hips","Шир. в бёдрах")}</th>}
                                    {hasSideLength && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("sideLength","Дл. по боковому")}</th>}
                                    {hasBottomWidth && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("bottomWidth","Шир. входа в низу")}</th>}
                                    {hasLength && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("length","Длина")}</th>}
                                    {hasShoulders && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("shoulders","Плечи")}</th>}
                                    {hasChest && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("chest","Грудь")}</th>}
                                    {hasSleeves && !isPants && <th className="py-2 px-2 text-left font-medium text-foreground">{lbl("sleeves","Рукав")}</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((row, idx) => (
                                    <tr key={idx} className="border-b border-border/50">
                                      <td className="py-2 pr-4 font-medium text-foreground">{row.size}</td>
                                      {hasWaist && <td className="py-2 px-2 text-foreground/75">{row.waist || "—"}</td>}
                                      {hasHips && <td className="py-2 px-2 text-foreground/75">{row.hips || "—"}</td>}
                                      {hasSideLength && <td className="py-2 px-2 text-foreground/75">{row.sideLength || "—"}</td>}
                                      {hasBottomWidth && <td className="py-2 px-2 text-foreground/75">{row.bottomWidth || "—"}</td>}
                                      {hasLength && <td className="py-2 px-2 text-foreground/75">{row.length || "—"}</td>}
                                      {hasShoulders && <td className="py-2 px-2 text-foreground/75">{row.shoulders || "—"}</td>}
                                      {hasChest && <td className="py-2 px-2 text-foreground/75">{row.chest || "—"}</td>}
                                      {hasSleeves && !isPants && <td className="py-2 px-2 text-foreground/75">{row.sleeves || "—"}</td>}
                                    </tr>
                                  ))}
                                </tbody>
                              </>
                            );
                          })()}
                        </table>
                      </div>
                    ); })()}
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Characteristics — HTML block from admin when filled, otherwise falls back to Состав/Уход fields */}
              {((product as any).specsHtml || product.composition || product.careInstructions) && (
              <AccordionItem value="care" className="border-b border-border">
                <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline" data-testid="accordion-care">
                  Характеристики
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  {(product as any).specsHtml ? (
                    <div
                      className="max-h-[220px] overflow-y-auto pr-1 text-sm text-foreground/80 leading-relaxed [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_li]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mb-2 [&_strong]:font-semibold [&_strong]:text-foreground"
                      dangerouslySetInnerHTML={{ __html: (product as any).specsHtml }}
                      data-testid="content-specs-html"
                    />
                  ) : (
                    <div className="max-h-[220px] overflow-y-auto pr-1 space-y-3 text-sm text-foreground/80">
                      {product.composition && (
                        <p><span className="text-foreground font-medium">Состав:</span> {product.composition}</p>
                      )}
                      {product.careInstructions && (
                        <p><span className="text-foreground font-medium">Уход:</span> {product.careInstructions}</p>
                      )}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
              )}

              {/* Note */}
              {(product as any).note && (
              <AccordionItem value="note" className="border-b border-border">
                <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline" data-testid="accordion-note">
                  Примечание
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="max-h-[220px] overflow-y-auto pr-1 text-sm text-foreground/80 whitespace-pre-line">
                    {(product as any).note}
                  </div>
                </AccordionContent>
              </AccordionItem>
              )}

              {!isWholesale && (
              <AccordionItem value="delivery" className="border-b border-border">
                <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline" data-testid="accordion-delivery">
                  Доставка и возврат
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="max-h-[220px] overflow-y-auto pr-1 space-y-3 text-sm text-foreground/80">
                    <p><span className="text-foreground font-medium">Доставка:</span> {(product as any).delivery || "По всей России от 2-х дней. Бесплатно при заказе от 5000 ₽"}</p>
                    <p><span className="text-foreground font-medium">Возврат:</span> {(product as any).returnPolicy || "14 дней на возврат товара надлежащего качества"}</p>
                  </div>
                </AccordionContent>
              </AccordionItem>
              )}
            </Accordion>
          </div>
          
          {/* Image Gallery - Hidden on mobile, 2-up layout on desktop */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="hidden lg:block order-2 lg:order-1"
          >
            {(() => {
              const n = allImages.length;
              if (n === 0) return null;
              const maxIdx = Math.max(0, n - 2);
              const displayIdx = Math.min(safeImageIndex, maxIdx);
              return (
                <div ref={galleryRef} className="relative">
                  <div className="overflow-hidden w-full">
                    <div
                      className="flex"
                      style={{
                        transform: `translateX(-${(displayIdx / n) * 100}%)`,
                        transition: 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
                        width: `${n * 50}%`,
                      }}
                    >
                      {allImages.map((imgUrl, i) => {
                        const key = `img-${i}`;
                        const ZOOM_STEPS = [1, 2, 3];
                        const currentZoom = zoomLevels[key] ?? 1;
                        const isZoomed = currentZoom > 1;
                        const zoomStepIdx = ZOOM_STEPS.indexOf(currentZoom);
                        const atMax = zoomStepIdx === ZOOM_STEPS.length - 1;
                        return (
                          <div
                            key={i}
                            className="flex-shrink-0 aspect-[3/4] overflow-hidden relative select-none"
                            style={{ width: `${100 / n}%`, cursor: 'none' }}
                            onMouseEnter={() => {
                              const el = zoomCursorEls.current.get(i);
                              if (el) el.style.display = 'flex';
                            }}
                            onMouseMove={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const px = e.clientX - rect.left;
                              const py = e.clientY - rect.top;
                              const cursorEl = zoomCursorEls.current.get(i);
                              if (cursorEl) {
                                cursorEl.style.left = `${px - 16}px`;
                                cursorEl.style.top = `${py - 16}px`;
                              }
                              if (isZoomed) {
                                const imgEl = zoomImgEls.current.get(i);
                                if (imgEl) imgEl.style.transformOrigin = `${(px / rect.width) * 100}% ${(py / rect.height) * 100}%`;
                              }
                            }}
                            onMouseLeave={() => {
                              const el = zoomCursorEls.current.get(i);
                              if (el) el.style.display = 'none';
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              const ox = ((e.clientX - rect.left) / rect.width) * 100;
                              const oy = ((e.clientY - rect.top) / rect.height) * 100;
                              if (atMax) {
                                setZoomLevels(prev => ({ ...prev, [key]: 1 }));
                                const imgEl = zoomImgEls.current.get(i);
                                if (imgEl) imgEl.style.transformOrigin = '50% 50%';
                              } else {
                                const nextZoom = ZOOM_STEPS[zoomStepIdx + 1];
                                setZoomLevels(prev => ({ ...prev, [key]: nextZoom }));
                                const imgEl = zoomImgEls.current.get(i);
                                if (imgEl) imgEl.style.transformOrigin = `${ox}% ${oy}%`;
                              }
                            }}
                            data-testid={`img-container-desktop-${i}`}
                          >
                            <img
                              ref={(el) => {
                                zoomImgEls.current.set(i, el);
                                if (el && i === 0) el.setAttribute('fetchpriority', 'high');
                              }}
                              src={imgUrl}
                              alt={getImageAlt(i)}
                              loading={i <= 1 ? "eager" : "lazy"}
                              decoding={i <= 1 ? "sync" : "async"}
                              className="w-full h-full object-cover pointer-events-none"
                              style={{
                                transform: `scale(${currentZoom})`,
                                transformOrigin: '50% 50%',
                                transition: 'transform 0.2s ease-out',
                              }}
                              data-testid={`img-product-desktop-${i}`}
                            />
                            <div
                              ref={(el) => zoomCursorEls.current.set(i, el)}
                              className="absolute z-20 pointer-events-none items-center justify-center w-8 h-8 rounded-full bg-black/60 text-white"
                              style={{ display: 'none', position: 'absolute', left: 0, top: 0 }}
                            >
                              {atMax ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {n > 2 && (
                    <>
                      <button
                        onClick={prevImage}
                        disabled={displayIdx === 0}
                        data-testid="button-prev-desktop"
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-background/80 backdrop-blur-sm text-foreground rounded-full flex items-center justify-center hover:bg-background transition-colors disabled:opacity-0 shadow-md z-10"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        onClick={nextImage}
                        disabled={displayIdx >= maxIdx}
                        data-testid="button-next-desktop"
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-background/80 backdrop-blur-sm text-foreground rounded-full flex items-center justify-center hover:bg-background transition-colors disabled:opacity-0 shadow-md z-10"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </>
                  )}
                </div>
              );
            })()}
            {allImages.length > 2 && (
              <div className="flex justify-center gap-1.5 mt-3">
                {Array.from({ length: allImages.length - 1 }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentImageIndex(i)}
                    data-testid={`button-dot-desktop-${i}`}
                    className={`rounded-full transition-all duration-200 ${i === Math.min(safeImageIndex, allImages.length - 2) ? 'w-5 h-1.5 bg-foreground' : 'w-1.5 h-1.5 bg-foreground/30 hover:bg-foreground/50'}`}
                  />
                ))}
              </div>
            )}
            {/* Desktop video block */}
            {videoUrl && (
              <div className="mt-4">
                <video
                  src={videoUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  controls
                  className="w-full rounded-lg object-cover"
                  data-testid="video-product-desktop"
                />
              </div>
            )}
            {/* Feature badges — desktop (below image gallery) */}
            {(() => {
              const badgeIds: string[] = Array.isArray((product as any).featureBadgeIds) ? (product as any).featureBadgeIds : [];
              if (badgeIds.length === 0) return null;
              const templates = (featureBadgeTemplatesData || {}) as Record<string, { icon?: string; title?: string; description?: string }>;
              const badges = badgeIds.map((id) => templates[id]).filter((t): t is { icon?: string; title?: string; description?: string } => !!t && !!t.title);
              if (badges.length === 0) return null;
              return (
                <div className="grid grid-cols-3 gap-x-3 gap-y-2 mt-4" data-testid="section-feature-badges-desktop">
                  {badges.map((b, idx) => {
                    const Icon = getFeatureBadgeIcon(b.icon);
                    return (
                      <div key={idx} className="flex items-start gap-2" data-testid={`badge-feature-desktop-${idx}`}>
                        <div className="w-7 h-7 rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                          <Icon className="w-3.5 h-3.5 text-foreground/60" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-foreground leading-tight">{b.title}</p>
                          {b.description && <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{b.description}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </motion.div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/92 flex items-center justify-center"
          onClick={() => { if (!lightboxZoomed) setLightboxOpen(false); }}
          data-testid="lightbox-overlay"
        >
          <div className="relative" onClick={e => e.stopPropagation()}>
            <ZoomableLightboxImage
              src={allImages[lightboxImgIdx]}
              alt={getImageAlt(lightboxImgIdx)}
              className="max-w-[92vw] max-h-[92vh] object-contain rounded-sm"
              resetKey={`${lightboxOpen}-${lightboxImgIdx}`}
              onZoomChange={setLightboxZoomed}
              data-testid="lightbox-image"
            />
            {!lightboxZoomed && (
              <button
                className="absolute top-2 right-2 text-black bg-white/80 hover:bg-white rounded-full p-2 transition-colors z-10"
                onClick={() => { setLightboxOpen(false); setLightboxZoomed(false); }}
                data-testid="button-lightbox-close"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {!lightboxZoomed && lightboxImgIdx > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2.5 transition-colors"
              onClick={e => { e.stopPropagation(); setLightboxImgIdx(i => i - 1); }}
              data-testid="button-lightbox-prev"
            >
              <ChevronLeft className="w-7 h-7" />
            </button>
          )}

          {!lightboxZoomed && lightboxImgIdx < allImages.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2.5 transition-colors"
              onClick={e => { e.stopPropagation(); setLightboxImgIdx(i => i + 1); }}
              data-testid="button-lightbox-next"
            >
              <ChevronRight className="w-7 h-7" />
            </button>
          )}

          {!lightboxZoomed && allImages.length > 1 && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2">
              {allImages.map((_, i) => (
                <button
                  key={i}
                  onClick={e => { e.stopPropagation(); setLightboxImgIdx(i); }}
                  className={`rounded-full transition-all duration-200 ${i === lightboxImgIdx ? 'w-5 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/40 hover:bg-white/70'}`}
                  data-testid={`button-lightbox-dot-${i}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Price Drop Email Dialog */}
      <Dialog open={priceDropDialogOpen} onOpenChange={setPriceDropDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-primary" />
              Снижение цены
            </DialogTitle>
            <DialogDescription>
              Введите email — мы пришлём письмо, когда цена на «{product.name}» снизится.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <Input
              type="email"
              placeholder="ваш@email.ru"
              value={priceDropEmail}
              onChange={e => setPriceDropEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handlePriceDropSubmit()}
              data-testid="input-price-drop-email"
              autoFocus
            />
            <Button
              onClick={handlePriceDropSubmit}
              disabled={!priceDropEmail.trim() || isSubscribingPriceDrop}
              className="w-full"
              data-testid="button-price-drop-submit"
            >
              {isSubscribingPriceDrop ? <Loader2 className="w-4 h-4 animate-spin" /> : "Подписаться"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Gallery Overlay */}
      <AnimatePresence>
        {isGalleryOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm"
            onClick={() => setIsGalleryOpen(false)}
          >
            <div className="absolute top-4 right-4 z-10">
              <button
                onClick={() => setIsGalleryOpen(false)}
                data-testid="button-close-gallery"
                className="w-12 h-12 bg-foreground/10 text-foreground rounded-full flex items-center justify-center hover:bg-foreground/20 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="h-full overflow-y-auto py-16 px-4">
              <div className="max-w-4xl mx-auto">
                <p className="text-center text-muted-foreground text-sm mb-6">Нажмите на фото для выбора</p>
                <div 
                  className="grid grid-cols-2 md:grid-cols-3 gap-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {allImages.map((img, idx) => (
                    <motion.button
                      key={idx}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 0.05 }}
                      onClick={() => {
                        setCurrentImageIndex(idx);
                        setIsGalleryOpen(false);
                      }}
                      data-testid={`button-gallery-image-${idx}`}
                      className={`aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all hover:scale-[1.02] ${
                        idx === safeImageIndex ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-border'
                      }`}
                    >
                      <img 
                        src={getThumbForImage(img)} 
                        alt={getImageAlt(idx)} 
                        title={getImageTitle(idx)}
                        className="w-full h-full object-cover"
                        onError={(e) => { if (img && e.currentTarget.src !== img) e.currentTarget.src = img; }}
                      />
                    </motion.button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {lookData && (lookData.products.length > 0 || lookData.categoryProducts.length > 0) && (
        <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14" data-testid="section-complete-look">
          <div className="mb-6 sm:mb-8">
            <h2 className="text-xl sm:text-2xl font-semibold text-foreground tracking-tight" data-testid="text-complete-look-title">
              Дополните свой образ
            </h2>
            <p className="text-sm text-foreground/70 mt-1">Сочетайте с этими вещами для цельного look</p>
          </div>

          {lookData.products.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
              {lookData.products.map((item: any) => {
                const itemPrice = isWholesale && item.wholesalePrice 
                  ? item.wholesalePrice 
                  : item.price;
                return (
                  <Link 
                    key={item.id} 
                    href={`/${item.slug || item.id}`}
                    className="group block"
                    data-testid={`card-look-product-${item.id}`}
                  >
                    <div className="relative aspect-[3/4] rounded-md overflow-hidden bg-muted mb-2">
                      <img
                        src={item.thumbnailUrl || item.imageUrl}
                        alt={`${item.name} BOOOMERANGS${item.category ? `, ${item.category}` : ""}`}
                        title={item.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => { if (item.imageUrl && e.currentTarget.src !== item.imageUrl) e.currentTarget.src = item.imageUrl; }}
                      />
                      {item.badgeText && typeof item.badgeText === 'string' && item.badgeText.length > 0 && (
                        <Badge className="absolute top-2 left-2 text-[10px]" variant="default">
                          {item.badgeText}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium text-foreground truncate" data-testid={`text-look-name-${item.id}`}>
                      {item.name}
                    </p>
                    <p className="text-sm text-foreground/70" data-testid={`text-look-price-${item.id}`}>
                      {itemPrice ? `${(itemPrice / 100).toLocaleString('ru-RU')} ₽` : ''}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}

          {lookData.categoryProducts.length > 0 && lookData.lookCategory && (
            <div>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                <h3 className="text-lg font-medium text-foreground">
                  {CATEGORIES[lookData.lookCategory as CategorySlug]?.name || lookData.lookCategory}
                  {lookData.lookSubcategory && ` → ${lookData.lookSubcategory}`}
                </h3>
                <Link
                  href={lookData.lookSubcategory ? `/products/${lookData.lookCategory}/${transliterateToSlug(lookData.lookSubcategory)}` : `/products/${lookData.lookCategory}`}
                  className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors font-medium"
                  data-testid="link-look-category"
                >
                  Смотреть все
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {lookData.categoryProducts.map((item: any) => {
                  const itemPrice = isWholesale && item.wholesalePrice 
                    ? item.wholesalePrice 
                    : item.price;
                  return (
                    <Link 
                      key={item.id} 
                      href={`/${item.slug || item.id}`}
                      className="group block"
                      data-testid={`card-look-cat-product-${item.id}`}
                    >
                      <div className="relative aspect-[3/4] rounded-md overflow-hidden bg-muted mb-2">
                        <img
                          src={item.thumbnailUrl || item.imageUrl}
                          alt={`${item.name} BOOOMERANGS${item.category ? `, ${item.category}` : ""}`}
                          title={item.name}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                          onError={(e) => { if (item.imageUrl && e.currentTarget.src !== item.imageUrl) e.currentTarget.src = item.imageUrl; }}
                        />
                        {item.badgeText && typeof item.badgeText === 'string' && item.badgeText.length > 0 && (
                          <Badge className="absolute top-2 left-2 text-[10px]" variant="default">
                            {item.badgeText}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium text-foreground truncate" data-testid={`text-look-cat-name-${item.id}`}>
                        {item.name}
                      </p>
                      <p className="text-sm text-foreground/70" data-testid={`text-look-cat-price-${item.id}`}>
                        {itemPrice ? `${(itemPrice / 100).toLocaleString('ru-RU')} ₽` : ''}
                      </p>
                    </Link>
                  );
                })}
                <Link
                  href={lookData.lookSubcategory ? `/products/${lookData.lookCategory}/${transliterateToSlug(lookData.lookSubcategory)}` : `/products/${lookData.lookCategory}`}
                  className="flex flex-col items-center justify-center aspect-[3/4] rounded-md border-2 border-dashed border-muted-foreground/20 hover:border-primary/40 transition-colors group"
                  data-testid="link-look-category-more"
                >
                  <ArrowRight className="w-8 h-8 text-muted-foreground group-hover:text-primary transition-colors mb-2" />
                  <span className="text-sm text-muted-foreground group-hover:text-primary transition-colors font-medium">
                    Все {lookData.lookSubcategory || CATEGORIES[lookData.lookCategory as CategorySlug]?.name?.toLowerCase() || "товары"}
                  </span>
                </Link>
              </div>
            </div>
          )}
        </section>
      )}

      {product && (
        <RecommendationBlock
          productId={product.id}
          title="С этим часто берут"
        />
      )}

      {recentlyViewedProducts && recentlyViewedProducts.length > 0 && (
        <section className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="section-recently-viewed">
          <h2 className="text-xl font-semibold mb-4 text-foreground">Недавно просмотренные</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {recentlyViewedProducts.slice(0, 6).map((p: any) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      <ReviewSection productId={product.id} />
      <Footer />
    </div>
  );
}

function PreorderButton({ product, selectedSize, selectedColor }: { product: any; selectedSize: string; selectedColor: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { addOrUpdateItem, items: preorderCartItems } = usePreorderCart();
  const { openDrawer: openPreorderCartDrawer } = usePreorderCartDrawer();
  const [sizeQuantities, setSizeQuantities] = useState<Record<string, number>>({});
  const [justAdded, setJustAdded] = useState(false);

  const SIZE_ORDER = ["XXS","XS","S","M","L","XL","XXL","XXXL","ONE SIZE","OS"];
  const sizeStockData = (product as any).sizeStock;
  const availableSizes: string[] = (() => {
    const fromStock = sizeStockData && Object.keys(sizeStockData).length > 0 ? Object.keys(sizeStockData) : [];
    const fromSizes = product.sizes?.length > 0 ? product.sizes : [];
    const all = Array.from(new Set([...fromSizes, ...fromStock]));
    return all.length > 0 ? [...all].sort((a, b) => {
      const ia = SIZE_ORDER.indexOf(a), ib = SIZE_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1; if (ib === -1) return -1;
      return ia - ib;
    }) : [];
  })();
  const totalItems = Object.values(sizeQuantities).reduce((s, q) => s + q, 0);
  const discountPct = (product as any).discountPercent || 0;
  const productFixedPrice: number = (product as any).salePrice || 0;
  const salePrice = productFixedPrice > 0 && productFixedPrice < product.price
    ? productFixedPrice
    : (discountPct > 0 ? Math.round(product.price * (1 - discountPct / 100)) : product.price);

  function changeQty(size: string, delta: number) {
    setSizeQuantities(prev => {
      const cur = prev[size] || 0;
      const next = Math.max(0, cur + delta);
      const updated = { ...prev, [size]: next };
      if (next === 0) delete updated[size];
      return updated;
    });
  }

  
  const alreadyInCart = preorderCartItems.some(i => i.productId === product.id);

  function handleAddToCart() {
    if (availableSizes.length === 0) {
      addOrUpdateItem({
        productId: product.id,
        productName: product.name,
        price: salePrice,
        imageUrl: product.thumbnailUrl || product.imageUrl || "",
        selectedSizes: { "ONE SIZE": 1 },
        selectedColor: selectedColor || undefined,
      });
      openPreorderCartDrawer();
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1800);
      return;
    }
    if (totalItems === 0) {
      if (alreadyInCart) {
        setLocation("/predrop/checkout");
      } else {
        toast({ title: "Выберите размер", variant: "destructive" });
      }
      return;
    }
    addOrUpdateItem({
      productId: product.id,
      productName: product.name,
      price: salePrice,
      imageUrl: product.thumbnailUrl || product.imageUrl || "",
      selectedSizes: { ...sizeQuantities },
      selectedColor: selectedColor || undefined,
    });
    setSizeQuantities({});
    openPreorderCartDrawer();
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1800);
  }

  return (
    <div className="mb-8 space-y-4" data-testid="preorder-action">
      {availableSizes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-foreground uppercase tracking-wide shrink-0">Размер и количество</p>
            {totalItems > 0 && (
              <div className="text-right">
                <div className="text-xs font-medium text-foreground">
                  {Object.entries(sizeQuantities).filter(([,q]) => q > 0).map(([size, qty]) => `${size} × ${qty}`).join(", ")}
                </div>
                <div className="text-xs text-foreground">{totalItems} шт. · {(totalItems * salePrice / 100).toLocaleString("ru-RU")} ₽</div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {availableSizes.map((size) => {
              const qty = sizeQuantities[size] || 0;
              return (
                <div
                  key={size}
                  className={`relative flex flex-col items-center gap-2.5 py-3 px-2 rounded-2xl border-2 transition-all ${qty > 0 ? "border-primary bg-primary/8 shadow-sm" : "border-border/60 bg-muted/30 hover:border-border"}`}
                  data-testid={`size-qty-${size}`}
                >
                  {qty > 0 && (
                    <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shadow-sm">{qty}</span>
                  )}
                  <span className={`text-sm font-bold tracking-wide leading-none ${qty > 0 ? "text-primary" : "text-foreground"}`}>{size}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => changeQty(size, -1)}
                      disabled={qty === 0}
                      className={`w-6 h-6 flex items-center justify-center rounded-full text-base font-medium leading-none transition-all disabled:opacity-20 ${qty > 0 ? "bg-primary/15 text-primary hover:bg-primary/25" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      data-testid={`button-qty-minus-${size}`}
                    >−</button>
                    <span className={`w-5 text-center text-sm font-bold leading-none tabular-nums ${qty > 0 ? "text-primary" : "text-muted-foreground"}`}>{qty}</span>
                    <button
                      type="button"
                      onClick={() => changeQty(size, 1)}
                      className={`w-6 h-6 flex items-center justify-center rounded-full text-base font-medium leading-none transition-all ${qty > 0 ? "bg-primary/15 text-primary hover:bg-primary/25" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      data-testid={`button-qty-plus-${size}`}
                    >+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <Button
        onClick={handleAddToCart}
        className={`w-full h-11 rounded-full text-sm font-medium transition-all ${justAdded ? "bg-green-600 hover:bg-green-600" : ""}`}
        data-testid="button-preorder-add-to-cart"
      >
        {justAdded ? (
          <>
            <Check className="w-4 h-4 mr-2" />
            Добавлено в корзину предзаказов
          </>
        ) : totalItems > 0 ? (
          <>
            <ShoppingCart className="w-4 h-4 mr-2" />
            {alreadyInCart
              ? `Добавить ещё ${totalItems} шт. — ${(totalItems * salePrice / 100).toLocaleString("ru-RU")} ₽`
              : `В корзину предзаказов — ${(totalItems * salePrice / 100).toLocaleString("ru-RU")} ₽`}
          </>
        ) : alreadyInCart ? (
          <>
            <ShoppingCart className="w-4 h-4 mr-2" />
            Перейти к оформлению →
          </>
        ) : availableSizes.length > 0 ? (
          <>
            <ShoppingCart className="w-4 h-4 mr-2" />
            Выберите размер
          </>
        ) : (
          <>
            <ShoppingCart className="w-4 h-4 mr-2" />
            В корзину предзаказов
          </>
        )}
      </Button>
    </div>
  );
}
