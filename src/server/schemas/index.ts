import { z } from "zod";

import {
  MEMORY_SCOPES,
  MEMORY_SENSITIVITIES,
  OOC_VERDICTS,
  PERSONA_FEEDBACK_CATEGORIES,
  PLAN_SCOPES,
  PLAN_STATUSES,
  FEEDBACK_STATUSES,
} from "../../types/domain";

export const uuidSchema = z.string().uuid();

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "必须使用 YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    );
  }, "日期无效");

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "必须使用 HH:mm");

export const ianaTimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "无效的 IANA 时区");

export const idempotencyKeySchema = z.string().trim().min(8).max(200);

export const updateBadcaseReviewSchema = z
  .object({
    badcaseId: uuidSchema,
    status: z.enum(FEEDBACK_STATUSES),
    expectedRevision: z.coerce.number().int().min(0).max(2_147_483_647),
  })
  .strict();

export const magicLinkRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    redirectPath: z.string().startsWith("/").max(200).default("/chat"),
  })
  .strict();

export const personaSnapshotSchema = z
  .object({
    identity: z
      .object({
        name: z.string().trim().min(1).max(40),
        role: z.string().trim().min(1).max(60),
        background: z.string().trim().max(1000).optional(),
      })
      .strict(),
    coreTraits: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
    speakingStyle: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    supportStyle: z.string().trim().min(1).max(1000),
    reminderTone: z.string().trim().min(1).max(500),
    boundaries: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
    preferences: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
    values: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    relationshipDefinition: z.string().trim().max(1000).optional(),
    proactiveLevel: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();

export const createCustomRoleSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40),
    persona: personaSnapshotSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.persona.identity.background?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["persona", "identity", "background"],
        message: "自定义角色必须填写身份与背景",
      });
    }
    if (!value.persona.relationshipDefinition?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["persona", "relationshipDefinition"],
        message: "自定义角色必须填写与用户的关系",
      });
    }
  });

export const switchRoleSchema = z
  .object({
    roleId: uuidSchema,
  })
  .strict();

export const createPersonaVersionSchema = z
  .object({
    roleId: uuidSchema,
    expectedCurrentVersionId: uuidSchema,
    persona: personaSnapshotSchema,
    confirmed: z.literal(true),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const sendMessageSchema = z
  .object({
    roleId: uuidSchema,
    conversationId: uuidSchema,
    clientMessageId: z.string().trim().min(8).max(200),
    content: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const chatHistoryRequestSchema = z
  .object({
    roleId: uuidSchema,
    conversationId: uuidSchema,
    cursor: z.string().trim().min(1).max(500),
  })
  .strict();

export const regenerateMessageSchema = z
  .object({
    userMessageId: uuidSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const memoryCandidateDecisionSchema = z
  .object({
    candidateId: uuidSchema,
    action: z.enum(["confirm", "reject"]),
    editedContent: z.string().trim().min(1).max(5000).optional(),
    editedScope: z.enum(MEMORY_SCOPES).optional(),
    editedRoleId: uuidSchema.nullable().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.action === "reject" &&
      (value.editedContent !== undefined ||
        value.editedScope !== undefined ||
        value.editedRoleId !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "拒绝候选时不能提交记忆修改内容",
      });
    }

    if (value.editedScope === "role_private" && !value.editedRoleId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["editedRoleId"],
        message: "角色专属记忆必须指定角色",
      });
    }

    if (value.editedScope === "user_shared" && value.editedRoleId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["editedRoleId"],
        message: "用户共享记忆不能绑定角色",
      });
    }
  });

