import { Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { Product } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShoppingCart, ExternalLink, Minus, Plus } from "lucide-react";
import { useCart } from "@/hooks/use-cart";
import { useToast } from "@/hooks/use-toast";

interface ProductCardProps {
  product: Product;
  priority?: boolean;
}

export function ProductCard({ product, priority = false }: ProductCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(priority);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { addItem } = useCart();
  const { toast } = useToast();
  
  useEffect(() => {
    if (priority && product.thumbnailUrl) {
      const img = new Image();
      img.src = product.thumbnailUrl;
    }
  }, [priority, product.thumbnailUrl]);
  
  const price = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(product.price / 100);

  const imageUrl = product.thumbnailUrl || product.imageUrl;

  useEffect(() => {
    if (priority || shouldLoad) return;
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "800px" }
    );
    
    if (cardRef.current) {
      observer.observe(cardRef.current);
    }
    
    return () => observer.disconnect();
  }, [priority, shouldLoad]);

  const handleAddToCart = () => {
    if (product.sizes?.length > 0 && !selectedSize) {
      toast({
        title: "Выберите размер",
        variant: "destructive",
      });
      return;
    }
    addItem({ 
      productId: product.id, 
      quantity, 
      size: selectedSize || undefined,
      color: selectedColor || undefined
    });
    toast({
      title: "Добавлено в корзину",
      description: `${product.name} (${quantity} шт.)`,
    });
    setIsModalOpen(false);
  };

  return (
    <div ref={cardRef} className="group cursor-pointer block" data-testid={`product-card-${product.id}`}>
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogTrigger asChild>
          <div className="relative aspect-[4/5] sm:aspect-[3/4] overflow-hidden bg-zinc-800 mb-2 sm:mb-4">
            {!imageLoaded && !imageError && (
              <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-500 rounded-full animate-spin" />
              </div>
            )}
            
            {imageError && (
              <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
                <span className="text-zinc-600 font-mono text-xs">Нет фото</span>
              </div>
            )}
            
            {shouldLoad && (
              <img 
                src={imageUrl} 
                alt={product.name}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
                className={`w-full h-full object-cover transition-opacity duration-200 ${
                  imageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
              />
            )}
            
            <div className="absolute top-2 right-2 sm:top-4 sm:right-4 flex flex-col gap-2 z-10">
              {product.isNew && (
                <span className="bg-primary text-white px-1.5 py-0.5 sm:px-2 sm:py-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider">
                  Новинка
                </span>
              )}
            </div>
            
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
              <span className="border border-white text-white px-6 py-3 font-mono text-sm uppercase tracking-widest hover:bg-white hover:text-black transition-colors">
                Просмотр
              </span>
            </div>
          </div>
        </DialogTrigger>

        <DialogContent className="sm:max-w-[600px] bg-zinc-900 border-zinc-800 text-white p-0 overflow-hidden">
          <div className="flex flex-col md:flex-row max-h-[90vh] overflow-y-auto">
            <div className="md:w-1/2 aspect-[3/4]">
              <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
            </div>
            <div className="md:w-1/2 p-6 flex flex-col">
              <DialogHeader className="mb-4">
                <DialogTitle className="font-display text-2xl uppercase tracking-tight">{product.name}</DialogTitle>
                <div className="font-mono text-xl text-primary font-bold">{price}</div>
              </DialogHeader>

              <div className="flex-1 space-y-4">
                <p className="text-zinc-400 text-sm line-clamp-4">{product.description}</p>
                
                {product.sizes && product.sizes.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[10px] uppercase font-mono text-zinc-500">Размер</span>
                    <div className="flex flex-wrap gap-2">
                      {product.sizes.map(size => (
                        <button
                          key={size}
                          onClick={() => setSelectedSize(size)}
                          className={`px-3 py-1 border text-xs font-mono transition-colors ${
                            selectedSize === size 
                              ? "bg-white text-black border-white" 
                              : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-4">
                  <div className="flex items-center border border-zinc-800">
                    <button 
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="p-2 hover:bg-zinc-800 transition-colors"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-10 text-center font-mono">{quantity}</span>
                    <button 
                      onClick={() => setQuantity(quantity + 1)}
                      className="p-2 hover:bg-zinc-800 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <Button 
                  onClick={handleAddToCart}
                  className="w-full bg-white text-black hover:bg-zinc-200 font-mono uppercase tracking-wider py-6"
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  В корзину
                </Button>
                <Link href={`/products/${product.id}`} onClick={() => setIsModalOpen(false)}>
                  <Button 
                    variant="outline"
                    className="w-full border-zinc-800 text-zinc-400 hover:bg-zinc-800 font-mono uppercase tracking-wider py-6"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    На страницу товара
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      <Link href={`/products/${product.id}`}>
        <div className="flex flex-col sm:flex-row justify-between items-start gap-1">
          <div>
            <h3 className="font-display text-sm sm:text-xl uppercase text-white group-hover:text-primary transition-colors leading-tight">
              {product.name}
            </h3>
            <p className="text-zinc-500 text-[10px] sm:text-sm font-mono mt-0.5">{product.subcategory || product.category}</p>
          </div>
          <span className="font-mono text-white font-bold text-xs sm:text-base">{price}</span>
        </div>
      </Link>
    </div>
  );
}
