import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StoredScanState } from "@/shared/types";

export type ScanStoreState = {
  tabs: Record<number, StoredScanState>;
};

type ScanStoreActions = {
  getScanState: (tabId?: number | null) => StoredScanState;
  setScanState: (tabId: number, patch: Partial<StoredScanState>) => void;
  clearScanState: (tabId: number) => void;
};

export function emptyState(tabId: number | null): StoredScanState {
  return {
    tabId,
    url: "",
    status: "Ready",
    forms: [],
    mappings: [],
    error: "",
    scannedAt: "",
    debug: undefined,
  };
}

function chromeLocalStorageAdapter() {
  return {
    getItem: async (name: string): Promise<string | null> => {
      const result = await chrome.storage.local.get(name);
      const value = result[name];
      if (value == null) return null;
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    setItem: async (name: string, value: string): Promise<void> => {
      await chrome.storage.local.set({ [name]: JSON.parse(value) });
    },
    removeItem: async (name: string): Promise<void> => {
      await chrome.storage.local.remove(name);
    }
  };
}

export const useScanStore = create<ScanStoreState & ScanStoreActions>()(
  persist(
    (set, get) => ({
      tabs: {},

      getScanState(tabId?: number | null): StoredScanState {
        if (tabId == null) {
          return emptyState(null);
        }
        const state = get();
        return state.tabs[tabId] ?? emptyState(tabId);
      },

      setScanState(tabId: number, patch: Partial<StoredScanState>) {
        set((state) => {
          const current = state.tabs[tabId] ?? emptyState(tabId);
          return {
            tabs: {
              ...state.tabs,
              [tabId]: {
                ...current,
                ...patch,
                tabId,
              },
            },
          };
        });
      },

      clearScanState(tabId: number) {
        set((state) => {
          const nextTabs = { ...state.tabs };
          delete nextTabs[tabId];
          return { tabs: nextTabs };
        });
      },
    }),
    {
      name: "infillScanState",
      storage: createJSONStorage(() => chromeLocalStorageAdapter()),
    }
  )
);

