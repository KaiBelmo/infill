import type { ProfileCategory, ProfileFact, Sensitivity } from "@infill/shared";
import { ProfileFactSchema } from "@infill/shared";

export type ProfileFactInput = {
  key: string;
  label: string;
  value: ProfileFact["value"];
  category: ProfileCategory;
  sensitivity: Sensitivity;
  source?: ProfileFact["source"];
  verified?: boolean;
  confidence?: number;
  expiresAt?: string;
  sourceRefs?: string[];
  notes?: string;
};

export function createProfileFact(input: ProfileFactInput, now = new Date()): ProfileFact {
  const timestamp = now.toISOString();

  return ProfileFactSchema.parse({
    id: crypto.randomUUID(),
    key: normalizeProfileKey(input.key),
    label: input.label.trim(),
    value: normalizeProfileFactValue(input.value),
    category: input.category,
    sensitivity: input.sensitivity,
    source: input.source ?? "manual",
    verified: input.verified ?? true,
    confidence: input.confidence ?? 1,
    expiresAt: input.expiresAt,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceRefs: input.sourceRefs ?? [],
    notes: input.notes?.trim() || undefined
  });
}

export function updateProfileFact(existing: ProfileFact, input: ProfileFactInput, now = new Date()): ProfileFact {
  return ProfileFactSchema.parse({
    ...existing,
    key: normalizeProfileKey(input.key),
    label: input.label.trim(),
    value: normalizeProfileFactValue(input.value),
    category: input.category,
    sensitivity: input.sensitivity,
    source: input.source ?? existing.source,
    verified: input.verified ?? existing.verified,
    confidence: input.confidence ?? existing.confidence,
    expiresAt: input.expiresAt ?? existing.expiresAt,
    sourceRefs: input.sourceRefs ?? existing.sourceRefs,
    notes: input.notes?.trim() || existing.notes,
    updatedAt: now.toISOString()
  });
}

export function replaceProfileFact(existing: ProfileFact, incoming: ProfileFact, now = new Date()): ProfileFact {
  return ProfileFactSchema.parse({
    ...incoming,
    id: existing.id,
    key: normalizeProfileKey(incoming.key),
    createdAt: existing.createdAt,
    updatedAt: now.toISOString(),
    sourceRefs: incoming.sourceRefs ?? existing.sourceRefs
  });
}

export function mergeProfileFact(existing: ProfileFact, incoming: ProfileFact, now = new Date()): ProfileFact {
  return ProfileFactSchema.parse({
    ...existing,
    key: normalizeProfileKey(incoming.key || existing.key),
    label: incoming.label.trim() || existing.label,
    value: normalizeProfileFactValue(incoming.value),
    category: incoming.category ?? existing.category,
    sensitivity: incoming.sensitivity ?? existing.sensitivity,
    source: incoming.source ?? existing.source,
    verified: incoming.verified ?? existing.verified,
    confidence: incoming.confidence ?? existing.confidence,
    expiresAt: incoming.expiresAt ?? existing.expiresAt,
    sourceRefs: incoming.sourceRefs.length > 0 ? incoming.sourceRefs : existing.sourceRefs,
    notes: incoming.notes?.trim() || existing.notes,
    updatedAt: now.toISOString()
  });
}

export function normalizeProfileKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeProfileFactValue(value: ProfileFact["value"]): ProfileFact["value"] {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => item.trim());
  }

  return value;
}
