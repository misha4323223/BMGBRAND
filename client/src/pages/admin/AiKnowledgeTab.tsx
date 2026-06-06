import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Save, RotateCcw, RefreshCw, Bot, Truck, CreditCard, ArrowLeftRight, Ruler, Shirt, Handshake, Star, Building2, Gift } from "lucide-react";

const BLOCK_META: Record<string, { label: string; desc: string; icon: any }> = {
  ai_prompt_base:      { label: "Базовый промт",            desc: "Личность, тон, правила поведения и информация о бренде. Используется в каждом запросе.",                    icon: Bot },
  ai_block_delivery:   { label: "Доставка",                 desc: "СДЭК, Яндекс Доставка, сроки, стоимость, отслеживание. Подключается при вопросах о доставке.",             icon: Truck },
  ai_block_payment:    { label: "Оплата",                   desc: "ЮKassa, Т-Банк, Ozon Pay, рассрочка. Подключается при вопросах об оплате.",                                icon: CreditCard },
  ai_block_returns:    { label: "Возврат и обмен",          desc: "Условия возврата, сроки, порядок оформления. Подключается при вопросах о возврате.",                        icon: ArrowLeftRight },
  ai_block_sizing:     { label: "Размеры",                  desc: "Размерная сетка, рекомендации, особенности. Подключается при вопросах о размерах.",                        icon: Ruler },
  ai_block_merch_order:{ label: "Мерч на заказ",            desc: "Корпоративный мерч, тиражи, сроки, клиенты. Подключается при вопросах о производстве мерча.",              icon: Shirt },
  ai_block_partner:    { label: "Партнёрская программа",    desc: "Реферальная программа, комиссии, инструменты партнёра. Подключается при вопросах о партнёрке.",            icon: Handshake },
  ai_block_artist:     { label: "Платформа для артистов",   desc: "Персональные страницы /@slug, витрина мерча, аналитика. Подключается при вопросах об артист-платформе.",  icon: Star },
  ai_block_wholesale:  { label: "Оптовые закупки",          desc: "B2B условия, регистрация, XML-фид. Подключается при вопросах об оптовых закупках.",                        icon: Building2 },
  ai_block_giftcards:  { label: "Подарочные сертификаты",   desc: "Покупка, использование, особенности сертификатов. Подключается при вопросах о сертификатах.",              icon: Gift },
};

const ORDERED_KEYS = [
  "ai_prompt_base",
  "ai_block_delivery",
  "ai_block_payment",
  "ai_block_returns",
  "ai_block_sizing",
  "ai_block_merch_order",
  "ai_block_partner",
  "ai_block_artist",
  "ai_block_wholesale",
  "ai_block_giftcards",
] as const;

type AiKey = typeof ORDERED_KEYS[number];

interface AiKnowledgeTabProps {
  apiKey: string;
  adminFetch: (url: string, apiKey: string, options?: RequestInit) => Promise<Response>;
}

export function AiKnowledgeTab({ apiKey, adminFetch }: AiKnowledgeTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<{ blocks: Record<string, string>; defaults: Record<string, string> }>({
    queryKey: ["/api/admin/ai-knowledge"],
    queryFn: async () => {
      const res = await adminFetch("/api/admin/ai-knowledge", apiKey);
      if (!res.ok) throw new Error("Ошибка загрузки");
      return res.json();
    },
    enabled: !!apiKey,
  });

  function getValue(key: string): string {
    if (key in drafts) return drafts[key];
    return data?.blocks?.[key] ?? "";
  }

  function isDirty(key: string): boolean {
    return key in drafts && drafts[key] !== (data?.blocks?.[key] ?? "");
  }

  async function handleSave(key: AiKey) {
    const value = getValue(key);
    setSaving(key);
    try {
      const res = await adminFetch(`/api/admin/ai-knowledge/${key}`, apiKey, {
        method: "POST",
        body: JSON.stringify({ value }),
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Ошибка сохранения");
      setDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
      await qc.invalidateQueries({ queryKey: ["/api/admin/ai-knowledge"] });
      toast({ title: "Сохранено", description: `Блок «${BLOCK_META[key].label}» обновлён` });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  async function handleReset(key: AiKey) {
    setResetting(key);
    try {
      const res = await adminFetch(`/api/admin/ai-knowledge/${key}/reset`, apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Ошибка сброса");
      const json = await res.json();
      setDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
      await qc.invalidateQueries({ queryKey: ["/api/admin/ai-knowledge"] });
      toast({ title: "Сброшено", description: `Блок «${BLOCK_META[key].label}» восстановлен по умолчанию` });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setResetting(null);
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Загрузка блоков знаний...
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Bot className="w-5 h-5" />
            Знания AI-ассистента
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            AI получает базовый промт + тематический блок в зависимости от темы вопроса. Редактируй без деплоя.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-ai-knowledge-refresh">
          <RefreshCw className="w-4 h-4 mr-1" />
          Обновить
        </Button>
      </div>

      <div className="grid gap-1 text-xs text-muted-foreground bg-muted/40 border rounded-lg p-3">
        <p className="font-medium text-foreground mb-1">Как это работает:</p>
        <p>• <b>Базовый промт</b> — отправляется всегда</p>
        <p>• <b>Тематические блоки</b> — подключаются автоматически по ключевым словам в вопросе пользователя</p>
        <p>• Итоговый промт в Groq: ~600–900 токенов вместо 4000+. Кэш обновляется каждые 5 минут.</p>
      </div>

      {ORDERED_KEYS.map((key) => {
        const meta = BLOCK_META[key];
        const Icon = meta.icon;
        const dirty = isDirty(key);
        const isSaving = saving === key;
        const isResetting = resetting === key;

        return (
          <Card key={key} className={dirty ? "border-amber-400/60" : ""}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <CardTitle className="text-sm">{meta.label}</CardTitle>
                    <CardDescription className="text-xs mt-0.5">{meta.desc}</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {dirty && <Badge variant="outline" className="text-amber-600 border-amber-400 text-xs">Не сохранено</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleReset(key)}
                    disabled={isResetting || isSaving}
                    data-testid={`button-ai-reset-${key}`}
                  >
                    {isResetting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    <span className="ml-1">По умолчанию</span>
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={() => handleSave(key)}
                    disabled={!dirty || isSaving || isResetting}
                    data-testid={`button-ai-save-${key}`}
                  >
                    {isSaving ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                    Сохранить
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Textarea
                value={getValue(key)}
                onChange={e => setDrafts(prev => ({ ...prev, [key]: e.target.value }))}
                rows={key === "ai_prompt_base" ? 12 : 8}
                className="font-mono text-xs resize-y"
                placeholder="Введите текст блока..."
                data-testid={`textarea-ai-${key}`}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {getValue(key).length} символов · ~{Math.round(getValue(key).length / 4)} токенов
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
