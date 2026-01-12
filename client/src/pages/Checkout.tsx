import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCart } from "@/hooks/use-cart";
import { useCreateOrder } from "@/hooks/use-orders";
import { useLocation } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Loader2, CheckCircle2 } from "lucide-react";
import { insertOrderSchema } from "@shared/schema";

// Form schema based on insertOrderSchema but simplified for frontend validation
const checkoutSchema = z.object({
  customerName: z.string().min(2, "Имя обязательно"),
  customerEmail: z.string().email("Некорректный email"),
  customerPhone: z.string().min(10, "Номер телефона обязателен"),
  address: z.string().min(10, "Полный адрес обязателен"),
});

type CheckoutForm = z.infer<typeof checkoutSchema>;

export default function Checkout() {
  const { data: cartItems } = useCart();
  const createOrder = useCreateOrder();
  const [, setLocation] = useLocation();
  const [success, setSuccess] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutSchema),
  });

  const subtotal = cartItems?.reduce((acc, item) => acc + (item.product.price * item.quantity), 0) || 0;

  const onSubmit = (data: CheckoutForm) => {
    createOrder.mutate(data, {
      onSuccess: () => {
        setSuccess(true);
        // Normally redirect to a success page, but simple state is fine for this demo
      }
    });
  };

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
    }).format(cents);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-white px-4">
        <CheckCircle2 className="w-24 h-24 text-primary mb-8" />
        <h1 className="font-display text-4xl md:text-6xl uppercase tracking-tighter mb-4 text-center">
          Заказ подтвержден
        </h1>
        <p className="font-mono text-zinc-400 mb-12 text-center max-w-md">
          Спасибо за ваш заказ. Мы отправили подтверждение на вашу почту.
          Готовьтесь к дропу.
        </p>
        <button 
          onClick={() => {
            window.location.href = "/"; // Force reload to clear client state if needed
          }}
          className="bg-white text-black px-10 py-4 font-display uppercase tracking-widest hover:bg-primary hover:text-white transition-colors"
        >
          На главную
        </button>
      </div>
    );
  }

  if (!cartItems || cartItems.length === 0) {
    console.log("Cart is empty, staying on checkout or redirecting to cart?");
    // For debugging, let's not redirect immediately or at least log it
    // setLocation("/cart");
    // return null;
  }

  return (
    <div className="min-h-screen bg-background text-white">
      <Navbar />

      <div className="pt-32 pb-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24">
          
          {/* Left: Form */}
          <div>
            <h1 className="font-display text-4xl mb-12 uppercase tracking-tighter">Оформление заказа</h1>
            
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 md:space-y-8">
              <div className="space-y-4 md:space-y-6">
                <div className="space-y-1 md:space-y-2">
                  <label className="text-[10px] md:text-xs uppercase font-mono text-zinc-500">Полное имя</label>
                  <input
                    {...register("customerName")}
                    className="w-full bg-zinc-950 border border-zinc-800 p-3 md:p-4 text-white placeholder:text-zinc-700 focus:outline-none focus:border-primary font-mono transition-colors text-sm md:text-base"
                    placeholder="ИВАН ИВАНОВ"
                  />
                  {errors.customerName && <p className="text-red-500 text-[10px] md:text-xs font-mono">{errors.customerName.message}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                  <div className="space-y-1 md:space-y-2">
                    <label className="text-[10px] md:text-xs uppercase font-mono text-zinc-500">Email</label>
                    <input
                      {...register("customerEmail")}
                      className="w-full bg-zinc-950 border border-zinc-800 p-3 md:p-4 text-white placeholder:text-zinc-700 focus:outline-none focus:border-primary font-mono transition-colors text-sm md:text-base"
                      placeholder="EMAIL@EXAMPLE.COM"
                    />
                    {errors.customerEmail && <p className="text-red-500 text-[10px] md:text-xs font-mono">{errors.customerEmail.message}</p>}
                  </div>
                  
                  <div className="space-y-1 md:space-y-2">
                    <label className="text-[10px] md:text-xs uppercase font-mono text-zinc-500">Телефон</label>
                    <input
                      {...register("customerPhone")}
                      className="w-full bg-zinc-950 border border-zinc-800 p-3 md:p-4 text-white placeholder:text-zinc-700 focus:outline-none focus:border-primary font-mono transition-colors text-sm md:text-base"
                      placeholder="+7 (999) 000-00-00"
                    />
                    {errors.customerPhone && <p className="text-red-500 text-[10px] md:text-xs font-mono">{errors.customerPhone.message}</p>}
                  </div>
                </div>

                <div className="space-y-1 md:space-y-2">
                  <label className="text-[10px] md:text-xs uppercase font-mono text-zinc-500">Адрес доставки</label>
                  <textarea
                    {...register("address")}
                    rows={3}
                    className="w-full bg-zinc-950 border border-zinc-800 p-3 md:p-4 text-white placeholder:text-zinc-700 focus:outline-none focus:border-primary font-mono transition-colors text-sm md:text-base"
                    placeholder="ГОРОД, УЛИЦА, КВАРТИРА"
                  />
                  {errors.address && <p className="text-red-500 text-[10px] md:text-xs font-mono">{errors.address.message}</p>}
                </div>
              </div>

              <button 
                type="submit"
                disabled={createOrder.isPending}
                className="w-full bg-primary text-white h-14 md:h-16 font-display text-lg md:text-xl uppercase tracking-widest hover:bg-red-600 transition-colors flex items-center justify-center"
              >
                {createOrder.isPending ? <Loader2 className="animate-spin" /> : `Заказать • ${formatPrice(subtotal)}`}
              </button>
            </form>
          </div>

          {/* Right: Order Summary */}
          <div className="bg-zinc-950 border border-zinc-900 p-8 h-fit">
            <h3 className="font-display text-2xl uppercase mb-8">Ваш заказ</h3>
            
            <div className="space-y-6 mb-8 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
              {cartItems?.map((item) => (
                <div key={item.id} className="flex gap-4">
                  <div className="w-16 h-20 bg-zinc-900 flex-shrink-0">
                    <img src={item.product.imageUrl} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1">
                    <p className="font-display text-sm uppercase">{item.product.name}</p>
                    <p className="font-mono text-xs text-zinc-500 mt-1">{item.size} / {item.color} x{item.quantity}</p>
                    <p className="font-mono text-sm mt-2">{formatPrice(item.product.price * item.quantity)}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-zinc-800 pt-6 font-mono text-sm space-y-3">
              <div className="flex justify-between text-zinc-400">
                <span>Сумма</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Доставка</span>
                <span>Бесплатно</span>
              </div>
              <div className="flex justify-between text-white font-bold text-lg pt-2">
                <span>Всего</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
      
      <Footer />
    </div>
  );
}
