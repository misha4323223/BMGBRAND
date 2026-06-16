import { useRef, useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

interface PromoBannerSettings {
  visible: boolean;
  title: string;
  subtitle: string;
  buttonText: string;
  buttonLink: string;
  bgImage: string;
  bgColor: string;
  textColor: string;
  size: string;
  rounded: boolean;
  effect: string;
  position?: string;
}

const THEMES: Record<string, {
  wrap: string;
  wrapStyle?: React.CSSProperties;
  label: string;
  title: string;
  subtitle: string;
  divider: string;
  btnBg: string;
  btnText: string;
  btnBorder: string;
  deco: string;
}> = {
  black: {
    wrap: "bg-[#111111]",
    label: "text-white/35",
    title: "text-white",
    subtitle: "text-white/60",
    divider: "bg-white/10",
    btnBg: "bg-white hover:bg-white/90",
    btnText: "text-black",
    btnBorder: "border-transparent",
    deco: "bg-white/5",
  },
  white: {
    wrap: "bg-white border border-neutral-200",
    label: "text-neutral-400",
    title: "text-neutral-900",
    subtitle: "text-neutral-500",
    divider: "bg-neutral-200",
    btnBg: "bg-black hover:bg-neutral-800",
    btnText: "text-white",
    btnBorder: "border-transparent",
    deco: "bg-black/4",
  },
  red: {
    wrap: "",
    wrapStyle: { backgroundColor: "#CC1F1F" },
    label: "text-white/50",
    title: "text-white",
    subtitle: "text-white/70",
    divider: "bg-white/15",
    btnBg: "bg-white hover:bg-white/90",
    btnText: "text-[#CC1F1F]",
    btnBorder: "border-transparent",
    deco: "bg-white/8",
  },
  gray: {
    wrap: "bg-neutral-800",
    label: "text-white/35",
    title: "text-white",
    subtitle: "text-white/60",
    divider: "bg-white/10",
    btnBg: "bg-white hover:bg-white/90",
    btnText: "text-neutral-900",
    btnBorder: "border-transparent",
    deco: "bg-white/5",
  },
  gradient: {
    wrap: "",
    wrapStyle: { background: "linear-gradient(110deg, #0f0f0f 0%, #1c1c1c 50%, #111 100%)" },
    label: "text-white/35",
    title: "text-white",
    subtitle: "text-white/60",
    divider: "bg-white/10",
    btnBg: "bg-white hover:bg-white/90",
    btnText: "text-black",
    btnBorder: "border-transparent",
    deco: "bg-white/5",
  },
};

const SIZE_Y: Record<string, string> = {
  compact: "py-5 sm:py-6",
  medium:  "py-8 sm:py-10",
  large:   "py-12 sm:py-16",
};

export default function PromoBanner({ settings }: { settings: PromoBannerSettings }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.08 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (!settings || settings.visible === false) return null;
  if (!settings.title && !settings.subtitle) return null;

  const hasBgImage = !!settings.bgImage;
  const theme = THEMES[settings.bgColor] || THEMES.black;
  const sizeClass = SIZE_Y[settings.size] || SIZE_Y.medium;
  const roundedClass = settings.rounded ? "rounded-2xl mx-4 sm:mx-6 lg:mx-8 overflow-hidden" : "";

  const wrapBg = hasBgImage
    ? {
        backgroundImage: `url(${settings.bgImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        ...(settings.effect === "parallax" ? { backgroundAttachment: "fixed" } : {}),
      }
    : (theme.wrapStyle || {});

  const isLight = settings.bgColor === "white";

  const inner = (
    <div
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : "translateY(16px)",
        transition: "opacity 0.55s ease-out, transform 0.55s ease-out",
      }}
      className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-8 lg:px-10"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8">

        {/* Left: text */}
        <div className="flex-1 min-w-0">
          {/* Small label/eyebrow */}
          <p className={`text-[10px] uppercase tracking-[0.18em] font-semibold mb-2 ${hasBgImage ? "text-white/50" : theme.label}`}>
            BOOOMERANGS
          </p>

          <h2
            className={`font-bold tracking-tight leading-none mb-0 ${hasBgImage ? "text-white" : theme.title} ${
              settings.size === "large"  ? "text-2xl sm:text-4xl" :
              settings.size === "compact" ? "text-lg sm:text-xl" :
              "text-xl sm:text-3xl"
            }`}
            data-testid="text-promo-title"
          >
            {settings.title}
          </h2>

          {settings.subtitle && (
            <p
              className={`mt-2 text-sm leading-relaxed ${hasBgImage ? "text-white/65" : theme.subtitle} ${
                settings.size === "compact" ? "text-xs" : "text-sm"
              }`}
              data-testid="text-promo-subtitle"
            >
              {settings.subtitle}
            </p>
          )}
        </div>

        {/* Divider (desktop) */}
        {settings.buttonText && settings.buttonLink && (
          <div className={`hidden sm:block shrink-0 w-px self-stretch ${hasBgImage ? "bg-white/15" : theme.divider}`} />
        )}

        {/* Right: CTA */}
        {settings.buttonText && settings.buttonLink && (
          <div className="shrink-0">
            <Link href={settings.buttonLink} data-testid="link-promo-cta">
              <span
                className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
                  hasBgImage
                    ? "bg-white text-black hover:bg-white/90"
                    : `${theme.btnBg} ${theme.btnText}`
                }`}
                data-testid="button-promo-cta"
              >
                {settings.buttonText}
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <section
      ref={ref}
      className={`relative overflow-hidden ${sizeClass} ${roundedClass} ${!hasBgImage ? theme.wrap : ""}`}
      style={wrapBg}
      data-testid="section-promo-banner"
    >
      {/* Background image overlays */}
      {hasBgImage && settings.effect !== "blur" && (
        <div className="absolute inset-0 bg-black/55" />
      )}
      {hasBgImage && settings.effect === "blur" && (
        <>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${settings.bgImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(8px)",
              transform: "scale(1.12)",
            }}
          />
          <div className="absolute inset-0 bg-black/50" />
        </>
      )}

      {/* Subtle decorative diagonal stripe — only on solid-color banners */}
      {!hasBgImage && (
        <div
          aria-hidden
          className={`pointer-events-none absolute -right-16 top-0 bottom-0 w-64 ${isLight ? "bg-black/[0.03]" : "bg-white/[0.035]"}`}
          style={{ transform: "skewX(-12deg)" }}
        />
      )}

      <div className="flex items-center h-full">
        {inner}
      </div>
    </section>
  );
}
