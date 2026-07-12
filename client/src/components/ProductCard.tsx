import { Link } from "wouter";
import { useState, useEffect, useRef, memo, useMemo, useCallback } from "react";
import { Product } from "@shared/schema";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, ExternalLink, Minus, Plus, X, Percent, ChevronLeft, ChevronRight, Flame, Bell, Check, Loader2, ArrowUpRight } from "lucide-react";
import { ProductMiniChat } from "./ProductMiniChat";
import { useCart, useAddToCart } from "@/hooks/use-cart";
import { useToast } from "@/hooks/use-toast";
import { useWholesalePrice } from "@/hooks/use-auth";
import { useFavoriteStatus, useFavoriteActions } from "@/hooks/use-favorites";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useColorVariants, ColorVariant } from "@/hooks/use-products";
import { DolyameWidget } from "@/components/DolyameWidget";

function toThumbUrl(url: string): string {
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

// Memoized formatter at module level - created once
const priceFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 0,
});

const formatPrice = (cents: number) => priceFormatter.format(cents / 100);
const displayName = (name: string) => name.replace(/\bBOOOMERANGS\b/gi, '').replace(/\bBMGBRAND\b/gi, '').replace(/\s{2,}/g, ' ').trim();

const STANDARD_SIZES = new Set(["XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL"]);
function isEffectivelyNoSize(product: any): boolean {
  if (product?.noSize) return true;
  const sizes: string[] = product?.sizes || [];
  const sizeStockKeys: string[] = product?.sizeStock ? Object.keys(product.sizeStock) : [];
  const allSizes = sizes.length > 0 ? sizes : sizeStockKeys;
  return allSizes.length === 1 && !STANDARD_SIZES.has(allSizes[0]);
}

interface ProductCardProps {
  product: Product;
  priority?: boolean;
  isJDM?: boolean;
  isMinta?: boolean;
  isMerch?: boolean;
}

