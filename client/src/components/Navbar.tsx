import { Link, useLocation } from "wouter";
import { ShoppingBag, Menu, X, ArrowLeft, Search, User, LogOut, LogIn, Gift, Heart, ChevronDown, ChevronRight, Briefcase, TrendingUp, Shirt, PackageOpen, Headphones, Music } from "lucide-react";
import { usePartnerBanner, PartnerBannerContent } from "./PartnerBanner";
import { MusicDrawer } from "./MusicDrawer";
import { usePlayer } from "@/context/PlayerContext";
import { useState, useRef, useEffect, useMemo, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCart } from "@/hooks/use-cart";
import { usePreorderCart } from "@/context/PreorderCartContext";
import { useFavorites } from "@/hooks/use-favorites";
import { useAuth, useLogout, useWholesalePrice } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const SearchModal = lazy(() => import("./SearchModal").then(m => ({ default: m.SearchModal })));
const AuthModal = lazy(() => import("./AuthModal").then(m => ({ default: m.AuthModal })));
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NavbarSettings } from "./navbar-settings";
import { DEFAULT_NAVBAR_SETTINGS } from "./navbar-settings";
import { RuStoreButton } from "./RuStoreButton";
import { CATEGORIES, normalizeCategories } from "@shared/schema";
import type { CategoryConfig } from "@shared/schema";
import type { ArtistTrack } from "@/context/PlayerContext";

interface ArtistGroupMobile {
  slug: string;
  name: string;
  tracks: ArtistTrack[];
}

