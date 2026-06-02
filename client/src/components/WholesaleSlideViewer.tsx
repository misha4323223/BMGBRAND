import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";

interface WholesaleSlideViewerProps {
  slides: string[];
}

export default function WholesaleSlideViewer({ slides }: WholesaleSlideViewerProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [animated, setAnimated] = useState(false);
  const [loadedPages, setLoadedPages] = useState<Set<number>>(new Set([0]));

  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const lastScrollPage = useRef(0);
  const numPages = slides.length;

  const fmt = (n: number) => String(n).padStart(2, "0");

  // Preload neighbours
  useEffect(() => {
    const toPreload = [currentPage - 1, currentPage, currentPage + 1].filter(
      (i) => i >= 0 && i < numPages
    );
    setLoadedPages((prev) => {
      const next = new Set(prev);
      toPreload.forEach((i) => next.add(i));
      return next;
    });
  }, [currentPage, numPages]);

  // Scroll-based page detection
  useEffect(() => {
    if (!numPages) return;
    const handleScroll = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const containerTop = rect.top;
      const containerHeight = rect.height;
      const vh = window.innerHeight;
      if (containerTop > 0 || containerTop < -(containerHeight - vh)) return;
      const scrolledInContainer = -containerTop;
      const scrollableDistance = containerHeight - vh;
      if (scrollableDistance <= 0) return;
      const rawPage = (scrolledInContainer / scrollableDistance) * (numPages - 1);
      const newPage = Math.max(0, Math.min(numPages - 1, Math.round(rawPage)));
      if (newPage !== lastScrollPage.current) {
        lastScrollPage.current = newPage;
        setAnimated(true);
        setCurrentPage(newPage);
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [numPages]);

  const goTo = useCallback(
    (idx: number) => {
      if (!containerRef.current || numPages <= 1) return;
      const container = containerRef.current;
      const containerTop = container.getBoundingClientRect().top + window.scrollY;
      const containerHeight = container.clientHeight;
      const vh = window.innerHeight;
      const scrollableDistance = containerHeight - vh;
      const targetScroll = containerTop + (idx / (numPages - 1)) * scrollableDistance;
      window.scrollTo({ top: targetScroll, behavior: "smooth" });
    },
    [numPages]
  );

  const handlePrev = useCallback(() => {
    if (currentPage > 0) goTo(currentPage - 1);
  }, [currentPage, goTo]);

  const handleNext = useCallback(() => {
    if (currentPage < numPages - 1) goTo(currentPage + 1);
  }, [currentPage, numPages, goTo]);

  const skipToOrder = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const bottom = container.getBoundingClientRect().bottom + window.scrollY;
    window.scrollTo({ top: bottom, behavior: "smooth" });
  }, []);

  // Keyboard
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") handleNext();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") handlePrev();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleNext, handlePrev]);

  // Touch swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
      if (dx < 0) handleNext();
      else handlePrev();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const containerHeight = numPages > 1 ? numPages * 100 : 100;
  if (!numPages) return null;

  return (
    <div
      ref={containerRef}
      style={{ height: `${containerHeight}vh` }}
      className="relative w-full"
    >
      <div
        style={{ height: "100svh" }}
        className="sticky top-0 w-full bg-black overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Progress bar — top */}
        <div className="absolute top-0 left-0 right-0 z-30 flex gap-1.5 px-6 pt-2.5">
          {Array.from({ length: numPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className="flex-1 h-[2px] relative rounded-full overflow-hidden cursor-pointer group"
              data-testid={`btn-slide-progress-${i}`}
            >
              <div className="absolute inset-0 bg-white/15 rounded-full" />
              <div
                className={`absolute inset-0 rounded-full transition-all duration-300 ${
                  i <= currentPage ? "bg-white" : "bg-transparent"
                }`}
              />
            </button>
          ))}
        </div>

        {/* Editorial counter — bottom left */}
        <div className="absolute left-6 bottom-16 z-20 pointer-events-none select-none">
          <span
            className="font-black leading-none tabular-nums block"
            style={{
              fontSize: "clamp(56px, 9vw, 110px)",
              letterSpacing: "-0.04em",
              color: "rgba(255,255,255,0.07)",
            }}
          >
            {fmt(currentPage + 1)}
          </span>
          <div className="flex items-center gap-2 -mt-1">
            <div className="h-px w-5 bg-white/20" />
            <span className="text-[10px] text-white/25 uppercase tracking-widest tabular-nums">
              {fmt(numPages)}
            </span>
          </div>
        </div>

        {/* Slides — horizontal position */}
        <div className="absolute inset-0 pt-5">
          {slides.map((src, i) => {
            const wasLoaded = loadedPages.has(i);
            const offset = (i - currentPage) * 100;
            return (
              <div
                key={src}
                className="absolute inset-0"
                style={{
                  transform: `translateX(${offset}%)`,
                  transition: animated ? "transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)" : "none",
                }}
              >
                {wasLoaded && (
                  <img
                    src={src}
                    alt={`Слайд ${i + 1}`}
                    className="w-full h-full object-contain"
                    loading={i === 0 ? "eager" : "lazy"}
                    draggable={false}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Invisible click zones left/right */}
        {numPages > 1 && (
          <>
            <button
              onClick={handlePrev}
              disabled={currentPage === 0}
              className="absolute left-0 top-10 bottom-20 w-1/4 z-20 cursor-pointer disabled:cursor-default"
              style={{ opacity: 0 }}
              data-testid="btn-slide-zone-prev"
              aria-label="Предыдущий слайд"
            />
            <button
              onClick={handleNext}
              disabled={currentPage === numPages - 1}
              className="absolute right-0 top-10 bottom-20 w-1/4 z-20 cursor-pointer disabled:cursor-default"
              style={{ opacity: 0 }}
              data-testid="btn-slide-zone-next"
              aria-label="Следующий слайд"
            />
          </>
        )}

        {/* Arrow buttons — bottom right */}
        {numPages > 1 && (
          <div className="absolute bottom-7 right-6 z-30 flex items-center gap-2">
            <button
              onClick={handlePrev}
              disabled={currentPage === 0}
              className="w-9 h-9 rounded-full border border-white/20 hover:border-white/50 flex items-center justify-center text-white/50 hover:text-white disabled:opacity-15 disabled:cursor-not-allowed transition-all"
              data-testid="btn-slide-prev"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleNext}
              disabled={currentPage === numPages - 1}
              className="w-9 h-9 rounded-full border border-white/20 hover:border-white/50 flex items-center justify-center text-white/50 hover:text-white disabled:opacity-15 disabled:cursor-not-allowed transition-all"
              data-testid="btn-slide-next"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Skip to order — bottom center */}
        <button
          onClick={skipToOrder}
          className="absolute bottom-7 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 border border-white/20 hover:border-white/50 bg-white/5 hover:bg-white/10 backdrop-blur-sm text-white/60 hover:text-white transition-all px-5 py-2 rounded-full text-[10px] uppercase tracking-[0.18em] font-semibold whitespace-nowrap"
          data-testid="btn-skip-to-order"
        >
          Перейти к заказу
          <ChevronDown className="w-3 h-3" />
        </button>

        {/* Scroll hint — only on first slide */}
        {currentPage === 0 && numPages > 1 && (
          <div className="absolute top-1/2 right-6 -translate-y-1/2 flex flex-col items-center gap-1.5 pointer-events-none select-none animate-bounce z-20">
            <span className="text-[9px] text-white/20 uppercase tracking-widest" style={{ writingMode: "vertical-rl" }}>
              скролл
            </span>
            <ChevronRight className="w-3 h-3 text-white/20 rotate-90" />
          </div>
        )}

        {/* Bottom gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-b from-transparent to-black/80 pointer-events-none z-10" />
      </div>
    </div>
  );
}
