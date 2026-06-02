import { Helmet } from "react-helmet-async";

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  ogType?: string;
  ogImage?: string;
  canonical?: string;
  noindex?: boolean;
  jsonLd?: Record<string, any> | Record<string, any>[];
}

const SITE_NAME = "BMGBRAND";
const CANONICAL_ORIGIN = "https://booomerangs.ru";
const DEFAULT_DESCRIPTION = "BMGBRAND — российский бренд одежды и аксессуаров. Худи, футболки, носки, авторские принты. Оплата частями через Долями. Доставка по всей России.";

function getAbsoluteUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${CANONICAL_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

export default function SEO({
  title,
  description = DEFAULT_DESCRIPTION,
  keywords,
  ogType = "website",
  ogImage = "/og-image.png",
  canonical,
  noindex = false,
  jsonLd,
}: SEOProps) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : `Booomerangs — Российский бренд одежды Booomerangs/BMGBRAND`;
  const absoluteOgImage = getAbsoluteUrl(ogImage);
  const canonicalUrl = canonical || `${CANONICAL_ORIGIN}${window.location.pathname}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      {!noindex && <link rel="canonical" href={canonicalUrl} />}

      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={absoluteOgImage} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="ru_RU" />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={absoluteOgImage} />

      {jsonLd && (
        <script type="application/ld+json">
          {JSON.stringify(Array.isArray(jsonLd) ? jsonLd : jsonLd)}
        </script>
      )}
    </Helmet>
  );
}
