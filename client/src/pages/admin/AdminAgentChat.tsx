import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Send, CheckCircle2, XCircle, Loader2, Sparkles, Terminal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: {
    tool: string;
    params: any;
    description: string;
  };
}

interface AdminAgentChatProps {
  apiKey: string;
  adminFetch: (url: string, apiKey: string, options?: RequestInit) => Promise<any>;
}

export function AdminAgentChat({ apiKey, adminFetch }: AdminAgentChatProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Привет! Я AI-ассистент администратора. Могу искать и обновлять товары, управлять промокодами, смотреть заказы и статистику.\n\nПримеры команд:\n• «Найди все толстовки»\n• «Покажи последние 5 заказов»\n• «Создай промокод ЛЕТО20 на 20%»\n• «Скрой товар с ID 12345»\n• «Покажи статистику магазина»",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const historyForApi = () =>
    messages
      .filter((m) => !m.pending)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: ChatMessage = { id: `u_${Date.now()}`, role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await adminFetch("/api/admin/agent/chat", apiKey, {
        method: "POST",
        body: JSON.stringify({ command: text, history: historyForApi() }),
      });

      const assistantId = `a_${Date.now()}`;

      if (res.type === "write") {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: res.description,
            pending: { tool: res.tool, params: res.params, description: res.description },
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: res.text || res.result || "Готово.",
          },
        ]);
      }
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
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
        prev.map((m) =>
          m.id === msgId ? { ...m, pending: undefined, content: res.result || "✅ Выполнено." } : m
        )
      );
    } catch (e: any) {
      toast({ title: "Ошибка выполнения", description: e.message, variant: "destructive" });
    } finally {
      setExecutingId(null);
    }
  }

  function handleCancel(msgId: string) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, pending: undefined, content: "❌ Операция отменена." } : m
      )
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm">Ассистент администратора</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Управляй магазином голосом — товары, промокоды, заказы, статистика
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        <div className="rounded-lg border bg-muted/20 h-80 overflow-y-auto p-3 space-y-3 text-sm">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : msg.pending
                      ? "bg-amber-50 border border-amber-200 text-foreground"
                      : "bg-background border text-foreground"
                }`}
              >
                {msg.pending ? (
                  <div className="space-y-2">
                    <p className="font-medium text-amber-700 flex items-center gap-1">
                      <Terminal className="w-3 h-3" />
                      Предлагаю выполнить:
                    </p>
                    <p>{msg.content}</p>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => handleConfirm(msg.id, msg.pending)}
                        disabled={executingId === msg.id}
                      >
                        {executingId === msg.id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                        )}
                        Подтвердить
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-3 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
                        onClick={() => handleCancel(msg.id)}
                        disabled={executingId === msg.id}
                      >
                        <XCircle className="w-3 h-3 mr-1" />
                        Отмена
                      </Button>
                    </div>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
          {loading && (
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
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Введи команду… Enter — отправить, Shift+Enter — перенос строки"
            rows={2}
            className="resize-none text-xs"
            disabled={loading}
          />
          <Button
            size="icon"
            className="h-auto w-10 flex-shrink-0"
            onClick={handleSend}
            disabled={!input.trim() || loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
