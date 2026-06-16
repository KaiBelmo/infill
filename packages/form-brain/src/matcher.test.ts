import { describe, expect, it } from "vitest";
import {
  buildLlmBatchKeyMatchRequest,
  buildLlmBatchKeyMatchPrompt,
  clearProfileFactResolverCache,
  findProfileKey,
  inferProfileFactFromFieldValue,
  mapFieldsToProfile,
  mapFieldToProfile,
  resolveProfileFactValue,
  scoreFieldMatch,
  type LlmBatchKeyMatchRequest,
  type LlmKeyMatchResponse,
  type ProfileFactResolverOptions
} from "./matcher";

const timestamp = "2026-04-26T00:00:00.000Z";

describe("field matcher", () => {
  it("matches email autocomplete to a profile fact", () => {
    const mapping = mapFieldToProfile(
      {
        fieldId: "field_1",
        formId: "form_1",
        tagName: "input",
        autocomplete: "email",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input:nth-of-type(1)"
      },
      [
        {
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
          updatedAt: timestamp,
          sourceRefs: []
        }
      ]
    );

    expect(mapping.profileKey).toBe("contact.email");
    expect(mapping.value).toBe("person@example.com");
    expect(mapping.preselected).toBe(true);
  });

  it("infers a profile fact from a recognized user-filled field", () => {
    const fact = inferProfileFactFromFieldValue(
      {
        fieldId: "field_1",
        formId: "form_1",
        tagName: "input",
        inputType: "email",
        labelText: "Email address",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: true,
        domPathHint: "input:nth-of-type(1)"
      },
      " person@example.com "
    );

    expect(fact).toEqual({
      key: "contact.email",
      label: "Email Address",
      value: "person@example.com",
      category: "contact",
      sensitivity: "normal"
    });
  });

  it("matches signup fields from input type and camel-case attributes", () => {
    const facts = [
      {
        id: "fact_first",
        key: "identity.first_name",
        label: "First Name",
        value: "John",
        category: "identity" as const,
        sensitivity: "normal" as const,
        source: "pasted_memory" as const,
        verified: true,
        confidence: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        sourceRefs: []
      },
      {
        id: "fact_last",
        key: "identity.last_name",
        label: "Last Name",
        value: "Doe",
        category: "identity" as const,
        sensitivity: "normal" as const,
        source: "pasted_memory" as const,
        verified: true,
        confidence: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        sourceRefs: []
      },
      {
        id: "fact_email",
        key: "contact.email",
        label: "Email",
        value: "john.doe@example.com",
        category: "contact" as const,
        sensitivity: "normal" as const,
        source: "pasted_memory" as const,
        verified: true,
        confidence: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        sourceRefs: []
      }
    ];

    const firstName = mapFieldToProfile(
      {
        fieldId: "first",
        formId: "form",
        tagName: "input",
        inputType: "text",
        name: "firstName",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input[name='firstName']"
      },
      facts
    );
    const lastName = mapFieldToProfile(
      {
        fieldId: "last",
        formId: "form",
        tagName: "input",
        inputType: "text",
        id: "last-name",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input#last-name"
      },
      facts
    );
    const email = mapFieldToProfile(
      {
        fieldId: "email",
        formId: "form",
        tagName: "input",
        inputType: "email",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input[type='email']"
      },
      facts
    );

    expect(firstName.value).toBe("John");
    expect(lastName.value).toBe("Doe");
    expect(email.value).toBe("john.doe@example.com");
  });

  it("does not fill phone fields from invalid saved phone facts", () => {
    const mapping = mapFieldToProfile(
      {
        fieldId: "phone",
        formId: "form",
        tagName: "input",
        inputType: "tel",
        labelText: "Phone",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input[type='tel']"
      },
      [
        {
          id: "fact_bad_phone",
          key: "contact.phone",
          label: "Phone",
          value: "Flutter and Next.js were part of interview preparation",
          category: "contact",
          sensitivity: "normal",
          source: "pasted_memory",
          verified: true,
          confidence: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          sourceRefs: []
        }
      ]
    );

    expect(mapping.valueSource).toBe("none");
    expect(mapping.value).toBeUndefined();
    expect(mapping.reason).toContain("invalid value");
  });

  it("treats null profile facts as missing so fields remain learnable", () => {
    const mapping = mapFieldToProfile(
      {
        fieldId: "linkedin",
        formId: "form",
        tagName: "input",
        inputType: "text",
        labelText: "LinkedIn",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input#linkedin"
      },
      [
        {
          id: "fact_linkedin",
          key: "contact.linkedin",
          label: "LinkedIn",
          value: null,
          category: "contact",
          sensitivity: "normal",
          source: "llm_suggested",
          verified: false,
          confidence: 0.8,
          createdAt: timestamp,
          updatedAt: timestamp,
          sourceRefs: []
        }
      ]
    );

    expect(mapping.valueSource).toBe("none");
    expect(mapping.value).toBeUndefined();
    expect(mapping.reason).toContain("invalid value");
  });

  it("does not classify frontend mobile skill labels as phone facts", () => {
    const mapping = mapFieldToProfile(
      {
        fieldId: "skill",
        formId: "form",
        tagName: "input",
        inputType: "text",
        labelText: "Skills frontend mobile",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input#skill"
      },
      []
    );

    expect(mapping.profileKey).toBeUndefined();
  });

  it("still classifies mobile number labels as phone facts", () => {
    const mapping = mapFieldToProfile(
      {
        fieldId: "mobile",
        formId: "form",
        tagName: "input",
        inputType: "text",
        labelText: "Mobile number",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input#mobile"
      },
      []
    );

    expect(mapping.profileKey).toBe("contact.phone");
  });

  it("skips invalid contact facts and uses a later valid match", () => {
    const mapping = mapFieldToProfile(
      {
        fieldId: "phone",
        formId: "form",
        tagName: "input",
        inputType: "tel",
        labelText: "Phone",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input[type='tel']"
      },
      [
        {
          id: "fact_bad_phone",
          key: "contact.phone",
          label: "Phone",
          value: "Flutter and Next.js were part of interview preparation",
          category: "contact",
          sensitivity: "normal",
          source: "pasted_memory",
          verified: true,
          confidence: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          sourceRefs: []
        },
        {
          id: "fact_good_phone",
          key: "contact.phone",
          label: "Phone",
          value: "(555) 123-4567",
          category: "contact",
          sensitivity: "normal",
          source: "pasted_memory",
          verified: true,
          confidence: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          sourceRefs: []
        }
      ]
    );

    expect(mapping.value).toBe("(555) 123-4567");
    expect(mapping.usedFactIds).toEqual(["fact_good_phone"]);
  });

  it("uses direct canonical city before derived current location", () => {
    const mapping = mapFieldToProfile(
      inputField("City"),
      [
        profileFact("address.city", "City", "Casablanca"),
        profileFact("custom.identity_location_current", "Identity location current", "Temara, Rabat-Sale-Kenitra, Morocco")
      ]
    );

    expect(mapping.profileKey).toBe("address.city");
    expect(mapping.value).toBe("Casablanca");
    expect(mapping.usedFactIds).toEqual(["fact_address_city"]);
    expect(mapping.reason).toBe("Matched from field metadata.");
  });

  it("derives address fields from a custom current location fact", () => {
    const facts = [
      profileFact("custom.identity_location_current", "Identity location current", "Temara, Rabat-Sale-Kenitra, Morocco (IP-based estimate)")
    ];
    const resolverOptions = llmResolverOptions({
      bestFactKey: "custom.identity_location_current",
      confidence: 0.86,
      relationship: "semantic_source",
      reason: "Custom location fact can provide address components."
    });

    const city = mapFieldToProfile(inputField("City"), facts, resolverOptions);
    const region = mapFieldToProfile(inputField("Region"), facts, resolverOptions);
    const country = mapFieldToProfile(inputField("Country"), facts, resolverOptions);

    expect(city.value).toBe("Temara");
    expect(city.profileKey).toBe("address.city");
    expect(city.reason).toContain("LLM fallback selected custom.identity_location_current");
    expect(city.usedFactIds).toEqual(["fact_custom_identity_location_current"]);
    expect(region.value).toBe("Rabat-Sale-Kenitra");
    expect(region.profileKey).toBe("address.region");
    expect(country.value).toBe("Morocco");
    expect(country.profileKey).toBe("address.country");
  });

  it("rejects previous location facts for current address fields", () => {
    const resolverOptions = llmResolverOptions({
      bestFactKey: "custom.previous_location",
      confidence: 0.65,
      relationship: "stale_or_historical",
      reason: "Historical location should not fill current address."
    });
    const mapping = mapFieldToProfile(
      inputField("City"),
      [profileFact("custom.previous_location", "Previous location", "Marrakesh, Marrakesh-Safi, Morocco")],
      resolverOptions
    );

    expect(mapping.profileKey).toBe("address.city");
    expect(mapping.valueSource).toBe("none");
    expect(mapping.value).toBeUndefined();
  });

  it("derives company name and current title from custom current work facts", () => {
    const company = mapFieldToProfile(
      inputField("Company name"),
      [profileFact("custom.current_employer", "Current employer", "Acme Corp")],
      llmResolverOptions({
        bestFactKey: "custom.current_employer",
        confidence: 0.9,
        relationship: "semantic_source",
        reason: "Current employer maps to company name."
      })
    );
    const title = mapFieldToProfile(
      inputField("Job title"),
      [profileFact("custom.current_role", "Current role", "Frontend Engineer")],
      llmResolverOptions({
        bestFactKey: "custom.current_role",
        confidence: 0.9,
        relationship: "semantic_source",
        reason: "Current role maps to job title."
      })
    );

    expect(company.profileKey).toBe("company.name");
    expect(company.value).toBe("Acme Corp");
    expect(company.reason).toContain("LLM fallback selected custom.current_employer");
    expect(title.profileKey).toBe("work.current_title");
    expect(title.value).toBe("Frontend Engineer");
    expect(title.reason).toContain("LLM fallback selected custom.current_role");
  });

  it("rejects previous work facts for current company and title fields", () => {
    const company = mapFieldToProfile(
      inputField("Company name"),
      [profileFact("custom.previous_employer", "Previous employer", "OldCo")],
      llmResolverOptions({
        bestFactKey: "custom.previous_employer",
        confidence: 0.61,
        relationship: "stale_or_historical",
        reason: "Historical employer is below acceptance threshold."
      })
    );
    const title = mapFieldToProfile(
      inputField("Job title"),
      [profileFact("custom.former_role", "Former role", "QA Engineer")],
      llmResolverOptions({
        bestFactKey: "custom.former_role",
        confidence: 0.61,
        relationship: "stale_or_historical",
        reason: "Historical role is below acceptance threshold."
      })
    );

    expect(company.profileKey).toBe("company.name");
    expect(company.valueSource).toBe("none");
    expect(title.profileKey).toBe("work.current_title");
    expect(title.valueSource).toBe("none");
  });

  it("derives full name from preferred calling name without overriding canonical full name", () => {
    const resolverOptions = llmResolverOptions({
      bestFactKey: "custom.preferred_calling_name",
      confidence: 0.88,
      relationship: "semantic_source",
      reason: "Preferred calling name can supply display identity in low-sensitivity context."
    });
    const derived = mapFieldToProfile(
      inputField("Full name"),
      [profileFact("custom.preferred_calling_name", "Preferred calling name", "Kai Belmo")],
      resolverOptions
    );
    const direct = mapFieldToProfile(
      inputField("Full name"),
      [
        profileFact("identity.full_name", "Full name", "Kailan Belmo"),
        profileFact("custom.preferred_calling_name", "Preferred calling name", "Kai Belmo")
      ],
      resolverOptions
    );

    expect(derived.profileKey).toBe("identity.full_name");
    expect(derived.value).toBe("Kai Belmo");
    expect(derived.reason).toContain("LLM fallback selected custom.preferred_calling_name");
    expect(direct.value).toBe("Kailan Belmo");
    expect(direct.usedFactIds).toEqual(["fact_identity_full_name"]);
  });

  it("rejects previous calling names for current full name fields", () => {
    const mapping = mapFieldToProfile(
      inputField("Full name"),
      [profileFact("custom.previous_calling_name", "Previous calling name", "Old Name")],
      llmResolverOptions({
        bestFactKey: "custom.previous_calling_name",
        confidence: 0.64,
        relationship: "stale_or_historical",
        reason: "Historical calling name is below acceptance threshold."
      })
    );

    expect(mapping.profileKey).toBe("identity.full_name");
    expect(mapping.valueSource).toBe("none");
    expect(mapping.value).toBeUndefined();
  });

  it("rejects llm fallback keys that were not provided", () => {
    const mapping = mapFieldToProfile(
      inputField("Company name"),
      [profileFact("custom.current_employer", "Current employer", "Acme Corp")],
      llmResolverOptions({
        bestFactKey: "custom.fake_key",
        confidence: 0.95,
        relationship: "semantic_source",
        reason: "Bad model output."
      })
    );

    expect(mapping.valueSource).toBe("none");
    expect(mapping.value).toBeUndefined();
  });

  it("rejects placeholder values selected by the llm fallback", () => {
    const mapping = mapFieldToProfile(
      inputField("Company name"),
      [profileFact("custom.current_employer", "Current employer", "unknown")],
      llmResolverOptions({
        bestFactKey: "custom.current_employer",
        confidence: 0.95,
        relationship: "semantic_source",
        reason: "Placeholder should be rejected locally."
      })
    );

    expect(mapping.valueSource).toBe("none");
    expect(mapping.value).toBeUndefined();
  });

  it("reuses cached llm key matches for the same target and fact keys", () => {
    clearProfileFactResolverCache();
    let calls = 0;
    const resolverOptions: ProfileFactResolverOptions = {
      enableLlmKeyMatcherFallback: true,
      modelVersion: "test-model",
      llmKeyMatcher: () => {
        calls += 1;
        return {
          bestFactKey: "custom.current_employer",
          confidence: 0.91,
          relationship: "semantic_source",
          reason: "Current employer maps to company."
        };
      }
    };
    const facts = [profileFact("custom.current_employer", "Current employer", "Acme Corp")];

    expect(mapFieldToProfile(inputField("Company name"), facts, resolverOptions).value).toBe("Acme Corp");
    expect(mapFieldToProfile(inputField("Company name"), facts, resolverOptions).value).toBe("Acme Corp");
    expect(calls).toBe(1);
  });

  it("batch matches all unresolved target keys against fact metadata in one call", () => {
    clearProfileFactResolverCache();
    const requests: LlmBatchKeyMatchRequest[] = [];
    const facts = [
      profileFact("custom.identity_location_current", "Identity location current", "Temara, Rabat-Sale-Kenitra, Morocco"),
      profileFact("custom.current_employer", "Current employer", "Acme Corp")
    ];
    const mappings = mapFieldsToProfile(
      [inputField("City"), inputField("Company name")],
      facts,
      {
        enableLlmKeyMatcherFallback: true,
        modelVersion: "test-model",
        llmBatchKeyMatcher: (request) => {
          requests.push(request);
          return {
            matches: [
              {
                targetKey: "address.city",
                bestFactKey: "custom.identity_location_current",
                confidence: 0.88,
                relationship: "semantic_source",
                reason: "Current location can locally provide city."
              },
              {
                targetKey: "company.name",
                bestFactKey: "custom.current_employer",
                confidence: 0.91,
                relationship: "semantic_source",
                reason: "Current employer maps to company."
              }
            ]
          };
        }
      }
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.targets.map((target) => target.targetKey).sort()).toEqual(["address.city", "company.name"]);
    expect(requests[0]?.facts).toEqual([
      { key: "custom.identity_location_current", label: "Identity location current" },
      { key: "custom.current_employer", label: "Current employer" }
    ]);
    expect(JSON.stringify(requests[0])).not.toContain("Temara");
    expect(JSON.stringify(requests[0])).not.toContain("Acme Corp");
    expect(mappings.map((mapping) => mapping.value)).toEqual(["Temara", "Acme Corp"]);
  });

  it("does not include direct canonical winners in the llm batch request", () => {
    clearProfileFactResolverCache();
    const requests: LlmBatchKeyMatchRequest[] = [];
    const mappings = mapFieldsToProfile(
      [inputField("City"), inputField("Company name")],
      [
        profileFact("address.city", "City", "Casablanca"),
        profileFact("custom.current_employer", "Current employer", "Acme Corp")
      ],
      {
        enableLlmKeyMatcherFallback: true,
        modelVersion: "test-model",
        llmBatchKeyMatcher: (request) => {
          requests.push(request);
          return {
            matches: [{
              targetKey: "company.name",
              bestFactKey: "custom.current_employer",
              confidence: 0.91,
              relationship: "semantic_source",
              reason: "Current employer maps to company."
            }]
          };
        }
      }
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.targets.map((target) => target.targetKey)).toEqual(["company.name"]);
    expect(mappings.map((mapping) => mapping.value)).toEqual(["Casablanca", "Acme Corp"]);
  });

  it("reuses cached llm batch matches for the same targets and fact metadata", () => {
    clearProfileFactResolverCache();
    let calls = 0;
    const resolverOptions: ProfileFactResolverOptions = {
      enableLlmKeyMatcherFallback: true,
      modelVersion: "test-model",
      llmBatchKeyMatcher: () => {
        calls += 1;
        return {
          matches: [{
            targetKey: "company.name",
            bestFactKey: "custom.current_employer",
            confidence: 0.91,
            relationship: "semantic_source",
            reason: "Current employer maps to company."
          }]
        };
      }
    };
    const fields = [inputField("Company name")];
    const facts = [profileFact("custom.current_employer", "Current employer", "Acme Corp")];

    expect(mapFieldsToProfile(fields, facts, resolverOptions)[0]?.value).toBe("Acme Corp");
    expect(mapFieldsToProfile(fields, facts, resolverOptions)[0]?.value).toBe("Acme Corp");
    expect(calls).toBe(1);
  });

  it("builds a batch key-match prompt without profile fact values", () => {
    const request: LlmBatchKeyMatchRequest = {
      targets: [{ targetKey: "field:city-input", targetLabel: "Ville", context: { formPurpose: "profile", sensitivity: "low" } }],
      facts: [{ key: "custom.identity_location_current", label: "Identity location current" }]
    };

    const prompt = buildLlmBatchKeyMatchPrompt(request);

    expect(prompt).toContain("Return JSON only");
    expect(prompt).toContain("field:city-input");
    expect(prompt).toContain("Ville");
    expect(prompt).toContain("suggestedProfileKey");
    expect(prompt).toContain("Form labels, placeholders, and nearby text may be in any language");
    expect(prompt).toContain("translate or interpret the label semantically");
    expect(prompt).toContain("targetKey as an opaque identifier, not a semantic hint");
    expect(prompt).toContain("Never infer field meaning from any substring");
    expect(prompt).toContain("Copy each targetKey into the output exactly");
    expect(prompt).toContain("address.city");
    expect(prompt).toContain("custom.identity_location_current");
    expect(prompt).not.toContain("Temara");
  });

  it("does not hardcode translated city labels into the local scorer", () => {
    expect(scoreFieldMatch(inputField("Ville")).profileKey).toBeUndefined();
  });

  it("maps the pasted SmartRecruiters page mock through the extension mapper API", () => {
    clearProfileFactResolverCache();
    const batchRequests: LlmBatchKeyMatchRequest[] = [];
    const fields = [
      smartRecruitersField("first-name-input", "First name", { autocomplete: "given-name", required: true }),
      smartRecruitersField("last-name-input", "Last name", { autocomplete: "family-name", required: true }),
      smartRecruitersField("email-input", "Email", { autocomplete: "email", inputType: "email", required: true }),
      smartRecruitersField("confirm-email-input", "Confirm your email", { autocomplete: "email", inputType: "email", required: true }),
      smartRecruitersField("spl-form-element_10", "Ville", { autocomplete: "off", required: true }),
      smartRecruitersField("spl-form-element_5", "Phone number", { inputType: "tel", ariaLabel: "Phone number", required: true }),
      smartRecruitersField("linkedin-input", "LinkedIn"),
      smartRecruitersField("facebook-input", "Facebook"),
      smartRecruitersField("twitter-input", "X (fka Twitter)"),
      smartRecruitersField("website-input", "Website"),
      smartRecruitersField("hiring-manager-message-input", "Let the company know about your interest working there", {
        tagName: "textarea"
      })
    ];
    const facts = [
      profileFact("identity.first_name", "First name", "Kai"),
      profileFact("identity.last_name", "Last name", "Belmo"),
      profileFact("contact.email", "Email", "kai@example.com"),
      profileFact("contact.phone", "Phone number", "+39 333 123 4567"),
      profileFact("contact.linkedin", "LinkedIn", "https://www.linkedin.com/in/kai"),
      profileFact("contact.facebook", "Facebook", "https://www.facebook.com/kai"),
      profileFact("contact.twitter", "X", "https://x.com/kai"),
      profileFact("contact.website", "Website", "https://kai.example"),
      profileFact("custom.identity_location_current", "Identity location current", "Temara, Rabat-Sale-Kenitra, Morocco")
    ];

    const mappings = mapFieldsToProfile(fields, facts, {
      enableLlmKeyMatcherFallback: true,
      modelVersion: "test-model",
      llmBatchKeyMatcher: (request) => {
        batchRequests.push(request);
        return {
          matches: [{
            targetKey: "field:spl-form-element_10",
            suggestedProfileKey: "address.city",
            bestFactKey: "custom.identity_location_current",
            confidence: 0.88,
            relationship: "semantic_source",
            reason: "Ville is French for city; current location can locally provide the city field."
          }]
        };
      }
    });
    const byFieldId = new Map(mappings.map((mapping) => [mapping.fieldId, mapping]));

    expect(batchRequests).toHaveLength(1);
    expect(batchRequests[0]?.targets).toEqual([{
      targetKey: "field:spl-form-element_10",
      targetLabel: "Ville",
      context: { formPurpose: "unknown", sensitivity: "low" }
    }]);
    expect(JSON.stringify(batchRequests[0])).not.toContain("Temara");

    expect(byFieldId.get("first-name-input")).toMatchObject({ profileKey: "identity.first_name", value: "Kai" });
    expect(byFieldId.get("last-name-input")).toMatchObject({ profileKey: "identity.last_name", value: "Belmo" });
    expect(byFieldId.get("email-input")).toMatchObject({ profileKey: "contact.email", value: "kai@example.com" });
    expect(byFieldId.get("confirm-email-input")).toMatchObject({ profileKey: "contact.email", value: "kai@example.com" });
    expect(byFieldId.get("spl-form-element_10")).toMatchObject({
      profileKey: "address.city",
      value: "Temara",
      valueSource: "profile_fact"
    });
    expect(byFieldId.get("spl-form-element_5")).toMatchObject({ profileKey: "contact.phone", value: "+39 333 123 4567" });
    expect(byFieldId.get("linkedin-input")).toMatchObject({ profileKey: "contact.linkedin", value: "https://www.linkedin.com/in/kai" });
    expect(byFieldId.get("facebook-input")).toMatchObject({ profileKey: "contact.facebook", value: "https://www.facebook.com/kai" });
    expect(byFieldId.get("twitter-input")).toMatchObject({ profileKey: "contact.twitter", value: "https://x.com/kai" });
    expect(byFieldId.get("website-input")).toMatchObject({ profileKey: "contact.website", value: "https://kai.example" });
    expect(byFieldId.get("hiring-manager-message-input")).toMatchObject({
      profileKey: undefined,
      valueSource: "generated_answer",
      requiresExplicitApproval: true
    });
  });

  it("builds the runtime LLM batch request without profile values", () => {
    const fields = [
      smartRecruitersField("first-name-input", "First name"),
      smartRecruitersField("spl-form-element_10", "Ville"),
      smartRecruitersField("hiring-manager-message-input", "Let the company know about your interest working there", {
        tagName: "textarea"
      })
    ];
    const facts = [
      profileFact("identity.first_name", "First name", "Kai"),
      profileFact("custom.identity_location_current", "Identity location current", "Temara, Rabat-Sale-Kenitra, Morocco")
    ];

    const request = buildLlmBatchKeyMatchRequest(fields, facts);

    expect(request?.targets).toEqual([{
      targetKey: "field:spl-form-element_10",
      targetLabel: "Ville",
      context: { formPurpose: "unknown", sensitivity: "low" }
    }]);
    expect(request?.facts).toEqual([
      { key: "identity.first_name", label: "First name" },
      { key: "custom.identity_location_current", label: "Identity location current" }
    ]);
    expect(JSON.stringify(request)).not.toContain("Kai");
    expect(JSON.stringify(request)).not.toContain("Temara");
  });

  it("builds a batch key-match request for contact.phone with French label", () => {
    const fields = [
      smartRecruitersField("phone-input", "NuméRo De TéLéPhone", { inputType: "tel" })
    ];
    const facts = [
      profileFact("custom.telephone", "telephone", "06 12 34 56 78")
    ];

    const request = buildLlmBatchKeyMatchRequest(fields, facts);

    expect(request?.targets).toEqual([{
      targetKey: "contact.phone",
      targetLabel: "NuméRo De TéLéPhone",
      context: { formPurpose: "unknown", sensitivity: "medium" }
    }]);
    expect(request?.facts).toEqual([
      { key: "custom.telephone", label: "telephone" }
    ]);
  });

  it("hard-rejects stale llm relationships even with high confidence", () => {
    const resolved = resolveProfileFactValue(
      "company.name",
      [profileFact("custom.previous_employer", "Previous employer", "OldCo")],
      { sensitivity: "low" },
      llmResolverOptions({
        bestFactKey: "custom.previous_employer",
        confidence: 0.99,
        relationship: "stale_or_historical",
        reason: "The fact is historical."
      })
    );

    expect(resolved).toBeUndefined();
  });

  it("does not fill high-sensitivity full name from an llm-selected calling name", () => {
    const resolved = resolveProfileFactValue(
      "identity.full_name",
      [profileFact("custom.preferred_calling_name", "Preferred calling name", "Kai Belmo")],
      { sensitivity: "high" },
      llmResolverOptions({
        bestFactKey: "custom.preferred_calling_name",
        confidence: 0.99,
        relationship: "semantic_source",
        reason: "Preferred name is not enough for high-sensitivity identity."
      })
    );

    expect(resolved).toBeUndefined();
  });

  it("derives first and last name from a custom identity display name fact", () => {
    const facts = [
      {
        id: "fact_display_name",
        key: "custom.identity_display_name",
        label: "Identity display name",
        value: "Kai Belmo",
        category: "custom" as const,
        sensitivity: "normal" as const,
        source: "pasted_memory" as const,
        verified: true,
        confidence: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        sourceRefs: []
      }
    ];

    const firstName = mapFieldToProfile(
      {
        fieldId: "first",
        formId: "form",
        tagName: "input",
        inputType: "text",
        labelText: "First Name",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input#first-name"
      },
      facts
    );
    const lastName = mapFieldToProfile(
      {
        fieldId: "last",
        formId: "form",
        tagName: "input",
        inputType: "text",
        labelText: "Last Name",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input#last-name"
      },
      facts
    );

    expect(firstName.value).toBe("Kai");
    expect(firstName.reason).toBe("Derived from a saved profile fact.");
    expect(lastName.value).toBe("Belmo");
  });

  it("derives names from display name facts with pasted-memory evidence tags", () => {
    const facts = [
      {
        id: "fact_display_name",
        key: "custom.identity_display_name",
        label: "Identity display name",
        value: "kai belmo [fact]",
        category: "custom" as const,
        sensitivity: "normal" as const,
        source: "pasted_memory" as const,
        verified: true,
        confidence: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        sourceRefs: []
      }
    ];

    const firstName = mapFieldToProfile(
      {
        fieldId: "first",
        formId: "form",
        tagName: "input",
        inputType: "text",
        name: "firstName",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input#first-name"
      },
      facts
    );
    const lastName = mapFieldToProfile(
      {
        fieldId: "last",
        formId: "form",
        tagName: "input",
        inputType: "text",
        name: "lastName",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input#last-name"
      },
      facts
    );

    expect(firstName.value).toBe("kai");
    expect(lastName.value).toBe("belmo");
  });

  it("finds valid email facts saved under non-canonical keys", () => {
    const mapping = mapFieldToProfile(
      {
        fieldId: "email",
        formId: "form",
        tagName: "input",
        inputType: "email",
        labelText: "Email",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "input#email"
      },
      [
        {
          id: "fact_email",
          key: "custom.primary_email",
          label: "Primary email",
          value: "kai@example.com",
          category: "custom",
          sensitivity: "normal",
          source: "pasted_memory",
          verified: true,
          confidence: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          sourceRefs: []
        }
      ]
    );

    expect(mapping.profileKey).toBe("contact.email");
    expect(mapping.value).toBe("kai@example.com");
  });

  it("does not infer a profile fact from sensitive fields", () => {
    const fact = inferProfileFactFromFieldValue(
      {
        fieldId: "field_1",
        formId: "form_1",
        tagName: "input",
        inputType: "text",
        labelText: "Date of birth",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: true,
        domPathHint: "input:nth-of-type(1)"
      },
      "2000-01-01"
    );

    expect(fact).toBeUndefined();
  });

  it("scores common identity fields from varied metadata", () => {
    expect(findProfileKey({
      fieldId: "first",
      formId: "form",
      tagName: "input",
      inputType: "text",
      dataAttributes: { "data-field-type": "first name" },
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#first"
    })).toBe("identity.first_name");

    expect(findProfileKey({
      fieldId: "last",
      formId: "form",
      tagName: "input",
      inputType: "text",
      placeholder: "Family name",
      id: "lastName",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#last"
    })).toBe("identity.last_name");

    expect(findProfileKey({
      fieldId: "full",
      formId: "form",
      tagName: "input",
      inputType: "text",
      labelText: "Legal name",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#full"
    })).toBe("identity.full_name");
  });

  it("matches contact and social fields from direct and scored signals", () => {
    expect(findProfileKey({
      fieldId: "site",
      formId: "form",
      tagName: "input",
      inputType: "url",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input[type='url']"
    })).toBe("contact.website");

    expect(findProfileKey({
      fieldId: "linkedin",
      formId: "form",
      tagName: "input",
      inputType: "text",
      ariaLabel: "LinkedIn profile",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#linkedin"
    })).toBe("contact.linkedin");

    expect(findProfileKey({
      fieldId: "github",
      formId: "form",
      tagName: "input",
      inputType: "text",
      name: "githubUrl",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input[name='githubUrl']"
    })).toBe("contact.github");

    expect(findProfileKey({
      fieldId: "facebook",
      formId: "form",
      tagName: "input",
      inputType: "text",
      labelText: "Facebook",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#facebook"
    })).toBe("contact.facebook");

    expect(findProfileKey({
      fieldId: "twitter",
      formId: "form",
      tagName: "input",
      inputType: "text",
      labelText: "X (fka Twitter)",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#twitter"
    })).toBe("contact.twitter");
  });

  it("does not match identity name from username fields", () => {
    expect(findProfileKey({
      fieldId: "username",
      formId: "form",
      tagName: "input",
      inputType: "text",
      name: "username",
      labelText: "Username",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#username"
    })).toBeUndefined();
  });

  it("routes company name to company instead of identity", () => {
    expect(findProfileKey({
      fieldId: "company",
      formId: "form",
      tagName: "input",
      inputType: "text",
      labelText: "Company name",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#company"
    })).toBe("company.name");
  });

  it("does not route long-form company interest prompts to company name", () => {
    const mapping = mapFieldToProfile(
      {
        fieldId: "interest",
        formId: "form",
        tagName: "textarea",
        labelText: "Let the company know about your interest working there",
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: "textarea#interest",
        options: []
      },
      []
    );

    expect(mapping.profileKey).toBeUndefined();
    expect(mapping.valueSource).toBe("generated_answer");
    expect(mapping.requiresExplicitApproval).toBe(true);
  });

  it("does not match bare X labels as Twitter without supporting context", () => {
    expect(findProfileKey({
      fieldId: "x",
      formId: "form",
      tagName: "input",
      inputType: "text",
      labelText: "X",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#x"
    })).toBeUndefined();
  });

  it("matches common social media profile fields", () => {
    const cases = [
      ["Instagram", "contact.instagram"],
      ["Threads profile", "contact.threads"],
      ["TikTok URL", "contact.tiktok"],
      ["YouTube channel", "contact.youtube"],
      ["Snapchat username", "contact.snapchat"],
      ["Pinterest profile", "contact.pinterest"],
      ["Reddit username", "contact.reddit"],
      ["Discord handle", "contact.discord"],
      ["Telegram username", "contact.telegram"],
      ["WhatsApp number", "contact.whatsapp"],
      ["Medium profile", "contact.medium"],
      ["Stack Overflow profile", "contact.stackoverflow"],
      ["Dribbble profile", "contact.dribbble"],
      ["Behance profile", "contact.behance"],
      ["Bluesky profile", "contact.bluesky"],
      ["Mastodon profile", "contact.mastodon"],
      ["Twitch channel", "contact.twitch"],
      ["GitLab profile", "contact.gitlab"],
      ["Bitbucket profile", "contact.bitbucket"],
      ["Product Hunt profile", "contact.producthunt"]
    ] as const;

    for (const [labelText, expectedKey] of cases) {
      expect(findProfileKey({
        fieldId: labelText.toLowerCase().replace(/\s+/g, "_"),
        formId: "form",
        tagName: "input",
        inputType: "text",
        labelText,
        required: false,
        disabled: false,
        readonly: false,
        visible: true,
        hasUserValue: false,
        domPathHint: `input[aria-label='${labelText}']`
      })).toBe(expectedKey);
    }
  });

  it("rejects weak-only evidence", () => {
    const classOnly = scoreFieldMatch({
      fieldId: "first",
      formId: "form",
      tagName: "input",
      inputType: "text",
      className: "first-name",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input.first-name"
    });

    const nearbyOnly = scoreFieldMatch({
      fieldId: "phone",
      formId: "form",
      tagName: "input",
      inputType: "text",
      nearbyText: "Phone number",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#phone"
    });

    expect(classOnly.profileKey).toBeUndefined();
    expect(nearbyOnly.profileKey).toBeUndefined();
  });

  it("returns undefined for ambiguous close scores", () => {
    const match = scoreFieldMatch({
      fieldId: "ambiguous",
      formId: "form",
      tagName: "input",
      inputType: "text",
      name: "roleTitle",
      dataAttributes: { "data-field": "full name" },
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#ambiguous"
    });

    expect(match.profileKey).toBeUndefined();
    expect(match.rejectedReason).toContain("too close");
  });

  it("matches aria-labelledby-style extracted label text", () => {
    expect(findProfileKey({
      fieldId: "email",
      formId: "form",
      tagName: "input",
      inputType: "text",
      labelText: "Email address",
      required: false,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#email"
    })).toBe("contact.email");
  });
});

