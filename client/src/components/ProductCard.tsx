import { Link } from "wouter";
import { motion } from "framer-motion";
import { Product } from "@shared/schema";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  // Format price from cents to currency
  const price = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(product.price / 100);

  // Map database path to static path if needed
  const imageUrl = product.imageUrl;

  return (
    <Link href={`/products/${product.id}`} className="group cursor-pointer block">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative aspect-[4/5] sm:aspect-[3/4] overflow-hidden bg-zinc-900 mb-2 sm:mb-4"
      >
        {/* Dynamic Image from DB or Unsplash fallback */}
        <img 
          src={imageUrl} 
          alt={product.name}
          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500 scale-100 group-hover:scale-105"
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
      </motion.div>
      
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
