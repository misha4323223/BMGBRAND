import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Send, Users, ShieldAlert, FlaskConical, History, Image } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const adminFetch = async (url: string, apiKey: string, options: RequestInit = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: { "x-api-key": apiKey, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
};

interface Props {
  apiKey: string;
  isActive: boolean;
}

type AdminPushStatus = "idle" | "pending" | "subscribed" | "denied" | "unsupported";

export default function PushNotificationsPanel({ apiKey, isActive }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [pushForm, setPushForm] = useState({ title: "", body: "", url: "", image: "" });
  const [adminPushStatus, setAdminPushStatus] = useState<AdminPushStatus>("idle");
  const [currentSub, setCurrentSub] = useState<PushSubscription | null>(null);

  const clientStatsQuery = useQuery<{ total: number }>({
    queryKey: ["/api/admin/push/stats"],
    queryFn: () => adminFetch("/api/admin/push/stats", apiKey),
    enabled: !!apiKey && isActive,
  });

  const adminStatsQuery = useQuery<{ total: number }>({
    queryKey: ["/api/admin/push/admin-stats"],
    queryFn: () => adminFetch("/api/admin/push/admin-stats", apiKey),
    enabled: !!apiKey && isActive,
  });

  const historyQuery = useQuery<Array<{
    title: string; body: string; url?: string; image?: string; tag?: string;
    sentAt: string; sent: number; failed: number; total: number;
  }>>({
    queryKey: ["/api/admin/push/history"],
    queryFn: () => adminFetch("/api/admin/push/history", apiKey),
    enabled: !!apiKey && isActive,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!isActive) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setAdminPushStatus("unsupported");
      return;
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        setCurrentSub(sub);
        setAdminPushStatus("subscribed");
      } else {
        setAdminPushStatus("idle");
      }
    });
  }, [isActive]);

  const pushSendMutation = useMutation({
    mutationFn: (data: { title: string; body: string; url?: string; image?: string }) =>
      adminFetch("/api/admin/push/send", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: (data: any) => {
      toast({ title: `✅ Push отправлен: ${data.sent} из ${data.total} подписчиков` });
      setPushForm({ title: "", body: "", url: "", image: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/push/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/push/history"] });
    },
    onError: (err: any) => toast({ title: "Ошибка отправки", description: err.message, variant: "destructive" }),
  });

  const pushTestMutation = useMutation({
    mutationFn: (data: { title: string; body: string; url?: string; image?: string }) =>
      adminFetch("/api/admin/push/test", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: (data: any) => {
      toast({ title: `🧪 Тест-пуш отправлен: ${data.sent} admin-браузер(ов)`, description: "Проверьте уведомление на своём устройстве" });
    },
    onError: (err: any) => toast({ title: "Ошибка тест-пуша", description: err.message, variant: "destructive" }),
  });

  const adminSubscribeMutation = useMutation({
    mutationFn: (subscription: any) =>
      adminFetch("/api/admin/push/admin-subscribe", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      }),
    onSuccess: () => {
      setAdminPushStatus("subscribed");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/push/admin-stats"] });
      toast({ title: "✅ Push-алерты подключены", description: "Вы будете получать уведомления от BOOOM AI" });
    },
    onError: (err: any) => toast({ title: "Ошибка подписки", description: err.message, variant: "destructive" }),
  });

  const adminUnsubscribeMutation = useMutation({
    mutationFn: (endpoint: string) =>
      adminFetch("/api/admin/push/admin-unsubscribe", apiKey, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      }),
    onSuccess: () => {
      setAdminPushStatus("idle");
      setCurrentSub(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/push/admin-stats"] });
      toast({ title: "Push-алерты отключены" });
    },
    onError: (err: any) => toast({ title: "Ошибка отписки", description: err.message, variant: "destructive" }),
  });

  const handleAdminSubscribe = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast({ title: "Браузер не поддерживает push-уведомления", variant: "destructive" });
      return;
    }
    try {
      setAdminPushStatus("pending");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setAdminPushStatus("denied");
        toast({ title: "Разрешение отклонено", description: "Разрешите уведомления в настройках браузера", variant: "destructive" });
        return;
      }
      const vapidRes = await fetch("/api/push/vapid-public-key");
      const { publicKey } = await vapidRes.json();
      // Таймаут на serviceWorker.ready — если SW не зарегистрировался, не зависаем вечно
      const swReadyTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Service Worker не готов. Обновите страницу.")), 10_000)
      );
      const reg = await Promise.race([navigator.serviceWorker.ready, swReadyTimeout]);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      setCurrentSub(sub);
      await adminSubscribeMutation.mutateAsync(sub.toJSON());
    } catch (err: any) {
      setAdminPushStatus("idle");
      toast({ title: "Ошибка подписки", description: err.message, variant: "destructive" });
    }
  };

  const handleAdminUnsubscribe = async () => {
    if (!currentSub) return;
    try {
      await currentSub.unsubscribe();
      await adminUnsubscribeMutation.mutateAsync(currentSub.endpoint);
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  };

  const handleSendPush = () => {
    if (!pushForm.title.trim() || !pushForm.body.trim()) {
      toast({ title: "Заполните заголовок и текст", variant: "destructive" });
      return;
    }
    const total = clientStatsQuery.data?.total ?? 0;
    if (!confirm(`Отправить push-уведомление ${total} клиентам?`)) return;
    pushSendMutation.mutate({
      title: pushForm.title,
      body: pushForm.body,
      url: pushForm.url || undefined,
      image: pushForm.image || undefined,
    });
  };

  const handleTestPush = () => {
    if (!pushForm.title.trim() || !pushForm.body.trim()) {
      toast({ title: "Заполните заголовок и текст", variant: "destructive" });
      return;
    }
    pushTestMutation.mutate({
      title: pushForm.title,
      body: pushForm.body,
      url: pushForm.url || undefined,
      image: pushForm.image || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              Push-подписчиков (клиенты)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {clientStatsQuery.isLoading ? "…" : (clientStatsQuery.data?.total ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">получат ручную рассылку и уведомления о новинках</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              Admin-алерты (BOOOM AI)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {adminStatsQuery.isLoading ? "…" : (adminStatsQuery.data?.total ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">браузеров администраторов подписаны на алерты</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="w-4 h-4" />
            Алерты BOOOM AI → этот браузер
          </CardTitle>
          <CardDescription>
            Получайте push-уведомления прямо в браузер: низкий сток, брошенные корзины, дайджест продаж, очередь задач агента.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {adminPushStatus === "unsupported" && (
            <p className="text-sm text-muted-foreground">Браузер не поддерживает push-уведомления</p>
          )}
          {adminPushStatus === "denied" && (
            <p className="text-sm text-destructive">Разрешение отклонено. Включите уведомления в настройках браузера и обновите страницу.</p>
          )}
          {adminPushStatus === "subscribed" ? (
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="gap-1.5 text-green-700 bg-green-100 dark:bg-green-950 dark:text-green-400">
                <Bell className="w-3 h-3" />
                Алерты включены
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAdminUnsubscribe}
                disabled={adminUnsubscribeMutation.isPending}
                data-testid="button-admin-push-unsubscribe"
              >
                <BellOff className="w-3.5 h-3.5 mr-1.5" />
                Отключить
              </Button>
            </div>
          ) : (
            <Button
              onClick={handleAdminSubscribe}
              disabled={adminPushStatus === "pending" || adminSubscribeMutation.isPending}
              data-testid="button-admin-push-subscribe"
            >
              <Bell className="w-4 h-4 mr-2" />
              {adminPushStatus === "pending" ? "Ожидание разрешения…" : "Подписаться на алерты"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="w-4 h-4" />
            Отправить push клиентам
          </CardTitle>
          <CardDescription>
            Ручная рассылка всем клиентам, подписавшимся на уведомления через сайт.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-sm font-medium mb-1 block">Заголовок</label>
            <Input
              value={pushForm.title}
              onChange={(e) => setPushForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Новая коллекция уже здесь 🔥"
              data-testid="input-push-title"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Текст</label>
            <Textarea
              value={pushForm.body}
              onChange={(e) => setPushForm(f => ({ ...f, body: e.target.value }))}
              placeholder="Смотри новинки в каталоге"
              rows={2}
              data-testid="input-push-body"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Ссылка (необязательно)</label>
            <Input
              value={pushForm.url}
              onChange={(e) => setPushForm(f => ({ ...f, url: e.target.value }))}
              placeholder="https://booomerangs.ru/catalog"
              data-testid="input-push-url"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 flex items-center gap-1.5">
              <Image className="w-3.5 h-3.5" />
              Картинка (необязательно)
            </label>
            <Input
              value={pushForm.image}
              onChange={(e) => setPushForm(f => ({ ...f, image: e.target.value }))}
              placeholder="/push-banner.png или https://..."
              data-testid="input-push-image"
            />
            <p className="text-xs text-muted-foreground mt-1">Отображается под текстом уведомления. Используйте /push-banner.png для баннера.</p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              onClick={handleSendPush}
              disabled={pushSendMutation.isPending || pushTestMutation.isPending}
              data-testid="button-push-send"
            >
              <Send className="w-4 h-4 mr-2" />
              {pushSendMutation.isPending ? "Отправка…" : `Отправить всем (${clientStatsQuery.data?.total ?? "…"})`}
            </Button>
            <Button
              variant="outline"
              onClick={handleTestPush}
              disabled={pushSendMutation.isPending || pushTestMutation.isPending}
              data-testid="button-push-test"
            >
              <FlaskConical className="w-4 h-4 mr-2" />
              {pushTestMutation.isPending ? "Отправка…" : "Тест на себя"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* История рассылок */}
      {(historyQuery.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
              <History className="w-4 h-4" />
              История рассылок (последние {historyQuery.data?.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {historyQuery.data?.map((entry, i) => (
              <div key={i} className="flex items-start justify-between gap-3 text-sm border-b last:border-0 pb-2 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium truncate">{entry.title}</p>
                  <p className="text-muted-foreground truncate text-xs">{entry.body}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {new Date(entry.sentAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Badge variant="secondary" className="text-green-700 bg-green-100 dark:bg-green-950 dark:text-green-400 text-xs">
                    ✓ {entry.sent}
                  </Badge>
                  {entry.failed > 0 && (
                    <Badge variant="secondary" className="text-red-700 bg-red-100 dark:bg-red-950 dark:text-red-400 text-xs">
                      ✗ {entry.failed}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
