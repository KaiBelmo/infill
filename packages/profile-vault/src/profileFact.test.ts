import { describe, expect, it } from "vitest";
import { createProfileFact, mergeProfileFact, normalizeProfileKey, replaceProfileFact } from "./profileFact";

describe("profile facts", () => {
  it("normalizes profile keys", () => {
    expect(normalizeProfileKey(" Contact Email ")).toBe("contact_email");
  });

  it("creates a valid manual fact", () => {
    const fact = createProfileFact(
      {
        key: "contact.email",
        label: "Email",
        value: "person@example.com",
        category: "contact",
        sensitivity: "normal"
      },
      new Date("2026-04-26T00:00:00.000Z")
    );

    expect(fact.verified).toBe(true);
    expect(fact.source).toBe("manual");
  });

  it("replaces an existing fact while preserving identity", () => {
    const existing = createProfileFact(
      {
        key: "contact.email",
        label: "Email",
        value: "old@example.com",
        category: "contact",
        sensitivity: "normal"
      },
      new Date("2026-04-26T00:00:00.000Z")
    );
    const incoming = createProfileFact(
      {
        key: "contact.email",
        label: "Primary email",
        value: "new@example.com",
        category: "contact",
        sensitivity: "normal"
      },
      new Date("2026-04-27T00:00:00.000Z")
    );

    const replaced = replaceProfileFact(existing, incoming, new Date("2026-04-28T00:00:00.000Z"));

    expect(replaced.id).toBe(existing.id);
    expect(replaced.createdAt).toBe(existing.createdAt);
    expect(replaced.label).toBe("Primary email");
    expect(replaced.value).toBe("new@example.com");
  });

  it("merges a fact update and keeps prior references when the new fact has none", () => {
    const existing = createProfileFact(
      {
        key: "identity.full_name",
        label: "Full name",
        value: "Sam Rivera",
        category: "identity",
        sensitivity: "normal",
        sourceRefs: ["resume.pdf"]
      },
      new Date("2026-04-26T00:00:00.000Z")
    );
    const incoming = createProfileFact(
      {
        key: "identity.full_name",
        label: "Legal name",
        value: "Sam Rivera",
        category: "identity",
        sensitivity: "normal"
      },
      new Date("2026-04-27T00:00:00.000Z")
    );

    const merged = mergeProfileFact(existing, incoming, new Date("2026-04-28T00:00:00.000Z"));

    expect(merged.id).toBe(existing.id);
    expect(merged.label).toBe("Legal name");
    expect(merged.sourceRefs).toEqual(["resume.pdf"]);
  });
});
