import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    ...(process.env.NODE_ENV !== "production" ? [runtimeErrorOverlay()] : []),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Tiny shared utilities MUST NOT live inside heavy admin chunks.
          // Rollup co-locates small modules used by both the entry and
          // admin-only libraries into the manualChunk of the heavy library,
          // which forces the entry to import the entire 380 KB+ vendor
          // chunk just for clsx()/useSyncExternalStore(). Keep them separate.
          if (
            id.includes('/node_modules/clsx/') ||
            id.includes('/node_modules/tailwind-merge/')
          ) {
            return 'vendor-utils';
          }
          if (id.includes('/node_modules/use-sync-external-store/')) {
            return 'vendor-react';
          }
          // Admin-only: charts (recharts + d3 deps) — never load on storefront
          if (
            id.includes('/node_modules/recharts/') ||
            id.includes('/node_modules/d3-') ||
            id.includes('/node_modules/d3/') ||
            id.includes('/node_modules/victory-')
          ) {
            return 'vendor-charts';
          }
          // Admin-only: rich text editor
          if (id.includes('/node_modules/@tiptap/')) {
            return 'vendor-editor';
          }
          // Partner/wholesale only: PDF viewer — extremely heavy
          if (
            id.includes('/node_modules/pdfjs-dist/') ||
            id.includes('/node_modules/react-pdf/')
          ) {
            return 'vendor-pdf';
          }
          // Animation — separate chunk, loaded when first animation mounts
          if (id.includes('/node_modules/framer-motion/')) {
            return 'vendor-motion';
          }
          // Carousel — Home + ProductDetail only
          if (id.includes('/node_modules/embla-carousel')) {
            return 'vendor-carousel';
          }
          // Core React — always needed, keep together
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/')
          ) {
            return 'vendor-react';
          }
          // Data fetching
          if (id.includes('/node_modules/@tanstack/')) {
            return 'vendor-query';
          }
          // Radix UI primitives — needed on most pages
          if (id.includes('/node_modules/@radix-ui/')) {
            return 'vendor-ui';
          }
          // Forms
          if (
            id.includes('/node_modules/react-hook-form/') ||
            id.includes('/node_modules/@hookform/')
          ) {
            return 'vendor-forms';
          }
          // Validation
          if (
            id.includes('/node_modules/zod/') ||
            id.includes('/node_modules/zod-validation-error/')
          ) {
            return 'vendor-zod';
          }
          // Date utilities
          if (id.includes('/node_modules/date-fns/')) {
            return 'vendor-date';
          }
        },
      },
    },
  },
  server: {
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
