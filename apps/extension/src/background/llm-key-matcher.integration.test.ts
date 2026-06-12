import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapFieldsToProfile } from "@infill/form-brain";
import type { ExtractedField, ProfileFact } from "@infill/shared";
import { buildLlmKeyMatcherResolverOptions, buildLocalLlmKeyMatcherResolverOptions } from "./llm-key-matcher";

const runCloudKeyMatchMock = vi.hoisted(() => vi.fn());

const cloudState = vi.hoisted(() => ({
  config: {
    enableLlmKeyMatcherFallback: true,
    localOllamaEnabled: true,
    ollamaBaseUrl: "http://localhost:11434/v1",
    ollamaModel: "llama3.1",
    cloudAssistEnabled: false
  }
}));

vi.mock("./cloud-store", () => ({
  useCloudStore: {
    getState: () => ({
      getCloudState: () => cloudState
    })
  },
  validateOllamaBaseUrl: (value: string) => value.replace(/\/$/, "")
}));

vi.mock("./cloud-assist", () => ({
  runCloudKeyMatch: runCloudKeyMatchMock
}));

const timestamp = "2026-06-05T00:00:00.000Z";

describe("local Ollama key matcher scan pipeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cloudState.config.enableLlmKeyMatcherFallback = true;
    cloudState.config.localOllamaEnabled = true;
    runCloudKeyMatchMock.mockReset();
  });

  it("matches SmartRecruiters city from current location using one page-level Ollama request", async () => {
    const fields = [
      smartRecruitersField("first-name-input", "First name"),
      smartRecruitersField("last-name-input", "Last name"),
      smartRecruitersField("email-input", "Email", { inputType: "email", autocomplete: "email" }),
      smartRecruitersField("spl-form-element_10", "City"),
      smartRecruitersField("linkedin-input", "LinkedIn"),
      smartRecruitersField("hiring-manager-message-input", "Let the company know about your interest working there", {
        tagName: "textarea"
      })
    ];
    const facts = [
      profileFact("identity.first_name", "First name", "Kai"),
      profileFact("identity.last_name", "Last name", "Belmo"),
      profileFact("contact.email", "Email", "kai@example.com"),
      profileFact("contact.linkedin", "LinkedIn", "https://www.linkedin.com/in/kai"),
      profileFact("custom.identity_location_current", "Identity location current", "Temara, Rabat-Sale-Kenitra, Morocco")
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        model: "llama3.1",
        choices: [{
          message: {
            content: JSON.stringify({
              matches: [{
                targetKey: "address.city",
                bestFactKey: "custom.identity_location_current",
                confidence: 0.88,
                relationship: "semantic_source",
                reason: "Current location can locally provide the City field.",
                risks: ["Local extraction must verify a city component exists."]
              }]
            })
          }
        }]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const keyMatcher = await buildLocalLlmKeyMatcherResolverOptions(fields, facts);
    const mappings = mapFieldsToProfile(fields, facts, keyMatcher?.resolverOptions);
    const byFieldId = new Map(mappings.map((mapping) => [mapping.fieldId, mapping]));
    const ollamaBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const prompt = ollamaBody.messages[0].content;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:11434/v1/chat/completions");
    expect(ollamaBody.model).toBe("llama3.1");
    expect(ollamaBody.temperature).toBe(0);
    expect(ollamaBody.response_format).toEqual({ type: "json_object" });
    expect(prompt).toContain('"targetKey": "address.city"');
    expect(prompt).toContain('"key": "custom.identity_location_current"');
    expect(prompt).not.toContain("Temara");
    expect(prompt).not.toContain("kai@example.com");

    expect(keyMatcher?.debug.status).toBe("success");
    expect(keyMatcher?.debug.request?.targets).toHaveLength(1);
    expect(keyMatcher?.debug.request?.targets[0]?.targetKey).toBe("address.city");
    expect(keyMatcher?.debug.response?.matches[0]).toMatchObject({
      targetKey: "address.city",
      bestFactKey: "custom.identity_location_current",
      confidence: 0.88
    });

    expect(byFieldId.get("first-name-input")).toMatchObject({ profileKey: "identity.first_name", value: "Kai" });
    expect(byFieldId.get("last-name-input")).toMatchObject({ profileKey: "identity.last_name", value: "Belmo" });
    expect(byFieldId.get("email-input")).toMatchObject({ profileKey: "contact.email", value: "kai@example.com" });
    expect(byFieldId.get("linkedin-input")).toMatchObject({ profileKey: "contact.linkedin", value: "https://www.linkedin.com/in/kai" });
    expect(byFieldId.get("spl-form-element_10")).toMatchObject({
      profileKey: "address.city",
      value: "Temara",
      valueSource: "profile_fact",
      preselected: true
    });
    expect(byFieldId.get("hiring-manager-message-input")).toMatchObject({
      profileKey: undefined,
      valueSource: "generated_answer",
      requiresExplicitApproval: true
    });
  });

  it("falls back to local mapping when Ollama returns malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "not-json" } }]
      })
    })));
    const fields = [smartRecruitersField("spl-form-element_10", "City")];
    const facts = [profileFact("custom.identity_location_current", "Identity location current", "Temara, Rabat-Sale-Kenitra, Morocco")];

    const keyMatcher = await buildLocalLlmKeyMatcherResolverOptions(fields, facts);
    const mappings = mapFieldsToProfile(fields, facts, keyMatcher?.resolverOptions);

    expect(keyMatcher?.debug.status).toBe("error");
    expect(keyMatcher?.debug.reason).toContain("invalid JSON");
    expect(mappings[0]).toMatchObject({
      profileKey: "address.city",
      valueSource: "none"
    });
    expect(mappings[0]?.value).toBeUndefined();
  });

  it("uses the same extension-built matcher prompt for cloud provider matching", async () => {
    cloudState.config.localOllamaEnabled = false;
    runCloudKeyMatchMock.mockResolvedValue({
      rawResponseText: JSON.stringify({
        matches: [{
          targetKey: "address.city",
          bestFactKey: "custom.identity_location_current",
          confidence: 0.88,
          relationship: "semantic_source",
          reason: "Current location can locally provide the City field.",
          risks: ["Local extraction must verify a city component exists."]
        }]
      }),
      source: "cloud_model",
      warnings: [],
      providerId: "mock-cloud",
      model: "mock-model",
      credits: {
        monthlyLimit: 5000,
        usedThisPeriod: 1,
        remaining: 4999,
        resetAt: null
      }
    });
    const fields = [smartRecruitersField("spl-form-element_10", "City")];
    const facts = [profileFact("custom.identity_location_current", "Identity location current", "Temara, Rabat-Sale-Kenitra, Morocco")];

    const keyMatcher = await buildLlmKeyMatcherResolverOptions(fields, facts, "cloud");
    const mappings = mapFieldsToProfile(fields, facts, keyMatcher?.resolverOptions);
    const cloudPayload = runCloudKeyMatchMock.mock.calls[0]?.[0];

    expect(runCloudKeyMatchMock).toHaveBeenCalledTimes(1);
    expect(cloudPayload.prompt).toContain('"targetKey": "address.city"');
    expect(cloudPayload.prompt).toContain('"key": "custom.identity_location_current"');
    expect(cloudPayload.prompt).not.toContain("Temara");
    expect(keyMatcher?.debug).toMatchObject({
      providerId: "mock-cloud",
      model: "mock-model",
      status: "success"
    });
    expect(mappings[0]).toMatchObject({
      profileKey: "address.city",
      value: "Temara",
      valueSource: "profile_fact"
    });
  });
});

function smartRecruitersField(
  fieldId: string,
  labelText: string,
  overrides: Partial<ExtractedField> = {}
): ExtractedField {
  return {
    fieldId,
    formId: "smartrecruiters-application-form",
    tagName: overrides.tagName ?? "input",
    inputType: overrides.inputType ?? "text",
    name: fieldId,
    id: fieldId,
    labelText,
    required: false,
    disabled: false,
    readonly: false,
    visible: true,
    hasUserValue: false,
    domPathHint: `form#smartrecruiters-application-form [name="${fieldId}"]`,
    options: [],
    ...overrides
  };
}

function profileFact(key: string, label: string, value: ProfileFact["value"]): ProfileFact {
  return {
    id: `fact_${key.replace(/[^a-z0-9]+/gi, "_")}`,
    key,
    label,
    value,
    category: key.startsWith("contact.") ? "contact" : key.startsWith("identity.") ? "identity" : "custom",
    sensitivity: "normal",
    source: "manual",
    verified: true,
    confidence: 0.95,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceRefs: []
  };
}
