const DEBUG_STORAGE_KEY = "infillDebug";

function hasDebugFlag(): boolean {
  if (import.meta.env.DEV) {
    return true;
  }

  try {
    return globalThis.localStorage?.getItem(DEBUG_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function debugLog(...args: unknown[]): void {
  if (hasDebugFlag()) {
    console.log(...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (hasDebugFlag()) {
    console.warn(...args);
  }
}

export function debugError(...args: unknown[]): void {
  if (hasDebugFlag()) {
    console.error(...args);
  }
}
