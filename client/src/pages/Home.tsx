import SEO from "@/components/SEO";
import { ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, Truck, Palette, Flag, Mail, Shirt } from "lucide-react";

declare global {
  interface Window {
    __HERO__?: {
      img: string;
      imgMobile: string;
      opacity: number;
      tagline1: string;
      tagline2: string;
      buttonText: string;
      buttonLink: string;
    };
  }
}
import { Link } from "wouter";
import { ProductCard } from "@/components/ProductCard";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWholesalePrice } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import PromoBanner from "@/components/PromoBanner";
import philosophyMobile from "@assets/generated_images/philosophy_mobile_new.webp";
import clothingImg from "@assets/generated_images/streetwear_clothing_category.webp";
import socksImg from "@assets/generated_images/designer_socks_category.webp";
import accessoriesImg from "@assets/generated_images/accessories_category.webp";
import merchImg from "@assets/generated_images/merch_category.webp";

const identityVideo = "https://storage.yandexcloud.net/bmg/media/identity/cinematic_dark_urban_streetwear_video.mp4";

function LazyVideo({ src, className }: { src: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeSrc, setActiveSrc] = useState<string | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActiveSrc(src);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [src]);

  useEffect(() => {
    if (activeSrc && videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }, [activeSrc]);

  return (
    <video
      ref={videoRef}
      src={activeSrc || undefined}
      loop
      muted
      playsInline
      className={className}
    />
  );
}

function LazySection({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          if (typeof requestIdleCallback !== "undefined") {
            requestIdleCallback(() => setMounted(true), { timeout: 2000 });
          } else {
            setTimeout(() => setMounted(true), 50);
          }
        }
      },
      { rootMargin: "800px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!mounted) return <div ref={ref} />;
  return <>{children}</>;
}

function getOptimizedImageUrl(url: string): string {
  if (!url) return url;
  if (url.includes('_thumb.webp')) return url;
  // Изображения артистов загружаются через ЛК партнёра — thumbnail генерируется отдельно,
  // но старые загрузки его не имеют, поэтому для site/artist/ возвращаем оригинал
  if (url.includes('storage.yandexcloud.net/bmg/site/artist/')) return url;
  if (
    url.includes('storage.yandexcloud.net/bmg/products/') ||
    url.includes('storage.yandexcloud.net/bmg/site/')
  ) {
    const thumbUrl = url.replace(/\.(webp|jpg|jpeg|png)(\?.*)?$/i, '_thumb.webp$2');
    if (thumbUrl !== url) return thumbUrl;
  }
  return url;
}

const categories = [
  { name: "Одежда", slug: "clothing", image: clothingImg },
  { name: "Носки", slug: "socks", image: socksImg },
  { name: "Аксессуары", slug: "accessories", image: accessoriesImg },
  { name: "Мерч", slug: "merch", image: merchImg },
];

const benefits = [
  { icon: Truck, title: "Доставка по всей РФ", desc: "Отправляем в любой город" },
  { icon: Flag, title: "Сделано в России", desc: "Собственное производство" },
  { icon: Palette, title: "Уникальные принты", desc: "Авторский дизайн" },
  { icon: Shirt, title: "Создаём мерч", desc: "Разработаем для вашего бренда" },
];

const artists = [
  { 
    name: "Артист 1", 
    role: "Музыкант",
    image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=500&fit=crop",
    collection: "Коллекция 2026",
    slug: "artist-1"
  },
  { 
    name: "Артист 2", 
    role: "Рэпер",
    image: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=400&h=500&fit=crop",
    collection: "Street Series",
    slug: "artist-2"
  },
  { 
    name: "Артист 3", 
    role: "DJ",
    image: "https://images.unsplash.com/photo-1571266028243-d220c6a8b0e8?w=400&h=500&fit=crop",
    collection: "Night Edition",
    slug: "artist-3"
  },
  { 
    name: "Артист 4", 
    role: "Продюсер",
    image: "https://images.unsplash.com/photo-1598387993441-a364f854c3e1?w=400&h=500&fit=crop",
    collection: "Beat Drop",
    slug: "artist-4"
  },
  { 
    name: "Артист 5", 
    role: "Исполнитель",
    image: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&h=500&fit=crop",
    collection: "Urban Legends",
    slug: "artist-5"
  },
];

const blogPosts = [
  { 
    title: "SS'26: Новая эстетика уличной моды", 
    date: "15 января 2026",
    category: "Коллекции",
    excerpt: "Исследуем грани между российской уличной модой и современным искусством в новом дропе.",
    image: "/attached_assets/generated_images/blog_post_image_for_new_collection_drop.webp" 
  },
  { 
    title: "Лукбук: Urban Vibes в ритме города", 
    date: "10 января 2026",
    category: "Лукбук",
    excerpt: "Как сочетать комфорт и стиль в динамичной городской среде. Наш взгляд на повседневность.",
    image: "/attached_assets/generated_images/blog_post_image_for_urban_vibes_lookbook.webp" 
  },
  { 
    title: "Коллаб: BMG x Tula Artists", 
    date: "5 января 2026",
    category: "Коллаборации",
    excerpt: "Лимитированная серия, созданная совместно с локальными художниками Тулы.",
    image: "/attached_assets/generated_images/blog_post_image_for_artist_collaboration.webp" 
  },
];

