import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreorderCart } from "@/context/PreorderCartContext";
import { useAuth } from "@/hooks/use-auth";
import YooKassaWidget from "@/components/YooKassaWidget";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ShoppingBag, Package, Trash2, MapPin, Truck, Store,
  ChevronRight, Loader2, CreditCard, Check, AlertCircle
} from "lucide-react";

interface PickupPoint {
  id: string;
  name: string;
  date: string;
  city: string;
  address: string;
  isActive: boolean;
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

export default function PreorderCheckout() {
  const [, setLocation] = useLocation();
  const { items, removeItem, updateSizes, clearCart, totalPrice, totalQuantity } = usePreorderCart();
  const { data: authData } = useAuth();
  const user = authData?.user;
  const { toast } = useToast();

  const [lastName, setLastName] = useState(user?.name?.split(" ")[0] || "");
  const [firstName, setFirstName] = useState(user?.name?.split(" ")[1] || "");
  const [middleName, setMiddleName] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");

  const [deliveryType, setDeliveryType] = useState<"pickup" | "cdek">("pickup");
  const [selectedPickupId, setSelectedPickupId] = useState<string>("");

  const [cdekCityQuery, setCdekCityQuery] = useState("");
  const [cdekCities, setCdekCities] = useState<any[]>([]);
  const [cdekCitiesLoading, setCdekCitiesLoading] = useState(false);
  const [selectedCdekCity, setSelectedCdekCity] = useState<any | null>(null);
  const [selectedCdekPoint, setSelectedCdekPoint] = useState<any | null>(null);
  const [cdekTariffCode, setCdekTariffCode] = useState<number | null>(null);
  const [cdekDeliverySum, setCdekDeliverySum] = useState<number>(0);
  const [showCdekWidget, setShowCdekWidget] = useState(false);
  const [cdekWidgetLoading, setCdekWidgetLoading] = useState(false);
  const [cdekIframeUrl, setCdekIframeUrl] = useState<string | null>(null);
  const cdekInstanceCounterRef = useRef(0);
  const cdekCurrentInstanceRef = useRef<string | null>(null);

  const { data: mapsKeyData } = useQuery<{ key: string }>({
    queryKey: ["/api/cdek/maps-key"],
    staleTime: Infinity,
  });
  const mapsApiKey = mapsKeyData?.key || '';

  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePolicy, setAgreePolicy] = useState(false);

  const [widgetToken, setWidgetToken] = useState<string | null>(null);
  const [widgetOrderId, setWidgetOrderId] = useState<number | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  const { data: pickupPoints = [] } = useQuery<PickupPoint[]>({
    queryKey: ["/api/preorder/pickup-points"],
  });

  const activePickupPoints = pickupPoints.filter(p => p.isActive);

  const { data: paymentMethodsData } = useQuery<{ methods: { id: string; name: string }[]; enabled: boolean }>({
    queryKey: ["/api/payment-methods"],
  });
  const paymentMethods = paymentMethodsData?.methods || [];

  useEffect(() => {
    if (paymentMethods.length > 0 && !paymentMethod) {
      setPaymentMethod(paymentMethods[0].id);
    }
  }, [paymentMethods, paymentMethod]);

  useEffect(() => {
    if (activePickupPoints.length > 0 && !selectedPickupId) {
      setSelectedPickupId(activePickupPoints[0].id);
    }
  }, [activePickupPoints, selectedPickupId]);

  useEffect(() => {
    if (activePickupPoints.length === 0 && deliveryType === "pickup") {
      setDeliveryType("cdek");
    }
  }, [activePickupPoints, deliveryType]);

