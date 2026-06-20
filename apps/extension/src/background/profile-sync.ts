import type { CloudProfile, ProfileFact, ProfileSyncAction, ProfileSyncConflictAction, ProfileSyncPreview, EncryptedCloudProfileEnvelope } from "@infill/shared";
import { ProfileFactSchema } from "@infill/shared";
import { getCloudState, listCloudProfiles, listEncryptedCloudProfiles, saveCloudProfileMetadata, saveEncryptedCloudProfiles } from "./cloud";
import { persistProfileStoreNow, type LocalProfileRecord, useProfileStore } from "./profile-store";
import { createProfileSyncPreview } from "./profile-sync-core";
import { useSyncEncryptionStore } from "./sync-encryption-store";
import { encryptProfilePayload, decryptProfilePayload } from "./profile-crypto";
import { useCloudStore, useSessionTokenStore } from "./cloud-store";
import { beginPrivateSyncDebug, finishPrivateSyncDebug, recordPrivateSyncDebug } from "./private-sync-debug";

let lastFetchedCloudProfiles: CloudProfile[] = [];

export async function prepareProfileSyncAfterAuth(): Promise<ProfileSyncPreview | undefined> {
  await rehydrateSyncStores();
  const cloudState = getCloudState();
  if (!cloudState.auth?.user.id) return undefined;

  const existingPreview = useProfileStore.getState().pendingProfileSync;
  if (existingPreview?.accountUserId === cloudState.auth.user.id) {
    return existingPreview;
  }

  console.log("[profile-sync] auth completed", { userId: cloudState.auth.user.id });

  const [metadataProfiles, envelopes] = await Promise.all([
    listCloudProfiles(),
    listEncryptedCloudProfiles()
  ]);
  noteRemoteEnvelopeMetadata(envelopes);
  const encryptionState = useSyncEncryptionStore.getState().getEncryptionState();

  if (envelopes.length > 0 && (!encryptionState.enabled || !encryptionState.unlocked)) {
    console.log("[profile-sync] cloud has encrypted profiles, but local sync is locked/disabled");
    useProfileStore.getState().setPendingProfileSync(undefined);
    await persistProfileStoreNow();
    return undefined;
  }

  const cloudProfiles: CloudProfile[] = [];
  if (envelopes.length > 0 && encryptionState.unlocked) {
    const key = useSyncEncryptionStore.getState().getDerivedKey();
    if (!key) throw new Error("Sync encryption key is not available.");

    for (const envelope of envelopes) {
      const decrypted = await decryptProfilePayload(key, envelope.iv, envelope.ciphertext);
      cloudProfiles.push(profileFromMetadataAndEncryptedPayload(envelope, decrypted, metadataProfiles));
    }
  }

  lastFetchedCloudProfiles = cloudProfiles;
  const localProfiles = useProfileStore.getState().profiles;
  const preview = createProfileSyncPreview(localProfiles, cloudProfiles, cloudState.auth.user.id);
  useProfileStore.getState().setPendingProfileSync(preview);
  await persistProfileStoreNow();

  console.log("[profile-sync] sync preview generated", {
    localProfileCount: preview.localProfileCount,
    cloudProfileCount: preview.cloudProfileCount,
    conflictCount: preview.conflictCount
  });

  return preview;
}

export async function enableEncryptedProfileSync(passphrase: string): Promise<void> {
  console.log("[profile-sync] enable start");
  const attemptId = await beginPrivateSyncDebug({ flow: "enable-private-sync" });
  try {
    await recordPrivateSyncDebug("rehydrate-start", undefined, attemptId);
    await rehydrateSyncStores();
    await recordPrivateSyncDebug("rehydrate-complete", undefined, attemptId);
    const cloudState = getCloudState();
    const localProfiles = useProfileStore.getState().profiles;
    const stateDetails = {
      signedIn: Boolean(cloudState.auth?.sessionToken),
      userId: cloudState.auth?.user.id,
      apiBaseUrl: cloudState.config?.apiBaseUrl,
      localProfileCount: localProfiles.length,
      localFactCount: localProfiles.reduce((count, profile) => count + profile.facts.length, 0),
      profileSummaries: localProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        type: profile.type,
        isDefault: profile.isDefault,
        locked: profile.locked,
        factCount: profile.facts.length,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt
      }))
    };
    console.log("[profile-sync] enable state ready", stateDetails);
    await recordPrivateSyncDebug("state-ready", stateDetails, attemptId);

    const envelopes = await listEncryptedCloudProfiles();
    console.log("[profile-sync] enable remote envelopes checked", { encryptedEnvelopeCount: envelopes.length });
    await recordPrivateSyncDebug("remote-envelopes-checked", { encryptedEnvelopeCount: envelopes.length }, attemptId);
    noteRemoteEnvelopeMetadata(envelopes);
    if (envelopes.length > 0) {
      throw new Error("Private sync already exists for this account. Unlock with your sync passphrase before syncing this device.");
    }

    console.log("[profile-sync] enable deriving encryption key");
    await recordPrivateSyncDebug("derive-key-start", undefined, attemptId);
    await useSyncEncryptionStore.getState().enableSync(passphrase);
    await recordPrivateSyncDebug("derive-key-complete", {
      encryptionState: useSyncEncryptionStore.getState().getEncryptionState()
    }, attemptId);
    console.log("[profile-sync] enable uploading encrypted profiles");
    await saveProfilesToCloudEncrypted(useProfileStore.getState().profiles);
    useProfileStore.getState().setPendingProfileSync(undefined);
    await persistProfileStoreNow();
    console.log("[profile-sync] enable complete");
    await recordPrivateSyncDebug("attempt-complete", undefined, attemptId);
    await finishPrivateSyncDebug("success", undefined, attemptId);
  } catch (error) {
    await recordPrivateSyncDebug("attempt-error", {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined
    }, attemptId);
    await finishPrivateSyncDebug("error", error, attemptId);
    throw error;
  }
}

