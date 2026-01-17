import { motion } from "framer-motion";
import { ArrowRight, Truck, Palette, Flag, Mail } from "lucide-react";
import { Link } from "wouter";
import { useProducts } from "@/hooks/use-products";
import { ProductCard } from "@/components/ProductCard";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import heroLogo from "@assets/hero-logo.webp";
import heroBg from "@assets/generated_images/wet_softshell_fabric_on_asphalt_rain.webp";
import clothingImg from "@assets/generated_images/streetwear_clothing_category.webp";
import socksImg from "@assets/generated_images/designer_socks_category.webp";
import accessoriesImg from "@assets/generated_images/accessories_category.webp";
import merchImg from "@assets/generated_images/merch_category.webp";

const identityVideo = "https://storage.yandexcloud.net/bmg/media/identity/cinematic_dark_urban_streetwear_video.mp4";

const categories = [
  { name: "Одежда", slug: "clothing", image: clothingImg },
  { name: "Носки", slug: "socks", image: socksImg },
  { name: "Аксессуары", slug: "accessories", image: accessoriesImg },
  { name: "Мерч", slug: "merch", image: merchImg },
];

const benefits = [
  { icon: Truck, title: "Доставка по всей РФ", desc: "Отправляем в любой город" },
  { icon: Flag, title: "Сделано в России", desc: "Собственное производство" },
  { icon: Palette, title: "Уникальные принты", desc: "Авторский дизайн" },
];

const blogPosts = [
  { 
    title: "Новая коллекция SS'26", 
    date: "15 января 2026",
    excerpt: "Встречайте свежие дропы весенне-летнего сезона...",
    image: "/attached_assets/generated_images/blog_post_image_for_new_collection_drop.webp" 
  },
  { 
    title: "Лукбук: Urban Vibes", 
    date: "10 января 2026",
    excerpt: "Смотрите как носить наши вещи в городе...",
    image: "/attached_assets/generated_images/blog_post_image_for_urban_vibes_lookbook.webp" 
  },
  { 
    title: "Коллаборация с художником", 
    date: "5 января 2026",
    excerpt: "Специальный дроп с уникальными принтами...",
    image: "/attached_assets/generated_images/blog_post_image_for_artist_collaboration.webp" 
  },
];

