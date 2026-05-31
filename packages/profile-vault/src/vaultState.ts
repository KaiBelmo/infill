import type { LocalProfileVault, ProfileBundle, ProfileFact } from "@infill/shared";
import { LocalProfileVaultSchema, ProfileBundleSchema, ProfileFactSchema } from "@infill/shared";
import { mergeProfileFact, replaceProfileFact } from "./profileFact";

export const DEFAULT_PROFILE_BUNDLE_ID = "profile_default";
export const DEFAULT_PROFILE_BUNDLE_NAME = "Personal";

export type CreateProfileBundleInput = {
  id?: string;
  name?: string;
  description?: string;
  type?: ProfileBundle["type"];
  defaultLanguage?: string;
  facts?: ProfileFact[];
};

export type ProfileFactConflictPolicy = "keep-existing" | "replace" | "merge";

export type UpsertProfileFactOptions = {
  conflict?: ProfileFactConflictPolicy;
  now?: Date;
};

export type UpsertProfileFactResult = {
  action: "inserted" | "updated" | "replaced" | "unchanged";
  fact: ProfileFact;
  previousFact?: ProfileFact;
};

export function buildProfileBundle(input: CreateProfileBundleInput = {}, now = new Date()): ProfileBundle {
  const timestamp = now.toISOString();

  return ProfileBundleSchema.parse({
    id: input.id ?? crypto.randomUUID(),
    name: input.name?.trim() || DEFAULT_PROFILE_BUNDLE_NAME,
    description: input.description?.trim() || undefined,
    type: input.type ?? "personal",
    defaultLanguage: input.defaultLanguage ?? "en",
    facts: (input.facts ?? []).map((fact) => ProfileFactSchema.parse(fact)),
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function createDefaultProfileBundle(facts: ProfileFact[] = [], now = new Date()): ProfileBundle {
  return buildProfileBundle(
    {
      id: DEFAULT_PROFILE_BUNDLE_ID,
      name: DEFAULT_PROFILE_BUNDLE_NAME,
      type: "personal",
      facts
    },
    now
  );
}

export function createLocalProfileVault(bundles: ProfileBundle[], activeProfileId?: string): LocalProfileVault {
  return LocalProfileVaultSchema.parse({
    version: 2,
    activeProfileId,
    bundles
  });
}

export function resolveActiveProfileBundle(
  bundles: ProfileBundle[],
  activeProfileId?: string
): ProfileBundle | undefined {
  if (bundles.length === 0) {
    return undefined;
  }

  return bundles.find((bundle) => bundle.id === activeProfileId) ?? bundles[0];
}

export function upsertFactInBundle(
  bundle: ProfileBundle,
  incomingFact: ProfileFact,
  options: UpsertProfileFactOptions = {}
): { bundle: ProfileBundle; result: UpsertProfileFactResult } {
  const parsedBundle = ProfileBundleSchema.parse(bundle);
  const nextFact = ProfileFactSchema.parse(incomingFact);
  const conflict = options.conflict ?? "keep-existing";
  const now = options.now ?? new Date();
  const existingFact = parsedBundle.facts.find((fact) => fact.key === nextFact.key);

  if (!existingFact) {
    return {
      bundle: ProfileBundleSchema.parse({
        ...parsedBundle,
        facts: [...parsedBundle.facts, nextFact],
        updatedAt: now.toISOString()
      }),
      result: {
        action: "inserted",
        fact: nextFact
      }
    };
  }

  if (conflict === "keep-existing") {
    return {
      bundle: parsedBundle,
      result: {
        action: "unchanged",
        fact: existingFact,
        previousFact: existingFact
      }
    };
  }

  const resolvedFact = conflict === "replace"
    ? replaceProfileFact(existingFact, nextFact, now)
    : mergeProfileFact(existingFact, nextFact, now);

  return {
    bundle: ProfileBundleSchema.parse({
      ...parsedBundle,
      facts: parsedBundle.facts.map((fact) => (fact.id === existingFact.id ? resolvedFact : fact)),
      updatedAt: now.toISOString()
    }),
    result: {
      action: conflict === "replace" ? "replaced" : "updated",
      fact: resolvedFact,
      previousFact: existingFact
    }
  };
}

export function removeFactFromBundle(bundle: ProfileBundle, factId: string, now = new Date()): ProfileBundle {
  const parsedBundle = ProfileBundleSchema.parse(bundle);
  const nextFacts = parsedBundle.facts.filter((fact) => fact.id !== factId);
  if (nextFacts.length === parsedBundle.facts.length) {
    return parsedBundle;
  }

  return ProfileBundleSchema.parse({
    ...parsedBundle,
    facts: nextFacts,
    updatedAt: now.toISOString()
  });
}
