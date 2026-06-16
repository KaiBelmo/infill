export type Category = "jobs" | "tax" | "insurance" | "benefits";

export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "date"
  | "number"
  | "select"
  | "radio"
  | "checkbox"
  | "textarea"
  | "file";

export interface FieldDefinition {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  autocomplete?: string;
  options?: string[];
  placeholder?: string;
  showWhen?: { field: string; value: string };
}

export interface StepDefinition {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  fields: FieldDefinition[];
}

export interface FixtureDefinition {
  slug: string;
  category: Category;
  name: string;
  organization: string;
  summary: string;
  accent: string;
  secondary: string;
  theme: "foundry" | "enterprise" | "minimal" | "civic" | "retail" | "interview" | "workspace" | "claims" | "eligibility";
  navigation: "sidebar" | "top" | "rail" | "question" | "checklist";
  badge: string;
  steps: StepDefinition[];
}

export type FormValues = Record<string, string | boolean>;

export interface Draft {
  step: number;
  values: FormValues;
  savedAt: string;
}
