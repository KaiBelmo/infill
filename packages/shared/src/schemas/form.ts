import { z } from "zod";

export const ExtractedFieldOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  selected: z.boolean().optional()
});

export const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
});

export const ExtractedFieldSchema = z.object({
  fieldId: z.string().min(1),
  formId: z.string().min(1),
  frameId: z.string().optional(),
  tagName: z.enum(["input", "textarea", "select", "button", "custom"]),
  inputType: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  id: z.string().optional(),
  className: z.string().optional(),
  dataAttributes: z.record(z.string(), z.string()).optional(),
  autocomplete: z.string().optional(),
  labelText: z.string().optional(),
  ariaLabel: z.string().optional(),
  ariaDescription: z.string().optional(),
  placeholder: z.string().optional(),
  title: z.string().optional(),
  nearbyText: z.string().optional(),
  sectionHeading: z.string().optional(),
  groupLabel: z.string().optional(),
  options: z.array(ExtractedFieldOptionSchema).default([]),
  required: z.boolean(),
  disabled: z.boolean(),
  readonly: z.boolean(),
  visible: z.boolean(),
  currentValue: z.string().optional(),
  hasUserValue: z.boolean(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  min: z.string().optional(),
  max: z.string().optional(),
  step: z.string().optional(),
  domPathHint: z.string(),
  cssPath: z.string().optional(),
  boundingBox: BoundingBoxSchema.optional()
});

export const ExtractedFormSchema = z.object({
  formId: z.string().min(1),
  urlOrigin: z.string().min(1),
  urlPathHash: z.string().min(1),
  pageLanguage: z.string().min(2).max(35).optional(),
  pageTitle: z.string().optional(),
  formTitle: z.string().optional(),
  detectedDomain: z.string().optional(),
  fields: z.array(ExtractedFieldSchema),
  scanWarnings: z.array(z.string()).default([]),
  createdAt: z.string().datetime()
});

export type ExtractedFieldOption = z.infer<typeof ExtractedFieldOptionSchema>;
export type ExtractedField = z.infer<typeof ExtractedFieldSchema>;
export type ExtractedForm = z.infer<typeof ExtractedFormSchema>;
