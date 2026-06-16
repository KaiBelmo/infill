import type { ExtractedField, FieldMapping, ProfileCategory, ProfileFact, Sensitivity } from "@infill/shared";
import { classifyFieldRisk, isFillBlocked } from "./risk";

export type LearnedProfileFactInput = {
  key: string;
  label: string;
  value: string;
  category: ProfileCategory;
  sensitivity: Sensitivity;
};

export type FieldMatchEvidence = {
  source: FieldSignalSource;
  keyword: string;
  score: number;
};

export type FieldMatchResult = {
  profileKey?: string;
  score: number;
  confidence: number;
  evidence: FieldMatchEvidence[];
  rejectedReason?: string;
};

type FieldSignalSource =
  | "autocomplete"
  | "inputType"
  | "dataAttributes"
  | "name"
  | "id"
  | "labelText"
  | "ariaLabel"
  | "placeholder"
  | "title"
  | "section"
  | "className";

type PatternConfig = {
  strong: string[];
  weak?: string[];
  negative?: RegExp[];
};

type ResolvedProfileFactValue = {
  fact: ProfileFact;
  profileKey: string;
  value: string | number | boolean | string[];
  derived: boolean;
  confidence?: number;
  reason?: string;
};

export type ProfileFactResolutionContext = {
  preferPast?: boolean;
  formPurpose?: "profile" | "checkout" | "job" | "contact" | "unknown";
  sensitivity?: "low" | "medium" | "high";
};

export type LlmKeyMatchRequest = {
  targetKey: string;
  targetLabel?: string;
  facts: Array<{
    key: string;
    label?: string;
  }>;
  context?: ProfileFactResolutionContext;
};

export type LlmKeyMatchResponse = {
  bestFactKey: string | null;
  confidence: number;
  reason: string;
  relationship:
    | "direct_alias"
    | "semantic_source"
    | "weak_possible_source"
    | "not_applicable"
    | "stale_or_historical";
  risks?: string[];
  /**
   * Only set for synthetic `field:` targets. The LLM-suggested canonical
   * profile key for a field the local scorer could not identify.
   */
  suggestedProfileKey?: string | null;
};

export type LlmBatchKeyMatchRequest = {
  targets: Array<{
    targetKey: string;
    targetLabel?: string;
    context?: ProfileFactResolutionContext;
  }>;
  facts: Array<{
    key: string;
    label?: string;
  }>;
};

export type LlmBatchKeyMatchItem = LlmKeyMatchResponse & {
  targetKey: string;
  /**
   * Only present when targetKey is a synthetic `field:{id}` key (locally-unresolved field).
   * The LLM suggests which canonical profile key this field represents (e.g. "address.city").
   */
  suggestedProfileKey?: string | null;
};

export type LlmBatchKeyMatchResponse = {
  matches: LlmBatchKeyMatchItem[];
};

const allowedLlmRelationships = new Set<LlmBatchKeyMatchItem["relationship"]>([
  "direct_alias",
  "semantic_source",
  "weak_possible_source",
  "not_applicable",
  "stale_or_historical"
]);

export function parseLlmBatchKeyMatchResponse(text: string, providerLabel = "LLM"): LlmBatchKeyMatchResponse {
  const cleaned = extractLlmJson(text);
  const repaired = tryRepairJson(cleaned);
  let parsed: unknown;
  try {
    parsed = JSON.parse(repaired);
  } catch {
    throw new Error(`${providerLabel} key matcher returned invalid JSON.`);
  }

  if (!isRecordValue(parsed) || !Array.isArray(parsed.matches)) {
    throw new Error(`${providerLabel} key matcher response must contain a matches array.`);
  }

  return { matches: parsed.matches.map((item) => parseLlmMatchItem(item, providerLabel)) };
}

function parseLlmMatchItem(item: unknown, providerLabel: string): LlmBatchKeyMatchItem {
  if (!isRecordValue(item)) throw new Error(`${providerLabel} key matcher match item must be an object.`);
  if (typeof item.targetKey !== "string" || !item.targetKey.trim()) {
    throw new Error(`${providerLabel} key matcher match item is missing targetKey.`);
  }
  if (item.bestFactKey !== null && typeof item.bestFactKey !== "string") {
    throw new Error(`${providerLabel} key matcher bestFactKey must be a string or null.`);
  }
  if (typeof item.confidence !== "number" || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
    throw new Error(`${providerLabel} key matcher confidence must be between 0 and 1.`);
  }
  const relationship = item.bestFactKey === null && (item.relationship === null || item.relationship === undefined)
    ? "not_applicable"
    : item.relationship;
  if (typeof relationship !== "string" || !allowedLlmRelationships.has(relationship as LlmBatchKeyMatchItem["relationship"])) {
    throw new Error(`${providerLabel} key matcher relationship is invalid.`);
  }
  const suggestedProfileKey = typeof item.suggestedProfileKey === "string"
    ? item.suggestedProfileKey
    : item.suggestedProfileKey === null
      ? null
      : undefined;
  return {
    targetKey: item.targetKey,
    ...(suggestedProfileKey !== undefined ? { suggestedProfileKey } : {}),
    bestFactKey: item.bestFactKey,
    confidence: item.confidence,
    relationship: relationship as LlmBatchKeyMatchItem["relationship"],
    reason: typeof item.reason === "string" ? item.reason : "",
    risks: Array.isArray(item.risks) ? item.risks.filter((risk): risk is string => typeof risk === "string") : undefined
  };
}

function extractLlmJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type ProfileFactResolverOptions = {
  enableLlmKeyMatcherFallback?: boolean;
  llmKeyMatcher?: (request: LlmKeyMatchRequest) => LlmKeyMatchResponse | undefined;
  llmBatchKeyMatcher?: (request: LlmBatchKeyMatchRequest) => LlmBatchKeyMatchResponse | undefined;
  promptVersion?: string;
  schemaVersion?: string;
  modelVersion?: string;
};

const MIN_ACCEPTED_SCORE = 70;
const MIN_SCORE_GAP = 15;
const DEFAULT_LLM_ACCEPT_THRESHOLD = 0.7;
const HIGH_SENSITIVITY_LLM_ACCEPT_THRESHOLD = 0.85;
const DEFAULT_LLM_PROMPT_VERSION = "profile-key-match-v2";
const DEFAULT_LLM_SCHEMA_VERSION = "1";
const DEFAULT_LLM_MODEL_VERSION = "unconfigured";
const WEAK_SIGNAL_SOURCES = new Set<FieldSignalSource>(["section", "className"]);
const llmKeyMatchCache = new Map<string, LlmKeyMatchResponse>();
const llmBatchKeyMatchCache = new Map<string, LlmBatchKeyMatchResponse>();

