import { describe, expect, it } from "vitest";
import { classifyFieldRisk } from "./risk";

const baseField = {
  fieldId: "field_1",
  formId: "form_1",
  tagName: "input" as const,
  required: false,
  disabled: false,
  readonly: false,
  visible: true,
  hasUserValue: false,
  domPathHint: "input:nth-of-type(1)"
};

describe("field risk classifier", () => {
  it("classifies password fields as sensitive (skipped, not blocked)", () => {
    expect(classifyFieldRisk({ ...baseField, inputType: "password" })).toBe("sensitive");
  });

  it("detects personal contact fields", () => {
    expect(classifyFieldRisk({ ...baseField, labelText: "Email address" })).toBe("personal");
  });

  it("detects restricted certification fields", () => {
    expect(classifyFieldRisk({ ...baseField, labelText: "I certify this application is accurate" })).toBe("restricted");
  });
});
