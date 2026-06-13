import { createMemorySnaplogStore, createSnaplogClient } from "@infill/snaplog";
import type { SnaplogEntry, SnaplogQuery } from "@infill/snaplog";
import {
  createExtensionSnaplogTransport,
  DEFAULT_EXTENSION_SNAPLOG_KEY
} from "@infill/snaplog/extension";

const MAX_EXTENSION_SNAPLOG_ENTRIES = 500;

const transport = hasChromeStorage()
  ? createExtensionSnaplogTransport({
      storage: chrome.storage.local,
      key: DEFAULT_EXTENSION_SNAPLOG_KEY,
      maxEntries: MAX_EXTENSION_SNAPLOG_ENTRIES
    })
  : createMemorySnaplogStore(MAX_EXTENSION_SNAPLOG_ENTRIES);

export const backgroundSnaplog = createSnaplogClient({
  runtime: "extension-background",
  source: "background",
  debugEnabled: () => import.meta.env.DEV,
  transport
});

export async function recordSnaplogEntry(entry: SnaplogEntry): Promise<void> {
  await transport.record(entry);
}

export async function readSnaplogEntries(): Promise<SnaplogEntry[]> {
  return await transport.read?.() ?? [];
}

export async function clearSnaplogEntries(): Promise<void> {
  await transport.clear?.();
}

export async function querySnaplogEntries(query: SnaplogQuery): Promise<SnaplogEntry[]> {
  return await backgroundSnaplog.queryLogs(query);
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}