export const LLM_BATCH_KEY_MATCH_SYSTEM_PROMPT = [
  "Match unresolved form targets to allowed fact keys.",
  "No fact values. Use only target text and allowed fact keys/labels.",
  "Return JSON only: exactly one JSON object and nothing else.",
  "The first character must be { and the last character must be }.",
  "No markdown, code fences, headings, comments, or prose.",
  "Output exact shape: {\"matches\":[...]}",
  "Return one item for every input target.",
  "Return items in the same order as input targets.",
  "Copy each targetKey into the output exactly as it appears in the input.",
  "Choose at most one bestFactKey per targetKey.",
  "bestFactKey must be allowed fact key or null.",
  "Use null when unclear.",
  "confidence must be a number from 0 to 1.",
  "When bestFactKey is null, relationship must be not_applicable.",
  "Form labels, placeholders, and nearby text may be in any language, not only English.",
  "For non-English labels, translate or interpret the label semantically before deciding the canonical profile key.",
  "For targets whose targetKey starts with 'field:' treat targetKey as an opaque identifier, not a semantic hint.",
  "Never infer field meaning from any substring, suffix, number, or token inside a 'field:' targetKey.",
  "For field: targets, set suggestedProfileKey from label/context or null.",
  "For non-field targets, set suggestedProfileKey to null.",
  "relationship: direct_alias, semantic_source, weak_possible_source, stale_or_historical, not_applicable.",
  "Old or past fact for current target => stale_or_historical."
].join(" ");

const signalWeights: Record<FieldSignalSource, number> = {
  autocomplete: 95,
  inputType: 90,
  dataAttributes: 85,
  name: 75,
  id: 70,
  labelText: 70,
  ariaLabel: 70,
  placeholder: 50,
  title: 40,
  section: 30,
  className: 20
};

export const autocompleteToProfileKey: Record<string, string> = {
  name: "identity.full_name",
  "given-name": "identity.first_name",
  "additional-name": "identity.middle_name",
  "family-name": "identity.last_name",
  email: "contact.email",
  tel: "contact.phone",
  "street-address": "address.street",
  "address-line1": "address.street_1",
  "address-line2": "address.street_2",
  "address-level2": "address.city",
  "address-level1": "address.region",
  "postal-code": "address.postal_code",
  country: "address.country",
  organization: "company.name",
  url: "contact.website"
};

const profileKeyPatterns: Record<string, PatternConfig> = {
  "identity.first_name": {
    strong: ["first name", "given name", "firstname", "first_name", "first-name", "fname"],
    weak: ["first"],
    negative: [/\b(user\s*name|username|login\s*name|company\s*name|business\s*name)\b/i]
  },
  "identity.middle_name": {
    strong: ["middle name", "additional name", "middlename", "middle_name"],
    weak: ["middle"]
  },
  "identity.last_name": {
    strong: ["last name", "family name", "surname", "lastname", "last_name", "last-name", "lname"],
    weak: ["last", "family"],
    negative: [/\b(company\s*name|business\s*name)\b/i]
  },
  "identity.full_name": {
    strong: ["full name", "legal name", "display name", "your name", "contact name"],
    weak: ["name"],
    negative: [/\b(user\s*name|username|login\s*name|company\s*name|business\s*name|cardholder\s*name)\b/i]
  },
  "contact.email": {
    strong: ["email", "e-mail", "email address", "mail"],
    negative: [/\b(email\s*(note|deliverability|verification|verified|help|support))\b/i]
  },
  "contact.phone": {
    strong: ["phone", "phone number", "telephone", "tel", "mobile phone", "mobile number", "contact number"],
    weak: ["mobile"],
    negative: [/\b(skills?|experience|frontend|mobile\s*(dev|developer|development)|automobile|verification|required)\b/i]
  },
  "contact.website": {
    strong: ["website", "web site", "homepage", "portfolio", "personal website"],
    weak: ["site", "link", "url"]
  },
  "contact.linkedin": {
    strong: ["linkedin", "linked in", "linkedin profile"]
  },
  "contact.github": {
    strong: ["github", "github profile", "github url"]
  },
  "contact.facebook": {
    strong: ["facebook", "facebook profile", "facebook url"]
  },
  "contact.twitter": {
    strong: ["twitter", "twitter profile", "twitter url", "x twitter", "x profile", "x url"]
  },
  "contact.instagram": {
    strong: ["instagram", "instagram profile", "instagram url", "insta"]
  },
  "contact.threads": {
    strong: ["threads", "threads profile", "threads url"]
  },
  "contact.tiktok": {
    strong: ["tiktok", "tik tok", "tiktok profile", "tik tok profile", "tiktok url", "tik tok url"]
  },
  "contact.youtube": {
    strong: ["youtube", "you tube", "youtube channel", "youtube profile", "youtube url"]
  },
  "contact.snapchat": {
    strong: ["snapchat", "snapchat profile", "snapchat username", "snap"]
  },
  "contact.pinterest": {
    strong: ["pinterest", "pinterest profile", "pinterest url"]
  },
  "contact.reddit": {
    strong: ["reddit", "reddit profile", "reddit username", "reddit url"]
  },
  "contact.discord": {
    strong: ["discord", "discord username", "discord handle", "discord profile"]
  },
  "contact.telegram": {
    strong: ["telegram", "telegram username", "telegram handle", "telegram profile", "telegram url"]
  },
  "contact.whatsapp": {
    strong: ["whatsapp", "whats app", "whatsapp number", "whats app number"]
  },
  "contact.medium": {
    strong: ["medium", "medium profile", "medium url"]
  },
  "contact.stackoverflow": {
    strong: ["stack overflow", "stackoverflow", "stack overflow profile", "stackoverflow profile", "stack overflow url", "stackoverflow url"]
  },
  "contact.dribbble": {
    strong: ["dribbble", "dribbble profile", "dribbble url"]
  },
  "contact.behance": {
    strong: ["behance", "behance profile", "behance url"]
  },
  "contact.bluesky": {
    strong: ["bluesky", "blue sky", "bsky", "bluesky profile", "blue sky profile", "bsky profile"]
  },
  "contact.mastodon": {
    strong: ["mastodon", "mastodon profile", "mastodon url"]
  },
  "contact.twitch": {
    strong: ["twitch", "twitch profile", "twitch channel", "twitch url"]
  },
  "contact.gitlab": {
    strong: ["gitlab", "git lab", "gitlab profile", "git lab profile", "gitlab url"]
  },
  "contact.bitbucket": {
    strong: ["bitbucket", "bit bucket", "bitbucket profile", "bit bucket profile", "bitbucket url"]
  },
  "contact.producthunt": {
    strong: ["product hunt", "producthunt", "product hunt profile", "producthunt profile"]
  },
  "company.name": {
    strong: ["company name", "business name", "organization", "organisation", "employer"],
    weak: ["company"]
  },
  "work.current_title": {
    strong: ["job title", "current title", "position title", "role title", "occupation"],
    weak: ["title", "position", "role"],
    negative: [/\b(page\s*title|title\s*tag|mr|mrs|ms|dr)\b/i]
  },
  "address.street_1": {
    strong: ["address line 1", "address 1", "street 1", "street address", "street"],
    weak: ["address"]
  },
  "address.street_2": {
    strong: ["address line 2", "address 2", "apt", "apartment", "suite", "unit"]
  },
  "address.city": {
    strong: ["city", "town", "locality"]
  },
  "address.region": {
    strong: ["state", "province", "region", "address level 1"]
  },
  "address.postal_code": {
    strong: ["postal code", "postcode", "zip code", "zipcode", "zip"]
  },
  "address.country": {
    strong: ["country", "country name"]
  }
};

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function mapFieldToProfile(
  field: ExtractedField,
  facts: ProfileFact[],
  resolverOptions: ProfileFactResolverOptions = {}
): FieldMapping {
  const risk = classifyFieldRisk(field);
  const blocked = isFillBlocked(risk);

  if (!blocked && shouldGenerateLongFormAnswer(field)) {
    return {
      fieldId: field.fieldId,
      profileKey: undefined,
      valueSource: "generated_answer",
      confidence: 0,
      risk,
      preselected: false,
      requiresExplicitApproval: true,
      reason: "Long-form field - AI will generate a draft based on page context.",
      warnings: [],
      usedFactIds: []
    };
  }

  const match = blocked ? undefined : scoreFieldMatch(field);
  const matchedKey = match?.profileKey;

  // Local scorer could not identify this field — check if the LLM batch
  // discovered a canonical key for it via its synthetic field: target.
  if (!matchedKey && !blocked) {
    const discovered = tryDiscoverFieldWithLlm(field, facts, risk, resolverOptions);
    if (discovered) {
      return discovered;
    }

    return {
      fieldId: field.fieldId,
      profileKey: undefined,
      valueSource: "generated_answer",
      confidence: 0,
      risk,
      preselected: false,
      requiresExplicitApproval: true,
      reason: "Unrecognized field — AI will generate a value based on page context.",
      warnings: [],
      usedFactIds: []
    };
  }

  const factMatch = matchedKey
    ? resolveProfileFactValue(matchedKey, facts, contextForField(field, risk), resolverOptions)
    : undefined;

  if (!factMatch) {
    const invalidMatchingFact = matchedKey
      ? facts.find((candidate) => keysMatch(candidate.key, matchedKey))
      : undefined;
    return {
      fieldId: field.fieldId,
      profileKey: matchedKey,
      valueSource: "none",
      confidence: matchedKey ? 0.45 : 0,
      risk,
      preselected: false,
      requiresExplicitApproval: risk !== "safe",
      reason: blocked
        ? "Blocked by field risk policy."
        : invalidMatchingFact
          ? "Matching profile fact has an invalid value for this field."
          : "No matching profile fact found.",
      warnings: blocked ? ["This field is not eligible for automatic fill."] : [],
      usedFactIds: []
    };
  }

  return {
    fieldId: field.fieldId,
    profileKey: factMatch.profileKey,
    value: factMatch.value,
    valueSource: "profile_fact",
    confidence: field.autocomplete ? 0.95 : factMatch.confidence ?? (factMatch.derived ? 0.68 : match?.confidence ?? 0.72),
    risk,
    preselected: risk === "personal" || risk === "safe" || risk === "unknown",
    requiresExplicitApproval: risk !== "safe" && risk !== "personal" && risk !== "unknown",
    reason: factMatch.reason ?? (factMatch.derived
      ? "Derived from a saved profile fact."
      : match?.evidence.some((item) => item.source === "autocomplete")
        ? "Matched from autocomplete metadata."
        : "Matched from field metadata."),
    warnings: factMatch.fact.verified ? [] : ["The matching profile fact is not marked verified."],
    usedFactIds: [factMatch.fact.id]
  };
}

