import { describe, expect, it } from "vitest";
import { createProfileFact } from "./profileFact";
import {
  createDefaultProfileBundle,
  createLocalProfileVault,
  resolveActiveProfileBundle,
  upsertFactInBundle
} from "./vaultState";

describe("vault state", () => {
  it("falls back to the first bundle when the active id is missing", () => {
    const bundle = createDefaultProfileBundle();

    expect(resolveActiveProfileBundle([bundle], "missing")?.id).toBe(bundle.id);
  });

  it("creates a versioned local vault shape", () => {
    const bundle = createDefaultProfileBundle();
    const vault = createLocalProfileVault([bundle], bundle.id);

    expect(vault.version).toBe(2);
    expect(vault.activeProfileId).toBe(bundle.id);
  });

  it("keeps an existing fact when conflict policy is keep-existing", () => {
    const existing = createProfileFact(
      {
        key: "contact.email",
        label: "Email",
        value: "person@example.com",
        category: "contact",
        sensitivity: "normal"
      },
      new Date("2026-04-26T00:00:00.000Z")
    );
    const incoming = createProfileFact(
      {
        key: "contact.email",
        label: "Work email",
        value: "work@example.com",
        category: "contact",
        sensitivity: "normal"
      },
      new Date("2026-04-27T00:00:00.000Z")
    );
    const bundle = createDefaultProfileBundle([existing], new Date("2026-04-26T00:00:00.000Z"));

    const result = upsertFactInBundle(bundle, incoming);

    expect(result.result.action).toBe("unchanged");
    expect(result.bundle.facts).toHaveLength(1);
    expect(result.bundle.facts[0]?.value).toBe("person@example.com");
  });

  it("replaces an existing fact by key when requested", () => {
    const existing = createProfileFact(
      {
        key: "contact.email",
        label: "Email",
        value: "person@example.com",
        category: "contact",
        sensitivity: "normal"
      },
      new Date("2026-04-26T00:00:00.000Z")
    );
    const incoming = createProfileFact(
      {
        key: "contact.email",
        label: "Primary email",
        value: "updated@example.com",
        category: "contact",
        sensitivity: "normal"
      },
      new Date("2026-04-27T00:00:00.000Z")
    );
    const bundle = createDefaultProfileBundle([existing], new Date("2026-04-26T00:00:00.000Z"));

    const result = upsertFactInBundle(bundle, incoming, {
      conflict: "replace",
      now: new Date("2026-04-28T00:00:00.000Z")
    });

    expect(result.result.action).toBe("replaced");
    expect(result.bundle.facts[0]?.id).toBe(existing.id);
    expect(result.bundle.facts[0]?.label).toBe("Primary email");
    expect(result.bundle.facts[0]?.value).toBe("updated@example.com");
  });
});
