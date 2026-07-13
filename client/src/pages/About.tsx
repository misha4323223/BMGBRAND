import SEO from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { motion } from "framer-motion";
import { Link } from "wouter";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.65, delay },
});

export default function About() {
  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="page-about">
      <SEO
        title="О бренде | BOOOMERANGS"
        description="BOOOMERANGS — российский бренд одежды и аксессуаров из Тулы. История, философия и производство с 2006 года."
        keywords="о бренде BOOOMERANGS, история бренда, BMGBRAND, российский бренд одежды, Тула"
      />
      <Navbar />

      {/* ── Hero ── */}
      <section className="relative w-full h-[80vh] sm:h-screen overflow-hidden">
        <img
          src="/images/about-hero.webp"
          alt="BOOOMERANGS"
          className="absolute inset-0 w-full h-full object-cover"
          data-testid="img-about-hero"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/30 to-black/80" />
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-16 sm:pb-24 px-4 text-center">
          <motion.div
            initial={{ opacity: 0, y: 36 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <p className="text-[10px] sm:text-xs uppercase tracking-[0.45em] text-white/70 mb-4">
              О бренде
            </p>
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-black uppercase tracking-[-0.04em] leading-[0.85] text-white">
              Делаем вещи,<br />
              <span className="text-primary">которые носим сами</span>
            </h1>
          </motion.div>
        </div>
      </section>

      {/* ── Три цифры ── */}
      <section className="py-14 sm:py-20 px-4 border-b border-border">
        <div className="max-w-3xl mx-auto grid grid-cols-3 gap-4 sm:gap-8 text-center">
          {[
            { value: "2006", label: "Год открытия\nпервого магазина" },
            { value: "200+", label: "Моделей носков\nв каталоге" },
            { value: "200+", label: "Магазинов\nпо всей России" },
          ].map(({ value, label }, i) => (
            <motion.div key={i} {...fadeUp(i * 0.1)}>
              <p className="text-4xl sm:text-6xl font-black tracking-[-0.04em] text-foreground leading-none">
                {value}
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-2 leading-snug whitespace-pre-line">
                {label}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── История — три этапа ── */}
      <section className="py-16 sm:py-28 px-4">
        <div className="max-w-2xl mx-auto">
          <motion.p
            {...fadeUp()}
            className="text-[10px] sm:text-xs uppercase tracking-[0.4em] text-muted-foreground mb-10 sm:mb-14"
          >
            История
          </motion.p>

          <div className="space-y-12 sm:space-y-16">
            {[
              {
                year: "2006",
                title: "Первый магазин",
                text: "Открыли StreetWear — мультибренд уличной одежды. С него всё началось.",
              },
              {
                year: "2019",
                title: "Своё производство",
                text: "Запустили полный производственный цикл в Узловском районе Тульской области. Теперь шьём, печатаем и упаковываем сами.",
              },
              {
                year: "2020",
                title: "Носки, которые изменили всё",
                text: "В пандемию сделали первые мемные носки — с принтами соды, соли и сахара. То, чего не было на полках. Покупатели оценили.",
              },
            ].map(({ year, title, text }, i) => (
              <motion.div
                key={year}
                {...fadeUp(i * 0.1)}
                className="flex gap-6 sm:gap-10 items-start"
              >
                <div className="flex-shrink-0 w-14 sm:w-20 text-right">
                  <span className="text-primary font-black text-base sm:text-xl tracking-tight">
                    {year}
                  </span>
                </div>
                <div className="flex-1 pt-0.5 border-t border-border">
                  <p className="font-bold text-foreground text-base sm:text-lg mb-1.5">{title}</p>
                  <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">{text}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Цитата основателя ── */}
      <section className="py-16 sm:py-24 px-4 bg-muted/30 border-y border-border">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div {...fadeUp()} className="space-y-6">
            <div className="w-8 h-[2px] bg-primary mx-auto" />
            <blockquote className="text-lg sm:text-2xl md:text-3xl font-light italic text-foreground/80 leading-relaxed tracking-tight">
              «Сначала приходит вдохновение. Потом эскиз, подбор тканей, тестирование — стираем и носим сами, пока не убедимся что вещь готова. И только потом — в производство.»
            </blockquote>
            <div className="w-8 h-[2px] bg-primary mx-auto" />
            <p className="text-xs sm:text-sm uppercase tracking-[0.3em] text-muted-foreground">
              Евгений Соболев — основатель BOOOMERANGS
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── Что мы делаем ── */}
      <section className="py-16 sm:py-28 px-4">
        <div className="max-w-3xl mx-auto">
          <motion.p
            {...fadeUp()}
            className="text-[10px] sm:text-xs uppercase tracking-[0.4em] text-muted-foreground mb-10 sm:mb-14"
          >
            Что мы делаем
          </motion.p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {[
              {
                emoji: "👕",
                title: "Одежда",
                text: "Футболки, худи, свитшоты, куртки, брюки — оверсайз-силуэт, унисекс. Ничего лишнего.",
              },
              {
                emoji: "🧦",
                title: "Носки",
                text: "200+ моделей — мемные, яркие, классические. Одни из самых узнаваемых в России.",
              },
              {
                emoji: "🎒",
                title: "Аксессуары",
                text: "Шопперы, кепки, шапки, сумки. Всё что завершает образ.",
              },
              {
                emoji: "🎤",
                title: "Мерч под ключ",
                text: "Производим официальный мерч для артистов, фестивалей и брендов. Делали мерч для «Дикой Мяты».",
              },
            ].map(({ emoji, title, text }, i) => (
              <motion.div
                key={title}
                {...fadeUp(i * 0.08)}
                className="border border-border rounded-2xl p-6 sm:p-8 hover:border-primary/40 transition-colors duration-300"
              >
                <span className="text-2xl sm:text-3xl mb-4 block">{emoji}</span>
                <p className="font-bold text-foreground text-base sm:text-lg mb-1.5">{title}</p>
                <p className="text-muted-foreground text-sm leading-relaxed">{text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Признание ── */}
      <section className="py-12 sm:py-16 px-4 border-t border-border">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
          <motion.div {...fadeUp()} className="flex-shrink-0 text-center sm:text-left">
            <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mb-1">Признание</p>
            <p className="font-black text-foreground text-base sm:text-lg leading-tight">
              Российская<br />Креативная Неделя
            </p>
          </motion.div>
          <div className="hidden sm:block w-px h-12 bg-border flex-shrink-0" />
          <motion.p {...fadeUp(0.1)} className="text-sm text-muted-foreground leading-relaxed text-center sm:text-left">
            Участник VI федерального форума-фестиваля. Включены в экосистему
            креативных индустрий Тульской области. Цель — стать одним из
            символов региона и продвигать Тулу как модную столицу.
          </motion.p>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 sm:py-24 px-4 text-center">
        <motion.div {...fadeUp()} className="space-y-4">
          <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-[-0.03em]">
            Убедись сам
          </h2>
          <p className="text-muted-foreground text-sm sm:text-base">
            Тула, Россия — производство полного цикла
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
            <Link href="/products">
              <button className="w-full sm:w-auto px-8 py-3.5 bg-foreground text-background text-sm font-bold uppercase tracking-widest rounded-full hover:opacity-80 transition-opacity">
                В каталог
              </button>
            </Link>
            <Link href="/merch-na-zakaz">
              <button className="w-full sm:w-auto px-8 py-3.5 border border-border text-foreground text-sm font-bold uppercase tracking-widest rounded-full hover:border-foreground transition-colors">
                Заказать мерч
              </button>
            </Link>
          </div>
        </motion.div>
      </section>

      <Footer />
    </div>
  );
}
