import "./handlers";
import { handlePossibleAuthCallback } from "./auth";
import { updateConflictBadge } from "./handlers";
import { LOCAL_PROFILE_STATE_KEY } from "./profile-store";
import { removeOverlays, ensureScanStoreHydrated, clearScanState } from "./scan";

type RuntimeMessage = {
  type?: string;
  tabId?: unknown;
  url?: unknown;
};

chrome.runtime.onInstalled.addListener(() => {
  void scanOpenTabsForAuthCallbacks();
});
async function scanOpenTabsForAuthCallbacks(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }).catch(() => []);
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined || !tab.url) return;
    await handlePossibleAuthCallback(tab.id, tab.url).catch(() => undefined);
  }));
}
void scanOpenTabsForAuthCallbacks();
chrome.runtime.onStartup?.addListener(() => {
  void scanOpenTabsForAuthCallbacks();
});


async function pollAuthCallbackTab(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab?.url) return;

    await handlePossibleAuthCallback(tabId, tab.url);
    const stored = await chrome.storage.session.get(["infillAuthState", "infillAuthCodeVerifier"]);
    if (!stored.infillAuthState && !stored.infillAuthCodeVerifier) {
      await chrome.storage.session.remove("infillAuthTabId").catch(() => undefined);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message?.type === "infill-auth-watch") {
    if (typeof message.tabId === "number") {
      void pollAuthCallbackTab(message.tabId);
      sendResponse({ ok: true });
      return false;
    }
    sendResponse({ ok: false, error: "Missing auth tab ID." });
    return false;
  }

  if (message?.type !== "infill-auth-callback") return undefined;

  if (typeof message.url !== "string") {
    sendResponse({ ok: false, error: "Missing auth callback URL." });
    return false;
  }

  handlePossibleAuthCallback(sender.tab?.id ?? chrome.tabs.TAB_ID_NONE, message.url)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      const message = error instanceof Error ? error.message : "Auth callback failed.";
      sendResponse({ ok: false, error: message });
    });

  return true;
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  handlePossibleAuthCallback(details.tabId, details.url).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    handlePossibleAuthCallback(tabId, changeInfo.url).catch(() => undefined);
  }

  // Clear scan state when the scanned tab navigates or reloads
  if (changeInfo.status === "loading") {
    ensureScanStoreHydrated().then(async () => {
      await removeOverlays(tabId).catch(() => undefined);
      await clearScanState(tabId).catch(() => undefined);
    }).catch(() => undefined);
  }
});

// Keep badge in sync when another context resolves conflicts
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !(LOCAL_PROFILE_STATE_KEY in changes)) return;
  updateConflictBadge();
});
