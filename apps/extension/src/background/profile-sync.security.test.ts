import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudProfile, ProfileFact } from "@infill/shared";
import type { LocalProfileRecord } from "./profile-store";

const now = "2026-05-18T00:00:00.000Z";

describe("encrypted profile sync", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses remote envelope metadata and commits only after decrypt succeeds", async () => {
    const envelope = createEnvelope();
    const cloudProfile = createCloudProfile();
    const localProfile = createLocalProfile();
    const derivedKey = {} as CryptoKey;

    const unlockSync = vi.fn().mockResolvedValue(derivedKey);
    const commitUnlockedKey = vi.fn();
    const noteRemoteProfiles = vi.fn();
    const setPendingProfileSync = vi.fn();
    const persistProfileStoreNow = vi.fn().mockResolvedValue(undefined);
    const decryptProfilePayload = vi.fn().mockResolvedValue(cloudProfile);
    const rehydrateCloudStore = vi.fn().mockResolvedValue(undefined);
    const rehydrateSessionTokenStore = vi.fn().mockResolvedValue(undefined);
    const rehydrateProfileStore = vi.fn().mockResolvedValue(undefined);
    const rehydrateSyncEncryptionStore = vi.fn().mockResolvedValue(undefined);

    vi.doMock("./cloud", () => ({
      getCloudState: () => ({ auth: { user: { id: "user_1" } } }),
      listCloudProfiles: vi.fn().mockResolvedValue([cloudProfile]),
      saveCloudProfileMetadata: vi.fn(),
      listEncryptedCloudProfiles: vi.fn().mockResolvedValue([envelope]),
      saveEncryptedCloudProfiles: vi.fn()
    }));
    vi.doMock("./profile-store", () => ({
      persistProfileStoreNow,
      useProfileStore: {
        persist: { rehydrate: rehydrateProfileStore },
        getState: () => ({
          profiles: [localProfile],
          pendingProfileSync: undefined,
          setPendingProfileSync
        })
      }
    }));
    vi.doMock("./sync-encryption-store", () => ({
      useSyncEncryptionStore: {
        persist: { rehydrate: rehydrateSyncEncryptionStore },
        getState: () => ({
          enabled: false,
          salt: undefined,
          kdfIterations: undefined,
          encryptionVersion: undefined,
          getEncryptionState: () => ({ enabled: false, unlocked: false, hasRemoteProfiles: false, remoteProfileCount: 0 }),
          unlockSync,
          commitUnlockedKey,
          noteRemoteProfiles,
          getDerivedKey: () => undefined
        })
      }
    }));
    vi.doMock("./cloud-store", () => ({
      useCloudStore: { persist: { rehydrate: rehydrateCloudStore } },
      useSessionTokenStore: { persist: { rehydrate: rehydrateSessionTokenStore } }
    }));
    vi.doMock("./profile-crypto", () => ({
      encryptProfilePayload: vi.fn(),
      decryptProfilePayload
    }));

    const { unlockEncryptedProfileSync } = await import("./profile-sync");
    const preview = await unlockEncryptedProfileSync("correct horse battery staple");

    expect(noteRemoteProfiles).toHaveBeenCalledWith({
      count: 1,
      salt: envelope.salt,
      kdfIterations: envelope.kdfIterations,
      encryptionVersion: envelope.encryptionVersion
    });
    expect(unlockSync).toHaveBeenCalledWith(
      "correct horse battery staple",
      envelope.salt,
      envelope.kdfIterations,
      envelope.encryptionVersion
    );
    expect(decryptProfilePayload).toHaveBeenCalledWith(derivedKey, envelope.iv, envelope.ciphertext);
    expect(commitUnlockedKey).toHaveBeenCalledWith(
      derivedKey,
      envelope.salt,
      envelope.kdfIterations,
      envelope.encryptionVersion
    );
    expect(persistProfileStoreNow).toHaveBeenCalled();
    expect(preview?.cloudProfileCount).toBe(1);
  });

  it("does not commit an unlocked key when decryption fails", async () => {
    const envelope = createEnvelope();
    const derivedKey = {} as CryptoKey;

    const unlockSync = vi.fn().mockResolvedValue(derivedKey);
    const commitUnlockedKey = vi.fn();
    const decryptProfilePayload = vi.fn().mockRejectedValue(
      new Error("Failed to decrypt profile payload. Incorrect passphrase or corrupted data.")
    );
    const rehydrateCloudStore = vi.fn().mockResolvedValue(undefined);
    const rehydrateSessionTokenStore = vi.fn().mockResolvedValue(undefined);
    const rehydrateProfileStore = vi.fn().mockResolvedValue(undefined);
    const rehydrateSyncEncryptionStore = vi.fn().mockResolvedValue(undefined);

    vi.doMock("./cloud", () => ({
      getCloudState: () => ({ auth: { user: { id: "user_1" } } }),
      listCloudProfiles: vi.fn().mockResolvedValue([createCloudProfile()]),
      saveCloudProfileMetadata: vi.fn(),
      listEncryptedCloudProfiles: vi.fn().mockResolvedValue([envelope]),
      saveEncryptedCloudProfiles: vi.fn()
    }));
    vi.doMock("./profile-store", () => ({
      persistProfileStoreNow: vi.fn().mockResolvedValue(undefined),
      useProfileStore: {
        persist: { rehydrate: rehydrateProfileStore },
        getState: () => ({
          profiles: [createLocalProfile()],
          pendingProfileSync: undefined,
          setPendingProfileSync: vi.fn()
        })
      }
    }));
    vi.doMock("./sync-encryption-store", () => ({
      useSyncEncryptionStore: {
        persist: { rehydrate: rehydrateSyncEncryptionStore },
        getState: () => ({
          enabled: false,
          salt: undefined,
          kdfIterations: undefined,
          encryptionVersion: undefined,
          getEncryptionState: () => ({ enabled: false, unlocked: false, hasRemoteProfiles: false, remoteProfileCount: 0 }),
          unlockSync,
          commitUnlockedKey,
          noteRemoteProfiles: vi.fn(),
          getDerivedKey: () => undefined
        })
      }
    }));
    vi.doMock("./cloud-store", () => ({
      useCloudStore: { persist: { rehydrate: rehydrateCloudStore } },
      useSessionTokenStore: { persist: { rehydrate: rehydrateSessionTokenStore } }
    }));
    vi.doMock("./profile-crypto", () => ({
      encryptProfilePayload: vi.fn(),
      decryptProfilePayload
    }));

    const { unlockEncryptedProfileSync } = await import("./profile-sync");

    await expect(unlockEncryptedProfileSync("wrong-passphrase")).rejects.toThrow(/Failed to decrypt profile payload/);
    expect(commitUnlockedKey).not.toHaveBeenCalled();
  });

  it("preserves the active KDF iteration metadata when uploading encrypted profiles", async () => {
    const localProfile = createLocalProfile();
    const derivedKey = {} as CryptoKey;
    const encryptProfilePayload = vi.fn(async (_key: CryptoKey, _payload: unknown, kdfIterations?: number) => ({
      iv: "iv",
      ciphertext: "ciphertext",
      encryptionVersion: 1 as const,
      kdfAlgorithm: "PBKDF2-SHA-256" as const,
      kdfIterations: kdfIterations ?? 310000
    }));
    const saveEncryptedCloudProfiles = vi.fn().mockResolvedValue([]);
    const saveCloudProfileMetadata = vi.fn().mockResolvedValue([]);
    const persistProfileStoreNow = vi.fn().mockResolvedValue(undefined);
    const setPendingProfileSync = vi.fn();
    const rehydrateCloudStore = vi.fn().mockResolvedValue(undefined);
    const rehydrateSessionTokenStore = vi.fn().mockResolvedValue(undefined);
    const rehydrateProfileStore = vi.fn().mockResolvedValue(undefined);
    const rehydrateSyncEncryptionStore = vi.fn().mockResolvedValue(undefined);

    const syncStoreState = {
      enabled: false,
      salt: undefined as string | undefined,
      kdfIterations: undefined as number | undefined,
      encryptionVersion: undefined as number | undefined,
      getEncryptionState: () => ({
        enabled: syncStoreState.enabled,
        salt: syncStoreState.salt,
        kdfIterations: syncStoreState.kdfIterations,
        encryptionVersion: syncStoreState.encryptionVersion,
        unlocked: true,
        hasRemoteProfiles: false,
        remoteProfileCount: 0
      }),
      enableSync: vi.fn(async () => {
        syncStoreState.enabled = true;
        syncStoreState.salt = "base64-salt";
        syncStoreState.kdfIterations = 123456;
        syncStoreState.encryptionVersion = 1;
      }),
      unlockSync: vi.fn(),
      commitUnlockedKey: vi.fn(),
      lockSync: vi.fn(),
      noteRemoteProfiles: vi.fn(),
      getDerivedKey: () => derivedKey
    };

    vi.doMock("./cloud", () => ({
      getCloudState: () => ({ auth: { user: { id: "user_1" } } }),
      listCloudProfiles: vi.fn().mockResolvedValue([]),
      saveCloudProfileMetadata,
      listEncryptedCloudProfiles: vi.fn().mockResolvedValue([]),
      saveEncryptedCloudProfiles
    }));
    vi.doMock("./profile-store", () => ({
      persistProfileStoreNow,
      useProfileStore: {
        persist: { rehydrate: rehydrateProfileStore },
        getState: () => ({
          profiles: [localProfile],
          pendingProfileSync: undefined,
          setPendingProfileSync
        })
      }
    }));
    vi.doMock("./sync-encryption-store", () => ({
      useSyncEncryptionStore: {
        persist: { rehydrate: rehydrateSyncEncryptionStore },
        getState: () => syncStoreState
      }
    }));
    vi.doMock("./cloud-store", () => ({
      useCloudStore: { persist: { rehydrate: rehydrateCloudStore } },
      useSessionTokenStore: { persist: { rehydrate: rehydrateSessionTokenStore } }
    }));
    vi.doMock("./profile-crypto", () => ({
      encryptProfilePayload,
      decryptProfilePayload: vi.fn()
    }));

    const { enableEncryptedProfileSync } = await import("./profile-sync");
    await enableEncryptedProfileSync("passphrase");

    expect(rehydrateCloudStore).toHaveBeenCalled();
    expect(rehydrateSessionTokenStore).toHaveBeenCalled();
    expect(rehydrateProfileStore).toHaveBeenCalled();
    expect(rehydrateSyncEncryptionStore).toHaveBeenCalled();
    expect(saveCloudProfileMetadata).toHaveBeenCalledWith([
      expect.objectContaining({
        id: localProfile.id,
        name: localProfile.name,
        facts: localProfile.facts
      })
    ]);
    expect(encryptProfilePayload).toHaveBeenCalledWith(derivedKey, { facts: localProfile.facts }, 123456);
    expect(saveEncryptedCloudProfiles).toHaveBeenCalledWith([
      expect.objectContaining({
        id: localProfile.id,
        salt: "base64-salt",
        kdfIterations: 123456
      })
    ]);
    expect(setPendingProfileSync).toHaveBeenCalledWith(undefined);
    expect(persistProfileStoreNow).toHaveBeenCalled();
  });
});

function createEnvelope() {
  return {
    id: "profile-cloud",
    encryptionVersion: 1 as const,
    kdfAlgorithm: "PBKDF2-SHA-256" as const,
    kdfIterations: 210000,
    salt: "remote-salt",
    iv: "remote-iv",
    ciphertext: "remote-ciphertext",
    createdAt: now,
    updatedAt: now
  };
}

function createCloudProfile(): CloudProfile {
  return {
    id: "profile-cloud",
    name: "Personal",
    type: "personal",
    isDefault: true,
    locked: false,
    facts: [fact("fact-cloud-email", "contact.email", "Email", "cloud@example.com")],
    createdAt: now,
    updatedAt: now
  };
}

function createLocalProfile(): LocalProfileRecord {
  return {
    id: "profile-local",
    name: "Personal",
    type: "personal",
    isDefault: true,
    locked: false,
    facts: [fact("fact-local-email", "contact.email", "Email", "local@example.com")],
    createdAt: now,
    updatedAt: now
  };
}

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
