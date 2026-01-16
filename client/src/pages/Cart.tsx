import { useCart, useRemoveFromCart, useClearCart } from "@/hooks/use-cart";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Link, useLocation } from "wouter";
import { Trash2, ArrowRight, ShoppingBag, ArrowLeft } from "lucide-react";
import { Loader2 } from "lucide-react";

export default function Cart() {
  const { data: cartItems, isLoading } = useCart();
  const removeFromCart = useRemoveFromCart();
  const clearCart = useClearCart();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
      </div>
    );
  }

  const subtotal = cartItems?.reduce((acc, item) => acc + (item.product.price * item.quantity), 0) || 0;
  
  const formatPrice = (cents: number) => {
    // The price is stored in cents (multiplied by 100 during import)
    // To display correctly, we use it as is if it was already in rubles or divide if it was truly cents
    // Given the current log showing 35000, it's likely 350 rubles.
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
    }).format(cents / 100);
  };

  return (
    <div className="min-h-screen bg-background text-white">
      <Navbar />

      <div className="pt-32 pb-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="font-display text-5xl md:text-6xl mb-12 uppercase tracking-tighter">Корзина</h1>

        {!cartItems || cartItems.length === 0 ? (
          <div className="text-center py-24 border border-zinc-900 bg-zinc-950/50">
            <ShoppingBag className="w-16 h-16 mx-auto mb-6 text-zinc-700" />
            <p className="font-mono text-zinc-500 mb-8 text-lg">Ваша корзина пуста.</p>
            <Link href="/products">
              <button className="bg-primary text-white px-8 py-3 font-display uppercase tracking-widest hover:bg-red-600 transition-colors">
                Перейти к покупкам
              </button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-8">
              {cartItems.map((item) => (
                <div key={item.id} className="flex gap-6 p-4 border border-zinc-900 bg-zinc-950 hover:border-zinc-800 transition-colors">
                  <div className="w-24 h-32 flex-shrink-0 bg-zinc-900 overflow-hidden">
                    <img src={item.product.imageUrl} alt={item.product.name} className="w-full h-full object-cover" />
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-display text-xl uppercase tracking-wide">{item.product.name}</h3>
                        <p className="font-mono font-bold text-lg">{formatPrice(item.product.price * item.quantity)}</p>
                      </div>
                      <p className="font-mono text-zinc-500 text-sm">
                        {item.size} / {item.color}
                      </p>
                    </div>
                    
                    <div className="flex justify-between items-end">
                      <p className="font-mono text-sm text-zinc-500">Кол-во: {item.quantity}</p>
                      <button 
                        onClick={() => removeFromCart.mutate({
                          id: item.id,
                          sessionId: item.sessionId,
                          productId: item.productId,
                          size: item.size,
                          color: item.color,
                        })}
                        className="text-zinc-600 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              
              <button 
                onClick={() => clearCart.mutate()}
                className="text-xs font-mono uppercase text-zinc-500 hover:text-white underline"
              >
                Очистить корзину
              </button>
            </div>

            {/* Summary */}
            <div className="lg:col-span-1">
              <div className="bg-zinc-950 border border-zinc-900 p-8 relative z-[50]">
                <h3 className="font-display text-2xl uppercase mb-8">Итого</h3>
                
                <div className="space-y-4 mb-8 font-mono text-sm">
                  <div className="flex justify-between text-zinc-400">
                    <span>Сумма</span>
                    <span>{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Доставка</span>
                    <span>Бесплатно</span>
                  </div>
                  <div className="border-t border-zinc-800 pt-4 flex justify-between text-white text-lg font-bold">
                    <span>Всего</span>
                    <span>{formatPrice(subtotal)}</span>
                  </div>
                </div>
                
                <div className="relative z-[100]">
                  <button 
                    id="checkout-button-main"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log("Navigating to checkout...");
                      setLocation("/checkout");
                    }}
                    className="w-full bg-white text-black hover:bg-primary hover:text-white h-16 font-display text-2xl uppercase tracking-widest transition-all flex items-center justify-center gap-2 group cursor-pointer active:scale-95"
                  >
                    Оформить заказ <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
                
                <Link href="/products" className="block text-center mt-6 font-mono text-xs text-zinc-500 hover:text-white relative z-[60]">
                  Продолжить покупки
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
