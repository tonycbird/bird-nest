import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

// Build stamp shown in Settings, so a stale service worker is easy to spot.
const BUILD = new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  // Nest's JSX runtime swaps any emoji that reaches the screen for a Nest icon (src/jsx).
  resolve: { alias: { "nest-jsx": fileURLToPath(new URL("./src/jsx", import.meta.url)) } },
  // Two pages: the app, and Body (the Fitness screens Nest shows in a frame).
  build: { rollupOptions: { input: { main: "index.html", body: "body.html" } } },
  plugins: [
    react({ jsxImportSource: "nest-jsx" }),
    VitePWA({
      registerType: "prompt", // a new build waits for a calm moment (app in background, or a Reload tap): see src/lib/update.ts
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        name: "Bird Nest",
        short_name: "Nest",
        description: "Today, step by step.",
        start_url: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#F4F5F8",
        theme_color: "#F4F5F8",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallback: "/index.html",
        // Supabase calls are never cached by the service worker; Dexie is the offline copy.
        navigateFallbackDenylist: [/^\/auth/, /^\/body/, /^\/api\//],
        // Buzzes from the helper (worker/) arrive here: public/push-sw.js.
        importScripts: ["push-sw.js"],
        // The Fitness script carries its exercise, stretch and food libraries, so it's big.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    })
  ],
  test: { environment: "node" }
});
