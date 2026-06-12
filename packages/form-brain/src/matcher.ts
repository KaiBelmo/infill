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

export type ProfileFactResolutionContext = {
  preferPast?: boolean;
  formPurpose?: "profile" | "checkout" | "job" | "contact" | "unknown";
  sensitivity?: "low" | "medium" | "high";
};

export type LlmKeyMatchResponse = {
  bestFactKey: string | null;
  confidence: number;
  reason: string;
  relationship: "direct_alias" | "semantic_source" | "weak_possible_source" | "not_applicable" | "stale_or_historical";
  risks?: string[];
  suggestedProfileKey?: string | null;
};

export type LlmBatchKeyMatchRequest = {
  targets: Array<{ targetKey: string; targetLabel?: string; context?: ProfileFactResolutionContext }>;
  facts: Array<{ key: string; label?: string }>;
};

export type LlmBatchKeyMatchItem = LlmKeyMatchResponse & { targetKey: string };
export type LlmBatchKeyMatchResponse = { matches: LlmBatchKeyMatchItem[] };

export type ProfileFactResolverOptions = {
  enableLlmKeyMatcherFallback?: boolean;
  llmKeyMatcher?: (request: {
    targetKey: string;
    targetLabel?: string;
    facts: LlmBatchKeyMatchRequest["facts"];
    context?: ProfileFactResolutionContext;
  }) => LlmKeyMatchResponse | undefined;
  llmBatchKeyMatcher?: (request: LlmBatchKeyMatchRequest) => LlmBatchKeyMatchResponse | undefined;
};

