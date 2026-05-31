const PRIVATE_SYNC_DEBUG_KEY = "infillPrivateSyncDebug";
const MAX_EVENTS = 80;

type PrivateSyncDebugEvent = {
  at: string;
  stage: string;
  details?: unknown;
};

type PrivateSyncDebugRecord = {
  attemptId: string;
  startedAt: string;
  updatedAt: string;
  status: "running" | "success" | "error";
  events: PrivateSyncDebugEvent[];
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
};

let activeAttemptId: string | undefined;
let memoryDebugRecord: PrivateSyncDebugRecord | undefined;

export async function beginPrivateSyncDebug(details?: unknown): Promise<string> {
  const attemptId = crypto.randomUUID();
  activeAttemptId = attemptId;
  const now = new Date().toISOString();
  const record: PrivateSyncDebugRecord = {
    attemptId,
    startedAt: now,
    updatedAt: now,
    status: "running",
    events: [
      {
        at: now,
        stage: "attempt-start",
        details: sanitizeDebugValue(details)
      }
    ]
  };
  await writePrivateSyncDebug(record);
  return attemptId;
}

export function getActivePrivateSyncAttemptId(): string | undefined {
  return activeAttemptId;
}

export async function recordPrivateSyncDebug(stage: string, details?: unknown, attemptId = activeAttemptId): Promise<void> {
  if (!attemptId) return;
  const record = await readPrivateSyncDebug();
  if (!record || record.attemptId !== attemptId) return;
  const now = new Date().toISOString();
  record.updatedAt = now;
  record.events = [
    ...record.events,
    {
      at: now,
      stage,
      details: sanitizeDebugValue(details)
    }
  ].slice(-MAX_EVENTS);
  await writePrivateSyncDebug(record);
}

export async function finishPrivateSyncDebug(status: "success" | "error", error?: unknown, attemptId = activeAttemptId): Promise<void> {
  if (!attemptId) return;
  const record = await readPrivateSyncDebug();
  if (!record || record.attemptId !== attemptId) return;
  record.status = status;
  record.updatedAt = new Date().toISOString();
  if (error) {
    record.error = errorToDebug(error);
  }
  await writePrivateSyncDebug(record);
  if (activeAttemptId === attemptId) {
    activeAttemptId = undefined;
  }
}

export async function getPrivateSyncDebug(): Promise<PrivateSyncDebugRecord | undefined> {
  return readPrivateSyncDebug();
}

export async function clearPrivateSyncDebug(): Promise<void> {
  memoryDebugRecord = undefined;
  if (!hasChromeStorage()) return;
  await chrome.storage.local.remove(PRIVATE_SYNC_DEBUG_KEY);
}

function errorToDebug(error: unknown): PrivateSyncDebugRecord["error"] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return { message: String(error) };
}

async function readPrivateSyncDebug(): Promise<PrivateSyncDebugRecord | undefined> {
  if (!hasChromeStorage()) return memoryDebugRecord;
  const result = await chrome.storage.local.get(PRIVATE_SYNC_DEBUG_KEY);
  const value = result[PRIVATE_SYNC_DEBUG_KEY];
  if (!value || typeof value !== "object") return undefined;
  return value as PrivateSyncDebugRecord;
}

async function writePrivateSyncDebug(record: PrivateSyncDebugRecord): Promise<void> {
  if (!hasChromeStorage()) {
    memoryDebugRecord = record;
    return;
  }
  await chrome.storage.local.set({ [PRIVATE_SYNC_DEBUG_KEY]: record });
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function sanitizeDebugValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[max-depth]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeDebugValue(item, depth + 1));
  if (typeof value !== "object") return String(value);

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = sanitizeDebugValue(entry, depth + 1);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  return /token|authorization|passphrase|password|secret|ciphertext|iv|salt|value|encryptedData/i.test(key);
}

function redactString(value: string): string {
  if (value.length > 500) return `${value.slice(0, 500)}...`;
  return value;
}
