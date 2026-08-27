// Storage module entry point — re-exports everything from core.
// Consumers keep `import { ... } from "./storage"` — bundler resolution
// routes it to this index.ts. Domain files (settings.ts, orders.ts, ...)
// extend DatabaseStorage via typed prototype assignment; importing them
// here installs the prototype patches before the first storage call.
import "./settings";
import "./orders";
import "./products";
import "./cart";
import "./gift-cards";
import "./promos";
import "./reviews";
import "./notifications";
import "./partners";
import "./commissions";
import "./payouts";
import "./legal";
import "./artist-tracks";
import "./chat";
import "./wholesale";
import "./cart-reminders";
export * from "./core";
