import { z } from "zod";

export const EVAL_CAPABILITIES = [
  "persona_response",
  "ooc_classification",
  "role_isolation",
  "plan_classification",
  "plan_extraction",
  "memory_extraction",
  "memory_recall",
  "emotion_response",
  "safety_response",
] as const;

export const EVAL_DATA_LEVELS = ["L1", "L2", "L3"] as const;
export const EVAL_SPLITS = ["dev", "test"] as const;

export const evalCapabilitySchema = z.enum(EVAL_CAPABILITIES);
export const evalDataLevelSchema = z.enum(EVAL_DATA_LEVELS);
export const evalSplitSchema = z.enum(EVAL_SPLITS);

const uuidSchema = z.string().uuid();

export const evalCaseSchema = z
  .object({
    caseKey: z.string().regex(/^v0_1_[a-z_]+_[0-9]{3}$/),
    capability: evalCapabilitySchema,
    dataLevel: evalDataLevelSchema,
    split: evalSplitSchema,
    isSensitive: z.boolean(),
    sourceBadcaseId: uuidSchema.optional(),
    tags: z.array(z.string().min(1).max(100)).max(30),
    input: z
      .object({
        taskType: evalCapabilitySchema,
      })
      .loose(),
    expected: z
      .object({
        taskType: evalCapabilitySchema,
      })
      .loose(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.input.taskType !== value.capability) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["input", "taskType"],
        message: "input.taskType 必须与 capability 一致",
      });
    }

    if (value.expected.taskType !== value.capability) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expected", "taskType"],
        message: "expected.taskType 必须与 capability 一致",
      });
    }

    if (value.dataLevel === "L2" && !value.sourceBadcaseId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceBadcaseId"],
        message: "L2 回归样本必须关联 sourceBadcaseId",
      });
    }

    if (value.capability === "safety_response" && !value.isSensitive) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isSensitive"],
        message: "安全样本必须标记为敏感数据",
      });
    }
  });

export const evalDatasetSnapshotSchema = z
  .object({
    datasetKey: z.string().min(1).max(100),
    version: z.string().min(1).max(50),
    generatedAt: z.string().datetime({ offset: true }),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    totalCases: z.number().int().positive(),
    files: z.array(
      z
        .object({
          file: z.string().min(1),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          cases: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

const modelCandidateSchema = z
  .object({
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    adapterVersion: z.string().min(1).max(100),
    role: z.enum(["generation", "validation", "fallback"]),
    temperature: z.number().min(0).max(2),
    maxOutputTokens: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    maxRetries: z.number().int().min(0).max(3),
  })
  .strict();

export const evalRunConfigSchema = z
  .object({
    datasetVersion: z.string().min(1).max(50),
    datasetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    strategyVersion: z.string().min(1).max(100),
    personaTemplateVersions: z.record(z.string(), z.number().int().positive()),
    judgeProvider: z.string().min(1).max(100).nullable(),
    judgeModel: z.string().min(1).max(200).nullable(),
    judgePromptVersion: z.string().min(1).max(100).nullable(),
    candidates: z.array(modelCandidateSchema).min(1),
  })
  .strict();

export const evalScorePayloadSchema = z
  .object({
    schemaValid: z.boolean(),
    rulePass: z.boolean(),
    judgeScore: z.number().min(0).max(1).nullable(),
    dimensionScores: z.record(z.string(), z.number().min(0).max(1)),
    matchedFields: z.array(z.string()),
    mismatchedFields: z.array(z.string()),
    failureLabels: z.array(z.string()),
    annotatorIds: z.array(z.string()),
    adjudicationRequired: z.boolean(),
  })
  .strict();

export type EvalCapability = z.infer<typeof evalCapabilitySchema>;
export type EvalDataLevel = z.infer<typeof evalDataLevelSchema>;
export type EvalSplit = z.infer<typeof evalSplitSchema>;
export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalDatasetSnapshot = z.infer<typeof evalDatasetSnapshotSchema>;
export type EvalRunConfig = z.infer<typeof evalRunConfigSchema>;
export type EvalScorePayload = z.infer<typeof evalScorePayloadSchema>;
