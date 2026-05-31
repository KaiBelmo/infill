import type { ProtocolWithReturn } from "webext-bridge";
import type {
  CloudAssistRequest,
  CloudAssistResponse,
  FieldMapping,
  ParseProfileRequest,
  ParseProfileResponse,
  ProfileCategory,
  ProfileSyncAction,
  ProfileSyncConflictAction,
  ProfileSyncPreview,
  Sensitivity
} from "@infill/shared";
import type { SyncEncryptionState } from "@/shared/types";
import type { CloudState } from "./background/cloud";
import type { DeviceInfo, LearnedFactConflict, LearnedFactUndo } from "./cloudClient";

type LearnedFactPayload = {
  key: string;
  label: string;
  value: string;
  category: ProfileCategory;
  sensitivity: Sensitivity;
};

type CloudConfigInput = {
  apiBaseUrl?: string;
  webBaseUrl?: string;
  cloudAssistEnabled?: boolean;
  localOllamaEnabled?: boolean;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  localOllamaFallbackToCloud?: boolean;
};

type ApiHealthResult = { ok: boolean; name?: string; version?: string };
type OllamaHealthResult = { baseUrl: string; modelCount: number; ok: boolean; selectedModel?: string; version?: string };
type BillingCheckoutResult = { checkoutUrl: string; billingMode: string };
type ListDevicesResult = { devices: DeviceInfo[] };

type ScanResponse = { forms: import("@infill/shared").ExtractedForm[] };
type FillResponse = { filledFieldIds: string[]; skippedFieldIds: string[] };

type LearnFactResult = {
  saved: boolean;
  status: string;
  persisted?: boolean;
  persistError?: string;
  conflict?: LearnedFactConflict;
  undo?: LearnedFactUndo;
};

declare module "webext-bridge" {
  export interface ProtocolMap {
    "learn-fact": ProtocolWithReturn<{ fact: LearnedFactPayload }, LearnFactResult>;
    "learn-conflict-detected": ProtocolWithReturn<null, null>;
    "undo-learned-fact": ProtocolWithReturn<{ undo: NonNullable<LearnFactResult["undo"]> }, { undone: boolean }>;
    "clear-recent-learned-notice": ProtocolWithReturn<null, null>;

    "get-cloud-state": ProtocolWithReturn<null, CloudState>;
    "save-cloud-config": ProtocolWithReturn<{ config: CloudConfigInput }, CloudState>;
    "refresh-cloud-session": ProtocolWithReturn<null, CloudState>;
    "sync-cloud-session": ProtocolWithReturn<null, CloudState>;
    "logout-cloud-session": ProtocolWithReturn<null, null>;
    "delete-cloud-profile": ProtocolWithReturn<{ profileId: string }, null>;
    "sync-encrypted-profiles-if-unlocked": ProtocolWithReturn<null, boolean>;
    "enable-encrypted-sync": ProtocolWithReturn<{ passphrase: string }, null>;
    "unlock-encrypted-sync": ProtocolWithReturn<{ passphrase: string }, ProfileSyncPreview | undefined>;
    "lock-encrypted-sync": ProtocolWithReturn<null, null>;
    "get-sync-encryption-state": ProtocolWithReturn<null, SyncEncryptionState>;
    "prepare-profile-sync": ProtocolWithReturn<null, ProfileSyncPreview | undefined>;
    "apply-profile-sync-decision": ProtocolWithReturn<{ action: ProfileSyncAction }, ProfileSyncPreview | undefined>;
    "resolve-profile-sync-conflict": ProtocolWithReturn<{ conflictId: string; action: ProfileSyncConflictAction }, ProfileSyncPreview | undefined>;
    "run-cloud-assist": ProtocolWithReturn<{ request: CloudAssistRequest }, CloudAssistResponse>;
    "run-cloud-parse-profile": ProtocolWithReturn<{ request: ParseProfileRequest }, ParseProfileResponse>;
    "check-api-health": ProtocolWithReturn<null, ApiHealthResult>;
    "check-local-ollama": ProtocolWithReturn<{ baseUrl: string; model?: string }, OllamaHealthResult>;
    "create-billing-checkout": ProtocolWithReturn<null, BillingCheckoutResult>;
    "list-devices": ProtocolWithReturn<null, ListDevicesResult>;
    "auth-start": ProtocolWithReturn<null, null>;

    "scan-tab": ProtocolWithReturn<{ tabId: number; tabUrl: string }, import("@/shared/types").StoredScanState>;
    "get-scan-state": ProtocolWithReturn<null, import("@/shared/types").StoredScanState>;
    "debug-profile-facts": ProtocolWithReturn<null, unknown>;
    "debug-profile-storage": ProtocolWithReturn<null, unknown>;
    "debug-private-sync": ProtocolWithReturn<null, unknown>;
    "clear-private-sync-debug": ProtocolWithReturn<null, null>;

    "scan": ProtocolWithReturn<null, ScanResponse>;
    "fill": ProtocolWithReturn<{ mappings: FieldMapping[] }, FillResponse>;
  }
}