export function parseLlmBatchKeyMatchResponse(text: string, providerLabel = "LLM"): LlmBatchKeyMatchResponse {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`${providerLabel} key matcher returned invalid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { matches?: unknown }).matches)) {
    throw new Error(`${providerLabel} key matcher response must contain a matches array.`);
  }

  return {
    matches: (parsed as { matches: unknown[] }).matches.map((value) => {
      if (!value || typeof value !== "object") {
        throw new Error(`${providerLabel} key matcher match item must be an object.`);
      }
      const item = value as Record<string, unknown>;
      if (typeof item.targetKey !== "string" || !item.targetKey) {
        throw new Error(`${providerLabel} key matcher match item is missing targetKey.`);
      }
      if (item.bestFactKey !== null && typeof item.bestFactKey !== "string") {
        throw new Error(`${providerLabel} key matcher bestFactKey must be a string or null.`);
      }
      if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) {
        throw new Error(`${providerLabel} key matcher confidence must be between 0 and 1.`);
      }
      const relationship = item.bestFactKey === null && item.relationship == null ? "not_applicable" : item.relationship;
      if (!["direct_alias", "semantic_source", "weak_possible_source", "not_applicable", "stale_or_historical"].includes(String(relationship))) {
        throw new Error(`${providerLabel} key matcher relationship is invalid.`);
      }
      return {
        targetKey: item.targetKey,
        bestFactKey: item.bestFactKey as string | null,
        confidence: item.confidence,
        relationship: relationship as LlmBatchKeyMatchItem["relationship"],
        reason: typeof item.reason === "string" ? item.reason : "",
        risks: Array.isArray(item.risks) ? item.risks.filter((risk): risk is string => typeof risk === "string") : undefined,
        suggestedProfileKey: typeof item.suggestedProfileKey === "string" || item.suggestedProfileKey === null
          ? item.suggestedProfileKey
          : undefined
      };
    })
  };
}

const MIN_ACCEPTED_SCORE = 70;
const MIN_SCORE_GAP = 15;
const WEAK_SIGNAL_SOURCES = new Set<FieldSignalSource>(["section", "className"]);

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

  // Unrecognized fields (no labelAliases match) need LLM generation
  if (!matchedKey && !blocked) {
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

  const factMatch = matchedKey ? resolveProfileFactValue(matchedKey, facts, resolverOptions) : undefined;

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
    confidence: field.autocomplete ? 0.95 : factMatch.derived ? 0.68 : match?.confidence ?? 0.72,
    risk,
    preselected: risk === "personal" || risk === "safe" || risk === "unknown",
    requiresExplicitApproval: risk !== "safe" && risk !== "personal" && risk !== "unknown",
    reason: factMatch.derived
      ? "Derived from a saved profile fact."
      : match?.evidence.some((item) => item.source === "autocomplete")
        ? "Matched from autocomplete metadata."
        : "Matched from field metadata.",
    warnings: factMatch.fact.verified ? [] : ["The matching profile fact is not marked verified."],
    usedFactIds: [factMatch.fact.id]
  };
}

export function mapFieldsToProfile(
  fields: ExtractedField[],
  facts: ProfileFact[],
  resolverOptions: ProfileFactResolverOptions = {}
): FieldMapping[] {
  return fields.map((field) => mapFieldToProfile(field, facts, resolverOptions));
}

export function buildLlmBatchKeyMatchRequest(
  fields: ExtractedField[],
  facts: ProfileFact[]
): LlmBatchKeyMatchRequest | undefined {
  const targets = fields.flatMap((field) => {
    const targetKey = findProfileKey(field);
    if (!targetKey || resolveProfileFactValue(targetKey, facts)) return [];
    return [{ targetKey, targetLabel: labelForProfileKey(targetKey, field) }];
  });
  return targets.length ? { targets, facts: facts.map(({ key, label }) => ({ key, label })) } : undefined;
}

export function buildLlmBatchKeyMatchPrompt(request: LlmBatchKeyMatchRequest): string {
  return [
    "Match unresolved form targets to allowed fact keys. Return JSON only with shape {\"matches\":[...]}.",
    "Use null when unclear. Do not include fact values.",
    JSON.stringify(request, null, 2)
  ].join("\n");
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

function normalizeFactValue(value: ProfileFact["value"]): string | number | boolean | string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

function isValidFactForProfileKey(key: string | undefined, value: ProfileFact["value"]): boolean {
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

function resolveProfileFactValue(
  key: string,
  facts: ProfileFact[],
  resolverOptions: ProfileFactResolverOptions = {}
): { fact: ProfileFact; profileKey: string; value: string | number | boolean | string[]; derived: boolean } | undefined {
  const direct = facts.find((candidate) => keysMatch(candidate.key, key) && isValidFactForProfileKey(key, candidate.value));
  if (direct) {
    return { fact: direct, profileKey: direct.key, value: normalizeFactValue(direct.value), derived: false };
  }

  if (resolverOptions.enableLlmKeyMatcherFallback && resolverOptions.llmKeyMatcher) {
    const match = resolverOptions.llmKeyMatcher({
      targetKey: key,
      facts: facts.map(({ key: factKey, label }) => ({ key: factKey, label }))
    });
    const fact = match?.bestFactKey ? facts.find((candidate) => candidate.key === match.bestFactKey) : undefined;
    if (fact && match && match.confidence >= 0.7 && match.relationship !== "not_applicable" && match.relationship !== "stale_or_historical") {
      const value = key === "address.city" && typeof fact.value === "string"
        ? fact.value.split(",")[0]?.trim()
        : normalizeFactValue(fact.value);
      if (value !== undefined) return { fact, profileKey: key, value, derived: true };
    }
  }

  if (key === "contact.email") {
    const email = facts.find((candidate) => {
      return factText(candidate).includes("email") && isValidFactForProfileKey(key, candidate.value);
    }) ?? facts.find((candidate) => isValidFactForProfileKey(key, candidate.value));
    return email ? { fact: email, profileKey: key, value: normalizeFactValue(email.value), derived: true } : undefined;
  }

  if (key === "contact.phone") {
    const phone = facts.find((candidate) => {
      const text = factText(candidate);
      return /\b(phone|mobile|tel)\b/.test(text) && isValidFactForProfileKey(key, candidate.value);
    });
    return phone ? { fact: phone, profileKey: key, value: normalizeFactValue(phone.value), derived: true } : undefined;
  }

  if (key === "identity.first_name" || key === "identity.last_name" || key === "identity.full_name") {
    const nameFact = findNameFact(facts);
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

function keysMatch(left: string, right: string): boolean {
  return left === right || normalizeKey(left) === normalizeKey(right);
}

function factText(fact: ProfileFact): string {
  return normalizeFieldText(`${fact.key} ${fact.label}`).toLowerCase();
}

function findNameFact(facts: ProfileFact[]): ProfileFact | undefined {
  return facts.find((fact) => keysMatch(fact.key, "identity.full_name") && typeof fact.value === "string" && splitDisplayName(fact.value))
    ?? facts.find((fact) => {
      if (typeof fact.value !== "string" || !splitDisplayName(fact.value)) {
        return false;
      }
      const text = factText(fact);
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
