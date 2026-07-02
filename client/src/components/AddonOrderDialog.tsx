import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Plus, Minus, Trash2, ShoppingBag, CheckCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import YooKassaWidget from "@/components/YooKassaWidget";

interface AddonItem {
  productId: number;
  productName: string;
  size?: string;
  color?: string;
  quantity: number;
  price: number;
  imageUrl?: string;
}

interface SelectedItem {
  productId: number;
  productName: string;
  price: number;
  imageUrl?: string;
  size?: string;
  color?: string;
  quantity: number;
  availableSizes: string[];
  availableColors: string[];
}

interface Product {
  id: number;
  name: string;
  price: number;
  images?: string[];
  imageUrl?: string;
  sizes?: string[];
  colors?: string[];
  variants?: Array<{ size?: string; color?: string; stock?: number }>;
}

interface AddonOrderDialogProps {
  orderId: number;
  open: boolean;
  onClose: () => void;
}

type Step = "select" | "paying" | "success";

function formatPrice(kopecks: number) {
  return `${(kopecks / 100).toLocaleString("ru-RU")} ₽`;
}

export default function AddonOrderDialog({ orderId, open, onClose }: AddonOrderDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("select");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"yookassa" | "tbank">("tbank");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const [addedTotal, setAddedTotal] = useState(0);

  const { data: configData } = useQuery<{ yookassaEnabled: boolean; tbankEnabled: boolean }>({
    queryKey: ["/api/payment-config"],
  });

  const { data: productsData, isLoading: productsLoading } = useQuery<{
    products: Product[];
    pagination: { total: number };
  }>({
    queryKey: ["/api/products", search],
    queryFn: () =>
      fetch(`/api/products?limit=20${search ? `&search=${encodeURIComponent(search)}` : ""}`).then((r) => r.json()),
    enabled: open && step === "select",
  });

  useEffect(() => {
    if (!open) {
      setStep("select");
      setSearch("");
      setSelected([]);
      setConfirmationToken(null);
      setAddedTotal(0);
    }
  }, [open]);

  useEffect(() => {
    if (configData) {
      if (configData.tbankEnabled) setPaymentMethod("tbank");
      else if (configData.yookassaEnabled) setPaymentMethod("yookassa");
    }
  }, [configData]);

  const products: Product[] = productsData?.products || [];

  function getSizes(p: Product): string[] {
    if (p.variants?.length) {
      const s = [...new Set(p.variants.map((v) => v.size).filter(Boolean))] as string[];
      if (s.length) return s;
    }
    return p.sizes || [];
  }

  function getColors(p: Product): string[] {
    if (p.variants?.length) {
      const c = [...new Set(p.variants.map((v) => v.color).filter(Boolean))] as string[];
      if (c.length) return c;
    }
    return p.colors || [];
  }

  function addProduct(p: Product) {
    const sizes = getSizes(p);
    const colors = getColors(p);
    const existing = selected.find((s) => s.productId === p.id);
    if (existing) {
      setSelected((prev) =>
        prev.map((s) => (s.productId === p.id ? { ...s, quantity: s.quantity + 1 } : s))
      );
      return;
    }
    setSelected((prev) => [
      ...prev,
      {
        productId: p.id,
        productName: p.name,
        price: p.price,
        imageUrl: p.images?.[0] || (p as any).imageUrl || undefined,
        size: sizes[0] || undefined,
        color: colors[0] || undefined,
        quantity: 1,
        availableSizes: sizes,
        availableColors: colors,
      },
    ]);
  }

  function removeItem(productId: number) {
    setSelected((prev) => prev.filter((s) => s.productId !== productId));
  }

  function changeQty(productId: number, delta: number) {
    setSelected((prev) =>
      prev
        .map((s) => (s.productId === productId ? { ...s, quantity: Math.max(1, s.quantity + delta) } : s))
        .filter((s) => s.quantity > 0)
    );
  }

  function changeSize(productId: number, size: string) {
    setSelected((prev) => prev.map((s) => (s.productId === productId ? { ...s, size } : s)));
  }

  function changeColor(productId: number, color: string) {
    setSelected((prev) => prev.map((s) => (s.productId === productId ? { ...s, color } : s)));
  }

  const total = selected.reduce((s, it) => s + it.price * it.quantity, 0);

  async function handlePay() {
    if (selected.length === 0) return;
    setIsSubmitting(true);
    try {
      const items = selected.map((s) => ({
        productId: s.productId,
        quantity: s.quantity,
        size: s.size || undefined,
        color: s.color || undefined,
      }));
      const res = await apiRequest("POST", `/api/orders/${orderId}/addon/initiate`, {
        items,
        paymentMethod,
      });
      const data = await res.json();
      setAddedTotal(data.addedTotal || total);

      if (data.paymentMethod === "tbank" && data.paymentUrl) {
        window.location.href = data.paymentUrl;
        return;
      }
      if (data.confirmationToken) {
        setConfirmationToken(data.confirmationToken);
        setStep("paying");
        return;
      }
      toast({ title: "Ошибка", description: "Не удалось создать платёж", variant: "destructive" });
    } catch (err: any) {
      const msg = err?.message || "Ошибка при оформлении дозаказа";
      toast({ title: "Ошибка", description: msg, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  const yookassaEnabled = configData?.yookassaEnabled ?? false;
  const tbankEnabled = configData?.tbankEnabled ?? true;

  return (
    <>
      <Dialog open={open && step !== "paying"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg w-full max-h-[90vh] overflow-y-auto" data-testid="dialog-addon-order">
          <DialogHeader>
            <DialogTitle>
              {step === "success" ? "Дозаказ оформлен" : `Добавить товары к заказу #${orderId}`}
            </DialogTitle>
          </DialogHeader>

          {step === "success" && (
            <div className="flex flex-col items-center gap-4 py-6" data-testid="addon-success">
              <CheckCircle className="w-14 h-14 text-green-500" />
              <p className="text-center text-base font-medium">
                Дозаказ на {formatPrice(addedTotal)} успешно оплачен!
              </p>
              <p className="text-center text-sm text-muted-foreground">
                Товары добавлены к заказу #{orderId}. Вы получите уведомление на почту.
              </p>
              <Button onClick={onClose} data-testid="button-addon-success-close">
                Готово
              </Button>
            </div>
          )}

          {step === "select" && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск товаров..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-addon-search"
                />
              </div>

              {selected.length > 0 && (
                <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Выбрано</p>
                  {selected.map((item) => (
                    <div key={item.productId} className="flex items-start gap-3">
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt={item.productName}
                          className="w-10 h-10 rounded object-cover shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.productName}</p>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          {item.availableSizes.length > 1 && (
                            <select
                              className="text-xs border rounded px-1 py-0.5 bg-background"
                              value={item.size || ""}
                              onChange={(e) => changeSize(item.productId, e.target.value)}
                              data-testid={`select-addon-size-${item.productId}`}
                            >
                              {item.availableSizes.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          )}
                          {item.availableSizes.length === 1 && item.size && (
                            <Badge variant="outline" className="text-xs">{item.size}</Badge>
                          )}
                          {item.availableColors.length > 1 && (
                            <select
                              className="text-xs border rounded px-1 py-0.5 bg-background"
                              value={item.color || ""}
                              onChange={(e) => changeColor(item.productId, e.target.value)}
                              data-testid={`select-addon-color-${item.productId}`}
                            >
                              {item.availableColors.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => changeQty(item.productId, -1)}
                          className="w-6 h-6 rounded border flex items-center justify-center hover:bg-muted"
                          data-testid={`button-addon-qty-minus-${item.productId}`}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-5 text-center text-sm">{item.quantity}</span>
                        <button
                          onClick={() => changeQty(item.productId, 1)}
                          className="w-6 h-6 rounded border flex items-center justify-center hover:bg-muted"
                          data-testid={`button-addon-qty-plus-${item.productId}`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => removeItem(item.productId)}
                          className="w-6 h-6 rounded border flex items-center justify-center hover:bg-muted ml-1 text-destructive"
                          data-testid={`button-addon-remove-${item.productId}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-1 border-t">
                    <span className="text-sm text-muted-foreground">Итого:</span>
                    <span className="font-semibold">{formatPrice(total)}</span>
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Каталог</p>
                {productsLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : products.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Товары не найдены</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {products.map((p) => {
                      const inSelected = selected.find((s) => s.productId === p.id);
                      return (
                        <div
                          key={p.id}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          {(p.images?.[0] || (p as any).imageUrl) && (
                            <img
                              src={p.images?.[0] || (p as any).imageUrl}
                              alt={p.name}
                              className="w-9 h-9 rounded object-cover shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{formatPrice(p.price)}</p>
                          </div>
                          <Button
                            size="sm"
                            variant={inSelected ? "secondary" : "outline"}
                            className="shrink-0 h-7 px-2 text-xs"
                            onClick={() => addProduct(p)}
                            data-testid={`button-addon-add-product-${p.id}`}
                          >
                            {inSelected ? (
                              <><Plus className="w-3 h-3 mr-1" />{inSelected.quantity}</>
                            ) : (
                              <><Plus className="w-3 h-3 mr-1" />Добавить</>
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {(yookassaEnabled || tbankEnabled) && selected.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Способ оплаты</p>
                  <div className="flex gap-2">
                    {tbankEnabled && (
                      <button
                        onClick={() => setPaymentMethod("tbank")}
                        className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          paymentMethod === "tbank"
                            ? "border-primary bg-primary/5 font-medium"
                            : "border-border hover:bg-muted/50"
                        }`}
                        data-testid="button-addon-method-tbank"
                      >
                        Т-Банк
                      </button>
                    )}
                    {yookassaEnabled && (
                      <button
                        onClick={() => setPaymentMethod("yookassa")}
                        className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          paymentMethod === "yookassa"
                            ? "border-primary bg-primary/5 font-medium"
                            : "border-border hover:bg-muted/50"
                        }`}
                        data-testid="button-addon-method-yookassa"
                      >
                        ЮKassa
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={onClose}
                  data-testid="button-addon-cancel"
                >
                  Отмена
                </Button>
                <Button
                  className="flex-1"
                  disabled={selected.length === 0 || isSubmitting}
                  onClick={handlePay}
                  data-testid="button-addon-pay"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <ShoppingBag className="w-4 h-4 mr-2" />
                  )}
                  Оплатить {selected.length > 0 ? formatPrice(total) : ""}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {step === "paying" && confirmationToken && (
        <YooKassaWidget
          confirmationToken={confirmationToken}
          returnUrl={`${window.location.origin}/profile`}
          onSuccess={() => setStep("success")}
          onFail={() => {
            toast({ title: "Ошибка оплаты", description: "Платёж не прошёл, попробуйте ещё раз", variant: "destructive" });
            setStep("select");
            setConfirmationToken(null);
          }}
          onClose={() => {
            setStep("select");
            setConfirmationToken(null);
          }}
        />
      )}
    </>
  );
}
