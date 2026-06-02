import { useRef, useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

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

const sizeMap: Record<string, string> = {
  compact: "py-8",
  medium: "py-16",
  large: "py-24",
};

function getBgStyles(bgColor: string, hasBgImage: boolean) {
  if (hasBgImage) return { className: "", style: {} as Record<string, string> };

  const map: Record<string, { className: string; style: Record<string, string> }> = {
    black: { className: "bg-[#111111]", style: {} },
    white: { className: "bg-white border border-neutral-200", style: {} },
    red: { className: "", style: { backgroundColor: "#E53935" } },
    gray: { className: "bg-neutral-700", style: {} },
    gradient: { className: "", style: { background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a1a 100%)" } },
  };
  return map[bgColor] || map.black;
}

function getTextClasses(textColor: string, bgColor: string, hasBgImage: boolean) {
  const isDark = textColor === "dark" || (!hasBgImage && bgColor === "white" && textColor !== "light");
  return {
    title: isDark ? "text-neutral-900" : "text-white",
    subtitle: isDark ? "text-neutral-600" : "text-white/80",
    isDark,
  };
}

export default function PromoBanner({ settings }: { settings: PromoBannerSettings }) {
  if (!settings || settings.visible === false) return null;
  if (!settings.title && !settings.subtitle) return null;

  const sizeClass = sizeMap[settings.size] || sizeMap.medium;
  const hasBgImage = !!settings.bgImage;
  const roundedClass = settings.rounded ? "rounded-2xl mx-4 sm:mx-6 lg:mx-8" : "";
  const bgStyles = getBgStyles(settings.bgColor, hasBgImage);
  const textClasses = getTextClasses(settings.textColor, settings.bgColor, hasBgImage);

  const isBlurEffect = settings.effect === "blur" && hasBgImage;
  const isParallax = settings.effect === "parallax" && hasBgImage;
  const isGradientOverlay = settings.effect === "gradient-overlay";
  const isAnimate = settings.effect === "animate";

  const bgImageStyle = hasBgImage && !isBlurEffect
    ? {
        backgroundImage: `url(${settings.bgImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        ...(isParallax ? { backgroundAttachment: "fixed" } : {}),
      }
    : {};

  const renderOverlays = () => {
    const overlays = [];

    if (hasBgImage && !isBlurEffect) {
      overlays.push(
        <div key="darken" className="absolute inset-0 bg-black/50" />
      );
    }

    if (isGradientOverlay) {
      if (hasBgImage) {
        overlays.push(
          <div key="gradient" className="absolute inset-0" style={{
            background: "linear-gradient(135deg, rgba(0,0,0,0.7) 0%, transparent 50%, rgba(0,0,0,0.7) 100%)"
          }} />
        );
      } else {
        overlays.push(
          <div key="gradient" className="absolute inset-0" style={{
            background: settings.bgColor === "white"
              ? "linear-gradient(135deg, rgba(0,0,0,0.03) 0%, transparent 50%, rgba(0,0,0,0.05) 100%)"
              : "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 50%, rgba(255,255,255,0.04) 100%)"
          }} />
        );
      }
    }

    return overlays;
  };

  const content = (
    <div className="relative z-10 text-center px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
      <h2
        className={`text-2xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4 ${textClasses.title}`}
        data-testid="text-promo-title"
      >
        {settings.title}
      </h2>
      {settings.subtitle && (
        <p
          className={`text-sm sm:text-base lg:text-lg mb-8 ${textClasses.subtitle}`}
          data-testid="text-promo-subtitle"
        >
          {settings.subtitle}
        </p>
      )}
      {settings.buttonText && settings.buttonLink && (
        <Link href={settings.buttonLink} data-testid="link-promo-cta">
          <Button
            size="lg"
            variant={textClasses.isDark ? "default" : "outline"}
            className={`${
              textClasses.isDark
                ? ""
                : "bg-white/10 backdrop-blur-sm border-white/30 text-white"
            } px-8 font-medium uppercase tracking-wider text-sm`}
            data-testid="button-promo-cta"
          >
            {settings.buttonText}
          </Button>
        </Link>
      )}
    </div>
  );

  const contentRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect(); } },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const animDuration = isAnimate ? "0.7s" : "0.6s";
  const animTranslateY = isAnimate ? "40px" : "20px";

  return (
    <section
      className={`relative overflow-hidden ${sizeClass} ${bgStyles.className} ${roundedClass}`}
      style={{ ...bgStyles.style, ...bgImageStyle }}
      data-testid="section-promo-banner"
    >
      {isBlurEffect && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${settings.bgImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(6px)",
            transform: "scale(1.1)",
          }}
        />
      )}
      {isBlurEffect && <div className="absolute inset-0 bg-black/40" />}
      {renderOverlays()}
      <div className="flex items-center justify-center">
        <div
          ref={contentRef}
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : `translateY(${animTranslateY})`,
            transition: `opacity ${animDuration} ease-out, transform ${animDuration} ease-out`,
          }}
        >
          {content}
        </div>
      </div>
    </section>
  );
}
