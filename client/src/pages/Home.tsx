import SEO from "@/components/SEO";
import { ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, Truck, Palette, Flag, Mail, Shirt, Pencil, Settings2, ShoppingBag, Globe, X } from "lucide-react";

declare global {
  interface Window {
    __HERO__?: {
      img: string;
      imgMobile: string;
      imgAlt?: string;
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
import { FeaturedDropSection } from "@/components/FeaturedDropSection";
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
            <span key={i} className="text-black text-xs sm:text-sm font-normal uppercase tracking-[0.15em] px-6 sm:px-8 shrink-0">
              {text}{" "}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReelPill({ item, onClick }: { item: any; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center shrink-0 cursor-pointer group focus:outline-none"
    >
      {/* Внешнее кольцо — как в Telegram/Instagram: градиентный ободок + чёрный зазор перед превью */}
      <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full p-[2.5px] bg-gradient-to-tr from-primary via-red-500 to-orange-400 group-active:scale-95 transition-transform duration-150">
        <div className="relative w-full h-full rounded-full overflow-hidden ring-2 ring-black">
          {/* video с preload="metadata" — браузер загружает первый кадр, не воспроизводит */}
          {item.videoUrl ? (
            <video
              src={item.videoUrl}
              poster={item.thumbnailUrl || undefined}
              preload="metadata"
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt={item.label || ""}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-zinc-600" aria-hidden="true">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
            </div>
          )}
          {/* иконка play по центру */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/25 transition-colors">
            <div className="w-6 h-6 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white ml-0.5" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
        </div>
      </div>
      {item.label && (
        <div className="mt-1.5 text-center w-20 sm:w-24">
          <span className="text-[7px] font-bold uppercase tracking-[0.1em] text-zinc-400 leading-tight line-clamp-2 group-hover:text-zinc-200 transition-colors">
            {item.label}
          </span>
        </div>
      )}
    </button>
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
  const [activeReel, setActiveReel] = useState<any>(null);
  const [reelMuted, setReelMuted] = useState(true);
  const [reelProduct, setReelProduct] = useState<any>(null);
  const modalVideoRef = useRef<HTMLVideoElement>(null);
  const reelTouchStartX = useRef<number | null>(null);

  // Подгружаем данные товара при открытии рила
  useEffect(() => {
    if (!activeReel?.link) { setReelProduct(null); return; }
    // Берём последний сегмент пути — работает для /products/slug, /slug, https://…/slug
    const clean = activeReel.link.replace(/^https?:\/\/[^/]+/, "").split("?")[0].split("#")[0];
    const slug = clean.split("/").filter(Boolean).at(-1) || "";
    if (!slug) { setReelProduct(null); return; }
    fetch(`/api/products/by-slug/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setReelProduct(d || null))
      .catch(() => setReelProduct(null));
  }, [activeReel]);
  const [heroPaused, setHeroPaused] = useState(false);
  const [heroAnimKey, setHeroAnimKey] = useState(0);

  // Load page settings from database FIRST
  const { data: pageSettings, isLoading: settingsLoading } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/home"],
  });

  // Артисты — отдельная подписка на тот же кэш, не блокирует остальные секции
  const { data: artistStripItems } = useQuery<any[]>({
    queryKey: ["/api/page-settings/home"],
    select: (data: any) => data?.artists?.items ?? null,
    staleTime: 5 * 60 * 1000,
  });

  const reelItems: any[] = (pageSettings as any)?.reels?.items || [];
  const goToReel = useCallback((delta: number) => {
    setActiveReel((current: any) => {
      if (!current || reelItems.length === 0) return current;
      let idx = reelItems.findIndex((r: any) => r === current);
      if (idx === -1 && current?.id != null) idx = reelItems.findIndex((r: any) => r.id === current.id);
      if (idx === -1) idx = 0;
      const nextIdx = (idx + delta + reelItems.length) % reelItems.length;
      return reelItems[nextIdx];
    });
  }, [reelItems]);

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

  const { data: preorderProducts } = useQuery<any[]>({
    queryKey: ["/api/preorder/products"],
    queryFn: async () => {
      const res = await fetch("/api/preorder/products");
      if (!res.ok) throw new Error("Failed to fetch preorder products");
      return res.json();
    },
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

  // Сбрасываем heroPrev после завершения анимации шторки
  useEffect(() => {
    if (heroPrev === null) return;
    const t = setTimeout(() => setHeroPrev(null), 1400);
    return () => clearTimeout(t);
  }, [heroPrev]);

  useEffect(() => {
    const slides = getHeroSlides();
    if (slides.length <= 1) return;
    if (heroPaused) return;
    const currentDuration = Math.max(1, Number(slides[heroSlideIndex]?.duration) || 7) * 1000;
    const timer = setTimeout(() => {
      setHeroSlideIndex(prev => {
        const next = (prev + 1) % slides.length;
        setHeroPrev(prev);
        setHeroAnimKey(k => k + 1);
        return next;
      });
    }, currentDuration);
    return () => clearTimeout(timer);
  }, [pageSettings, heroPaused, heroSlideIndex]);

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
  const allFeaturedProducts = useMemo(() => {
    if (!Array.isArray(products)) return [];
    const visibleProducts = products.filter((p: any) => !p.isHidden && (!isWholesale || (p.wholesalePrice && p.wholesalePrice > 0)));
    if (pageSettings?.popular?.mode === "manual") {
      const pinnedIds: number[] = pageSettings.popular.pinnedProductIds || [];
      if (pinnedIds.length > 0) {
        const pinned = pinnedIds.map((id: number) => visibleProducts.find((p: any) => p.id === id)).filter(Boolean);
        if (pinned.length > 0) return pinned;
      }
    }
    return [...visibleProducts].sort((a: any, b: any) => {
      const aNew = a.isNew || a.badgeText === "NEW" ? 1 : 0;
      const bNew = b.isNew || b.badgeText === "NEW" ? 1 : 0;
      if (bNew !== aNew) return bNew - aNew;
      return (b.id || 0) - (a.id || 0);
    });
  }, [products, pageSettings?.popular?.mode, pageSettings?.popular?.pinnedProductIds]);

  const featuredProducts = useMemo(
    () => allFeaturedProducts.slice(0, productCount),
    [allFeaturedProducts, productCount]
  );

  const [popularVisibleCount, setPopularVisibleCount] = useState(16);

  // Admin-editable SEO overrides (раздел "SEO" в админке) для главной страницы.
  const { data: seoOverrides } = useQuery<Record<string, { title?: string; description?: string }>>({
    queryKey: ["/api/page-settings/seo"],
  });
  const homeSeoOverride = seoOverrides?.["home"];

  const promoBanner = pageSettings?.promo_banner;
  const renderPromoBanner = (position: string) => {
    if (!promoBanner || promoBanner.visible === false || promoBanner.position !== position) return null;
    return <PromoBanner settings={promoBanner} />;
  };

  const DEFAULT_SECTION_ORDER = ["hero", "reels", "categories", "popular", "featuredDrop", "benefits", "philosophy", "blog", "promo_banner", "newsletter", "marquee"];
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
        title={homeSeoOverride?.title || "Официальный сайт бренда Booomerangs"}
        description={homeSeoOverride?.description || "Booomerangs (BMGBRAND) — официальный магазин мерча. Купить мерч Гудтаймс, Молодость внутри, Дикая мята, Драгни, МультFильмы и других артистов. Доставка по всей России."}
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
            "@id": `${window.location.origin}/#website`,
            "name": "Booomerangs",
            "alternateName": "BMGBRAND",
            "url": `${window.location.origin}/`,
            "inLanguage": "ru-RU",
            "publisher": { "@id": `${window.location.origin}/#organization` },
            "potentialAction": {
              "@type": "SearchAction",
              "target": `${window.location.origin}/products?search={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "@id": `${window.location.origin}/#webpage`,
            "url": `${window.location.origin}/`,
            "name": homeSeoOverride?.title || "Официальный сайт бренда Booomerangs | BMGBRAND",
            "description": homeSeoOverride?.description || "Booomerangs (BMGBRAND) — официальный магазин мерча. Купить мерч Гудтаймс, Молодость внутри, Дикая мята, Драгни, МультFильмы и других артистов. Доставка по всей России.",
            "inLanguage": "ru-RU",
            "isPartOf": { "@id": `${window.location.origin}/#website` },
            "about": { "@id": `${window.location.origin}/#organization` },
            "speakable": {
              "@type": "SpeakableSpecification",
              "xpath": ["/html/head/title", "/html/head/meta[@name='description']/@content", "//h1"],
            },
          },
        ]}
      />
      <Navbar />
      <h1 className="sr-only">Booomerangs (BMGBRAND) — официальный магазин мерча</h1>

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
          const isVideoSlide = (slide as any).bgType === 'video' && !!(slide as any).heroVideo;
          const showHero = settingsLoading ? !!window.__HERO__?.img : isSectionVisible("hero");
          return showHero ? (
            <div key="section-hero">
        {/* Mobile-only black spacer behind floating navbar for video slides */}
        {isVideoSlide && <div className="sm:hidden bg-black" style={{ height: '100px' }} />}
        <section
          className={`relative ${isVideoSlide ? 'aspect-video' : 'h-svh'} sm:h-auto sm:aspect-[2560/1740] w-full flex flex-col items-center justify-center overflow-hidden bg-black sm:-mt-40 ${pageSettings?.hero?.showOnMobile === false ? 'hidden sm:flex' : ''} ${pageSettings?.hero?.showOnDesktop === false ? 'flex sm:hidden' : ''}`}
          onTouchStart={() => setHeroPaused(true)}
          onTouchEnd={() => setHeroPaused(false)}
          onTouchCancel={() => setHeroPaused(false)}
        >
          {/* Градиентная вуаль по краям — стрелки всегда читаются */}
          <div className="absolute inset-y-0 left-0 w-20 sm:w-28 z-10 pointer-events-none" style={{ background: "linear-gradient(to right, rgba(0,0,0,0.32) 0%, transparent 100%)" }} />
          <div className="absolute inset-y-0 right-0 w-20 sm:w-28 z-10 pointer-events-none" style={{ background: "linear-gradient(to left, rgba(0,0,0,0.32) 0%, transparent 100%)" }} />

          <div className="absolute inset-0 z-0 overflow-hidden">
            {heroSlides.map((s: any, i: number) => (
              <div
                key={i === activeIndex ? `active-${heroAnimKey}` : i}
                className={`absolute inset-0${i === activeIndex ? ' hero-slide-enter' : ''}`}
                style={{
                  opacity: i === activeIndex
                    ? (parseFloat(s.heroOpacity) || 0.6)
                    : (i === heroPrev ? (parseFloat(s.heroOpacity) || 0.6) : 0),
                  zIndex: i === activeIndex ? 2 : (i === heroPrev ? 1 : 0),
                  transition: i !== activeIndex ? 'opacity 0.3s ease-out 1s' : undefined,
                }}
              >
                {s.bgType === "video" && s.heroVideo ? (
                  <>
                    {/* Desktop: full-height framed video */}
                    <div className="hidden sm:flex absolute inset-0 items-center justify-center">
                      <div
                        className="rounded-2xl overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.65)] ring-1 ring-white/20 border border-white/10"
                        style={{ height: 'calc(100% - 1rem)', aspectRatio: '16/9', maxWidth: 'calc(100% - 1rem)' }}
                      >
                        <video src={s.heroVideo} autoPlay loop muted playsInline preload={i === activeIndex ? "metadata" : "none"} className="w-full h-full object-cover block" />
                      </div>
                    </div>
                    {/* Mobile: hero shrinks to aspect-video, fill it */}
                    <div className="sm:hidden absolute inset-0">
                      <video src={s.heroVideo} autoPlay loop muted playsInline preload={i === activeIndex ? "metadata" : "none"} className="w-full h-full object-cover block" />
                    </div>
                  </>
                ) : (
                  <picture className="absolute inset-0 block">
                    {s.heroImageMobile && <source media="(max-width: 639px)" srcSet={s.heroImageMobile} />}
                    <img
                      src={s.heroImage || ""}
                      alt={s.heroImageAlt || "Booomerangs — российский бренд одежды и мерча"}
                      loading={i === 0 ? "eager" : "lazy"}
                      fetchpriority={i === 0 ? "high" : "low"}
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
                    alt={window.__HERO__.imgAlt || "Booomerangs — российский бренд одежды и мерча"}
                    loading="eager"
                    fetchpriority="high"
                    className="w-full h-full object-cover object-center"
                  />
                </picture>
              </div>
            )}
            {heroSlides.length === 0 && pageSettings && (
              <div className="absolute inset-0" style={{ opacity: parseFloat(pageSettings?.hero?.heroOpacity) || 0.6 }}>
                {pageSettings?.hero?.bgType === "video" && pageSettings?.hero?.heroVideo ? (
                  <>
                    {/* Desktop: full-height framed video */}
                    <div className="hidden sm:flex absolute inset-0 items-center justify-center">
                      <div
                        className="rounded-2xl overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.65)] ring-1 ring-white/20 border border-white/10"
                        style={{ height: 'calc(100% - 1rem)', aspectRatio: '16/9', maxWidth: 'calc(100% - 1rem)' }}
                      >
                        <video src={pageSettings.hero.heroVideo} autoPlay loop muted playsInline preload="metadata" className="w-full h-full object-cover block" />
                      </div>
                    </div>
                    {/* Mobile: hero shrinks to aspect-video, fill it */}
                    <div className="sm:hidden absolute inset-0">
                      <video src={pageSettings.hero.heroVideo} autoPlay loop muted playsInline preload="metadata" className="w-full h-full object-cover block" />
                    </div>
                  </>
                ) : (
                  <picture className="absolute inset-0 block">
                    {pageSettings?.hero?.heroImageMobile && <source media="(max-width: 639px)" srcSet={pageSettings.hero.heroImageMobile} />}
                    <img src={pageSettings?.hero?.heroImage || ""} alt={pageSettings?.hero?.heroImageAlt || "Booomerangs — российский бренд одежды и мерча"} loading="eager" fetchpriority="high" className="w-full h-full object-cover object-center" />
                  </picture>
                )}
              </div>
            )}
          </div>
          <div className={`relative z-10 text-center px-4 max-w-4xl mx-auto flex flex-col items-center mt-auto pb-28 sm:pb-8 ${isVideoSlide ? 'hidden sm:flex' : 'flex'}`}>
            <div className="flex flex-col items-center">
              <p className="font-mono text-[9px] sm:text-xs text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] mb-6 sm:mb-8 text-center leading-relaxed drop-shadow-lg">
                {slide.tagline1 || pageSettings?.hero?.tagline1 || window.__HERO__?.tagline1 || "МЫ ДЕЛАЕМ ТО, ЧТО НОСИМ САМИ."}<br/>{slide.tagline2 || pageSettings?.hero?.tagline2 || window.__HERO__?.tagline2 || "РОССИЙСКИЙ БРЕНД ОДЕЖДЫ И АКСЕССУАРОВ."}
              </p>
              <Link href={slide.buttonLink || pageSettings?.hero?.buttonLink || window.__HERO__?.buttonLink || "/products"}>
                <Button size="lg" className="bg-card/75 backdrop-blur-md border border-border/50 outline outline-1 outline-white/40 outline-offset-[5px] text-foreground hover:outline-0 hover:border-2 hover:border-border/80 transition-all duration-200 px-5 py-3 sm:px-6 sm:py-4 text-xs sm:text-sm font-display uppercase tracking-[0.2em] sm:tracking-[0.3em] rounded-full h-auto min-h-0" data-testid="button-hero-catalog">
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
                  setHeroAnimKey(k => k + 1);
                  setHeroSlideIndex((activeIndex - 1 + heroSlides.length) % heroSlides.length);
                }}
                className="group absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 z-20 p-3 text-white/70 hover:text-white transition-all duration-300"
                data-testid="button-hero-prev"
              >
                <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8 transition-transform duration-300 group-hover:-translate-x-1 stroke-[1.5]" />
              </button>
              <button
                type="button"
                aria-label="Следующий слайд"
                onClick={() => {
                  setHeroPrev(activeIndex);
                  setHeroAnimKey(k => k + 1);
                  setHeroSlideIndex((activeIndex + 1) % heroSlides.length);
                }}
                className="group absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 z-20 p-3 text-white/70 hover:text-white transition-all duration-300"
                data-testid="button-hero-next"
              >
                <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8 transition-transform duration-300 group-hover:translate-x-1 stroke-[1.5]" />
              </button>
            </>
          )}
        </section>
        {/* Mobile-only CTA button below video hero */}
        {isVideoSlide && (
          <div className="sm:hidden bg-black px-6 py-5 flex flex-col items-center gap-2">
            <Link href={slide.buttonLink || pageSettings?.hero?.buttonLink || "/products"} className="w-full max-w-xs">
              <Button
                size="lg"
                className="w-full bg-primary hover:bg-primary/90 text-white font-display uppercase tracking-[0.2em] text-sm rounded-full py-4 h-auto min-h-0 shadow-[0_0_24px_hsl(0_72%_51%/0.45)] transition-all duration-300 active:scale-95"
                data-testid="button-hero-catalog-mobile-video"
              >
                {slide.buttonText || pageSettings?.hero?.buttonText || "Перейти в коллекцию"}
              </Button>
            </Link>
            {(slide.tagline1 || pageSettings?.hero?.tagline1) && (
              <p className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.2em] text-center">
                {slide.tagline1 || pageSettings?.hero?.tagline1}
              </p>
            )}
          </div>
        )}
        {renderPromoBanner("after_hero")}
        {(() => {
          const stripItems: any[] = artistStripItems || pageSettings?.artists?.items || artists;
          if (!stripItems || stripItems.length === 0) return null;
          return (
            <div className="w-full border-t-2 border-primary" style={{ background: "radial-gradient(ellipse 100% 60% at 50% 0%, #1c1c1c 0%, #0a0a0a 65%)" }}>
              {/* ── Мобильный заголовок (только sm-) ── */}
              <div className="flex sm:hidden items-center justify-between px-4 pt-4 pb-1">
                <span className="text-[10px] font-mono tracking-[0.3em] uppercase text-zinc-300">
                  Коллаборации
                </span>
                <Link
                  href={pageSettings?.artists?.linkUrl || "/products/merch"}
                  className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-zinc-400 hover:text-white transition-colors"
                  data-testid="link-all-artists-strip-mobile"
                >
                  <span>Все</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              {/* ── Лента коллабораций ── */}
              <div className="flex items-stretch">
                {/* Левый лейбл */}
                <div className="hidden sm:flex shrink-0 items-center justify-center px-5 lg:px-7 border-r border-zinc-800">
                  <span className="text-[11px] font-mono tracking-[0.3em] uppercase text-zinc-300 whitespace-nowrap" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
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
                    {stripItems.map((artist: any, idx: number) => {
                      const rotations = [-2, 1.5, -1, 2, -1.5, 1];
                      const rot = rotations[idx % rotations.length];
                      return (
                        <Link
                          key={idx}
                          href={artist.slug ? `/@${artist.slug}` : (artist.link || "/products/merch")}
                          className="flex flex-col shrink-0 cursor-pointer group"
                          style={{ transform: `rotate(${rot}deg)`, transition: "transform 0.35s cubic-bezier(.22,.68,0,1.2), box-shadow 0.35s ease" }}
                          data-testid={`link-artist-strip-${idx}`}
                        >
                          {/* Поляроид */}
                          <div
                            className="bg-white shadow-lg group-hover:shadow-2xl"
                            style={{
                              padding: "6px 6px 0 6px",
                              transform: "rotate(0deg)",
                              transition: "transform 0.35s cubic-bezier(.22,.68,0,1.2)",
                            }}
                          >
                            {/* Фото */}
                            <div className="relative overflow-hidden" style={{ width: 86, height: 110 }}>
                              <img
                                src={getOptimizedImageUrl(artist.image)}
                                alt={artist.name}
                                loading={idx < 5 ? "eager" : "lazy"}
                                // @ts-ignore fetchpriority is valid on <img> but missing from current @types/react
                                fetchpriority={idx < 5 ? "high" : "auto"}
                                decoding={idx < 5 ? "sync" : "async"}
                                width={86}
                                height={110}
                                className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                              />
                            </div>
                            {/* Белая полоска с именем */}
                            <div className="flex items-center justify-center px-1 py-2" style={{ width: 86, minHeight: 32 }}>
                              <span className="text-[7.5px] font-bold uppercase tracking-[0.1em] text-zinc-800 text-center leading-tight line-clamp-2">
                                {artist.name}
                              </span>
                            </div>
                          </div>
                        </Link>
                      );
                    })}

                    {/* ── Специальная карточка «× ваш мерч» ── */}
                    <Link
                      href="/merch-na-zakaz"
                      className="flex flex-col shrink-0 cursor-pointer group"
                      style={{ transform: "rotate(1.5deg)", transition: "transform 0.35s cubic-bezier(.22,.68,0,1.2)" }}
                      data-testid="link-artist-strip-custom-merch"
                    >
                      <div
                        className="bg-white shadow-lg group-hover:shadow-2xl"
                        style={{ padding: "6px 6px 0 6px", transition: "transform 0.35s cubic-bezier(.22,.68,0,1.2)" }}
                      >
                        {/* Тёмный фон с логотипом */}
                        <div
                          className="relative overflow-hidden flex items-center justify-center"
                          style={{ width: 86, height: 110, background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)" }}
                        >
                          <img
                            src="/images/boomerangs-logo.webp"
                            alt="Booomerangs"
                            className="w-14 h-auto object-contain opacity-90 transition-transform duration-500 group-hover:scale-110"
                          />
                        </div>
                        {/* Подпись */}
                        <div className="flex items-center justify-center px-1 py-2" style={{ width: 86, minHeight: 32 }}>
                          <span className="text-[7.5px] font-bold uppercase tracking-[0.1em] text-zinc-800 text-center leading-tight">
                            × ваш мерч
                          </span>
                        </div>
                      </div>
                    </Link>

                    <div className="shrink-0 w-10 sm:w-16" />
                  </div>
                </div>
                {/* Правая ссылка "Все" */}
                <Link
                  href={pageSettings?.artists?.linkUrl || "/products/merch"}
                  className="hidden sm:flex shrink-0 items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-zinc-300 hover:text-white transition-all duration-200 px-5 lg:px-7 border-l border-zinc-800 group"
                  data-testid="link-all-artists-strip"
                >
                  <span className="whitespace-nowrap">Все</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
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
                    <div className="flex-1 px-0 sm:px-7 py-3.5">
                      <p className="text-sm sm:text-base font-semibold text-white leading-tight">
                        Создай свой мерч и присоединяйся к нашей платформе
                      </p>
                      {/* Шаги-иконки вместо текстовой подписи */}
                      <div className="hidden sm:flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <Pencil className="w-3 h-3 text-zinc-300 shrink-0" />
                        <span className="text-[10px] text-zinc-300">Идея</span>
                        <ArrowRight className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
                        <Settings2 className="w-3 h-3 text-zinc-300 shrink-0" />
                        <span className="text-[10px] text-zinc-300">Производство</span>
                        <ArrowRight className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
                        <Globe className="w-3 h-3 text-zinc-300 shrink-0" />
                        <span className="text-[10px] text-zinc-300">Платформа</span>
                        <ArrowRight className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
                        <ShoppingBag className="w-3 h-3 text-zinc-300 shrink-0" />
                        <span className="text-[10px] text-zinc-300">Продажа</span>
                        <ArrowRight className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
                        <Truck className="w-3 h-3 text-zinc-300 shrink-0" />
                        <span className="text-[10px] text-zinc-300">Доставка</span>
                      </div>
                    </div>
                    {/* Красная кнопка */}
                    <div className="shrink-0 px-4 sm:px-7 py-4">
                      <div className="flex items-center gap-2 bg-primary px-4 py-2 rounded text-white text-[10px] sm:text-xs font-bold uppercase tracking-[0.15em] group-hover:bg-primary/90 transition-colors duration-200 whitespace-nowrap">
                        <span>Заказать</span>
                        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </div>
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

        case "reels": {
          if (!isSectionVisible("reels")) return null;
          const reelsSettings = pageSettings?.reels || {};
          const reelItems: any[] = reelsSettings.items || [];
          if (reelItems.length === 0) return null;
          return (
            <div key="section-reels" className="w-full border-t-2 border-primary" style={{ background: "radial-gradient(ellipse 100% 60% at 50% 0%, #1c1c1c 0%, #0a0a0a 65%)" }}>
              <div className="flex sm:hidden items-center px-4 pt-4 pb-1">
                <span className="text-[10px] font-mono tracking-[0.3em] uppercase text-zinc-300">
                  {reelsSettings.title || "Обзоры"}
                </span>
              </div>
              <div className="flex items-stretch">
                <div className="hidden sm:flex shrink-0 items-center justify-center px-5 lg:px-7 border-r border-zinc-800">
                  <span className="text-[11px] font-mono tracking-[0.3em] uppercase text-zinc-300 whitespace-nowrap" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                    {reelsSettings.title || "Обзоры"}
                  </span>
                </div>
                <div className="flex-1 relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-8 sm:w-12 bg-gradient-to-r from-zinc-950 to-transparent z-10 pointer-events-none" />
                  <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-l from-zinc-950 to-transparent z-10 pointer-events-none" />
                  <div
                    className="flex items-end gap-3 sm:gap-4 overflow-x-auto px-4 sm:px-6 py-5 sm:py-6"
                    style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                  >
                    {reelItems.map((item: any, idx: number) => (
                      <ReelPill key={item.id || idx} item={item} onClick={() => setActiveReel(item)} />
                    ))}
                    <div className="shrink-0 w-10 sm:w-16" />
                  </div>
                </div>
              </div>
            </div>
          );
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

          {isLoading ? null : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-0 mt-0 overflow-hidden">
              {allFeaturedProducts.slice(0, popularVisibleCount).map((product, index) => (
                <ProductCard key={product.id} product={product} priority={index < 4} />
              ))}
            </div>
          )}

          <div className="flex justify-center mt-10 sm:mt-14">
            {!isLoading && popularVisibleCount < allFeaturedProducts.length ? (
              <Button
                variant="outline"
                size="lg"
                className="uppercase tracking-wide gap-2.5"
                onClick={() => setPopularVisibleCount(c => c + 16)}
              >
                Показать ещё
                <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button asChild variant="outline" size="lg" className="uppercase tracking-wide gap-2.5">
                <Link href={pageSettings?.popular?.linkUrl || "/products"} data-testid="link-all-products">
                  {pageSettings?.popular?.linkText || "Все товары"}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
            )}
          </div>
      </section>
            </div>
          ) : null;

        case "featuredDrop":
          return isSectionVisible("featuredDrop") ? (() => {
            const fdSettings = pageSettings?.featuredDrop || {};
            const now = Date.now();
            const isActive = (p: any) => (p.preorderStatus || "collecting") === "collecting" && (!p.preorderDeadline || new Date(p.preorderDeadline).getTime() >= now);
            const fdProduct = preorderProducts?.find((p: any) => p.id === fdSettings.productId)
              || preorderProducts?.find(isActive)
              || preorderProducts?.find((p: any) => (p.preorderStatus || "collecting") === "collecting")
              || preorderProducts?.[0];
            if (!fdProduct) return null;
            return (
              <div key="section-featured-drop">
                <FeaturedDropSection
                  product={fdProduct}
                  title={fdSettings.title}
                  subtitle={fdSettings.subtitle}
                  ctaText={fdSettings.ctaText}
                  terminalLabel={fdSettings.terminalLabel}
                />
                {renderPromoBanner("after_featured_drop")}
              </div>
            );
          })() : null;

        case "benefits":
          return isSectionVisible("benefits") ? (
            <div key="section-benefits">
      <section className={`section-lazy ${getBgClass("benefits", "bg-zinc-950")}`}>
        <div className="max-w-8xl mx-auto">
          {/* Specs panel — single unified block */}
          <div className="border-t border-b border-white/[0.08]">
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-white/[0.08]">
              {benefits.map((benefit, index) => {
                const BenefitIcon = benefit.icon;
                const title = pageSettings?.benefits?.[`benefit${index}Title`] || benefit.title;
                const desc = pageSettings?.benefits?.[`benefit${index}Desc`] || benefit.desc;
                return (
                  <div
                    key={index}
                    className={`group flex flex-col justify-between px-5 sm:px-8 py-5 sm:py-6 cursor-default transition-colors duration-200 hover:bg-white/[0.03] ${index >= 2 ? "border-t border-white/[0.08] sm:border-t-0" : ""}`}
                  >
                    <BenefitIcon className="w-4 h-4 text-white/40 mb-4 sm:mb-6" strokeWidth={1.5} />
                    <div>
                      <p
                        style={{ fontFamily: "'Oswald', sans-serif" }}
                        className="text-sm sm:text-base font-bold uppercase tracking-tight text-white leading-tight mb-0.5"
                      >
                        {title}
                      </p>
                      <p className="font-mono text-[9px] sm:text-[10px] tracking-[0.12em] text-white/30 uppercase leading-relaxed">
                        {desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
      {renderPromoBanner("after_benefits")}
            </div>
          ) : null;

        case "philosophy":
          return isSectionVisible("philosophy") ? (
            <div key="section-philosophy">
      <section className={`section-lazy overflow-hidden ${getBgClass("philosophy", "bg-zinc-950")}`}>
        <div className="flex flex-col md:flex-row min-h-[520px] sm:min-h-[640px] md:h-[680px] md:max-h-[680px]">
          {/* Left — text panel */}
          <div className="flex flex-col justify-center px-6 py-12 sm:px-12 sm:py-20 md:w-[48%] lg:w-[44%] shrink-0 gap-6 sm:gap-8">
            <p className="text-[11px] sm:text-xs font-mono tracking-[0.25em] uppercase text-white/35">
              BOOOMERANGS — МАНИФЕСТ
            </p>
            <h2 className="font-['Oswald',sans-serif] text-[2.8rem] sm:text-[4rem] lg:text-[5rem] font-bold uppercase leading-[0.9] tracking-tight text-white">
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
            <p className="text-base sm:text-lg text-white/50 leading-[1.8]">
              {pageSettings?.philosophy?.text || "Базируясь в Туле — городе мастеров, пряников и самоваров — мы создаем вещи для повседневной жизни. На нашем счету более 200 моделей носков: от ироничных мемных дизайнов до оригинальных ярких пар. Мы объединяем традиции качества и современный стиль в каждой детали нашего ассортимента."}
            </p>
            <Link
              href={pageSettings?.philosophy?.linkUrl || "/about"}
              className="group inline-flex items-center gap-3 w-fit mt-2"
              data-testid="link-manifesto"
            >
              <span className="text-xs font-mono tracking-[0.22em] uppercase text-white/40 group-hover:text-white/70 transition-colors duration-200">
                {pageSettings?.philosophy?.linkText || "Узнать о нас"}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-white/25 group-hover:text-white/60 group-hover:translate-x-1 transition-all duration-200" strokeWidth={1.5} />
            </Link>
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
            {/* Vignette — все четыре края растворяются в фоне */}
            <div className="hidden md:block absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-zinc-950 to-transparent pointer-events-none" />
            <div className="hidden md:block absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-zinc-950 to-transparent pointer-events-none" />
            <div className="hidden md:block absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-zinc-950 to-transparent pointer-events-none" />
            <div className="hidden md:block absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-zinc-950 to-transparent pointer-events-none" />
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
      <section className={`section-lazy ${getBgClass("newsletter", "bg-zinc-950")} border-t border-white/[0.08] relative overflow-hidden`}>
        <div className="max-w-8xl mx-auto px-6 sm:px-12 lg:px-16 py-20 sm:py-32 flex flex-col md:flex-row gap-14 md:gap-24 items-start md:items-center">

          {/* Left — form */}
          <div className="flex-1 w-full">
            {subscribed ? (
              <div className="border border-white/[0.12] p-6 sm:p-8">
                <p className="text-lg font-medium text-white mb-2">{pageSettings?.newsletter?.successText || "Добро пожаловать в клуб"}</p>
                {homepagePromo?.isActive && homepagePromo?.code && (
                  <p className="text-sm text-white/40">
                    Ваш промокод: <span className="text-primary font-bold text-base">{homepagePromo.code}</span>
                  </p>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubscribe} className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-0 border border-white/[0.12] overflow-hidden">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Ваш email"
                    required
                    disabled={isSubmitting}
                    className="flex-1 bg-transparent px-5 py-4 text-sm text-white placeholder:text-white/30 focus:outline-none disabled:opacity-50"
                    data-testid="input-newsletter-email"
                  />
                  <Button
                    type="submit"
                    disabled={isSubmitting || !newsletterConsent}
                    className="bg-white hover:bg-white/90 text-black rounded-none px-8 py-4 h-auto text-sm font-bold uppercase tracking-wider shrink-0 disabled:opacity-40"
                    data-testid="button-newsletter-submit"
                  >
                    {isSubmitting ? "..." : (pageSettings?.newsletter?.buttonText || "Подписаться")}
                  </Button>
                </div>
                <label className="flex items-start gap-2 cursor-pointer" data-testid="label-home-newsletter-consent">
                  <input
                    type="checkbox"
                    checked={newsletterConsent}
                    onChange={(e) => setNewsletterConsent(e.target.checked)}
                    className="mt-0.5 accent-primary"
                    data-testid="checkbox-home-newsletter-consent"
                  />
                  <span className="text-[11px] leading-tight text-white/30 text-left">
                    Я соглашаюсь на обработку персональных данных и получение рассылки в соответствии с{" "}
                    <a href="/privacy" className="underline hover:text-white/50" target="_blank">политикой конфиденциальности</a>
                  </span>
                </label>
              </form>
            )}
          </div>

          {/* Right — editorial */}
          <div className="md:w-[48%] lg:w-[42%] shrink-0">
            <p className="text-[10px] font-mono tracking-[0.3em] uppercase text-white/35 mb-8 sm:mb-12">
              БУДЬ В КУРСЕ
            </p>
            <h2 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-[3.2rem] sm:text-[4.6rem] lg:text-[5.4rem] font-bold uppercase leading-[0.88] tracking-tight text-white mb-8 sm:mb-10">
              {pageSettings?.newsletter?.title ? (
                <span>{pageSettings.newsletter.title}</span>
              ) : (
                <>
                  <span className="block">НЕ</span>
                  <span className="block text-primary">ПРОПУСТИ</span>
                  <span className="block">ДРОП</span>
                </>
              )}
            </h2>
            <p className="text-sm sm:text-[1.05rem] text-white/45 leading-[1.75] max-w-xs">
              {pageSettings?.newsletter?.subtitle || "Новые коллекции, эксклюзивные акции и закрытые предложения — прямо на почту."}
              {homepagePromo?.isActive && homepagePromo?.discountPercent && (
                <><br /><span className="text-primary font-medium">Скидка {homepagePromo.discountPercent}% на первый заказ</span></>
              )}
            </p>
          </div>
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
                    <div className="mb-6 sm:mb-12">
                      <div>
                        {customSettings.subtitle && (
                          <p className="text-xs sm:text-sm uppercase tracking-[0.2em] text-foreground mb-2">{customSettings.subtitle}</p>
                        )}
                        <h2 className="text-2xl sm:text-5xl font-bold tracking-tight">{customSettings.title || "Хиты продаж"}</h2>
                      </div>
                    </div>
                    {isLoading ? null : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
                        {sectionProducts.map((product: any) => (
                          <ProductCard key={product.id} product={product} data-testid={`card-custom-hits-product-${product.id}`} />
                        ))}
                      </div>
                    )}
                    {customSettings.linkUrl && (
                      <div className="flex justify-center mt-10 sm:mt-14">
                        <Button asChild variant="outline" size="lg" className="uppercase tracking-wide gap-2.5">
                          <Link href={customSettings.linkUrl}>
                            {customSettings.linkText || "Смотреть всё"} <ArrowRight className="w-4 h-4" />
                          </Link>
                        </Button>
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
        return sectionContent;
      })}

      {activeReel && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          onClick={() => { setActiveReel(null); setReelMuted(true); setReelProduct(null); }}
        >
          {/* Blurred background — desktop only */}
          <video
            src={activeReel.videoUrl}
            autoPlay loop playsInline muted
            className="hidden sm:block absolute inset-0 w-full h-full object-cover scale-110 opacity-30"
            style={{ filter: "blur(32px)" }}
            aria-hidden="true"
          />
          <div className="hidden sm:block absolute inset-0 bg-black/40" />

          {/* Video panel:
              mobile  — полный экран, object-cover
              desktop — 9:16, высота 95vh, по центру, скруглённые углы */}
          <div
            className="relative w-full h-full sm:h-[95vh] sm:rounded-2xl sm:overflow-hidden sm:shadow-2xl"
            style={{ aspectRatio: undefined }}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => { reelTouchStartX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              if (reelTouchStartX.current == null) return;
              const deltaX = e.changedTouches[0].clientX - reelTouchStartX.current;
              reelTouchStartX.current = null;
              if (Math.abs(deltaX) < 40) return;
              goToReel(deltaX < 0 ? 1 : -1);
            }}
          >
            {/* Внутренний контейнер 9:16 только на десктопе */}
            <div className="w-full h-full sm:h-full sm:flex sm:items-center sm:justify-center">
              {/* Стрелки — только на десктопе */}
              {reelItems.length > 1 && (
                <>
                  <button
                    className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-colors"
                    onClick={(e) => { e.stopPropagation(); goToReel(-1); }}
                    aria-label="Предыдущий рил"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-colors"
                    onClick={(e) => { e.stopPropagation(); goToReel(1); }}
                    aria-label="Следующий рил"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
              <div className="relative w-full h-full sm:aspect-[9/16] sm:h-full sm:w-auto sm:max-w-full">
                <video
                  ref={modalVideoRef}
                  key={activeReel.videoUrl}
                  src={activeReel.videoUrl}
                  autoPlay
                  playsInline
                  muted={reelMuted}
                  className="absolute inset-0 w-full h-full object-cover"
                  onCanPlay={(e) => { (e.target as HTMLVideoElement).play().catch(() => {}); }}
                  onEnded={() => goToReel(1)}
                />

                {/* Топ-бар: градиент + мут / название / закрыть */}
                <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/70 via-black/20 to-transparent pb-10">
                  <div className="flex items-center justify-between px-4 pt-4">
                    {/* Мут */}
                    <button
                      className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white"
                      onClick={() => setReelMuted((m) => !m)}
                      aria-label={reelMuted ? "Включить звук" : "Выключить звук"}
                    >
                      {reelMuted ? (
                        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white" aria-hidden="true">
                          <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0 0 17.73 19L19 20.27 20.27 19 5.27 4 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white" aria-hidden="true">
                          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                        </svg>
                      )}
                    </button>

                    {/* Название рила по центру */}
                    {activeReel.label && (
                      <span className="text-white/80 text-[13px] font-medium tracking-wide truncate max-w-[160px] text-center">
                        {activeReel.label}
                      </span>
                    )}

                    {/* Закрыть */}
                    <button
                      className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white"
                      onClick={() => { setActiveReel(null); setReelMuted(true); setReelProduct(null); }}
                      aria-label="Закрыть"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Edge bar — тонкая карточка у низа */}
                {activeReel.link && (
                  <a
                    href={activeReel.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-3 px-4 py-2.5 bg-black/60 backdrop-blur-xl border-t border-white/10 active:bg-black/80 transition-colors"
                  >
                    {/* Круглое фото */}
                    {(reelProduct?.thumbnailUrl || reelProduct?.imageUrl || activeReel.thumbnailUrl) ? (
                      <img
                        src={reelProduct?.thumbnailUrl || reelProduct?.imageUrl || activeReel.thumbnailUrl}
                        alt={reelProduct?.name || activeReel.label || ""}
                        className="w-10 h-10 rounded-full object-cover shrink-0 ring-1 ring-white/20"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-zinc-800 shrink-0" />
                    )}
                    {/* Название + цена */}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-[13px] font-semibold leading-tight truncate">
                        {reelProduct?.name || activeReel.label || ""}
                      </p>
                      {reelProduct?.price != null && (
                        <p className="text-white/70 text-[12px] leading-tight mt-0.5">
                          {`${Math.round((reelProduct.salePrice || reelProduct.price) / 100).toLocaleString("ru-RU")} ₽`}
                        </p>
                      )}
                    </div>
                    {/* Тег */}
                    <span className="shrink-0 bg-primary text-white text-[11px] font-bold px-3 py-1.5 rounded-full">
                      Купить
                    </span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
