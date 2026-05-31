import type { ExtractedField, FieldRisk } from "@infill/shared";

const secretPatterns = [
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\bcredit\s*card\b/i,
  /\bcard\s*number\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /\bbank\s*account\b/i,
  /\brouting\s*number\b/i,
  /\bssn\b/i,
  /\bsocial\s*security\b/i,
  /\bnational\s*id\b/i,
  /\bpassport\s*number\b/i,
  /\bapi\s*key\b/i,
  /\bprivate\s*key\b/i,
  /\brecovery\s*phrase\b/i,
  /\bseed\s*phrase\b/i
];

const restrictedPatterns = [
  /\bpassport\b/i,
  /\bcitizenship\b/i,
  /\bnationality\b/i,
  /\bwork\s*authorization\b/i,
  /\bdisability\b/i,
  /\bmedical\b/i,
  /\bdiagnosis\b/i,
  /\btax\b/i,
  /\bcriminal\b/i,
  /\bi\s*certify\b/i,
  /\bagree\s*to\s*terms\b/i
];

const sensitivePatterns = [
  /\bdate\s*of\s*birth\b/i,
  /\bdob\b/i,
  /\bgender\b/i,
  /\bpronouns\b/i,
  /\bsalary\b/i,
  /\bemergency\s*contact\b/i
];

const personalPatterns = [
  /\bname\b/i,
  /\bemail\b/i,
  /\bphone\b/i,
  /\baddress\b/i,
  /\bcity\b/i,
  /\bpostal\b/i,
  /\bzip\b/i,
  /\bcompany\b/i,
  /\btitle\b/i
];

export function classifyFieldRisk(field: ExtractedField): FieldRisk {
  const text = fieldText(field);

  if (field.inputType === "password") {
    return "sensitive";
  }

  if (secretPatterns.some((pattern) => pattern.test(text))) {
    return "secret";
  }

  if (restrictedPatterns.some((pattern) => pattern.test(text))) {
    return "restricted";
  }

  if (sensitivePatterns.some((pattern) => pattern.test(text))) {
    return "sensitive";
  }

  if (personalPatterns.some((pattern) => pattern.test(text))) {
    return "personal";
  }

  return "unknown";
}

export function isFillBlocked(risk: FieldRisk): boolean {
  return risk === "secret" || risk === "restricted";
}

function fieldText(field: ExtractedField): string {
  return [
    field.inputType,
    field.name,
    field.id,
    field.className,
    field.dataAttributes ? Object.values(field.dataAttributes).join(" ") : undefined,
    field.autocomplete,
    field.labelText,
    field.ariaLabel,
    field.ariaDescription,
    field.placeholder,
    field.title,
    field.nearbyText,
    field.sectionHeading,
    field.groupLabel
  ]
    .filter(Boolean)
    .join(" ");
}
