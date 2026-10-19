export type UUID = string;
export type ISODate = string;
export type ISODateTime = string;
export type IanaTimezone = string;

export type JsonPrimitive = string | number | boolean | null;
export type Json = JsonPrimitive | { [key: string]: Json | undefined } | Json[];

export const ROLE_SOURCES = ["system_template", "custom"] as const;
export type RoleSource = (typeof ROLE_SOURCES)[number];

export const MESSAGE_SENDERS = ["user", "assistant", "system"] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

export const MESSAGE_STATUSES = ["pending", "completed", "failed", "deleted"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const AI_RUN_STATUSES = ["running", "completed", "blocked", "failed"] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export const MEMORY_SCOPES = ["user_shared", "role_private"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_STATUSES = [
  "pending",
  "active",
  "superseded",
  "deleted",
  "rejected",
] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_SENSITIVITIES = ["normal", "sensitive", "forbidden"] as const;
export type MemorySensitivity = (typeof MEMORY_SENSITIVITIES)[number];

export const PLAN_SCOPES = ["day", "week", "month", "year"] as const;
export type PlanScope = (typeof PLAN_SCOPES)[number];

export const PLAN_STATUSES = [
  "pending",
  "active",
  "completed",
  "cancelled",
  "deleted",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PROPOSAL_STATUSES = [
  "pending",
  "confirmed",
  "rejected",
  "expired",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const OOC_VERDICTS = ["pass", "rewrite", "block", "error"] as const;
export type OocVerdict = (typeof OOC_VERDICTS)[number];

export const JOB_STATUSES = [
  "scheduled",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const FEEDBACK_STATUSES = ["open", "triaged", "resolved", "dismissed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface PersonaIdentity {
  name: string;
  role: string;
  background?: string;
}

export interface PersonaSnapshot {
  identity: PersonaIdentity;
  coreTraits: string[];
  speakingStyle: string[];
  supportStyle: string;
  reminderTone: string;
  boundaries: string[];
  preferences?: string[];
  values?: string[];
  relationshipDefinition?: string;
  proactiveLevel?: "low" | "medium" | "high";
}

export interface Profile {
  id: UUID;
  displayName: string;
  avatarSeed: string | null;
  currentRoleId: UUID | null;
  onboardingCompletedAt: ISODateTime | null;
  deletedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface UserSettings {
  userId: UUID;
  timezone: IanaTimezone;
  locale: string;
  theme: "light";
  fontScale: number;
  preferredUserName: string | null;
  defaultDayTime: string | null;
  defaultReminderMinutes: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  browserNotificationsEnabled: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface RoleTemplate {
  id: UUID;
  templateKey: string;
  displayName: string;
  roleLabel: string;
  shortDescription: string;
  sortOrder: number;
  personaSnapshot: PersonaSnapshot;
  templateVersion: number;
  isActive: boolean;
}

export interface Role {
  id: UUID;
  userId: UUID;
  templateId: UUID | null;
  source: RoleSource;
  displayName: string;
  currentPersonaVersionId: UUID | null;
  status: "active" | "archived";
  lastInteractedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PersonaVersion {
  id: UUID;
  userId: UUID;
  roleId: UUID;
  versionNo: number;
  schemaVersion: number;
  personaSnapshot: PersonaSnapshot;
  compiledSystemPrompt: string;
  strategyVersionId: UUID;
  changeSummary: string | null;
  createdAt: ISODateTime;
}

export interface Conversation {
  id: UUID;
  userId: UUID;
  roleId: UUID;
  lastMessageAt: ISODateTime | null;
  lastSummaryMessageId: UUID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Message {
  id: UUID;
  userId: UUID;
  conversationId: UUID;
  roleId: UUID;
  sender: MessageSender;
  content: string;
  status: MessageStatus;
  clientMessageId: string | null;
  personaVersionId: UUID | null;
  replyToMessageId: UUID | null;
  deletedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ConversationSummary {
  id: UUID;
  userId: UUID;
  conversationId: UUID;
  throughMessageId: UUID;
  summaryText: string;
  summaryVersion: number;
  provider: string;
  model: string;
  estimatedTokens: number;
  createdAt: ISODateTime;
}

export interface AiRun {
  id: UUID;
  userId: UUID;
  conversationId: UUID;
  userMessageId: UUID;
  assistantMessageId: UUID | null;
  provider: string;
  model: string;
  strategyVersionId: UUID;
  status: AiRunStatus;
  rewritten: boolean;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  traceId: string;
  errorCode: string | null;
  startedAt: ISODateTime;
  completedAt: ISODateTime | null;
}

export interface OocDimensionScores {
  identity?: number;
  personality?: number;
  speakingStyle?: number;
  preference?: number;
  memoryTruthfulness?: number;
  boundarySafety?: number;
  temporaryRoleplay?: number;
}

export interface OocCheck {
  id: UUID;
  aiRunId: UUID;
  attemptNo: 1 | 2;
  verdict: OocVerdict;
  overallScore: number | null;
  dimensionScores: OocDimensionScores;
  failureLabels: string[];
  provider: string;
  model: string;
  latencyMs: number;
  createdAt: ISODateTime;
}

export interface MemoryCandidate {
  id: UUID;
  userId: UUID;
  roleId: UUID | null;
  sourceMessageId: UUID;
  suggestedScope: MemoryScope;
  category: string;
  content: string;
  normalizedKey: string | null;
  sensitivity: MemorySensitivity;
  confidence: number;
  status: ProposalStatus;
  confirmedMemoryId: UUID | null;
  supersedesMemoryId: UUID | null;
  expiresAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Memory {
  id: UUID;
  userId: UUID;
  scope: MemoryScope;
  roleId: UUID | null;
  category: string;
  content: string;
  normalizedKey: string | null;
  sensitivity: Exclude<MemorySensitivity, "forbidden">;
  status: MemoryStatus;
  sourceMessageId: UUID | null;
  confirmedByUser: boolean;
  validFrom: ISODateTime | null;
  validTo: ISODateTime | null;
  supersedesMemoryId: UUID | null;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  deletedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PlanProposal {
  id: UUID;
  userId: UUID;
  sourceRoleId: UUID | null;
  sourceMessageId: UUID;
  intent: "create" | "offer" | "clarify";
  scope: PlanScope;
  parsedPayload: Json;
  missingFields: string[];
  confidence: number;
  status: ProposalStatus;
  confirmedPlanId: UUID | null;
  /** Null for legacy rows created before controlled proposal mutations. */
  idempotencyKey: string | null;
  confirmationIdempotencyKey: string | null;
  rejectionIdempotencyKey: string | null;
  expiresAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

interface PlanBase {
  id: UUID;
  userId: UUID;
  parentPlanId: UUID | null;
  title: string;
  notes: string | null;
  status: PlanStatus;
  periodStart: ISODate;
  periodEnd: ISODate;
  dueDate: ISODate | null;
  timezone: IanaTimezone;
  source: "chat" | "manual" | "system";
  sourceRoleId: UUID | null;
  completedAt: ISODateTime | null;
  sortOrder: number;
  idempotencyKey: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface DayPlan extends PlanBase {
  scope: "day";
  parentPlanId: null;
  scheduledAt: ISODateTime | null;
  reminderAt: ISODateTime | null;
}

export interface WeekPlan extends PlanBase {
  scope: "week";
  parentPlanId: null;
  scheduledAt: null;
  reminderAt: null;
}

export interface MonthPlan extends PlanBase {
  scope: "month";
  parentPlanId: null;
  scheduledAt: null;
  reminderAt: null;
}

export interface YearPlan extends PlanBase {
  scope: "year";
  scheduledAt: null;
  reminderAt: null;
}

export type Plan = DayPlan | WeekPlan | MonthPlan | YearPlan;

export interface PlanStatusEvent {
  id: UUID;
  userId: UUID;
  planId: UUID;
  fromStatus: PlanStatus | null;
  toStatus: PlanStatus;
  source: "user" | "system" | "admin";
  changedByUserId: UUID | null;
  metadata: Json;
  createdAt: ISODateTime;
}

export interface NotificationJob {
  id: UUID;
  userId: UUID;
  planId: UUID;
  scheduledFor: ISODateTime;
  externalJobId: string | null;
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
  availableAt: ISODateTime;
  claimToken: UUID | null;
  leaseExpiresAt: ISODateTime | null;
  idempotencyKey: string;
  lastErrorCode: string | null;
  lastAttemptAt: ISODateTime | null;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface InAppNotification {
  id: UUID;
  userId: UUID;
  notificationJobId: UUID;
  planId: UUID;
  kind: "plan_reminder";
  deliveredAt: ISODateTime;
  readAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface EmotionFollowup {
  id: UUID;
  userId: UUID;
  sourceMessageId: UUID;
  roleId: UUID;
  emotionType: string;
  intensity: number;
  scheduledFor: ISODateTime;
  status: JobStatus;
  externalJobId: string | null;
  sentMessageId: UUID | null;
  idempotencyKey: string;
  lastErrorCode: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export const PERSONA_FEEDBACK_CATEGORIES = [
  "tone_mismatch",
  "identity_conflict",
  "fact_error",
  "memory_error",
  "too_cold",
  "boundary_violation",
  "other",
] as const;
export type PersonaFeedbackCategory = (typeof PERSONA_FEEDBACK_CATEGORIES)[number];

export interface PersonaFeedback {
  id: UUID;
  userId: UUID;
  messageId: UUID;
  roleId: UUID;
  personaVersionId: UUID;
  categories: PersonaFeedbackCategory[];
  additionalText: string | null;
  entryPoint: "long_press" | "context_menu";
  status: FeedbackStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Badcase {
  id: UUID;
  userId: UUID | null;
  sourceType: "persona_feedback" | "automatic_eval" | "manual";
  personaFeedbackId: UUID | null;
  messageId: UUID | null;
  aiRunId: UUID | null;
  capability: string;
  severity: "low" | "medium" | "high" | "critical";
  diagnosis: string | null;
  redactedExcerpt: string | null;
  status: FeedbackStatus;
  fixStrategyVersionId: UUID | null;
  assignedAdminId: UUID | null;
  resolvedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
