import { z } from "zod";

export const FieldRiskSchema = z.enum([
  "safe",
  "personal",
  "sensitive",
  "restricted",
  "secret",
  "unknown"
]);

export const FieldMappingSchema = z.object({
  fieldId: z.string().min(1),
  profileKey: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  valueSource: z.enum([
    "profile_fact",
    "generated_answer",
    "manual",
    "previous_answer",
    "none"
  ]),
  confidence: z.number().min(0).max(1),
  risk: FieldRiskSchema,
  preselected: z.boolean(),
  requiresExplicitApproval: z.boolean(),
  reason: z.string(),
  warnings: z.array(z.string()).default([]),
  usedFactIds: z.array(z.string()).default([])
});

export type FieldRisk = z.infer<typeof FieldRiskSchema>;
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