export function mapFieldsToProfile(
  fields: ExtractedField[],
  facts: ProfileFact[],
  resolverOptions: ProfileFactResolverOptions = {}
): FieldMapping[] {
  const batchOptions = prepareBatchResolverOptions(fields, facts, resolverOptions);
  return fields.map((field) => mapFieldToProfile(field, facts, batchOptions));
}

export function buildLlmBatchKeyMatchRequest(
  fields: ExtractedField[],
  facts: ProfileFact[]
): LlmBatchKeyMatchRequest | undefined {
  const targets = collectBatchMatchTargets(fields, facts);
  if (targets.length === 0) {
    return undefined;
  }

  return {
    targets,
    facts: facts.map(({ key, label }) => ({ key, label }))
  };
}

export function inferProfileFactFromFieldValue(field: ExtractedField, value: string): LearnedProfileFactInput | undefined {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return undefined;
  }

  const risk = classifyFieldRisk(field);
  if (isFillBlocked(risk) || risk === "sensitive") {
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
    sensitivity: risk === "safe" ? "public" : "normal"
  };
}

export function findProfileKey(field: ExtractedField): string | undefined {
  if (shouldGenerateLongFormAnswer(field)) {
    return undefined;
  }

  return scoreFieldMatch(field).profileKey;
}

export function scoreFieldMatch(field: ExtractedField): FieldMatchResult {
  const autocomplete = field.autocomplete?.trim().toLowerCase();

  if (autocomplete && autocompleteToProfileKey[autocomplete]) {
    return {
      profileKey: autocompleteToProfileKey[autocomplete],
      score: signalWeights.autocomplete,
      confidence: 0.95,
      evidence: [{ source: "autocomplete", keyword: autocomplete, score: signalWeights.autocomplete }]
    };
  }

  if (field.inputType === "email") {
    return directInputTypeMatch("contact.email", "email");
  }

  if (field.inputType === "tel") {
    return directInputTypeMatch("contact.phone", "tel");
  }

  if (field.inputType === "url") {
    return directInputTypeMatch("contact.website", "url");
  }

  const signals = collectFieldSignals(field);
  const candidates = Object.entries(profileKeyPatterns)
    .map(([profileKey, config]) => scoreCandidate(profileKey, config, signals))
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  const second = candidates[1];

  if (!best || best.score <= 0) {
    return { score: 0, confidence: 0, evidence: [], rejectedReason: "No pattern evidence found." };
  }

  if (best.score < MIN_ACCEPTED_SCORE) {
    return {
      score: best.score,
      confidence: confidenceFromScore(best.score),
      evidence: best.evidence,
      rejectedReason: `Best score ${best.score} is below threshold ${MIN_ACCEPTED_SCORE}.`
    };
  }

  if (second && second.score > 0 && best.score - second.score < MIN_SCORE_GAP) {
    return {
      score: best.score,
      confidence: confidenceFromScore(best.score),
      evidence: best.evidence,
      rejectedReason: `Best score is too close to ${second.profileKey}.`
    };
  }

  if (!hasDecisiveEvidence(best.evidence)) {
    return {
      score: best.score,
      confidence: confidenceFromScore(best.score),
      evidence: best.evidence,
      rejectedReason: "Only weak evidence sources matched."
    };
  }

  return {
    profileKey: best.profileKey,
    score: best.score,
    confidence: confidenceFromScore(best.score),
    evidence: best.evidence
  };
}

