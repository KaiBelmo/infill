import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createProfileFact, listProfileFacts, normalizeProfileKey } from "@infill/profile-vault";
import type { CloudProfile, FillProfile, ProfileCategory, ProfileFact, ProfileSyncAction, ProfileSyncConflictAction, ProfileSyncPreview, Sensitivity } from "@infill/shared";
import { ProfileFactSchema } from "@infill/shared";
import type { ExtensionState, FactDraft, LearnedFactConflict, LearnedFactUndo } from "@/shared/types";

export const LOCAL_PROFILE_STATE_KEY = "infillExtensionProfileState";
const DEFAULT_PROFILE_ID = "local-default";

export type LocalProfileRecord = FillProfile & {
  facts: ProfileFact[];
  createdAt: string;
  updatedAt: string;
};

export type StoredExtensionState = {
  activeProfileId: string;
  profiles: LocalProfileRecord[];
  pendingConflicts: LearnedFactConflict[];
  pendingProfileSync?: ProfileSyncPreview;
  recentLearnedCount: number;
  recentLearnedUndos: LearnedFactUndo[];
};

export type LearnFactResult = {
  status: "saved" | "unchanged" | "conflict";
  conflict?: LearnedFactConflict;
  undo?: LearnedFactUndo;
};

type ProfileStoreActions = {
  getExtensionState: () => ExtensionState;
  setActiveProfile: (profileId: string) => ExtensionState;
  createLocalProfile: (name: string, profileType?: string) => ExtensionState;
  deleteLocalProfile: (profileId: string) => ExtensionState;
  restoreLocalProfile: (profile: LocalProfileRecord) => ExtensionState;
  clearLocalProfileFacts: (profileId: string) => ExtensionState;
  replaceLocalProfileFacts: (profileId: string, facts: ProfileFact[]) => ExtensionState;
  saveLocalFact: (fact: FactDraft, profileId?: string) => ExtensionState;
  restoreLocalFact: (profileId: string, fact: ProfileFact) => ExtensionState;
  deleteLocalFact: (factId: string, profileId?: string) => ExtensionState;
  setPendingProfileSync: (preview?: ProfileSyncPreview) => ExtensionState;
  applyCloudProfileSync: (action: ProfileSyncAction, cloudProfiles: CloudProfile[]) => ExtensionState;
  resolveProfileSyncConflict: (conflictId: string, action: ProfileSyncConflictAction) => ExtensionState;
  resolveLearnedFactConflict: (conflictId: string, action: "replace" | "keep_existing") => ExtensionState;
  saveLearnedFact: (input: { key: string; label: string; value: string; category: ProfileCategory; sensitivity: Sensitivity }) => LearnFactResult;
  undoLearnedFact: (undo: LearnedFactUndo) => ExtensionState;
  clearRecentLearnedNotice: () => ExtensionState;
};

function createDefaultState(facts: ProfileFact[] = []): StoredExtensionState {
  const now = new Date().toISOString();
  return {
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [
      {
        id: DEFAULT_PROFILE_ID,
        name: "Personal",
        type: "personal",
        isDefault: true,
        locked: false,
        facts,
        createdAt: now,
        updatedAt: facts.reduce((latest, fact) => (fact.updatedAt > latest ? fact.updatedAt : latest), now)
      }
    ],
    pendingConflicts: [],
    pendingProfileSync: undefined,
    recentLearnedCount: 0,
    recentLearnedUndos: []
  };
}

