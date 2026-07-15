import { resolveActiveGenerationWindowMs, resolveOperationTimeoutMs } from "../openai-operation-timeout.js";
import { PROJECT_MODEL_ROLES } from "../project-model-policy.js";

function parseStartedAtMs(startedAt) {
  if (!startedAt) return null;
  const parsed = Date.parse(startedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildExecutionRecoveryMetadata({
  code,
  projectId,
  stepId,
  actionId,
  operation = PROJECT_MODEL_ROLES.resultGeneration,
  model = null,
  modelTier = null,
  reasoningEffort = null,
  configuredTimeoutMs = null,
  elapsedMs = null,
  abortSource = null,
  providerCallCount = 0,
  resultExists = false,
  persistenceOccurred = false,
  retrySafe = true,
} = {}) {
  return {
    code,
    recoverable: true,
    retryAllowed: retrySafe,
    at: new Date().toISOString(),
    projectId: projectId || null,
    stepId: stepId || null,
    actionId: actionId || null,
    operation,
    modelRole: operation,
    modelTier,
    model,
    reasoningEffort,
    configuredTimeoutMs,
    elapsedMs,
    abortSource,
    providerCallCount,
    resultExists,
    persistenceOccurred,
    retrySafe,
  };
}

export function withExecutionRecovery(preparedInput = {}, recovery = null) {
  if (!recovery) {
    return preparedInput || {};
  }
  return {
    ...(preparedInput || {}),
    _executionRecovery: recovery,
  };
}

export function resolveExecutionGenerationGate({
  action,
  executionPlan = null,
  complexityLevel = "standard",
  now = Date.now(),
} = {}) {
  if (!action) {
    return { allowed: true, reason: "missing_action" };
  }

  if (action.pending_result_id) {
    return {
      allowed: false,
      code: "RESULT_ALREADY_PENDING",
      reason: "pending_result_exists",
      pendingResultId: action.pending_result_id,
    };
  }

  const timeoutResolution = resolveOperationTimeoutMs({
    role: PROJECT_MODEL_ROLES.resultGeneration,
    complexityLevel,
  });
  const activeWindowMs = resolveActiveGenerationWindowMs(timeoutResolution);
  const startedAtMs = parseStartedAtMs(action.started_at);

  if (
    action.status === "in_progress" &&
    action.session_status === "generating" &&
    startedAtMs &&
    now - startedAtMs < activeWindowMs
  ) {
    return {
      allowed: false,
      code: "EXECUTION_IN_PROGRESS",
      reason: "generation_in_flight",
      activeWindowMs,
      elapsedMs: now - startedAtMs,
      executionMode: executionPlan?.mode || null,
    };
  }

  const recovery = action.prepared_input?._executionRecovery;
  if (
    recovery?.code === "PROJECT_ACTION_GENERATION_TIMEOUT" &&
    action.status === "prepared" &&
    action.session_status === "ready"
  ) {
    return {
      allowed: true,
      reason: "recoverable_timeout_retry",
      recovery,
    };
  }

  return { allowed: true, reason: "ready_to_execute" };
}

export function logGenerationTimeoutFailure(stageLog, metadata = {}) {
  if (typeof stageLog !== "function") return;
  stageLog("generation_timeout", metadata);
}

/**
 * Authoritative persisted shape after a generation timeout recovery write.
 * `recoverable_error` is a mobile lifecycle label — not a DB enum value.
 */
export function resolvePersistedTimeoutRecoveryState(actionRow = {}) {
  const recovery = actionRow?.prepared_input?._executionRecovery || null;
  return {
    actionStatus: actionRow?.status || null,
    sessionStatus: actionRow?.session_status || null,
    recoveryCode: recovery?.code || null,
    recoverable: recovery?.recoverable === true,
    retryAllowed: recovery?.retryAllowed === true,
    resultExists: Boolean(actionRow?.pending_result_id),
    collectedInputPreserved: Boolean(actionRow?.collected_input),
    mobileLifecycleState: "recoverable_error",
    mobileLifecycleSource: "client_resolver",
    dbLifecycleState: actionRow?.status === "prepared" && actionRow?.session_status === "ready"
      ? "ready_to_execute"
      : null,
  };
}
