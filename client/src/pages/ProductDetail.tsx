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
    // If product has sizes/colors but none are selected, we might want to allow it if the arrays are empty
    const hasSizes = product.sizes && product.sizes.length > 0;
    const hasColors = product.colors && product.colors.length > 0;

    if ((hasSizes && !selectedSize) || (hasColors && !selectedColor)) {
      return;
    }
    
    addToCart.mutate({
      productId: product.id,
      quantity,
      size: selectedSize || "One Size",
      color: selectedColor || "Default",
    });
  };

  const price = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(product.price / 100);

  return (
    <div className="min-h-screen bg-background text-white">
      <Navbar />
      
      <div className="pt-16 sm:pt-24 pb-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:grid lg:grid-cols-2 gap-6 lg:gap-24">
          
          {/* Details */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col order-1 lg:order-2"
          >
            <div className="flex justify-between items-start mb-2 sm:mb-4">
              <div>
                <span className="font-mono text-primary text-[10px] uppercase tracking-widest block mb-1" data-testid={`text-category-${product.id}`}>{product.category}</span>
                <h1 className="font-display text-2xl sm:text-5xl uppercase tracking-tighter leading-tight" data-testid={`text-product-name-${product.id}`}>
                  {product.name}
                </h1>
              </div>
              <p className="font-mono text-xl sm:text-2xl font-bold text-white shrink-0 ml-4" data-testid={`text-product-price-${product.id}`}>{price}</p>
            </div>
            
            <div className="prose prose-invert prose-xs sm:prose-sm mb-4 sm:mb-10 text-zinc-400 font-mono leading-relaxed">
              <p className="line-clamp-2 sm:line-clamp-none opacity-80" data-testid={`text-product-description-${product.id}`}>{product.description}</p>
            </div>

            {/* Mobile Image Gallery - inserted between description and selectors */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="lg:hidden mb-6"
            >
              <div className="aspect-[4/5] bg-zinc-900/30 w-full overflow-hidden border border-white/5 rounded-none shadow-xl">
                <img 
                  src={product.imageUrl} 
                  alt={product.name} 
                  className="w-full h-full object-cover grayscale-[0.3] hover:grayscale-0 transition-all duration-700"
                />
              </div>
            </motion.div>

            {/* Compact Selectors Grid */}
            <div className="grid grid-cols-1 gap-4 mb-6 sm:mb-10 p-3 sm:p-0 bg-zinc-900/50 sm:bg-transparent border border-white/5 sm:border-0 rounded-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                {/* Color */}
                <div className="flex-1">
                  <label className="block font-mono text-[9px] uppercase text-zinc-500 mb-2 tracking-tighter">Цвет</label>
                  <div className="flex flex-wrap gap-1.5">
                    {product.colors.map(color => (
                      <button
                        key={color}
                        onClick={() => setSelectedColor(color)}
                        data-testid={`button-select-color-${color}`}
                        className={`h-8 px-3 font-mono text-[10px] uppercase border transition-all ${
                          selectedColor === color 
                            ? "border-primary bg-primary text-white" 
                            : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                        }`}
                      >
                        {color}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Size */}
                <div className="flex-1">
                  <label className="block font-mono text-[9px] uppercase text-zinc-500 mb-2 tracking-tighter">Размер</label>
                  <div className="flex flex-wrap gap-1.5">
                    {product.sizes.map(size => (
                      <button
                        key={size}
                        onClick={() => setSelectedSize(size)}
                        data-testid={`button-select-size-${size}`}
                        className={`w-8 h-8 flex items-center justify-center font-mono text-[10px] uppercase border transition-all ${
                          selectedSize === size 
                            ? "border-primary bg-primary text-white" 
                            : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Area */}
              <div className="flex items-center gap-3 pt-2 sm:pt-0 border-t border-white/5 sm:border-0">
                <div className="flex items-center h-10 border border-zinc-800 bg-black/20 px-1">
                  <button 
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    data-testid="button-quantity-decrease"
                    className="w-8 h-8 flex items-center justify-center hover:text-primary transition-colors"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-6 text-center font-mono text-xs" data-testid="text-quantity-value">{quantity}</span>
                  <button 
                    onClick={() => setQuantity(quantity + 1)}
                    data-testid="button-quantity-increase"
                    className="w-8 h-8 flex items-center justify-center hover:text-primary transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                
                <button
                  onClick={handleAddToCart}
                  data-testid="button-add-to-cart"
                  disabled={((product.sizes?.length > 0 && !selectedSize) || (product.colors?.length > 0 && !selectedColor)) || addToCart.isPending}
                  className={`flex-1 h-10 flex items-center justify-center gap-2 font-display text-sm uppercase tracking-widest transition-all ${
                    ((product.sizes?.length > 0 && !selectedSize) || (product.colors?.length > 0 && !selectedColor))
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      : "bg-primary text-white hover:bg-red-600 active:scale-[0.98]"
                  }`}
                >
                  {addToCart.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <ShoppingBag className="w-4 h-4" />
                      Купить
                    </>
                  )}
                </button>
              </div>
            </div>
            
            {((product.sizes?.length > 0 && !selectedSize) || (product.colors?.length > 0 && !selectedColor)) && (
              <p className="mb-4 text-center text-primary/60 font-mono text-[8px] uppercase tracking-widest animate-pulse">
                Выберите {product.sizes?.length > 0 && !selectedSize ? "размер" : ""}{product.sizes?.length > 0 && !selectedSize && product.colors?.length > 0 && !selectedColor ? " и " : ""}{product.colors?.length > 0 && !selectedColor ? "цвет" : ""}
              </p>
            )}
          </motion.div>
          
          {/* Image Gallery - Hidden on mobile, left on desktop */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="hidden lg:block order-2 lg:order-1"
          >
            <div className="aspect-[3/4] bg-zinc-900/30 w-full overflow-hidden border border-white/5">
              <img 
                src={product.imageUrl} 
                alt={product.name} 
                className="w-full h-full object-cover grayscale-[0.3] hover:grayscale-0 transition-all duration-700"
              />
            </div>
          </motion.div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