function chromeStorageAdapter() {
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

export const useProfileStore = create<StoredExtensionState & ProfileStoreActions>()(
  persist(
    (set, get) => ({
      ...createDefaultState(),

      getExtensionState(): ExtensionState {
        return toPublicExtensionState(get());
      },

      setActiveProfile(profileId: string): ExtensionState {
        const state = get();
        const nextProfile = state.profiles.find((profile) => profile.id === profileId);
        if (!nextProfile) {
          throw new Error("That profile is no longer available.");
        }
        set({ activeProfileId: nextProfile.id });
        return toPublicExtensionState(get());
      },

      createLocalProfile(name: string, profileType = "custom"): ExtensionState {
        const trimmedName = name.trim();
        if (!trimmedName) {
          throw new Error("Enter a profile name before creating it.");
        }
        const now = new Date().toISOString();
        const profile: LocalProfileRecord = {
          id: crypto.randomUUID(),
          name: trimmedName,
          type: profileType,
          isDefault: false,
          locked: false,
          facts: [],
          createdAt: now,
          updatedAt: now
        };
        set((state) => ({
          profiles: [...state.profiles, profile],
          activeProfileId: profile.id
        }));
        return toPublicExtensionState(get());
      },

      deleteLocalProfile(profileId: string): ExtensionState {
        const state = get();
        const profile = state.profiles.find((item) => item.id === profileId);
        if (!profile) {
          throw new Error("That profile is no longer available.");
        }
        if (profile.isDefault) {
          throw new Error("The default profile stays available.");
        }
        const nextProfiles = state.profiles.filter((item) => item.id !== profileId);
        const nextConflicts = state.pendingConflicts.filter((conflict) => conflict.profileId !== profileId);
        const activeProfileId = state.activeProfileId === profileId
          ? (nextProfiles.find((p) => p.isDefault) ?? nextProfiles[0]!).id
          : state.activeProfileId;
        set({ profiles: nextProfiles, pendingConflicts: nextConflicts, activeProfileId });
        return toPublicExtensionState(get());
      },

      restoreLocalProfile(profile: LocalProfileRecord): ExtensionState {
        const state = get();
        const exists = state.profiles.some((item) => item.id === profile.id);
        set({
          profiles: exists
            ? state.profiles.map((item) => item.id === profile.id ? profile : item)
            : [...state.profiles, profile],
          activeProfileId: profile.id
        });
        return toPublicExtensionState(get());
      },

      clearLocalProfileFacts(profileId: string): ExtensionState {
        const state = get();
        const profile = state.profiles.find((item) => item.id === profileId);
        if (!profile) {
          throw new Error("That profile is no longer available.");
        }
        set({
          profiles: state.profiles.map((item) =>
            item.id === profileId
              ? { ...item, facts: [], updatedAt: new Date().toISOString() }
              : item
          ),
          pendingConflicts: state.pendingConflicts.filter((conflict) => conflict.profileId !== profileId)
        });
        return toPublicExtensionState(get());
      },

      replaceLocalProfileFacts(profileId: string, facts: ProfileFact[]): ExtensionState {
        const state = get();
        const profile = state.profiles.find((item) => item.id === profileId);
        if (!profile) {
          throw new Error("That profile is no longer available.");
        }
        set({
          profiles: state.profiles.map((item) =>
            item.id === profileId
              ? { ...item, facts, updatedAt: new Date().toISOString() }
              : item
          ),
          pendingConflicts: state.pendingConflicts.filter((conflict) => conflict.profileId !== profileId)
        });
        return toPublicExtensionState(get());
      },

      saveLocalFact(fact: FactDraft, profileId?: string): ExtensionState {
        set((state) => {
          const targetProfile = getTargetProfile(state, profileId);
          const updatedFacts = upsertProfileFact(targetProfile.facts, fact);
          const normalizedKey = normalizeProfileKey(fact.key);
          return {
            profiles: state.profiles.map((p) =>
              p.id === targetProfile.id
                ? { ...p, facts: updatedFacts, updatedAt: new Date().toISOString() }
                : p
            ),
            pendingConflicts: state.pendingConflicts.filter(
              (conflict) => !(conflict.profileId === targetProfile.id && conflict.existingFact.key === normalizedKey)
            )
          };
        });
        return toPublicExtensionState(get());
      },

      restoreLocalFact(profileId: string, fact: ProfileFact): ExtensionState {
        set((state) => {
          const targetProfile = getTargetProfile(state, profileId);
          const facts = targetProfile.facts.some((item) => item.id === fact.id)
            ? targetProfile.facts.map((item) => item.id === fact.id ? fact : item)
            : [...targetProfile.facts, fact];
          return {
            profiles: state.profiles.map((profile) =>
              profile.id === targetProfile.id
                ? { ...profile, facts, updatedAt: new Date().toISOString() }
                : profile
            )
          };
        });
        return toPublicExtensionState(get());
      },

      deleteLocalFact(factId: string, profileId?: string): ExtensionState {
        set((state) => {
          const targetProfile = getTargetProfile(state, profileId);
          const factToDelete = targetProfile.facts.find((fact) => fact.id === factId);
          if (!factToDelete) {
            throw new Error("That fact is no longer available.");
          }
          return {
            profiles: state.profiles.map((p) =>
              p.id === targetProfile.id
                ? { ...p, facts: p.facts.filter((fact) => fact.id !== factId), updatedAt: new Date().toISOString() }
                : p
            ),
            pendingConflicts: state.pendingConflicts.filter(
              (conflict) => !(conflict.profileId === targetProfile.id && conflict.existingFact.id === factId)
            )
          };
        });
        return toPublicExtensionState(get());
      },

      setPendingProfileSync(preview?: ProfileSyncPreview): ExtensionState {
        set({ pendingProfileSync: preview });
        return toPublicExtensionState(get());
      },

      applyCloudProfileSync(action: ProfileSyncAction, cloudProfiles: CloudProfile[]): ExtensionState {
        set((state) => {
          console.log("[profile-sync] user selected action", { action, cloudProfileCount: cloudProfiles.length });
          if (action === "keep_local") {
            return { pendingProfileSync: undefined };
          }

          if (action === "import_cloud") {
            const imported = cloudProfiles.map((profile) => cloudToLocalProfile(profile, state.profiles));
            console.log("[profile-sync] cloud profiles imported locally", { count: imported.length });
            return {
              profiles: [...state.profiles, ...imported],
              pendingProfileSync: undefined
            };
          }

          const { profiles, conflicts } = mergeCloudProfilesIntoLocal(state.profiles, cloudProfiles);
          console.log("[profile-sync] conflicts created", { count: conflicts.length });
          return {
            profiles,
            pendingProfileSync: state.pendingProfileSync
              ? {
                  ...state.pendingProfileSync,
                  conflicts,
                  conflictCount: conflicts.length
                }
              : undefined
          };
        });
        return toPublicExtensionState(get());
      },

      resolveProfileSyncConflict(conflictId: string, action: ProfileSyncConflictAction): ExtensionState {
        set((state) => {
          const pending = state.pendingProfileSync;
          const conflict = pending?.conflicts.find((item) => item.id === conflictId);
          if (!pending || !conflict) {
            throw new Error("That sync conflict has already been resolved.");
          }

          const now = new Date().toISOString();
          const profiles = state.profiles.map((profile) => {
            if (profile.id !== conflict.profileId) return profile;
            if (action === "keep_local") return profile;
            const fact = action === "use_cloud"
              ? { ...conflict.cloudFact, id: conflict.localFact.id, updatedAt: now }
              : { ...conflict.cloudFact, id: crypto.randomUUID(), key: nextKeepBothKey(profile.facts, conflict.cloudFact.key), createdAt: now, updatedAt: now };
            return {
              ...profile,
              facts: action === "use_cloud"
                ? profile.facts.map((item) => item.id === conflict.localFact.id ? fact : item)
                : [...profile.facts, fact],
              updatedAt: now
            };
          });

          const conflicts = pending.conflicts.filter((item) => item.id !== conflictId);
          console.log("[profile-sync] conflict resolved", { conflictId, action, remaining: conflicts.length });
          return {
            profiles,
            pendingProfileSync: conflicts.length > 0
              ? { ...pending, conflicts, conflictCount: conflicts.length }
              : undefined
          };
        });
        return toPublicExtensionState(get());
      },

      resolveLearnedFactConflict(conflictId: string, action: "replace" | "keep_existing"): ExtensionState {
        set((state) => {
          const conflict = state.pendingConflicts.find((item) => item.id === conflictId);
          if (!conflict) {
            throw new Error("That learned update has already been resolved.");
          }
          const nextProfiles = action === "replace"
            ? state.profiles.map((p) => {
                if (p.id !== conflict.profileId) return p;
                return {
                  ...p,
                  facts: upsertProfileFact(p.facts, {
                    ...conflict.proposedFact,
                    id: conflict.existingFact.id,
                    source: "previous_answer",
                    verified: false,
                    confidence: 0.7
                  }),
                  updatedAt: new Date().toISOString()
                };
              })
            : state.profiles;
          return {
            profiles: nextProfiles,
            pendingConflicts: state.pendingConflicts.filter((item) => item.id !== conflictId)
          };
        });
        return toPublicExtensionState(get());
      },

      saveLearnedFact(input: { key: string; label: string; value: string; category: ProfileCategory; sensitivity: Sensitivity }): LearnFactResult {
        const state = get();
        const activeProfile = getTargetProfile(state);
        const normalizedKey = normalizeProfileKey(input.key);
        const existingFact = activeProfile.facts.find((fact) => fact.key === normalizedKey);
        console.log("[profile-store] saveLearnedFact", {
          activeProfileId: activeProfile.id,
          activeProfileName: activeProfile.name,
          inputKey: input.key,
          normalizedKey,
          valuePreview: input.value.slice(0, 30),
          existing: Boolean(existingFact),
          factCountBefore: activeProfile.facts.length
        });

        if (!existingFact) {
          let savedFactId = "";
          set((state) => {
            const nextFacts = upsertProfileFact(activeProfile.facts, {
              ...input,
              source: "previous_answer",
              verified: false,
              confidence: 0.7
            });
            savedFactId = nextFacts.find((fact) => fact.key === normalizedKey)?.id ?? "";
            console.log("[profile-store] saved learned fact", {
              profileId: activeProfile.id,
              normalizedKey,
              savedFactId,
              factCountAfter: nextFacts.length
            });
            const undo = savedFactId ? { type: "saved_fact" as const, profileId: activeProfile.id, factId: savedFactId } : undefined;
            return {
            profiles: state.profiles.map((p) =>
              p.id === activeProfile.id
                ? {
                    ...p,
                    facts: nextFacts,
                    updatedAt: new Date().toISOString()
                  }
                : p
            ),
            recentLearnedCount: state.recentLearnedCount + 1,
            recentLearnedUndos: undo ? [undo, ...state.recentLearnedUndos].slice(0, 5) : state.recentLearnedUndos
          };
          });
          return {
            status: "saved",
            undo: savedFactId ? { type: "saved_fact", profileId: activeProfile.id, factId: savedFactId } : undefined
          };
        }

        if (String(existingFact.value).trim() === input.value.trim()) {
          const undo = findRecentUndoForFact(get().recentLearnedUndos, activeProfile.id, existingFact);
          console.log("[profile-store] learned fact unchanged", {
            profileId: activeProfile.id,
            normalizedKey,
            factId: existingFact.id,
            hasUndo: Boolean(undo)
          });
          return { status: "unchanged", undo };
        }

        if (shouldReplaceInvalidContactFact(existingFact, input)) {
          const undo = { type: "replaced_fact" as const, profileId: activeProfile.id, previousFact: existingFact };
          set((state) => ({
            profiles: state.profiles.map((p) =>
              p.id === activeProfile.id
                ? {
                    ...p,
                    facts: upsertProfileFact(p.facts, {
                      ...input,
                      id: existingFact.id,
                      source: "previous_answer",
                      verified: false,
                      confidence: 0.8
                    }),
                    updatedAt: new Date().toISOString()
                  }
                : p
            ),
            pendingConflicts: state.pendingConflicts.filter(
              (conflict) => !(conflict.profileId === activeProfile.id && conflict.existingFact.key === existingFact.key)
            ),
            recentLearnedCount: state.recentLearnedCount + 1,
            recentLearnedUndos: [undo, ...state.recentLearnedUndos].slice(0, 5)
          }));
          console.log("[profile-store] replaced invalid contact fact from learned value", {
            profileId: activeProfile.id,
            normalizedKey,
            factId: existingFact.id
          });
          return {
            status: "saved",
            undo
          };
        }

        const conflict: LearnedFactConflict = {
          id: crypto.randomUUID(),
          profileId: activeProfile.id,
          profileName: activeProfile.name,
          existingFact,
          proposedFact: {
            ...input,
            source: "previous_answer",
            verified: false,
            confidence: 0.7
          },
          createdAt: new Date().toISOString()
        };
        set((state) => ({
          pendingConflicts: [
            ...state.pendingConflicts.filter(
              (item) => !(item.profileId === activeProfile.id && item.existingFact.key === existingFact.key)
            ),
            conflict
          ]
        }));
        console.log("[profile-store] learned fact conflict", {
          profileId: activeProfile.id,
          normalizedKey,
          conflictId: conflict.id,
          existingFactId: existingFact.id
        });
        return {
          status: "conflict",
          conflict,
          undo: { type: "conflict", profileId: activeProfile.id, conflictId: conflict.id }
        };
      },

      undoLearnedFact(undo: LearnedFactUndo): ExtensionState {
        set((state) => {
          if (undo.type === "conflict") {
            return {
              pendingConflicts: state.pendingConflicts.filter((conflict) => conflict.id !== undo.conflictId),
              recentLearnedUndos: state.recentLearnedUndos.filter((item) => !undosMatch(item, undo))
            };
          }

          if (undo.type === "replaced_fact") {
            return {
              profiles: state.profiles.map((profile) =>
                profile.id === undo.profileId
                  ? {
                      ...profile,
                      facts: profile.facts.map((fact) => fact.id === undo.previousFact.id ? undo.previousFact : fact),
                      updatedAt: new Date().toISOString()
                    }
                  : profile
              ),
              recentLearnedCount: Math.max(0, state.recentLearnedCount - 1),
              recentLearnedUndos: state.recentLearnedUndos.filter((item) => !undosMatch(item, undo))
            };
          }

          return {
            profiles: state.profiles.map((profile) =>
              profile.id === undo.profileId
                ? {
                    ...profile,
                    facts: profile.facts.filter((fact) => fact.id !== undo.factId),
                    updatedAt: new Date().toISOString()
                  }
                : profile
            ),
            recentLearnedCount: Math.max(0, state.recentLearnedCount - 1),
            recentLearnedUndos: state.recentLearnedUndos.filter((item) => !undosMatch(item, undo))
          };
        });
        return toPublicExtensionState(get());
      },

      clearRecentLearnedNotice(): ExtensionState {
        set({ recentLearnedCount: 0, recentLearnedUndos: [] });
        return toPublicExtensionState(get());
      }
    }),
    {
      name: LOCAL_PROFILE_STATE_KEY,
      storage: createJSONStorage(() => chromeStorageAdapter()),
      onRehydrateStorage: () => {
        return async (state, error) => {
          if (error) return;
          if (state) {
            const cleaned = sanitizeStoredProfileState(state);
            if (cleaned.changed) {
              useProfileStore.setState(cleaned.state);
            }
            return;
          }
          // No persisted state found — try legacy migration
          const legacyFacts = await listProfileFacts().catch(() => []);
          const migrated = createDefaultState(legacyFacts.map((fact) => ProfileFactSchema.parse(fact)));
          useProfileStore.setState(migrated);
        };
      },
      version: 1,
      migrate: (persistedState, version) => {
        if (version === 0) {
          return createDefaultState();
        }
        return sanitizeStoredProfileState(persistedState as StoredExtensionState).state;
      }
    }
  )
);

// Cross-context sync: when another extension context (service worker, popup, options)
// writes to chrome.storage.local, Zustand's persist middleware only updates the writer's
// in-memory state. Other contexts need to listen for storage changes and rehydrate.
// Debounced: rapid sequential writes (e.g. saveApprovedFacts loop) fire multiple events
// that cause React re-render cascades and freeze extension pages. Coalesce into one update.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  let latestIncoming: StoredExtensionState | undefined;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !(LOCAL_PROFILE_STATE_KEY in changes)) return;
    const newValue = changes[LOCAL_PROFILE_STATE_KEY]?.newValue;
    if (newValue == null) return;
    const incomingState = unwrapPersistedProfileState(newValue);
    if (!incomingState) return;

    latestIncoming = incomingState;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (!latestIncoming) return;
      const { activeProfileId, profiles, pendingConflicts, pendingProfileSync, recentLearnedCount, recentLearnedUndos } = useProfileStore.getState();
      const current = JSON.stringify({ activeProfileId, profiles, pendingConflicts, pendingProfileSync, recentLearnedCount, recentLearnedUndos });
      const incoming = JSON.stringify(latestIncoming);
      if (current !== incoming) {
        useProfileStore.setState(latestIncoming);
      }
      latestIncoming = undefined;
    }, 50);
  });
}