export default function Home() {
  const { data: products, isLoading } = useProducts();
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const featuredProducts = products?.slice(0, 8);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/newsletter/subscribe", { email });
      setSubscribed(true);
      setEmail("");
    } catch (err) {
      console.error("Subscribe error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-white">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative h-[80vh] sm:h-screen flex flex-col items-center justify-center overflow-hidden bg-black">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
        </div>

        <div className="relative z-10 text-center px-4 w-full max-w-lg mx-auto mb-8">
          <motion.img
            src={heroLogo}
            alt="BMGBRAND"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="w-full h-auto"
          />
        </div>

        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto pb-40 sm:pb-52">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="flex flex-col items-center"
          >
            <p className="font-mono text-[10px] sm:text-xs text-zinc-400 uppercase tracking-[0.3em] mb-8 text-center leading-relaxed">
              МЫ ДЕЛАЕМ ТО, ЧТО НОСИМ САМИ. <br className="hidden sm:block"/>
              ОРИГИНАЛЬНЫЙ РОССИЙСКИЙ СТРИТВИР.
            </p>
            <Link href="/products">
              <Button 
                size="lg"
                className="bg-[#FFFFF0] text-black hover:bg-primary hover:text-white px-6 py-4 text-sm font-display uppercase tracking-[0.3em] rounded-none transition-all duration-500 hover:scale-110 active:scale-95 relative group overflow-visible h-auto min-h-0"
                data-testid="button-hero-catalog"
              >
                {/* Corner Accents for Streetwear style */}
                <div className="absolute -top-1 -left-1 w-2 h-2 border-t border-l border-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b border-r border-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                
                <span className="relative z-10">Смотреть каталог</span>
                
                {/* Glitch/Offset effect background on hover */}
                <div className="absolute inset-0 bg-primary -z-10 translate-x-0 translate-y-0 group-hover:translate-x-1 group-hover:translate-y-1 transition-transform duration-300 opacity-0 group-hover:opacity-100" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Categories Section */}
      <section className="py-12 sm:py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="font-display text-3xl sm:text-5xl text-white">
              Категории
            </h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {categories.map((cat) => (
              <Link 
                key={cat.slug} 
                href={`/products?category=${cat.slug}`}
                className="group relative aspect-[4/5] overflow-hidden bg-zinc-900"
                data-testid={`link-category-${cat.slug}`}
              >
                <img 
                  src={cat.image} 
                  alt={cat.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
                  <h3 className="font-display text-xl sm:text-2xl text-white uppercase tracking-wider group-hover:text-primary transition-colors">
                    {cat.name}
                  </h3>
                  <span className="font-mono text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors flex items-center mt-2">
                    Смотреть <ArrowRight className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-12 sm:py-24 bg-zinc-950 border-y border-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 sm:mb-12 gap-4">
            <div>
              <span className="font-mono text-xs text-primary uppercase tracking-widest">Хиты продаж</span>
              <h2 className="font-display text-3xl sm:text-5xl text-white mt-2">Популярное</h2>
            </div>
            <Link href="/products" className="font-mono text-zinc-500 hover:text-white text-sm flex items-center gap-2 group" data-testid="link-all-products">
              ВСЕ ТОВАРЫ <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                <div key={i} className="animate-pulse">
                  <div className="bg-zinc-800 aspect-[4/5] mb-2" />
                  <div className="h-4 bg-zinc-800 w-2/3 mb-1" />
                  <div className="h-3 bg-zinc-800 w-1/4" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 sm:gap-x-6 gap-y-8 sm:gap-y-10">
              {featuredProducts?.map((product, index) => (
                <ProductCard key={product.id} product={product} priority={index < 4} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-12 sm:py-20 bg-background">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 sm:gap-12">
            {benefits.map((benefit, index) => (
              <motion.div 
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="text-center group"
              >
                <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 border border-zinc-800 mb-4 sm:mb-6 group-hover:border-primary transition-colors">
                  <benefit.icon className="w-7 h-7 sm:w-8 sm:h-8 text-zinc-400 group-hover:text-primary transition-colors" />
                </div>
                <h3 className="font-display text-lg sm:text-xl text-white mb-2 uppercase tracking-wide">
                  {benefit.title}
                </h3>
                <p className="font-mono text-xs sm:text-sm text-zinc-500">
                  {benefit.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
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
              <Link href="/about" className="inline-flex items-center text-primary font-bold hover:text-white transition-colors group text-sm sm:text-base" data-testid="link-manifesto">
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
                preload="none"
                className="hidden md:block relative z-10 w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700"
              />
              <img 
                src={heroBg} 
                alt="BMGBRAND Identity"
                loading="lazy"
                className="md:hidden relative z-10 w-full h-full object-cover grayscale"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Blog/News Section */}
      <section className="py-12 sm:py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 sm:mb-12 gap-4">
            <div>
              <span className="font-mono text-xs text-primary uppercase tracking-widest">Новости</span>
              <h2 className="font-display text-3xl sm:text-5xl text-white mt-2">Блог</h2>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 sm:gap-10">
            {blogPosts.map((post, index) => (
              <motion.article 
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="group cursor-pointer relative"
              >
                {/* Modern Streetwear Card Shape */}
                <div className="relative overflow-hidden bg-zinc-950 border border-zinc-900 transition-all duration-500 group-hover:border-primary/50"
                     style={{
                       clipPath: "polygon(0 0, 100% 0, 100% 90%, 90% 100%, 0 100%)"
                     }}>
                  
                  {/* Image Container */}
                  <div className="aspect-[16/11] overflow-hidden grayscale group-hover:grayscale-0 transition-all duration-700">
                    <img 
                      src={post.image} 
                      alt={post.title}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    {/* Dark overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />
                  </div>

                  {/* Content */}
                  <div className="p-6 relative">
                    {/* Tag element */}
                    <div className="absolute -top-3 left-6 bg-primary text-white text-[8px] font-mono px-2 py-0.5 uppercase tracking-[0.2em]">
                      BMG_JOURNAL
                    </div>

                    <div className="flex justify-between items-center mb-3">
                      <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">{post.date}</span>
                      <div className="w-8 h-[1px] bg-zinc-800" />
                    </div>

                    <h3 className="font-display text-xl text-white mb-3 group-hover:text-primary transition-colors leading-tight uppercase tracking-tight">
                      {post.title}
                    </h3>
                    
                    <p className="font-mono text-xs text-zinc-400 line-clamp-2 mb-4 leading-relaxed opacity-80 group-hover:opacity-100 transition-opacity">
                      {post.excerpt}
                    </p>

                    <div className="flex items-center gap-2 text-primary font-mono text-[10px] uppercase tracking-[0.2em] group/link">
                      <span>ЧИТАТЬ ПОЛНОСТЬЮ</span>
                      <ArrowRight className="w-3 h-3 transition-transform group-hover/link:translate-x-1" />
                    </div>
                  </div>

                  {/* Decorative corner detail */}
                  <div className="absolute bottom-0 right-0 w-8 h-8 bg-primary/10 pointer-events-none" 
                       style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }} />
                </div>
                
                {/* Background offset shape for depth */}
                <div className="absolute -inset-2 border border-primary/5 -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                     style={{ clipPath: "polygon(0 0, 100% 0, 100% 90%, 90% 100%, 0 100%)" }} />
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      {/* Newsletter Section */}
      <section className="py-12 sm:py-20 bg-zinc-950 border-y border-zinc-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Mail className="w-10 h-10 sm:w-12 sm:h-12 text-primary mx-auto mb-4" />
          <h2 className="font-display text-2xl sm:text-4xl text-white mb-3">
            Подпишитесь на рассылку
          </h2>
          <p className="font-mono text-sm text-zinc-400 mb-6 sm:mb-8">
            Получайте первыми информацию о новых дропах и эксклюзивных акциях.<br/>
            <span className="text-primary font-bold">Скидка 7% на первый заказ!</span>
          </p>
          
          {subscribed ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-primary/10 border border-primary/30 p-6 rounded-none"
            >
              <p className="font-display text-xl text-white mb-2">Спасибо за подписку!</p>
              <p className="font-mono text-sm text-zinc-400">
                Ваш промокод: <span className="text-primary font-bold">WELCOME7</span>
              </p>
            </motion.div>
          ) : (
            <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Ваш email"
                required
                disabled={isSubmitting}
                className="flex-1 bg-zinc-900 border border-zinc-800 px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
                data-testid="input-newsletter-email"
              />
              <Button 
                type="submit" 
                disabled={isSubmitting}
                className="bg-primary hover:bg-red-600 text-white px-6 py-3 font-display uppercase tracking-wider"
                data-testid="button-newsletter-submit"
              >
                {isSubmitting ? "..." : "Подписаться"}
              </Button>
            </form>
          )}
        </div>
      </section>

      {/* Marquee/Ticker */}
      <div className="bg-primary py-2 sm:py-4 overflow-hidden border-y border-black/10">
        <div className="whitespace-nowrap flex">
          <div className="animate-marquee flex shrink-0">
            <span className="text-black font-display text-sm sm:text-2xl font-bold px-4 sm:px-8 uppercase tracking-widest flex items-center">
              Новая коллекция уже в продаже • Бесплатная доставка при заказе от 5000₽ • 
            </span>
          </div>
          <div className="animate-marquee flex shrink-0">
            <span className="text-black font-display text-sm sm:text-2xl font-bold px-4 sm:px-8 uppercase tracking-widest flex items-center">
              Новая коллекция уже в продаже • Бесплатная доставка при заказе от 5000₽ • 
            </span>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
