import type { AccountInfo, ExtractedForm, FieldMapping, ProfileCategory, ProfileFact, ProfileSyncAction, ProfileSyncConflict, ProfileSyncPreview, SessionInfo, Sensitivity, UserAccount } from "@infill/shared";
import type { FillProfile } from "@infill/shared";

// --- Cloud types (previously in background/cloud-store.ts, re-exported via background/cloud.ts) ---

export type CloudConfig = {
  apiBaseUrl: string;
  webBaseUrl: string;
  cloudAssistEnabled: boolean;
  localOllamaEnabled: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaModelOptions: string[];
  localOllamaFallbackToCloud: boolean;
};

export type CloudAuthState = {
  user: UserAccount;
  session: SessionInfo;
  account: AccountInfo;
  sessionToken: string;
  refreshToken: string;
  updatedAt: string;
};

export type CloudState = {
  config: CloudConfig;
  auth?: CloudAuthState;
};

// --- Extension types (previously in cloudClient.ts) ---

export type LocalProfileSummary = FillProfile & {
  factCount: number;
  createdAt: string;
  updatedAt: string;
};

export type FactDraft = {
  id?: string;
  key: string;
  label: string;
  value: string;
  category: ProfileCategory;
  sensitivity: Sensitivity;
  source?: ProfileFact["source"];
  verified?: boolean;
  confidence?: number;
};

export type LearnedFactConflict = {
  id: string;
  profileId: string;
  profileName: string;
  existingFact: ProfileFact;
  proposedFact: FactDraft;
  createdAt: string;
};

export type LearnedFactUndo =
  | { type: "saved_fact"; profileId: string; factId: string }
  | { type: "replaced_fact"; profileId: string; previousFact: ProfileFact }
  | { type: "conflict"; profileId: string; conflictId: string };

export type SyncEncryptionState = {
  enabled: boolean;
  salt?: string;
  kdfIterations?: number;
  encryptionVersion?: number;
  unlocked: boolean;
  hasRemoteProfiles?: boolean;
  remoteProfileCount?: number;
};

export type ExtensionState = {
  activeProfileId: string;
  profiles: LocalProfileSummary[];
  facts: ProfileFact[];
  pendingConflicts: LearnedFactConflict[];
  pendingProfileSync?: ProfileSyncPreview;
  recentLearnedCount: number;
  recentLearnedUndos: LearnedFactUndo[];
  syncEncryption?: SyncEncryptionState;
};

export type ProfileSyncDecision = ProfileSyncAction;
export type ProfileSyncConflictResolution = ProfileSyncConflict["resolution"];

export type DeviceInfo = {
  id: string;
  name: string;
  browser?: string;
  platform?: string;
  extensionVersion?: string;
  linkedAt: string;
  lastSeenAt: string;
  revokedAt?: string;
};

// --- Scan state types (ephemeral; lives only in the background service worker) ---

export type ScanStatus =
  | "Ready"
  | "Scanning"
  | "Review fill"
  | "Local AI assist ready"
  | "Local fallback ready"
  | "Cloud assist ready"
  | "Filling"
  | "Filled"
  | "Blocked"
  | "Error";

export type StoredScanState = {
  tabId: number | null;
  url: string;
  status: ScanStatus;
  forms: ExtractedForm[];
  mappings: FieldMapping[];
  error: string;
  scannedAt: string;
  debug?: ScanDebugState;
};

export type ScanDebugFact = {
  id: string;
  key: string;
  label: string;
  category: ProfileCategory;
  sensitivity: Sensitivity;
  source: ProfileFact["source"];
  verified: boolean;
  confidence: number;
  valueKind: "string" | "number" | "boolean" | "list" | "object";
  valuePreview: string;
  sourceRefCount: number;
  hasNotes: boolean;
};

export type ScanDebugFormField = {
  fieldId: string;
  formId: string;
  frameId?: string;
  tagName: string;
  inputType?: string;
  role?: string;
  name?: string;
  id?: string;
  className?: string;
  dataAttributes?: Record<string, string>;
  autocomplete?: string;
  labelText?: string;
  ariaLabel?: string;
  ariaDescription?: string;
  placeholder?: string;
  title?: string;
  nearbyText?: string;
  sectionHeading?: string;
  groupLabel?: string;
  required: boolean;
  disabled: boolean;
  readonly: boolean;
  visible: boolean;
  hasUserValue: boolean;
  currentValuePreview: string;
  maxLength?: number;
  pattern?: string;
  min?: string;
  max?: string;
  step?: string;
  domPathHint: string;
  cssPath?: string;
  optionCount: number;
  options: Array<{ label: string; value: string; selected?: boolean }>;
};

export type ScanDebugForm = {
  formId: string;
  urlOrigin: string;
  urlPathHash: string;
  pageTitle?: string;
  formTitle?: string;
  detectedDomain?: string;
  fieldCount: number;
  scanWarnings: string[];
  createdAt: string;
  fields: ScanDebugFormField[];
};

export type ScanDebugField = {
  fieldId: string;
  label: string;
  fieldMeta: string;
  profileKey?: string;
  valuePreview: string;
  valueSource: FieldMapping["valueSource"];
  risk: FieldMapping["risk"];
  preselected: boolean;
  ready: boolean;
  reason: string;
  warnings: string[];
  usedFactIds: string[];
  fillStatus?: "filled" | "skipped" | "pending";
  fillReason?: string;
  matchScore?: number;
  matchConfidence?: number;
  matchEvidence?: Array<{ source: string; keyword: string; score: number }>;
  matchRejectedReason?: string;
};

export type ScanDebugState = {
  factCount: number;
  formCount: number;
  fieldCount: number;
  mappingCount: number;
  readyCount: number;
  blockedCount: number;
  filledCount: number;
  skippedFillCount: number;
  cloudAssistUsed: boolean;
  cloudAssistStatus: string;
  generatedAt: string;
  facts: ScanDebugFact[];
  forms: ScanDebugForm[];
  fields: ScanDebugField[];
};
