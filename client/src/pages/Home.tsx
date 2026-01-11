import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { useProducts } from "@/hooks/use-products";
import { ProductCard } from "@/components/ProductCard";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import heroBg from "@assets/generated_images/wet_softshell_fabric_on_asphalt_rain.png";

import identityVideo from "@assets/generated_videos/cinematic_dark_urban_streetwear_video.mp4";

export default function Home() {
  const { data: products, isLoading } = useProducts();
  
  // Featured products (take first 3)
  const featuredProducts = products?.slice(0, 3);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-white">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative h-[80vh] sm:h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src={heroBg} 
            alt="Hero Background" 
            className="w-full h-full object-cover grayscale opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        </div>

        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto mt-10 sm:mt-20">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="flex flex-col items-center"
          >
            <h1 className="font-display text-4xl sm:text-7xl md:text-9xl font-bold uppercase tracking-tighter text-white mb-4 sm:mb-6 leading-none flex flex-wrap items-center justify-center">
              <span className="text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.3)]">BOOO</span>
              <span className="text-primary text-stroke-white drop-shadow-[0_0_20px_rgba(239,68,68,0.3)]">MERANGS</span>
            </h1>
            <p className="font-mono text-sm sm:text-lg md:text-xl text-zinc-300 mb-8 sm:mb-10 max-w-xl mx-auto">
              МЫ ДЕЛАЕМ ТО, ЧТО НОСИМ САМИ. <br/>
              ОРИГИНАЛЬНЫЙ РОССИЙСКИЙ СТРИТВИР.
            </p>
            <Link href="/products">
              <button className="bg-primary hover:bg-red-600 text-white px-6 py-3 sm:px-8 sm:py-4 font-display text-lg sm:text-xl uppercase tracking-widest transition-all hover:scale-105 active:scale-95">
                Смотреть коллекцию
              </button>
            </Link>
          </motion.div>
        </div>

        {/* Scroll Indicator */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 1 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        >
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] -rotate-90 origin-center mb-8">Листайте</span>
          <div className="w-[1px] h-16 bg-gradient-to-b from-primary to-transparent" />
        </motion.div>
      </section>

      {/* Philosophy Section */}
      <section className="py-12 sm:py-24 bg-zinc-950 border-y border-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-8 sm:gap-16 items-center">
            <div>
              <h2 className="font-display text-3xl sm:text-5xl md:text-6xl text-white mb-6 sm:mb-8 leading-tight">
                НЕ ПРОСТО <br/><span className="text-stroke">ОДЕЖДА</span>. <br/>ИДЕНТИЧНОСТЬ.
              </h2>
              <p className="font-mono text-xs sm:text-base text-zinc-400 mb-6 sm:mb-8 leading-relaxed">
                Рожденный на улицах России, BMGBRAND олицетворяет сырую энергию молодежной культуры. 
                Мы не следуем трендам; мы документируем нашу реальность через ткань и принты.
                Каждая вещь рассказывает историю бетонных джунглей.
              </p>
              <Link href="/about" className="inline-flex items-center text-primary font-bold hover:text-white transition-colors group text-sm sm:text-base">
                ЧИТАТЬ МАНИФЕСТ <ArrowRight className="ml-2 w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-2 transition-transform" />
              </Link>
            </div>
            <div className="relative aspect-square overflow-hidden bg-black">
              <div className="absolute -inset-4 border-2 border-primary/20 z-0" />
              <video 
                src={identityVideo} 
                autoPlay 
                loop 
                muted 
                playsInline
                className="relative z-10 w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-12 sm:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-end mb-8 sm:mb-12">
            <h2 className="font-display text-3xl sm:text-4xl text-white">Новинки</h2>
            <Link href="/products" className="hidden md:block font-mono text-zinc-500 hover:text-white text-sm">
              СМОТРЕТЬ ВСЕ ТОВАРЫ
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-8">
              {[1, 2, 3].map(i => (
                <div key={i} className="animate-pulse">
                  <div className="bg-zinc-900 aspect-[4/5] mb-2" />
                  <div className="h-4 bg-zinc-900 w-2/3 mb-1" />
                  <div className="h-3 bg-zinc-900 w-1/4" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 sm:gap-x-8 gap-y-8 sm:gap-y-12">
              {featuredProducts?.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
          
          <div className="mt-12 text-center md:hidden">
            <Link href="/products" className="btn-outline">VIEW ALL</Link>
          </div>
        </div>
      </section>

      {/* Marquee/Ticker */}
      <div className="bg-primary py-4 overflow-hidden whitespace-nowrap">
        <div className="animate-marquee inline-block">
          {[...Array(10)].map((_, i) => (
            <span key={i} className="text-black font-display text-2xl font-bold mx-8 uppercase tracking-widest">
              Новая коллекция уже в продаже • Бесплатная доставка при заказе от 5000₽ • 
            </span>
          ))}
        </div>
      </div>

      <Footer />
    </div>
  );
}
