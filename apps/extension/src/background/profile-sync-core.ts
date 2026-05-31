import type { CloudProfile, ProfileFact, ProfileSyncPreview } from "@infill/shared";
import type { LocalProfileRecord } from "./profile-store";

export function createProfileSyncPreview(
  localProfiles: LocalProfileRecord[],
  cloudProfiles: CloudProfile[],
  accountUserId: string
): ProfileSyncPreview {
  const now = new Date().toISOString();
  const conflicts = collectConflicts(localProfiles, cloudProfiles, now);
  const matchedCloudIds = new Set<string>();
  const matchedLocalIds = new Set<string>();

  for (const cloudProfile of cloudProfiles) {
    const localProfile = findMatchingProfile(localProfiles, cloudProfile);
    if (localProfile) {
      matchedCloudIds.add(cloudProfile.id);
      matchedLocalIds.add(localProfile.id);
    }
  }

  return {
    id: crypto.randomUUID(),
    accountUserId,
    createdAt: now,
    localProfileCount: localProfiles.length,
    cloudProfileCount: cloudProfiles.length,
    importableCloudProfileCount: cloudProfiles.length - matchedCloudIds.size,
    uploadableLocalProfileCount: localProfiles.length - matchedLocalIds.size,
    mergeableProfileCount: matchedLocalIds.size,
    conflictCount: conflicts.length,
    conflicts
  };
}

function collectConflicts(localProfiles: LocalProfileRecord[], cloudProfiles: CloudProfile[], createdAt: string): ProfileSyncPreview["conflicts"] {
  const conflicts: ProfileSyncPreview["conflicts"] = [];
  for (const cloudProfile of cloudProfiles) {
    const localProfile = findMatchingProfile(localProfiles, cloudProfile);
    if (!localProfile) continue;

    for (const cloudFact of cloudProfile.facts) {
      const localFact = localProfile.facts.find((fact) => fact.key === cloudFact.key);
      if (!localFact || factsEqual(localFact, cloudFact)) continue;
      conflicts.push({
        id: crypto.randomUUID(),
        profileId: localProfile.id,
        profileName: localProfile.name,
        factKey: localFact.key,
        factLabel: localFact.label || cloudFact.label,
        localFact,
        cloudFact,
        createdAt
      });
    }
  }
  return conflicts;
}

function findMatchingProfile(localProfiles: LocalProfileRecord[], cloudProfile: CloudProfile): LocalProfileRecord | undefined {
  return localProfiles.find((profile) => profile.id === cloudProfile.id)
    ?? localProfiles.find((profile) =>
      profile.name.trim().toLowerCase() === cloudProfile.name.trim().toLowerCase() &&
      profile.type === cloudProfile.type
    );
}

function factsEqual(left: ProfileFact, right: ProfileFact): boolean {
  return left.key === right.key && String(left.value).trim() === String(right.value).trim();
}