function directInputTypeMatch(profileKey: string, inputType: string): FieldMatchResult {
  return {
    profileKey,
    score: signalWeights.inputType,
    confidence: 0.9,
    evidence: [{ source: "inputType", keyword: inputType, score: signalWeights.inputType }]
  };
}

function collectFieldSignals(field: ExtractedField): Array<{ source: FieldSignalSource; value: string }> {
  const sectionText = [
    field.sectionHeading,
    field.groupLabel,
    field.nearbyText
  ].filter(Boolean).join(" ");

  const dataAttributes = field.dataAttributes
    ? Object.values(field.dataAttributes).filter(Boolean).join(" ")
    : "";

  const signals: Array<{ source: FieldSignalSource; value: string }> = [
    { source: "dataAttributes", value: dataAttributes },
    { source: "name", value: field.name ?? "" },
    { source: "id", value: field.id ?? "" },
    { source: "labelText", value: field.labelText ?? "" },
    { source: "ariaLabel", value: field.ariaLabel ?? "" },
    { source: "placeholder", value: field.placeholder ?? "" },
    { source: "title", value: field.title ?? "" },
    { source: "section", value: sectionText },
    { source: "className", value: field.className ?? "" }
  ];

  return signals.filter((signal) => signal.value.trim().length > 0);
}

function scoreCandidate(
  profileKey: string,
  config: PatternConfig,
  signals: Array<{ source: FieldSignalSource; value: string }>
): { profileKey: string; score: number; evidence: FieldMatchEvidence[] } {
  const allText = signals.map((signal) => signal.value).join(" ");
  const normalizedAllText = normalizeFieldText(allText);
  if (config.negative?.some((pattern) => pattern.test(allText) || pattern.test(normalizedAllText))) {
    return { profileKey, score: 0, evidence: [] };
  }

  const evidence: FieldMatchEvidence[] = [];
  for (const signal of signals) {
    const normalized = normalizeFieldText(signal.value);
    for (const keyword of config.strong) {
      if (matchesKeyword(normalized, keyword)) {
        evidence.push({ source: signal.source, keyword, score: signalWeights[signal.source] });
        break;
      }
    }

    if (evidence.some((item) => item.source === signal.source)) {
      continue;
    }

    for (const keyword of config.weak ?? []) {
      if (matchesKeyword(normalized, keyword)) {
        evidence.push({ source: signal.source, keyword, score: Math.round(signalWeights[signal.source] * 0.45) });
        break;
      }
    }
  }

  const primaryScore = evidence
    .filter((item) => item.source !== "section")
    .reduce((sum, item) => sum + item.score, 0);
  const sectionBoost = primaryScore > 0
    ? evidence.filter((item) => item.source === "section").reduce((sum, item) => sum + item.score, 0)
    : 0;

  return {
    profileKey,
    score: primaryScore + sectionBoost,
    evidence
  };
}

function hasDecisiveEvidence(evidence: FieldMatchEvidence[]): boolean {
  return evidence.some((item) => !WEAK_SIGNAL_SOURCES.has(item.source));
}

function confidenceFromScore(score: number): number {
  if (score >= 120) return 0.9;
  if (score >= 90) return 0.82;
  if (score >= 70) return 0.72;
  return Math.max(0, Math.min(0.65, score / 100));
}

function matchesKeyword(normalizedValue: string, keyword: string): boolean {
  const normalizedKeyword = normalizeFieldText(keyword);
  const valueTokens = tokenize(normalizedValue);
  const keywordTokens = tokenize(normalizedKeyword);

  if (keywordTokens.length === 0) {
    return false;
  }

  if (keywordTokens.length === 1) {
    return valueTokens.includes(keywordTokens[0]!);
  }

  return normalizedValue.split(" ").join(" ").includes(keywordTokens.join(" "));
}

export function isCacheableProfileKey(key: string): boolean {
  const prefix = key.split(".")[0];
  return prefix === "identity" || prefix === "contact" || prefix === "address" || prefix === "work" || prefix === "company";
}

export function isLongFormField(field: ExtractedField): boolean {
  if (field.tagName === "textarea") {
    return true;
  }

  if (field.role === "textbox" && field.inputType !== "email" && field.inputType !== "tel" && field.inputType !== "url") {
    return true;
  }

  const longFormHints = [
    field.labelText,
    field.ariaLabel,
    field.placeholder,
    field.ariaDescription,
    field.nearbyText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(cover\s*letter|explain|describe|tell\s*us|about\s*you|bio|summary|message|comment|reason|why|how|detail|additional|other|note)\b/i.test(longFormHints)) {
    return true;
  }

  return false;
}

function shouldGenerateLongFormAnswer(field: ExtractedField): boolean {
  if (field.autocomplete?.trim()) {
    return false;
  }

  if (field.inputType === "email" || field.inputType === "tel" || field.inputType === "url") {
    return false;
  }

  if (field.tagName === "textarea") {
    return true;
  }

  const promptText = [
    field.labelText,
    field.ariaLabel,
    field.placeholder,
    field.ariaDescription,
    field.nearbyText
  ]
    .filter(Boolean)
    .join(" ");

  return /\b(cover\s*letter|let\s+.*\bknow|interest(?:ed)?\s+(?:in|working|joining)|why\s+(?:do\s+)?you|explain|describe|tell\s*us|about\s*you|bio|summary|message|comment|reason|motivation|additional\s+(?:info|information|details?)|other\s+(?:info|information|details?)|note)\b/i.test(promptText);
}

function contextForField(field: ExtractedField, sensitivity: ReturnType<typeof classifyFieldRisk>): ProfileFactResolutionContext {
  const text = [
    field.labelText,
    field.ariaLabel,
    field.placeholder,
    field.sectionHeading,
    field.groupLabel,
    field.nearbyText
  ].filter(Boolean).join(" ");

  const formPurpose = /\b(job|career|application|employer|role|position)\b/i.test(text)
    ? "job"
    : /\b(checkout|billing|shipping|payment|order)\b/i.test(text)
      ? "checkout"
      : /\b(contact|message|support)\b/i.test(text)
        ? "contact"
        : /\b(profile|account|personal)\b/i.test(text)
          ? "profile"
          : "unknown";

  return {
    formPurpose,
    sensitivity: sensitivity === "sensitive" ? "high" : sensitivity === "personal" ? "medium" : "low"
  };
}

