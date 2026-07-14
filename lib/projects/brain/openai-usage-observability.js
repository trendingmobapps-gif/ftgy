import { estimateOpenAiOperationCost } from "./openai-cost-estimation.js";
import { isFrontierModel } from "./openai-model-tiers.js";

const OUTPUT_TOKEN_WARNING_THRESHOLD = 20_000;
const REASONING_TOKEN_WARNING_THRESHOLD = 15_000;

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function extractOpenAiUsage(payload) {
  const usage = payload?.usage && typeof payload.usage === "object" ? payload.usage : {};

  const inputTokens = safeNumber(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = safeNumber(usage.output_tokens ?? usage.completion_tokens);
  const cachedInputTokens = safeNumber(
    usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens,
  );
  const reasoningTokens = safeNumber(usage.output_tokens_details?.reasoning_tokens);
  const totalTokens = safeNumber(usage.total_tokens);

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
}

export function logOpenAiUsageEvent(logFn, input) {
  if (typeof logFn !== "function") return;

  const cost = estimateOpenAiOperationCost({
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    reasoningTokens: input.reasoningTokens,
  });

  const payload = {
    event: "project_openai_usage",
    operation: input.operation || null,
    role: input.role || input.operation || null,
    model: input.model || null,
    selectedModelTier: input.selectedModelTier || input.modelTier || null,
    configuredReasoningEffort: input.configuredReasoningEffort || null,
    providerReasoningEffort: input.providerReasoningEffort || null,
    complexity: input.complexity || input.complexityLevel || null,
    complexityLevel: input.complexityLevel || input.complexity || null,
    complexitySignalsCount: input.complexitySignalsCount ?? null,
    highReasonCode: input.highReasonCode || null,
    maxOutputTokens: input.maxOutputTokens ?? null,
    maxTotalTokensPerOperation: input.maxTotalTokensPerOperation ?? null,
    attempt: input.attempt ?? null,
    fallbackUsed: Boolean(input.fallbackUsed),
    fallbackReason: input.fallbackReason || null,
    reuseHit: Boolean(input.reuseHit),
    reuseType: input.reuseType || null,
    evidenceHash: input.evidenceHash ? String(input.evidenceHash).slice(0, 16) : null,
    reused: Boolean(input.reused || input.reuseHit),
    inputTokens: input.inputTokens ?? null,
    cachedInputTokens: input.cachedInputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    reasoningTokens: input.reasoningTokens ?? null,
    totalTokens: input.totalTokens ?? null,
    latencyMs: input.latencyMs ?? null,
    success: Boolean(input.success),
    internalErrorCode: input.internalErrorCode || null,
    projectId: input.projectId || null,
    stepId: input.stepId || null,
    actionId: input.actionId || null,
    transport: input.transport || null,
    providerCallCount: input.providerCallCount ?? null,
    logicalOperationId: input.logicalOperationId || null,
    operationBudgetStatus: input.operationBudgetStatus || null,
    projectFrontierCallCount: input.projectFrontierCallCount ?? null,
    actionFrontierCallCount: input.actionFrontierCallCount ?? null,
    repairRole: input.repairRole || null,
    escalationUsed: Boolean(input.escalationUsed),
    estimatedCostBand: input.estimatedCostBand || cost.costBand,
  };

  logFn(payload);

  if ((input.outputTokens ?? 0) > OUTPUT_TOKEN_WARNING_THRESHOLD) {
    logFn({
      event: "project_openai_usage_warning",
      warning: "high_output_tokens",
      role: input.role || input.operation || null,
      operation: input.operation || null,
      projectId: input.projectId || null,
      outputTokens: input.outputTokens,
      threshold: OUTPUT_TOKEN_WARNING_THRESHOLD,
    });
  }

  if ((input.reasoningTokens ?? 0) > REASONING_TOKEN_WARNING_THRESHOLD) {
    logFn({
      event: "project_openai_usage_warning",
      warning: "high_reasoning_tokens",
      role: input.role || input.operation || null,
      operation: input.operation || null,
      projectId: input.projectId || null,
      reasoningTokens: input.reasoningTokens,
      threshold: REASONING_TOKEN_WARNING_THRESHOLD,
    });
  }

  if ((input.providerCallCount ?? 0) > 1) {
    logFn({
      event: "project_openai_usage_warning",
      warning: "multiple_provider_calls",
      role: input.role || input.operation || null,
      operation: input.operation || null,
      projectId: input.projectId || null,
      providerCallCount: input.providerCallCount,
      logicalOperationId: input.logicalOperationId || null,
    });
  }

  if (
    input.role &&
    ["extraction", "formatting", "evaluation", "executionPlanLegacy"].includes(input.role) &&
    (input.selectedModelTier === "frontier" || isFrontierModel(input.model))
  ) {
    logFn({
      event: "project_openai_usage_warning",
      warning: "frontier_for_mechanical_role",
      role: input.role,
      model: input.model || null,
      projectId: input.projectId || null,
    });
  }

  if (input.warning === "plan_regeneration_unchanged_evidence") {
    logFn({
      event: "project_openai_usage_warning",
      warning: "plan_regeneration_unchanged_evidence",
      projectId: input.projectId || null,
      actionId: input.actionId || null,
      evidenceHash: input.evidenceHash ? String(input.evidenceHash).slice(0, 16) : null,
    });
  }

  if (input.warning === "result_generation_duplicate_miss") {
    logFn({
      event: "project_openai_usage_warning",
      warning: "result_generation_duplicate_miss",
      projectId: input.projectId || null,
      actionId: input.actionId || null,
    });
  }

  if (input.warning === "frontier_limit_exceeded") {
    logFn({
      event: "project_openai_usage_warning",
      warning: "frontier_limit_exceeded",
      projectId: input.projectId || null,
      actionId: input.actionId || null,
      scope: input.scope || null,
    });
  }

  if (input.warning === "efficient_repair_failed_frontier_escalation") {
    logFn({
      event: "project_openai_usage_warning",
      warning: "efficient_repair_failed_frontier_escalation",
      role: input.role || null,
      projectId: input.projectId || null,
    });
  }

  if (input.operationBudgetStatus === "approaching_limit") {
    logFn({
      event: "project_openai_usage_warning",
      warning: "operation_token_ceiling_approaching",
      role: input.role || input.operation || null,
      projectId: input.projectId || null,
      consumedTokens: input.consumedTokens ?? null,
      maxTotalTokensPerOperation: input.maxTotalTokensPerOperation ?? null,
    });
  }
}

export function logRoadmapDuplicateGenerationWarning(logFn, input) {
  if (typeof logFn !== "function") return;
  logFn({
    event: "project_openai_usage_warning",
    warning: "roadmap_generation_skipped_duplicate",
    projectId: input.projectId || null,
    brainStatus: input.brainStatus || null,
    reason: input.reason || null,
    reuseHit: true,
    reuseType: input.reason || "duplicate_generation",
  });
}

export const OPENAI_USAGE_WARNING_THRESHOLDS = {
  outputTokens: OUTPUT_TOKEN_WARNING_THRESHOLD,
  reasoningTokens: REASONING_TOKEN_WARNING_THRESHOLD,
};