// --- Helper functions ---

import { useSyncEncryptionStore } from "./sync-encryption-store";

export function toPublicExtensionState(state: StoredExtensionState): ExtensionState {
  const activeProfile = getTargetProfile(state);
  return {
    activeProfileId: activeProfile.id,
    profiles: state.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      type: profile.type,
      isDefault: profile.isDefault,
      locked: profile.locked,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      factCount: profile.facts.length
    })),
    facts: activeProfile.facts,
    pendingConflicts: state.pendingConflicts,
    pendingProfileSync: state.pendingProfileSync,
    recentLearnedCount: state.recentLearnedCount,
    recentLearnedUndos: state.recentLearnedUndos,
    syncEncryption: useSyncEncryptionStore.getState().getEncryptionState()
  };
}

export async function persistProfileStoreNow(): Promise<void> {
  const state = useProfileStore.getState();
  const persistedState: StoredExtensionState = {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles,
    pendingConflicts: state.pendingConflicts,
    pendingProfileSync: state.pendingProfileSync,
    recentLearnedCount: state.recentLearnedCount,
    recentLearnedUndos: state.recentLearnedUndos
  };

  await chrome.storage.local.set({
    [LOCAL_PROFILE_STATE_KEY]: {
      state: persistedState,
      version: 1
    }
  });
}

