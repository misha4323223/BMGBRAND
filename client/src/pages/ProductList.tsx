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
import { Loader2, X, ChevronDown, ChevronRight, ChevronLeft, PanelLeft, PanelLeftClose, ArrowRight, Heart, ShoppingBag, ArrowLeft, BrainCog, MessageCircle, Menu, Play, Pause, Headphones, Music } from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";
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
  const [musicOpen, setMusicOpen] = useState(false);
  const [expandedArtist, setExpandedArtist] = useState<string | null>(null);
  const { data: cartItems } = useCart();
  const cartCount = cartItems?.reduce((acc: number, item: any) => acc + item.quantity, 0) || 0;
  const { favoritesCount } = useFavorites();
  const { currentTrack, isPlaying, play, pause } = usePlayer();
  const musicPanelRef = useRef<HTMLDivElement>(null);
  const musicBtnRef = useRef<HTMLButtonElement>(null);

  const { data: tracksData } = useQuery<{ artists: Array<{ slug: string; name: string; tracks: any[] }> }>({
    queryKey: ["/api/artists/all-tracks"],
    staleTime: 5 * 60 * 1000,
  });
  const artists = tracksData?.artists ?? [];
  const allTracks = artists.flatMap((a: any) => a.tracks);

  // Reset expanded state when panel closes
  useEffect(() => {
    if (!musicOpen) setExpandedArtist(null);
  }, [musicOpen]);

  // Close music panel on outside click
  useEffect(() => {
    if (!musicOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        musicPanelRef.current && !musicPanelRef.current.contains(e.target as Node) &&
        musicBtnRef.current && !musicBtnRef.current.contains(e.target as Node)
      ) setMusicOpen(false);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 100);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [musicOpen]);

  // Signal ChatWidget to hide its floating button while this nav is mounted
  useEffect(() => {
    document.documentElement.setAttribute("data-merch-nav", "1");
    return () => document.documentElement.removeAttribute("data-merch-nav");
  }, []);

  // Lock body scroll when burger menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const openAI = () => { setMenuOpen(false); window.dispatchEvent(new CustomEvent("open-booom-ai")); };
  const openManager = () => { setMenuOpen(false); window.dispatchEvent(new CustomEvent("open-booom-manager")); };

  function fmtDur(secs: number) {
    if (!secs || isNaN(secs)) return "—";
    const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <>
      {/* ── Main navbar ──────────────────────────────────────────────────── */}
      <nav
        className="fixed top-0 left-0 right-0 z-[100] flex items-center h-16 px-3 sm:px-5 gap-2"
        style={{
          background: "rgba(4,4,4,0.93)",
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {/* Left: back + logo */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => window.history.back()}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Назад"
          >
            <ArrowLeft className="w-4 h-4 text-white/40" />
          </button>
          <Link href="/" className="flex-shrink-0">
            <img src="/images/boomerangs-logo.webp" alt="Booomerangs" className="h-[56px] w-auto object-contain" />
          </Link>
        </div>

        {/* Center: Mini-player pill ──────────────────────────────────────── */}
        <button
          ref={musicBtnRef}
          onClick={() => setMusicOpen(v => !v)}
          className="flex-1 min-w-0 max-w-[135px] sm:max-w-sm mx-auto flex items-center gap-1 sm:gap-2.5 rounded-xl sm:rounded-2xl transition-all duration-300"
          style={{
            background: musicOpen ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.055)",
            border: musicOpen ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(255,255,255,0.09)",
            padding: "4px 8px",
          }}
          aria-label="Плеер"
          aria-expanded={musicOpen}
        >
          {currentTrack ? (
            /* ── Playing state ── */
            <>
              <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md sm:rounded-lg overflow-hidden flex-shrink-0" style={{ background: "rgba(255,255,255,0.1)" }}>
                {currentTrack.coverUrl
                  ? <img src={currentTrack.coverUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><Music className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white/30" /></div>}
              </div>
              {/* Title + artist — desktop only */}
              <div className="hidden sm:flex flex-1 min-w-0 flex-col text-left">
                <p className="text-[11px] font-bold text-white/90 truncate leading-tight">{currentTrack.title}</p>
                <p className="text-[9px] text-white/35 truncate mt-0.5">{currentTrack.subtitle || currentTrack.artistSlug}</p>
              </div>
              {/* Animated sound bars — desktop only */}
              <div className="hidden sm:flex items-end gap-[3px] h-4 flex-shrink-0">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-[2.5px] rounded-full bg-white/60" style={{
                    height: isPlaying ? `${9 + i * 3}px` : "3px",
                    animation: isPlaying ? `merchnav-bar ${0.5 + i * 0.18}s ease-in-out infinite alternate` : "none",
                    transition: "height 0.2s ease",
                  }} />
                ))}
              </div>
              <ChevronDown
                className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white/30 flex-shrink-0 transition-transform duration-200"
                style={{ transform: musicOpen ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            </>
          ) : (
            /* ── Idle state ── */
            <>
              <div className="w-5 h-5 sm:w-7 sm:h-7 flex items-center justify-center rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.07)" }}>
                <Headphones className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white/55" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/45 leading-tight truncate">Музыка</p>
              </div>
              <ChevronDown
                className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white/22 flex-shrink-0 transition-transform duration-200"
                style={{ transform: musicOpen ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            </>
          )}
        </button>

        {/* Right: favorites + cart + burger ──────────────────────────────── */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* AI chat — mobile only */}
          <button
            onClick={openAI}
            className="sm:hidden relative p-2 rounded-full hover:bg-white/10 transition-colors"
            aria-label="AI чат"
          >
            <BrainCog className="text-white/60" style={{ width: 18, height: 18 }} />
          </button>
          {/* Favorites — desktop only */}
          <Link href="/favorites" className="relative p-2 rounded-full hover:bg-white/10 transition-colors hidden sm:flex" aria-label="Избранное">
            <Heart className="text-white/60" style={{ width: 18, height: 18 }} />
            {favoritesCount > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-white text-black text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
                {favoritesCount > 9 ? "9+" : favoritesCount}
              </span>
            )}
          </Link>
          <Link href="/cart" className="relative p-2 rounded-full hover:bg-white/10 transition-colors" aria-label="Корзина">
            <ShoppingBag className="text-white/60" style={{ width: 18, height: 18 }} />
            {cartCount > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-white text-black text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
                {cartCount > 9 ? "9+" : cartCount}
              </span>
            )}
          </Link>
          <button
            onClick={() => setMenuOpen(true)}
            className="ml-0.5 p-2 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Открыть меню"
            aria-expanded={menuOpen}
          >
            <Menu className="w-5 h-5 text-white/75" />
          </button>
        </div>
      </nav>

      {/* Keyframe for sound-bar animation */}
      <style>{`
        @keyframes merchnav-bar {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1.1); }
        }
      `}</style>

      {/* ── Music dropdown panel ─────────────────────────────────────────── */}
      <AnimatePresence>
        {musicOpen && (
          /* Позиционирование вынесено в обычный div, чтобы Framer Motion
             не перезаписывал transform (он заменяет его своими scale/y) */
          <div
            className="fixed z-[99]"
            style={{
              top: "68px",
              left: "max(8px, calc(50vw - 215px))",
              right: "max(8px, calc(50vw - 215px))",
            }}
          >
          <motion.div
            ref={musicPanelRef}
            key="merch-music-panel"
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden w-full"
            style={{
              background: "#090909",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "20px",
              boxShadow: "0 28px 80px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04)",
            }}
          >
            {/* Scan-line overlay */}
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.008) 3px, rgba(255,255,255,0.008) 4px)",
            }} />

            {/* Header */}
            <div className="relative flex items-center gap-2.5 px-4 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <Headphones className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.45)" }} />
              <span className="text-[9px] font-bold tracking-[0.42em] uppercase flex-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                Исполнители × Плейлист
              </span>
              <button onClick={() => setMusicOpen(false)} className="p-1 rounded-lg" style={{ color: "rgba(255,255,255,0.22)" }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Artist accordion list */}
            <div className="relative max-h-[62vh] overflow-y-auto overscroll-contain px-2 py-2 space-y-1">
              {artists.length === 0 && (
                <div className="py-10 text-center">
                  <Music className="w-8 h-8 mx-auto mb-3 opacity-10 text-white" />
                  <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>Треки ещё не добавлены</p>
                </div>
              )}

              {artists.map((artist: any) => {
                const isExp = expandedArtist === artist.slug;
                const hasActive = artist.tracks.some((t: any) => currentTrack?.id === t.id);

                return (
                  <div key={artist.slug} className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
                    {/* Artist row */}
                    <button
                      onClick={() => setExpandedArtist(isExp ? null : artist.slug)}
                      className="w-full flex items-center gap-3 px-3.5 py-3 transition-all hover:bg-white/[0.03]"
                      style={{ color: hasActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.72)" }}
                    >
                      <div
                        className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
                        style={{ background: "rgba(255,255,255,0.07)" }}
                      >
                        {artist.tracks[0]?.coverUrl
                          ? <img src={artist.tracks[0].coverUrl} alt={artist.name} className="w-full h-full object-cover" loading="lazy" />
                          : <Music className="w-4 h-4 opacity-25 text-white" />}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-[13px] font-semibold truncate leading-tight">{artist.name}</p>
                      </div>
                      {/* Active bars */}
                      {hasActive && (
                        <div className="flex items-end gap-[2.5px] h-3.5 mr-1">
                          {[0, 1, 2].map(i => (
                            <div key={i} className="w-[2px] rounded-full bg-white/75" style={{
                              height: isPlaying ? `${6 + i * 3}px` : "3px",
                              animation: isPlaying ? `merchnav-bar ${0.5 + i * 0.2}s ease-in-out infinite alternate` : "none",
                            }} />
                          ))}
                        </div>
                      )}
                      <ChevronDown
                        className="w-3.5 h-3.5 opacity-25 flex-shrink-0 transition-transform duration-200"
                        style={{ transform: isExp ? "rotate(180deg)" : "rotate(0deg)" }}
                      />
                    </button>

                    {/* Track list (accordion) */}
                    <div style={{
                      maxHeight: isExp ? `${artist.tracks.length * 56 + 12}px` : "0px",
                      overflow: "hidden",
                      transition: "max-height 0.33s cubic-bezier(0.4,0,0.2,1)",
                    }}>
                      <div className="px-2 pb-2 space-y-0.5">
                        {artist.tracks.map((track: any, idx: number) => {
                          const isActive = currentTrack?.id === track.id;
                          const isThisPlaying = isActive && isPlaying;
                          return (
                            <div
                              key={track.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => { isThisPlaying ? pause() : play(track, allTracks); }}
                              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); isThisPlaying ? pause() : play(track, allTracks); } }}
                              className="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer select-none transition-all duration-150"
                              style={{ background: isActive ? "rgba(255,255,255,0.08)" : "transparent" }}
                              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)"; }}
                              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                            >
                              {/* Cover */}
                              <div className="relative w-8 h-8 rounded-lg overflow-hidden flex-shrink-0" style={{ background: "rgba(255,255,255,0.07)" }}>
                                {track.coverUrl
                                  ? <img src={track.coverUrl} alt={track.title} className="w-full h-full object-cover" loading="lazy" />
                                  : <div className="w-full h-full flex items-center justify-center"><Music className="w-3 h-3 opacity-20 text-white" /></div>}
                                {isActive && (
                                  <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.52)" }}>
                                    {isThisPlaying ? <Pause className="w-3 h-3 text-white" /> : <Play className="w-3 h-3 text-white" />}
                                  </div>
                                )}
                              </div>
                              {/* Index / bars */}
                              <div className="w-4 flex-shrink-0 flex items-center justify-center">
                                {isActive
                                  ? <div className="flex items-end gap-[2px] h-3">
                                      {[0, 1, 2].map(i => (
                                        <div key={i} className="w-[2px] rounded-full bg-white/75" style={{
                                          height: isThisPlaying ? `${5 + i * 2}px` : "2px",
                                          animation: isThisPlaying ? `merchnav-bar ${0.5 + i * 0.2}s ease-in-out infinite alternate` : "none",
                                        }} />
                                      ))}
                                    </div>
                                  : <span className="text-[10px] text-white/20 tabular-nums">{idx + 1}</span>}
                              </div>
                              {/* Title */}
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-medium truncate leading-tight" style={{ color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.7)" }}>
                                  {track.title}
                                </p>
                                {track.subtitle && <p className="text-[9px] mt-0.5 opacity-25 truncate text-white">{track.subtitle}</p>}
                              </div>
                              {/* Duration */}
                              <span className="text-[10px] opacity-22 flex-shrink-0 tabular-nums text-white">{fmtDur(track.duration)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Panel footer */}
            <div className="px-4 py-3 relative" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-[8px] text-center font-bold tracking-[0.4em] uppercase" style={{ color: "rgba(255,255,255,0.7)" }}>
                BOOOMERANGS × ARTIST COLLABS
              </p>
            </div>
          </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Full-screen burger panel ─────────────────────────────────────── */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              key="merch-menu-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="fixed inset-0 z-[149] bg-black/60"
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              key="merch-menu-panel"
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
              className="fixed inset-y-0 right-0 z-[150] flex flex-col overflow-hidden"
              style={{ width: "min(100vw, 440px)", background: "#040404" }}
            >
              {/* Scan-line */}
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.011) 3px, rgba(255,255,255,0.011) 4px)",
              }} />
              {/* Grid */}
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)",
                backgroundSize: "44px 44px",
              }} />
              {/* Glow */}
              <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full pointer-events-none" style={{
                background: "radial-gradient(circle, rgba(255,255,255,0.025) 0%, transparent 70%)",
              }} />

              {/* Top bar */}
              <div className="relative z-10 flex items-center justify-between px-5 h-16 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <Link href="/" onClick={() => setMenuOpen(false)} className="flex-shrink-0">
                  <img src="/images/boomerangs-logo.webp" alt="Booomerangs" className="h-[52px] w-auto" />
                </Link>
                <button onClick={() => setMenuOpen(false)} className="p-2 rounded-full hover:bg-white/10 transition-colors" aria-label="Закрыть">
                  <X className="w-5 h-5 text-white/50" />
                </button>
              </div>

              {/* Nav links */}
              <div className="relative z-10 flex-1 flex flex-col justify-center px-5 py-6 min-h-0 overflow-y-auto">
                {MERCH_NAV_LINKS.map(({ label, href }, i) => (
                  <motion.div
                    key={href}
                    initial={{ x: 36, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 36, opacity: 0 }}
                    transition={{ duration: 0.38, delay: 0.08 + i * 0.065, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <Link
                      href={href}
                      onClick={() => setMenuOpen(false)}
                      className="group flex items-center justify-between py-3"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                    >
                      <span className="font-black text-white/80 group-hover:text-white transition-colors leading-none tracking-tight" style={{ fontSize: "clamp(1.65rem, 7vw, 2.6rem)" }}>
                        {label}
                      </span>
                      <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/55 flex-shrink-0 transition-all group-hover:translate-x-1" />
                    </Link>
                  </motion.div>
                ))}
              </div>

              {/* Chat section */}
              <div className="relative z-10 px-5 pb-7 pt-4 flex-shrink-0">
                <motion.div initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.38, delay: 0.48 }}>
                  <p className="text-[9px] font-bold tracking-[0.38em] uppercase mb-3" style={{ color: "rgba(255,255,255,0.22)" }}>— Связь</p>
                  <div className="flex gap-2">
                    <button onClick={openAI}
                      className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all"
                      style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.72)", background: "transparent" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                    >
                      <BrainCog className="w-3.5 h-3.5 opacity-60" /> BOOOM AI
                    </button>
                    <button onClick={openManager}
                      className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all"
                      style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.72)", background: "transparent" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                    >
                      <MessageCircle className="w-3.5 h-3.5 opacity-60" /> МЕНЕДЖЕР
                    </button>
                  </div>
                </motion.div>
                <motion.p
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.6 }}
                  className="mt-5 text-center text-[8px] font-bold tracking-[0.36em] uppercase"
                  style={{ color: "rgba(255,255,255,0.7)" }}
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

