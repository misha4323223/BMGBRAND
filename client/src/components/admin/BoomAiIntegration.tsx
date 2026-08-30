import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "@/lib/admin-fetch";
import { Bot, Loader2, Settings2 } from "lucide-react";

// «BOOM AI» — локальная модель (Ollama) в чат-виджете. Переключатель в админке
// (Интеграции) показывает/скрывает режим «BOOM AI» у клиентов.
export function BooomaAiIntegration({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const [toggling, setToggling] = useState(false);

  const settingsQuery = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/admin/booom-ai/settings"],
    enabled: !!apiKey,
  });

  const enabled = settingsQuery.data?.enabled ?? true;

  async function handleToggle() {
    setToggling(true);
    try {
      await adminFetch("/api/admin/booom-ai/settings", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      toast({ title: enabled ? "BOOM AI скрыт из чата" : "BOOM AI показан в чате" });
      settingsQuery.refetch();
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-white/10 border-b border-muted px-5 py-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-base flex items-center gap-2">BOOM AI</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Локальная модель (Ollama на вашем ПК) в чат-виджете сайта. Настройка адреса/модели — через переменные окружения.
          </p>
        </div>
        <div className={`text-xs font-medium px-2.5 py-1 rounded-full ${
          enabled ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"
        }`}>
          {enabled ? "Включён" : "Скрыт"}
        </div>
      </div>

      <div className="p-5">
        {settingsQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
          </div>
        )}

        <div className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm font-medium">Показывать BOOM AI в чате</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Когда включено — у клиентов в чат-виджете есть кнопка «BOOM AI» (локальная модель).
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
              enabled ? "bg-primary" : "bg-muted-foreground/30"
            } disabled:opacity-60`}
            aria-label="Переключить BOOM AI"
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
        </div>

        <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2.5 space-y-1">
          <div className="font-medium text-foreground flex items-center gap-1.5">
            <Settings2 className="w-3 h-3" /> Где настраивается модель
          </div>
          <div className="space-y-0.5 font-mono">
            <div>OLLAMA_BASE_URL — адрес туннеля к ПК</div>
            <div>OLLAMA_MODEL — модель в Ollama (напр. qwen2.5:3b)</div>
          </div>
        </div>
      </div>
    </div>
  );
}