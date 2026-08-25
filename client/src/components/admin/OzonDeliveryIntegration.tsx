import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "@/lib/admin-fetch";
import { Store, Loader2, CheckCircle2, X, Clock, RefreshCw } from "lucide-react";

export function OzonDeliveryIntegration({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const [toggling, setToggling] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [reloading, setReloading] = useState(false);

  const settingsQuery = useQuery<{
    configured: boolean;
    enabled: boolean;
    serviceReady: boolean;
    oauthStatus: { configured: boolean; authenticated: boolean; expiresAt?: string; isExpired?: boolean };
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

  return (
    <div className="p-4 space-y-6 max-w-2xl">
      <h2 className="text-xl font-bold flex items-center gap-2">
        <Store className="w-5 h-5" />
        Интеграции
      </h2>

      {/* Ozon Delivery Card */}
      <div className="border rounded-xl overflow-hidden">
        {/* Header */}
        <div className="bg-[#005BFF]/10 border-b border-[#005BFF]/20 px-5 py-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#005BFF] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-sm">O</span>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-base">Ozon Delivery (Логистика Ozon)</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Покупатель выбирает ПВЗ Ozon до оплаты. OAuth 2.0 через dev.ozon.ru.
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

