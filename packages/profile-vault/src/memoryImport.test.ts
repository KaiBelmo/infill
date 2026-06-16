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

  it("normalizes unknown placeholder values to null after stripping fact tags", () => {
    const facts = parseMemoryFacts("Identity display name: Alex Chen [fact]\nIdentity sex or gender: unknown [unknown]");

    expect(facts[0]?.value).toBe("Alex Chen");
    expect(facts[0]?.confidence).toBe("high");
    expect(facts[1]?.value).toBeNull();
    expect(facts[1]?.confidence).toBe("missing");
  });

  it("normalizes none-style placeholder values to null", () => {
    const facts = parseMemoryFacts("LinkedIn: none\nPortfolio: N/A\nGitHub: not provided\nWebsite: Unknown exact URL\nExact URL: exact URL unknown");

    expect(facts.map((fact) => fact.value)).toEqual([null, null, null, null, null]);
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

  it("parses confidence tags as metadata and strips them from values", () => {
    const facts = parseMemoryFacts([
      "Full name: Kai Belmo [fact] [confidence: high]",
      "Work style: Direct and iterative [inference] [confidence: medium]",
      "Speculation blind spot: Overbuilding workflows [speculation] [confidence: low]",
      "Unknown linkedin exact URL: What exact LinkedIn profile URL should be saved? [unknown] [confidence: missing]"
    ].join("\n"));

    expect(facts.map((fact) => ({ label: fact.label, value: fact.value, confidence: fact.confidence }))).toEqual([
      { label: "Full name", value: "Kai Belmo", confidence: "high" },
      { label: "Work style", value: "Direct and iterative", confidence: "medium" },
      { label: "Speculation blind spot", value: "Overbuilding workflows", confidence: "low" },
      { label: "Unknown linkedin exact URL", value: null, confidence: "missing" }
    ]);
  });

  it("derives confidence from source tags when no explicit confidence tag is present", () => {
    const facts = parseMemoryFacts([
      "Name: Alex [fact]",
      "Preference: concise replies [memory]",
      "Work style: fast iteration [inference]",
      "Operating mode: direct answers [assumption]",
      "Next action: ask for tests [prediction]",
      "Possible blind spot: impatience [speculation]",
      "Unknown primary goal: What primary outcome should be saved? [unknown]"
    ].join("\n"));

    expect(facts.map((fact) => fact.confidence)).toEqual(["high", "high", "medium", "medium", "low", "low", "missing"]);
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
