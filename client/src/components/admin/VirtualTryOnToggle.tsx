import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

interface Props {
  apiKey: string;
}

export default function VirtualTryOnToggle({ apiKey }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [toggling, setToggling] = useState(false);

  const { data, isLoading } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/admin/virtual-tryon/settings"],
    enabled: !!apiKey,
    queryFn: async () => {
      const res = await fetch("/api/admin/virtual-tryon/settings", {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  async function handleToggle(enable: boolean) {
    setToggling(true);
    try {
      const res = await fetch("/api/admin/virtual-tryon/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ enabled: enable }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: enable ? "АР-примерка включена" : "АР-примерка отключена" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/virtual-tryon/settings"] });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setToggling(false);
    }
  }

  const enabled = data?.enabled ?? true;

  return (
    <Card className="border border-zinc-800 bg-zinc-900 text-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          👗 АР-примерка (Virtual Try-On)
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="text-sm text-zinc-400">
          {enabled
            ? "Кнопка «Примерить» отображается на карточках товаров"
            : "Кнопка «Примерить» скрыта для покупателей"}
        </div>
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
        ) : (
          <button
            onClick={() => handleToggle(!enabled)}
            disabled={toggling}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              enabled ? "bg-blue-600" : "bg-zinc-600"
            } ${toggling ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        )}
      </CardContent>
    </Card>
  );
}
