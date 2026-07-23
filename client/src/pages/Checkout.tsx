import SEO from "@/components/SEO";
import { DolyameWidget, DolyameLogo } from "@/components/DolyameWidget";
import YooKassaWidget, { loadWidgetScript } from "@/components/YooKassaWidget";

import yookassaLogo from "@assets/yookassa-logo.webp";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCart, useUpdateCartQuantity, useRemoveFromCart } from "@/hooks/use-cart";
import { useCreateOrder } from "@/hooks/use-orders";
import { useSession } from "@/hooks/use-session";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { type CheckoutSettings, DEFAULT_CHECKOUT_SETTINGS } from "@/components/checkout-settings";
import { Loader2, CheckCircle2, MapPin, Truck, Search, Package, Tag, Percent, CreditCard, Landmark, Building2, Info, Gift, Plus, Minus, Trash2, Clock, ShieldCheck, AlertCircle } from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getStoredRef } from "@/lib/partner-ref";

// Transport companies for wholesale
const TRANSPORT_COMPANIES = [
  { id: "cdek",    name: "СДЭК",           abbr: "СД",  color: "#00A94B", desc: "Доставка по всей России" },
  { id: "dellin",  name: "Деловые Линии",  abbr: "ДЛ",  color: "#ED1C24", desc: "Грузовая логистика" },
  { id: "pek",     name: "ПЭК",            abbr: "ПЭК", color: "#00599D", desc: "Межрегиональная доставка" },
  { id: "pochta",  name: "Почта России",   abbr: "ПР",  color: "#004D9E", desc: "Отправление по всей РФ" },
  { id: "baikal",  name: "ТК Байкал",      abbr: "БК",  color: "#0070C0", desc: "Доставка до терминала" },
];

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

interface CdekCity {
  code: number;
  city: string;
  region?: string;
  latitude?: number;
  longitude?: number;
}

interface CdekPoint {
  code: string;
  name: string;
  location: {
    address: string;
    address_full: string;
  };
  work_time?: string;
}

interface CdekTariff {
  tariff_code: number;
  tariff_name: string;
  tariff_description: string;
  delivery_sum: number;
  period_min: number;
  period_max: number;
}


const CDEK_DOOR_TARIFFS = [137, 139, 184, 480, 482, 486];

type DeliveryService = "cdek" | "ozon";

interface GiftCardValidationResponse {
  valid: boolean;
  balance?: number;
  expiresAt?: string;
  error?: string;
}

interface PromoValidationResponse {
  valid: boolean;
  code?: string;
  discountPercent?: number;
  discountAmount?: number;
  canCombineWithLoyalty?: boolean;
  applicableCategories?: string[] | null;
  eligibleAmount?: number | null;
  message?: string;
  error?: string;
}

const checkoutSchema = z.object({
  customerLastName: z.string().min(2, "Фамилия обязательна"),
  customerFirstName: z.string().min(2, "Имя обязательно"),
  customerPatronymic: z.string().min(2, "Отчество обязательно"),
  customerEmail: z.string().email("Некорректный email"),
  customerPhone: z.string().min(10, "Номер телефона обязателен"),
  address: z.string().min(5, "Адрес обязателен"),
  promoCode: z.string().optional(),
});

type CheckoutForm = z.infer<typeof checkoutSchema>;