  useEffect(() => {
    if (!cdekCityQuery.trim() || cdekCityQuery.length < 2) { setCdekCities([]); return; }
    const timer = setTimeout(async () => {
      setCdekCitiesLoading(true);
      try {
        const r = await fetch(`/api/cdek/cities?city=${encodeURIComponent(cdekCityQuery)}&size=7`);
        if (r.ok) { const d = await r.json(); setCdekCities(Array.isArray(d) ? d : []); }
      } catch { setCdekCities([]); }
      finally { setCdekCitiesLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [cdekCityQuery]);

  useEffect(() => {
    const handle = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.instanceId !== cdekCurrentInstanceRef.current) return;
      if (d.type === "cdek:ready") { setCdekWidgetLoading(false); }
      if (d.type === "cdek:choose") {
        setSelectedCdekPoint({ code: d.point.code, name: d.point.name, address: d.point.address });
        setCdekTariffCode(d.tariff_code || 136);
        setCdekDeliverySum(d.delivery_sum ? Math.round(d.delivery_sum * 100) : 0);
        setShowCdekWidget(false);
        toast({ title: "ПВЗ СДЭК выбран", description: d.point.name });
      }
      if (d.type === "cdek:error") { setCdekWidgetLoading(false); }
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [toast]);

  const buildCdekIframeUrl = useCallback((city: any): string => {
    cdekInstanceCounterRef.current += 1;
    const instanceId = `cdek-${cdekInstanceCounterRef.current}-${Date.now()}`;
    cdekCurrentInstanceRef.current = instanceId;
    const params = new URLSearchParams({
      city_code: String(city.code),
      city_name: city.city,
      lat: String(city.latitude || 54.011),
      lon: String(city.longitude || 38.29),
      instance_id: instanceId,
      service_path: '/api/cdek/widget-proxy',
      ...(mapsApiKey ? { api_key: mapsApiKey } : {}),
    });
    return `/cdek-widget.html?${params.toString()}`;
  }, [mapsApiKey]);

  const openCdekWidget = useCallback(() => {
    if (!selectedCdekCity) return;
    setCdekWidgetLoading(true);
    setShowCdekWidget(true);
    const url = buildCdekIframeUrl(selectedCdekCity);
    setCdekIframeUrl(url);
  }, [selectedCdekCity, buildCdekIframeUrl]);

  const orderMutation = useMutation({
    mutationFn: async () => {
      setOrderError(null);

      if (!lastName.trim() || !firstName.trim()) throw new Error("Укажите фамилию и имя");
      if (!email.trim() || !email.includes("@")) throw new Error("Укажите корректный email");
      if (!phone.trim()) throw new Error("Укажите телефон");
      if (!agreeTerms || !agreePolicy) throw new Error("Необходимо принять условия");
      if (items.length === 0) throw new Error("Корзина пуста");

      if (deliveryType === "pickup" && !selectedPickupId) throw new Error("Выберите точку самовывоза");
      if (deliveryType === "cdek" && !selectedCdekPoint) throw new Error("Выберите пункт выдачи СДЭК");

      const pickupPoint = activePickupPoints.find(p => p.id === selectedPickupId);
      const address = deliveryType === "pickup"
        ? `Самовывоз: ${pickupPoint?.name || ""}, ${pickupPoint?.city || ""}, ${pickupPoint?.address || ""}`
        : `СДЭК ПВЗ: ${selectedCdekPoint?.name || ""}, ${selectedCdekPoint?.address || ""}`;

      const deliveryCost = deliveryType === "cdek" ? cdekDeliverySum : 0;

      const orderItems = items.flatMap(item =>
        Object.entries(item.selectedSizes)
          .filter(([, qty]) => qty > 0)
          .map(([size, quantity]) => ({
            productId: item.productId,
            productName: item.productName,
            quantity,
            price: item.price,
            size: size === "ONE SIZE" ? undefined : size,
            color: item.selectedColor,
            imageUrl: item.imageUrl,
          }))
      );

      const data = await apiRequest("POST", "/api/preorder/order-multi", {
        customerLastName: lastName.trim(),
        customerFirstName: firstName.trim(),
        customerMiddleName: middleName.trim(),
        customerEmail: email.trim(),
        customerPhone: phone.trim(),
        address,
        paymentMethod,
        items: orderItems,
        deliveryType,
        pickupPointId: deliveryType === "pickup" ? selectedPickupId : undefined,
        cdekPointCode: deliveryType === "cdek" ? selectedCdekPoint?.code : undefined,
        cdekPointAddress: deliveryType === "cdek" ? selectedCdekPoint?.address : undefined,
        cdekCityCode: deliveryType === "cdek" ? selectedCdekCity?.code : undefined,
        cdekTariffCode: deliveryType === "cdek" ? cdekTariffCode : undefined,
        cdekDeliverySum: deliveryType === "cdek" ? cdekDeliverySum : undefined,
      });

      return data;
    },
    onSuccess: (data: any) => {
      if (data.confirmationToken) {
        setWidgetToken(data.confirmationToken);
        setWidgetOrderId(data.orderId || null);
      } else if (data.paymentUrl) {
        clearCart();
        window.location.href = data.paymentUrl;
      }
    },
    onError: (err: any) => {
      setOrderError(err.message || "Ошибка при создании предзаказа");
    },
  });

  if (items.length === 0 && !widgetToken) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <SEO title="Корзина предзаказов | BOOOMERANGS" description="" />
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-40 text-center">
          <Package className="w-16 h-16 text-muted-foreground/30 mx-auto mb-6" />
          <h2 className="text-xl font-semibold mb-3">Корзина предзаказов пуста</h2>
          <p className="text-muted-foreground text-sm mb-8">Добавь товары с Pre-drop страницы</p>
          <Button onClick={() => setLocation("/concept")}>
            Перейти к Pre-drop
          </Button>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO title="Оформление предзаказа | BOOOMERANGS" description="Оформи предзаказ на товары BOOOMERANGS — получи первым" />
      <Navbar />
      {widgetToken && (
        <YooKassaWidget
          confirmationToken={widgetToken}
          returnUrl={`${window.location.origin}/order-success/${widgetOrderId}`}
          onSuccess={() => {
            clearCart();
            setWidgetToken(null);
            if (widgetOrderId) setLocation(`/order-success/${widgetOrderId}`);
          }}
          onFail={() => {
            setWidgetToken(null);
            toast({ title: "Оплата не прошла", variant: "destructive" });
          }}
          onClose={() => setWidgetToken(null)}
        />
      )}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-28 pb-20">

        <h1 className="text-2xl font-black uppercase tracking-[-0.03em] mb-8">
          Оформление предзаказа
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">

          {/* Left column: form */}
          <div className="space-y-8">

            {/* Cart items */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                <ShoppingBag className="w-4 h-4" />
                Товары ({totalQuantity} шт.)
              </h2>
              <div className="space-y-3">
                {items.map(item => {
                  const qty = Object.values(item.selectedSizes).reduce((s, q) => s + q, 0);
                  return (
                    <div key={item.productId} className="flex items-center gap-4 p-4 border border-border rounded-xl bg-card">
                      {item.imageUrl && (
                        <img src={item.imageUrl} alt={item.productName} className="w-16 h-20 object-cover rounded-md shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm leading-tight">{item.productName}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {Object.entries(item.selectedSizes).filter(([, q]) => q > 0).map(([size, q]) => (
                            <span key={size} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs font-medium">
                              {size === "ONE SIZE" ? "One Size" : size}
                              {q > 1 && <span className="text-muted-foreground">×{q}</span>}
                            </span>
                          ))}
                        </div>
                        <p className="text-sm font-bold mt-2">{formatPrice(item.price * qty)}</p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => removeItem(item.productId)}
                        data-testid={`button-remove-preorder-item-${item.productId}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Customer info */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                <CreditCard className="w-4 h-4" />
                Контактные данные
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  placeholder="Фамилия *"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  data-testid="input-preorder-lastname"
                />
                <Input
                  placeholder="Имя *"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  data-testid="input-preorder-firstname"
                />
                <Input
                  placeholder="Отчество"
                  value={middleName}
                  onChange={e => setMiddleName(e.target.value)}
                  data-testid="input-preorder-middlename"
                  className="sm:col-span-2"
                />
                <Input
                  type="email"
                  placeholder="Email *"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  data-testid="input-preorder-email"
                />
                <Input
                  type="tel"
                  placeholder="Телефон *"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  data-testid="input-preorder-phone"
                />
              </div>
            </section>

            {/* Delivery */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Доставка
              </h2>

              {(activePickupPoints.length > 0 || true) && (
                <div className="flex flex-col sm:flex-row gap-2 mb-5">
                  {activePickupPoints.length > 0 && (
                    <button
                      onClick={() => setDeliveryType("pickup")}
                      className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors text-left ${
                        deliveryType === "pickup"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      }`}
                      data-testid="button-delivery-pickup"
                    >
                      <Store className={`w-5 h-5 shrink-0 ${deliveryType === "pickup" ? "text-primary" : "text-muted-foreground"}`} />
                      <div>
                        <p className="font-semibold text-sm">Самовывоз на фестивале</p>
                        <p className="text-xs text-muted-foreground">Бесплатно</p>
                      </div>
                    </button>
                  )}
                  <button
                    onClick={() => setDeliveryType("cdek")}
                    className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors text-left ${
                      deliveryType === "cdek"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    }`}
                    data-testid="button-delivery-cdek"
                  >
                    <Truck className={`w-5 h-5 shrink-0 ${deliveryType === "cdek" ? "text-primary" : "text-muted-foreground"}`} />
                    <div>
                      <p className="font-semibold text-sm">СДЭК до ПВЗ</p>
                      <p className="text-xs text-muted-foreground">После окончания сбора</p>
                    </div>
                  </button>
                </div>
              )}

              {deliveryType === "pickup" && activePickupPoints.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground mb-3">Выбери точку самовывоза</p>
                  {activePickupPoints.map(point => (
                    <button
                      key={point.id}
                      onClick={() => setSelectedPickupId(point.id)}
                      className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border transition-colors text-left ${
                        selectedPickupId === point.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      }`}
                      data-testid={`button-pickup-point-${point.id}`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${
                        selectedPickupId === point.id ? "border-primary" : "border-muted-foreground"
                      }`}>
                        {selectedPickupId === point.id && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{point.name}</p>
                        <p className="text-xs text-muted-foreground">{point.city}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3" />{point.address}
                        </p>
                        {point.date && (
                          <p className="text-xs text-foreground font-medium mt-0.5">{point.date}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {deliveryType === "cdek" && (
                <div className="space-y-4">
                  <div className="relative">
                    <Input
                      placeholder="Введите город..."
                      value={cdekCityQuery}
                      onChange={e => { setCdekCityQuery(e.target.value); setSelectedCdekCity(null); setSelectedCdekPoint(null); }}
                      data-testid="input-cdek-city"
                    />
                    {cdekCitiesLoading && (
                      <Loader2 className="absolute right-3 top-3 w-4 h-4 animate-spin text-muted-foreground" />
                    )}
                    {cdekCities.length > 0 && !selectedCdekCity && (
                      <div className="absolute z-50 w-full bg-card border border-border rounded-xl shadow-lg mt-1 overflow-hidden">
                        {cdekCities.map(city => (
                          <button
                            key={city.code}
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors"
                            onClick={() => { setSelectedCdekCity(city); setCdekCityQuery(city.city); setCdekCities([]); }}
                            data-testid={`option-cdek-city-${city.code}`}
                          >
                            {city.city}{city.region && `, ${city.region}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedCdekCity && !selectedCdekPoint && (
                    <Button variant="outline" className="w-full" onClick={openCdekWidget} disabled={cdekWidgetLoading} data-testid="button-open-cdek-widget">
                      {cdekWidgetLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <MapPin className="w-4 h-4 mr-2" />}
                      {cdekWidgetLoading ? "Загрузка карты..." : "Выбрать ПВЗ на карте"}
                    </Button>
                  )}

                  {showCdekWidget && cdekIframeUrl && (
                    <div className="relative w-full h-[500px]">
                      <iframe
                        key={cdekIframeUrl}
                        src={cdekIframeUrl}
                        className="absolute inset-0 w-full h-full border border-border rounded-xl"
                        style={{ border: 'none' }}
                        title="CDEK Points Map"
                        data-testid="preorder-cdek-widget-iframe"
                      />
                      {cdekWidgetLoading && (
                        <div className="absolute inset-0 border border-border rounded-xl flex flex-col items-center justify-center bg-accent/10 z-10">
                          <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                          <p className="text-muted-foreground text-sm">Загрузка карты ПВЗ...</p>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedCdekPoint && (
                    <div className="flex items-start gap-3 p-4 rounded-xl border border-primary bg-primary/5">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{selectedCdekPoint.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3 h-3" />{selectedCdekPoint.address}
                        </p>
                        {cdekDeliverySum > 0 && (
                          <p className="text-xs font-medium text-foreground mt-0.5">
                            Стоимость доставки: {formatPrice(cdekDeliverySum)}
                          </p>
                        )}
                      </div>
                      <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setSelectedCdekPoint(null); setShowCdekWidget(false); setCdekIframeUrl(null); }}>
                        Изменить
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Payment */}
            {paymentMethods.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  Способ оплаты
                </h2>
                <div className="flex flex-col gap-2">
                  {paymentMethods.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setPaymentMethod(m.id)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors text-left ${
                        paymentMethod === m.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                      data-testid={`button-payment-${m.id}`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                        paymentMethod === m.id ? "border-primary" : "border-muted-foreground"
                      }`}>
                        {paymentMethod === m.id && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                      </div>
                      <span className="font-medium text-sm">{m.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Terms */}
            <section className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer group" data-testid="label-agree-terms">
                <div
                  onClick={() => setAgreeTerms(!agreeTerms)}
                  className={`w-5 h-5 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center cursor-pointer transition-colors ${
                    agreeTerms ? "bg-primary border-primary" : "border-muted-foreground group-hover:border-primary"
                  }`}
                >
                  {agreeTerms && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>
                <span className="text-xs text-muted-foreground leading-relaxed">
                  Согласен с{" "}
                  <a href="/terms" target="_blank" className="underline hover:text-foreground">условиями предзаказа</a>
                  {" "}и условиями{" "}
                  <a href="/terms" target="_blank" className="underline hover:text-foreground">публичной оферты</a>
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer group" data-testid="label-agree-policy">
                <div
                  onClick={() => setAgreePolicy(!agreePolicy)}
                  className={`w-5 h-5 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center cursor-pointer transition-colors ${
                    agreePolicy ? "bg-primary border-primary" : "border-muted-foreground group-hover:border-primary"
                  }`}
                >
                  {agreePolicy && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>
                <span className="text-xs text-muted-foreground leading-relaxed">
                  Согласен на{" "}
                  <a href="/privacy" target="_blank" className="underline hover:text-foreground">обработку персональных данных</a>
                </span>
              </label>
            </section>
          </div>

          {/* Right column: order summary */}
          <div className="space-y-4">
            <div className="border border-border rounded-2xl p-6 bg-card sticky top-28">
              <h3 className="font-bold text-base mb-4">Итого</h3>
              <div className="space-y-3">
                {items.map(item => {
                  const qty = Object.values(item.selectedSizes).reduce((s, q) => s + q, 0);
                  return (
                    <div key={item.productId} className="flex items-center gap-3">
                      {item.imageUrl && (
                        <img src={item.imageUrl} alt="" className="w-10 h-12 object-cover rounded shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">× {qty}</p>
                      </div>
                      <p className="text-sm font-semibold shrink-0">{formatPrice(item.price * qty)}</p>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-border mt-4 pt-4 space-y-2">
                {deliveryType === "cdek" && cdekDeliverySum > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Доставка СДЭК</span>
                    <span>{formatPrice(cdekDeliverySum)}</span>
                  </div>
                )}
                {deliveryType === "pickup" && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Самовывоз</span>
                    <span className="text-green-600 font-medium">Бесплатно</span>
                  </div>
                )}
                <div className="flex items-center justify-between font-bold">
                  <span>Итого</span>
                  <span className="text-lg">{formatPrice(totalPrice + (deliveryType === "cdek" ? cdekDeliverySum : 0))}</span>
                </div>
              </div>

              {orderError && (
                <div className="flex items-start gap-2 mt-4 p-3 rounded-lg bg-destructive/10 text-destructive text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {orderError}
                </div>
              )}

              <Button
                className="w-full mt-5 h-12 font-semibold text-base"
                onClick={() => orderMutation.mutate()}
                disabled={orderMutation.isPending || !agreeTerms || !agreePolicy || items.length === 0}
                data-testid="button-submit-preorder"
              >
                {orderMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />Создаём предзаказ...</>
                ) : (
                  <>Оплатить <ChevronRight className="w-4 h-4 ml-1" /></>
                )}
              </Button>

              <p className="text-[11px] text-muted-foreground text-center mt-3 leading-relaxed">
                Нажимая «Оплатить», вы оформляете предзаказ. Деньги будут списаны сейчас.
              </p>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
