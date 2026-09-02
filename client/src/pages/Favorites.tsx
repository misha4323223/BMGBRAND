import { useAuth, useWholesalePrice } from "@/hooks/use-auth";
import { BrandLoader } from "@/components/BrandLoader";
import { useLocation } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SEO from "@/components/SEO";
import { Bell, Check, Heart, Loader2, ShoppingBag, ShoppingCart } from "lucide-react";
import { useFavorites } from "@/hooks/use-favorites";
import { ProductCard } from "@/components/ProductCard";
import { useState } from "react";
import { useSession } from "@/hooks/use-session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useCartDrawer } from "@/components/CartDrawer";
import { api } from "@shared/routes";

const SIZE_ORDER = ["XXS","XS","S","M","L","XL","XXL","2XL","3XL","4XL","5XL"];

function pickFirstAvailableSize(product: any): string | null {
  const sizeStockData = product.sizeStock as Record<string, number> | undefined;
  const hasSizes = product.sizes?.length > 0 || (sizeStockData && Object.keys(sizeStockData).length > 0);
  if (!hasSizes) return "Default";

  const rawSizes: string[] = product.sizes?.length > 0
    ? product.sizes
    : Object.keys(sizeStockData || {});

  const sorted = [...rawSizes].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.toUpperCase());
    const bi = SIZE_ORDER.indexOf(b.toUpperCase());
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const inStock = sorted.find(s => {
    const stock = sizeStockData?.[s];
    return stock === undefined || stock > 0;
  });

  return inStock || null;
}