export async function unlockEncryptedProfileSync(passphrase: string): Promise<ProfileSyncPreview | undefined> {
  await rehydrateSyncStores();
  const cloudState = getCloudState();
  if (!cloudState.auth?.user.id) return undefined;

  const envelopes = await listEncryptedCloudProfiles();
  noteRemoteEnvelopeMetadata(envelopes);
  if (envelopes.length === 0) {
    await useSyncEncryptionStore.getState().unlockSync(passphrase);
    return prepareProfileSyncAfterAuth();
  }

  const firstEnvelope = envelopes[0]!;
  const key = await useSyncEncryptionStore.getState().unlockSync(
    passphrase,
    firstEnvelope.salt,
    firstEnvelope.kdfIterations,
    firstEnvelope.encryptionVersion
  );

  const cloudProfiles = envelopes.map((envelope) => {
    if (
      envelope.salt !== firstEnvelope.salt ||
      envelope.kdfIterations !== firstEnvelope.kdfIterations ||
      envelope.encryptionVersion !== firstEnvelope.encryptionVersion
    ) {
      throw new Error("Encrypted cloud profiles use incompatible encryption settings. Contact support before syncing.");
    }
    return envelope;
  });

  const decryptedProfiles: CloudProfile[] = [];
  const metadataProfiles = await listCloudProfiles();
  for (const envelope of cloudProfiles) {
    const decrypted = await decryptProfilePayload(key, envelope.iv, envelope.ciphertext);
    decryptedProfiles.push(profileFromMetadataAndEncryptedPayload(envelope, decrypted, metadataProfiles));
  }

  useSyncEncryptionStore.getState().commitUnlockedKey(
    key,
    firstEnvelope.salt,
    firstEnvelope.kdfIterations,
    firstEnvelope.encryptionVersion
  );

  lastFetchedCloudProfiles = decryptedProfiles;
  const preview = createProfileSyncPreview(useProfileStore.getState().profiles, decryptedProfiles, cloudState.auth.user.id);
  useProfileStore.getState().setPendingProfileSync(preview);
  await persistProfileStoreNow();
  return preview;
}

export async function applyProfileSyncDecision(action: ProfileSyncAction): Promise<ProfileSyncPreview | undefined> {
  await rehydrateSyncStores();
  const encryptionState = useSyncEncryptionStore.getState().getEncryptionState();
  if (!encryptionState.unlocked) {
    throw new Error("Unlock private sync before continuing.");
  }

  const state = useProfileStore.getState();
  state.applyCloudProfileSync(action, lastFetchedCloudProfiles);
  await persistProfileStoreNow();

  if (action !== "keep_local") {
    await saveProfilesToCloudEncrypted(useProfileStore.getState().profiles);
  }

  console.log("[profile-sync] sync persisted locally/cloud", { action });
  return useProfileStore.getState().pendingProfileSync;
}

export async function resolveProfileSyncConflict(conflictId: string, action: ProfileSyncConflictAction): Promise<ProfileSyncPreview | undefined> {
  await rehydrateSyncStores();
  useProfileStore.getState().resolveProfileSyncConflict(conflictId, action);
  await persistProfileStoreNow();
  await saveProfilesToCloudEncrypted(useProfileStore.getState().profiles);
  return useProfileStore.getState().pendingProfileSync;
}