function MobileMusicList({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useQuery<{ artists: ArtistGroupMobile[] }>({
    queryKey: ["/api/artists/all-tracks"],
    staleTime: 2 * 60 * 1000,
  });
  const { currentTrack, isPlaying, play, pause } = usePlayer();
  const artists = data?.artists || [];
  const allTracks = artists.flatMap(a => a.tracks);

  if (isLoading) {
    return (
      <div className="pt-3 pl-2 space-y-1">
        {[1, 2].map(i => <div key={i} className="h-10 rounded-xl bg-muted/50 animate-pulse" />)}
      </div>
    );
  }
  if (artists.length === 0) {
    return <p className="text-sm text-muted-foreground pl-2 pt-3">Треки не добавлены</p>;
  }

  return (
    <div className="pt-3 pl-2 space-y-3 overflow-y-auto max-h-64">
      {artists.map(artist => (
        <div key={artist.slug}>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-1.5">{artist.name}</p>
          <div className="space-y-0.5">
            {artist.tracks.map(track => {
              const isActive = currentTrack?.id === track.id;
              const isThisPlaying = isActive && isPlaying;
              return (
                <button
                  key={track.id}
                  onClick={() => {
                    if (isActive && isThisPlaying) pause();
                    else { play(track, allTracks); onClose(); }
                  }}
                  className="flex items-center gap-2.5 w-full py-1.5 px-2 rounded-lg transition-colors text-left"
                  style={{ background: isActive ? "hsla(var(--primary)/0.1)" : "transparent" }}
                  data-testid={`mobile-track-${track.id}`}
                >
                  {track.coverUrl ? (
                    <img src={track.coverUrl} alt={track.title} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-muted flex-shrink-0" />
                  )}
                  <span
                    className="text-sm font-medium truncate flex-1"
                    style={{ color: isActive ? "hsl(var(--primary))" : undefined }}
                  >
                    {track.title}
                  </span>
                  {isThisPlaying
                    ? <Pause className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
                    : <Play className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [searchEverOpened, setSearchEverOpened] = useState(false);
  const [authEverOpened, setAuthEverOpened] = useState(false);
  const [isLoginDropdownOpen, setIsLoginDropdownOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // ── Мобильный скролл: скрывать навбар при скролле вниз ──
  const [isNavHidden, setIsNavHidden] = useState(false);
  const lastScrollY = useRef(0);

  // Shop mega-menu state
  const [isShopMenuOpen, setIsShopMenuOpen] = useState(false);
  const shopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shopMenuRef = useRef<HTMLDivElement>(null);
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);
  const [mobileShopOpen, setMobileShopOpen] = useState(false);
  const [mobileExpandedCat, setMobileExpandedCat] = useState<string | null>(null);
  const [isMusicDrawerOpen, setIsMusicDrawerOpen] = useState(false);
  const [isMobileTracksOpen, setIsMobileTracksOpen] = useState(false);
  const { currentTrack } = usePlayer();
  const isTouchDevice = useRef(false);

  useEffect(() => {
    const onTouch = () => { isTouchDevice.current = true; };
    const onMouse = () => { isTouchDevice.current = false; };
    window.addEventListener('touchstart', onTouch, { passive: true });
    window.addEventListener('mousemove', onMouse);
    return () => {
      window.removeEventListener('touchstart', onTouch);
      window.removeEventListener('mousemove', onMouse);
    };
  }, []);

  useEffect(() => {
    if (!isShopMenuOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (shopMenuRef.current && !shopMenuRef.current.contains(e.target as Node)) {
        setIsShopMenuOpen(false);
        setHoveredCat(null);
      }
    };
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('mousedown', handleOutside);
    return () => {
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [isShopMenuOpen]);

  useEffect(() => {
    if (isShopMenuOpen) {
      document.body.classList.add('megamenu-open');
    } else {
      document.body.classList.remove('megamenu-open');
    }
    return () => document.body.classList.remove('megamenu-open');
  }, [isShopMenuOpen]);

  useEffect(() => {
    const el = mobileMenuRef.current;
    if (!el) return;
    if (isOpen) {
      el.removeAttribute("inert");
    } else {
      el.setAttribute("inert", "");
    }
  }, [isOpen]);

  // ── Скролл-хук: только мобильные (<1024px) ──
  useEffect(() => {
    const handleScroll = () => {
      if (window.innerWidth >= 1024) return;
      if (isOpen) { setIsNavHidden(false); return; }
      const currentY = window.scrollY;
      if (currentY > lastScrollY.current && currentY > 80) {
        setIsNavHidden(true);
      } else if (currentY < lastScrollY.current) {
        setIsNavHidden(false);
      }
      lastScrollY.current = currentY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isOpen]);


  const [location, navigate] = useLocation();

  useEffect(() => {
    setIsOpen(false);
    setIsShopMenuOpen(false);
    setMobileShopOpen(false);
    setMobileExpandedCat(null);
    setHoveredCat(null);
    if (shopTimerRef.current) clearTimeout(shopTimerRef.current);
  }, [location]);

  const { data: cartItems } = useCart();
  const { data: authData } = useAuth();
  const logout = useLogout();
  const partnerBanner = usePartnerBanner();
  
  const { favoritesCount } = useFavorites();
  const { totalCount: preorderCount } = usePreorderCart();
  const user = authData?.user;
  const cartCount = cartItems?.reduce((acc, item) => acc + item.quantity, 0) || 0;
  const { isWholesale } = useWholesalePrice();
  const isPartner = user?.role === 'partner';
  const profileHref = isPartner
    ? "/partner"
    : isWholesale
      ? "/wholesale/profile"
      : "/profile";

  const { data: navbarData } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/navbar"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: dynamicCategories } = useQuery<Record<string, CategoryConfig>>({
    queryKey: ["/api/categories"],
    staleTime: 5 * 60 * 1000,
  });

  const categories = useMemo(
    () => normalizeCategories(dynamicCategories || CATEGORIES),
    [dynamicCategories]
  );
  const categoryEntries = useMemo(() => Object.entries(categories), [categories]);

  const settings: NavbarSettings = (() => {
    if (navbarData?.navbar_data) {
      const parsed = typeof navbarData.navbar_data === "string"
        ? JSON.parse(navbarData.navbar_data)
        : navbarData.navbar_data;
      return { ...DEFAULT_NAVBAR_SETTINGS, ...parsed };
    }
    return DEFAULT_NAVBAR_SETTINGS;
  })();

  const visibleLinks = settings.links.filter((l) => l.visible);
  const isHome = location === "/";
  const isConceptPage = location === "/concept";

  const openShopMenu = () => {
    if (shopTimerRef.current) clearTimeout(shopTimerRef.current);
    setIsShopMenuOpen(true);
  };
  const closeShopMenu = () => {
    shopTimerRef.current = setTimeout(() => setIsShopMenuOpen(false), 120);
  };
  const closeAll = () => {
    setIsShopMenuOpen(false);
    setIsOpen(false);
    setMobileShopOpen(false);
    setMobileExpandedCat(null);
  };

  const getNavWrapperClasses = () => {
    // Mobile: floating pill at top-4; Desktop: full-width frosted bar at top-0
    return "fixed z-50 top-4 left-1/2 -translate-x-1/2 w-[95%] max-w-6xl lg:top-0 lg:left-0 lg:right-0 lg:translate-x-0 lg:w-full lg:max-w-none";
  };

  const getNavBarClasses = () => {
    switch (settings.style) {
      case "classic":
        return "bg-card/75 backdrop-blur-md shadow-sm px-4 sm:px-6 lg:px-8 py-2.5 lg:py-3";
      case "transparent":
        return "bg-card/60 backdrop-blur-md border-b border-border/40 px-4 sm:px-6 lg:px-8 py-2.5 lg:py-3";
      case "minimal":
        return "bg-transparent backdrop-blur-sm border-b border-border/40 px-4 sm:px-6 lg:px-8 py-2.5 lg:py-3";
      case "pill":
      default:
        return "bg-card/80 backdrop-blur-md border border-border/60 px-4 sm:px-6 lg:px-8 py-2.5 lg:py-3 rounded-full shadow-sm";
    }
  };

  const getActiveClasses = () => {
    switch (settings.style) {
      case "classic":
        return "border-b-2 border-primary text-foreground font-medium px-4 py-1.5";
      case "transparent":
        return "bg-white/10 text-foreground font-medium rounded-md px-4 py-1.5";
      case "minimal":
        return "text-primary font-medium border-b-2 border-primary px-4 py-1.5";
      case "pill":
      default:
        return "bg-secondary text-secondary-foreground font-medium rounded-full px-5 py-2 text-base";
    }
  };

  const getInactiveClasses = () => {
    switch (settings.style) {
      case "classic":
        return "text-foreground/75 hover:text-foreground px-4 py-1.5 border-b-2 border-transparent";
      case "transparent":
        return "text-foreground/75 hover:text-foreground hover:bg-white/5 rounded-md px-4 py-1.5";
      case "minimal":
        return "text-foreground/75 hover:text-foreground px-4 py-1.5 border-b-2 border-transparent";
      case "pill":
      default:
        return "text-foreground/75 hover:text-foreground hover:bg-muted rounded-full px-5 py-2 text-base";
    }
  };

  const getMobileMenuClasses = () => {
    switch (settings.style) {
      case "classic":
      case "minimal":
        return "bg-card/80 backdrop-blur-md border border-border/50 rounded-lg p-5 shadow-lg";
      case "transparent":
        return "bg-card/75 backdrop-blur-md border border-border/50 rounded-lg p-5 shadow-lg";
      case "pill":
      default:
        return "bg-card/80 backdrop-blur-md border border-border/50 rounded-2xl p-5 shadow-lg";
    }
  };

  const getShopMenuClasses = () => {
    switch (settings.style) {
      case "classic":
      case "minimal":
        return "rounded-xl";
      case "transparent":
        return "rounded-xl";
      case "pill":
      default:
        return "rounded-2xl";
    }
  };

  const iceStyle: React.CSSProperties = {
    background: "rgba(252, 252, 253, 0.96)",
    backdropFilter: "blur(32px) brightness(1.04)",
    WebkitBackdropFilter: "blur(32px) brightness(1.04)",
    border: "1px solid rgba(255,255,255,0.90)",
    boxShadow: "0 8px 28px rgba(0,0,0,0.08), inset 0 1.5px 0 rgba(255,255,255,1)",
  };

  const isShopActive = location.startsWith("/products") || categoryEntries.some(([slug]) => location.startsWith(`/${slug}`));

  return (
    <>
    <nav className={`${getNavWrapperClasses()} transition-transform duration-300 ease-in-out ${isNavHidden ? 'navbar-hidden-mobile' : ''} ${isSearchOpen ? 'invisible' : ''} ${partnerBanner.rendered ? 'lg:border-b lg:border-black/15' : ''}`}>
      <div className={`${getNavBarClasses()} lg:bg-background/80 lg:backdrop-blur-md ${partnerBanner.rendered ? 'lg:!border-0' : 'lg:border-b lg:border-border/20'} lg:shadow-none lg:px-8 lg:py-0 lg:rounded-none`}>

        {/* ── Mobile layout ─────────────────────────── */}
        <div className="flex lg:hidden items-center justify-between h-10">
          <div className="flex items-center">
            {settings.showBackButton && !isHome && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => window.history.back()}
                className="w-8 h-8 rounded-full text-foreground mr-1"
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <Link href="/" className="flex-shrink-0 cursor-pointer" data-testid="link-navbar-logo">
              <img src="/images/boomerangs-logo.webp" alt="Booomerangs" className="h-20 w-auto object-contain" fetchpriority="high" width={80} height={80} />
            </Link>
          </div>
          <div className="flex items-center space-x-1">
            {isHome && <RuStoreButton variant="mobile" />}
            {settings.showSearch && (
              <button onClick={() => { setSearchEverOpened(true); setIsSearchOpen(true); }} className="p-1.5 hover:bg-muted rounded-full transition-colors" aria-label="Поиск">
                <Search className="w-5 h-5 text-foreground" />
              </button>
            )}
            {!isConceptPage && (
              <Link href="/favorites" className="relative p-1.5 hover:bg-muted rounded-full transition-colors" aria-label="Избранное">
                <Heart className={`w-5 h-5 ${favoritesCount > 0 ? 'fill-foreground text-foreground' : 'text-foreground'}`} />
                {favoritesCount > 0 && (
                  <span className="absolute top-0 right-0 bg-primary text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{favoritesCount}</span>
                )}
              </Link>
            )}
            {preorderCount > 0 && (
              <Link href="/predrop/checkout" className="relative p-1.5 hover:bg-muted rounded-full transition-colors" aria-label="Корзина предзаказов">
                <PackageOpen className="w-5 h-5 text-foreground" />
                <span className="absolute top-0 right-0 bg-primary text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{preorderCount}</span>
              </Link>
            )}
            {settings.showCart && (
              <Link href="/cart" className="relative p-1.5 hover:bg-muted rounded-full transition-colors" aria-label="Корзина">
                <ShoppingBag className="w-5 h-5 text-foreground" />
                {cartCount > 0 && (
                  <span className="absolute top-0 right-0 bg-primary text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{cartCount}</span>
                )}
              </Link>
            )}
            {settings.showUser && user && (
              <Link
                href={profileHref}
                className="p-1.5 hover:bg-muted rounded-full transition-colors"
                aria-label="Личный кабинет"
                data-testid="link-mobile-profile"
              >
                <User className="w-5 h-5 text-foreground" />
              </Link>
            )}
            {settings.showUser && !user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-login" className="text-xs px-3 flex items-center gap-1">
                    Войти <ChevronDown className="w-3 h-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 bg-card/95 backdrop-blur-2xl border border-border/50 shadow-xl rounded-2xl overflow-hidden p-1.5">
                  <DropdownMenuItem onClick={() => { setAuthEverOpened(true); setIsAuthOpen(true); }} className="cursor-pointer flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors">
                    <User className="w-4 h-4 shrink-0 text-foreground/50" />
                    <div>
                      <p className="font-medium leading-tight">Покупателям</p>
                      <p className="text-[11px] text-foreground/50 leading-tight mt-0.5">Личный кабинет</p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/wholesale/register" className="cursor-pointer flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors">
                      <Briefcase className="w-4 h-4 shrink-0 text-foreground/50" />
                      <div>
                        <p className="font-medium leading-tight">Оптовым партнёрам</p>
                        <p className="text-[11px] text-foreground/50 leading-tight mt-0.5">Оптовый кабинет</p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/partner/register" className="cursor-pointer flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors">
                      <TrendingUp className="w-4 h-4 shrink-0 text-foreground/50" />
                      <div>
                        <p className="font-medium leading-tight">Партнёрская программа</p>
                        <p className="text-[11px] text-foreground/50 leading-tight mt-0.5">Зарабатывай с нами</p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/merch-na-zakaz" className="cursor-pointer flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors">
                      <Shirt className="w-4 h-4 shrink-0 text-foreground/50" />
                      <div>
                        <p className="font-medium leading-tight">Мерч на заказ</p>
                        <p className="text-[11px] text-foreground/50 leading-tight mt-0.5">Производство под ключ</p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button className="text-foreground hover:text-primary p-2" onClick={() => setIsOpen(!isOpen)} aria-label={isOpen ? "Закрыть меню" : "Открыть меню"}>
              {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* ── Desktop layout (3-column frosted bar) ── */}
        <div className="hidden lg:flex items-center justify-between h-12">

          {/* Left: back + logo + brand text */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {settings.showBackButton && !isHome && (
              <button
                onClick={() => window.history.back()}
                className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-foreground hover:bg-muted transition-colors flex-shrink-0"
                data-testid="button-back-desktop"
                aria-label="Назад"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <Link href="/" className="flex-shrink-0 cursor-pointer flex items-center gap-2.5" data-testid="link-navbar-logo">
              <img src="/images/boomerangs-logo.webp" alt="Booomerangs" className="h-[76px] w-auto object-contain" fetchpriority="high" width={76} height={76} />
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "2px" }}>
                <span
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 800,
                    fontSize: "17px",
                    letterSpacing: "0.03em",
                    whiteSpace: "nowrap",
                    lineHeight: 1,
                  }}
                >
                  BOOOMERANGS
                </span>
                <span
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 600,
                    fontSize: "10px",
                    letterSpacing: "-0.02em",
                    whiteSpace: "nowrap",
                    lineHeight: 1,
                  }}
                >
                  Делаем{"\u2004"}вещи
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    letterSpacing: "0.04em",
                    whiteSpace: "nowrap",
                    lineHeight: 1,
                  }}
                >
                  которые носим сами
                </span>
              </div>
            </Link>
          </div>

          {/* Center: nav links */}
          <div className="flex items-center gap-1">
            {visibleLinks.map((link) => {
              const isShopLink = link.href === "/products";
              if (isShopLink) {
                return (
                  <div
                    key={link.href}
                    className="relative"
                    ref={shopMenuRef}
                  >
                    <button
                      onClick={() => {
                        setIsShopMenuOpen(prev => !prev);
                        if (!isShopMenuOpen) setHoveredCat(categoryEntries[0]?.[0] || null);
                      }}
                      data-testid="button-shop-menu"
                      className={`whitespace-nowrap transition-all duration-300 flex items-center gap-1 ${
                        isShopActive ? getActiveClasses() : getInactiveClasses()
                      }`}
                    >
                      {link.label}
                      <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isShopMenuOpen ? "rotate-180" : ""}`} />
                    </button>

                    {/* Desktop two-panel mega-menu */}
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: "50%",
                        paddingTop: "8px",
                        display: "flex",
                        gap: "8px",
                        opacity: isShopMenuOpen ? 1 : 0,
                        pointerEvents: isShopMenuOpen ? "auto" : "none",
                        transform: isShopMenuOpen ? "translateX(-50%) translateY(0px)" : "translateX(-50%) translateY(-6px)",
                        transition: "opacity 0.18s ease, transform 0.18s ease",
                        zIndex: 60,
                      }}
                    >
                      <div className={`${getShopMenuClasses()} py-2 min-w-[160px]`} style={iceStyle}>
                        <Link href="/products" onClick={closeAll} data-testid="link-shop-all" className="flex items-center justify-between w-full px-4 py-2 text-sm text-slate-500 hover:text-slate-800 hover:bg-white/60 rounded-lg transition-colors">
                          Все товары
                        </Link>
                        <div className="my-1 mx-3 border-t border-blue-100/70" />
                        {categoryEntries.map(([slug, cat]) => (
                          <button
                            key={slug}
                            onMouseEnter={() => { if (!isTouchDevice.current) setHoveredCat(slug); }}
                            onClick={() => {
                              if (isTouchDevice.current) {
                                if (hoveredCat === slug) { navigate(`/products/${slug}`); closeAll(); }
                                else { setHoveredCat(slug); }
                              } else {
                                navigate(`/products/${slug}`); closeAll();
                              }
                            }}
                            data-testid={`button-category-${slug}`}
                            className={`flex items-center justify-between w-full px-4 py-2 text-sm rounded-lg transition-colors ${hoveredCat === slug ? "bg-white/70 text-slate-900 font-medium" : "text-slate-700 hover:bg-white/55 hover:text-slate-900"}`}
                          >
                            {cat.name}
                            {cat.subcategories.length > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                          </button>
                        ))}
                      </div>
                      <div
                        className={`${getShopMenuClasses()} py-2 min-w-[160px]`}
                        style={{
                          ...iceStyle,
                          opacity: hoveredCat ? 1 : 0,
                          pointerEvents: hoveredCat ? "auto" : "none",
                          transform: hoveredCat ? "translateX(0)" : "translateX(-6px)",
                          transition: "opacity 0.15s ease, transform 0.15s ease",
                        }}
                      >
                        {hoveredCat && categories[hoveredCat] && (
                          <>
                            <Link href={`/products/${hoveredCat}`} onClick={closeAll} className="flex items-center justify-between w-full px-4 py-2 text-sm text-slate-400 hover:text-slate-800 hover:bg-white/60 rounded-lg transition-colors">
                              Все {categories[hoveredCat].name}
                            </Link>
                            <div className="my-1 mx-3 border-t border-slate-100" />
                            {categories[hoveredCat].subcategories.map((sub) => (
                              <Link key={sub.slug} href={`/${sub.slug}`} onClick={closeAll} data-testid={`link-subcategory-${sub.slug}`} className="block px-4 py-2 text-sm text-slate-700 hover:text-slate-900 hover:bg-white/60 rounded-lg transition-colors">
                                {sub.name}
                              </Link>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`whitespace-nowrap transition-all duration-300 ${location === link.href ? getActiveClasses() : getInactiveClasses()}`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Right: icons + войти */}
          <div className="flex items-center gap-0.5 justify-end flex-shrink-0">
            <div className="mr-1">
              <RuStoreButton variant="desktop" />
            </div>
            <button
              onClick={() => setIsMusicDrawerOpen(true)}
              className="p-1.5 hover:bg-muted rounded-full transition-colors group relative"
              data-testid="button-music-drawer"
              aria-label="Музыка"
            >
              <Headphones className="w-5 h-5 text-foreground group-hover:text-primary transition-colors" />
              {currentTrack && (
                <span
                  className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full"
                  style={{ background: "hsl(var(--primary))", boxShadow: "0 0 6px hsl(var(--primary))" }}
                />
              )}
            </button>
            {settings.showSearch && (
              <button onClick={() => { setSearchEverOpened(true); setIsSearchOpen(true); }} className="p-1.5 hover:bg-muted rounded-full transition-colors group" data-testid="button-search" aria-label="Поиск">
                <Search className="w-5 h-5 text-foreground group-hover:text-primary transition-colors" />
              </button>
            )}
            {settings.showUser && (
              <>
                {user ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-2 hover:bg-muted rounded-full transition-colors group" data-testid="button-user-menu" aria-label="Профиль">
                        <User className="w-6 h-6 text-foreground group-hover:text-primary transition-colors" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 bg-card/85 backdrop-blur-2xl border border-border/50 shadow-xl rounded-2xl overflow-hidden p-0">
                      <div className="px-4 py-4 border-b border-border/40">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-foreground/8 border border-border/50 flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-semibold text-foreground uppercase">
                              {user.name?.[0] || "?"}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground leading-tight">{user.name}</p>
                            <p className="text-[10px] text-foreground/60 truncate mt-0.5">{user.email}</p>
                          </div>
                        </div>
                      </div>
                      <div className="py-1.5 px-1.5">
                        <DropdownMenuItem asChild>
                          <Link href={profileHref} className="cursor-pointer flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors">
                            <User className="w-4 h-4 text-foreground/60" />
                            {isPartner ? "Кабинет партнёра" : "Личный кабинет"}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href="/favorites" className="cursor-pointer flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors">
                            <Heart className="w-4 h-4 text-foreground/60" />
                            Избранное
                            {favoritesCount > 0 && <span className="ml-auto text-[11px] font-semibold text-foreground/60">{favoritesCount}</span>}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href="/cart" className="cursor-pointer flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors">
                            <ShoppingBag className="w-4 h-4 text-foreground/60" />
                            Корзина
                            {cartCount > 0 && <span className="ml-auto text-[11px] font-semibold text-foreground/60">{cartCount}</span>}
                          </Link>
                        </DropdownMenuItem>
                      </div>
                      <div className="border-t border-border/40 py-1.5 px-1.5">
                        <DropdownMenuItem onClick={() => logout.mutate()} className="cursor-pointer flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/8 transition-colors">
                          <LogOut className="w-4 h-4" />Выйти
                        </DropdownMenuItem>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </>
            )}
            {!isConceptPage && (
              <Link href="/favorites" className="relative cursor-pointer group p-2 hover:bg-muted rounded-full transition-colors" data-testid="link-favorites" aria-label="Избранное">
                <Heart className={`w-6 h-6 transition-colors ${favoritesCount > 0 ? 'fill-foreground text-foreground' : 'text-foreground group-hover:text-primary'}`} />
                {favoritesCount > 0 && (
                  <span className="absolute top-0 right-0 bg-primary text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{favoritesCount}</span>
                )}
              </Link>
            )}
            {preorderCount > 0 && (
              <Link href="/predrop/checkout" className="relative cursor-pointer group p-2 hover:bg-muted rounded-full transition-colors" aria-label="Корзина предзаказов">
                <PackageOpen className="w-6 h-6 text-foreground group-hover:text-primary transition-colors" />
                <span className="absolute top-0 right-0 bg-primary text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{preorderCount}</span>
              </Link>
            )}
            {settings.showCart && (
              <Link href="/cart" className="relative cursor-pointer group p-2 hover:bg-muted rounded-full transition-colors" aria-label="Корзина">
                <ShoppingBag className="w-6 h-6 text-foreground group-hover:text-primary transition-colors" />
                {cartCount > 0 && (
                  <span className="absolute top-0 right-0 bg-primary text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{cartCount}</span>
                )}
              </Link>
            )}
            {settings.showUser && !user && (
              <DropdownMenu open={isLoginDropdownOpen} onOpenChange={setIsLoginDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    className="ml-2 px-5 py-2 rounded-full border border-border text-base font-medium text-foreground hover:bg-muted transition-colors flex-shrink-0 flex items-center gap-1.5"
                    data-testid="button-login-desktop"
                  >
                    Войти
                    <ChevronDown className={`w-4 h-4 opacity-60 transition-transform duration-200 ${isLoginDropdownOpen ? "rotate-180" : ""}`} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-60 bg-card/95 backdrop-blur-2xl border border-border/50 shadow-xl rounded-2xl overflow-hidden p-1.5"
                >
                  <DropdownMenuItem
                    onClick={() => { setIsLoginDropdownOpen(false); setAuthEverOpened(true); setIsAuthOpen(true); }}
                    className="cursor-pointer flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-foreground/8 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-foreground/60" />
                    </div>
                    <div>
                      <p className="font-semibold leading-tight text-foreground">Покупателям</p>
                      <p className="text-[11px] text-foreground/50 leading-tight mt-0.5">Личный кабинет и заказы</p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      href="/wholesale/register"
                      onClick={() => setIsLoginDropdownOpen(false)}
                      className="cursor-pointer flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-foreground/8 flex items-center justify-center shrink-0">
                        <Briefcase className="w-4 h-4 text-foreground/60" />
                      </div>
                      <div>
                        <p className="font-semibold leading-tight text-foreground">Оптовым партнёрам</p>
                        <p className="text-[11px] text-foreground/50 leading-tight mt-0.5">Оптовый кабинет и цены</p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      href="/partner/register"
                      onClick={() => setIsLoginDropdownOpen(false)}
                      className="cursor-pointer flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-foreground/8 flex items-center justify-center shrink-0">
                        <TrendingUp className="w-4 h-4 text-foreground/60" />
                      </div>
                      <div>
                        <p className="font-semibold leading-tight text-foreground">Партнёрская программа</p>
                        <p className="text-[11px] text-foreground/50 leading-tight mt-0.5">Зарабатывай с нами</p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      href="/merch-na-zakaz"
                      onClick={() => setIsLoginDropdownOpen(false)}
                      className="cursor-pointer flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-foreground/8 flex items-center justify-center shrink-0">
                        <Shirt className="w-4 h-4 text-foreground/60" />
                      </div>
                      <div>
                        <p className="font-semibold leading-tight text-foreground">Мерч на заказ</p>
                        <p className="text-[11px] text-foreground/50 leading-tight mt-0.5">Производство под ключ</p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

        </div>

        <PartnerBannerContent {...partnerBanner} />
      </div>

      {/* Mobile menu */}
      <div
        className="lg:hidden absolute top-full left-0 w-full mt-2"
        aria-hidden={!isOpen}
        ref={mobileMenuRef}
        style={{
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? "scale(1) translateY(10px)" : "scale(0.95) translateY(-10px)",
          transition: "opacity 0.2s ease-out, transform 0.2s ease-out",
          pointerEvents: isOpen ? "auto" : "none",
          visibility: isOpen ? "visible" : "hidden",
        }}
      >
        <div className={getMobileMenuClasses()}>
          <div className="space-y-3">
            {visibleLinks.map((link) => {
              const isShopLink = link.href === "/products";
              if (isShopLink) {
                return (
                  <div key={link.href}>
                    <button
                      onClick={() => setMobileShopOpen((v) => !v)}
                      data-testid="button-mobile-shop-menu"
                      className={`flex items-center justify-between w-full text-xl font-medium transition-all ${isShopActive ? 'text-primary' : 'text-foreground/75'}`}
                    >
                      {link.label}
                      <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${mobileShopOpen ? "rotate-180" : ""}`} />
                    </button>

                    {/* Mobile category accordion */}
                    <div
                      style={{
                        maxHeight: mobileShopOpen ? "1400px" : "0px",
                        overflow: "hidden",
                        transition: "max-height 0.35s ease",
                      }}
                    >
                      <div className="pt-3 pl-2 space-y-2">
                        <Link
                          href="/products"
                          onClick={closeAll}
                          className="block text-sm text-muted-foreground hover:text-foreground transition-colors py-1 border-b border-border pb-2 mb-1"
                        >
                          Все товары
                        </Link>
                        {categoryEntries.map(([slug, cat]) => (
                          <div key={slug}>
                            <button
                              onClick={() => setMobileExpandedCat(mobileExpandedCat === slug ? null : slug)}
                              className="flex items-center justify-between w-full text-sm font-semibold text-foreground hover:text-primary transition-colors py-1"
                              data-testid={`button-mobile-cat-${slug}`}
                            >
                              {cat.name}
                              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${mobileExpandedCat === slug ? "rotate-180" : ""}`} />
                            </button>
                            <div
                              style={{
                                maxHeight: mobileExpandedCat === slug ? "400px" : "0px",
                                overflow: "hidden",
                                transition: "max-height 0.25s ease",
                              }}
                            >
                              <div className="pl-3 pt-1 pb-2 space-y-1">
                                <Link
                                  href={`/products/${slug}`}
                                  onClick={closeAll}
                                  className="block text-sm text-muted-foreground hover:text-foreground transition-colors py-0.5"
                                >
                                  Все {cat.name}
                                </Link>
                                {cat.subcategories.map((sub) => (
                                  <Link
                                    key={sub.slug}
                                    href={`/${sub.slug}`}
                                    onClick={closeAll}
                                    data-testid={`link-mobile-subcategory-${sub.slug}`}
                                    className="block text-sm text-muted-foreground hover:text-foreground transition-colors py-0.5"
                                  >
                                    {sub.name}
                                  </Link>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className={`block text-xl font-medium hover:text-primary transition-all ${location === link.href ? 'text-primary' : 'text-muted-foreground'}`}
                >
                  {link.label}
                </Link>
              );
            })}

            {/* Mobile music accordion */}
            <div className="border-t border-border pt-3 mt-1">
              <button
                onClick={() => setIsMobileTracksOpen(v => !v)}
                data-testid="button-mobile-music-menu"
                className="flex items-center justify-between w-full text-xl font-medium text-muted-foreground hover:text-primary transition-all"
              >
                <span className="flex items-center gap-2">
                  <Music className="w-5 h-5" />
                  Музыка
                  {currentTrack && (
                    <span
                      className="w-2 h-2 rounded-full inline-block"
                      style={{ background: "hsl(var(--primary))", boxShadow: "0 0 5px hsl(var(--primary))" }}
                    />
                  )}
                </span>
                <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${isMobileTracksOpen ? "rotate-180" : ""}`} />
              </button>
              <div
                style={{
                  maxHeight: isMobileTracksOpen ? "280px" : "0px",
                  overflow: "hidden",
                  transition: "max-height 0.3s ease",
                }}
              >
                <MobileMusicList onClose={() => setIsOpen(false)} />
              </div>
            </div>

            {settings.showUser && user && (
              <>
                <div className="border-t border-border pt-3 mt-1">
                  <Link
                    href={profileHref}
                    onClick={closeAll}
                    data-testid="link-mobile-menu-profile"
                    className={`flex items-center gap-2 text-xl font-medium hover:text-primary transition-all ${location === profileHref ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    <User className="w-5 h-5" />
                    Личный кабинет
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <MusicDrawer open={isMusicDrawerOpen} onClose={() => setIsMusicDrawerOpen(false)} />

      {authEverOpened && (
        <Suspense fallback={null}>
          <AuthModal open={isAuthOpen} onOpenChange={setIsAuthOpen} />
        </Suspense>
      )}
    </nav>
    {searchEverOpened && (
      <Suspense fallback={null}>
        <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      </Suspense>
    )}
    </>
  );
}
