import { Helmet } from "react-helmet-async";
import { serializeJsonLd } from "@shared/product-jsonld";

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

const SITE_NAME = "BOOOMERANGS";
const CANONICAL_ORIGIN = "https://booomerangs.ru";
const DEFAULT_DESCRIPTION = "Официальный интернет-магазин BOOOMERANGS. Одежда, носки и авторский мерч, коллекции артистов и лимитированные дропы. Доставка по всей России.";

function getAbsoluteUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${CANONICAL_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

interface SEOPropsExtended extends SEOProps {
  ogImageWidth?: string;
  ogImageHeight?: string;
  /** true — добавить «| BOOOMERANGS», если бренда нет в самом заголовке.
   *  По умолчанию НЕ добавляем: ТЗ п.5 требует выдавать Title из настроек как есть. */
  brandSuffix?: boolean;
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
  ogImageWidth = "1200",
  ogImageHeight = "630",
  brandSuffix = false,
}: SEOPropsExtended) {
  // Автоприписка «| BMGBRAND» убрана (ТЗ п.5): Title из админки/страницы выводится как есть.
  const fullTitle = title
    ? (brandSuffix && !title.includes(SITE_NAME) ? `${title} | ${SITE_NAME}` : title)
    : "BOOOMERANGS — российский бренд одежды и мерча";
  const absoluteOgImage = getAbsoluteUrl(ogImage);
  const canonicalUrl = canonical || `${CANONICAL_ORIGIN}${window.location.pathname}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}
      {noindex
        ? <meta name="robots" content="noindex, follow" />
        : <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
      }
      {/* Canonical always present — even noindex pages need it to avoid duplication signals */}
      <link rel="canonical" href={canonicalUrl} />

      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={absoluteOgImage} />
      <meta property="og:image:width" content={ogImageWidth} />
      <meta property="og:image:height" content={ogImageHeight} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="ru_RU" />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={absoluteOgImage} />

      {jsonLd && (
        <script type="application/ld+json">
          {/* serializeJsonLd экранирует <, >, & и U+2028/U+2029, чтобы отзывы
              покупателей и SEO-тексты не могли «разорвать» тег <script>. */}
          {serializeJsonLd(jsonLd)}
        </script>
      )}
    </Helmet>
  );
}