export const updateMemorySchema = z
  .object({
    memoryId: uuidSchema,
    content: z.string().trim().min(1).max(5000).optional(),
    scope: z.enum(MEMORY_SCOPES).optional(),
    roleId: uuidSchema.nullable().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const deleteMemorySchema = z
  .object({
    memoryId: uuidSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const planBaseInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(5000).optional(),
  timezone: ianaTimezoneSchema,
});

export const dayPlanInputSchema = planBaseInputSchema
  .extend({
    scope: z.literal("day"),
    date: isoDateSchema,
    scheduledAt: isoDateTimeSchema.optional(),
    reminderAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const weekPlanInputSchema = planBaseInputSchema
  .extend({
    scope: z.literal("week"),
    weekStart: isoDateSchema.refine((value) => {
      return new Date(`${value}T00:00:00.000Z`).getUTCDay() === 1;
    }, "weekStart 必须是周一"),
    dueDate: isoDateSchema.optional(),
  })
  .strict();

export const monthPlanInputSchema = planBaseInputSchema
  .extend({
    scope: z.literal("month"),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "必须使用 YYYY-MM"),
    dueDate: isoDateSchema.optional(),
  })
  .strict();

export const yearPlanInputSchema = planBaseInputSchema
  .extend({
    scope: z.literal("year"),
    year: z.number().int().min(2000).max(2100),
    parentPlanId: uuidSchema.optional(),
    dueDate: isoDateSchema.optional(),
  })
  .strict();

export const planInputSchema = z
  .discriminatedUnion("scope", [
    dayPlanInputSchema,
    weekPlanInputSchema,
    monthPlanInputSchema,
    yearPlanInputSchema,
  ])
  .superRefine((value, context) => {
    if (value.scope !== "day") {
      return;
    }

    if (value.reminderAt && !value.scheduledAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reminderAt"],
        message: "设置提醒前必须先选择计划时间",
      });
    }

    if (
      value.reminderAt &&
      value.scheduledAt &&
      Date.parse(value.reminderAt) > Date.parse(value.scheduledAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reminderAt"],
        message: "提醒时间不能晚于计划时间",
      });
    }
  });

