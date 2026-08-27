import { useQuery, useMutation } from "@tanstack/react-query";
import { transportCompanyName } from "@shared/transport-companies";
import { BrandLoader } from "@/components/BrandLoader";
import { useLocation } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAuth, useLogout } from "@/hooks/use-auth";
import SEO from "@/components/SEO";
import { makeVariant } from "@/lib/ecommerce";
import { useAddToCart } from "@/hooks/use-cart";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Loader2, Building2, User, Mail, Phone, MapPin,
  FileText, Package, ShoppingBag, LogOut, CheckCircle, Check,
  Clock, AlertCircle, ChevronRight, Trash2,
  RefreshCw, Minus, Plus, Calendar, Hash, Ruler, Palette, Truck, CreditCard, MessageCircle, ExternalLink,
  Settings, Lock, Home, X, Download
} from "lucide-react";
import { SiVk, SiTelegram } from "react-icons/si";
import { PasswordInput } from "@/components/ui/password-input";
import { FeedTab } from "@/pages/wholesale/FeedTab";

interface OrderItem {
  productId: number;
  name?: string;
  productName?: string;
  quantity: number;
  price: number;
  size?: string;
  color?: string;
  sku?: string;
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
  paymentId?: string;
  invoiceNumber?: number;
  isWholesale?: boolean;
  isPreorder?: boolean;
  preorderPaymentId?: string;
  items: OrderItem[];
}

