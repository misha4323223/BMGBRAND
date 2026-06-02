import SEO from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";

const DEFAULT_ABOUT = {
  title: "Мы —",
  titleAccent: "Booomerangs",
  description: "Базируясь в Туле — городе мастеров, пряников и самоваров — мы создаем вещи для повседневной жизни. На нашем счету более 200 моделей носков (мемных и просто ярких), а также собственная линейка качественной одежды, в которую входят куртки, худи, джоггеры, футболки, шорты и аксессуары.",
  quote: "Делаем вещи\nКоторые носим сами",
};

export default function About() {
  const { data: pageSettings } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings", "static_pages"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/static_pages");
      if (!res.ok) return {};
      return res.json();
    },
  });

  const rawData = pageSettings?.about_data;
  const parsed = rawData ? (typeof rawData === "string" ? JSON.parse(rawData) : rawData) : null;
  const merged = { ...DEFAULT_ABOUT, ...parsed };
  if (merged.titleAccent) {
    merged.titleAccent = merged.titleAccent.replace(/Boo+merangs/i, "Booomerangs").replace(/BOO+MERANGS/i, "BOOOMERANGS");
  }
  const about = merged;

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="page-about">
      <SEO 
        title="О бренде | BOOOMERANGS"
        description="BMGBRAND — российский бренд одежды и аксессуаров. Узнайте историю создания и философию бренда Booomerangs."
        keywords="о бренде BMGBRAND, история бренда, Booomerangs, российский бренд одежды и аксессуаров"
      />
      <Navbar />

      <section className="relative w-full h-[70vh] sm:h-[80vh] overflow-hidden">
        <img
          src="/images/about-hero.webp"
          alt="BOOOMERANGS на вершине"
          className="absolute inset-0 w-full h-full object-cover"
          data-testid="img-about-hero"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/70" />
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-12 sm:pb-16 px-4">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="text-center"
          >
            <p className="text-[10px] sm:text-xs uppercase tracking-[0.4em] text-white mb-3">
              О бренде
            </p>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-black uppercase tracking-[-0.05em] leading-[0.85] text-white">
              {about.title}{" "}
              <span className="text-primary">{about.titleAccent}</span>
            </h1>
          </motion.div>
        </div>
      </section>

      <section className="py-16 sm:py-24 px-4">
        <div className="max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="space-y-16"
          >
            <p className="text-base sm:text-lg leading-[1.8] text-muted-foreground text-center">
              {about.description}
            </p>

            {about.quote && (
              <blockquote className="text-center">
                <div className="w-10 h-[2px] bg-primary mx-auto mb-8" />
                <p className="text-xl sm:text-2xl md:text-3xl font-light italic text-foreground/80 leading-snug tracking-tight whitespace-pre-line">
                  «{about.quote}»
                </p>
                <div className="w-10 h-[2px] bg-primary mx-auto mt-8" />
              </blockquote>
            )}
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