export const createManualPlanSchema = z
  .object({
    plan: planInputSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const confirmPlanProposalSchema = z
  .object({
    proposalId: uuidSchema,
    plan: planInputSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const rejectPlanProposalSchema = z
  .object({
    proposalId: uuidSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const changePlanStatusSchema = z
  .object({
    planId: uuidSchema,
    expectedStatus: z.enum(PLAN_STATUSES),
    nextStatus: z.enum(["active", "completed", "cancelled"]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const personaFeedbackSchema = z
  .object({
    messageId: uuidSchema,
    roleId: uuidSchema,
    personaVersionId: uuidSchema,
    categories: z.array(z.enum(PERSONA_FEEDBACK_CATEGORIES)).min(1).max(7),
    additionalText: z.string().trim().max(2000).optional(),
    entryPoint: z.enum(["long_press", "context_menu"]),
  })
  .strict();

export const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().url().max(5000),
    keys: z
      .object({
        p256dh: z.string().min(1).max(1000),
        auth: z.string().min(1).max(1000),
      })
      .strict(),
    deviceLabel: z.string().trim().max(100).optional(),
  })
  .strict();

export const markInAppNotificationReadSchema = z
  .object({
    notificationId: uuidSchema,
    read: z.enum(["true", "false"]).transform((value) => value === "true"),
  })
  .strict();

/**
 * Account deletion is intentionally separate from ordinary profile changes.
 * The exact phrase and acknowledgement make a forged or accidental form
 * submission fail closed before it reaches either Auth or the database.
 */
export const deleteAccountSchema = z
  .object({
    acknowledged: z.literal("true"),
    confirmation: z.literal("删除我的账号"),
  })
  .strict();

export const planClassifierOutputSchema = z
  .object({
    intent: z.enum(["none", "create", "offer", "clarify"]),
    scope: z.enum(PLAN_SCOPES).nullable(),
    confidence: z.number().min(0).max(1),
    title: z.string().trim().max(200).nullable(),
    originalTimeText: z.string().max(500).nullable(),
    parsedPayload: z.record(z.string(), z.unknown()),
    missingFields: z.array(z.string().min(1).max(100)).max(20),
    reasoningLabel: z.string().min(1).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.intent === "none" && value.scope !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope"],
        message: "无计划意图时 scope 必须为空",
      });
    }

    if (value.intent !== "none" && value.scope === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope"],
        message: "检测到计划意图时必须给出层级",
      });
    }
  });

export const memoryExtractionCandidateSchema = z
  .object({
    action: z.enum(["auto_write", "confirm", "ignore", "forbidden"]),
    scope: z.enum(MEMORY_SCOPES),
    roleId: uuidSchema.nullable(),
    category: z.string().trim().min(1).max(100),
    content: z.string().trim().min(1).max(5000),
    normalizedKey: z.string().trim().max(300).nullable(),
    sensitivity: z.enum(MEMORY_SENSITIVITIES),
    confidence: z.number().min(0).max(1),
    supersedesMemoryId: uuidSchema.nullable(),
  })
  .strict();

export const memoryExtractionOutputSchema = z
  .object({
    candidates: z.array(memoryExtractionCandidateSchema).max(20),
  })
  .strict();

/**
 * Product extraction requires an exact quote from the current user message.
 * The quote is used only for server-side grounding and is never persisted as
 * model reasoning or returned to the browser.
 */
export const groundedMemoryExtractionOutputSchema = z
  .object({
    candidates: z
      .array(
        memoryExtractionCandidateSchema.extend({
          evidenceQuote: z.string().trim().min(1).max(1000),
        }),
      )
      .max(20),
  })
  .strict();

const oocScoreSchema = z.number().min(0).max(1);

export const oocCheckOutputSchema = z
  .object({
    verdict: z.enum(OOC_VERDICTS),
    overallScore: oocScoreSchema,
    dimensionScores: z
      .object({
        identity: oocScoreSchema,
        personality: oocScoreSchema,
        speakingStyle: oocScoreSchema,
        preference: oocScoreSchema,
        memoryTruthfulness: oocScoreSchema,
        boundarySafety: oocScoreSchema,
        temporaryRoleplay: oocScoreSchema,
      })
      .strict(),
    failureLabels: z.array(z.string().min(1).max(100)).max(20),
    rewriteInstructions: z.array(z.string().min(1).max(500)).max(12),
  })
  .strict();

export const emotionSignalOutputSchema = z
  .object({
    primaryEmotion: z.enum([
      "sadness",
      "anxiety",
      "anger",
      "grief",
      "loneliness",
      "overwhelm",
      "other",
    ]),
    valence: z.enum(["positive", "neutral", "negative"]),
    intensity: z.number().min(0).max(1),
    highRisk: z.boolean(),
    scheduleNextDayFollowup: z.boolean(),
    supportMode: z.enum(["listen", "clarify", "offer_help", "safety"]),
  })
  .strict();

export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;
export type CreateCustomRoleInput = z.infer<typeof createCustomRoleSchema>;
export type CreatePersonaVersionInput = z.infer<typeof createPersonaVersionSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type PlanInput = z.infer<typeof planInputSchema>;
export type ConfirmPlanProposalInput = z.infer<typeof confirmPlanProposalSchema>;
export type RejectPlanProposalInput = z.infer<typeof rejectPlanProposalSchema>;
export type PersonaFeedbackInput = z.infer<typeof personaFeedbackSchema>;
export type PlanClassifierOutput = z.infer<typeof planClassifierOutputSchema>;
export type MemoryExtractionOutput = z.infer<typeof memoryExtractionOutputSchema>;
export type GroundedMemoryExtractionOutput = z.infer<
  typeof groundedMemoryExtractionOutputSchema
>;
export type DeleteMemoryInput = z.infer<typeof deleteMemorySchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type OocCheckOutput = z.infer<typeof oocCheckOutputSchema>;
export type EmotionSignalOutput = z.infer<typeof emotionSignalOutputSchema>;

export * from "./evaluation";