export function getTargetProfile(state: StoredExtensionState, requestedProfileId?: string): LocalProfileRecord {
  const profileId = requestedProfileId ?? state.activeProfileId;
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new Error("The selected profile is no longer available.");
  }

  return profile;
}

function upsertProfileFact(existingFacts: ProfileFact[], draft: FactDraft): ProfileFact[] {
  const now = new Date().toISOString();
  const normalizedKey = normalizeProfileKey(draft.key);
  const existingFact = existingFacts.find((fact) => fact.id === draft.id) ?? existingFacts.find((fact) => fact.key === normalizedKey);
  if (!existingFact) {
    return [
      ...existingFacts,
      createProfileFact({
        key: normalizedKey,
        label: draft.label,
        value: sanitizeFactStringValue(draft.value),
        category: draft.category,
        sensitivity: draft.sensitivity,
        source: draft.source,
        verified: draft.verified,
        confidence: draft.confidence
      })
    ];
  }

  const updatedFact: ProfileFact = {
    ...existingFact,
    key: normalizedKey,
    label: draft.label.trim(),
    value: sanitizeFactStringValue(draft.value),
    category: draft.category,
    sensitivity: draft.sensitivity,
    source: draft.source ?? existingFact.source,
    verified: draft.verified ?? existingFact.verified,
    confidence: draft.confidence ?? existingFact.confidence,
    updatedAt: now
  };

  return existingFacts.map((fact) => (fact.id === existingFact.id ? updatedFact : fact));
}

