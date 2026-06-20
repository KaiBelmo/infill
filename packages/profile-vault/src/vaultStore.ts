import type { LocalProfileVault, ProfileBundle, ProfileFact } from "@infill/shared";
import { LocalProfileVaultSchema, ProfileBundleSchema, ProfileFactSchema } from "@infill/shared";
import {
  DEFAULT_PROFILE_BUNDLE_ID,
  buildProfileBundle,
  createDefaultProfileBundle,
  createLocalProfileVault,
  removeFactFromBundle,
  resolveActiveProfileBundle,
  upsertFactInBundle,
  type ProfileFactConflictPolicy,
  type UpsertProfileFactResult
} from "./vaultState";

const dbName = "infill_v1";
const dbVersion = 2;
const vaultStoreName = "profileVault";
const vaultRecordKey = "local-profile-vault";

type SaveProfileFactOptions = {
  profileId?: string;
  conflict?: ProfileFactConflictPolicy;
  now?: Date;
};

type ImportProfileFactsOptions = SaveProfileFactOptions;

export async function listProfileBundles(): Promise<ProfileBundle[]> {
  const vault = await readVault();
  return vault.bundles;
}

export async function getProfileBundle(profileId: string): Promise<ProfileBundle | undefined> {
  const vault = await readVault();
  return vault.bundles.find((bundle) => bundle.id === profileId);
}

export async function getActiveProfileId(): Promise<string> {
  const vault = await readVault();
  return ensureActiveBundle(vault).id;
}

export async function getActiveProfileBundle(): Promise<ProfileBundle> {
  const vault = await readVault();
  return ensureActiveBundle(vault);
}

export async function setActiveProfileBundle(profileId: string): Promise<ProfileBundle> {
  const db = await openVaultDb();
  const vault = await readVaultFromDb(db);
  const bundle = vault.bundles.find((candidate) => candidate.id === profileId);
  if (!bundle) {
    db.close();
    throw new Error("The selected profile does not exist.");
  }

  const nextVault = LocalProfileVaultSchema.parse({
    ...vault,
    activeProfileId: bundle.id
  });
  await writeVaultToDb(db, nextVault);
  db.close();
  return bundle;
}

export async function saveProfileBundle(bundle: ProfileBundle, now = new Date()): Promise<ProfileBundle> {
  const parsedBundle = ProfileBundleSchema.parse({
    ...bundle,
    updatedAt: now.toISOString()
  });
  const db = await openVaultDb();
  const vault = await readVaultFromDb(db);
  const existingIndex = vault.bundles.findIndex((candidate) => candidate.id === parsedBundle.id);
  const bundles = existingIndex >= 0
    ? vault.bundles.map((candidate, index) => (index === existingIndex ? parsedBundle : candidate))
    : [...vault.bundles, parsedBundle];
  const nextVault = createLocalProfileVault(bundles, vault.activeProfileId ?? parsedBundle.id);
  await writeVaultToDb(db, nextVault);
  db.close();
  return parsedBundle;
}

export async function createProfileBundle(
  input: Parameters<typeof buildProfileBundle>[0] = {},
  now = new Date()
): Promise<ProfileBundle> {
  const bundle = buildProfileBundle(input, now);
  return saveProfileBundle(bundle, now);
}

export async function deleteProfileBundle(profileId: string): Promise<void> {
  const db = await openVaultDb();
  const vault = await readVaultFromDb(db);

  if (vault.bundles.length <= 1) {
    db.close();
    throw new Error("At least one profile must remain.");
  }

  const bundles = vault.bundles.filter((bundle) => bundle.id !== profileId);
  const nextActive = vault.activeProfileId === profileId
    ? bundles[0]?.id
    : vault.activeProfileId;
  const nextVault = createLocalProfileVault(bundles, nextActive);
  await writeVaultToDb(db, nextVault);
  db.close();
}

export async function listProfileFacts(profileId?: string): Promise<ProfileFact[]> {
  const vault = await readVault();
  const bundle = profileId
    ? vault.bundles.find((candidate) => candidate.id === profileId)
    : ensureActiveBundle(vault);
  return bundle?.facts ?? [];
}

export async function saveProfileFact(
  fact: ProfileFact,
  options: SaveProfileFactOptions = {}
): Promise<UpsertProfileFactResult> {
  const parsedFact = ProfileFactSchema.parse(fact);
  const db = await openVaultDb();
  const vault = await readVaultFromDb(db);
  const activeBundle = resolveBundleForWrite(vault, options.profileId);
  const { bundle, result } = upsertFactInBundle(activeBundle, parsedFact, {
    conflict: options.conflict ?? "replace",
    now: options.now
  });
  const nextVault = replaceBundleInVault(vault, bundle);
  await writeVaultToDb(db, nextVault);
  db.close();
  return result;
}

