import { describe, expect, it } from "vitest";
import type { CloudAssistRequest, FieldMapping } from "@infill/shared";
import { mergeAssistAnswersWithLocal, parseAssistAnswers, prepareAssistInput } from "./assist";

describe("assist helpers", () => {
  it("parses fenced JSON, surrounding text, arrays, and normalized values", () => {
    expect(parseAssistAnswers("```json\n{\"answers\":[{\"fieldId\":\"a\",\"value\":\" yes \"}]}\n```").get("a")?.value).toBe("yes");
    expect(parseAssistAnswers("before {\"answers\":[{\"fieldId\":\"b\",\"value\":true}]} after").get("b")?.value).toBe(true);
    expect(parseAssistAnswers("[{\"fieldId\":\"c\",\"value\":[\" one \",\"\",2,\"two\"]}]").get("c")?.value).toEqual(["one", "two"]);
    expect(parseAssistAnswers("{\"answers\":[{\"fieldId\":\"d\",\"value\":\"\"},{\"fieldId\":\"e\",\"value\":12}]}").has("d")).toBe(false);
    expect(parseAssistAnswers("not json").size).toBe(0);
  });

  it("omits placeholder answers instead of filling unknown-style values", () => {
    const answers = parseAssistAnswers(JSON.stringify({
      answers: [
        { fieldId: "unknown", value: "unknown" },
        { fieldId: "none", value: "none" },
        { fieldId: "na", value: "N/A" },
        { fieldId: "unknown_url", value: "Unknown exact URL" },
        { fieldId: "url_unknown", value: "Exact URL unknown" },
        { fieldId: "mixed", value: ["unknown", "github.com/example"] },
        { fieldId: "only_placeholders", value: ["unknown", "not provided"] }
      ]
    }));

    expect(answers.has("unknown")).toBe(false);
    expect(answers.has("none")).toBe(false);
    expect(answers.has("na")).toBe(false);
    expect(answers.has("unknown_url")).toBe(false);
    expect(answers.has("url_unknown")).toBe(false);
    expect(answers.get("mixed")?.value).toEqual(["github.com/example"]);
    expect(answers.has("only_placeholders")).toBe(false);
  });

  it("prepares only safe facts and eligible unresolved fields for model prompts", () => {
    const request = createAssistRequest();
    const prepared = prepareAssistInput(request);

    expect(prepared.safeFacts.map((fact) => fact.id)).toEqual(["fact_public"]);
    expect(prepared.llmFields.map((field) => field.fieldId)).toEqual(["field_long"]);
    expect(prepared.promptMessages[1]?.content).not.toContain("Ada Lovelace");
    expect(prepared.cachedMappings.get("field_email")?.value).toBe("ada@example.com");
  });

  it("does not cache null profile facts as fillable values", () => {
    const request = createAssistRequest();
    request.facts = [
      {
        id: "fact_email",
        key: "contact.email",
        label: "Email",
        value: null,
        category: "contact",
        sensitivity: "normal",
        source: "llm_suggested",
        verified: false,
        confidence: 0.8,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
        sourceRefs: []
      }
    ];

    const prepared = prepareAssistInput(request);

    expect(prepared.cachedMappings.has("field_email")).toBe(false);
    expect(prepared.promptMessages[1]?.content).toContain('"hasValue":false');
  });

  it("merges cached and generated answers without changing restricted fields", () => {
    const request = createAssistRequest();
    const prepared = prepareAssistInput(request);
    const merged = mergeAssistAnswersWithLocal({
      localMappings: request.localMappings,
      cachedMappings: prepared.cachedMappings,
      allFields: prepared.allFields,
      answersByFieldId: parseAssistAnswers(JSON.stringify({
        answers: [
          { fieldId: "field_long", value: "Generated draft." },
          { fieldId: "field_secret", value: "should not apply" }
        ]
      }))
    });

    const byId = new Map(merged.map((mapping) => [mapping.fieldId, mapping]));
    expect(byId.get("field_email")?.valueSource).toBe("profile_fact");
    expect(byId.get("field_long")?.valueSource).toBe("generated_answer");
    expect(byId.get("field_long")?.preselected).toBe(true);
    expect(byId.get("field_secret")?.value).toBeUndefined();
  });
});

function createAssistRequest(): CloudAssistRequest {
  return {
    forms: [
      {
        formId: "form_1",
        urlOrigin: "https://example.com",
        urlPathHash: "example.com/apply",
        createdAt: "2026-05-01T00:00:00.000Z",
        scanWarnings: [],
        fields: [
          {
            fieldId: "field_email",
            formId: "form_1",
            tagName: "input",
            inputType: "email",
            labelText: "Email",
            required: true,
            disabled: false,
            readonly: false,
            visible: true,
            hasUserValue: false,
            domPathHint: "input[name='email']",
            options: []
          },
          {
            fieldId: "field_long",
            formId: "form_1",
            tagName: "textarea",
            labelText: "Tell us about yourself",
            required: false,
            disabled: false,
            readonly: false,
            visible: true,
            hasUserValue: false,
            domPathHint: "textarea[name='bio']",
            options: []
          },
          {
            fieldId: "field_secret",
            formId: "form_1",
            tagName: "input",
            inputType: "password",
            labelText: "Password",
            required: true,
            disabled: false,
            readonly: false,
            visible: true,
            hasUserValue: false,
            domPathHint: "input[type='password']",
            options: []
          }
        ]
      }
    ],
    facts: [
      {
        id: "fact_public",
        key: "contact.email",
        label: "Email",
        value: "ada@example.com",
        category: "contact",
        sensitivity: "normal",
        source: "manual",
        verified: true,
        confidence: 1,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
        sourceRefs: []
      },
      {
        id: "fact_secret",
        key: "identity.full_name",
        label: "Full name",
        value: "Ada Lovelace",
        category: "identity",
        sensitivity: "secret",
        source: "manual",
        verified: true,
        confidence: 1,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
        sourceRefs: []
      }
    ],
    localMappings: [
      mapping("field_email", "none", "personal"),
      mapping("field_long", "none", "personal"),
      mapping("field_secret", "none", "secret")
    ],
    requestedAt: "2026-05-01T00:00:00.000Z",
    locale: "en"
  };
}

function mapping(fieldId: string, valueSource: FieldMapping["valueSource"], risk: FieldMapping["risk"]): FieldMapping {
  return {
    fieldId,
    valueSource,
    confidence: 0,
    risk,
    preselected: false,
    requiresExplicitApproval: risk !== "safe",
    reason: "No local answer yet.",
    warnings: [],
    usedFactIds: []
  };
}