function cloudToLocalProfile(profile: CloudProfile, existingProfiles: LocalProfileRecord[]): LocalProfileRecord {
  const now = new Date().toISOString();
  const idExists = existingProfiles.some((item) => item.id === profile.id);
  return {
    id: idExists ? crypto.randomUUID() : profile.id,
    name: idExists ? `${profile.name} (cloud)` : profile.name,
    type: profile.type,
    isDefault: false,
    locked: profile.locked,
    facts: profile.facts,
    createdAt: profile.createdAt || now,
    updatedAt: profile.updatedAt || now
  };
}

function mergeCloudProfilesIntoLocal(
  localProfiles: LocalProfileRecord[],
  cloudProfiles: CloudProfile[]
): { profiles: LocalProfileRecord[]; conflicts: NonNullable<ProfileSyncPreview["conflicts"]> } {
  const now = new Date().toISOString();
  const conflicts: NonNullable<ProfileSyncPreview["conflicts"]> = [];
  let profiles = [...localProfiles];

  for (const cloudProfile of cloudProfiles) {
    const matched = findMatchingProfile(profiles, cloudProfile);
    if (!matched) {
      profiles = [...profiles, cloudToLocalProfile(cloudProfile, profiles)];
      continue;
    }

    const nextFacts = [...matched.facts];
    for (const cloudFact of cloudProfile.facts) {
      const localFact = nextFacts.find((fact) => fact.key === cloudFact.key);
      if (!localFact) {
        nextFacts.push(cloudFact);
        continue;
      }

      if (String(localFact.value).trim() !== String(cloudFact.value).trim()) {
        conflicts.push({
          id: crypto.randomUUID(),
          profileId: matched.id,
          profileName: matched.name,
          factKey: localFact.key,
          factLabel: localFact.label || cloudFact.label,
          localFact,
          cloudFact,
          createdAt: now
        });
      }
    }

    profiles = profiles.map((profile) =>
      profile.id === matched.id
        ? { ...profile, facts: nextFacts, updatedAt: nextFacts.length === matched.facts.length ? profile.updatedAt : now }
        : profile
    );
  }

  return { profiles, conflicts };
}

