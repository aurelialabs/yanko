import "server-only";

export type { ModelAdapter } from "./model-adapter";
export {
  DEFAULT_MODEL_CONTEXT_BUDGET,
  MODEL_CONTEXT_PROMPT_VERSION,
  ModelContextError,
  buildModelContext,
  estimateContextTokens,
} from "./context-builder";
export { loadModelContextSources } from "./context-data";
export { createModelContextMemoryRetriever } from "./memory-context-retrieval";
export { recordAiRunMemoryRetrievals } from "./chat-memory-retrieval-data";
export { ModelAdapterError, isModelAdapterError } from "./model-errors";
export { ModelRegistry, modelRegistry } from "./model-registry";
export { runOocGate } from "./ooc-gate";
export { EMOTION_FOLLOWUP_MIN_INTENSITY, applyEmotionPolicy } from "./emotion-policy";
export {
  EMOTION_SIGNAL_PROMPT_VERSION,
  EmotionRuntimeError,
  runEmotionSignal,
} from "./emotion-runtime";
export { scheduleStrongNegativeEmotionFollowup } from "./emotion-followup-data";
export {
  EMOTION_SIGNAL_WORKER_DEFAULT_LEASE_SECONDS,
  EmotionSignalWorkerError,
  isEmotionSignalWorkerEnabled,
  processEmotionSignalJob,
  runConfiguredEmotionSignalWorker,
} from "./emotion-signal-worker";
export {
  EmotionSignalJobStoreError,
  SupabaseEmotionSignalJobStore,
} from "./emotion-signal-worker-data";
export {
  EMOTION_FOLLOWUP_DELIVERY_DEFAULT_LEASE_SECONDS,
  EmotionFollowupWorkerError,
  createEmotionFollowupDeliverer,
  isEmotionFollowupDeliveryWorkerEnabled,
  persistEmotionFollowupMessage,
  processEmotionFollowupDelivery,
  runConfiguredEmotionFollowupDeliveryWorker,
} from "./emotion-followup-worker";
export {
  EmotionFollowupDeliveryStoreError,
  SupabaseEmotionFollowupDeliveryStore,
} from "./emotion-followup-worker-data";
export {
  MEMORY_POLICY_VERSION,
  MemoryPolicyError,
  applyMemoryPolicy,
} from "./memory-policy";
export {
  MEMORY_EXTRACTION_PROMPT_VERSION,
  MemoryExtractionRuntimeError,
  runMemoryExtraction,
} from "./memory-extraction-runtime";
export {
  MEMORY_EXTRACTION_WORKER_DEFAULT_BATCH_SIZE,
  MEMORY_EXTRACTION_WORKER_DEFAULT_LEASE_SECONDS,
  MemoryExtractionWorkerError,
  isMemoryExtractionWorkerEnabled,
  processMemoryExtractionJob,
  runConfiguredMemoryExtractionWorker,
} from "./memory-extraction-worker";
export {
  MemoryExtractionJobStoreError,
  SupabaseMemoryExtractionJobStore,
} from "./memory-extraction-worker-data";
export {
  MEMORY_EMBEDDING_WORKER_DEFAULT_BATCH_SIZE,
  MEMORY_EMBEDDING_WORKER_DEFAULT_LEASE_SECONDS,
  MemoryEmbeddingWorkerError,
  isMemoryEmbeddingWorkerEnabled,
  processMemoryEmbeddingJob,
  runConfiguredMemoryEmbeddingWorker,
} from "./memory-embedding-worker";
export {
  MemoryEmbeddingJobStoreError,
  SupabaseMemoryEmbeddingJobStore,
} from "./memory-embedding-worker-data";
export {
  MEMORY_EMBEDDING_DIMENSIONS,
  MEMORY_RETRIEVAL_DEFAULT_MIN_SIMILARITY,
  MEMORY_RETRIEVAL_MAX_RESULTS,
  MemoryVectorError,
  indexMemoryVector,
  isValidMemoryEmbeddingAdapter,
  isValidMemoryEmbedding,
  retrieveMemoryVectors,
} from "./memory-vector";
export {
  MemoryVectorStoreError,
  SupabaseMemoryVectorStore,
} from "./memory-vector-data";
export {
  PLAN_EXTRACTION_PROMPT_VERSION,
  PlanExtractionRuntimeError,
  runPlanExtraction,
} from "../plan/plan-extraction-runtime";
export {
  PLAN_EXTRACTION_WORKER_DEFAULT_LEASE_SECONDS,
  PlanExtractionWorkerError,
  isPlanExtractionWorkerEnabled,
  processPlanExtractionJob,
  runConfiguredPlanExtractionWorker,
} from "../plan/plan-extraction-worker";
export {
  PlanExtractionJobStoreError,
  SupabasePlanExtractionJobStore,
} from "../plan/plan-extraction-worker-data";
export {
  OOC_CRITICAL_DIMENSION_SCORE,
  OOC_DIMENSION_WEIGHTS,
  OOC_HARD_FAILURE_LABELS,
  OOC_MAX_ATTEMPTS,
  OOC_PASS_SCORE,
  OOC_POLICY_VERSION,
  OocPolicyError,
  applyOocPolicy,
  calculateOocOverallScore,
} from "./ooc-policy";
export type {
  BuiltModelContext,
  ContextConversationMessage,
  ContextMemory,
  ContextSummary,
  ModelContextBudget,
  ModelContextErrorCode,
  ModelContextSources,
} from "./context-builder";
export type {
  LoadedModelContextSources,
  ModelContextLoadOptions,
} from "./context-data";
export type {
  ModelContextMemoryRetrievalAudit,
  ModelContextMemoryRetrievalMatch,
  ModelContextMemoryRetrievalRequest,
  ModelContextMemoryRetrievalResult,
  ModelContextMemoryRetriever,
} from "./memory-context-retrieval";
export type {
  PersistedMemoryRetrieval,
  RecordAiRunMemoryRetrievalsInput,
} from "./chat-memory-retrieval-data";
export type {
  OocGateCheckRecord,
  OocGateDependencies,
  OocGateResult,
} from "./ooc-gate";
export type { OocHardFailureLabel, OocPolicyResult } from "./ooc-policy";
export type { EmotionPolicyOutcome, EmotionPolicyResult } from "./emotion-policy";
export type {
  EmotionRuntimeDependencies,
  EmotionRuntimeErrorCode,
  EmotionRuntimeInput,
  EmotionRuntimeResult,
  EmotionSignalContext,
} from "./emotion-runtime";
export type {
  EmotionFollowupStatus,
  PersistedEmotionFollowup,
  ScheduleEmotionFollowupInput,
} from "./emotion-followup-data";
export type { EmotionSignalContextLoadErrorCode } from "./emotion-signal-context-data";
export { EmotionSignalContextLoadError } from "./emotion-signal-context-data";
export type {
  EmotionSignalExecutor,
  EmotionSignalWorkerErrorCode,
  EmotionSignalWorkerJobOutcome,
  EmotionSignalWorkerOutcome,
} from "./emotion-signal-worker";
export type {
  ClaimedEmotionSignalJob,
  EmotionSignalJobCompletion,
  EmotionSignalJobCompletionOutcome,
  EmotionSignalJobStore,
} from "./emotion-signal-worker-data";
export type {
  EmotionFollowupDeliveryInput,
  EmotionFollowupDeliverer,
  EmotionFollowupMessageGenerator,
  EmotionFollowupMessagePersistenceOutcome,
  EmotionFollowupWorkerErrorCode,
  EmotionFollowupWorkerJobOutcome,
  EmotionFollowupWorkerOutcome,
} from "./emotion-followup-worker";
export type {
  ClaimedEmotionFollowup,
  EmotionFollowupCompletion,
  EmotionFollowupCompletionOutcome,
  EmotionFollowupDeliveryStore,
} from "./emotion-followup-worker-data";
export type {
  ExistingMemoryForPolicy,
  MemoryPolicyAction,
  MemoryPolicyCandidate,
  MemoryPolicyInput,
  MemoryPolicyOperation,
  MemoryPolicyReason,
  MemoryPolicyResult,
} from "./memory-policy";
export type {
  ExistingMemoryForExtraction,
  MemoryExtractionContextLoadErrorCode,
  MemoryExtractionContext,
  PersistedMemoryExtraction,
} from "./memory-extraction-data";
export { MemoryExtractionContextLoadError } from "./memory-extraction-data";
export type {
  MemoryExtractionRuntimeDependencies,
  MemoryExtractionRuntimeErrorCode,
  MemoryExtractionRuntimeInput,
} from "./memory-extraction-runtime";
export type {
  MemoryExtractionExecutor,
  MemoryExtractionWorkerBatchOutcome,
  MemoryExtractionWorkerErrorCode,
  MemoryExtractionWorkerJobOutcome,
} from "./memory-extraction-worker";
export type {
  ClaimedMemoryExtractionJob,
  MemoryExtractionJobCompletion,
  MemoryExtractionJobCompletionOutcome,
  MemoryExtractionJobStore,
} from "./memory-extraction-worker-data";
export type { MemoryEmbeddingContext } from "./memory-embedding-data";
export { MemoryEmbeddingContextLoadError } from "./memory-embedding-data";
export type {
  MemoryEmbeddingWorkerBatchOutcome,
  MemoryEmbeddingWorkerErrorCode,
  MemoryEmbeddingWorkerJobOutcome,
} from "./memory-embedding-worker";
export type {
  ClaimedMemoryEmbeddingJob,
  MemoryEmbeddingJobCompletion,
  MemoryEmbeddingJobCompletionOutcome,
  MemoryEmbeddingJobStore,
} from "./memory-embedding-worker-data";
export type {
  MemoryEmbeddingAdapter,
  MemoryEmbeddingAdapterDescriptor,
  MemoryEmbeddingPurpose,
  MemoryEmbeddingRequest,
  MemoryEmbeddingResponse,
  MemoryVectorErrorCode,
  MemoryVectorStore,
  RetrievedMemoryVector,
} from "./memory-vector";
export type {
  PersistedPlanExtraction,
  PlanExtractionContext,
  PlanExtractionDataErrorCode,
  PlanExtractionModelMetadata,
} from "../plan/plan-extraction-data";
export { PlanExtractionDataError } from "../plan/plan-extraction-data";
export type {
  PlanExtractionRuntimeDependencies,
  PlanExtractionRuntimeErrorCode,
  PlanExtractionRuntimeInput,
} from "../plan/plan-extraction-runtime";
export type {
  PlanExtractionExecutor,
  PlanExtractionWorkerErrorCode,
  PlanExtractionWorkerJobOutcome,
  PlanExtractionWorkerOutcome,
} from "../plan/plan-extraction-worker";
export type {
  ClaimedPlanExtractionJob,
  PlanExtractionJobCompletion,
  PlanExtractionJobCompletionOutcome,
  PlanExtractionJobStore,
} from "../plan/plan-extraction-worker-data";
export type {
  ModelAdapterDescriptor,
  ModelCapability,
  ModelFinishReason,
  ModelGenerationRequest,
  ModelGenerationResponse,
  ModelMessage,
  ModelMessageRole,
  ModelRequestMetadata,
  ModelStreamEvent,
  ModelStructuredRequest,
  ModelStructuredResponse,
  ModelUsage,
} from "./model-types";
