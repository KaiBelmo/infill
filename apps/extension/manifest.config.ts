import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "Infill",
  version: pkg.version,
  description: "Local-first form filling with preview before fill.",
  permissions: ["activeTab", "scripting", "storage", "tabs", "webNavigation"],
  host_permissions: ["file:///*", "https://*/*", "http://*/*"],
  background: {
    service_worker: "src/background/serviceWorker.ts",
    type: "module"
  },
  icons: {
    "16": "public/infill-icon.png",
    "48": "public/infill-icon.png",
    "128": "public/infill-icon.png"
  },
  action: {
    default_title: "Open Infill",
    default_popup: "src/popup/index.html",
    default_icon: {
      "16": "public/infill-icon.png",
      "48": "public/infill-icon.png",
      "128": "public/infill-icon.png"
    }
  },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*", "file:///*"],
      js: ["src/content/contentScript.ts"],
      run_at: "document_idle"
    }
  ],
  options_page: "src/options/index.html"
});
