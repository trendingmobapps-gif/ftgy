import { hasPersistedConversation } from "./normalize.js";
import { getExecutionPlanFromPreparedInput } from "../execution/execution-plan-generator.js";
import { EXECUTION_PLAN_VERSION } from "../execution/execution-plan-validation.js";
import { allowsLegacyPendingQuestion } from "../execution/execution-modes.js";

export const TERMINAL_ACTION_STATUSES = new Set(["completed", "failed", "archived"]);

export const ACTIVE_ACTION_STATUSES = new Set(["prepared", "in_progress"]);

export function isStepCompleted(step) {
  return step?.status === "completed" || step?.status === "skipped";
}

export function isStepMutable(step) {
  return Boolean(step) && !isStepCompleted(step);
}

export function isActionTerminal(action) {
  return Boolean(action?.status) && TERMINAL_ACTION_STATUSES.has(action.status);
}

export function isActionActive(action) {
  return Boolean(action) && !isActionTerminal(action);
}

export function getPersistedExecutionPlan(action) {
  return getExecutionPlanFromPreparedInput(action?.prepared_input);
}

export function getPersistedContractVersion(action) {
  const plan = getPersistedExecutionPlan(action);
  return plan?.metadata?.version || plan?.version || null;
}

export function hasLegacyToolPendingQuestion(action) {
  const pending = action?.pending_question || action?.pendingQuestion || null;
  if (!pending?.key) {
    return false;
  }

  const missingFields = Array.isArray(action?.missing_fields) ? action.missing_fields : [];
  return missingFields.some((field) => field?.key === pending.key);
}

export function hasLegacySessionConflict(action, executionPlan) {
  if (!action || !executionPlan?.mode) {
    return false;
  }
  if (allowsLegacyPendingQuestion(executionPlan.mode)) {
    return false;
  }
  return hasLegacyToolPendingQuestion(action);
}

export function canSafelySanitizeLegacySession(action, executionPlan) {
  if (!hasLegacySessionConflict(action, executionPlan)) {
    return false;
  }
  return isActionCompatibleWithPlan(action, executionPlan);
}

export function isActionCompatibleWithPlan(action, plan) {
  if (!action || !plan?.mode) {
    return true;
  }

  const persisted = getPersistedExecutionPlan(action);
  if (!persisted?.mode) {
    return true;
  }

  if (persisted.mode !== plan.mode) {
    return false;
  }

  const persistedVersion = persisted.metadata?.version || persisted.version || 1;
  if (persistedVersion < EXECUTION_PLAN_VERSION) {
    return false;
  }

  return true;
}

export function shouldResumeExistingAction({ step, action, executionPlan = null, forceRegenerateInvalidPlan = false }) {
  if (!action || !isStepMutable(step)) {
    return false;
  }
  if (isActionTerminal(action)) {
    return false;
  }
  if (forceRegenerateInvalidPlan) {
    return false;
  }

  const persistedPlan = getPersistedExecutionPlan(action);
  if (executionPlan && persistedPlan?.mode && persistedPlan.mode !== executionPlan.mode) {
    return false;
  }

  if (action.status === "in_progress") {
    if (executionPlan && !isActionCompatibleWithPlan(action, executionPlan)) {
      return false;
    }
    return true;
  }

  if (!hasPersistedConversation(action)) {
    return false;
  }

  if (executionPlan && !isActionCompatibleWithPlan(action, executionPlan)) {
    return false;
  }

  return true;
}

export function shouldReplaceIncompatiblePreparedAction({ step, action, executionPlan, forceRegenerateInvalidPlan = false }) {
  if (!action || !isStepMutable(step) || isActionTerminal(action)) {
    return false;
  }
  if (forceRegenerateInvalidPlan) {
    return true;
  }
  if (!executionPlan?.mode) {
    return false;
  }
  if (canSafelySanitizeLegacySession(action, executionPlan)) {
    return false;
  }
  return !isActionCompatibleWithPlan(action, executionPlan);
}

export function shouldReplaceTerminalAction({ step, action }) {
  return isStepMutable(step) && Boolean(action) && isActionTerminal(action);
}

export function buildActionArchiveSnapshot(action, { reason = "replaced" } = {}) {
  if (!action) return null;

  return {
    archivedAt: new Date().toISOString(),
    reason,
    actionId: action.id,
    status: action.status,
    sessionStatus: action.session_status || null,
    preparedInput: action.prepared_input || {},
    collectedInput: action.collected_input || {},
    conversation: action.conversation || [],
    completedAt: action.completed_at || null,
  };
}

export function appendActionHistory(preparedInput = {}, snapshot) {
  if (!snapshot) {
    return preparedInput || {};
  }

  const base = preparedInput && typeof preparedInput === "object" ? { ...preparedInput } : {};
  const history = Array.isArray(base._actionHistory) ? [...base._actionHistory] : [];
  history.push(snapshot);
  return {
    ...base,
    _actionHistory: history.slice(-8),
  };
}

export function extractCompatibleCollectedInput(action) {
  const interactive = action?.collected_input?.interactive;
  if (!interactive || typeof interactive !== "object") {
    return {};
  }

  const compatible = {};
  if (interactive.type === "structured_form" && interactive.formValues) {
    compatible.interactive = {
      type: "structured_form",
      formValues: { ...interactive.formValues },
    };
  }
  if (interactive.type === "choice" && interactive.selectedChoice) {
    compatible.interactive = {
      type: "choice",
      selectedChoice: interactive.selectedChoice,
    };
  }
  if (interactive.type === "checklist" && interactive.checklistChecked) {
    compatible.interactive = {
      type: "checklist",
      checklistChecked: { ...interactive.checklistChecked },
    };
  }
  if (interactive.type === "recommendation_selection") {
    compatible.interactive = {
      type: "recommendation_selection",
      selectedRecommendations: interactive.selectedRecommendations || [],
      priorityOrder: interactive.priorityOrder || [],
      customOptions: interactive.customOptions || [],
      confirmed: false,
    };
  }

  return compatible;
}
