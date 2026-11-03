import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "@/lib/admin-fetch";
import { Store, Loader2, CheckCircle2, X, Clock, RefreshCw, KeyRound, Wifi, Calculator, PackagePlus, AlertTriangle } from "lucide-react";

interface DeliveryApiPointsSyncState {
  runId: string;
  cursor?: string | null;
  listDone?: boolean;
  pages: number;
  refsSeen: number;
  detailsFetched: number;
  detailsFailed: number;
  totalRefs?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  lastError?: string;
  hasMore: boolean;
  inactiveMarked?: number;
}

interface DeliveryApiPointsSyncResult {
  success: boolean;
  state?: DeliveryApiPointsSyncState;
  hasMore?: boolean;
  done?: boolean;
  error?: string;
}

interface DeliveryApiTokenStatus {
  configured: boolean;
  authenticated: boolean;
  clientIdMasked: string | null;
  expiresAt?: string;
  expiresInSeconds?: number;
  scopes: string[];
  lastError: { code: string; message: string } | null;
  publicEnabled?: boolean;
  points?: { state: DeliveryApiPointsSyncState | null };
}

interface DeliveryApiQuoteResult {
  success: boolean;
  quote?: {
    deliveryPointId: string;
    shipmentMethodId: string;
    deliveryCostKopeks: number;
    insuranceCostKopeks: number;
    costKopeks: number;
    estimatedDeliveryDays?: number;
    cutoffAt?: string;
    requestIds: string[];
    traceId?: string;
  };
  error?: string;
  code?: string;
  status?: number;
  traceId?: string;
}

interface DeliveryApiOrderResult {
  success: boolean;
  order?: {
    orderNumber: string;
    orderExternalId?: string;
    postings: Array<{
      requestId?: string;
      postingNumber: string;
      postingExternalId?: string;
      estimatedDeliveryDays?: number;
      cutoffAt?: string;
    }>;
  };
  quote?: NonNullable<DeliveryApiQuoteResult["quote"]>;
  error?: string;
  code?: string;
  quoteCode?: string;
  status?: number;
  traceId?: string;
  idempotencyKey?: string;
  mayHaveBeenCreated?: boolean;
}

