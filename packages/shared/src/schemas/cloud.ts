import { z } from "zod";
import { ExtractedFormSchema } from "./form";
import { FieldMappingSchema } from "./mapping";
import { ProfileFactSchema } from "./profile";

export const BillingModeSchema = z.enum(["disabled", "test", "live"]);

export const SubscriptionPlanSchema = z.enum(["free", "pro"]);

export const SubscriptionStatusSchema = z.enum(["none", "active", "on_trial", "past_due", "cancelled", "expired", "unpaid"]);

export const CloudFeatureSourceSchema = z.enum(["cloud_model", "local_model", "local_fallback"]);

export const EmailSignInRequestSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(8).max(128),
  deviceName: z.string().min(1).max(120).default("Web Account"),
  clientType: z.enum(["web", "extension"]).default("web"),
  browser: z.string().min(1).max(120).optional(),
  platform: z.string().min(1).max(120).optional(),
  extensionVersion: z.string().min(1).max(40).optional()
});

export const AccountSignUpRequestSchema = EmailSignInRequestSchema.extend({
  username: z.string().trim().min(2).max(80)
});

export const RefreshSessionRequestSchema = z.object({
  refreshToken: z.string().min(1)
});

export const UserAccountSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  name: z.string().optional(),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().optional()
});

export const SessionInfoSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime()
});

export const CreditBalanceSchema = z.object({
  monthlyLimit: z.number().int().positive(),
  usedThisPeriod: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resetAt: z.string().datetime().nullable().optional()
});

export const FillProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  isDefault: z.boolean(),
  locked: z.boolean()
});

export const CloudProfileSchema = FillProfileSchema.extend({
  facts: z.array(ProfileFactSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const CloudProfileListResponseSchema = z.object({
  profiles: z.array(CloudProfileSchema)
});

export const CloudProfileUpsertRequestSchema = z.object({
  profiles: z.array(CloudProfileSchema)
});

export const CloudProfileUpsertResponseSchema = z.object({
  profiles: z.array(CloudProfileSchema)
});

export const CloudProfileDeleteResponseSchema = z.object({
  success: z.boolean()
});

// --- Encrypted profile sync envelopes (E2E encrypted — backend stores opaque blobs) ---

export const EncryptedCloudProfileEnvelopeSchema = z.object({
  id: z.string().min(1),
  encryptionVersion: z.literal(1),
  kdfAlgorithm: z.literal("PBKDF2-SHA-256"),
  kdfIterations: z.number().int().min(100_000),
  salt: z.string().min(1).describe("Base64-encoded PBKDF2 salt"),
  iv: z.string().min(1).describe("Base64-encoded AES-GCM IV/nonce"),
  ciphertext: z.string().min(1).describe("Base64-encoded AES-GCM ciphertext"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deviceId: z.string().optional()
});

export const EncryptedProfileSyncUploadRequestSchema = z.object({
  envelopes: z.array(EncryptedCloudProfileEnvelopeSchema).min(1)
});

export const EncryptedProfileSyncListResponseSchema = z.object({
  envelopes: z.array(EncryptedCloudProfileEnvelopeSchema)
});

export const ProfileSyncConflictActionSchema = z.enum(["keep_local", "use_cloud", "keep_both"]);

export const ProfileSyncConflictSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  profileName: z.string().min(1),
  factKey: z.string().min(1),
  factLabel: z.string().min(1),
  localFact: ProfileFactSchema,
  cloudFact: ProfileFactSchema,
  createdAt: z.string().datetime(),
  resolution: ProfileSyncConflictActionSchema.optional()
});

export const ProfileSyncPreviewSchema = z.object({
  id: z.string().min(1),
  accountUserId: z.string().min(1),
  createdAt: z.string().datetime(),
  localProfileCount: z.number().int().nonnegative(),
  cloudProfileCount: z.number().int().nonnegative(),
  importableCloudProfileCount: z.number().int().nonnegative(),
  uploadableLocalProfileCount: z.number().int().nonnegative(),
  mergeableProfileCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  conflicts: z.array(ProfileSyncConflictSchema)
});

export const ProfileSyncActionSchema = z.enum(["keep_local", "import_cloud", "merge"]);

export const AccountInfoSchema = z.object({
  user: UserAccountSchema,
  subscription: z.object({
    plan: SubscriptionPlanSchema,
    status: SubscriptionStatusSchema,
    renewsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
    trialEndsAt: z.string().datetime().nullable()
  }),
  billing: z.object({
    canManageBilling: z.boolean()
  }),
  credits: CreditBalanceSchema,
  profiles: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    items: z.array(FillProfileSchema)
  })
});

export const AuthSessionEnvelopeSchema = z.object({
  user: UserAccountSchema,
  session: SessionInfoSchema,
  sessionToken: z.string().min(1),
  refreshToken: z.string().min(1),
  account: AccountInfoSchema
});

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    status: z.number().int().min(400).max(599)
  })
});

