import { create } from "zustand";
import type { ExtractedForm, FieldMapping } from "@infill/shared";
import type { ScanDebugState, ScanStatus, StoredScanState } from "@/shared/types";
import { useProfileStore } from "@/background/profile-store";
import {
  scanTab as bgScanTab,
  getScanState as bgGetScanState
} from "@/cloudClient";
import { useCloudClientStore } from "@/shared/stores/cloud-client-store";


type PopupState = {
  forms: ExtractedForm[];
  mappings: FieldMapping[];
  error: string;
  status: ScanStatus;
  scannedAt: string;
  debug?: ScanDebugState;
};

type PopupActions = {
  changeActiveProfile: (profileId: string) => void;
  syncScanState: () => Promise<void>;
  scanActiveTab: () => Promise<void>;
  openSettings: () => void;
  startOAuth: () => Promise<void>;
  openBilling: () => void;
};

export const usePopupStore = create<PopupState & PopupActions>()((set, get) => ({
  forms: [],
  mappings: [],
  error: "",
  status: "Ready",
  scannedAt: "",
  debug: undefined,

  changeActiveProfile(profileId) {
    useProfileStore.getState().setActiveProfile(profileId);
    set({ error: "", forms: [], mappings: [], status: "Ready", scannedAt: "", debug: undefined });
  },

  async syncScanState() {
    try {
      const scanState = await bgGetScanState();
      // If scan state belongs to a different tab, reset to Ready
      const tab = await getActiveTab();
      const tabMatches = tab?.id != null && (scanState.tabId === tab.id || scanState.tabId === null);
      if (tabMatches) {
        set({
          forms: scanState.forms ?? [],
          mappings: scanState.mappings ?? [],
          error: scanState.error ?? "",
          status: scanState.status ?? "Ready",
          scannedAt: scanState.scannedAt ?? "",
          debug: scanState.debug,
        });
      } else {
        set({ forms: [], mappings: [], error: "", status: "Ready", scannedAt: "", debug: undefined });
      }
    } catch {
      // Background may not be ready yet
    }
  },

  async scanActiveTab() {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url) {
      set({ status: "Blocked", error: "This page cannot be scanned." });
      return;
    }

    set({ forms: [], mappings: [], error: "", status: "Scanning", scannedAt: "", debug: undefined });

    // Delegate to background â€” scan continues even if popup closes
    try {
      const result = await bgScanTab(tab.id, tab.url);
      set({
        forms: result.forms ?? [],
        mappings: result.mappings ?? [],
        error: result.error ?? "",
        status: result.status ?? "Ready",
        scannedAt: result.scannedAt ?? "",
        debug: result.debug,
      });
    } catch (err) {
      set({
        forms: [],
        mappings: [],
        status: "Error",
        scannedAt: "",
        debug: undefined,
        error: err instanceof Error ? err.message : "Scan failed.",
      });
    }
  },

  openSettings() {
    chrome.runtime.openOptionsPage();
  },

  async startOAuth() {
    try {
      await useCloudClientStore.getState().startOAuth();
    } catch {
      set({ error: "Could not open sign-in page. Check cloud web URL in settings." });
    }
  },

  openBilling() {
    if (!useCloudClientStore.getState().openBilling()) {
      chrome.runtime.openOptionsPage();
    }
  },
}));


async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Cross-context sync: background writes scan state to chrome.storage.local;
// popup subscribes so it auto-updates when scan completes or status changes.
const SCAN_STATE_KEY = "infillScanState";
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !(SCAN_STATE_KEY in changes)) return;
    const raw = changes[SCAN_STATE_KEY]?.newValue;
    if (raw == null) return;
    // Zustand persist wraps stored data as { state: {...}, version: N }
    const incoming = (typeof raw === "object" && "state" in raw
      ? (raw as { state: StoredScanState }).state
      : raw) as StoredScanState;

    // If scan state was cleared (tab navigated), reset popup
    if (incoming.status === "Ready" && (incoming.forms?.length ?? 0) === 0) {
      usePopupStore.setState({ forms: [], mappings: [], error: "", status: "Ready", scannedAt: "", debug: undefined });
      return;
    }

    const curStatus = usePopupStore.getState().status;
    const curError = usePopupStore.getState().error;
    const curFormsLen = usePopupStore.getState().forms.length;
    const curMappingsLen = usePopupStore.getState().mappings.length;
    const curDebugAt = usePopupStore.getState().debug?.generatedAt;
    // Only sync if something actually changed to avoid render loops
    if (
      curStatus !== incoming.status ||
      curError !== incoming.error ||
      curFormsLen !== (incoming.forms?.length ?? 0) ||
      curMappingsLen !== (incoming.mappings?.length ?? 0) ||
      curDebugAt !== incoming.debug?.generatedAt
    ) {
      usePopupStore.setState({
        forms: incoming.forms ?? [],
        mappings: incoming.mappings ?? [],
        error: incoming.error ?? "",
        status: incoming.status ?? "Ready",
        scannedAt: incoming.scannedAt ?? "",
        debug: incoming.debug,
      });
    }
  });
}
