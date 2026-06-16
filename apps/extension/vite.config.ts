import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import manifest from "./manifest.config.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), "VITE_");

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      }
    },
    define: {
      __VITE_API_BASE_URL__: JSON.stringify(env.VITE_API_BASE_URL ?? ""),
      __VITE_WEB_BASE_URL__: JSON.stringify(env.VITE_WEB_BASE_URL ?? ""),
      __VITE_EXTENSION_REDIRECT_PATH__: JSON.stringify(env.VITE_EXTENSION_REDIRECT_PATH ?? "/extension-redirect")
    },
    plugins: [
      react(),
      tailwindcss(),
      crx({ manifest })
    ],
    build: {
      emptyOutDir: true,
      rollupOptions: {
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]"
        }
      }
    },
    server: {
      cors: {
        origin: [/chrome-extension:\/\//]
      }
    }
  };
});
