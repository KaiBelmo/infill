import type { CloudAssistRequest, ExtractedField, FieldMapping, ProfileFact } from "@infill/shared";
import { findProfileKey, isCacheableProfileKey, isLongFormField } from "./matcher";

export type AssistAnswer = {
  fieldId: string;
  value: FieldMapping["value"];
  reason?: string;
};

export type AssistPromptMessage = {
  role: "system" | "user";
  content: string;
};

export type PreparedAssistInput = {
  safeFacts: ProfileFact[];
  allFields: ExtractedField[];
  cachedMappings: Map<string, FieldMapping>;
  llmFields: ExtractedField[];
  promptMessages: AssistPromptMessage[];
};

export function prepareAssistInput(request: CloudAssistRequest): PreparedAssistInput {
  const safeFacts = request.facts.filter((fact) => fact.sensitivity === "public" || fact.sensitivity === "normal");
  const localByFieldId = new Map(request.localMappings.map((mapping) => [mapping.fieldId, mapping]));
  const allFields = request.forms.flatMap((form) => form.fields);
  const factsByKey = new Map(safeFacts.map((fact) => [fact.key, fact]));
  const cachedMappings = resolveCachedFields(allFields, localByFieldId, factsByKey);
  const llmFields = allFields.filter((field) => isEligibleForAssistGeneration(field, localByFieldId.get(field.fieldId)));

  return {
    safeFacts,
    allFields,
    cachedMappings,
    llmFields,
    promptMessages: buildAssistPromptMessages(request, safeFacts, llmFields)
  };
}

export function buildAssistPromptMessages(
  request: Pick<CloudAssistRequest, "locale">,
  safeFacts: ProfileFact[],
  llmFields: ExtractedField[]
): AssistPromptMessage[] {
  return [
    {
      role: "system",
      content: [
        "You produce JSON only.",
        "Return one JSON object with an `answers` array.",
        "Each answer must have `fieldId` and either `value` or be omitted entirely if you cannot answer safely.",
        "Generate answers for unresolved web form fields using the field metadata, valid options, and locale.",
        "You are not given raw profile values. Use only field context and the available profile topics.",
        "For long-form text fields, write concise first-person draft text.",
        "For select, radio, or checkbox-style fields, choose only from the provided exact option values.",
        "If a field needs personal specifics you do not know, use neutral placeholders in square brackets instead of inventing details.",
        "Respect locale for formatting dates, phones, addresses, and regional wording whenever field context requires it.",
        "Never suggest passwords, payment details, government IDs, API keys, or secret values.",
        "Never fill structured profile fields (name, email, phone, address) - those are handled locally.",
        "Example: {\"answers\":[{\"fieldId\":\"field_cover_letter\",\"value\":\"I am excited to apply because [relevant experience].\"},{\"fieldId\":\"field_work_auth\",\"value\":\"yes\"}]}",
        "Do not wrap the JSON in markdown fences."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        locale: request.locale,
        outputSchema: {
          answers: [
            {
              fieldId: "string",
              value: "string | boolean | string[]"
            }
          ]
        },
        profileContext: safeFacts.map(toPromptFactSummary),
        fields: llmFields.map(serializeFieldForPrompt)
      })
    }
  ];
}

export function mergeAssistAnswersWithLocal(input: {
  localMappings: FieldMapping[];
  cachedMappings: Map<string, FieldMapping>;
  allFields: ExtractedField[];
  answersByFieldId: Map<string, AssistAnswer>;
}): FieldMapping[] {
  return input.localMappings.map((mapping) => {
    const cached = input.cachedMappings.get(mapping.fieldId);
    if (cached) {
      return cached;
    }

    if (mapping.risk === "secret" || mapping.risk === "restricted") {
      return mapping;
    }

    const field = input.allFields.find((candidate) => candidate.fieldId === mapping.fieldId);
    if (!field) {
      return mapping;
    }

    const answer = input.answersByFieldId.get(mapping.fieldId);
    if (!answer) {
      return mapping;
    }

    return {
      ...mapping,
      value: answer.value,
      valueSource: "generated_answer",
      confidence: Math.max(mapping.confidence, 0.65),
      preselected: mapping.risk === "safe" || mapping.risk === "personal" || mapping.risk === "unknown",
      requiresExplicitApproval: mapping.risk !== "safe" && mapping.risk !== "personal" && mapping.risk !== "unknown",
      reason: answer.reason ?? "Model generated an answer from field context without raw profile values.",
      warnings: [...mapping.warnings, "Model generated an answer without raw profile values."],
      usedFactIds: mapping.usedFactIds
    };
  });
}

