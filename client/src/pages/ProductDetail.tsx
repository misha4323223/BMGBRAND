import { useRoute, useLocation } from "wouter";
import { useProduct } from "@/hooks/use-products";
import { useAddToCart } from "@/hooks/use-cart";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";

export default function ProductDetail() {
  const [, params] = useRoute("/products/:id");
  const [, setLocation] = useLocation();
  const id = parseInt(params?.id || "0");
  const { data: product, isLoading, error } = useProduct(id);
  const addToCart = useAddToCart();
  
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [selectedColor, setSelectedColor] = useState<string>("");
  const [quantity, setQuantity] = useState(1);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
      </div>
    );
  }

  if (!product || error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-white">
        <h2 className="font-display text-2xl mb-4">Товар не найден</h2>
        <button onClick={() => setLocation("/products")} className="text-primary underline">Вернуться в магазин</button>
      </div>
    );
  }

  const handleAddToCart = () => {
    if (!selectedSize || !selectedColor) {
      // Typically show error toast here
      return;
    }
    addToCart.mutate({
      productId: product.id,
      quantity,
      size: selectedSize,
      color: selectedColor,
    });
  };

  const price = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(product.price);

  return (
    <div className="min-h-screen bg-background text-white">
      <Navbar />
      
      <div className="pt-24 pb-12 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24">
          
          {/* Left: Image Gallery */}
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-4"
          >
            <div className="aspect-[3/4] bg-zinc-900 w-full overflow-hidden">
              <img 
                src={product.imageUrl} 
                alt={product.name} 
                className="w-full h-full object-cover"
              />
            </div>
          </motion.div>

          {/* Right: Details */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col justify-center h-full pt-10 lg:pt-0"
          >
            <div className="mb-2">
              <span className="font-mono text-primary text-sm uppercase tracking-widest">{product.category}</span>
            </div>
            
            <h1 className="font-display text-5xl md:text-6xl uppercase tracking-tighter mb-4 leading-none">
              {product.name}
            </h1>
            
            <p className="font-mono text-2xl font-bold mb-8 text-zinc-300">{price}</p>
            
            <div className="prose prose-invert prose-sm mb-10 text-zinc-400 font-mono leading-relaxed">
              <p>{product.description}</p>
            </div>

            {/* Selectors */}
            <div className="space-y-8 mb-10">
              {/* Color */}
              <div>
                <label className="block font-mono text-xs uppercase text-zinc-500 mb-3">Выберите цвет</label>
                <div className="flex gap-3">
                  {product.colors.map(color => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      className={`h-10 px-4 font-mono text-sm uppercase border transition-all ${
                        selectedColor === color 
                          ? "border-primary bg-primary/10 text-primary" 
                          : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                      }`}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size */}
              <div>
                <label className="block font-mono text-xs uppercase text-zinc-500 mb-3">Выберите размер</label>
                <div className="flex gap-3">
                  {product.sizes.map(size => (
                    <button
                      key={size}
                      onClick={() => setSelectedSize(size)}
                      className={`w-12 h-12 flex items-center justify-center font-mono text-sm uppercase border transition-all ${
                        selectedSize === size 
                          ? "border-primary bg-primary/10 text-primary" 
                          : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity */}
              <div>
                <label className="block font-mono text-xs uppercase text-zinc-500 mb-3">Количество</label>
                <div className="flex items-center w-32 border border-zinc-800">
                  <button 
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-10 h-10 flex items-center justify-center hover:text-primary transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="flex-1 text-center font-mono text-sm">{quantity}</span>
                  <button 
                    onClick={() => setQuantity(quantity + 1)}
                    className="w-10 h-10 flex items-center justify-center hover:text-primary transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Action */}
            <button
              onClick={handleAddToCart}
              disabled={!selectedSize || !selectedColor || addToCart.isPending}
              className={`w-full h-16 flex items-center justify-center gap-3 font-display text-xl uppercase tracking-widest transition-all ${
                !selectedSize || !selectedColor
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                  : "bg-primary text-white hover:bg-red-600"
              }`}
            >
              {addToCart.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <>
                  <ShoppingBag className="w-5 h-5 mb-1" />
                  Добавить в корзину
                </>
              )}
            </button>
            
            {(!selectedSize || !selectedColor) && (
              <p className="mt-4 text-center text-red-500 font-mono text-xs uppercase">
                Пожалуйста, выберите размер и цвет
              </p>
            )}

          </motion.div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
