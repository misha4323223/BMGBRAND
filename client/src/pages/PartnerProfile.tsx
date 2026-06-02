import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import SEO from "@/components/SEO";
import {
  Loader2, Handshake, LogOut, Copy, Download, ExternalLink,
  TrendingUp, Eye, ShoppingBag, Wallet, Settings as SettingsIcon, Link as LinkIcon,
  CheckCircle, Clock, XCircle, BadgeDollarSign, Package, Code2, HelpCircle,
  ChevronDown, ChevronRight, Tag, Trash2, Music2, Landmark, Info, Save, MessageSquare, Send,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PartnerProductsTab } from "./partner/ProductsTab";
import { WidgetTab } from "./partner/WidgetTab";
import { ArtistTab } from "./partner/ArtistTab";

type TabKey = "overview" | "link" | "products" | "widget" | "commissions" | "payouts" | "refstats" | "settings";

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="shrink-0 text-muted-foreground/60 hover:text-muted-foreground transition-colors" tabIndex={-1}>
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-xs leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface PartnerData {
  partner: {
    id: number;
    partnerSlug: string;
    storeName: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
    status: string;
    legalStatus: string | null;
    commissionOverride: number | null;
    totalEarned: number;
    payoutRequested: boolean;
    createdAt: string | null;
    isArtist?: boolean;
    artistRate?: number | null;
    bankBik?: string | null;
    bankAccount?: string | null;
    bankName?: string | null;
    bankCorrAccount?: string | null;
  };
  globalCommissionPercent: number;
  effectiveCommissionPercent: number;
  progressiveInfo?: {
    monthlyTotal: number;
    currentRate: number;
    nextTierAt: number | null;
    nextTierRate: number | null;
  } | null;
  refUrl: string;
}

interface StatsData {
  clicks: number;
  ordersCount: number;
  ordersTotal: number;
  awaitingPaymentAmount: number;
  holdAmount: number;
  pendingAmount: number;
  confirmedAmount: number;
  paidAmount: number;
  readyToConfirmAmount: number;
}

interface CommissionOrderItem {
  name: string;
  qty: number;
  price: number;
}

interface Commission {
  id: number;
  orderId: number;
  partnerId: number;
  orderItemsTotal: number;
  commissionPercent: number;
  commissionAmount: number;
  status: "pending" | "confirmed" | "cancelled" | "paid";
  holdUntil: string | null;
  createdAt: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  commissionType?: "artist" | "referral" | null;
  orderItems?: CommissionOrderItem[];
}

interface Payout {
  id: number;
  amount: number;
  commissionCount: number;
  method: string;
  recipientName: string;
  note: string | null;
  createdAt: string | null;
  status: "awaiting_invoice" | "invoice_uploaded" | "paid_pending_receipt" | "paid_pending_act" | "completed" | "rejected";
  invoiceUrl: string | null;
  invoiceUploadedAt: string | null;
  invoiceNumber: string | null;
  paidAt: string | null;
  paidReference: string | null;
  receiptUrl: string | null;
  receiptUploadedAt: string | null;
  receiptNumber: string | null;
  actUrl: string | null;
  actUploadedAt: string | null;
  actNumber: string | null;
  completedAt: string | null;
  rejectedReason: string | null;
}

