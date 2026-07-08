import { useEffect, createContext, useContext, useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { X, PackageOpen, ArrowRight, Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePreorderCart } from "@/context/PreorderCartContext";

interface PreorderCartDrawerContextType {
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const PreorderCartDrawerContext = createContext<PreorderCartDrawerContextType>({
  isOpen: false,
  openDrawer: () => {},
  closeDrawer: () => {},
});

export function usePreorderCartDrawer() {
  return useContext(PreorderCartDrawerContext);
}

export function PreorderCartDrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openDrawer = useCallback(() => setIsOpen(true), []);
  const closeDrawer = useCallback(() => setIsOpen(false), []);

  return (
    <PreorderCartDrawerContext.Provider value={{ isOpen, openDrawer, closeDrawer }}>
      {children}
      <PreorderCartDrawer />
    </PreorderCartDrawerContext.Provider>
  );
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function PreorderCartDrawer() {
  const { isOpen, closeDrawer } = usePreorderCartDrawer();
  const { items, removeItem, updateSizes, totalQuantity, totalPrice } = usePreorderCart();
  const [, setLocation] = useLocation();

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
    }, 3500);
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

  const handleCheckout = () => {
    closeDrawer();
    setLocation("/predrop/checkout");
  };

  const handleViewCart = () => {
    closeDrawer();
    setLocation("/predrop/checkout");
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
      data-testid="panel-preorder-cart-drawer"
    >
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <PackageOpen className="w-5 h-5 text-foreground" />
          <h2 className="text-lg font-semibold text-foreground">
            Предзаказ
          </h2>
          {totalQuantity > 0 && (
            <Badge variant="secondary">{totalQuantity}</Badge>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={closeDrawer}
          data-testid="button-close-preorder-drawer"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            <PackageOpen className="w-16 h-16 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-lg mb-2">Корзина предзаказов пуста</p>
            <p className="text-muted-foreground text-sm mb-6">
              Добавьте товары, чтобы они появились здесь
            </p>
            <Button onClick={closeDrawer} data-testid="button-preorder-drawer-continue-shopping">
              Продолжить выбор
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => {
              const qty = Object.values(item.selectedSizes).reduce((a, b) => a + b, 0);
              const sizesLabel = Object.entries(item.selectedSizes)
                .map(([size, q]) => `${size} × ${q}`)
                .join(", ");
              const itemTotal = item.price * qty;

              return (
                <div
                  key={`preorder-cart-${item.productId}`}
                  className="flex gap-3 p-4"
                  data-testid={`card-preorder-drawer-item-${item.productId}`}
                >
                  <div className="w-20 h-24 flex-shrink-0 bg-muted rounded-md overflow-hidden">
                    {item.imageUrl && (
                      <img
                        src={item.imageUrl}
                        alt={item.productName}
                        className="w-full h-full object-cover"
                        data-testid={`img-preorder-drawer-item-${item.productId}`}
                      />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div className="flex items-start justify-between gap-1">
                      <div>
                        <h3 className="text-sm font-medium text-foreground line-clamp-2 leading-tight" data-testid={`text-preorder-drawer-item-name-${item.productId}`}>
                          {item.productName}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {sizesLabel}
                        </p>
                      </div>
                      <button
                        onClick={() => removeItem(item.productId)}
                        data-testid={`button-preorder-drawer-remove-${item.productId}`}
                        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-end justify-between mt-2">
                      <p className="text-sm font-semibold text-foreground" data-testid={`text-preorder-drawer-item-price-${item.productId}`}>
                        {formatPrice(itemTotal)}
                      </p>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => {
                            const sizeEntries = Object.entries(item.selectedSizes);
                            const lastSize = sizeEntries[sizeEntries.length - 1]?.[0];
                            if (!lastSize) return;
                            const currentQty = item.selectedSizes[lastSize];
                            if (currentQty <= 1) {
                              const updated = { ...item.selectedSizes };
                              delete updated[lastSize];
                              if (Object.keys(updated).length === 0) {
                                removeItem(item.productId);
                              } else {
                                updateSizes(item.productId, updated);
                              }
                            } else {
                              updateSizes(item.productId, { ...item.selectedSizes, [lastSize]: currentQty - 1 });
                            }
                          }}
                          data-testid={`button-preorder-drawer-decrease-${item.productId}`}
                          className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-7 text-center text-sm font-medium text-foreground" data-testid={`text-preorder-drawer-qty-${item.productId}`}>
                          {qty}
                        </span>
                        <button
                          onClick={() => {
                            const sizeEntries = Object.entries(item.selectedSizes);
                            const lastSize = sizeEntries[sizeEntries.length - 1]?.[0] || "ONE SIZE";
                            updateSizes(item.productId, { ...item.selectedSizes, [lastSize]: (item.selectedSizes[lastSize] || 0) + 1 });
                          }}
                          data-testid={`button-preorder-drawer-increase-${item.productId}`}
                          className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
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

      {items.length > 0 && (
        <div className="border-t border-border p-4 space-y-3 bg-background">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">
              {totalQuantity} {totalQuantity === 1 ? "товар" : totalQuantity < 5 ? "товара" : "товаров"}
            </span>
            <span className="font-semibold text-foreground text-lg" data-testid="text-preorder-drawer-total">
              {formatPrice(totalPrice)}
            </span>
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={handleCheckout}
            data-testid="button-preorder-drawer-checkout"
          >
            Оформить предзаказ
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>

          <Button
            variant="ghost"
            className="w-full"
            onClick={handleViewCart}
            data-testid="button-preorder-drawer-continue"
          >
            Продолжить выбор
          </Button>
        </div>
      )}
    </div>
  );
}
