import { describe, it, expect } from "vitest";
import { injectMeta } from "../static";

// Оболочка client/index.html после этапа 5: все управляемые теги помечены
// data-rh="true", чтобы react-helmet-async удалял их при гидратации.
const SHELL = `<html><head>
<title>BOOOMERANGS — российский бренд одежды и мерча</title>
<meta name="description" content="shell" data-rh="true" />
<meta name="robots" content="index, follow" data-rh="true" />
<meta property="og:title" content="shell" data-rh="true" />
<meta property="og:description" content="shell" data-rh="true" />
<meta property="og:image" content="/og-image.png" data-rh="true" />
<meta property="og:type" content="website" data-rh="true" />
<meta property="og:url" content="https://booomerangs.ru/" data-rh="true" />
<meta name="twitter:title" content="shell" data-rh="true" />
<meta name="twitter:description" content="shell" data-rh="true" />
<meta name="twitter:image" content="/og-image.png" data-rh="true" />
<link rel="canonical" href="https://booomerangs.ru/" data-rh="true">
</head><body></body></html>`;

const out = injectMeta(SHELL, {
  title: "Свитера — тест",
  description: "Проверка метаданных",
  ogImage: "https://booomerangs.ru/og.png",
  canonical: "https://booomerangs.ru/sweaters",
  jsonLd: '{"@type":"Thing"}',
});

describe("injectMeta", () => {
  it("подменяет title и description, не размножая теги", () => {
    expect(out).toContain("<title>Свитера — тест</title>");
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out.match(/<meta name="description"/g)).toHaveLength(1);
    expect(out).toContain('content="Проверка метаданных"');
  });

  it("оставляет canonical и og:url ровно по одному разу", () => {
    expect(out.match(/rel="canonical"/g)).toHaveLength(1);
    expect(out).toContain('href="https://booomerangs.ru/sweaters"');
    expect(out.match(/property="og:url"/g)).toHaveLength(1);
  });

  it("все управляемые meta сохраняют маркер data-rh (ровно один на тег)", () => {
    // Ни на одном теге не должно быть двух data-rh.
    expect(out).not.toMatch(/data-rh="true"[^>]*data-rh="true"/);
    expect(out).toMatch(/<link rel="canonical"[^>]*data-rh="true"/);
    expect(out).toMatch(/<meta property="og:url"[^>]*data-rh="true"/);
    expect(out).toMatch(/<meta name="description"[^>]*data-rh="true"/);
  });

  it("JSON-LD добавляет с тем же маркером", () => {
    expect(out.match(/application\/ld\+json/g)).toHaveLength(1);
    expect(out).toMatch(/application\/ld\+json" data-rh="true"/);
  });
});
