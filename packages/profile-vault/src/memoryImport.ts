import type { ProfileCategory, Sensitivity } from "@infill/shared";
import { findProfileKeyFromLabel, categoryForProfileKey } from "@infill/form-brain";

export type MemoryFactDraft = {
  key: string;
  label: string;
  value: string;
  category: ProfileCategory;
  sensitivity: Sensitivity;
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
  const value = stripFactTag(match[2]?.trim() ?? "");
  if (!label || !value) {
    return undefined;
  }

  const key = keyForLabel(label);
  if (!isValidFactValue(key, value)) {
    return undefined;
  }

  return {
    key,
    label,
    value,
    category: categoryForProfileKey(key),
    sensitivity: sensitivityForLabel(label)
  };
}

function stripFactTag(value: string): string {
  return value.replace(/(?:\s*\[[^\]\r\n]{1,80}\]\s*)+$/g, "").trim();
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
