import type {
  CloudAssistRequest,
  CloudAssistResponse,
  ProfileSyncAction,
  ProfileSyncConflictAction,
  ProfileSyncPreview,
  ParseProfileRequest,
  ParseProfileResponse
} from "@infill/shared";
import type { CloudState, DeviceInfo, LearnedFactConflict, LearnedFactUndo, StoredScanState } from "@/shared/types";
import type { OllamaHealthResult } from "@/background/cloud";

type BridgeSendMessage = typeof import("webext-bridge/popup").sendMessage;

let _send: BridgeSendMessage;

export function initBridge(fn: BridgeSendMessage): void {
  _send = fn;
}

export type { LearnedFactConflict, LearnedFactUndo, DeviceInfo };

const LOCAL_CLOUD_STATE_KEY = "infillCloudState";
const AUTH_STATE_KEY = "infillAuthState";
const AUTH_CODE_VERIFIER_KEY = "infillAuthCodeVerifier";

async function readCloudConfigFromStorage(): Promise<{ webBaseUrl: string; apiBaseUrl: string }> {
  const local = await chrome.storage.local.get(LOCAL_CLOUD_STATE_KEY);
  const persisted = local[LOCAL_CLOUD_STATE_KEY];
  const persistedState = persisted && typeof persisted === "object" && "state" in persisted
    ? (persisted as { state?: Partial<CloudState> }).state
    : undefined;

  return {
    webBaseUrl: trimBaseUrl(persistedState?.config?.webBaseUrl || __VITE_WEB_BASE_URL__),
    apiBaseUrl: trimBaseUrl(persistedState?.config?.apiBaseUrl || __VITE_API_BASE_URL__)
  };
}

function trimBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function generateCodeVerifier(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return base64UrlEncode(randomBytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function getCloudState(): Promise<CloudState> {
  return _send("get-cloud-state", null, "background");
}

export async function saveCloudConfig(config: Partial<CloudState["config"]>): Promise<CloudState> {
  return _send("save-cloud-config", { config }, "background");
}

export async function refreshCloudSession(): Promise<CloudState> {
  return _send("refresh-cloud-session", null, "background");
}

export async function syncCloudSession(): Promise<CloudState> {
  return _send("sync-cloud-session", null, "background");
}

export async function prepareProfileSync(): Promise<ProfileSyncPreview | undefined> {
  return _send("prepare-profile-sync", null, "background");
}

export async function deleteCloudProfile(profileId: string): Promise<void> {
  await _send("delete-cloud-profile", { profileId }, "background");
}

export async function syncEncryptedProfilesIfUnlocked(): Promise<boolean> {
  return _send("sync-encrypted-profiles-if-unlocked", null, "background");
}

export async function applyProfileSyncDecision(action: ProfileSyncAction): Promise<ProfileSyncPreview | undefined> {
  return _send("apply-profile-sync-decision", { action }, "background");
}

export async function resolveProfileSyncConflict(conflictId: string, action: ProfileSyncConflictAction): Promise<ProfileSyncPreview | undefined> {
  return _send("resolve-profile-sync-conflict", { conflictId, action }, "background");
}

export async function getSyncEncryptionState(): Promise<import("@/shared/types").SyncEncryptionState> {
  return _send("get-sync-encryption-state", null, "background");
}

export async function enableEncryptedSync(passphrase: string): Promise<void> {
  await _send("enable-encrypted-sync", { passphrase }, "background");
}

export async function unlockEncryptedSync(passphrase: string): Promise<ProfileSyncPreview | undefined> {
  return _send("unlock-encrypted-sync", { passphrase }, "background");
}

export async function lockEncryptedSync(): Promise<void> {
  await _send("lock-encrypted-sync", null, "background");
}

export async function logoutCloudSession(): Promise<void> {
  await _send("logout-cloud-session", null, "background");
}

export async function runCloudAssist(request: CloudAssistRequest): Promise<CloudAssistResponse> {
  return _send("run-cloud-assist", { request }, "background");
}

export async function runCloudParseProfile(request: ParseProfileRequest): Promise<ParseProfileResponse> {
  return _send("run-cloud-parse-profile", { request }, "background");
}

export async function checkApiHealth(): Promise<{ ok: boolean; name?: string; version?: string }> {
  return _send("check-api-health", null, "background");
}

export async function checkLocalOllama(input: { baseUrl: string; model?: string }): Promise<OllamaHealthResult> {
  return _send("check-local-ollama", input, "background");
}

export type BillingCheckoutResult =
  | { ok: true; checkoutUrl: string; billingMode: string }
  | { ok: false; message: string };

export async function createBillingCheckout(): Promise<BillingCheckoutResult> {
  return _send("create-billing-checkout", null, "background");
}

export async function listDevices(): Promise<DeviceInfo[]> {
  const result = await _send("list-devices", null, "background");
  return result.devices;
}

export async function startOAuthFlow(): Promise<void> {
  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  await chrome.storage.session.set({
    [AUTH_STATE_KEY]: state,
    [AUTH_CODE_VERIFIER_KEY]: codeVerifier
  });

  const { webBaseUrl } = await readCloudConfigFromStorage();
  if (!webBaseUrl) {
    throw new Error("Set the cloud web base URL in settings before signing in.");
  }

  const extensionCallbackUrl = `${webBaseUrl}${__VITE_EXTENSION_REDIRECT_PATH__}`;
  const authUrl = new URL("/account", webBaseUrl);
  authUrl.searchParams.set("returnTo", extensionCallbackUrl);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("client", "browser-extension");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const tab = await chrome.tabs.create({ url: authUrl.toString(), active: true });
  if (tab.id !== undefined) {
    await chrome.storage.session.set({ infillAuthTabId: tab.id });
    chrome.runtime.sendMessage({ type: "infill-auth-watch", tabId: tab.id }).catch(() => undefined);
  }
}

export async function scanTab(tabId: number, tabUrl: string): Promise<StoredScanState> {
  return _send("scan-tab", { tabId, tabUrl }, "background");
}

export async function getScanState(tabId?: number): Promise<StoredScanState> {
  return _send("get-scan-state", { tabId }, "background");
}

export async function getPrivateSyncDebug(): Promise<unknown> {
  return _send("debug-private-sync", null, "background");
}

export async function clearPrivateSyncDebug(): Promise<void> {
  await _send("clear-private-sync-debug", null, "background");
}
