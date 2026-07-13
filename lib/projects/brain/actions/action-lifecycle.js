import { hasPersistedConversation } from "./normalize.js";

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

export function shouldResumeExistingAction({ step, action }) {
  if (!action || !isStepMutable(step)) {
    return false;
  }
  if (isActionTerminal(action)) {
    return false;
  }
  if (action.status === "in_progress") {
    return true;
  }
  return hasPersistedConversation(action);
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