function formatKopeks(value: number): string {
  return `${(value / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function createIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // UUID v4-совместимый fallback для старых браузеров.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const random = (Math.random() * 16) | 0;
      const value = char === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }
}

interface DeliveryApiCheckResult {
  success: boolean;
  checkedAt: string;
  token: {
    ok: boolean;
    configured: boolean;
    clientIdMasked: string | null;
    expiresAt?: string;
    expiresInSeconds?: number;
    scopes?: string[];
    error?: { code: string; message: string };
  };
  api: null | {
    ok: boolean;
    status: number;
    itemsCount: number | null;
    traceId?: string;
    error?: { code: string; message: string };
  };
}

export function OzonDeliveryIntegration({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const [toggling, setToggling] = useState(false);
  const [togglingPublic, setTogglingPublic] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [checkingApi, setCheckingApi] = useState(false);
  const [apiCheck, setApiCheck] = useState<DeliveryApiCheckResult | null>(null);
  const [syncingPoints, setSyncingPoints] = useState(false);
  const [pointsSync, setPointsSync] = useState<DeliveryApiPointsSyncResult | null>(null);
  const [quotePointId, setQuotePointId] = useState("");
  const [quotePhone, setQuotePhone] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [quoteItems, setQuoteItems] = useState("1");
  const [quoting, setQuoting] = useState(false);
  const [quoteResult, setQuoteResult] = useState<DeliveryApiQuoteResult | null>(null);
  const [orderPointId, setOrderPointId] = useState("");
  const [orderPhone, setOrderPhone] = useState("");
  const [orderAmount, setOrderAmount] = useState("");
  const [orderItems, setOrderItems] = useState("1");
  const [orderDescription, setOrderDescription] = useState(
    "Товары интернет-магазина Boomerang",
  );
  const [orderFullName, setOrderFullName] = useState("");
  const [orderExternalId, setOrderExternalId] = useState("");
  const [postingExternalId, setPostingExternalId] = useState("");
  const [orderConfirm, setOrderConfirm] = useState(false);
  const [orderIdempotencyKey, setOrderIdempotencyKey] = useState(
    createIdempotencyKey,
  );
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderResult, setOrderResult] = useState<DeliveryApiOrderResult | null>(
    null,
  );

  const settingsQuery = useQuery<{
    configured: boolean;
    enabled: boolean;
    serviceReady: boolean;
    oauthStatus: { configured: boolean; authenticated: boolean; expiresAt?: string; isExpired?: boolean };
    deliveryApi?: DeliveryApiTokenStatus;
  }>({
    queryKey: ["/api/admin/ozon-delivery/settings"],
    enabled: !!apiKey,
    refetchInterval: 15000,
  });

  const settings = settingsQuery.data;
  const oauth = settings?.oauthStatus;
  const isConnected = oauth?.configured && oauth?.authenticated && !oauth?.isExpired;

  async function handleToggle(enable: boolean) {
    setToggling(true);
    try {
      await adminFetch("/api/admin/ozon-delivery/settings", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enable }),
      });
      toast({ title: enable ? "Ozon Доставка включена" : "Ozon Доставка отключена" });
      settingsQuery.refetch();
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setToggling(false);
    }
  }

  async function handleTogglePublic(enable: boolean) {
    setTogglingPublic(true);
    try {
      await adminFetch("/api/admin/ozon-delivery-api/settings", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enable }),
      });
      toast({
        title: enable
          ? "Ozon Delivery API включён в чекауте"
          : "Ozon Delivery API отключён в чекауте",
      });
      settingsQuery.refetch();
    } catch (e: any) {
      toast({
        title: "Не удалось переключить чекаут",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setTogglingPublic(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    try {
      const data = await adminFetch("/api/admin/ozon-oauth/authorize", apiKey);
      if (data?.authUrl) {
        window.open(data.authUrl, "_blank", "width=700,height=600,noopener");
        toast({ title: "Откройте страницу авторизации Ozon", description: "После авторизации вернитесь сюда и нажмите «Обновить статус»" });
      } else {
        toast({ title: "Ошибка", description: data?.error || "Не удалось получить URL авторизации", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  }

  async function handleReload() {
    setReloading(true);
    try {
      const data = await adminFetch("/api/admin/ozon-oauth/reload", apiKey, { method: "POST" });
      if (data?.success) {
        toast({ title: "Токены перечитаны из БД" });
        settingsQuery.refetch();
      } else {
        toast({ title: "Токены не найдены", description: data?.error || "Авторизуйтесь заново", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setReloading(false);
    }
  }

  async function handleCheckDeliveryApi() {
    setCheckingApi(true);
    try {
      const data = await adminFetch("/api/admin/ozon-delivery-api/check", apiKey, { method: "POST" });
      setApiCheck(data);
      settingsQuery.refetch();
      if (data?.success) {
        toast({
          title: "Ozon Delivery API доступен",
          description: data.api?.itemsCount != null
            ? `Токен получен, ПВЗ в первой странице: ${data.api.itemsCount}`
            : "Токен получен, API отвечает",
        });
      } else {
        toast({
          title: "Проверка не прошла",
          description: data?.api?.error?.message || data?.token?.error?.message || "Подробности в блоке проверки",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setCheckingApi(false);
    }
  }

  async function handleSyncPoints() {
    if (!deliveryApi?.configured) return;
    setSyncingPoints(true);
    const currentState = pointsSync?.state ?? deliveryApi?.points?.state;
    let restart = !currentState || !!currentState.completedAt || !currentState.hasMore;
    let lastResult: DeliveryApiPointsSyncResult | null = null;

    try {
      // Каждый запрос — ограниченная пачка страниц. Продолжаем, пока сервер
      // говорит hasMore, чтобы не упереться в таймаут serverless-контейнера.
      for (let iteration = 0; iteration < 200; iteration++) {
        const data: DeliveryApiPointsSyncResult = await adminFetch(
          "/api/admin/ozon-delivery-api/points/sync",
          apiKey,
          {
            method: "POST",
            body: JSON.stringify({ maxPages: 20, restart }),
          },
        );
        lastResult = data;
        setPointsSync(data);

        if (!data?.success) {
          toast({
            title: "Синхронизация ПВЗ остановлена",
            description: data?.error || data?.state?.lastError || "Подробности в блоке статуса",
            variant: "destructive",
          });
          break;
        }
        if (!data.hasMore) {
          toast({
            title: "Справочник ПВЗ готов",
            description: data.state
              ? `Обработано ${data.state.refsSeen.toLocaleString("ru-RU")} пунктов`
              : undefined,
          });
          break;
        }
        restart = false;
      }
      settingsQuery.refetch();
    } catch (e: any) {
      toast({ title: "Ошибка синхронизации ПВЗ", description: e.message, variant: "destructive" });
    } finally {
      setSyncingPoints(false);
    }

    if (lastResult?.success && lastResult.hasMore) {
      toast({
        title: "Пачка обработана",
        description: "Нажмите «Продолжить», чтобы продолжить с сохранённого места",
      });
    }
  }

  async function handleQuote() {
    if (!deliveryApi?.configured) return;
    const amount = Number(quoteAmount.replace(",", "."));
    if (!quotePointId.trim() || !/^\d{1,20}$/.test(quotePointId.trim())) {
      toast({ title: "Укажите ID ПВЗ", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Укажите сумму товаров", variant: "destructive" });
      return;
    }

    setQuoting(true);
    setQuoteResult(null);
    try {
      const data: DeliveryApiQuoteResult = await adminFetch(
        "/api/admin/ozon-delivery-api/quote",
        apiKey,
        {
          method: "POST",
          body: JSON.stringify({
            deliveryPointId: quotePointId.trim(),
            phone: quotePhone,
            declaredValueKopeks: Math.round(amount * 100),
            itemCount: Math.max(1, Math.floor(Number(quoteItems) || 1)),
          }),
        },
      );
      setQuoteResult(data);
      if (data?.success) {
        toast({
          title: "Расчёт получен",
          description: data.quote ? formatKopeks(data.quote.costKopeks) : undefined,
        });
      } else {
        toast({
          title: "Расчёт не удался",
          description: data?.error || "Подробности в блоке расчёта",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({ title: "Ошибка расчёта", description: e.message, variant: "destructive" });
    } finally {
      setQuoting(false);
    }
  }

  async function handleCreateOrder() {
    if (!deliveryApi?.configured) return;
    const pointId = orderPointId.trim();
    if (!/^\d{1,20}$/.test(pointId)) {
      toast({ title: "Укажите корректный ID ПВЗ", variant: "destructive" });
      return;
    }

    const amount = Number(orderAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Укажите сумму товаров", variant: "destructive" });
      return;
    }

    const description = orderDescription.trim();
    if (!description) {
      toast({
        title: "Укажите описание содержимого",
        variant: "destructive",
      });
      return;
    }

    if (!orderConfirm) {
      toast({
        title: "Подтвердите создание реального заказа",
        variant: "destructive",
      });
      return;
    }

    setCreatingOrder(true);
    setOrderResult(null);
    try {
      const data: DeliveryApiOrderResult = await adminFetch(
        "/api/admin/ozon-delivery-api/order/create",
        apiKey,
        {
          method: "POST",
          body: JSON.stringify({
            confirm: true,
            deliveryPointId: pointId,
            phone: orderPhone,
            declaredValueKopeks: Math.round(amount * 100),
            itemCount: Math.max(1, Math.floor(Number(orderItems) || 1)),
            description,
            fullName: orderFullName.trim() || undefined,
            orderExternalId: orderExternalId.trim() || undefined,
            postingExternalId: postingExternalId.trim() || undefined,
            idempotencyKey: orderIdempotencyKey,
          }),
        },
      );
      setOrderResult(data);

      if (data?.success && data.order) {
        toast({
          title: "Заказ создан в Ozon",
          description: data.order.orderNumber,
        });
        // Следующая форма будет создавать новый заказ, а не повторять этот.
        setOrderConfirm(false);
        setOrderIdempotencyKey(createIdempotencyKey());
      } else {
        toast({
          title: data?.mayHaveBeenCreated
            ? "Результат создания неизвестен"
            : "Заказ не создан",
          description: data?.error || "Подробности в блоке создания заказа",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      const data = e?.data as DeliveryApiOrderResult | undefined;
      if (data) setOrderResult(data);
      toast({
        title: data?.mayHaveBeenCreated
          ? "Результат создания неизвестен"
          : "Ошибка создания заказа",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setCreatingOrder(false);
    }
  }

  async function handleRevoke() {
    if (!confirm("Отключить Ozon Delivery? OAuth-токены будут удалены.")) return;
    setRevoking(true);
    try {
      await adminFetch("/api/admin/ozon-oauth/revoke", apiKey, { method: "POST" });
      toast({ title: "Ozon отключён", description: "Токены удалены" });
      settingsQuery.refetch();
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setRevoking(false);
    }
  }

  const statusLabel = settings?.serviceReady
    ? "Активна"
    : isConnected
      ? "Авторизован (выкл.)"
      : oauth?.configured
        ? "Не авторизован"
        : "Не настроена";

  const statusColor = settings?.serviceReady
    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
    : isConnected
      ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
      : "bg-muted text-muted-foreground";

  const deliveryApi = settings?.deliveryApi;
  const deliveryApiReady = !!deliveryApi?.configured && !!deliveryApi?.authenticated;
  const deliveryApiLabel = deliveryApi?.configured
    ? deliveryApiReady
      ? "Токен активен"
      : "Токен не получен"
    : "Не настроено";
  const deliveryApiColor = deliveryApiReady
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    : deliveryApi?.configured
      ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
      : "bg-muted text-muted-foreground";

  const pointsState = pointsSync?.state ?? deliveryApi?.points?.state;
  const pointsInProgress = !!pointsState && pointsState.hasMore && !pointsState.completedAt;
  const pointsDone = !!pointsState?.completedAt;
  const pointsWithErrors = pointsDone && (pointsState?.detailsFailed ?? 0) > 0;
  const pointsLabel = pointsInProgress
    ? "В процессе"
    : pointsWithErrors
      ? "Готов с ошибками"
      : pointsDone
        ? "Готов"
        : "Не синхронизирован";
  const pointsColor = pointsInProgress
    ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
    : pointsDone && !pointsWithErrors
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : pointsWithErrors
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  const pointsProgress =
    pointsState?.totalRefs && pointsState.totalRefs > 0
      ? Math.min(100, Math.round((pointsState.refsSeen / pointsState.totalRefs) * 100))
      : null;

  return (
    <div className="p-4 space-y-6 max-w-2xl">
      <h2 className="text-xl font-bold flex items-center gap-2">
        <Store className="w-5 h-5" />
        Интеграции
      </h2>

      {/* Ozon Delivery API — новый кабинет (client_credentials) */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-800 px-5 py-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center flex-shrink-0">
            <KeyRound className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-base flex items-center gap-2 flex-wrap">
              Ozon Delivery API
              <span className="text-[10px] font-mono font-normal px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                client_credentials
              </span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Новый кабинет Ozon Доставки. Токен server-to-server, без страницы согласия.
            </p>
          </div>
          <div className={`text-xs font-medium px-2.5 py-1 rounded-full ${deliveryApiColor}`}>
            {deliveryApiLabel}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {settingsQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
            </div>
          )}

          {deliveryApi && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Credentials</div>
                <div className={`flex items-center gap-1.5 ${deliveryApi.configured ? "text-foreground" : "text-muted-foreground"}`}>
                  {deliveryApi.configured
                    ? <><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Загружены из окружения</>
                    : <><X className="w-3.5 h-3.5 text-red-400" /> Не заданы</>
                  }
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Токен</div>
                <div className={`flex items-center gap-1.5 ${deliveryApiReady ? "text-foreground" : "text-muted-foreground"}`}>
                  {deliveryApiReady
                    ? <><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Получен</>
                    : <><X className="w-3.5 h-3.5 text-red-400" /> Ещё не получен</>
                  }
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Client ID</div>
                <div className="text-foreground font-mono text-xs">{deliveryApi.clientIdMasked || "—"}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Права</div>
                <div className="text-foreground text-xs">{deliveryApi.scopes.length} из 8</div>
              </div>
            </div>
          )}

          {deliveryApi?.expiresAt && deliveryApi.authenticated && (
            <p className="text-xs text-muted-foreground">
              Токен действует до: {new Date(deliveryApi.expiresAt).toLocaleString("ru-RU")}
            </p>
          )}

          {deliveryApi?.lastError && (
            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2.5">
              Последняя ошибка: <span className="font-mono">{deliveryApi.lastError.code}</span> — {deliveryApi.lastError.message}
            </div>
          )}

          <div className="flex gap-2 flex-wrap items-center">
            <button
              onClick={handleCheckDeliveryApi}
              disabled={checkingApi || !deliveryApi?.configured}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-60"
            >
              {checkingApi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              Проверить подключение
            </button>
            <span className="text-xs text-muted-foreground">
              Токен + первая страница /v1/delivery-point/list
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Токен сохраняется в YDB и переживает перезапуск. При смене Client ID старый токен игнорируется.
          </p>

          {apiCheck && (
            <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5">
                {apiCheck.token.ok
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  : <X className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                }
                <span><span className="font-medium">Токен:</span> {apiCheck.token.ok ? "получен" : "не получен"}</span>
              </div>
              {apiCheck.token.ok && apiCheck.token.expiresAt && (
                <div className="text-muted-foreground pl-5">
                  до {new Date(apiCheck.token.expiresAt).toLocaleString("ru-RU")}
                  {" · "}прав: {apiCheck.token.scopes?.length ?? "—"}
                  {apiCheck.token.clientIdMasked ? ` · Client ID: ${apiCheck.token.clientIdMasked}` : ""}
                </div>
              )}
              {!apiCheck.token.ok && apiCheck.token.error && (
                <div className="text-red-600 dark:text-red-400 pl-5 break-words">
                  <span className="font-mono">{apiCheck.token.error.code}</span>: {apiCheck.token.error.message}
                </div>
              )}
              <div className="flex items-start gap-1.5">
                {apiCheck.api?.ok
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                  : <X className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                }
                <span className="break-words">
                  <span className="font-medium">API:</span>{" "}
                  {!apiCheck.api
                    ? "не проверялся"
                    : apiCheck.api.ok
                      ? `доступен, ПВЗ в первой странице: ${apiCheck.api.itemsCount ?? "—"}`
                      : `HTTP ${apiCheck.api.status}: ${apiCheck.api.error?.message || "ошибка"}`
                  }
                </span>
              </div>
              {apiCheck.api?.traceId && (
                <div className="font-mono text-[10px] text-muted-foreground break-all">
                  x-o3-trace-id: {apiCheck.api.traceId}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">
                Проверено: {new Date(apiCheck.checkedAt).toLocaleString("ru-RU")}
              </div>
            </div>
          )}

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Справочник ПВЗ</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ~900 страниц по 100 пунктов. Прогресс сохраняется в YDB — можно продолжить позже.
                </p>
              </div>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${pointsColor}`}>
                {pointsLabel}
              </span>
            </div>

            {pointsState ? (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Пунктов</div>
                    <div className="font-mono">{pointsState.refsSeen.toLocaleString("ru-RU")}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Деталей</div>
                    <div className="font-mono">{pointsState.detailsFetched.toLocaleString("ru-RU")}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Страниц</div>
                    <div className="font-mono">{pointsState.pages.toLocaleString("ru-RU")}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Ошибок</div>
                    <div className={`font-mono ${pointsState.detailsFailed > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                      {pointsState.detailsFailed.toLocaleString("ru-RU")}
                    </div>
                  </div>
                </div>

                {pointsProgress != null && (
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-emerald-600 transition-all" style={{ width: `${pointsProgress}%` }} />
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {pointsProgress}%{pointsState.totalRefs ? ` из ${pointsState.totalRefs.toLocaleString("ru-RU")}` : ""}
                    </div>
                  </div>
                )}

                {pointsState.completedAt && (
                  <p className="text-xs text-muted-foreground">
                    Завершено: {new Date(pointsState.completedAt).toLocaleString("ru-RU")}
                  </p>
                )}

                {pointsState.lastError && (
                  <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2.5 break-words">
                    {pointsState.lastError}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Справочник ещё не синхронизирован. После первого прохода ПВЗ появятся в локальной таблице.
              </p>
            )}

            <div className="flex gap-2 flex-wrap items-center">
              <button
                onClick={handleSyncPoints}
                disabled={syncingPoints || checkingApi || !deliveryApi?.configured}
                className="flex items-center gap-2 px-4 py-2 border text-sm font-medium rounded-lg hover:bg-muted transition-colors disabled:opacity-60"
              >
                {syncingPoints ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {pointsInProgress ? "Продолжить синхронизацию ПВЗ" : "Синхронизировать ПВЗ"}
              </button>
              {syncingPoints && (
                <span className="text-xs text-muted-foreground">
                  Обрабатываю пачку страниц…
                </span>
              )}
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Показывать Ozon в чекауте</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Отдельный флаг нового Delivery API. Старый Seller-контур не меняется.
                </p>
              </div>
              <button
                onClick={() => handleTogglePublic(!deliveryApi?.publicEnabled)}
                disabled={
                  togglingPublic ||
                  !deliveryApi?.configured ||
                  !pointsDone
                }
                className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                  deliveryApi?.publicEnabled ? "bg-emerald-600" : "bg-muted-foreground/30"
                } disabled:opacity-60`}
                title={
                  !deliveryApi?.configured
                    ? "Сначала задайте ключи Delivery API"
                    : !pointsDone
                      ? "Сначала полностью синхронизируйте ПВЗ"
                      : undefined
                }
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  deliveryApi?.publicEnabled ? "translate-x-5" : "translate-x-0"
                }`} />
              </button>
            </div>
            {!pointsDone && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Включение станет доступно после полной синхронизации справочника ПВЗ.
              </p>
            )}
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-start gap-2">
              <Calculator className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Проверка расчёта доставки</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Предварительный расчёт через <code className="font-mono">/v1/order/checkout</code>. Этот же расчёт используется публичным чекаутом после включения Ozon выше.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                ID ПВЗ
                <input
                  value={quotePointId}
                  onChange={(e) => setQuotePointId(e.target.value)}
                  placeholder="например, 123456789"
                  inputMode="numeric"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Телефон покупателя
                <input
                  value={quotePhone}
                  onChange={(e) => setQuotePhone(e.target.value)}
                  placeholder="+7 900 123-45-67"
                  inputMode="tel"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Сумма товаров, ₽
                <input
                  value={quoteAmount}
                  onChange={(e) => setQuoteAmount(e.target.value)}
                  placeholder="3500"
                  inputMode="decimal"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Товаров, шт
                <input
                  value={quoteItems}
                  onChange={(e) => setQuoteItems(e.target.value)}
                  placeholder="1"
                  inputMode="numeric"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </label>
            </div>

            <button
              onClick={handleQuote}
              disabled={quoting || syncingPoints || checkingApi || !deliveryApi?.configured}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-60"
            >
              {quoting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              {quoting ? "Считаю…" : "Рассчитать доставку"}
            </button>

            {quoteResult?.success && quoteResult.quote && (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 px-3 py-3 text-xs space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-foreground">Итого к оплате за доставку</span>
                  <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                    {formatKopeks(quoteResult.quote.costKopeks)}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  Доставка: {formatKopeks(quoteResult.quote.deliveryCostKopeks)} · Страховка: {formatKopeks(quoteResult.quote.insuranceCostKopeks)}
                </div>
                <div className="text-muted-foreground">
                  Срок: {quoteResult.quote.estimatedDeliveryDays != null ? `${quoteResult.quote.estimatedDeliveryDays} дн.` : "—"}
                  {quoteResult.quote.cutoffAt ? ` · cutoff: ${new Date(quoteResult.quote.cutoffAt).toLocaleString("ru-RU")}` : ""}
                </div>
                <div className="text-muted-foreground font-mono text-[10px] break-all">
                  shipment_method_id: {quoteResult.quote.shipmentMethodId}
                  {quoteResult.quote.traceId ? ` · x-o3-trace-id: ${quoteResult.quote.traceId}` : ""}
                </div>
              </div>
            )}

            {quoteResult && !quoteResult.success && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2.5 break-words">
                {quoteResult.error || "Не удалось рассчитать доставку"}
                {quoteResult.traceId ? (
                  <div className="font-mono text-[10px] mt-1 break-all">x-o3-trace-id: {quoteResult.traceId}</div>
                ) : null}
              </div>
            )}
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-start gap-2">
              <PackagePlus className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Создание заказа</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Реальная проверка <code className="font-mono">/v1/order/create</code>. Перед созданием автоматически повторяется <code className="font-mono">/v1/order/checkout</code> с теми же параметрами. После оплаты заказа магазина этот вызов выполняется автоматически.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-medium">Если ключи заданы, это создаст настоящий заказ в Ozon.</div>
                <p className="text-amber-700/80 dark:text-amber-400/80">
                  Отмена и привязка к заказу магазина в этом этапе не реализованы — отменять заказ нужно в кабинете Ozon Доставки.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                ID ПВЗ
                <input
                  value={orderPointId}
                  onChange={(e) => setOrderPointId(e.target.value)}
                  placeholder="например, 123456789"
                  inputMode="numeric"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Телефон получателя
                <input
                  value={orderPhone}
                  onChange={(e) => setOrderPhone(e.target.value)}
                  placeholder="+7 900 123-45-67"
                  inputMode="tel"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Сумма товаров, ₽
                <input
                  value={orderAmount}
                  onChange={(e) => setOrderAmount(e.target.value)}
                  placeholder="3500"
                  inputMode="decimal"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Товаров, шт
                <input
                  value={orderItems}
                  onChange={(e) => setOrderItems(e.target.value)}
                  placeholder="1"
                  inputMode="numeric"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
                ФИО получателя <span className="font-normal">(необязательно)</span>
                <input
                  value={orderFullName}
                  onChange={(e) => setOrderFullName(e.target.value)}
                  placeholder="Иванов Иван Иванович"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
                Описание содержимого
                <input
                  value={orderDescription}
                  onChange={(e) => setOrderDescription(e.target.value)}
                  placeholder="Товары интернет-магазина"
                  maxLength={500}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
                <span className="text-[10px] text-muted-foreground">{orderDescription.length}/500</span>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                order_external_id <span className="font-normal">(необязательно)</span>
                <input
                  value={orderExternalId}
                  onChange={(e) => setOrderExternalId(e.target.value)}
                  placeholder="shop-order-42"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                posting_external_id <span className="font-normal">(необязательно)</span>
                <input
                  value={postingExternalId}
                  onChange={(e) => setPostingExternalId(e.target.value)}
                  placeholder="shop-posting-42-1"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </label>
            </div>

            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={orderConfirm}
                onChange={(e) => setOrderConfirm(e.target.checked)}
                className="mt-0.5 accent-amber-600"
              />
              <span>
                Подтверждаю создание <span className="font-medium text-foreground">настоящего</span> заказа в Ozon. Понимаю, что отмена выполняется в кабинете Ozon.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleCreateOrder}
                disabled={creatingOrder || !deliveryApi?.configured || !orderConfirm}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-60"
              >
                {creatingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
                {creatingOrder ? "Создаю…" : "Создать заказ в Ozon"}
              </button>
              <span className="text-[10px] text-muted-foreground font-mono break-all">
                Текущий Idempotency-Key: {orderIdempotencyKey}
              </span>
            </div>

            {orderResult?.success && orderResult.order && (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 px-3 py-3 text-xs space-y-2">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="font-medium text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Заказ создан
                  </span>
                  <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 break-all">
                    {orderResult.order.orderNumber}
                  </span>
                </div>
                {orderResult.order.orderExternalId ? (
                  <div className="text-muted-foreground">
                    order_external_id: <span className="font-mono">{orderResult.order.orderExternalId}</span>
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  {orderResult.order.postings.map((posting) => (
                    <div key={posting.postingNumber} className="rounded border bg-background/60 px-2.5 py-2 space-y-1">
                      <div className="font-mono font-medium break-all">{posting.postingNumber}</div>
                      {posting.postingExternalId ? (
                        <div className="text-muted-foreground break-all">posting_external_id: <span className="font-mono">{posting.postingExternalId}</span></div>
                      ) : null}
                      <div className="text-muted-foreground">
                        {posting.estimatedDeliveryDays != null ? `${posting.estimatedDeliveryDays} дн.` : "Срок: —"}
                        {posting.cutoffAt ? ` · cutoff: ${new Date(posting.cutoffAt).toLocaleString("ru-RU")}` : ""}
                        {posting.requestId ? ` · request_id: ${posting.requestId}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
                {orderResult.quote ? (
                  <div className="text-muted-foreground">
                    Расчёт: {formatKopeks(orderResult.quote.costKopeks)} · доставка {formatKopeks(orderResult.quote.deliveryCostKopeks)} · страховка {formatKopeks(orderResult.quote.insuranceCostKopeks)}
                  </div>
                ) : null}
                {orderResult.traceId ? (
                  <div className="font-mono text-[10px] text-muted-foreground break-all">x-o3-trace-id: {orderResult.traceId}</div>
                ) : null}
                {orderResult.idempotencyKey ? (
                  <div className="font-mono text-[10px] text-muted-foreground break-all">
                    Idempotency-Key этого заказа: {orderResult.idempotencyKey}
                  </div>
                ) : null}
                <p className="text-[10px] text-muted-foreground">
                  Заказ создан напрямую в Ozon и пока не привязан к заказу магазина.
                </p>
              </div>
            )}

            {orderResult && !orderResult.success && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-xs text-red-700 dark:text-red-400 space-y-2">
                <div className="break-words">
                  {orderResult.error || "Не удалось создать заказ"}
                  {orderResult.status ? <span className="text-[10px] opacity-70"> · HTTP {orderResult.status}</span> : null}
                </div>
                {orderResult.mayHaveBeenCreated && (
                  <div className="flex items-start gap-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-2.5 py-2 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      Запрос мог дойти до Ozon. Не создавайте новый заказ с новым ключом: проверьте кабинет Ozon. Повторять запрос можно только с текущим Idempotency-Key.
                    </span>
                  </div>
                )}
                {orderResult.idempotencyKey ? (
                  <div className="font-mono text-[10px] break-all text-muted-foreground">
                    Idempotency-Key: {orderResult.idempotencyKey}
                  </div>
                ) : null}
                {orderResult.traceId ? (
                  <div className="font-mono text-[10px] break-all text-muted-foreground">x-o3-trace-id: {orderResult.traceId}</div>
                ) : null}
              </div>
            )}
          </div>

          {deliveryApi && !deliveryApi.configured && (
            <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2.5">
              Добавьте <code className="font-mono">OZON_DELIVERY_API_CLIENT_ID</code> и <code className="font-mono">OZON_DELIVERY_API_CLIENT_SECRET</code> в переменные окружения контейнера и перезапустите сервер.
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Кнопка «Переавторизовать» в блоке ниже относится к старому Seller-контуру и для этого приложения не используется.
          </p>
        </div>
      </div>

      {/* Ozon Delivery Card */}
      <div className="border rounded-xl overflow-hidden">
        {/* Header */}
        <div className="bg-[#005BFF]/10 border-b border-[#005BFF]/20 px-5 py-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#005BFF] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-sm">O</span>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-base">Ozon Delivery — старый Seller-контур</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Устаревший Seller API. Не используется новым кабинетом Ozon Доставки; будет удалён после миграции.
            </p>
          </div>
          <div className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor}`}>
            {statusLabel}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {settingsQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
            </div>
          )}

          {/* OAuth status grid */}
          {oauth && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Credentials</div>
                <div className={`flex items-center gap-1.5 ${oauth.configured ? "text-foreground" : "text-muted-foreground"}`}>
                  {oauth.configured
                    ? <><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Загружены из окружения</>
                    : <><X className="w-3.5 h-3.5 text-red-400" /> Не заданы</>
                  }
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">OAuth токен</div>
                <div className={`flex items-center gap-1.5 ${isConnected ? "text-foreground" : "text-muted-foreground"}`}>
                  {isConnected
                    ? <><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Авторизован</>
                    : oauth.authenticated && oauth.isExpired
                      ? <><Clock className="w-3.5 h-3.5 text-yellow-500" /> Токен истёк</>
                      : <><X className="w-3.5 h-3.5 text-red-400" /> Не авторизован</>
                  }
                </div>
              </div>
            </div>
          )}

          {oauth?.expiresAt && isConnected && (
            <p className="text-xs text-muted-foreground">
              Токен действует до: {new Date(oauth.expiresAt).toLocaleString("ru-RU")}
            </p>
          )}

          {/* Enable toggle — only when connected */}
          {isConnected && (
            <div className="flex items-center justify-between py-3 border-t">
              <div>
                <div className="text-sm font-medium">Показывать Ozon доставку в чекауте</div>
                <div className="text-xs text-muted-foreground mt-0.5">Покупатели смогут выбрать ПВЗ Ozon</div>
              </div>
              <button
                onClick={() => handleToggle(!settings?.enabled)}
                disabled={toggling}
                className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#005BFF]/50 ${
                  settings?.enabled ? "bg-[#005BFF]" : "bg-muted-foreground/30"
                } disabled:opacity-60`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  settings?.enabled ? "translate-x-5" : "translate-x-0"
                }`} />
              </button>
            </div>
          )}

          {/* Not configured warning */}
          {settings && !oauth?.configured && (
            <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2.5">
              Добавьте <code className="font-mono">OZON_CLIENT_ID</code> и <code className="font-mono">OZON_CLIENT_SECRET</code> в переменные окружения контейнера и перезапустите сервер.
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap items-center">
            {oauth?.configured && !isConnected && (
              <>
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-2 bg-[#005BFF] text-white text-sm font-medium rounded-lg hover:bg-[#0050E0] transition-colors disabled:opacity-60"
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Авторизовать в Ozon
                </button>
                <button
                  onClick={handleReload}
                  disabled={reloading}
                  className="flex items-center gap-2 px-3 py-2 border text-sm rounded-lg hover:bg-muted transition-colors disabled:opacity-60"
                  title="Подхватить токены из БД (если авторизация прошла через другой сервер)"
                >
                  {reloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Подхватить токены
                </button>
              </>
            )}
            {isConnected && (
              <>
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-3 py-1.5 border text-sm rounded-lg hover:bg-muted transition-colors disabled:opacity-60"
                >
                  {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Переавторизовать
                </button>
                <button
                  onClick={handleRevoke}
                  disabled={revoking}
                  className="flex items-center gap-2 px-3 py-1.5 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-60"
                >
                  {revoking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                  Отключить
                </button>
              </>
            )}
            <button
              onClick={() => settingsQuery.refetch()}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
            >
              <RefreshCw className="w-3 h-3" /> Обновить
            </button>
          </div>

          {/* Setup instructions */}
          <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2.5 space-y-1.5">
            <div className="font-medium text-foreground">Как подключить:</div>
            <ol className="list-decimal list-inside space-y-1">
              <li>На <a href="https://dev.ozon.ru" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">dev.ozon.ru</a> создайте частное приложение с OAuth и Redirect URI: <code className="font-mono text-[10px] bg-muted px-1 rounded">https://booomerangs.ru/api/ozon/oauth/callback</code></li>
              <li>Добавьте в переменные окружения контейнера:
                <div className="mt-1 font-mono bg-muted rounded px-2 py-1 text-[11px] space-y-0.5">
                  <div>OZON_CLIENT_ID=<span className="text-muted-foreground">Client-Id из dev.ozon.ru</span></div>
                  <div>OZON_CLIENT_SECRET=<span className="text-muted-foreground">Client-Secret из dev.ozon.ru</span></div>
                </div>
              </li>
              <li>Перезапустите контейнер</li>
              <li>Нажмите «Авторизовать в Ozon» и разрешите доступ</li>
              <li>Включите переключатель — в чекауте появится выбор ПВЗ</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

