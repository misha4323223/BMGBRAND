import { useCart, useRemoveFromCart, useUpdateCartQuantity } from "@/hooks/use-cart";
import { useWholesalePrice } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { X, ShoppingBag, ArrowRight, Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, createContext, useContext, useState, useCallback, useRef } from "react";

interface CartDrawerContextType {
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const CartDrawerContext = createContext<CartDrawerContextType>({
  isOpen: false,
  openDrawer: () => {},
  closeDrawer: () => {},
});

export function useCartDrawer() {
  return useContext(CartDrawerContext);
}

export function CartDrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openDrawer = useCallback(() => setIsOpen(true), []);
  const closeDrawer = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(isOpen ? 'cart-drawer-open' : 'cart-drawer-close'));
  }, [isOpen]);

  return (
    <CartDrawerContext.Provider value={{ isOpen, openDrawer, closeDrawer }}>
      {children}
      <CartDrawer />
    </CartDrawerContext.Provider>
  );
}

function CartDrawer() {
  const { isOpen, closeDrawer } = useCartDrawer();
  const { data: cartItems, isLoading } = useCart();
  const removeFromCart = useRemoveFromCart();
  const updateQuantity = useUpdateCartQuantity();
  const [, setLocation] = useLocation();
  const { isWholesale, getWholesalePrice } = useWholesalePrice();

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevItemCount = useRef<number>(0);
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHovering = useRef(false);

  const clearAutoClose = () => {
    if (autoCloseTimer.current) {
      clearTimeout(autoCloseTimer.current);
      autoCloseTimer.current = null;
    }
  };

  const startAutoClose = () => {
    clearAutoClose();
    autoCloseTimer.current = setTimeout(() => {
      if (!isHovering.current) closeDrawer();
    }, 2000);
  };

  useEffect(() => {
    if (isOpen) {
      isHovering.current = false;
      startAutoClose();
    } else {
      clearAutoClose();
    }
    return clearAutoClose;
  }, [isOpen]);

  const handleInteractionStart = () => {
    isHovering.current = true;
    clearAutoClose();
  };

  const handleInteractionEnd = () => {
    isHovering.current = false;
    startAutoClose();
  };

  useEffect(() => {
    if (!cartItems) return;
    const currentCount = cartItems.length;
    if (currentCount > prevItemCount.current && prevItemCount.current > 0) {
      setFlashIndex(currentCount - 1);
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      }, 100);
      setTimeout(() => setFlashIndex(null), 1500);
    }
    prevItemCount.current = currentCount;
  }, [cartItems?.length]);

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      minimumFractionDigits: 0,
    }).format(cents / 100);

  const subtotal =
    cartItems?.reduce((acc, item) => {
      const discountPct = (item.product as any).discountPercent;
      const sizeDiscounts = (item.product as any).sizeDiscounts as Record<string, number> | null;
      const sizeDiscount = sizeDiscounts && item.size ? sizeDiscounts[item.size] : null;
      const effectiveDiscount = sizeDiscount ?? discountPct;
      const retailPrice = (effectiveDiscount && effectiveDiscount > 0 && !isWholesale)
        ? Math.round(item.product.price * (1 - effectiveDiscount / 100))
        : item.product.price;
      const price = isWholesale
        ? getWholesalePrice(item.product.price, (item.product as any).wholesalePrice) || item.product.price
        : retailPrice;
      return acc + price * item.quantity;
    }, 0) || 0;

  const itemCount = cartItems?.reduce((acc, item) => acc + item.quantity, 0) || 0;

  const handleCheckout = () => {
    closeDrawer();
    setLocation("/checkout");
  };

  const handleContinueShopping = () => {
    closeDrawer();
  };

  const handleViewCart = () => {
    closeDrawer();
    setLocation("/cart");
  };

  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimating(true)));
    } else {
      setAnimating(false);
      const t = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  if (!mounted) return null;

  return (
          <div
            className="fixed right-0 top-0 bottom-0 z-[9999] w-[340px] max-w-[85vw] bg-background border-l border-border flex flex-col shadow-2xl"
            style={{
              transform: animating ? "translateX(0)" : "translateX(100%)",
              transition: "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)",
              pointerEvents: animating ? "auto" : "none",
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseEnter={handleInteractionStart}
            onMouseLeave={handleInteractionEnd}
            onTouchStart={handleInteractionStart}
            onFocus={handleInteractionStart}
            onBlur={handleInteractionEnd}
            data-testid="panel-cart-drawer"
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-foreground" />
                <h2 className="text-lg font-semibold text-foreground">
                  Корзина
                </h2>
                {itemCount > 0 && (
                  <Badge variant="secondary">{itemCount}</Badge>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={closeDrawer}
                data-testid="button-close-cart-drawer"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto" ref={scrollRef}>
              {isLoading ? (
                <div className="flex items-center justify-center h-40">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : !cartItems || cartItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full px-6 text-center">
                  <ShoppingBag className="w-16 h-16 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground text-lg mb-2">Корзина пуста</p>
                  <p className="text-muted-foreground text-sm mb-6">
                    Добавьте товары, чтобы они появились здесь
                  </p>
                  <Button onClick={handleContinueShopping} data-testid="button-drawer-continue-shopping">
                    Перейти к покупкам
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {cartItems.map((item, index) => {
                    const discountPct = (item.product as any).discountPercent;
                    const sizeDiscounts = (item.product as any).sizeDiscounts as Record<string, number> | null;
                    const sizeDiscount = sizeDiscounts && item.size ? sizeDiscounts[item.size] : null;
                    const effectiveDiscount = sizeDiscount ?? discountPct;
                    const hasDiscount = effectiveDiscount && effectiveDiscount > 0 && !isWholesale;
                    const retailPrice = hasDiscount
                      ? Math.round(item.product.price * (1 - effectiveDiscount / 100))
                      : item.product.price;
                    const itemPrice = isWholesale
                      ? getWholesalePrice(item.product.price, (item.product as any).wholesalePrice) || item.product.price
                      : retailPrice;
                    const itemTotal = itemPrice * item.quantity;

                    return (
                      <div
                        key={`cart-${item.productId}-${item.size}-${item.color}`}
                        className={`flex gap-3 p-4 transition-colors duration-700 ${flashIndex === index ? "bg-primary/10" : ""}`}
                        style={{
                          opacity: animating ? 1 : 0,
                          transform: animating ? "translateY(0)" : "translateY(10px)",
                          transition: `opacity 0.3s ease-out ${index * 0.05}s, transform 0.3s ease-out ${index * 0.05}s`,
                        }}
                        data-testid={`card-drawer-item-${item.id}`}
                      >
                        <div className="w-20 h-24 flex-shrink-0 bg-muted rounded-md overflow-hidden">
                          <img
                            src={item.product.thumbnailUrl || item.product.imageUrl}
                            alt={`${item.product.name} BOOOMERANGS`}
                            title={item.product.name}
                            className="w-full h-full object-cover"
                            data-testid={`img-drawer-item-${item.id}`}
                          />
                        </div>

                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                          <div className="flex items-start justify-between gap-1">
                            <div>
                              <h3 className="text-sm font-medium text-foreground line-clamp-2 leading-tight" data-testid={`text-drawer-item-name-${item.id}`}>
                                {item.product.name}
                              </h3>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {item.size}{item.color && item.color !== "Default" ? ` / ${item.color}` : ""}
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                removeFromCart.mutate({
                                  id: item.id,
                                  sessionId: item.sessionId || "",
                                  productId: item.productId,
                                  size: item.size,
                                  color: item.color,
                                  productName: item.product?.name,
                                })
                              }
                              data-testid={`button-drawer-remove-${item.productId}`}
                              className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-end justify-between mt-2">
                            <p className={`text-sm font-semibold ${isWholesale ? "text-primary" : "text-foreground"}`} data-testid={`text-drawer-item-price-${item.id}`}>
                              {formatPrice(itemTotal)}
                            </p>
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => {
                                  if (item.quantity <= 1) {
                                    removeFromCart.mutate({
                                      id: item.id,
                                      sessionId: item.sessionId || "",
                                      productId: item.productId,
                                      size: item.size,
                                      color: item.color,
                                      productName: item.product?.name,
                                    });
                                  } else {
                                    updateQuantity.mutate({
                                      id: item.id,
                                      sessionId: item.sessionId || "",
                                      productId: item.productId,
                                      size: item.size,
                                      color: item.color,
                                      quantity: item.quantity - 1,
                                    });
                                  }
                                }}
                                data-testid={`button-drawer-decrease-${item.id}`}
                                className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="w-7 text-center text-sm font-medium text-foreground" data-testid={`text-drawer-qty-${item.id}`}>
                                {item.quantity}
                              </span>
                              <button
                                onClick={() =>
                                  updateQuantity.mutate({
                                    id: item.id,
                                    sessionId: item.sessionId || "",
                                    productId: item.productId,
                                    size: item.size,
                                    color: item.color,
                                    quantity: item.quantity + 1,
                                  })
                                }
                                disabled={(() => {
                                  const sizeStr = item.size || "One Size";
                                  const sStock = (item.product as any)?.sizeStock as Record<string, number> | null;
                                  let maxStock: number;
                                  if (sStock && sStock[sizeStr] !== undefined) {
                                    maxStock = sStock[sizeStr];
                                  } else if (item.product?.stock !== undefined && item.product?.stock !== null) {
                                    maxStock = item.product.stock;
                                  } else {
                                    maxStock = 999;
                                  }
                                  return item.quantity >= maxStock;
                                })()}
                                data-testid={`button-drawer-increase-${item.id}`}
                                className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {cartItems && cartItems.length > 0 && (
              <div className="border-t border-border p-4 space-y-3 bg-background">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">
                    {itemCount} {itemCount === 1 ? "товар" : itemCount < 5 ? "товара" : "товаров"}
                  </span>
                  <span className="font-semibold text-foreground text-lg" data-testid="text-drawer-total">
                    {formatPrice(subtotal)}
                  </span>
                </div>

                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleCheckout}
                  data-testid="button-drawer-checkout"
                >
                  Оформить заказ
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleViewCart}
                    data-testid="button-drawer-view-cart"
                  >
                    Корзина
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={handleContinueShopping}
                    data-testid="button-drawer-continue"
                  >
                    Продолжить
                  </Button>
                </div>
              </div>
            )}
          </div>
  );
}
