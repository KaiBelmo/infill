import { describe, expect, it } from "vitest";
import { parseMemoryFacts } from "./memoryImport";

describe("memory import", () => {
  it("parses approved memory lines into profile facts", () => {
    const facts = parseMemoryFacts("Email: person@example.com\nFull name: Sam Rivera");

    expect(facts).toMatchObject([
      { key: "contact.email", value: "person@example.com", category: "contact" },
      { key: "identity.full_name", value: "Sam Rivera", category: "identity" }
    ]);
  });

  it("marks secret-like labels as secret", () => {
    const [fact] = parseMemoryFacts("API key: hidden");

    expect(fact?.sensitivity).toBe("secret");
  });

  it("strips bracketed fact tags from values", () => {
    const facts = parseMemoryFacts("Identity display name: Alex Chen [fact]\nIdentity sex or gender: unknown [unknown]");

    expect(facts[0]?.value).toBe("Alex Chen");
    expect(facts[1]?.value).toBeNull();
    expect(facts[1]?.confidence).toBe("missing");
  });

  it("strips any trailing bracketed annotation tags", () => {
    const tags = ["fact", "memory", "inference", "assumption", "speculation", "prediction", "unknown", "smth"];
    for (const tag of tags) {
      const [fact] = parseMemoryFacts(`Name: Alice [${tag}]`);
      expect(fact?.value).toBe("Alice");
    }
  });

  it("strips multiple trailing bracketed annotation tags", () => {
    const [fact] = parseMemoryFacts("Name: Alice Chen [fact] [smth]");

    expect(fact?.value).toBe("Alice Chen");
  });

  it("does not treat non-contact notes as phone or email facts", () => {
    const facts = parseMemoryFacts([
      "Phone number verification required: Flutter and Next.js were part of interview preparation [memory]",
      "Email deliverability note: use a professional domain",
      "Skills frontend mobile: Flutter and Next.js were part of interview preparation [memory]"
    ].join("\n"));

    expect(facts).toEqual([
      {
        key: "custom.phone_number_verification_required",
        label: "Phone number verification required",
        value: "Flutter and Next.js were part of interview preparation",
        category: "custom",
        sensitivity: "normal",
        confidence: "high"
      },
      {
        key: "custom.email_deliverability_note",
        label: "Email deliverability note",
        value: "use a professional domain",
        category: "custom",
        sensitivity: "normal",
        confidence: "high"
      },
      {
        key: "custom.skills_frontend_mobile",
        label: "Skills frontend mobile",
        value: "Flutter and Next.js were part of interview preparation",
        category: "custom",
        sensitivity: "normal",
        confidence: "high"
      }
    ]);
  });
});
