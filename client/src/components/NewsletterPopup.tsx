import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Copy } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export function NewsletterPopup() {
  const [isVisible, setIsVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [promoCode, setPromoCode] = useState("WELCOME10");
  const [consent, setConsent] = useState(false);

  const { data: promoData } = useQuery<{ popup: any; homepage: any }>({
    queryKey: ["/api/subscription-promos"],
  });
  const popupPromo = promoData?.popup;

  useEffect(() => {
    const dismissed = localStorage.getItem("newsletter-popup-dismissed");
    const subscribed = localStorage.getItem("newsletter-subscribed");
    if (!dismissed && !subscribed) {
      const timer = setTimeout(() => setIsVisible(true), popupPromo?.settings?.delay || 4000);
      return () => clearTimeout(timer);
    }
  }, [popupPromo?.settings?.delay]);

  const subscribeMutation = useMutation({
    mutationFn: async (emailAddr: string) => {
      const res = await apiRequest("POST", "/api/newsletter/subscribe", { email: emailAddr, source: "popup" });
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
    if (!email || !email.includes("@")) { setError("Введите корректный email"); return; }
    if (!consent) { setError("Необходимо дать согласие на обработку данных"); return; }
    subscribeMutation.mutate(email);
  };

  const handleDismiss = () => {
    localStorage.setItem("newsletter-popup-dismissed", "true");
    setIsVisible(false);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(popupPromo?.code || promoCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
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
            <div className="relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
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
                        style={{ textShadow: "0 0 48px rgba(220,38,38,0.45), 0 0 80px rgba(220,38,38,0.2)" }}
                      >
                        -{popupPromo?.discountPercent || 10}%
                      </div>
                      <h3 className="text-xs font-bold text-white/90 uppercase tracking-[0.2em] mb-2">
                        {popupPromo?.settings?.title || "Эксклюзивное предложение"}
                      </h3>
                      <p className="text-white/40 text-[13px] leading-relaxed">
                        {popupPromo?.settings?.description || "Скидка на первый заказ при подписке на рассылку. Будьте первыми, кто узнаёт о новых дропах."}
                      </p>
                    </div>

                    {/* Form */}
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
                        {subscribeMutation.isPending ? "..." : (popupPromo?.settings?.buttonText || "Получить скидку")}
                      </button>

                      {error && (
                        <p className="text-red-400 text-xs text-center">{error}</p>
                      )}

                      <label className="flex items-start gap-2.5 cursor-pointer" data-testid="label-newsletter-consent">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                          className="mt-0.5 accent-primary shrink-0"
                          data-testid="checkbox-newsletter-consent"
                        />
                        <span className="text-white/25 text-[11px] leading-relaxed">
                          Я соглашаюсь на обработку персональных данных и получение рассылки в соответствии с{" "}
                          <a href="/privacy" className="underline hover:text-white/50 transition-colors" target="_blank">
                            политикой конфиденциальности
                          </a>
                        </span>
                      </label>
                    </form>
                  </div>
                ) : (
                  <div className="text-center space-y-5">
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                      style={{ border: "1px solid rgba(220,38,38,0.4)", boxShadow: "0 0 24px rgba(220,38,38,0.2)" }}
                    >
                      <Check className="w-7 h-7 text-primary" />
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-white mb-1">
                        {popupPromo?.settings?.successTitle || "Добро пожаловать!"}
                      </h3>
                      <p className="text-white/40 text-sm">
                        {popupPromo?.settings?.successText || "Ваш промокод на скидку"} {popupPromo?.discountPercent || 10}%
                      </p>
                    </div>

                    <div
                      onClick={handleCopyCode}
                      className="cursor-pointer rounded-xl p-4 transition-all group hover:border-primary/40"
                      style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
                      data-testid="button-copy-promo-code"
                    >
                      <div className="flex items-center justify-center gap-3">
                        <span
                          className="text-2xl font-black text-primary tracking-widest"
                          style={{ textShadow: "0 0 24px rgba(220,38,38,0.4)" }}
                        >
                          {popupPromo?.code || promoCode}
                        </span>
                        {copied
                          ? <Check className="w-4 h-4 text-green-400" />
                          : <Copy className="w-4 h-4 text-white/25 group-hover:text-primary transition-colors" />}
                      </div>
                      <p className="text-white/25 text-[11px] mt-1">
                        {copied ? "Скопировано!" : "Нажмите, чтобы скопировать"}
                      </p>
                    </div>

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
  );
}
