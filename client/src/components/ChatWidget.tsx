import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { X, Send, ArrowRight, ImagePlus, Loader2, Bot, UserRound, Sparkles, Ruler } from "lucide-react";

// Renders AI message text with clickable markdown links [text](url)
function AiMessageContent({ text }: { text: string }) {
  const parts = text.split(/(\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g);
  const result: React.ReactNode[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part && part.startsWith("[") && parts[i + 2]) {
      const label = parts[i + 1];
      const url = parts[i + 2];
      result.push(
        <a
          key={i}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 font-medium hover:opacity-70 transition-opacity"
          onClick={e => e.stopPropagation()}
        >
          {label}
        </a>
      );
      i += 3;
    } else {
      if (part) result.push(<span key={i}>{part}</span>);
      i++;
    }
  }
  return <p className="leading-snug whitespace-pre-wrap">{result}</p>;
}

type ChatMode = "ai" | "manager";

interface SizeAdvisorProduct {
  id: number;
  name: string;
  subcategory?: string;
  hasMeasurements: boolean;
  hasWaist: boolean;
}

interface ProductCard {
  id: number;
  name: string;
  price: number | null;
  imageUrl: string | null;
  url: string;
}

interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  products?: ProductCard[];
}

interface ProductPageContext {
  id: number;
  name: string;
  price: number;
  description: string;
  composition?: string;
  color?: string;
  sizeStock?: Record<string, number>;
  stock?: number;
  category?: string;
  subcategory?: string;
}

interface ChatMessage {
  messageId: string;
  sender: "client" | "admin";
  text: string;
  timestamp: number;
  userName?: string;
  imageUrl?: string;
}

function getOrCreateSessionId(): string {
  let sid = localStorage.getItem("chat_session_id");
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem("chat_session_id", sid);
  }
  return sid;
}

const ChatIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fillRule="evenodd" clipRule="evenodd"
      d="M2 6C2 4.34315 3.34315 3 5 3H19C20.6569 3 22 4.34315 22 6V15C22 16.6569 20.6569 18 19 18H13.4142L9.70711 21.7071C9.42111 21.9931 8.99099 22.0787 8.61732 21.9239C8.24364 21.769 8 21.4045 8 21V18H5C3.34315 18 2 16.6569 2 15V6Z"
      fill="currentColor"/>
  </svg>
);

const QUICK_QUESTIONS = [
  "Как доставляется мой заказ?",
  "Какие способы оплаты доступны?",
  "Как вернуть или обменять товар?",
  "Как подобрать правильный размер?",
  "Можно заказать мерч с логотипом?",
  "Как работает партнёрская программа?",
];

