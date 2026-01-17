import { Link } from "wouter";
import { useState } from "react";
import { Product } from "@shared/schema";

interface ProductCardProps {
  product: Product;
  priority?: boolean;
}

export function ProductCard({ product, priority = false }: ProductCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  
  const price = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(product.price / 100);

  const imageUrl = product.imageUrl;

  return (
    <Link href={`/products/${product.id}`} className="group cursor-pointer block content-auto">
      <div className="relative aspect-[4/5] sm:aspect-[3/4] overflow-hidden bg-zinc-900 mb-2 sm:mb-4">
        {/* Skeleton loader */}
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 bg-zinc-800 animate-pulse flex items-center justify-center">
            <div className="w-12 h-12 border-2 border-zinc-700 border-t-zinc-500 rounded-full animate-spin" />
          </div>
        )}
        
        {/* Error state */}
        {imageError && (
          <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
            <span className="text-zinc-600 font-mono text-xs">Нет фото</span>
          </div>
        )}
        
        <img 
          src={imageUrl} 
          alt={product.name}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
        
        {/* Overlay Tags */}
        <div className="absolute top-4 left-4 flex flex-col gap-2">
          {product.isNew && (
            <span className="bg-primary text-white px-2 py-1 text-xs font-bold uppercase tracking-wider">
              Новинка
            </span>
          )}
        </div>
        
        {/* Hover Quick View Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <span className="border border-white text-white px-6 py-3 font-mono text-sm uppercase tracking-widest hover:bg-white hover:text-black transition-colors">
            Смотреть
          </span>
        </div>
      </div>
      
      <div className="flex flex-col sm:flex-row justify-between items-start gap-1">
        <div>
          <h3 className="font-display text-sm sm:text-xl uppercase text-white group-hover:text-primary transition-colors leading-tight">
            {product.name}
          </h3>
          <p className="text-zinc-500 text-[10px] sm:text-sm font-mono mt-0.5">{product.category}</p>
        </div>
        <span className="font-mono text-white font-bold text-xs sm:text-base">{price}</span>
      </div>
    </Link>
  );
}