export function parseAssistAnswers(text: string): Map<string, AssistAnswer> {
  const jsonText = extractJson(text);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return new Map();
  }

  if (Array.isArray(parsed)) {
    parsed = { answers: parsed };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return new Map();
  }

  const rawAnswers = Array.isArray((parsed as { answers?: unknown }).answers)
    ? (parsed as { answers: unknown[] }).answers
    : [];
  const result = new Map<string, AssistAnswer>();

  for (const candidate of rawAnswers) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }

    const fieldId = typeof (candidate as { fieldId?: unknown }).fieldId === "string"
      ? (candidate as { fieldId: string }).fieldId.trim()
      : "";
    if (!fieldId) {
      continue;
    }

    const value = normalizeAssistAnswerValue((candidate as { value?: unknown }).value);
    if (value === undefined) {
      continue;
    }

    const reason = typeof (candidate as { reason?: unknown }).reason === "string"
      ? (candidate as { reason: string }).reason.trim()
      : undefined;
    result.set(fieldId, { fieldId, value, reason });
  }

  return result;
}

export function extractJson(text: string): string {
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return trimmed;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  const firstArray = text.indexOf("[");
  const lastArray = text.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    return text.slice(firstArray, lastArray + 1);
  }

  return trimmed;
}

export function serializeFieldForPrompt(field: ExtractedField) {
  const label = field.labelText || field.ariaLabel || field.placeholder || field.name || field.fieldId;

  return {
    fieldId: field.fieldId,
    label,
    tagName: field.tagName,
    inputType: field.inputType,
    role: field.role,
    required: field.required,
    maxLength: field.maxLength,
    nearbyText: field.nearbyText,
    sectionHeading: field.sectionHeading,
    placeholder: field.placeholder,
    options: field.options.map((option) => ({
      label: option.label,
      value: option.value
    }))
  };
}

export function toPromptFactSummary(fact: ProfileFact) {
  return {
    key: fact.key,
    label: fact.label,
    category: fact.category,
    hasValue: hasPromptValue(fact.value),
    valueKind: describePromptValue(fact.value)
  };
}

export function normalizeAssistAnswerValue(value: unknown): FieldMapping["value"] | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (Array.isArray(value)) {
    const normalized = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

export function normalizeFactValue(value: ProfileFact["value"]): string | number | boolean | string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

export function resolveCachedFields(
  fields: ExtractedField[],
  localByFieldId: Map<string, FieldMapping>,
  factsByKey: Map<string, ProfileFact>
): Map<string, FieldMapping> {
  const result = new Map<string, FieldMapping>();

  for (const field of fields) {
    const local = localByFieldId.get(field.fieldId);
    if (!local || local.valueSource !== "none") {
      continue;
    }

    const key = findProfileKey(field);
    if (!key || !isCacheableProfileKey(key)) {
      continue;
    }

    const fact = factsByKey.get(key);
    if (!fact) {
      continue;
    }

    result.set(field.fieldId, {
      ...local,
      profileKey: fact.key,
      value: normalizeFactValue(fact.value),
      valueSource: "profile_fact",
      confidence: field.autocomplete ? 0.95 : 0.72,
      reason: field.autocomplete ? "Matched from autocomplete metadata (cached)." : "Matched from field label (cached).",
      warnings: fact.verified ? [] : ["The matching profile fact is not marked verified."],
      usedFactIds: [fact.id]
    });
  }

  return result;
}

export function mergeCachedWithLocal(
  localMappings: FieldMapping[],
  cachedMappings: Map<string, FieldMapping>
): FieldMapping[] {
  return localMappings.map((mapping) => cachedMappings.get(mapping.fieldId) ?? mapping);
}

function isEligibleForAssistGeneration(field: ExtractedField, local: FieldMapping | undefined): boolean {
  if (!local || local.valueSource !== "none" || local.risk === "secret" || local.risk === "restricted") {
    return false;
  }

  return isLongFormField(field) || !findProfileKey(field);
}

function hasPromptValue(value: ProfileFact["value"]): boolean {
  if (value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

function describePromptValue(value: ProfileFact["value"]): "text" | "number" | "boolean" | "list" | "object" {
  if (Array.isArray(value)) {
    return "list";
  }

  if (typeof value === "object") {
    return "object";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  return "text";
}
