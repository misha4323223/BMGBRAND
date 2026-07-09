import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import "./index.css";
import { queryClient } from "./lib/queryClient";

// Pre-populate React Query cache with server-injected page settings so that
// the Home page's first render never hits the settingsLoading blank state.
// window.__HOME_SETTINGS__ is injected by server/static.ts (prod) and
// server/vite.ts (dev) alongside the existing window.__HERO__ pattern.
declare global {
  interface Window {
    __HOME_SETTINGS__?: Record<string, any>;
  }
}

if (window.__HOME_SETTINGS__) {
  queryClient.setQueryData(["/api/page-settings/home"], window.__HOME_SETTINGS__);
}

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
