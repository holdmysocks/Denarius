import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Stable vendor libraries used by the app shell get their own long-cached
// chunks, which also keeps the main entry chunk under Rollup's 500 kB warning.
// recharts/d3 are deliberately left out: only lazy-loaded pages use them, and
// a manual chunk would pull their shared deps (clsx, etc.) into the entry's
// preload list. date-fns is unused at runtime, so it has no group either.
const VENDOR_CHUNKS: [chunk: string, packages: RegExp][] = [
  ["react-vendor", /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@remix-run)[\\/]/],
  ["tanstack", /[\\/]node_modules[\\/]@tanstack[\\/]/],
  ["radix", /[\\/]node_modules[\\/]@radix-ui[\\/]/],
  ["motion", /[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/],
  ["icons", /[\\/]node_modules[\\/]lucide-react[\\/]/],
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          return VENDOR_CHUNKS.find(([, pattern]) => pattern.test(id))?.[0];
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