export default function Favorites() {
  const { data: authData, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { favoriteIds, favoritesCount, isLoggedIn } = useFavorites();
  const sessionId = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { openDrawer } = useCartDrawer();

  const user = authData?.user;
  const { isWholesale } = useWholesalePrice();

  const [isAddingAll, setIsAddingAll] = useState(false);
  const [localSubscribed, setLocalSubscribed] = useState<Set<number>>(new Set());
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [priceDropDialog, setPriceDropDialog] = useState<{ open: boolean; product: any | null }>({ open: false, product: null });
  const [priceDropEmail, setPriceDropEmail] = useState("");

  const { data: mySubscriptionsData } = useQuery<{ productIds: number[] }>({
    queryKey: ['/api/price-drop-notify/my', user?.email],
    enabled: !!user?.email,
    queryFn: async () => {
      const res = await fetch(`/api/price-drop-notify/my?email=${encodeURIComponent(user!.email!)}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  const subscribedProducts = new Set<number>([
    ...(mySubscriptionsData?.productIds ?? []),
    ...localSubscribed,
  ]);

  const { data: favoriteProducts = [], isLoading: productsLoading } = useQuery<any[]>({
    queryKey: ['/api/products/by-ids', favoriteIds.join(',')],
    enabled: favoriteIds.length > 0,
    queryFn: async () => {
      if (favoriteIds.length === 0) return [];
      const res = await fetch(`/api/products/by-ids?ids=${favoriteIds.join(',')}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  const handleAddAll = async () => {
    if (!sessionId || isAddingAll || favoriteProducts.length === 0) return;
    setIsAddingAll(true);

    let added = 0;
    let skipped = 0;

    for (const product of favoriteProducts) {
      const size = pickFirstAvailableSize(product);
      if (size === null) { skipped++; continue; }

      try {
        const res = await fetch("/api/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            productId: product.id,
            size,
            color: product.colors?.[0] || "Default",
            quantity: 1,
          }),
        });
        if (res.ok) added++;
        else skipped++;
      } catch {
        skipped++;
      }
    }

    await queryClient.refetchQueries({ queryKey: [api.cart.list.path, sessionId] });
    setIsAddingAll(false);

    if (added > 0) openDrawer();

    toast({
      title: added > 0
        ? `${added} ${added === 1 ? "товар добавлен" : added < 5 ? "товара добавлено" : "товаров добавлено"} в корзину`
        : "Ничего не добавлено",
      description: skipped > 0
        ? `${skipped} ${skipped === 1 ? "товар пропущен" : "товара пропущено"} — нет в наличии`
        : undefined,
    });
  };

  const subscribeToPriceDrop = async (productId: number, productName: string, email: string) => {
    const res = await fetch("/api/price-drop-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, productName, email }),
    });
    if (!res.ok) throw new Error("Ошибка подписки");
    return res.json() as Promise<{ success: boolean; alreadySubscribed: boolean }>;
  };

  const handleBellClick = async (product: any) => {
    if (subscribedProducts.has(product.id)) return;

    if (user?.email) {
      setIsSubscribing(true);
      try {
        const res = await fetch("/api/price-drop-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id, productName: product.name, email: user.email }),
        });
        const text = await res.text();
        if (!res.ok) {
          console.error("[PriceDrop] Server error:", res.status, text);
          throw new Error(text);
        }
        let data: { success: boolean; alreadySubscribed: boolean };
        try {
          data = JSON.parse(text);
        } catch {
          console.error("[PriceDrop] JSON parse error, raw response:", text);
          throw new Error("Некорректный ответ сервера");
        }
        setLocalSubscribed(prev => new Set([...prev, product.id]));
        toast({
          title: data.alreadySubscribed ? "Вы уже подписаны" : "Подписка оформлена",
          description: `Пришлём письмо на ${user.email}, когда цена снизится`,
        });
      } catch (err) {
        console.error("[PriceDrop] Error:", err);
        toast({ title: "Не удалось оформить подписку", variant: "destructive" });
      } finally {
        setIsSubscribing(false);
      }
    } else {
      setPriceDropDialog({ open: true, product });
      setPriceDropEmail("");
    }
  };

  const handleSubscribeSubmit = async () => {
    if (!priceDropDialog.product || !priceDropEmail.trim()) return;
    setIsSubscribing(true);
    try {
      const data = await subscribeToPriceDrop(priceDropDialog.product.id, priceDropDialog.product.name, priceDropEmail.trim());
      setLocalSubscribed(prev => new Set([...prev, priceDropDialog.product!.id]));
      setPriceDropDialog({ open: false, product: null });
      toast({
        title: data.alreadySubscribed ? "Вы уже подписаны" : "Подписка оформлена",
        description: `Пришлём письмо на ${priceDropEmail.trim()}, когда цена снизится`,
      });
    } catch {
      toast({ title: "Не удалось оформить подписку", variant: "destructive" });
    } finally {
      setIsSubscribing(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <BrandLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Избранное | BMGBRAND"
        description="Ваши избранные товары"
        noindex
      />
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-24 pb-8">
        <div className="flex items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground" data-testid="text-favorites-title">
              Избранное
            </h1>
            {favoritesCount > 0 && (
              <span className="text-muted-foreground text-lg">{favoritesCount}</span>
            )}
          </div>

          {favoriteProducts.length > 0 && !productsLoading && (
            <Button
              variant="outline"
              onClick={handleAddAll}
              disabled={isAddingAll}
              data-testid="button-add-all-to-cart"
              className="shrink-0 gap-2"
            >
              {isAddingAll ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShoppingCart className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">
                {isAddingAll ? "Добавляем..." : "Добавить всё в корзину"}
              </span>
              <span className="sm:hidden">
                {isAddingAll ? "..." : "Всё в корзину"}
              </span>
            </Button>
          )}
        </div>

        {favoriteIds.length === 0 ? (
          <Card className="p-12 text-center max-w-lg mx-auto">
            <Heart className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-foreground mb-2">Здесь пока пусто</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Нажмите на сердечко на карточке товара, чтобы добавить его в избранное
            </p>
            <Button onClick={() => setLocation("/products")} data-testid="button-go-to-shop">
              <ShoppingBag className="w-4 h-4 mr-2" />
              Перейти в магазин
            </Button>
          </Card>
        ) : productsLoading ? (
          <div className="flex items-center justify-center py-16">
            <BrandLoader size="lg" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4" data-testid="grid-favorites">
            {/* Оптовикам товары без оптовой цены не показываем (правило бизнеса) */}
            {favoriteProducts.filter((p: any) => !isWholesale || (p.wholesalePrice && p.wholesalePrice > 0)).map(product => {
              const subscribed = subscribedProducts.has(product.id);
              return (
                <div key={product.id} className="flex flex-col gap-1.5">
                  <ProductCard product={product} />
                  <button
                    onClick={() => handleBellClick(product)}
                    disabled={subscribed || isSubscribing}
                    data-testid={`button-price-drop-${product.id}`}
                    className={[
                      "w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200",
                      subscribed
                        ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 cursor-default"
                        : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/30 hover:bg-muted/50",
                    ].join(" ")}
                  >
                    {subscribed ? (
                      <>
                        <Check className="w-3 h-3 shrink-0" />
                        <span>Подписан на цену</span>
                      </>
                    ) : (
                      <>
                        <Bell className="w-3 h-3 shrink-0" />
                        <span>Следить за ценой</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {!isLoggedIn && favoriteIds.length > 0 && (
          <p className="text-center text-sm text-muted-foreground mt-8">
            Войдите в аккаунт, чтобы избранное сохранялось между устройствами
          </p>
        )}
      </div>

      <Footer />

      <Dialog open={priceDropDialog.open} onOpenChange={(open) => !open && setPriceDropDialog({ open: false, product: null })}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-4 h-4" />
              Следить за ценой
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {priceDropDialog.product && (
              <p className="text-sm text-muted-foreground">
                Уведомим вас, когда цена на{" "}
                <span className="font-medium text-foreground">{priceDropDialog.product.name}</span>{" "}
                снизится.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="price-drop-email">Email</Label>
              <Input
                id="price-drop-email"
                type="email"
                placeholder="your@email.com"
                value={priceDropEmail}
                onChange={(e) => setPriceDropEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubscribeSubmit()}
                data-testid="input-price-drop-email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceDropDialog({ open: false, product: null })}>
              Отмена
            </Button>
            <Button
              onClick={handleSubscribeSubmit}
              disabled={isSubscribing || !priceDropEmail.trim()}
              data-testid="button-submit-price-drop"
            >
              {isSubscribing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Подписаться
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
