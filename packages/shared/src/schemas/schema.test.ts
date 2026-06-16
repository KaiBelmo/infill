import { describe, expect, it } from "vitest";
import {
  AccountInfoSchema,
  AuthSessionEnvelopeSchema,
  CloudAssistRequestSchema,
  CloudAssistResponseSchema,
  EncryptedCloudProfileEnvelopeSchema,
  EncryptedProfileSyncUploadRequestSchema,
  ExtractedFormSchema,
  FieldMappingSchema,
  LocalProfileVaultSchema,
  ProfileBundleSchema,
  ProfileFactSchema
} from "../index";

const timestamp = "2026-04-26T00:00:00.000Z";

describe("shared schemas", () => {
  it("validates profile facts", () => {
    const fact = ProfileFactSchema.parse({
      id: "fact_1",
      key: "contact.email",
      label: "Email",
      value: "person@example.com",
      category: "contact",
      sensitivity: "normal",
      source: "manual",
      verified: true,
      confidence: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    expect(fact.sourceRefs).toEqual([]);
  });

  it("allows null profile facts to represent learnable missing values", () => {
    const fact = ProfileFactSchema.parse({
      id: "fact_1",
      key: "contact.linkedin",
      label: "LinkedIn",
      value: null,
      category: "contact",
      sensitivity: "normal",
      source: "llm_suggested",
      verified: false,
      confidence: 0.8,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    expect(fact.value).toBeNull();
  });

  it("validates local profile vault state", () => {
    const bundle = ProfileBundleSchema.parse({
      id: "profile_1",
      name: "Personal",
      type: "personal",
      facts: [],
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const vault = LocalProfileVaultSchema.parse({
      version: 2,
      activeProfileId: bundle.id,
      bundles: [bundle]
    });

    expect(vault.bundles).toHaveLength(1);
  });

  it("validates extracted forms", () => {
    const form = ExtractedFormSchema.parse({
      formId: "form_1",
      urlOrigin: "https://example.com",
      urlPathHash: "hash",
      fields: [],
      createdAt: timestamp
    });

    expect(form.scanWarnings).toEqual([]);
  });

  it("requires mapping confidence between zero and one", () => {
    expect(() =>
      FieldMappingSchema.parse({
        fieldId: "field_1",
        valueSource: "none",
        confidence: 2,
        risk: "unknown",
        preselected: false,
        requiresExplicitApproval: true,
        reason: "invalid"
      })
    ).toThrow();
  });

  it("validates auth session envelopes", () => {
    const envelope = AuthSessionEnvelopeSchema.parse({
      user: {
        id: "user_1",
        email: "person@example.com",
        name: "Person Example",
        createdAt: timestamp
      },
      session: {
        sessionId: "session_1",
        userId: "user_1",
        deviceId: "device_1",
        deviceName: "Chrome Extension",
        expiresAt: timestamp,
        createdAt: timestamp
      },
      sessionToken: "session_token",
      refreshToken: "refresh_token",
      account: {
        user: {
          id: "user_1",
          email: "person@example.com",
          name: "Person Example",
          createdAt: timestamp
        },
        subscription: {
          plan: "free",
          status: "none",
          renewsAt: null,
          endsAt: null,
          trialEndsAt: null
        },
        billing: {
          canManageBilling: false
        },
        credits: {
          monthlyLimit: 10,
          usedThisPeriod: 0,
          remaining: 10,
          resetAt: timestamp
        },
        profiles: {
          used: 1,
          limit: 1,
          items: [
            {
              id: "profile_1",
              name: "Personal",
              type: "personal",
              isDefault: true,
              locked: false
            }
          ]
        }
      }
    });

    expect(envelope.account.subscription.plan).toBe("free");
  });

  it("validates account payloads", () => {
    const account = AccountInfoSchema.parse({
      user: {
        id: "user_1",
        email: "person@example.com",
        createdAt: timestamp
      },
      subscription: {
        plan: "pro",
        status: "active",
        renewsAt: timestamp,
        endsAt: null,
        trialEndsAt: null
      },
      billing: {
        canManageBilling: true
      },
      credits: {
        monthlyLimit: 5000,
        usedThisPeriod: 100,
        remaining: 4900,
        resetAt: timestamp
      },
      profiles: {
        used: 2,
        limit: 10,
        items: []
      }
    });

    expect(account.subscription.status).toBe("active");
  });

  it("validates cloud assist requests", () => {
    const request = CloudAssistRequestSchema.parse({
      forms: [
        {
          formId: "form_1",
          urlOrigin: "https://example.com",
          urlPathHash: "hash",
          fields: [],
          createdAt: timestamp
        }
      ],
      facts: [],
      localMappings: [],
      requestedAt: timestamp,
      locale: "en"
    });

    expect(request.forms).toHaveLength(1);
  });

  it("validates cloud assist responses", () => {
    const response = CloudAssistResponseSchema.parse({
      mappings: [],
      source: "local_fallback",
      warnings: [],
      credits: {
        monthlyLimit: 10,
        usedThisPeriod: 1,
        remaining: 9,
        resetAt: timestamp
      }
    });

    expect(response.credits.remaining).toBe(9);
  });

  it("validates encrypted profile sync envelopes", () => {
    const upload = EncryptedProfileSyncUploadRequestSchema.parse({
      envelopes: [
        {
          id: "profile_1",
          encryptionVersion: 1,
          kdfAlgorithm: "PBKDF2-SHA-256",
          kdfIterations: 310000,
          salt: "c2FsdA==",
          iv: "aXY=",
          ciphertext: "Y2lwaGVydGV4dA==",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ]
    });

    expect(upload.envelopes[0]).toEqual(
      EncryptedCloudProfileEnvelopeSchema.parse(upload.envelopes[0])
    );
  });
});
