import { describe, expect, it } from "vitest";
import { fixtures } from "./data";
import { isVisible, readDraft, storageKey, validateFields } from "./form-utils";

describe("fixture definitions", () => {
  it("provides five long workflows in every category", () => {
    for (const category of ["jobs", "tax", "insurance", "benefits"]) {
      const group = fixtures.filter((fixture) => fixture.category === category);
      expect(group).toHaveLength(5);
      expect(group.every((fixture) => fixture.steps.length >= 5)).toBe(true);
      expect(group.every((fixture) => fixture.steps.flatMap((step) => step.fields).length >= 35)).toBe(true);
    }
  });

  it("uses stable unique field ids within each fixture", () => {
    for (const fixture of fixtures) {
      const ids = fixture.steps.flatMap((step) => step.fields.map((field) => field.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("gives every fixture an owned workflow and varied presentation model", () => {
    expect(new Set(fixtures.map((fixture) => fixture.steps.map((step) => step.title).join("|"))).size).toBe(fixtures.length);
    expect(new Set(fixtures.map((fixture) => fixture.theme)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(fixtures.map((fixture) => fixture.navigation)).size).toBeGreaterThanOrEqual(5);
    expect(fixtures.filter((fixture) => fixture.theme === "foundry")).toHaveLength(1);
  });

  it("includes fixture-native task fields instead of title-only customization", () => {
    const expectedLabels: Record<string, string> = {
      "corporate-talent": "Candidate source",
      "individual-return": "Filing status",
      "auto-collision": "Vehicle year make and model",
      "home-damage": "Property habitability",
      "food-support": "Food purchasing group",
      "childcare-support": "Child needing care",
    };
    for (const [slug, label] of Object.entries(expectedLabels)) {
      const fixture = fixtures.find((item) => item.slug === slug);
      expect(fixture?.steps.flatMap((step) => step.fields).some((item) => item.label === label)).toBe(true);
    }
  });

  it("keeps fixtures dense enough after introducing domain-native steps", () => {
    for (const fixture of fixtures) {
      expect(fixture.steps.every((step) => step.fields.length >= 8)).toBe(true);
      expect(fixture.steps.flatMap((step) => step.fields).length).toBeGreaterThanOrEqual(60);
    }
  });
});

describe("form behavior", () => {
  it("validates visible required fields", () => {
    const fields = [{ id: "name", label: "Name", type: "text" as const, required: true }];
    expect(validateFields(fields, {})).toEqual({ name: "Name is required." });
    expect(validateFields(fields, { name: "Fictional Person" })).toEqual({});
  });

  it("reveals conditional fields only when the answer matches", () => {
    const conditional = { id: "details", label: "Details", type: "text" as const, showWhen: { field: "answer", value: "Yes" } };
    expect(isVisible(conditional, { answer: "No" })).toBe(false);
    expect(isVisible(conditional, { answer: "Yes" })).toBe(true);
  });

  it("restores a valid local draft and ignores malformed data", () => {
    const valid = { step: 2, values: { name: "Test User" }, savedAt: "2026-06-15T10:00:00.000Z" };
    expect(readDraft("sample", { getItem: (key) => key === storageKey("sample") ? JSON.stringify(valid) : null })).toEqual(valid);
    expect(readDraft("sample", { getItem: () => "not-json" })).toBeNull();
  });
});
