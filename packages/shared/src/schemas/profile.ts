import { z } from "zod";

export const SensitivitySchema = z.enum([
  "public",
  "normal",
  "sensitive",
  "restricted",
  "secret"
]);

export const ProfileCategorySchema = z.enum([
  "identity",
  "contact",
  "address",
  "work",
  "education",
  "finance",
  "travel",
  "health",
  "legal",
  "family",
  "social",
  "preferences",
  "documents",
  "company",
  "custom"
]);

export const ProfileFactValueSchema = z.union([
  z.null(),
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.unknown())
]);

export const ProfileFactSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  value: ProfileFactValueSchema,
  category: ProfileCategorySchema,
  sensitivity: SensitivitySchema,
  source: z.enum([
    "manual",
    "import",
    "resume",
    "document",
    "pasted_memory",
    "llm_suggested",
    "previous_answer",
    "system"
  ]),
  verified: z.boolean(),
  confidence: z.number().min(0).max(1),
  expiresAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  sourceRefs: z.array(z.string()).default([]),
  notes: z.string().optional()
});

export const ProfileBundleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum([
    "personal",
    "job_seeker",
    "founder",
    "company",
    "student",
    "freelancer",
    "travel",
    "custom"
  ]),
  defaultLanguage: z.string().default("en"),
  facts: z.array(ProfileFactSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const LocalProfileVaultSchema = z.object({
  version: z.literal(2),
  activeProfileId: z.string().min(1).optional(),
  bundles: z.array(ProfileBundleSchema)
});

export type Sensitivity = z.infer<typeof SensitivitySchema>;
export type ProfileCategory = z.infer<typeof ProfileCategorySchema>;
export type ProfileFact = z.infer<typeof ProfileFactSchema>;
export type ProfileBundle = z.infer<typeof ProfileBundleSchema>;
export type LocalProfileVault = z.infer<typeof LocalProfileVaultSchema>;
