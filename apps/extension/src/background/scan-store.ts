import { create } from "zustand";
import type { StoredScanState } from "@/shared/types";

type ScanStoreActions = {
  getScanState: () => StoredScanState;
  setScanState: (patch: Partial<StoredScanState>) => void;
  clearScanState: () => void;
};

function emptyState(): StoredScanState {
  return {
    tabId: null,
    url: "",
    status: "Ready",
    forms: [],
    mappings: [],
    error: "",
    scannedAt: "",
  };
}

export const useScanStore = create<StoredScanState & ScanStoreActions>()((set, get) => ({
  ...emptyState(),

  getScanState(): StoredScanState {
    const { tabId, url, status, forms, mappings, error, scannedAt, debug } = get();
    return { tabId, url, status, forms, mappings, error, scannedAt, debug };
  },

  setScanState(patch: Partial<StoredScanState>) {
    set(patch);
  },

  clearScanState() {
    set(emptyState());
  },
}));
