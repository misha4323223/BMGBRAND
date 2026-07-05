import SEO from "@/components/SEO";
import { usePaginatedProducts, ProductFilters } from "@/hooks/use-products";
import { ProductCard } from "@/components/ProductCard";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useMemo, useState, useEffect, useCallback, useRef, startTransition } from "react";
import { useWholesalePrice } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { CATEGORIES, CategorySlug, normalizeCategories } from "@shared/schema";
import type { CategoryConfig, SubcategoryConfig } from "@shared/schema";
import { useRoute, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { Loader2, X, ChevronDown, ChevronRight, PanelLeft, PanelLeftClose, ArrowRight, Heart, ShoppingBag, ArrowLeft, BrainCog, MessageCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCart } from "@/hooks/use-cart";
import { useFavorites } from "@/hooks/use-favorites";

/* ─── MERCH COSMIC NAVBAR ────────────────────────────────────────────────── */
const MERCH_NAV_LINKS = [
  { label: "Главная",        href: "/" },
  { label: "Каталог",        href: "/products" },
  { label: "Коллаборации",   href: "/products/merch" },
  { label: "Предзаказ",      href: "/predrop" },
  { label: "О нас",          href: "/about" },
];

function MerchNavbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: cartItems } = useCart();
  const cartCount = cartItems?.reduce((acc: number, item: any) => acc + item.quantity, 0) || 0;
  const { favoritesCount } = useFavorites();

  // Signal ChatWidget to hide its floating button while this nav is mounted
  useEffect(() => {
    document.documentElement.setAttribute("data-merch-nav", "1");
    return () => document.documentElement.removeAttribute("data-merch-nav");
  }, []);

  // Lock body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const openAI = () => { setMenuOpen(false); window.dispatchEvent(new CustomEvent("open-booom-ai")); };
  const openManager = () => { setMenuOpen(false); window.dispatchEvent(new CustomEvent("open-booom-manager")); };

  return (
    <>
      {/* ── Slim fixed bar ─────────────────────────────────────────────── */}
      <nav
        className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-3 sm:px-5 h-14"
        style={{ background: "rgba(5,5,5,0.88)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Left: back + logo */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => window.history.back()}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Назад"
          >
            <ArrowLeft className="w-4 h-4 text-white/50" />
          </button>
          <Link href="/" className="flex-shrink-0">
            <img src="/images/boomerangs-logo.webp" alt="Booomerangs" className="h-[52px] w-auto object-contain" />
          </Link>
        </div>

        {/* Right: icons + signal burger */}
        <div className="flex items-center gap-0.5">
          <Link href="/favorites" className="relative p-2 rounded-full hover:bg-white/10 transition-colors" aria-label="Избранное">
            <Heart className="text-white/65" style={{ width: 18, height: 18 }} />
            {favoritesCount > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-white text-black text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
                {favoritesCount > 9 ? "9+" : favoritesCount}
              </span>
            )}
          </Link>
          <Link href="/cart" className="relative p-2 rounded-full hover:bg-white/10 transition-colors" aria-label="Корзина">
            <ShoppingBag className="text-white/65" style={{ width: 18, height: 18 }} />
            {cartCount > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-white text-black text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
                {cartCount > 9 ? "9+" : cartCount}
              </span>
            )}
          </Link>

          {/* Signal burger — EQ bars */}
          <button
            onClick={() => setMenuOpen(true)}
            className="ml-1 p-2 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Открыть меню"
            aria-expanded={menuOpen}
            aria-controls="merch-menu-panel"
          >
            <div className="flex items-end gap-[3px]" style={{ height: 20, width: 18 }}>
              <div className={`w-[4px] rounded-[2px] bg-white/80 ${menuOpen ? "" : "merch-eq-bar-1"}`} style={{ height: menuOpen ? "100%" : undefined }} />
              <div className={`w-[4px] rounded-[2px] bg-white/80 ${menuOpen ? "" : "merch-eq-bar-2"}`} style={{ height: menuOpen ? "100%" : undefined }} />
              <div className={`w-[4px] rounded-[2px] bg-white/80 ${menuOpen ? "" : "merch-eq-bar-3"}`} style={{ height: menuOpen ? "100%" : undefined }} />
            </div>
          </button>
        </div>
      </nav>

      {/* ── Full-screen cosmic panel ────────────────────────────────────── */}
      <AnimatePresence>
        {menuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="merch-menu-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="fixed inset-0 z-[149] bg-black/60"
              onClick={() => setMenuOpen(false)}
            />

            {/* Panel — slides from right */}
            <motion.div
              key="merch-menu-panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
              className="fixed inset-y-0 right-0 z-[150] flex flex-col overflow-hidden"
              style={{ width: "min(100vw, 440px)", background: "#040404" }}
            >
              {/* Scan-line texture */}
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.011) 3px, rgba(255,255,255,0.011) 4px)",
              }} />
              {/* Grid */}
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)",
                backgroundSize: "44px 44px",
              }} />
              {/* Ambient glow top-right */}
              <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full pointer-events-none" style={{
                background: "radial-gradient(circle, rgba(255,255,255,0.025) 0%, transparent 70%)",
              }} />

              {/* Top bar */}
              <div className="relative z-10 flex items-center justify-between px-5 h-14 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <Link href="/" onClick={() => setMenuOpen(false)} className="flex-shrink-0">
                  <img src="/images/boomerangs-logo.webp" alt="Booomerangs" className="h-[50px] w-auto" />
                </Link>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  aria-label="Закрыть"
                >
                  <X className="w-5 h-5 text-white/50" />
                </button>
              </div>

              {/* Nav links — staggered */}
              <div className="relative z-10 flex-1 flex flex-col justify-center px-5 py-6 min-h-0 overflow-y-auto">
                {MERCH_NAV_LINKS.map(({ label, href }, i) => (
                  <motion.div
                    key={href}
                    initial={{ x: 36, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 36, opacity: 0 }}
                    transition={{ duration: 0.38, delay: 0.08 + i * 0.065, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <Link
                      href={href}
                      onClick={() => setMenuOpen(false)}
                      className="group flex items-center justify-between py-3"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                    >
                      <span
                        className="font-black text-white/80 group-hover:text-white transition-colors leading-none tracking-tight"
                        style={{ fontSize: "clamp(1.65rem, 7vw, 2.6rem)" }}
                      >
                        {label}
                      </span>
                      <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/55 flex-shrink-0 transition-all group-hover:translate-x-1" />
                    </Link>
                  </motion.div>
                ))}
              </div>

              {/* Chat section */}
              <div className="relative z-10 px-5 pb-7 pt-4 flex-shrink-0">
                <motion.div
                  initial={{ y: 18, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.38, delay: 0.48 }}
                >
                  <p className="text-[9px] font-bold tracking-[0.38em] uppercase mb-3" style={{ color: "rgba(255,255,255,0.22)" }}>
                    — Связь
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={openAI}
                      className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all"
                      style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.72)", background: "transparent" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                    >
                      <BrainCog className="w-3.5 h-3.5 opacity-60" />
                      BOOOM AI
                    </button>
                    <button
                      onClick={openManager}
                      className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all"
                      style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.72)", background: "transparent" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                    >
                      <MessageCircle className="w-3.5 h-3.5 opacity-60" />
                      МЕНЕДЖЕР
                    </button>
                  </div>
                </motion.div>

                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.6 }}
                  className="mt-5 text-center text-[8px] font-bold tracking-[0.36em] uppercase"
                  style={{ color: "rgba(255,255,255,0.12)" }}
                >
                  BOOOMERANGS × ARTIST COLLABS
                </motion.p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function JDMBanner() {
  return (
    <div className="relative w-full overflow-hidden rounded-lg mb-8">
      <div className="absolute inset-0 bg-gradient-to-r from-black via-red-900 to-black" />
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage: `repeating-linear-gradient(
          45deg,
          transparent,
          transparent 10px,
          rgba(255,255,255,0.03) 10px,
          rgba(255,255,255,0.03) 20px
        )`
      }} />
      <div className="absolute top-2 left-4 text-white/10 text-6xl sm:text-8xl font-black select-none">
        走
      </div>
      <div className="absolute bottom-2 right-4 text-white/10 text-6xl sm:text-8xl font-black select-none">
        族
      </div>
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 via-white to-red-500" />
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 via-white to-red-500" />
      
      <div className="relative z-10 py-8 sm:py-12 px-6 sm:px-10 flex flex-col items-center justify-center text-center">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-red-500 text-2xl">日</span>
          <h2 className="text-3xl sm:text-5xl font-black text-white tracking-wider">
            JDM
          </h2>
          <span className="text-red-500 text-2xl">本</span>
        </div>
        <p className="text-white/70 text-sm sm:text-base tracking-widest uppercase">
          Коллекция Японского Автоспорта
        </p>
        <div className="mt-4 flex gap-2">
          <span className="px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded">DRIFT</span>
          <span className="px-2 py-0.5 bg-white text-black text-xs font-bold rounded">RACING</span>
          <span className="px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded">STREET</span>
        </div>
      </div>
    </div>
  );
}

function JDMPageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black relative">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-20 left-10 text-red-500/5 text-[200px] font-black select-none rotate-12">
          改
        </div>
        <div className="absolute bottom-20 right-10 text-white/5 text-[150px] font-black select-none -rotate-12">
          速
        </div>
        <div className="absolute top-1/2 left-1/4 text-red-500/3 text-[100px] font-black select-none">
          夜
        </div>
      </div>
      <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-red-600 via-red-500 to-red-600 pointer-events-none" />
      <div className="absolute top-0 right-0 w-2 h-full bg-gradient-to-b from-red-600 via-red-500 to-red-600 pointer-events-none" />
      <div>
        {children}
      </div>
    </div>
  );
}

function MintaBanner() {
  return (
    <div className="relative w-full overflow-hidden rounded-lg mb-8" style={{ background: '#5f5f5f' }}>
      {/* Top/bottom accent lines */}
      <div className="absolute top-0 left-0 w-full h-[3px]" style={{ background: '#ffa000' }} />
      <div className="absolute bottom-0 left-0 w-full h-[3px]" style={{ background: '#ffa000' }} />

      <div className="relative z-10 py-8 sm:py-10 px-6 sm:px-10 flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-10">
        {/* Logo */}
        <img
          src="/dikaya-myata-logo.png"
          alt="Дикая Мята"
          className="h-16 sm:h-20 object-contain flex-shrink-0"
        />
        {/* Text block */}
        <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
          <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap justify-center sm:justify-start">
            <span className="text-xl sm:text-3xl font-black tracking-wider uppercase" style={{ color: '#ffffff' }}>BOOOMERANGS</span>
            <span className="text-xl sm:text-3xl font-black" style={{ color: '#ffa000' }}>×</span>
            <span className="text-xl sm:text-3xl font-black tracking-wider uppercase" style={{ color: '#ffa000' }}>ДИКАЯ МЯТА</span>
          </div>
          <p className="text-xs sm:text-sm tracking-widest uppercase mt-1" style={{ color: '#ffffff', opacity: 0.5 }}>
            Коллаборация с Фестивалем
          </p>
          <div className="mt-3 flex gap-2">
            <span className="px-3 py-1 text-xs font-bold rounded-sm uppercase tracking-wide" style={{ background: '#ffa000', color: '#2e2e2e' }}>МУЗЫКА</span>
            <span className="px-3 py-1 text-xs font-bold rounded-sm uppercase tracking-wide" style={{ background: '#ffffff20', color: '#ffffff', border: '1px solid rgba(255,255,255,0.3)' }}>ПРИРОДА</span>
            <span className="px-3 py-1 text-xs font-bold rounded-sm uppercase tracking-wide" style={{ background: '#ffa000', color: '#2e2e2e' }}>СВОБОДА</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MintaPageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative" style={{ background: '#f7ece4' }}>
      {/* Floating decorative elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-20 left-10 text-[120px] font-black select-none rotate-12" style={{ color: '#ffa000', opacity: 0.04 }}>
          ★
        </div>
        <div className="absolute bottom-20 right-10 text-[100px] font-black select-none -rotate-12" style={{ color: '#2e2e2e', opacity: 0.04 }}>
          ♪
        </div>
        <div className="absolute top-1/3 right-1/4 text-[80px] font-black select-none" style={{ color: '#ffa000', opacity: 0.03 }}>
          ✦
        </div>
      </div>
      {/* Side accents */}
      <div className="absolute top-0 left-0 w-[3px] h-full pointer-events-none" style={{ background: '#ffa000' }} />
      <div className="absolute top-0 right-0 w-[3px] h-full pointer-events-none" style={{ background: '#ffa000' }} />
      <div>
        {children}
      </div>
    </div>
  );
}

function MerchBanner() {
  return (
    <div className="relative w-full overflow-hidden" style={{ minHeight: '72vh' }}>
      {/* Base bg */}
      <div className="absolute inset-0 bg-zinc-950" />
      {/* Grid pattern — brighter for better visibility */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />
      {/* Ambient radial glow — top-left accent */}
      <div className="absolute -top-20 -left-20 w-[50vw] h-[50vw] pointer-events-none" style={{
        background: 'radial-gradient(ellipse at top left, rgba(255,255,255,0.04) 0%, transparent 65%)',
      }} />
      {/* Giant watermark "МЕРЧ" in background */}
      <div className="absolute inset-0 flex items-center justify-end pr-4 sm:pr-12 select-none pointer-events-none overflow-hidden">
        <span
          className="font-black text-white leading-none"
          style={{ opacity: 0.055, fontSize: 'clamp(140px, 38vw, 480px)' }}
        >
          МЕРЧ
        </span>
      </div>
      {/* Bottom fade to page bg */}
      <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-zinc-950 to-transparent" />
      {/* Content */}
      <div className="relative z-10 px-4 sm:px-6 lg:px-12 pt-32 sm:pt-40 pb-10 max-w-7xl mx-auto">
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.13 } } }}
        >
          {/* Label */}
          <motion.div
            variants={{ hidden: { opacity: 0, x: -16 }, show: { opacity: 1, x: 0, transition: { duration: 0.5 } } }}
            className="flex items-center gap-3 mb-5"
          >
            <div className="w-6 h-px shrink-0" style={{ background: 'rgba(255,255,255,0.45)' }} />
            <span className="text-[10px] tracking-[0.4em] uppercase font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>
              BOOOMERANGS × ARTIST COLLABS
            </span>
          </motion.div>
          {/* Big title */}
          <div className="overflow-hidden mb-5">
            <motion.h2
              variants={{ hidden: { opacity: 0, y: 80 }, show: { opacity: 1, y: 0, transition: { duration: 0.85, ease: [0.16, 1, 0.3, 1] } } }}
              className="font-black text-white leading-none tracking-tighter"
              style={{ fontSize: 'clamp(4rem, 18vw, 13rem)' }}
            >
              МЕРЧ
            </motion.h2>
          </div>
          {/* Subtitle */}
          <motion.p
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } }}
            className="text-xs sm:text-sm tracking-[0.28em] uppercase font-medium"
            style={{ color: 'rgba(255,255,255,0.42)' }}
          >
            Официальные коллаборации с артистами
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}

function MerchPageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 relative">
      {/* Fixed decorative symbols */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-1/4 right-6 font-black select-none" style={{ fontSize: '200px', color: 'rgba(255,255,255,0.012)', lineHeight: 1 }}>◈</div>
        <div className="absolute bottom-1/4 left-4 font-black select-none" style={{ fontSize: '150px', color: 'rgba(255,255,255,0.01)', lineHeight: 1 }}>✦</div>
        <div className="absolute top-2/3 right-1/3 font-black select-none" style={{ fontSize: '90px', color: 'rgba(255,255,255,0.008)', lineHeight: 1 }}>◆</div>
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/* ─── Merch Marquee ─────────────────────────────────────────────── */
function MerchMarquee({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  const SEP = ' ★ ';
  const chunk = text + SEP;
  const items = Array(10).fill(chunk);
  return (
    <div className="overflow-hidden select-none relative z-10" style={{ background: bg }}>
      {/* border uses a wrapper so we can control opacity without rgba parsing */}
      <div style={{ borderTop: '1px solid currentColor', borderBottom: '1px solid currentColor', color: fg, opacity: 0.18 }} />
      <div className="merch-marquee-track flex whitespace-nowrap py-3 sm:py-4" style={{ width: 'max-content' }}>
        {[...items, ...items].map((item, i) => (
          <span
            key={i}
            className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.32em] px-4"
            style={{ color: fg, opacity: 0.85 }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Merch Collab Theme Config ─────────────────────────────────── */
interface MerchCollabConfig {
  bg: string;
  accent: string;
  accentFg: string;
  text: string;
  textMuted: string;
  decorSymbols?: Array<{ symbol: string; opacity: number; size: string; pos: string; rotate?: string }>;
  accentLines?: boolean;
  tagline?: string;
  artistSlug?: string;
}

const MERCH_COLLAB_THEMES: Record<string, MerchCollabConfig> = {
  gudtajms: {
    bg: '#080808',
    accent: '#e8e8e8',
    accentFg: '#080808',
    text: '#ffffff',
    textMuted: '#666666',
    decorSymbols: [
      { symbol: '◆', opacity: 0.03, size: '180px', pos: 'top-24 left-4', rotate: 'rotate-12' },
      { symbol: '◈', opacity: 0.025, size: '130px', pos: 'bottom-24 right-4', rotate: '-rotate-12' },
    ],
    tagline: 'Хип-хоп коллаборация',
    artistSlug: 'gudtajms',
  },
  dragni: {
    bg: '#070a1f',
    accent: '#7c83ff',
    accentFg: '#070a1f',
    text: '#dde2ff',
    textMuted: '#8088d0',
    decorSymbols: [
      { symbol: '◉', opacity: 0.04, size: '190px', pos: 'top-20 right-4', rotate: 'rotate-6' },
      { symbol: '✦', opacity: 0.03, size: '110px', pos: 'bottom-24 left-4', rotate: '-rotate-12' },
    ],
    accentLines: true,
    tagline: 'Совместная коллекция',
    artistSlug: 'dragni',
  },
  multfilmy: {
    bg: '#0d0d0d',
    accent: '#00e87a',
    accentFg: '#0d0d0d',
    text: '#ffffff',
    textMuted: '#555555',
    decorSymbols: [
      { symbol: '⬡', opacity: 0.04, size: '160px', pos: 'top-20 right-6', rotate: 'rotate-6' },
      { symbol: '⬡', opacity: 0.025, size: '100px', pos: 'bottom-20 left-4', rotate: '-rotate-12' },
    ],
    accentLines: true,
    tagline: 'Анимация × Стиль',
    artistSlug: 'multfilmy',
  },
  'tulskie-dizajnery': {
    bg: '#090909',
    accent: '#ff8c42',
    accentFg: '#090909',
    text: '#ffffff',
    textMuted: '#666666',
    decorSymbols: [
      { symbol: '✦', opacity: 0.035, size: '150px', pos: 'top-24 right-6', rotate: 'rotate-12' },
      { symbol: '◆', opacity: 0.025, size: '100px', pos: 'bottom-20 left-4', rotate: '-rotate-6' },
    ],
    tagline: 'Локальная коллаборация',
    artistSlug: 'tulskie-dizajnery',
  },
  formula: {
    bg: '#0a0a0a',
    accent: '#c8c8c8',
    accentFg: '#0a0a0a',
    text: '#ffffff',
    textMuted: '#666666',
    decorSymbols: [
      { symbol: '◆', opacity: 0.03, size: '160px', pos: 'top-24 right-6', rotate: 'rotate-12' },
    ],
    tagline: 'Коллаборация',
    artistSlug: 'formula',
  },
};

/* ─── Merch Collab Wrapper ──────────────────────────────────────── */
function MerchCollabWrapper({ theme, children }: { theme: MerchCollabConfig; children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative" style={{ background: theme.bg }}>
      {theme.decorSymbols && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          {theme.decorSymbols.map((d, i) => (
            <div
              key={i}
              className={`absolute ${d.pos} ${d.rotate || ''} font-black select-none`}
              style={{ fontSize: d.size, color: theme.accent, opacity: d.opacity, lineHeight: 1 }}
            >
              {d.symbol}
            </div>
          ))}
          {theme.accentLines && (
            <>
              <div className="absolute top-0 left-0 w-[2px] h-full" style={{ background: theme.accent, opacity: 0.35 }} />
              <div className="absolute top-0 right-0 w-[2px] h-full" style={{ background: theme.accent, opacity: 0.35 }} />
            </>
          )}
        </div>
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/* ─── Merch Collab Header ───────────────────────────────────────── */
function MerchCollabHeader({
  subName,
  theme,
  onNavigate,
}: {
  subName: string;
  theme: MerchCollabConfig;
  onNavigate: (path: string) => void;
}) {
  const artistHref = theme.artistSlug ? `/@${theme.artistSlug}` : null;
  return (
    <>
      {/* Hero banner */}
      <div className="relative overflow-hidden z-10" style={{ background: theme.bg, minHeight: '52vh' }}>
        {/* Grid pattern */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />
        {/* Bottom fade */}
        <div
          className="absolute inset-x-0 bottom-0 h-28"
          style={{ background: `linear-gradient(to bottom, transparent, ${theme.bg})` }}
        />
        {/* Content */}
        <div className="relative z-10 px-4 sm:px-6 lg:px-12 pt-32 sm:pt-40 pb-10 max-w-7xl mx-auto">
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }}
          >
            {/* Label */}
            <motion.div
              variants={{ hidden: { opacity: 0, x: -16 }, show: { opacity: 1, x: 0, transition: { duration: 0.5 } } }}
              className="flex items-center gap-2.5 mb-4"
            >
              <span className="w-5 shrink-0" style={{ height: '1.5px', background: theme.accent }} />
              <span className="text-[10px] font-bold uppercase tracking-[0.38em]" style={{ color: theme.accent }}>
                ОФИЦИАЛЬНАЯ КОЛЛАБОРАЦИЯ
              </span>
            </motion.div>
            {/* Title */}
            <div className="overflow-hidden mb-3">
              <motion.h1
                variants={{ hidden: { opacity: 0, y: 60 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } } }}
                className="font-black leading-none tracking-tight"
                style={{ color: theme.text, fontSize: 'clamp(2.4rem, 7.5vw, 5.5rem)' }}
              >
                <span className="block">{subName}</span>
                <span className="block" style={{ color: theme.accent }}>× BOOOMERANGS</span>
              </motion.h1>
            </div>
            {/* Tagline */}
            {theme.tagline && (
              <motion.p
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.45 } } }}
                className="text-xs sm:text-sm font-medium tracking-[0.22em] uppercase mb-7"
                style={{ color: theme.textMuted }}
              >
                {theme.tagline}
              </motion.p>
            )}
            {/* CTA */}
            {artistHref && (
              <motion.div
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.45 } } }}
              >
                <button
                  onClick={() => onNavigate(artistHref)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-[11px] font-bold uppercase tracking-[0.18em] transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: `${theme.accent}16`,
                    border: `1px solid ${theme.accent}40`,
                    color: theme.accent,
                  }}
                >
                  О коллаборации
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </motion.div>
        </div>
      </div>
      {/* Marquee */}
      <MerchMarquee
        text={`${subName} × BOOOMERANGS`}
        bg={theme.accent}
        fg={theme.accentFg}
      />
    </>
  );
}

interface ProductListProps {
  forcedCatSlug?: string;
  forcedSubName?: string;
  forcedSubSlug?: string;
}

export default function ProductList({ forcedCatSlug, forcedSubName, forcedSubSlug }: ProductListProps = {}) {
  const { isWholesale } = useWholesalePrice();
  const [, catSubParams] = useRoute("/products/:catSlug/:subSlug");
  const [, catOnlyParams] = useRoute("/products/:catSlug");

  const [search, setSearch] = useState(window.location.search);
  
  useEffect(() => {
    const handleLocationChange = () => {
      setSearch(window.location.search);
    };
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);
  
  const navigate = useCallback((path: string, replace = false) => {
    if (replace) {
      window.history.replaceState(null, "", path);
    } else {
      window.history.pushState(null, "", path);
    }
    const url = new URL(path, window.location.origin);
    setSearch(url.search);
  }, []);
  
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const { data: dynamicCategories } = useQuery<Record<string, CategoryConfig>>({
    queryKey: ["/api/categories"],
  });
  const categories = useMemo(() => normalizeCategories(dynamicCategories || CATEGORIES), [dynamicCategories]);

  const artistList = useMemo(() => {
    const merchSubs: Array<{name: string; slug: string}> = (categories["merch"] as any)?.subcategories || [];
    return merchSubs.filter(s => s.slug !== "jdm");
  }, [categories]);

  const pathCatSlug = catSubParams?.catSlug || catOnlyParams?.catSlug || null;
  const pathSubSlug = catSubParams?.subSlug || null;

  const categoryParam = useMemo(() => {
    if (forcedCatSlug) return forcedCatSlug;
    if (pathCatSlug && categories[pathCatSlug]) return pathCatSlug;
    const qp = params.get("category") as CategorySlug | null;
    if (qp) return qp;
    return null;
  }, [forcedCatSlug, pathCatSlug, params, categories]);

  const subcategoryParam = useMemo(() => {
    if (forcedSubName) return forcedSubName;
    if (pathSubSlug && categoryParam) {
      const cat = categories[categoryParam];
      if (cat) {
        const found = cat.subcategories.find(s => s.slug === pathSubSlug);
        if (found) return found.name;
      }
    }
    const rawSubcategory = params.get("subcategory");
    if (!rawSubcategory) return null;
    return decodeURIComponent(rawSubcategory).trim();
  }, [forcedSubName, pathSubSlug, categoryParam, categories, params]);
  
  const saleParam = params.get("sale") === "true";
  const searchParam = params.get("search") || undefined;

  const shouldNoIndex = !!(searchParam || saleParam);
  
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const [sortOpen, setSortOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 2000000]);
  const [priceInputMin, setPriceInputMin] = useState("");
  const [priceInputMax, setPriceInputMax] = useState("");
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string>("newest");
  const [appliedFilters, setAppliedFilters] = useState<ProductFilters>({});
  
  const PRICE_MAX = 2000000;
  const PRICE_STEP = 10000;
  
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedFilters.minPrice !== undefined && appliedFilters.minPrice > 0) count++;
    if (appliedFilters.maxPrice !== undefined && appliedFilters.maxPrice < PRICE_MAX) count++;
    if (appliedFilters.size) count++;
    return count;
  }, [appliedFilters]);

  const applyFilters = useCallback(() => {
    const f: ProductFilters = {};
    if (priceRange[0] > 0) f.minPrice = priceRange[0];
    if (priceRange[1] < PRICE_MAX) f.maxPrice = priceRange[1];
    if (selectedSizes.length > 0) f.size = selectedSizes.join(",");
    if (sortBy) f.sort = sortBy;
    startTransition(() => {
      setAppliedFilters(f);
    });
  }, [priceRange, selectedSizes, sortBy]);

  const resetFilters = useCallback(() => {
    setPriceRange([0, PRICE_MAX]);
    setPriceInputMin("");
    setPriceInputMax("");
    setSelectedSizes([]);
    setSortBy("");
    setAppliedFilters({});
  }, []);

  const handleSortChange = useCallback((newSort: string) => {
    setSortBy(newSort);
    startTransition(() => {
      setAppliedFilters(prev => ({ ...prev, sort: newSort }));
    });
  }, []);

  // Force refresh data on category/subcategory/search change
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
  }, [categoryParam, subcategoryParam, searchParam, queryClient]);

  useEffect(() => {
    resetFilters();
    cachedSizesRef.current = [];
  }, [categoryParam, subcategoryParam]);


  const { 
    data, 
    isLoading, 
    error, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage 
  } = usePaginatedProducts(24, categoryParam || undefined, subcategoryParam || undefined, saleParam, searchParam, appliedFilters);

  const allProducts = useMemo(() => {
    if (!data?.pages) return [];
    const flat = data.pages.flatMap(page => page.products);
    if (!isWholesale) return flat;
    return flat.filter((p: any) => p.wholesalePrice && p.wholesalePrice > 0);
  }, [data, isWholesale]);

  const cachedSizesRef = useRef<string[]>([]);
  
  const availableSizes = useMemo(() => {
    const hasActiveSizeFilter = appliedFilters.size && appliedFilters.size.length > 0;
    if (hasActiveSizeFilter && cachedSizesRef.current.length > 0) {
      return cachedSizesRef.current;
    }
    
    const sizesSet = new Set<string>();
    if (data?.pages) {
      data.pages.forEach(page => {
        page.products.forEach(p => {
          if (p.sizes) p.sizes.forEach(s => sizesSet.add(s));
        });
      });
    }
    const sizeOrder = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL"];
    const sorted = Array.from(sizesSet).sort((a, b) => {
      const ai = sizeOrder.indexOf(a.toUpperCase());
      const bi = sizeOrder.indexOf(b.toUpperCase());
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
    
    if (!hasActiveSizeFilter && sorted.length > 0) {
      cachedSizesRef.current = sorted;
    }
    return sorted;
  }, [data, appliedFilters.size]);

  const currentCategory = categoryParam ? categories[categoryParam] : null;
  const subcategories: SubcategoryConfig[] = useMemo(() => {
    if (!currentCategory) return [];
    return currentCategory.subcategories;
  }, [currentCategory]);

  const pagination = data?.pages[0]?.pagination;
  
  // Auto-load next page when approaching end of list
  const loadMoreRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          fetchNextPage();
        }
      },
      { 
        rootMargin: "600px",
        threshold: 0.1
      }
    );
    
    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }
    
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleCategoryChange = (cat: CategorySlug | "all") => {
    if (cat === "all") {
      navigate("/products", true);
    } else {
      navigate(`/products/${cat}`, true);
    }
  };

  const handleSubcategoryChange = (subName: string | null) => {
    if (subName && categoryParam) {
      const cat = categories[categoryParam];
      const subConfig = cat?.subcategories.find(s => s.name === subName);
      if (subConfig) {
        navigate(`/${subConfig.slug}`, true);
      } else {
        navigate(`/products/${categoryParam}`, true);
      }
    } else if (categoryParam) {
      navigate(`/products/${categoryParam}`, true);
    }
  };

  const getTitle = () => {
    if (searchParam) return `Результаты поиска: "${searchParam}"`;
    if (saleParam) return "Распродажа";
    if (currentCategory) {
      if (subcategoryParam) return subcategoryParam;
      return currentCategory.name;
    }
    return "Все товары";
  };


  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <h2 className="text-2xl font-semibold mb-4 text-foreground">Ошибка подключения</h2>
        <button onClick={() => window.location.reload()} className="text-primary underline" data-testid="button-retry">Повторить</button>
      </div>
    );
  }

  const isJDM = subcategoryParam === "JDM";
  const isMinta = subcategoryParam?.toLowerCase().includes("дикая мята") || subcategoryParam === "Дикая мята" || subcategoryParam === "ДИКАЯ МЯТА";
  const isMerch = subcategoryParam?.toLowerCase() === "мерч" || subcategoryParam === "Мерч" || subcategoryParam === "МЕРЧ" || categoryParam === "merch";
  const isThemed = isJDM || isMinta || isMerch;
  const isDarkThemed = (isJDM || isMerch) && !isMinta;
  // isMerchSub: merch subcategory page, opened via SlugResolver with forcedSubSlug prop
  const effectiveSubSlug = pathSubSlug || forcedSubSlug || null;
  const isMerchSub = isMerch && !!effectiveSubSlug && !isJDM && !isMinta;
  const collabTheme = isMerchSub ? (MERCH_COLLAB_THEMES[effectiveSubSlug!] ?? null) : null;

  // Theme-specific colors
  const themeColors = isJDM 
    ? { accent: "red", text: "text-red-500", border: "border-red-500", bg: "bg-red-600" }
    : isMinta 
    ? { accent: "amber", text: "text-[#ffa000]", border: "border-[#ffa000]", bg: "bg-[#ffa000]" }
    : isMerch
    ? { accent: "purple", text: "text-amber-400", border: "border-purple-500", bg: "bg-purple-600" }
    : null;

  // Dynamic SEO based on active filters
  const catalogSeoTitle = (() => {
    if (searchParam) return `Поиск: «${searchParam}» — BMGBRAND`;
    if (saleParam) return "Распродажа — скидки на одежду";
    if (subcategoryParam && isMerch) return `Мерч ${subcategoryParam} — купить официальный мерч`;
    if (subcategoryParam) return `${subcategoryParam} — купить`;
    if (currentCategory?.slug === 'socks') return "Купить необычные носки с принтом — прикольные носки с мемами | BMGBRAND";
    if (currentCategory) return `${currentCategory.name} — купить`;
    return "Каталог одежды";
  })();

  const catalogSeoDescription = (() => {
    if (subcategoryParam && isMerch) {
      return `Купить мерч ${subcategoryParam} — официальный магазин BMGBRAND. Футболки, худи, аксессуары. Оплата частями через Долями. Доставка по России СДЭК и Яндекс Доставкой.`;
    }
    if (subcategoryParam) {
      return `${subcategoryParam} в официальном магазине BMGBRAND. Одежда с авторскими принтами. Оплата частями через Долями. Доставка по всей России.`;
    }
    if (currentCategory?.slug === 'socks') {
      return "Купить необычные носки с принтом BOOOMERANGS: оригинальные носки с мемами, прикольные авторские рисунки, носки хорошего качества — хлопок 75%. Оплата частями. Доставка СДЭК по всей России.";
    }
    if (currentCategory) {
      return `${currentCategory.name} — купить в официальном интернет-магазине BMGBRAND. Российский бренд одежды. Оплата частями через Долями. Доставка по России.`;
    }
    if (saleParam) {
      return "Распродажа в BMGBRAND — скидки на одежду и аксессуары. Оплата частями через Долями. Доставка по России.";
    }
    return "Каталог BMGBRAND — худи, футболки, брюки, носки, аксессуары. Оплата частями через Долями. Доставка по всей России.";
  })();

  const catalogSeoKeywords = [
    subcategoryParam,
    subcategoryParam && isMerch ? `мерч ${subcategoryParam}` : null,
    isMerch ? "мерч" : null,
    isMerch ? "купить мерч" : null,
    currentCategory?.slug === 'socks' ? "купить носки" : null,
    currentCategory?.slug === 'socks' ? "необычные носки" : null,
    currentCategory?.slug === 'socks' ? "оригинальные носки" : null,
    currentCategory?.slug === 'socks' ? "прикольные носки" : null,
    currentCategory?.slug === 'socks' ? "носки с мемами" : null,
    currentCategory?.slug === 'socks' ? "носки с принтом" : null,
    currentCategory?.slug === 'socks' ? "носки хорошего качества" : null,
    currentCategory?.slug === 'socks' ? "купить носки с принтом" : null,
    currentCategory?.slug === 'socks' ? "носки BOOOMERANGS" : null,
    currentCategory?.name,
    "BMGBRAND",
    "BOOOMERANGS",
    "купить",
    "российский бренд одежды и аксессуаров",
    "доставка по России",
  ].filter(Boolean).join(", ");

  const catalogCanonical = (() => {
    const base = window.location.origin;
    if (categoryParam && subcategoryParam) return `${base}/products/${categoryParam}?subcategory=${encodeURIComponent(subcategoryParam)}`;
    if (categoryParam) return `${base}/products/${categoryParam}`;
    return `${base}/products`;
  })();

  const breadcrumbItems: any[] = [
    { "@type": "ListItem", "position": 1, "name": "Главная", "item": window.location.origin },
    { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${window.location.origin}/products` },
  ];
  if (currentCategory) {
    breadcrumbItems.push({ "@type": "ListItem", "position": 3, "name": currentCategory.name, "item": `${window.location.origin}/products/${categoryParam}` });
  }
  if (subcategoryParam) {
    breadcrumbItems.push({ "@type": "ListItem", "position": breadcrumbItems.length + 1, "name": subcategoryParam, "item": catalogCanonical });
  }

  const pageContent = (
    <>
      <SEO 
        title={catalogSeoTitle}
        description={catalogSeoDescription}
        keywords={catalogSeoKeywords}
        canonical={catalogCanonical}
        noindex={shouldNoIndex}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": breadcrumbItems,
        }}
      />
      {isMerch ? <MerchNavbar /> : <Navbar />}

      {/* ── Full-bleed hero for main merch page ── */}
      {isMerch && !subcategoryParam && <MerchBanner />}
      {isMerch && !subcategoryParam && (
        <MerchMarquee
          text="МЕРЧ · КОЛЛАБОРАЦИИ · ОГРАНИЧЕННЫЕ СЕРИИ · BOOOMERANGS"
          bg="#111111"
          fg="rgba(255,255,255,0.32)"
        />
      )}

      {/* ── Full-bleed header for themed merch subcategories ── */}
      {isMerchSub && collabTheme && (
        <MerchCollabHeader
          subName={subcategoryParam!}
          theme={collabTheme}
          onNavigate={(p) => navigate(p)}
        />
      )}

      <div className={`pb-12 ${(isMerch && !subcategoryParam) || (isMerchSub && collabTheme) ? 'pt-4 sm:pt-6' : 'pt-28'}`}>
        <div className="px-4 sm:px-6 lg:px-8 max-w-8xl mx-auto">
          {isJDM && <JDMBanner />}
          {isMinta && <MintaBanner />}
        </div>

        {/* Title row — hidden visually for merch pages (shown in hero), keep for a11y + count */}
        <div className="px-4 sm:px-6 lg:px-8 max-w-8xl mx-auto flex items-center justify-between mb-6 gap-2">
          {isMerch ? (
            <h1 className="sr-only">{getTitle()}</h1>
          ) : (
            <h1 className={`text-3xl sm:text-4xl md:text-5xl font-semibold ${isJDM ? "text-red-500" : isMinta ? "text-[#ffa000]" : "text-foreground"}`}>
              {getTitle()}
            </h1>
          )}
          <div className="flex items-center gap-3 ml-auto">
            {pagination && (
              <span className={`text-sm ${isDarkThemed ? "text-white/60" : isMinta ? "text-[#2e2e2e]/60" : "text-muted-foreground"}`} data-testid="text-product-count">
                {allProducts.length} из {pagination.total}
              </span>
            )}
            <Button
              variant="outline"
              onClick={() => setFiltersOpen(!filtersOpen)}
              className={`lg:hidden gap-1.5 text-xs ${isDarkThemed ? "border-white/30 text-white bg-white/10 hover:bg-white/20" : isMinta ? "border-[#ffa000]/40 text-[#2e2e2e] bg-[#ffa000]/10 hover:bg-[#ffa000]/20" : ""}`}
              data-testid="button-toggle-filters-mobile"
              aria-expanded={filtersOpen}
              aria-controls="catalog-sidebar"
            >
              <PanelLeft className="w-4 h-4" />
              Категории
              {activeFilterCount > 0 && (
                <span className="ml-1 bg-primary text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{activeFilterCount}</span>
              )}
            </Button>
          </div>
        </div>

        {/* ── Collab cards grid — main merch page only ── */}
        {isMerch && !subcategoryParam && artistList.length > 0 && (
          <div className="px-4 sm:px-6 lg:px-8 max-w-8xl mx-auto mb-10">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-5 h-px bg-white/20 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-[0.38em] text-white/30">Коллаборации</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {artistList.map(({ slug, name }) => {
                const ct = MERCH_COLLAB_THEMES[slug];
                const accentColor = ct ? ct.accent : 'rgba(255,255,255,0.45)';
                const tagline = ct?.tagline || 'Коллаборация';
                return (
                  <button
                    key={slug}
                    onClick={() => navigate(`/${slug}`, true)}
                    data-testid={`button-collab-${slug}`}
                    className="group relative flex flex-col items-start p-3.5 sm:p-4 rounded-xl text-left overflow-hidden transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98]"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.075)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
                  >
                    {/* Top accent line */}
                    <div className="absolute top-0 inset-x-0 h-[2px] rounded-t-xl" style={{ background: accentColor, opacity: 0.85 }} />
                    <span className="text-[9px] font-bold uppercase tracking-[0.28em] mb-2 mt-0.5" style={{ color: accentColor, opacity: 0.75 }}>
                      × BOOOMERANGS
                    </span>
                    <span className="text-sm sm:text-[15px] font-black text-white leading-tight mb-1.5">{name}</span>
                    <span className="text-[10px] text-white/35 uppercase tracking-wider mb-3 leading-tight">{tagline}</span>
                    <div
                      className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-200 group-hover:gap-1.5"
                      style={{ color: accentColor, opacity: 0.75 }}
                    >
                      Смотреть <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex relative">
          {/* Mobile sidebar overlay */}
          {filtersOpen && (
            <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setFiltersOpen(false)} aria-hidden="true" />
          )}

          {/* Desktop sidebar toggle */}
          {!sidebarVisible && (
            <div className="hidden lg:flex flex-col items-center absolute top-0 left-2 z-10">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setSidebarVisible(true)}
                data-testid="button-show-sidebar"
                aria-label="Показать панель фильтров"
              >
                <PanelLeft className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Sidebar */}
          <aside
            id="catalog-sidebar"
            role={filtersOpen ? "dialog" : undefined}
            aria-modal={filtersOpen ? true : undefined}
            aria-label="Фильтры и категории"
            onKeyDown={(e) => { if (e.key === "Escape") setFiltersOpen(false); }}
            className={`
              fixed top-0 left-0 z-50 h-full w-[280px] border-r overflow-y-auto p-4 pt-16
              transition-transform duration-200 ease-in-out
              ${isDarkThemed ? "bg-zinc-900 border-zinc-700" : isMinta ? "bg-[#f7ece4] border-[#ffa000]/30" : "bg-background border-border"}
              ${filtersOpen ? "translate-x-0" : "-translate-x-full"}
              ${sidebarVisible ? "lg:translate-x-0 lg:static lg:z-auto lg:h-auto lg:w-[260px] lg:min-w-[260px] lg:p-0 lg:pt-0 lg:border-r-0 lg:bg-transparent lg:sticky lg:top-28 lg:self-start lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto" : "lg:hidden"}
            `}
          >
            <div className="flex items-center justify-between mb-3 lg:hidden">
              <span className={`text-sm font-semibold ${isDarkThemed ? "text-white" : isMinta ? "text-[#2e2e2e]" : "text-foreground"}`}>Категории</span>
              <Button size="icon" variant="ghost" onClick={() => setFiltersOpen(false)} className={isDarkThemed ? "text-white hover:bg-white/10" : isMinta ? "text-[#2e2e2e] hover:bg-[#2e2e2e]/10" : ""} data-testid="button-close-sidebar" aria-label="Закрыть панель">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="hidden lg:flex items-center justify-end mb-3">
              <Button size="icon" variant="ghost" onClick={() => setSidebarVisible(false)} data-testid="button-hide-sidebar" aria-label="Скрыть панель фильтров">
                <PanelLeftClose className="w-4 h-4" />
              </Button>
            </div>

            {/* Categories */}
            <div className="mb-4">
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCategoriesOpen(prev => !prev); }}
                className="flex items-center justify-between w-full py-1.5 mb-1 cursor-pointer select-none"
                data-testid="button-toggle-categories"
                aria-expanded={categoriesOpen}
              >
                <span className={`text-[11px] font-medium uppercase tracking-wider ${isDarkThemed ? "text-white/50" : isMinta ? "text-[#2e2e2e]/55" : "text-muted-foreground"}`}>Категории</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isDarkThemed ? "text-white/50" : isMinta ? "text-[#2e2e2e]/55" : "text-muted-foreground"} ${categoriesOpen ? "rotate-0" : "-rotate-90"}`} />
              </button>
              {categoriesOpen && (
                <div className="space-y-0.5">
                  <button
                    onClick={() => { handleCategoryChange("all"); setFiltersOpen(false); }}
                    data-testid="button-category-all"
                    className={`w-full text-left text-sm px-3 py-2 rounded-md transition-colors ${
                      !categoryParam && !saleParam
                        ? isDarkThemed ? "bg-white/10 text-white font-medium" : isMinta ? "bg-[#ffa000]/15 text-[#ffa000] font-medium" : "bg-muted text-foreground font-medium"
                        : isDarkThemed ? "text-white/70 hover:bg-white/5 hover:text-white" : isMinta ? "text-[#2e2e2e]/70 hover:bg-[#2e2e2e]/5 hover:text-[#2e2e2e]" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    Все товары
                  </button>
                  {Object.keys(categories).map(slug => {
                    const isActive = categoryParam === slug;
                    const catData = categories[slug as keyof typeof categories];
                    const catSubcats: SubcategoryConfig[] = catData?.subcategories || [];
                    const hasSubcats = catSubcats.length > 0;
                    const isExpanded = expandedCategories[slug] !== undefined ? expandedCategories[slug] : isActive;
                    const showSubcats = hasSubcats && isExpanded;
                    return (
                      <div key={slug}>
                        <div className="flex items-center">
                          <button
                            onClick={() => { handleCategoryChange(slug as CategorySlug); setFiltersOpen(false); }}
                            data-testid={`button-category-${slug}`}
                            className={`flex-1 text-left text-sm px-3 py-2 rounded-md transition-colors ${
                              isActive
                                ? isDarkThemed ? "bg-white/10 text-white font-medium" : isMinta ? "bg-[#ffa000]/15 text-[#ffa000] font-medium" : "bg-muted text-foreground font-medium"
                                : isDarkThemed ? "text-white/70 hover:bg-white/5 hover:text-white" : isMinta ? "text-[#2e2e2e]/70 hover:bg-[#2e2e2e]/5 hover:text-[#2e2e2e]" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                            }`}
                          >
                            {catData.name}
                          </button>
                          {hasSubcats && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setExpandedCategories(prev => ({ ...prev, [slug]: !isExpanded })); }}
                              className="p-1.5 rounded-md transition-colors hover:bg-muted/50"
                              data-testid={`button-toggle-subcats-${slug}`}
                              aria-label={isExpanded ? "Свернуть подкатегории" : "Развернуть подкатегории"}
                            >
                              <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-0" : "-rotate-90"}`} />
                            </button>
                          )}
                        </div>
                        {showSubcats && (
                          <div className="ml-3 mt-0.5 mb-1 border-l border-border pl-3 space-y-0.5">
                            <button
                              onClick={() => { handleCategoryChange(slug as CategorySlug); setFiltersOpen(false); }}
                              data-testid={`button-subcategory-all-${slug}`}
                              className={`w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors ${
                                isActive && !subcategoryParam
                                  ? isDarkThemed ? "text-white font-medium" : isMinta ? "text-[#ffa000] font-medium" : "text-foreground font-medium"
                                  : isDarkThemed ? "text-white/60 hover:text-white" : isMinta ? "text-[#2e2e2e]/60 hover:text-[#2e2e2e]" : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              Все {catData.name}
                            </button>
                            {catSubcats.map(sub => (
                              <button
                                key={sub.slug}
                                onClick={() => { navigate(`/${sub.slug}`, true); setFiltersOpen(false); }}
                                data-testid={`button-subcategory-${sub.slug}`}
                                className={`w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors ${
                                  isActive && subcategoryParam === sub.name
                                    ? isDarkThemed ? "text-white font-medium" : isMinta ? "text-[#ffa000] font-medium" : "text-foreground font-medium"
                                    : isDarkThemed ? "text-white/60 hover:text-white" : isMinta ? "text-[#2e2e2e]/60 hover:text-[#2e2e2e]" : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {sub.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sort */}
            <div className="mb-4">
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSortOpen(prev => !prev); }}
                className="flex items-center justify-between w-full py-1.5 mb-1 cursor-pointer select-none"
                data-testid="button-toggle-sort"
                aria-expanded={sortOpen}
              >
                <span className={`text-[11px] font-medium uppercase tracking-wider ${isDarkThemed ? "text-white/50" : isMinta ? "text-[#2e2e2e]/55" : "text-muted-foreground"}`}>Сортировка</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isDarkThemed ? "text-white/50" : isMinta ? "text-[#2e2e2e]/55" : "text-muted-foreground"} ${sortOpen ? "rotate-0" : "-rotate-90"}`} />
              </button>
              {sortOpen && (
                <div className="space-y-0.5">
                  {[
                    { value: "", label: "По умолчанию" },
                    { value: "price_asc", label: "Сначала дешёвые" },
                    { value: "price_desc", label: "Сначала дорогие" },
                    { value: "newest", label: "Новинки" },
                    { value: "name_asc", label: "По названию А-Я" },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleSortChange(opt.value)}
                      className={`w-full text-left text-xs px-3 py-1.5 rounded-md transition-colors ${
                        sortBy === opt.value
                          ? isDarkThemed ? "bg-white/10 text-white font-medium" : isMinta ? "bg-[#ffa000]/15 text-[#ffa000] font-medium" : "bg-muted text-foreground font-medium"
                          : isDarkThemed ? "text-white/60 hover:text-white" : isMinta ? "text-[#2e2e2e]/70 hover:bg-[#2e2e2e]/5 hover:text-[#2e2e2e]" : "text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid={`button-sort-${opt.value || "default"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Price filter */}
            <div className="mb-4">
              <span className={`text-[11px] font-medium uppercase tracking-wider mb-3 block ${isDarkThemed ? "text-white/50" : isMinta ? "text-[#2e2e2e]/55" : "text-muted-foreground"}`}>Цена, ₽</span>
              <Slider
                value={priceRange}
                onValueChange={(val) => {
                  setPriceRange(val as [number, number]);
                  setPriceInputMin(val[0] > 0 ? String(Math.round(val[0] / 100)) : "");
                  setPriceInputMax(val[1] < PRICE_MAX ? String(Math.round(val[1] / 100)) : "");
                }}
                min={0}
                max={PRICE_MAX}
                step={PRICE_STEP}
                minStepsBetweenThumbs={1}
                data-testid="slider-price"
              />
              <div className="flex items-center gap-1.5 mt-2">
                <div className="flex-1 min-w-0 relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">от</span>
                  <Input
                    type="number"
                    placeholder="0"
                    value={priceInputMin}
                    onChange={(e) => {
                      setPriceInputMin(e.target.value);
                      const v = parseInt(e.target.value) * 100;
                      if (!isNaN(v) && v >= 0) setPriceRange([v, Math.max(v, priceRange[1])]);
                      else if (e.target.value === "") setPriceRange([0, priceRange[1]]);
                    }}
                    className="pl-7 pr-1 text-xs h-8 w-full"
                    data-testid="input-price-min"
                  />
                </div>
                <span className="text-muted-foreground text-[10px] flex-shrink-0">—</span>
                <div className="flex-1 min-w-0 relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">до</span>
                  <Input
                    type="number"
                    placeholder="20000"
                    value={priceInputMax}
                    onChange={(e) => {
                      setPriceInputMax(e.target.value);
                      const v = parseInt(e.target.value) * 100;
                      if (!isNaN(v) && v > 0) setPriceRange([Math.min(priceRange[0], v), v]);
                      else if (e.target.value === "") setPriceRange([priceRange[0], PRICE_MAX]);
                    }}
                    className="pl-7 pr-1 text-xs h-8 w-full"
                    data-testid="input-price-max"
                  />
                </div>
              </div>
            </div>

            {/* Size filter */}
            {availableSizes.length > 0 && (
              <div className="mb-5">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Размер</span>
                <div className="flex flex-wrap gap-1.5">
                  {availableSizes.map(size => {
                    const isActive = selectedSizes.includes(size);
                    return (
                      <button
                        key={size}
                        onClick={() => {
                          setSelectedSizes(prev => isActive ? prev.filter(s => s !== size) : [...prev, size]);
                        }}
                        className={`min-w-[36px] px-2 py-1 text-xs rounded-md border transition-colors ${
                          isActive
                            ? isDarkThemed ? "bg-white/20 border-white/40 text-white font-medium" : isMinta ? "bg-[#ffa000]/20 border-[#ffa000]/50 text-[#ffa000] font-medium" : "bg-secondary text-secondary-foreground border-secondary font-medium"
                            : isDarkThemed ? "border-white/20 text-white/60 hover:border-white/40 hover:text-white" : isMinta ? "border-[#2e2e2e]/25 text-[#2e2e2e]/60 hover:border-[#2e2e2e]/50 hover:text-[#2e2e2e]" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                        }`}
                        data-testid={`button-size-${size}`}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Button
              onClick={() => { applyFilters(); setFiltersOpen(false); }}
              className="w-full"
              data-testid="button-apply-filters"
            >
              Применить
            </Button>

            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                onClick={resetFilters}
                className="w-full gap-1 text-xs text-muted-foreground mt-1"
                data-testid="button-reset-filters"
              >
                <X className="w-3 h-3" />
                Сбросить фильтры
              </Button>
            )}
          </aside>

          {/* Products Grid */}
          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-0 overflow-hidden">
              {isLoading ? (
                [1,2,3,4,5,6,7,8].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className={`aspect-[971/1504] w-full ${isDarkThemed ? "bg-zinc-800" : isMinta ? "bg-[#e8d8cc]" : "bg-muted"}`} />
                    <div className="px-3 pt-3 pb-4">
                      <div className={`h-3 w-2/3 mb-2 rounded ${isDarkThemed ? "bg-zinc-700" : "bg-muted-foreground/20"}`} />
                      <div className={`h-3 w-1/4 rounded ${isDarkThemed ? "bg-zinc-700" : "bg-muted-foreground/20"}`} />
                    </div>
                  </div>
                ))
              ) : allProducts.length === 0 ? (
                <div className={`col-span-full text-center py-20 ${isThemed ? "text-white/60" : "text-muted-foreground"}`} data-testid="text-empty-category">
                  Товары в этой категории не найдены.
                </div>
              ) : (
                allProducts.map((product, index) => (
                  <ProductCard key={product.id} product={product} priority={index < 4} isJDM={isJDM} isMinta={isMinta} isMerch={isMerch} />
                ))
              )}
            </div>

            {/* Auto-load trigger */}
            <div ref={loadMoreRef} className="h-1" />

            {/* Loading indicator */}
            {isFetchingNextPage && (
              <div className="flex justify-center mt-8">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            )}

            {/* Manual load button as fallback */}
            {hasNextPage && !isFetchingNextPage && (
              <div className="flex justify-center mt-12">
                <Button
                  onClick={() => fetchNextPage()}
                  variant="outline"
                  size="lg"
                  data-testid="button-load-more"
                >
                  Показать ещё
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SEO text block for main categories */}
      {categoryParam === 'clothing' && !subcategoryParam && (
        <div className="max-w-4xl mx-auto px-4 py-12 text-zinc-500 dark:text-zinc-500">
          <h2 className="text-base font-semibold text-zinc-400 dark:text-zinc-400 mb-3">Одежда BOOOMERANGS / BMGBRAND</h2>
          <p className="text-sm leading-relaxed mb-3">
            BOOOMERANGS / BMGBRAND — российский бренд одежды из Тулы с широким ассортиментом: от базовых оверсайз-футболок до зимних курток. Мы создаём вещи, которые носим сами — с вниманием к каждой детали и качеству материалов.
          </p>
          <p className="text-sm leading-relaxed mb-3">
            В основе коллекции — базовые футболки oversize из премиальной двухнитки, которые не садятся и не теряют форму после стирки. Для тех, кто ценит технологичность — куртки серии SSH 2.0 из softshell-материала с защитой от ветра и влаги. Для любителей тактического стиля — джоггеры и брюки из рипстопа с практичными карманами.
          </p>
          <p className="text-sm leading-relaxed mb-3">
            В каталоге также представлены футболки нестандартного кроя из трёхнитки, кожаные сумки и аксессуары. Авторские дизайны соседствуют с минималистичными базовыми вещами — каждый найдёт то, что подходит именно ему.
          </p>
          <p className="text-sm leading-relaxed">
            Российская одежда из Тулы с доставкой по всей России через СДЭК и Яндекс Доставку.
          </p>
        </div>
      )}

      {currentCategory?.slug === 'socks' && !subcategoryParam && (
        <div className="max-w-4xl mx-auto px-4 py-12 text-zinc-500 dark:text-zinc-500">
          <h2 className="text-base font-semibold text-zinc-400 dark:text-zinc-400 mb-3">Необычные носки с принтом BOOOMERANGS / BMGBRAND</h2>
          <p className="text-sm leading-relaxed mb-3">
            Носки BOOOMERANGS — это большой выбор необычных и оригинальных моделей с яркими авторскими принтами. Если ищете прикольные носки с мемами, носки с уникальными рисунками или просто носки хорошего качества — вы попали по адресу. Состав: хлопок 75%, полиамид 17%, эластан 8% — комфортная носка, которая держит форму и не теряет цвет после стирки.
          </p>
          <p className="text-sm leading-relaxed mb-3">
            В каталоге носков BOOOMERANGS вы найдёте авторские дизайны, культовые интернет-мемы, коллаборационные принты с российскими артистами и музыкальными фестивалями. Есть модели для мужчин и женщин — размеры 34–39 и 40–45. Принты как сдержанные, так и яркие — на любой вкус и образ.
          </p>
          <p className="text-sm leading-relaxed mb-3">
            Купить оригинальные носки BOOOMERANGS легко: выбирайте понравившуюся модель, добавляйте в корзину и оформляйте заказ. Минимальная партия — одна пара. Подходят как для себя, так и в качестве необычного подарка.
          </p>
          <p className="text-sm leading-relaxed">
            Доставка по всей России через СДЭК и Яндекс Доставку. Производство — Россия.
          </p>
        </div>
      )}

      {categoryParam === 'accessories' && !subcategoryParam && (
        <div className="max-w-4xl mx-auto px-4 py-12 text-zinc-500 dark:text-zinc-500">
          <h2 className="text-base font-semibold text-zinc-400 dark:text-zinc-400 mb-3">Аксессуары BOOOMERANGS — кружки, ремни, шапки и сумки</h2>
          <p className="text-sm leading-relaxed mb-3">
            Аксессуары BOOOMERANGS — кружки с авторскими принтами, ремни, сумки, вязаные шапки-бини, классические шапки и панамы с фирменным логотипом. Каждый аксессуар дополняет образ и может стать оригинальным подарком.
          </p>
          <p className="text-sm leading-relaxed">
            Всё производится в России с вниманием к качеству материалов и деталям. Доставка по всей России через СДЭК и Яндекс Доставку.
          </p>
        </div>
      )}

      {categoryParam === 'merch' && !subcategoryParam && (
        <div className="max-w-4xl mx-auto px-4 py-12 text-zinc-500 dark:text-zinc-500">
          <h2 className="text-base font-semibold text-zinc-400 dark:text-zinc-400 mb-3">Мерч BOOOMERANGS — официальные коллаборации и брендовые вещи</h2>
          <p className="text-sm leading-relaxed mb-3">
            Мерч BOOOMERANGS — это несколько направлений в одном месте. Во-первых, брендовый мерч самого бренда: вещи с символикой BOOOMERANGS — российского бренда из Тулы. Во-вторых, официальные коллаборации с российскими артистами и фестивалями: ГУДТАЙМС, ДРАГНИ, Молодость внутри, МультFильмы, Дикая Мята.
          </p>
          <p className="text-sm leading-relaxed mb-3">
            Кроме того, BOOOMERANGS создаёт мерч для корпораций, компаний и мероприятий — с разработкой дизайна и производством под ключ.
          </p>
          <p className="text-sm leading-relaxed">
            Весь мерч производится в России. Доставка по всей России через СДЭК и Яндекс Доставку.
          </p>
        </div>
      )}

      <Footer />
    </>
  );
  
  if (isJDM) {
    return <JDMPageWrapper>{pageContent}</JDMPageWrapper>;
  }

  if (isMinta) {
    return <MintaPageWrapper>{pageContent}</MintaPageWrapper>;
  }

  if (isMerchSub && collabTheme) {
    return <MerchCollabWrapper theme={collabTheme}>{pageContent}</MerchCollabWrapper>;
  }

  if (isMerch) {
    return <MerchPageWrapper>{pageContent}</MerchPageWrapper>;
  }

  return <div className="min-h-screen bg-background">{pageContent}</div>;
}
