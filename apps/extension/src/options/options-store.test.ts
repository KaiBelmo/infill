import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileFact } from "@infill/shared";

const now = "2026-05-26T00:00:00.000Z";

const syncEncryptedProfilesIfUnlocked = vi.fn();
const unlockEncryptedSync = vi.fn();
const enableEncryptedSync = vi.fn();
const runCloudParseProfile = vi.fn();
const deleteLocalFact = vi.fn();
const restoreLocalFact = vi.fn();
const getEncryptionState = vi.fn();

let profileState: {
  activeProfileId: string;
  profiles: Array<{
    id: string;
    name: string;
    type: string;
    isDefault: boolean;
    locked: boolean;
    facts: ProfileFact[];
    createdAt: string;
    updatedAt: string;
  }>;
};

vi.mock("@/cloudClient", () => ({
  runCloudParseProfile,
  applyProfileSyncDecision: vi.fn(),
  prepareProfileSync: vi.fn(),
  resolveProfileSyncConflict: vi.fn(),
  syncEncryptedProfilesIfUnlocked,
  unlockEncryptedSync,
  enableEncryptedSync
}));

vi.mock("@/background/sync-encryption-store", () => ({
  useSyncEncryptionStore: {
    getState: () => ({
      getEncryptionState
    })
  }
}));

vi.mock("@/shared/stores/cloud-client-store", () => ({
  useCloudClientStore: {
    getState: () => ({
      cloudState: {
        auth: {
          sessionToken: "session-token",
          account: {
            subscription: {
              plan: "pro",
              status: "active"
            }
          }
        }
      }
    })
  }
}));

vi.mock("@/background/profile-store", () => ({
  toPublicExtensionState: vi.fn(() => ({ profiles: [], facts: [] })),
  useProfileStore: {
    getState: () => ({
      ...profileState,
      deleteLocalFact,
      restoreLocalFact
    })
  }
}));

describe("options profile fact removal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    syncEncryptedProfilesIfUnlocked.mockResolvedValue(true);
    runCloudParseProfile.mockReset();
    unlockEncryptedSync.mockResolvedValue(undefined);
    enableEncryptedSync.mockResolvedValue(undefined);
    getEncryptionState.mockReturnValue({ enabled: true, unlocked: false });
    profileState = {
      activeProfileId: "profile-1",
      profiles: [{
        id: "profile-1",
        name: "Personal",
        type: "personal",
        isDefault: true,
        locked: false,
        facts: [fact("fact-1", "Identity display name", "Kai")],
        createdAt: now,
        updatedAt: now
      }]
    };
    deleteLocalFact.mockImplementation((factId: string, profileId: string) => {
      profileState = {
        ...profileState,
        profiles: profileState.profiles.map((profile) =>
          profile.id === profileId
            ? { ...profile, facts: profile.facts.filter((item) => item.id !== factId) }
            : profile
        )
      };
    });
    restoreLocalFact.mockImplementation((profileId: string, factToRestore: ProfileFact) => {
      profileState = {
        ...profileState,
        profiles: profileState.profiles.map((profile) =>
          profile.id === profileId
            ? { ...profile, facts: [...profile.facts, factToRestore] }
            : profile
        )
      };
    });
  });

  it("syncs encrypted profiles after the undo window expires", async () => {
    const { useOptionsStore } = await import("./options-store");

    await useOptionsStore.getState().removeFact("fact-1");

    expect(deleteLocalFact).toHaveBeenCalledWith("fact-1", "profile-1");
    expect(syncEncryptedProfilesIfUnlocked).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);

    expect(syncEncryptedProfilesIfUnlocked).toHaveBeenCalledTimes(1);
  });

  it("shows a non-error sync reminder and marks cloud sync pending when private sync is locked", async () => {
    syncEncryptedProfilesIfUnlocked.mockResolvedValue(false);
    const { useOptionsStore } = await import("./options-store");

    await useOptionsStore.getState().removeFact("fact-1");
    await vi.advanceTimersByTimeAsync(4000);

    expect(useOptionsStore.getState().status).toBe("Removed locally. Enter your private sync passphrase to update cloud facts.");
    expect(useOptionsStore.getState().pendingEncryptedProfileSync).toBe(true);
    expect(useOptionsStore.getState().toast).toMatchObject({
      message: "Removed locally. Enter your private sync passphrase to update cloud facts.",
      tone: "default"
    });
  });

  it("does not ask new accounts for private sync when it was never enabled", async () => {
    syncEncryptedProfilesIfUnlocked.mockResolvedValue(false);
    getEncryptionState.mockReturnValue({ enabled: false, unlocked: false });
    const { useOptionsStore } = await import("./options-store");

    await useOptionsStore.getState().removeFact("fact-1");
    await vi.advanceTimersByTimeAsync(4000);

    expect(useOptionsStore.getState().status).toBe("Removed Identity display name.");
    expect(useOptionsStore.getState().pendingEncryptedProfileSync).toBe(false);
    expect(useOptionsStore.getState().toast).toBeUndefined();
  });

  it("uploads pending local changes after private sync is unlocked", async () => {
    syncEncryptedProfilesIfUnlocked.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { useOptionsStore } = await import("./options-store");

    await useOptionsStore.getState().removeFact("fact-1");
    await vi.advanceTimersByTimeAsync(4000);
    await useOptionsStore.getState().unlockEncryptedSync("sync-passphrase");

    expect(unlockEncryptedSync).toHaveBeenCalledWith("sync-passphrase");
    expect(syncEncryptedProfilesIfUnlocked).toHaveBeenCalledTimes(2);
    expect(useOptionsStore.getState().pendingEncryptedProfileSync).toBe(false);
    expect(useOptionsStore.getState().status).toBe("Private sync unlocked. Cloud facts updated.");
  });

  it("does not sync when the fact removal is undone", async () => {
    const { useOptionsStore } = await import("./options-store");

    await useOptionsStore.getState().removeFact("fact-1");
    await useOptionsStore.getState().undoClearFacts();
    await vi.advanceTimersByTimeAsync(4000);

    expect(restoreLocalFact).toHaveBeenCalledWith("profile-1", expect.objectContaining({ id: "fact-1" }));
    expect(syncEncryptedProfilesIfUnlocked).not.toHaveBeenCalled();
  });
});