function findMatchingProfile(localProfiles: LocalProfileRecord[], cloudProfile: CloudProfile): LocalProfileRecord | undefined {
  return localProfiles.find((profile) => profile.id === cloudProfile.id)
    ?? localProfiles.find((profile) =>
      profile.name.trim().toLowerCase() === cloudProfile.name.trim().toLowerCase() &&
      profile.type === cloudProfile.type
    );
}

function nextKeepBothKey(facts: ProfileFact[], baseKey: string): string {
  let index = 2;
  let key = `${baseKey}.cloud`;
  const keys = new Set(facts.map((fact) => fact.key));
  while (keys.has(key)) {
    key = `${baseKey}.cloud_${index}`;
    index += 1;
  }
  return key;
}

function unwrapPersistedProfileState(value: unknown): StoredExtensionState | undefined {
  const candidate = isRecord(value) && "state" in value ? value.state : value;

  if (!isRecord(candidate)) {
    return undefined;
  }

  if (
    typeof candidate.activeProfileId !== "string" ||
    !Array.isArray(candidate.profiles) ||
    !Array.isArray(candidate.pendingConflicts)
  ) {
    return undefined;
  }

  return {
    activeProfileId: candidate.activeProfileId,
    profiles: candidate.profiles as LocalProfileRecord[],
    pendingConflicts: candidate.pendingConflicts as LearnedFactConflict[],
    pendingProfileSync: isRecord(candidate.pendingProfileSync) ? candidate.pendingProfileSync as ProfileSyncPreview : undefined,
    recentLearnedCount: typeof candidate.recentLearnedCount === "number" ? candidate.recentLearnedCount : 0,
    recentLearnedUndos: Array.isArray(candidate.recentLearnedUndos) ? candidate.recentLearnedUndos as LearnedFactUndo[] : []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeStoredProfileState(state: StoredExtensionState): { state: StoredExtensionState; changed: boolean } {
  let changed = false;
  if (typeof state.recentLearnedCount !== "number") {
    changed = true;
  }
  if (!Array.isArray(state.recentLearnedUndos)) {
    changed = true;
  }
  const now = new Date().toISOString();
  const profiles = state.profiles.map((profile) => {
    const facts = profile.facts.map((fact) => {
      const sanitizedValue = typeof fact.value === "string" ? sanitizeFactStringValue(fact.value) : fact.value;
      const shouldRekeyInvalidContactFact = isInvalidContactFact(fact) && !isContactLabel(fact.label);
      const nextKey = shouldRekeyInvalidContactFact ? customKeyForLabel(fact.label) : fact.key;
      const nextCategory = shouldRekeyInvalidContactFact ? "custom" : fact.category;
      if (sanitizedValue === fact.value && nextKey === fact.key && nextCategory === fact.category) {
        return fact;
      }

      changed = true;
      return {
        ...fact,
        key: nextKey,
        value: sanitizedValue,
        category: nextCategory,
        updatedAt: now
      };
    });

    return facts.some((fact, index) => fact !== profile.facts[index])
      ? { ...profile, facts, updatedAt: now }
      : profile;
  });

  return {
    state: {
      ...(changed ? { ...state, profiles } : state),
      recentLearnedCount: typeof state.recentLearnedCount === "number" ? state.recentLearnedCount : 0,
      recentLearnedUndos: Array.isArray(state.recentLearnedUndos) ? state.recentLearnedUndos : []
    },
    changed
  };
}

function sanitizeFactStringValue(value: string): string {
  return value.replace(/(?:\s*\[[^\]\r\n]{1,80}\]\s*)+$/g, "").trim();
}

function undosMatch(left: LearnedFactUndo, right: LearnedFactUndo): boolean {
  if (left.type !== right.type || left.profileId !== right.profileId) {
    return false;
  }

  if (left.type === "saved_fact" && right.type === "saved_fact") {
    return left.factId === right.factId;
  }

  if (left.type === "replaced_fact" && right.type === "replaced_fact") {
    return left.previousFact.id === right.previousFact.id;
  }

  if (left.type === "conflict" && right.type === "conflict") {
    return left.conflictId === right.conflictId;
  }

  return false;
}

function findRecentUndoForFact(
  undos: LearnedFactUndo[],
  profileId: string,
  fact: ProfileFact
): LearnedFactUndo | undefined {
  return undos.find((undo) => {
    if (undo.profileId !== profileId) {
      return false;
    }

    if (undo.type === "saved_fact") {
      return undo.factId === fact.id;
    }

    if (undo.type === "replaced_fact") {
      return undo.previousFact.id === fact.id;
    }

    return false;
  });
}

function isInvalidContactFact(fact: ProfileFact): boolean {
  if (typeof fact.value !== "string") {
    return false;
  }

  const value = sanitizeFactStringValue(fact.value);
  if (fact.key === "contact.email") {
    return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  if (fact.key === "contact.phone") {
    const digits = value.replace(/\D/g, "");
    return digits.length < 7 || digits.length > 15;
  }

  return false;
}

function shouldReplaceInvalidContactFact(
  existingFact: ProfileFact,
  input: { key: string; value: string }
): boolean {
  if (!isInvalidContactFact(existingFact)) {
    return false;
  }

  const proposedFact = {
    ...existingFact,
    key: normalizeProfileKey(input.key),
    value: sanitizeFactStringValue(input.value)
  };

  return !isInvalidContactFact(proposedFact);
}

function isContactLabel(label: string): boolean {
  return /\be-?mail\b/i.test(label) || /\b(phone|telephone|tel)\b|\bmobile\s+(phone|number|tel)\b/i.test(label);
}

function customKeyForLabel(label: string): string {
  return `custom.${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}
