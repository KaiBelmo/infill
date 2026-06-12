import { errorToDebug, safeSerialize } from "@infill/snaplog";
import type { SnaplogAttemptRecord } from "@infill/snaplog";
import { backgroundSnaplog } from "./snaplog";

const PRIVATE_SYNC_DEBUG_KEY = "infillPrivateSyncDebug";
const MAX_EVENTS = 80;

type PrivateSyncDebugRecord = SnaplogAttemptRecord;

let activeAttemptId: string | undefined;
let memoryDebugRecord: PrivateSyncDebugRecord | undefined;

export async function beginPrivateSyncDebug(details?: unknown): Promise<string> {
  const attemptId = await backgroundSnaplog.beginDebugAttempt(details);
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
        details: safeSerialize(details)
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
      details: safeSerialize(details)
    }
  ].slice(-MAX_EVENTS);
  await writePrivateSyncDebug(record);
  await backgroundSnaplog.recordDebugEvent(stage, details, attemptId);
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
  await backgroundSnaplog.finishDebugAttempt(status, error, attemptId);
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