export default function WholesaleProfile() {
  const { data: authData, isLoading: authLoading } = useAuth();
  const logout = useLogout();
  const [, setLocation] = useLocation();

  const addToCart = useAddToCart();
  const { toast } = useToast();

  const [hiddenOrders, setHiddenOrders] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'feed' | 'settings'>('overview');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [repeatDialogOpen, setRepeatDialogOpen] = useState(false);
  const [repeatItems, setRepeatItems] = useState<Array<OrderItem & { included: boolean }>>([]);
  const [repeatOrderId, setRepeatOrderId] = useState<number | null>(null);
  const [isAddingToCart, setIsAddingToCart] = useState(false);

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

  const { data: ordersData, isLoading: ordersLoading } = useQuery<{ orders: Order[] }>({
    queryKey: ["/api/auth/orders"],
    enabled: !!authData?.user,
  });

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
      toast({ title: "Данные обновлены" });
    },
    onError: () => {
      toast({ title: "Не удалось обновить данные", description: "Попробуйте ещё раз позже", variant: "destructive" });
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
  }, [authData?.user?.id]);

  useEffect(() => {
    if (authData?.user) {
      setProfileName(authData.user.contactPerson || authData.user.name || '');
      setProfilePhone((authData.user as any).phone || authData.user.contactPhone || '');
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Ожидает</Badge>;
      case 'confirmed':
        return <Badge variant="default" className="bg-blue-600">Подтверждён</Badge>;
      case 'paid':
        return <Badge variant="default" className="bg-green-600">Оплачен</Badge>;
      case 'processing':
        return <Badge variant="default">В обработке</Badge>;
      case 'awaiting_payment':
        return <Badge variant="secondary">Ожидает оплаты</Badge>;
      case 'awaiting_confirmation':
        return <Badge variant="secondary">Ожидает подтверждения</Badge>;
      case 'shipped':
        return <Badge variant="default">Отправлен</Badge>;
      case 'delivered':
        return <Badge variant="outline" className="border-green-500 text-green-600">Доставлен</Badge>;
      case 'cancelled':
      case 'canceled':
        return <Badge variant="destructive">Отменён</Badge>;
      case 'refunded':
        return <Badge variant="outline" className="border-orange-500 text-orange-600">Возврат</Badge>;
      case 'completed':
        return <Badge variant="outline" className="border-green-500 text-green-600">Завершён</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const hideOrder = (orderId: number) => {
    const newHidden = [...hiddenOrders, orderId];
    setHiddenOrders(newHidden);
    localStorage.setItem(`hiddenOrders_${authData?.user?.id}`, JSON.stringify(newHidden));
  };

  const visibleOrders = (ordersData?.orders || []).filter(o => !hiddenOrders.includes(o.id));

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
        setLocation("/wholesale/register");
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
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-32 pb-24 max-w-md mx-auto px-4 text-center">
          <Card className="p-8">
            <Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h1 className="text-xl font-semibold mb-2">Войдите в аккаунт</h1>
            <p className="text-muted-foreground mb-6">
              Для доступа к оптовому кабинету необходимо авторизоваться
            </p>
            <Button onClick={() => setLocation("/")} data-testid="button-go-home">
              На главную
            </Button>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  const user = authData.user;
  const isWholesale = user.role === 'wholesale';

  if (!isWholesale) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-32 pb-24 max-w-md mx-auto px-4 text-center">
          <Card className="p-8">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h1 className="text-xl font-semibold mb-2">Доступ ограничен</h1>
            <p className="text-muted-foreground mb-6">
              Этот раздел доступен только для оптовых покупателей.
            </p>
            <div className="space-y-3">
              <Button onClick={() => setLocation("/wholesale/register")} className="w-full" data-testid="button-register-wholesale">
                Подать заявку на опт
              </Button>
              <Button variant="outline" onClick={() => setLocation("/profile")} className="w-full" data-testid="button-go-profile">
                Мой кабинет
              </Button>
            </div>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Оптовый кабинет" noindex={true} />
      <Navbar />

      <div className="pt-28 pb-24 max-w-2xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Building2 className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground" data-testid="text-company-name">
                {user.companyName || user.name || "Компания"}
              </h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{user.email}</span>
                {user.wholesaleApproved && (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                )}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Выйти
          </Button>
        </div>

        <div className="flex items-center gap-2 mb-6 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide [&>button]:shrink-0">
          <Button
            variant={activeTab === 'overview' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('overview')}
            data-testid="button-tab-overview"
          >
            Обзор
          </Button>
          <Button
            variant={activeTab === 'orders' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('orders')}
            className="gap-2"
            data-testid="button-tab-orders"
          >
            Заказы
            {visibleOrders.length > 0 && (
              <Badge variant={activeTab === 'orders' ? 'secondary' : 'default'} className="ml-0.5">
                {visibleOrders.length}
              </Badge>
            )}
          </Button>
          <Button
            variant={activeTab === 'feed' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('feed')}
            className="gap-2"
            data-testid="button-tab-feed"
          >
            <Download className="w-4 h-4" />
            Фид для сайта
          </Button>
          <Button
            variant={activeTab === 'settings' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('settings')}
            data-testid="button-tab-settings"
          >
            <Settings className="w-4 h-4 mr-1" />
            Настройки
          </Button>
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-4">
            {user.wholesaleApproved ? (
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-950/50 flex items-center justify-center shrink-0">
                    <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Оптовый доступ активен</p>
                    <p className="text-sm text-muted-foreground">Вам доступны специальные оптовые цены</p>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center shrink-0">
                    <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Заявка на рассмотрении</p>
                    <p className="text-sm text-muted-foreground">Менеджер свяжется с вами в ближайшее время</p>
                  </div>
                </div>
              </Card>
            )}

            <Card className="p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Данные компании</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Building2 className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Компания</p>
                    <p className="text-sm text-foreground">{user.companyName || "—"}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex gap-6">
                    <div>
                      <p className="text-xs text-muted-foreground">ИНН</p>
                      <p className="text-sm text-foreground" data-testid="text-inn">{user.inn || "—"}</p>
                    </div>
                    {user.kpp && (
                      <div>
                        <p className="text-xs text-muted-foreground">КПП</p>
                        <p className="text-sm text-foreground">{user.kpp}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <User className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Контактное лицо</p>
                    <p className="text-sm text-foreground">{user.contactPerson || user.name || "—"}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="text-sm text-foreground">{user.email}</p>
                  </div>
                </div>

                {user.contactPhone && (
                  <div className="flex items-start gap-3">
                    <Phone className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Телефон</p>
                      <p className="text-sm text-foreground">{user.contactPhone}</p>
                    </div>
                  </div>
                )}

                {user.legalAddress && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Юридический адрес</p>
                      <p className="text-sm text-foreground">{user.legalAddress}</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Ваши менеджеры</h3>
              <div className="grid grid-cols-1 gap-4">
                <div className="flex flex-col gap-3 p-4 rounded-md bg-muted/50">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <p className="font-medium text-foreground">Михаил</p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <a href="tel:+79051162902" className="flex items-center gap-2 text-foreground transition-colors" data-testid="link-manager-mikhail-phone">
                      <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>+7 905-116-29-02</span>
                    </a>
                    <a href="mailto:m.pimashin@booomerangs.ru" className="flex items-center gap-2 text-foreground transition-colors" data-testid="link-manager-mikhail-email">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>m.pimashin@booomerangs.ru</span>
                    </a>
                    <a href="https://vk.com/booomerangs_opt" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-foreground transition-colors" data-testid="link-manager-mikhail-vk">
                      <SiVk className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>VK</span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </a>
                    <a href="https://t.me/BOOOMERANGSOPT" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-foreground transition-colors" data-testid="link-manager-mikhail-tg">
                      <SiTelegram className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>Telegram</span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </a>
                  </div>
                </div>
              </div>
            </Card>

            {visibleOrders.length > 0 && (
              <Card
                className="p-4 cursor-pointer hover-elevate"
                onClick={() => setActiveTab('orders')}
                data-testid="card-go-to-orders"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Package className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-foreground">Мои заказы</p>
                      <p className="text-sm text-muted-foreground">{visibleOrders.length} заказ(ов)</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </div>
              </Card>
            )}
          </div>
        )}

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
                <Button onClick={() => setLocation("/products")} data-testid="button-go-catalog">
                  Перейти в каталог
                </Button>
              </Card>
            ) : (
              <div className="space-y-2">
                {visibleOrders.map((order) => {
                  const hasFinalInvoice = order.isPreorder && order.preorderPaymentId?.startsWith("final:");
                  const finalInvoiceNum = hasFinalInvoice ? order.preorderPaymentId!.replace("final:", "") : null;
                  return (
                    <Card
                      key={order.id}
                      className="overflow-hidden"
                      data-testid={`card-order-${order.id}`}
                    >
                      <div
                        className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => setSelectedOrder(order)}
                      >
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-semibold text-sm text-foreground" data-testid={`text-order-id-${order.id}`}>
                            #{order.id}
                          </span>
                          {order.isPreorder && (
                            <span className="text-xs px-2 py-0.5 rounded-full border font-medium text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-950/40 dark:border-violet-800">
                              Предзаказ
                            </span>
                          )}
                          {getStatusBadge(order.status)}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-sm text-foreground">{formatPrice(order.total)}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>

                      {/* Плашка финального счёта */}
                      {hasFinalInvoice && (
                        <div className="border-t border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                              Выставлен финальный счёт на оплату остатка 50%
                            </p>
                            <p className="text-xs text-amber-700 dark:text-amber-400">
                              Счёт №{finalInvoiceNum} — проверьте почту или скачайте ниже
                            </p>
                          </div>
                          <a
                            href={`/api/auth/orders/${order.id}/final-invoice-pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors"
                            data-testid={`button-download-final-invoice-${order.id}`}
                          >
                            <Download className="w-3.5 h-3.5" />
                            Скачать счёт
                          </a>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'feed' && (
          <FeedTab />
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">Контактные данные</span>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Контактное лицо</label>
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
                {user.companyName && (
                  <div>
                    <label className="text-sm text-muted-foreground mb-1.5 block">Компания</label>
                    <Input value={user.companyName} disabled className="opacity-60" data-testid="input-company-name" />
                    <p className="text-xs text-muted-foreground mt-1">Для смены реквизитов обратитесь к менеджеру</p>
                  </div>
                )}
                <Button
                  onClick={() => updateProfileMutation.mutate({ name: profileName, phone: profilePhone })}
                  disabled={updateProfileMutation.isPending || (profileName === (user.contactPerson || user.name || '') && profilePhone === ((user as any).phone || user.contactPhone || ''))}
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
                      placeholder="Склад, Офис, и т.д."
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
                        const fullAddress = [
                          addressStreet.trim(),
                          addressHouse.trim() ? `д. ${addressHouse.trim()}` : '',
                          addressApartment.trim() ? `оф. ${addressApartment.trim()}` : '',
                        ].filter(Boolean).join(', ');
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
                            a.id === editingAddressId ? { ...a, ...addrData } : a
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
                          <p className="text-sm text-foreground">
                            {[addr.lastName, addr.firstName, addr.patronymic].filter(Boolean).join(' ')}
                          </p>
                        )}
                        {addr.phone && (
                          <p className="text-xs text-muted-foreground">{addr.phone}</p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {addr.city}{addr.postalCode ? `, ${addr.postalCode}` : ''}
                        </p>
                        <p className="text-sm text-foreground">{addr.address}</p>
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

        {/* Order Detail Dialog */}
        <Dialog open={!!selectedOrder} onOpenChange={(open) => { if (!open) { setSelectedOrder(null); setDeleteConfirmId(null); } }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            {selectedOrder && (
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
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      Товары ({selectedOrder.items.filter((i: any) => !i._discountDetails).length})
                    </h4>
                    <div className="space-y-0 border rounded-md overflow-hidden">
                      {selectedOrder.items.filter((i: any) => !i._discountDetails).map((item, idx) => {
                        const itemName = item.productName || item.name || `Товар #${item.productId}`;
                        return (
                          <div key={idx} className="flex items-start justify-between gap-3 px-3 py-2.5 border-b last:border-b-0" data-testid={`text-order-item-${selectedOrder.id}-${idx}`}>
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

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      Документы по заказу
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`/api/auth/orders/${selectedOrder.id}/invoice`}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`button-download-invoice-${selectedOrder.id}`}
                      >
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <Download className="w-3.5 h-3.5" />
                          Счёт
                        </Button>
                      </a>
                      <a
                        href={`/api/auth/orders/${selectedOrder.id}/upd`}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`button-download-upd-${selectedOrder.id}`}
                      >
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <Download className="w-3.5 h-3.5" />
                          УПД
                        </Button>
                      </a>
                      <a
                        href={`/api/auth/orders/${selectedOrder.id}/torg12`}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`button-download-torg12-${selectedOrder.id}`}
                      >
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <Download className="w-3.5 h-3.5" />
                          ТОРГ-12
                        </Button>
                      </a>
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-between items-center pt-3 border-t gap-2">
                    <div className="flex items-center gap-2">
                      {deleteConfirmId === selectedOrder.id ? (
                        <>
                          <span className="text-xs text-muted-foreground">Скрыть?</span>
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
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>
                    <span className="font-semibold text-foreground" data-testid={`text-order-total-${selectedOrder.id}`}>
                      Итого: {formatPrice(selectedOrder.total)}
                    </span>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Repeat Order Dialog */}
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
