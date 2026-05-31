import { describe, expect, it } from "vitest";
import { buildScanWarningsFromSkippedInvisibleCount } from "./extract";

describe("buildScanWarningsFromSkippedInvisibleCount", () => {
  it("omits warnings when no invisible fields were skipped", () => {
    expect(buildScanWarningsFromSkippedInvisibleCount(0)).toEqual([]);
  });

  it("reports skipped invisible fields", () => {
    expect(buildScanWarningsFromSkippedInvisibleCount(2)).toEqual([
      "2 hidden or invisible fields were skipped."
    ]);
  });
});
