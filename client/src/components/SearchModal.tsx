import { useState, useEffect, useCallback, useRef } from "react";
import { Search, X, Loader2, ArrowRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Product } from "@shared/schema";
import { useWholesalePrice } from "@/hooks/use-auth";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);
  const { isWholesale, getWholesalePrice } = useWholesalePrice();
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<{ products: Product[] }>({
    queryKey: [`/api/products?search=${encodeURIComponent(debouncedSearch)}&limit=6`],
    enabled: debouncedSearch.length >= 2,
  });

  const handleClose = useCallback(() => {
    setSearchQuery("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    
    if (isOpen) {
      document.addEventListener("keydown", handleEsc);
      document.body.style.overflow = "hidden";
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleClose]);

  const products = (data?.products || []).filter(
    (p) => !isWholesale || ((p as any).wholesalePrice && (p as any).wholesalePrice > 0)
  );

  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimating(true)));
    } else {
      setAnimating(false);
      const t = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-[100]" onClick={handleClose}>
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-xl"
        style={{
          opacity: animating ? 1 : 0,
          transition: "opacity 0.2s ease-out",
        }}
      />

      <div className="relative w-full h-full flex flex-col items-center pt-4 sm:pt-20 px-3 sm:px-4">
        <div
          ref={modalRef}
          className="w-full max-w-xl"
          onClick={(e) => e.stopPropagation()}
          style={{
            opacity: animating ? 1 : 0,
            transform: animating ? "translateY(0) scale(1)" : "translateY(-12px) scale(0.97)",
            transition: "opacity 0.2s ease-out, transform 0.2s ease-out",
          }}
        >
          <div className="bg-card/85 backdrop-blur-2xl border border-border/50 rounded-2xl shadow-xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-border/40">
              <Search className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Например: тёплый костюм, чёрные джоггеры..."
                className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 outline-none text-base sm:text-lg font-normal"
                data-testid="input-search"
              />
              {isLoading && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin flex-shrink-0" />}
              <button
                onClick={handleClose}
                className="p-1.5 hover:bg-muted rounded-lg transition-colors flex-shrink-0 text-muted-foreground hover:text-foreground"
                data-testid="button-close-search"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>

            <div className="max-h-[55vh] sm:max-h-[60vh] overflow-y-auto overscroll-contain">
              {debouncedSearch.length < 2 ? (
                <div className="py-10 sm:py-14 text-center">
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-muted/60 rounded-full text-muted-foreground text-xs sm:text-sm">
                    <Search className="w-3 h-3" />
                    <span>Начните вводить запрос</span>
                  </div>
                </div>
              ) : products.length === 0 && !isLoading ? (
                <div className="py-10 sm:py-14 text-center">
                  <p className="text-foreground/70 text-sm font-medium">Ничего не найдено</p>
                  <p className="text-muted-foreground text-xs mt-1">Попробуйте другой запрос</p>
                </div>
              ) : (
                <div className="py-1">
                  {products.map((product, index) => (
                    <Link
                      key={product.id}
                      href={`/${product.slug || product.id}`}
                      onClick={handleClose}
                      className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-2.5 sm:py-3 hover:bg-muted/50 active:bg-muted/70 transition-colors cursor-pointer group"
                      data-testid={`search-result-${product.id}`}
                    >
                      <div className="w-11 h-14 sm:w-12 sm:h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0 border border-border/30">
                        {product.images?.[0] ? (
                          <img
                            src={product.images[0]}
                            alt={`${product.name} BOOOMERANGS`}
                            title={product.name}
                            className="w-full h-full object-cover"
                            loading={index < 3 ? "eager" : "lazy"}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            <Search className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-foreground text-sm sm:text-base font-medium truncate group-hover:text-primary transition-colors leading-snug">
                          {product.name}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-sm font-bold ${product.onSale ? 'text-primary' : 'text-foreground/80'}`}>
                            {((isWholesale ? (getWholesalePrice(product.price, (product as any).wholesalePrice, (product as any).wholesaleDiscountPercent) || product.price) : product.price) / 100).toLocaleString()} ₽
                          </span>
                          {product.onSale && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-black text-white tracking-widest uppercase font-medium">
                              SALE
                            </span>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {products.length > 0 && (
              <Link
                href={`/products?search=${encodeURIComponent(searchQuery)}`}
                onClick={handleClose}
                className="flex items-center justify-center gap-2 py-3 border-t border-border/40 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors w-full cursor-pointer font-medium tracking-wide"
                data-testid="link-view-all-results"
              >
                <span>Смотреть все результаты</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>

          <p className="text-center text-muted-foreground/50 text-xs mt-3 hidden sm:block tracking-wider">
            ESC — закрыть
          </p>
        </div>
      </div>
    </div>
  );
}