export default function Checkout() {
  const sessionId = useSession();
  const { data: cartItems } = useCart();
  const updateQuantity = useUpdateCartQuantity();
  const removeFromCart = useRemoveFromCart();
  const createOrder = useCreateOrder();
  const { data: authData } = useAuth();
  const [, setLocation] = useLocation();
  const [success, setSuccess] = useState(false);
  const [widgetToken, setWidgetToken] = useState<string | null>(null);
  const [widgetOrderId, setWidgetOrderId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: stockValidation } = useQuery<{ valid: boolean; issues: { productName: string; size?: string; requested: number; available: number }[] }>({
    queryKey: ["/api/cart/validate", sessionId],
    queryFn: async () => {
      if (!sessionId) return { valid: true, issues: [] };
      const res = await fetch(`/api/cart/${sessionId}/validate`);
      if (!res.ok) return { valid: true, issues: [] };
      return res.json();
    },
    enabled: !!sessionId,
    staleTime: 30000,
  });

  const { data: checkoutSettingsRaw } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings", "checkout"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/checkout");
      if (!res.ok) return {};
      return res.json();
    },
  });

  const cs: CheckoutSettings = useMemo(() => {
    if (!checkoutSettingsRaw?.checkout_data) return DEFAULT_CHECKOUT_SETTINGS;
    try {
      const parsed = typeof checkoutSettingsRaw.checkout_data === "string" 
        ? JSON.parse(checkoutSettingsRaw.checkout_data) 
        : checkoutSettingsRaw.checkout_data;
      return { ...DEFAULT_CHECKOUT_SETTINGS, ...parsed };
    } catch {
      return DEFAULT_CHECKOUT_SETTINGS;
    }
  }, [checkoutSettingsRaw]);

  // Check if user is wholesale (for pricing and delivery)
  const isWholesale = authData?.user?.role === "wholesale" && authData?.user?.wholesaleApproved;
  
  // Wholesale users (any role=wholesale) are excluded from bonus program, regardless of approval status
  const isEligibleForLoyalty = authData?.user && authData?.user?.role !== "wholesale";
  
  // Get loyalty discount only for eligible retail customers
  const userLoyaltyDiscount = (isEligibleForLoyalty && authData?.user) ? ((authData.user as any).loyaltyDiscount || 0) : 0;

  // Delivery service selection
  const [deliveryService, setDeliveryService] = useState<DeliveryService>("cdek");

  // CDEK state
  const [deliveryType, setDeliveryType] = useState<"pickup" | "door">("pickup");
  const [citySearch, setCitySearch] = useState("");
  const [selectedCity, setSelectedCity] = useState<CdekCity | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<CdekPoint | null>(null);
  const [widgetDelivery, setWidgetDelivery] = useState<{
    delivery_sum: number;
    period_min: number | null;
    period_max: number | null;
    delivery_type: string | null;
    tariff_code: number | null;
  } | null>(null);
  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const [cdekDoorStreet, setCdekDoorStreet] = useState("");
  const [cdekDoorHouse, setCdekDoorHouse] = useState("");
  const [cdekDoorApartment, setCdekDoorApartment] = useState("");
  const [cdekDoorEntrance, setCdekDoorEntrance] = useState("");
  const [cdekDoorFloor, setCdekDoorFloor] = useState("");

  // Wholesale transport company
  const [selectedTransport, setSelectedTransport] = useState<string>("cdek");

  // Promo state
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<PromoValidationResponse | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("yookassa");
  
  useEffect(() => {
    if (isWholesale) {
      setSelectedPaymentMethod("invoice");
    }
  }, [isWholesale]);

  useEffect(() => {
    if (selectedPaymentMethod === "yookassa") {
      loadWidgetScript().catch(() => {});
    }
  }, [selectedPaymentMethod]);

  // Auto-apply promo code from sessionStorage (set by PromoCapture in App.tsx
  // when user arrives from a post-purchase email link like /products?promo=CODE).
  const autoPromoApplied = useRef(false);
  useEffect(() => {
    if (autoPromoApplied.current) return;
    if (!cartItems || cartItems.length === 0) return;
    const pending = sessionStorage.getItem("pendingPromo");
    if (!pending) return;
    autoPromoApplied.current = true;
    sessionStorage.removeItem("pendingPromo");
    setPromoCodeInput(pending);
    validatePromo.mutate(pending);
  }, [cartItems]);

  // Gift card state
  const [giftCardInput, setGiftCardInput] = useState("");
  const [appliedGiftCard, setAppliedGiftCard] = useState<{ code: string; balance: number } | null>(null);
  
  // Agreement checkboxes
  const [agreeOffer, setAgreeOffer] = useState(false);
  const [agreePolicy, setAgreePolicy] = useState(false);
  const [showDeliveryInfo, setShowDeliveryInfo] = useState(false);

  // Widget state - using iframe for complete isolation
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [widgetLoading, setWidgetLoading] = useState(false);
  
  // Unique instance ID for iframe isolation
  const instanceIdRef = useRef(0);
  const currentInstanceRef = useRef<string | null>(null);

  const { data: mapsKeyData } = useQuery<{ key: string }>({
    queryKey: ["/api/cdek/maps-key"],
    staleTime: Infinity,
  });
  const mapsApiKey = mapsKeyData?.key || '';

  // Generate iframe URL for current city
  const getIframeUrl = useCallback((city: typeof selectedCity) => {
    if (!city) return null;
    instanceIdRef.current += 1;
    const instanceId = `cdek-${instanceIdRef.current}-${Date.now()}`;
    currentInstanceRef.current = instanceId;
    
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

  // Listen for messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      
      // Validate instance ID to ignore stale messages
      if (data.instanceId !== currentInstanceRef.current) {
        console.log('[CDEK Widget] Ignoring stale message from instance:', data.instanceId);
        return;
      }
      
      switch (data.type) {
        case 'cdek:ready':
          console.log('[CDEK Widget] Ready');
          setWidgetLoading(false);
          break;
        case 'cdek:choose':
          console.log('[CDEK Widget] Chosen:', data);
          setSelectedPoint({
            code: data.point.code,
            name: data.point.name,
            location: { 
              address: data.point.address, 
              address_full: data.point.address 
            },
            work_time: data.point.work_time
          });
          setWidgetDelivery({
            delivery_sum: data.delivery_sum || 0,
            period_min: data.period_min,
            period_max: data.period_max,
            delivery_type: data.delivery_type,
            tariff_code: data.tariff_code || null
          });
          break;
        case 'cdek:error':
          console.error('[CDEK Widget] Error:', data.error);
          setWidgetLoading(false);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Generate iframe URL when city changes
  const iframeUrl = useMemo(() => {
    if (deliveryType !== 'pickup' || !selectedCity) {
      currentInstanceRef.current = null;
      return null;
    }
    setWidgetLoading(true);
    setWidgetError(null);
    return getIframeUrl(selectedCity);
  }, [deliveryType, selectedCity?.code, getIframeUrl]);

  const { data: paymentMethodsData } = useQuery<{ methods: { id: string, name: string, description?: string }[], enabled: boolean, ozonPayEnabled?: boolean }>({
    queryKey: ["/api/payment-methods"],
  });
  const paymentMethods = paymentMethodsData?.methods || [];
  // Временно скрыт до готовности: const ozonPayEnabled = paymentMethodsData?.ozonPayEnabled === true;
  const ozonPayEnabled = false;

  const { register, handleSubmit, setValue, watch, getValues, formState: { errors } } = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      customerLastName: "",
      customerFirstName: "",
      customerPatronymic: "",
      customerEmail: "",
      customerPhone: "",
      address: "",
      promoCode: "",
    },
  });

  // Auto-set payment method and address when Ozon delivery is selected
  useEffect(() => {
    if (deliveryService === "ozon") {
      setSelectedPaymentMethod("ozon-pay");
      setValue("address", "Ozon Pay (адрес и ПВЗ выбирается в виджете Ozon)");
    }
  }, [deliveryService, setValue]);

  const { data: savedShippingData } = useQuery<{ shippingData: { customerName?: string; customerEmail?: string; customerPhone?: string; address?: string; transportCompany?: string } | null }>({
    queryKey: ["/api/auth/shipping-data"],
    enabled: !!isWholesale,
    staleTime: 1000 * 60 * 10,
  });

  interface SavedAddress {
    id: string;
    label: string;
    city: string;
    address: string;
    postalCode?: string;
    street?: string;
    house?: string;
    apartment?: string;
    entrance?: string;
    floor?: string;
    lastName?: string;
    firstName?: string;
    patronymic?: string;
    phone?: string;
    isDefault: boolean;
  }

  const { data: savedAddressesData } = useQuery<{ addresses: SavedAddress[] }>({
    queryKey: ["/api/auth/addresses"],
    enabled: !!authData?.user && !isWholesale,
    staleTime: 1000 * 60 * 10,
  });

  useEffect(() => {
    if (isWholesale && savedShippingData?.shippingData) {
      const sd = savedShippingData.shippingData;
      if (sd.customerName) {
        const nameParts = sd.customerName.split(' ');
        if (nameParts[0]) setValue("customerLastName", nameParts[0]);
        if (nameParts[1]) setValue("customerFirstName", nameParts[1]);
        if (nameParts[2]) setValue("customerPatronymic", nameParts.slice(2).join(' '));
      }
      if (sd.customerEmail) setValue("customerEmail", sd.customerEmail);
      if (sd.customerPhone) setValue("customerPhone", sd.customerPhone);
      if (sd.address) setValue("address", sd.address);
      if (sd.transportCompany) setSelectedTransport(sd.transportCompany);
    }
  }, [isWholesale, savedShippingData, setValue]);

  useEffect(() => {
    if (!isWholesale && savedAddressesData?.addresses) {
      const defaultAddr = savedAddressesData.addresses.find(a => a.isDefault) || savedAddressesData.addresses[0];
      if (defaultAddr) {
        if (defaultAddr.lastName && !watch("customerLastName")) setValue("customerLastName", defaultAddr.lastName);
        if (defaultAddr.firstName && !watch("customerFirstName")) setValue("customerFirstName", defaultAddr.firstName);
        if (defaultAddr.patronymic && !watch("customerPatronymic")) setValue("customerPatronymic", defaultAddr.patronymic);
        if (defaultAddr.phone && !watch("customerPhone")) setValue("customerPhone", defaultAddr.phone);
        if (defaultAddr.address && !watch("address")) setValue("address", defaultAddr.address);
        if (defaultAddr.city && !selectedCity) {
          setCitySearch(defaultAddr.city);
        }
      }
    }
  }, [isWholesale, savedAddressesData, setValue, watch, selectedCity]);

  // Helper to get correct price based on wholesale status (with discount support)
  const getItemPrice = (product: any, size?: string | null) => {
    if (isWholesale && product.wholesalePrice) return product.wholesalePrice;
    if (!isWholesale && product.salePrice && product.salePrice > 0 && product.salePrice < product.price) {
      return product.salePrice;
    }
    const discountPct = product.discountPercent;
    const sizeDiscounts = product.sizeDiscounts as Record<string, number> | null;
    const sizeDiscount = sizeDiscounts && size ? sizeDiscounts[size] : null;
    const effectiveDiscount = sizeDiscount ?? discountPct;
    if (effectiveDiscount && effectiveDiscount > 0 && !isWholesale) {
      return Math.round(product.price * (1 - effectiveDiscount / 100));
    }
    return product.price;
  };

  const subtotal = cartItems?.reduce((acc, item) => acc + (getItemPrice(item.product, item.size) * item.quantity), 0) || 0;

  const validatePromo = useMutation({
    mutationFn: async (code: string) => {
      const cartItemsForValidation = cartItems?.map(item => ({
        category: item.product.category || '',
        subcategory: (item.product as any).subcategory || '',
        price: item.product.price,
        quantity: item.quantity,
      })) || [];
      const res = await apiRequest("POST", "/api/promo-codes/validate", { 
        code, 
        orderAmount: subtotal,
        email: getValues("customerEmail") || undefined,
        cartItems: cartItemsForValidation,
      });
      return res.json() as Promise<PromoValidationResponse>;
    },
    onSuccess: (data) => {
      if (data.valid) {
        setAppliedPromo(data);
        const discountText = data.discountPercent 
          ? `${data.discountPercent}%`
          : `${(data.discountAmount || 0) / 100} ₽`;
        const categoryHint = data.applicableCategories && data.applicableCategories.length > 0
          ? ` на: ${data.applicableCategories.join(', ')}`
          : '';
        toast({
          title: "Промокод применен",
          description: `Скидка: ${discountText}${categoryHint}`,
        });
      } else {
        setAppliedPromo(null);
        toast({
          variant: "destructive",
          title: "Ошибка",
          description: data.message || data.error || "Неверный промокод",
        });
      }
    }
  });

  const handleApplyPromo = () => {
    if (!promoCodeInput) return;
    validatePromo.mutate(promoCodeInput);
  };

  // Gift card validation mutation
  const validateGiftCard = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch(`/api/gift-cards/validate/${encodeURIComponent(code.toUpperCase())}`);
      return res.json() as Promise<GiftCardValidationResponse>;
    },
    onSuccess: (data) => {
      if (data.valid && data.balance) {
        setAppliedGiftCard({ code: giftCardInput.toUpperCase(), balance: data.balance });
        toast({
          title: "Сертификат применён",
          description: `Баланс: ${(data.balance / 100).toLocaleString("ru-RU")} ₽`,
        });
      } else {
        setAppliedGiftCard(null);
        toast({
          variant: "destructive",
          title: "Ошибка",
          description: data.error || "Неверный сертификат",
        });
      }
    }
  });

  const handleApplyGiftCard = () => {
    if (!giftCardInput) return;
    validateGiftCard.mutate(giftCardInput);
  };

  const debouncedCitySearch = useDebounce(citySearch, 300);

  const { data: citiesRaw, isLoading: citiesLoading } = useQuery<CdekCity[]>({
    queryKey: ["/api/cdek/cities", debouncedCitySearch],
    queryFn: async () => {
      const res = await fetch(`/api/cdek/cities?city=${encodeURIComponent(debouncedCitySearch)}`);
      if (!res.ok) throw new Error("Failed to fetch cities");
      return res.json();
    },
    enabled: debouncedCitySearch.length >= 1 && !selectedCity,
  });

  const cities = citiesRaw?.filter((c) =>
    c.city.toLowerCase().startsWith(citySearch.toLowerCase())
  );

  useEffect(() => {
    if (cities && cities.length > 0 && !selectedCity && citySearch.length >= 1) {
      setShowCityDropdown(true);
    }
  }, [cities, selectedCity, citySearch]);

  const { data: deliveryPoints, isLoading: pointsLoading } = useQuery<CdekPoint[]>({
    queryKey: ["/api/cdek/delivery-points", selectedCity?.code],
    queryFn: async () => {
      const res = await fetch(`/api/cdek/delivery-points?city_code=${selectedCity?.code}`);
      if (!res.ok) throw new Error("Failed to fetch delivery points");
      return res.json();
    },
    enabled: !!selectedCity && deliveryType === "pickup",
  });

  const { data: deliveryCalc, isLoading: calcLoading } = useQuery<{ tariffs: CdekTariff[] }>({
    queryKey: ["/api/cdek/calculate", selectedCity?.code],
    queryFn: async () => {
      const res = await fetch(`/api/cdek/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_city_code: selectedCity?.code }),
      });
      if (!res.ok) return { tariffs: [] };
      return res.json();
    },
    enabled: !!selectedCity,
  });

  const pvzTariffs = deliveryCalc?.tariffs?.filter(t => !CDEK_DOOR_TARIFFS.includes(t.tariff_code)) || [];
  const doorTariffs = deliveryCalc?.tariffs?.filter(t => CDEK_DOOR_TARIFFS.includes(t.tariff_code)) || [];
  const cheapestTariff = pvzTariffs.length ? pvzTariffs.reduce((min, t) => t.delivery_sum < min.delivery_sum ? t : min, pvzTariffs[0]) : null;
  const cheapestDoorTariff = doorTariffs.length ? doorTariffs.reduce((min, t) => t.delivery_sum < min.delivery_sum ? t : min, doorTariffs[0]) : null;

  const FREE_SHIPPING_THRESHOLD = 500000;
  const isFreeShipping = !isWholesale && subtotal >= FREE_SHIPPING_THRESHOLD;

  const cdekDeliveryCost = !isWholesale 
    ? (deliveryType === "door" 
      ? (cheapestDoorTariff ? cheapestDoorTariff.delivery_sum * 100 : 0)
      : (widgetDelivery?.delivery_sum 
        ? widgetDelivery.delivery_sum * 100 
        : (cheapestTariff ? cheapestTariff.delivery_sum * 100 : 0)))
    : 0;
  
  const rawDeliveryCost = isWholesale ? 0 : deliveryService === "ozon" ? 0 : cdekDeliveryCost;
  const deliveryCost = isFreeShipping ? 0 : rawDeliveryCost;
  // Calculate promo discount: percent-based or fixed amount
  // If promo has category restrictions, eligibleAmount is the sum of matching items
  const promoEligibleAmount = appliedPromo?.eligibleAmount ?? subtotal;
  const promoDiscount = appliedPromo 
    ? (appliedPromo.discountPercent 
        ? Math.round(promoEligibleAmount * (appliedPromo.discountPercent / 100))
        : (appliedPromo.discountAmount || 0))
    : 0;
  
  // Calculate loyalty discount amount (only for retail, check if can combine with promo)
  const canApplyLoyalty = !appliedPromo || appliedPromo.canCombineWithLoyalty !== false;
  const loyaltyDiscountAmount = (userLoyaltyDiscount > 0 && canApplyLoyalty) 
    ? Math.round(subtotal * (userLoyaltyDiscount / 100)) 
    : 0;
  
  // Calculate gift card discount (can't exceed order total)
  const giftCardDiscount = appliedGiftCard 
    ? Math.min(appliedGiftCard.balance, subtotal + deliveryCost - promoDiscount - loyaltyDiscountAmount)
    : 0;
  
  const total = Math.max(0, subtotal + deliveryCost - promoDiscount - loyaltyDiscountAmount - giftCardDiscount);

  const WHOLESALE_MIN_ORDER = 500000;
  const isWholesaleBelowMin = isWholesale && subtotal < WHOLESALE_MIN_ORDER;

  useEffect(() => {
    if (deliveryService === "cdek" && deliveryType === "door" && selectedCity && cdekDoorStreet && cdekDoorHouse) {
      const parts = [cdekDoorStreet, `д. ${cdekDoorHouse}`];
      if (cdekDoorApartment) parts.push(`кв. ${cdekDoorApartment}`);
      if (cdekDoorEntrance) parts.push(`подъезд ${cdekDoorEntrance}`);
      if (cdekDoorFloor) parts.push(`этаж ${cdekDoorFloor}`);
      setValue("address", `СДЭК Курьер: ${selectedCity.city}, ${parts.join(', ')}`);
    } else if (deliveryService === "cdek" && deliveryType === "pickup" && selectedPoint && selectedCity) {
      setValue("address", `СДЭК ПВЗ: ${selectedCity.city}, ${selectedPoint.location.address_full || selectedPoint.location.address}`);
    }
  }, [deliveryService, deliveryType, selectedPoint, selectedCity, cdekDoorStreet, cdekDoorHouse, cdekDoorApartment, cdekDoorEntrance, cdekDoorFloor, setValue]);

  const onSubmit = (data: CheckoutForm) => {
    const customerName = [data.customerLastName, data.customerFirstName, data.customerPatronymic].filter(Boolean).join(' ');
    // Partner attribution: pass ref explicitly in body as a robust fallback to the cookie,
    // which can be dropped by Safari ITP / 3rd-party cookie blockers in widget flows.
    const partnerRef = getStoredRef();
    const orderData: any = {
      ...data,
      customerName,
      ...(partnerRef ? { ref: partnerRef } : {}),
      promoCode: appliedPromo?.code,
      giftCardCode: appliedGiftCard?.code,
      giftCardAmount: giftCardDiscount,
      deliveryCost: deliveryCost,
      paymentMethod: selectedPaymentMethod,
      isWholesale: isWholesale,
      transportCompany: isWholesale ? selectedTransport : undefined,
      deliveryService: deliveryService,
      cdekPointCode: deliveryService === "cdek" && deliveryType === "pickup" ? (selectedPoint?.code || undefined) : undefined,
      cdekCityCode: deliveryService === "cdek" ? (selectedCity?.code || undefined) : undefined,
      cdekTariffCode: deliveryService === "cdek" 
        ? (deliveryType === "door" 
          ? (cheapestDoorTariff?.tariff_code || undefined) 
          : (widgetDelivery?.tariff_code || cheapestTariff?.tariff_code || undefined)) 
        : undefined,
      cdekDeliveryType: deliveryService === "cdek" ? deliveryType : undefined,
      cdekDoorAddress: deliveryService === "cdek" && deliveryType === "door" ? {
        street: cdekDoorStreet,
        house: cdekDoorHouse,
        flat: cdekDoorApartment || undefined,
        entrance: cdekDoorEntrance || undefined,
        floor: cdekDoorFloor || undefined,
      } : undefined,
    };

    if (isWholesale) {
      apiRequest("POST", "/api/auth/shipping-data", {
        customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        address: data.address,
        transportCompany: selectedTransport,
      }).catch(() => {});
    }

    createOrder.mutate(orderData, {
      onSuccess: (orderData: any) => {
        if (orderData.confirmationToken) {
          setWidgetToken(orderData.confirmationToken);
          setWidgetOrderId(orderData.id);
        } else if (orderData.paymentUrl) {
          window.location.href = orderData.paymentUrl;
        } else {
          setSuccess(true);
        }
      },
      onError: (error: any) => {
        const raw = error.message || "";
        if (error.code === "STOCK_INSUFFICIENT" && error.stockIssues?.length) {
          const lines = error.stockIssues.map((si: any) => {
            const sizePart = si.size ? ` (${si.size})` : "";
            return `• ${si.productName}${sizePart}: в наличии ${si.available} шт.`;
          });
          toast({
            variant: "destructive",
            title: "Недостаточно товара на складе",
            description: lines.join("\n"),
            duration: 10000,
          });
          return;
        }
        const friendly = raw.includes("Unauthorized") || raw.includes("авторизуйтесь")
          ? "Необходимо войти в аккаунт"
          : raw.includes("Ozon Pay") || raw.includes("ozon")
          ? raw
          : raw.includes("payment") || raw.includes("оплат")
          ? "Не удалось инициировать оплату. Попробуйте другой способ или повторите позже."
          : raw || "Не удалось оформить заказ. Попробуйте ещё раз.";
        toast({
          variant: "destructive",
          title: "Не удалось оформить заказ",
          description: friendly,
        });
      }
    });
  };

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
    }).format(cents / 100);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <CheckCircle2 className="w-20 h-20 text-green-500 mb-6" />
        <h1 className="text-3xl md:text-4xl font-semibold mb-4 text-center text-foreground">
          {cs.successTitle}
        </h1>
        <p className="text-muted-foreground mb-8 text-center max-w-md">
          {cs.successDescription}
        </p>
        <Button 
          size="lg"
          onClick={() => window.location.href = "/"}
        >
          {cs.successButtonText}
        </Button>
      </div>
    );
  }

  if (!cartItems || cartItems.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <BrandLoader size="lg" />
        <p className="text-muted-foreground mt-4">{cs.emptyCartText}</p>
        <Button 
          variant="ghost"
          onClick={() => setLocation("/cart")}
          className="mt-4"
        >
          {cs.emptyCartButtonText}
        </Button>
      </div>
    );
  }

  const widgetReturnUrl = widgetOrderId ? `${window.location.origin}/order-success/${widgetOrderId}` : window.location.origin;

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Оформление заказа" noindex={true} />
      <Navbar />

      {stockValidation && !stockValidation.valid && stockValidation.issues.length > 0 && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-3">
          <div className="max-w-4xl mx-auto flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-700 mb-1">
                В корзине есть позиции с недостаточным остатком:
              </p>
              <ul className="space-y-0.5">
                {stockValidation.issues.map((issue, i) => (
                  <li key={i} className="text-sm text-red-600">
                    • {issue.productName}{issue.size ? ` (${issue.size})` : ""} —{" "}
                    {issue.available === 0 ? "нет в наличии" : `доступно ${issue.available} шт., в корзине ${issue.requested} шт.`}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-red-500 mt-1.5">
                Удалите или уменьшите количество этих позиций, чтобы оформить заказ.
              </p>
            </div>
          </div>
        </div>
      )}

      {widgetToken && (
        <YooKassaWidget
          confirmationToken={widgetToken}
          returnUrl={widgetReturnUrl}
          onSuccess={() => {
            setWidgetToken(null);
            if (widgetOrderId) {
              setLocation(`/order-success/${widgetOrderId}`);
            } else {
              setSuccess(true);
            }
          }}
          onFail={() => {
            setWidgetToken(null);
            toast({
              variant: "destructive",
              title: "Оплата не прошла",
              description: "Попробуйте ещё раз или выберите другой способ оплаты",
            });
          }}
          onClose={() => {
            setWidgetToken(null);
          }}
        />
      )}

      <div className="pt-32 pb-24 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          
          {/* Left: Form */}
          <div className="lg:col-span-3">
            <h1 className="text-2xl md:text-3xl font-semibold mb-6 text-foreground">{cs.pageTitle}</h1>
            
            {/* Wholesale Transport Company Selection */}
            {isWholesale && (
              <Card className="p-6 mb-6 border-2 border-primary/20 bg-primary/5">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-foreground">
                  <Building2 className="w-5 h-5 text-primary" />
                  {cs.wholesaleTransportTitle}
                  <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full ml-2">{cs.wholesaleBadgeText}</span>
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {cs.wholesaleTransportDescription}
                </p>

                <RadioGroup
                  value={selectedTransport}
                  onValueChange={setSelectedTransport}
                  className="grid grid-cols-2 sm:grid-cols-3 gap-2.5"
                >
                  {TRANSPORT_COMPANIES.map((tc) => {
                    const isSelected = selectedTransport === tc.id;
                    return (
                      <div
                        key={tc.id}
                        onClick={() => setSelectedTransport(tc.id)}
                        className={`relative cursor-pointer rounded-xl border-2 p-3.5 transition-all select-none ${
                          isSelected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border bg-card hover:border-primary/40 hover:bg-muted/40"
                        }`}
                        data-testid={`card-tc-${tc.id}`}
                      >
                        <RadioGroupItem value={tc.id} id={`tc-${tc.id}`} className="sr-only" data-testid={`radio-tc-${tc.id}`} />
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <div
                              className="h-7 px-2 rounded-md flex items-center justify-center text-white font-bold text-[11px] tracking-wide"
                              style={{ backgroundColor: tc.color }}
                            >
                              {tc.abbr}
                            </div>
                            {isSelected && (
                              <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                                <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 10 10">
                                  <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-sm leading-tight">{tc.name}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{tc.desc}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </RadioGroup>
              </Card>
            )}

            <Card className="p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-foreground">
                <Truck className="w-5 h-5" />
                {isWholesale ? cs.deliverySectionTitleWholesale : cs.deliverySectionTitle}
              </h2>

              {!isWholesale && isFreeShipping && (
                <div className="mb-4 px-4 py-3 bg-foreground text-background rounded-xl flex items-center justify-between">
                  <p className="text-sm font-semibold tracking-wide uppercase">Бесплатная доставка</p>
                  <p className="text-xs opacity-60">от 5 000 ₽</p>
                </div>
              )}
              {!isWholesale && !isFreeShipping && subtotal > 0 && (
                <div className="mb-4 p-4 border border-border rounded-xl">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">До бесплатной доставки</p>
                    <p className="text-xs font-semibold text-foreground">{formatPrice(FREE_SHIPPING_THRESHOLD - subtotal)}</p>
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-foreground rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {!isWholesale && (
              <RadioGroup 
                value={deliveryService} 
                onValueChange={(v) => {
                  const svc = v as DeliveryService;
                  setDeliveryService(svc);
                  if (svc === "ozon") {
                    setSelectedPoint(null);
                    setWidgetDelivery(null);
                  }
                }}
                className="space-y-3"
              >
                {ozonPayEnabled && (
                <div
                  className={`flex items-center space-x-3 p-3 border rounded-lg hover-elevate cursor-pointer ${deliveryService === "ozon" ? "border-primary bg-primary/5" : ""}`}
                  onClick={() => { setDeliveryService("ozon"); setSelectedPoint(null); setWidgetDelivery(null); }}
                >
                  <RadioGroupItem value="ozon" id="delivery-ozon" data-testid="radio-ozon" />
                  <Label htmlFor="delivery-ozon" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-3 flex-wrap">
                      <img src="/images/ozon-pay-logo.svg" alt="Ozon Pay" className="h-6 w-auto" loading="eager" />
                      <span className="text-sm font-medium tracking-tight text-foreground/80">
                        Оплата <span className="text-[#005BFF] font-semibold">+</span> доставка до ПВЗ
                      </span>
                    </div>
                  </Label>
                </div>
                )}
                <div className={`flex items-center space-x-3 p-3 border rounded-lg hover-elevate cursor-pointer ${deliveryService === "cdek" ? "border-primary bg-primary/5" : ""}`} onClick={() => { setDeliveryService("cdek"); }}>
                  <RadioGroupItem value="cdek" id="delivery-cdek" data-testid="radio-cdek" />
                  <Label htmlFor="delivery-cdek" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <img src="/images/cdek-logo.webp" alt="СДЭК" className="h-5 w-auto" loading="eager" />
                    </div>
                  </Label>
                </div>
              </RadioGroup>
              )}

              {/* Ozon Pay: info block */}
              {!isWholesale && deliveryService === "ozon" && (
                <div className="mt-4 p-4 rounded-lg bg-[#EBF1FF] dark:bg-[#005BFF]/10 border border-[#005BFF]/30 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0 w-8 h-8 rounded-full bg-[#005BFF] flex items-center justify-center">
                      <span className="text-white text-xs font-black">O</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Оплата и доставка через Ozon Pay</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        После нажатия кнопки «{cs.submitButtonText}» вы будете перенаправлены на страницу Ozon Pay, где сможете выбрать удобный пункт выдачи и оплатить заказ картой, через СБП или Ozon Картой.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
                    <div className="p-2 rounded bg-white dark:bg-background/40 border border-[#005BFF]/20">
                      <div className="font-medium text-foreground mb-0.5">1. Оформите</div>
                      <div>заполните данные и нажмите кнопку</div>
                    </div>
                    <div className="p-2 rounded bg-white dark:bg-background/40 border border-[#005BFF]/20">
                      <div className="font-medium text-foreground mb-0.5">2. Выберите ПВЗ</div>
                      <div>на странице Ozon Pay</div>
                    </div>
                    <div className="p-2 rounded bg-white dark:bg-background/40 border border-[#005BFF]/20">
                      <div className="font-medium text-foreground mb-0.5">3. Оплатите</div>
                      <div>картой, СБП или Ozon Картой</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Wholesale: Simple address form */}
              {isWholesale && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {cs.addressWholesaleDescription}
                  </p>
                  <Textarea
                    {...register("address")}
                    placeholder={cs.addressPlaceholder}
                    className="min-h-[100px]"
                    data-testid="input-wholesale-address"
                  />
                  {errors.address && (
                    <p className="text-sm text-destructive">{errors.address.message}</p>
                  )}
                </div>
              )}

              {/* CDEK: City Search */}
              {!isWholesale && deliveryService === "cdek" && (
              <div className="mt-6 space-y-2 relative">
                <Label>{cs.citySearchLabel}</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={selectedCity ? selectedCity.city : citySearch}
                    onChange={(e) => {
                      setCitySearch(e.target.value);
                      // Reset city selection when user edits - widget will auto-cleanup via useEffect
                      if (selectedCity && e.target.value !== selectedCity.city) {
                        setSelectedCity(null);
                        setSelectedPoint(null);
                        setWidgetDelivery(null);
                        setDeliveryType("pickup");
                        setCdekDoorStreet(""); setCdekDoorHouse(""); setCdekDoorApartment(""); setCdekDoorEntrance(""); setCdekDoorFloor("");
                      }
                      setShowCityDropdown(true);
                    }}
                    onFocus={() => setShowCityDropdown(true)}
                    placeholder={cs.citySearchPlaceholder}
                    className="pl-10"
                    data-testid="input-city-search"
                  />
                  {citiesLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" />}
                </div>
                
                {/* City dropdown */}
                {showCityDropdown && cities && cities.length > 0 && !selectedCity && (
                  <div className="absolute z-50 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {cities.map((city) => (
                      <button
                        key={city.code}
                        type="button"
                        className="w-full px-4 py-3 text-left hover:bg-accent/50 flex items-center gap-2"
                        onClick={() => {
                          setSelectedCity(city);
                          setCitySearch(city.city);
                          setShowCityDropdown(false);
                        }}
                        data-testid={`city-option-${city.code}`}
                      >
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-foreground">{city.city}</p>
                          {city.region && <p className="text-xs text-muted-foreground">{city.region}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* CDEK: Delivery type tabs */}
              {!isWholesale && deliveryService === "cdek" && selectedCity && (
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    className={`flex-1 py-2.5 px-4 text-sm font-medium rounded-lg border transition-colors ${deliveryType === "pickup" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent/50"}`}
                    onClick={() => { setDeliveryType("pickup"); setCdekDoorStreet(""); setCdekDoorHouse(""); setCdekDoorApartment(""); setCdekDoorEntrance(""); setCdekDoorFloor(""); }}
                    data-testid="button-cdek-pvz"
                  >
                    В пункт выдачи
                  </button>
                  <button
                    type="button"
                    className={`flex-1 py-2.5 px-4 text-sm font-medium rounded-lg border transition-colors ${deliveryType === "door" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent/50"}`}
                    onClick={() => { setDeliveryType("door"); setSelectedPoint(null); setWidgetDelivery(null); }}
                    data-testid="button-cdek-door"
                  >
                    До двери {cheapestDoorTariff ? `от ${Math.ceil(cheapestDoorTariff.delivery_sum)} ₽` : ''}
                  </button>
                </div>
              )}

              {/* CDEK: Door delivery address form */}
              {!isWholesale && deliveryService === "cdek" && deliveryType === "door" && selectedCity && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <Label className="text-sm mb-1.5 block">Улица *</Label>
                      <Input
                        value={cdekDoorStreet}
                        onChange={(e) => setCdekDoorStreet(e.target.value)}
                        placeholder="Название улицы"
                        data-testid="input-cdek-door-street"
                      />
                    </div>
                    <div>
                      <Label className="text-sm mb-1.5 block">Дом *</Label>
                      <Input
                        value={cdekDoorHouse}
                        onChange={(e) => setCdekDoorHouse(e.target.value)}
                        placeholder="Номер дома"
                        data-testid="input-cdek-door-house"
                      />
                    </div>
                    <div>
                      <Label className="text-sm mb-1.5 block">Квартира / офис</Label>
                      <Input
                        value={cdekDoorApartment}
                        onChange={(e) => setCdekDoorApartment(e.target.value)}
                        placeholder="Кв. / офис"
                        data-testid="input-cdek-door-apartment"
                      />
                    </div>
                    <div>
                      <Label className="text-sm mb-1.5 block">Подъезд</Label>
                      <Input
                        value={cdekDoorEntrance}
                        onChange={(e) => setCdekDoorEntrance(e.target.value)}
                        placeholder="Подъезд"
                        data-testid="input-cdek-door-entrance"
                      />
                    </div>
                    <div>
                      <Label className="text-sm mb-1.5 block">Этаж</Label>
                      <Input
                        value={cdekDoorFloor}
                        onChange={(e) => setCdekDoorFloor(e.target.value)}
                        placeholder="Этаж"
                        data-testid="input-cdek-door-floor"
                      />
                    </div>
                  </div>

                  {cheapestDoorTariff && (
                    <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-sm font-medium text-foreground">Курьерская доставка</p>
                          <p className="text-xs text-muted-foreground">{cheapestDoorTariff.period_min}-{cheapestDoorTariff.period_max} дней</p>
                        </div>
                        <p className="text-lg font-semibold text-foreground">{formatPrice(cheapestDoorTariff.delivery_sum * 100)}</p>
                      </div>
                    </div>
                  )}

                  {!cheapestDoorTariff && !calcLoading && (
                    <p className="text-sm text-muted-foreground">Курьерская доставка недоступна для этого города</p>
                  )}
                </div>
              )}

              {/* CDEK: Delivery Points List */}
              {!isWholesale && deliveryService === "cdek" && deliveryType === "pickup" && selectedCity && (
                <div className="mt-6 space-y-4">
                  <Label>{cs.pvzLabel}</Label>
                  
                  {/* Widget error state */}
                  {widgetError && !widgetLoading && !iframeUrl && (
                    <div className="w-full h-[500px] border rounded-lg flex flex-col items-center justify-center bg-destructive/5 border-destructive/20">
                      <MapPin className="w-8 h-8 text-destructive mb-3" />
                      <p className="text-destructive font-medium mb-2">Ошибка загрузки карты</p>
                      <p className="text-sm text-muted-foreground text-center max-w-md px-4">{widgetError}</p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="mt-4"
                        onClick={() => window.location.reload()}
                      >
                        Обновить страницу
                      </Button>
                    </div>
                  )}
                  
                  {/* Widget iframe - keep visible so Yandex Maps can render in proper dimensions */}
                  {iframeUrl && (
                    <div className="relative w-full h-[500px]">
                      <iframe
                        key={iframeUrl}
                        src={iframeUrl}
                        className="absolute inset-0 w-full h-full border rounded-lg"
                        style={{ border: 'none' }}
                        title="CDEK Widget"
                        data-testid="cdek-widget-iframe"
                      />
                      {widgetLoading && (
                        <div className="absolute inset-0 border rounded-lg flex flex-col items-center justify-center bg-accent/10 z-10">
                          <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                          <p className="text-muted-foreground">Загрузка карты ПВЗ...</p>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedPoint && (
                    <div className="p-4 bg-primary/5 border border-primary rounded-lg flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-primary mt-0.5" />
                      <div>
                        <p className="font-semibold text-foreground">{cs.selectedPointLabel}</p>
                        <p className="text-sm font-medium">{selectedPoint.name}</p>
                        <p className="text-sm text-muted-foreground">{selectedPoint.location.address}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}


              {/* CDEK: Delivery cost info (PVZ mode only — door mode shows cost inside its own section) */}
              {!isWholesale && deliveryService === "cdek" && deliveryType === "pickup" && selectedCity && (widgetDelivery || cheapestTariff) && (
                <div className="mt-4 p-3 bg-accent/30 rounded-lg">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium text-foreground">{cs.deliveryCostLabel}</p>
                      <p className="text-xs text-muted-foreground">
                        {widgetDelivery?.period_min && widgetDelivery?.period_max 
                          ? `${widgetDelivery.period_min}-${widgetDelivery.period_max} дней`
                          : cheapestTariff 
                            ? `${cheapestTariff.period_min}-${cheapestTariff.period_max} дней`
                            : ''}
                      </p>
                    </div>
                    {isFreeShipping ? (
                      <div className="text-right">
                        <p className="text-sm line-through text-muted-foreground">{formatPrice(cdekDeliveryCost)}</p>
                        <p className="text-lg font-semibold text-green-600">Бесплатно</p>
                      </div>
                    ) : (
                      <p className="text-lg font-semibold text-foreground">{formatPrice(deliveryCost)}</p>
                    )}
                  </div>
                </div>
              )}
              {!isWholesale && deliveryService === "cdek" && calcLoading && selectedCity && (
                <div className="mt-4 flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Расчёт стоимости доставки...
                </div>
              )}
            </Card>

            {deliveryService !== "ozon" && (
            <Card className="p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4 text-foreground">{cs.paymentSectionTitle}</h2>
              <RadioGroup 
                value={selectedPaymentMethod} 
                onValueChange={setSelectedPaymentMethod}
                className="space-y-3"
              >
                {/* Invoice payment option for wholesale */}
                {isWholesale && (
                  <div 
                    className={`flex items-center space-x-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      selectedPaymentMethod === "invoice" 
                        ? "border-primary bg-primary/10" 
                        : "border-border hover:border-primary/50"
                    }`}
                    onClick={() => setSelectedPaymentMethod("invoice")}
                  >
                    <RadioGroupItem value="invoice" id="pay-invoice" data-testid="radio-pay-invoice" />
                    <Label htmlFor="pay-invoice" className="flex-1 cursor-pointer flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="font-medium">Оплата по счёту</span>
                        <p className="text-xs text-muted-foreground">Счёт будет отправлен на вашу почту</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center text-primary-foreground font-bold text-sm">₽</div>
                        <span className="text-[10px] font-bold uppercase tracking-tighter">Счёт</span>
                      </div>
                    </Label>
                  </div>
                )}

                {!isWholesale && paymentMethods.map((method: any) => (
                  <div 
                    key={method.id} 
                    className={`flex items-center space-x-4 p-3 border rounded-lg hover-elevate cursor-pointer ${selectedPaymentMethod === method.id ? "border-primary bg-primary/5" : ""}`}
                    onClick={() => setSelectedPaymentMethod(method.id)}
                  >
                    <RadioGroupItem value={method.id} id={`pay-${method.id}`} />
                    <Label htmlFor={`pay-${method.id}`} className="flex-1 cursor-pointer flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="font-medium">{method.name}</span>
                        <p className="text-xs text-muted-foreground">{method.description}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {method.id === "tbank" ? (
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <Landmark className="w-6 h-6 text-[#FFDD2D]" />
                              <span className="text-[10px] font-bold uppercase tracking-tighter">T-Bank</span>
                            </div>
                            <div className="w-px h-5 bg-border" />
                            <div className="flex items-center gap-1 opacity-70">
                              <DolyameLogo size={13} white={false} />
                              <span className="text-[9px] font-extrabold tracking-widest uppercase text-foreground">Долями</span>
                            </div>
                          </div>
                        ) : (
                          <img src={yookassaLogo} alt="ЮKassa" className="h-6 object-contain" />
                        )}
                      </div>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </Card>
            )}

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4 text-foreground">{cs.contactsSectionTitle}</h2>
              
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="customerLastName">Фамилия</Label>
                    <Input
                      id="customerLastName"
                      {...register("customerLastName")}
                      data-testid="input-customer-lastName"
                      placeholder="Иванов"
                    />
                    {errors.customerLastName && <p className="text-destructive text-sm" data-testid="error-customer-lastName">{errors.customerLastName.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="customerFirstName">Имя</Label>
                    <Input
                      id="customerFirstName"
                      {...register("customerFirstName")}
                      data-testid="input-customer-firstName"
                      placeholder="Иван"
                    />
                    {errors.customerFirstName && <p className="text-destructive text-sm" data-testid="error-customer-firstName">{errors.customerFirstName.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="customerPatronymic">Отчество</Label>
                    <Input
                      id="customerPatronymic"
                      {...register("customerPatronymic")}
                      data-testid="input-customer-patronymic"
                      placeholder="Иванович"
                    />
                    {errors.customerPatronymic && <p className="text-destructive text-sm" data-testid="error-customer-patronymic">{errors.customerPatronymic.message}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="customerEmail">{cs.emailLabel}</Label>
                    <Input
                      id="customerEmail"
                      type="email"
                      {...register("customerEmail")}
                      data-testid="input-customer-email"
                      placeholder={cs.emailPlaceholder}
                    />
                    {errors.customerEmail && <p className="text-destructive text-sm" data-testid="error-customer-email">{errors.customerEmail.message}</p>}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="customerPhone">{cs.phoneLabel}</Label>
                    <Input
                      id="customerPhone"
                      {...register("customerPhone")}
                      data-testid="input-customer-phone"
                      placeholder={cs.phonePlaceholder}
                    />
                    {errors.customerPhone && <p className="text-destructive text-sm" data-testid="error-customer-phone">{errors.customerPhone.message}</p>}
                  </div>
                </div>

                {deliveryService === "ozon" && (
                  <input type="hidden" {...register("address")} />
                )}

                {selectedPoint && (
                  <div className="p-3 bg-accent/30 rounded-lg">
                    <p className="text-sm font-medium text-foreground">{cs.selectedPointLabel}</p>
                    <p className="text-sm text-muted-foreground">{selectedPoint.name}</p>
                    <p className="text-xs text-muted-foreground">{selectedPoint.location.address}</p>
                    <input type="hidden" {...register("address")} />
                  </div>
                )}

                {/* Agreement Section */}
                <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
                  <div className="flex items-start gap-3">
                    <Checkbox 
                      id="agree-offer" 
                      checked={agreeOffer}
                      onCheckedChange={(checked) => setAgreeOffer(checked as boolean)}
                      data-testid="checkbox-agree-offer"
                    />
                    <label htmlFor="agree-offer" className="text-sm cursor-pointer leading-tight">
                      {cs.offerAgreementText}{" "}
                      <a 
                        href={cs.offerLinkUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary underline hover:no-underline"
                      >
                        {cs.offerLinkText}
                      </a>
                    </label>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <Checkbox 
                      id="agree-policy" 
                      checked={agreePolicy}
                      onCheckedChange={(checked) => setAgreePolicy(checked as boolean)}
                      data-testid="checkbox-agree-policy"
                    />
                    <label htmlFor="agree-policy" className="text-sm cursor-pointer leading-tight">
                      {cs.policyAgreementText}{" "}
                      <a 
                        href={cs.policyLinkUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary underline hover:no-underline"
                      >
                        {cs.policyLinkText}
                      </a>
                    </label>
                  </div>
                  
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                    {cs.consentText}{" "}
                    <a 
                      href={cs.policyLinkUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary underline hover:no-underline"
                    >
                      {cs.policyLinkText}
                    </a>.
                  </p>
                </div>

                {/* Delivery Info Button */}
                <Dialog open={showDeliveryInfo} onOpenChange={setShowDeliveryInfo}>
                  <DialogTrigger asChild>
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="w-full"
                      data-testid="button-delivery-info"
                    >
                      <Info className="w-4 h-4 mr-2" />
                      {cs.deliveryInfoButtonText}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md" aria-describedby="delivery-info-description">
                    <DialogHeader>
                      <DialogTitle>{cs.deliveryInfoTitle}</DialogTitle>
                    </DialogHeader>
                    <div id="delivery-info-description" className="space-y-4 text-sm">
                      {isWholesale ? (
                        <p className="flex items-start gap-2">
                          <Truck className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                          <span>{cs.wholesaleDeliveryInfoText}</span>
                        </p>
                      ) : (
                        <>
                          {(() => {
                            const icons = [Truck, Clock, Package, ShieldCheck, Gift];
                            return cs.retailDeliveryInfoItems
                              .filter(item => item.visible)
                              .map((item, idx) => {
                                const IconComponent = icons[idx % icons.length];
                                return (
                                  <p key={idx} className="flex items-start gap-2">
                                    <IconComponent className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                                    <span>{item.text}</span>
                                  </p>
                                );
                              });
                          })()}
                          <p className="flex items-start gap-2">
                            <MapPin className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                            <span>Статус доставки доступен в вашем личном кабинете. Нажмите на заказ, чтобы увидеть, где находится посылка, и обновить информацию.</span>
                          </p>
                        </>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>

                <Button 
                  type="submit"
                  size="lg"
                  className="w-full"
                  data-testid="button-submit-order"
                  disabled={createOrder.isPending || !agreeOffer || !agreePolicy || (!isWholesale && deliveryService === "cdek" && deliveryType === "pickup" && !selectedPoint) || (!isWholesale && deliveryService === "cdek" && deliveryType === "door" && (!cdekDoorStreet || !cdekDoorHouse || !cheapestDoorTariff)) || (!isWholesale && deliveryService === "cdek" && !selectedCity) || isWholesaleBelowMin}
                >
                  {createOrder.isPending ? <Loader2 className="animate-spin mr-2" /> : null}
                  {cs.submitButtonText} · {formatPrice(total)}
                </Button>

                {isWholesaleBelowMin && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800" data-testid="warning-wholesale-min-order">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <p className="text-sm text-amber-700 dark:text-amber-300" data-testid="text-wholesale-min-order">
                      {cs.wholesaleMinOrderText} — {formatPrice(WHOLESALE_MIN_ORDER)}. Сейчас: {formatPrice(subtotal)}.
                    </p>
                  </div>
                )}

                {!isWholesale && deliveryService === "cdek" && deliveryType === "pickup" && !selectedPoint && selectedCity && (
                  <p className="text-sm text-center text-muted-foreground">{cs.selectPointHint}</p>
                )}
                {!isWholesale && deliveryService === "cdek" && deliveryType === "door" && selectedCity && (!cdekDoorStreet || !cdekDoorHouse) && (
                  <p className="text-sm text-center text-muted-foreground">Введите улицу и дом для курьерской доставки</p>
                )}
                {!isWholesale && deliveryService === "cdek" && !selectedCity && (
                  <p className="text-sm text-center text-muted-foreground">{cs.selectCityHint}</p>
                )}
              </form>
            </Card>
          </div>

          {/* Right: Order Summary */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6 sticky top-24">
              <h3 className="text-xl font-semibold mb-6 text-foreground">{cs.orderSummaryTitle}</h3>
              
              <div className="space-y-4 mb-6 max-h-80 overflow-y-auto">
                {cartItems?.map((item) => (
                  <div key={item.id} className="flex gap-3" data-testid={`checkout-item-${item.id}`}>
                    <div className="w-14 h-18 bg-muted flex-shrink-0 rounded-md overflow-hidden">
                      <img src={item.product.imageUrl} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-1">
                        <p className="text-sm font-medium text-foreground line-clamp-2">{item.product.name}</p>
                        <button
                          onClick={() => removeFromCart.mutate({
                            id: item.id,
                            sessionId: item.sessionId || '',
                            productId: item.productId,
                            size: item.size,
                            color: item.color,
                          })}
                          data-testid={`button-checkout-remove-${item.id}`}
                          className="text-muted-foreground hover:text-destructive transition-colors p-0.5 flex-shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.size}{item.color && item.color !== "Default" ? ` / ${item.color}` : ""}
                      </p>
                      {appliedPromo?.applicableCategories && appliedPromo.applicableCategories.length > 0 && (() => {
                        const cats = appliedPromo.applicableCategories!.map(c => c.toLowerCase());
                        const matches = cats.includes(item.product.category?.toLowerCase() ?? '') ||
                                        cats.includes(item.product.subcategory?.toLowerCase() ?? '');
                        return matches ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded px-1.5 py-0.5 mt-1">
                            <Tag className="w-2.5 h-2.5" />
                            Скидка по промокоду
                          </span>
                        ) : null;
                      })()}
                      <div className="flex items-center justify-between mt-1.5">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            data-testid={`button-checkout-decrease-${item.id}`}
                            disabled={item.quantity <= 1 || updateQuantity.isPending}
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
                          <span className="text-xs font-medium w-6 text-center tabular-nums" data-testid={`text-checkout-quantity-${item.id}`}>{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            data-testid={`button-checkout-increase-${item.id}`}
                            disabled={updateQuantity.isPending}
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
                        <p className="text-sm font-medium text-foreground">{formatPrice(getItemPrice(item.product, item.size) * item.quantity)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Promo Code Input */}
              <div className="border-t pt-4 mb-4">
                <Label className="text-sm font-medium mb-2 block">{cs.promoCodeLabel}</Label>
                <div className="flex gap-2">
                  <Input 
                    placeholder={cs.promoCodePlaceholder} 
                    value={promoCodeInput}
                    onChange={(e) => setPromoCodeInput(e.target.value)}
                    className="flex-1"
                    data-testid="input-promo-code"
                  />
                  <Button 
                    type="button"
                    variant="outline" 
                    onClick={handleApplyPromo}
                    disabled={validatePromo.isPending || !promoCodeInput}
                    data-testid="button-apply-promo"
                  >
                    {validatePromo.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : cs.promoCodeApplyText}
                  </Button>
                </div>
                {appliedPromo && (
                  <div className="mt-2 flex items-center justify-between text-sm text-green-600 font-medium bg-green-50 dark:bg-green-900/20 p-2 rounded">
                    <div className="flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      <span>Код {appliedPromo.code} применен</span>
                    </div>
                    <button 
                      className="text-muted-foreground hover:text-foreground underline text-xs"
                      onClick={() => {
                        setAppliedPromo(null);
                        setPromoCodeInput("");
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                )}
              </div>

              {!isWholesale && (
                <div className="border-t pt-4 mb-4">
                  <Label className="text-sm font-medium mb-2 block">{cs.giftCardLabel}</Label>
                  <div className="flex gap-2">
                    <Input 
                      placeholder={cs.giftCardPlaceholder} 
                      value={giftCardInput}
                      onChange={(e) => setGiftCardInput(e.target.value.toUpperCase())}
                      className="flex-1 font-mono"
                      data-testid="input-gift-card"
                    />
                    <Button 
                      variant="outline" 
                      onClick={handleApplyGiftCard}
                      disabled={validateGiftCard.isPending || !giftCardInput}
                      data-testid="button-apply-gift-card"
                    >
                      {validateGiftCard.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : cs.giftCardApplyText}
                    </Button>
                  </div>
                  {appliedGiftCard && (
                    <div className="mt-2 flex items-center justify-between text-sm text-green-600 font-medium bg-green-50 dark:bg-green-900/20 p-2 rounded">
                      <div className="flex items-center gap-1">
                        <Gift className="w-3 h-3" />
                        <span>Сертификат {appliedGiftCard.code.slice(0, 9)}... применён</span>
                      </div>
                      <button 
                        className="text-muted-foreground hover:text-foreground underline text-xs"
                        onClick={() => {
                          setAppliedGiftCard(null);
                          setGiftCardInput("");
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t pt-4 text-sm space-y-2">
                <div className="flex justify-between text-muted-foreground">
                  <span>{cs.summarySubtotalLabel}</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                {appliedPromo && promoDiscount > 0 && (
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>{cs.summaryPromoLabel}</span>
                    <span>-{formatPrice(promoDiscount)}</span>
                  </div>
                )}
                {loyaltyDiscountAmount > 0 && (
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>{cs.summaryLoyaltyLabel} ({userLoyaltyDiscount}%)</span>
                    <span>-{formatPrice(loyaltyDiscountAmount)}</span>
                  </div>
                )}
                {giftCardDiscount > 0 && (
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>{cs.summaryGiftCardLabel}</span>
                    <span>-{formatPrice(giftCardDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>
                    {isWholesale 
                      ? `${cs.summaryDeliveryLabelWholesale} ${TRANSPORT_COMPANIES.find(tc => tc.id === selectedTransport)?.name || 'ТК'}` 
                      : cs.summaryDeliveryLabel
                    }
                  </span>
                  <span className={isFreeShipping ? "text-green-600 font-medium" : ""}>
                    {isWholesale 
                      ? cs.summaryDeliveryWholesaleValue 
                      : isFreeShipping
                        ? "Бесплатно"
                        : (deliveryCost > 0 ? formatPrice(deliveryCost) : "—")
                    }
                  </span>
                </div>
                <div className="flex justify-between text-foreground font-semibold text-base pt-2">
                  <span>{cs.summaryTotalLabel}</span>
                  <span>{formatPrice(total)}</span>
                </div>
                {!isWholesale && total >= 300000 && total <= 3000000 && (
                  <div className="pt-1">
                    <DolyameWidget
                      price={total}
                      isDark={false}
                      isMinta={false}
                      productId={0}
                    />
                  </div>
                )}
              </div>
            </Card>
          </div>

        </div>
      </div>
      
      <Footer />
    </div>
  );
}
