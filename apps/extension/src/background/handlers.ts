import { onMessage } from "webext-bridge/background";
import { messageFromUnknownError } from "./cloud-api";
import {
  checkApiHealth,
  checkLocalOllama,
  createBillingCheckout,
  getCloudState,
  listDevices,
  logoutCloudSession,
  refreshCloudSession,
  runCloudAssist,
  runCloudParseProfile,
  saveCloudConfig,
  syncCloudSession,
  deleteCloudProfile
} from "./cloud";
import { startAuthFlow } from "./auth";
import { applyProfileSyncDecision, enableEncryptedProfileSync, prepareProfileSyncAfterAuth, resolveProfileSyncConflict, syncEncryptedProfilesIfUnlocked, unlockEncryptedProfileSync } from "./profile-sync";
import { LOCAL_PROFILE_STATE_KEY, persistProfileStoreNow, useProfileStore } from "./profile-store";
import { scanTab, getScanState } from "./scan";
import { useScanStore } from "./scan-store";
import { useSyncEncryptionStore } from "./sync-encryption-store";
import { clearPrivateSyncDebug, getPrivateSyncDebug } from "./private-sync-debug";
import { clearSnaplogEntries, readSnaplogEntries, recordSnaplogEntry } from "./snaplog";
import type { SnaplogEntry } from "@infill/snaplog";

onMessage("learn-fact", async ({ data: { fact } }) => {
  console.log("[learn-fact] request", {
    key: fact.key,
    label: fact.label,
    valuePreview: String(fact.value ?? "").slice(0, 30),
    category: fact.category,
    sensitivity: fact.sensitivity
  });
  const result = useProfileStore.getState().saveLearnedFact(fact);
  let persisted = false;
  let persistError: string | undefined;
  try {
    await persistProfileStoreNow();
    persisted = true;
  } catch (error) {
    persistError = error instanceof Error ? error.message : String(error);
    console.log("[learn-fact] persist failed", {
      key: fact.key,
      persistError
    });
  }

  const profileState = useProfileStore.getState();
  const activeProfile = profileState.profiles.find((profile) => profile.id === profileState.activeProfileId);
  console.log("[learn-fact] result", {
    status: result.status,
    persisted,
    persistError,
    activeProfileId: profileState.activeProfileId,
    activeProfileName: activeProfile?.name,
    activeFactCount: activeProfile?.facts.length,
    factKeys: activeProfile?.facts.map((item) => item.key)
  });
  updateConflictBadge();
  const saved = (result.status === "saved" || result.status === "unchanged") && persisted;
  return {
    saved,
    status: result.status,
    persisted,
    persistError,
    conflict: result.conflict,
    undo: result.undo
  };
});

onMessage("learn-conflict-detected", () => {
  updateConflictBadge();
  return null;
});

onMessage("undo-learned-fact", async ({ data: { undo } }) => {
  useProfileStore.getState().undoLearnedFact(undo);
  await persistProfileStoreNow();
  updateConflictBadge();
  return { undone: true };
});

onMessage("clear-recent-learned-notice", () => {
  useProfileStore.getState().clearRecentLearnedNotice();
  return null;
});

onMessage("get-cloud-state", () => {
  return getCloudState();
});

onMessage("save-cloud-config", ({ data: { config } }) => {
  return saveCloudConfig(config);
});

onMessage("refresh-cloud-session", async () => {
  return await refreshCloudSession();
});

onMessage("sync-cloud-session", async () => {
  const state = await syncCloudSession();
  await prepareProfileSyncAfterAuth().catch((error) => {
    console.log("[profile-sync] preview after session sync failed", error);
    return undefined;
  });
  return state;
});

onMessage("logout-cloud-session", async () => {
  await logoutCloudSession();
  return null;
});

onMessage("delete-cloud-profile", async ({ data }) => {
  const { profileId } = data as { profileId: string };
  await deleteCloudProfile(profileId);
  return null;
});

onMessage("sync-encrypted-profiles-if-unlocked", async () => {
  return await syncEncryptedProfilesIfUnlocked();
});

onMessage("enable-encrypted-sync", async ({ data }) => {
  const { passphrase } = data as { passphrase: string };
  await enableEncryptedProfileSync(passphrase);
  return null;
});

onMessage("unlock-encrypted-sync", async ({ data }) => {
  const { passphrase } = data as { passphrase: string };
  return await unlockEncryptedProfileSync(passphrase);
});

onMessage("lock-encrypted-sync", () => {
  useSyncEncryptionStore.getState().lockSync();
  return null;
});

onMessage("get-sync-encryption-state", () => {
  return useSyncEncryptionStore.getState().getEncryptionState();
});

onMessage("prepare-profile-sync", async () => {
  return await prepareProfileSyncAfterAuth();
});

onMessage("apply-profile-sync-decision", async ({ data }) => {
  const { action } = data as { action: "keep_local" | "import_cloud" | "merge" };
  return await applyProfileSyncDecision(action);
});

