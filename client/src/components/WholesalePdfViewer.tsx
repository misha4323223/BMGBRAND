import { useEffect, useRef, useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface WholesalePdfViewerProps {
  pdfUrl: string;
}

export default function WholesalePdfViewer({ pdfUrl }: WholesalePdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [pageWidth, setPageWidth] = useState<number>(800);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [animDir, setAnimDir] = useState<"next" | "prev" | null>(null);
  const [displayPage, setDisplayPage] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);

  const updatePageWidth = useCallback(() => {
    if (stickyRef.current) {
      const w = stickyRef.current.clientWidth;
      setPageWidth(Math.min(w - 32, 900));
    }
  }, []);

  useEffect(() => {
    updatePageWidth();
    window.addEventListener("resize", updatePageWidth);
    return () => window.removeEventListener("resize", updatePageWidth);
  }, [updatePageWidth]);

  useEffect(() => {
    if (!numPages || !isLoaded) return;

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
      const rawPage = Math.round((scrolledInContainer / scrollableDistance) * (numPages - 1));
      const newPage = Math.max(0, Math.min(numPages - 1, rawPage));

      if (newPage !== currentPage) {
        setAnimDir(newPage > currentPage ? "next" : "prev");
        setCurrentPage(newPage);
        setTimeout(() => {
          setDisplayPage(newPage);
          setAnimDir(null);
        }, 220);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [numPages, isLoaded, currentPage]);

  useEffect(() => {
    setDisplayPage(currentPage);
  }, []);

  const goTo = useCallback((idx: number) => {
    if (!containerRef.current || !numPages) return;
    const container = containerRef.current;
    const containerTop = container.getBoundingClientRect().top + window.scrollY;
    const containerHeight = container.clientHeight;
    const vh = window.innerHeight;
    const scrollableDistance = containerHeight - vh;
    const targetScroll = containerTop + (idx / (numPages - 1)) * scrollableDistance;
    window.scrollTo({ top: targetScroll, behavior: "smooth" });
  }, [numPages]);

  const handlePrev = () => {
    if (currentPage > 0) goTo(currentPage - 1);
  };

  const handleNext = () => {
    if (currentPage < numPages - 1) goTo(currentPage + 1);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") handleNext();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") handlePrev();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentPage, numPages]);

  const stickyHeight = "100svh";
  const containerHeight = numPages > 1 ? numPages * 100 : 100;

  return (
    <div
      ref={containerRef}
      style={{ height: `${containerHeight}vh` }}
      className="relative w-full"
    >
      <div
        ref={stickyRef}
        style={{ height: stickyHeight }}
        className="sticky top-0 w-full bg-[#111] overflow-hidden flex flex-col"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-black/60 backdrop-blur-sm border-b border-white/10 z-10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-medium">
              BOOOMERANGS / Коллекция
            </span>
            <span className="w-1 h-1 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-primary font-semibold">
              Презентация
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/40 tabular-nums">
              {isLoaded ? `${currentPage + 1} / ${numPages}` : "..."}
            </span>
          </div>
        </div>

        {/* PDF Page */}
        <div className="flex-1 flex items-center justify-center overflow-hidden relative">
          {!isLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-white/40 text-sm">Загрузка презентации...</span>
            </div>
          )}

          <div
            ref={pageRef}
            className={`transition-all duration-200 ease-in-out ${
              animDir === "next"
                ? "opacity-0 translate-y-2"
                : animDir === "prev"
                ? "opacity-0 -translate-y-2"
                : "opacity-100 translate-y-0"
            }`}
          >
            <Document
              file={pdfUrl}
              onLoadSuccess={({ numPages: n }) => {
                setNumPages(n);
                setIsLoaded(true);
              }}
              loading={null}
              error={
                <div className="text-white/50 text-sm text-center p-8">
                  Не удалось загрузить презентацию
                </div>
              }
            >
              <Page
                pageIndex={displayPage}
                width={pageWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="shadow-2xl rounded-sm"
              />
            </Document>
          </div>
        </div>

        {/* Navigation */}
        {isLoaded && numPages > 1 && (
          <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-black/60 backdrop-blur-sm border-t border-white/10">
            {/* Prev */}
            <button
              onClick={handlePrev}
              disabled={currentPage === 0}
              className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10"
              data-testid="btn-pdf-prev"
            >
              <ChevronLeft className="w-4 h-4" />
              Назад
            </button>

            {/* Dots */}
            <div className="flex items-center gap-1.5 overflow-hidden max-w-[200px]">
              {Array.from({ length: numPages }).map((_, i) => {
                const dist = Math.abs(i - currentPage);
                if (dist > 5) return null;
                return (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    className={`rounded-full transition-all duration-200 ${
                      i === currentPage
                        ? "w-5 h-1.5 bg-primary"
                        : "w-1.5 h-1.5 bg-white/20 hover:bg-white/40"
                    }`}
                    data-testid={`btn-pdf-dot-${i}`}
                  />
                );
              })}
            </div>

            {/* Next */}
            <button
              onClick={handleNext}
              disabled={currentPage === numPages - 1}
              className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10"
              data-testid="btn-pdf-next"
            >
              Вперёд
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Scroll hint — only on first page */}
        {isLoaded && currentPage === 0 && numPages > 1 && (
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none select-none animate-bounce">
            <span className="text-[10px] text-white/30 uppercase tracking-widest">Листай</span>
            <ChevronRight className="w-3 h-3 text-white/30 rotate-90" />
          </div>
        )}
      </div>
    </div>
  );
}
