import { describe, expect, it } from "vitest";
import { parseLlmBatchKeyMatchResponse } from "./llm-key-matcher-parser";

describe("llm key matcher", () => {
  it("parses a valid Ollama batch key match response", () => {
    const response = parseLlmBatchKeyMatchResponse(JSON.stringify({
      matches: [{
        targetKey: "address.city",
        bestFactKey: "custom.identity_location_current",
        confidence: 0.88,
        relationship: "semantic_source",
        reason: "Current location can locally provide the city.",
        risks: ["Local extraction must verify city component."]
      }]
    }));

    expect(response).toEqual({
      matches: [{
        targetKey: "address.city",
        bestFactKey: "custom.identity_location_current",
        confidence: 0.88,
        relationship: "semantic_source",
        reason: "Current location can locally provide the city.",
        risks: ["Local extraction must verify city component."]
      }]
    });
  });

  it("preserves suggested profile keys for synthetic field targets", () => {
    const response = parseLlmBatchKeyMatchResponse(JSON.stringify({
      matches: [{
        targetKey: "field:form_1_field_7",
        suggestedProfileKey: "address.city",
        bestFactKey: "custom.identity_location_current",
        confidence: 0.88,
        relationship: "semantic_source",
        reason: "Ville is French for city."
      }]
    }));

    expect(response.matches[0]).toMatchObject({
      targetKey: "field:form_1_field_7",
      suggestedProfileKey: "address.city",
      bestFactKey: "custom.identity_location_current"
    });
  });

  it("rejects malformed Ollama batch key match responses", () => {
    expect(() => parseLlmBatchKeyMatchResponse("not-json")).toThrow("invalid JSON");
    expect(() => parseLlmBatchKeyMatchResponse(JSON.stringify({ matches: "nope" }))).toThrow("matches array");
    expect(() => parseLlmBatchKeyMatchResponse(JSON.stringify({
      matches: [{
        targetKey: "address.city",
        bestFactKey: "custom.identity_location_current",
        confidence: 0.88,
        relationship: "current_guess",
        reason: "bad relationship"
      }]
    }))).toThrow("relationship is invalid");
  });
});
