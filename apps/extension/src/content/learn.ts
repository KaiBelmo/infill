import type { ExtractedField, ExtractedForm, ProfileCategory } from "@infill/shared";
import { findProfileKey, categoryForProfileKey, labelForProfileKey } from "@infill/form-brain";
import { sendMessage } from "webext-bridge/content-script";
import { locateField } from "./locator";
import { type SupportedControl, getControlValue } from "./scanner/dom-utils";
type LearnedFact = {
  key: string;
  label: string;
  value: string;
  category: ProfileCategory;
  sensitivity: "public" | "normal";
};

const blockedPatterns = [
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\bcredit\s*card\b/i,
  /\bcard\s*number\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /\bbank\s*account\b/i,
  /\brouting\s*number\b/i,
  /\bssn\b/i,
  /\bsocial\s*security\b/i,
  /\bnational\s*id\b/i,
  /\bpassport\b/i,
  /\bapi\s*key\b/i,
  /\bprivate\s*key\b/i,
  /\brecovery\s*phrase\b/i,
  /\bseed\s*phrase\b/i,
  /\bdate\s*of\s*birth\b/i,
  /\bdob\b/i,
  /\bgender\b/i,
  /\bpronouns\b/i,
  /\bsalary\b/i,
  /\bemergency\s*contact\b/i
];

let learningController: AbortController | undefined;
const sentValues = new Set<string>();

export function installProfileLearning(forms: ExtractedForm[]): void {
  learningController?.abort();
  learningController = new AbortController();

  const fields = forms.flatMap((form) => form.fields);
  console.log("[learn] installing profile learning", {
    forms: forms.length,
    fields: fields.length,
    fieldIds: fields.map((field) => field.fieldId)
  });

  for (const field of fields) {
    const result = locateField(field);
    const element = result.element;
    if (!element || !isLearnableElement(element)) {
      console.log("[learn] skipped listener", {
        fieldId: field.fieldId,
        label: debugFieldLabel(field),
        reason: element ? "Element is not learnable" : result.reason
      });
      continue;
    }

    const handler = () => learnFromElement(field, element);
    element.addEventListener("change", handler, { signal: learningController.signal });
    element.addEventListener("blur", handler, { signal: learningController.signal });
    console.log("[learn] listener attached", {
      fieldId: field.fieldId,
      label: debugFieldLabel(field),
      tagName: element.tagName,
      inputType: element instanceof HTMLInputElement ? element.type : undefined
    });
  }
}

function learnFromElement(field: ExtractedField, element: SupportedControl): void {
  const value = getControlValue(element);
  const fact = inferLearnedFact(field, value);
  if (!fact) {
    console.log("[learn] ignored value", {
      fieldId: field.fieldId,
      label: debugFieldLabel(field),
      valuePreview: previewValue(value),
      reason: getLearnIgnoreReason(field, value)
    });
    return;
  }

  const sentKey = `${fact.key}:${fact.value}`;
  if (sentValues.has(sentKey)) {
    console.log("[learn] duplicate suppressed", {
      fieldId: field.fieldId,
      key: fact.key,
      valuePreview: previewValue(fact.value)
    });
    return;
  }

  sentValues.add(sentKey);
  console.log("[learn] sending learned fact", {
    fieldId: field.fieldId,
    key: fact.key,
    label: fact.label,
    valuePreview: previewValue(fact.value)
  });
  sendMessage("learn-fact", { fact }, "background")
    .then((result: { saved: boolean; status: string; conflict?: { id: string } }) => {
      console.log("[learn] background result", {
        fieldId: field.fieldId,
        key: fact.key,
        status: result?.status,
        saved: result?.saved,
        conflictId: result?.conflict?.id
      });
      if (!result?.saved && result?.status !== "conflict") {
        sentValues.delete(sentKey);
      }
      if (result?.status === "conflict") {
        sendMessage("learn-conflict-detected", null, "background").catch(() => undefined);
      }
    })
    .catch((error) => {
      sentValues.delete(sentKey);
      console.log("[learn] background save failed", {
        fieldId: field.fieldId,
        key: fact.key,
        error: error instanceof Error ? error.message : String(error)
      });
    });
}

function inferLearnedFact(field: ExtractedField, value: string): LearnedFact | undefined {
  const normalizedValue = value.trim();
  if (!normalizedValue || isBlockedField(field)) {
    return undefined;
  }

  const key = findProfileKey(field);
  if (!key) {
    return undefined;
  }

  return {
    key,
    label: labelForProfileKey(key, field),
    value: normalizedValue,
    category: categoryForProfileKey(key),
    sensitivity: "normal"
  };
}

function isBlockedField(field: ExtractedField): boolean {
  if (field.inputType === "password") {
    return true;
  }

  const text = [
    field.inputType,
    field.name,
    field.id,
    field.autocomplete,
    field.labelText,
    field.ariaLabel,
    field.ariaDescription,
    field.placeholder,
    field.title,
    field.nearbyText,
    field.sectionHeading,
    field.groupLabel
  ]
    .filter(Boolean)
    .join(" ");

  return blockedPatterns.some((pattern) => pattern.test(text));
}

function isLearnableElement(element: Element): element is SupportedControl {
  if (element instanceof HTMLInputElement) {
    return !["password", "checkbox", "radio", "file", "hidden", "submit", "button", "reset"].includes(element.type);
  }

  return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || (element instanceof HTMLElement && element.isContentEditable);
}

function getLearnIgnoreReason(field: ExtractedField, value: string): string {
  if (!value.trim()) {
    return "empty value";
  }

  if (isBlockedField(field)) {
    return "blocked field";
  }

  if (!findProfileKey(field)) {
    return "no profile key inferred";
  }

  return "unknown";
}

function debugFieldLabel(field: ExtractedField): string {
  return [
    field.labelText,
    field.ariaLabel,
    field.placeholder,
    field.name,
    field.id,
    field.fieldId
  ].find((value) => value && value.trim().length > 0) ?? field.fieldId;
}

function previewValue(value: string): string {
  return value.trim().slice(0, 80);
}
