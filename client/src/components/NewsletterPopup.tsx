import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Copy, Bell, BellOff, Zap, Tag, Sparkles } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

type PushStatus = "idle" | "pending" | "subscribed" | "denied" | "unsupported";

async function subscribeToPush(): Promise<{ success: boolean; error?: string }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { success: false, error: "unsupported" };
  }
  try {
    const keyRes = await fetch("/api/push/vapid-public-key");
    if (!keyRes.ok) return { success: false, error: "no_vapid" };
    const { publicKey } = await keyRes.json();

    const swReadyTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 10_000)
    );
    const reg = await Promise.race([navigator.serviceWorker.ready, swReadyTimeout]);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return { success: false, error: "denied" };
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function NewsletterPopup() {
  const [isVisible, setIsVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [promoCode, setPromoCode] = useState("WELCOME10");
  const [consent, setConsent] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus>("idle");
  const [pushError, setPushError] = useState<string>("");
  const [showPrePrompt, setShowPrePrompt] = useState(false);

  const { data: promoData } = useQuery<{ popup: any; homepage: any }>({
    queryKey: ["/api/subscription-promos"],
  });
  const popupPromo = promoData?.popup;

  useEffect(() => {
    const dismissed = localStorage.getItem("newsletter-popup-dismissed");
    const subscribed = localStorage.getItem("newsletter-subscribed");
    const pushSubscribed = localStorage.getItem("push-subscribed");
    if (dismissed || subscribed || pushSubscribed) return;

    const timer = setTimeout(
      () => setIsVisible(true),
      popupPromo?.settings?.delay || 4000
    );
    return () => clearTimeout(timer);
  }, [popupPromo?.settings?.delay]);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushStatus("unsupported");
      return;
    }
    if (localStorage.getItem("push-subscribed")) {
      setPushStatus("subscribed");
    } else if (Notification.permission === "denied") {
      setPushStatus("denied");
    }
  }, []);

  const subscribeMutation = useMutation({
    mutationFn: async (emailAddr: string) => {
      const res = await apiRequest("POST", "/api/newsletter/subscribe", {
        email: emailAddr,
        source: "popup",
      });
      return res.json();
    },
    onSuccess: (data: { promoCode?: string }) => {
      setIsSubscribed(true);
      localStorage.setItem("newsletter-subscribed", "true");
      if (data.promoCode) setPromoCode(data.promoCode);
    },
    onError: (err: any) => setError(err.message || "Ошибка подписки"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !email.includes("@")) {
      setError("Введите корректный email");
      return;
    }
    if (!consent) {
      setError("Необходимо дать согласие на обработку данных");
      return;
    }
    subscribeMutation.mutate(email);
  };

  const handleDismiss = useCallback(() => {
    localStorage.setItem("newsletter-popup-dismissed", "true");
    setIsVisible(false);
  }, []);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(popupPromo?.code || promoCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Клик на кнопку → показываем наш красивый пре-попап
  const handlePushSubscribe = () => {
    if (pushStatus === "subscribed" || pushStatus === "pending") return;
    setShowPrePrompt(true);
  };

  // Подтверждение в пре-попапе → реальная подписка
  const handlePrePromptConfirm = async () => {
    setShowPrePrompt(false);
    setPushStatus("pending");
    setPushError("");

    const timeoutId = setTimeout(() => {
      setPushStatus("idle");
      setPushError("Браузер не ответил. Попробуйте ещё раз.");
    }, 15000);

    const result = await subscribeToPush();
    clearTimeout(timeoutId);

    if (result.success) {
      setPushStatus("subscribed");
      setPushError("");
      localStorage.setItem("push-subscribed", "true");
    } else if (result.error === "unsupported") {
      setPushStatus("unsupported");
    } else if (result.error === "denied") {
      setPushStatus("denied");
      setPushError("Разрешите уведомления в настройках браузера");
    } else {
      setPushStatus("idle");
      setPushError(result.error || "Не удалось подключить. Попробуйте ещё раз.");
    }
  };

  const pushLabel =
    pushStatus === "subscribed"
      ? "Уведомления включены ✓"
      : pushStatus === "pending"
      ? "Подключение..."
      : pushStatus === "denied"
      ? "Попробовать снова"
      : "Подписаться на уведомления";

  const showPushBlock = pushStatus !== "unsupported";

  return (
    <>
    {/* ── Пре-попап разрешения на уведомления ─────────────────────── */}
    <AnimatePresence>
      {showPrePrompt && (
        <>
          <motion.div
            key="pre-prompt-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-[300]"
            onClick={() => setShowPrePrompt(false)}
          />
          <motion.div
            key="pre-prompt-card"
            initial={{ opacity: 0, scale: 0.88, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="fixed inset-0 flex items-center justify-center z-[301] p-6"
          >
            <div
              className="relative w-full max-w-[320px] rounded-2xl overflow-hidden"
              style={{
                background: "rgba(12, 12, 12, 0.96)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
              }}
            >
              {/* Красная линия сверху */}
              <div className="h-[3px] w-full bg-gradient-to-r from-transparent via-red-600 to-transparent" />

              <div className="px-6 pt-6 pb-7 space-y-5">
                {/* Иконка */}
                <div className="flex justify-center">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center"
                    style={{
                      background: "rgba(220,38,38,0.12)",
                      border: "1px solid rgba(220,38,38,0.25)",
                      boxShadow: "0 0 32px rgba(220,38,38,0.15)",
                    }}
                  >
                    <Bell className="w-7 h-7 text-red-500" />
                  </div>
                </div>

                {/* Текст */}
                <div className="text-center space-y-2">
                  <h3 className="text-white font-bold text-[17px] leading-snug">
                    Узнавай о новинках первым
                  </h3>
                  <p className="text-white/45 text-[13px] leading-relaxed">
                    Включи уведомления — мы напишем когда выйдут новые дропы, скидки и эксклюзивные предложения
                  </p>
                </div>

                {/* Что будет приходить */}
                <div className="space-y-2">
                  {[
                    { icon: <Zap className="w-3.5 h-3.5 text-red-400 shrink-0" />, text: "Новые дропы и коллекции" },
                    { icon: <Tag className="w-3.5 h-3.5 text-red-400 shrink-0" />, text: "Скидки и акции" },
                    { icon: <Sparkles className="w-3.5 h-3.5 text-red-400 shrink-0" />, text: "Эксклюзивные предложения" },
                  ].map(({ icon, text }) => (
                    <div key={text} className="flex items-center gap-2.5">
                      <div
                        className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                        style={{ background: "rgba(220,38,38,0.1)" }}
                      >
                        {icon}
                      </div>
                      <span className="text-white/55 text-[12px]">{text}</span>
                    </div>
                  ))}
                </div>

                {/* Кнопки */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setShowPrePrompt(false)}
                    className="flex-1 py-3 rounded-xl text-sm font-medium text-white/35 transition-all hover:text-white/55"
                    style={{ border: "1px solid rgba(255,255,255,0.07)" }}
                    data-testid="button-push-preprompt-decline"
                  >
                    Нет, позже
                  </button>
                  <button
                    onClick={handlePrePromptConfirm}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.97]"
                    style={{
                      background: "linear-gradient(135deg, #dc2626, #b91c1c)",
                      boxShadow: "0 4px 16px rgba(220,38,38,0.35)",
                    }}
                    data-testid="button-push-preprompt-confirm"
                  >
                    Да, хочу! 🔔
                  </button>
                </div>

                <p className="text-white/18 text-[10px] text-center">
                  Отписаться можно в любой момент
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>

    {/* ── Основной попап рассылки ───────────────────────────────────── */}
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
            onClick={handleDismiss}
          />

          {/* Popup */}
          <motion.div
            initial={{ opacity: 0, y: 48, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 32, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="fixed inset-0 flex items-center justify-center z-[201] p-4"
          >
            <div
              className="relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
              style={{
                background: "rgba(10, 10, 10, 0.88)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              {/* Red accent line top */}
              <div className="h-[3px] w-full bg-gradient-to-r from-transparent via-primary to-transparent" />

              {/* Close */}
              <button
                onClick={handleDismiss}
                className="absolute top-4 right-4 text-white/30 hover:text-white/70 transition-colors z-10"
                data-testid="button-close-newsletter-popup"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="px-7 pt-7 pb-8">
                {!isSubscribed ? (
                  <div className="space-y-5">
                    {/* Header */}
                    <div className="text-center">
                      <div
                        className="text-6xl sm:text-7xl font-black text-primary leading-none mb-3 select-none"
                        style={{
                          textShadow:
                            "0 0 48px rgba(220,38,38,0.45), 0 0 80px rgba(220,38,38,0.2)",
                        }}
                      >
                        -{popupPromo?.discountPercent || 10}%
                      </div>
                      <h3 className="text-xs font-bold text-white/90 uppercase tracking-[0.2em] mb-2">
                        {popupPromo?.settings?.title || "Эксклюзивное предложение"}
                      </h3>
                      <p className="text-white/40 text-[13px] leading-relaxed">
                        {popupPromo?.settings?.description ||
                          "Скидка на первый заказ при подписке на рассылку. Будьте первыми, кто узнаёт о новых дропах."}
                      </p>
                    </div>

                    {/* Email Form */}
                    <form onSubmit={handleSubmit} className="space-y-3">
                      <input
                        type="email"
                        placeholder={popupPromo?.settings?.placeholder || "Ваш email"}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-primary/60 transition-all"
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.1)",
                        }}
                        data-testid="input-newsletter-email"
                      />

                      <button
                        type="submit"
                        disabled={subscribeMutation.isPending}
                        className="w-full bg-primary hover:bg-primary/85 active:scale-[0.98] text-white font-bold tracking-wider uppercase text-sm py-3.5 rounded-xl transition-all disabled:opacity-60"
                        data-testid="button-subscribe-newsletter"
                      >
                        {subscribeMutation.isPending
                          ? "..."
                          : popupPromo?.settings?.buttonText || "Получить скидку"}
                      </button>

                      {error && (
                        <p className="text-red-400 text-xs text-center">{error}</p>
                      )}

                      <label
                        className="flex items-start gap-2.5 cursor-pointer"
                        data-testid="label-newsletter-consent"
                      >
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                          className="mt-0.5 accent-primary shrink-0"
                          data-testid="checkbox-newsletter-consent"
                        />
                        <span className="text-white/25 text-[11px] leading-relaxed">
                          Я соглашаюсь на обработку персональных данных и получение
                          рассылки в соответствии с{" "}
                          <a
                            href="/privacy"
                            className="underline hover:text-white/50 transition-colors"
                            target="_blank"
                          >
                            политикой конфиденциальности
                          </a>
                        </span>
                      </label>
                    </form>

                    {/* Push block — разделитель и кнопка подписки на push */}
                    {showPushBlock && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex-1 h-px"
                            style={{ background: "rgba(255,255,255,0.08)" }}
                          />
                          <span className="text-white/20 text-[11px] uppercase tracking-widest shrink-0">
                            или
                          </span>
                          <div
                            className="flex-1 h-px"
                            style={{ background: "rgba(255,255,255,0.08)" }}
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handlePushSubscribe}
                          disabled={
                            pushStatus === "subscribed" ||
                            pushStatus === "pending"
                          }
                          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all active:scale-[0.98]"
                          style={{
                            border:
                              pushStatus === "subscribed"
                                ? "1px solid rgba(34,197,94,0.35)"
                                : pushStatus === "denied"
                                ? "1px solid rgba(239,68,68,0.25)"
                                : "1px solid rgba(255,255,255,0.12)",
                            background:
                              pushStatus === "subscribed"
                                ? "rgba(34,197,94,0.08)"
                                : pushStatus === "denied"
                                ? "rgba(239,68,68,0.06)"
                                : "rgba(255,255,255,0.04)",
                            color:
                              pushStatus === "subscribed"
                                ? "rgba(134,239,172,0.9)"
                                : pushStatus === "denied"
                                ? "rgba(255,150,150,0.8)"
                                : "rgba(255,255,255,0.55)",
                            cursor: pushStatus === "subscribed" ? "default" : "pointer",
                          }}
                          data-testid="button-push-subscribe"
                        >
                          {pushStatus === "subscribed" ? (
                            <Check className="w-4 h-4 text-green-400" />
                          ) : pushStatus === "denied" ? (
                            <Bell className="w-4 h-4" />
                          ) : (
                            <Bell className="w-4 h-4" />
                          )}
                          <span>{pushLabel}</span>
                        </button>

                        {pushError && (
                          <p className="text-red-400/60 text-[10px] text-center leading-relaxed">
                            {pushError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  // ── Email success screen ──────────────────────────────────
                  <div className="text-center space-y-5">
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                      style={{
                        border: "1px solid rgba(220,38,38,0.4)",
                        boxShadow: "0 0 24px rgba(220,38,38,0.2)",
                      }}
                    >
                      <Check className="w-7 h-7 text-primary" />
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-white mb-1">
                        {popupPromo?.settings?.successTitle || "Добро пожаловать!"}
                      </h3>
                      <p className="text-white/40 text-sm">
                        {popupPromo?.settings?.successText ||
                          "Ваш промокод на скидку"}{" "}
                        {popupPromo?.discountPercent || 10}%
                      </p>
                    </div>

                    <div
                      onClick={handleCopyCode}
                      className="cursor-pointer rounded-xl p-4 transition-all group hover:border-primary/40"
                      style={{
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.03)",
                      }}
                      data-testid="button-copy-promo-code"
                    >
                      <div className="flex items-center justify-center gap-3">
                        <span
                          className="text-2xl font-black text-primary tracking-widest"
                          style={{ textShadow: "0 0 24px rgba(220,38,38,0.4)" }}
                        >
                          {popupPromo?.code || promoCode}
                        </span>
                        {copied ? (
                          <Check className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4 text-white/25 group-hover:text-primary transition-colors" />
                        )}
                      </div>
                      <p className="text-white/25 text-[11px] mt-1">
                        {copied ? "Скопировано!" : "Нажмите, чтобы скопировать"}
                      </p>
                    </div>

                    {/* Push option на экране успеха */}
                    {showPushBlock && pushStatus !== "subscribed" && pushStatus !== "denied" && (
                      <button
                        type="button"
                        onClick={handlePushSubscribe}
                        disabled={pushStatus === "pending"}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium transition-all"
                        style={{
                          border: "1px solid rgba(255,255,255,0.1)",
                          background: "rgba(255,255,255,0.03)",
                          color: "rgba(255,255,255,0.4)",
                        }}
                        data-testid="button-push-subscribe-success"
                      >
                        <Bell className="w-3.5 h-3.5" />
                        <span>
                          {pushStatus === "pending"
                            ? "Подключение..."
                            : "Также включить push-уведомления"}
                        </span>
                      </button>
                    )}
                    {showPushBlock && pushStatus === "subscribed" && (
                      <p className="text-green-400/70 text-[11px] flex items-center justify-center gap-1.5">
                        <Check className="w-3.5 h-3.5" /> Push-уведомления включены
                      </p>
                    )}

                    <button
                      onClick={handleDismiss}
                      className="w-full py-3 rounded-xl text-sm font-medium text-white/50 hover:text-white/80 transition-colors"
                      style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                      data-testid="button-close-after-subscribe"
                    >
                      {popupPromo?.settings?.closeText || "За покупками →"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
    </>
  );
}
