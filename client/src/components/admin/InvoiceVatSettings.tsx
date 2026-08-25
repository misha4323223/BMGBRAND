import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "@/lib/admin-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Settings, Save, Loader2 } from "lucide-react";

export function InvoiceVatSettings({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const [vatRate, setVatRate] = useState<string>("5");
  const [vatMode, setVatMode] = useState<string>("included");
  const [vatLoaded, setVatLoaded] = useState(false);

  const { data: settingsData } = useQuery<Record<string, string>>({
    queryKey: ["/api/bonus-settings", "vat"],
    queryFn: async () => adminFetch("/api/bonus-settings", apiKey),
    enabled: !!apiKey,
  });

  useEffect(() => {
    if (settingsData && !vatLoaded) {
      const storedRate = settingsData["invoice_vat_rate"];
      if (storedRate) setVatRate(storedRate);
      const storedMode = settingsData["invoice_vat_mode"];
      if (storedMode === "on_top" || storedMode === "included") setVatMode(storedMode);
      setVatLoaded(true);
    }
  }, [settingsData, vatLoaded]);

  const saveVatMutation = useMutation({
    mutationFn: async ({ rate, mode }: { rate: string; mode: string }) => {
      const num = parseFloat(rate);
      if (isNaN(num) || num < 0 || num > 100) {
        throw new Error("Значение НДС должно быть от 0 до 100");
      }
      await adminFetch("/api/bonus-settings", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "invoice_vat_rate", value: String(num) }),
      });
      await adminFetch("/api/bonus-settings", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "invoice_vat_mode", value: mode }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bonus-settings"] });
      toast({ title: "Сохранено", description: "Настройки НДС обновлены" });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Ошибка", description: "Не удалось сохранить настройки НДС" });
    },
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">Настройки НДС в счетах</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="vat-rate" className="text-sm text-muted-foreground whitespace-nowrap">Ставка:</Label>
            <Input
              id="vat-rate"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
              className="w-20 text-center"
              data-testid="input-vat-rate"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">Режим:</Label>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={vatMode === "included" ? "default" : "outline"}
                onClick={() => setVatMode("included")}
                data-testid="button-vat-included"
              >
                В том числе
              </Button>
              <Button
                size="sm"
                variant={vatMode === "on_top" ? "default" : "outline"}
                onClick={() => setVatMode("on_top")}
                data-testid="button-vat-on-top"
              >
                Сверху
              </Button>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => saveVatMutation.mutate({ rate: vatRate, mode: vatMode })}
            disabled={saveVatMutation.isPending}
            data-testid="button-save-vat"
          >
            {saveVatMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
            Сохранить
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {vatMode === "included"
            ? "НДС включён в сумму — итоговая сумма не меняется, НДС выделяется из неё"
            : "НДС сверху суммы — к итогу добавляется сумма НДС, покупатель платит больше"}
        </p>
      </CardContent>
    </Card>
  );
}

