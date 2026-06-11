import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, ArrowRight, ExternalLink, Play, Quote, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Share2, ShoppingCart, Zap, Tag, Heart } from "lucide-react";
import { SiTelegram, SiVk, SiYoutube, SiInstagram, SiTiktok, SiSpotify, SiTwitch, SiSoundcloud, SiApplemusic, SiDiscord, SiX, SiBandcamp, SiPatreon, SiOnlyfans } from "react-icons/si";
import { useState, useEffect, useRef } from "react";
import { transliterateToSlug } from "@shared/schema";
import SEO from "@/components/SEO";
import { useAddToCart } from "@/hooks/use-cart";
import { usePreorderCart } from "@/context/PreorderCartContext";
import { useToast } from "@/hooks/use-toast";

interface ArtistSettings {
  heroImage?: string;
  heroImageMobile?: string;
  heroVideo?: string;
  heroBgType?: string;
  heroOpacity?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  name?: string;
  role?: string;
  shortDescription?: string;
  aboutTitle?: string;
  aboutText?: string;
  aboutImages?: string[];
  galleryTitle?: string;
  galleryImages?: string[];
  productsTitle?: string;
  productsLimit?: number;
  productsLinkText?: string;
  logoUrl?: string;
  quoteText?: string;
  quoteAuthor?: string;
  videoUrl?: string;
  videoTitle?: string;
  socialTelegram?: string;
  socialVk?: string;
  socialYoutube?: string;
  socialInstagram?: string;
  socialOther?: string;
  socialOtherLabel?: string;
  heroVisible?: boolean;
  aboutVisible?: boolean;
  galleryVisible?: boolean;
  productsVisible?: boolean;
  quoteVisible?: boolean;
  videoVisible?: boolean;
  socialsVisible?: boolean;
  seoTitle?: string;
  seoDescription?: string;
  theme?: string;
  marqueeText?: string;
}

interface ArtistThemeConfig {
  bg: string;
  bgMuted: string;
  accent: string;
  accentFg: string;
  text: string;
  textMuted: string;
  decorBg?: string;
  decorSymbols?: Array<{ symbol: string; color: string; opacity: number; size: string; pos: string; rotate?: string }>;
  accentLines?: boolean;
}

const ARTIST_THEMES: Record<string, ArtistThemeConfig> = {
  default: {
    bg: '',
    bgMuted: 'hsl(var(--muted) / 0.3)',
    accent: 'hsl(var(--primary))',
    accentFg: '#fff',
    text: '',
    textMuted: 'var(--muted-foreground)',
  },
  dark: {
    bg: '#0a0a0a',
    bgMuted: '#111111',
    accent: '#ffffff',
    accentFg: '#0a0a0a',
    text: '#ffffff',
    textMuted: '#777777',
    decorBg: '#141414',
    decorSymbols: [
      { symbol: '◆', color: '#ffffff', opacity: 0.03, size: '160px', pos: 'top-20 left-6', rotate: 'rotate-12' },
      { symbol: '◈', color: '#ffffff', opacity: 0.025, size: '120px', pos: 'bottom-20 right-6', rotate: '-rotate-12' },
    ],
  },
  raw: {
    bg: '#f0ebe3',
    bgMuted: '#e5ddd2',
    accent: '#1a1a1a',
    accentFg: '#f0ebe3',
    text: '#1a1a1a',
    textMuted: '#6b6b5a',
    decorBg: '#e8e0d6',
  },
  neon: {
    bg: '#0d0d0d',
    bgMuted: '#141414',
    accent: '#00ff88',
    accentFg: '#0d0d0d',
    text: '#ffffff',
    textMuted: '#555555',
    decorBg: '#111111',
    decorSymbols: [
      { symbol: '⬡', color: '#00ff88', opacity: 0.04, size: '150px', pos: 'top-16 right-8', rotate: 'rotate-6' },
      { symbol: '⬡', color: '#00ff88', opacity: 0.025, size: '100px', pos: 'bottom-16 left-6', rotate: '-rotate-12' },
    ],
    accentLines: true,
  },
  warm: {
    bg: '#f7ece4',
    bgMuted: '#efe3d8',
    accent: '#ffa000',
    accentFg: '#ffffff',
    text: '#2e2e2e',
    textMuted: '#8a7a6a',
    decorBg: '#efe3d8',
    decorSymbols: [
      { symbol: '★', color: '#ffa000', opacity: 0.04, size: '140px', pos: 'top-24 left-8', rotate: 'rotate-12' },
      { symbol: '♪', color: '#2e2e2e', opacity: 0.04, size: '110px', pos: 'bottom-24 right-8', rotate: '-rotate-12' },
      { symbol: '✦', color: '#ffa000', opacity: 0.03, size: '90px', pos: 'top-1/2 right-1/4' },
    ],
    accentLines: true,
  },
};

const socialIcons: Record<string, any> = {
  telegram: SiTelegram,
  vk: SiVk,
  youtube: SiYoutube,
  instagram: SiInstagram,
};

const urlPlatformIcons: Array<{ pattern: RegExp; icon: any }> = [
  { pattern: /tiktok\.com/i, icon: SiTiktok },
  { pattern: /spotify\.com/i, icon: SiSpotify },
  { pattern: /twitch\.tv/i, icon: SiTwitch },
  { pattern: /soundcloud\.com/i, icon: SiSoundcloud },
  { pattern: /music\.apple\.com|itunes\.apple\.com/i, icon: SiApplemusic },
  { pattern: /discord\.gg|discord\.com/i, icon: SiDiscord },
  { pattern: /twitter\.com|x\.com/i, icon: SiX },
  { pattern: /bandcamp\.com/i, icon: SiBandcamp },
  { pattern: /patreon\.com/i, icon: SiPatreon },
  { pattern: /onlyfans\.com/i, icon: SiOnlyfans },
  { pattern: /t\.me|telegram\.me/i, icon: SiTelegram },
  { pattern: /vk\.com|vkvideo/i, icon: SiVk },
  { pattern: /youtube\.com|youtu\.be/i, icon: SiYoutube },
  { pattern: /instagram\.com/i, icon: SiInstagram },
];

function getSocialIcon(key: string, url?: string): any {
  if (socialIcons[key]) return socialIcons[key];
  if (url) {
    for (const { pattern, icon } of urlPlatformIcons) {
      if (pattern.test(url)) return icon;
    }
  }
  return ExternalLink;
}

