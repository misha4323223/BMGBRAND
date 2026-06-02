import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { X, ArrowRight, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const STORAGE_KEY = "partner_banner_dismissed_session";
const SHOW_DELAY_MS = 3000;
const HIDDEN_PATHS = ["/partner", "/admin", "/wholesale"];

export function usePartnerBanner() {
  const [location] = useLocation();
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const { data: authData } = useAuth();

  const user = authData?.user;
  const isPartner = user?.role === "partner";
  const isHiddenPage = HIDDEN_PATHS.some((p) => location.startsWith(p));

  useEffect(() => {
    if (isHiddenPage) return;
    if (isPartner) return;
    if (sessionStorage.getItem(STORAGE_KEY) === "1") return;

    const t = setTimeout(() => {
      setRendered(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    }, SHOW_DELAY_MS);

    return () => clearTimeout(t);
  }, [isHiddenPage, isPartner]);

  const dismiss = () => {
    setVisible(false);
    sessionStorage.setItem(STORAGE_KEY, "1");
    setTimeout(() => setRendered(false), 400);
  };

  return { visible, rendered: rendered && !isHiddenPage && !isPartner, dismiss };
}

interface PartnerBannerContentProps {
  visible: boolean;
  rendered: boolean;
  dismiss: () => void;
}

export function PartnerBannerContent({ visible, rendered, dismiss }: PartnerBannerContentProps) {
  if (!rendered) return null;

  return (
    <div
      data-testid="partner-banner"
      style={{
        maxHeight: visible ? "200px" : "0px",
        opacity: visible ? 1 : 0,
        overflow: "hidden",
        transition: "max-height 0.5s cubic-bezier(0.16,1,0.3,1), opacity 0.35s ease",
        willChange: "max-height, opacity",
      }}
    >
      {/* Mobile */}
      <div
        className="flex sm:hidden items-center gap-2 px-3 py-2"
        style={{ borderTop: "1px solid rgba(0,0,0,0.10)" }}
      >
        <span className="text-[11px] text-foreground/70 flex-1 min-w-0 leading-tight">
          Рекламируй <span className="font-bold">BOOOMERANGS</span><br />
          <span className="text-foreground/50">и зарабатывай на этом</span>
        </span>
        <Link
          href="/partner/register"
          onClick={dismiss}
          data-testid="link-partner-banner-cta"
          className="text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0"
          style={{ background: "#E53935", color: "#fff" }}
        >
          Стать партнёром
        </Link>
        <button
          onClick={dismiss}
          data-testid="button-partner-banner-close"
          className="p-1 shrink-0 rounded-full text-foreground/30 hover:text-foreground/70 transition-colors"
          aria-label="Закрыть"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Desktop */}
      <div
        className="hidden sm:block relative"
        style={{ borderTop: "1px solid rgba(0,0,0,0.07)" }}
      >
        <div className="flex items-center justify-between gap-6 px-8 lg:px-16 py-3.5">
          {/* Левая часть */}
          <div className="flex items-center gap-4 min-w-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "#E53935" }}
            >
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0" style={{ borderLeft: "2px solid #E53935", paddingLeft: "12px" }}>
              <p className="text-foreground text-base font-black leading-tight tracking-tight">
                Рекламируй{" "}
                <span style={{ color: "#E53935" }}>BOOOMERANGS</span>{" "}
                и зарабатывай на этом
              </p>
              <p className="text-black/70 text-sm mt-0.5 font-medium">
                Присоединяйся к партнёрской программе — получай комиссию с каждого заказа
              </p>
            </div>
          </div>

          {/* Правая часть */}
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/partner/register"
              onClick={dismiss}
              data-testid="link-partner-banner-cta"
              className="group flex items-center gap-2 font-bold text-sm px-5 py-2 rounded-full whitespace-nowrap transition-all duration-200"
              style={{ background: "#E53935", color: "#fff" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#c62828"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#E53935"; }}
            >
              Стать партнёром
              <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <button
              onClick={dismiss}
              data-testid="button-partner-banner-close"
              className="p-1.5 rounded-full text-black/30 hover:text-black/70 hover:bg-black/5 transition-all duration-150"
              aria-label="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