onMessage("resolve-profile-sync-conflict", async ({ data }) => {
  const { conflictId, action } = data as { conflictId: string; action: "keep_local" | "use_cloud" | "keep_both" };
  return await resolveProfileSyncConflict(conflictId, action);
});

onMessage("run-cloud-assist", async ({ data: { request } }) => {
  return await runCloudAssist(request);
});

onMessage("run-cloud-parse-profile", async ({ data: { request } }) => {
  return await runCloudParseProfile(request);
});

onMessage("check-api-health", async () => {
  return await checkApiHealth();
});

onMessage("check-local-ollama", async ({ data }) => {
  return await checkLocalOllama(data);
});

onMessage("create-billing-checkout", async () => {
  try {
    const result = await createBillingCheckout();
    return {
      ok: true,
      ...result
    };
  } catch (error) {
    return {
      ok: false,
      message: messageFromUnknownError(error, "Unable to create a billing checkout.")
    };
  }
});

onMessage("list-devices", async () => {
  return await listDevices();
});

onMessage("scan-tab", async ({ data }) => {
  const { tabId, tabUrl } = data as { tabId: number; tabUrl: string };
  await scanTab(tabId, tabUrl);
  return useScanStore.getState().getScanState();
});

onMessage("get-scan-state", async () => {
  return await getScanState();
});

onMessage("debug-profile-facts", () => {
  const state = useProfileStore.getState();
  const activeProfile = state.profiles.find((profile) => profile.id === state.activeProfileId);
  const facts = activeProfile?.facts ?? [];
  const contactFacts = facts.filter((fact) =>
    fact.key.startsWith("contact.") ||
    fact.key.includes("email") ||
    fact.key.includes("phone") ||
    fact.key.includes("linkedin") ||
    fact.key.includes("facebook") ||
    fact.key.includes("twitter") ||
    fact.key.includes("website")
  );
  console.table(contactFacts.map((fact) => ({
    id: fact.id,
    key: fact.key,
    label: fact.label,
    value: typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value),
    category: fact.category,
    sensitivity: fact.sensitivity,
    source: fact.source
  })));
  return {
    activeProfileId: state.activeProfileId,
    activeProfileName: activeProfile?.name,
    factCount: facts.length,
    contactFacts
  };
});

onMessage("debug-profile-storage", async () => {
  const raw = await chrome.storage.local.get(LOCAL_PROFILE_STATE_KEY);
  const persisted = raw[LOCAL_PROFILE_STATE_KEY];
  const state = useProfileStore.getState();
  const activeProfile = state.profiles.find((profile) => profile.id === state.activeProfileId);
  const persistedState = persisted && typeof persisted === "object" && "state" in persisted
    ? (persisted as { state?: unknown }).state
    : persisted;
  const persistedProfiles = persistedState && typeof persistedState === "object" && "profiles" in persistedState
    ? (persistedState as { profiles?: unknown }).profiles
    : undefined;
  const persistedActiveProfileId = persistedState && typeof persistedState === "object" && "activeProfileId" in persistedState
    ? (persistedState as { activeProfileId?: unknown }).activeProfileId
    : undefined;

  console.log("[debug-profile-storage]", {
    activeProfileId: state.activeProfileId,
    activeProfileName: activeProfile?.name,
    inMemoryFactCount: activeProfile?.facts.length ?? 0,
    persistedActiveProfileId,
    persistedProfileCount: Array.isArray(persistedProfiles) ? persistedProfiles.length : undefined,
    rawKeys: Object.keys(raw)
  });

  return {
    activeProfileId: state.activeProfileId,
    activeProfileName: activeProfile?.name,
    inMemoryFactCount: activeProfile?.facts.length ?? 0,
    persistedActiveProfileId,
    persistedProfileCount: Array.isArray(persistedProfiles) ? persistedProfiles.length : undefined,
    raw
  };
});

onMessage("debug-private-sync", async () => {
  const debug = await getPrivateSyncDebug();
  console.log("[debug-private-sync]", debug);
  return debug;
});

onMessage("clear-private-sync-debug", async () => {
  await clearPrivateSyncDebug();
  return null;
});

onMessage("snaplog-record", async ({ data }) => {
  await recordSnaplogEntry(data as SnaplogEntry);
  return null;
});

onMessage("snaplog-read", async () => {
  return await readSnaplogEntries();
});

onMessage("snaplog-clear", async () => {
  await clearSnaplogEntries();
  return null;
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) return false;
  const typed = message as { type?: string; entry?: SnaplogEntry };
  if (typed.type !== "snaplog-record" || !typed.entry) return false;
  recordSnaplogEntry(typed.entry)
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

onMessage("auth-start", async () => {
  await startAuthFlow();
  return null;
});

export function updateConflictBadge(): void {
  const count = useProfileStore.getState().pendingConflicts.length;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}
