/**
 * Synchronous color/model variant matching — extracted for use by bot-ssr.ts,
 * which must never call YDB and only reads warm in-memory caches.
 *
 * This mirrors the matching cascade used by the live `/api/products/:id/variants`
 * endpoint in server/routes.ts (extractModelName/extractArticleCode/parseSkuForVariants/
 * extractSkuFromName/extractBrandPrefix/isKnownColor + the same fallback order).
 * It is a deliberate, self-contained copy — not a shared import from routes.ts —
 * so the existing live endpoint is never touched by this change.
 */

import { extractColorFromName } from "./categoryMapper";

export interface VariantMatchInput {
  id: number;
  slug: string;
  name: string;
  sku: string | null;
  price: number;
  stock: number;
  imageUrl: string;
  thumbnailUrl: string;
  isHidden: boolean;
  colors: string[];
}

export interface VariantResult {
  id: number;
  slug: string;
  color: string;
  name: string;
  imageUrl: string;
  thumbnailUrl: string;
  price: number;
  stock: number;
  sizeRange: string | null;
}

const KNOWN_COLORS = new Set([
  'черный', 'черная', 'черные', 'белый', 'белая', 'белые', 'серый', 'серая', 'серые',
  'синий', 'синяя', 'синие', 'красный', 'красная', 'красные', 'зеленый', 'зеленая', 'зеленые',
  'желтый', 'желтая', 'желтые', 'розовый', 'розовая', 'розовые', 'фиолетовый', 'фиолетовая', 'фиолетовые',
  'коричневый', 'коричневая', 'коричневые', 'бежевый', 'бежевая', 'бежевые', 'оранжевый', 'оранжевая', 'оранжевые',
  'голубой', 'голубая', 'голубые', 'хаки', 'песочный', 'песочная', 'песочные', 'мятный', 'мятная', 'мятные',
  'молочный', 'молочная', 'молочные', 'персиковый', 'персиковая', 'персиковые', 'бордовый', 'бордовая', 'бордовые',
  'графит', 'графитовый', 'графитовая',
  'оливковый', 'оливковые', 'оливковая', 'вери пери', 'т.синий', 'темно-синий', 'тёмно-синий',
  'горчичный', 'горчичные', 'горчичная', 'лайм', 'лаймовый', 'лаймовая',
  'айсберг', 'камо', 'бодовый',
  'т.серый', 'т.серая', 'т.серые',
]);

export function isKnownColor(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  if (KNOWN_COLORS.has(normalized)) return true;
  if (normalized.includes('/')) {
    const base = normalized.split('/')[0].trim();
    if (KNOWN_COLORS.has(base)) return true;
  }
  if (normalized.startsWith('тёмно-') || normalized.startsWith('темно-')) return true;
  return false;
}

