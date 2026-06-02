import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMemo, lazy, Suspense } from "react";
import { CATEGORIES, normalizeCategories } from "@shared/schema";
import type { CategoryConfig } from "@shared/schema";

const ProductList = lazy(() => import("@/pages/ProductList"));
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

const LEGACY_SLUG_MAP: Record<string, { category: string; subcategory: string }> = {
  'hoodies': { category: 'clothing', subcategory: 'Толстовки' },
  'sweatshirts': { category: 'clothing', subcategory: 'Свитшоты' },
  'sweaters': { category: 'clothing', subcategory: 'Свитера' },
  't-shirts': { category: 'clothing', subcategory: 'Футболки' },
  'shorts': { category: 'clothing', subcategory: 'Шорты' },
  'hats': { category: 'accessories', subcategory: 'Шапки' },
  'bags': { category: 'accessories', subcategory: 'Сумки' },
  'remni': { category: 'accessories', subcategory: 'Ремни' },
  'sportivnye-40-45': { category: 'socks', subcategory: 'Спортивные (40-45)' },
  'sportivnye-34-39-2': { category: 'socks', subcategory: 'Спортивные (34-39)' },
  'tula-designers': { category: 'merch', subcategory: 'Тульские Дизайнеры' },
  'clothes': { category: 'clothing', subcategory: '' },
  'rasprodazha': { category: 'sale', subcategory: '' },
  'rasprodazha-2': { category: 'sale', subcategory: '' },
  'podarochnye-nabory': { category: 'merch', subcategory: '' },
};

export default function SlugResolver() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";

  const { data: dynamicCategories } = useQuery<Record<string, CategoryConfig>>({
    queryKey: ["/api/categories"],
  });
  const categories = useMemo(
    () => normalizeCategories(dynamicCategories || CATEGORIES),
    [dynamicCategories]
  );

  const resolved = useMemo(() => {
    if (!slug) return null;

    for (const [catSlug, cat] of Object.entries(categories)) {
      const found = cat.subcategories.find((s) => s.slug === slug);
      if (found) {
        return { type: "subcategory" as const, catSlug, subName: found.name, subSlug: found.slug };
      }
    }

    if (categories[slug]) {
      return { type: "category" as const, catSlug: slug };
    }

    const legacy = LEGACY_SLUG_MAP[slug];
    if (legacy) {
      if (legacy.subcategory && categories[legacy.category]) {
        const cat = categories[legacy.category];
        const sub = cat.subcategories.find(s => s.name === legacy.subcategory);
        if (sub) {
          return { type: "subcategory" as const, catSlug: legacy.category, subName: sub.name, subSlug: sub.slug };
        }
      }
      if (categories[legacy.category]) {
        return { type: "category" as const, catSlug: legacy.category };
      }
    }

    return { type: "product" as const };
  }, [slug, categories]);

  if (!resolved || resolved.type === "product") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <ProductDetail />
      </Suspense>
    );
  }

  if (resolved.type === "category") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <ProductList forcedCatSlug={resolved.catSlug} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LoadingFallback />}>
      <ProductList
        forcedCatSlug={resolved.catSlug}
        forcedSubName={resolved.subName}
        forcedSubSlug={resolved.subSlug}
      />
    </Suspense>
  );
}