function optimizeArtistImg(url: string): string {
  if (!url) return url;
  if (url.includes('storage.yandexcloud.net/bmg/site/artist/')) return url;
  if (url.includes('storage.yandexcloud.net/bmg/')) {
    const t = url.replace(/\.(webp|jpg|jpeg|png)(\?.*)?$/i, '_thumb.webp$2');
    if (t !== url) return t;
  }
  return url;
}

function toThumbUrl(url: string): string {
  if (!url) return url;
  if (url.includes('_thumb.webp')) return url;
  if (
    url.includes('storage.yandexcloud.net/bmg/products/') ||
    url.includes('storage.yandexcloud.net/bmg/site/')
  ) {
    const thumbUrl = url.replace(/\.(webp|jpg|jpeg|png)(\?.*)?$/i, '_thumb.webp$2');
    if (thumbUrl !== url) return thumbUrl;
  }
  return url;
}

const ARTIST_PAGE_SIZE = 8;

function ArtistOverlay({ artist, onClose }: { artist: { name: string; role: string; image: string; slug: string; link: string; accent: string }; onClose: () => void }) {
  const [visibleCount, setVisibleCount] = useState(ARTIST_PAGE_SIZE);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const { data: allProducts, isLoading } = useQuery<any[]>({
    queryKey: ['/api/products/by-artist', artist.slug],
    queryFn: async () => {
      if (!artist.slug) return [];
      const res = await fetch(`/api/products/by-artist/${encodeURIComponent(artist.slug)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.products ?? data ?? [];
    },
    enabled: !!artist.slug,
    staleTime: 2 * 60 * 1000,
  });

  const products = useMemo(() => (allProducts || []).slice(0, visibleCount), [allProducts, visibleCount]);
  const hasMore = (allProducts?.length || 0) > visibleCount;

  // Сброс при смене артиста
  useEffect(() => {
    setVisibleCount(ARTIST_PAGE_SIZE);
  }, [artist.slug]);

  // Автоподгрузка следующей порции при приближении к концу списка
  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (!el) return;
    if (!hasMore) return;
    const total = allProducts?.length || 0;

    if (typeof IntersectionObserver === "undefined") {
      setVisibleCount(total);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((v) => Math.min(v + ARTIST_PAGE_SIZE, total));
        }
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, allProducts?.length]);

  const { data: artistPagesSettings } = useQuery<any>({
    queryKey: ['/api/page-settings/artist_pages'],
    staleTime: 5 * 60 * 1000,
  });
  const artistLogoUrl: string | undefined = artist.slug ? artistPagesSettings?.[artist.slug]?.logoUrl : undefined;

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      {/* Artist photo as full-bleed background */}
      <div className="absolute inset-0">
        <img
          src={artist.image}
          alt={artist.name}
          className="w-full h-full object-cover"
          style={{ objectPosition: 'center 15%' }}
        />
        {/* Dark cinematic overlay */}
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(135deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.65) 50%, rgba(0,0,0,0.88) 100%)',
        }} />
        {/* Scanline grain */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.6) 0px, rgba(255,255,255,0.6) 1px, transparent 1px, transparent 3px)',
        }} />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full overflow-y-auto">
        {/* Header */}
        <div className="relative flex flex-col items-center px-4 sm:px-8 pt-6 sm:pt-10 pb-4">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="flex flex-col items-center text-center"
          >
            <div className="flex items-center justify-center gap-3 sm:gap-4">
              <img
                src="/images/boomerangs-logo.webp"
                alt="Booomerangs"
                className="object-contain"
                style={{ maxHeight: 'clamp(4.5rem, 13.5vw, 8.25rem)', maxWidth: '40vw' }}
              />
              <span className="font-black leading-none" style={{ color: artist.accent, fontSize: 'clamp(1.6rem, 5vw, 3rem)' }}>×</span>
              {artistLogoUrl ? (
                <img
                  src={artistLogoUrl}
                  alt={artist.name}
                  className="object-contain"
                  style={{ maxHeight: 'clamp(3rem, 9vw, 5.5rem)', maxWidth: '32vw' }}
                />
              ) : (
                <h2 className="font-black text-white leading-none tracking-tighter" style={{ fontSize: 'clamp(1.8rem, 7vw, 4rem)' }}>
                  {artist.name}
                </h2>
              )}
            </div>
          </motion.div>
          <button
            onClick={onClose}
            className="absolute left-4 sm:left-8 top-6 sm:top-10 flex items-center gap-2 text-white/70 text-sm font-medium hover:text-white transition-colors group"
            data-testid="button-artist-overlay-close"
          >
            <span className="flex items-center justify-center w-8 h-8 rounded-full border border-white/20 bg-black/30 backdrop-blur-sm group-hover:border-white/50 group-hover:bg-black/50 transition-all">
              <ArrowLeft className="w-3.5 h-3.5 text-white" />
            </span>
            <span className="hidden sm:inline">Назад</span>
          </button>
        </div>

        {/* Accent divider */}
        <div className="mx-4 sm:mx-8 h-px mb-6" style={{ background: `linear-gradient(90deg, ${artist.accent}, transparent)` }} />

        {/* Products strip */}
        <div className="px-4 sm:px-8 flex-1">
          {isLoading ? (
            <div className="flex items-center gap-3 py-8">
              <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
              <span className="text-xs text-white/40 tracking-widest uppercase">Загружаем коллекцию…</span>
            </div>
          ) : !products?.length ? (
            <p className="text-sm text-white/40 py-8">Товары скоро появятся</p>
          ) : (
            <motion.div
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.02 } } }}
            >
              {products.map((product: any, idx: number) => (
                <motion.div
                  key={product.id}
                  variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } } }}
                >
                  <Link
                    href={`/${product.slug || product.id}`}
                    onClick={onClose}
                    className="block group relative overflow-hidden rounded-xl"
                    style={{ aspectRatio: '3/4' }}
                  >
                    {product.imageUrl ? (
                      <img
                        src={toThumbUrl(product.imageUrl)}
                        alt={product.name}
                        loading={idx < 8 ? 'eager' : 'lazy'}
                        fetchPriority={idx < 4 ? 'high' : 'auto'}
                        decoding="async"
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.05]"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-white/5" />
                    )}
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.1) 55%)' }} />
                    <div className="absolute bottom-0 left-0 right-0 p-2.5 sm:p-3">
                      <p className="text-[10px] sm:text-xs font-black text-white leading-tight line-clamp-2 mb-1">{product.name}</p>
                      <p className="font-black text-white" style={{ fontSize: 'clamp(12px, 3vw, 15px)', color: artist.accent }}>
                        {product.price ? `${Math.round(Number(product.price) / 100).toLocaleString('ru-RU')} ₽` : ''}
                      </p>
                    </div>
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: artist.accent }}>
                        <ArrowRight className="w-3 h-3 text-black" />
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>

        {/* Автоподгрузка при прокрутке */}
        {hasMore && (
          <div ref={loadMoreSentinelRef} className="px-4 sm:px-8 py-6 sm:py-8 mt-4 flex justify-center h-10" data-testid="sentinel-load-more-artist-overlay-products">
            <div
              className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: `${artist.accent}55`, borderTopColor: 'transparent' }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

function MerchArtistSection() {
  const { data: homeSettings } = useQuery<any>({
    queryKey: ["/api/page-settings/home"],
    staleTime: 5 * 60 * 1000,
  });

  const [selectedArtist, setSelectedArtist] = useState<null | { name: string; role: string; image: string; slug: string; link: string; accent: string }>(null);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const imgRefs = useRef<Record<string, HTMLImageElement | null>>({});

  // Drag-to-scroll refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });

  // Arrow visibility
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const artistCards = useMemo(() => {
    const items: any[] = homeSettings?.artists?.items || [];
    return items
      .filter((a: any) => a.image)
      .map((a: any) => ({
        name:   a.name   || '',
        role:   a.role   || 'Коллаборация',
        image:  optimizeArtistImg(a.image),
        slug:   a.slug   || '',
        link:   a.link && a.link.startsWith('/') ? a.link : (a.slug ? `/@${a.slug}` : ''),
        accent: MERCH_COLLAB_THEMES[a.slug]?.accent ?? 'rgba(255,255,255,0.38)',
      }));
  }, [homeSettings]);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 8);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    return () => el.removeEventListener('scroll', updateArrows);
  }, [updateArrows, artistCards]);

  const scrollCards = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const step = Math.round(el.clientWidth * 0.65);
    el.scrollBy({ left: dir === 'right' ? step : -step, behavior: 'smooth' });
  }, []);

  /* ── 3D tilt: no CSS transition on transform during move ── */
  const handleCardMouseMove = useCallback((e: React.MouseEvent<HTMLButtonElement>, slug: string) => {
    const card = cardRefs.current[slug];
    if (!card) return;
    // Disable transform-transition while mouse is moving to prevent jitter
    card.style.transition = 'box-shadow 0.35s ease';
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `perspective(700px) rotateY(${x * 12}deg) rotateX(${-y * 8}deg) scale(1.04) translateZ(0)`;
    const img = imgRefs.current[slug];
    if (img) {
      img.style.transition = 'none';
      img.style.transform = `scale(1.1) translate(${x * -5}px, ${y * -3}px)`;
    }
  }, []);

  const handleCardMouseEnter = useCallback((slug: string) => {
    setHoveredSlug(slug);
  }, []);

  const handleCardMouseLeave = useCallback((slug: string) => {
    const card = cardRefs.current[slug];
    if (card) {
      // Re-enable transition for smooth spring-back
      card.style.transition = 'transform 0.55s cubic-bezier(0.16,1,0.3,1), box-shadow 0.35s ease';
      card.style.transform = 'perspective(700px) rotateY(0deg) rotateX(0deg) scale(1) translateZ(0)';
    }
    const img = imgRefs.current[slug];
    if (img) {
      img.style.transition = 'transform 0.55s cubic-bezier(0.16,1,0.3,1)';
      img.style.transform = 'scale(1) translate(0px, 0px)';
    }
    setHoveredSlug(null);
  }, []);

  /* ── Drag-to-scroll (desktop) ── */
  const onScrollMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    dragState.current = { active: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft, moved: false };
    el.style.cursor = 'grabbing';
    el.style.userSelect = 'none';
  }, []);

  const onScrollMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragState.current.active || !scrollRef.current) return;
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - dragState.current.startX) * 1.4;
    if (Math.abs(walk) > 4) dragState.current.moved = true;
    scrollRef.current.scrollLeft = dragState.current.scrollLeft - walk;
  }, []);

  const onScrollMouseUp = useCallback(() => {
    dragState.current.active = false;
    if (scrollRef.current) {
      scrollRef.current.style.cursor = 'grab';
      scrollRef.current.style.userSelect = '';
    }
  }, []);

  const handleCardClick = useCallback((artist: typeof artistCards[0]) => {
    // Don't open modal if the user was dragging
    if (dragState.current.moved) { dragState.current.moved = false; return; }
    setSelectedArtist(artist);
  }, [artistCards]);

  return (
    <>
    <div
      className="relative w-full"
      style={{ background: '#090909', paddingTop: '72px', paddingBottom: '36px' }}
    >
      {/* Film grain overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.025,
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '300px 300px',
        }}
      />

      {/* Section label */}
      <motion.div
        className="px-4 sm:px-6 lg:px-12 mb-7 flex items-center gap-3"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="w-5 h-px shrink-0" style={{ background: 'rgba(255,255,255,0.28)' }} />
        <span className="text-[9px] font-bold tracking-[0.45em] uppercase" style={{ color: 'rgba(255,255,255,0.38)' }}>
          BOOOMERANGS × ARTIST COLLABS
        </span>
      </motion.div>

      {/* Cards scroll container */}
      <div className="relative">
        {/* Left edge fade + arrow */}
        <div
          className="absolute left-0 top-0 bottom-4 w-24 z-10 pointer-events-none flex items-center"
          style={{ background: 'linear-gradient(to right, #090909 20%, transparent)' }}
        >
          <button
            onClick={() => scrollCards('left')}
            aria-label="Листать влево"
            className="pointer-events-auto ml-2 flex items-center justify-center rounded-full transition-all duration-200"
            style={{
              width: 40, height: 40,
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.14)',
              backdropFilter: 'blur(8px)',
              opacity: canScrollLeft ? 1 : 0,
              transform: canScrollLeft ? 'scale(1)' : 'scale(0.7)',
              transition: 'opacity 0.25s ease, transform 0.25s ease',
              pointerEvents: canScrollLeft ? 'auto' : 'none',
            }}
          >
            <ChevronLeft className="w-4 h-4 text-white/80" />
          </button>
        </div>

        {/* Right edge fade + arrow */}
        <div
          className="absolute right-0 top-0 bottom-4 w-24 z-10 pointer-events-none flex items-center justify-end"
          style={{ background: 'linear-gradient(to left, #090909 20%, transparent)' }}
        >
          <button
            onClick={() => scrollCards('right')}
            aria-label="Листать вправо"
            className="pointer-events-auto mr-2 flex items-center justify-center rounded-full"
            style={{
              width: 40, height: 40,
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.14)',
              backdropFilter: 'blur(8px)',
              opacity: canScrollRight ? 1 : 0,
              transform: canScrollRight ? 'scale(1)' : 'scale(0.7)',
              transition: 'opacity 0.25s ease, transform 0.25s ease',
              pointerEvents: canScrollRight ? 'auto' : 'none',
            }}
          >
            <ChevronRight className="w-4 h-4 text-white/80" />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="overflow-x-auto scrollbar-none"
          style={{ WebkitOverflowScrolling: 'touch', cursor: 'grab', scrollSnapType: 'x proximity' }}
          onMouseDown={onScrollMouseDown}
          onMouseMove={onScrollMouseMove}
          onMouseUp={onScrollMouseUp}
          onMouseLeave={onScrollMouseUp}
        >
          <motion.div
            className="flex px-4 sm:px-6 lg:px-12 pb-4"
            style={{ width: 'max-content', gap: 'clamp(12px, 2vw, 18px)' }}
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
          >
            {artistCards.map((artist) => {
              const isHovered = hoveredSlug === artist.slug;
              return (
                <motion.div
                  key={artist.slug || artist.name}
                  variants={{
                    hidden: { opacity: 0, y: 36, scale: 0.92 },
                    show:  { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
                  }}
                  className="flex-shrink-0"
                  style={{ scrollSnapAlign: 'start' }}
                >
                  <button
                    ref={el => { cardRefs.current[artist.slug] = el; }}
                    type="button"
                    onClick={() => handleCardClick(artist)}
                    onMouseMove={(e) => handleCardMouseMove(e, artist.slug)}
                    onMouseEnter={() => handleCardMouseEnter(artist.slug)}
                    onMouseLeave={() => handleCardMouseLeave(artist.slug)}
                    className="block relative overflow-hidden focus:outline-none"
                    style={{
                      width: 'clamp(190px, 28vw, 265px)',
                      aspectRatio: '2/3',
                      borderRadius: '18px',
                      cursor: 'pointer',
                      /* NO transform in base transition — added dynamically via JS */
                      transition: 'box-shadow 0.35s ease',
                      boxShadow: isHovered
                        ? `0 0 0 1.5px rgba(255,255,255,0.28), 0 24px 70px rgba(0,0,0,0.45), 0 10px 40px rgba(0,0,0,0.7)`
                        : '0 6px 28px rgba(0,0,0,0.55)',
                      willChange: 'transform',
                    }}
                    aria-label={`Открыть коллекцию ${artist.name}`}
                    data-testid={`button-artist-card-${artist.slug}`}
                  >
                    {/* Photo */}
                    <img
                      ref={el => { imgRefs.current[artist.slug] = el; }}
                      src={artist.image}
                      alt={artist.name}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover"
                      style={{
                        objectPosition: 'center 15%',
                        willChange: 'transform',
                        pointerEvents: 'none',
                      }}
                    />

                    {/* Gradient */}
                    <div className="absolute inset-0" style={{
                      background: 'linear-gradient(to top, rgba(0,0,0,0.98) 0%, rgba(0,0,0,0.42) 42%, rgba(0,0,0,0.06) 100%)',
                    }} />

                    {/* Top accent bar */}
                    <div
                      className="absolute top-0 inset-x-0 rounded-t-[18px]"
                      style={{
                        height: isHovered ? '4px' : '3px',
                        background: 'rgba(255,255,255,0.85)',
                        transition: 'height 0.25s ease, opacity 0.25s ease, box-shadow 0.25s ease',
                        opacity: isHovered ? 1 : 0.5,
                        boxShadow: isHovered ? `0 0 10px rgba(255,255,255,0.35)` : 'none',
                      }}
                    />

                    {/* Scanlines */}
                    <div className="absolute inset-0 pointer-events-none" style={{
                      backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.4) 0px, rgba(255,255,255,0.4) 1px, transparent 1px, transparent 4px)',
                      opacity: 0.03,
                    }} />

                    {/* Corner bracket — top right */}
                    <div className="absolute top-3 right-3" style={{
                      width: 20, height: 20,
                      borderTop: `1.5px solid rgba(255,255,255,0.55)`,
                      borderRight: `1.5px solid rgba(255,255,255,0.55)`,
                      borderRadius: '0 4px 0 0',
                      opacity: isHovered ? 0.85 : 0.25,
                      transition: 'opacity 0.3s ease',
                    }} />
                    {/* Corner bracket — bottom left */}
                    <div className="absolute bottom-[86px] left-3" style={{
                      width: 20, height: 20,
                      borderBottom: `1.5px solid rgba(255,255,255,0.55)`,
                      borderLeft: `1.5px solid rgba(255,255,255,0.55)`,
                      borderRadius: '0 0 0 4px',
                      opacity: isHovered ? 0.85 : 0.25,
                      transition: 'opacity 0.3s ease',
                    }} />

                    {/* Info */}
                    <div className="absolute bottom-0 left-0 right-0 p-4" style={{
                      transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1)',
                      transform: isHovered ? 'translateY(0)' : 'translateY(3px)',
                    }}>
                      <p className="font-mono uppercase leading-none mb-2" style={{
                        fontSize: 8, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.65)', opacity: 0.9,
                      }}>
                        × BOOOMERANGS
                      </p>
                      <h3 className="font-black text-white leading-tight" style={{ fontSize: 'clamp(15px, 3.8vw, 22px)' }}>
                        {artist.name}
                      </h3>
                      <div style={{
                        overflow: 'hidden',
                        maxHeight: isHovered ? '24px' : '0px',
                        opacity: isHovered ? 1 : 0,
                        transition: 'max-height 0.3s ease, opacity 0.25s ease',
                        marginTop: isHovered ? '8px' : 0,
                      }}>
                        <span className="inline-flex items-center gap-1.5" style={{
                          fontSize: 10, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.2em',
                        }}>
                          СМОТРЕТЬ КОЛЛЕКЦИЮ <ArrowRight style={{ width: 9, height: 9 }} />
                        </span>
                      </div>
                    </div>
                  </button>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </div>

    {/* Artist overlay */}
    <AnimatePresence>
      {selectedArtist && (
        <ArtistOverlay artist={selectedArtist} onClose={() => setSelectedArtist(null)} />
      )}
    </AnimatePresence>
    </>
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

  // Longer, on-page visible description (300–500 chars) for category/catalog SEO content.
  // Distinct from catalogSeoDescription (meta tag, kept short for snippets).
  const catalogVisibleDescription = (() => {
    if (searchParam) return null;
    if (subcategoryParam && isMerch) {
      return `Официальный мерч ${subcategoryParam} в интернет-магазине BMGBRAND: футболки, худи, свитшоты и аксессуары с авторскими принтами артиста. Все модели пошиты из плотного качественного хлопка, принты не выцветают и не трескаются после стирки. Оплата картой или частями через Долями, доставка СДЭК и Яндекс Доставкой по всей России — от Москвы и Санкт-Петербурга до регионов. Новые коллекции и коллаборации выходят регулярно, размерная сетка и рекомендации по подбору размера — на карточке каждого товара.`;
    }
    if (subcategoryParam) {
      return `${subcategoryParam} — раздел каталога BMGBRAND, российского бренда одежды с авторскими принтами из Тулы. В подборке — актуальные модели с уникальными дизайнами, которые не встретить в масс-маркете. Все вещи проверены на качество пошива и печати перед отправкой. Оплата картой или частями через Долями, доставка СДЭК и Яндекс Доставкой по всей России. На карточке товара доступны таблица размеров и инструмент подбора размера по параметрам.`;
    }
    if (currentCategory?.slug === 'socks') {
      return `Необычные носки с принтом BOOOMERANGS — это оригинальные авторские рисунки, мемные принты и классические модели на любой вкус. Состав — качественный хлопок (75%), прочная резинка, яркая печать, которая не выцветает после стирок. Подходят как повседневный образ, так и в подарок: есть одиночные пары и подарочные наборы. Оплата картой или частями через Долями. Доставка СДЭК и Яндекс Доставкой по всей России — от 1–3 дней в крупных городах.`;
    }
    if (currentCategory) {
      return `${currentCategory.name} в официальном интернет-магазине BMGBRAND — российского бренда одежды с авторскими принтами. Мы делаем вещи, которые носим сами: плотные ткани, аккуратный крой, печать, которая не трескается и не выцветает. В каталоге — актуальные модели и лимитированные коллаборации с артистами. Оплата картой или частями через Долями, доставка СДЭК и Яндекс Доставкой по всей России, от крупных городов до отдалённых регионов.`;
    }
    if (saleParam) {
      return `Распродажа в BMGBRAND — одежда и аксессуары с авторскими принтами по сниженным ценам. В разделе собраны товары из прошлых коллекций и остатки лимитированных серий — количество ограничено. Качество то же, что и в основном каталоге: плотный хлопок, аккуратная печать, проверенный пошив. Оплата картой или частями через Долями, доставка СДЭК и Яндекс Доставкой по всей России.`;
    }
    return `Каталог BMGBRAND — российского бренда одежды с авторскими принтами из Тулы: худи, свитшоты, футболки, носки и аксессуары. Мы делаем вещи, которые носим сами, поэтому уделяем внимание качеству ткани, кроя и печати принтов. В каталоге — базовые модели, сезонные новинки и лимитированные коллаборации с артистами и фестивалями. Оплата картой или частями через Долями, доставка СДЭК и Яндекс Доставкой по всей России.`;
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

      {/* ── Artist cards for main merch page ── */}
      {isMerch && !subcategoryParam && <MerchArtistSection />}
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
          {!isMerch && (
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
          )}
        </div>

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

      {catalogVisibleDescription && (
        <div className="max-w-4xl mx-auto px-4 py-12">
          <p
            className={`text-sm leading-relaxed ${
              isDarkThemed ? "text-white/50" : isMinta ? "text-[#2e2e2e]/60" : "text-zinc-500 dark:text-zinc-500"
            }`}
            data-testid="text-category-description"
          >
            {catalogVisibleDescription}
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
