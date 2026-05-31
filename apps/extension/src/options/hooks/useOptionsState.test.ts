import { describe, expect, it, vi } from "vitest";
import type { ProfileFact } from "@infill/shared";

const now = "2026-05-29T00:00:00.000Z";

vi.mock("@/background/profile-store", () => ({
  useProfileStore: {
    getState: () => ({
      activeProfileId: "profile-1",
      profiles: [],
      pendingConflicts: [],
      pendingProfileSync: undefined,
      recentLearnedCount: 0,
      recentLearnedUndos: []
    })
  }
}));

vi.mock("@/background/sync-encryption-store", () => ({
  useSyncEncryptionStore: {
    getState: () => ({
      enabled: false,
      salt: undefined,
      kdfIterations: undefined,
      encryptionVersion: undefined,
      hasRemoteProfiles: false,
      remoteProfileCount: 0,
      getDerivedKey: () => undefined
    })
  }
}));

vi.mock("@/shared/stores/cloud-client-store", () => ({
  normalizeCloudMessage: (message: string) => message,
  useCloudClientStore: {
    getState: () => ({
      cloudState: null,
      isSignedIn: false,
      canUseCloud: false,
      cloudPlan: "free",
      cloudMessage: "",
      devices: []
    })
  }
}));

vi.mock("../options-store", () => ({
  useOptionsStore: {
    getState: () => ({
      activeView: "memory",
      memoryText: "",
      detectedFacts: [],
      newProfileName: "",
      status: "",
      parsingWithLlm: false,
      clearedFactsUndo: undefined,
      clearedFactsUndoId: undefined,
      toast: undefined
    })
  }
}));

vi.mock("@/shared/debug-log", () => ({
  debugLog: vi.fn()
}));

describe("buildOptionsExtensionState", () => {
  it("keeps profile summaries, active facts, and sync encryption details aligned", async () => {
    const { buildOptionsExtensionState } = await import("./useOptionsState");
    const primaryFact = fact("fact-1", "profile-1", "Full name", "Kai River");
    const secondaryFact = fact("fact-2", "profile-2", "Company", "infill");

    const extensionState = buildOptionsExtensionState(
      {
        activeProfileId: "profile-2",
        profiles: [
          profile("profile-1", "Personal", [primaryFact]),
          profile("profile-2", "Work", [secondaryFact])
        ],
        pendingConflicts: [],
        pendingProfileSync: undefined,
        recentLearnedCount: 2,
        recentLearnedUndos: []
      },
      {
        enabled: true,
        salt: "salt",
        kdfIterations: 310000,
        encryptionVersion: 1,
        hasRemoteProfiles: true,
        remoteProfileCount: 3,
        unlocked: true
      }
    );

    expect(extensionState.activeProfileId).toBe("profile-2");
    expect(extensionState.profiles).toEqual([
      expect.objectContaining({ id: "profile-1", name: "Personal", factCount: 1 }),
      expect.objectContaining({ id: "profile-2", name: "Work", factCount: 1 })
    ]);
    expect(extensionState.facts).toEqual([secondaryFact]);
    expect(extensionState.recentLearnedCount).toBe(2);
    expect(extensionState.syncEncryption).toEqual({
      enabled: true,
      salt: "salt",
      kdfIterations: 310000,
      encryptionVersion: 1,
      unlocked: true,
      hasRemoteProfiles: true,
      remoteProfileCount: 3
    });
  });
});

function profile(id: string, name: string, facts: ProfileFact[]) {
  return {
    id,
    name,
    type: "custom",
    isDefault: id === "profile-1",
    locked: false,
    facts,
    createdAt: now,
    updatedAt: now
  };
}

function fact(id: string, profileId: string, label: string, value: string): ProfileFact {
  return {
    id,
    key: `custom.${profileId}_${label.toLowerCase().replace(/\s+/g, "_")}`,
    label,
    value,
    category: "custom",
    sensitivity: "normal",
    source: "manual",
    verified: true,
    confidence: 1,
    sourceRefs: [],
    createdAt: now,
    updatedAt: now
  };
}
