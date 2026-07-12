import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Sparkles, X, Send, RotateCcw, ChevronRight } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProductForChat {
  id: number;
  name: string;
  price: number;
  color?: string | null;
  description?: string | null;
  composition?: string | null;
  careInstructions?: string | null;
  measurements?: any[] | null;
  sizes?: string[];
  sizeStock?: Record<string, number> | null;
  artistSlug?: string | null;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
}

interface Props {
  /** The currently active product (may be a variant). */
  product: ProductForChat;
  /**
   * Change this value to reset the chat (e.g. pass `isModalOpen ? String(product.id) : "closed"`).
   * The component remounts / clears state whenever resetKey changes.
   */
  resetKey: string;
}

// ─── Simple Markdown Renderer ─────────────────────────────────────────────────
// Handles: **bold**, ## headers, | tables |, - bullet lists, plain text.
// Keeps whitespace-pre-wrap for normal lines so newlines work out of the box.

function renderInline(text: string): React.ReactNode[] {
  // Split on **bold** patterns
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function MiniMarkdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // ── Markdown table (3+ consecutive pipe lines) ──────────────────────────
    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      // Filter out separator rows (---|---) and parse cells
      const rows = tableLines
        .filter(l => !/^\s*\|[\s\-|:]+\|\s*$/.test(l))
        .map(l =>
          l
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map(c => c.trim())
        );
      if (rows.length > 0) {
        nodes.push(
          <div key={`tbl-${i}`} className="overflow-x-auto my-1.5">
            <table className="text-[10px] border-collapse w-full min-w-[160px]">
              <thead>
                <tr>
                  {rows[0].map((cell, j) => (
                    <th
                      key={j}
                      className="px-1.5 py-0.5 border border-black/15 bg-black/5 font-semibold text-left whitespace-nowrap"
                    >
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? "" : "bg-black/[0.02]"}>
                    {row.map((cell, j) => (
                      <td key={j} className="px-1.5 py-0.5 border border-black/10 whitespace-nowrap">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // ── Bullet list item ─────────────────────────────────────────────────────
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      const bulletText = trimmed.slice(2);
      nodes.push(
        <div key={`li-${i}`} className="flex gap-1.5 leading-relaxed">
          <span className="mt-[3px] w-1 h-1 rounded-full bg-black/40 shrink-0" />
          <span>{renderInline(bulletText)}</span>
        </div>
      );
      i++;
      continue;
    }

    // ── Section header (## or ###) ────────────────────────────────────────────
    if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      const headerText = trimmed.replace(/^#{2,3}\s+/, "");
      nodes.push(
        <p key={`h-${i}`} className="font-semibold text-[11px] mt-1.5 mb-0.5 text-black/80">
          {renderInline(headerText)}
        </p>
      );
      i++;
      continue;
    }

    // ── Empty line → spacer ──────────────────────────────────────────────────
    if (trimmed === "") {
      nodes.push(<div key={`sp-${i}`} className="h-1" />);
      i++;
      continue;
    }

    // ── Regular line ─────────────────────────────────────────────────────────
    nodes.push(
      <span key={`ln-${i}`} className="leading-relaxed">
        {renderInline(line)}
        {i < lines.length - 1 ? "\n" : ""}
      </span>
    );
    i++;
  }

  return (
    <div className="whitespace-pre-wrap break-words">
      {nodes}
      {streaming && <span className="animate-pulse opacity-60">▌</span>}
    </div>
  );
}

// ─── Bouncing dots loader ─────────────────────────────────────────────────────

function BouncingDots() {
  return (
    <span className="flex gap-0.5 items-center h-3 py-0.5">
      <span className="w-1 h-1 bg-black/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1 h-1 bg-black/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1 h-1 bg-black/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const ProductMiniChat = memo(function ProductMiniChat({ product, resetKey }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Cache full product data — fetch once, reuse for all subsequent messages
  const fullProductCacheRef = useRef<{ id: number; data: ProductForChat } | null>(null);

  // Prevent double-fire of initial message on open
  const initSentRef = useRef(false);

  // Stable ref so the initial useEffect doesn't need sendMessage in deps
  const sendMessageRef = useRef<(text: string, history: ChatMsg[]) => Promise<void>>(async () => {});

  // ── Reset when resetKey changes (modal open/close or variant switch) ────────
  useEffect(() => {
    setIsOpen(false);
    setMessages([]);
    setInput("");
    setStreaming(false);
    initSentRef.current = false;
    fullProductCacheRef.current = null;
  }, [resetKey]);

  // ── Auto-scroll to bottom ─────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Fetch full product details once and cache ────────────────────────────
  const getFullProduct = useCallback(async (): Promise<ProductForChat> => {
    if (fullProductCacheRef.current?.id === product.id) {
      return fullProductCacheRef.current.data;
    }
    try {
      const res = await fetch(`/api/products/${product.id}`);
      if (res.ok) {
        const data = await res.json();
        fullProductCacheRef.current = { id: product.id, data };
        return data;
      }
    } catch {
      // network error — use what we have
    }
    // Fallback: use product as-is (may lack composition/measurements)
    fullProductCacheRef.current = { id: product.id, data: product };
    return product;
  }, [product]);

  // ── Core send function ────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string, history: ChatMsg[]) => {
      if (!text.trim() || streaming) return;

      const userMsg: ChatMsg = { role: "user", content: text };
      const withUser = [...history, userMsg];
      setMessages([...withUser, { role: "assistant", content: "" }]);
      setInput("");
      setStreaming(true);

      let accumulated = "";

      try {
        // Fetch full product once (cached after first call)
        const fullProduct = await getFullProduct();

        const res = await fetch("/api/ai/product-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product: {
              id: fullProduct.id,
              name: fullProduct.name,
              price: fullProduct.price,
              color: fullProduct.color,
              description: fullProduct.description,
              composition: fullProduct.composition,
              careInstructions: fullProduct.careInstructions,
              measurements: fullProduct.measurements,
              sizes: fullProduct.sizes,
              sizeStock: fullProduct.sizeStock,
              artistSlug: fullProduct.artistSlug,
            },
            messages: withUser,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;
            try {
              const parsed = JSON.parse(raw);
              // Server signals AI unavailable via { error: "..." }
              if (parsed.error) throw new Error(`ai_error:${parsed.error}`);
              if (parsed.text) {
                accumulated += parsed.text;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: "assistant", content: accumulated };
                  return updated;
                });
              }
            } catch (e: any) {
              if (e.message?.startsWith("ai_error:")) throw e;
              // JSON parse errors — skip silently
            }
          }
        }

        // Fallback: client-side empty detection if server didn't catch it
        if (!accumulated.trim()) {
          throw new Error("ai_error:empty_response");
        }
      } catch (err: any) {
        const errMsg = err.message ?? "";
        const errorText =
          errMsg === "ai_error:empty_response"
            ? "ИИ обдумал вопрос, но не смог дать ответ. Попробуйте задать вопрос иначе."
            : errMsg === "ai_error:ai_unavailable"
            ? "ИИ временно недоступен. Попробуйте позже."
            : "Не удалось получить ответ. Попробуйте ещё раз.";
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: errorText, isError: true };
          return updated;
        });
      } finally {
        setStreaming(false);
      }
    },
    [streaming, getFullProduct]
  );

  // Keep ref in sync so initial-open effect can call latest version
  sendMessageRef.current = sendMessage;

  // ── Auto-send initial message when chat opens (once per session) ──────────
  useEffect(() => {
    if (!isOpen) {
      initSentRef.current = false;
      return;
    }
    if (initSentRef.current || messages.length > 0) return;
    initSentRef.current = true;
    // Use ref to avoid stale closure / dep array issues
    sendMessageRef.current("Расскажи об этом товаре.", []);
  }, [isOpen, messages.length]);

  // ── Retry last failed message ─────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const lastUserMsg = messages[lastUserIdx];
    const historyBefore = messages.slice(0, lastUserIdx);
    sendMessage(lastUserMsg.content, historyBefore);
  }, [messages, sendMessage]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const lastMsg = messages[messages.length - 1];
  const hasError = !!lastMsg?.isError;
  const showRetryBtn = hasError && !input.trim() && !streaming;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="pt-2 border-t border-black/10">
      {!isOpen ? (
        /* Collapsed: trigger button */
        <button
          onClick={() => setIsOpen(true)}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-white border border-black/12 hover:border-black/30 hover:bg-black/[0.02] transition-all group shadow-sm"
          data-testid="button-product-ai-chat-open"
        >
          <Sparkles className="w-4 h-4 text-black/40 shrink-0 group-hover:text-black/70 transition-colors" />
          <span className="text-[12px] font-medium text-black/60 group-hover:text-black/80 transition-colors">BOOOM AI</span>
          <ChevronRight className="w-3.5 h-3.5 text-black/20 ml-auto shrink-0 group-hover:text-black/40 transition-colors" />
        </button>
      ) : (
        /* Expanded: chat UI */
        <div className="space-y-2">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-black/60 uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              ИИ о товаре
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-black/30 hover:text-black transition-colors"
              data-testid="button-product-ai-chat-close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Messages */}
          <div className="max-h-48 overflow-y-auto space-y-2 pr-0.5">
            {messages.map((msg, idx) => {
              const isLast = idx === messages.length - 1;
              const isStreamingThis = streaming && isLast && msg.role === "assistant";

              return (
                <div
                  key={idx}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[92%] px-2.5 py-1.5 rounded-lg text-[11px] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-black text-white"
                        : msg.isError
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : "bg-black/5 text-black"
                    }`}
                  >
                    {msg.content ? (
                      <MiniMarkdown text={msg.content} streaming={isStreamingThis} />
                    ) : isStreamingThis ? (
                      <BouncingDots />
                    ) : null}
                    {/* Retry button right inside the error bubble — always visible */}
                    {msg.isError && !streaming && (
                      <button
                        onClick={handleRetry}
                        className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-red-600 hover:text-red-800 underline underline-offset-2 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Повторить запрос
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input row — always visible; disabled during streaming */}
          <div className="flex gap-1.5">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey && input.trim() && !streaming) {
                  e.preventDefault();
                  sendMessage(input, messages);
                }
              }}
              placeholder={streaming ? "ИИ печатает…" : "Задать вопрос…"}
              disabled={streaming}
              className="flex-1 h-8 px-2.5 text-[11px] rounded-md border border-black/20 bg-transparent focus:outline-none focus:border-black/40 placeholder:text-black/30 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="input-product-ai-chat"
              autoComplete="off"
            />

            {/* Retry or Send */}
            {showRetryBtn ? (
              <button
                onClick={handleRetry}
                title="Повторить запрос"
                className="h-8 w-8 flex items-center justify-center rounded-md border border-black/20 text-black/50 hover:text-black hover:border-black/40 transition-colors shrink-0"
                data-testid="button-product-ai-chat-retry"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => { if (input.trim() && !streaming) sendMessage(input, messages); }}
                disabled={!input.trim() || streaming}
                className="h-8 w-8 flex items-center justify-center rounded-md bg-black text-white disabled:opacity-25 transition-opacity shrink-0"
                data-testid="button-product-ai-chat-send"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
