import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileFact } from "@infill/shared";

const now = "2026-05-26T00:00:00.000Z";

const syncEncryptedProfilesIfUnlocked = vi.fn();
const unlockEncryptedSync = vi.fn();
const enableEncryptedSync = vi.fn();
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
  runCloudParseProfile: vi.fn(),
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
    getState: () => ({ cloudState: { auth: { sessionToken: "session-token" } } })
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
