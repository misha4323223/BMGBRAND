---
    name: Merch page SEO & Bot SSR
    description: /merch-na-zakaz не имел Bot SSR — ботам отдавался пустой div; исправлено добавлением renderMerchOrder() в bot-ssr.ts
    ---

    ## Правило
    Страница /merch-na-zakaz требует renderMerchOrder() в server/bot-ssr.ts.

    **Why:** До 20.07.2026 bot-ssr.ts не обрабатывал /merch-na-zakaz — Яндекс и Google видели пустой `<div id="root">`. Вся JSON-LD разметка и контент были невидимы ботам.

    **How to apply:** При добавлении новых маркетинговых страниц — всегда проверять bot-ssr.ts и добавлять render-функцию. Шаблон: renderAbout() / renderFaq() / renderMerchOrder().

    ## Что было сделано (20.07.2026)
    - server/bot-ssr.ts: добавлена renderMerchOrder(), подключена в middleware после /faq
    - server/routes.ts: /merch-na-zakaz sitemap changefreq monthly→weekly, priority 0.8→0.9
    - client/src/pages/MerchOrder.tsx: SEO-текстовый блок (H2 "Футболки с логотипом на заказ" / "Худи и толстовки с принтом" / "Носки с символикой компании" + технологии + B2B/гео)
    - client/src/pages/MerchOrder.tsx: блок "Часто заказывают" с 5 внутренними ссылками перед FAQ

    ## Проверка Bot SSR
    ```bash
    curl -s -A "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)" http://localhost:5000/merch-na-zakaz | grep -E "<h[12]|X-Bot-SSR"
    ```
    