export function extractModelName(name: string): string | null {
  const allDoubleQuotes: string[] = [];
  const dqRegex = /"([^"]+)"/g;
  let dqMatch;
  while ((dqMatch = dqRegex.exec(name)) !== null) allDoubleQuotes.push(dqMatch[1]);

  const allAngleQuotes: string[] = [];
  const aqRegex = /«([^»]+)»/g;
  let aqMatch;
  while ((aqMatch = aqRegex.exec(name)) !== null) allAngleQuotes.push(aqMatch[1]);

  const quotedParts = allDoubleQuotes.length > 0 ? allDoubleQuotes : allAngleQuotes;
  if (quotedParts.length > 0) {
    let model = quotedParts.map(p => p.toLowerCase().replace(/[&%]/g, '').trim()).join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (model && model.length >= 2) {
      let lastQuoteEnd = -1;
      const dqr2 = /"([^"]+)"/g;
      let m2;
      while ((m2 = dqr2.exec(name)) !== null) lastQuoteEnd = m2.index + m2[0].length;
      const aqr2 = /«([^»]+)»/g;
      while ((m2 = aqr2.exec(name)) !== null) lastQuoteEnd = m2.index + m2[0].length;

      if (lastQuoteEnd > 0) {
        const rest = name.substring(lastQuoteEnd);
        const parenMatch = rest.match(/^([^(]*)\(/);
        const rawSuffix = (parenMatch ? parenMatch[1] : rest).replace(/["«»]/g, '').trim();
        if (rawSuffix) {
          const suffixWords = rawSuffix.split(/\s+/).filter(w => w.length > 0);
          const textMods = suffixWords.filter(w => !/\d/.test(w) && !isKnownColor(w));
          if (textMods.length > 0) model = model + ' ' + textMods.join(' ').toLowerCase();
        }
      }
      return model;
    }
  }

  const underscoreFullMatch = name.match(/BMGBRAND_(.+?)[\s(]/i);
  if (underscoreFullMatch) {
    const segments = underscoreFullMatch[1].split('_').filter(s => s.length > 0);
    const modelSegments = segments.filter(s => !/\d/.test(s));
    const model = modelSegments.join('_').toLowerCase().trim();
    if (model && model.length >= 2) return model;
  }

  const firstParen = name.indexOf('(');
  if (firstParen > 0) {
    const beforeParen = name.substring(0, firstParen).trim();
    let modelPart = beforeParen
      .replace(/^(куртка|анорак|жилет|ветровка|футболка|свитшот|брюки|шорты|толстовка|носки|худи|лонгслив|поло|майка|рубашка|кепка|бейсболка|панама|свитер)\s+/i, '')
      .replace(/^(BMGBRAND|BOOOMERANGS|BMG)\s*/i, '')
      .replace(/(BMGBRAND|BOOOMERANGS|BMG)\s*/gi, '')
      .replace(/^(coach\s+jacket)\s*/i, '')
      .trim();

    if (modelPart && modelPart.length >= 3 && /[a-zA-Z]{2,}/.test(modelPart)) {
      let model = modelPart.toLowerCase()
        .replace(/[&%]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/([a-z])(\d)/gi, '$1 $2')
        .replace(/(\d)([a-z])/gi, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
      if (model && model.length >= 3) {
        const allParens = [...name.matchAll(/\(([^)]+)\)/g)];
        for (const pm of allParens) {
          const content = pm[1].trim();
          if (!isKnownColor(content) && content.length >= 2) model = model + ' ' + content.toLowerCase();
        }
        return model;
      }
    }
  }

  const nestedParenMatch = name.match(/\(([^()]*\([^)]*\)[^)]*)\)/);
  if (nestedParenMatch) {
    const content = nestedParenMatch[1].trim();
    if (!isKnownColor(content)) {
      const model = content.toLowerCase().replace(/\s+/g, ' ').trim();
      if (model && model.length >= 2) return model;
    }
  }

  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const content = parenMatch[1];
    if (isKnownColor(content)) return null;

    let model = content.toLowerCase()
      .replace(/[&%]/g, '')
      .replace(/№\s*(nk|gk|gr|n|g|r)?\s*0*\d+/gi, '')
      .replace(/\b(nk|gk|gr|n|g|r)\s*0*\d+\b/gi, '')
      .replace(/\bkids\s*\d*\b/gi, '')
      .replace(/v\.\d+/gi, '')
      .replace(/\b[a-z]\s+$/gi, '')
      .replace(/\bonesize\b/gi, '')
      .trim()
      .replace(/\s+/g, ' ');

    if (model && model.length >= 2) {
      const closingParenIdx = name.indexOf(')');
      if (closingParenIdx >= 0) {
        const afterParen = name.substring(closingParenIdx + 1).trim();
        if (afterParen) {
          const cleanAfter = afterParen
            .replace(/[БбКкЧчСсЗз]\/[ПпНн]/g, '')
            .replace(/\([^)]*\)/g, '')
            .trim();
          const words = cleanAfter.split(/\s+/).filter(w => w.length > 0);
          const printWords = words.filter(w => {
            const stripped = w.replace(/[()]/g, '');
            if (isKnownColor(stripped)) return false;
            if (isKnownColor(w)) return false;
            if (/^\(?\d{2}[-\/]\d{2}\)?$/.test(w)) return false;
            if (/^\d+$/.test(w)) return false;
            if (/^[ОO]\/S$/i.test(w)) return false;
            return true;
          });
          if (printWords.length > 0) {
            const printName = printWords.join(' ').toLowerCase().trim();
            model = model + ' ' + printName;
          }
        }
      }
      return model;
    }
  }

  return null;
}

