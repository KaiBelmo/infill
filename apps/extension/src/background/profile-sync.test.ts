import { describe, expect, it } from "vitest";
import type { CloudProfile, ProfileFact } from "@infill/shared";
import { createProfileSyncPreview } from "./profile-sync-core";
import type { LocalProfileRecord } from "./profile-store";

const now = "2026-05-16T00:00:00.000Z";

describe("profile sync preview", () => {
  it("creates conflicts for same-key facts with different values", () => {
    const localProfiles: LocalProfileRecord[] = [{
      id: "profile-local",
      name: "Personal",
      type: "personal",
      isDefault: true,
      locked: false,
      facts: [
        fact("fact-local-email", "contact.email", "Email", "local@example.com"),
        fact("fact-local-name", "identity.name", "Name", "Local Person")
      ],
      createdAt: now,
      updatedAt: now
    }];
    const cloudProfiles: CloudProfile[] = [{
      id: "profile-cloud",
      name: "Personal",
      type: "personal",
      isDefault: true,
      locked: false,
      facts: [
        fact("fact-cloud-email", "contact.email", "Email", "cloud@example.com"),
        fact("fact-cloud-phone", "contact.phone", "Phone", "+15555550123")
      ],
      createdAt: now,
      updatedAt: now
    }];

    const preview = createProfileSyncPreview(localProfiles, cloudProfiles, "user_1");

    expect(preview.localProfileCount).toBe(1);
    expect(preview.cloudProfileCount).toBe(1);
    expect(preview.mergeableProfileCount).toBe(1);
    expect(preview.conflictCount).toBe(1);
    expect(preview.conflicts[0]).toMatchObject({
      profileName: "Personal",
      factKey: "contact.email",
      factLabel: "Email",
      localFact: { value: "local@example.com" },
      cloudFact: { value: "cloud@example.com" }
    });
  });
});

function fact(id: string, key: string, label: string, value: string): ProfileFact {
  return {
    id,
    key,
    label,
    value,
    category: key.startsWith("contact.") ? "contact" : "identity",
    sensitivity: "normal",
    source: "manual",
    verified: true,
    confidence: 1,
    sourceRefs: [],
    createdAt: now,
    updatedAt: now
  };
}
