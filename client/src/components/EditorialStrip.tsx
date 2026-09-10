import { Link } from "wouter";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useRef } from "react";

export type EditorialStripItem = {
  id?: string;
  image?: string;
  label?: string;
  link?: string;
};

type EditorialStripProps = {
  title?: string;
  subtitle?: string;
  items: EditorialStripItem[];
};

/**
 * «Лента с разделителями» — editorial-карусель в стиле COS/Arket:
 * квадратные фото без скруглений, разделённые тонкими линиями 1px,
 * mono-подпись + стрелка под фото, стрелки ← → по краям (desktop).
 * Скролл нативный (scroll-snap), без новых библиотек.
 */
export function EditorialStrip({ title, subtitle, items }: EditorialStripProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const scrollByCard = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-editorial-card]");
    const step = card ? card.offsetWidth + 1 : 320;
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  if (!items || items.length === 0) return null;

  return (
    <section className="py-10 sm:py-16 bg-background">
      <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4 mb-6 sm:mb-10">
          <div className="min-w-0">
            {subtitle && (
              <p className="font-mono text-[10px] sm:text-xs uppercase tracking-[0.25em] text-zinc-400 mb-1.5 truncate">
                {subtitle}
              </p>
            )}
            {title && (
              <h2
                style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
                className="text-2xl sm:text-4xl font-bold uppercase tracking-tight leading-none text-foreground"
              >
                {title}
              </h2>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-label="Предыдущие"
              onClick={() => scrollByCard(-1)}
              className="p-2 -m-1 text-zinc-500 hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="Следующие"
              onClick={() => scrollByCard(1)}
              className="p-2 -m-1 text-zinc-500 hover:text-foreground transition-colors"
            >
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      <div className="relative border-y border-border/40">
        <div className="absolute left-0 top-0 bottom-0 w-6 sm:w-16 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-6 sm:w-16 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />

        <div
          ref={trackRef}
          className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory divide-x divide-border/60"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {items.map((item, idx) => (
            <Link
              key={item.id || idx}
              href={item.link || "/products"}
              data-editorial-card
              className="group relative shrink-0 snap-start w-[44vw] sm:w-[280px] lg:w-[320px] bg-background flex flex-col"
            >
              <div className="aspect-square overflow-hidden bg-zinc-100">
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.label || ""}
                    loading="lazy"
                    decoding="async"
                    sizes="(max-width: 640px) 44vw, 320px"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-950">
                    <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40 px-4 text-center">
                      {item.label || "—"}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 px-2 py-3 sm:py-4">
                <span className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-zinc-700 group-hover:text-foreground transition-colors truncate">
                  {item.label || "Смотреть"}
                </span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0 text-zinc-400 transition-all duration-300 group-hover:translate-x-1 group-hover:text-foreground" strokeWidth={1.5} />
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="sm:hidden flex items-center justify-center gap-1.5 mt-4 text-muted-foreground text-xs">
        <span>Листайте</span>
        <ArrowRight className="w-3 h-3 animate-pulse" />
      </div>
    </section>
  );
}