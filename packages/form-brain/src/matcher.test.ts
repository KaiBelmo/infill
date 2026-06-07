import { describe, expect, it } from "vitest";
import { findProfileKey, inferProfileFactFromFieldValue, mapFieldToProfile, scoreFieldMatch } from "./matcher";

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

  it("matches localized city labels", () => {
    expect(findProfileKey({
      fieldId: "city-fr",
      formId: "form",
      tagName: "input",
      inputType: "text",
      labelText: "Ville",
      required: true,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#city"
    })).toBe("address.city");

    expect(findProfileKey({
      fieldId: "city-it",
      formId: "form",
      tagName: "input",
      inputType: "text",
      labelText: "Città",
      required: true,
      disabled: false,
      readonly: false,
      visible: true,
      hasUserValue: false,
      domPathHint: "input#city-it"
    })).toBe("address.city");
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
