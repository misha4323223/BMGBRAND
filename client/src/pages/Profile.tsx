import { useAuth, useLogout } from "@/hooks/use-auth";
import { transportCompanyName } from "@shared/transport-companies";
import { useLocation } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import SEO from "@/components/SEO";
import YooKassaWidget from "@/components/YooKassaWidget";
import AddonOrderDialog from "@/components/AddonOrderDialog";
import { BrandLoader } from "@/components/BrandLoader";
import { Loader2, User, Mail, Package, LogOut, CheckCircle, AlertCircle, ShoppingBag, Gift, TrendingUp, Star, ChevronRight, ChevronDown, ChevronUp, Trash2, MapPin, Phone, Truck, Hash, Palette, Ruler, Tag, CreditCard, Copy, Check, Calendar, X, RefreshCw, Minus, Plus, ExternalLink, Ban, Settings, Lock, Home, Landmark, Bell } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useAddToCart } from "@/hooks/use-cart";
import { useToast } from "@/hooks/use-toast";
import { makeVariant } from "@/lib/ecommerce";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

interface OrderItem {
  productId: number;
  productName?: string;
  name?: string;
  sku?: string;
  quantity: number;
  price: number;
  size?: string;
  color?: string;
  imageUrl?: string;
}

interface CdekData {
  orderUuid?: string;
  cdekNumber?: string;
  status?: string;
  tariffCode?: number;
  pointCode?: string;
  lastCdekStatus?: string;
  lastCdekStatusName?: string;
  lastCdekStatusDate?: string;
  cdekStatuses?: Array<{
    code: string;
    name: string;
    date: string;
    city?: string;
  }>;
  deliveryService?: string;
  ydStatus?: string;
  ydStatuses?: Array<{
    code: string;
    name: string;
    date: string;
  }>;
  ydStatusName?: string;
  ydStatusDate?: string;
}

interface Order {
  id: number;
  status: string;
  total: number;
  createdAt: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  address?: string;
  transportCompany?: string;
  isWholesale?: boolean;
  paymentId?: string;
  cdekData?: string;
  items: OrderItem[];
}

interface UserGiftCard {
  id: number;
  code: string;
  amount: number;
  balance: number;
  status: string;
  purchaserEmail: string;
  recipientEmail?: string;
  expiresAt?: string;
  createdAt?: string;
}

interface UserPromoCode {
  code: string;
  discountPercent?: number;
  discountAmount?: number;
  source: string;
  isActive: boolean;
  expiresAt?: string | null;
  usedByMe?: boolean;
}

