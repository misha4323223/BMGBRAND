import { useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShoppingBag, ExternalLink } from "lucide-react";
import { ProductGrid } from "./PartnerPublic";

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

export default function PartnerWidget() {
  const [, params] = useRoute<{ slug: string }>("/partner/:slug/widget");
  const slug = params?.slug?.toLowerCase() || "";

  const { data, isLoading, error } = useQuery<PartnerPublicData>({
    queryKey: ["/api/partner/public", slug, "widget"],
    queryFn: async () => {
      const res = await fetch(`/api/partner/public/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
    enabled: !!slug,
    retry: false,
  });

  // Hide app shell artifacts (no Navbar/Footer rendered)
  useEffect(() => {
    document.documentElement.classList.add("partner-widget-host");
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.classList.remove("partner-widget-host");
      document.body.style.background = "";
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-[200px] flex items-center justify-center bg-background text-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[200px] flex items-center justify-center bg-background text-foreground p-6">
        <p className="text-sm text-muted-foreground">Виджет временно недоступен</p>
      </div>
    );
  }

  const { partner, products } = data;
  const homeUrl = `/?ref=${encodeURIComponent(partner.partnerSlug)}`;

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="widget-root">
      <header className="border-b px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground truncate">Подборка</p>
          <p className="font-bold truncate" data-testid="text-widget-store-name">
            {partner.storeName}
          </p>
        </div>
        <a
          href={homeUrl}
          target="_top"
          rel="noopener"
          className="text-xs font-medium text-primary inline-flex items-center gap-1 hover:underline shrink-0"
          data-testid="link-widget-brand"
        >
          BMG BRAND <ExternalLink className="w-3 h-3" />
        </a>
      </header>

      <main className="p-3 sm:p-4">
        {products.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <ShoppingBag className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm">Партнёр пока не выбрал товары</p>
            <a
              href={homeUrl}
              target="_top"
              rel="noopener"
              className="inline-flex items-center gap-1 text-primary text-sm mt-3 hover:underline"
            >
              Перейти в каталог BMG BRAND <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ) : (
          <ProductGrid products={products} slug={partner.partnerSlug} compact />
        )}
      </main>

      <footer className="border-t px-4 py-3 text-center">
        <a
          href={homeUrl}
          target="_top"
          rel="noopener"
          className="text-xs text-muted-foreground hover:text-foreground"
          data-testid="link-widget-footer"
        >
          Powered by BMG BRAND · booomerangs.ru
        </a>
      </footer>
    </div>
  );
}