function ProductCardInner({ product, priority = false, isJDM = false, isMinta = false, isMerch = false }: ProductCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [shouldLoad, setShouldLoad] = useState(priority);
  const [isHovered, setIsHovered] = useState(false);
  const [hoverImageLoaded, setHoverImageLoaded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [modalImageIndex, setModalImageIndex] = useState(0);
  const [cardImageIndex, setCardImageIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef<number>(0);
  const wasSwipedRef = useRef(false);
  const cardTouchStartX = useRef<number | null>(null);
  const cardTouchDeltaX = useRef<number>(0);
  const cardWasSwiped = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { mutate: addItem } = useAddToCart();
  const { toast } = useToast();
  const { isWholesale, getWholesalePrice } = useWholesalePrice();
  
  const isFav = useFavoriteStatus(product.id);
  const { toggleFavorite, isLoggedIn } = useFavoriteActions();
  const [sockQty, setSockQty] = useState(1);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifySubmitted, setNotifySubmitted] = useState<Set<string>>(new Set());
  const [notifySize, setNotifySize] = useState<string | null>(null);
  const [notifyConsent, setNotifyConsent] = useState(false);

  const isSocks = product.category === 'socks';
  const showWholesaleOverlay = isWholesale && isSocks;

  const [activeVariantId, setActiveVariantId] = useState<number | null>(null);
  const [dolyameOpen, setDolyameOpen] = useState(false);

  const { data: variants } = useColorVariants(product.id, isModalOpen);
  const hasVariants = variants && variants.length > 1;

  const { data: variantProductData } = useQuery({
    queryKey: ['/api/products', activeVariantId, 'modal-detail'],
    queryFn: async () => {
      const res = await fetch(`/api/products/${activeVariantId}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!activeVariantId && activeVariantId !== product.id && isModalOpen,
    staleTime: 5 * 60 * 1000,
  });

  const activeProduct = (variantProductData ?? product) as typeof product;

  const sizeStockData = (product as any).sizeStock;
  const hasSizeStockData = sizeStockData && Object.keys(sizeStockData).length > 0;
  const isProductOutOfStock = hasSizeStockData
    ? Object.values(sizeStockData).every((v: any) => v <= 0)
    : (product.stock !== undefined && product.stock !== null && product.stock <= 0);
  const sizeStockKeys = hasSizeStockData ? Object.keys(sizeStockData as Record<string, number>) : [];
  const sizeStockTotal = sizeStockKeys.reduce((sum: number, k: string) => sum + (Number((sizeStockData as Record<string, number>)[k]) || 0), 0);
  const singleSockSize = sizeStockKeys.length === 1 ? sizeStockKeys[0] : undefined;

  const notifyMutation = useMutation({
    mutationFn: async (data: { productId: number; productName: string; size: string; email: string }) => {
      const res = await apiRequest("POST", "/api/stock-notify", data);
      return res.json();
    },
    onSuccess: (_data: any, variables: { productId: number; productName: string; size: string; email: string }) => {
      setNotifySubmitted(prev => new Set(prev).add(variables.size));
      setNotifySize(null);
      setNotifyEmail("");
      toast({ title: "Готово!", description: "Мы уведомим вас, когда товар появится в наличии" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось оформить подписку", variant: "destructive" });
    },
  });

  // Memoize computed values
  const cardImagesCount = product.images ? product.images.length : 0;
  const imageUrl = useMemo(() => {
    if (product.images && product.images.length > 0) {
      const idx = cardImageIndex > 0 ? Math.min(cardImageIndex, product.images.length - 1) : fallbackIndex;
      return toThumbUrl(product.images[idx]);
    }
    return product.imageUrl || product.thumbnailUrl;
  }, [product.thumbnailUrl, product.imageUrl, product.images, fallbackIndex, cardImageIndex]);
  const hoverImageUrl = useMemo(() => {
    const hoverIdx = fallbackIndex === 0 ? 1 : (fallbackIndex === 1 ? 2 : 1);
    if (product.images && product.images.length > hoverIdx) return toThumbUrl(product.images[hoverIdx]);
    if (product.images && product.images.length > 1) return toThumbUrl(product.images[1]);
    if ((product as any).hoverThumbnailUrl) return (product as any).hoverThumbnailUrl;
    return null;
  }, [(product as any).hoverThumbnailUrl, product.images, fallbackIndex]);
  const retailPrice = useMemo(() => formatPrice(product.price), [product.price]);
  const wholesalePrice = useMemo(() => getWholesalePrice(product.price, (product as any).wholesalePrice), [product.price, (product as any).wholesalePrice, getWholesalePrice]);
  const displayPrice = useMemo(() => wholesalePrice ? formatPrice(wholesalePrice) : retailPrice, [wholesalePrice, retailPrice]);
  const discountPct = (product as any).discountPercent;
  const productSalePrice = (product as any).salePrice;
  const hasDiscount = ((productSalePrice && productSalePrice > 0 && productSalePrice < product.price) || (discountPct && discountPct > 0)) && !wholesalePrice;
  const salePrice = productSalePrice && productSalePrice > 0 && productSalePrice < product.price
    ? productSalePrice
    : (discountPct && discountPct > 0 ? Math.round(product.price * (1 - discountPct / 100)) : product.price);
  
  useEffect(() => {
    if (priority && product.thumbnailUrl) {
      const img = new Image();
      img.src = product.thumbnailUrl;
    }
  }, [priority, product.thumbnailUrl]);

  useEffect(() => {
    if (priority || shouldLoad) return;
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { 
        rootMargin: "300px",
        threshold: 0.01 
      }
    );
    
    if (cardRef.current) {
      observer.observe(cardRef.current);
    }
    
    return () => observer.disconnect();
  }, [priority, shouldLoad]);

  useEffect(() => {
    if (!isModalOpen) {
      setActiveVariantId(null);
      setSelectedSize(null);
      setModalImageIndex(0);
      setNotifySize(null);
      setNotifySubmitted(new Set());
    }
  }, [isModalOpen]);

  useEffect(() => {
    setSelectedSize(null);
    setModalImageIndex(0);
    setNotifySize(null);
    setNotifySubmitted(new Set());
  }, [activeVariantId]);

  const activeSizeStockData = (activeProduct as any).sizeStock;
  const hasActiveSizeStockData = activeSizeStockData && Object.keys(activeSizeStockData).length > 0;
  const isActiveProductOutOfStock = hasActiveSizeStockData
    ? Object.values(activeSizeStockData).every((v: any) => v <= 0)
    : (activeProduct.stock !== undefined && activeProduct.stock !== null && activeProduct.stock <= 0);
  const activeDiscountPct = (activeProduct as any).discountPercent;
  const activeProductFixedPrice: number = (activeProduct as any).salePrice || 0;
  const activeWholesalePrice = getWholesalePrice(activeProduct.price, (activeProduct as any).wholesalePrice);
  const activeSizeDiscountsMap = (activeProduct as any).sizeDiscounts as Record<string, number> | null | undefined;
  const activeSizeDiscount = (!isWholesale && activeSizeDiscountsMap && selectedSize && activeSizeDiscountsMap[selectedSize]) ? activeSizeDiscountsMap[selectedSize] : null;
  const effectiveActiveDiscountPct = activeSizeDiscount ?? activeDiscountPct;
  const activeHasFixedPrice = activeProductFixedPrice > 0 && activeProductFixedPrice < activeProduct.price && !activeWholesalePrice;
  const activeHasDiscount = (activeHasFixedPrice || (effectiveActiveDiscountPct && effectiveActiveDiscountPct > 0)) && !activeWholesalePrice;
  const activeSalePrice = activeHasFixedPrice
    ? activeProductFixedPrice
    : (activeHasDiscount ? Math.round(activeProduct.price * (1 - (effectiveActiveDiscountPct || 0) / 100)) : activeProduct.price);
  const activeRetailPrice = formatPrice(activeProduct.price);
  const activeDisplayPrice = activeWholesalePrice ? formatPrice(activeWholesalePrice) : activeRetailPrice;
  const isModalPreorderCollecting = (activeProduct as any).preorderEnabled && (activeProduct as any).preorderStatus === "collecting";
  const showModalPreorderLabels = isModalPreorderCollecting && !!activeHasDiscount;

  const handleAddToCart = () => {
    const activeSizeStock = (activeProduct as any).sizeStock as Record<string, number> | null;
    const activeSizeStockKeys = activeSizeStock ? Object.keys(activeSizeStock) : [];
    const autoSize = selectedSize || (activeSizeStockKeys.length === 1 ? activeSizeStockKeys[0] : undefined);

    if (activeProduct.sizes?.length > 0 && !selectedSize && !isEffectivelyNoSize(activeProduct)) {
      toast({
        title: "Выберите размер",
        variant: "destructive",
      });
      return;
    }
    addItem({ 
      productId: activeProduct.id, 
      quantity, 
      size: autoSize,
      color: selectedColor || undefined
    });
    setSelectedSize("");
    setQuantity(1);
  };

  const sockStockRaw = product.stock ?? 0;
  const sockMaxStock = sockStockRaw > 0 ? sockStockRaw : sizeStockTotal;
  const handleSockQuickAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (sockMaxStock <= 0) {
      toast({ title: "Нет в наличии", variant: "destructive" });
      return;
    }
    const qty = Math.min(sockQty, sockMaxStock);
    addItem({
      productId: product.id,
      quantity: qty,
      size: singleSockSize,
    });
    toast({ title: `${product.name}`, description: `Добавлено: ${qty} шт.` });
    setSockQty(1);
  };

  return (
    <div ref={cardRef} className="group cursor-pointer block relative -mr-px w-[calc(100%+1px)] hover:z-10" style={{ contain: 'layout style paint' }} data-testid={`product-card-${product.id}`}>
      <Dialog open={isModalOpen} onOpenChange={(open) => {
        setIsModalOpen(open);
        if (!open) {
          setIsDescriptionExpanded(false);
          setModalImageIndex(0);
        }
      }}>
        <div 
          onClick={() => {
            if (cardWasSwiped.current) { cardWasSwiped.current = false; return; }
            if (!showWholesaleOverlay) setIsModalOpen(true);
          }}
          onMouseEnter={() => { if (hoverImageUrl) setIsHovered(true); }}
          onMouseLeave={() => setIsHovered(false)}
          onTouchStart={(e) => {
            cardTouchStartX.current = e.touches[0].clientX;
            cardTouchDeltaX.current = 0;
          }}
          onTouchMove={(e) => {
            if (cardTouchStartX.current !== null) {
              cardTouchDeltaX.current = e.touches[0].clientX - cardTouchStartX.current;
            }
          }}
          onTouchEnd={() => {
            if (cardImagesCount > 1 && Math.abs(cardTouchDeltaX.current) > 40) {
              cardWasSwiped.current = true;
              if (cardTouchDeltaX.current < -40) {
                setCardImageIndex(prev => (prev + 1) % cardImagesCount);
              } else {
                setCardImageIndex(prev => (prev - 1 + cardImagesCount) % cardImagesCount);
              }
              setImageLoaded(false);
            }
            cardTouchStartX.current = null;
            cardTouchDeltaX.current = 0;
          }}
          className="relative overflow-hidden bg-muted w-full"
          style={{ aspectRatio: '971 / 1504' }}>
            <div
              className={`absolute inset-0 flex items-center justify-center bg-muted transition-opacity duration-200 ${
                imageLoaded || imageError ? 'opacity-0 pointer-events-none' : 'opacity-100'
              }`}
            >
              <div className="w-6 h-6 border-2 border-muted-foreground/20 border-t-muted-foreground/60 rounded-full animate-spin" />
            </div>
            
            {imageError && (
              <div className="absolute inset-0 bg-muted flex items-center justify-center">
                <span className="text-muted-foreground text-xs">Нет фото</span>
              </div>
            )}
            
            {shouldLoad && (
              <img 
                ref={el => { if (el && priority) el.setAttribute('fetchpriority', 'high'); }}
                src={imageUrl ?? undefined} 
                alt={`${product.name} BOOOMERANGS${product.category ? `, ${product.category}` : ""}`}
                title={product.name}
                decoding="async"
                sizes="(max-width: 480px) 46vw, (max-width: 768px) 45vw, (max-width: 1024px) 30vw, 280px"
                loading={priority ? "eager" : "lazy"}
                onLoad={() => setImageLoaded(true)}
                onError={() => {
                  const maxFallback = product.images ? product.images.length - 1 : 0;
                  if (fallbackIndex < maxFallback) {
                    setFallbackIndex(prev => prev + 1);
                    setImageLoaded(false);
                  } else {
                    setImageError(true);
                  }
                }}
                className={`absolute inset-0 w-full h-full object-cover ${
                  priority ? '' : 'transition-opacity duration-300'
                } ${
                  imageLoaded ? (isHovered && hoverImageLoaded ? 'opacity-0' : 'opacity-100') : 'opacity-0'
                }`}
              />
            )}
            
            {shouldLoad && hoverImageUrl && cardImageIndex === 0 && (
              <img
                src={hoverImageUrl}
                alt={`${product.name} BOOOMERANGS${product.category ? `, ${product.category}` : ""}, вид сзади`}
                title={product.name}
                decoding="async"
                sizes="(max-width: 480px) 46vw, (max-width: 768px) 45vw, (max-width: 1024px) 30vw, 280px"
                onLoad={() => setHoverImageLoaded(true)}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                  isHovered && hoverImageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
              />
            )}

            
            <button
              onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }}
              className={`absolute top-2 left-2 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-background/80 backdrop-blur-sm border transition-all duration-200 ${dolyameOpen ? 'opacity-0 pointer-events-none' : ''}`}
              style={isFav ? { background: 'rgba(249,115,22,0.15)', borderColor: 'rgba(249,115,22,0.5)' } : { borderColor: 'hsl(var(--border) / 0.5)' }}
              aria-label={isFav ? "Убрать из избранного" : "Добавить в избранное"}
              data-testid={`button-favorite-${product.id}`}
            >
              <Flame
                className="w-4 h-4 transition-colors duration-200"
                style={{ color: isFav ? '#f97316' : undefined }}
                fill={isFav ? '#f97316' : 'none'}
                strokeWidth={2}
              />
            </button>

            <div className={`absolute top-2 right-2 flex flex-col gap-1 z-10 transition-opacity duration-150 ${dolyameOpen ? 'opacity-0 pointer-events-none' : ''}`}>
              {hasDiscount ? (
                <span className="bg-white text-black px-2 py-0.5 text-[9px] sm:text-[10px] font-bold tracking-widest uppercase">
                  -{discountPct}%
                </span>
              ) : product.isNew && product.createdAt && (Date.now() - new Date(product.createdAt).getTime()) < 30 * 24 * 60 * 60 * 1000 && (
                <span className="bg-black text-white px-2 py-0.5 text-[9px] sm:text-[10px] font-medium tracking-widest uppercase">
                  {(() => {
                    const bt = (product as any).badgeText;
                    if (typeof bt === 'string' && bt.trim().length > 0) return bt.trim();
                    if (bt && typeof bt === 'object' && 'data' in bt) {
                      try {
                        const decoded = new TextDecoder().decode(new Uint8Array(bt.data)).trim();
                        return decoded.length > 0 ? decoded : "NEW";
                      } catch (e) {
                        return "NEW";
                      }
                    }
                    return "NEW";
                  })()}
                </span>
              )}
              {!hasSizeStockData && !isProductOutOfStock && (product.stock ?? 0) > 0 && (product.stock ?? 0) <= 3 && (
                <span className="bg-white text-black px-2 py-0.5 text-[9px] sm:text-[10px] font-medium tracking-wide" data-testid={`badge-low-stock-${product.id}`}>
                  Осталось {product.stock} шт.
                </span>
              )}
            </div>

            {showWholesaleOverlay && (
              <div
                className="absolute inset-0 z-10 flex flex-col items-center justify-end pb-3 px-3 bg-gradient-to-t from-black/70 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                onClick={(e) => e.stopPropagation()}
                data-testid={`overlay-sock-wholesale-${product.id}`}
              >
                <div className="w-full space-y-2">
                  <div className="flex items-center justify-between text-black text-xs">
                    <span className="font-medium">{product.sku || product.name?.slice(0, 20)}</span>
                    <span className="opacity-80">В наличии: {sockMaxStock}</span>
                  </div>
                  <div className="flex items-center gap-1 w-full">
                    <div className="flex items-center bg-white/20 backdrop-blur-sm rounded-md shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); setSockQty(Math.max(1, sockQty - 1)); }}
                        className="text-black h-7 w-7"
                        data-testid={`button-sock-minus-${product.id}`}
                      >
                        <Minus className="w-3 h-3" />
                      </Button>
                      <input
                        type="number"
                        min={1}
                        max={sockMaxStock}
                        value={sockQty}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          const raw = e.target.value;
                          if (raw === "") { setSockQty(1); return; }
                          const n = parseInt(raw, 10);
                          if (Number.isNaN(n)) return;
                          setSockQty(Math.max(1, Math.min(sockMaxStock, n)));
                        }}
                        onBlur={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (Number.isNaN(n) || n < 1) setSockQty(1);
                        }}
                        className="w-10 text-center text-black text-sm font-medium bg-transparent border-0 outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        data-testid={`input-sock-qty-${product.id}`}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); setSockQty(Math.min(sockMaxStock, sockQty + 1)); }}
                        className="text-black h-7 w-7"
                        data-testid={`button-sock-plus-${product.id}`}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleSockQuickAdd}
                      className="flex-1 min-w-0 h-7 px-2"
                      disabled={sockMaxStock <= 0}
                      data-testid={`button-sock-add-${product.id}`}
                    >
                      <ShoppingCart className="w-3 h-3 shrink-0" />
                      <span className="hidden sm:inline ml-1.5">В корзину</span>
                    </Button>
                  </div>
                </div>
              </div>
            )}
        </div>

        <DialogContent className="max-w-[95vw] sm:max-w-[800px] bg-[#f2f2f2] border-[#d8d8d8] p-0 overflow-hidden rounded-2xl max-h-[92vh] sm:max-h-[95vh] duration-150" aria-describedby={undefined}>
          <DialogTitle className="sr-only">{product.name}</DialogTitle>
          <div className="flex flex-col md:flex-row max-h-[92vh] sm:max-h-[95vh] overflow-y-auto md:overflow-hidden">
            {/* Image container - swipe on mobile, arrows on desktop */}
            <div 
              className="w-full md:w-1/2 relative flex-shrink-0 min-h-[60vh] md:min-h-0"
              onTouchStart={(e) => {
                touchStartX.current = e.touches[0].clientX;
                touchDeltaX.current = 0;
              }}
              onTouchMove={(e) => {
                if (touchStartX.current !== null) {
                  touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
                }
              }}
              onTouchEnd={() => {
                if (activeProduct.images && activeProduct.images.length > 1) {
                  const threshold = 50;
                  if (touchDeltaX.current < -threshold) {
                    wasSwipedRef.current = true;
                    setModalImageIndex((prev) => (prev + 1) % (activeProduct.images || []).length);
                  } else if (touchDeltaX.current > threshold) {
                    wasSwipedRef.current = true;
                    setModalImageIndex((prev) => (prev - 1 + (activeProduct.images || []).length) % (activeProduct.images || []).length);
                  }
                }
                touchStartX.current = null;
                touchDeltaX.current = 0;
              }}
            >
              <Link
                href={`/${activeProduct.slug || activeProduct.id}`}
                onClick={(e) => {
                  if (wasSwipedRef.current) {
                    e.preventDefault();
                    wasSwipedRef.current = false;
                    return;
                  }
                  setIsModalOpen(false);
                }}
                className="block w-full h-[60vh] sm:h-auto md:h-full md:min-h-[600px] cursor-pointer"
                data-testid="link-modal-image"
              >
                <img 
                  src={activeProduct.images && activeProduct.images.length > 0 ? activeProduct.images[modalImageIndex] : activeProduct.imageUrl} 
                  alt={`${activeProduct.name} BOOOMERANGS${activeProduct.category ? `, ${activeProduct.category}` : ""}`}
                  title={activeProduct.name}
                  className="w-full h-full object-contain md:object-cover"
                />
              </Link>
              {activeProduct.images && activeProduct.images.length > 1 && (() => {
                const imgs = activeProduct.images!;
                return (
                  <>
                    {/* Mobile: transparent tap zones over image edges */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setModalImageIndex((prev) => (prev - 1 + imgs.length) % imgs.length); }}
                      className="absolute left-0 top-0 bottom-0 w-[15%] z-10 flex items-center justify-start pl-2 focus:outline-none md:hidden"
                      data-testid="button-modal-prev-image-mobile"
                    >
                      <ChevronLeft className="w-5 h-5 text-foreground/30" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setModalImageIndex((prev) => (prev + 1) % imgs.length); }}
                      className="absolute right-0 top-0 bottom-0 w-[15%] z-10 flex items-center justify-end pr-2 focus:outline-none md:hidden"
                      data-testid="button-modal-next-image-mobile"
                    >
                      <ChevronRight className="w-5 h-5 text-foreground/30" />
                    </button>
                    {/* Desktop: rounded arrow buttons */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setModalImageIndex((prev) => (prev - 1 + imgs.length) % imgs.length); }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center bg-white/90 backdrop-blur-md text-black/70 rounded-full border border-black/10 shadow-sm hover:text-black hover:bg-white active:scale-95 active:scale-95 transition-all duration-200 hidden md:flex"
                      data-testid="button-modal-prev-image"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setModalImageIndex((prev) => (prev + 1) % imgs.length); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center bg-white/90 backdrop-blur-md text-black/70 rounded-full border border-black/10 shadow-sm hover:text-black hover:bg-white active:scale-95 active:scale-95 transition-all duration-200 hidden md:flex"
                      data-testid="button-modal-next-image"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                    {/* Dot indicators */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex gap-1.5">
                      {imgs.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={(e) => { e.stopPropagation(); setModalImageIndex(idx); }}
                          className={`rounded-full transition-all duration-300 ${idx === modalImageIndex ? 'bg-black w-4 h-1.5' : 'bg-black/25 w-1.5 h-1.5 hover:bg-black/50'}`}
                          data-testid={`button-modal-dot-${idx}`}
                        />
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
            {/* Content container - compact on mobile, scrollable on desktop */}
            <div className="w-full md:w-1/2 p-3 sm:p-6 lg:p-8 flex flex-col md:overflow-y-auto md:max-h-[95vh]">
              <div className="flex-1 flex flex-col">
                <div className="mb-3 sm:mb-5 text-left">
                  <h3 className="text-xl sm:text-2xl font-black leading-snug text-black tracking-tight mb-1">{displayName(activeProduct.name)}</h3>
                  {(product as any).artistSlug && (
                    <Link
                      href={`/@${(product as any).artistSlug}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[11px] text-black/40 hover:text-black transition-colors mb-2"
                    >
                      <ArrowUpRight className="w-3 h-3" />
                      Смотреть всю коллекцию артиста
                    </Link>
                  )}
                  <div className="space-y-1">
                    {showModalPreorderLabels && (
                      <p className="text-[10px] font-medium text-black uppercase tracking-wide">Предпродажная цена</p>
                    )}
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className={`text-3xl sm:text-4xl font-black tracking-tight ${activeHasDiscount ? 'text-red-500' : 'text-black'}`}>{activeHasDiscount ? formatPrice(activeSalePrice) : activeDisplayPrice}</span>
                      {activeHasDiscount && (
                        <span className="text-base font-semibold text-red-400 line-through">{activeRetailPrice}</span>
                      )}
                      {isWholesale && activeWholesalePrice && (
                        <>
                          <span className="text-base text-black/35 line-through font-medium">{activeRetailPrice}</span>
                          <span className="text-xs font-bold tracking-widest text-white bg-black px-2 py-0.5 uppercase">ОПТ</span>
                        </>
                      )}
                    </div>
                    {showModalPreorderLabels && (
                      <p className="text-[11px] text-black">
                        Цена после релиза — {activeRetailPrice} · <span className="font-medium">экономите {formatPrice(activeProduct.price - activeSalePrice)}</span>
                      </p>
                    )}
                  </div>
                  {!isWholesale && activeSalePrice >= 300000 && activeSalePrice <= 3000000 && (
                    <DolyameWidget
                      price={activeSalePrice}
                      isDark={false}
                      isMinta={false}
                      productId={activeProduct.id}
                    />
                  )}
                </div>

                <div className="space-y-2 sm:space-y-6 flex-1">
                  <div className="space-y-0.5 sm:space-y-2">
                    <span className="text-[9px] font-medium text-black/40 uppercase tracking-widest">Описание</span>
                    <div className="relative">
                      <p 
                        className={`text-black/80 text-xs sm:text-sm leading-relaxed transition-all duration-300 ${
                          !isDescriptionExpanded ? 'line-clamp-2 sm:line-clamp-5' : ''
                        }`}
                      >
                        {activeProduct.description}
                      </p>
                      {activeProduct.description && activeProduct.description.length > 100 && (
                        <button
                          onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                          className="text-black/60 text-xs mt-0.5 hover:text-black hover:underline transition-colors"
                          data-testid="button-expand-description"
                        >
                          {isDescriptionExpanded ? 'Свернуть' : 'Ещё'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Variant selector (socks: size ranges, clothing: colors) */}
                  {hasVariants && (
                    <div className="space-y-1 sm:space-y-2">
                      <span className="text-[10px] sm:text-xs font-semibold text-black uppercase tracking-wider">
                        {isSocks ? "Размер / Цвет" : "Другие варианты"}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {isSocks ? (
                          (() => {
                            const bySizeRange = (variants as ColorVariant[]).reduce((acc, v) => {
                              const key = v.sizeRange || 'Один размер';
                              if (!acc[key]) acc[key] = [];
                              acc[key].push(v);
                              return acc;
                            }, {} as Record<string, ColorVariant[]>);
                            return Object.entries(bySizeRange).flatMap(([range, rangeVariants]) =>
                              rangeVariants.map(v => {
                                const isActive = (activeVariantId ?? product.id) === v.id;
                                return (
                                  <button
                                    key={v.id}
                                    onClick={() => setActiveVariantId(v.id === product.id ? null : v.id)}
                                    className={`flex flex-col items-center gap-0.5 p-1 rounded-lg border-2 transition-all ${
                                      isActive ? 'border-black' : 'border-transparent hover:border-black/20'
                                    }`}
                                    data-testid={`button-modal-variant-sock-${v.id}`}
                                  >
                                    <img src={v.thumbnailUrl || v.imageUrl} alt={`${v.name} BOOOMERANGS${v.color ? ", " + v.color : ""}`} onError={(e) => { if (v.imageUrl && e.currentTarget.src !== v.imageUrl) e.currentTarget.src = v.imageUrl; }} className="w-20 h-32 rounded-md object-cover bg-gray-100" />
                                    <span className="text-[11px] text-black/70 leading-tight font-medium">{range}</span>
                                    {v.color && <span className="text-[10px] text-black/60 leading-tight">{v.color}</span>}
                                  </button>
                                );
                              })
                            );
                          })()
                        ) : (
                          (variants as ColorVariant[]).map(v => {
                            const isActive = (activeVariantId ?? product.id) === v.id;
                            return (
                              <button
                                key={v.id}
                                onClick={() => setActiveVariantId(v.id === product.id ? null : v.id)}
                                className={`relative rounded-lg border-2 transition-all overflow-hidden ${
                                  isActive ? 'border-black' : 'border-transparent hover:border-black/20'
                                }`}
                                title={v.color || v.name}
                                data-testid={`button-modal-variant-color-${v.id}`}
                              >
                                <img src={v.thumbnailUrl || v.imageUrl} alt={`${v.name} BOOOMERANGS${v.color ? ", " + v.color : ""}`} onError={(e) => { if (v.imageUrl && e.currentTarget.src !== v.imageUrl) e.currentTarget.src = v.imageUrl; }} className="w-20 h-32 object-cover bg-gray-100" />
                                {isActive && (
                                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                                    <Check className="w-3 h-3 text-white" />
                                  </div>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Stock display for products WITHOUT sizes (bags, hats, belts, mugs, etc.) */}
                  {isWholesale && (!activeProduct.sizes || activeProduct.sizes.length === 0) && (
                    <div className="flex items-center gap-2 py-2 px-3 bg-black/5 rounded-md border border-black/25">
                      <span className="text-[10px] sm:text-xs text-black/70">Остаток на складе:</span>
                      <span className="text-sm sm:text-base text-primary font-bold">
                        {(activeProduct as any).stock ?? 0} шт.
                      </span>
                    </div>
                  )}

                  {!isEffectivelyNoSize(activeProduct) && (activeProduct.sizes?.length > 0 || hasActiveSizeStockData) && (
                    <div className="space-y-1 sm:space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-medium text-black/40 uppercase tracking-widest">Размер</span>
                        {isWholesale && hasActiveSizeStockData && (
                          <span className="text-[10px] sm:text-xs text-primary font-medium">Остаток</span>
                        )}
                      </div>
                      {isWholesale && !hasActiveSizeStockData && (
                        <div className="flex items-center gap-2 py-2 px-3 bg-black/5 rounded-md border border-black/25 mb-2">
                          <span className="text-[10px] sm:text-xs text-black/70">Общий остаток:</span>
                          <span className="text-sm sm:text-base text-primary font-bold">
                            {(activeProduct as any).stock ?? 0} шт.
                          </span>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5 sm:gap-2">
                        {(() => {
                          const sizeOrder = ["XXS","XS","S","M","L","XL","XXL","2XL","3XL","4XL","5XL"];
                          const sortSizes = (arr: string[]) => [...arr].sort((a, b) => {
                            const ai = sizeOrder.indexOf(a.toUpperCase()), bi = sizeOrder.indexOf(b.toUpperCase());
                            if (ai !== -1 && bi !== -1) return ai - bi;
                            if (ai !== -1) return -1;
                            if (bi !== -1) return 1;
                            return a.localeCompare(b);
                          });
                          const baseSizes = activeProduct.sizes?.length > 0 ? activeProduct.sizes : (hasActiveSizeStockData ? Object.keys(activeSizeStockData) : []);
                          const allSizes = (activeProduct.sizes?.length > 0)
                            ? sortSizes(baseSizes)
                            : (hasActiveSizeStockData
                                ? sortSizes(Array.from(new Set([...baseSizes, ...Object.keys(activeSizeStockData)])))
                                : sortSizes(baseSizes));
                          return allSizes.map(size => {
                            const stockCount = activeSizeStockData?.[size];
                            const isSizeOutOfStock = hasActiveSizeStockData
                              ? (stockCount !== undefined && stockCount <= 0)
                              : (activeProduct.stock !== undefined && activeProduct.stock !== null && activeProduct.stock <= 0);
                            const isSubmittedForSize = notifySubmitted.has(size);
                            const isSizeLowStock = !isSizeOutOfStock && hasActiveSizeStockData && stockCount !== undefined && stockCount > 0 && stockCount <= 3;
                            return (
                              <div key={size} className="flex flex-col items-center">
                                {isWholesale && hasActiveSizeStockData && stockCount !== undefined && (
                                  <span className="text-[9px] sm:text-xs text-primary font-medium mb-0.5">
                                    {stockCount > 0 ? stockCount : '0'}
                                  </span>
                                )}
                                {isSizeOutOfStock ? (
                                  <div className="relative">
                                    <button
                                      onClick={() => {
                                        setNotifySize(size);
                                        setSelectedSize(null);
                                      }}
                                      className={`min-w-[36px] h-8 sm:h-10 border text-[11px] sm:text-sm flex items-center justify-center rounded-md px-2 sm:px-3 transition-colors ${
                                        notifySize === size
                                          ? "border-primary text-primary bg-primary/10"
                                          : isSubmittedForSize
                                            ? "border-green-500 text-green-400"
                                            : "border-red-500/60 text-black/25 hover:border-red-400 hover:text-black/50"
                                      }`}
                                    >
                                      {isSubmittedForSize ? <Check className="w-3 h-3 mr-0.5" /> : null}
                                      {size}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="relative">
                                    <button
                                      onClick={() => {
                                        setSelectedSize(size);
                                        setNotifySize(null);
                                      }}
                                      className={`min-w-[40px] h-9 sm:h-11 border-2 text-[11px] sm:text-sm font-semibold transition-all flex items-center justify-center rounded-xl px-2 sm:px-3 ${
                                        selectedSize === size 
                                          ? "bg-black text-white border-black shadow-md" 
                                          : "bg-white border-black/15 text-black hover:border-black hover:text-black shadow-sm"
                                      }`}
                                    >
                                      {size}
                                    </button>
                                    {!isWholesale && activeSizeDiscountsMap && activeSizeDiscountsMap[size] && (
                                      <span className="absolute -top-2 -right-2 min-w-[22px] h-[18px] flex items-center justify-center text-[9px] font-bold rounded-full bg-red-500 text-white px-1 pointer-events-none">
                                        -{activeSizeDiscountsMap[size]}%
                                      </span>
                                    )}
                                    {!isWholesale && isSizeLowStock && (
                                      <span className="absolute -bottom-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center text-[9px] font-bold rounded-full border border-orange-400 bg-background text-orange-500 px-0.5 pointer-events-none">
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
                      {notifySize && !notifySubmitted.has(notifySize) && (
                        <div className="mt-2 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <Bell className="w-3.5 h-3.5 text-primary shrink-0" />
                            <input
                              type="email"
                              value={notifyEmail}
                              onChange={(e) => setNotifyEmail(e.target.value)}
                              placeholder="Ваш email"
                              data-testid="input-modal-size-notify-email"
                              className="flex-1 h-8 px-2.5 text-xs rounded-md border border-black/30 bg-black/5 text-black placeholder:text-black/40 focus:outline-none focus:border-black/60"
                            />
                            <Button
                              size="sm"
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
                                  productId: activeProduct.id,
                                  productName: activeProduct.name,
                                  size: notifySize,
                                  email: notifyEmail,
                                });
                              }}
                              disabled={notifyMutation.isPending}
                              data-testid="button-modal-size-notify"
                              className="h-8"
                            >
                              {notifyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Уведомить"}
                            </Button>
                          </div>
                          <label className="flex items-start gap-1.5 cursor-pointer" data-testid="label-modal-notify-consent">
                            <input
                              type="checkbox"
                              checked={notifyConsent}
                              onChange={(e) => setNotifyConsent(e.target.checked)}
                              className="mt-0.5 accent-primary"
                              data-testid="checkbox-modal-notify-consent"
                            />
                            <span className="text-[9px] leading-tight text-black/60">
                              Соглашаюсь на обработку данных и уведомления ({" "}
                              <a href="/privacy" className="underline hover:text-foreground" target="_blank">политика</a>)
                            </span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  {!isActiveProductOutOfStock && !(activeProduct as any).preorderEnabled && (
                  <div className="space-y-1 sm:space-y-2">
                    <span className="text-[9px] font-medium text-black/40 uppercase tracking-widest">Количество</span>
                    <div className="flex items-center w-fit bg-white border border-black/10 rounded-full overflow-hidden shadow-sm">
                      <button 
                        onClick={() => setQuantity(Math.max(1, quantity - 1))}
                        className="p-2 sm:p-3 hover:bg-black/5 transition-colors text-black/50 hover:text-black"
                      >
                        <Minus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      </button>
                      <span className="w-8 sm:w-10 text-center text-sm sm:text-base font-semibold text-black">{quantity}</span>
                      <button 
                        onClick={() => setQuantity(quantity + 1)}
                        className="p-2 sm:p-3 hover:bg-black/5 transition-colors text-black/50 hover:text-black"
                      >
                        <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      </button>
                    </div>
                  </div>
                  )}
                </div>
              </div>

              <div className="mt-2 sm:mt-4 pt-2 sm:pt-4 border-t border-black/10 space-y-2 sm:space-y-3">
                {(activeProduct as any).preorderEnabled ? (
                  <div className="space-y-2">
                    <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold tracking-widest uppercase text-amber-800 bg-amber-200 px-2 py-0.5 rounded-sm">Предзаказ</span>
                        {((activeProduct as any).preorderStatus === "collecting" || !(activeProduct as any).preorderStatus) && (
                          <span className="text-[10px] text-amber-700">· Сбор заявок</span>
                        )}
                        {(activeProduct as any).preorderStatus === "production" && (
                          <span className="text-[10px] text-amber-700">· Производство</span>
                        )}
                        {(activeProduct as any).preorderStatus === "shipping" && (
                          <span className="text-[10px] text-amber-700">· Отправка</span>
                        )}
                        {(activeProduct as any).preorderStatus === "shipped" && (
                          <span className="text-[10px] text-amber-700">· Отправлено</span>
                        )}
                      </div>
                      {/* Описание и даты — только при сборе заявок */}
                      {((activeProduct as any).preorderStatus === "collecting" || !(activeProduct as any).preorderStatus) && (
                        <>
                          <p className="text-[11px] text-amber-900/75 leading-relaxed">
                            Товар доступен только по предзаказу — оформите заявку на странице товара.
                          </p>
                          {(activeProduct as any).preorderDeadline && (
                            <p className="text-[11px] text-amber-800">
                              <span className="font-semibold">Приём заявок до:</span>{" "}
                              {new Date((activeProduct as any).preorderDeadline).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                            </p>
                          )}
                          {(activeProduct as any).preorderShippingDate && (
                            <p className="text-[11px] text-amber-800">
                              <span className="font-semibold">Ориентировочная отправка:</span>{" "}
                              {new Date((activeProduct as any).preorderShippingDate).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    {/* Кнопка: "Перейти к предзаказу" только при сборе, иначе нейтральная */}
                    {((activeProduct as any).preorderStatus === "collecting" || !(activeProduct as any).preorderStatus) ? (
                      <Link
                        href={`/${activeProduct.slug || activeProduct.id}`}
                        onClick={() => setIsModalOpen(false)}
                        className="flex items-center justify-center gap-1.5 w-full h-9 sm:h-12 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white text-xs sm:text-sm font-semibold tracking-widest uppercase transition-all rounded-none"
                        data-testid={`button-modal-go-preorder-${activeProduct.id}`}
                      >
                        Перейти к предзаказу
                        <ArrowUpRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </Link>
                    ) : (
                      <Link
                        href={`/${activeProduct.slug || activeProduct.id}`}
                        onClick={() => setIsModalOpen(false)}
                        className="flex items-center justify-center gap-1.5 w-full h-9 sm:h-12 bg-muted hover:bg-muted/80 active:scale-[0.98] text-muted-foreground text-xs sm:text-sm font-semibold tracking-widest uppercase transition-all rounded-none"
                        data-testid={`button-modal-view-product-${activeProduct.id}`}
                      >
                        Открыть страницу товара
                        <ArrowUpRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </Link>
                    )}
                  </div>
                ) : isActiveProductOutOfStock ? (
                  <>
                    <div className="flex items-center justify-center h-9 sm:h-12 rounded-md bg-black/5 text-black/60 text-xs sm:text-sm font-medium" data-testid="text-modal-out-of-stock">
                      {notifySize ? `Размер ${notifySize} — нет в наличии` : "Нет в наличии"}
                    </div>
                    {(() => {
                      const hasSizes = activeProduct.sizes?.length > 0;
                      const sizeStockKeys = hasActiveSizeStockData ? Object.keys(activeSizeStockData) : [];
                      const allDisplaySizes = hasSizes ? activeProduct.sizes : sizeStockKeys;
                      const isSingleSize = allDisplaySizes.length <= 1;
                      const singleSizeValue = isSingleSize && allDisplaySizes.length === 1 ? allDisplaySizes[0] : null;
                      const targetSize = notifySize || singleSizeValue || (!hasSizes ? "one-size" : "");
                      const alreadySubmitted = targetSize ? notifySubmitted.has(targetSize) : false;
                      const sizeNotifyFormVisible = !isSingleSize && notifySize;

                      if (!isSingleSize && allDisplaySizes.length > 1 && !notifySize) {
                        return (
                          <p className="text-center text-black/50 text-xs sm:text-sm">
                            Нажмите на нужный размер выше, чтобы подписаться на уведомление
                          </p>
                        );
                      }
                      if (sizeNotifyFormVisible) return null;
                      if (alreadySubmitted) {
                        return (
                          <div className="flex items-center justify-center gap-2 text-xs sm:text-sm text-green-600">
                            <Check className="w-3.5 h-3.5" />
                            <span>Вы подписаны на уведомление</span>
                          </div>
                        );
                      }
                      return (
                        <div className="space-y-1.5" data-testid="block-modal-notify">
                          <div className="flex items-center gap-2">
                            <Bell className="w-4 h-4 text-primary shrink-0" />
                            <input
                              type="email"
                              value={notifyEmail}
                              onChange={(e) => setNotifyEmail(e.target.value)}
                              placeholder="Email для уведомления"
                              data-testid="input-modal-notify-email"
                              className="flex-1 h-9 px-3 text-xs sm:text-sm rounded-md border border-black/15 bg-black/5 text-black placeholder:text-black/25 focus:outline-none focus:border-black/30"
                            />
                            <Button
                              size="sm"
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
                                  productId: activeProduct.id,
                                  productName: activeProduct.name,
                                  size: targetSize,
                                  email: notifyEmail,
                                });
                              }}
                              disabled={notifyMutation.isPending}
                              data-testid="button-modal-submit-notify"
                            >
                              {notifyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Уведомить"}
                            </Button>
                          </div>
                          <label className="flex items-start gap-1.5 cursor-pointer" data-testid="label-modal-oos-consent">
                            <input
                              type="checkbox"
                              checked={notifyConsent}
                              onChange={(e) => setNotifyConsent(e.target.checked)}
                              className="mt-0.5 accent-primary"
                              data-testid="checkbox-modal-oos-consent"
                            />
                            <span className="text-[9px] leading-tight text-black/60">
                              Соглашаюсь на обработку данных и уведомления ({" "}
                              <a href="/privacy" className="underline hover:text-foreground" target="_blank">политика</a>)
                            </span>
                          </label>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                <Button 
                  onClick={handleAddToCart}
                  className="w-full bg-black text-white hover:bg-black/85 active:scale-[0.98] h-11 sm:h-13 text-xs sm:text-sm font-semibold tracking-widest uppercase transition-all rounded-xl"
                >
                  <ShoppingCart className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                  В корзину
                </Button>
                )}
                <Link
                  href={`/${activeProduct.slug || activeProduct.id}`}
                  onClick={() => setIsModalOpen(false)}
                  className="flex items-center justify-center gap-1.5 w-full h-11 sm:h-13 border border-black/20 rounded-xl text-xs sm:text-sm font-medium text-black hover:bg-black hover:text-white hover:border-black transition-all"
                  data-testid="link-modal-open-product-page"
                >
                  Открыть страницу товара
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>

                {/* AI Mini Chat — extracted to ProductMiniChat.tsx */}
                <ProductMiniChat
                  product={activeProduct as any}
                  resetKey={isModalOpen ? String(activeProduct.id) : "closed"}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      <Link href={`/${product.slug || product.id}`}>
        {(isJDM || isMinta || isMerch) ? (
          <div className={`px-3 pt-2.5 pb-3 sm:px-4 sm:pt-3 sm:pb-4 ${isJDM ? "bg-zinc-900" : isMinta ? "bg-[#f7ece4]" : "bg-zinc-900"}`}>
            <h3 className={`text-[13px] sm:text-sm font-medium leading-snug line-clamp-2 mb-1.5 transition-colors ${isJDM ? "text-white group-hover:text-red-400" : isMinta ? "group-hover:text-[#2e2e2e]/60" : "text-white group-hover:text-white/70"}`} style={isMinta ? { color: '#2e2e2e' } : undefined}>
              {displayName(product.name)}
            </h3>
            <div className="flex items-baseline gap-2">
              <span className={`text-sm sm:text-base font-bold ${hasDiscount ? "text-red-600" : isJDM ? "text-red-500" : isMinta ? "" : "text-white"}`} style={isMinta && !hasDiscount ? { color: '#2e2e2e' } : undefined}>
                {hasDiscount ? formatPrice(salePrice) : displayPrice}
              </span>
              {(hasDiscount || (isWholesale && wholesalePrice && !hasDiscount)) && (
                <span className={`text-[11px] line-through ${isJDM || isMerch ? "text-white/40" : isMinta ? "" : "text-muted-foreground/50"}`} style={isMinta ? { color: '#2e2e2e', opacity: 0.4 } : undefined}>{retailPrice}</span>
              )}
            </div>
            <div className="min-h-[22px]">
              {!isWholesale && salePrice >= 300000 && salePrice <= 3000000 && (
                <DolyameWidget price={salePrice} isDark={isJDM || isMerch} isMinta={isMinta} productId={product.id} onOpenChange={setDolyameOpen} />
              )}
            </div>
          </div>
        ) : (
          <div className="px-2 sm:px-3 pt-2 pb-2 sm:pb-3">
            <div className="bg-card rounded-2xl shadow-[0_2px_10px_0_rgba(0,0,0,0.08)] border border-border/40 px-3 py-3 sm:px-4 sm:py-3.5 transition-shadow duration-200 group-hover:shadow-[0_4px_18px_0_rgba(0,0,0,0.12)] flex flex-col">
              <h3 className="text-[13px] sm:text-sm font-semibold leading-snug line-clamp-2 text-foreground group-hover:text-primary transition-colors" style={{ minHeight: '2.6em' }}>
                {displayName(product.name)}
              </h3>
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-sm sm:text-[15px] font-black tracking-tight ${hasDiscount ? "text-red-600" : isWholesale ? "text-primary" : "text-foreground"}`}>
                  {hasDiscount ? formatPrice(salePrice) : displayPrice}
                </span>
                {(hasDiscount || (isWholesale && wholesalePrice && !hasDiscount)) && (
                  <span className="text-[11px] line-through text-muted-foreground/50">{retailPrice}</span>
                )}
              </div>
              <div className="min-h-[22px] mt-1">
                {!isWholesale && salePrice >= 300000 && salePrice <= 3000000 && (
                  <DolyameWidget price={salePrice} isDark={false} isMinta={false} productId={product.id} onOpenChange={setDolyameOpen} />
                )}
              </div>
            </div>
          </div>
        )}
      </Link>
    </div>
  );
}

// Wrap in React.memo to prevent unnecessary re-renders during scroll
export const ProductCard = memo(ProductCardInner);
