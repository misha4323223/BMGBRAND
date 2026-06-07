import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

interface RecommendationBlockProps {
  productId: number;
  exclude?: number[];
  title?: string;
  compact?: boolean;
}

function displayName(name: string): string {
  return name.replace(/\bBOOOMERANGS\b/gi, '').replace(/\bBMGBRAND\b/gi, '').replace(/\s{2,}/g, ' ').trim();
}

export function RecommendationBlock({
  productId,
  exclude = [],
  title = "С этим часто берут",
  compact = false,
}: RecommendationBlockProps) {
  const excludeParam = exclude.length > 0 ? `&exclude=${exclude.join(',')}` : '';

  const { data: products } = useQuery<any[]>({
    queryKey: ['/api/products', productId, 'recommendations', exclude.join(',')],
    enabled: !!productId && productId > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/recommendations?count=6${excludeParam}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

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

  return (
    <section
      className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14"
      data-testid="block-recommendations-full"
    >
      <div className="mb-6 sm:mb-8">
        <h2 className="text-xl sm:text-2xl font-semibold text-foreground tracking-tight">
          {title}
        </h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {products.slice(0, 4).map((p) => (
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
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
                onError={(e) => {
                  if (p.imageUrl && e.currentTarget.src !== p.imageUrl) {
                    e.currentTarget.src = p.imageUrl;
                  }
                }}
              />
            </div>
            <p className="text-sm font-medium text-foreground truncate">
              {displayName(p.name)}
            </p>
            <p className="text-sm text-foreground/70">
              {p.price ? `${(p.price / 100).toLocaleString('ru-RU')} ₽` : ''}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
