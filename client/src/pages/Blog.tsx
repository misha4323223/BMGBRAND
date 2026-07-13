import SEO from "@/components/SEO";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ArrowRight, Calendar, User } from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";
import { Link } from "wouter";

const defaultBlogPosts = [
  { 
    title: "SS'26: Новая эстетика уличной моды", 
    date: "15 января 2026",
    category: "Коллекции",
    author: "BMG Team",
    excerpt: "Исследуем грани между российской уличной модой и современным искусством в новом дропе.",
    image: "/attached_assets/generated_images/blog_post_image_for_new_collection_drop.webp" 
  },
  { 
    title: "Лукбук: Urban Vibes в ритме города", 
    date: "10 января 2026",
    category: "Лукбук",
    author: "BMG Team",
    excerpt: "Как сочетать комфорт и стиль в динамичной городской среде. Наш взгляд на повседневность.",
    image: "/attached_assets/generated_images/blog_post_image_for_urban_vibes_lookbook.webp" 
  },
  { 
    title: "Коллаб: BMG x Tula Artists", 
    date: "5 января 2026",
    category: "Коллаборации",
    author: "BMG Team",
    excerpt: "Лимитированная серия, созданная совместно с локальными художниками Тулы.",
    image: "/attached_assets/generated_images/blog_post_image_for_artist_collaboration.webp" 
  },
];

export default function Blog() {
  const homeSettingsQuery = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/home"],
  });

  const blogPagesQuery = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/blog_pages"],
  });

  const homeData = homeSettingsQuery.data;
  const blogPagesData = blogPagesQuery.data;

  const blogItems = homeData?.blog?.items || defaultBlogPosts;

  const BADGE_COLORS: Record<string, { bg: string; text: string }> = {
    black: { bg: "#1C1C1C", text: "#FFFFFF" },
    white: { bg: "#FFFFFF", text: "#1C1C1C" },
    red: { bg: "#E53935", text: "#FFFFFF" },
    gray: { bg: "#6B7280", text: "#FFFFFF" },
    beige: { bg: "#D4C5A9", text: "#1C1C1C" },
  };

  const posts = blogItems.map((item: any, idx: number) => {
    const pageData = blogPagesData?.[String(idx)];
    return {
      title: pageData?.title || item.title,
      date: pageData?.date || item.date,
      category: pageData?.category || item.category,
      badgeColor: pageData?.badgeColor || "black",
      author: pageData?.author || item.author || "BMG Team",
      excerpt: pageData?.excerpt || item.excerpt,
      image: pageData?.image || item.image,
    };
  });

  const isLoading = homeSettingsQuery.isLoading;

  return (
    <div className="min-h-screen bg-background">
      <SEO 
        title="Блог"
        description="Блог BMGBRAND — новости бренда, тренды российской моды, новые коллекции и коллаборации."
        keywords="блог BMGBRAND, новости российской одежды, тренды, коллекции"
      />
      <Navbar />
      <main className="pt-24 pb-16 sm:pb-24">
        <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 sm:mb-24">
            <motion.span 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs font-bold text-primary uppercase tracking-[0.3em] mb-4 inline-block"
            >
              {homeData?.blog?.subtitle || "BMG Журнал"}
            </motion.span>
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight mb-6"
              data-testid="text-blog-heading"
            >
              {homeData?.blog?.title || "Культура и стиль"}
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-muted-foreground max-w-2xl mx-auto text-lg"
            >
              Анонсы новых коллекций, истории создания вещей и авторские дизайны бренда.
            </motion.p>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <BrandLoader size="lg" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 sm:gap-12">
              {posts.map((post: any, index: number) => (
                <motion.article
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="group relative flex flex-col"
                  data-testid={`card-blog-post-${index}`}
                >
                  <Link href={`/blog/${index}`}>
                    <div className="relative aspect-[4/5] overflow-hidden rounded-2xl mb-6 bg-muted cursor-pointer shadow-xl">
                      <img 
                        src={post.image} 
                        alt={post.title}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 group-hover:rotate-1"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />
                      
                      <div className="absolute top-4 left-4">
                        {(() => {
                          const c = BADGE_COLORS[post.badgeColor] || BADGE_COLORS.black;
                          return (
                            <span 
                              className="backdrop-blur-md text-[10px] font-bold px-3 py-1.5 rounded-full border border-white/20 uppercase tracking-wider"
                              style={{ backgroundColor: c.bg + "CC", color: c.text }}
                              data-testid={`badge-blog-${index}`}
                            >
                              {post.category}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </Link>

                  <div className="flex-1 flex flex-col">
                    <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {post.date}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" /> {post.author}
                      </span>
                    </div>

                    <Link href={`/blog/${index}`}>
                      <h2 className="text-2xl font-bold leading-tight group-hover:text-primary transition-colors cursor-pointer mb-4">
                        {post.title}
                      </h2>
                    </Link>

                    <p className="text-muted-foreground text-sm leading-relaxed line-clamp-3 mb-6">
                      {post.excerpt}
                    </p>

                    <Link href={`/blog/${index}`}>
                      <div className="mt-auto inline-flex items-center text-xs font-bold uppercase tracking-widest border-b border-primary/30 pb-1 group-hover:border-primary transition-all cursor-pointer" data-testid={`link-read-more-${index}`}>
                        Читать далее <ArrowRight className="ml-2 w-3 h-3 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </Link>
                  </div>
                </motion.article>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
