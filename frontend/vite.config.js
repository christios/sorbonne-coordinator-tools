import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "path";
import { devSession } from "./vite-plugins/dev-session.js";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  build: {
    outDir: process.env.VITE_OUT_DIR ?? "dist",
    emptyOutDir: true,
    rollupOptions: {
      // The application, and the small page Microsoft's sign-in popup comes back to.
      input: {
        index: resolve(__dirname, "index.html"),
        microsoft: resolve(__dirname, "microsoft-signin.html"),
      },
    },
  },
  plugins: [viteReact(), tailwindcss(), devSession()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
  server: {
    strictPort: true,
    host: "127.0.0.1",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
