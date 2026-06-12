import type { ProfileCategory, ProfileFact, Sensitivity } from "@infill/shared";
import { findProfileKeyFromLabel, categoryForProfileKey } from "@infill/form-brain";

export type ConfidenceLevel = "high" | "medium" | "low" | "missing";

export type MemoryFactDraft = {
  key: string;
  label: string;
  value: ProfileFact["value"];
  category: ProfileCategory;
  sensitivity: Sensitivity;
  confidence: ConfidenceLevel;
};

export function parseMemoryFacts(text: string): MemoryFactDraft[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseMemoryLine)
    .filter((fact): fact is MemoryFactDraft => Boolean(fact));
}

function parseMemoryLine(line: string): MemoryFactDraft | undefined {
  const match = line.match(/^[-*]?\s*([^:=]+)\s*[:=]\s*(.+)$/);
  if (!match) {
    return undefined;
  }

  const label = match[1]?.trim();
  const rawValue = match[2]?.trim() ?? "";
  const value = normalizeMemoryFactValue(rawValue, label);
  if (!label || value === undefined) {
    return undefined;
  }

  const key = keyForLabel(label);
  if (typeof value === "string" && !isValidFactValue(key, value)) {
    return undefined;
  }

  return {
    key,
    label,
    value,
    category: categoryForProfileKey(key),
    sensitivity: sensitivityForLabel(label),
    confidence: confidenceForMemoryValue(rawValue, value, label)
  };
}

export function confidenceForMemoryValue(
  value: string,
  normalizedValue?: ProfileFact["value"],
  label?: string
): ConfidenceLevel {
  const explicit = value.match(/\[\s*confidence\s*:\s*(high|medium|low|missing)\s*\]/i)?.[1];
  if (explicit) return explicit.toLowerCase() as ConfidenceLevel;

  const tags = Array.from(
    value.matchAll(/\[\s*([^\]\r\n]{1,80})\s*\]/g),
    (match) => match[1]?.trim().toLowerCase() ?? ""
  );
  if (normalizedValue === null || tags.includes("unknown")) return "missing";
  if (tags.includes("speculation") || tags.includes("prediction")) return "low";
  if (tags.includes("inference") || tags.includes("assumption")) return "medium";
  return "high";
}

function normalizeMemoryFactValue(value: string, label?: string): ProfileFact["value"] | undefined {
  const tags = Array.from(
    value.matchAll(/\[\s*([^\]\r\n]{1,80})\s*\]/g),
    (match) => match[1]?.trim().toLowerCase() ?? ""
  );
  if (/^unknown\b/i.test(label?.trim() ?? "") && tags.includes("unknown")) return null;

  const cleaned = stripFactTag(value);
  if (!cleaned) return undefined;
  return isUnknownPlaceholderValue(cleaned) ? null : cleaned;
}

function stripFactTag(value: string): string {
  return value.replace(/(?:\s*\[[^\]\r\n]{1,80}\]\s*)+$/g, "").trim();
}

function isUnknownPlaceholderValue(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[.\s_-]+$/g, "");
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length <= 8 && /\b(unknown|none|null|n\/a|na|not applicable|not provided|not specified|unspecified|missing|no answer|i don't know|i do not know|dont know|don't know)\b/i.test(normalized);
}

function keyForLabel(label: string): string {
  return findProfileKeyFromLabel(label) ?? `custom.${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

function sensitivityForLabel(label: string): Sensitivity {
  const normalized = label.toLowerCase();
  if (/\bpassword|card|bank|ssn|passport|secret|token|key\b/.test(normalized)) return "secret";
  if (/\bdob|birth|salary|medical|legal|citizenship\b/.test(normalized)) return "restricted";
  return "normal";
}

function isValidFactValue(key: string, value: string): boolean {
  if (key === "contact.email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  if (key === "contact.phone") {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
  }

  return true;
}
