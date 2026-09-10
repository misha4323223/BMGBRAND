import { Link } from "wouter";
import {
  ArrowRight,
  ChevronDown,
  ChevronsLeftRight,
  Shirt,
  Pencil,
  Settings2,
  Globe,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Меняет 800px _thumb.webp на лёгкий ~200px _thumb_small.webp для маленьких карточек.
function getOptimizedImageSmallUrl(url: string): string {
  if (!url) return url;
  if (url.includes("_thumb_small.webp")) return url;
  const smallUrl = url.replace(/\.webp(\?.*)?$/i, "_thumb_small.webp$1");
  if (smallUrl !== url) return smallUrl;
  return url;
}

function getOptimizedImageUrl(url: string): string {
  if (!url) return url;
  if (url.includes("_thumb.webp")) return url;
  // У артистов на CDN тоже есть _thumb.webp — применяем ту же замену, что и для товаров.
  // Если миниатюра вдруг отсутствует, у <img> есть onError-фолбэк на оригинал.
  if (
    url.includes("storage.yandexcloud.net/bmg/products/") ||
    url.includes("storage.yandexcloud.net/bmg/site/")
  ) {
    const thumbUrl = url.replace(/\.(webp|jpg|jpeg|png)(\?.*)?$/i, "_thumb.webp$2");
    if (thumbUrl !== url) return thumbUrl;
  }
  return url;
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
          {/* В ленте показываем только картинку (thumbnailUrl) — видео монтируется в модалке по клику */}
          {item.thumbnailUrl ? (
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

interface CollabReviewsVaultProps {
  artists: any[];
  artistsLinkUrl: string;
  reels: any[];
  reelsTitle: string;
  onReelClick: (item: any) => void;
}

/**
 * Минималистичный люк — секция «Коллаборации + Обзоры» на главной.
 * Свёрнуто: две створки с горизонтальным текстом и тонкими accent-линиями.
 * Клик: створки разъезжаются в стороны, ленты артистов и рилов проявляются.
 * Состояние открыто/закрыто запоминается в localStorage.
 */
export function CollabReviewsVault({ artists, artistsLinkUrl, reels, reelsTitle, onReelClick }: CollabReviewsVaultProps) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("bmg_vault_open") === "1";
    } catch {
      return false;
    }
  });
  const [expanded, setExpanded] = useState(open);      // развёрнута ли высота контента
  const [bladesAway, setBladesAway] = useState(open);  // разъехались ли створки
  const [contentShown, setContentShown] = useState(open); // видим ли контент (fade)
  const timers = useRef<number[]>([]);
  const busy = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem("bmg_vault_open", open ? "1" : "0");
    } catch { /* localStorage недоступен — игнорируем */ }
  }, [open]);

  useEffect(() => () => {
    timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  const toggle = () => {
    if (busy.current) return;
    busy.current = true;
    if (open) {
      // Закрытие: контент гаснет → створки сходятся → высота схлопывается
      setOpen(false);
      setContentShown(false);
      timers.current.push(window.setTimeout(() => setBladesAway(false), 110));
      timers.current.push(window.setTimeout(() => setExpanded(false), 560));
      timers.current.push(window.setTimeout(() => { busy.current = false; }, 860));
    } else {
      // Открытие: высота разворачивается → створки разъезжаются → контент проявляется
      setOpen(true);
      setExpanded(true);
      timers.current.push(window.setTimeout(() => setBladesAway(true), 160));
      timers.current.push(window.setTimeout(() => setContentShown(true), 340));
      timers.current.push(window.setTimeout(() => { busy.current = false; }, 920));
    }
  };

  const hasArtists = Array.isArray(artists) && artists.length > 0;
  const hasReels = Array.isArray(reels) && reels.length > 0;

  return (
    <section
      className="w-full border-t-2 border-primary"
      style={{ background: "radial-gradient(ellipse 100% 60% at 50% 0%, #1c1c1c 0%, #0a0a0a 65%)" }}
      data-testid="section-vault"
    >
      {/* ── Створки + содержимое (клик = открыть/закрыть) ── */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="vault-content"
        className="group w-full"
        data-testid="vault-toggle"
      >
      <div className="relative min-h-[44px] sm:min-h-[52px]" id="vault-content">
        {/* Содержимое (высота разворачивается) */}
        <div className={`grid transition-[grid-template-rows] duration-500 ease-out ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="min-h-0 overflow-hidden">
            <div className={`transition-opacity duration-500 ${contentShown ? "opacity-100" : "opacity-0"}`}>
              {hasArtists && (
                <div>
                  {/* ── Мобильный заголовок (только sm-) ── */}
                  <div className="flex sm:hidden items-center justify-between px-4 pt-4 pb-1">
                    <span className="text-[10px] font-mono tracking-[0.3em] uppercase text-zinc-300">
                      Коллаборации
                    </span>
                    <Link
                      href={artistsLinkUrl}
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
                        {artists.map((artist: any, idx: number) => {
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
                                    src={getOptimizedImageSmallUrl(getOptimizedImageUrl(artist.image))}
                                    alt={artist.name}
                                    loading={idx < 2 ? "eager" : "lazy"}
                                    // @ts-ignore fetchpriority is valid on <img> but missing from current @types/react
                                    fetchpriority={idx < 2 ? "high" : "auto"}
                                    decoding="async"
                                    width={86}
                                    height={110}
                                    data-stage="small"
                                    onError={(e) => {
                                      const el = e.currentTarget;
                                      const thumb = getOptimizedImageUrl(artist.image);
                                      const original = artist.image;
                                      // small → 800px thumb → оригинал
                                      if (thumb && el.getAttribute("data-stage") === "small") {
                                        el.setAttribute("data-stage", "thumb");
                                        el.src = thumb;
                                      } else if (original && el.src !== original) {
                                        el.setAttribute("data-stage", "original");
                                        el.src = original;
                                      }
                                    }}
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
                      href={artistsLinkUrl}
                      className="hidden sm:flex shrink-0 items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-zinc-300 hover:text-white transition-all duration-200 px-5 lg:px-7 border-l border-zinc-800 group"
                      data-testid="link-all-artists-strip"
                    >
                      <span className="whitespace-nowrap">Все</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  </div>
                </div>
              )}

              {hasReels && (
                <div className={hasArtists ? "border-t border-zinc-800" : ""}>
                  {/* ── Мобильный заголовок (только sm-) ── */}
                  <div className="flex sm:hidden items-center px-4 pt-4 pb-1">
                    <span className="text-[10px] font-mono tracking-[0.3em] uppercase text-zinc-300">
                      {reelsTitle}
                    </span>
                  </div>
                  {/* ── Лента обзоров ── */}
                  <div className="flex items-stretch">
                    <div className="hidden sm:flex shrink-0 items-center justify-center px-5 lg:px-7 border-r border-zinc-800">
                      <span className="text-[11px] font-mono tracking-[0.3em] uppercase text-zinc-300 whitespace-nowrap" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                        {reelsTitle}
                      </span>
                    </div>
                    <div className="flex-1 relative overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 w-8 sm:w-12 bg-gradient-to-r from-zinc-950 to-transparent z-10 pointer-events-none" />
                      <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-l from-zinc-950 to-transparent z-10 pointer-events-none" />
                      <div
                        className="flex items-end gap-3 sm:gap-4 overflow-x-auto px-4 sm:px-6 py-5 sm:py-6"
                        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                      >
                        {reels.map((item: any, idx: number) => (
                          <ReelPill key={item.id || idx} item={item} onClick={() => onReelClick(item)} />
                        ))}
                        <div className="shrink-0 w-10 sm:w-16" />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Створки ── */}
        <div className={`absolute inset-0 z-10 flex ${bladesAway ? "vault-blades-away" : ""}`} aria-hidden="true">
          {/* Левая створка */}
          <div className="vault-blade vault-blade-left relative w-1/2 h-full bg-[#101010] overflow-hidden flex items-center justify-center">
            {/* Текст + стрелка */}
            <div className="flex items-center gap-2 select-none">
              <span className="text-[11px] sm:text-xs font-bold tracking-[0.25em] uppercase text-zinc-300 group-hover:text-white transition-colors">
                Коллаборации
              </span>
              <ChevronDown className="w-3 h-3 text-primary/60 -rotate-90" />
            </div>
          </div>
          {/* Правая створка */}
          <div className="vault-blade vault-blade-right relative w-1/2 h-full bg-[#101010] overflow-hidden flex items-center justify-center">
            {/* Текст + стрелка */}
            <div className="flex items-center gap-2 select-none">
              <ChevronDown className="w-3 h-3 text-primary/60 rotate-90" />
              <span className="text-[11px] sm:text-xs font-bold tracking-[0.25em] uppercase text-zinc-300 group-hover:text-white transition-colors">
                Обзоры
              </span>
            </div>
          </div>
          {/* ── Центральный элемент — «нажми сюда» ── */}
          <div
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 transition-all duration-500 ${bladesAway ? "opacity-0 scale-50" : "opacity-100 scale-100"}`}
          >
            {/* Пульсирующее кольцо — привлекает внимание */}
            <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
            {/* Орб с градиентным кольцом */}
            <div className="relative w-9 h-9 sm:w-11 sm:h-11 rounded-full p-[2px] bg-gradient-to-tr from-primary via-red-500 to-orange-400 group-hover:scale-110 transition-transform duration-300 group-active:scale-95 cursor-pointer shadow-[0_0_20px_rgba(229,57,53,0.45)]">
              <div className="w-full h-full rounded-full bg-[#0a0a0a] flex items-center justify-center">
                <ChevronsLeftRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
              </div>
            </div>
          </div>
        </div>
      </div>
      </button>

      {/* ── CTA: Мерч на заказ — всегда виден под люком ── */}
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
    </section>
  );
}