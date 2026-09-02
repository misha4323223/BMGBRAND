import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useWholesalePrice } from "@/hooks/use-auth";

interface RecommendationBlockProps {
  productId: number;
  exclude?: number[];
  title?: string;
  subtitle?: string;
  category?: string;
  compact?: boolean;
}

function displayName(name: string): string {
  return name.replace(/\bBOOOMERANGS\b/gi, '').replace(/\bBMGBRAND\b/gi, '').replace(/\s{2,}/g, ' ').trim();
}

export function RecommendationBlock({
  productId,
  exclude = [],
  title = "С этим часто берут",
  subtitle,
  category,
  compact = false,
}: RecommendationBlockProps) {
  const excludeParam = exclude.length > 0 ? `&exclude=${exclude.join(',')}` : '';

  const { isWholesale } = useWholesalePrice();

  const { data: fetched } = useQuery<any[]>({
    queryKey: ['/api/products', productId, 'recommendations', exclude.join(',')],
    enabled: !!productId && productId > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/recommendations?count=6${excludeParam}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Оптовикам товары без оптовой цены не показываем
  const products = (fetched || []).filter(
    (p: any) => !isWholesale || (p.wholesalePrice && p.wholesalePrice > 0)
  );

  if (!products || products.length === 0) return null;

  if (compact) {
    return (
      <div className="px-4 py-3 border-t border-border" data-testid="block-recommendations-compact">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {products.slice(0, 4).map((p) => (
            <Link
              key={p.id}
              href={`/${p.slug || p.id}`}
              className="flex-shrink-0 w-[72px] group"
              data-testid={`card-rec-compact-${p.id}`}
            >
              <div className="w-[72px] h-[88px] rounded-md bg-muted overflow-hidden mb-1">
                <img
                  src={p.thumbnailUrl || p.imageUrl}
                  alt={p.name}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                  onError={(e) => {
                    if (p.imageUrl && e.currentTarget.src !== p.imageUrl) {
                      e.currentTarget.src = p.imageUrl;
                    }
                  }}
                />
              </div>
              <p className="text-[10px] text-foreground line-clamp-2 leading-tight">
                {displayName(p.name)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {p.price ? `${(p.price / 100).toLocaleString('ru-RU')} ₽` : ''}
              </p>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const seeMoreHref = category ? `/products/${category}` : null;

  return (
    <section
      className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14"
      data-testid="block-recommendations-full"
    >
      <div className="mb-6 sm:mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground tracking-tight">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {seeMoreHref && (
          <Link
            href={seeMoreHref}
            className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors font-medium"
            data-testid="link-recommendations-more"
          >
            Смотреть ещё
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {products.slice(0, 4).map((p) => {
          const badge = p.isNew
            ? "NEW"
            : (typeof p.badgeText === "string" && p.badgeText.trim() ? p.badgeText : null);
          return (
            <Link
              key={p.id}
              href={`/${p.slug || p.id}`}
              className="group block"
              data-testid={`card-rec-full-${p.id}`}
            >
              <div className="relative aspect-[3/4] rounded-md overflow-hidden bg-muted mb-2">
                <img
                  src={p.thumbnailUrl || p.imageUrl}
                  alt={`${p.name} BOOOMERANGS`}
                  title={p.name}
                  className="w-full h-full object-cover transition-opacity duration-300 group-hover:opacity-0"
                  loading="lazy"
                  onError={(e) => {
                    if (p.imageUrl && e.currentTarget.src !== p.imageUrl) {
                      e.currentTarget.src = p.imageUrl;
                    }
                  }}
                />
                {p.hoverThumbnailUrl && (
                  <img
                    src={p.hoverThumbnailUrl}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    loading="lazy"
                  />
                )}
                {badge && (
                  <Badge className="absolute top-2 left-2 text-[10px]" variant="default">
                    {badge}
                  </Badge>
                )}
              </div>
              <p className="text-sm font-medium text-foreground truncate">
                {displayName(p.name)}
              </p>
              <p className="text-sm text-foreground/70">
                {p.price ? `${(p.price / 100).toLocaleString('ru-RU')} ₽` : ''}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