describe("options memory review confidence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    profileState = {
      activeProfileId: "profile-1",
      profiles: [profile("profile-1", [])]
    };
    runCloudParseProfile.mockReset();
  });

  it("keeps low and missing confidence facts unchecked during review", async () => {
    const { useOptionsStore } = await import("./options-store");

    useOptionsStore.getState().setMemoryText([
      "Full name: Kai Belmo [fact] [confidence: high]",
      "Work style: Direct and iterative [inference] [confidence: medium]",
      "Speculation blind spot: Overbuilding workflows [speculation] [confidence: low]",
      "Unknown linkedin exact URL: What exact LinkedIn profile URL should be saved? [unknown] [confidence: missing]"
    ].join("\n"));
    useOptionsStore.getState().reviewMemory();

    expect(useOptionsStore.getState().detectedFacts.map((fact) => ({
      label: fact.label,
      value: fact.value,
      confidence: fact.confidence,
      approved: fact.approved
    }))).toEqual([
      { label: "Full name", value: "Kai Belmo", confidence: "high", approved: true },
      { label: "Work style", value: "Direct and iterative", confidence: "medium", approved: true },
      { label: "Speculation blind spot", value: "Overbuilding workflows", confidence: "low", approved: false },
      { label: "Unknown linkedin exact URL", value: null, confidence: "missing", approved: false }
    ]);
  });

  it("surfaces cloud parser fallback warnings and keeps locally parsed facts reviewable", async () => {
    runCloudParseProfile.mockResolvedValue({
      fields: [],
      source: "local_fallback",
      warnings: ["Cloud assist is unavailable. Profile parsing requires an LLM."],
      credits: {
        monthlyLimit: 100,
        usedThisPeriod: 0,
        remaining: 100,
        resetAt: null
      }
    });

    const { useOptionsStore } = await import("./options-store");

    useOptionsStore.getState().setMemoryText("Full name: Kai Belmo [fact] [confidence: high]");
    await useOptionsStore.getState().reviewMemoryWithLlm();

    expect(useOptionsStore.getState().status).toBe(
      "Cloud AI could not parse profile fields: Cloud assist is unavailable. Profile parsing requires an LLM. 1 facts found by local review."
    );
    expect(useOptionsStore.getState().detectedFacts).toMatchObject([
      {
        label: "Full name",
        value: "Kai Belmo",
        approved: true
      }
    ]);
  });
});

describe("getInitialView", () => {
  beforeEach(() => {
    vi.stubGlobal("window", undefined);
  });

  it("returns 'memory' when window is undefined", async () => {
    const { getInitialView } = await import("./options-store");
    expect(getInitialView()).toBe("memory");
  });

  it("returns appropriate views based on window.location.hash", async () => {
    const { getInitialView } = await import("./options-store");

    vi.stubGlobal("window", { location: { hash: "#/profile" } });
    expect(getInitialView()).toBe("profile");

    vi.stubGlobal("window", { location: { hash: "#profile" } });
    expect(getInitialView()).toBe("profile");

    vi.stubGlobal("window", { location: { hash: "#/facts" } });
    expect(getInitialView()).toBe("facts");

    vi.stubGlobal("window", { location: { hash: "#facts" } });
    expect(getInitialView()).toBe("facts");

    vi.stubGlobal("window", { location: { hash: "#/sync" } });
    expect(getInitialView()).toBe("sync");

    vi.stubGlobal("window", { location: { hash: "#sync" } });
    expect(getInitialView()).toBe("sync");

    vi.stubGlobal("window", { location: { hash: "#/memory" } });
    expect(getInitialView()).toBe("memory");

    vi.stubGlobal("window", { location: { hash: "" } });
    expect(getInitialView()).toBe("memory");
  });
});

function fact(id: string, label: string, value: string): ProfileFact {
  return {
    id,
    key: "custom.identity_display_name",
    label,
    value,
    category: "identity",
    sensitivity: "normal",
    source: "manual",
    verified: true,
    confidence: 1,
    sourceRefs: [],
    createdAt: now,
    updatedAt: now
  };
}

function profile(id: string, facts: ProfileFact[]) {
  return {
    id,
    name: "Personal",
    type: "personal",
    isDefault: true,
    locked: false,
    facts,
    createdAt: now,
    updatedAt: now
  };
}
