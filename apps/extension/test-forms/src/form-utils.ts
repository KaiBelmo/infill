import type { Draft, FieldDefinition, FormValues } from "./types";

export function isVisible(field: FieldDefinition, values: FormValues): boolean {
  if (!field.showWhen) return true;
  return String(values[field.showWhen.field] ?? "") === field.showWhen.value;
}

export function validateFields(fields: FieldDefinition[], values: FormValues): Record<string, string> {
  return fields.reduce<Record<string, string>>((errors, field) => {
    if (!isVisible(field, values) || !field.required) return errors;
    const value = values[field.id];
    if (value === undefined || value === "" || value === false) errors[field.id] = `${field.label} is required.`;
    return errors;
  }, {});
}

export function storageKey(slug: string): string {
  return `fixture-foundry:${slug}:draft`;
}

export function readDraft(slug: string, storage: Pick<Storage, "getItem">): Draft | null {
  const raw = storage.getItem(storageKey(slug));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Draft;
  } catch {
    return null;
  }
}
