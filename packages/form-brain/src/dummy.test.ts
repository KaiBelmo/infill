import type { ExtractedField } from "@infill/shared";
import { describe, expect, it, vi } from "vitest";
import { generateDummyDataForField } from "./dummy";

describe("generateDummyDataForField", () => {
  it("generates an E.164 US phone number", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const value = generateDummyDataForField(field({
      id: "phone",
      name: "phone",
      inputType: "tel",
      labelText: "Phone number"
    }));

    expect(value).toMatch(/^\+1\d{10}$/);
  });

  it("keeps French address and phone fields in the same locale persona", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state: Record<string, string | boolean> = {};

    const city = generateDummyDataForField(field({ labelText: "Ville" }), state, "fr");
    const country = generateDummyDataForField(field({ labelText: "Pays" }), state, "fr");
    const phone = generateDummyDataForField(field({ labelText: "Numéro de téléphone", inputType: "tel" }), state, "fr");

    expect(city).toBe("Paris");
    expect(country).toBe("France");
    expect(phone).toMatch(/^\+336\d{8}$/);
  });

  it("uses region-specific locale data when the page declares a region", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(generateDummyDataForField(field({ labelText: "Ville" }), {}, "fr-CA")).toBe("Montréal");
    expect(generateDummyDataForField(field({ labelText: "City" }), {}, "en-GB")).toBe("London");
  });

  it("generates a valid LinkedIn profile URL", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const value = generateDummyDataForField(field({
      id: "linkedin",
      name: "linkedin",
      inputType: "text",
      labelText: "LinkedIn"
    }));

    expect(value).toMatch(/^https:\/\/www\.linkedin\.com\/in\/[a-z0-9-]+$/);
  });

  it("generates a validator-safe X identifier when the field asks for a handle", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const value = generateDummyDataForField(field({
      id: "twitter",
      name: "twitter",
      labelText: "X (ancien Twitter)"
    }));

    expect(value).toMatch(/^[a-zA-Z0-9_]{4,15}$/);
  });

  it("generates a Twitter URL when the field explicitly requests a profile", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const value = generateDummyDataForField(field({
      id: "twitter-profile",
      labelText: "Twitter profile URL"
    }));

    expect(value).toMatch(/^https:\/\/twitter\.com\/[a-zA-Z0-9_]{4,15}$/);
  });
});

function field(overrides: Partial<ExtractedField>): ExtractedField {
  return {
    fieldId: "field",
    formId: "form",
    tagName: "input",
    inputType: "text",
    options: [],
    required: false,
    disabled: false,
    readonly: false,
    visible: true,
    hasUserValue: false,
    domPathHint: "input",
    ...overrides
  };
}
