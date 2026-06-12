import "./handlers";
import { handlePossibleAuthCallback } from "./auth";
import { updateConflictBadge } from "./handlers";
import { removeOverlays } from "./scan";
import { useScanStore } from "./scan-store";

chrome.runtime.onInstalled.addListener(() => undefined);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    handlePossibleAuthCallback(tabId, changeInfo.url).catch(() => undefined);
  }

  // Clear scan state when the scanned tab navigates or reloads
  if (changeInfo.status === "loading") {
    const scan = useScanStore.getState();
    if (scan.tabId === tabId && scan.status !== "Ready") {
      removeOverlays(tabId).catch(() => undefined);
      scan.clearScanState();
    }
  }
});

// Keep badge in sync when another context resolves conflicts
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !("infillExtensionProfileState" in changes)) return;
  updateConflictBadge();
});
