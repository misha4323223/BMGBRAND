import { useProducts } from "@/hooks/use-products";
import { ProductCard } from "@/components/ProductCard";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Loader2 } from "lucide-react";
import { useState } from "react";

export default function ProductList() {
  const { data: products, isLoading, error } = useProducts();
  const [filter, setFilter] = useState<string>("all");

  const categories = ["all", ...Array.from(new Set(products?.map(p => p.category) || []))];

  const filteredProducts = filter === "all" 
    ? products 
    : products?.filter(p => p.category === filter);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-white">
        <h2 className="font-display text-2xl mb-4">Ошибка подключения</h2>
        <button onClick={() => window.location.reload()} className="text-primary underline">Повторить</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="pt-32 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <h1 className="font-display text-4xl sm:text-5xl md:text-7xl text-white mb-8 sm:mb-12 uppercase tracking-tighter">
          Все товары
        </h1>

        {/* Filters */}
        <div className="flex flex-nowrap overflow-x-auto pb-4 mb-8 sm:mb-12 gap-2 sm:gap-3 no-scrollbar border-b border-zinc-800 lg:flex-wrap lg:overflow-visible lg:pb-8">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`font-mono text-[10px] sm:text-sm uppercase tracking-wider px-4 sm:px-6 py-2 sm:py-3 border whitespace-nowrap transition-all ${
                filter === cat 
                  ? "bg-primary border-primary text-white" 
                  : "bg-transparent border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white"
              }`}
            >
              {cat === 'all' ? 'Все' : cat}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 sm:gap-x-6 gap-y-8 sm:gap-y-12">
          {filteredProducts?.length === 0 ? (
            <div className="col-span-full text-center py-20 text-zinc-500 font-mono">
              Товары в этой категории не найдены.
            </div>
          ) : (
            filteredProducts?.map(product => (
              <ProductCard key={product.id} product={product} />
            ))
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
