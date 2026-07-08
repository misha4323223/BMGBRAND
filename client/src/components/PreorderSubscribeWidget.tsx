import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, CheckCircle2, Sparkles, Rocket } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

const TICKER_TEXT = "PRE-DROP  •  ГОЛОСУЙ РУБЛЁМ  •  ЛИМИТИРОВАННЫЕ ДРОПЫ  •  ТОЛЬКО ДЛЯ СВОИХ  •  ";

function useCountUp(target: number, durationMs = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!target) { setValue(0); return; }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function Sparks() {
  const sparks = useMemo(() => Array.from({ length: 14 }).map((_, i) => {
    const angle = (i / 14) * Math.PI * 2;
    const dist = 60 + Math.random() * 40;
    return {
      id: i,
      sx: `${Math.cos(angle) * dist}px`,
      sy: `${Math.sin(angle) * dist}px`,
      delay: `${Math.random() * 0.15}s`,
    };
  }), []);
  return (
    <>
      {sparks.map(s => (
        <span
          key={s.id}
          className="predrop-spark"
          style={{ ["--sx" as any]: s.sx, ["--sy" as any]: s.sy, animationDelay: s.delay }}
        />
      ))}
    </>
  );
}

export function PreorderSubscribeWidget() {
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/preorder-subscribers/count"],
  });
  const count = useCountUp(countData?.count ?? 0);

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/preorder-subscribers/subscribe", { email });
    },
    onSuccess: () => setSubscribed(true),
  });

  const stars = useMemo(() => Array.from({ length: 26 }).map((_, i) => ({
    id: i,
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    size: `${1 + Math.random() * 2}px`,
    duration: `${2 + Math.random() * 3}s`,
    delay: `${Math.random() * 3}s`,
  })), []);

  return (
    <section
      className="relative bg-black overflow-hidden"
      data-testid="section-predrop-subscribe"
    >
      {/* Звёздное поле */}
      <div className="absolute inset-0">
        {stars.map(s => (
          <span
            key={s.id}
            className="predrop-star"
            style={{ top: s.top, left: s.left, width: s.size, height: s.size, animationDuration: s.duration, animationDelay: s.delay }}
          />
        ))}
      </div>

      {/* Космические блобы-свечения */}
      <div
        className="predrop-blob-1 absolute -top-1/3 -left-1/4 w-[70vw] h-[70vw] max-w-[600px] max-h-[600px] rounded-full opacity-30 blur-[100px] pointer-events-none"
        style={{ background: "radial-gradient(circle, #E53935 0%, transparent 70%)" }}
      />
      <div
        className="predrop-blob-2 absolute -bottom-1/3 -right-1/4 w-[60vw] h-[60vw] max-w-[520px] max-h-[520px] rounded-full opacity-20 blur-[100px] pointer-events-none"
        style={{ background: "radial-gradient(circle, #7C4DFF 0%, transparent 70%)" }}
      />

      {/* Верхний тикер */}
      <div className="relative border-b border-white/10 overflow-hidden py-2.5 bg-white/[0.03]">
        <div className="merch-marquee-track flex whitespace-nowrap">
          <span className="text-[11px] font-semibold tracking-[0.25em] text-white/40 uppercase px-2">
            {TICKER_TEXT.repeat(4)}
          </span>
          <span className="text-[11px] font-semibold tracking-[0.25em] text-white/40 uppercase px-2" aria-hidden>
            {TICKER_TEXT.repeat(4)}
          </span>
        </div>
      </div>

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
        {/* Иконка с пульсирующими кольцами */}
        <div className="relative inline-flex items-center justify-center w-16 h-16 mb-6">
          <span className="predrop-ring absolute inset-0 rounded-full border border-[#E53935]/60" />
          <span className="predrop-ring absolute inset-0 rounded-full border border-[#E53935]/60" style={{ animationDelay: "0.6s" }} />
          <span className="predrop-ring absolute inset-0 rounded-full border border-[#E53935]/60" style={{ animationDelay: "1.2s" }} />
          <span className="relative w-14 h-14 rounded-full bg-[#E53935]/10 border border-[#E53935]/40 flex items-center justify-center">
            <Bell className="w-6 h-6" style={{ color: "#E53935" }} />
          </span>
        </div>

        <h2 className="text-3xl sm:text-5xl md:text-6xl font-black tracking-tight text-white leading-[1.05] mb-4 font-display">
          НЕ ПРОПУСТИ<br className="hidden sm:block" /> СЛЕДУЮЩИЙ ДРОП
        </h2>

        <p className="text-sm sm:text-base text-white/50 max-w-lg mx-auto mb-8 leading-relaxed">
          Подпишись — и узнаешь о новом pre-drop раньше всех. Никакого спама,
          только моменты, когда решается, что мы шьём дальше.
        </p>

        {/* Соц. доказательство */}
        {(countData?.count ?? 0) > 0 && (
          <div className="predrop-count-pop inline-flex items-center gap-2 mb-8 px-4 py-2 rounded-full bg-white/5 border border-white/10">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: "#E53935" }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: "#E53935" }} />
            </span>
            <span className="text-xs sm:text-sm text-white/70">
              <span className="font-bold text-white tabular-nums">{count.toLocaleString("ru-RU")}</span> человек уже в списке ожидания
            </span>
          </div>
        )}

        {subscribed ? (
          <div className="relative flex flex-col items-center gap-3 py-6" data-testid="predrop-subscribed-message">
            <div className="relative">
              <Sparks />
              <CheckCircle2 className="w-12 h-12 relative z-10" style={{ color: "#E53935" }} />
            </div>
            <p className="text-lg font-bold text-white">Готово, ты в списке!</p>
            <p className="text-sm text-white/50 max-w-xs">
              Как только откроется новый pre-drop — пришлём письмо первым делом
            </p>
          </div>
        ) : (
          <div className="max-w-md mx-auto space-y-4">
            <div className="predrop-form-glow">
              <div className="flex flex-col sm:flex-row gap-2 bg-black rounded-full p-1.5">
                <Input
                  type="email"
                  placeholder="Твой email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && email && agreed && subscribeMutation.mutate()}
                  className="flex-1 bg-transparent border-0 text-white placeholder:text-white/30 focus-visible:ring-0 h-11 px-4 rounded-full"
                  data-testid="input-preorder-email"
                />
                <button
                  onClick={() => subscribeMutation.mutate()}
                  disabled={!email || !agreed || subscribeMutation.isPending}
                  className="shrink-0 h-11 px-6 rounded-full text-sm font-bold text-black hover:opacity-90 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                  style={{ backgroundColor: "#E53935" }}
                  data-testid="button-preorder-subscribe"
                >
                  {subscribeMutation.isPending ? (
                    <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin block" />
                  ) : (
                    <>
                      Подписаться <Rocket className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>

            <label className="flex items-start gap-2 cursor-pointer group justify-center">
              <input
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                className="mt-0.5 shrink-0"
                style={{ accentColor: "#E53935" }}
                data-testid="checkbox-preorder-agree"
              />
              <span className="text-[11px] text-white/35 group-hover:text-white/55 transition-colors leading-relaxed text-left max-w-xs">
                Соглашаюсь получать уведомления о новых предзаказах. Отписаться можно в любой момент в личном кабинете.
              </span>
            </label>

            {subscribeMutation.isError && (
              <p className="text-red-400 text-xs">Ошибка. Попробуй ещё раз.</p>
            )}

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-white/25 pt-1">
              <Sparkles className="w-3 h-3" />
              <span>Без спама. Только сигналы о запуске</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