export function findProfileKeyFromLabel(label: string): string | undefined {
  return scoreFieldMatch({
    fieldId: "label",
    formId: "label",
    tagName: "input",
    labelText: label,
    required: false,
    disabled: false,
    readonly: false,
    visible: true,
    options: [],
    hasUserValue: false,
    domPathHint: ""
  }).profileKey;
}

export function categoryForProfileKey(key: string): ProfileCategory {
  const prefix = key.split(".")[0];

  if (
    prefix === "identity" ||
    prefix === "contact" ||
    prefix === "address" ||
    prefix === "work" ||
    prefix === "company"
  ) {
    return prefix;
  }

  return "custom";
}

export function labelForProfileKey(key: string, field: ExtractedField): string {
  const fieldLabel = [
    field.labelText,
    field.ariaLabel,
    field.placeholder,
    field.name,
    field.id
  ]
    .filter(Boolean)
    .find((value) => value && value.trim().length > 0);

  if (fieldLabel) {
    return titleCase(fieldLabel);
  }

  return titleCase(key.split(".").at(-1)?.replace(/[_-]+/g, " ") ?? key);
}

export function titleCase(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeFactValue(value: ProfileFact["value"]): string | number | boolean | string[] | undefined {
  if (value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

function isValidFactForProfileKey(key: string | undefined, value: ProfileFact["value"]): boolean {
  if (value === null) {
    return false;
  }

  if (typeof value === "string" && isUnknownPlaceholderValue(value)) {
    return false;
  }

  if (!key || typeof value !== "string") {
    return true;
  }

  if (key === "contact.email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  if (key === "contact.phone") {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
  }

  return true;
}

export function resolveProfileFactValue(
  key: string,
  facts: ProfileFact[],
  context: ProfileFactResolutionContext = {},
  resolverOptions: ProfileFactResolverOptions = {}
): ResolvedProfileFactValue | undefined {
  const direct = resolveDirectCanonicalFact(key, facts);
  if (direct) {
    return direct;
  }

  const llmFallback = resolveProfileFactValueWithLlm(key, facts, context, resolverOptions);
  if (llmFallback) {
    return llmFallback;
  }

  if (key === "contact.email") {
    const email = facts.find((candidate) => {
      return factText(candidate).includes("email") && isValidFactForProfileKey(key, candidate.value);
    }) ?? facts.find((candidate) => isValidFactForProfileKey(key, candidate.value));
    const value = email ? normalizeFactValue(email.value) : undefined;
    return email && value !== undefined ? { fact: email, profileKey: key, value, derived: true } : undefined;
  }

  if (key === "contact.phone") {
    const phone = facts.find((candidate) => {
      const text = factText(candidate);
      return /\b(phone|mobile|tel)\b/.test(text) && isValidFactForProfileKey(key, candidate.value);
    });
    const value = phone ? normalizeFactValue(phone.value) : undefined;
    return phone && value !== undefined ? { fact: phone, profileKey: key, value, derived: true } : undefined;
  }

  if (key === "identity.first_name" || key === "identity.last_name" || key === "identity.full_name") {
    if (key === "identity.full_name" && context.sensitivity === "high") {
      return undefined;
    }

    const nameFact = findNameFact(facts, key);
    const nameValue = typeof nameFact?.value === "string" ? splitDisplayName(nameFact.value) : undefined;
    if (!nameFact || !nameValue) {
      return undefined;
    }

    const value = key === "identity.first_name"
      ? nameValue.first
      : key === "identity.last_name"
        ? nameValue.last
        : nameValue.full;

    return value ? { fact: nameFact, profileKey: key, value, derived: true } : undefined;
  }

  return undefined;
}

export function resolveDirectCanonicalFact(key: string, facts: ProfileFact[]): ResolvedProfileFactValue | undefined {
  const direct = facts.find((candidate) => keysMatch(candidate.key, key) && isValidFactForProfileKey(key, candidate.value));
  if (!direct) {
    return undefined;
  }

  const value = normalizeFactValue(direct.value);
  return value === undefined ? undefined : { fact: direct, profileKey: direct.key, value, derived: false };
}

/**
 * For fields the local scorer couldn't identify, check if the LLM batch
 * discovered a canonical profile key via the synthetic `field:{fieldId}` target.
 * Returns a FieldMapping if the LLM found both a suggestedProfileKey and a
 * usable fact, or undefined if we should fall through to generated_answer.
 */
function tryDiscoverFieldWithLlm(
  field: ExtractedField,
  facts: ProfileFact[],
  risk: ReturnType<typeof classifyFieldRisk>,
  resolverOptions: ProfileFactResolverOptions
): FieldMapping | undefined {
  if (!resolverOptions.enableLlmKeyMatcherFallback || !resolverOptions.llmKeyMatcher) {
    return undefined;
  }

  const syntheticKey = `field:${field.fieldId}`;
  const context = contextForField(field, risk);
  const llmResult = resolverOptions.llmKeyMatcher({
    targetKey: syntheticKey,
    facts: facts.map(({ key, label }) => ({ key, label })),
    context
  });

  if (!llmResult || !llmResult.bestFactKey || !llmResult.suggestedProfileKey) {
    return undefined;
  }

  if (llmResult.relationship === "not_applicable" || llmResult.relationship === "stale_or_historical") {
    return undefined;
  }

  const threshold = context.sensitivity === "high"
    ? HIGH_SENSITIVITY_LLM_ACCEPT_THRESHOLD
    : DEFAULT_LLM_ACCEPT_THRESHOLD;

  if (llmResult.confidence < threshold) {
    return undefined;
  }

  const canonicalKey = llmResult.suggestedProfileKey;
  const selectedFact = facts.find((f) => f.key === llmResult.bestFactKey);
  if (!selectedFact) {
    return undefined;
  }

  const extractedValue = extractValueForTarget(canonicalKey, selectedFact, context);
  if (extractedValue === undefined) {
    return undefined;
  }

  const candidate: ResolvedProfileFactValue = {
    fact: selectedFact,
    profileKey: canonicalKey,
    value: extractedValue,
    derived: true,
    confidence: llmResult.confidence,
    reason: `LLM discovered field as ${canonicalKey} from label; fact: ${selectedFact.key}`
  };

  if (!judgeResolvedCandidate(candidate, selectedFact, context)) {
    return undefined;
  }

  return {
    fieldId: field.fieldId,
    profileKey: canonicalKey,
    value: extractedValue,
    valueSource: "profile_fact",
    confidence: llmResult.confidence,
    risk,
    preselected: risk === "personal" || risk === "safe" || risk === "unknown",
    requiresExplicitApproval: risk !== "safe" && risk !== "personal" && risk !== "unknown",
    reason: `LLM identified this field as "${canonicalKey}" from its label and matched a profile fact.`,
    warnings: selectedFact.verified ? [] : ["The matching profile fact is not marked verified."],
    usedFactIds: [selectedFact.id]
  };
}



function prepareBatchResolverOptions(
  fields: ExtractedField[],
  facts: ProfileFact[],
  resolverOptions: ProfileFactResolverOptions
): ProfileFactResolverOptions {
  if (!resolverOptions.enableLlmKeyMatcherFallback || !resolverOptions.llmBatchKeyMatcher) {
    return resolverOptions;
  }

  const request = buildLlmBatchKeyMatchRequest(fields, facts);
  if (!request) {
    return resolverOptions;
  }

  const batchResponse = matchFactKeysWithLlmBatch(request, resolverOptions);
  const matchesByTarget = new Map(batchResponse.matches.map((match) => [match.targetKey, match]));

  return {
    ...resolverOptions,
    llmKeyMatcher: (request) => {
      const match = matchesByTarget.get(request.targetKey);
      if (!match) {
        return resolverOptions.llmKeyMatcher?.(request);
      }

      const { targetKey: _targetKey, ...response } = match;
      return response;
    }
  };
}

function collectBatchMatchTargets(
  fields: ExtractedField[],
  facts: ProfileFact[]
): LlmBatchKeyMatchRequest["targets"] {
  const targetsByKey = new Map<string, LlmBatchKeyMatchRequest["targets"][number]>();

  for (const field of fields) {
    const risk = classifyFieldRisk(field);
    if (isFillBlocked(risk) || shouldGenerateLongFormAnswer(field)) {
      continue;
    }

    const targetKey = scoreFieldMatch(field).profileKey;

    if (!targetKey) {
      // Local scorer could not identify this field (e.g. non-English label).
      // Send it to the LLM with a synthetic key so it can discover both the
      // canonical profile key and the matching fact.
      const fieldLabel = [
        field.labelText,
        field.ariaLabel,
        field.placeholder,
        field.title
      ].find((v) => v?.trim());

      if (fieldLabel) {
        const syntheticKey = `field:${field.fieldId}`;
        const context = contextForField(field, risk);
        if (!targetsByKey.has(syntheticKey)) {
          targetsByKey.set(syntheticKey, {
            targetKey: syntheticKey,
            targetLabel: fieldLabel.trim(),
            context
          });
        }
      }
      continue;
    }

    if (resolveDirectCanonicalFact(targetKey, facts)) {
      continue;
    }

    const context = contextForField(field, risk);
    const current = targetsByKey.get(targetKey);
    if (!current || sensitivityRank(context.sensitivity) > sensitivityRank(current.context?.sensitivity)) {
      targetsByKey.set(targetKey, {
        targetKey,
        targetLabel: labelForProfileKey(targetKey, field),
        context
      });
    }
  }

  return [...targetsByKey.values()];
}

function resolveProfileFactValueWithLlm(
  targetKey: string,
  facts: ProfileFact[],
  context: ProfileFactResolutionContext,
  resolverOptions: ProfileFactResolverOptions
): ResolvedProfileFactValue | undefined {
  if (!resolverOptions.enableLlmKeyMatcherFallback || !resolverOptions.llmKeyMatcher) {
    return undefined;
  }

  const match = matchFactKeyWithLlm(targetKey, facts.map(({ key, label }) => ({ key, label })), context, resolverOptions);
  if (match.relationship === "not_applicable" || match.relationship === "stale_or_historical") {
    return undefined;
  }

  const selectedFact = match.bestFactKey ? facts.find((fact) => fact.key === match.bestFactKey) : undefined;
  if (!selectedFact) {
    return undefined;
  }

  const extractedValue = extractValueForTarget(targetKey, selectedFact, context);
  if (extractedValue === undefined) {
    return undefined;
  }

  const candidate: ResolvedProfileFactValue = {
    fact: selectedFact,
    profileKey: targetKey,
    value: extractedValue,
    derived: true,
    confidence: match.confidence,
    reason: `LLM fallback selected ${selectedFact.key}: ${match.reason}`
  };

  return judgeResolvedCandidate(candidate, selectedFact, context) ? candidate : undefined;
}

export function matchFactKeyWithLlm(
  targetKey: string,
  factsMeta: LlmKeyMatchRequest["facts"],
  context: ProfileFactResolutionContext = {},
  resolverOptions: ProfileFactResolverOptions = {}
): LlmKeyMatchResponse {
  const cacheKey = llmCacheKey(targetKey, factsMeta, context, resolverOptions);
  const cached = getCachedLlmKeyMatch(cacheKey);
  if (cached && isSafeLlmMatch(cached, factsMeta, context)) {
    return cached;
  }

  const response = resolverOptions.llmKeyMatcher?.({
    targetKey,
    targetLabel: titleCase(targetKey.split(".").at(-1)?.replace(/[_-]+/g, " ") ?? targetKey),
    facts: factsMeta,
    context
  }) ?? {
    bestFactKey: null,
    confidence: 0,
    relationship: "not_applicable" as const,
    reason: "LLM key matcher is not configured."
  };

  setCachedLlmKeyMatch(cacheKey, response);
  return response;
}

export function matchFactKeysWithLlmBatch(
  request: LlmBatchKeyMatchRequest,
  resolverOptions: ProfileFactResolverOptions = {}
): LlmBatchKeyMatchResponse {
  const cacheKey = llmBatchCacheKey(request, resolverOptions);
  const cached = getCachedLlmBatchKeyMatch(cacheKey);
  if (cached && isSafeLlmBatchMatch(cached, request)) {
    seedSingleMatchCache(request, cached, resolverOptions);
    return cached;
  }

  const response = resolverOptions.llmBatchKeyMatcher?.(request) ?? {
    matches: request.targets.map((target) => ({
      targetKey: target.targetKey,
      bestFactKey: null,
      confidence: 0,
      relationship: "not_applicable" as const,
      reason: "LLM batch key matcher is not configured."
    }))
  };

  const sanitized = sanitizeBatchResponse(response, request);
  setCachedLlmBatchKeyMatch(cacheKey, sanitized);
  seedSingleMatchCache(request, sanitized, resolverOptions);
  return sanitized;
}

export function buildLlmBatchKeyMatchPrompt(request: LlmBatchKeyMatchRequest): string {
  return [
    LLM_BATCH_KEY_MATCH_SYSTEM_PROMPT,
    "",
    "INPUT",
    JSON.stringify(request, null, 2),
    "",
    "OUTPUT",
    JSON.stringify({
      matches: [
        {
          targetKey: "address.city",
          bestFactKey: "custom.current_location",
          confidence: 0.86,
          relationship: "semantic_source",
          reason: "The fact label describes the user's current location, which can locally provide a city component.",
          risks: ["Local extraction must verify a city component exists."]
        },
        {
          targetKey: "field:abc123",
          suggestedProfileKey: "address.city",
          bestFactKey: "custom.identity_location_current",
          confidence: 0.88,
          relationship: "semantic_source",
          reason: "The label 'Ville' is French for city. The location fact can provide the city component.",
          risks: ["Local extraction must verify a city component exists."]
        }
      ]
    })
  ].join("\n");
}

export function getCachedLlmKeyMatch(cacheKey: string): LlmKeyMatchResponse | undefined {
  return llmKeyMatchCache.get(cacheKey);
}

export function setCachedLlmKeyMatch(cacheKey: string, response: LlmKeyMatchResponse): void {
  llmKeyMatchCache.set(cacheKey, response);
}

export function getCachedLlmBatchKeyMatch(cacheKey: string): LlmBatchKeyMatchResponse | undefined {
  return llmBatchKeyMatchCache.get(cacheKey);
}

export function setCachedLlmBatchKeyMatch(cacheKey: string, response: LlmBatchKeyMatchResponse): void {
  llmBatchKeyMatchCache.set(cacheKey, response);
}

export function clearProfileFactResolverCache(): void {
  llmKeyMatchCache.clear();
  llmBatchKeyMatchCache.clear();
}

export function tryRepairJson(jsonStr: string): string {
  let cleaned = jsonStr.trim();
  
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {}

  const stack: ("{" | "[")[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      stack.push("{");
    } else if (char === "[") {
      stack.push("[");
    } else if (char === "}") {
      if (stack[stack.length - 1] === "{") {
        stack.pop();
      }
    } else if (char === "]") {
      if (stack[stack.length - 1] === "[") {
        stack.pop();
      }
    }
  }

  if (stack.length > 0) {
    let repaired = cleaned;
    if (inString) {
      repaired += '"';
    }
    while (stack.length > 0) {
      const open = stack.pop();
      if (open === "{") {
        repaired += "}";
      } else if (open === "[") {
        repaired += "]";
      }
    }
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {}
  }

  return cleaned;
}

export function getCachedLlmBatchKeyMatchResponse(
  request: LlmBatchKeyMatchRequest,
  resolverOptions: ProfileFactResolverOptions = {}
): LlmBatchKeyMatchResponse | undefined {
  const cacheKey = llmBatchCacheKey(request, resolverOptions);
  const cached = getCachedLlmBatchKeyMatch(cacheKey);
  if (cached && isSafeLlmBatchMatch(cached, request)) {
    return cached;
  }
  return undefined;
}

export function setCachedLlmBatchKeyMatchResponse(
  request: LlmBatchKeyMatchRequest,
  response: LlmBatchKeyMatchResponse,
  resolverOptions: ProfileFactResolverOptions = {}
): void {
  const cacheKey = llmBatchCacheKey(request, resolverOptions);
  const sanitized = sanitizeBatchResponse(response, request);
  setCachedLlmBatchKeyMatch(cacheKey, sanitized);
  seedSingleMatchCache(request, sanitized, resolverOptions);
}

function llmCacheKey(
  targetKey: string,
  factsMeta: LlmKeyMatchRequest["facts"],
  context: ProfileFactResolutionContext,
  resolverOptions: ProfileFactResolverOptions
): string {
  return JSON.stringify({
    targetKey,
    factKeys: factsMeta.map((fact) => fact.key).sort(),
    preferPast: Boolean(context.preferPast),
    promptVersion: resolverOptions.promptVersion ?? DEFAULT_LLM_PROMPT_VERSION,
    schemaVersion: resolverOptions.schemaVersion ?? DEFAULT_LLM_SCHEMA_VERSION,
    modelVersion: resolverOptions.modelVersion ?? DEFAULT_LLM_MODEL_VERSION
  });
}

function llmBatchCacheKey(
  request: LlmBatchKeyMatchRequest,
  resolverOptions: ProfileFactResolverOptions
): string {
  return JSON.stringify({
    targets: request.targets
      .map((target) => ({
        targetKey: target.targetKey,
        targetLabel: target.targetLabel ?? "",
        context: contextBucket(target.context)
      }))
      .sort((left, right) => left.targetKey.localeCompare(right.targetKey)),
    facts: request.facts
      .map((fact) => ({ key: fact.key, label: fact.label ?? "" }))
      .sort((left, right) => left.key.localeCompare(right.key)),
    promptVersion: resolverOptions.promptVersion ?? DEFAULT_LLM_PROMPT_VERSION,
    schemaVersion: resolverOptions.schemaVersion ?? DEFAULT_LLM_SCHEMA_VERSION,
    modelVersion: resolverOptions.modelVersion ?? DEFAULT_LLM_MODEL_VERSION
  });
}

function seedSingleMatchCache(
  request: LlmBatchKeyMatchRequest,
  response: LlmBatchKeyMatchResponse,
  resolverOptions: ProfileFactResolverOptions
): void {
  const factsMeta = request.facts;
  const targetByKey = new Map(request.targets.map((target) => [target.targetKey, target]));
  for (const match of response.matches) {
    const target = targetByKey.get(match.targetKey);
    if (!target) {
      continue;
    }

    const { targetKey: _targetKey, ...singleResponse } = match;
    setCachedLlmKeyMatch(llmCacheKey(match.targetKey, factsMeta, target.context ?? {}, resolverOptions), singleResponse);
  }
}

function sanitizeBatchResponse(
  response: LlmBatchKeyMatchResponse,
  request: LlmBatchKeyMatchRequest
): LlmBatchKeyMatchResponse {
  const allowedTargets = new Set(request.targets.map((target) => target.targetKey));
  const allowedFacts = new Set(request.facts.map((fact) => fact.key));
  const knownProfileKeys = new Set(Object.keys(profileKeyPatterns));
  const byTarget = new Map<string, LlmBatchKeyMatchItem>();

  for (const match of response.matches) {
    if (!allowedTargets.has(match.targetKey)) {
      continue;
    }

    // For synthetic field: targets, validate the suggestedProfileKey
    const suggestedProfileKey =
      match.targetKey.startsWith("field:") && match.suggestedProfileKey && knownProfileKeys.has(match.suggestedProfileKey)
        ? match.suggestedProfileKey
        : null;

    byTarget.set(match.targetKey, {
      ...match,
      suggestedProfileKey,
      bestFactKey: match.bestFactKey && allowedFacts.has(match.bestFactKey) ? match.bestFactKey : null,
      confidence: clampConfidence(match.confidence),
      risks: match.risks?.filter(Boolean)
    });
  }

  return {
    matches: request.targets.map((target) => byTarget.get(target.targetKey) ?? {
      targetKey: target.targetKey,
      bestFactKey: null,
      confidence: 0,
      relationship: "not_applicable" as const,
      reason: "No batch match returned for this target."
    })
  };
}

function isSafeLlmMatch(
  response: LlmKeyMatchResponse,
  factsMeta: LlmKeyMatchRequest["facts"],
  context: ProfileFactResolutionContext
): boolean {
  if (!response.bestFactKey) {
    return true;
  }

  if (response.relationship === "not_applicable" || response.relationship === "stale_or_historical") {
    return false;
  }

  const threshold = context.sensitivity === "high"
    ? HIGH_SENSITIVITY_LLM_ACCEPT_THRESHOLD
    : DEFAULT_LLM_ACCEPT_THRESHOLD;

  return response.confidence >= threshold && factsMeta.some((fact) => fact.key === response.bestFactKey);
}

function isSafeLlmBatchMatch(
  response: LlmBatchKeyMatchResponse,
  request: LlmBatchKeyMatchRequest
): boolean {
  const targetByKey = new Map(request.targets.map((target) => [target.targetKey, target]));
  return response.matches.every((match) => {
    const target = targetByKey.get(match.targetKey);
    return target ? isSafeLlmMatch(match, request.facts, target.context ?? {}) : false;
  });
}

function contextBucket(context: ProfileFactResolutionContext | undefined): Required<ProfileFactResolutionContext> {
  return {
    preferPast: Boolean(context?.preferPast),
    formPurpose: context?.formPurpose ?? "unknown",
    sensitivity: context?.sensitivity ?? "low"
  };
}

function sensitivityRank(value: ProfileFactResolutionContext["sensitivity"]): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function extractValueForTarget(
  targetKey: string,
  fact: ProfileFact,
  context: ProfileFactResolutionContext = {}
): string | undefined {
  if (targetKey === "address.city" || targetKey === "address.region" || targetKey === "address.country") {
    return extractAddressPartFromLocationFact(targetKey, fact);
  }

  if (
    targetKey === "company.name" ||
    targetKey === "work.current_title" ||
    targetKey === "identity.display_name"
  ) {
    return cleanDerivedTextValue(fact.value);
  }

  if (targetKey === "identity.full_name" && context.sensitivity !== "high") {
    return cleanDerivedTextValue(fact.value);
  }

  return undefined;
}

export function judgeResolvedCandidate(
  candidate: ResolvedProfileFactValue,
  fact: ProfileFact,
  context: ProfileFactResolutionContext = {}
): boolean {
  const threshold = context.sensitivity === "high"
    ? HIGH_SENSITIVITY_LLM_ACCEPT_THRESHOLD
    : DEFAULT_LLM_ACCEPT_THRESHOLD;

  if ((candidate.confidence ?? 0) < threshold) {
    return false;
  }

  if (typeof candidate.value !== "string" || !candidate.value.trim() || isUnknownPlaceholderValue(candidate.value)) {
    return false;
  }

  if (!isValidFactForProfileKey(candidate.profileKey, candidate.value)) {
    return false;
  }

  if (candidate.profileKey.startsWith("address.") && candidate.value.length > 80) {
    return false;
  }

  if (candidate.profileKey === "identity.full_name" && context.sensitivity === "high") {
    return false;
  }

  return fact.key === candidate.fact.key;
}

function extractAddressPartFromLocationFact(targetKey: string, fact: ProfileFact): string | undefined {
  const value = cleanDerivedTextValue(fact.value);
  if (!value) {
    return undefined;
  }

  const parts = value
    .split(",")
    .map((part) => cleanDerivedTextValue(part))
    .filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return undefined;
  }

  if (targetKey === "address.city") {
    return parts[0];
  }

  if (targetKey === "address.region" && parts.length >= 3) {
    return parts[1];
  }

  if (targetKey === "address.country" && parts.length >= 2) {
    return parts.at(-1);
  }

  return undefined;
}

function cleanDerivedTextValue(value: ProfileFact["value"]): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const cleaned = stripMemoryEvidenceTags(value)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned && !isUnknownPlaceholderValue(cleaned) ? cleaned : undefined;
}

