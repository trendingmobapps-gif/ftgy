import { PROJECT_MODEL_ROLES } from "./project-model-policy.js";

/** Fallback when timeout resolution input is incomplete. */
const PROJECT_ACTION_FALLBACK_TIMEOUT_MS = 180_000;

/** Vercel maxDuration for projects-execute-action (see vercel.json). */
export const VERCEL_EXECUTE_ACTION_MAX_DURATION_MS = 300_000;

/** Reserved for validation, persistence, and response serialization. */
export const VERCEL_EXECUTE_ACTION_RUNTIME_BUFFER_MS = 20_000;

const ROLE_TIMEOUT_BUDGETS_MS = {
  [PROJECT_MODEL_ROLES.extraction]: 45_000,
  [PROJECT_MODEL_ROLES.formatting]: 45_000,
  [PROJECT_MODEL_ROLES.evaluation]: 60_000,
  [PROJECT_MODEL_ROLES.roadmap]: 180_000,
  [PROJECT_MODEL_ROLES.experienceDesign]: 90_000,
  [PROJECT_MODEL_ROLES.executionPlanLegacy]: 90_000,
  [PROJECT_MODEL_ROLES.decision]: 90_000,
  [PROJECT_MODEL_ROLES.resultGeneration]: {
    simple: 90_000,
    standard: 180_000,
    complex: 240_000,
    exceptional: 240_000,
  },
  [PROJECT_MODEL_ROLES.resultRevision]: {
    simple: 90_000,
    standard: 120_000,
    complex: 180_000,
    exceptional: 240_000,
  },
  [PROJECT_MODEL_ROLES.researchSynthesis]: {
    simple: 120_000,
    standard: 180_000,
    complex: 240_000,
    exceptional: 240_000,
  },
};

function resolveRoleBudget(role, complexityLevel = "standard") {
  const entry = ROLE_TIMEOUT_BUDGETS_MS[role] || ROLE_TIMEOUT_BUDGETS_MS[PROJECT_MODEL_ROLES.resultGeneration];
  if (typeof entry === "number") {
    return entry;
  }
  return entry[complexityLevel] || entry.standard || PROJECT_ACTION_FALLBACK_TIMEOUT_MS;
}

/**
 * Operation-aware provider timeout. Always stays below the configured Vercel runtime limit.
 */
export function resolveOperationTimeoutMs({
  role = PROJECT_MODEL_ROLES.resultGeneration,
  complexityLevel = "standard",
  runtimeMaxDurationMs = VERCEL_EXECUTE_ACTION_MAX_DURATION_MS,
  runtimeBufferMs = VERCEL_EXECUTE_ACTION_RUNTIME_BUFFER_MS,
} = {}) {
  const configuredBudgetMs = resolveRoleBudget(role, complexityLevel);
  const runtimeCeilingMs = Math.max(30_000, runtimeMaxDurationMs - runtimeBufferMs);
  const timeoutMs = Math.min(configuredBudgetMs, runtimeCeilingMs);

  return {
    role,
    complexityLevel,
    configuredBudgetMs,
    runtimeMaxDurationMs,
    runtimeBufferMs,
    runtimeCeilingMs,
    timeoutMs,
    abortSource: "operation_timeout_controller",
  };
}

export function resolveActiveGenerationWindowMs(timeoutResolution) {
  const base = timeoutResolution?.timeoutMs || PROJECT_ACTION_FALLBACK_TIMEOUT_MS;
  return base + 30_000;
}
