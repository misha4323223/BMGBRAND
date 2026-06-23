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
import { Minus, Plus, ShoppingBag, ShoppingCart, ChevronLeft, ChevronRight, Loader2, X, Percent, Heart, ArrowRight, Target, Clock, Landmark, Share2, Check, Home, ZoomIn, ZoomOut, Bell, TrendingUp, TrendingDown, LogIn, AlertTriangle, MapPin, Truck, RotateCcw, Gift, Ruler } from "lucide-react";
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
import { CATEGORIES, transliterateToSlug, type CategorySlug, type SizeMeasurement } from "@shared/schema";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useFavorites } from "@/hooks/use-favorites";
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
        name: product.name,
        price: product.price ? Math.round(product.price / 100) : 0,
        description: (product as any).description || "",
        composition: (product as any).composition || "",
        color: (product as any).color || "",
        sizeStock: (product as any).sizeStock || {},
        stock: (product as any).stock ?? 0,
        category: (product as any).category || "",
        subcategory: (product as any).subcategory || "",
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
  const { isFavorite, toggleFavorite, isLoggedIn: isFavLoggedIn } = useFavorites();
  const { viewedIds, addViewed } = useRecentlyViewed();
  
  const id = product?.id || 0;

  const { data: productReviews = [] } = useQuery<{ rating: number; comment?: string | null; authorName: string; createdAt?: string }[]>({
    queryKey: ["/api/reviews", id],
    enabled: !!id,
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
      setSelectedSize("(OneSize)");
    }
  }, [(product as any)?.id, isEffectivelyNoSize(product)]);
  const [quantity, setQuantity] = useState(1);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [hintCopied, setHintCopied] = useState(false);
  const isHint = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("hint") === "1";
  const [hintBannerVisible, setHintBannerVisible] = useState(true);
  const [zoomPos, setZoomPos] = useState<{ x: number; y: number } | null>(null);
  const [zoomEnabled, setZoomEnabled] = useState(false);
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
    setPairIdx(0);
    if (product?.id) addViewed(product.id);
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
  const mediaItems = useMemo<Array<{type: 'video'|'image', url: string}>>(() => {
    const items: Array<{type: 'video'|'image', url: string}> = [];
    if (videoUrl) items.push({ type: 'video', url: videoUrl });
    allImages.forEach(url => items.push({ type: 'image', url }));
    return items;
  }, [videoUrl, allImages]);
  const pairCount = Math.ceil(mediaItems.length / 2) || 1;
  const [pairIdx, setPairIdx] = useState(0);
  
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
    if (!sizeAdvisorHeight.trim() || !sizeAdvisorMeasure.trim() || sizeAdvisorLoading) return;
    setSizeAdvisorLoading(true);
    setSizeAdvisorResult(null);
    setSizeAdvisorRecommended(null);
    try {
      localStorage.setItem('sa_height', sizeAdvisorHeight.trim());
      localStorage.setItem('sa_measure', sizeAdvisorMeasure.trim());
    } catch {}
    const measurements = (product.measurements as SizeMeasurement[]) || [];
    const hasWaist = measurements.some((m: SizeMeasurement) => !!m.waist);
    const measureLabel = hasWaist ? 'обхват талии' : 'обхват груди';
    const msgText = `Подберите мне размер для товара "${product.name}". Мой рост: ${sizeAdvisorHeight} см, ${measureLabel}: ${sizeAdvisorMeasure} см.`;
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
  const wholesalePriceValue = getWholesalePrice(product.price, (product as any).wholesalePrice);
  const displayPrice = wholesalePriceValue ? formatPrice(wholesalePriceValue) : retailPrice;
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

  const origin = window.location.origin;
  const productUrl = `${origin}/${product.slug || product.id}`;
  const productImage = product.imageUrl?.startsWith("http") ? product.imageUrl : `${origin}${product.imageUrl || "/favicon.png"}`;

  const categoryName = product.category || "";
  const selectedColorName = hasColorVariants
    ? (colorVariants?.find(v => v.id === product.id)?.color || "")
    : (selectedColor || "");
  const sizesText = product.sizes?.length > 0 ? product.sizes.join(", ") : "";

  const isMerchProduct = ["merch", "мерч"].includes(((product as any).category || "").toLowerCase());
  const autoSeoTitle = `${product.name}${selectedColorName ? ` ${selectedColorName}` : ""} — купить${isMerchProduct ? " мерч" : ""}`;
  const seoTitle = product.seoTitle || autoSeoTitle;

  const seoDescParts = [
    isMerchProduct
      ? `Купить мерч ${product.name} BOOOMERANGS`
      : `Купить ${product.name} BOOOMERANGS`,
    selectedColorName ? `цвет: ${selectedColorName}` : "",
    sizesText ? `Размеры: ${sizesText}.` : "",
    "Доставка по России СДЭК и Яндекс Доставкой.",
    product.description ? product.description.slice(0, 80) : "",
  ].filter(Boolean);
  const autoSeoDescription = seoDescParts.join(" ").slice(0, 220);
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

  const productJsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": product.name,
      "description": product.description || `${product.name} — купить в BMGBRAND`,
      "image": allProductImages.length > 0 ? allProductImages : [productImage],
      "url": productUrl,
      "sku": (product as any).article || product.sku || product.id,
      "brand": { "@type": "Brand", "name": "BMGBRAND" },
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
        "seller": { "@type": "Organization", "name": "BMGBRAND" },
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
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": origin },
        { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${origin}/products` },
        ...(product.category ? [{ "@type": "ListItem", "position": 3, "name": product.category, "item": `${origin}/products/${encodeURIComponent(product.category)}` }] : []),
        { "@type": "ListItem", "position": product.category ? 4 : 3, "name": product.name, "item": productUrl },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={seoTitle}
        description={seoDescription}
        keywords={seoKeywords}
        ogType="product"
        ogImage={product.imageUrl || "/favicon.png"}
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
        <div className="flex flex-col lg:grid lg:grid-cols-[3fr_2fr] gap-6 lg:gap-10">
          
          {/* Mobile Image Gallery - Top on mobile */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="lg:hidden mb-4"
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg">
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
          </motion.div>

          {/* Details */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col order-1 lg:order-2"
          >
            <div className="flex flex-col mb-4 sm:mb-6">
              <span className="font-mono text-muted-foreground text-[10px] uppercase tracking-[0.3em] block mb-2" data-testid={`text-category-${product.id}`}>{product.category}</span>

              {/* ── Мобильная раскладка: заголовок + 3 равных кнопки ── */}
              <div className="sm:hidden">
                <h1 className="text-base font-semibold leading-snug text-foreground mb-3" data-testid={`text-product-name-${product.id}`}>
                  {displayName(product.name)}
                </h1>
                <div className={`grid gap-2 ${isWholesale ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  <button
                    onClick={() => toggleFavorite(product.id)}
                    className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl border border-border/60 hover:border-foreground/30 transition-all duration-200"
                    data-testid={`button-favorite-detail-${product.id}`}
                  >
                    <Heart className={`w-4 h-4 transition-colors duration-200 ${isFavorite(product.id) ? 'fill-primary text-primary' : 'text-foreground/60'}`} />
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

              {/* ── Десктопная раскладка: оригинал ── */}
              <div className="hidden sm:flex items-start justify-between gap-3">
                <h1 className="text-3xl font-semibold leading-tight text-foreground" data-testid={`text-product-name-${product.id}`}>
                  {displayName(product.name)}
                </h1>
                <button
                  onClick={() => toggleFavorite(product.id)}
                  className="shrink-0 mt-1 w-10 h-10 flex items-center justify-center rounded-full border border-border/60 hover:border-foreground/40 transition-all duration-200"
                  data-testid={`button-favorite-detail-${product.id}`}
                >
                  <Heart className={`w-5 h-5 transition-colors duration-200 ${isFavorite(product.id) ? 'fill-primary text-primary' : 'text-foreground/60'}`} />
                </button>
                <button
                  onClick={async () => {
                    const url = window.location.href;
                    if (navigator.share) { try { await navigator.share({ title: product.name, url }); } catch {} }
                    else { await navigator.clipboard.writeText(url); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); }
                  }}
                  className="shrink-0 mt-1 w-10 h-10 flex items-center justify-center rounded-full border border-border/60 hover:border-foreground/40 transition-all duration-200"
                  data-testid={`button-share-product-${product.id}`}
                  title="Поделиться"
                >
                  {linkCopied ? <Check className="w-5 h-5 text-primary" /> : <Share2 className="w-5 h-5 text-foreground/60" />}
                </button>
                {!isWholesale && (
                  <button
                    onClick={async () => {
                      const url = `${window.location.origin}${window.location.pathname}?hint=1`;
                      await navigator.clipboard.writeText(url);
                      setHintCopied(true);
                      setTimeout(() => setHintCopied(false), 2000);
                    }}
                    className="shrink-0 mt-1 flex items-center gap-2 px-4 h-11 rounded-full border border-border/60 transition-all duration-200 text-sm font-medium text-foreground/70 hover:text-foreground hover:border-foreground/40"
                    data-testid={`button-hint-product-${product.id}`}
                    title="Намекнуть"
                  >
                    {hintCopied ? <Check className="w-5 h-5 text-primary" /> : <Gift className="w-5 h-5" />}
                    {hintCopied ? "Ссылка скопирована" : "Намекнуть"}
                  </button>
                )}
              </div>
              <div className="border-t border-border my-3 sm:my-4"></div>
              <div className="space-y-1" data-testid={`text-product-price-${product.id}`}>
                {showPreorderPriceLabels && (
                  <p className="text-xs font-medium text-foreground uppercase tracking-wide">Предпродажная цена</p>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  <p className={`text-2xl sm:text-3xl font-bold ${hasDiscount ? 'text-red-600' : isWholesale ? 'text-primary' : 'text-foreground'}`}>
                    {hasDiscount ? formatPrice(salePrice) : displayPrice}
                  </p>
                  {hasDiscount && (
                    <>
                      <span className="text-lg font-semibold text-red-400 line-through">{retailPrice}</span>
                    </>
                  )}
                  {isWholesale && wholesalePriceValue && (
                    <>
                      <span className="text-lg text-foreground/45 line-through">{retailPrice}</span>
                      <Badge variant="secondary">ОПТ</Badge>
                    </>
                  )}
                </div>
                {showPreorderPriceLabels && (
                  <p className="text-xs text-foreground">
                    Цена после релиза — {retailPrice} · <span className="font-medium text-foreground">экономите {formatPrice(product.price - salePrice)}</span>
                  </p>
                )}
              </div>
              {!isWholesale && salePrice >= 300000 && salePrice <= 3000000 && (
                <DolyameWidget
                  price={salePrice}
                  isDark={false}
                  isMinta={false}
                  productId={product.id}
                />
              )}
            </div>
            

            {/* Compact Selectors Grid - always show size selector */}
            {(hasColorVariants || product.colors.length > 0 || !hasMultipleSizeRanges) && (
            <div className="space-y-6 mb-8">
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
                      const baseSizes = product.sizes?.length > 0 ? product.sizes : (hasSizeStock ? Object.keys(sizeStock) : []);
                      const displaySizes = hasSizeStock
                        ? sortSizes(Array.from(new Set([...baseSizes, ...Object.keys(sizeStock)])))
                        : sortSizes(baseSizes);
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
                        const stockCount = sizeStock?.[size];
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
                      className="mt-2 flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:border-foreground/40 bg-muted/40 hover:bg-muted/70 transition-all text-sm font-medium text-foreground/70 hover:text-foreground"
                    >
                      <Ruler className="w-4 h-4 shrink-0" />
                      <span>{sizeAdvisorOpen ? 'Свернуть подбор размера' : 'Не знаете свой размер? Подобрать с AI'}</span>
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
                                {(() => {
                                  const m = (product.measurements as SizeMeasurement[]) || [];
                                  return m.some((x: SizeMeasurement) => !!x.waist) ? 'Талия (см)' : 'Грудь (см)';
                                })()}
                              </label>
                              <input
                                type="number"
                                placeholder="96"
                                value={sizeAdvisorMeasure}
                                onChange={e => setSizeAdvisorMeasure(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSizeAdvisorSubmit()}
                                data-testid="input-size-advisor-measure"
                                className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/60 transition-colors"
                              />
                            </div>
                          </div>
                          <button
                            onClick={handleSizeAdvisorSubmit}
                            disabled={!sizeAdvisorHeight.trim() || !sizeAdvisorMeasure.trim() || sizeAdvisorLoading}
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

            {/* Action Area */}
            {(() => {
              const sizeStockData = (product as any).sizeStock;
              const hasSizeStockData = sizeStockData && Object.keys(sizeStockData).length > 0;
              const allSizesOutOfStock = hasSizeStockData 
                ? Object.values(sizeStockData).every((v: any) => v <= 0)
                : ((product.stock ?? 0) <= 0);
              const selectedSizeOutOfStock = selectedSize && hasSizeStockData && sizeStockData[selectedSize] !== undefined && sizeStockData[selectedSize] <= 0;
              const isProductUnavailable = allSizesOutOfStock || selectedSizeOutOfStock;

              if ((product as any).preorderEnabled && (product as any).preorderStatus === "collecting") {
                return <PreorderButton product={product} selectedSize={selectedSize} selectedColor={selectedColor} />;
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
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
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

            {/* Price Drop Subscription — hidden for active preorders */}
            {!((product as any).preorderEnabled && (product as any).preorderStatus === "collecting") && (
              <div className="mb-6">
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
                    {isSubscribingPriceDrop ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <TrendingDown className="w-4 h-4" />
                    )}
                    Уведомить о снижении цены
                  </button>
                )}
              </div>
            )}

            {/* Product Info Accordion */}
            <Accordion type="multiple" className="w-full border-t border-border">
              {/* Description */}
              <AccordionItem value="description" className="border-b border-border">
                <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline" data-testid="accordion-description">
                  Описание
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <p className="text-sm text-foreground/80 leading-relaxed">
                    {product.description}
                  </p>
                </AccordionContent>
              </AccordionItem>

              {/* Measurements - show for any product that has measurements data */}
              {product.measurements && (product.measurements as SizeMeasurement[]).length > 0 && (
                <AccordionItem value="measurements" className="border-b border-border">
                  <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline" data-testid="accordion-measurements">
                    Таблица размеров
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        {(() => {
                          const rows = product.measurements as SizeMeasurement[];
                          const hasLength = rows.some(r => r.length);
                          const hasChest = rows.some(r => r.chest);
                          const hasShoulders = rows.some(r => r.shoulders);
                          const hasSleeves = rows.some(r => r.sleeves);
                          const hasWaist = rows.some(r => r.waist);
                          const hasHips = rows.some(r => r.hips);
                          const isPants = hasWaist && !hasSleeves;
                          return (
                            <>
                              <thead>
                                <tr className="border-b border-border">
                                  <th className="py-2 pr-4 text-left font-medium text-foreground">Размер</th>
                                  {hasWaist && <th className="py-2 px-2 text-left font-medium text-foreground">{isPants ? "Шир. по талии" : "Талия"}</th>}
                                  {hasHips && <th className="py-2 px-2 text-left font-medium text-foreground">{isPants ? "Шир. по бёдрам" : "Бёдра"}</th>}
                                  {hasLength && <th className="py-2 px-2 text-left font-medium text-foreground">{isPants ? "Дл. внутр. шва" : "Длина"}</th>}
                                  {hasShoulders && <th className="py-2 px-2 text-left font-medium text-foreground">{isPants ? "Дл. бокового шва" : "Плечи"}</th>}
                                  {hasChest && <th className="py-2 px-2 text-left font-medium text-foreground">{isPants ? "Шир. по низу" : "Грудь"}</th>}
                                  {hasSleeves && !isPants && <th className="py-2 px-2 text-left font-medium text-foreground">Рукав</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row) => (
                                  <tr key={row.size} className="border-b border-border/50">
                                    <td className="py-2 pr-4 font-medium text-foreground">{row.size}</td>
                                    {hasWaist && <td className="py-2 px-2 text-foreground/75">{row.waist || "—"}</td>}
                                    {hasHips && <td className="py-2 px-2 text-foreground/75">{row.hips || "—"}</td>}
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
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Composition & Care */}
              {(product.composition || product.careInstructions) && (
              <AccordionItem value="care" className="border-b border-border">
                <AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:no-underline" data-testid="accordion-care">
                  Состав и уход
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="space-y-3 text-sm text-foreground/80">
                    {product.composition && (
                      <p><span className="text-foreground font-medium">Состав:</span> {product.composition}</p>
                    )}
                    {product.careInstructions && (
                      <p><span className="text-foreground font-medium">Уход:</span> {product.careInstructions}</p>
                    )}
                  </div>
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
                  <div className="text-sm text-foreground/80 whitespace-pre-line">
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
                  <div className="space-y-3 text-sm text-foreground/80">
                    <p><span className="text-foreground font-medium">Доставка:</span> {(product as any).delivery || "По всей России от 2-х дней. Бесплатно при заказе от 5000 ₽"}</p>
                    <p><span className="text-foreground font-medium">Возврат:</span> {(product as any).returnPolicy || "14 дней на возврат товара надлежащего качества"}</p>
                  </div>
                </AccordionContent>
              </AccordionItem>
              )}
            </Accordion>
          </motion.div>
          
          {/* Image Gallery - Hidden on mobile, 2-up layout on desktop */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="hidden lg:block order-2 lg:order-1"
          >
            {(() => {
              const leftItem = mediaItems[pairIdx * 2];
              const rightItem = mediaItems[pairIdx * 2 + 1];
              const isSingle = !rightItem;
              const getAlt = (itemIdx: number) => {
                const imgIdx = videoUrl ? itemIdx - 1 : itemIdx;
                return imgIdx >= 0 ? getImageAlt(imgIdx) : '';
              };
              const renderItem = (item: {type: 'video'|'image', url: string}, itemIdx: number, key: string) => (
                <div key={key} className={`${isSingle ? 'w-full' : 'flex-1'} aspect-[3/4] overflow-hidden`}>
                  {item.type === 'video' ? (
                    <video
                      src={item.url}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full h-full object-cover"
                      data-testid={`video-product-desktop-${key}`}
                    />
                  ) : (
                    <img
                      ref={itemIdx === 0 ? (el => { if (el) el.setAttribute('fetchpriority', 'high'); }) : undefined}
                      src={item.url}
                      alt={getAlt(itemIdx)}
                      loading={itemIdx === 0 ? "eager" : "lazy"}
                      decoding={itemIdx === 0 ? "sync" : "async"}
                      className="w-full h-full object-cover"
                      data-testid={`img-product-desktop-${key}`}
                    />
                  )}
                </div>
              );
              return (
                <div className="relative">
                  <div className="flex">
                    {leftItem && renderItem(leftItem, pairIdx * 2, 'left')}
                    {rightItem && renderItem(rightItem, pairIdx * 2 + 1, 'right')}
                  </div>
                  {pairCount > 1 && (
                    <>
                      <button
                        onClick={() => setPairIdx(i => Math.max(0, i - 1))}
                        disabled={pairIdx === 0}
                        data-testid="button-prev-pair-desktop"
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-background/80 backdrop-blur-sm text-foreground rounded-full flex items-center justify-center hover:bg-background transition-colors disabled:opacity-0 shadow-md"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setPairIdx(i => Math.min(pairCount - 1, i + 1))}
                        disabled={pairIdx === pairCount - 1}
                        data-testid="button-next-pair-desktop"
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-background/80 backdrop-blur-sm text-foreground rounded-full flex items-center justify-center hover:bg-background transition-colors disabled:opacity-0 shadow-md"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </>
                  )}
                </div>
              );
            })()}
            {pairCount > 1 && (
              <div className="flex justify-center gap-1.5 mt-3">
                {Array.from({ length: pairCount }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPairIdx(i)}
                    data-testid={`button-pair-dot-${i}`}
                    className={`rounded-full transition-all duration-200 ${i === pairIdx ? 'w-5 h-1.5 bg-foreground' : 'w-1.5 h-1.5 bg-foreground/30 hover:bg-foreground/50'}`}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </div>

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
      toast({ title: "Добавлено в корзину предзаказов", description: product.name });
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
    toast({ title: "Добавлено в корзину предзаказов", description: product.name });
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