function keysMatch(left: string, right: string): boolean {
  return left === right || normalizeKey(left) === normalizeKey(right);
}

function factText(fact: ProfileFact): string {
  return normalizeFieldText(`${fact.key} ${fact.label}`).toLowerCase();
}

function findNameFact(facts: ProfileFact[], targetKey: string): ProfileFact | undefined {
  return facts.find((fact) => keysMatch(fact.key, "identity.full_name") && typeof fact.value === "string" && splitDisplayName(fact.value))
    ?? facts.find((fact) => {
      if (typeof fact.value !== "string" || !splitDisplayName(fact.value)) {
        return false;
      }
      const text = factText(fact);
      if (/\b(past|previous|former|old|history|historical|formerly|ex)\b/i.test(text)) {
        return false;
      }
      return /\b(display|full|legal)?\s*name\b/.test(text) || /\bidentity\s+display\s+name\b/.test(text);
    });
}

function splitDisplayName(value: string): { full: string; first: string; last: string } | undefined {
  const cleaned = stripMemoryEvidenceTags(value);
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.some((part) => /[^\p{L}'-]/u.test(part))) {
    return undefined;
  }

  return {
    full: parts.join(" "),
    first: parts.slice(0, -1).join(" "),
    last: parts.at(-1) ?? ""
  };
}

function stripMemoryEvidenceTags(value: string): string {
  return value
    .replace(/\s*\[(?:fact|memory|inference|assumption|unknown|speculation|prediction)\]\s*$/i, "")
    .trim();
}

function isUnknownPlaceholderValue(value: string): boolean {
  const normalized = stripMemoryEvidenceTags(value).trim().toLowerCase().replace(/[.\s_-]+$/g, "");
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length <= 8 && /\b(unknown|none|null|n\/a|na|not applicable|not provided|not specified|unspecified|missing|no answer|i don't know|i do not know|dont know|don't know)\b/i.test(normalized);
}

function normalizeFieldText(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(stripNoiseAffixes)
    .filter(Boolean)
    .join(" ");
}

function tokenize(value: string): string[] {
  return normalizeFieldText(value).split(/\s+/).filter(Boolean);
}

function stripNoiseAffixes(token: string): string {
  return token
    .replace(/^(user|usr|fld|field|input|form|txt|ctrl)+(?=[a-z0-9])/i, "")
    .replace(/(field|input|control|value)$/i, "");
}