export async function syncEncryptedProfilesIfUnlocked(): Promise<boolean> {
  await rehydrateSyncStores();

  const cloudState = getCloudState();
  const encryptionState = useSyncEncryptionStore.getState().getEncryptionState();
  if (!cloudState.auth?.sessionToken || !encryptionState.enabled || !encryptionState.unlocked) {
    console.log("[profile-sync] skipped encrypted profile upload", {
      signedIn: Boolean(cloudState.auth?.sessionToken),
      enabled: encryptionState.enabled,
      unlocked: encryptionState.unlocked
    });
    return false;
  }

  await saveProfilesToCloudEncrypted(useProfileStore.getState().profiles);
  console.log("[profile-sync] encrypted profile upload completed after local change");
  return true;
}

async function rehydrateSyncStores(): Promise<void> {
  await Promise.all([
    useCloudStore.persist.rehydrate(),
    useSessionTokenStore.persist.rehydrate(),
    useProfileStore.persist.rehydrate(),
    useSyncEncryptionStore.persist.rehydrate()
  ]);
}

async function saveProfilesToCloudEncrypted(profiles: LocalProfileRecord[]): Promise<void> {
  const syncState = useSyncEncryptionStore.getState();
  const key = syncState.getDerivedKey();
  if (!key) throw new Error("Sync encryption key is not available.");
  if (!syncState.salt || !syncState.kdfIterations) {
    throw new Error("Private sync metadata is not available on this device.");
  }

  const cloudProfiles = profiles.map(localToCloudProfile);
  console.log("[profile-sync] saving profile metadata", { profileCount: cloudProfiles.length });
  await recordPrivateSyncDebug("save-metadata-start", { profileCount: cloudProfiles.length });
  await saveCloudProfileMetadata(cloudProfiles);
  console.log("[profile-sync] profile metadata saved", { profileCount: cloudProfiles.length });
  await recordPrivateSyncDebug("save-metadata-complete", { profileCount: cloudProfiles.length });

  const envelopes: EncryptedCloudProfileEnvelope[] = [];
  for (const profile of profiles) {
    const payload = encryptedFactsPayload(profile);
    const encrypted = await encryptProfilePayload(key, payload, syncState.kdfIterations);

    envelopes.push({
      id: profile.id,
      encryptionVersion: encrypted.encryptionVersion,
      kdfAlgorithm: encrypted.kdfAlgorithm,
      kdfIterations: encrypted.kdfIterations,
      salt: syncState.salt,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    });
  }

  console.log("[profile-sync] saving encrypted envelopes", { envelopeCount: envelopes.length });
  await recordPrivateSyncDebug("save-envelopes-start", { envelopeCount: envelopes.length });
  await saveEncryptedCloudProfiles(envelopes);
  console.log("[profile-sync] encrypted envelopes saved", { envelopeCount: envelopes.length });
  await recordPrivateSyncDebug("save-envelopes-complete", { envelopeCount: envelopes.length });
}

function profileFromMetadataAndEncryptedPayload(
  envelope: EncryptedCloudProfileEnvelope,
  decrypted: unknown,
  metadataProfiles: CloudProfile[]
): CloudProfile {
  const facts = parseEncryptedFactsPayload(decrypted);
  const metadata = metadataProfiles.find((profile) => profile.id === envelope.id);
  if (!metadata) {
    throw new Error("Encrypted profile metadata is missing. Sync profile metadata before private facts.");
  }

  return {
    ...metadataForCloudProfile(metadata),
    id: envelope.id,
    facts
  };
}

function parseEncryptedFactsPayload(payload: unknown): ProfileFact[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { facts?: unknown }).facts)) {
    throw new Error("Encrypted profile payload is invalid.");
  }
  return (payload as { facts: unknown[] }).facts.map((fact) => ProfileFactSchema.parse(fact));
}

function metadataForCloudProfile(profile: CloudProfile): Omit<CloudProfile, "facts"> {
  return {
    id: profile.id,
    name: profile.name,
    type: profile.type,
    isDefault: profile.isDefault,
    locked: profile.locked,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

function encryptedFactsPayload(profile: LocalProfileRecord): { facts: ProfileFact[] } {
  return { facts: profile.facts };
}

function localToCloudProfile(profile: LocalProfileRecord): CloudProfile {
  return {
    id: profile.id,
    name: profile.name,
    type: profile.type,
    isDefault: profile.isDefault,
    locked: profile.locked,
    facts: profile.facts,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

function noteRemoteEnvelopeMetadata(envelopes: EncryptedCloudProfileEnvelope[]): void {
  const firstEnvelope = envelopes[0];
  useSyncEncryptionStore.getState().noteRemoteProfiles({
    count: envelopes.length,
    salt: firstEnvelope?.salt,
    kdfIterations: firstEnvelope?.kdfIterations,
    encryptionVersion: firstEnvelope?.encryptionVersion
  });
}
