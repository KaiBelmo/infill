import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { build as viteBuild, defineConfig, loadEnv, type Plugin } from "vite";
import manifest from "./manifest.config.js";

function createBuildDefines(env: Record<string, string>, mode: string): Record<string, string> {
  return {
    __VITE_API_BASE_URL__: JSON.stringify(env.VITE_API_BASE_URL ?? ""),
    __VITE_WEB_BASE_URL__: JSON.stringify(env.VITE_WEB_BASE_URL ?? ""),
    __VITE_EXTENSION_REDIRECT_PATH__: JSON.stringify(env.VITE_EXTENSION_REDIRECT_PATH ?? "/extension-redirect"),
    "process.env.NODE_ENV": JSON.stringify(mode)
  };
}
function classicServiceWorkerPlugin(env: Record<string, string>): Plugin {
  return {
    name: "infill-classic-service-worker",
    apply: "build",
    async closeBundle() {
      await viteBuild({
        configFile: false,
        envFile: false,
        root: __dirname,
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
            "@infill/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
            "@infill/form-brain": path.resolve(__dirname, "../../packages/form-brain/src/index.ts"),
            "@infill/profile-vault": path.resolve(__dirname, "../../packages/profile-vault/src/index.ts"),
          }
        },
        define: createBuildDefines(env, "production"),
        build: {
          emptyOutDir: false,
          target: "chrome109",
          lib: {
            entry: path.resolve(__dirname, "src/background/serviceWorker.ts"),
            name: "InfillServiceWorker",
            formats: ["iife"],
            fileName: () => "service-worker.js"
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true
            }
          }
        }
      });

      const manifestPath = path.resolve(__dirname, "dist", "manifest.json");
      const builtManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
        background?: { service_worker?: string; type?: string };
      };
      if (builtManifest.background?.service_worker) {
        builtManifest.background.service_worker = "service-worker.js";
        delete builtManifest.background.type;
        fs.writeFileSync(manifestPath, `${JSON.stringify(builtManifest, null, 2)}\n`, "utf-8");
      }
    }
  };
}
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), "VITE_");

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@infill/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
        "@infill/form-brain": path.resolve(__dirname, "../../packages/form-brain/src/index.ts"),
        "@infill/profile-vault": path.resolve(__dirname, "../../packages/profile-vault/src/index.ts"),
      }
    },
    define: createBuildDefines(env, mode),
    plugins: [
      react(),
      tailwindcss(),
      crx({ manifest }),
      classicServiceWorkerPlugin(env)
    ],
    build: {
      emptyOutDir: true,
      target: "chrome109",
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