export default function Profile() {
  const { data: authData, isLoading: authLoading } = useAuth();
  const logout = useLogout();
  const [, setLocation] = useLocation();
  
  const [hiddenOrders, setHiddenOrders] = useState<number[]>([]);
  const [hiddenPreorders, setHiddenPreorders] = useState<number[]>([]);
  const [deletePreorderConfirmId, setDeletePreorderConfirmId] = useState<number | null>(null);
  const [cancelPreorderConfirmId, setCancelPreorderConfirmId] = useState<number | null>(null);
  const [certificatesExpanded, setCertificatesExpanded] = useState(false);
  const [preordersExpanded, setPreordersExpanded] = useState(true);
  const [promoCodesExpanded, setPromoCodesExpanded] = useState(false);
  const [priceDropExpanded, setPriceDropExpanded] = useState(false);
  const [stockNotifyExpanded, setStockNotifyExpanded] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'preorders' | 'subscriptions' | 'settings'>('overview');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [repeatDialogOpen, setRepeatDialogOpen] = useState(false);
  const [repeatItems, setRepeatItems] = useState<Array<OrderItem & { included: boolean }>>([]);
  const [repeatOrderId, setRepeatOrderId] = useState<number | null>(null);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [addonOrderId, setAddonOrderId] = useState<number | null>(null);
  const addToCart = useAddToCart();
  const { toast } = useToast();

  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [addressLabel, setAddressLabel] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressPostal, setAddressPostal] = useState('');
  const [addressHouse, setAddressHouse] = useState('');
  const [addressApartment, setAddressApartment] = useState('');
  const [addressEntrance, setAddressEntrance] = useState('');
  const [addressFloor, setAddressFloor] = useState('');
  const [addressLastName, setAddressLastName] = useState('');
  const [addressFirstName, setAddressFirstName] = useState('');
  const [addressPatronymic, setAddressPatronymic] = useState('');
  const [addressPhone, setAddressPhone] = useState('');
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);

  const { data: ordersData, isLoading: ordersLoading } = useQuery<{ orders: Order[] }>({
    queryKey: ["/api/auth/orders"],
    enabled: !!authData?.user,
  });

  const { data: preorderOrders, isLoading: preordersLoading } = useQuery<any[]>({
    queryKey: ["/api/preorder/my-orders"],
    enabled: !!authData?.user,
  });

  const isRetail = authData?.user?.role !== 'wholesale';
  const { data: loyaltyTiers } = useQuery<Array<{ id: number; minSpent: number; discountPercent: number; name: string | null }>>({
    queryKey: ["/api/loyalty-tiers"],
    enabled: isRetail && !!authData?.user,
  });

  const { data: giftCards } = useQuery<UserGiftCard[]>({
    queryKey: ["/api/auth/my-gift-cards"],
    enabled: isRetail && !!authData?.user,
  });

  const { data: promoCodes } = useQuery<UserPromoCode[]>({
    queryKey: ["/api/auth/my-promo-codes"],
    enabled: isRetail && !!authData?.user,
  });

  const userEmail = authData?.user?.email || '';

  const { data: priceDropData } = useQuery<{ subscriptions: Array<{ id: string; productId: number; productName: string; priceAtSubscription: number; createdAt: string }> }>({
    queryKey: ["/api/price-drop-notify/my", userEmail],
    queryFn: () => fetch(`/api/price-drop-notify/my?email=${encodeURIComponent(userEmail)}`).then(r => r.json()),
    enabled: activeTab === 'subscriptions' && !!userEmail,
  });

  const { data: stockNotifyData } = useQuery<{ subscriptions: Array<{ id: string; productId: number; productName: string; size: string; createdAt: string }> }>({
    queryKey: ["/api/stock-notify/my", userEmail],
    queryFn: () => fetch(`/api/stock-notify/my?email=${encodeURIComponent(userEmail)}`).then(r => r.json()),
    enabled: activeTab === 'subscriptions' && !!userEmail,
  });

  const { data: preorderSubData, isLoading: preorderSubLoading } = useQuery<{ subscribed: boolean; isActive: boolean } | null>({
    queryKey: ["/api/preorder-subscribers/my-status", userEmail],
    queryFn: () => fetch(`/api/preorder-subscribers/my-status?email=${encodeURIComponent(userEmail)}`).then(r => r.json()),
    enabled: activeTab === 'subscriptions' && !!userEmail,
  });

  const unsubscribePreorderMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/preorder-subscribers/unsubscribe", { email: userEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preorder-subscribers/my-status", userEmail] });
      toast({ title: "Отписка оформлена", description: "Вы больше не будете получать уведомления о предзаказах" });
    },
  });

  const deletePriceDropMutation = useMutation({
    mutationFn: ({ productId }: { productId: number }) =>
      apiRequest("DELETE", "/api/price-drop-notify", { productId, email: userEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-drop-notify/my", userEmail] });
      toast({ title: "Подписка отменена" });
    },
  });

  const deleteStockNotifyMutation = useMutation({
    mutationFn: ({ productId, size }: { productId: number; size: string }) =>
      apiRequest("DELETE", "/api/stock-notify", { productId, size, email: userEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-notify/my", userEmail] });
      toast({ title: "Подписка отменена" });
    },
  });

  const { data: newsletterData, isLoading: newsletterLoading } = useQuery<{ subscribed: boolean; promoCode: string | null }>({
    queryKey: ["/api/newsletter/my-subscription", userEmail],
    queryFn: () => fetch(`/api/newsletter/my-subscription?email=${encodeURIComponent(userEmail)}`).then(async r => { const d = await r.json(); return d; }),
    enabled: !!userEmail,
    staleTime: 0,
  });

  const unsubscribeNewsletterMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/newsletter/my-subscription", { email: userEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletter/my-subscription", userEmail] });
      toast({ title: "Вы отписались от рассылки" });
    },
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

  const { data: addressesData } = useQuery<{ addresses: SavedAddress[] }>({
    queryKey: ["/api/auth/addresses"],
    enabled: !!authData?.user,
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { name?: string; phone?: string }) => {
      const res = await apiRequest("PATCH", "/api/auth/profile", data);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Ошибка'); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Профиль обновлён" });
    },
    onError: () => {
      toast({ title: "Не удалось обновить профиль", description: "Попробуйте ещё раз позже", variant: "destructive" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const res = await apiRequest("POST", "/api/auth/change-password", data);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Ошибка'); }
      return res.json();
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: "Пароль изменён" });
    },
    onError: (error: Error) => {
      const raw = error.message || "";
      const friendly = raw.includes("Incorrect") || raw.includes("incorrect") || raw.includes("неверный")
        ? "Текущий пароль указан неверно"
        : raw.includes("short") || raw.includes("символ")
        ? "Новый пароль слишком короткий"
        : "Не удалось изменить пароль. Попробуйте ещё раз.";
      toast({ title: "Ошибка смены пароля", description: friendly, variant: "destructive" });
    },
  });

  const updateAddressesMutation = useMutation({
    mutationFn: async (addresses: SavedAddress[]) => {
      const res = await apiRequest("PUT", "/api/auth/addresses", { addresses });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Ошибка'); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/addresses"] });
    },
    onError: () => {
      toast({ title: "Не удалось сохранить адрес", description: "Попробуйте ещё раз позже", variant: "destructive" });
    },
  });

  useEffect(() => {
    const stored = localStorage.getItem(`hiddenOrders_${authData?.user?.id}`);
    if (stored) {
      setHiddenOrders(JSON.parse(stored));
    }
    const storedPreorders = localStorage.getItem(`hiddenPreorders_${authData?.user?.id}`);
    if (storedPreorders) {
      setHiddenPreorders(JSON.parse(storedPreorders));
    }
  }, [authData?.user?.id]);

  useEffect(() => {
    if (authData?.user) {
      setProfileName(authData.user.name || '');
      setProfilePhone((authData.user as any).phone || '');
    }
  }, [authData?.user]);

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
    }).format(cents / 100);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const getGiftCardStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-green-600">Активен</Badge>;
      case 'used':
        return <Badge variant="secondary">Использован</Badge>;
      case 'expired':
        return <Badge variant="destructive">Истёк</Badge>;
      case 'pending':
        return <Badge variant="secondary">Ожидает оплаты</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getPromoSource = (source: string) => {
    switch (source) {
      case 'subscription':
        return 'За подписку';
      case 'order':
        return 'Использован в заказе';
      case 'review':
        return 'За отзыв';
      default:
        return source;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Ожидает</Badge>;
      case 'paid':
        return <Badge variant="default" className="bg-green-600">Оплачен</Badge>;
      case 'processing':
        return <Badge variant="default">В обработке</Badge>;
      case 'shipped':
        return <Badge variant="default">Отправлен</Badge>;
      case 'ready_for_pickup':
        return <Badge variant="default" className="bg-amber-500">Готов к выдаче</Badge>;
      case 'delivered':
        return <Badge variant="outline" className="border-green-500 text-green-600">Доставлен</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Отменен</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };
  
  const parseCdekData = (order: Order): CdekData | null => {
    if (!order.cdekData) return null;
    try {
      return typeof order.cdekData === 'string' ? JSON.parse(order.cdekData) : order.cdekData;
    } catch { return null; }
  };

  const canCancelOrder = (status: string) => {
    return ['pending', 'paid', 'processing'].includes(status);
  };

  const isAddonEligible = (order: any) => {
    if (!['paid', 'confirmed', 'processing'].includes(order.status)) return false;
    const ageMs = Date.now() - new Date(order.createdAt).getTime();
    if (ageMs > 12 * 3600 * 1000) return false;
    try {
      const addon = order.addonData ? JSON.parse(order.addonData) : null;
      if (addon?.status === 'paid') return false;
    } catch {}
    return true;
  };

  const cancelOrderMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await apiRequest("POST", `/api/auth/orders/${orderId}/cancel`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка отмены');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/orders"] });
      setSelectedOrder(null);
      toast({ title: "Заказ отменён" });
    },
    onError: () => {
      toast({ title: "Не удалось отменить заказ", description: "Попробуйте позже или свяжитесь с поддержкой", variant: "destructive" });
    },
  });

  // Отмена предзаказа: разрешена, только пока идёт сбор (см. canCancelPreorder).
  // Возврат денег менеджер делает вручную — об этом напоминает тост и VK-алерт.
  const cancelPreorderMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await apiRequest("POST", `/api/auth/orders/${orderId}/cancel`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка отмены');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preorder/my-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/orders"] });
      setCancelPreorderConfirmId(null);
      toast({ title: "Предзаказ отменён", description: "Возврат средств согласуем с вами вручную" });
    },
    onError: () => {
      setCancelPreorderConfirmId(null);
      toast({ title: "Не удалось отменить предзаказ", description: "Сбор, возможно, уже завершён — напишите в поддержку", variant: "destructive" });
    },
  });

  const refreshTrackingMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await apiRequest("POST", `/api/auth/orders/${orderId}/refresh-tracking`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка обновления');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/orders"] });
      if (selectedOrder) {
        setSelectedOrder({
          ...selectedOrder,
          cdekData: JSON.stringify(data.cdekData),
          status: data.status || selectedOrder.status,
        });
      }
      toast({ title: "Статус обновлён" });
    },
    onError: () => {
      toast({ title: "Не удалось обновить статус", description: "Попробуйте через несколько минут", variant: "destructive" });
    },
  });

  const [preorderCdekCache, setPreorderCdekCache] = useState<Record<number, any>>({});
  const refreshPreorderTrackingMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await apiRequest("POST", `/api/auth/orders/${orderId}/refresh-tracking`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Ошибка'); }
      return res.json();
    },
    onSuccess: (data, orderId) => {
      setPreorderCdekCache(prev => ({ ...prev, [orderId]: data.cdekData }));
      queryClient.invalidateQueries({ queryKey: ["/api/preorder/my-orders"] });
      toast({ title: "Трекинг обновлён" });
    },
    onError: () => toast({ title: "Не удалось обновить трекинг", variant: "destructive" }),
  });

  const hideOrder = (orderId: number) => {
    const newHidden = [...hiddenOrders, orderId];
    setHiddenOrders(newHidden);
    localStorage.setItem(`hiddenOrders_${authData?.user?.id}`, JSON.stringify(newHidden));
  };

  const hidePreorder = (orderId: number) => {
    const newHidden = [...hiddenPreorders, orderId];
    setHiddenPreorders(newHidden);
    localStorage.setItem(`hiddenPreorders_${authData?.user?.id}`, JSON.stringify(newHidden));
  };
  
  const visibleOrders = (ordersData?.orders || []).filter(o => !hiddenOrders.includes(o.id));

  // Предзаказ можно отменить, только пока идёт сбор: статус заказа paid/pending,
  // заказ ещё не отменён и кампания товара в статусе collecting.
  const canCancelPreorder = (order: any) => {
    if (!order || order.status === 'cancelled') return false;
    if (!['pending', 'paid'].includes(order.status)) return false;
    const prodStatus = (order as any).orderPreorderStatus || order.productPreorder?.preorderStatus || 'collecting';
    return prodStatus === 'collecting';
  };

  const openRepeatDialog = (order: Order) => {
    setRepeatOrderId(order.id);
    setRepeatItems(
      order.items.filter((item: any) => !item._discountDetails).map(item => ({
        ...item,
        included: true,
      }))
    );
    setSelectedOrder(null);
    setRepeatDialogOpen(true);
  };

  const updateRepeatItemQuantity = (index: number, newQty: number) => {
    if (newQty < 1) return;
    setRepeatItems(prev => prev.map((item, i) => i === index ? { ...item, quantity: newQty } : item));
  };

  const toggleRepeatItem = (index: number) => {
    setRepeatItems(prev => prev.map((item, i) => i === index ? { ...item, included: !item.included } : item));
  };

  const handleRepeatOrder = async () => {
    const itemsToAdd = repeatItems.filter(item => item.included);
    if (itemsToAdd.length === 0) return;

    setIsAddingToCart(true);
    try {
      for (const item of itemsToAdd) {
        await new Promise<void>((resolve, reject) => {
          addToCart.mutate(
            {
              productId: item.productId,
              quantity: item.quantity,
              size: item.size || "One Size",
              color: item.color || "Default",
              ecommerce: {
                id: item.sku || item.productId,
                name: item.productName || item.name || String(item.productId),
                priceCents: item.price,
                variant: makeVariant(item.size, item.color),
                quantity: item.quantity,
              },
            },
            {
              onSuccess: () => resolve(),
              onError: () => reject(),
            }
          );
        });
      }
      setRepeatDialogOpen(false);
      toast({
        title: "Товары добавлены в корзину",
        description: `${itemsToAdd.length} позиций из заказа #${repeatOrderId} добавлены в корзину`,
      });
      setLocation("/cart");
    } catch {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Не удалось добавить некоторые товары в корзину",
      });
    } finally {
      setIsAddingToCart(false);
    }
  };

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setLocation("/");
      }
    });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <BrandLoader size="lg" />
      </div>
    );
  }

  if (!authData?.user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <User className="w-16 h-16 text-muted-foreground mb-6" />
        <h1 className="text-2xl font-semibold mb-4 text-foreground">Войдите в аккаунт</h1>
        <p className="text-muted-foreground mb-8 text-center">
          Для доступа к личному кабинету необходимо авторизоваться
        </p>
        <Button size="lg" onClick={() => setLocation("/")}>
          На главную
        </Button>
      </div>
    );
  }

  const user = authData.user;
  
  // Сумма для бонусной программы: только розничные (не оптовые) заказы
  // в статусах, которые учитывает лояльность (без pending/cancelled/refunded/awaiting_payment).
  const totalSpent = ordersData?.orders
    ? ordersData.orders
        .filter((o: any) => !o.isWholesale && !['pending', 'awaiting_payment', 'cancelled', 'refunded', 'new', 'created'].includes(o.status))
        .reduce((sum: number, o: any) => sum + (o.total || 0), 0)
    : ((user as any).totalSpent || 0);
  const currentDiscount = (user as any).loyaltyDiscount || 0;
  const sortedTiers = loyaltyTiers ? [...loyaltyTiers].sort((a, b) => a.minSpent - b.minSpent) : [];
  const currentTier = sortedTiers.filter(t => totalSpent >= t.minSpent).pop();
  const nextTier = sortedTiers.find(t => totalSpent < t.minSpent);
  const progressToNext = nextTier 
    ? Math.min(100, Math.round((totalSpent / nextTier.minSpent) * 100))
    : 100;
  const amountToNextTier = nextTier ? nextTier.minSpent - totalSpent : 0;

  const hasPromoCodes = promoCodes && promoCodes.length > 0;
  const hasGiftCards = giftCards && giftCards.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Личный кабинет" noindex={true} />
      <Navbar />

      <div className="pt-32 pb-24 max-w-4xl mx-auto px-4 sm:px-6">
        {/* Header with user info and logout */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground" data-testid="text-user-name">{user.name}</h1>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span data-testid="text-user-email">{user.email}</span>
                {user.emailVerified ? (
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                )}
              </div>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleLogout}
            disabled={logout.isPending}
            data-testid="button-logout"
          >
            {logout.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogOut className="w-4 h-4 mr-2" />}
            Выйти
          </Button>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-1 border-b mb-6">
          <Button
            variant={activeTab === 'overview' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('overview')}
            className="rounded-b-none text-xs sm:text-sm px-2 sm:px-3"
            data-testid="button-tab-overview"
          >
            Обзор
          </Button>
          <Button
            variant={activeTab === 'orders' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('orders')}
            className="rounded-b-none text-xs sm:text-sm px-2 sm:px-3"
            data-testid="button-tab-orders"
          >
            Заказы
            {visibleOrders.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">{visibleOrders.length}</Badge>
            )}
          </Button>
          <Button
            variant={activeTab === 'preorders' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('preorders')}
            className="rounded-b-none text-xs sm:text-sm px-2 sm:px-3"
            data-testid="button-tab-preorders"
          >
            Предзаказы
          </Button>
          <Button
            variant={activeTab === 'subscriptions' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('subscriptions')}
            className="rounded-b-none text-xs sm:text-sm px-2 sm:px-3"
            data-testid="button-tab-subscriptions"
          >
            Подписки
            {((promoCodes?.length || 0) + (priceDropData?.subscriptions?.length || 0) + (stockNotifyData?.subscriptions?.length || 0)) > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {(promoCodes?.length || 0) + (priceDropData?.subscriptions?.length || 0) + (stockNotifyData?.subscriptions?.length || 0)}
              </Badge>
            )}
          </Button>
          <Button
            variant={activeTab === 'settings' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('settings')}
            className="rounded-b-none text-xs sm:text-sm px-2 sm:px-3"
            data-testid="button-tab-settings"
          >
            <Settings className="w-4 h-4 mr-1" />
            Настройки
          </Button>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Top row: Loyalty + Stats */}
            {isRetail && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Loyalty Card */}
                <Card className="p-5">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <Gift className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm text-foreground">Бонусная программа</span>
                    </div>
                    {currentTier?.name && (
                      <Badge variant="secondary" className="text-xs">
                        <Star className="w-3 h-3 mr-1" />
                        {currentTier.name}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-baseline gap-3 mb-3">
                    <span className="text-3xl font-bold text-primary" data-testid="text-loyalty-discount">
                      {currentDiscount}%
                    </span>
                    <span className="text-xs text-muted-foreground">ваша скидка</span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>Сумма покупок:</span>
                    <span className="font-medium text-foreground" data-testid="text-total-spent">
                      {formatPrice(totalSpent)}
                    </span>
                  </div>

                  {nextTier && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">До {nextTier.discountPercent}%{nextTier.name ? ` (${nextTier.name})` : ''}</span>
                        <span className="text-primary font-medium">{formatPrice(amountToNextTier)}</span>
                      </div>
                      <Progress value={progressToNext} className="h-1.5" />
                    </div>
                  )}

                  {!nextTier && sortedTiers.length > 0 && (
                    <div className="text-center">
                      <Badge variant="default" className="bg-primary">
                        <Star className="w-3 h-3 mr-1" />
                        Максимальный уровень
                      </Badge>
                    </div>
                  )}

                  {sortedTiers.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Совершайте покупки и получайте скидки!
                    </p>
                  )}
                </Card>

                {/* Quick Stats Card */}
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <ShoppingBag className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-sm text-foreground">Сводка</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-md p-3 text-center">
                      <div className="text-2xl font-bold text-foreground" data-testid="text-orders-count">
                        {visibleOrders.length}
                      </div>
                      <div className="text-xs text-muted-foreground">Заказов</div>
                    </div>
                    <div className="bg-muted/50 rounded-md p-3 text-center">
                      <div className="text-2xl font-bold text-foreground" data-testid="text-promos-count">
                        {(promoCodes?.filter(p => p.isActive && !p.usedByMe).length || 0) + (giftCards?.filter(g => g.status === 'active').length || 0)}
                      </div>
                      <div className="text-xs text-muted-foreground">Активных бонусов</div>
                    </div>
                  </div>
                  {visibleOrders.length > 0 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full mt-3"
                      onClick={() => setActiveTab('orders')}
                      data-testid="button-view-orders"
                    >
                      <Package className="w-3.5 h-3.5 mr-2" />
                      Смотреть заказы
                    </Button>
                  )}
                </Card>
              </div>
            )}

            {/* Shortcut to subscriptions */}
            {isRetail && hasPromoCodes && (
              <Card className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-sm text-foreground">Мои промокоды</span>
                    <Badge variant="secondary" className="text-xs">{promoCodes!.filter(p => !p.usedByMe).length}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab('subscriptions')}
                    data-testid="button-go-to-subscriptions"
                  >
                    Смотреть
                    <ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </div>
              </Card>
            )}

            {/* Gift Cards */}
            {isRetail && hasGiftCards && (
              <Card className="p-5">
                <div 
                  className="flex items-center gap-2 cursor-pointer select-none"
                  onClick={() => setCertificatesExpanded(!certificatesExpanded)}
                  data-testid="button-toggle-certificates"
                >
                  <CreditCard className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm text-foreground">Мои сертификаты</span>
                  <Badge variant="secondary" className="text-xs">{giftCards!.length}</Badge>
                  <div className="ml-auto">
                    {certificatesExpanded ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
                {certificatesExpanded && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                    {giftCards!.map((card) => (
                      <div 
                        key={card.id} 
                        className="border rounded-md p-3"
                        data-testid={`card-gift-${card.id}`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono font-bold text-xs text-foreground truncate" data-testid={`text-gift-code-${card.id}`}>
                              {card.code}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => { e.stopPropagation(); copyCode(card.code); }}
                              className="shrink-0"
                              data-testid={`button-copy-gift-${card.id}`}
                            >
                              {copiedCode === card.code ? (
                                <Check className="w-3.5 h-3.5 text-green-500" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </Button>
                          </div>
                          {getGiftCardStatusBadge(card.status)}
                        </div>
                        <div className="flex items-end justify-between gap-2">
                          <div className="text-xs text-muted-foreground space-y-0.5">
                            <div>Номинал: {formatPrice(card.amount)}</div>
                            {card.purchaserEmail.toLowerCase() !== authData?.user?.email?.toLowerCase() && (
                              <div className="text-primary">Подарен вам</div>
                            )}
                            {card.expiresAt && (
                              <div>до {formatDate(card.expiresAt)}</div>
                            )}
                          </div>
                          {card.balance > 0 && card.status === 'active' && (
                            <span className="text-lg font-bold text-primary whitespace-nowrap" data-testid={`text-gift-balance-${card.id}`}>
                              {formatPrice(card.balance)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Empty state for non-retail or no bonuses */}
            {isRetail && !hasPromoCodes && !hasGiftCards && (
              <Card className="p-8 text-center">
                <Gift className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  У вас пока нет промокодов и сертификатов. Подпишитесь на рассылку, чтобы получить промокод на скидку!
                </p>
              </Card>
            )}
          </div>
        )}

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div>
            {ordersLoading ? (
              <div className="flex items-center justify-center py-16">
                <BrandLoader size="lg" />
              </div>
            ) : visibleOrders.length === 0 ? (
              <Card className="p-12 text-center">
                <ShoppingBag className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">У вас пока нет заказов</p>
                <Button onClick={() => setLocation("/products")} data-testid="button-go-shopping">
                  Перейти к покупкам
                </Button>
              </Card>
            ) : (
              <div className="space-y-3">
                {visibleOrders.map((order) => {
                  const orderItems = order.items.filter((i: any) => !i._discountDetails);
                  const itemImages = orderItems
                    .map(i => i.imageUrl)
                    .filter(Boolean)
                    .slice(0, 4);
                  
                  return (
                    <Card 
                      key={order.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => setSelectedOrder(order)}
                      data-testid={`card-order-${order.id}`}
                    >
                      <div className="px-4 py-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-semibold text-sm text-foreground" data-testid={`text-order-id-${order.id}`}>
                              #{order.id}
                            </span>
                            {getStatusBadge(order.status)}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-sm text-foreground">{formatPrice(order.total)}</span>
                            <span className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</span>
                            {isAddonEligible(order) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 px-2"
                                data-testid={`button-addon-order-${order.id}`}
                                onClick={(e) => { e.stopPropagation(); setAddonOrderId(order.id); }}
                              >
                                + Добавить
                              </Button>
                            )}
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </div>
                        {itemImages.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-2">
                              {itemImages.map((img, idx) => (
                                <div key={idx} className="w-8 h-8 rounded-md border bg-muted overflow-hidden shrink-0">
                                  <img 
                                    src={img!} 
                                    alt="" 
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                </div>
                              ))}
                              {orderItems.length > 4 && (
                                <div className="w-8 h-8 rounded-md border bg-muted flex items-center justify-center shrink-0">
                                  <span className="text-[10px] text-muted-foreground">+{orderItems.length - 4}</span>
                                </div>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {orderItems.length} {orderItems.length === 1 ? 'товар' : orderItems.length < 5 ? 'товара' : 'товаров'}
                            </span>
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Preorders Tab */}
        {activeTab === 'preorders' && (
          <div className="space-y-4" data-testid="section-preorders">
            {preordersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : !preorderOrders || preorderOrders.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-muted-foreground text-sm">У вас пока нет предзаказов</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setLocation('/concept')} data-testid="button-go-concept">
                  Перейти к предзаказам
                </Button>
              </Card>
            ) : (() => {
              const visiblePreorders = preorderOrders.filter((o: any) => !hiddenPreorders.includes(o.id));
              return visiblePreorders.length === 0 ? (
                <Card className="p-6 text-center">
                  <p className="text-muted-foreground text-sm">У вас пока нет предзаказов</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setLocation('/concept')} data-testid="button-go-concept-2">
                    Перейти к предзаказам
                  </Button>
                </Card>
              ) : (
                <>
                  <div 
                    className="flex items-center gap-2 cursor-pointer select-none px-1"
                    onClick={() => setPreordersExpanded(!preordersExpanded)}
                    data-testid="button-toggle-preorders"
                  >
                    <Package className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-sm text-foreground">Мои предзаказы</span>
                    <Badge variant="secondary" className="text-xs">{visiblePreorders.length}</Badge>
                    <div className="ml-auto">
                      {preordersExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                  {preordersExpanded && visiblePreorders.map((order: any) => {
                    const items = Array.isArray(order.items) ? order.items : [];
                    const item = items[0] || {};
                    const status = order.status;
                    return (
                      <Card key={order.id} className="p-4" data-testid={`card-preorder-order-${order.id}`}>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{item.productName || "Предзаказ"}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {item.size && `Размер: ${item.size}`}{item.size && item.color ? " / " : ""}{item.color && `Цвет: ${item.color}`}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Заказ #{order.id} от {new Date(order.createdAt).toLocaleDateString("ru-RU")}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium">{(order.total / 100).toLocaleString("ru-RU")} &#8381;</p>
                            {status === "cancelled" ? (
                              <Badge variant="destructive" className="text-xs mt-1">Отменён</Badge>
                            ) : ["paid", "processing", "shipped", "delivered"].includes(status) ? (
                              <Badge variant="outline" className="text-xs border-green-500 text-green-600 mt-1">Оплачен</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600 mt-1">Ожидает оплаты</Badge>
                            )}
                          </div>
                        </div>
                        {order.productPreorder && (() => {
                          const productStatus = (order as any).orderPreorderStatus || order.productPreorder?.preorderStatus || "collecting";
                          const steps = [
                            { key: "collecting", label: "Сбор" },
                            { key: "production", label: "В производстве" },
                            { key: "shipping", label: "Отправка" },
                            { key: "shipped", label: "Отправлено" },
                          ];
                          const cancelledOrPaid = productStatus === "cancelled" || status === "paid";
                          const orderCancelled = status === "cancelled";
                          const currentIdx = steps.findIndex(s => s.key === productStatus);
                          return (
                            <div className="mt-3 pt-3 border-t border-border">
                              {orderCancelled || productStatus === "cancelled" ? (
                                <Badge variant="destructive" className="text-xs">{orderCancelled ? "Заказ отменён" : "Предзаказ отменён"}</Badge>
                              ) : (
                                <div className="flex items-center gap-1 mb-3" data-testid={`preorder-steps-${order.id}`}>
                                  {steps.map((step, idx) => {
                                    const isActive = idx <= currentIdx;
                                    const isCurrent = idx === currentIdx;
                                    return (
                                      <div key={step.key} className="flex items-center gap-1 flex-1">
                                        <div className="flex flex-col items-center flex-1">
                                          <div className={`w-full h-1.5 rounded-full transition-colors ${isActive ? 'bg-primary' : 'bg-muted'}`} />
                                          <span className={`text-[10px] mt-1 text-center leading-tight ${isCurrent ? 'text-primary font-medium' : isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                                            {step.label}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {!orderCancelled && productStatus === "collecting" && order.productPreorder.preorderDeadline && (
                                <p className="text-xs text-muted-foreground mb-2">
                                  Сбор до {new Date(order.productPreorder.preorderDeadline).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                                </p>
                              )}
                              {productStatus === "production" && order.productPreorder.preorderProductionDate && (
                                <p className="text-xs text-muted-foreground mb-2">
                                  В производстве до {new Date(order.productPreorder.preorderProductionDate).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                                </p>
                              )}
                              {productStatus === "shipping" && order.productPreorder.preorderShippingDate && (
                                <p className="text-xs text-muted-foreground mb-2">
                                  Отправка {new Date(order.productPreorder.preorderShippingDate).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                                </p>
                              )}
                              {(productStatus === "shipping" || productStatus === "shipped") && (() => {
                                const cdekRaw = preorderCdekCache[order.id] || order.cdekData;
                                if (!cdekRaw) return null;
                                let cdek: any = {};
                                try { cdek = typeof cdekRaw === 'string' ? JSON.parse(cdekRaw) : cdekRaw; } catch { return null; }
                                const trackNumber = cdek.cdekNumber || cdek.trackNumber;
                                const pointAddress = cdek.pointAddress;
                                const cdekStatuses: any[] = cdek.cdekStatuses || [];
                                return (
                                  <div className="mt-2 bg-muted/30 rounded-md p-3 space-y-2">
                                    {/* Header row: track number + buttons */}
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <Truck className="w-4 h-4 text-primary shrink-0" />
                                        <span className="text-sm text-foreground">СДЭК{trackNumber ? ':' : ''}</span>
                                        {trackNumber && (
                                          <span className="font-mono text-sm font-medium text-foreground" data-testid={`text-preorder-track-${order.id}`}>{trackNumber}</span>
                                        )}
                                        {!trackNumber && (
                                          <span className="text-sm text-muted-foreground">{cdek.orderUuid ? 'Заявка создана' : 'Накладная создаётся...'}</span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1">
                                        {trackNumber && (
                                          <>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={() => { navigator.clipboard.writeText(trackNumber); toast({ title: "Трек скопирован" }); }}
                                              data-testid={`button-copy-preorder-track-${order.id}`}
                                            >
                                              <Copy className="w-3.5 h-3.5 mr-1" />
                                              Копировать
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => window.open(`https://www.cdek.ru/ru/tracking?order_id=${trackNumber}`, '_blank')}
                                              data-testid={`button-track-preorder-cdek-${order.id}`}
                                            >
                                              <ExternalLink className="w-3.5 h-3.5 mr-1" />
                                              На сайте СДЭК
                                            </Button>
                                          </>
                                        )}
                                      </div>
                                    </div>

                                    {/* ПВЗ адрес */}
                                    {pointAddress && (
                                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                        <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                        <span>{pointAddress}</span>
                                      </div>
                                    )}

                                    {/* Путь посылки */}
                                    {cdekStatuses.length > 0 && (
                                      <div className="mt-1 border-t pt-2">
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                          <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                                            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                                            Путь посылки
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => refreshPreorderTrackingMutation.mutate(order.id)}
                                            disabled={refreshPreorderTrackingMutation.isPending}
                                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                                            data-testid={`button-refresh-preorder-track-${order.id}`}
                                          >
                                            {refreshPreorderTrackingMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                            Обновить
                                          </button>
                                        </div>
                                        <div className="space-y-0">
                                          {cdekStatuses.map((st: any, idx: number) => (
                                            <div key={idx} className="flex gap-2.5 relative">
                                              <div className="flex flex-col items-center">
                                                <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${idx === 0 ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                                                {idx < cdekStatuses.length - 1 && <div className="w-px flex-1 bg-muted mt-0.5" />}
                                              </div>
                                              <div className="flex-1 min-w-0 pb-2.5">
                                                <p className={`text-xs leading-tight ${idx === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{st.name}</p>
                                                <div className="flex flex-wrap items-center gap-x-2 mt-0.5">
                                                  {st.date && (
                                                    <span className="text-[10px] text-muted-foreground">
                                                      {new Date(st.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                  )}
                                                  {st.city && (
                                                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                                      <MapPin className="w-2.5 h-2.5" />{st.city}
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Если статусов нет — кнопка обновить */}
                                    {cdekStatuses.length === 0 && (
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs text-muted-foreground">
                                          {cdek.lastCdekStatusName || 'Статус обновляется...'}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => refreshPreorderTrackingMutation.mutate(order.id)}
                                          disabled={refreshPreorderTrackingMutation.isPending}
                                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                                          data-testid={`button-refresh-preorder-track-${order.id}`}
                                        >
                                          {refreshPreorderTrackingMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                          Обновить
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })()}
                        <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 flex-wrap">
                          {canCancelPreorder(order) && (
                            cancelPreorderConfirmId === order.id ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Отменить предзаказ? Возврат — вручную.</span>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={cancelPreorderMutation.isPending}
                                  onClick={() => cancelPreorderMutation.mutate(order.id)}
                                  data-testid={`button-confirm-cancel-preorder-${order.id}`}
                                >
                                  {cancelPreorderMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                                  Да
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setCancelPreorderConfirmId(null)}
                                  data-testid={`button-abort-cancel-preorder-${order.id}`}
                                >
                                  Нет
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setCancelPreorderConfirmId(order.id)}
                                data-testid={`button-cancel-preorder-${order.id}`}
                              >
                                <X className="w-3.5 h-3.5 mr-1" />
                                Отменить
                              </Button>
                            )
                          )}
                          {deletePreorderConfirmId === order.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Удалить предзаказ из списка?</span>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => { hidePreorder(order.id); setDeletePreorderConfirmId(null); }}
                                data-testid={`button-confirm-delete-preorder-${order.id}`}
                              >
                                Да
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDeletePreorderConfirmId(null)}
                                data-testid={`button-cancel-delete-preorder-${order.id}`}
                              >
                                Нет
                              </Button>
                            </div>
                          ) : (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => setDeletePreorderConfirmId(order.id)}
                              className="text-muted-foreground ml-auto"
                              data-testid={`button-delete-preorder-${order.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" />
                              Удалить
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">Личные данные</span>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Имя</label>
                  <Input
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    data-testid="input-profile-name"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Телефон</label>
                  <Input
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    placeholder="+7 (___) ___-__-__"
                    data-testid="input-profile-phone"
                  />
                </div>
                <Button
                  onClick={() => updateProfileMutation.mutate({ name: profileName, phone: profilePhone })}
                  disabled={updateProfileMutation.isPending || (profileName === (user.name || '') && profilePhone === ((user as any).phone || ''))}
                  data-testid="button-save-profile"
                >
                  {updateProfileMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Сохранить
                </Button>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm text-foreground">Адреса доставки</span>
                </div>
                {!showAddressForm && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingAddressId(null);
                      setAddressLabel('');
                      setAddressCity('');
                      setAddressStreet('');
                      setAddressPostal('');
                      setAddressHouse('');
                      setAddressApartment('');
                      setAddressEntrance('');
                      setAddressFloor('');
                      setAddressLastName('');
                      setAddressFirstName('');
                      setAddressPatronymic('');
                      setAddressPhone('');
                      setShowAddressForm(true);
                    }}
                    data-testid="button-add-address"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Добавить
                  </Button>
                )}
              </div>

              {showAddressForm && (
                <div className="border rounded-md p-4 mb-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground">
                      {editingAddressId ? 'Редактировать адрес' : 'Новый адрес'}
                    </span>
                    <Button size="icon" variant="ghost" onClick={() => setShowAddressForm(false)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Название</label>
                    <Input
                      value={addressLabel}
                      onChange={(e) => setAddressLabel(e.target.value)}
                      placeholder="Дом, Работа, и т.д."
                      data-testid="input-address-label"
                    />
                  </div>

                  <div className="border-t pt-3 mt-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Получатель</span>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Фамилия</label>
                        <Input
                          value={addressLastName}
                          onChange={(e) => setAddressLastName(e.target.value)}
                          placeholder="Иванов"
                          data-testid="input-address-lastname"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Имя</label>
                        <Input
                          value={addressFirstName}
                          onChange={(e) => setAddressFirstName(e.target.value)}
                          placeholder="Иван"
                          data-testid="input-address-firstname"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Отчество</label>
                        <Input
                          value={addressPatronymic}
                          onChange={(e) => setAddressPatronymic(e.target.value)}
                          placeholder="Иванович"
                          data-testid="input-address-patronymic"
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="text-xs text-muted-foreground mb-1 block">Телефон</label>
                      <Input
                        value={addressPhone}
                        onChange={(e) => setAddressPhone(e.target.value)}
                        placeholder="+7 (999) 123-45-67"
                        data-testid="input-address-phone"
                      />
                    </div>
                  </div>

                  <div className="border-t pt-3 mt-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Адрес</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Город</label>
                        <Input
                          value={addressCity}
                          onChange={(e) => setAddressCity(e.target.value)}
                          placeholder="Москва"
                          data-testid="input-address-city"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Индекс</label>
                        <Input
                          value={addressPostal}
                          onChange={(e) => setAddressPostal(e.target.value)}
                          placeholder="101000"
                          data-testid="input-address-postal"
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="text-xs text-muted-foreground mb-1 block">Улица</label>
                      <Input
                        value={addressStreet}
                        onChange={(e) => setAddressStreet(e.target.value)}
                        placeholder="ул. Пушкина"
                        data-testid="input-address-street"
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-2">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Дом</label>
                        <Input
                          value={addressHouse}
                          onChange={(e) => setAddressHouse(e.target.value)}
                          placeholder="10"
                          data-testid="input-address-house"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Кв./Офис</label>
                        <Input
                          value={addressApartment}
                          onChange={(e) => setAddressApartment(e.target.value)}
                          placeholder="5"
                          data-testid="input-address-apartment"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Подъезд</label>
                        <Input
                          value={addressEntrance}
                          onChange={(e) => setAddressEntrance(e.target.value)}
                          placeholder="1"
                          data-testid="input-address-entrance"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Этаж</label>
                        <Input
                          value={addressFloor}
                          onChange={(e) => setAddressFloor(e.target.value)}
                          placeholder="3"
                          data-testid="input-address-floor"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end pt-2">
                    <Button variant="outline" size="sm" onClick={() => setShowAddressForm(false)}>Отмена</Button>
                    <Button
                      size="sm"
                      disabled={!addressCity.trim() || !addressStreet.trim()}
                      onClick={() => {
                        const existing = addressesData?.addresses || [];
                        const fullAddress = [addressStreet.trim(), addressHouse.trim() ? `д. ${addressHouse.trim()}` : '', addressApartment.trim() ? `кв. ${addressApartment.trim()}` : ''].filter(Boolean).join(', ');
                        const addrData = {
                          label: addressLabel.trim() || 'Адрес',
                          city: addressCity.trim(),
                          address: fullAddress || addressStreet.trim(),
                          postalCode: addressPostal.trim(),
                          street: addressStreet.trim(),
                          house: addressHouse.trim(),
                          apartment: addressApartment.trim(),
                          entrance: addressEntrance.trim(),
                          floor: addressFloor.trim(),
                          lastName: addressLastName.trim(),
                          firstName: addressFirstName.trim(),
                          patronymic: addressPatronymic.trim(),
                          phone: addressPhone.trim(),
                        };
                        if (editingAddressId) {
                          const updated = existing.map(a =>
                            a.id === editingAddressId
                              ? { ...a, ...addrData }
                              : a
                          );
                          updateAddressesMutation.mutate(updated);
                        } else {
                          const newAddr = {
                            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                            ...addrData,
                            isDefault: existing.length === 0,
                          };
                          updateAddressesMutation.mutate([...existing, newAddr]);
                        }
                        setShowAddressForm(false);
                        toast({ title: editingAddressId ? 'Адрес обновлён' : 'Адрес добавлен' });
                      }}
                      data-testid="button-save-address"
                    >
                      Сохранить
                    </Button>
                  </div>
                </div>
              )}

              {(!addressesData?.addresses || addressesData.addresses.length === 0) && !showAddressForm ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Нет сохранённых адресов
                </p>
              ) : (
                <div className="space-y-2">
                  {(addressesData?.addresses || []).map((addr) => (
                    <div
                      key={addr.id}
                      className="border rounded-md p-3 flex items-start justify-between gap-3"
                      data-testid={`card-address-${addr.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm text-foreground">{addr.label || 'Адрес'}</span>
                          {addr.isDefault && (
                            <Badge variant="secondary" className="text-xs">По умолчанию</Badge>
                          )}
                        </div>
                        {(addr.lastName || addr.firstName) && (
                          <p className="text-xs text-muted-foreground">
                            {[addr.lastName, addr.firstName, addr.patronymic].filter(Boolean).join(' ')}
                            {addr.phone ? ` \u00B7 ${addr.phone}` : ''}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {addr.city}{addr.postalCode ? `, ${addr.postalCode}` : ''}
                        </p>
                        <p className="text-sm text-foreground">{addr.address}</p>
                        {(addr.entrance || addr.floor) && (
                          <p className="text-xs text-muted-foreground">
                            {addr.entrance ? `подъезд ${addr.entrance}` : ''}{addr.entrance && addr.floor ? ', ' : ''}{addr.floor ? `этаж ${addr.floor}` : ''}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!addr.isDefault && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const updated = (addressesData?.addresses || []).map(a => ({
                                ...a,
                                isDefault: a.id === addr.id,
                              }));
                              updateAddressesMutation.mutate(updated);
                              toast({ title: 'Адрес по умолчанию обновлён' });
                            }}
                            data-testid={`button-default-address-${addr.id}`}
                          >
                            <Home className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditingAddressId(addr.id);
                            setAddressLabel(addr.label);
                            setAddressCity(addr.city);
                            setAddressStreet(addr.street || addr.address);
                            setAddressPostal(addr.postalCode || '');
                            setAddressHouse(addr.house || '');
                            setAddressApartment(addr.apartment || '');
                            setAddressEntrance(addr.entrance || '');
                            setAddressFloor(addr.floor || '');
                            setAddressLastName(addr.lastName || '');
                            setAddressFirstName(addr.firstName || '');
                            setAddressPatronymic(addr.patronymic || '');
                            setAddressPhone(addr.phone || '');
                            setShowAddressForm(true);
                          }}
                          data-testid={`button-edit-address-${addr.id}`}
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            const filtered = (addressesData?.addresses || []).filter(a => a.id !== addr.id);
                            if (addr.isDefault && filtered.length > 0) {
                              filtered[0].isDefault = true;
                            }
                            updateAddressesMutation.mutate(filtered);
                            toast({ title: 'Адрес удалён' });
                          }}
                          data-testid={`button-delete-address-${addr.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Lock className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">Смена пароля</span>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Текущий пароль</label>
                  <PasswordInput
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    data-testid="input-current-password"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Новый пароль</label>
                  <PasswordInput
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    data-testid="input-new-password"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Подтвердите пароль</label>
                  <PasswordInput
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    data-testid="input-confirm-password"
                  />
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-xs text-destructive mt-1">Пароли не совпадают</p>
                  )}
                </div>
                <Button
                  onClick={() => changePasswordMutation.mutate({ currentPassword, newPassword })}
                  disabled={
                    changePasswordMutation.isPending ||
                    !currentPassword ||
                    !newPassword ||
                    newPassword.length < 6 ||
                    newPassword !== confirmPassword
                  }
                  data-testid="button-change-password"
                >
                  {changePasswordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Изменить пароль
                </Button>
                {newPassword && newPassword.length < 6 && (
                  <p className="text-xs text-muted-foreground">Минимум 6 символов</p>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* Subscriptions Tab */}
        {activeTab === 'subscriptions' && (
          <div className="space-y-6">
            {/* Newsletter subscription */}
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm text-foreground">Рассылка</span>
                </div>
                {newsletterLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : newsletterData?.subscribed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => unsubscribeNewsletterMutation.mutate()}
                    disabled={unsubscribeNewsletterMutation.isPending}
                    data-testid="button-unsubscribe-newsletter"
                  >
                    {unsubscribeNewsletterMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5 mr-1" />
                    )}
                    Отписаться
                  </Button>
                ) : (
                  <Badge variant="secondary" className="text-xs">Не подписан</Badge>
                )}
              </div>
              {!newsletterLoading && newsletterData?.subscribed && (
                <p className="text-xs text-muted-foreground mt-3">
                  Вы подписаны на рассылку. Получаете анонсы новых дропов и эксклюзивные акции.
                </p>
              )}
              {!newsletterLoading && newsletterData && !newsletterData.subscribed && (
                <p className="text-xs text-muted-foreground mt-3">
                  Вы не подписаны на рассылку.
                </p>
              )}
            </Card>

            {/* Preorder subscription */}
            <Card className="p-5" data-testid="card-preorder-subscription">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm text-foreground">Уведомления о предзаказах</span>
                </div>
                {preorderSubLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : preorderSubData?.subscribed && preorderSubData?.isActive ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => unsubscribePreorderMutation.mutate()}
                    disabled={unsubscribePreorderMutation.isPending}
                    data-testid="button-unsubscribe-preorder"
                  >
                    {unsubscribePreorderMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5 mr-1" />
                    )}
                    Отписаться
                  </Button>
                ) : (
                  <Badge variant="secondary" className="text-xs">Не подписан</Badge>
                )}
              </div>
              {!preorderSubLoading && preorderSubData?.subscribed && preorderSubData?.isActive && (
                <p className="text-xs text-muted-foreground mt-3">
                  Вы подписаны на уведомления. Получите письмо, как только откроется новый предзаказ.
                </p>
              )}
              {!preorderSubLoading && (!preorderSubData?.subscribed || !preorderSubData?.isActive) && (
                <p className="text-xs text-muted-foreground mt-3">
                  Вы не подписаны. Подписаться можно на странице{' '}
                  <a href="/concept" className="underline hover:text-foreground transition-colors">Pre-drop</a>.
                </p>
              )}
            </Card>

            {/* Promo Codes */}
            {isRetail && (
              <Card className="p-5">
                <div
                  className="flex items-center gap-2 cursor-pointer select-none"
                  onClick={() => setPromoCodesExpanded(!promoCodesExpanded)}
                  data-testid="button-toggle-promo-codes"
                >
                  <Tag className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm text-foreground">Мои промокоды</span>
                  {promoCodes && promoCodes.length > 0 && (
                    <Badge variant="secondary" className="text-xs">{promoCodes.length}</Badge>
                  )}
                  <div className="ml-auto">
                    {promoCodesExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>
                {promoCodesExpanded && (
                  <div className="mt-4">
                    {!promoCodes || promoCodes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">У вас пока нет промокодов. Подпишитесь на рассылку или совершайте покупки — мы будем дарить вам скидки.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {promoCodes.map((promo) => (
                          <div
                            key={promo.code}
                            className={`border rounded-md p-3 flex items-center justify-between gap-2 ${promo.usedByMe ? 'opacity-60' : ''}`}
                            data-testid={`card-promo-${promo.code}`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`font-mono font-bold text-sm truncate ${promo.usedByMe ? 'text-muted-foreground line-through' : 'text-foreground'}`} data-testid={`text-promo-code-${promo.code}`}>
                                  {promo.code}
                                </span>
                                {promo.usedByMe ? (
                                  <Badge variant="secondary" className="shrink-0">Использован</Badge>
                                ) : promo.isActive ? (
                                  <Badge variant="default" className="bg-green-600 shrink-0">Активен</Badge>
                                ) : (
                                  <Badge variant="secondary" className="shrink-0">Неактивен</Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                {promo.discountPercent ? (
                                  <span className={`font-medium ${promo.usedByMe ? 'text-muted-foreground' : 'text-foreground'}`}>-{promo.discountPercent}%</span>
                                ) : null}
                                {promo.discountAmount ? (
                                  <span className={`font-medium ${promo.usedByMe ? 'text-muted-foreground' : 'text-foreground'}`}>-{formatPrice(promo.discountAmount)}</span>
                                ) : null}
                                <span>{getPromoSource(promo.source)}</span>
                                {promo.expiresAt && (
                                  <span>до {formatDate(promo.expiresAt)}</span>
                                )}
                              </div>
                            </div>
                            {!promo.usedByMe && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={(e) => { e.stopPropagation(); copyCode(promo.code); }}
                                className="shrink-0"
                                data-testid={`button-copy-promo-${promo.code}`}
                              >
                                {copiedCode === promo.code ? (
                                  <Check className="w-4 h-4 text-green-500" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )}

            {/* Price Drop Subscriptions */}
            <Card className="p-5">
              <div
                className="flex items-center gap-2 cursor-pointer select-none"
                onClick={() => setPriceDropExpanded(!priceDropExpanded)}
                data-testid="button-toggle-price-drop"
              >
                <TrendingUp className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">Слежу за ценой</span>
                {priceDropData?.subscriptions && priceDropData.subscriptions.length > 0 && (
                  <Badge variant="secondary" className="text-xs">{priceDropData.subscriptions.length}</Badge>
                )}
                <div className="ml-auto">
                  {priceDropExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </div>
              {priceDropExpanded && (
                <div className="mt-4">
                  {!priceDropData ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Загрузка...
                    </div>
                  ) : priceDropData.subscriptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Вы не следите ни за одним товаром. На странице товара нажмите «Уведомить о снижении цены».</p>
                  ) : (
                    <div className="space-y-2">
                      {priceDropData.subscriptions.map((sub) => (
                        <div
                          key={sub.id}
                          className="border rounded-md p-3 flex items-center justify-between gap-2"
                          data-testid={`card-price-drop-${sub.id}`}
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-sm text-foreground truncate" data-testid={`text-price-drop-name-${sub.id}`}>
                              {sub.productName || `Товар #${sub.productId}`}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Цена при подписке: <span className="font-medium text-foreground">{formatPrice(sub.priceAtSubscription)}</span>
                            </div>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => { e.stopPropagation(); deletePriceDropMutation.mutate({ productId: sub.productId }); }}
                            disabled={deletePriceDropMutation.isPending}
                            className="shrink-0"
                            data-testid={`button-delete-price-drop-${sub.id}`}
                          >
                            {deletePriceDropMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <X className="w-4 h-4 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Stock Notifications */}
            <Card className="p-5">
              <div
                className="flex items-center gap-2 cursor-pointer select-none"
                onClick={() => setStockNotifyExpanded(!stockNotifyExpanded)}
                data-testid="button-toggle-stock-notify"
              >
                <Ruler className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">Жду размер</span>
                {stockNotifyData?.subscriptions && stockNotifyData.subscriptions.length > 0 && (
                  <Badge variant="secondary" className="text-xs">{stockNotifyData.subscriptions.length}</Badge>
                )}
                <div className="ml-auto">
                  {stockNotifyExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </div>
              {stockNotifyExpanded && (
                <div className="mt-4">
                  {!stockNotifyData ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Загрузка...
                    </div>
                  ) : stockNotifyData.subscriptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Вы не ждёте ни одного размера. На странице товара нажмите «Уведомить о появлении размера».</p>
                  ) : (
                    <div className="space-y-2">
                      {stockNotifyData.subscriptions.map((sub) => (
                        <div
                          key={sub.id}
                          className="border rounded-md p-3 flex items-center justify-between gap-2"
                          data-testid={`card-stock-notify-${sub.id}`}
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-sm text-foreground truncate" data-testid={`text-stock-notify-name-${sub.id}`}>
                              {sub.productName || `Товар #${sub.productId}`}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Размер: <span className="font-medium text-foreground">{sub.size}</span>
                            </div>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => { e.stopPropagation(); deleteStockNotifyMutation.mutate({ productId: sub.productId, size: sub.size }); }}
                            disabled={deleteStockNotifyMutation.isPending}
                            className="shrink-0"
                            data-testid={`button-delete-stock-notify-${sub.id}`}
                          >
                            {deleteStockNotifyMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <X className="w-4 h-4 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Order Detail Dialog */}
        <Dialog open={!!selectedOrder} onOpenChange={(open) => { if (!open) { setSelectedOrder(null); setDeleteConfirmId(null); } }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            {selectedOrder && (() => {
              const cdek = parseCdekData(selectedOrder);
              const trackNumber = cdek?.cdekNumber;
              const hasCdekOrder = !!(cdek?.orderUuid);
              const ydStatus = cdek?.ydStatus as string | undefined;
              
              const statusSteps = [
                { key: 'pending', label: 'Оформлен' },
                { key: 'paid', label: 'Оплачен' },
                { key: 'processing', label: 'Собирается' },
                { key: 'shipped', label: 'Отправлен' },
                { key: 'ready_for_pickup', label: 'Готов к выдаче' },
                { key: 'delivered', label: 'Доставлен' },
              ];
              
              const isCancelled = selectedOrder.status === 'cancelled';
              const currentStepIndex = isCancelled ? -1 : statusSteps.findIndex(s => s.key === selectedOrder.status);
              
              return (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-3 flex-wrap">
                      <span>Заказ #{selectedOrder.id}</span>
                      {getStatusBadge(selectedOrder.status)}
                    </DialogTitle>
                    <DialogDescription className="flex items-center gap-2 text-xs">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDate(selectedOrder.createdAt)}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4">
                    {/* Status Tracker */}
                    {!isCancelled && (
                      <div className="py-2" data-testid={`tracker-order-${selectedOrder.id}`}>
                        <div className="flex items-center justify-between relative">
                          <div className="absolute top-3 left-0 right-0 h-0.5 bg-muted mx-6" />
                          <div 
                            className="absolute top-3 left-0 h-0.5 bg-primary mx-6 transition-all duration-500" 
                            style={{ width: currentStepIndex >= 0 ? `calc(${(currentStepIndex / (statusSteps.length - 1)) * 100}% - 3rem)` : '0%' }}
                          />
                          {statusSteps.map((step, idx) => {
                            const isCompleted = currentStepIndex >= idx;
                            const isCurrent = currentStepIndex === idx;
                            return (
                              <div key={step.key} className="flex flex-col items-center relative z-10">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-colors ${
                                  isCompleted 
                                    ? 'bg-primary border-primary' 
                                    : 'bg-background border-muted-foreground/30'
                                }`}>
                                  {isCompleted && (
                                    <Check className="w-3 h-3 text-primary-foreground" />
                                  )}
                                </div>
                                <span className={`text-[10px] mt-1.5 text-center leading-tight max-w-[60px] ${
                                  isCurrent ? 'font-semibold text-primary' : isCompleted ? 'text-foreground' : 'text-muted-foreground'
                                }`}>
                                  {step.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {isCancelled && (
                      <div className="flex items-center gap-2 bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
                        <Ban className="w-4 h-4 shrink-0" />
                        <span>Заказ отменён</span>
                      </div>
                    )}

                    {/* CDEK Tracking */}
                    {hasCdekOrder && (
                      <div className="bg-muted/30 rounded-md p-3" data-testid={`cdek-tracking-${selectedOrder.id}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <Truck className="w-4 h-4 text-primary shrink-0" />
                            <span className="text-sm text-foreground">СДЭК{trackNumber ? ':' : ''}</span>
                            {trackNumber && (
                              <span className="font-mono text-sm font-medium text-foreground" data-testid={`text-track-number-${selectedOrder.id}`}>{trackNumber}</span>
                            )}
                            {!trackNumber && (
                              <span className="text-sm text-muted-foreground">Заявка создана</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {trackNumber && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(trackNumber); toast({ title: "Трек-номер скопирован" }); }}
                                  data-testid={`button-copy-track-${selectedOrder.id}`}
                                >
                                  <Copy className="w-3.5 h-3.5 mr-1" />
                                  Копировать
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(e) => { e.stopPropagation(); window.open(`https://www.cdek.ru/ru/tracking?order_id=${trackNumber}`, '_blank'); }}
                                  data-testid={`button-track-cdek-${selectedOrder.id}`}
                                >
                                  <ExternalLink className="w-3.5 h-3.5 mr-1" />
                                  На сайте СДЭК
                                </Button>
                              </>
                            )}
                          </div>
                        </div>

                        {cdek?.cdekStatuses && cdek.cdekStatuses.length > 0 && (
                          <div className="mt-3 border-t pt-3" data-testid={`cdek-statuses-${selectedOrder.id}`}>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                                Путь посылки
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => { e.stopPropagation(); refreshTrackingMutation.mutate(selectedOrder.id); }}
                                disabled={refreshTrackingMutation.isPending}
                                data-testid={`button-refresh-tracking-${selectedOrder.id}`}
                              >
                                {refreshTrackingMutation.isPending ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                                ) : (
                                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                                )}
                                Обновить
                              </Button>
                            </div>
                            <div className="space-y-0">
                              {cdek.cdekStatuses.map((status, idx) => (
                                <div key={idx} className="flex gap-2.5 relative" data-testid={`cdek-status-${selectedOrder.id}-${idx}`}>
                                  <div className="flex flex-col items-center">
                                    <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${idx === 0 ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                                    {idx < cdek.cdekStatuses!.length - 1 && (
                                      <div className="w-px flex-1 bg-muted mt-0.5" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0 pb-2.5">
                                    <p className={`text-xs leading-tight ${idx === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                                      {status.name}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0 mt-0.5">
                                      {status.date && (
                                        <span className="text-[10px] text-muted-foreground">
                                          {new Date(status.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                      )}
                                      {status.city && (
                                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                          <MapPin className="w-2.5 h-2.5" />
                                          {status.city}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {(!cdek?.cdekStatuses || cdek.cdekStatuses.length === 0) && (
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">
                              {cdek?.lastCdekStatusName || 'Статус обновляется...'}
                              {cdek?.lastCdekStatusDate && (
                                <span> — {new Date(cdek.lastCdekStatusDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                              )}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => { e.stopPropagation(); refreshTrackingMutation.mutate(selectedOrder.id); }}
                              disabled={refreshTrackingMutation.isPending}
                              data-testid={`button-refresh-tracking-empty-${selectedOrder.id}`}
                            >
                              {refreshTrackingMutation.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                              )}
                              Обновить
                            </Button>
                          </div>
                        )}
                      </div>
                    )}


                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                        <Package className="w-4 h-4 text-muted-foreground" />
                        Товары ({selectedOrder.items.filter((i: any) => !i._discountDetails).length})
                      </h4>
                      <div className="space-y-0 border rounded-md overflow-hidden">
                        {selectedOrder.items.filter((i: any) => !i._discountDetails).map((item, idx) => {
                          const itemName = item.productName || item.name || `Товар #${item.productId}`;
                          return (
                            <div key={idx} className="flex items-start gap-3 px-3 py-2.5 border-b last:border-b-0" data-testid={`text-order-item-${selectedOrder.id}-${idx}`}>
                              {item.imageUrl && (
                                <div className="w-12 h-12 rounded-md border bg-muted overflow-hidden shrink-0">
                                  <img src={item.imageUrl} alt={itemName} className="w-full h-full object-cover" loading="lazy" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-foreground" data-testid={`text-order-item-name-${selectedOrder.id}-${idx}`}>
                                  {itemName}
                                </p>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                                  {item.sku && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Hash className="w-3 h-3" />
                                      {item.sku}
                                    </span>
                                  )}
                                  {item.size && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Ruler className="w-3 h-3" />
                                      {item.size}
                                    </span>
                                  )}
                                  {item.color && item.color !== 'Default' && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Palette className="w-3 h-3" />
                                      {item.color}
                                    </span>
                                  )}
                                  {item.quantity > 1 && (
                                    <span className="text-xs text-muted-foreground">
                                      x{item.quantity}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="text-sm font-medium text-foreground">{formatPrice(item.price * item.quantity)}</span>
                                {item.quantity > 1 && (
                                  <p className="text-xs text-muted-foreground">{formatPrice(item.price)} / шт.</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {(selectedOrder.address || selectedOrder.customerPhone || selectedOrder.customerName || selectedOrder.customerEmail || selectedOrder.transportCompany) && (
                      <div>
                        <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                          <Truck className="w-4 h-4 text-muted-foreground" />
                          Доставка и контакты
                        </h4>
                        <div className="bg-muted/30 rounded-md p-3 space-y-2">
                          {selectedOrder.customerName && (
                            <div className="flex items-center gap-2 text-sm">
                              <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="text-foreground" data-testid={`text-order-name-${selectedOrder.id}`}>{selectedOrder.customerName}</span>
                            </div>
                          )}
                          {selectedOrder.customerEmail && (
                            <div className="flex items-center gap-2 text-sm">
                              <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="text-muted-foreground" data-testid={`text-order-email-${selectedOrder.id}`}>{selectedOrder.customerEmail}</span>
                            </div>
                          )}
                          {selectedOrder.customerPhone && (
                            <div className="flex items-center gap-2 text-sm">
                              <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="text-muted-foreground" data-testid={`text-order-phone-${selectedOrder.id}`}>{selectedOrder.customerPhone}</span>
                            </div>
                          )}
                          {selectedOrder.address && (
                            <div className="flex items-start gap-2 text-sm">
                              <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                              <span className="text-muted-foreground" data-testid={`text-order-address-${selectedOrder.id}`}>{selectedOrder.address}</span>
                            </div>
                          )}
                          {selectedOrder.transportCompany && (
                            <div className="flex items-center gap-2 text-sm">
                              <Truck className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="text-muted-foreground" data-testid={`text-order-transport-${selectedOrder.id}`}>{transportCompanyName(selectedOrder.transportCompany)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {selectedOrder.paymentId && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>ID платежа: {selectedOrder.paymentId}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap justify-between items-center pt-3 border-t gap-2">
                      {deleteConfirmId === selectedOrder.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Скрыть заказ из списка?</span>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => { hideOrder(selectedOrder.id); setDeleteConfirmId(null); setSelectedOrder(null); }}
                            data-testid={`button-confirm-delete-order-${selectedOrder.id}`}
                          >
                            Да
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleteConfirmId(null)}
                            data-testid={`button-cancel-delete-order-${selectedOrder.id}`}
                          >
                            Нет
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setDeleteConfirmId(selectedOrder.id)}
                            className="text-muted-foreground"
                            data-testid={`button-delete-order-${selectedOrder.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            Скрыть
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openRepeatDialog(selectedOrder)}
                            data-testid={`button-repeat-order-${selectedOrder.id}`}
                          >
                            <RefreshCw className="w-3.5 h-3.5 mr-1" />
                            Повторить
                          </Button>
                          {canCancelOrder(selectedOrder.status) && !(selectedOrder as any).isPreorder && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => cancelOrderMutation.mutate(selectedOrder.id)}
                              disabled={cancelOrderMutation.isPending}
                              data-testid={`button-cancel-order-${selectedOrder.id}`}
                            >
                              {cancelOrderMutation.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                              ) : (
                                <X className="w-3.5 h-3.5 mr-1" />
                              )}
                              Отменить
                            </Button>
                          )}
                        </div>
                      )}
                      <span className="font-semibold text-foreground" data-testid={`text-order-total-${selectedOrder.id}`}>
                        Итого: {formatPrice(selectedOrder.total)}
                      </span>
                    </div>

                    {(() => {
                      try {
                        const addon = (selectedOrder as any).addonData
                          ? JSON.parse((selectedOrder as any).addonData)
                          : null;
                        if (!addon) return null;
                        return (
                          <div className="mt-3 border-t pt-3" data-testid={`addon-info-${selectedOrder.id}`}>
                            <div className="flex items-center gap-1.5 mb-2">
                              <Plus className="w-3.5 h-3.5 text-primary" />
                              <span className="text-xs font-medium text-foreground">
                                Дозаказ
                                {addon.status === 'paid' && <span className="ml-1.5 text-green-600">• Оплачен</span>}
                                {addon.status === 'awaiting_payment' && <span className="ml-1.5 text-yellow-600">• Ожидает оплаты</span>}
                                {addon.status === 'expired' && <span className="ml-1.5 text-muted-foreground">• Истёк</span>}
                              </span>
                            </div>
                            <div className="space-y-1 pl-5">
                              {(addon.items || []).map((it: any, idx: number) => (
                                <div key={idx} className="flex justify-between text-xs text-muted-foreground" data-testid={`addon-item-${selectedOrder.id}-${idx}`}>
                                  <span>
                                    {it.productName}
                                    {it.size && <span className="ml-1 text-[10px]">{it.size}</span>}
                                    {it.color && <span className="ml-1 text-[10px]">{it.color}</span>}
                                    {' '}×{it.quantity}
                                  </span>
                                  <span>{formatPrice(it.price * it.quantity)}</span>
                                </div>
                              ))}
                              {addon.addedTotal > 0 && (
                                <div className="flex justify-between text-xs font-medium text-foreground pt-1 border-t">
                                  <span>Итого дозаказ:</span>
                                  <span>{formatPrice(addon.addedTotal)}</span>
                                </div>
                              )}
                              {addon.paidAt && (
                                <p className="text-[10px] text-muted-foreground">
                                  {new Date(addon.paidAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      } catch { return null; }
                    })()}
                  </div>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>

        {addonOrderId && (
          <AddonOrderDialog
            orderId={addonOrderId}
            open={!!addonOrderId}
            onClose={() => setAddonOrderId(null)}
          />
        )}

        <Dialog open={repeatDialogOpen} onOpenChange={setRepeatDialogOpen}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Повторить заказ #{repeatOrderId}</DialogTitle>
              <DialogDescription>
                Выберите товары и количество для повторного заказа
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              {repeatItems.map((item, index) => {
                const itemName = item.productName || item.name || `Товар #${item.productId}`;
                return (
                  <div
                    key={index}
                    className={`border rounded-md p-3 transition-opacity ${!item.included ? 'opacity-50' : ''}`}
                    data-testid={`repeat-item-${index}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{itemName}</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {item.size && item.size !== "One Size" && (
                            <Badge variant="secondary">{item.size}</Badge>
                          )}
                          {item.color && item.color !== "Default" && (
                            <Badge variant="secondary">{item.color}</Badge>
                          )}
                          {item.sku && (
                            <span className="text-xs text-muted-foreground">Арт: {item.sku}</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {formatPrice(item.price)} за шт.
                        </p>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleRepeatItem(index)}
                        data-testid={`button-toggle-repeat-item-${index}`}
                      >
                        {item.included ? (
                          <Trash2 className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <Plus className="w-4 h-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>

                    {item.included && (
                      <div className="flex items-center gap-2 mt-3">
                        <span className="text-sm text-muted-foreground">Кол-во:</span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => updateRepeatItemQuantity(index, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            data-testid={`button-decrease-qty-${index}`}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <Input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => updateRepeatItemQuantity(index, parseInt(e.target.value) || 1)}
                            className="w-16 text-center"
                            data-testid={`input-qty-${index}`}
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => updateRepeatItemQuantity(index, item.quantity + 1)}
                            data-testid={`button-increase-qty-${index}`}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                        <span className="text-sm font-medium text-foreground ml-auto">
                          {formatPrice(item.price * item.quantity)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              {repeatItems.filter(i => i.included).length > 0 && (
                <div className="flex justify-between items-center pt-3 border-t">
                  <span className="text-sm text-muted-foreground">
                    Позиций: {repeatItems.filter(i => i.included).length}
                  </span>
                  <span className="font-semibold text-foreground">
                    Итого: {formatPrice(repeatItems.filter(i => i.included).reduce((sum, item) => sum + item.price * item.quantity, 0))}
                  </span>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setRepeatDialogOpen(false)}
                data-testid="button-cancel-repeat"
              >
                Отмена
              </Button>
              <Button
                onClick={handleRepeatOrder}
                disabled={isAddingToCart || repeatItems.filter(i => i.included).length === 0}
                data-testid="button-confirm-repeat"
              >
                {isAddingToCart ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Добавляем...
                  </>
                ) : (
                  <>
                    <ShoppingBag className="w-4 h-4 mr-2" />
                    В корзину
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Footer />
    </div>
  );
}

function PreorderPayRemainingButton({ orderId, amount }: { orderId: number; amount: number }) {
  const { toast } = useToast();
  const [selectedMethod, setSelectedMethod] = useState<string>("tbank");
  const [showMethods, setShowMethods] = useState(false);
  const [preorderWidgetToken, setPreorderWidgetToken] = useState<string | null>(null);

  const { data: paymentMethodsData } = useQuery<{ methods: { id: string, name: string, description?: string }[], enabled: boolean }>({
    queryKey: ["/api/payment-methods"],
  });
  const paymentMethods = paymentMethodsData?.methods || [];

  const payRemaining = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/preorder/${orderId}/pay-remaining`, {
        paymentMethod: selectedMethod,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.confirmationToken) {
        setPreorderWidgetToken(data.confirmationToken);
      } else if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      }
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось создать платеж", variant: "destructive" });
    },
  });

  const preorderReturnUrl = `${window.location.origin}/order-success/${orderId}`;

  return (
    <div className="space-y-2">
      {preorderWidgetToken && (
        <YooKassaWidget
          confirmationToken={preorderWidgetToken}
          returnUrl={preorderReturnUrl}
          onSuccess={() => {
            setPreorderWidgetToken(null);
            window.location.href = preorderReturnUrl;
          }}
          onFail={() => {
            setPreorderWidgetToken(null);
            toast({ title: "Оплата не прошла", variant: "destructive" });
          }}
          onClose={() => setPreorderWidgetToken(null)}
        />
      )}
      {paymentMethods.length > 1 && !showMethods && (
        <Button
          size="sm"
          onClick={() => setShowMethods(true)}
          data-testid={`button-pay-remaining-${orderId}`}
        >
          Оплатить остаток {(amount / 100).toLocaleString("ru-RU")} &#8381;
        </Button>
      )}
      {paymentMethods.length > 1 && showMethods && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Способ оплаты</p>
          <RadioGroup value={selectedMethod} onValueChange={setSelectedMethod} className="space-y-1.5">
            {paymentMethods.map((method: any) => (
              <div
                key={method.id}
                className={`flex items-center space-x-3 p-2 border rounded-lg hover-elevate cursor-pointer ${selectedMethod === method.id ? "border-primary bg-primary/5" : ""}`}
                onClick={() => setSelectedMethod(method.id)}
                data-testid={`radio-remaining-pay-${method.id}-${orderId}`}
              >
                <RadioGroupItem value={method.id} id={`remaining-pay-${method.id}-${orderId}`} />
                <Label htmlFor={`remaining-pay-${method.id}-${orderId}`} className="flex-1 cursor-pointer flex items-center justify-between">
                  <span className="text-xs font-medium">{method.name}</span>
                  {method.id === "tbank" ? (
                    <Landmark className="w-4 h-4 text-[#FFDD2D]" />
                  ) : (
                    <div className="w-5 h-5 bg-[#8000FF] rounded flex items-center justify-center text-white font-bold text-[7px]">ЮK</div>
                  )}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <Button
            size="sm"
            onClick={() => payRemaining.mutate()}
            disabled={payRemaining.isPending}
            data-testid={`button-confirm-pay-remaining-${orderId}`}
          >
            {payRemaining.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            Оплатить {(amount / 100).toLocaleString("ru-RU")} &#8381;
          </Button>
        </div>
      )}
      {paymentMethods.length <= 1 && (
        <Button
          size="sm"
          onClick={() => payRemaining.mutate()}
          disabled={payRemaining.isPending}
          data-testid={`button-pay-remaining-${orderId}`}
        >
          {payRemaining.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          Оплатить остаток {(amount / 100).toLocaleString("ru-RU")} &#8381;
        </Button>
      )}
    </div>
  );
}
