import { describe, expect, it } from "vitest";
import { isFillableMappingValue } from "./fill";

describe("fill value guards", () => {
  it("rejects null and unknown-style placeholders before DOM fill", () => {
    expect(isFillableMappingValue(undefined)).toBe(false);
    expect(isFillableMappingValue(null)).toBe(false);
    expect(isFillableMappingValue("unknown")).toBe(false);
    expect(isFillableMappingValue("Unknown exact URL")).toBe(false);
    expect(isFillableMappingValue("Exact URL unknown")).toBe(false);
    expect(isFillableMappingValue("none")).toBe(false);
    expect(isFillableMappingValue("N/A")).toBe(false);
    expect(isFillableMappingValue("not provided")).toBe(false);
    expect(isFillableMappingValue("[address.city]")).toBe(false);
    expect(isFillableMappingValue("Temara")).toBe(true);
    expect(isFillableMappingValue(false)).toBe(true);
  });
});
