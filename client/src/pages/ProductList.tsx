import { usePaginatedProducts } from "@/hooks/use-products";
import { ProductCard } from "@/components/ProductCard";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Loader2 } from "lucide-react";
import { useMemo, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { CATEGORIES, CategorySlug } from "@shared/schema";

export default function ProductList() {
  const [search, setSearch] = useState(window.location.search);
  
  useEffect(() => {
    const handleLocationChange = () => setSearch(window.location.search);
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);
  
  const navigate = useCallback((path: string) => {
    window.history.pushState(null, "", path);
    setSearch(new URL(path, window.location.origin).search);
  }, []);
  
  const params = useMemo(() => new URLSearchParams(search), [search]);
  
  const categoryParam = params.get("category") as CategorySlug | null;
  const subcategoryParam = params.get("subcategory");
  const saleParam = params.get("sale") === "true";
  
  const { 
    data, 
    isLoading, 
    error, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage 
  } = usePaginatedProducts(24, categoryParam || undefined, subcategoryParam || undefined, saleParam);

  const allProducts = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap(page => page.products);
  }, [data]);

  const currentCategory = categoryParam ? CATEGORIES[categoryParam] : null;
  const subcategories = currentCategory?.subcategories || [];

  const pagination = data?.pages[0]?.pagination;

  const handleCategoryChange = (cat: CategorySlug | "all") => {
    if (cat === "all") {
      navigate("/products");
    } else if (cat === "sale") {
      navigate("/products?sale=true");
    } else {
      navigate(`/products?category=${cat}`);
    }
  };

  const handleSubcategoryChange = (sub: string | null) => {
    if (sub) {
      navigate(`/products?category=${categoryParam}&subcategory=${encodeURIComponent(sub)}`);
    } else {
      navigate(`/products?category=${categoryParam}`);
    }
  };

  const getTitle = () => {
    if (saleParam) return "Распродажа";
    if (currentCategory) {
      if (subcategoryParam) return subcategoryParam;
      return currentCategory.name;
    }
    return "Все товары";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin" data-testid="loader-products" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-white">
        <h2 className="font-display text-2xl mb-4">Ошибка подключения</h2>
        <button onClick={() => window.location.reload()} className="text-primary underline" data-testid="button-retry">Повторить</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="pt-32 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between mb-8 sm:mb-12 gap-2">
          <h1 className="font-display text-4xl sm:text-5xl md:text-7xl text-white uppercase tracking-tighter">
            {getTitle()}
          </h1>
          {pagination && (
            <span className="text-zinc-500 font-mono text-sm" data-testid="text-product-count">
              {allProducts.length} из {pagination.total}
            </span>
          )}
        </div>

        {/* Main Categories */}
        <div className="flex flex-nowrap overflow-x-auto pb-4 mb-4 gap-2 sm:gap-3 no-scrollbar border-b border-zinc-800 lg:flex-wrap lg:overflow-visible lg:pb-6">
          <button
            onClick={() => handleCategoryChange("all")}
            data-testid="button-category-all"
            className={`font-mono text-[10px] sm:text-sm uppercase tracking-wider px-4 sm:px-6 py-2 sm:py-3 border whitespace-nowrap transition-all ${
              !categoryParam && !saleParam
                ? "bg-primary border-primary text-white" 
                : "bg-transparent border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white"
            }`}
          >
            Все
          </button>
          {(Object.keys(CATEGORIES) as CategorySlug[]).map(slug => (
            <button
              key={slug}
              onClick={() => handleCategoryChange(slug)}
              data-testid={`button-category-${slug}`}
              className={`font-mono text-[10px] sm:text-sm uppercase tracking-wider px-4 sm:px-6 py-2 sm:py-3 border whitespace-nowrap transition-all ${
                (categoryParam === slug || (slug === "sale" && saleParam))
                  ? "bg-primary border-primary text-white" 
                  : "bg-transparent border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white"
              }`}
            >
              {CATEGORIES[slug].name}
            </button>
          ))}
        </div>

        {/* Subcategories */}
        {subcategories.length > 0 && (
          <div className="flex flex-nowrap overflow-x-auto pb-4 mb-8 gap-2 no-scrollbar lg:flex-wrap lg:overflow-visible lg:pb-6">
            <button
              onClick={() => handleSubcategoryChange(null)}
              data-testid="button-subcategory-all"
              className={`font-mono text-[10px] sm:text-xs tracking-wider px-3 sm:px-4 py-1.5 sm:py-2 border whitespace-nowrap transition-all ${
                !subcategoryParam
                  ? "bg-zinc-800 border-zinc-700 text-white" 
                  : "bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
              }`}
            >
              Все {currentCategory?.name}
            </button>
            {subcategories.map(sub => (
              <button
                key={sub}
                onClick={() => handleSubcategoryChange(sub)}
                data-testid={`button-subcategory-${sub}`}
                className={`font-mono text-[10px] sm:text-xs tracking-wider px-3 sm:px-4 py-1.5 sm:py-2 border whitespace-nowrap transition-all ${
                  subcategoryParam === sub
                    ? "bg-zinc-800 border-zinc-700 text-white" 
                    : "bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                }`}
              >
                {sub}
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 sm:gap-x-6 gap-y-8 sm:gap-y-12">
          {allProducts.length === 0 ? (
            <div className="col-span-full text-center py-20 text-zinc-500 font-mono" data-testid="text-empty-category">
              Товары в этой категории не найдены.
            </div>
          ) : (
            allProducts.map((product, index) => (
              <ProductCard key={product.id} product={product} priority={index < 8} />
            ))
          )}
        </div>

        {/* Load More Button */}
        {hasNextPage && (
          <div className="flex justify-center mt-12">
            <Button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              variant="outline"
              size="lg"
              className="font-mono uppercase tracking-wider border-zinc-700 hover:bg-zinc-800"
              data-testid="button-load-more"
            >
              {isFetchingNextPage ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Загрузка...
                </>
              ) : (
                "Показать ещё"
              )}
            </Button>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
