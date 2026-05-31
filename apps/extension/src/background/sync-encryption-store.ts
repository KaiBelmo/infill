import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SyncEncryptionState } from "@/shared/types";
import { deriveEncryptionKey, generateSalt } from "./profile-crypto";

const SYNC_ENCRYPTION_STATE_KEY = "infillSyncEncryptionState";

export type StoredSyncEncryptionState = Omit<SyncEncryptionState, "unlocked">;

type SyncEncryptionActions = {
  getEncryptionState: () => SyncEncryptionState;
  enableSync: (passphrase: string, salt?: string, kdfIterations?: number, encryptionVersion?: number) => Promise<void>;
  unlockSync: (passphrase: string, salt?: string, kdfIterations?: number, encryptionVersion?: number) => Promise<CryptoKey>;
  commitUnlockedKey: (key: CryptoKey, salt: string, kdfIterations: number, encryptionVersion: number) => void;
  lockSync: () => void;
  noteRemoteProfiles: (input: { count: number; salt?: string; kdfIterations?: number; encryptionVersion?: number }) => void;
  getDerivedKey: () => CryptoKey | undefined;
};

// In-memory only. Never persisted.
let currentDerivedKey: CryptoKey | undefined;

function chromeLocalStorageAdapter() {
  return {
    getItem: async (name: string): Promise<string | null> => {
      const result = await chrome.storage.local.get(name);
      const value = result[name];
      if (value == null) return null;
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    setItem: async (name: string, value: string): Promise<void> => {
      await chrome.storage.local.set({ [name]: JSON.parse(value) });
    },
    removeItem: async (name: string): Promise<void> => {
      await chrome.storage.local.remove(name);
    }
  };
}

export const useSyncEncryptionStore = create<StoredSyncEncryptionState & SyncEncryptionActions>()(
  persist(
    (set, get) => ({
      enabled: false,
      salt: undefined,
      kdfIterations: undefined,
      encryptionVersion: undefined,
      hasRemoteProfiles: false,
      remoteProfileCount: 0,

      getEncryptionState(): SyncEncryptionState {
        const state = get();
        return {
          enabled: state.enabled,
          salt: state.salt,
          kdfIterations: state.kdfIterations,
          encryptionVersion: state.encryptionVersion,
          unlocked: currentDerivedKey !== undefined,
          hasRemoteProfiles: state.hasRemoteProfiles,
          remoteProfileCount: state.remoteProfileCount
        };
      },

      async enableSync(passphrase: string, providedSalt?: string, providedKdfIterations?: number, providedEncryptionVersion?: number) {
        const salt = providedSalt ?? generateSalt();
        const kdfIterations = providedKdfIterations ?? 310000;
        const encryptionVersion = providedEncryptionVersion ?? 1;

        currentDerivedKey = await deriveEncryptionKey(passphrase, salt, kdfIterations);
        
        set({
          enabled: true,
          salt,
          kdfIterations,
          encryptionVersion,
          hasRemoteProfiles: true,
          remoteProfileCount: Math.max(1, get().remoteProfileCount ?? 0)
        });
      },

      async unlockSync(passphrase: string, providedSalt?: string, providedKdfIterations?: number, providedEncryptionVersion?: number): Promise<CryptoKey> {
        const state = get();
        const salt = providedSalt ?? state.salt;
        const kdfIterations = providedKdfIterations ?? state.kdfIterations;
        const encryptionVersion = providedEncryptionVersion ?? state.encryptionVersion ?? 1;
        if (!salt || !kdfIterations) {
          throw new Error("Private sync is not fully configured on this device.");
        }

        const key = await deriveEncryptionKey(passphrase, salt, kdfIterations);
        if (!providedSalt && state.enabled) {
          get().commitUnlockedKey(key, salt, kdfIterations, encryptionVersion);
        }
        return key;
      },

      commitUnlockedKey(key: CryptoKey, salt: string, kdfIterations: number, encryptionVersion: number) {
        currentDerivedKey = key;
        set({
          enabled: true,
          salt,
          kdfIterations,
          encryptionVersion
        });
      },

      lockSync() {
        currentDerivedKey = undefined;
        set({ enabled: get().enabled }); // trigger update
      },

      noteRemoteProfiles(input) {
        const state = get();
        set({
          hasRemoteProfiles: input.count > 0,
          remoteProfileCount: input.count,
          salt: state.salt ?? input.salt,
          kdfIterations: state.kdfIterations ?? input.kdfIterations,
          encryptionVersion: state.encryptionVersion ?? input.encryptionVersion
        });
      },

      getDerivedKey() {
        return currentDerivedKey;
      }
    }),
    {
      name: SYNC_ENCRYPTION_STATE_KEY,
      storage: createJSONStorage(() => chromeLocalStorageAdapter()),
      partialize: (state) => ({
        enabled: state.enabled,
        salt: state.salt,
        kdfIterations: state.kdfIterations,
        encryptionVersion: state.encryptionVersion,
        hasRemoteProfiles: state.hasRemoteProfiles,
        remoteProfileCount: state.remoteProfileCount
      }),
      version: 1
    }
  )
);

// Cross-context sync
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !(SYNC_ENCRYPTION_STATE_KEY in changes)) return;
    const newValue = changes[SYNC_ENCRYPTION_STATE_KEY]?.newValue;
    if (newValue == null) return;
    
    try {
      const incomingState = typeof newValue === "string" ? JSON.parse(newValue) : newValue;
      if (incomingState && incomingState.state) {
        useSyncEncryptionStore.setState(incomingState.state);
      }
    } catch {
      // ignore parse errors
    }
  });
}
