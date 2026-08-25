import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, ShoppingCart } from "lucide-react";

export function AbandonedCartTriggerButton() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleTrigger = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/admin/trigger-abandoned-cart");
      const data = await res.json();
      toast({ title: "Запущено", description: data.message });
    } catch {
      toast({ title: "Ошибка", description: "Не удалось запустить проверку", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleClearReminders = async () => {
    if (!confirm("Сбросить все cooldown-записи? После этого письма будут отправлены повторно всем пользователям с непустой корзиной.")) return;
    setClearing(true);
    try {
      const res = await apiRequest("POST", "/api/admin/clear-cart-reminders");
      const data = await res.json();
      toast({ title: "Готово", description: data.message });
    } catch {
      toast({ title: "Ошибка", description: "Не удалось сбросить cooldown", variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={handleTrigger} disabled={loading} data-testid="button-trigger-abandoned-cart">
        {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShoppingCart className="w-4 h-4 mr-2" />}
        Запустить проверку сейчас
      </Button>
      <Button variant="outline" onClick={handleClearReminders} disabled={clearing} data-testid="button-clear-cart-reminders">
        {clearing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
        Сбросить cooldown (38 заблокированы)
      </Button>
      <p className="text-sm text-muted-foreground">Результат появится в логах сервера</p>
    </div>
  );
}