const PAYOUT_STATUS_LABELS: Record<Payout["status"], { label: string; cls: string }> = {
  awaiting_invoice: { label: "Ожидает счёт", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
  invoice_uploaded: { label: "Счёт загружен — ждём оплаты", cls: "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200" },
  paid_pending_receipt: { label: "Оплачено — пришлите чек НПД", cls: "bg-purple-100 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200" },
  paid_pending_act: { label: "Оплачено — пришлите акт", cls: "bg-purple-100 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200" },
  completed: { label: "Завершено", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" },
  rejected: { label: "Отклонено", cls: "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200" },
};

const PAYOUT_MIN_KOPEKS = 0; // без минимальной суммы

const PAYOUT_METHOD_LABELS: Record<string, string> = {
  bank_card: "Банковская карта",
  sbp: "СБП",
  bank_account: "Расчётный счёт",
  yoomoney: "ЮMoney",
  other: "Иное",
};

function fmtRub(kopeks: number) {
  return (kopeks / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return s;
  }
}
function fmtDateShort(s: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("ru-RU"); } catch { return s; }
}

function commissionBadge(c: Commission): { label: string; cls: string } {
  if (c.status === "paid") return { label: "Выплачено", cls: "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200" };
  if (c.status === "cancelled") return { label: "Отменено", cls: "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200" };
  if (c.status === "confirmed") return { label: "Готово к выплате", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" };
  // pending
  if (!c.holdUntil) return { label: "Ожидает оплаты", cls: "bg-yellow-100 text-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-200" };
  return { label: `На удержании до ${fmtDateShort(c.holdUntil)}`, cls: "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200" };
}

export default function PartnerProfile() {
  const [, setLocation] = useLocation();
  const { data: authData, isLoading: authLoading } = useAuth();
  const logout = useLogout();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"bug" | "wish" | "other">("wish");
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const feedbackMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/partner/feedback", { type: feedbackType, message: feedbackMessage });
      return res;
    },
    onSuccess: () => {
      setFeedbackOpen(false);
      setFeedbackMessage("");
      toast({ title: "Отправлено!", description: "Спасибо — мы получили ваше сообщение." });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось отправить. Попробуйте позже.", variant: "destructive" });
    },
  });

  // Redirect if not logged in or wrong role
  useEffect(() => {
    if (authLoading) return;
    if (!authData?.user) {
      setLocation("/partner/login");
    } else if (authData.user.role !== "partner") {
      setLocation("/");
    }
  }, [authLoading, authData, setLocation]);

  const meQuery = useQuery<PartnerData>({
    queryKey: ["/api/partner/me"],
    enabled: !!authData?.user && authData.user.role === "partner",
  });

  const statsQuery = useQuery<StatsData>({
    queryKey: ["/api/partner/stats"],
    enabled: !!authData?.user && authData.user.role === "partner",
  });

  if (authLoading || !authData?.user || authData.user.role !== "partner") {
    return (
      <>
        <Navbar />
        <main className="container mx-auto px-4 py-16 min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin" />
        </main>
        <Footer />
      </>
    );
  }

  if (meQuery.isLoading) {
    return (
      <>
        <Navbar />
        <main className="container mx-auto px-4 py-16 min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin" />
        </main>
        <Footer />
      </>
    );
  }

  if (meQuery.error || !meQuery.data) {
    return (
      <>
        <Navbar />
        <main className="container mx-auto px-4 py-16 min-h-[60vh]">
          <div className="max-w-md mx-auto">
            <Alert variant="destructive">
              <AlertDescription>Не удалось загрузить данные партнёра. Попробуйте обновить страницу.</AlertDescription>
            </Alert>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const { partner, effectiveCommissionPercent, progressiveInfo } = meQuery.data;
  const refUrl = `${window.location.origin}/r/${partner.partnerSlug}`;
  const stats = statsQuery.data;

  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: "overview", label: "Обзор", icon: TrendingUp },
    { key: "link", label: "Моя ссылка", icon: LinkIcon },
    { key: "products", label: "Мои товары", icon: Package },
    { key: "widget", label: "Виджет", icon: Code2 },
    ...(partner.isArtist ? [{ key: "refstats" as TabKey, label: "Рефералы", icon: Eye }] : []),
    { key: "commissions", label: "Заказы и комиссии", icon: ShoppingBag },
    { key: "payouts", label: "Выплаты", icon: Wallet },
    { key: "settings", label: "Настройки", icon: SettingsIcon },
  ];

  return (
    <>
      <SEO title="Партнёрский кабинет — BMG BRAND" />
      <Navbar />
      <main className="container mx-auto px-4 pt-24 pb-10 min-h-[70vh]">
        {/* Шапка кабинета */}
        <Card className="p-4 sm:p-5 mb-4 sm:mb-5">
          <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <Handshake className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold leading-tight truncate" data-testid="text-partner-name">{partner.storeName}</h1>
                <p className="text-xs sm:text-sm text-muted-foreground truncate">
                  {partner.contactEmail}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setFeedbackOpen(true)} data-testid="button-feedback" className="shrink-0">
              <MessageSquare className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Написать нам</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => logout.mutate()} data-testid="button-logout" className="shrink-0">
              <LogOut className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Выйти</span>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t">
            <Badge variant="secondary" className="text-[11px] font-normal">
              <BadgeDollarSign className="w-3 h-3 mr-1" /> Ваша комиссия {effectiveCommissionPercent}%
            </Badge>
            <Badge variant="outline" className="text-[11px] font-normal">
              {partner.contactName}
            </Badge>
            <Badge variant="outline" className="text-[11px] font-normal font-mono">
              /r/{partner.partnerSlug}
            </Badge>
          </div>
        </Card>

        {/* Табы — горизонтальный скролл на мобильных */}
        <div className="border-b mb-5 -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-px">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  data-testid={`tab-${t.key}`}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition ${
                    active
                      ? "border-primary text-foreground font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === "overview" && <OverviewTab stats={stats} loading={statsQuery.isLoading} isArtist={partner.isArtist} partnerSlug={partner.partnerSlug} artistRate={partner.artistRate} />}
        {activeTab === "refstats" && <RefStatsTab stats={stats} loading={statsQuery.isLoading} />}
        {activeTab === "link" && <LinkTab refUrl={refUrl} slug={partner.partnerSlug} />}
        {activeTab === "products" && <PartnerProductsTab partnerSlug={partner.partnerSlug} />}
        {activeTab === "widget" && <WidgetTab slug={partner.partnerSlug} />}
        {activeTab === "commissions" && <CommissionsTab />}
        {activeTab === "payouts" && (
          <PayoutsTab
            awaiting={stats?.awaitingPaymentAmount ?? 0}
            hold={stats?.holdAmount ?? 0}
            confirmed={stats?.confirmedAmount ?? 0}
            paid={stats?.paidAmount ?? 0}
            payoutRequested={partner.payoutRequested}
            legalStatus={partner.legalStatus ?? null}
            bankBik={partner.bankBik ?? null}
            bankAccount={partner.bankAccount ?? null}
            bankName={partner.bankName ?? null}
            bankCorrAccount={partner.bankCorrAccount ?? null}
          />
        )}
        {activeTab === "settings" && <SettingsTab partner={partner} effectiveCommissionPercent={effectiveCommissionPercent} progressiveInfo={progressiveInfo} />}
      </main>
      <Footer />

      {/* Модал обратной связи */}
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Написать нам
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "wish", label: "💡 Пожелание" },
                { key: "bug", label: "🐛 Ошибка" },
                { key: "other", label: "💬 Другое" },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setFeedbackType(t.key)}
                  className={`rounded-xl border-2 px-3 py-2 text-xs font-medium transition-all ${feedbackType === t.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Textarea
              placeholder="Опишите пожелание или проблему..."
              value={feedbackMessage}
              onChange={(e) => setFeedbackMessage(e.target.value)}
              rows={4}
              className="resize-none"
              data-testid="textarea-feedback"
            />
            <Button
              className="w-full"
              onClick={() => feedbackMutation.mutate()}
              disabled={feedbackMutation.isPending || feedbackMessage.trim().length < 5}
              data-testid="button-feedback-submit"
            >
              {feedbackMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              Отправить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OverviewTab({ stats, loading, isArtist, partnerSlug, artistRate }: { stats?: StatsData; loading: boolean; isArtist?: boolean; partnerSlug?: string; artistRate?: number | null }) {
  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (isArtist && partnerSlug) {
    return <ArtistTab partnerSlug={partnerSlug} artistRate={artistRate} />;
  }
  const cards = [
    { label: "Переходов по ссылке", value: stats.clicks.toLocaleString("ru-RU"), icon: Eye, testid: "stat-clicks", tip: "Уникальные переходы по вашей реферальной ссылке за всё время." },
    { label: "Заказов", value: stats.ordersCount.toLocaleString("ru-RU"), icon: ShoppingBag, testid: "stat-orders", tip: "Оплаченные заказы, оформленные через вашу ссылку в течение 30 дней после перехода." },
    { label: "Оборот по заказам", value: fmtRub(stats.ordersTotal), icon: TrendingUp, testid: "stat-orders-total", tip: "Суммарная стоимость товаров по всем вашим реферальным заказам (без доставки)." },
    { label: "Ожидают оплаты", value: fmtRub(stats.awaitingPaymentAmount), icon: Clock, testid: "stat-awaiting", tip: "Покупатель оформил заказ, но ещё не оплатил. Ваша комиссия начислится после оплаты." },
    { label: "На удержании", value: fmtRub(stats.holdAmount), icon: Clock, testid: "stat-hold", tip: "Заказ оплачен, но ваша комиссия удерживается 14 дней на случай возврата. Потом перейдёт в «Доступно к выплате»." },
    { label: "Доступно к выплате", value: fmtRub(stats.confirmedAmount), icon: CheckCircle, testid: "stat-confirmed", tip: "Ваша подтверждённая комиссия, готовая к выводу. Без минимальной суммы — вывести можно любую доступную сумму." },
    { label: "Выплачено", value: fmtRub(stats.paidAmount), icon: BadgeDollarSign, testid: "stat-paid", tip: "Общая сумма всех завершённых выплат за всё время." },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Card key={c.label} className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-[11px] sm:text-xs text-muted-foreground uppercase tracking-wide leading-tight">{c.label}</p>
                  <InfoTip text={c.tip} />
                </div>
                <p className="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight truncate" data-testid={c.testid}>{c.value}</p>
              </div>
              <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground shrink-0 mt-0.5" />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function RefStatsTab({ stats, loading }: { stats?: StatsData; loading: boolean }) {
  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  const cards = [
    { label: "Переходов по ссылке", value: stats.clicks.toLocaleString("ru-RU"), icon: Eye, testid: "ref-stat-clicks", tip: "Уникальные переходы по вашей реферальной ссылке за всё время." },
    { label: "Заказов", value: stats.ordersCount.toLocaleString("ru-RU"), icon: ShoppingBag, testid: "ref-stat-orders", tip: "Оплаченные заказы, оформленные через вашу ссылку в течение 30 дней после перехода." },
    { label: "Оборот по заказам", value: fmtRub(stats.ordersTotal), icon: TrendingUp, testid: "ref-stat-orders-total", tip: "Суммарная стоимость товаров по всем вашим реферальным заказам (без доставки)." },
    { label: "Ожидают оплаты", value: fmtRub(stats.awaitingPaymentAmount), icon: Clock, testid: "ref-stat-awaiting", tip: "Покупатель оформил заказ, но ещё не оплатил. Ваша комиссия начислится после оплаты." },
    { label: "На удержании", value: fmtRub(stats.holdAmount), icon: Clock, testid: "ref-stat-hold", tip: "Заказ оплачен, но ваша комиссия удерживается 14 дней на случай возврата. Потом перейдёт в «Доступно к выплате»." },
    { label: "Доступно к выплате", value: fmtRub(stats.confirmedAmount), icon: CheckCircle, testid: "ref-stat-confirmed", tip: "Ваша подтверждённая комиссия, готовая к выводу. Без минимальной суммы — вывести можно любую доступную сумму." },
    { label: "Выплачено", value: fmtRub(stats.paidAmount), icon: BadgeDollarSign, testid: "ref-stat-paid", tip: "Общая сумма всех завершённых выплат за всё время." },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Card key={c.label} className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-[11px] sm:text-xs text-muted-foreground uppercase tracking-wide leading-tight">{c.label}</p>
                  <InfoTip text={c.tip} />
                </div>
                <p className="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight truncate" data-testid={c.testid}>{c.value}</p>
              </div>
              <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground shrink-0 mt-0.5" />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function LinkTab({ refUrl, slug }: { refUrl: string; slug: string }) {
  const { toast } = useToast();
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [promoDiscount, setPromoDiscount] = useState(10);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(refUrl, { type: "svg", margin: 2, width: 320 })
      .then((svg) => { if (!cancelled) setQrSvg(svg); })
      .catch(() => { if (!cancelled) setQrSvg(null); });
    return () => { cancelled = true; };
  }, [refUrl]);

  const promoQuery = useQuery<{ promoCode: any | null }>({
    queryKey: ["/api/partner/promo-code"],
    queryFn: () => apiRequest("GET", "/api/partner/promo-code").then((r) => r.json()),
  });

  const activePromo = promoQuery.data?.promoCode;

  useEffect(() => {
    if (activePromo) {
      setPromoCode(activePromo.code || "");
      setPromoDiscount(activePromo.discountPercent ?? 10);
    }
  }, [activePromo]);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/partner/promo-code", { code: promoCode.trim().toUpperCase(), discountPercent: promoDiscount }).then(async (r) => {
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Ошибка"); }
      return r.json();
    }),
    onSuccess: () => {
      toast({ title: "Готово", description: "Промокод сохранён" });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/promo-code"] });
    },
    onError: (e: any) => toast({ title: "Ошибка", description: e?.message || "Не удалось сохранить", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/partner/promo-code").then(async (r) => {
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Ошибка"); }
      return r.json();
    }),
    onSuccess: () => {
      toast({ title: "Удалено", description: "Промокод деактивирован" });
      setPromoCode("");
      setPromoDiscount(10);
      queryClient.invalidateQueries({ queryKey: ["/api/partner/promo-code"] });
    },
    onError: (e: any) => toast({ title: "Ошибка", description: e?.message || "Не удалось удалить", variant: "destructive" }),
  });

  function copy() {
    navigator.clipboard.writeText(refUrl).then(
      () => toast({ title: "Скопировано", description: "Ссылка скопирована в буфер обмена" }),
      () => toast({ title: "Ошибка", description: "Не удалось скопировать", variant: "destructive" }),
    );
  }

  function copyPromo() {
    if (!activePromo?.code) return;
    navigator.clipboard.writeText(activePromo.code).then(
      () => toast({ title: "Скопировано", description: `Промокод ${activePromo.code} скопирован` }),
      () => toast({ title: "Ошибка", description: "Не удалось скопировать", variant: "destructive" }),
    );
  }

  function downloadQR() {
    if (!qrSvg) return;
    const blob = new Blob([qrSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bmgbrand-${slug}-qr.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const codeValid = /^[A-Za-z0-9]{4,16}$/.test(promoCode.trim());

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-5 sm:p-6 space-y-4 lg:col-span-2">
          <div>
            <h2 className="text-base sm:text-lg font-semibold">Ваша партнёрская ссылка</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Делитесь с аудиторией — заказы фиксируются за вами 30 дней (last-click).
            </p>
          </div>
          <div className="flex gap-2">
            <Input value={refUrl} readOnly data-testid="input-ref-url" className="font-mono text-xs sm:text-sm" onFocus={(e) => e.currentTarget.select()} />
            <Button onClick={copy} variant="outline" size="icon" data-testid="button-copy-ref" className="shrink-0">
              <Copy className="w-4 h-4" />
            </Button>
            <Button asChild variant="outline" size="icon" data-testid="button-open-ref" className="shrink-0">
              <a href={refUrl} target="_blank" rel="noopener noreferrer" aria-label="Открыть">
                <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          </div>
          <div className="text-xs text-muted-foreground pt-3 border-t space-y-1.5">
            <p>Идентификатор: <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{slug}</code></p>
            <p>Также работает параметр <code className="px-1.5 py-0.5 rounded bg-muted font-mono">?ref={slug}</code> к любой странице сайта.</p>
          </div>
        </Card>

        <Card className="p-5 sm:p-6 flex flex-col items-center gap-3">
          <h2 className="text-base sm:text-lg font-semibold self-start">QR-код</h2>
          {qrSvg ? (
            <div
              className="w-44 h-44 sm:w-48 sm:h-48 [&>svg]:w-full [&>svg]:h-full"
              data-testid="img-qr-code"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : (
            <div className="w-44 h-44 sm:w-48 sm:h-48 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
          )}
          <Button onClick={downloadQR} disabled={!qrSvg} variant="outline" size="sm" data-testid="button-download-qr" className="w-full">
            <Download className="w-4 h-4 mr-2" /> Скачать SVG
          </Button>
        </Card>
      </div>

      {/* Promo code block */}
      <Card className="p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2">
              <Tag className="w-4 h-4" /> Мой промокод
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Покупатель вводит ваш код — получает скидку, вы получаете комиссию. Один заказ = одна комиссия.
            </p>
          </div>
          {activePromo && (
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 shrink-0">
              Активен
            </Badge>
          )}
        </div>

        {activePromo && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
            <code className="text-lg font-bold tracking-widest">{activePromo.code}</code>
            <Badge variant="outline">−{activePromo.discountPercent}%</Badge>
            <span className="text-xs text-muted-foreground">использований: {activePromo.usedCount ?? 0}</span>
            <Button size="sm" variant="ghost" onClick={copyPromo} className="ml-auto shrink-0" title="Скопировать">
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        {promoQuery.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Загрузка…</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="promo-code-input">
                  Код <span className="text-muted-foreground text-xs font-normal">(4–16 символов, латиница и цифры)</span>
                </Label>
                <Input
                  id="promo-code-input"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  placeholder="Например: MISHKA10"
                  maxLength={16}
                  className="font-mono tracking-wider uppercase"
                  data-testid="input-promo-code"
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Скидка покупателю: <span className="font-semibold">{promoDiscount}%</span>
                </Label>
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-xs text-muted-foreground shrink-0">5%</span>
                  <input
                    type="range"
                    min={5}
                    max={15}
                    step={1}
                    value={promoDiscount}
                    onChange={(e) => setPromoDiscount(Number(e.target.value))}
                    className="w-full h-2 rounded-full accent-primary cursor-pointer"
                    data-testid="slider-promo-discount"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">15%</span>
                </div>
                <p className="text-xs text-muted-foreground">Ваша комиссия начисляется с суммы после скидки</p>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!codeValid || saveMutation.isPending}
                data-testid="btn-save-promo"
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                {activePromo ? "Обновить" : "Активировать"}
              </Button>
              {activePromo && (
                <Button
                  variant="outline"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  data-testid="btn-delete-promo"
                >
                  {deleteMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                  Удалить
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function CommissionsTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const hideCommissionMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/partner/commissions/${id}/hide`, { method: "POST", credentials: "include" });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch {}
      if (!res.ok) throw new Error(data.error || "Ошибка скрытия");
      return data;
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/partner/commissions"] });
      const prev = queryClient.getQueryData<{ commissions: Commission[] }>(["/api/partner/commissions", statusFilter]);
      queryClient.setQueryData(["/api/partner/commissions", statusFilter], (old: any) => ({
        ...old,
        commissions: (old?.commissions ?? []).filter((c: Commission) => c.id !== id),
      }));
      return { prev };
    },
    onSuccess: () => {
      toast({ title: "Скрыто" });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/partner/commissions"] });
        queryClient.invalidateQueries({ queryKey: ["/api/partner/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/partner/artist/stats"] });
      }, 1500);
    },
    onError: (err: any, _id, ctx: any) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/partner/commissions", statusFilter], ctx.prev);
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const query = useQuery<{ commissions: Commission[] }>({
    queryKey: ["/api/partner/commissions", statusFilter],
    queryFn: async () => {
      const url = statusFilter === "all"
        ? "/api/partner/commissions"
        : `/api/partner/commissions?status=${statusFilter}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Не удалось загрузить");
      return res.json();
    },
  });

  const filters: { key: string; label: string }[] = [
    { key: "all", label: "Все" },
    { key: "pending", label: "В ожидании" },
    { key: "confirmed", label: "Доступны к выплате" },
    { key: "paid", label: "Выплачено" },
    { key: "cancelled", label: "Отменено" },
  ];

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap gap-2 mb-4">
        {filters.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={statusFilter === f.key ? "secondary" : "outline"}
            onClick={() => setStatusFilter(f.key)}
            data-testid={`filter-${f.key}`}
          >
            {f.label}
          </Button>
        ))}
      </div>
      {query.isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : !query.data?.commissions?.length ? (
        <p className="text-center text-muted-foreground py-12">Пока нет комиссий</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-3 w-4"></th>
                <th className="py-2 pr-3">Дата</th>
                <th className="py-2 pr-3">Заказ</th>
                <th className="py-2 pr-3">Тип</th>
                <th className="py-2 pr-3 text-right">База</th>
                <th className="py-2 pr-3 text-right">%</th>
                <th className="py-2 pr-3 text-right">Сумма</th>
                <th className="py-2 pr-3">Статус</th>
              </tr>
            </thead>
              {query.data.commissions.map((c) => {
                const s = commissionBadge(c);
                const isExpanded = expandedId === c.id;
                const hasItems = c.orderItems && c.orderItems.length > 0;
                const typeBadge = c.commissionType === 'artist'
                  ? { label: "Мой товар", cls: "bg-violet-100 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200" }
                  : c.commissionType === 'referral'
                  ? { label: "Реферал", cls: "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200" }
                  : null;
                return (
                  <tbody key={c.id}>
                    <tr
                      className={`border-b last:border-0 ${hasItems ? "cursor-pointer hover:bg-muted/40 transition-colors" : ""}`}
                      onClick={() => hasItems && setExpandedId(isExpanded ? null : c.id)}
                      data-testid={`row-commission-${c.id}`}
                    >
                      <td className="py-2 pr-1 text-muted-foreground">
                        {hasItems
                          ? isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5" />
                            : <ChevronRight className="w-3.5 h-3.5" />
                          : null}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                      <td className="py-2 pr-3">#{c.orderId}</td>
                      <td className="py-2 pr-3">
                        {typeBadge
                          ? <Badge className={typeBadge.cls}>{typeBadge.label}</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="py-2 pr-3 text-right">{fmtRub(c.orderItemsTotal)}</td>
                      <td className="py-2 pr-3 text-right">{c.commissionPercent}%</td>
                      <td className="py-2 pr-3 text-right font-semibold">{fmtRub(c.commissionAmount)}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <Badge className={s.cls}>{s.label}</Badge>
                          <button
                            className="text-muted-foreground hover:text-red-600 transition-colors ml-1"
                            title="Скрыть из списка"
                            disabled={hideCommissionMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Скрыть эту запись из вашего списка?")) hideCommissionMutation.mutate(c.id);
                            }}
                            data-testid={`btn-hide-comm-${c.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && hasItems && (
                      <tr className="border-b last:border-0 bg-muted/30">
                        <td colSpan={7} className="py-2 px-4">
                          <ul className="space-y-0.5">
                            {c.orderItems!.map((item, idx) => (
                              <li key={idx} className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{item.name}{item.qty > 1 ? ` × ${item.qty}` : ""}</span>
                                <span className="ml-4 tabular-nums">{((item.price * item.qty) / 100).toLocaleString("ru-RU")} ₽</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
          </table>
        </div>
      )}
    </Card>
  );
}

interface BankSuggestion {
  value: string;
  data: { bic?: string; correspondent_account?: string; name?: { payment?: string; full?: string } };
}

function PayoutsTab({ awaiting, hold, confirmed, paid, payoutRequested, legalStatus, bankBik: initBik, bankAccount: initAccount, bankName: initName, bankCorrAccount: initCorr }: {
  awaiting: number; hold: number; confirmed: number; paid: number;
  payoutRequested: boolean; legalStatus: string | null;
  bankBik: string | null; bankAccount: string | null; bankName: string | null; bankCorrAccount: string | null;
}) {
  const { toast } = useToast();

  // ── Банковские реквизиты (для ИП / ООО) ────────────────────────────────
  const [bik, setBik] = useState(initBik || "");
  const [account, setAccount] = useState(initAccount || "");
  const [bankName, setBankName] = useState(initName || "");
  const [corrAccount, setCorrAccount] = useState(initCorr || "");
  const [bankSuggestions, setBankSuggestions] = useState<BankSuggestion[]>([]);
  const [bankOpen, setBankOpen] = useState(false);
  const bankAbort = useRef<AbortController | null>(null);

  const needsBankDetails = legalStatus === "ip" || legalStatus === "ooo";
  const bankDetailsSaved = !!(initBik && initAccount && initName && initCorr);
  const bankFormFilled = /^\d{9}$/.test(bik) && /^\d{20}$/.test(account) && bankName.length >= 2 && /^\d{20}$/.test(corrAccount);
  const bankDetailsChanged = bik !== (initBik || "") || account !== (initAccount || "") || bankName !== (initName || "") || corrAccount !== (initCorr || "");

  async function lookupBank(query: string) {
    if (!query || query.length < 3) { setBankSuggestions([]); return; }
    bankAbort.current?.abort();
    const ac = new AbortController();
    bankAbort.current = ac;
    try {
      const res = await fetch("/api/dadata/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, count: 7 }),
        signal: ac.signal,
      });
      if (!res.ok) return;
      const data = await res.json();
      setBankSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch {}
  }

  function applyBank(s: BankSuggestion) {
    setBik(s.data.bic || "");
    setBankName(s.data.name?.payment || s.data.name?.full || s.value || "");
    setCorrAccount(s.data.correspondent_account || "");
    setBankOpen(false);
  }

  const saveBankMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/partner/payout-details", {
        bankBik: bik, bankAccount: account, bankName, bankCorrAccount: corrAccount,
      });
      const text = await res.text();
      try { return JSON.parse(text); } catch { throw new Error(text || "Ошибка сохранения"); }
    },
    onSuccess: () => {
      toast({ title: "Реквизиты сохранены" });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me"] });
    },
    onError: (err: any) => {
      let msg = err?.message || "Ошибка";
      try { const m = msg.match(/^\d+:\s*(.*)/); if (m) msg = JSON.parse(m[1]).error || msg; } catch {}
      toast({ title: "Ошибка", description: msg, variant: "destructive" });
    },
  });

  // ── Запрос выплаты ──────────────────────────────────────────────────────
  const bankBlocksRequest = needsBankDetails && !bankDetailsSaved;
  const canRequest = confirmed > 0 && !payoutRequested && !bankBlocksRequest;

  const requestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/partner/payout/request");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Заявка создана", description: data?.message || "Мы свяжемся с вами по email" });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/stats"] });
    },
    onError: (err: any) => {
      let message = err?.message || "Ошибка";
      try {
        const m = message.match(/^\d+:\s*(.*)$/);
        if (m) message = JSON.parse(m[1]).error || message;
      } catch {}
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  const payoutsQuery = useQuery<{ payouts: Payout[] }>({
    queryKey: ["/api/partner/payouts"],
  });
  const payouts = payoutsQuery.data?.payouts || [];

  // Активные выплаты (требующие действия от партнёра или ожидающие админа)
  const activePayouts = payouts.filter((p) => p.status !== "completed" && p.status !== "rejected");
  const archivePayouts = payouts.filter((p) => p.status === "completed" || p.status === "rejected");

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-[11px] sm:text-xs text-muted-foreground uppercase tracking-wide leading-tight">Ожидают оплаты</p>
            <InfoTip text="Покупатель оформил заказ, но ещё не оплатил. Ваша комиссия начислится только после оплаты." />
          </div>
          <p className="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight truncate" data-testid="text-awaiting">{fmtRub(awaiting)}</p>
        </Card>
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-[11px] sm:text-xs text-muted-foreground uppercase tracking-wide leading-tight">На удержании</p>
            <InfoTip text="Заказ оплачен, но мы ждём 14 дней на случай возврата. После этого сумма перейдёт в «Доступно к выплате»." />
          </div>
          <p className="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight truncate" data-testid="text-hold">{fmtRub(hold)}</p>
        </Card>
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-[11px] sm:text-xs text-muted-foreground uppercase tracking-wide leading-tight">Доступно к выплате</p>
            <InfoTip text="Ваша подтверждённая комиссия, готовая к выводу. Без минимальной суммы — выводить можно любую доступную сумму." />
          </div>
          <p className="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight truncate" data-testid="text-confirmed">{fmtRub(confirmed)}</p>
        </Card>
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-[11px] sm:text-xs text-muted-foreground uppercase tracking-wide leading-tight">Уже выплачено</p>
            <InfoTip text="Общая сумма всех завершённых выплат за всё время." />
          </div>
          <p className="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight truncate" data-testid="text-paid">{fmtRub(paid)}</p>
        </Card>
      </div>

      {/* ── Банковские реквизиты (только ИП и ООО) ─────────────────────── */}
      {needsBankDetails && (
        <Card className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Landmark className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold leading-tight">Банковские реквизиты</h2>
              <p className="text-xs text-muted-foreground">Куда переводить комиссию — нужно для получения выплаты</p>
            </div>
            {bankDetailsSaved && !bankDetailsChanged && (
              <Badge className="ml-auto bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-0">Сохранены</Badge>
            )}
          </div>

          <div className="flex items-start gap-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 px-3.5 py-3">
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
              Введите БИК — название банка и корр. счёт заполнятся автоматически.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* БИК */}
            <div className="relative">
              <Label>БИК * (9 цифр)</Label>
              <Input
                value={bik}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 9);
                  setBik(v);
                  if (v.length >= 4) { lookupBank(v); setBankOpen(true); }
                }}
                onFocus={() => bik && setBankOpen(true)}
                onBlur={() => setTimeout(() => setBankOpen(false), 200)}
                inputMode="numeric"
                placeholder="044525225"
                data-testid="input-bank-bik"
                className="font-mono tracking-wide mt-1"
              />
              {bankOpen && bankSuggestions.length > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto bg-popover border rounded-md shadow-lg">
                  {bankSuggestions.map((s, i) => (
                    <button key={i} type="button"
                      className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyBank(s)}
                      data-testid={`dadata-bank-${i}`}
                    >
                      <div className="font-medium">{s.value}</div>
                      <div className="text-xs text-muted-foreground">БИК {s.data.bic}{s.data.correspondent_account ? ` · к/с ${s.data.correspondent_account}` : ""}</div>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">Корр. счёт и название подтянутся автоматически</p>
            </div>

            {/* Корр. счёт */}
            <div>
              <Label>Корреспондентский счёт * (20 цифр)</Label>
              <Input
                value={corrAccount}
                onChange={(e) => setCorrAccount(e.target.value.replace(/\D/g, "").slice(0, 20))}
                inputMode="numeric"
                placeholder="30101810400000000225"
                data-testid="input-bank-corr"
                className="font-mono tracking-wide mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">Заполняется по БИК — при необходимости скорректируйте</p>
            </div>

            {/* Название банка */}
            <div className="relative md:col-span-2">
              <Label>Название банка *</Label>
              <Input
                value={bankName}
                onChange={(e) => { setBankName(e.target.value); lookupBank(e.target.value); setBankOpen(true); }}
                onFocus={() => bankName && setBankOpen(true)}
                onBlur={() => setTimeout(() => setBankOpen(false), 200)}
                placeholder="Сбербанк, Т-Банк, ВТБ..."
                data-testid="input-bank-name"
                className="mt-1"
              />
              {bankOpen && bankSuggestions.length > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto bg-popover border rounded-md shadow-lg">
                  {bankSuggestions.map((s, i) => (
                    <button key={i} type="button"
                      className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyBank(s)}
                      data-testid={`dadata-bank-name-${i}`}
                    >
                      <div className="font-medium">{s.value}</div>
                      <div className="text-xs text-muted-foreground">БИК {s.data.bic}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Расчётный счёт */}
            <div className="md:col-span-2">
              <Label>Расчётный счёт * (20 цифр)</Label>
              <Input
                value={account}
                onChange={(e) => setAccount(e.target.value.replace(/\D/g, "").slice(0, 20))}
                inputMode="numeric"
                placeholder="40802810000000000000"
                data-testid="input-bank-account"
                className="font-mono tracking-wide mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">Начинается на 407 (физ. лицо) или 408 (ИП/самозанятый)</p>
            </div>
          </div>

          <Button
            onClick={() => saveBankMutation.mutate()}
            disabled={!bankFormFilled || saveBankMutation.isPending}
            variant={bankDetailsChanged ? "default" : "outline"}
            data-testid="button-save-bank"
          >
            {saveBankMutation.isPending
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <Save className="w-4 h-4 mr-2" />}
            {bankDetailsSaved ? "Обновить реквизиты" : "Сохранить реквизиты"}
          </Button>
        </Card>
      )}

      <Card className="p-5 sm:p-6 space-y-4">
        <h2 className="text-base sm:text-lg font-semibold">Запрос выплаты</h2>
        {payoutRequested ? (
          <Alert>
            <AlertDescription>
              Заявка в обработке — карточка выплаты уже появится ниже. Обновите страницу, если не видите.
            </AlertDescription>
          </Alert>
        ) : confirmed <= 0 ? (
          <p className="text-sm text-muted-foreground">
            Пока нет подтверждённой комиссии для вывода. После 14-дневного холда сумма станет доступна к выплате.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Вы можете запросить выплату на сумму <span className="font-semibold">{fmtRub(confirmed)}</span>. Минимальной суммы нет — выводить можно любую доступную сумму.
          </p>
        )}

        {/* Предупреждение: нужно заполнить реквизиты */}
        {bankBlocksRequest && confirmed > 0 && (
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 px-3.5 py-3">
            <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
              Перед запросом выплаты заполните и сохраните банковские реквизиты выше.
            </p>
          </div>
        )}

        {/* Инструкция по шагам — показывается всегда когда есть доступная сумма или заявка уже отправлена */}
        {(confirmed > 0 || payoutRequested) && (
          <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Как проходит выплата</p>
            {legalStatus === "self_employed" ? (
              <ol className="text-sm space-y-1.5 list-none">
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">1.</span> Нажмите «Запросить выплату» — менеджер создаст карточку выплаты</li>
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">2.</span> В приложении «Мой налог» сформируйте <strong>счёт</strong> на эту сумму (покупатель — ИП Соболев Д.А.) и загрузите его в карточку</li>
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">3.</span> Мы оплатим счёт и отметим это в системе</li>
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">4.</span> После получения денег сформируйте <strong>чек</strong> в «Мой налог» и загрузите его в карточку</li>
              </ol>
            ) : legalStatus === "ip" ? (
              <ol className="text-sm space-y-1.5 list-none">
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">1.</span> Заполните банковские реквизиты выше и нажмите «Запросить выплату»</li>
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">2.</span> Система автоматически сформирует <strong>счёт на оплату</strong> — он появится в карточке для скачивания</li>
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">3.</span> Мы переведём на расчётный счёт и отметим это в системе</li>
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">4.</span> Загрузите подписанный <strong>акт об оказанных услугах</strong></li>
              </ol>
            ) : legalStatus === "ooo" ? (
              <ol className="text-sm space-y-1.5 list-none">
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">1.</span> Заполните банковские реквизиты выше и нажмите «Запросить выплату»</li>
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">2.</span> Система автоматически сформирует <strong>счёт на оплату</strong> — он появится в карточке для скачивания</li>
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">3.</span> Мы переведём на расчётный счёт и отметим это в системе</li>
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">4.</span> Загрузите <strong>акт</strong> и <strong>счёт-фактуру / УПД</strong></li>
              </ol>
            ) : (
              <ol className="text-sm space-y-1.5 list-none">
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">1.</span> Нажмите «Запросить выплату»</li>
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">2.</span> Загрузите документ на оплату в карточку</li>
                <li className="flex gap-2"><span className="font-semibold text-primary shrink-0">3.</span> После оплаты загрузите закрывающий документ</li>
              </ol>
            )}
          </div>
        )}

        <Button
          onClick={() => requestMutation.mutate()}
          disabled={!canRequest || requestMutation.isPending}
          data-testid="button-request-payout"
        >
          {requestMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wallet className="w-4 h-4 mr-2" />}
          Запросить выплату
        </Button>
      </Card>

      {activePayouts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base sm:text-lg font-semibold">Активные выплаты</h2>
          <div className="space-y-3">
            {activePayouts.map((p) => (
              <PayoutCard key={p.id} payout={p} />
            ))}
          </div>
        </div>
      )}

      <Card className="p-5 sm:p-6 space-y-3">
        <h2 className="text-base sm:text-lg font-semibold">История выплат</h2>
        {payoutsQuery.isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : archivePayouts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Завершённых выплат пока нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-3">Дата</th>
                  <th className="py-2 pr-3">Статус</th>
                  <th className="py-2 pr-3">Способ</th>
                  <th className="py-2 pr-3 text-right">Сумма</th>
                  <th className="py-2 pr-3">Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {archivePayouts.map((p) => {
                  const st = PAYOUT_STATUS_LABELS[p.status] || { label: p.status, cls: "" };
                  return (
                    <tr key={p.id} className="border-b last:border-0" data-testid={`row-payout-${p.id}`}>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(p.createdAt)}</td>
                      <td className="py-2 pr-3"><Badge className={st.cls}>{st.label}</Badge></td>
                      <td className="py-2 pr-3">{PAYOUT_METHOD_LABELS[p.method] || p.method}</td>
                      <td className="py-2 pr-3 text-right font-semibold">{fmtRub(p.amount)}</td>
                      <td className="py-2 pr-3 text-xs max-w-xs break-words">
                        {p.status === "rejected" && p.rejectedReason
                          ? <span className="text-red-700 dark:text-red-300">Причина: {p.rejectedReason}</span>
                          : (p.note || "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function PayoutCard({ payout }: { payout: Payout }) {
  const { toast } = useToast();
  const [docNumber, setDocNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputId = `file-${payout.id}`;
  const isInvoiceStep = payout.status === "awaiting_invoice";
  const isReceiptStep = payout.status === "paid_pending_receipt" && !payout.receiptUrl;
  const isActStep = payout.status === "paid_pending_act" && !payout.actUrl;
  const activeKind: "invoice" | "receipt" | "act" | null =
    isInvoiceStep ? "invoice" : isReceiptStep ? "receipt" : isActStep ? "act" : null;

  const uploadMutation = useMutation({
    mutationFn: async (kind: "invoice" | "receipt" | "act") => {
      if (!file) throw new Error("Выберите файл");
      const fd = new FormData();
      fd.append("file", file);
      const numberField =
        kind === "invoice" ? "invoiceNumber" : kind === "receipt" ? "receiptNumber" : "actNumber";
      if (docNumber.trim()) fd.append(numberField, docNumber.trim());
      const res = await fetch(`/api/partner/payouts/${payout.id}/${kind}`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Ошибка ${res.status}`);
      return data;
    },
    onSuccess: () => {
      toast({ title: "Файл загружен" });
      setFile(null);
      setDocNumber("");
      queryClient.invalidateQueries({ queryKey: ["/api/partner/payouts"] });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err?.message || "Не удалось", variant: "destructive" });
    },
  });

  const st = PAYOUT_STATUS_LABELS[payout.status] || { label: payout.status, cls: "" };

  return (
    <Card className="p-5 space-y-4" data-testid={`card-active-payout-${payout.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-semibold" data-testid={`text-payout-amount-${payout.id}`}>{fmtRub(payout.amount)}</span>
            <Badge className={st.cls} data-testid={`badge-payout-status-${payout.id}`}>{st.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Выплата #{payout.id} · {PAYOUT_METHOD_LABELS[payout.method] || payout.method} · создана {fmtDate(payout.createdAt)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Получатель</p>
          <p>{payout.recipientName}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Комиссий в выплате</p>
          <p>{payout.commissionCount}</p>
        </div>
      </div>

      {/* История прикреплённых документов */}
      {payout.invoiceUrl && (
        <div className="text-sm border-t pt-3">
          <p className="text-muted-foreground text-xs mb-1">
            {payout.invoiceNumber?.startsWith("АВТ-") ? "Счёт (создан автоматически)" : "Счёт от вас"}
          </p>
          <a
            href={`/api/partner/payouts/${payout.id}/invoice`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline text-sm"
            data-testid={`btn-view-invoice-${payout.id}`}
          >
            <Download className="w-3 h-3" /> Открыть счёт{payout.invoiceNumber ? ` №${payout.invoiceNumber}` : ""}
          </a>
          <span className="text-xs text-muted-foreground ml-2">от {fmtDate(payout.invoiceUploadedAt)}</span>
        </div>
      )}

      {payout.paidAt && (
        <div className="text-sm border-t pt-3">
          <p className="text-muted-foreground text-xs mb-1">Оплата</p>
          <p>Оплачено {fmtDate(payout.paidAt)}{payout.paidReference ? ` · референс ${payout.paidReference}` : ""}</p>
        </div>
      )}

      {payout.receiptUrl && (
        <div className="text-sm border-t pt-3">
          <p className="text-muted-foreground text-xs mb-1">Чек НПД</p>
          <a
            href={`/api/partner/payouts/${payout.id}/receipt`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline text-sm"
            data-testid={`btn-view-receipt-${payout.id}`}
          >
            <Download className="w-3 h-3" /> Открыть чек{payout.receiptNumber ? ` №${payout.receiptNumber}` : ""}
          </a>
          <span className="text-xs text-muted-foreground ml-2">от {fmtDate(payout.receiptUploadedAt)}</span>
        </div>
      )}

      {payout.actUrl && (
        <div className="text-sm border-t pt-3">
          <p className="text-muted-foreground text-xs mb-1">Акт оказанных услуг</p>
          <a
            href={`/api/partner/payouts/${payout.id}/act`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline text-sm"
            data-testid={`btn-view-act-${payout.id}`}
          >
            <Download className="w-3 h-3" /> Открыть акт{payout.actNumber ? ` №${payout.actNumber}` : ""}
          </a>
          <span className="text-xs text-muted-foreground ml-2">от {fmtDate(payout.actUploadedAt)}</span>
        </div>
      )}

      {/* Действия партнёра по статусу */}
      {activeKind && (
        <div className="border-t pt-4 space-y-3">
          <div>
            <h3 className="font-medium mb-1">
              {activeKind === "invoice"
                ? "Прикрепите счёт из «Мой налог»"
                : activeKind === "receipt"
                  ? "Прикрепите чек из «Мой налог»"
                  : "Прикрепите акт оказанных услуг"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {activeKind === "invoice"
                ? "Сформируйте счёт на сумму выплаты в приложении ФНС «Мой налог» и приложите его (PDF, JPG, PNG, WebP или HEIC, до 25 МБ)."
                : activeKind === "receipt"
                  ? "После получения оплаты сформируйте чек самозанятого в приложении «Мой налог» и приложите его (PDF, JPG, PNG, WebP или HEIC, до 25 МБ)."
                  : "После получения оплаты сформируйте и подпишите акт оказанных услуг на сумму выплаты (заказчик — ООО «БУМЕРАНГ»). Приложите PDF или скан/фото подписанного экземпляра (PDF, JPG, PNG, WebP или HEIC, до 25 МБ)."}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`num-${payout.id}`} className="text-xs">
                Номер {activeKind === "invoice" ? "счёта" : activeKind === "receipt" ? "чека" : "акта"} (необязательно)
              </Label>
              <Input
                id={`num-${payout.id}`}
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                placeholder="например, 100"
                maxLength={64}
                data-testid={`input-docnumber-${payout.id}`}
              />
            </div>
            <div>
              <Label htmlFor={fileInputId} className="text-xs">Файл</Label>
              <Input
                id={fileInputId}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                data-testid={`input-file-${payout.id}`}
              />
            </div>
          </div>
          <Button
            onClick={() => uploadMutation.mutate(activeKind)}
            disabled={!file || uploadMutation.isPending}
            data-testid={`btn-upload-${activeKind}-${payout.id}`}
          >
            {uploadMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Загрузить {activeKind === "invoice" ? "счёт" : activeKind === "receipt" ? "чек" : "акт"}
          </Button>
        </div>
      )}

      {/* Подсказки по неактивным состояниям */}
      {payout.status === "invoice_uploaded" && (
        <Alert>
          <AlertDescription className="text-sm">
            Счёт получен. Ожидайте — администратор оплатит и пометит выплату как оплаченную, после этого здесь появится форма для прикрепления закрывающего документа (чека НПД или акта оказанных услуг).
          </AlertDescription>
        </Alert>
      )}
      {payout.status === "paid_pending_receipt" && payout.receiptUrl && (
        <Alert>
          <AlertDescription className="text-sm">
            Чек получен. Ожидайте — администратор проверит его и завершит выплату.
          </AlertDescription>
        </Alert>
      )}
      {payout.status === "paid_pending_act" && payout.actUrl && (
        <Alert>
          <AlertDescription className="text-sm">
            Акт получен. Ожидайте — администратор проверит его и завершит выплату.
          </AlertDescription>
        </Alert>
      )}
    </Card>
  );
}

function CommissionBlock({ partner, effectiveCommissionPercent, progressiveInfo }: {
  partner: PartnerData["partner"];
  effectiveCommissionPercent: number;
  progressiveInfo?: PartnerData["progressiveInfo"];
}) {
  const TIER1 = 1_000_000;
  const TIER2 = 2_000_000;

  if (partner.isArtist) {
    const ownRate = partner.artistRate ?? effectiveCommissionPercent;
    const refRate = partner.commissionOverride ?? partner.artistRate ?? effectiveCommissionPercent;
    return (
      <div className="space-y-2 pt-1">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground text-sm">С ваших товаров</span>
          <Badge variant="secondary" className="font-mono text-sm">{ownRate}%</Badge>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground text-sm">С реферальных заказов</span>
          <Badge variant="secondary" className="font-mono text-sm">{refRate}%</Badge>
        </div>
      </div>
    );
  }

  if (partner.commissionOverride != null) {
    return (
      <div className="flex justify-between items-center pt-1">
        <span className="text-muted-foreground text-sm">Индивидуальная ставка</span>
        <Badge variant="secondary" className="font-mono text-sm">{partner.commissionOverride}%</Badge>
      </div>
    );
  }

  if (progressiveInfo) {
    const { monthlyTotal, currentRate, nextTierAt, nextTierRate } = progressiveInfo;
    const monthlyRub = Math.round(monthlyTotal / 100);
    const progressPct = nextTierAt
      ? Math.min(100, Math.round((monthlyTotal / nextTierAt) * 100))
      : 100;
    const needRub = nextTierAt ? Math.max(0, Math.round((nextTierAt - monthlyTotal) / 100)) : 0;

    return (
      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">Текущая ставка</span>
          <Badge className="font-mono text-sm">{currentRate}%</Badge>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Оборот за месяц: <strong className="text-foreground">{monthlyRub.toLocaleString("ru-RU")} ₽</strong></span>
            {nextTierAt && <span>до {Math.round(nextTierAt / 100).toLocaleString("ru-RU")} ₽</span>}
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className={currentRate === 15 ? "font-semibold text-foreground" : ""}>15%</span>
            <span className={currentRate === 20 ? "font-semibold text-foreground" : ""}>20% (от 10 000 ₽)</span>
            <span className={currentRate === 25 ? "font-semibold text-foreground" : ""}>25% (от 20 000 ₽)</span>
          </div>
        </div>
        {nextTierAt && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
            До ставки <strong>{nextTierRate}%</strong> осталось накопить ещё <strong>{needRub.toLocaleString("ru-RU")} ₽</strong> оборота в этом месяце
          </p>
        )}
        {!nextTierAt && (
          <p className="text-xs text-green-600 bg-green-50 dark:bg-green-950/30 rounded-lg px-3 py-2 font-medium">
            Максимальная ставка достигнута 🎉
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center pt-1">
      <span className="text-muted-foreground text-sm">Ставка</span>
      <Badge variant="secondary" className="font-mono text-sm">{effectiveCommissionPercent}%</Badge>
    </div>
  );
}

function SettingsTab({ partner, effectiveCommissionPercent, progressiveInfo }: {
  partner: PartnerData["partner"];
  effectiveCommissionPercent: number;
  progressiveInfo?: PartnerData["progressiveInfo"];
}) {
  const { toast } = useToast();
  const [contactName, setContactName] = useState(partner.contactName);
  const [contactPhone, setContactPhone] = useState(partner.contactPhone || "");
  const [storeName, setStoreName] = useState(partner.storeName);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/partner/settings", { contactName, contactPhone, storeName });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Сохранено", description: "Данные обновлены" });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me"] });
    },
    onError: (err: any) => {
      let message = err?.message || "Ошибка";
      try {
        const m = message.match(/^\d+:\s*(.*)$/);
        if (m) message = JSON.parse(m[1]).error || message;
      } catch {}
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
      <Card className="p-5 sm:p-6 space-y-4">
        <h2 className="text-base sm:text-lg font-semibold">Контактные данные</h2>
        <div>
          <Label htmlFor="storeName">Название канала / магазина</Label>
          <Input id="storeName" value={storeName} onChange={(e) => setStoreName(e.target.value)} data-testid="input-settings-store" />
        </div>
        <div>
          <Label htmlFor="contactName">Имя</Label>
          <Input id="contactName" value={contactName} onChange={(e) => setContactName(e.target.value)} data-testid="input-settings-name" />
        </div>
        <div>
          <Label htmlFor="contactPhone">Телефон</Label>
          <Input id="contactPhone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} data-testid="input-settings-phone" />
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-settings">
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Сохранить
        </Button>
      </Card>
      <Card className="p-5 sm:p-6 space-y-3">
        <h2 className="text-base sm:text-lg font-semibold">Параметры аккаунта</h2>
        <div className="text-sm space-y-2">
          <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{partner.contactEmail}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Идентификатор</span><code className="text-xs">{partner.partnerSlug}</code></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Статус</span><Badge>{partner.status}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Зарегистрирован</span><span>{fmtDate(partner.createdAt)}</span></div>
        </div>
        <div className="border-t pt-3">
          <p className="text-sm font-medium mb-2">Персональная комиссия</p>
          <CommissionBlock partner={partner} effectiveCommissionPercent={effectiveCommissionPercent} progressiveInfo={progressiveInfo} />
        </div>
        <div className="text-sm space-y-2">
          <div className="flex justify-between"><span className="text-muted-foreground">Всего заработано</span><span className="font-semibold">{fmtRub(partner.totalEarned)}</span></div>
        </div>
        <p className="text-xs text-muted-foreground pt-2 border-t">
          Email и идентификатор изменить нельзя — обратитесь в поддержку.
        </p>
      </Card>
    </div>
  );
}
