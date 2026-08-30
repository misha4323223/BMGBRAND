import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "@/lib/admin-fetch";
import { BrainCog, Loader2, Sparkles } from "lucide-react";

// Облачный AI-чат (Groq) в чат-виджете. Переключатель в админке (Интеграции)
// показывает/скрывает режим «AI» у клиентов ВНУТРИ чат-виджета. Другие AI-фичи
// (подбор размера, proactive) не затрагивает.
export function AiChatIntegration({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const [toggling, setToggling] = useState(false);

  const settingsQuery = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/admin/ai-chat/settings"],
    enabled: !!apiKey,
  });

  const enabled = settingsQuery.data?.enabled ?? true;

  async function handleToggle() {
    setToggling(true);
    try {
      await adminFetch("/api/admin/ai-chat/settings", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      toast({ title: enabled ? "AI-чат скрыт из чата" : "AI-чат показан в чате" });
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
      <div className="bg-[#7C3AED]/10 border-b border-[#7C3AED]/20 px-5 py-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-[#7C3AED] flex items-center justify-center flex-shrink-0">
          <BrainCog className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-base flex items-center gap-2">AI-чат (облачный)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ответы ассистента BOOOMERANGS через Groq в чат-виджете. Скрывает только режим «AI» внутри виджета — другие AI-фичи не затрагивает.
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
            <div className="text-sm font-medium">Показывать AI-чат в виджете</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Когда выключено — у клиентов в чат-виджете нет режима «AI» (остаётся менеджер, а при включённом BOOM AI — он заменяет AI).
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/50 ${
              enabled ? "bg-[#7C3AED]" : "bg-muted-foreground/30"
            } disabled:opacity-60`}
            aria-label="Переключить AI-чат"
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
        </div>

        <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2.5 space-y-1">
          <div className="font-medium text-foreground flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Как это связано с BOOM AI
          </div>
          <ul className="list-disc list-inside space-y-1">
            <li>AI-чат вкл → в виджете режим «AI» (может быть рядом и BOOM AI).</li>
            <li>AI-чат выкл + BOOM AI вкл → в виджете режим «BOOM AI» вместо AI.</li>
            <li>Оба выкл → в виджете остаётся только менеджер.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}