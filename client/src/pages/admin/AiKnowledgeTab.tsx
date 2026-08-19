import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Save, RotateCcw, RefreshCw, Bot, Truck, CreditCard, ArrowLeftRight, Ruler, Shirt, Handshake, Star, Building2, Gift, BarChart2, Trash2, Package, Trophy, Tag, User, Briefcase, Flame, LayoutGrid } from "lucide-react";
import { AdminAgentChat } from "./AdminAgentChat";

const BLOCK_META: Record<string, { label: string; desc: string; icon: any }> = {
  ai_prompt_base:      { label: "Базовый промт",            desc: "Личность, тон, правила поведения и информация о бренде. Используется в каждом запросе.",                    icon: Bot },
  ai_block_assortment: { label: "Ассортимент магазина",     desc: "Полный список категорий и подкатегорий. Используется в КАЖДОМ запросе — не даёт ИИ выдумывать несуществующие товары.", icon: LayoutGrid },
  ai_block_delivery:   { label: "Доставка",                 desc: "СДЭК, сроки, стоимость, отслеживание. Подключается при вопросах о доставке.",             icon: Truck },
  ai_block_payment:    { label: "Оплата",                   desc: "ЮKassa, Т-Банк, Ozon Pay, рассрочка. Подключается при вопросах об оплате.",                                icon: CreditCard },
  ai_block_returns:    { label: "Возврат и обмен",          desc: "Условия возврата, сроки, порядок оформления. Подключается при вопросах о возврате.",                        icon: ArrowLeftRight },
  ai_block_sizing:     { label: "Размеры",                  desc: "Размерная сетка, рекомендации, особенности. Подключается при вопросах о размерах.",                        icon: Ruler },
  ai_block_merch_order:{ label: "Мерч на заказ",            desc: "Корпоративный мерч, тиражи, сроки, клиенты. Подключается при вопросах о производстве мерча.",              icon: Shirt },
  ai_block_partner:    { label: "Партнёрская программа",    desc: "Реферальная программа, комиссии, инструменты партнёра. Подключается при вопросах о партнёрке.",            icon: Handshake },
  ai_block_artist:     { label: "Платформа для артистов",   desc: "Персональные страницы /@slug, витрина мерча, аналитика. Подключается при вопросах об артист-платформе.",  icon: Star },
  ai_block_wholesale:  { label: "Оптовые закупки",          desc: "B2B условия, регистрация, XML-фид. Подключается при вопросах об оптовых закупках.",                        icon: Building2 },
  ai_block_giftcards:  { label: "Подарочные сертификаты",   desc: "Покупка, использование, особенности сертификатов. Подключается при вопросах о сертификатах.",              icon: Gift },
  ai_block_predrop:    { label: "Pre-drop (Предзаказ)",      desc: "Концепция, цена, сроки, отмена, доставка. Подключается при вопросах о предзаказах.",                       icon: Package },
  ai_block_loyalty:    { label: "Программа лояльности",      desc: "Уровни 1–5, автоматические скидки 5–20%. Подключается при вопросах о скидках по сумме покупок.",       icon: Trophy },
  ai_block_promo:      { label: "Промокоды",                 desc: "Как ввести, совмещение с лояльностью и сертификатами. Подключается при вопросах о промокодах.",             icon: Tag },
  ai_block_account:    { label: "Личный кабинет",            desc: "История заказов, отслеживание, профиль, избранное. Подключается при вопросах о кабинете.",                  icon: User },
  ai_block_vacancies:  { label: "Вакансии",                  desc: "Работа в BOOOMERANGS, открытые позиции. Подключается при вопросах о трудоустройстве.",                     icon: Briefcase },
  ai_block_brand:      { label: "О бренде",                  desc: "История, философия, производство, мерч, коллаборации. Подключается при вопросах о бренде, Туле, основателе.", icon: Flame },
};

const ORDERED_KEYS = [
  "ai_prompt_base",
  "ai_block_assortment",
  "ai_block_delivery",
  "ai_block_payment",
  "ai_block_returns",
  "ai_block_sizing",
  "ai_block_merch_order",
  "ai_block_partner",
  "ai_block_artist",
  "ai_block_wholesale",
  "ai_block_giftcards",
  "ai_block_predrop",
  "ai_block_loyalty",
  "ai_block_promo",
  "ai_block_account",
  "ai_block_vacancies",
  "ai_block_brand",
] as const;

type AiKey = typeof ORDERED_KEYS[number];

const TRIGGER_LABELS: Record<string, string> = {
  home_newuser:       "🏠 Главная — новый пользователь (20 сек)",
  product_time:       "📦 Карточка товара — долгий просмотр (35 сек)",
  product_outofstock: "📦 Карточка товара — нет в наличии (5 сек)",
  cart_time:          "🛒 Корзина — без оформления (60 сек)",
  checkout_time:      "💳 Чекаут — завис (90 сек)",
  catalog_browse:     "🔍 Каталог — долгий просмотр (2 мин)",
  exit_intent:        "🚪 Exit Intent — попытка уйти",
};

interface ProactiveStat { shown: number; clicked: number; dismissed: number; }
interface ProactiveStatsData { stats: Record<string, ProactiveStat>; }

interface AiKnowledgeTabProps {
  apiKey: string;
  adminFetch: (url: string, apiKey: string, options?: RequestInit) => Promise<any>;
}

