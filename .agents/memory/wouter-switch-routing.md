---
name: Wouter v3 Switch path stripping
description: useRoute inside a Switch-rendered component returns null in Wouter v3; how merch subcategories are routed
---

## Rule
In Wouter v3, `<Switch>` renders the first matching `<Route>`, but `useRoute()` called *inside* the rendered child component returns `null` — the params are not available via nested `useRoute`. The matched path appears to be "consumed" by the Switch.

**Why:** Wouter v3 changed routing context behavior. Inside a Switch-rendered component, `useRoute("/products/:catSlug/:subSlug")` does not re-match the current location, so params like `catSlug` and `subSlug` come back as `null`.

**How to apply:**
- Do NOT rely on `catSubParams` / `useRoute` inside ProductList for path-based subcategory routing.
- Use `forcedSubSlug` / `forcedCatSlug` props passed from SlugResolver instead.
- For `effectiveSubSlug`: `pathSubSlug || forcedSubSlug || null`.

## Merch subcategory routing architecture
Merch subcategory pages open via `/{subSlug}` (e.g. `/gudtajms`), NOT `/products/merch/{subSlug}`.

Flow: `/{slug}` → App.tsx `/:slug` route → SlugResolver → resolves slug via categories API → renders `<ProductList forcedCatSlug="merch" forcedSubName="ГУДТАЙМС" forcedSubSlug="gudtajms" />`.

So `isMerchSub` must check `forcedSubSlug`, not the URL path segment.

## Navigation from collab cards
Use `navigate('/{subSlug}')` (e.g. `/gudtajms`), NOT `/products/merch/{subSlug}` — the latter doesn't pass params through correctly in Wouter v3 Switch.
