import { PROJECT_MODEL_INTERNAL_CODES } from "./project-model-internal-codes.js";
import { isFrontierModel } from "./openai-model-tiers.js";

function readPositiveInt(name, fallback) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function readBudgetUsd(name, fallback) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function resolveProjectsCostGuardSettings() {
  const isPreview = process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV === "development";
  return {
    isPreview,
    maxFrontierCallsPerProjectCreation: readPositiveInt("PROJECTS_MAX_FRONTIER_CALLS_PER_PROJECT_CREATION", isPreview ? 1 : 2),
    maxFrontierCallsPerAction: readPositiveInt("PROJECTS_MAX_FRONTIER_CALLS_PER_ACTION", isPreview ? 1 : 3),
    maxTotalTokensPerOperation: readPositiveInt("PROJECTS_MAX_TOTAL_MODEL_TOKENS_PER_OPERATION", 120_000),
    previewDailyBudgetUsd: readBudgetUsd("PROJECTS_PREVIEW_DAILY_MODEL_BUDGET_USD", 5),
    productionDailyBudgetUsd: readBudgetUsd("PROJECTS_PRODUCTION_DAILY_MODEL_BUDGET_USD", 50),
  };
}

export function createOperationBudgetTracker({ maxTotalTokensPerOperation }) {
  return {
    consumedTokens: 0,
    maxTotalTokensPerOperation,
  };
}

export function recordOperationTokenUsage(tracker, usage = {}) {
  if (!tracker) return tracker;
  const delta =
    (Number(usage.inputTokens) || 0) +
    (Number(usage.outputTokens) || 0) +
    (Number(usage.reasoningTokens) || 0);
  tracker.consumedTokens += delta;
  return tracker;
}

export function evaluateOperationTokenBudget(tracker) {
  if (!tracker) {
    return { allowed: true, status: "unknown" };
  }
  if (tracker.consumedTokens >= tracker.maxTotalTokensPerOperation) {
    return {
      allowed: false,
      status: "exceeded",
      internalErrorCode: PROJECT_MODEL_INTERNAL_CODES.TOKEN_LIMIT_EXCEEDED,
    };
  }
  if (tracker.consumedTokens >= tracker.maxTotalTokensPerOperation * 0.85) {
    return { allowed: true, status: "approaching_limit" };
  }
  return { allowed: true, status: "ok" };
}

export function evaluateFrontierCallLimit({
  frontierCallCount = 0,
  limit,
  scope = "project",
}) {
  if (frontierCallCount >= limit) {
    return {
      allowed: false,
      internalErrorCode: PROJECT_MODEL_INTERNAL_CODES.FRONTIER_CALL_LIMIT_EXCEEDED,
      scope,
    };
  }
  return { allowed: true };
}

export function evaluateOperationBudget({
  runtimePolicy,
  tracker,
  frontierCallCount = 0,
  actionFrontierCallCount = 0,
  budgetScope = null,
  settings = resolveProjectsCostGuardSettings(),
}) {
  const tokenBudget = evaluateOperationTokenBudget(tracker);
  if (!tokenBudget.allowed) {
    return {
      allowed: false,
      internalErrorCode: tokenBudget.internalErrorCode,
      operationBudgetStatus: tokenBudget.status,
    };
  }

  if (runtimePolicy?.modelTier === "frontier" || isFrontierModel(runtimePolicy?.model)) {
    const resolvedScope =
      budgetScope ||
      (runtimePolicy?.role === "roadmap" ? "project_creation" : "action");

    if (resolvedScope === "project_creation") {
      const projectLimit = evaluateFrontierCallLimit({
        frontierCallCount,
        limit: settings.maxFrontierCallsPerProjectCreation,
        scope: "project_creation",
      });
      if (!projectLimit.allowed) {
        return {
          allowed: false,
          internalErrorCode: projectLimit.internalErrorCode,
          operationBudgetStatus: "frontier_project_limit",
        };
      }
    }

    if (resolvedScope === "action") {
      const actionLimit = evaluateFrontierCallLimit({
        frontierCallCount: actionFrontierCallCount,
        limit: settings.maxFrontierCallsPerAction,
        scope: "action",
      });
      if (!actionLimit.allowed) {
        return {
          allowed: false,
          internalErrorCode: actionLimit.internalErrorCode,
          operationBudgetStatus: "frontier_action_limit",
        };
      }
    }
  }

  return {
    allowed: true,
    operationBudgetStatus: tokenBudget.status,
  };
}

export function buildOpenAiRequestMetadata({
  role,
  projectId = null,
  liveTest = false,
}) {
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
  const projectHash = projectId
    ? String(projectId).replace(/-/g, "").slice(0, 12)
    : null;

  return {
    iter_environment: environment,
    iter_operation_role: role || null,
    iter_project_id_hash: projectHash,
    iter_live_test: Boolean(liveTest),
  };
}