export function extractArticleCode(name: string): string | null {
  const dqCount = (name.match(/"[^"]+"/g) || []).length;
  const aqCount = (name.match(/«[^»]+»/g) || []).length;
  const hasMultipleQuotedParts = dqCount > 1 || aqCount > 1;

  const underscoreMatch = name.match(/BMGBRAND_[^_]+_([A-Z0-9][\w\-]*)/i);
  if (underscoreMatch) {
    let articlePart = underscoreMatch[1].split(/\s+/)[0];
    articlePart = articlePart.replace(/-\d+$/, '');
    return articlePart.toUpperCase();
  }

  const nameWithoutQuotes = name.replace(/"[^"]*"/g, '').replace(/«[^»]*»/g, '');
  const slashPattern = nameWithoutQuotes.match(/\b([A-Z]{2,}[\/]\d+)\b/i);
  if (slashPattern) return slashPattern[1].toUpperCase();

  const parenArticleMatch = name.match(/\)\s*([A-Z]\d{2,3})\b/i);
  if (parenArticleMatch) return parenArticleMatch[1].toUpperCase();

  const letterNumPattern = nameWithoutQuotes.match(/\b([A-Z]{2,}\d{2,})\b/i);
  if (letterNumPattern) return letterNumPattern[1].toUpperCase();

  if (!hasMultipleQuotedParts) {
    const numPattern = name.match(/[»"]\s*(\d{2,3})\s*(?:\(|$)/);
    if (numPattern) return numPattern[1];
    const numAfterTextPattern = name.match(/[»"]\s+[A-Za-z]+\s+(\d{2,3})\b/);
    if (numAfterTextPattern) return numAfterTextPattern[1];
    const numBeforeTextPattern = name.match(/[»"]\s*(\d{2,3})\s+\S+\s*\(/);
    if (numBeforeTextPattern) return numBeforeTextPattern[1];
  }

  return null;
}

export function extractBrandPrefix(name: string): string {
  const underscoreMatch = name.match(/^([^_]+_?BMGBRAND)/i);
  if (underscoreMatch) {
    const prefix = underscoreMatch[0].replace(/_/g, ' ').toLowerCase().trim();
    const words = prefix.split(/\s+/);
    return words.slice(0, 2).join(' ').trim();
  }

  const match = name.match(/^([^("«(]+)/);
  if (!match) return '';
  const words = match[1].toLowerCase().replace(/[&%]/g, '').trim().split(/\s+/);
  return words.slice(0, 2).join(' ').trim();
}

export function parseSkuForVariants(sku: string): { styleGroup: string; number: string } | null {
  let s = sku.toLowerCase().replace(/\s+/g, '').trim();
  s = s.replace(/№([a-z])/i, '$1');
  s = s.replace(/№/g, 'n');

  let match = s.match(/^(nk|gk)0*(\d+)$/i);
  if (match) return { styleGroup: 'short', number: match[2] };

  match = s.match(/^(gr)0*(\d+)$/i);
  if (match) return { styleGroup: 'sport', number: match[2] };
  match = s.match(/^(r)0*(\d+)$/i);
  if (match) return { styleGroup: 'sport', number: match[2] };

  match = s.match(/^(n|g)0*(\d+)$/i);
  if (match) return { styleGroup: 'classic', number: match[2] };

  match = s.match(/^kids\s*0*(\d+)$/i);
  if (match) return { styleGroup: 'kids', number: match[1] };

  match = s.match(/^([a-z]+)0*(\d+)$/i);
  if (match) return { styleGroup: match[1], number: match[2] };

  return null;
}

export function extractSkuFromName(name: string): string | null {
  const match = name.match(/\(([^)]+)\)/);
  if (!match) return null;

  const content = match[1];

  const numSignLetterMatch = content.match(/№\s*(nk|gk|gr|n|g|r)\s*0*(\d+)/i);
  if (numSignLetterMatch) return numSignLetterMatch[1].toUpperCase() + numSignLetterMatch[2];

  const numSignOnlyMatch = content.match(/№\s*0*(\d+)/i);
  if (numSignOnlyMatch) return 'N' + numSignOnlyMatch[1];

  const skuMatch = content.match(/(?:^|\s)(nk|gk|gr|n|g|r)\s*0*(\d+)(?:\s|$|\))/i);
  if (skuMatch) return skuMatch[1].toUpperCase() + skuMatch[2];

  const endMatch = content.match(/(nk|gk|gr|n|g|r|№)\s*0*(\d+)\s*$/i);
  if (endMatch) return endMatch[1].toUpperCase().replace('№', 'N') + endMatch[2];

  return null;
}

function extractSizeRange(name: string): string | null {
  const match = name.match(/\b(40[-\/]45|34[-\/]39|29[-\/]33)\b/i);
  return match ? match[1].replace('/', '-') : null;
}

function stripColorsFromName(n: string, isColor: (t: string) => boolean): string {
  let result = n;
  const allParens = [...result.matchAll(/\(([^)]+)\)/g)];
  for (const m of allParens) {
    if (isColor(m[1])) result = result.replace(m[0], ' ');
  }
  const words = result.trim().split(/\s+/);
  while (words.length > 0 && isColor(words[words.length - 1])) words.pop();
  return words.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Synchronous variant matching, mirroring the live /api/products/:id/variants
 * endpoint's cascade. Returns deduped color/size variants (current product
 * included), filtered to visible, priced, real-image products.
 */
export function findProductVariantsSync(
  product: VariantMatchInput,
  allProducts: VariantMatchInput[],
): VariantResult[] {
  const productModelName = extractModelName(product.name);
  const productBrandPrefix = extractBrandPrefix(product.name);

  const skuFromField = product.sku ? parseSkuForVariants(product.sku) : null;
  const skuFromName = extractSkuFromName(product.name);
  const skuFromNameParsed = skuFromName ? parseSkuForVariants(skuFromName) : null;
  const productSkuParsed = skuFromNameParsed || skuFromField;

  let variants: VariantMatchInput[] = [];
  const variantIds = new Set<number>();

  const productArticle = extractArticleCode(product.name);
  const hasQuotedModel = product.name.match(/["«]/) !== null;
  const hasUnderscoreModel = product.name.match(/BMGBRAND_[^_]+_/i) !== null;

  if ((hasQuotedModel || hasUnderscoreModel) && productArticle && productModelName) {
    const articleVariants = allProducts.filter(p => {
      if (extractBrandPrefix(p.name) !== productBrandPrefix) return false;
      const pModelName = extractModelName(p.name);
      if (!pModelName || pModelName !== productModelName) return false;
      return extractArticleCode(p.name) === productArticle;
    });
    articleVariants.forEach(v => { if (!variantIds.has(v.id)) { variants.push(v); variantIds.add(v.id); } });
  }

  if (variants.length <= 1 && productSkuParsed && productModelName && !hasQuotedModel && !hasUnderscoreModel) {
    const skuVariants = allProducts.filter(p => {
      const pModelName = extractModelName(p.name);
      if (!pModelName || pModelName !== productModelName) return false;
      if (extractBrandPrefix(p.name) !== productBrandPrefix) return false;
      const pSkuFromName = extractSkuFromName(p.name);
      const pSkuParsed = pSkuFromName ? parseSkuForVariants(pSkuFromName) : (p.sku ? parseSkuForVariants(p.sku) : null);
      if (!pSkuParsed) return false;
      return pSkuParsed.styleGroup === productSkuParsed.styleGroup && pSkuParsed.number === productSkuParsed.number;
    });
    skuVariants.forEach(v => { if (!variantIds.has(v.id)) { variants.push(v); variantIds.add(v.id); } });
  }

  if (variants.length <= 1 && productModelName && productArticle) {
    const combinedVariants = allProducts.filter(p => {
      if (extractBrandPrefix(p.name) !== productBrandPrefix) return false;
      return extractModelName(p.name) === productModelName && extractArticleCode(p.name) === productArticle;
    });
    combinedVariants.forEach(v => { if (!variantIds.has(v.id)) { variants.push(v); variantIds.add(v.id); } });
  }

  if (variants.length <= 1 && productArticle && !productModelName) {
    const articleVariants = allProducts.filter(p => {
      if (extractBrandPrefix(p.name) !== productBrandPrefix) return false;
      return extractArticleCode(p.name) === productArticle;
    });
    articleVariants.forEach(v => { if (!variantIds.has(v.id)) { variants.push(v); variantIds.add(v.id); } });
  }

  if (variants.length <= 1 && productModelName && productModelName.length >= 2 && !productArticle && !productSkuParsed) {
    const nameVariants = allProducts.filter(p => {
      const pModelName = extractModelName(p.name);
      if (!pModelName) return false;
      if (extractBrandPrefix(p.name) !== productBrandPrefix) return false;
      return pModelName === productModelName;
    });
    nameVariants.forEach(v => { if (!variantIds.has(v.id)) { variants.push(v); variantIds.add(v.id); } });
  }

  if (variants.length <= 1 && !productModelName && !productArticle && !productSkuParsed) {
    const productColorMatch = product.name.match(/\(([^)]+)\)/);
    if (productColorMatch && isKnownColor(productColorMatch[1])) {
      const productBaseName = product.name.replace(/\s*\([^)]+\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (productBaseName.length >= 5) {
        const baseNameVariants = allProducts.filter(p => {
          if (p.id === product.id) return false;
          const pColorMatch = p.name.match(/\(([^)]+)\)/);
          if (!pColorMatch || !isKnownColor(pColorMatch[1])) return false;
          const pBaseName = p.name.replace(/\s*\([^)]+\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
          return pBaseName === productBaseName;
        });
        baseNameVariants.forEach(v => { if (!variantIds.has(v.id)) { variants.push(v); variantIds.add(v.id); } });
      }
    }
  }

  if (variants.length <= 1 && !productModelName && !productArticle && !productSkuParsed) {
    const productStripped = stripColorsFromName(product.name, isKnownColor);
    if (productStripped.length >= 10) {
      const strippedVariants = allProducts.filter(p => {
        if (p.id === product.id) return false;
        return stripColorsFromName(p.name, isKnownColor) === productStripped;
      });
      strippedVariants.forEach(v => { if (!variantIds.has(v.id)) { variants.push(v); variantIds.add(v.id); } });
    }
  }

  if (!variants.some(v => v.id === product.id)) variants = [product, ...variants];

  variants = variants.filter(v => {
    if (v.isHidden) return false;
    if (!v.price || v.price <= 0) return false;
    if (!v.imageUrl || !v.imageUrl.startsWith('http')) return false;
    return true;
  });

  const colorVariants: VariantResult[] = variants.map(v => {
    const extractedColor = extractColorFromName(v.name);
    return {
      id: v.id,
      slug: v.slug || '',
      color: extractedColor || v.colors?.[0] || 'Default',
      name: v.name,
      imageUrl: v.imageUrl,
      thumbnailUrl: v.thumbnailUrl,
      price: v.price,
      stock: v.stock || 0,
      sizeRange: extractSizeRange(v.name),
    };
  });

  const seenColorSize = new Map<string, VariantResult>();
  for (const cv of colorVariants) {
    const key = `${cv.color.toLowerCase()}|${cv.sizeRange || ''}`;
    const existing = seenColorSize.get(key);
    if (!existing || cv.stock > existing.stock) seenColorSize.set(key, cv);
  }
  return [...seenColorSize.values()];
}
