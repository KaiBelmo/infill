import { createSnaplogClient } from "@infill/snaplog";
import type { SnaplogEntry, SnaplogRuntime, SnaplogTransport } from "@infill/snaplog";

const DEBUG_STORAGE_KEY = "infillDebug";
let extensionDebugEnabled = false;

const snaplog = createSnaplogClient({
  runtime: detectRuntime(),
  source: "extension",
  debugEnabled: hasDebugFlag,
  transport: createRuntimeTransport()
});

function hasDebugFlag(): boolean {
  if (import.meta.env.DEV) {
    return true;
  }
  if (extensionDebugEnabled) {
    return true;
  }

  try {
    return globalThis.localStorage?.getItem(DEBUG_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

try {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(DEBUG_STORAGE_KEY)
      .then((result) => {
        extensionDebugEnabled = result[DEBUG_STORAGE_KEY] === true;
      })
      .catch(() => undefined);
    chrome.storage.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local" || !(DEBUG_STORAGE_KEY in changes)) return;
      extensionDebugEnabled = changes[DEBUG_STORAGE_KEY].newValue === true;
    });
  }
} catch {
  extensionDebugEnabled = false;
}

export function debugLog(...args: unknown[]): void {
  snaplog.debugLog(...args);
}

export function debugWarn(...args: unknown[]): void {
  snaplog.debugWarn(...args);
}

export function debugError(...args: unknown[]): void {
  snaplog.debugError(...args);
}

export function injectDebugLog(vars: Record<string, unknown>, source = "extension"): void {
  if (!hasDebugFlag()) return;
  snaplog.injectLog(vars, { source, runtime: detectRuntime() });
}

function createRuntimeTransport(): SnaplogTransport {
  return {
    record(entry: SnaplogEntry): void {
      try {
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
        chrome.runtime.sendMessage({ type: "snaplog-record", entry }).catch(() => undefined);
      } catch {
        // Debug instrumentation must never affect extension behavior.
      }
    }
  };
}

function detectRuntime(): SnaplogRuntime {
  try {
    const url = globalThis.location?.href ?? "";
    if (url.includes("popup")) return "extension-popup";
    if (url.includes("options")) return "extension-options";
    if (typeof chrome !== "undefined" && chrome.runtime?.id && !globalThis.document) return "extension-background";
    if (typeof chrome !== "undefined" && chrome.runtime?.id) return "extension-content";
  } catch {
    return "unknown";
  }
  return "unknown";
}
