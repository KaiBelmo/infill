import type { ExtractedField, ExtractedForm, FieldMapping } from "@infill/shared";

export function getFieldLabel(field: ExtractedField | undefined): string {
  return [
    field?.labelText,
    field?.ariaLabel,
    field?.placeholder,
    field?.name,
    field?.id
  ].find((value) => value && value.trim().length > 0) ?? "Unnamed field";
}

export function getFieldMeta(field: ExtractedField | undefined, form: ExtractedForm | undefined): string {
  if (!field) {
    return "Field metadata unavailable";
  }

  const parts = [
    field.tagName === "input" && field.inputType ? field.inputType : field.tagName,
    field.required ? "required" : "optional",
    form?.formTitle || form?.pageTitle
  ];

  return parts.filter(Boolean).join(" · ");
}

export function canToggleMappingValue(mapping: FieldMapping): boolean {
  return mapping.value !== undefined && mapping.risk !== "restricted" && mapping.risk !== "secret";
}

export function getMappingStateLabel(mapping: FieldMapping): string {
  if (mapping.risk === "secret" || mapping.risk === "restricted") {
    return "Blocked";
  }

  if (mapping.value === undefined) {
    return "No match";
  }

  return mapping.preselected ? "Selected" : "Skipped";
}

export function formatValueSource(source: FieldMapping["valueSource"]): string {
  return source.replace(/_/g, " ");
}