function MarqueeSection({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const rafRef = useRef<number>(0);
  const halfWidthRef = useRef(0);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;

    const speed = 0.5;
    let lastTime = 0;

    halfWidthRef.current = inner.scrollWidth / 2;

    const ro = new ResizeObserver(() => {
      halfWidthRef.current = inner.scrollWidth / 2;
    });
    ro.observe(inner);

    const animate = (time: number) => {
      if (lastTime) {
        const delta = time - lastTime;
        offsetRef.current -= speed * (delta / 16);
        if (Math.abs(offsetRef.current) >= halfWidthRef.current) {
          offsetRef.current += halfWidthRef.current;
        }
        inner.style.transform = `translateX(${offsetRef.current}px)`;
      }
      lastTime = time;
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="py-5 sm:py-6 overflow-hidden border-t border-b border-border/30">
      <div ref={containerRef} className="overflow-hidden">
        <div ref={innerRef} className="whitespace-nowrap flex will-change-transform" style={{ width: "max-content" }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="text-foreground/60 text-xs sm:text-sm font-normal uppercase tracking-[0.15em] px-6 sm:px-8 shrink-0">
              {text}{" "}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { isWholesale } = useWholesalePrice();
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newsletterConsent, setNewsletterConsent] = useState(false);
  const artistCarouselRef = useRef<HTMLDivElement>(null);
  const blogCarouselRef = useRef<HTMLDivElement>(null);
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const [heroPrev, setHeroPrev] = useState<number | null>(null);
  const [heroPaused, setHeroPaused] = useState(false);

  // Load page settings from database FIRST
  const { data: pageSettings, isLoading: settingsLoading } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/home"],
  });

  // Compute what products to fetch based on settings
  const productQueryConfig = useMemo(() => {
    if (!pageSettings) return null;
    const allPinnedIds = new Set<number>();
    let needsAutoProducts = false;
    let maxAutoCount = 0;

    const popular = pageSettings.popular;
    if (popular?.visible !== false) {
      const count = parseInt(popular?.count) || 8;
      if (popular?.mode === "manual" && Array.isArray(popular?.pinnedProductIds) && popular.pinnedProductIds.length > 0) {
        popular.pinnedProductIds.forEach((id: number) => allPinnedIds.add(id));
      } else {
        needsAutoProducts = true;
        maxAutoCount = Math.max(maxAutoCount, count);
      }
    }

    Object.keys(pageSettings).forEach(key => {
      if (!key.startsWith("custom_")) return;
      const section = pageSettings[key];
      if (section?.type !== "custom_hits" || section?.visible === false) return;
      const count = parseInt(section?.count) || 8;
      if (section?.mode === "manual" && Array.isArray(section?.pinnedProductIds) && section.pinnedProductIds.length > 0) {
        section.pinnedProductIds.forEach((id: number) => allPinnedIds.add(id));
      } else {
        needsAutoProducts = true;
        maxAutoCount = Math.max(maxAutoCount, count);
      }
    });

    if (needsAutoProducts) {
      return { type: "auto" as const, limit: Math.max(maxAutoCount + 8, 24) };
    } else if (allPinnedIds.size > 0) {
      return { type: "ids" as const, ids: Array.from(allPinnedIds) };
    }
    return { type: "auto" as const, limit: 24 };
  }, [pageSettings]);

  const { data: products, isLoading } = useQuery<any[]>({
    queryKey: ["/api/products", "home", productQueryConfig],
    queryFn: async () => {
      if (!productQueryConfig) return [];
      if (productQueryConfig.type === "ids") {
        const res = await fetch(`/api/products/by-ids?ids=${productQueryConfig.ids.join(",")}`);
        if (!res.ok) throw new Error("Failed to fetch products");
        return res.json();
      }
      const res = await fetch(`/api/products?limit=${productQueryConfig.limit}`);
      if (!res.ok) throw new Error("Failed to fetch products");
      const data = await res.json();
      return data.products;
    },
    enabled: !!productQueryConfig,
  });
  
  const isSectionVisible = (section: string) => {
    if (settingsLoading) return false;
    return pageSettings?.[section]?.visible !== false;
  };

  // Helper function to get background class based on settings
  const getBgClass = (section: string, defaultBg: string = "bg-background") => {
    const bgColor = pageSettings?.[section]?.bgColor;
    switch (bgColor) {
      case "muted": return "bg-muted";
      case "card": return "bg-card";
      case "primary": return "bg-primary text-primary-foreground";
      case "dark": return "bg-black text-white";
      default: return defaultBg;
    }
  };
  
  const [promoReady, setPromoReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPromoReady(true), 2000);
    return () => clearTimeout(t);
  }, []);

  const getHeroSlides = () => {
    const hero = pageSettings?.hero;
    if (!hero) return [];
    if (hero.slides && Array.isArray(hero.slides)) {
      return hero.slides.filter((s: any) => s.heroImage || s.heroVideo);
    }
    if (hero.heroImage || hero.heroVideo) return [hero];
    return [];
  };

  useEffect(() => {
    const slides = getHeroSlides();
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      if (heroPaused) return;
      setHeroSlideIndex(prev => {
        const next = (prev + 1) % slides.length;
        setHeroPrev(prev);
        return next;
      });
    }, 7000);
    return () => clearInterval(timer);
  }, [pageSettings, heroPaused]);

  // Предзагрузка всех слайдов кроме первого — чтобы не было "квадратиков" при переходе
  useEffect(() => {
    const slides = getHeroSlides();
    if (slides.length <= 1) return;
    const isMobile = window.innerWidth < 640;
    slides.slice(1).forEach((s: any) => {
      const src = (isMobile && s.heroImageMobile) ? s.heroImageMobile : s.heroImage;
      if (src) {
        const img = new Image();
        img.src = src;
      }
    });
  }, [pageSettings]);
  const { data: promoData } = useQuery<{ popup: any; homepage: any }>({
    queryKey: ["/api/subscription-promos"],
    enabled: promoReady,
    staleTime: 5 * 60 * 1000,
  });
  const homepagePromo = promoData?.homepage;
  
  const productCount = parseInt(pageSettings?.popular?.count) || 8;
  const featuredProducts = useMemo(() => {
    if (!Array.isArray(products)) return [];
    const visibleProducts = products.filter((p: any) => !p.isHidden && (!isWholesale || (p.wholesalePrice && p.wholesalePrice > 0)));
    if (pageSettings?.popular?.mode === "manual") {
      const pinnedIds: number[] = pageSettings.popular.pinnedProductIds || [];
      if (pinnedIds.length > 0) {
        const pinned = pinnedIds.map((id: number) => visibleProducts.find((p: any) => p.id === id)).filter(Boolean);
        if (pinned.length > 0) return pinned;
      }
    }
    const sorted = [...visibleProducts].sort((a: any, b: any) => {
      const aNew = a.isNew || a.badgeText === "NEW" ? 1 : 0;
      const bNew = b.isNew || b.badgeText === "NEW" ? 1 : 0;
      if (bNew !== aNew) return bNew - aNew;
      return (b.id || 0) - (a.id || 0);
    });
    return sorted.slice(0, productCount);
  }, [products, productCount, pageSettings?.popular?.mode, pageSettings?.popular?.pinnedProductIds]);

  const promoBanner = pageSettings?.promo_banner;
  const renderPromoBanner = (position: string) => {
    if (!promoBanner || promoBanner.visible === false || promoBanner.position !== position) return null;
    return <PromoBanner settings={promoBanner} />;
  };

  const DEFAULT_SECTION_ORDER = ["hero", "categories", "popular", "artists", "benefits", "philosophy", "blog", "promo_banner", "newsletter", "marquee"];
  const FIXED_SECTIONS = new Set(DEFAULT_SECTION_ORDER);
  const rawOrder: string[] = (pageSettings?.sectionOrder?.order as string[]) || [];
  // Include fixed sections + custom sections (those that start with "custom_")
  const filteredOrder = rawOrder.filter((id: string) => FIXED_SECTIONS.has(id) || id.startsWith("custom_"));
  DEFAULT_SECTION_ORDER.forEach(id => { if (!filteredOrder.includes(id)) filteredOrder.push(id); });
  const sectionOrder: string[] = filteredOrder.length > 0 ? filteredOrder : DEFAULT_SECTION_ORDER;

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || isSubmitting) return;
    if (!newsletterConsent) return;
    
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/newsletter/subscribe", { email, source: "homepage" });
      setSubscribed(true);
      setEmail("");
    } catch (err) {
      console.error("Subscribe error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-white">
      <SEO 
        title="Официальный сайт бренда Booomerangs"
        description="Booomerangs (BMGBRAND) — официальный магазин мерча. Купить мерч Гудтаймс, Молодость внутри, Дикая мята, Драгни, МультFильмы и других артистов. Доставка по всей России."
        keywords="мерч Гудтаймс, мерч Молодость внутри, мерч Дикая мята, мерч Драгни, мерч МультFильмы, купить мерч, мерч артистов, Booomerangs, BMGBRAND, российский бренд одежды с авторскими принтами"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "BMGBRAND",
            "alternateName": "Booomerangs",
            "description": "Официальный магазин мерча российского бренда одежды и аксессуаров. Мерч Гудтаймс, Молодость внутри, Дикая мята и других артистов. Доставка по всей России.",
            "logo": `${window.location.origin}/favicon.png`,
            "url": window.location.origin,
            "sameAs": [
              "https://vk.com/bmgbrand",
              "https://t.me/bmg_booomerangs",
              "https://www.instagram.com/bmgbrand/",
            ],
            "address": {
              "@type": "PostalAddress",
              "addressLocality": "Тула",
              "addressCountry": "RU",
            },
            "contactPoint": {
              "@type": "ContactPoint",
              "contactType": "customer service",
              "availableLanguage": "Russian",
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "Booomerangs",
            "alternateName": "BMGBRAND",
            "url": `${window.location.origin}/`,
            "potentialAction": {
              "@type": "SearchAction",
              "target": `${window.location.origin}/products?search={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          },
        ]}
      />
      <Navbar />
      
      {settingsLoading && (
        <div className="min-h-screen" />
      )}
      
      {(() => {
        const firstVisibleSection = sectionOrder.find(id => isSectionVisible(id));
        const heroIsFirst = firstVisibleSection === "hero";
        const heroHiddenOnMobile = heroIsFirst && pageSettings?.hero?.showOnMobile === false;
        const heroHiddenOnDesktop = heroIsFirst && pageSettings?.hero?.showOnDesktop === false;
        const needsNavbarOffset = !heroIsFirst || heroHiddenOnMobile || heroHiddenOnDesktop;
        if (!needsNavbarOffset) return null;
        if (heroIsFirst) {
          const mobilePt = heroHiddenOnMobile ? "pt-20" : "pt-0";
          const desktopPt = heroHiddenOnDesktop ? "sm:pt-24" : "sm:pt-0";
          return <div className={`${mobilePt} ${desktopPt}`} />;
        }
        const sectionDefaults: Record<string, string> = {
          popular: "bg-card", categories: "bg-background", artists: "bg-background",
          benefits: "bg-background", philosophy: "bg-secondary", blog: "bg-background",
          newsletter: "bg-foreground", marquee: "bg-background",
        };
        const firstBg = getBgClass(firstVisibleSection || "", sectionDefaults[firstVisibleSection || ""] || "bg-background");
        return <div className={`pt-20 sm:pt-24 ${firstBg}`} />;
      })()}
      {sectionOrder.map((sectionId, sectionIdx) => {
        const sectionContent = (() => {
        switch (sectionId) {

        case "hero": {
          const heroSlides = getHeroSlides();
          const activeIndex = heroSlides.length > 0 ? heroSlideIndex % heroSlides.length : 0;
          const slide = heroSlides[activeIndex] || pageSettings?.hero || {};
          const multiSlide = heroSlides.length > 1;
          return isSectionVisible("hero") ? (
            <div key="section-hero">
        <section
          className={`relative h-svh sm:h-auto sm:aspect-[2560/1740] w-full flex flex-col items-center justify-center overflow-hidden bg-black sm:-mt-40 ${pageSettings?.hero?.showOnMobile === false ? 'hidden sm:flex' : ''} ${pageSettings?.hero?.showOnDesktop === false ? 'flex sm:hidden' : ''}`}
          onTouchStart={() => setHeroPaused(true)}
          onTouchEnd={() => setHeroPaused(false)}
          onTouchCancel={() => setHeroPaused(false)}
        >
          <div className="absolute inset-0 z-0 overflow-hidden">
            {heroSlides.map((s: any, i: number) => (
              <div
                key={i}
                className="absolute inset-0 transition-opacity duration-1000"
                style={{ opacity: i === activeIndex ? (parseFloat(s.heroOpacity) || 0.6) : 0, zIndex: i === activeIndex ? 1 : 0 }}
              >
                {s.bgType === "video" && s.heroVideo ? (
                  <video src={s.heroVideo} autoPlay loop muted playsInline preload={i === activeIndex ? "metadata" : "none"} className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <picture className="absolute inset-0 block">
                    {s.heroImageMobile && <source media="(max-width: 639px)" srcSet={s.heroImageMobile} />}
                    <img
                      src={s.heroImage || ""}
                      alt={`Hero ${i + 1}`}
                      loading="eager"
                      className="w-full h-full object-cover object-center"
                    />
                  </picture>
                )}
              </div>
            ))}
            {heroSlides.length === 0 && !pageSettings && window.__HERO__?.img && (
              <div className="absolute inset-0" style={{ opacity: window.__HERO__.opacity }}>
                <picture className="absolute inset-0 block">
                  {window.__HERO__.imgMobile && <source media="(max-width: 639px)" srcSet={window.__HERO__.imgMobile} />}
                  <img
                    src={window.__HERO__.img}
                    alt="Hero"
                    loading="eager"
                    className="w-full h-full object-cover object-center"
                  />
                </picture>
              </div>
            )}
            {heroSlides.length === 0 && pageSettings && (
              <div className="absolute inset-0" style={{ opacity: parseFloat(pageSettings?.hero?.heroOpacity) || 0.6 }}>
                {pageSettings?.hero?.bgType === "video" && pageSettings?.hero?.heroVideo ? (
                  <video src={pageSettings.hero.heroVideo} autoPlay loop muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <picture className="absolute inset-0 block">
                    {pageSettings?.hero?.heroImageMobile && <source media="(max-width: 639px)" srcSet={pageSettings.hero.heroImageMobile} />}
                    <img src={pageSettings?.hero?.heroImage || ""} alt="Hero" loading="eager" className="w-full h-full object-cover object-center" />
                  </picture>
                )}
              </div>
            )}
          </div>
          <div className="relative z-10 text-center px-4 max-w-4xl mx-auto flex flex-col items-center mt-auto pb-28 sm:pb-8">
            <div className="flex flex-col items-center">
              <p className="font-mono text-[9px] sm:text-xs text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] mb-6 sm:mb-8 text-center leading-relaxed drop-shadow-lg">
                {slide.tagline1 || pageSettings?.hero?.tagline1 || window.__HERO__?.tagline1 || "МЫ ДЕЛАЕМ ТО, ЧТО НОСИМ САМИ."}<br/>{slide.tagline2 || pageSettings?.hero?.tagline2 || window.__HERO__?.tagline2 || "РОССИЙСКИЙ БРЕНД ОДЕЖДЫ И АКСЕССУАРОВ."}
              </p>
              <Link href={slide.buttonLink || pageSettings?.hero?.buttonLink || window.__HERO__?.buttonLink || "/products"}>
                <Button size="lg" className="bg-card/75 backdrop-blur-md border border-border/50 text-foreground hover:bg-card/90 transition-colors px-5 py-3 sm:px-6 sm:py-4 text-xs sm:text-sm font-display uppercase tracking-[0.2em] sm:tracking-[0.3em] rounded-full h-auto min-h-0" data-testid="button-hero-catalog">
                  {slide.buttonText || pageSettings?.hero?.buttonText || window.__HERO__?.buttonText || "Смотреть каталог"}
                </Button>
              </Link>
            </div>
          </div>
          {multiSlide && (
            <>
              <button
                type="button"
                aria-label="Предыдущий слайд"
                onClick={() => {
                  setHeroPrev(activeIndex);
                  setHeroSlideIndex((activeIndex - 1 + heroSlides.length) % heroSlides.length);
                }}
                className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm border border-white/20 text-white flex items-center justify-center transition-colors"
                data-testid="button-hero-prev"
              >
                <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
              <button
                type="button"
                aria-label="Следующий слайд"
                onClick={() => {
                  setHeroPrev(activeIndex);
                  setHeroSlideIndex((activeIndex + 1) % heroSlides.length);
                }}
                className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm border border-white/20 text-white flex items-center justify-center transition-colors"
                data-testid="button-hero-next"
              >
                <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
              <div className="absolute bottom-8 left-0 right-0 z-20 flex justify-center gap-2">
                {heroSlides.map((_: any, i: number) => (
                  <button
                    key={i}
                    onClick={() => { setHeroPrev(activeIndex); setHeroSlideIndex(i); }}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${i === activeIndex ? "bg-white w-5" : "bg-white/50"}`}
                    data-testid={`button-hero-dot-${i}`}
                  />
                ))}
              </div>
            </>
          )}
        </section>
        {renderPromoBanner("after_hero")}
        {(() => {
          const stripItems: any[] = pageSettings?.artists?.items || artists;
          if (!stripItems || stripItems.length === 0) return null;
          return (
            <div className="w-full bg-zinc-950">
              {/* ── Лента коллабораций ── */}
              <div className="flex items-stretch">
                {/* Левый лейбл */}
                <div className="hidden sm:flex shrink-0 items-center justify-center px-5 lg:px-7 border-r border-zinc-800">
                  <span className="text-[9px] font-mono tracking-[0.3em] uppercase text-zinc-500 whitespace-nowrap" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                    Коллаборации
                  </span>
                </div>
                {/* Лента карточек с fade-масками */}
                <div className="flex-1 relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-8 sm:w-12 bg-gradient-to-r from-zinc-950 to-transparent z-10 pointer-events-none" />
                  <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-l from-zinc-950 to-transparent z-10 pointer-events-none" />
                  <div
                    className="flex items-end gap-3 sm:gap-4 overflow-x-auto scrollbar-hide px-4 sm:px-6 py-5 sm:py-6"
                    style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                  >
                    {stripItems.map((artist: any, idx: number) => (
                      <Link
                        key={idx}
                        href={artist.slug ? `/@${artist.slug}` : (artist.link || "/products/merch")}
                        className="flex flex-col items-center gap-2.5 group shrink-0 cursor-pointer"
                        data-testid={`link-artist-strip-${idx}`}
                      >
                        <div className="relative w-[92px] h-[124px] sm:w-[110px] sm:h-[148px] rounded overflow-hidden ring-1 ring-zinc-700/80 group-hover:ring-primary group-hover:ring-2 transition-all duration-300 group-hover:scale-[1.04]">
                          <img
                            src={getOptimizedImageUrl(artist.image)}
                            alt={artist.name}
                            className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-transparent" />
                          <div className="absolute top-1.5 right-1.5 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-primary/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                            <span className="text-white font-bold leading-none" style={{ fontSize: "9px" }}>×</span>
                          </div>
                        </div>
                        <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-400 group-hover:text-white transition-colors duration-200 text-center leading-tight w-[92px] sm:w-[110px] line-clamp-2">
                          {artist.name}
                        </span>
                      </Link>
                    ))}
                    <div className="shrink-0 w-10 sm:w-16" />
                  </div>
                </div>
                {/* Правая ссылка "Все" */}
                <Link
                  href={pageSettings?.artists?.linkUrl || "/products/merch"}
                  className="hidden sm:flex shrink-0 items-center gap-2 text-[9px] font-mono uppercase tracking-widest text-zinc-500 hover:text-white transition-all duration-200 px-5 lg:px-7 border-l border-zinc-800 group"
                  data-testid="link-all-artists-strip"
                >
                  <span className="whitespace-nowrap">Все</span>
                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>

              {/* ── CTA: Мерч на заказ — вшит в тот же тёмный блок ── */}
              <div className="border-t border-zinc-800">
                <Link href="/merch-na-zakaz" data-testid="merch-strip-banner" className="group block">
                  <div className="flex items-center gap-3 sm:gap-0 px-4 sm:px-0">
                    {/* Иконка + лейбл */}
                    <div className="hidden sm:flex shrink-0 items-center gap-3 px-5 lg:px-7 py-4 border-r border-zinc-800">
                      <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <Shirt className="w-3.5 h-3.5 text-white" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-[0.22em] text-white whitespace-nowrap">
                        Мерч на заказ
                      </span>
                    </div>
                    {/* Мобильная иконка */}
                    <div className="sm:hidden w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0">
                      <Shirt className="w-3.5 h-3.5 text-white" />
                    </div>
                    {/* Главный CTA-текст */}
                    <div className="flex-1 px-0 sm:px-7 py-4">
                      <p className="text-sm sm:text-base font-semibold text-white leading-tight">
                        Создай мерч как у них
                      </p>
                      <p className="text-[11px] text-zinc-500 mt-0.5 hidden sm:block">
                        Полный цикл производства — от идеи до доставки
                      </p>
                    </div>
                    {/* Кнопка */}
                    <div className="shrink-0 flex items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-[0.18em] text-primary group-hover:gap-3 transition-all duration-200 py-4 sm:px-7 sm:border-l sm:border-zinc-800">
                      <span>Заказать</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          );
        })()}
            </div>
          ) : null;
        }

        case "categories":
          return isSectionVisible("categories") ? (() => {
        const catLayout = pageSettings?.categories?.layout || "bento";
        const catItems = pageSettings?.categories?.items || categories;
        
        const renderCategoryCard = (cat: any, idx: number, sizeClass: string = "", aspectClass: string = "aspect-square") => {
          const imgSrc = cat.image || (categories[idx]?.image);
          const isSpecial = cat.slug === "sale" && !cat.image;
          
          if (isSpecial) {
            return (
              <Link 
                key={idx}
                href={`/products/${cat.slug}`}
                className={`group relative overflow-hidden rounded-xl ${sizeClass} aspect-[2/1] flex items-center justify-center`}
                data-testid={`link-category-${cat.slug}`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary via-red-600 to-red-700" />
                <div className="relative z-10 text-center p-4">
                  <h3 className="text-2xl sm:text-3xl font-bold text-white group-hover:scale-110 transition-transform">
                    {cat.name}
                  </h3>
                </div>
              </Link>
            );
          }
          
          return (
            <div
              key={idx}
              className={sizeClass}
            >
              <Link 
                href={`/products/${cat.slug}`}
                className={`group relative overflow-hidden rounded-xl block ${aspectClass} bg-muted`}
                data-testid={`link-category-${cat.slug}`}
              >
                {imgSrc && (
                  <img 
                    src={imgSrc} 
                    alt={cat.name}
                    loading="lazy"
                    decoding="async"
                    sizes="(max-width: 480px) 46vw, (max-width: 768px) 45vw, (max-width: 1024px) 30vw, 280px"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
                  <span className="text-[10px] sm:text-xs text-white/50 uppercase tracking-widest font-medium block mb-1">
                    {cat.slug}
                  </span>
                  <h3 className="text-lg sm:text-2xl font-bold text-white tracking-tight">
                    {cat.name}
                  </h3>
                </div>
              </Link>
            </div>
          );
        };

        const catContent = (
          <section className={`section-lazy py-10 sm:py-24 ${getBgClass("categories", "bg-background")}`}>
            <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-6 sm:mb-16">
                <h2 className="text-2xl sm:text-5xl font-bold text-foreground tracking-tight">
                  {pageSettings?.categories?.title || "Категории"}
                </h2>
              </div>
              
              {catLayout === "grid" && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
                  {catItems.map((cat: any, idx: number) => {
                    const spanClass = cat.span === "2" ? "col-span-2" : "";
                    const aspect = cat.span === "2" ? "aspect-[4/3]" : "aspect-square";
                    return renderCategoryCard(cat, idx, spanClass, aspect);
                  })}
                </div>
              )}

              {catLayout === "bento" && (
                <div className="grid grid-cols-2 md:grid-cols-12 gap-2 sm:gap-4 auto-rows-[140px] sm:auto-rows-[220px] md:auto-rows-[260px]">
                  {catItems.map((cat: any, idx: number) => {
                    const bentoPatterns = [
                      "md:col-span-7 row-span-2",
                      "md:col-span-5 row-span-1",
                      "md:col-span-5 row-span-1",
                      "md:col-span-4 row-span-2",
                      "md:col-span-4 row-span-1",
                      "md:col-span-4 row-span-1",
                    ];
                    const pattern = bentoPatterns[idx % bentoPatterns.length];
                    return renderCategoryCard(cat, idx, pattern, "h-full w-full");
                  })}
                </div>
              )}

              {catLayout === "carousel" && (
                <div className="relative">
                  <div className="absolute left-0 top-0 bottom-0 w-8 sm:w-16 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
                  <div className="absolute right-0 top-0 bottom-0 w-8 sm:w-16 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
                  <div 
                    className="flex gap-4 sm:gap-6 overflow-x-auto scrollbar-hide px-4 sm:px-8 snap-x snap-mandatory pb-4"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    {catItems.map((cat: any, idx: number) => (
                      <div key={idx} className="flex-shrink-0 snap-center w-[260px] sm:w-[320px] md:w-[360px]">
                        {renderCategoryCard(cat, idx, "", "aspect-[3/4]")}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-center mt-6 sm:hidden">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      <span>Листайте</span>
                      <ArrowRight className="w-3 h-3 animate-pulse" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        );

        return (
          <div key="section-categories">
            {catContent}
            {renderPromoBanner("after_categories")}
          </div>
        );
      })() : null;

        case "popular":
          return isSectionVisible("popular") ? (
            <div key="section-popular">
        {renderPromoBanner("before_popular")}
      <section
        className={`pt-6 sm:pt-8 pb-8 sm:pb-14 ${getBgClass("popular", "")}`}
        style={!pageSettings?.popular?.bgColor ? { backgroundColor: "#f2f2f2" } : undefined}
      >
          <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-end pb-3 mb-0">
              <div className="border-l-[3px] border-primary pl-3">
                {pageSettings?.popular?.subtitle && (
                  <span className="text-xs text-primary font-medium uppercase tracking-widest block mb-1">{pageSettings.popular.subtitle}</span>
                )}
                <h2
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
                  className="text-3xl sm:text-5xl font-bold uppercase tracking-tight leading-none text-foreground"
                >
                  {pageSettings?.popular?.title || "Новинки"}
                </h2>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-0 mt-0 overflow-hidden">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                <div key={i} className="animate-pulse">
                  <div className="bg-muted aspect-[4/5] mb-3" />
                  <div className="h-4 bg-muted w-2/3 mb-2" />
                  <div className="h-3 bg-muted w-1/4" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-0 mt-0 overflow-hidden">
              {featuredProducts?.map((product, index) => (
                <ProductCard key={product.id} product={product} priority={index < 4} />
              ))}
            </div>
          )}

          <div className="flex justify-center mt-10 sm:mt-14">
            <Button asChild variant="outline" size="lg" className="uppercase tracking-wide gap-2.5">
              <Link href={pageSettings?.popular?.linkUrl || "/products"} data-testid="link-all-products">
                {pageSettings?.popular?.linkText || "Все товары"}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </div>
      </section>
            </div>
          ) : null;

        case "artists":
          return isSectionVisible("artists") ? (() => {
        const artistLayout = pageSettings?.artists?.layout || "rows";
        const artistItems = pageSettings?.artists?.items || artists;
        
        const renderArtistCard = (artist: any, index: number, cardClass: string = "w-[260px] sm:w-[300px]") => (
          <Link
            href={artist.slug ? `/@${artist.slug}` : (artist.link || pageSettings?.artists?.linkUrl || "/products/merch")}
            data-testid={`link-artist-${index}`}
            className={`block group relative ${cardClass} aspect-[3/4] rounded-xl overflow-hidden bg-muted`}
          >
            <img
              src={getOptimizedImageUrl(artist.image)}
              alt={artist.name}
              loading="lazy"
              decoding="async"
              sizes="(max-width: 640px) 260px, 300px"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5 translate-y-1 group-hover:translate-y-0 transition-transform duration-300" style={{textShadow: "0 1px 4px rgba(0,0,0,0.9)"}}>
              <p className="text-[11px] font-mono tracking-[0.22em] uppercase text-white mb-2">{artist.role}</p>
              <h3 className="font-['Oswald',sans-serif] text-white text-xl sm:text-2xl font-bold uppercase leading-tight mb-1">
                {artist.name}
              </h3>
              <p className="text-white text-xs sm:text-sm leading-snug line-clamp-1">{artist.collection}</p>
              <span className="inline-flex items-center gap-1 mt-2 text-[11px] font-mono tracking-[0.2em] uppercase text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                Смотреть <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </Link>
        );

        const artistContent = (
          <section className={`section-lazy py-10 sm:py-16 ${getBgClass("artists", "bg-background")} overflow-hidden`}>
            <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 mb-6 sm:mb-10">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-3">
                <div>
                  <p className="text-[11px] font-mono tracking-[0.25em] uppercase text-muted-foreground mb-2">
                    {pageSettings?.artists?.subtitle || "Коллаборации"}
                  </p>
                  <h2 className="font-['Oswald',sans-serif] text-3xl sm:text-5xl font-bold uppercase tracking-tight">
                    {pageSettings?.artists?.title || "Наши артисты"}
                  </h2>
                </div>
                <Link
                  href={pageSettings?.artists?.linkUrl || "/products/merch"}
                  className="inline-flex items-center gap-2 text-[10px] font-mono tracking-[0.2em] uppercase text-muted-foreground hover:text-primary transition-colors group shrink-0"
                  data-testid="link-all-merch"
                >
                  {pageSettings?.artists?.linkText || "Весь мерч"} <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>
            </div>

            {artistLayout === "grid" && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-0 overflow-hidden">
                {artistItems.map((artist: any, index: number) => (
                  <div key={index}>
                    {renderArtistCard(artist, index, "w-full")}
                  </div>
                ))}
              </div>
            )}

            {artistLayout === "bento" && (
              <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-2 md:grid-cols-12 gap-3 sm:gap-4 auto-rows-[200px] sm:auto-rows-[260px]">
                  {artistItems.map((artist: any, index: number) => {
                    const bentoPatterns = [
                      "md:col-span-5 row-span-2",
                      "md:col-span-7 row-span-1",
                      "md:col-span-3 row-span-1",
                      "md:col-span-4 row-span-1",
                      "md:col-span-6 row-span-2",
                      "md:col-span-6 row-span-1",
                    ];
                    const pattern = bentoPatterns[index % bentoPatterns.length];
                    return (
                      <div
                        key={index}
                        className={pattern}
                      >
                        {renderArtistCard(artist, index, "w-full h-full aspect-auto")}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {artistLayout === "rows" && (
              <>
                {/* Mobile: horizontal scroll carousel */}
                <div className="md:hidden relative">
                  <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
                  <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
                  <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 snap-x snap-mandatory pb-4" style={{ scrollbarWidth: 'none' }}>
                    {artistItems.map((artist: any, index: number) => (
                      <Link
                        key={index}
                        href={artist.slug ? `/@${artist.slug}` : (artist.link || pageSettings?.artists?.linkUrl || "/products/merch")}
                        data-testid={`link-artist-mobile-${index}`}
                        className="block group relative flex-shrink-0 snap-center w-[200px] aspect-[3/4] overflow-hidden bg-muted rounded-xl"
                      >
                        <img
                          src={getOptimizedImageUrl(artist.image)}
                          alt={artist.name}
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                        <div className="absolute bottom-0 left-0 right-0 p-4" style={{textShadow: "0 1px 4px rgba(0,0,0,0.9)"}}>
                          <p className="text-[9px] font-mono tracking-[0.22em] uppercase text-white mb-1">{artist.role}</p>
                          <h3 className="font-['Barlow_Condensed',sans-serif] text-white text-xl font-bold uppercase leading-tight">{artist.name}</h3>
                        </div>
                      </Link>
                    ))}
                  </div>
                  <div className="flex justify-center mt-3">
                    <div className="flex items-center gap-2 text-foreground/40 text-xs">
                      <span>Листайте</span>
                      <ArrowRight className="w-3 h-3 animate-pulse" />
                    </div>
                  </div>
                </div>

                {/* Desktop: 2-column editorial rows */}
                <div className="hidden md:block max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="border-t border-foreground/15 grid grid-cols-2">
                    {artistItems.map((artist: any, index: number) => (
                      <Link
                        key={index}
                        href={artist.slug ? `/@${artist.slug}` : (artist.link || pageSettings?.artists?.linkUrl || "/products/merch")}
                        data-testid={`link-artist-${index}`}
                        className={`group flex items-stretch border-b border-foreground/10 hover:bg-foreground/[0.03] transition-colors duration-200 ${index % 2 === 0 ? "border-r border-foreground/10" : ""}`}
                      >
                        <div className="flex-shrink-0 w-[120px] aspect-[2/3] overflow-hidden bg-muted">
                          <img
                            src={getOptimizedImageUrl(artist.image)}
                            alt={artist.name}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover grayscale-[20%] group-hover:grayscale-0 group-hover:scale-[1.04] transition-all duration-500 ease-out"
                          />
                        </div>
                        <div className="flex flex-1 items-center justify-between gap-2 px-6 py-3">
                          <div className="min-w-0">
                            <p className="text-[9px] font-mono tracking-[0.3em] uppercase text-foreground mb-1">{artist.role}</p>
                            <h3 className="font-['Barlow_Condensed',sans-serif] text-4xl font-bold uppercase leading-none tracking-tight text-foreground truncate">{artist.name}</h3>
                            <p className="text-[11px] text-foreground mt-1 font-mono truncate">{artist.collection}</p>
                          </div>
                          <ArrowRight className="flex-shrink-0 w-4 h-4 text-foreground/25 group-hover:text-foreground group-hover:translate-x-0.5 transition-all duration-200" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </>
            )}

            {artistLayout === "carousel" && (() => {
              const scrollArtists = (dir: number) => {
                const el = artistCarouselRef.current;
                if (el) el.scrollBy({ left: dir * (el.clientWidth * 0.7), behavior: 'smooth' });
              };
              return (
              <>
                <div className="relative">
                  <div className="absolute left-0 top-0 bottom-0 w-8 sm:w-20 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
                  <div className="absolute right-0 top-0 bottom-0 w-8 sm:w-20 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
                  <button
                    className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20 hidden sm:flex items-center justify-center w-8 h-8 text-foreground/30 hover:text-foreground transition-colors duration-200"
                    onClick={() => scrollArtists(-1)}
                    data-testid="button-artist-carousel-prev"
                    aria-label="Назад"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <button
                    className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20 hidden sm:flex items-center justify-center w-8 h-8 text-foreground/30 hover:text-foreground transition-colors duration-200"
                    onClick={() => scrollArtists(1)}
                    data-testid="button-artist-carousel-next"
                    aria-label="Вперёд"
                  >
                    <ArrowRight className="w-5 h-5" />
                  </button>
                  <div 
                    ref={artistCarouselRef}
                    className="flex gap-4 sm:gap-6 overflow-x-auto scrollbar-hide px-4 sm:px-8 lg:px-16 snap-x snap-mandatory pb-4"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    {artistItems.map((artist: any, index: number) => (
                      <div
                        key={index}
                        className="flex-shrink-0 snap-center"
                      >
                        {renderArtistCard(artist, index)}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-center mt-6 sm:hidden">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <span>Листайте</span>
                    <ArrowRight className="w-3 h-3 animate-pulse" />
                  </div>
                </div>
              </>
              );
            })()}
          </section>
        );
        return (
          <div key="section-artists">
            {artistContent}
            {renderPromoBanner("after_artists")}
          </div>
        );
      })() : null;

        case "benefits":
          return isSectionVisible("benefits") ? (
            <div key="section-benefits">
      <section className={`section-lazy py-8 sm:py-20 ${getBgClass("benefits", "bg-background")}`}>
        <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-10">
            {benefits.map((benefit, index) => (
              <div 
                key={index}
                className="text-center group flex flex-col items-center"
              >
                <div className="inline-flex items-center justify-center w-10 h-10 sm:w-14 sm:h-14 rounded-full border border-border mb-3 sm:mb-4">
                  <benefit.icon className="w-4 h-4 sm:w-6 sm:h-6 text-foreground" strokeWidth={1.5} />
                </div>
                <h3 className="text-xs sm:text-sm font-medium text-foreground mb-0.5 tracking-tight">
                  {pageSettings?.benefits?.[`benefit${index}Title`] || benefit.title}
                </h3>
                <p className="text-[10px] sm:text-xs text-muted-foreground">
                  {pageSettings?.benefits?.[`benefit${index}Desc`] || benefit.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
      {renderPromoBanner("after_benefits")}
            </div>
          ) : null;

        case "philosophy":
          return isSectionVisible("philosophy") ? (
            <div key="section-philosophy">
      <section className={`section-lazy overflow-hidden ${getBgClass("philosophy", "bg-secondary text-secondary-foreground")}`}>
        <div className="flex flex-col md:flex-row min-h-[520px] sm:min-h-[640px] md:h-[680px] md:max-h-[680px]">
          {/* Left — text panel */}
          <div className="flex flex-col justify-between px-6 py-10 sm:px-12 sm:py-16 md:w-[45%] lg:w-[40%] shrink-0">
            <div>
              <p className="text-[11px] sm:text-xs font-mono tracking-[0.25em] uppercase text-secondary-foreground/70 mb-6 sm:mb-10">
                BOOOMERANGS — МАНИФЕСТ
              </p>
              <h2 className="font-['Oswald',sans-serif] text-[2.6rem] sm:text-[3.8rem] lg:text-[4.8rem] font-bold uppercase leading-[0.92] tracking-tight mb-6 sm:mb-10">
                {pageSettings?.philosophy?.title ? (
                  <span>{pageSettings.philosophy.title}</span>
                ) : (
                  <>
                    <span className="block">БОЛЬШЕ</span>
                    <span className="block text-primary">ЧЕМ</span>
                    <span className="block">ОДЕЖДА</span>
                  </>
                )}
              </h2>
              <p className="text-sm sm:text-base text-secondary-foreground/60 leading-relaxed max-w-sm">
                {pageSettings?.philosophy?.text || "Базируясь в Туле — городе мастеров, пряников и самоваров — мы создаем вещи для повседневной жизни. Мы объединяем традиции качества и современный стиль в каждой детали."}
              </p>
            </div>
            <div className="mt-8 sm:mt-0 flex flex-col gap-6">
              <div className="w-12 h-px bg-primary" />
              <Link
                href={pageSettings?.philosophy?.linkUrl || "/about"}
                className="inline-flex items-center gap-3 group w-fit"
                data-testid="link-manifesto"
              >
                <span className="text-xs sm:text-sm font-mono tracking-[0.2em] uppercase font-medium text-secondary-foreground group-hover:text-primary transition-colors">
                  {pageSettings?.philosophy?.linkText || "Узнать о нас"}
                </span>
                <ArrowRight className="w-4 h-4 text-primary group-hover:translate-x-1.5 transition-transform" />
              </Link>
            </div>
          </div>

          {/* Right — video/image panel */}
          <div className="relative flex-1 flex items-center justify-center min-h-0 overflow-hidden">
            {pageSettings?.philosophy?.desktopMediaType === "image" && pageSettings?.philosophy?.desktopImage ? (
              <img
                src={pageSettings.philosophy.desktopImage}
                alt="BMGBRAND Identity"
                loading="lazy"
                className="hidden md:block w-full h-full object-contain"
              />
            ) : (
              <LazyVideo
                src={pageSettings?.philosophy?.videoUrl || identityVideo}
                className="hidden md:block w-full h-full object-contain"
              />
            )}
            {pageSettings?.philosophy?.mobileMediaType === "video" && pageSettings?.philosophy?.mobileVideo ? (
              <LazyVideo
                src={pageSettings.philosophy.mobileVideo}
                className="md:hidden w-full h-auto"
              />
            ) : (
              <img
                src={pageSettings?.philosophy?.mobileImage || philosophyMobile}
                alt="BMGBRAND Identity"
                loading="lazy"
                className="md:hidden w-full h-auto"
              />
            )}
            {/* Gradient edge fade to left */}
            <div className="hidden md:block absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-secondary to-transparent pointer-events-none" />
          </div>
        </div>
      </section>
      {renderPromoBanner("after_philosophy")}
            </div>
          ) : null;

        case "blog":
          return isSectionVisible("blog") ? (() => {
        const blogLayout = pageSettings?.blog?.layout || "carousel";
        const blogItems = pageSettings?.blog?.items || blogPosts;
        
        const renderBlogCard = (post: any, index: number, variant: "vertical" | "horizontal" = "vertical") => (
          <article
            key={index}
            className={`group relative overflow-hidden rounded-xl bg-muted ${
              variant === "horizontal"
                ? "flex-shrink-0 aspect-[3/2]"
                : "aspect-[3/4] sm:aspect-[2/3]"
            }`}
          >
            <img
              src={post.image}
              alt={post.title}
              loading="lazy"
              decoding="async"
              sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 400px"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
            />
            {/* Gradient: transparent top → dark bottom */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

            {/* Category — top left */}
            <div className="absolute top-4 left-4">
              <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-white" style={{textShadow: "0 1px 3px rgba(0,0,0,0.9)"}}>
                {post.category}
              </span>
            </div>

            {/* Content — bottom */}
            <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5 translate-y-1 group-hover:translate-y-0 transition-transform duration-300" style={{textShadow: "0 1px 4px rgba(0,0,0,0.9)"}}>
              <p className="text-white/80 text-[11px] font-mono tracking-widest uppercase mb-2">{post.date}</p>
              <h3 className="text-white font-['Oswald',sans-serif] text-lg sm:text-xl font-bold uppercase leading-tight line-clamp-2 mb-3">
                {post.title}
              </h3>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono tracking-[0.2em] uppercase text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                Читать <ArrowRight className="w-3 h-3" />
              </span>
            </div>

            <Link href={`/blog/${index}`} className="absolute inset-0 z-10" aria-label={post.title} />
          </article>
        );

        const blogContent = (
          <section className={`section-lazy py-10 sm:py-16 ${getBgClass("blog", "bg-background")} overflow-hidden`}>
            <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-6 sm:mb-10 gap-3">
                <div>
                  <p className="text-[11px] font-mono tracking-[0.25em] uppercase text-muted-foreground mb-2">
                    {pageSettings?.blog?.subtitle || "BMG Журнал"}
                  </p>
                  <h2 className="font-['Oswald',sans-serif] text-3xl sm:text-5xl font-bold uppercase tracking-tight">
                    {pageSettings?.blog?.title || "Культура и стиль"}
                  </h2>
                </div>
                <Link href="/blog" className="inline-flex items-center gap-2 text-[10px] font-mono tracking-[0.2em] uppercase text-muted-foreground hover:text-primary transition-colors group shrink-0">
                  Все материалы <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>

              {blogLayout === "grid" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
                  {blogItems.map((post: any, index: number) => renderBlogCard(post, index))}
                </div>
              )}

              {blogLayout === "bento" && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  {blogItems.map((post: any, index: number) => {
                    const isFirst = index === 0;
                    const bentoClass = isFirst ? "md:col-span-7 md:row-span-2" : "md:col-span-5";
                    return (
                      <div key={index} className={bentoClass}>
                        {renderBlogCard(post, index, isFirst ? "vertical" : "horizontal")}
                      </div>
                    );
                  })}
                </div>
              )}

              {blogLayout === "carousel" && (() => {
                const scrollBlog = (dir: number) => {
                  const el = blogCarouselRef.current;
                  if (el) el.scrollBy({ left: dir * (el.clientWidth * 0.7), behavior: 'smooth' });
                };
                return (
                <div className="relative -mx-4 sm:-mx-6 lg:-mx-8">
                  <div className="absolute left-0 top-0 bottom-0 w-8 sm:w-16 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
                  <div className="absolute right-0 top-0 bottom-0 w-8 sm:w-16 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
                  <button
                    className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20 hidden sm:flex items-center justify-center w-8 h-8 text-foreground/30 hover:text-foreground transition-colors duration-200"
                    onClick={() => scrollBlog(-1)}
                    data-testid="button-blog-carousel-prev"
                    aria-label="Назад"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <button
                    className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20 hidden sm:flex items-center justify-center w-8 h-8 text-foreground/30 hover:text-foreground transition-colors duration-200"
                    onClick={() => scrollBlog(1)}
                    data-testid="button-blog-carousel-next"
                    aria-label="Вперёд"
                  >
                    <ArrowRight className="w-5 h-5" />
                  </button>
                  <div 
                    ref={blogCarouselRef}
                    className="flex gap-6 sm:gap-8 overflow-x-auto scrollbar-hide px-4 sm:px-8 snap-x snap-mandatory pb-4"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    {blogItems.map((post: any, index: number) => (
                      <div key={index} className="flex-shrink-0 snap-center w-[300px] sm:w-[360px] md:w-[400px]">
                        {renderBlogCard(post, index)}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-center mt-6 sm:hidden">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      <span>Листайте</span>
                      <ArrowRight className="w-3 h-3 animate-pulse" />
                    </div>
                  </div>
                </div>
                );
              })()}
            </div>
          </section>
        );
        return (
          <div key="section-blog">
            {blogContent}
            {renderPromoBanner("after_blog")}
          </div>
        );
      })() : null;

        case "promo_banner":
          return promoBanner && promoBanner.visible !== false && !promoBanner.position ? (
            <div key="section-promo_banner">
              <PromoBanner settings={promoBanner} />
            </div>
          ) : null;

        case "newsletter":
          return isSectionVisible("newsletter") ? (
            <div key="section-newsletter">
      <section className={`section-lazy py-12 sm:py-28 ${getBgClass("newsletter", "bg-foreground")} text-background relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none select-none flex items-center justify-center">
          <img src="/images/boomerangs-logo.webp" alt="" className="w-[80%] max-w-[800px] invert brightness-200" draggable={false} />
        </div>
        <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-[10px] sm:text-xs uppercase tracking-[0.2em] sm:tracking-[0.3em] text-background/50 mb-3 sm:mb-4">
            {pageSettings?.newsletter?.subtitle ? "" : "Будь в курсе"}
          </p>

          <h2 className="text-2xl sm:text-4xl md:text-5xl font-black uppercase tracking-[-0.03em] text-background mb-2 sm:mb-3 leading-tight">
            {pageSettings?.newsletter?.title || "Не пропусти дроп"}
          </h2>
          <p className="text-xs sm:text-sm text-background/60 mb-6 sm:mb-10 max-w-sm mx-auto">
            {pageSettings?.newsletter?.subtitle || "Новые коллекции, эксклюзивные акции и закрытые предложения — прямо на почту."}<br/>
            {homepagePromo?.isActive && homepagePromo?.discountPercent && (
              <span className="text-primary font-medium">Скидка {homepagePromo.discountPercent}% на первый заказ</span>
            )}
          </p>
          
          {subscribed ? (
            <div className="border border-background/10 p-6 sm:p-8 rounded-xl">
              <p className="text-lg font-medium text-background mb-2">{pageSettings?.newsletter?.successText || "Добро пожаловать в клуб"}</p>
              {homepagePromo?.isActive && homepagePromo?.code && (
                <p className="text-sm text-background/50">
                  Ваш промокод: <span className="text-primary font-bold text-base">{homepagePromo.code}</span>
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubscribe} className="max-w-sm mx-auto space-y-3 sm:space-y-4">
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-0 sm:border sm:border-background/20 sm:rounded-full sm:overflow-hidden sm:bg-background/5 sm:backdrop-blur-sm">
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Ваш email"
                  required
                  disabled={isSubmitting}
                  className="w-full bg-background/5 sm:bg-transparent border border-background/20 sm:border-0 rounded-full sm:rounded-none px-4 py-3 sm:px-5 sm:py-3.5 text-sm text-background placeholder:text-background/40 focus:outline-none disabled:opacity-50"
                  data-testid="input-newsletter-email"
                />
                <Button 
                  type="submit" 
                  disabled={isSubmitting || !newsletterConsent}
                  className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white rounded-full px-6 py-3 sm:py-3.5 text-sm font-medium sm:m-1 shrink-0"
                  data-testid="button-newsletter-submit"
                >
                  {isSubmitting ? "..." : (pageSettings?.newsletter?.buttonText || "Подписаться")}
                </Button>
              </div>
              <label className="flex items-start gap-2 cursor-pointer justify-center" data-testid="label-home-newsletter-consent">
                <input
                  type="checkbox"
                  checked={newsletterConsent}
                  onChange={(e) => setNewsletterConsent(e.target.checked)}
                  className="mt-0.5 accent-primary"
                  data-testid="checkbox-home-newsletter-consent"
                />
                <span className="text-[11px] leading-tight text-background/50 text-left">
                  Я соглашаюсь на обработку персональных данных и получение рассылки в соответствии с{" "}
                  <a href="/privacy" className="underline hover:text-background/60" target="_blank">политикой конфиденциальности</a>
                </span>
              </label>
            </form>
          )}
        </div>
      </section>
            </div>
          ) : null;

        case "marquee":
          return isSectionVisible("marquee") ? (
            <div key="section-marquee">
              <MarqueeSection text={pageSettings?.marquee?.text || "Новая коллекция уже в продаже • Бесплатная доставка при заказе от 5000₽ •"} />
            </div>
          ) : null;

        default: {
          // Render custom sections (added by admin)
          if (!sectionId.startsWith("custom_")) return null;
          const customSettings = pageSettings?.[sectionId];
          if (!customSettings || customSettings.visible === false) return null;

          const customBg = (() => {
            switch (customSettings.bgColor) {
              case "muted": return "bg-muted";
              case "card": return "bg-card";
              case "dark": return "bg-black text-white";
              default: return "bg-background";
            }
          })();

          // Custom Hits (product grid)
          if (customSettings.type === "custom_hits") {
            const count = parseInt(customSettings.count) || 8;
            let sectionProducts: any[] = [];
            if (customSettings.mode === "manual" && Array.isArray(customSettings.pinnedProductIds) && customSettings.pinnedProductIds.length > 0) {
              const visibleProducts = (products || []).filter((p: any) => !p.isHidden && (!isWholesale || (p.wholesalePrice && p.wholesalePrice > 0)));
              sectionProducts = customSettings.pinnedProductIds.map((id: number) => visibleProducts.find((p: any) => p.id === id)).filter(Boolean);
            } else {
              const visibleProducts = (products || []).filter((p: any) => !p.isHidden && (!isWholesale || (p.wholesalePrice && p.wholesalePrice > 0)));
              const sorted = [...visibleProducts].sort((a: any, b: any) => (b.id || 0) - (a.id || 0));
              sectionProducts = sorted.slice(0, count);
            }
            return (
              <div key={sectionId}>
                <section className={`py-10 sm:py-20 ${customBg}`}>
                  <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-end justify-between mb-6 sm:mb-12">
                      <div>
                        {customSettings.subtitle && (
                          <p className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">{customSettings.subtitle}</p>
                        )}
                        <h2 className="text-2xl sm:text-5xl font-bold tracking-tight">{customSettings.title || "Хиты продаж"}</h2>
                      </div>
                      {customSettings.linkUrl && (
                        <Link href={customSettings.linkUrl} className="group hidden sm:flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
                          {customSettings.linkText || "Смотреть всё"} <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                        </Link>
                      )}
                    </div>
                    {isLoading ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
                        {[...Array(count > 4 ? 4 : count)].map((_, i) => (
                          <div key={i} className="animate-pulse bg-muted rounded-xl aspect-[3/4]" />
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
                        {sectionProducts.map((product: any) => (
                          <ProductCard key={product.id} product={product} data-testid={`card-custom-hits-product-${product.id}`} />
                        ))}
                      </div>
                    )}
                    {customSettings.linkUrl && (
                      <div className="mt-8 text-center sm:hidden">
                        <Link href={customSettings.linkUrl}>
                          <Button variant="outline" size="sm" className="rounded-full">
                            {customSettings.linkText || "Смотреть всё"} <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            );
          }

          // Custom Promo Banner
          if (customSettings.type === "custom_promo_banner") {
            return (
              <div key={sectionId}>
                <PromoBanner settings={customSettings} />
              </div>
            );
          }

          // Custom Text Block
          if (customSettings.type === "custom_text") {
            return (
              <div key={sectionId}>
                <section className={`py-12 sm:py-20 ${customBg}`}>
                  <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                    {customSettings.image && (
                      <div className="mb-8 sm:mb-12 overflow-hidden rounded-2xl">
                        <img src={customSettings.image} alt={customSettings.title || ""} className="w-full h-[300px] sm:h-[420px] object-cover" loading="lazy" />
                      </div>
                    )}
                    <h2 className="text-2xl sm:text-4xl font-bold tracking-tight mb-4 sm:mb-6">{customSettings.title || ""}</h2>
                    {customSettings.text && (
                      <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-6 sm:mb-8 whitespace-pre-line">{customSettings.text}</p>
                    )}
                    {customSettings.buttonText && customSettings.buttonLink && (
                      <Link href={customSettings.buttonLink}>
                        <Button className="rounded-full">{customSettings.buttonText} <ArrowRight className="w-4 h-4 ml-2" /></Button>
                      </Link>
                    )}
                  </div>
                </section>
              </div>
            );
          }

          return null;
        }
        }
        })();
        if (!sectionContent) return null;
        if (sectionIdx < 3) return sectionContent;
        return <LazySection key={`lazy-${sectionId}`}>{sectionContent}</LazySection>;
      })}

      <Footer />
    </div>
  );
}