export function ChatWidget() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ChatMode>("ai");

  // AI state
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [productPageCtx, setProductPageCtx] = useState<ProductPageContext | null>(null);

  // Size advisor state
  const [sizeAdvisorProduct, setSizeAdvisorProduct] = useState<SizeAdvisorProduct | null>(null);
  const [sizeHeight, setSizeHeight] = useState("");
  const [sizeMeasure, setSizeMeasure] = useState("");

  // Manager chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [userName, setUserName] = useState(() => localStorage.getItem("chat_user_name") || "");
  const [nameInput, setNameInput] = useState("");
  const [nameSet, setNameSet] = useState(() => !!localStorage.getItem("chat_user_name"));
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const sessionId = useRef(getOrCreateSessionId());
  const aiBottomRef = useRef<HTMLDivElement>(null);
  const managerBottomRef = useRef<HTMLDivElement>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);
  const managerInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTsRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const openRef = useRef(false);
  openRef.current = open;

  const scrollAiToBottom = () => setTimeout(() => aiBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  const scrollManagerToBottom = () => setTimeout(() => managerBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);

  // --- Size advisor: listen for open event from product page ---
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<SizeAdvisorProduct>;
      setSizeAdvisorProduct(ev.detail);
      setSizeHeight("");
      setSizeMeasure("");
      setAiMessages([]);
      setMode("ai");
      setOpen(true);
    };
    window.addEventListener("open-size-advisor", handler);
    return () => window.removeEventListener("open-size-advisor", handler);
  }, []);

  // --- Product page context: track current product for AI ---
  useEffect(() => {
    const setHandler = (e: Event) => {
      const ev = e as CustomEvent<ProductPageContext>;
      setProductPageCtx(ev.detail);
    };
    const clearHandler = () => setProductPageCtx(null);
    window.addEventListener("set-product-context", setHandler);
    window.addEventListener("clear-product-context", clearHandler);
    return () => {
      window.removeEventListener("set-product-context", setHandler);
      window.removeEventListener("clear-product-context", clearHandler);
    };
  }, []);

  // --- AI logic ---
  const sendAiMessage = async (text: string) => {
    if (!text.trim() || aiLoading) return;
    const userMsg: AiMessage = { id: `u-${Date.now()}`, role: "user", content: text.trim() };
    const newMessages = [...aiMessages, userMsg];
    setAiMessages(newMessages);
    setAiInput("");
    setAiLoading(true);
    scrollAiToBottom();

    // Derive page type from current URL
    const pageType = location.startsWith("/cart") ? "cart"
      : location.startsWith("/checkout") ? "checkout"
      : location === "/" ? "home"
      : location.startsWith("/products") ? "catalog"
      : productPageCtx ? "product"
      : "other";

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          pageContext: { pageType, product: productPageCtx ?? undefined },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiMessages(prev => [...prev, {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: "__tired__",
        }]);
        return;
      }
      const reply = data.reply || "Извините, не удалось получить ответ. Напишите нашему менеджеру.";
      const products: ProductCard[] = data.products || [];
      setAiMessages(prev => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: reply, products }]);
    } catch {
      setAiMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: "__tired__",
      }]);
    } finally {
      setAiLoading(false);
      scrollAiToBottom();
    }
  };

  const handleAiKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAiMessage(aiInput); }
  };

  // --- Size advisor submit ---
  const sendSizeAdvisorMessage = async () => {
    if (!sizeAdvisorProduct || !sizeHeight.trim() || !sizeMeasure.trim() || aiLoading) return;
    const isBottoms = sizeAdvisorProduct.hasWaist;
    const measureLabel = isBottoms ? "обхват талии" : "обхват груди";
    const msgText = `Подберите мне размер для товара "${sizeAdvisorProduct.name}". Мой рост: ${sizeHeight} см, ${measureLabel}: ${sizeMeasure} см.`;
    const productId = sizeAdvisorProduct.id;
    setSizeAdvisorProduct(null);

    const userMsg: AiMessage = { id: `u-${Date.now()}`, role: "user", content: msgText };
    const newMessages = [userMsg];
    setAiMessages(newMessages);
    setAiLoading(true);
    scrollAiToBottom();
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          productId,
          pageContext: { pageType: "product", product: productPageCtx ?? undefined },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiMessages(prev => [...prev, { id: `err-${Date.now()}`, role: "assistant", content: "__tired__" }]);
        return;
      }
      const reply = data.reply || "Не удалось получить ответ. Напишите нашему менеджеру.";
      setAiMessages(prev => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: reply, products: [] }]);
    } catch {
      setAiMessages(prev => [...prev, { id: `err-${Date.now()}`, role: "assistant", content: "__tired__" }]);
    } finally {
      setAiLoading(false);
      scrollAiToBottom();
    }
  };

  // --- Manager chat logic ---
  const loadMessages = useCallback(async (since?: number) => {
    try {
      const qs = since ? `?since=${since}` : "";
      const res = await fetch(`/api/chat/messages/${sessionId.current}${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      const incoming: ChatMessage[] = (data.messages || []).filter((m: any) => (m.text || m.imageUrl) && m.messageId);
      if (incoming.length === 0) return;

      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.messageId));
        const realClientTexts = new Set(incoming.filter(m => m.sender === "client").map(m => m.text));
        const withoutMatchedTemps = prev.filter(m => !m.messageId.startsWith("temp-") || !realClientTexts.has(m.text));
        const fresh = incoming.filter(m => !existingIds.has(m.messageId));
        if (fresh.length === 0 && withoutMatchedTemps.length === prev.length) return prev;
        const newAdminMsgs = fresh.filter(m => m.sender === "admin");
        if (newAdminMsgs.length > 0 && !openRef.current) setUnreadCount(c => c + newAdminMsgs.length);
        return [...withoutMatchedTemps, ...fresh].sort((a, b) => a.timestamp - b.timestamp);
      });

      const maxTs = Math.max(...incoming.map(m => m.timestamp));
      if (maxTs > lastTsRef.current) lastTsRef.current = maxTs;
    } catch {}
  }, []);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  useEffect(() => {
    if (open && mode === "manager") {
      loadMessages();
      setUnreadCount(0);
      scrollManagerToBottom();
      setTimeout(() => managerInputRef.current?.focus(), 200);
    }
    if (open && mode === "ai") {
      setTimeout(() => aiInputRef.current?.focus(), 200);
    }
  }, [open, mode, loadMessages]);

  useEffect(() => {
    const interval = (open && mode === "manager") ? 3000 : 30000;
    pollRef.current = setInterval(() => loadMessages(lastTsRef.current || undefined), interval);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadMessages, open, mode]);

  useEffect(() => { if (open && mode === "manager") scrollManagerToBottom(); }, [messages, open, mode]);
  useEffect(() => { if (open && mode === "ai") scrollAiToBottom(); }, [aiMessages, open, mode]);

  const handleSetName = () => {
    const name = nameInput.trim() || "Гость";
    setUserName(name);
    localStorage.setItem("chat_user_name", name);
    setNameSet(true);
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploading) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) { alert("Максимальный размер фото — 5 МБ"); return; }
    setUploading(true);
    try {
      const reader = new FileReader();
      const imageData: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const uploadRes = await fetch("/api/chat/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData, sessionId: sessionId.current }),
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { url } = await uploadRes.json();
      const now = Date.now();
      const tempId = `temp-img-${now}`;
      const text = inputText.trim() || "📷 Фото";
      setMessages(prev => [...prev, { messageId: tempId, sender: "client", text, timestamp: now, userName, imageUrl: url }]);
      setInputText("");
      scrollManagerToBottom();
      const msgRes = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, text, userName: userName || "Гость", imageUrl: url }),
      });
      if (msgRes.ok) {
        const data = await msgRes.json();
        if (data.timestamp) lastTsRef.current = Math.max(lastTsRef.current, data.timestamp - 1);
        setTimeout(() => loadMessages(now - 2000), 600);
      }
    } catch (err) {
      console.error("[Chat] Image upload failed:", err);
      setMessages(prev => [...prev, { messageId: `err-${Date.now()}`, sender: "admin", text: "Не удалось загрузить фото. Попробуйте ещё раз.", timestamp: Date.now() }]);
      scrollManagerToBottom();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const sendManagerMessage = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    setInputText("");
    const now = Date.now();
    const tempId = `temp-${now}`;
    setMessages(prev => [...prev, { messageId: tempId, sender: "client", text, timestamp: now, userName }]);
    scrollManagerToBottom();
    try {
      const res = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, text, userName: userName || "Гость" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.timestamp) lastTsRef.current = Math.max(lastTsRef.current, data.timestamp - 1);
        setTimeout(() => loadMessages(now - 2000), 600);
      }
    } catch {} finally {
      setSending(false);
    }
  };

  const handleManagerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendManagerMessage(); }
  };

  if (location === "/wholesale/preorder") return null;

  return (
    <>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />

          <div className="fixed z-50 flex flex-col
            bottom-[88px] right-4 w-[calc(100vw-2rem)] max-w-[300px] h-[420px]
            sm:bottom-24 sm:right-6 sm:w-[340px] sm:h-[480px]
            md:w-[360px] md:h-[520px]
            bg-white rounded-2xl overflow-hidden shadow-[0_8px_48px_rgba(0,0,0,0.22)] border border-black/10">

            {/* Header */}
            <div className="flex-shrink-0 bg-black text-white px-4 py-3 sm:px-5 sm:py-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center">
                    {mode === "ai" ? <Bot className="w-4 h-4" /> : <ChatIcon />}
                  </div>
                  <div>
                    <p className="font-semibold text-sm tracking-wide">
                      {mode === "ai" ? "AI-ассистент" : "Онлайн-чат"}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${mode === "ai" ? "bg-violet-400 animate-pulse" : "bg-emerald-400 animate-pulse"}`} />
                      <p className="text-[10px] text-white/60">
                        {mode === "ai" ? "BOOOM AI · отвечает мгновенно" : "Менеджер · пн–пт 11:00–19:00"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Switch mode button */}
                <button
                  onClick={() => setMode(m => m === "ai" ? "manager" : "ai")}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-[11px] font-medium text-white/90 whitespace-nowrap"
                  data-testid="button-chat-switch-mode"
                >
                  {mode === "ai" ? (
                    <><UserRound className="w-3 h-3" /> Менеджер</>
                  ) : (
                    <><Bot className="w-3 h-3" /> AI-помощник</>
                  )}
                </button>
              </div>
            </div>

            {/* AI mode */}
            {mode === "ai" && (
              <>
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0 bg-[#f7f7f7]">
                  {aiMessages.length === 0 && !sizeAdvisorProduct && (
                    <div className="flex flex-col items-center gap-3 pt-2 pb-1">
                      <div className="w-12 h-12 rounded-2xl bg-black flex items-center justify-center text-white">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-sm text-black">Привет! Я AI-ассистент</p>
                        <p className="text-xs text-black/40 mt-1">Отвечу на вопросы о доставке,<br />оплате, возврате, размерах и мерче</p>
                      </div>
                      <div className="w-full flex flex-col gap-2 mt-1">
                        {QUICK_QUESTIONS.map(q => (
                          <button
                            key={q}
                            onClick={() => sendAiMessage(q)}
                            className="w-full text-left px-3.5 py-2.5 rounded-xl bg-white border border-black/10 text-xs text-black/70 hover:border-black/30 hover:bg-black/[0.02] active:scale-[0.98] transition-all shadow-sm"
                            data-testid={`button-quick-question-${q}`}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Size advisor form */}
                  {sizeAdvisorProduct && aiMessages.length === 0 && (
                    <div className="flex flex-col gap-3 pt-2 pb-1">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-2xl bg-black flex items-center justify-center text-white flex-shrink-0">
                          <Ruler className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-black">Подбор размера</p>
                          <p className="text-xs text-black/40 mt-0.5 line-clamp-1">{sizeAdvisorProduct.name}</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs text-black/50 mb-1 block">Ваш рост (см)</label>
                          <input
                            type="number"
                            placeholder="например, 178"
                            value={sizeHeight}
                            onChange={e => setSizeHeight(e.target.value)}
                            data-testid="input-size-height"
                            className="w-full px-3 py-2 rounded-xl border border-black/12 text-sm text-black placeholder-black/25 bg-black/[0.02] outline-none focus:border-black transition-colors"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-black/50 mb-1 block">
                            {sizeAdvisorProduct.hasWaist ? "Обхват талии (см)" : "Обхват груди (см)"}
                          </label>
                          <input
                            type="number"
                            placeholder="например, 96"
                            value={sizeMeasure}
                            onChange={e => setSizeMeasure(e.target.value)}
                            data-testid="input-size-measure"
                            onKeyDown={e => { if (e.key === "Enter") sendSizeAdvisorMessage(); }}
                            className="w-full px-3 py-2 rounded-xl border border-black/12 text-sm text-black placeholder-black/25 bg-black/[0.02] outline-none focus:border-black transition-colors"
                          />
                        </div>
                        <button
                          onClick={sendSizeAdvisorMessage}
                          disabled={!sizeHeight.trim() || !sizeMeasure.trim() || aiLoading}
                          data-testid="button-size-advisor-submit"
                          className="w-full py-2.5 rounded-xl bg-black text-white text-sm font-medium hover:bg-black/80 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Подобрать размер
                        </button>
                        <button
                          onClick={() => setSizeAdvisorProduct(null)}
                          className="w-full py-1.5 text-xs text-black/40 hover:text-black/70 transition-colors"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}

                  {aiMessages.map(msg => (
                    <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                      <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} w-full`}>
                        {msg.role === "assistant" && (
                          <div className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center mr-2 flex-shrink-0 mt-auto mb-0.5">
                            <Bot className="w-3.5 h-3.5" />
                          </div>
                        )}
                        {msg.role === "assistant" && msg.content === "__tired__" ? (
                          <div className="max-w-[85%] rounded-2xl px-4 py-3 shadow-sm bg-amber-50 border border-amber-200 rounded-bl-md">
                            <p className="text-sm text-amber-900 leading-snug mb-2.5">
                              😴 Наш помощник устал — напишите нам напрямую, поможем!
                            </p>
                            <button
                              onClick={() => setChatMode("manager")}
                              className="w-full py-1.5 px-3 rounded-lg bg-black text-white text-xs font-medium hover:bg-black/80 active:scale-95 transition-all"
                            >
                              Написать менеджеру
                            </button>
                          </div>
                        ) : (
                          <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm break-words shadow-sm
                            ${msg.role === "user"
                              ? "bg-black text-white rounded-br-md"
                              : "bg-white text-black rounded-bl-md border border-black/8"
                            }`}>
                            {msg.role === "user"
                              ? <p className="leading-snug">{msg.content}</p>
                              : <AiMessageContent text={msg.content} />
                            }
                          </div>
                        )}
                      </div>
                      {msg.role === "assistant" && msg.products && msg.products.length > 0 && (
                        <div className="ml-9 mt-2 flex flex-col gap-2 w-[calc(100%-2.25rem)]">
                          {msg.products.map(p => (
                            <a
                              key={p.id}
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2.5 bg-white border border-black/10 rounded-xl px-3 py-2 shadow-sm hover:shadow-md hover:border-black/25 transition-all group text-left no-underline"
                            >
                              {p.imageUrl ? (
                                <img src={p.imageUrl} alt={p.name} className="w-11 h-11 object-cover rounded-lg flex-shrink-0 bg-gray-100" />
                              ) : (
                                <div className="w-11 h-11 rounded-lg bg-gray-100 flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-black leading-snug line-clamp-2 group-hover:underline">{p.name}</p>
                                {p.price && (
                                  <p className="text-xs text-gray-500 mt-0.5">{p.price.toLocaleString("ru-RU")} ₽</p>
                                )}
                              </div>
                              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {aiLoading && (
                    <div className="flex justify-start">
                      <div className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center mr-2 flex-shrink-0">
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                      <div className="bg-white border border-black/8 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-black/30 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 bg-black/30 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 bg-black/30 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  )}

                  {/* After several messages, offer to switch to manager */}
                  {aiMessages.length >= 4 && aiMessages.length % 4 === 0 && !aiLoading && (
                    <div className="flex justify-center">
                      <button
                        onClick={() => setMode("manager")}
                        className="text-xs text-black/40 hover:text-black/70 underline underline-offset-2 transition-colors"
                      >
                        Хотите поговорить с менеджером?
                      </button>
                    </div>
                  )}

                  <div ref={aiBottomRef} />
                </div>

                <div className="flex-shrink-0 bg-white border-t border-black/8 flex items-center gap-1.5"
                  style={{ padding: "10px 12px", paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
                  <input
                    ref={aiInputRef}
                    placeholder="Спросите меня..."
                    value={aiInput}
                    onChange={e => setAiInput(e.target.value)}
                    onKeyDown={handleAiKeyDown}
                    disabled={aiLoading}
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-black/12 text-sm text-black placeholder-black/30 bg-black/[0.02] outline-none focus:border-black transition-colors disabled:opacity-50"
                    data-testid="input-ai-message"
                    style={{ fontSize: "16px" }}
                  />
                  <button
                    onClick={() => sendAiMessage(aiInput)}
                    disabled={!aiInput.trim() || aiLoading}
                    className="w-9 h-9 rounded-xl bg-black text-white flex items-center justify-center hover:bg-black/80 active:scale-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                    data-testid="button-ai-send"
                  >
                    {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </>
            )}

            {/* Manager mode */}
            {mode === "manager" && (
              !nameSet ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 bg-white">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-black flex items-center justify-center text-white">
                    <ChatIcon />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-sm sm:text-base text-black">Как вас зовут?</p>
                    <p className="text-xs sm:text-sm text-black/40 mt-1">Чтобы менеджер мог к вам обратиться</p>
                  </div>
                  <div className="w-full max-w-[240px] flex flex-col gap-2.5">
                    <input
                      placeholder="Ваше имя"
                      value={nameInput}
                      onChange={e => setNameInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSetName()}
                      className="w-full px-4 py-3 rounded-xl border border-black/15 text-sm text-black placeholder-black/30 bg-black/[0.02] outline-none focus:border-black transition-colors"
                      data-testid="input-chat-name"
                      autoFocus
                      style={{ fontSize: "16px" }}
                    />
                    <button
                      onClick={handleSetName}
                      className="w-full py-3 rounded-xl bg-black text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-black/80 active:scale-95 transition-all"
                      data-testid="button-chat-name-submit"
                    >
                      Начать чат <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0 bg-[#f7f7f7]">
                    {messages.filter(m => m.text || m.imageUrl).length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-black/8 flex items-center justify-center text-black/20">
                          <ChatIcon />
                        </div>
                        <p className="text-sm text-black/35 font-medium">Напишите нам — мы на связи!</p>
                      </div>
                    )}
                    {messages.filter(m => m.text || m.imageUrl).map(msg => (
                      <div key={msg.messageId} className={`flex ${msg.sender === "client" ? "justify-end" : "justify-start"}`}>
                        {msg.sender === "admin" && (
                          <div className="w-7 h-7 rounded-full bg-black text-white text-[10px] font-bold flex items-center justify-center mr-2 flex-shrink-0 mt-auto mb-0.5">М</div>
                        )}
                        <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm break-words shadow-sm
                          ${msg.sender === "client" ? "bg-black text-white rounded-br-md" : "bg-white text-black rounded-bl-md border border-black/8"}
                          ${msg.messageId.startsWith("temp-") ? "opacity-50" : ""}`}>
                          {msg.sender === "admin" && (
                            <p className="text-[10px] font-semibold mb-1 opacity-40 uppercase tracking-wide">{msg.userName || "Менеджер"}</p>
                          )}
                          {msg.imageUrl && (
                            <img src={msg.imageUrl} alt="Фото" className="rounded-lg max-w-full max-h-[200px] object-contain mb-1 cursor-pointer"
                              onClick={() => setPreviewImage(msg.imageUrl!)} data-testid={`img-chat-${msg.messageId}`} />
                          )}
                          {msg.text && msg.text !== "📷 Фото" && <p className="leading-snug">{msg.text}</p>}
                          <p className={`text-[10px] mt-1 ${msg.sender === "client" ? "text-white/40 text-right" : "text-black/30"}`}>
                            {new Date(msg.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div ref={managerBottomRef} />
                  </div>

                  <div className="flex-shrink-0 bg-white border-t border-black/8 flex items-center gap-1.5"
                    style={{ padding: "10px 12px", paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" data-testid="input-chat-file" />
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading || sending}
                      className="w-9 h-9 rounded-xl text-black/40 hover:text-black hover:bg-black/5 flex items-center justify-center active:scale-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                      data-testid="button-chat-attach" aria-label="Прикрепить фото">
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                    </button>
                    <input ref={managerInputRef} placeholder="Написать сообщение..." value={inputText}
                      onChange={e => setInputText(e.target.value)} onKeyDown={handleManagerKeyDown}
                      disabled={sending || uploading}
                      className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-black/12 text-sm text-black placeholder-black/30 bg-black/[0.02] outline-none focus:border-black transition-colors disabled:opacity-50"
                      data-testid="input-chat-message" style={{ fontSize: "16px" }} />
                    <button onClick={sendManagerMessage} disabled={!inputText.trim() || sending || uploading}
                      className="w-9 h-9 rounded-xl bg-black text-white flex items-center justify-center hover:bg-black/80 active:scale-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                      data-testid="button-chat-send">
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )
            )}
          </div>
        </>
      )}

      {/* Fullscreen image preview */}
      {previewImage && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)} data-testid="overlay-chat-image-preview">
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-white/30 transition-colors"
            onClick={() => setPreviewImage(null)} data-testid="button-close-image-preview">
            <X className="w-5 h-5" />
          </button>
          <img src={previewImage} alt="Просмотр фото" className="max-w-full max-h-full object-contain rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* Toggle button */}
      <div className="fixed bottom-6 right-6 z-50">
        <button onClick={() => setOpen(o => !o)}
          className="relative w-14 h-14 rounded-2xl bg-black text-white shadow-[0_4px_24px_rgba(0,0,0,0.35)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.45)] hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center"
          data-testid="button-chat-toggle" aria-label="Открыть чат">
          {open ? <X className="w-5 h-5" /> : <ChatIcon />}
          {!open && unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
