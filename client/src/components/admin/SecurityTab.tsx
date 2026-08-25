import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Lock, RefreshCw, CheckCircle2 } from "lucide-react";

export function SecurityTab({ adminKey }: { adminKey: string }) {
  const { toast } = useToast();

  const syncStatusQuery = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/admin/1c-sync-status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/1c-sync-status", {
        headers: { "x-api-key": adminKey },
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to fetch sync status");
      return res.json();
    },
  });

  const toggleSyncMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/admin/1c-sync-toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": adminKey,
        },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle sync");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/1c-sync-status"] });
      toast({
        title: data.enabled ? "1С синхронизация включена" : "1С синхронизация отключена",
        description: data.enabled
          ? "Сервер принимает данные от 1С"
          : "Все запросы от 1С будут отклонены",
      });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось изменить статус", variant: "destructive" });
    },
  });

  const isEnabled = syncStatusQuery.data?.enabled ?? false;

  return (
    <div className="space-y-6">
      <Card className="bg-zinc-900 border-zinc-800 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Безопасность
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-zinc-400" />
                <span className="font-medium">Приём данных из 1С</span>
              </div>
              <p className="text-sm text-zinc-400">
                {isEnabled
                  ? "Сервер принимает данные от 1С. Отключите после завершения синхронизации."
                  : "Сервер отклоняет все запросы от 1С. Включите перед синхронизацией."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={isEnabled ? "default" : "outline"} className={isEnabled ? "bg-green-600" : ""}>
                {isEnabled ? "ВКЛ" : "ВЫКЛ"}
              </Badge>
              <Switch
                checked={isEnabled}
                onCheckedChange={(checked) => toggleSyncMutation.mutate(checked)}
                disabled={toggleSyncMutation.isPending}
                data-testid="switch-1c-sync"
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">Активные меры защиты</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                "Двухфакторная админ-авторизация (JWT + API-ключ)",
                "CORS — ограничение разрешённых доменов",
                "Secure cookies — httpOnly, secure, sameSite",
                "Helmet — security-заголовки (XSS, HSTS и др.)",
                "Rate-limit — логин/регистрация (10 попыток / 15 мин)",
                "Rate-limit — админ-верификация (5 попыток / 15 мин, блокировка IP)",
                "bcrypt — хеширование паролей (salt rounds: 10)",
                "JWT — авторизация через httpOnly cookie",
                "Подтверждение email — обязательная верификация при регистрации",
                "YooKassa — проверка IP-адреса webhook",
                "T-Bank — проверка SHA-256 подписи webhook",
                "1C — доступ только через переключатель в админке",
                "Zod — валидация входящих данных на сервере",
                "API-ключ — защита эндпоинтов синхронизации",
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 p-3 rounded-lg bg-zinc-800/30 border border-zinc-700/50">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-sm">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