const formatPrice = (cents: number) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 }).format(cents / 100);

function ArtistMarquee({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  const SEP = ' ★ ';
  const chunk = text + SEP;
  const items = Array(12).fill(chunk);
  return (
    <>
      <style>{`
        @keyframes artist-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .artist-marquee-inner { animation: artist-marquee 180s linear infinite; }
        .artist-marquee-inner:hover { animation-play-state: paused; }
      `}</style>
      <div className="overflow-hidden select-none" style={{ background: bg }}>
        <div className="border-y" style={{ borderColor: `${fg}18` }}>
          <div
            className="artist-marquee-inner flex whitespace-nowrap py-3 sm:py-4"
            style={{ width: 'max-content' }}
          >
            {[...items, ...items].map((item, i) => (
              <span
                key={i}
                className="text-[11px] sm:text-xs font-bold uppercase tracking-[0.3em] px-4"
                style={{ color: fg, opacity: 0.9 }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

interface ArtistProductCardProps {
  product: any;
  priority?: boolean;
  theme?: ArtistThemeConfig;
}

function ArtistLikeButton({ slug, theme }: { slug: string; theme?: ArtistThemeConfig }) {
  const tc = theme || ARTIST_THEMES.default;
  const isColored = !!theme && theme !== ARTIST_THEMES.default;
  const storageKey = `artist_liked_${slug}`;
  const [liked, setLiked] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });
  const [burst, setBurst] = useState(false);

  const { data, refetch } = useQuery<{ likes: number }>({
    queryKey: [`/api/artists/${slug}/likes`],
    queryFn: async () => {
      const res = await fetch(`/api/artists/${slug}/likes`);
      return res.json();
    },
    staleTime: 30000,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: () => apiRequest('POST', `/api/artists/${slug}/like`),
    onSuccess: (res: any) => {
      try { localStorage.setItem(storageKey, '1'); } catch {}
      setLiked(true);
      setBurst(true);
      setTimeout(() => setBurst(false), 600);
      if (res?.likes != null) {
        queryClient.setQueryData([`/api/artists/${slug}/likes`], { likes: res.likes });
      } else {
        refetch();
      }
    },
  });

  const count = data?.likes ?? 0;

  const bg = isColored ? `${tc.accent}15` : 'hsl(var(--muted) / 0.4)';
  const border = isColored ? `${tc.accent}30` : 'hsl(var(--border))';
  const textColor = isColored ? tc.text : 'inherit';
  const heartColor = liked ? '#f43f5e' : (isColored ? tc.textMuted : 'var(--muted-foreground)');

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center gap-3 py-10"
    >
      <button
        onClick={() => { if (!liked && !isPending) mutate(); }}
        disabled={liked || isPending}
        data-testid="button-artist-like"
        className="relative flex items-center gap-2.5 px-6 py-3 rounded-full border text-sm font-semibold transition-all duration-200 select-none disabled:cursor-default"
        style={{ background: bg, borderColor: border, color: textColor }}
      >
        <motion.span
          animate={burst ? { scale: [1, 1.5, 0.9, 1.1, 1], rotate: [0, -10, 10, -5, 0] } : {}}
          transition={{ duration: 0.5 }}
        >
          <Heart
            className="w-4 h-4 transition-colors duration-300"
            style={{ color: heartColor }}
            fill={liked ? '#f43f5e' : 'none'}
            strokeWidth={2}
          />
        </motion.span>
        <span>{liked ? 'Спасибо! ❤️' : 'Нравится артист'}</span>
        {count > 0 && (
          <span
            className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: isColored ? `${tc.accent}20` : 'hsl(var(--muted))', color: isColored ? tc.accent : 'var(--muted-foreground)' }}
          >
            {count.toLocaleString('ru-RU')}
          </span>
        )}
      </button>
    </motion.div>
  );
}

function ArtistProductCard({ product, priority = false, theme }: ArtistProductCardProps) {
  const tc = theme || ARTIST_THEMES.default;
  const [open, setOpen] = useState(false);
  const [buyMode, setBuyMode] = useState<'cart' | 'checkout'>('cart');
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const { mutate: addItem, isPending } = useAddToCart();
  const { addOrUpdateItem } = usePreorderCart();
  const { toast } = useToast();

  const isPreorder = !!(product.preorderEnabled);

  const sizeStock: Record<string, number> | null = product.sizeStock || null;
  const sizes: string[] = product.noSize
    ? []
    : product.sizes?.length > 0
      ? product.sizes
      : sizeStock ? Object.keys(sizeStock) : [];

  const sizeOrder = ["XXS","XS","S","M","L","XL","XXL","2XL","3XL","4XL","5XL"];
  const sortedSizes = [...sizes].sort((a, b) => {
    const ai = sizeOrder.indexOf(a.toUpperCase()), bi = sizeOrder.indexOf(b.toUpperCase());
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const needsSizePicker = !product.noSize && sortedSizes.length > 1;

  const imageUrl: string = (product.images?.[0] || product.imageUrl || product.thumbnailUrl || '');
  const discountPct: number = product.discountPercent || 0;
  const productFixedPrice: number = (product as any).salePrice || 0;
  const hasDiscount = (productFixedPrice > 0 && productFixedPrice < product.price) || discountPct > 0;
  const salePrice = productFixedPrice > 0 && productFixedPrice < product.price
    ? productFixedPrice
    : (discountPct > 0 ? Math.round(product.price * (1 - discountPct / 100)) : product.price);
  const badgePct = productFixedPrice > 0 && productFixedPrice < product.price
    ? Math.round((1 - productFixedPrice / product.price) * 100)
    : discountPct;

  function formatDeadline(dateStr?: string | null) {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    } catch { return null; }
  }

  function handleButtonClick(e: React.MouseEvent, mode: 'cart' | 'checkout') {
    e.stopPropagation();
    e.preventDefault();
    setBuyMode(mode);
    setSelectedSize(null);
    if (!needsSizePicker) {
      doAdd(mode, product.noSize ? '(OneSize)' : (sortedSizes[0] || undefined));
      return;
    }
    setOpen(true);
  }

  function handlePreorderClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setSelectedSize(null);
    if (!needsSizePicker) {
      doAddPreorder(product.noSize ? '(OneSize)' : (sortedSizes[0] || undefined));
      return;
    }
    setOpen(true);
  }

  function doAdd(mode: 'cart' | 'checkout', size?: string) {
    addItem(
      { productId: product.id, quantity: 1, size: size || undefined },
      {
        onSuccess: () => {
          if (mode === 'checkout') {
            setTimeout(() => navigate('/checkout'), 300);
          }
        },
      }
    );
    setOpen(false);
  }

  function doAddPreorder(size?: string) {
    addOrUpdateItem({
      productId: product.id,
      productName: product.name,
      price: salePrice,
      imageUrl: imageUrl,
      slug: product.slug,
      selectedSizes: { [size || '(OneSize)']: 1 },
      preorderDeadline: product.preorderDeadline ?? null,
      preorderShippingDate: product.preorderShippingDate ?? null,
      preorderProductionDate: product.preorderProductionDate ?? null,
    });
    setOpen(false);
    toast({
      title: "Добавлено в предзаказ",
      description: product.name,
    });
  }

  function handleConfirm() {
    if (needsSizePicker && !selectedSize) return;
    if (isPreorder) {
      doAddPreorder(selectedSize || undefined);
    } else {
      doAdd(buyMode, selectedSize || undefined);
    }
  }

  const accentBg = tc.accent || 'hsl(var(--primary))';
  const accentFg = tc.accentFg || '#fff';

  const deadlineStr = formatDeadline(product.preorderDeadline);
  const shippingStr = formatDeadline(product.preorderShippingDate);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg" data-testid={`artist-product-card-${product.id}`}>
      {/* Изображение */}
      <Link href={`/${product.slug || product.id}`} className="block relative overflow-hidden bg-muted" style={{ aspectRatio: '971 / 1504' }}>
        {imageUrl && (
          <img
            src={imageUrl}
            alt={product.name}
            loading={priority ? 'eager' : 'lazy'}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        {hasDiscount && badgePct > 0 && (
          <span className="absolute top-2 right-2 bg-black/80 text-white text-[9px] font-bold px-2.5 py-0.5 rounded-full tracking-widest uppercase backdrop-blur-sm">
            -{badgePct}%
          </span>
        )}
        {/* Десктоп: hover-оверлей — только для обычных товаров */}
        {!isPreorder && (
          <div className="absolute inset-x-0 bottom-0 hidden sm:flex gap-2 p-2 translate-y-full group-hover:translate-y-0 transition-transform duration-300 bg-gradient-to-t from-black/60 to-transparent pt-10">
            <button
              type="button"
              onClick={(e) => handleButtonClick(e, 'cart')}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-md backdrop-blur-sm active:scale-95 transition-all"
              data-testid={`button-artist-cart-${product.id}`}
              style={{ backgroundColor: accentBg, color: accentFg }}
            >
              <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
              В корзину
            </button>
            <button
              type="button"
              onClick={(e) => handleButtonClick(e, 'checkout')}
              className="flex-1 flex items-center justify-center gap-1.5 text-white text-xs font-semibold py-2 rounded-md bg-white/15 backdrop-blur-sm border border-white/50 hover:bg-white/25 active:scale-95 transition-all"
              data-testid={`button-artist-buynow-${product.id}`}
            >
              <Zap className="w-3.5 h-3.5 shrink-0" />
              В 1 клик
            </button>
          </div>
        )}
      </Link>

      {/* Предзаказ: инфо-блок + кнопка */}
      {isPreorder ? (
        <div className="mt-2 px-1">
          <div className="rounded-xl border border-amber-300/60 bg-amber-50/80 px-3 py-2 mb-2" style={tc.bg ? { background: `${tc.accent}10`, borderColor: `${tc.accent}40` } : {}}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-amber-400 text-white">ПРЕДЗАКАЗ</span>
              <span className="text-[10px] text-amber-700 font-medium">· Сбор заявок</span>
            </div>
            {deadlineStr && (
              <p className="text-[11px] text-amber-800 leading-snug">
                Приём заявок до: <span className="font-semibold">{deadlineStr}</span>
              </p>
            )}
            {shippingStr && (
              <p className="text-[11px] text-amber-800 leading-snug">
                Ориентировочная отправка: <span className="font-semibold">{shippingStr}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handlePreorderClick}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] font-bold py-2.5 rounded-xl transition-all active:scale-95"
            style={{ background: accentBg, color: accentFg }}
            data-testid={`button-artist-preorder-${product.id}`}
          >
            <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
            В предзаказ
          </button>
        </div>
      ) : (
        /* Обычный товар: мобильные кнопки */
        <div className="flex sm:hidden gap-1.5 mt-2">
          <button
            type="button"
            onClick={(e) => handleButtonClick(e, 'cart')}
            className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-bold py-2.5 rounded-xl transition-all active:scale-95"
            style={{ background: accentBg, color: accentFg }}
            data-testid={`button-artist-cart-mobile-${product.id}`}
          >
            <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
            В корзину
          </button>
          <button
            type="button"
            onClick={(e) => handleButtonClick(e, 'checkout')}
            className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-bold py-2.5 rounded-xl border-2 border-foreground/20 bg-background text-foreground transition-all active:scale-95"
            data-testid={`button-artist-buynow-mobile-${product.id}`}
          >
            <Zap className="w-3.5 h-3.5 shrink-0" />
            В 1 клик
          </button>
        </div>
      )}

      <div className="px-2 pt-2 pb-2.5">
        <Link
          href={`/${product.slug || product.id}`}
          className="block text-[13px] sm:text-sm font-semibold leading-snug line-clamp-2 mb-1.5 transition-opacity hover:opacity-70"
          style={tc.text ? { color: tc.text } : {}}
        >
          {product.name}
        </Link>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-black tracking-tight ${hasDiscount ? 'text-red-500' : ''}`}
            style={tc.text && !hasDiscount ? { color: tc.text } : {}}
          >
            {formatPrice(salePrice)}
          </span>
          {hasDiscount && (
            <span className="text-[11px] line-through" style={tc.textMuted ? { color: tc.textMuted } : { color: 'var(--muted-foreground)' }}>
              {formatPrice(product.price)}
            </span>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs sm:max-w-sm rounded-2xl p-6" aria-describedby={undefined}>
          <DialogTitle className="text-base font-bold mb-1 pr-6 leading-snug">{product.name}</DialogTitle>
          <p className="text-xs text-muted-foreground mb-4">
            {isPreorder ? 'Выберите размер для предзаказа' : buyMode === 'cart' ? 'Выберите размер и добавьте в корзину' : 'Выберите размер для быстрой покупки'}
          </p>
          <div className="flex flex-wrap gap-2 mb-5">
            {sortedSizes.map((sz) => {
              const stock = sizeStock ? (sizeStock[sz] ?? 0) : 1;
              const outOfStock = !isPreorder && sizeStock ? stock <= 0 : false;
              return (
                <button
                  key={sz}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => setSelectedSize(sz)}
                  className={`px-3 py-1.5 text-sm rounded-md border-2 transition-all font-medium
                    ${outOfStock ? 'opacity-35 cursor-not-allowed border-border text-muted-foreground' : ''}
                    ${selectedSize === sz ? 'border-foreground bg-foreground text-background' : outOfStock ? '' : 'border-border hover:border-foreground/50'}`}
                  data-testid={`button-size-${sz}-${product.id}`}
                >
                  {sz}
                </button>
              );
            })}
          </div>
          <Button
            onClick={handleConfirm}
            disabled={!selectedSize}
            className="w-full"
            style={{ backgroundColor: accentBg, color: accentFg }}
            data-testid="button-size-confirm"
          >
            {isPreorder ? 'В предзаказ' : buyMode === 'cart' ? 'В корзину' : 'Купить в 1 клик'}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ArtistPage() {
  const params = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const slug = params.slug?.replace(/^@/, '');
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [galleryExpanded, setGalleryExpanded] = useState(false);
  const [promoCopied, setPromoCopied] = useState(false);
  const viewTrackedRef = useRef(false);

  useEffect(() => {
    if (shareCopied) {
      const t = setTimeout(() => setShareCopied(false), 2000);
      return () => clearTimeout(t);
    }
  }, [shareCopied]);

  useEffect(() => {
    if (promoCopied) {
      const t = setTimeout(() => setPromoCopied(false), 2000);
      return () => clearTimeout(t);
    }
  }, [promoCopied]);

  // Отслеживаем посещение страницы (fire-and-forget)
  useEffect(() => {
    if (slug && !viewTrackedRef.current) {
      viewTrackedRef.current = true;
      fetch(`/api/artists/${slug}/view`, { method: 'POST' }).catch(() => {});
    }
  }, [slug]);

  const artistPagesEmpty = (data: any) => data && typeof data === 'object' && Object.keys(data).length === 0;
  const { data: allArtistPages, isLoading: artistPagesLoading } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/artist_pages"],
    refetchInterval: (query) => artistPagesEmpty(query.state.data) ? 2000 : false,
    staleTime: 0,
  });

  const { data: homeSettings, isLoading: homeLoading } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/home"],
  });

  const { data: promoData } = useQuery<{ promoCode: { code: string; discountPercent: number } | null }>({
    queryKey: [`/api/artists/${slug}/promo`],
    enabled: !!slug,
  });

  const settings: ArtistSettings = allArtistPages?.[slug] || {};

  const isMintaSlug = slug?.toLowerCase().includes('dikaya') || slug?.toLowerCase().includes('minta') || slug?.toLowerCase().includes('myata');
  const effectiveTheme = settings.theme || (isMintaSlug ? 'warm' : 'default');
  const tc = ARTIST_THEMES[effectiveTheme] || ARTIST_THEMES.default;
  const isColored = effectiveTheme !== 'default';

  const homeArtist = (homeSettings?.artists?.items || []).find((a: any) => a.slug === slug);

  const artistName = settings.name || homeArtist?.name || slug;
  const artistRole = settings.role !== undefined ? settings.role : (homeArtist?.role || "");
  const heroImage = settings.heroImage || homeArtist?.image || "";
  const heroOpacity = settings.heroOpacity || "0.5";

  const productsLimit = settings.productsLimit ?? 8;

  const { data: slugProducts, isLoading: slugLoading } = useQuery<any[]>({
    queryKey: ["/api/products/by-artist", slug, productsLimit],
    queryFn: async () => {
      const res = await fetch(`/api/products/by-artist/${slug}?limit=${productsLimit}`);
      return res.json();
    },
    enabled: settings.productsVisible !== false && !!slug,
  });

  const products = (slugProducts || []).slice(0, productsLimit);

  const productsQueryLoading = slugLoading;

  // Notify AI chat widget about current artist context
  useEffect(() => {
    if (!slug || !artistName) return;
    window.dispatchEvent(new CustomEvent("set-artist-context", {
      detail: {
        slug,
        name: artistName,
        role: settings.role || "",
        description: (settings.shortDescription || settings.aboutText || "").slice(0, 300),
        products: products.slice(0, 8).map((p: any) => ({
          name: p.name,
          price: p.price ? Math.round(p.price / 100) : 0,
        })),
      },
    }));
    return () => {
      window.dispatchEvent(new Event("clear-artist-context"));
    };
  }, [slug, artistName, products.length]);

  const galleryImages = settings.galleryImages?.filter(Boolean) || [];
  const aboutImages = settings.aboutImages?.filter(Boolean) || [];

  const socials = [
    { key: "telegram", url: settings.socialTelegram, label: "Telegram" },
    { key: "vk", url: settings.socialVk, label: "VK" },
    { key: "youtube", url: settings.socialYoutube, label: "YouTube" },
    { key: "instagram", url: settings.socialInstagram, label: "Instagram" },
  ].filter(s => s.url);

  if (settings.socialOther) {
    socials.push({ key: "other", url: settings.socialOther, label: settings.socialOtherLabel || "Ссылка" });
  }

  const isLoading = artistPagesLoading || homeLoading;
  const hasNoData = !allArtistPages?.[slug] && !homeArtist;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Загрузка...</div>
      </div>
    );
  }

  if (hasNoData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Артист не найден</h1>
          <p className="text-muted-foreground">Страница ещё не настроена</p>
          <Link href="/">
            <Button variant="outline" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4 mr-2" /> На главную
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <SEO 
        title={settings?.seoTitle || `Мерч ${artistName} — купить официальный мерч`}
        description={settings?.seoDescription || `Купить мерч ${artistName} — официальный магазин Booomerangs. ${settings?.aboutText?.slice(0, 100) || "Футболки, худи, аксессуары с доставкой по всей России."}`}
        keywords={`мерч ${artistName}, купить мерч ${artistName}, ${artistName}, Booomerangs, BMGBRAND`}
        ogImage={heroImage || undefined}
      />
      <main className="min-h-screen" style={isColored ? { background: tc.bg } : {}}>

        {/* Theme decorative background */}
        {isColored && tc.decorSymbols && (
          <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
            {tc.decorSymbols.map((d, i) => (
              <div key={i} className={`absolute ${d.pos} ${d.rotate || ''} font-black select-none`} style={{ fontSize: d.size, color: d.color, opacity: d.opacity }}>
                {d.symbol}
              </div>
            ))}
            {tc.accentLines && (
              <>
                <div className="absolute top-0 left-0 w-[2px] h-full" style={{ background: tc.accent, opacity: 0.5 }} />
                <div className="absolute top-0 right-0 w-[2px] h-full" style={{ background: tc.accent, opacity: 0.5 }} />
              </>
            )}
          </div>
        )}

        <div className="relative z-10">
        {settings.heroVisible !== false && (
          <section className="relative min-h-[75vh] sm:min-h-[88vh] flex items-end" data-testid="section-artist-hero">
            {/* Кнопка Назад */}
            <button
              onClick={() => navigate("/")}
              className="absolute top-5 left-5 z-30 flex items-center gap-2 text-white/70 text-sm font-medium hover:text-white transition-colors group"
              data-testid="button-artist-back"
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-full border border-white/20 bg-black/30 backdrop-blur-sm group-hover:border-white/50 group-hover:bg-black/50 transition-all">
                <ArrowLeft className="w-3.5 h-3.5" />
              </span>
              <span className="hidden sm:inline">Назад</span>
            </button>
            <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 to-zinc-800" />

            {settings.heroBgType === "video" && settings.heroVideo ? (
              <video
                src={settings.heroVideo}
                autoPlay
                muted
                loop
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : heroImage ? (
              <>
                {/* Мобильный баннер — только на маленьких экранах */}
                {settings.heroImageMobile ? (
                  <>
                    <img
                      src={settings.heroImageMobile}
                      alt={artistName}
                      className="block lg:hidden absolute inset-0 w-full h-full object-cover"
                    />
                    <img
                      src={heroImage}
                      alt={artistName}
                      className="hidden lg:block absolute inset-0 w-full h-full object-cover"
                    />
                  </>
                ) : (
                  <img
                    src={heroImage}
                    alt={artistName}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                {!settings.heroImageMobile && (
                  <img
                    src={heroImage}
                    alt=""
                    className="hidden lg:block absolute right-0 top-0 h-full w-1/2 object-contain object-right-bottom drop-shadow-2xl"
                  />
                )}
              </>
            ) : null}

            {/* Cinematic overlays */}
            <div
              className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/10"
              style={{ opacity: Number(heroOpacity) + 0.15 }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/25 to-transparent" />
            {/* Subtle vignette */}
            <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 30% 100%, rgba(0,0,0,0.5) 0%, transparent 70%)' }} />

            <div className="relative z-10 w-full px-4 sm:px-6 lg:px-12 pb-0">
              <motion.div
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.13 } } }}
                className="max-w-lg lg:max-w-xl xl:max-w-2xl"
              >
                {artistRole && (
                  <motion.div
                    variants={{ hidden: { opacity: 0, x: -16 }, show: { opacity: 1, x: 0, transition: { duration: 0.5 } } }}
                    className="flex items-center gap-2.5 mb-3"
                  >
                    <span className="w-5 h-[1.5px] bg-white/70 shrink-0" />
                    <span className="text-white/90 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.3em]">
                      {artistRole}
                    </span>
                  </motion.div>
                )}
                <div className="overflow-hidden mb-4">
                  <motion.h1
                    variants={{ hidden: { opacity: 0, y: 80 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } } }}
                    className="text-5xl sm:text-7xl lg:text-8xl font-black text-white leading-[0.92] tracking-tight"
                  >
                    {settings.logoUrl ? (
                      <img
                        src={settings.logoUrl}
                        alt={artistName}
                        className="block"
                        loading="eager"
                        fetchPriority="high"
                        style={{
                          width: settings.logoSize ? `${settings.logoSize}px` : '280px',
                          height: 'auto',
                          maxWidth: '90vw',
                          objectFit: 'contain',
                          objectPosition: 'left center',
                          filter: 'drop-shadow(0 2px 16px rgba(0,0,0,0.6))'
                        }}
                      />
                    ) : artistName}
                  </motion.h1>
                </div>
                {settings.shortDescription && (
                  <motion.p
                    variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } }}
                    className="text-white text-sm sm:text-[15px] max-w-xs leading-relaxed mb-5"
                  >
                    {settings.shortDescription}
                  </motion.p>
                )}

              </motion.div>
            </div>
          </section>
        )}

        {settings.heroVisible !== false && (
          <ArtistMarquee
            text={settings.marqueeText !== undefined ? settings.marqueeText : [artistName, artistRole].filter(Boolean).join(' — ')}
            bg={isColored ? tc.accent : '#0a0a0a'}
            fg={isColored ? tc.accentFg : '#ffffff'}
          />
        )}

        {/* ── Социальные кнопки под бегущей строкой ── */}
        {settings.heroVisible !== false && (socials.length > 0 || settings.socialsVisible !== false) && (
          <div
            className="border-b border-white/5"
            style={{ background: isColored ? tc.bg : '#0d0d0d' }}
          >
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-12 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {settings.socialsVisible !== false && socials.map((s) => {
                  const Icon = getSocialIcon(s.key, s.url);
                  return (
                    <a
                      key={s.key}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`link-social-bar-${s.key}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.13em] transition-all duration-200"
                      style={{
                        background: 'rgba(255,255,255,0.07)',
                        border: '1px solid rgba(255,255,255,0.18)',
                        color: '#fff',
                      }}
                      onMouseEnter={e => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = 'rgba(255,255,255,0.16)';
                        el.style.borderColor = 'rgba(255,255,255,0.35)';
                        el.style.transform = 'translateY(-1px)';
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = 'rgba(255,255,255,0.07)';
                        el.style.borderColor = 'rgba(255,255,255,0.18)';
                        el.style.transform = 'translateY(0)';
                      }}
                    >
                      <Icon className="w-3 h-3 shrink-0" />
                      <span>{s.label}</span>
                    </a>
                  );
                })}

                {socials.length > 0 && (
                  <div className="h-4 w-px bg-white/10 hidden sm:block" />
                )}

                {/* Кнопка «Поделиться» */}
                <button
                  data-testid="button-artist-share-bar"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.13em] transition-all duration-200"
                  style={{
                    background: shareCopied ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)',
                    border: `1px solid ${shareCopied ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.18)'}`,
                    color: '#fff',
                  }}
                  onMouseEnter={e => {
                    if (shareCopied) return;
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = 'rgba(255,255,255,0.16)';
                    el.style.borderColor = 'rgba(255,255,255,0.35)';
                    el.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={e => {
                    if (shareCopied) return;
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = 'rgba(255,255,255,0.07)';
                    el.style.borderColor = 'rgba(255,255,255,0.18)';
                    el.style.transform = 'translateY(0)';
                  }}
                  onClick={async () => {
                    const shareData = {
                      title: artistName,
                      text: settings.shortDescription || artistName,
                      url: window.location.href,
                    };
                    if (navigator.share) {
                      try { await navigator.share(shareData); } catch (_) {}
                    } else {
                      try {
                        await navigator.clipboard.writeText(window.location.href);
                        setShareCopied(true);
                      } catch (_) {}
                    }
                  }}
                >
                  <Share2 className="w-3 h-3 shrink-0" />
                  <span>{shareCopied ? 'Скопировано!' : 'Поделиться'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {settings.aboutVisible !== false && settings.aboutText && (
          <section className="py-16 sm:py-24" style={isColored ? { background: tc.bg } : { background: 'var(--background)' }} data-testid="section-artist-about">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-12">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-[2px] w-6 rounded-full shrink-0" style={{ background: isColored ? tc.accent : 'rgba(255,255,255,0.25)' }} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: isColored ? tc.accent : 'var(--muted-foreground)' }}>{artistName}</span>
                </div>
                <div className="flex items-center gap-4 mb-8">
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight" style={isColored ? { color: tc.text } : {}}>
                    {settings.aboutTitle || "О коллаборации"}
                  </h2>
                  <span className="flex-1 h-px hidden sm:block" style={{ background: isColored ? tc.accent : 'currentColor', opacity: 0.10 }} />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
                  <div className="space-y-4">
                    {settings.aboutText.split('\n').filter(Boolean).map((paragraph, i) => (
                      <p key={i} className="leading-relaxed" style={isColored ? { color: tc.textMuted } : {}}>
                        {paragraph}
                      </p>
                    ))}
                  </div>
                  {aboutImages.length > 0 && (
                    <div className="space-y-4">
                      {aboutImages.map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt={`${artistName} ${i + 1}`}
                          className="w-full h-auto block rounded-2xl shadow-lg"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          </section>
        )}

        {settings.quoteVisible !== false && settings.quoteText && (
          <section
            className="relative overflow-hidden"
            style={{ background: isColored ? tc.bgMuted : '#0c0c0c' }}
            data-testid="section-artist-quote"
          >
            <div className="w-full h-px" style={{ background: isColored ? `${tc.accent}28` : 'rgba(255,255,255,0.06)' }} />
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-12 py-14 sm:py-20">
              <motion.div
                initial={{ opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.65 }}
                className="flex gap-6 sm:gap-10 items-stretch"
              >
                <div
                  className="shrink-0 w-[3px] rounded-full"
                  style={{ background: isColored ? tc.accent : 'rgba(255,255,255,0.22)' }}
                />
                <div>
                  <blockquote
                    className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight leading-snug mb-5"
                    style={isColored ? { color: tc.text } : { color: '#fff' }}
                  >
                    {settings.quoteText}
                  </blockquote>
                  {settings.quoteAuthor && (
                    <cite
                      className="text-[11px] font-bold uppercase tracking-[0.22em] not-italic"
                      style={{ color: isColored ? tc.accent : 'rgba(255,255,255,0.32)' }}
                    >
                      — {settings.quoteAuthor}
                    </cite>
                  )}
                </div>
              </motion.div>
            </div>
            <div className="w-full h-px" style={{ background: isColored ? `${tc.accent}28` : 'rgba(255,255,255,0.06)' }} />
          </section>
        )}

        {/* ── Галерея ── */}
        {settings.galleryVisible !== false && galleryImages.length > 0 && (
          <section
            className="py-12 sm:py-20"
            style={isColored ? { background: tc.bg } : { background: 'var(--background)' }}
            data-testid="section-artist-gallery-video"
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" data-testid="section-artist-gallery">
              <div className="flex items-center gap-4 mb-6">
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight" style={isColored ? { color: tc.text } : {}}>
                  {settings.galleryTitle || "Галерея"}
                </h2>
                <span className="flex-1 h-px hidden sm:block" style={{ background: isColored ? tc.accent : 'currentColor', opacity: 0.10 }} />
              </div>

              {(() => {
                const LIMIT = 6;
                const hasMore = galleryImages.length > LIMIT;
                const visible = galleryExpanded ? galleryImages : galleryImages.slice(0, LIMIT);
                const hidden = hasMore && !galleryExpanded ? galleryImages.length - LIMIT : 0;
                return (
                  <>
                    <div className="columns-2 sm:columns-3 gap-1 sm:gap-1.5">
                      {visible.map((img, i) => (
                        <button
                          key={i}
                          onClick={() => { setGalleryIndex(i); setLightboxOpen(true); }}
                          data-testid={`button-gallery-grid-${i}`}
                          className="relative w-full mb-1 sm:mb-1.5 overflow-hidden group/cell bg-muted focus:outline-none break-inside-avoid block"
                        >
                          <img
                            src={img}
                            alt={`${artistName} фото ${i + 1}`}
                            loading="lazy"
                            className="w-full h-auto block transition-transform duration-700 group-hover/cell:scale-[1.04]"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover/cell:bg-black/45 transition-all duration-300 flex items-center justify-center">
                            <div className="opacity-0 group-hover/cell:opacity-100 transition-opacity duration-300 w-10 h-10 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
                              </svg>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>

                    {hasMore && (
                      <div className="mt-4 flex justify-center">
                        <button
                          data-testid="button-gallery-expand"
                          onClick={() => setGalleryExpanded(v => !v)}
                          className="group flex items-center gap-2.5 px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-all duration-300 border"
                          style={{
                            background: 'transparent',
                            borderColor: isColored ? `${tc.accent}40` : 'rgba(255,255,255,0.15)',
                            color: isColored ? tc.accent : 'rgba(255,255,255,0.5)',
                          }}
                          onMouseEnter={e => {
                            const el = e.currentTarget as HTMLElement;
                            el.style.background = isColored ? `${tc.accent}15` : 'rgba(255,255,255,0.07)';
                            el.style.borderColor = isColored ? `${tc.accent}70` : 'rgba(255,255,255,0.3)';
                            el.style.color = isColored ? tc.accent : '#fff';
                          }}
                          onMouseLeave={e => {
                            const el = e.currentTarget as HTMLElement;
                            el.style.background = 'transparent';
                            el.style.borderColor = isColored ? `${tc.accent}40` : 'rgba(255,255,255,0.15)';
                            el.style.color = isColored ? tc.accent : 'rgba(255,255,255,0.5)';
                          }}
                        >
                          {galleryExpanded ? (
                            <>
                              <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                              <span>Свернуть</span>
                            </>
                          ) : (
                            <>
                              <span>Ещё {hidden} фото</span>
                              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}

              <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
                <DialogContent className="max-w-none w-screen h-screen p-0 bg-black/95 border-none flex items-center justify-center" data-testid="dialog-gallery-lightbox">
                  <DialogTitle className="sr-only">{artistName} — галерея</DialogTitle>
                  <button
                    onClick={() => setLightboxOpen(false)}
                    className="absolute top-4 right-4 z-50 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                    data-testid="button-lightbox-close"
                  >
                    ✕
                  </button>
                  {galleryImages.length > 1 && (
                    <button
                      onClick={() => setGalleryIndex((prev) => (prev - 1 + galleryImages.length) % galleryImages.length)}
                      data-testid="button-lightbox-prev"
                      className="absolute left-3 sm:left-6 z-40 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                  )}
                  <div className="w-full h-full flex items-center justify-center p-3">
                    <img
                      key={galleryIndex}
                      src={galleryImages[galleryIndex]}
                      alt={`${artistName} фото ${galleryIndex + 1}`}
                      className="max-w-full max-h-full object-contain select-none rounded"
                      style={{ maxHeight: 'calc(100vh - 80px)' }}
                    />
                  </div>
                  {galleryImages.length > 1 && (
                    <button
                      onClick={() => setGalleryIndex((prev) => (prev + 1) % galleryImages.length)}
                      data-testid="button-lightbox-next"
                      className="absolute right-3 sm:right-6 z-40 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  )}
                  <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-white/40 text-xs font-mono tabular-nums">
                    {galleryIndex + 1} / {galleryImages.length}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </section>
        )}

        {/* ── Видео — кинематографичный полноширинный блок ── */}
        {settings.videoVisible !== false && settings.videoUrl && (
          <section
            className="relative overflow-hidden"
            style={{ background: isColored ? tc.bgMuted : '#090909' }}
            data-testid="section-artist-video"
          >
            <div className="w-full h-px" style={{ background: isColored ? `${tc.accent}28` : 'rgba(255,255,255,0.06)' }} />

            {/* Заголовок */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-12 pt-10 pb-5">
              <motion.div
                initial={{ opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="flex items-center gap-4"
              >
                <div className="shrink-0 w-[3px] h-5 rounded-full" style={{ background: isColored ? tc.accent : 'rgba(255,255,255,0.25)' }} />
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.28em]"
                  style={{ color: isColored ? tc.accent : 'rgba(255,255,255,0.35)' }}
                >
                  {settings.videoTitle || "Видео"}
                </span>
              </motion.div>
            </div>

            {/* Плеер */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="px-4 sm:px-8 lg:px-16 pb-12 sm:pb-16"
            >
              <div className="max-w-5xl mx-auto">
                <div className="aspect-video overflow-hidden" style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}>
                  {(() => {
                    const url = settings.videoUrl.trim();
                    if (url.startsWith("<iframe") || url.startsWith("<IFRAME")) {
                      const srcMatch = url.match(/src=["']([^"']+)["']/i);
                      const src = srcMatch ? srcMatch[1] : null;
                      return src ? <iframe src={src} className="w-full h-full" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock" allowFullScreen title="Video" style={{ border: 0 }} /> : null;
                    }
                    if (url.includes("youtube.com") || url.includes("youtu.be")) {
                      return <iframe src={url.replace("watch?v=", "embed/").replace("youtu.be/", "youtube.com/embed/")} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="Video" style={{ border: 0 }} />;
                    }
                    if (url.includes("vk.com") || url.includes("vkvideo") || url.includes("vk.ru")) {
                      let src = url;
                      if (!url.includes("video_ext.php")) {
                        const m = url.match(/video(-?\d+)_(\d+)/);
                        if (m) src = `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}&hd=2`;
                      }
                      return <iframe src={src} className="w-full h-full" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock" allowFullScreen title="Video" style={{ border: 0 }} />;
                    }
                    if (url.includes("disk.yandex.ru") || url.includes("yadi.sk")) {
                      return <iframe src={url} className="w-full h-full" allow="autoplay; encrypted-media; fullscreen" allowFullScreen title="Video" style={{ border: 0 }} />;
                    }
                    return <video src={url} controls className="w-full h-full object-contain"><track kind="captions" /></video>;
                  })()}
                </div>
              </div>
            </motion.div>

            <div className="w-full h-px" style={{ background: isColored ? `${tc.accent}28` : 'rgba(255,255,255,0.06)' }} />
          </section>
        )}

        {settings.productsVisible !== false && (productsQueryLoading || products.length > 0) && (
          <section className="py-16 sm:py-24" style={isColored ? { background: tc.bg } : { background: 'var(--background)' }} data-testid="section-artist-products">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-[3px] w-8 rounded-full" style={{ background: isColored ? tc.accent : 'currentColor', opacity: isColored ? 1 : 0.25 }} />
                <span className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: isColored ? tc.accent : 'var(--muted-foreground)' }}>Коллекция</span>
              </div>
              <div className="flex items-center gap-4 mb-8">
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight" style={isColored ? { color: tc.text } : {}}>
                  {settings.productsTitle || "Товары коллекции"}
                </h2>
                <span className="flex-1 h-px hidden sm:block" style={{ background: isColored ? tc.accent : 'currentColor', opacity: 0.1 }} />
              </div>
              {productsQueryLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="aspect-[3/4] rounded-lg bg-muted animate-pulse" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {products.slice(0, productsLimit).map((product: any, index: number) => (
                      <ArtistProductCard key={product.id} product={product} priority={index < 4} theme={tc} />
                    ))}
                  </div>
                  {products.length > 0 && (
                    <div className="flex justify-center mt-10">
                      <Link
                        href="/products"
                        className="text-base flex items-center gap-2 group transition-colors font-bold"
                        style={isColored ? { color: tc.accent } : {}}
                        data-testid="link-all-artist-products"
                      >
                        {settings.productsLinkText || "Все товары"} <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}
        {/* Промокод партнёра — купон-билет */}
        {promoData?.promoCode && (() => {
          const ticketBg = isColored ? tc.accent : '#111111';
          const ticketFg = isColored ? tc.accentFg : '#ffffff';
          const ticketMuted = isColored ? `${tc.accentFg}99` : 'rgba(255,255,255,0.5)';
          return (
            <section
              className="py-10 sm:py-16 overflow-visible"
              style={{ background: isColored ? tc.bg : 'hsl(var(--background))' }}
              data-testid="section-artist-promo"
            >
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="max-w-xl mx-auto px-4 sm:px-6"
              >
                {/* Ticket card */}
                <div className="relative flex flex-col sm:flex-row rounded-2xl overflow-hidden shadow-2xl shadow-black/30"
                     style={{ background: ticketBg }}>

                  {/* Notch circles — top & bottom of divider (visible on sm+) */}
                  <div className="hidden sm:block absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full z-20 border-2"
                       style={{ background: isColored ? tc.bg : 'hsl(var(--background))', borderColor: isColored ? tc.bg : 'hsl(var(--background))' }} />
                  <div className="hidden sm:block absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-7 h-7 rounded-full z-20 border-2"
                       style={{ background: isColored ? tc.bg : 'hsl(var(--background))', borderColor: isColored ? tc.bg : 'hsl(var(--background))' }} />
                  {/* Notch circles — left & right of horizontal divider (on mobile) */}
                  <div className="sm:hidden absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full z-20"
                       style={{ background: isColored ? tc.bg : 'hsl(var(--background))' }} />
                  <div className="sm:hidden absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full z-20"
                       style={{ background: isColored ? tc.bg : 'hsl(var(--background))' }} />

                  {/* Left — discount */}
                  <div className="flex-1 flex flex-col items-center justify-center py-8 px-6 text-center gap-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: ticketMuted }}>
                      промокод от {artistName}
                    </p>
                    <div className="font-black leading-none my-1" style={{ color: ticketFg, fontSize: 'clamp(60px, 16vw, 80px)' }}>
                      -{promoData.promoCode.discountPercent}%
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: ticketMuted }}>
                      на весь заказ
                    </p>
                  </div>

                  {/* Divider */}
                  <div className="relative flex items-center justify-center sm:flex-col">
                    <div className="w-full h-px sm:w-px sm:h-full border-t sm:border-l border-dashed" style={{ borderColor: ticketMuted }} />
                  </div>

                  {/* Right — code + copy */}
                  <div className="flex-1 flex flex-col items-center justify-center py-8 px-6 text-center gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: ticketMuted }}>
                      ваш код
                    </p>
                    <button
                      type="button"
                      data-testid="button-artist-promo-copy"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(promoData.promoCode!.code);
                          setPromoCopied(true);
                          setTimeout(() => setPromoCopied(false), 2500);
                        } catch (_) {}
                      }}
                      className="group flex flex-col items-center gap-2 transition-all active:scale-95"
                    >
                      <span className="font-mono font-black tracking-[0.15em]" style={{ color: ticketFg, fontSize: 'clamp(20px, 6vw, 28px)' }}>
                        {promoData.promoCode.code}
                      </span>
                      <span
                        className="text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors px-3 py-1 rounded-full border"
                        style={{
                          color: promoCopied ? ticketBg : ticketFg,
                          background: promoCopied ? ticketFg : 'transparent',
                          borderColor: ticketMuted,
                        }}
                      >
                        {promoCopied ? '✓ Скопировано' : 'нажмите чтобы скопировать'}
                      </span>
                    </button>
                  </div>
                </div>
              </motion.div>
            </section>
          );
        })()}

        </div>
      </main>

      {/* Лайк */}
      <div style={isColored ? { background: tc.bg } : { background: 'var(--background)' }}>
        <ArtistLikeButton slug={slug!} theme={isColored ? tc : undefined} />
      </div>

      {/* ── Подвал: CTA «Хочешь свою страницу?» ── */}
      <footer style={{ background: '#080808' }}>
        <div className="w-full h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-12 py-14 sm:py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-10"
          >
            {/* Левая часть: текст */}
            <div className="max-w-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-[2px] w-6 rounded-full bg-white/25 shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/35">
                  BMGBRAND × Партнёрская программа
                </span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-white leading-tight tracking-tight mb-3">
                Хочешь свою<br />страницу?
              </h3>
              <p className="text-sm text-white/70 leading-relaxed">
                Создай коллаборацию с брендом — получи персональную страницу, уникальную коллекцию и заработок с каждой продажи.
              </p>

              <div className="mt-8">
                <Link href="/partner/register">
                  <button
                    className="flex items-center gap-2.5 px-6 py-3 rounded-full text-sm font-bold text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                    style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.20)' }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.18)';
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.35)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.12)';
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.20)';
                    }}
                    data-testid="button-artist-footer-partner"
                  >
                    Стать партнёром
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </Link>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Нижняя строка */}
        <div className="w-full h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-12 py-4 flex items-center justify-between">
          <Link href="/">
            <span className="text-xs font-black tracking-tight text-white/25 hover:text-white/50 transition-colors">
              BMGBRAND
            </span>
          </Link>
          <p className="text-[10px] text-white/20">
            © {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </>
  );
}