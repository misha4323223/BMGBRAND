import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { motion } from "framer-motion";

export default function About() {
  return (
    <div className="min-h-screen bg-background text-white">
      <Navbar />
      
      {/* Header */}
      <section className="pt-40 pb-20 px-4 text-center">
        <motion.h1 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-display text-6xl md:text-8xl lg:text-9xl uppercase tracking-tighter mb-8 leading-none"
        >
          Мы — <br/><span className="text-primary">Boomerangs</span>
        </motion.h1>
      </section>

      {/* Content */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-32">
        <div className="font-mono text-lg md:text-xl text-zinc-400 space-y-12 leading-relaxed">
          <p>
            <span className="text-white font-bold">BMGBRAND</span> — это не просто бренд. Это заявление. 
            Беря начало в самом индустриальном сердце России, мы заметили нехватку аутентичности на улицах. 
            Все было лишь копией копии.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 my-12">
             <div className="aspect-square bg-zinc-900 overflow-hidden">
               <img src="https://images.unsplash.com/photo-1523398002811-999ca8dec234?q=80&w=800&auto=format&fit=crop" className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700" alt="Студия" />
             </div>
             <div className="aspect-square bg-zinc-900 overflow-hidden">
               <img src="https://pixabay.com/get/gfec57aba92cfc067935c1db888e810b53ab79a022d14605f785409954ab517f7ae3cd573a9eec57a47f0b6643afd1d8036aaff365a8390c37d3ca75e64dfd24c_1280.jpg" className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700" alt="Процесс" />
             </div>
          </div>

          <p>
            Мы решили создавать вещи, которые носим сами. Высококонтрастные принты, эстетика брутализма 
            и тяжелые ткани, способные выдержать северный климат и городской ритм.
          </p>
          
          <p>
            Каждый принт — это история андеграунда. Каждый шов — это стремление к качеству. 
            Мы — для тех, кто идет своим путем.
          </p>

          <blockquote className="border-l-4 border-primary pl-8 text-2xl md:text-3xl text-white font-display uppercase tracking-tight py-4">
            "Улица — наш подиум. Город — наш холст."
          </blockquote>
        </div>
      </section>

      <Footer />
    </div>
  );
}