export function AiKnowledgeTab({ apiKey, adminFetch }: AiKnowledgeTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resettingStats, setResettingStats] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<{ blocks: Record<string, string>; defaults: Record<string, string> }>({
    queryKey: ["/api/admin/ai-knowledge"],
    queryFn: () => adminFetch("/api/admin/ai-knowledge", apiKey),
    enabled: !!apiKey,
  });

  const { data: statsData, refetch: refetchStats } = useQuery<ProactiveStatsData>({
    queryKey: ["/api/admin/ai-proactive-stats"],
    queryFn: () => adminFetch("/api/admin/ai-proactive-stats", apiKey),
    enabled: !!apiKey,
    refetchInterval: 30000,
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
      await adminFetch(`/api/admin/ai-knowledge/${key}`, apiKey, {
        method: "POST",
        body: JSON.stringify({ value }),
      });
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
      await adminFetch(`/api/admin/ai-knowledge/${key}/reset`, apiKey, {
        method: "POST",
      });
      setDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
      await qc.invalidateQueries({ queryKey: ["/api/admin/ai-knowledge"] });
      toast({ title: "Сброшено", description: `Блок «${BLOCK_META[key].label}» восстановлен по умолчанию` });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setResetting(null);
    }
  }

  async function handleResetStats() {
    setResettingStats(true);
    try {
      await adminFetch("/api/admin/ai-proactive-stats/reset", apiKey, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["/api/admin/ai-proactive-stats"] });
      toast({ title: "Статистика сброшена" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setResettingStats(false);
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

  if (error) {
    return (
      <div className="p-6 text-destructive">
        Ошибка загрузки: {(error as Error).message}
      </div>
    );
  }

  const stats = statsData?.stats ?? {};
  const triggerKeys = Object.keys(TRIGGER_LABELS);
  const totalShown = triggerKeys.reduce((s, k) => s + (stats[k]?.shown ?? 0), 0);
  const totalClicked = triggerKeys.reduce((s, k) => s + (stats[k]?.clicked ?? 0), 0);
  const totalDismissed = triggerKeys.reduce((s, k) => s + (stats[k]?.dismissed ?? 0), 0);
  const globalCtr = totalShown > 0 ? ((totalClicked / totalShown) * 100).toFixed(1) : "—";

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
        <p>• <b>Ассортимент магазина</b> — отправляется всегда (не даёт ИИ выдумывать несуществующие товары)</p>
        <p>• <b>Тематические блоки</b> — подключаются автоматически по ключевым словам в вопросе пользователя</p>
        <p>• Итоговый промт в Groq: ~600–900 токенов. Кэш обновляется каждые 5 минут.</p>
      </div>

      {/* Admin Agent Chat */}
      <AdminAgentChat apiKey={apiKey} adminFetch={adminFetch} />

      {/* Proactive chat stats */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-muted-foreground" />
              <div>
                <CardTitle className="text-sm">Проактивный чат — статистика</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Сколько раз пузырь появлялся, сколько кликов и отклонений. Обновляется раз в 30 сек.
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => refetchStats()} data-testid="button-proactive-stats-refresh">
                <RefreshCw className="w-3 h-3 mr-1" />
                Обновить
              </Button>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={handleResetStats} disabled={resettingStats} data-testid="button-proactive-stats-reset">
                {resettingStats ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                Сбросить
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Summary row */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: "Показов", value: totalShown, color: "text-foreground" },
              { label: "Кликов", value: totalClicked, color: "text-emerald-600" },
              { label: "Отклонений", value: totalDismissed, color: "text-amber-600" },
              { label: "CTR", value: `${globalCtr}%`, color: totalShown > 0 && parseFloat(globalCtr) >= 10 ? "text-emerald-600" : "text-foreground" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-muted/40 rounded-xl p-3 text-center border">
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Per-trigger table */}
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/40 border-b">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Триггер</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground w-16">Показов</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground w-16">Кликов</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground w-20">Откл.</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground w-16">CTR</th>
                </tr>
              </thead>
              <tbody>
                {triggerKeys.map((key, i) => {
                  const s = stats[key] ?? { shown: 0, clicked: 0, dismissed: 0 };
                  const ctr = s.shown > 0 ? ((s.clicked / s.shown) * 100).toFixed(1) + "%" : "—";
                  const isEmpty = s.shown === 0;
                  return (
                    <tr key={key} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <td className="px-3 py-2 text-foreground">{TRIGGER_LABELS[key] ?? key}</td>
                      <td className={`px-3 py-2 text-right font-mono ${isEmpty ? "text-muted-foreground/40" : "text-foreground"}`}>{s.shown}</td>
                      <td className={`px-3 py-2 text-right font-mono ${s.clicked > 0 ? "text-emerald-600 font-semibold" : "text-muted-foreground/40"}`}>{s.clicked}</td>
                      <td className={`px-3 py-2 text-right font-mono ${s.dismissed > 0 ? "text-amber-600" : "text-muted-foreground/40"}`}>{s.dismissed}</td>
                      <td className={`px-3 py-2 text-right font-mono ${s.clicked > 0 && parseFloat(ctr) >= 10 ? "text-emerald-600 font-semibold" : "text-muted-foreground"}`}>{ctr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            CTR (click-through rate) — % пользователей, кликнувших по пузырю. Цель: &gt;10%.
          </p>
        </CardContent>
      </Card>

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
