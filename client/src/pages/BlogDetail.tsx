import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ProductCard } from "@/components/ProductCard";
import { ArrowLeft, Calendar, User, Tag, Share2, Quote, ChevronLeft, ChevronRight, Play } from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";
import { Button } from "@/components/ui/button";
import SEO from "@/components/SEO";
import { useWholesalePrice } from "@/hooks/use-auth";
import { useState } from "react";
import { transliterateToSlug } from "@shared/schema";

const defaultBlogPosts = [
  { 
    title: "SS'26: Новая эстетика уличной моды", 
    date: "15 января 2026",
    category: "Коллекции",
    author: "BMG Team",
    content: `
      <p>Новая коллекция SS'26 (Spring/Summer 2026) — это переосмысление уличной моды через призму функциональности и искусства. В этом сезоне мы решили отойти от привычных канонов и предложить нечто большее, чем просто одежду.</p>
      
      <h3>Философия коллекции</h3>
      <p>Мы вдохновлялись индустриальной архитектурой и природными текстурами. В основе коллекции лежат премиальные материалы: тяжелый хлопок, технологичный софтшелл и инновационные ткани с эффектом памяти.</p>
      
      <blockquote>
        "Наша цель — создать вещи, которые будут актуальны не один сезон, а станут частью вашего личного стиля на годы."
      </blockquote>

      <h3>Ключевые модели</h3>
      <p>В центре внимания — оверсайз-худи с уникальными принтами, нанесенными методом шелкографии, и брюки-карго с продуманной системой карманов. Особое место занимают аксессуары, которые дополняют образ, делая его завершенным.</p>
    `,
    image: "/attached_assets/generated_images/blog_post_image_for_new_collection_drop.webp",
    tags: ["Streetwear", "Style", "BMG", "NewDrop"],
    excerpt: "",
  },
  { 
    title: "Лукбук: Urban Vibes в ритме города", 
    date: "10 января 2026",
    category: "Лукбук",
    author: "BMG Team",
    content: `
      <p>Город никогда не спит, и ваша одежда должна соответствовать этому ритму. В новом лукбуке Urban Vibes мы показываем, как наши вещи адаптируются под разные сценарии городской жизни.</p>
      
      <h3>От рассвета до заката</h3>
      <p>Утренний кофе, прогулка по центру, вечерняя встреча с друзьями — наши комплекты продуманы так, чтобы вы чувствовали себя уверенно в любой ситуации.</p>
      
      <h3>Стилизация</h3>
      <p>В этом сезоне мы рекомендуем многослойность. Сочетайте базовые футболки с объемными рубашками или ветровками. Не бойтесь экспериментировать с аксессуарами: поясные сумки и кепки — маст-хэв этого года.</p>
    `,
    image: "/attached_assets/generated_images/blog_post_image_for_urban_vibes_lookbook.webp",
    tags: ["Streetwear", "Style", "BMG", "NewDrop"],
    excerpt: "",
  },
  { 
    title: "Коллаб: BMG x Tula Artists", 
    date: "5 января 2026",
    category: "Коллаборации",
    author: "BMG Team",
    content: `
      <p>Тула — это не только пряники и самовары. Это город талантливых людей и мастеров. Мы рады представить нашу новую коллаборацию с локальными художниками.</p>
      
      <h3>Искусство в деталях</h3>
      <p>Каждый принт в этой серии — это уникальная история, созданная вручную. Мы перенесли эскизы молодых талантов на ткань, используя лучшие методы печати, чтобы сохранить каждую линию и оттенок.</p>
      
      <h3>Лимитированный дроп</h3>
      <p>Эта серия выпущена ограниченным тиражом. Каждая вещь имеет свой уникальный номер, что делает её по-настоящему коллекционной. Поддержите локальную культуру вместе с нами.</p>
    `,
    image: "/attached_assets/generated_images/blog_post_image_for_artist_collaboration.webp",
    tags: ["Streetwear", "Style", "BMG", "NewDrop"],
    excerpt: "",
  },
];

const RUSSIAN_MONTHS: Record<string, string> = {
  "января": "01", "февраля": "02", "марта": "03", "апреля": "04",
  "мая": "05", "июня": "06", "июля": "07", "августа": "08",
  "сентября": "09", "октября": "10", "ноября": "11", "декабря": "12",
};

