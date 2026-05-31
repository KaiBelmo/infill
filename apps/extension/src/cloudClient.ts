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

export async function createBillingCheckout(): Promise<{ checkoutUrl: string; billingMode: string }> {
  return _send("create-billing-checkout", null, "background");
}

export async function listDevices(): Promise<DeviceInfo[]> {
  const result = await _send("list-devices", null, "background");
  return result.devices;
}

export async function startOAuthFlow(): Promise<void> {
  await _send("auth-start", null, "background");
}

export async function scanTab(tabId: number, tabUrl: string): Promise<StoredScanState> {
  return _send("scan-tab", { tabId, tabUrl }, "background");
}

export async function getScanState(): Promise<StoredScanState> {
  return _send("get-scan-state", null, "background");
}

export async function getPrivateSyncDebug(): Promise<unknown> {
  return _send("debug-private-sync", null, "background");
}

export async function clearPrivateSyncDebug(): Promise<void> {
  await _send("clear-private-sync-debug", null, "background");
}