export const CloudAssistRequestSchema = z.object({
  forms: z.array(ExtractedFormSchema).min(1),
  facts: z.array(ProfileFactSchema),
  localMappings: z.array(FieldMappingSchema),
  requestedAt: z.string().datetime(),
  locale: z.string().min(2).max(16).default("en")
});

export const CloudAssistResponseSchema = z.object({
  mappings: z.array(FieldMappingSchema),
  source: CloudFeatureSourceSchema,
  warnings: z.array(z.string()).default([]),
  credits: CreditBalanceSchema,
  providerId: z.string().optional(),
  model: z.string().optional()
});

export const CloudKeyMatchRequestSchema = z.object({
  prompt: z.string().min(1).max(30_000),
  requestedAt: z.string().datetime()
});

export const CloudKeyMatchResponseSchema = z.object({
  rawResponseText: z.string(),
  source: CloudFeatureSourceSchema,
  warnings: z.array(z.string()).default([]),
  credits: CreditBalanceSchema,
  providerId: z.string().optional(),
  model: z.string().optional()
});

export type BillingMode = z.infer<typeof BillingModeSchema>;
export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema>;
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;
export type EmailSignInRequest = z.infer<typeof EmailSignInRequestSchema>;
export type AccountSignUpRequest = z.infer<typeof AccountSignUpRequestSchema>;
export type RefreshSessionRequest = z.infer<typeof RefreshSessionRequestSchema>;
export type UserAccount = z.infer<typeof UserAccountSchema>;
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
export type CreditBalance = z.infer<typeof CreditBalanceSchema>;
export type FillProfile = z.infer<typeof FillProfileSchema>;
export type CloudProfile = z.infer<typeof CloudProfileSchema>;
export type CloudProfileListResponse = z.infer<typeof CloudProfileListResponseSchema>;
export type CloudProfileUpsertRequest = z.infer<typeof CloudProfileUpsertRequestSchema>;
export type CloudProfileUpsertResponse = z.infer<typeof CloudProfileUpsertResponseSchema>;
export type CloudProfileDeleteResponse = z.infer<typeof CloudProfileDeleteResponseSchema>;
export type EncryptedCloudProfileEnvelope = z.infer<typeof EncryptedCloudProfileEnvelopeSchema>;
export type EncryptedProfileSyncUploadRequest = z.infer<typeof EncryptedProfileSyncUploadRequestSchema>;
export type EncryptedProfileSyncListResponse = z.infer<typeof EncryptedProfileSyncListResponseSchema>;
export type ProfileSyncConflictAction = z.infer<typeof ProfileSyncConflictActionSchema>;
export type ProfileSyncConflict = z.infer<typeof ProfileSyncConflictSchema>;
export type ProfileSyncPreview = z.infer<typeof ProfileSyncPreviewSchema>;
export type ProfileSyncAction = z.infer<typeof ProfileSyncActionSchema>;
export type AccountInfo = z.infer<typeof AccountInfoSchema>;
export type AuthSessionEnvelope = z.infer<typeof AuthSessionEnvelopeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export const ParsedProfileFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1).nullable(),
  category: z.enum(["identity", "contact", "address", "work", "company", "custom"])
});

export const ParseProfileRequestSchema = z.object({
  rawText: z.string().min(1).max(10_000),
  locale: z.string().min(2).max(16).default("en")
});

export const ParseProfileResponseSchema = z.object({
  fields: z.array(ParsedProfileFieldSchema),
  source: CloudFeatureSourceSchema,
  warnings: z.array(z.string()).default([]),
  credits: CreditBalanceSchema
});

export const ExtensionAuthExchangeRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  code_verifier: z.string().min(1),
  client: z.literal("browser-extension")
});

export const CloudFilterRequestSchema = z.object({
  facts: z.array(ProfileFactSchema),
  fieldLabels: z.array(z.string()),
  requestedAt: z.string().datetime(),
  locale: z.string().min(2).max(16).default("en")
});

export const CloudFilterResponseSchema = z.object({
  keepIndexes: z.array(z.number()),
  warnings: z.array(z.string()).default([])
});

export type CloudAssistRequest = z.infer<typeof CloudAssistRequestSchema>;
export type CloudAssistResponse = z.infer<typeof CloudAssistResponseSchema>;
export type CloudKeyMatchRequest = z.infer<typeof CloudKeyMatchRequestSchema>;
export type CloudKeyMatchResponse = z.infer<typeof CloudKeyMatchResponseSchema>;
export type ParsedProfileField = z.infer<typeof ParsedProfileFieldSchema>;
export type ParseProfileRequest = z.infer<typeof ParseProfileRequestSchema>;
export type ParseProfileResponse = z.infer<typeof ParseProfileResponseSchema>;
export type ExtensionAuthExchangeRequest = z.infer<typeof ExtensionAuthExchangeRequestSchema>;
export type CloudFilterRequest = z.infer<typeof CloudFilterRequestSchema>;
export type CloudFilterResponse = z.infer<typeof CloudFilterResponseSchema>;