function parseBlogDate(ruDate: string): string {
  const parts = (ruDate || "").trim().split(" ");
  if (parts.length === 3) {
    const day = parts[0].padStart(2, "0");
    const month = RUSSIAN_MONTHS[parts[1].toLowerCase()];
    const year = parts[2];
    if (day && month && year && /^\d{4}$/.test(year)) return `${year}-${month}-${day}`;
  }
  return ruDate;
}

function extractIframeSrc(html: string): string | null {
  const match = html.match(/src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function getVideoEmbed(url: string) {
  const trimmed = url.trim();

  // If the user pasted a full <iframe> tag — extract src from it
  if (trimmed.startsWith("<iframe") || trimmed.startsWith("<IFRAME")) {
    const src = extractIframeSrc(trimmed);
    if (!src) return null;
    return (
      <iframe
        src={src}
        className="w-full h-full"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock"
        allowFullScreen
        title="Video"
        style={{ border: 0 }}
      />
    );
  }

  if (trimmed.includes("youtube.com") || trimmed.includes("youtu.be")) {
    const embedUrl = trimmed
      .replace("watch?v=", "embed/")
      .replace("youtu.be/", "youtube.com/embed/");
    return (
      <iframe
        src={embedUrl}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title="Video"
        style={{ border: 0 }}
      />
    );
  }

  if (trimmed.includes("vk.com") || trimmed.includes("vkvideo")) {
    // Convert regular VK video page URL to embed URL if needed
    let embedSrc = trimmed;
    if (!trimmed.includes("video_ext.php")) {
      const match = trimmed.match(/video(-?\d+)_(\d+)/);
      if (match) {
        embedSrc = `https://vk.com/video_ext.php?oid=${match[1]}&id=${match[2]}&hd=2`;
      }
    }
    return (
      <iframe
        src={embedSrc}
        className="w-full h-full"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock"
        allowFullScreen
        title="Video"
        style={{ border: 0 }}
      />
    );
  }

  return (
    <video src={trimmed} controls className="w-full h-full object-contain">
      <track kind="captions" />
    </video>
  );
}

export default function BlogDetail() {
  const { id } = useParams();
  const postIndex = parseInt(id || "0");
  const [galleryIndex, setGalleryIndex] = useState(0);
  const { isWholesale } = useWholesalePrice();

  const blogPagesQuery = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/blog_pages"],
  });

  const homeSettingsQuery = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/home"],
  });

  const isLoading = blogPagesQuery.isLoading || homeSettingsQuery.isLoading;
  const validIndex = !isNaN(postIndex) && postIndex >= 0;

  const homeItems = homeSettingsQuery.data?.blog?.items || [];
  const blogPageData = validIndex ? blogPagesQuery.data?.[String(postIndex)] : null;
  const homeItem = validIndex ? homeItems[postIndex] : null;
  const fallback = validIndex ? (defaultBlogPosts[postIndex] || null) : null;

  const totalPosts = Math.max(homeItems.length, defaultBlogPosts.length);
  const postExists = validIndex && postIndex < totalPosts;

  const post = {
    title: blogPageData?.title || homeItem?.title || fallback?.title || "",
    date: blogPageData?.date || homeItem?.date || fallback?.date || "",
    category: blogPageData?.category || homeItem?.category || fallback?.category || "",
    badgeColor: blogPageData?.badgeColor || "black",
    author: blogPageData?.author || homeItem?.author || fallback?.author || "BMG Team",
    content: blogPageData?.content || fallback?.content || "",
    image: blogPageData?.image || homeItem?.image || fallback?.image || "",
    excerpt: blogPageData?.excerpt || homeItem?.excerpt || fallback?.excerpt || "",
    tags: blogPageData?.tags || fallback?.tags || [],
    seoTitle: blogPageData?.seoTitle || "",
    seoDescription: blogPageData?.seoDescription || "",
    quoteText: blogPageData?.quoteText || "",
    quoteAuthor: blogPageData?.quoteAuthor || "",
    quoteVisible: blogPageData?.quoteVisible === true,
    galleryTitle: blogPageData?.galleryTitle || "Галерея",
    galleryImages: (blogPageData?.galleryImages || []).filter(Boolean) as string[],
    galleryVisible: blogPageData?.galleryVisible === true,
    videoUrl: blogPageData?.videoUrl || "",
    videoTitle: blogPageData?.videoTitle || "Видео",
    videoVisible: blogPageData?.videoVisible === true,
    productsTitle: blogPageData?.productsTitle || "Товары из статьи",
    productsCategory: blogPageData?.productsCategory || "",
    productsSubcategory: blogPageData?.productsSubcategory || "",
    productsLinkText: blogPageData?.productsLinkText || "Все товары",
    productsVisible: blogPageData?.productsVisible === true,
    linkedProducts: blogPageData?.linkedProducts || [],
    linkedProductButtons: blogPageData?.linkedProductButtons || {},
    contentImages: (blogPageData?.contentImages || []).filter(Boolean) as string[],
  };

  const productsQuery = post.productsCategory
    ? `/api/products?category=${post.productsCategory}${post.productsSubcategory ? `&subcategory=${post.productsSubcategory}` : ""}&limit=8`
    : "";

  const { data: productsData } = useQuery<{ products: any[] }>({
    queryKey: ["/api/products", "blog", post.productsCategory, post.productsSubcategory],
    queryFn: async () => {
      if (!productsQuery) return { products: [] };
      const res = await fetch(productsQuery);
      return res.json();
    },
    enabled: !!productsQuery && post.productsVisible,
  });

  const linkedProductIds: number[] = post.linkedProducts || [];
  const { data: linkedProductsData } = useQuery<any[]>({
    queryKey: ["/api/products/by-ids", linkedProductIds.join(",")],
    queryFn: async () => {
      if (linkedProductIds.length === 0) return [];
      const res = await fetch(`/api/products/by-ids?ids=${linkedProductIds.join(",")}`);
      return res.json();
    },
    enabled: linkedProductIds.length > 0,
  });

  // Оптовикам товары без оптовой цены не показываем (правило бизнеса)
  const products = (productsData?.products || []).filter(
    (p: any) => !isWholesale || (p.wholesalePrice && p.wholesalePrice > 0)
  );
  const linkedProducts = linkedProductsData || [];

  const badgeColors: Record<string, { bg: string; text: string }> = {
    black: { bg: "#1C1C1C", text: "#FFFFFF" },
    white: { bg: "#FFFFFF", text: "#1C1C1C" },
    red: { bg: "#E53935", text: "#FFFFFF" },
    gray: { bg: "#6B7280", text: "#FFFFFF" },
    beige: { bg: "#D4C5A9", text: "#1C1C1C" },
  };
  const bc = badgeColors[post.badgeColor] || badgeColors.black;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center pt-40 pb-16">
          <BrandLoader size="lg" />
        </div>
        <Footer />
      </div>
    );
  }

  if (!postExists && !isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-24 pb-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
            <h1 className="text-3xl font-bold mb-4" data-testid="text-blog-not-found">Статья не найдена</h1>
            <p className="text-muted-foreground mb-8">Запрашиваемая статья не существует или была удалена.</p>
            <Link href="/blog">
              <Button variant="outline" data-testid="button-back-to-blog-notfound">
                <ArrowLeft className="w-4 h-4 mr-2" /> Вернуться к журналу
              </Button>
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO 
        title={post.seoTitle || post.title || "Статья"}
        description={post.seoDescription || post.excerpt || (post.content ? (() => { const s = post.content; if (s.length <= 160) return s; const cut = s.slice(0, 160); const sp = cut.lastIndexOf(" "); return sp > 0 ? cut.slice(0, sp) : cut; })() : "") || "Блог BMGBRAND — статьи о российской моде и авторских дизайнах."}
        ogType="article"
        ogImage={post.image || "/og-image.png"}
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": post.title,
            "description": post.seoDescription || post.excerpt || "",
            "image": post.image ? (post.image.startsWith("http") ? post.image : `${window.location.origin}${post.image}`) : `${window.location.origin}/og-image.png`,
            "url": window.location.href,
            "datePublished": parseBlogDate(post.date),
            "dateModified": parseBlogDate(post.date),
            "author": {
              "@type": "Organization",
              "@id": `${window.location.origin}/#organization`,
              "name": post.author || "BMG Team",
            },
            "publisher": {
              "@type": "Organization",
              "@id": `${window.location.origin}/#organization`,
              "name": "BMGBRAND",
              "logo": {
                "@type": "ImageObject",
                "url": `${window.location.origin}/favicon.png`,
              },
            },
            "mainEntityOfPage": {
              "@type": "WebPage",
              "@id": window.location.href,
            },
            ...(post.tags && post.tags.length > 0 ? { "keywords": post.tags.join(", ") } : {}),
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Главная", "item": window.location.origin },
              { "@type": "ListItem", "position": 2, "name": "Блог", "item": `${window.location.origin}/blog` },
              { "@type": "ListItem", "position": 3, "name": post.title, "item": window.location.href },
            ],
          },
        ]}
      />
      <Navbar />
      <main className="pt-24 pb-16">
        <article className="max-w-4xl mx-auto px-4 sm:px-6">
          <Link href="/blog">
            <Button variant="ghost" className="mb-8 p-0 hover:bg-transparent text-muted-foreground hover:text-primary transition-colors flex items-center gap-2" data-testid="button-back-to-blog">
              <ArrowLeft className="w-4 h-4" /> Назад к журналу
            </Button>
          </Link>

          <header className="mb-12">
            <div className="flex items-center gap-2 mb-4">
              <span
                className="text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider"
                style={{ backgroundColor: bc.bg, color: bc.text }}
                data-testid="text-blog-badge"
              >
                {post.category}
              </span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-tight" data-testid="text-blog-title">
              {post.title}
            </h1>
            <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground border-b border-border pb-8">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" /> {post.date}
              </div>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" /> {post.author}
              </div>
              <div
                className="ml-auto flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                data-testid="button-share"
                onClick={async () => {
                  const shareData = {
                    title: post.title,
                    text: post.excerpt || post.title,
                    url: window.location.href,
                  };
                  if (navigator.share) {
                    try {
                      await navigator.share(shareData);
                    } catch (_) {}
                  } else {
                    try {
                      await navigator.clipboard.writeText(window.location.href);
                      const el = document.querySelector('[data-testid="button-share"] span');
                      if (el) {
                        const original = el.textContent;
                        el.textContent = "Ссылка скопирована!";
                        setTimeout(() => { el.textContent = original; }, 2000);
                      }
                    } catch (_) {}
                  }
                }}
              >
                <Share2 className="w-4 h-4" /> <span>Поделиться</span>
              </div>
            </div>
          </header>

          {post.image && (
            <div className={`mb-12 ${post.contentImages.length > 0 ? "grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-4 items-start" : ""}`}>
              <div className="rounded-3xl overflow-hidden shadow-2xl">
                <img
                  src={post.image}
                  alt={post.title}
                  className="w-full h-auto block"
                  data-testid="img-blog-hero"
                />
              </div>
              {post.contentImages.length > 0 && (
                <div className="flex flex-col gap-4">
                  {post.contentImages.map((img: string, idx: number) => (
                    <div key={idx} className="rounded-3xl overflow-hidden shadow-xl">
                      <img
                        src={img}
                        alt={`Дополнительное фото ${idx + 1}`}
                        className="w-full h-auto block"
                        data-testid={`img-blog-content-${idx}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {post.content && (
            <div 
              className="prose prose-lg dark:prose-invert max-w-none 
                prose-headings:font-bold prose-headings:tracking-tight 
                prose-p:text-muted-foreground prose-p:leading-relaxed
                prose-blockquote:border-l-primary prose-blockquote:bg-muted/50 prose-blockquote:p-6 prose-blockquote:rounded-r-xl prose-blockquote:not-italic
                prose-strong:text-foreground"
              dangerouslySetInnerHTML={{ __html: post.content }}
              data-testid="content-blog-body"
            />
          )}
        </article>

        {/* Quote Section */}
        {post.quoteVisible && post.quoteText && (
          <motion.section
            className="py-12 sm:py-16 bg-muted/30 mt-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            data-testid="section-blog-quote"
          >
            <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
              <Quote className="w-8 h-8 text-primary/40 mx-auto mb-4" />
              <blockquote className="text-xl sm:text-2xl font-medium italic leading-relaxed mb-4">
                &laquo;{post.quoteText}&raquo;
              </blockquote>
              {post.quoteAuthor && (
                <cite className="text-sm text-muted-foreground not-italic">
                  — {post.quoteAuthor}
                </cite>
              )}
            </div>
          </motion.section>
        )}

        {/* Gallery Section */}
        {post.galleryVisible && post.galleryImages.length > 0 && (
          <motion.section
            className="py-16 sm:py-24 bg-background"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            data-testid="section-blog-gallery"
          >
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-2xl sm:text-3xl font-bold mb-8">
                {post.galleryTitle}
              </h2>

              <div className="relative flex items-center justify-center">
                <img
                  src={post.galleryImages[galleryIndex]}
                  alt={`Фото ${galleryIndex + 1}`}
                  className="block w-auto h-auto max-w-full max-h-[85vh] rounded-2xl shadow-xl transition-opacity duration-300"
                  data-testid={`img-blog-gallery-${galleryIndex}`}
                />

                {post.galleryImages.length > 1 && (
                  <>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full opacity-80"
                      onClick={() => setGalleryIndex((galleryIndex - 1 + post.galleryImages.length) % post.galleryImages.length)}
                      data-testid="button-blog-gallery-prev"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full opacity-80"
                      onClick={() => setGalleryIndex((galleryIndex + 1) % post.galleryImages.length)}
                      data-testid="button-blog-gallery-next"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </Button>
                  </>
                )}
              </div>

              {post.galleryImages.length > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  {post.galleryImages.map((_: string, idx: number) => (
                    <button
                      key={idx}
                      type="button"
                      className={`w-2 h-2 rounded-full transition-colors ${idx === galleryIndex ? "bg-primary" : "bg-muted-foreground/30"}`}
                      onClick={() => setGalleryIndex(idx)}
                      data-testid={`button-blog-gallery-dot-${idx}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.section>
        )}

        {/* Video Section */}
        {post.videoVisible && post.videoUrl && (
          <motion.section
            className="relative bg-background overflow-hidden"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            data-testid="section-blog-video"
          >
            <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none" />

            <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
              {post.videoTitle && (
                <div className="flex items-center gap-2 mb-5">
                  <Play className="w-4 h-4 text-primary fill-primary" />
                  <span className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                    {post.videoTitle}
                  </span>
                </div>
              )}
              <div className="aspect-video rounded-2xl overflow-hidden shadow-2xl shadow-black/25 dark:shadow-black/50 ring-1 ring-black/5 dark:ring-white/5">
                {getVideoEmbed(post.videoUrl)}
              </div>
            </div>
          </motion.section>
        )}

        {/* Products Section */}
        {(linkedProducts.length > 0 || (post.productsVisible && products.length > 0)) && (
          <motion.section
            className="py-16 sm:py-24 bg-background"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            data-testid="section-blog-products"
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
                <h2 className="text-2xl sm:text-3xl font-bold">
                  {post.productsTitle}
                </h2>
                {post.productsCategory && (
                  <Link
                    href={post.productsSubcategory ? `/products/${post.productsCategory}/${transliterateToSlug(post.productsSubcategory)}` : `/products/${post.productsCategory}`}
                    className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-2 group transition-colors"
                    data-testid="link-all-blog-products"
                  >
                    {post.productsLinkText}
                    <ArrowLeft className="w-4 h-4 rotate-180 group-hover:translate-x-1 transition-transform" />
                  </Link>
                )}
              </div>

              {linkedProducts.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-8">
                  {linkedProducts.map((product: any) => {
                    const customText = (post.linkedProductButtons || {})[product.id];
                    const buttonLabel = customText || product.name;
                    return (
                      <Link
                        key={`linked-${product.id}`}
                        href={`/${product.slug || product.id}`}
                        data-testid={`button-blog-linked-product-${product.id}`}
                      >
                        <div className="flex items-center gap-3 px-4 py-2.5 border rounded-md bg-card hover-elevate transition-all cursor-pointer group">
                          {(product.thumbnailUrl || product.imageUrl) && (
                            <img
                              src={product.thumbnailUrl || product.imageUrl}
                              alt={product.name}
                              className="w-8 h-10 object-cover rounded"
                            />
                          )}
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-medium group-hover:text-primary transition-colors">{buttonLabel}</span>
                            {product.price && (
                              <span className="text-xs text-muted-foreground">{(product.price / 100).toLocaleString('ru-RU')} ₽</span>
                            )}
                          </div>
                          <ArrowLeft className="w-4 h-4 rotate-180 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all ml-1" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              {post.productsVisible && products.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
                  {products.filter((p: any) => !linkedProductIds.includes(p.id)).slice(0, 8).map((product: any) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              )}
            </div>
          </motion.section>
        )}

        {/* Tags */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 mt-12">
          {(post.tags || []).length > 0 && (
            <div className="pt-8 border-t border-border flex flex-wrap gap-2">
              <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground mr-4"><Tag className="w-3 h-3" /> Теги:</span>
              {(post.tags || []).map((tag: string) => (
                <span key={tag} className="text-xs bg-muted px-3 py-1 rounded-full hover:bg-primary/20 transition-colors cursor-pointer" data-testid={`tag-${tag}`}>
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