function inputField(labelText: string) {
  const fieldId = labelText.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return {
    fieldId,
    formId: "form",
    tagName: "input" as const,
    inputType: "text",
    labelText,
    required: false,
    disabled: false,
    readonly: false,
    visible: true,
    hasUserValue: false,
    domPathHint: `input#${fieldId}`
  };
}

function smartRecruitersField(
  fieldId: string,
  labelText: string,
  overrides: Partial<ReturnType<typeof inputField>> = {}
) {
  return {
    fieldId,
    formId: "smartrecruiters-oneclick",
    tagName: "input" as const,
    inputType: "text",
    labelText,
    required: false,
    disabled: false,
    readonly: false,
    visible: true,
    hasUserValue: false,
    domPathHint: `oc-oneclick-form #${fieldId}`,
    ...overrides
  };
}

function profileFact(key: string, label: string, value: string | null) {
  const prefix = key.split(".")[0];
  return {
    id: `fact_${key.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`,
    key,
    label,
    value,
    category: prefix === "custom" ? "custom" as const : prefix as "identity" | "contact" | "address" | "work" | "company" | "custom",
    sensitivity: "normal" as const,
    source: "pasted_memory" as const,
    verified: true,
    confidence: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceRefs: []
  };
}

function llmResolverOptions(response: LlmKeyMatchResponse): ProfileFactResolverOptions {
  clearProfileFactResolverCache();
  return {
    enableLlmKeyMatcherFallback: true,
    modelVersion: "test-model",
    llmKeyMatcher: () => response
  };
}
