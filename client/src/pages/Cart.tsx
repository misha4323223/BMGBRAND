import { useState } from "react";
import SEO from "@/components/SEO";
import { useCart, useRemoveFromCart, useClearCart, useUpdateCartQuantity } from "@/hooks/use-cart";
import { useAuth, useWholesalePrice } from "@/hooks/use-auth";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { AuthModal } from "@/components/AuthModal";
import { Link, useLocation } from "wouter";
import { Trash2, ArrowRight, ShoppingBag, Percent, AlertCircle, Plus, Minus } from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const MIN_WHOLESALE_ORDER = 500000; // 5000 RUB in cents

export default function Cart() {
  const { data: cartItems, isLoading } = useCart();
  const removeFromCart = useRemoveFromCart();
  const updateQuantity = useUpdateCartQuantity();
  const clearCart = useClearCart();
  const [, setLocation] = useLocation();
  const { isWholesale, getWholesalePrice } = useWholesalePrice();
  const { data: authData } = useAuth();
  const isLoggedIn = !!(authData?.user);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <BrandLoader size="lg" />
      </div>
    );
  }

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
    }).format(cents / 100);
  };
  
  const retailSubtotal = cartItems?.reduce((acc, item) => {
    const itemSalePrice = (item.product as any).salePrice;
    if (itemSalePrice && itemSalePrice > 0 && itemSalePrice < item.product.price) {
      return acc + (itemSalePrice * item.quantity);
    }
    const discountPct = (item.product as any).discountPercent;
    const sizeDiscounts = (item.product as any).sizeDiscounts as Record<string, number> | null;
    const sizeDiscount = sizeDiscounts && item.size ? sizeDiscounts[item.size] : null;
    const effectiveDiscount = sizeDiscount ?? discountPct;
    const price = (effectiveDiscount && effectiveDiscount > 0)
      ? Math.round(item.product.price * (1 - effectiveDiscount / 100))
      : item.product.price;
    return acc + (price * item.quantity);
  }, 0) || 0;
  const wholesaleSubtotal = cartItems?.reduce((acc, item) => {
    const price = isWholesale ? (getWholesalePrice(item.product.price, (item.product as any).wholesalePrice) || item.product.price) : item.product.price;
    return acc + (price * item.quantity);
  }, 0) || 0;
  const subtotal = isWholesale ? wholesaleSubtotal : retailSubtotal;
  const savings = retailSubtotal - wholesaleSubtotal;
  
  const meetsMinOrder = !isWholesale || subtotal >= MIN_WHOLESALE_ORDER;

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Корзина" description="Ваша корзина покупок BMGBRAND." noindex={true} />
      <Navbar />

      <div className="pt-32 pb-24 max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl md:text-4xl font-semibold mb-8 text-foreground">Корзина</h1>

        {!cartItems || cartItems.length === 0 ? (
          <Card className="text-center py-16 px-6" data-testid="status-cart-empty">
            <ShoppingBag className="w-16 h-16 mx-auto mb-6 text-muted-foreground" />
            <p className="text-muted-foreground mb-8 text-lg">Ваша корзина пуста</p>
            <Link href="/products">
              <Button size="lg" data-testid="button-go-shopping">
                Перейти к покупкам
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-4">
              {cartItems.map((item) => {
                const itemSalePrice = (item.product as any).salePrice;
                const discountPct = (item.product as any).discountPercent;
                const sizeDiscounts = (item.product as any).sizeDiscounts as Record<string, number> | null;
                const sizeDiscount = sizeDiscounts && item.size ? sizeDiscounts[item.size] : null;
                const effectiveDiscount = sizeDiscount ?? discountPct;
                const hasDiscount = !isWholesale && ((itemSalePrice && itemSalePrice > 0 && itemSalePrice < item.product.price) || (effectiveDiscount && effectiveDiscount > 0));
                const retailItemPrice = (itemSalePrice && itemSalePrice > 0 && itemSalePrice < item.product.price && !isWholesale)
                  ? itemSalePrice
                  : (effectiveDiscount && effectiveDiscount > 0 && !isWholesale
                    ? Math.round(item.product.price * (1 - effectiveDiscount / 100))
                    : item.product.price);
                const wholesaleItemPrice = getWholesalePrice(item.product.price, (item.product as any).wholesalePrice) || item.product.price;
                const itemPrice = isWholesale ? wholesaleItemPrice : retailItemPrice;
                const itemTotal = itemPrice * item.quantity;
                const retailTotal = retailItemPrice * item.quantity;
                
                return (
                <Card key={`${item.productId}-${item.size}-${item.color}`} className="flex gap-4 p-4" data-testid={`card-cart-item-${item.productId}-${item.size}`}>
                  <div className="w-24 h-28 flex-shrink-0 bg-muted rounded-lg overflow-hidden">
                    <img src={item.product.imageUrl} alt={item.product.name} className="w-full h-full object-cover" data-testid={`img-cart-item-${item.id}`} />
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-between min-w-0">
                    <div>
                      <div className="flex justify-between items-start gap-2 mb-1">
                        <h3 className="font-medium text-foreground line-clamp-2 text-sm sm:text-base" data-testid={`text-cart-item-name-${item.id}`}>{item.product.name}</h3>
                        <div className="text-right whitespace-nowrap">
                          <p className={`font-semibold ${isWholesale ? 'text-primary' : 'text-foreground'}`} data-testid={`text-cart-item-total-${item.id}`}>
                            {formatPrice(itemTotal)}
                          </p>
                          {isWholesale && (
                            <p className="text-xs text-muted-foreground line-through">{formatPrice(retailTotal)}</p>
                          )}
                        </div>
                      </div>
                      <p className="text-muted-foreground text-sm" data-testid={`text-cart-item-variants-${item.id}`}>
                        {item.size}{item.color && item.color !== "Default" ? ` / ${item.color}` : ""}
                      </p>
                    </div>
                    
                    <div className="flex justify-between items-center mt-2">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          data-testid={`button-decrease-quantity-${item.id}`}
                          disabled={item.quantity <= (isWholesale && (item.product as any)?.category === 'socks' ? 2 : 1) || updateQuantity.isPending}
                          onClick={() => updateQuantity.mutate({
                            id: item.id,
                            sessionId: item.sessionId || '',
                            productId: item.productId,
                            size: item.size,
                            color: item.color,
                            quantity: item.quantity - 1,
                          })}
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="text-sm font-medium w-8 text-center tabular-nums" data-testid={`text-cart-item-quantity-${item.id}`}>{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          data-testid={`button-increase-quantity-${item.id}`}
                          disabled={updateQuantity.isPending || (() => {
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
                          onClick={() => updateQuantity.mutate({
                            id: item.id,
                            sessionId: item.sessionId || '',
                            productId: item.productId,
                            size: item.size,
                            color: item.color,
                            quantity: item.quantity + 1,
                          })}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                      <button 
                        onClick={() => removeFromCart.mutate({
                          id: item.id,
                          sessionId: item.sessionId || '',
                          productId: item.productId,
                          size: item.size,
                          color: item.color,
                          productName: item.product?.name,
                        })}
                        data-testid={`button-remove-cart-item-${item.id}`}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </Card>
              );})}
              
              <button 
                onClick={() => clearCart.mutate()}
                data-testid="button-clear-cart"
                className="text-sm text-muted-foreground hover:text-foreground underline"
              >
                Очистить корзину
              </button>
            </div>

            {/* Summary */}
            <div className="lg:col-span-1">
              <Card className="p-6 sticky top-24">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-semibold text-foreground">Итого</h3>
                  {isWholesale && (
                    <Badge variant="secondary">
                      ОПТ
                    </Badge>
                  )}
                </div>
                
                <div className="space-y-3 mb-6 text-sm">
                  {isWholesale && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Розничная цена</span>
                      <span className="line-through">{formatPrice(retailSubtotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-muted-foreground">
                    <span>{isWholesale ? 'Оптовая цена' : 'Сумма'}</span>
                    <span data-testid="text-cart-subtotal">{formatPrice(subtotal)}</span>
                  </div>
                  {isWholesale && savings > 0 && (
                    <div className="flex justify-between text-primary">
                      <span>Ваша экономия</span>
                      <span data-testid="text-cart-savings">{formatPrice(savings)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-muted-foreground">
                    <span>Доставка</span>
                    <span data-testid="text-shipping-cost">Рассчитается при оформлении</span>
                  </div>
                  <div className="border-t pt-3 flex justify-between text-foreground text-lg font-semibold">
                    <span>Всего</span>
                    <span data-testid="text-cart-total">{formatPrice(subtotal)}</span>
                  </div>
                </div>
                
                {isWholesale && !meetsMinOrder && (
                  <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-destructive/10 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Минимальный заказ для опта</p>
                      <p>Добавьте товаров ещё на {formatPrice(MIN_WHOLESALE_ORDER - subtotal)}</p>
                    </div>
                  </div>
                )}
                
                {!isLoggedIn && (
                  <div className="flex items-start gap-3 p-3 mb-4 rounded-lg bg-primary/10 border border-primary/20">
                    <Percent className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
                    <div className="text-sm">
                      <p className="font-medium text-foreground">Зарегистрируйся и получи скидку</p>
                      <p className="text-muted-foreground text-xs mt-0.5">Чем больше покупаешь — тем выше твоя персональная скидка. Скидка применяется автоматически к каждому заказу.</p>
                      <button onClick={() => setAuthModalOpen(true)} className="text-primary text-xs font-medium hover:underline mt-1 inline-block" data-testid="link-loyalty-register">
                        Создать аккаунт →
                      </button>
                    </div>
                  </div>
                )}

                <Button 
                  size="lg"
                  className="w-full"
                  data-testid="button-checkout"
                  onClick={() => setLocation("/checkout")}
                  disabled={!meetsMinOrder}
                >
                  Оформить заказ <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                
                <Link href="/products" className="block text-center mt-4 text-sm text-muted-foreground hover:text-foreground">
                  Продолжить покупки
                </Link>
              </Card>
            </div>
          </div>
        )}
      </div>

      <Footer />
      <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} initialView="register" />
    </div>
  );
}