export async function deleteProfileFact(id: string, profileId?: string): Promise<void> {
  const db = await openVaultDb();
  const vault = await readVaultFromDb(db);
  const activeBundle = resolveBundleForWrite(vault, profileId);
  const nextBundle = removeFactFromBundle(activeBundle, id);
  const nextVault = replaceBundleInVault(vault, nextBundle);
  await writeVaultToDb(db, nextVault);
  db.close();
}

export async function importProfileFacts(
  facts: unknown[],
  options: ImportProfileFactsOptions = {}
): Promise<ProfileFact[]> {
  const parsedFacts = facts.map((fact) => ProfileFactSchema.parse(fact));
  const db = await openVaultDb();
  const vault = await readVaultFromDb(db);
  let bundle = resolveBundleForWrite(vault, options.profileId);

  for (const fact of parsedFacts) {
    bundle = upsertFactInBundle(bundle, fact, {
      conflict: options.conflict ?? "replace",
      now: options.now
    }).bundle;
  }

  const nextVault = replaceBundleInVault(vault, bundle);
  await writeVaultToDb(db, nextVault);
  db.close();
  return parsedFacts;
}

export function exportProfileFacts(facts: ProfileFact[]): string {
  return JSON.stringify({ version: 2, facts }, null, 2);
}

export async function exportLocalProfileVault(): Promise<string> {
  const vault = await readVault();
  return JSON.stringify(vault, null, 2);
}

async function readVault(): Promise<LocalProfileVault> {
  const db = await openVaultDb();
  const vault = await readVaultFromDb(db);
  db.close();
  return vault;
}

async function readVaultFromDb(db: IDBDatabase): Promise<LocalProfileVault> {
  const transaction = db.transaction(vaultStoreName, "readonly");
  const store = transaction.objectStore(vaultStoreName);
  const record = await requestToPromise<unknown>(store.get(vaultRecordKey));
  const migrated = record ? LocalProfileVaultSchema.parse(record) : createLocalProfileVault([createDefaultProfileBundle()], DEFAULT_PROFILE_BUNDLE_ID);
  return ensureVaultShape(migrated);
}

async function writeVaultToDb(db: IDBDatabase, vault: LocalProfileVault): Promise<void> {
  const transaction = db.transaction(vaultStoreName, "readwrite");
  const store = transaction.objectStore(vaultStoreName);
  await requestToPromise(store.put(ensureVaultShape(vault), vaultRecordKey));
  await transactionDone(transaction);
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(vaultStoreName)) {
        const vaultStore = db.createObjectStore(vaultStoreName);
        const bundle = createDefaultProfileBundle();
        const vault = createLocalProfileVault([bundle], bundle.id);
        vaultStore.put(vault, vaultRecordKey);
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function replaceBundleInVault(vault: LocalProfileVault, bundle: ProfileBundle): LocalProfileVault {
  const bundles = vault.bundles.some((candidate) => candidate.id === bundle.id)
    ? vault.bundles.map((candidate) => (candidate.id === bundle.id ? bundle : candidate))
    : [...vault.bundles, bundle];
  return ensureVaultShape(createLocalProfileVault(bundles, vault.activeProfileId ?? bundle.id));
}

function resolveBundleForWrite(vault: LocalProfileVault, profileId?: string): ProfileBundle {
  if (profileId) {
    const bundle = vault.bundles.find((candidate) => candidate.id === profileId);
    if (!bundle) {
      throw new Error("The selected profile does not exist.");
    }
    return bundle;
  }

  return ensureActiveBundle(vault);
}

function ensureActiveBundle(vault: LocalProfileVault): ProfileBundle {
  const bundle = resolveActiveProfileBundle(vault.bundles, vault.activeProfileId);
  if (bundle) {
    return bundle;
  }

  return createDefaultProfileBundle();
}

function ensureVaultShape(vault: LocalProfileVault): LocalProfileVault {
  if (vault.bundles.length > 0) {
    return LocalProfileVaultSchema.parse({
      ...vault,
      activeProfileId: resolveActiveProfileBundle(vault.bundles, vault.activeProfileId)?.id
    });
  }

  const bundle = createDefaultProfileBundle();
  return createLocalProfileVault([bundle], bundle.id);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}
