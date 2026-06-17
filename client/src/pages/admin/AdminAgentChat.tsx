import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Bot, Send, CheckCircle2, XCircle, Loader2, Sparkles, Terminal,
  ListTodo, ScrollText, Settings2, Play, RefreshCw, Clock, Zap,
  Mail, Eye, EyeOff, Users, ChevronDown, ChevronUp, Percent,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: { tool: string; params: any; description: string };
}

interface QueueItem {
  id: string;
  type: string;
  title: string;
  description: string;
  params: any;
  tool: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected" | "executed";
  executedAt?: string;
  error?: string;
}

interface LogEntry {
  id: string;
  type: string;
  action: string;
  summary: string;
  createdAt: string;
  isAuto: boolean;
}

interface AgentSettings {
  enabled: boolean;
  seoEnabled: boolean;
  alertsEnabled: boolean;
  digestEnabled: boolean;
}

interface AdminAgentChatProps {
  apiKey: string;
  adminFetch: (url: string, apiKey: string, options?: RequestInit) => Promise<any>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  discount: "💸 Скидка",
  description: "📝 Описание",
  hide_product: "👁 Скрыть товар",
  seo: "🔍 SEO",
  blog_draft: "✍️ Блог",
  review_reply: "💬 Отзыв",
  promo_code: "🎟 Промокод",
  seo_batch: "🔍 SEO батч",
  digest: "📊 Дайджест",
  knowledge_gap: "🧠 Пробел в знаниях",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-300",
  approved: "bg-blue-100 text-blue-700 border-blue-300",
  rejected: "bg-red-100 text-red-700 border-red-300",
  executed: "bg-emerald-100 text-emerald-700 border-emerald-300",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает",
  approved: "Одобрено",
  rejected: "Отклонено",
  executed: "Выполнено",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AdminAgentChat({ apiKey, adminFetch }: AdminAgentChatProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"chat" | "queue" | "log" | "settings">("chat");

  // ── Chat state ──
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: "welcome",
    role: "assistant",
    content: "Привет! Я AI-ассистент администратора. Могу искать и обновлять товары, управлять промокодами, смотреть заказы и статистику.\n\nПримеры:\n• «Найди все толстовки»\n• «Покажи последние 5 заказов»\n• «Создай промокод ЛЕТО20 на 20%»\n• «Покажи статистику магазина»",
  }]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── cart_promo editor state ──
  const [cartPromoEdits, setCartPromoEdits] = useState<Record<string, {
    discount: number;
    validityHours: number;
    emailSubject: string;
    emailBody: string;
  }>>({});
  const [cartPromoShowAll, setCartPromoShowAll] = useState<Record<string, boolean>>({});
  const [cartPromoShowPreview, setCartPromoShowPreview] = useState<Record<string, boolean>>({});

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Queue data ──
  const { data: queueData, refetch: refetchQueue, isLoading: queueLoading } = useQuery<{ items: QueueItem[] }>({
    queryKey: ["/api/admin/agent-queue"],
    queryFn: () => adminFetch("/api/admin/agent-queue", apiKey),
    enabled: !!apiKey && activeTab === "queue",
    refetchInterval: activeTab === "queue" ? 15000 : false,
  });

  // ── Log data ──
  const { data: logData, refetch: refetchLog, isLoading: logLoading } = useQuery<{ log: LogEntry[] }>({
    queryKey: ["/api/admin/autonomous-agent/log"],
    queryFn: () => adminFetch("/api/admin/autonomous-agent/log", apiKey),
    enabled: !!apiKey && activeTab === "log",
  });

  // ── Agent status + settings ──
  const { data: statusData, refetch: refetchStatus } = useQuery<{
    status: { lastRun: string; lastResult: string };
    settings: AgentSettings;
    pendingCount: number;
  }>({
    queryKey: ["/api/admin/autonomous-agent/status"],
    queryFn: () => adminFetch("/api/admin/autonomous-agent/status", apiKey),
    enabled: !!apiKey && activeTab === "settings",
  });

  const [settingsSaving, setSettingsSaving] = useState(false);
  const [localSettings, setLocalSettings] = useState<AgentSettings | null>(null);
  const [runningJob, setRunningJob] = useState<string | null>(null);

  const settings: AgentSettings = localSettings ?? statusData?.settings ?? {
    enabled: true, seoEnabled: true, alertsEnabled: true, digestEnabled: true,
  };

  // ── Chat functions ──
  const historyForApi = () =>
    messages.filter((m) => !m.pending).slice(-12).map((m) => ({ role: m.role, content: m.content }));

  async function handleSend() {
    const text = input.trim();
    if (!text || chatLoading) return;
    setInput("");
    const userMsg: ChatMessage = { id: `u_${Date.now()}`, role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);
    try {
      const res = await adminFetch("/api/admin/agent/chat", apiKey, {
        method: "POST",
        body: JSON.stringify({ command: text, history: historyForApi() }),
      });
      const assistantId = `a_${Date.now()}`;
      if (res.type === "write") {
        setMessages((prev) => [...prev, {
          id: assistantId, role: "assistant", content: res.description,
          pending: { tool: res.tool, params: res.params, description: res.description },
        }]);
      } else {
        setMessages((prev) => [...prev, {
          id: assistantId, role: "assistant", content: res.text || res.result || "Готово.",
        }]);
      }
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setChatLoading(false);
    }
  }

  async function handleConfirm(msgId: string, pending: ChatMessage["pending"]) {
    if (!pending) return;
    setExecutingId(msgId);
    try {
      const res = await adminFetch("/api/admin/agent/execute", apiKey, {
        method: "POST",
        body: JSON.stringify({ tool: pending.tool, params: pending.params }),
      });
      setMessages((prev) =>
        prev.map((m) => m.id === msgId ? { ...m, pending: undefined, content: res.result || "✅ Выполнено." } : m)
      );
    } catch (e: any) {
      toast({ title: "Ошибка выполнения", description: e.message, variant: "destructive" });
    } finally {
      setExecutingId(null);
    }
  }

  function handleChatCancel(msgId: string) {
    setMessages((prev) =>
      prev.map((m) => m.id === msgId ? { ...m, pending: undefined, content: "❌ Операция отменена." } : m)
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  // ── Queue functions ──
  async function handleQueueAction(itemId: string, action: "approve" | "reject", paramsOverride?: Record<string, any>) {
    try {
      await adminFetch(`/api/admin/agent-queue/${itemId}/${action}`, apiKey, {
        method: "POST",
        ...(paramsOverride ? { body: JSON.stringify({ paramsOverride }) } : {}),
      });
      await qc.invalidateQueries({ queryKey: ["/api/admin/agent-queue"] });
      toast({ title: action === "approve" ? "✅ Подтверждено и выполнено" : "❌ Отклонено" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  }

  function getCartEdit(item: QueueItem) {
    return cartPromoEdits[item.id] ?? {
      discount: item.params?.discount ?? 12,
      validityHours: item.params?.validityHours ?? 48,
      emailSubject: item.params?.emailSubject ?? `Персональная скидка ${item.params?.discount ?? 12}% — специально для вас 🎁`,
      emailBody: item.params?.emailBody ?? `{name}, мы заметили, что вы присматривались к {item}. Держите персональный промокод — только для вас.`,
    };
  }

  function setCartEdit(itemId: string, patch: Partial<ReturnType<typeof getCartEdit>>) {
    setCartPromoEdits(prev => {
      const base = prev[itemId] ?? getCartEdit(allItems.find(i => i.id === itemId)!);
      return { ...prev, [itemId]: { ...base, ...patch } };
    });
  }

  // ── Settings functions ──
  async function handleSaveSettings() {
    setSettingsSaving(true);
    try {
      await adminFetch("/api/admin/autonomous-agent/settings", apiKey, {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setLocalSettings(null);
      await qc.invalidateQueries({ queryKey: ["/api/admin/autonomous-agent/status"] });
      toast({ title: "Настройки сохранены" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleRunJob(job: string) {
    setRunningJob(job);
    try {
      await adminFetch("/api/admin/autonomous-agent/run", apiKey, {
        method: "POST",
        body: JSON.stringify({ job }),
      });
      toast({ title: "Запущено", description: "Задача выполняется в фоне" });
      // После запуска анализа корзин — переходим на Лог и обновляем его через 3 сек
      if (job === "cart_analysis") {
        setTimeout(() => {
          setActiveTab("log");
          refetchLog();
        }, 3000);
      }
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setRunningJob(null);
    }
  }

  // ── Tab data ──
  const pendingItems = queueData?.items?.filter((i) => i.status === "pending") ?? [];
  const allItems = queueData?.items ?? [];

  // ── Render ────────────────────────────────────────────────────────────────

  const tabs = [
    { id: "chat" as const, label: "Чат", icon: Bot },
    { id: "queue" as const, label: "Очередь", icon: ListTodo, badge: statusData?.pendingCount },
    { id: "log" as const, label: "Лог", icon: ScrollText },
    { id: "settings" as const, label: "Настройки", icon: Settings2 },
  ];

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm">BOOOM AI</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Ассистент + автономный агент магазина
            </CardDescription>
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 mt-3 border-b pb-0">
          {tabs.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t-md border border-b-0 transition-colors relative -mb-px ${
                activeTab === id
                  ? "bg-background border-border text-foreground font-medium"
                  : "bg-muted/40 border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`button-agent-tab-${id}`}
            >
              <Icon className="w-3 h-3" />
              {label}
              {badge != null && badge > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-0">

        {/* ── Chat tab ─────────────────────────────────────────────────── */}
        {activeTab === "chat" && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/20 h-72 overflow-y-auto p-3 space-y-3 text-sm">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && (
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : msg.pending
                        ? "bg-amber-50 border border-amber-200 text-foreground"
                        : "bg-background border text-foreground"
                  }`}>
                    {msg.pending ? (
                      <div className="space-y-2">
                        <p className="font-medium text-amber-700 flex items-center gap-1">
                          <Terminal className="w-3 h-3" />
                          Предлагаю выполнить:
                        </p>
                        <p>{msg.content}</p>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => handleConfirm(msg.id, msg.pending)} disabled={executingId === msg.id}>
                            {executingId === msg.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                            Подтвердить
                          </Button>
                          <Button size="sm" variant="outline"
                            className="h-7 px-3 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
                            onClick={() => handleChatCancel(msg.id)} disabled={executingId === msg.id}>
                            <XCircle className="w-3 h-3 mr-1" />
                            Отмена
                          </Button>
                        </div>
                      </div>
                    ) : msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-2 justify-start">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="bg-background border rounded-xl px-3 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Введи команду… Enter — отправить, Shift+Enter — перенос строки"
                rows={2}
                className="resize-none text-xs"
                disabled={chatLoading}
                data-testid="input-agent-chat"
              />
              <Button size="icon" className="h-auto w-10 flex-shrink-0"
                onClick={handleSend} disabled={!input.trim() || chatLoading}
                data-testid="button-agent-send">
                {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        )}

        {/* ── Queue tab ─────────────────────────────────────────────────── */}
        {activeTab === "queue" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Ожидают подтверждения: <b>{pendingItems.length}</b> / Всего: <b>{allItems.length}</b>
              </p>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => refetchQueue()} data-testid="button-queue-refresh">
                <RefreshCw className="w-3 h-3 mr-1" />
                Обновить
              </Button>
            </div>

            {queueLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Загрузка...
              </div>
            )}

            {!queueLoading && allItems.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-xs">
                <ListTodo className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Очередь пуста. Агент добавит предложения сюда, когда найдёт что улучшить.
              </div>
            )}

            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {allItems.map((item) => {
                const isCartPromo = item.type === "cart_promo";
                const edit = isCartPromo ? getCartEdit(item) : null;
                const users: Array<{ name: string; email: string; topItem: string }> = item.params?.users ?? [];
                const showAll = cartPromoShowAll[item.id] ?? false;
                const showPreview = cartPromoShowPreview[item.id] ?? false;

                return (
                  <div key={item.id} className={`border rounded-lg p-3 space-y-2 text-xs ${isCartPromo && item.status === "pending" ? "border-amber-300 bg-amber-50/30" : ""}`}>
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{isCartPromo ? "📧 Брошенные корзины" : (TYPE_LABELS[item.type] ?? item.type)}</span>
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${STATUS_COLORS[item.status]}`}>
                          {STATUS_LABELS[item.status]}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatDate(item.createdAt)}
                      </span>
                    </div>

                    <p className="font-medium text-foreground">{item.title}</p>

                    {/* ── cart_promo special UI ── */}
                    {isCartPromo && edit ? (
                      <div className="space-y-3 pt-1">

                        {/* Params row */}
                        <div className="flex flex-wrap gap-3 items-end">
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Скидка</label>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number" min={1} max={99} value={edit.discount}
                                onChange={e => setCartEdit(item.id, { discount: Number(e.target.value) })}
                                className="h-7 w-16 text-xs px-2"
                                disabled={item.status !== "pending"}
                                data-testid={`input-cart-promo-discount-${item.id}`}
                              />
                              <Percent className="w-3 h-3 text-muted-foreground" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Срок (часов)</label>
                            <Input
                              type="number" min={1} max={720} value={edit.validityHours}
                              onChange={e => setCartEdit(item.id, { validityHours: Number(e.target.value) })}
                              className="h-7 w-20 text-xs px-2"
                              disabled={item.status !== "pending"}
                              data-testid={`input-cart-promo-hours-${item.id}`}
                            />
                          </div>
                          <div className="text-[10px] text-muted-foreground pb-1">
                            🔖 Формат: <span className="font-mono font-bold text-foreground">CART-XXXXX</span><br/>
                            👥 Клиентов: <b className="text-foreground">{users.length}</b>
                          </div>
                        </div>

                        {/* Clients list */}
                        <div className="space-y-1">
                          <button
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setCartPromoShowAll(p => ({ ...p, [item.id]: !showAll }))}
                          >
                            <Users className="w-3 h-3" />
                            {showAll ? "Скрыть список" : `Показать всех клиентов (${users.length})`}
                            {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                          {showAll && (
                            <div className="max-h-36 overflow-y-auto border rounded-md bg-muted/20 divide-y text-[11px]">
                              {users.map((u, i) => (
                                <div key={i} className="px-2 py-1.5 flex justify-between gap-2">
                                  <span className="font-medium truncate">{u.name}</span>
                                  <span className="text-muted-foreground truncate">{u.email}</span>
                                  <span className="text-muted-foreground shrink-0 truncate max-w-[120px]">{u.topItem}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Email editor */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            <Mail className="w-3 h-3" />
                            Письмо
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] text-muted-foreground">Тема письма</label>
                            <Input
                              value={edit.emailSubject}
                              onChange={e => setCartEdit(item.id, { emailSubject: e.target.value })}
                              className="h-7 text-xs px-2"
                              disabled={item.status !== "pending"}
                              placeholder="Тема письма..."
                              data-testid={`input-cart-promo-subject-${item.id}`}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] text-muted-foreground">Текст письма</label>
                              <span className="text-[9px] text-muted-foreground">Токены: <code className="bg-muted px-0.5 rounded">{"{name}"}</code> — имя, <code className="bg-muted px-0.5 rounded">{"{item}"}</code> — товар</span>
                            </div>
                            <Textarea
                              value={edit.emailBody}
                              onChange={e => setCartEdit(item.id, { emailBody: e.target.value })}
                              rows={3}
                              className="text-xs resize-none"
                              disabled={item.status !== "pending"}
                              placeholder="Текст письма перед промокодом..."
                              data-testid={`textarea-cart-promo-body-${item.id}`}
                            />
                          </div>
                        </div>

                        {/* Preview toggle */}
                        <button
                          className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                          onClick={() => setCartPromoShowPreview(p => ({ ...p, [item.id]: !showPreview }))}
                        >
                          {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          {showPreview ? "Скрыть превью письма" : "Превью письма"}
                        </button>
                        {showPreview && (
                          <div className="border rounded-lg bg-[#f5f5f5] p-3 space-y-2">
                            <div className="bg-[#1C1C1C] rounded-md px-3 py-2 text-white text-[11px] font-black tracking-widest uppercase">
                              BOO<span className="text-red-500">O</span>MERANGS
                            </div>
                            <div className="bg-white rounded-md p-3 space-y-2">
                              <div className="text-[13px] font-black text-[#1C1C1C]">Персональная скидка для вас 🎁</div>
                              <p className="text-[11px] text-[#555]">
                                {edit.emailBody
                                  .replace(/\{name\}/g, users[0]?.name || "Иван")
                                  .replace(/\{item\}/g, users[0]?.topItem || "Шорты BMGBRAND")}
                              </p>
                              <div className="border-2 border-dashed border-[#1C1C1C] rounded-lg p-3 text-center bg-[#f9f9f9]">
                                <div className="text-[9px] text-[#888] uppercase tracking-widest mb-1">Ваш промокод</div>
                                <div className="text-[18px] font-black tracking-widest text-[#1C1C1C]">CART-XXXXX</div>
                                <div className="text-[11px] font-bold text-red-600 mt-1">Скидка {edit.discount}% на весь заказ</div>
                                <div className="text-[10px] text-[#999] mt-0.5">
                                  Действует {edit.validityHours >= 24 ? `${Math.round(edit.validityHours / 24)} дня` : `${edit.validityHours} часов`} · Однократное применение
                                </div>
                              </div>
                              <div className="text-center">
                                <span className="inline-block px-4 py-2 bg-[#1C1C1C] text-white text-[10px] font-bold uppercase tracking-wider rounded">
                                  Вернуться в корзину
                                </span>
                              </div>
                            </div>
                            <p className="text-[9px] text-center text-[#aaa]">Тема: {edit.emailSubject}</p>
                          </div>
                        )}

                        {item.error && <p className="text-red-500 text-[10px]">Ошибка: {item.error}</p>}

                        {item.status === "pending" && (
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => handleQueueAction(item.id, "approve", {
                                discount: edit.discount,
                                validityHours: edit.validityHours,
                                emailSubject: edit.emailSubject,
                                emailBody: edit.emailBody,
                              })}
                              data-testid={`button-queue-approve-${item.id}`}>
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Подтвердить и отправить
                            </Button>
                            <Button size="sm" variant="outline"
                              className="h-7 px-3 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
                              onClick={() => handleQueueAction(item.id, "reject")}
                              data-testid={`button-queue-reject-${item.id}`}>
                              <XCircle className="w-3 h-3 mr-1" />
                              Отклонить
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Generic item rendering */
                      <>
                        <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                          {item.description.length > 250 ? item.description.slice(0, 250) + "…" : item.description}
                        </p>
                        {item.error && <p className="text-red-500 text-[10px]">Ошибка: {item.error}</p>}
                        {item.status === "pending" && (
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => handleQueueAction(item.id, "approve")}
                              data-testid={`button-queue-approve-${item.id}`}>
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Подтвердить
                            </Button>
                            <Button size="sm" variant="outline"
                              className="h-7 px-3 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
                              onClick={() => handleQueueAction(item.id, "reject")}
                              data-testid={`button-queue-reject-${item.id}`}>
                              <XCircle className="w-3 h-3 mr-1" />
                              Отклонить
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Log tab ───────────────────────────────────────────────────── */}
        {activeTab === "log" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                История действий автономного агента
              </p>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => refetchLog()} data-testid="button-log-refresh">
                <RefreshCw className="w-3 h-3 mr-1" />
                Обновить
              </Button>
            </div>

            {logLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Загрузка...
              </div>
            )}

            {!logLoading && (!logData?.log || logData.log.length === 0) && (
              <div className="text-center py-8 text-muted-foreground text-xs">
                <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Лог пуст. Здесь будут отображаться все автоматические действия агента.
              </div>
            )}

            <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
              {(logData?.log ?? []).map((entry) => (
                <div key={entry.id} className="flex gap-3 items-start py-2 border-b last:border-0">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    entry.isAuto ? "bg-blue-100" : "bg-emerald-100"
                  }`}>
                    {entry.isAuto
                      ? <Zap className="w-2.5 h-2.5 text-blue-600" />
                      : <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-foreground">{entry.action}</span>
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
                        {TYPE_LABELS[entry.type] ?? entry.type}
                      </Badge>
                    </div>
                    {entry.summary && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{entry.summary}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">{formatDate(entry.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Settings tab ──────────────────────────────────────────────── */}
        {activeTab === "settings" && (
          <div className="space-y-4">
            {/* Status */}
            {statusData && (
              <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1 border">
                <p className="font-medium text-foreground mb-2 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" />
                  Статус агента
                </p>
                <p className="text-muted-foreground">
                  Последний запуск: <span className="text-foreground font-mono">{statusData.status.lastRun}</span>
                </p>
                <p className="text-muted-foreground">
                  Результат: <span className="text-foreground">{statusData.status.lastResult}</span>
                </p>
                <p className="text-muted-foreground">
                  В очереди: <span className="text-amber-600 font-semibold">{statusData.pendingCount}</span> ожидают подтверждения
                </p>
              </div>
            )}

            {/* Toggle settings */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-foreground">Включить/выключить:</p>

              {([
                { key: "enabled", label: "Автономный агент", desc: "Главный выключатель — отключает все задачи" },
                { key: "seoEnabled", label: "SEO-генерация", desc: "Автоматически заполнять SEO для новых товаров" },
                { key: "alertsEnabled", label: "Алерты", desc: "Уведомления о низком остатке и товарах без фото" },
                { key: "digestEnabled", label: "Еженедельный дайджест", desc: "Сводка каждый понедельник в 09:00" },
              ] as const).map(({ key, label, desc }) => (
                <div key={key} className="flex items-start gap-3">
                  <Switch
                    id={`setting-${key}`}
                    checked={settings[key]}
                    onCheckedChange={(checked) =>
                      setLocalSettings((prev) => ({ ...settings, ...prev, [key]: checked }))
                    }
                    data-testid={`switch-agent-${key}`}
                  />
                  <Label htmlFor={`setting-${key}`} className="cursor-pointer">
                    <span className="text-xs font-medium block">{label}</span>
                    <span className="text-[11px] text-muted-foreground">{desc}</span>
                  </Label>
                </div>
              ))}
            </div>

            <Button size="sm" className="h-8 text-xs w-full" onClick={handleSaveSettings} disabled={settingsSaving}
              data-testid="button-agent-save-settings">
              {settingsSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              Сохранить настройки
            </Button>

            {/* Manual run */}
            <div className="border-t pt-3 space-y-2">
              <p className="text-xs font-medium text-foreground">Запустить вручную:</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { job: "all", label: "Полный запуск" },
                  { job: "seo", label: "SEO-генерация" },
                  { job: "descriptions", label: "Описания" },
                  { job: "alerts", label: "Алерты" },
                  { job: "digest", label: "Дайджест" },
                  { job: "cart_analysis", label: "Анализ корзин" },
                ] as const).map(({ job, label }) => (
                  <Button key={job} variant="outline" size="sm" className="h-8 text-xs"
                    onClick={() => handleRunJob(job)}
                    disabled={runningJob !== null}
                    data-testid={`button-agent-run-${job}`}>
                    {runningJob === job
                      ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      : <Play className="w-3 h-3 mr-1" />}
                    {label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">Задачи выполняются в фоне — результат появится в логе.</p>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs font-medium text-foreground mb-1">Расписание:</p>
              <div className="text-[11px] text-muted-foreground space-y-1">
                <p>• SEO-батч — каждую ночь в 03:00 МСК (до 50 товаров)</p>
                <p>• Алерты — каждые 6 часов</p>
                <p>• Дайджест — каждый понедельник в 09:00</p>
                <p>• Анализ корзин — каждое воскресенье в 11:00</p>
                <p>• Лимит Groq: ~200 запросов/сутки для агента</p>
              </div>
            </div>

            <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={() => refetchStatus()}
              data-testid="button-agent-status-refresh">
              <RefreshCw className="w-3 h-3 mr-1" />
              Обновить статус
            </Button>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
