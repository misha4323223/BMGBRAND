# Booomerangs (BMGBRAND) - E-commerce Store

## Project Overview
Stylish internet store for Russian clothing brand Booomerangs (BMGBRAND).
Focus on "soaking the site in the brand" - unique prints, streetwear aesthetic, high contrast.
Target deployment: Yandex Serverless Containers + YDB + Object Storage.
Current state: Development in Replit.

## Brand Analysis
- **Brand Name:** Booomerangs / BMGBRAND
- **Style:** Russian streetwear, youth, unique prints.
- **Aesthetic:** High contrast (Black/White + Accents), Urban, Goth/Punk influences, "Underground".
- **Philosophy:** "We make things we wear ourselves".

## Technical Architecture
- **Frontend:** React (Vite), Tailwind CSS, Shadcn UI.
- **Backend:** Node.js Express (stateless, ready for serverless/functions).
- **Database:** YDB (Yandex Database) via Drizzle-like ORM adapter.
- **State Management:** TanStack Query.
- **Image Storage:** Yandex Object Storage with WebP optimization + thumbnails.

## Features
- Product Catalog with category/subcategory filtering
- Product Details (Large images, size selection)
- Shopping Cart (Session-based with composite keys)
- Checkout (Simple form)
- 1C Integration (import.xml for products, offers.xml for prices)
- Admin endpoints protected by SYNC_API_KEY

## Category System
- **Main categories:** Clothing, Socks, Accessories, Merch, Sale
- **Auto-mapping:** SKU prefixes (H=hoodies, SW=sweatshirts, N=socks, etc.) + name keywords
- **Special logic:** Socks subcategories include size range (40-45, 34-39)
- **API endpoints:** GET /api/categories, POST /api/backfill-categories

## Design Guidelines
- **Colors:** Black, White, Red/Neon accents.
- **Typography:** Bold, experiment with Cyrillic-style fonts or monospace.
- **Layout:** Minimalist navigation, print-focused, mobile-first.

## Key Files
- `server/categoryMapper.ts` - Category mapping logic
- `shared/schema.ts` - CATEGORIES structure + product schema
- `client/src/pages/ProductList.tsx` - Category navigation UI
- `.github/workflows/deploy.yml` - Yandex Cloud deployment
