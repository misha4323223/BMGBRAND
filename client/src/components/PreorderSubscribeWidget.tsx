import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bell, CheckCircle2, Rocket, BellRing, BellOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

type PushState = "idle" | "loading" | "subscribed" | "denied" | "unsupported";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function subscribeToPush(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "idle";

  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch("/api/push/vapid-public-key");
    if (!keyRes.ok) return "idle";
    const { publicKey } = await keyRes.json();

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription }),
    });
    return res.ok ? "subscribed" : "idle";
  } catch {
    return "idle";
  }
}

async function getPushStatus(): Promise<"subscribed" | "idle" | "unsupported"> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "idle";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "subscribed" : "idle";
  } catch {
    return "idle";
  }
}

const TICKER_TEXT = "PRE-DROP  •  ЛИМИТИРОВАННЫЕ КОЛЛЕКЦИИ  •  ";

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
  const [pushState, setPushState] = useState<PushState>("idle");

  useEffect(() => {
    getPushStatus().then(status => {
      if (status === "unsupported") setPushState("unsupported");
      else if (status === "subscribed") setPushState("subscribed");
    });
  }, []);

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/preorder-subscribers/subscribe", { email });
    },
    onSuccess: () => setSubscribed(true),
  });

  async function handlePushSubscribe() {
    setPushState("loading");
    const result = await subscribeToPush();
    setPushState(result);
  }

  const stars = useMemo(() => Array.from({ length: 16 }).map((_, i) => ({
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

      {/* Заголовок — по центру на всю ширину */}
      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-7 sm:pt-9 pb-5 sm:pb-6 text-center">
        <div className="relative inline-flex items-center justify-center w-12 h-12 mb-4">
          <span className="predrop-ring absolute inset-0 rounded-full border border-[#E53935]/60" />
          <span className="predrop-ring absolute inset-0 rounded-full border border-[#E53935]/60" style={{ animationDelay: "0.6s" }} />
          <span className="predrop-ring absolute inset-0 rounded-full border border-[#E53935]/60" style={{ animationDelay: "1.2s" }} />
          <span className="relative w-10 h-10 rounded-full bg-[#E53935]/10 border border-[#E53935]/40 flex items-center justify-center">
            <Bell className="w-5 h-5" style={{ color: "#E53935" }} />
          </span>
        </div>

        <h2 className="text-2xl sm:text-4xl md:text-5xl font-black tracking-tight text-white leading-[1.05] mb-3 font-display">
          НЕ ПРОПУСТИ<br className="hidden sm:block" /> СЛЕДУЮЩИЙ ДРОП
        </h2>

        <p className="text-sm sm:text-base text-white/50 max-w-lg mx-auto leading-relaxed">
          Два способа быть первым.
        </p>
      </div>

      {/* Две панели на всю ширину */}
      <div className="relative w-full flex flex-col sm:flex-row border-t border-white/10">

        {/* Левая панель — Email */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 sm:px-10 lg:px-16 py-7 sm:py-8 text-center border-b sm:border-b-0 sm:border-r border-white/10">
          <div className="w-10 h-10 rounded-full bg-[#E53935]/10 border border-[#E53935]/30 flex items-center justify-center mb-3">
            <Rocket className="w-4 h-4" style={{ color: "#E53935" }} />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-white mb-1">Подписка на email</h3>
          <p className="text-xs text-white/40 mb-4 max-w-xs leading-relaxed">
            Письмо в момент открытия нового предзаказа. Никакого спама.
          </p>

          {subscribed ? (
            <div className="relative flex flex-col items-center gap-3" data-testid="predrop-subscribed-message">
              <div className="relative">
                <Sparks />
                <CheckCircle2 className="w-10 h-10 relative z-10" style={{ color: "#E53935" }} />
              </div>
              <p className="text-base font-bold text-white">Готово, ты в списке!</p>
              <p className="text-xs text-white/40 max-w-[200px]">Пришлём письмо как только откроется pre-drop</p>
            </div>
          ) : (
            <div className="w-full max-w-sm space-y-4">
              <div className="predrop-form-glow">
                <div className="flex flex-col gap-2 bg-white/5 rounded-2xl p-3 border border-white/10">
                  <Input
                    type="email"
                    placeholder="Твой email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && email && agreed && subscribeMutation.mutate()}
                    className="bg-transparent border-0 text-white placeholder:text-white/30 focus-visible:ring-0 h-11 px-3 rounded-xl"
                    data-testid="input-preorder-email"
                  />
                  <button
                    onClick={() => subscribeMutation.mutate()}
                    disabled={!email || !agreed || subscribeMutation.isPending}
                    className="w-full h-11 rounded-xl text-sm font-bold text-black hover:opacity-90 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                    style={{ backgroundColor: "#E53935" }}
                    data-testid="button-preorder-subscribe"
                  >
                    {subscribeMutation.isPending ? (
                      <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin block" />
                    ) : (
                      <>Подписаться <Rocket className="w-3.5 h-3.5" /></>
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
            </div>
          )}
        </div>

        {/* Разделитель «или» по центру — только на десктопе */}
        <div className="hidden sm:flex flex-col items-center justify-center px-0 relative">
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/10 -translate-x-1/2" />
          <span className="relative z-10 bg-black text-[11px] font-semibold tracking-[0.2em] text-white/25 uppercase py-2 px-1">или</span>
        </div>

        {/* Мобильный разделитель «или» */}
        <div className="sm:hidden flex items-center gap-3 px-6 py-4">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[11px] font-semibold tracking-[0.2em] text-white/25 uppercase">или</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Правая панель — Push */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 sm:px-10 lg:px-16 py-7 sm:py-8 text-center">
          {pushState === "unsupported" ? (
            <>
              <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-5">
                <BellOff className="w-5 h-5 text-white/30" />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white/30 mb-1">Уведомления в браузере</h3>
              <p className="text-sm text-white/25 max-w-xs">Твой браузер не поддерживает push-уведомления</p>
            </>
          ) : pushState === "subscribed" ? (
            <>
              <div className="w-12 h-12 rounded-full bg-[#E53935]/10 border border-[#E53935]/30 flex items-center justify-center mb-5">
                <BellRing className="w-5 h-5" style={{ color: "#E53935" }} />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white mb-1">Уведомления включены</h3>
              <p className="text-sm text-white/40 max-w-xs">Браузер оповестит тебя мгновенно, даже когда сайт закрыт</p>
            </>
          ) : pushState === "denied" ? (
            <>
              <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-5">
                <BellOff className="w-5 h-5 text-white/30" />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white/50 mb-1">Уведомления заблокированы</h3>
              <p className="text-sm text-white/30 max-w-xs">Разреши уведомления в настройках браузера и обнови страницу</p>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-white/5 border border-white/15 flex items-center justify-center mb-3">
                <BellRing className="w-4 h-4 text-white/60" />
              </div>
              <h3 className="text-base sm:text-lg font-bold text-white mb-1">ПУШ-уведомления</h3>
              <p className="text-xs text-white/40 mb-4 max-w-xs leading-relaxed">
                Тихо всплывёт на экране в нужный момент.
              </p>
              <div className="w-full max-w-sm">
                <button
                  onClick={handlePushSubscribe}
                  disabled={pushState === "loading"}
                  className="w-full h-12 rounded-2xl border border-white/20 text-sm font-bold text-white hover:bg-white/10 hover:border-white/40 disabled:opacity-40 transition-all flex items-center justify-center gap-2.5"
                >
                  {pushState === "loading" ? (
                    <span className="w-4 h-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin block" />
                  ) : (
                    <>
                      <Bell className="w-4 h-4" />
                      Включить уведомления
                    </>
                  )}
                </button>
                <p className="text-[11px] text-white/25 mt-3">Без регистрации — браузер спросит разрешение</p>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
