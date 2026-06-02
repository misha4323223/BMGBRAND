import { useEffect } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SEO from "@/components/SEO";
import { Loader2, ShoppingBag, Handshake } from "lucide-react";

interface PartnerPublicProduct {
  id: number;
  name: string;
  slug: string;
  price: number;
  discountPercent: number | null;
  imageUrl: string | null;
  category: string;
  subcategory: string | null;
  sku: string | null;
  stock: number | null;
}

interface PartnerPublicData {
  partner: { partnerSlug: string; storeName: string };
  products: PartnerPublicProduct[];
}

function fmtRub(kopeks: number) {
  return (kopeks / 100).toLocaleString("ru-RU") + " ₽";
}

export default function PartnerPublic() {
  const [, params] = useRoute<{ slug: string }>("/partner/:slug");
  const slug = params?.slug?.toLowerCase() || "";

  const { data, isLoading, error } = useQuery<PartnerPublicData>({
    queryKey: ["/api/partner/public", slug],
    queryFn: async () => {
      const res = await fetch(`/api/partner/public/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error("Партнёр не найден");
      return res.json();
    },
    enabled: !!slug,
    retry: false,
  });

  // Set ref cookie via client navigation hint: hitting /r/:slug in background
  useEffect(() => {
    if (!data?.partner?.partnerSlug) return;
    fetch(`/r/${encodeURIComponent(data.partner.partnerSlug)}?to=/`, {
      redirect: "manual",
      credentials: "include",
    }).catch(() => {});
  }, [data?.partner?.partnerSlug]);

  if (isLoading) {
    return (
      <>
        <Navbar />
        <main className="container mx-auto px-4 pt-24 pb-16 min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin" />
        </main>
        <Footer />
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <SEO title="Партнёр не найден — BMG BRAND" />
        <Navbar />
        <main className="container mx-auto px-4 pt-28 pb-16 min-h-[60vh] text-center">
          <h1 className="text-2xl font-bold mb-2">Страница партнёра не найдена</h1>
          <p className="text-muted-foreground mb-6">Возможно, ссылка устарела или партнёр пока не активирован.</p>
          <Button asChild>
            <Link href="/">На главную</Link>
          </Button>
        </main>
        <Footer />
      </>
    );
  }

  const { partner, products } = data;

  return (
    <>
      <SEO
        title={`${partner.storeName} — товары BMG BRAND`}
        description={`Подборка товаров BMG BRAND от партнёра ${partner.storeName}. Покупайте напрямую на booomerangs.ru.`}
      />
      <Navbar />
      <main className="container mx-auto px-4 pt-24 pb-12 min-h-[70vh]">
        <Card className="p-4 sm:p-5 mb-5 sm:mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <Handshake className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold leading-tight truncate" data-testid="text-partner-public-name">
                {partner.storeName}
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">Подборка товаров BMG BRAND</p>
            </div>
          </div>
        </Card>

        {products.length === 0 ? (
          <Card className="p-10 sm:p-12 text-center">
            <ShoppingBag className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">Партнёр пока не выбрал товары для продвижения.</p>
            <Button asChild variant="outline">
              <Link href={`/?ref=${partner.partnerSlug}`}>Перейти в основной каталог</Link>
            </Button>
          </Card>
        ) : (
          <ProductGrid products={products} slug={partner.partnerSlug} />
        )}
      </main>
      <Footer />
    </>
  );
}

export function ProductGrid({
  products,
  slug,
  compact = false,
}: {
  products: PartnerPublicProduct[];
  slug: string;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3"
          : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"
      }
    >
      {products.map((p) => {
        const buyUrl = `/${p.slug}?ref=${encodeURIComponent(slug)}`;
        const hasDiscount = typeof p.discountPercent === "number" && p.discountPercent > 0;
        return (
          <Card
            key={p.id}
            className="overflow-hidden flex flex-col hover-elevate active-elevate-2"
            data-testid={`partner-product-card-${p.id}`}
          >
            <a
              href={buyUrl}
              target={compact ? "_top" : "_self"}
              rel="noopener"
              className="block aspect-square bg-muted relative"
              data-testid={`partner-product-link-${p.id}`}
            >
              {p.imageUrl ? (
                <img
                  src={p.imageUrl}
                  alt={p.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <ShoppingBag className="w-8 h-8" />
                </div>
              )}
              {hasDiscount && (
                <Badge className="absolute top-2 left-2 bg-red-600 text-white hover:bg-red-700">
                  −{p.discountPercent}%
                </Badge>
              )}
            </a>
            <div className="p-3 flex-1 flex flex-col">
              <a
                href={buyUrl}
                target={compact ? "_top" : "_self"}
                rel="noopener"
                className="text-sm font-medium line-clamp-2 mb-2 hover:underline"
                data-testid={`partner-product-name-${p.id}`}
              >
                {p.name}
              </a>
              <div className="mt-auto flex items-center justify-between gap-2">
                <span className="text-base font-bold" data-testid={`partner-product-price-${p.id}`}>
                  {fmtRub(p.price)}
                </span>
                <Button
                  asChild
                  size="sm"
                  variant="default"
                  data-testid={`button-partner-buy-${p.id}`}
                >
                  <a href={buyUrl} target={compact ? "_top" : "_self"} rel="noopener">
                    Купить
                  </a>
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
