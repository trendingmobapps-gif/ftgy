import { PROJECT_STATUSES, PROJECT_STATUS_TRANSITIONS } from "./constants.js";

export function isValidStatus(status) {
  return PROJECT_STATUSES.includes(status);
}

export function canTransition(from, to) {
  if (!isValidStatus(from) || !isValidStatus(to)) return false;
  const allowed = PROJECT_STATUS_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export function buildStatusUpdate(targetStatus, nowIso) {
  const now = nowIso || new Date().toISOString();
  const patch = { status: targetStatus, last_activity_at: now };

  switch (targetStatus) {
    case "active":
      patch.paused_at = null;
      break;
    case "paused":
      patch.paused_at = now;
      patch.completed_at = null;
      patch.archived_at = null;
      break;
    case "completed":
      patch.completed_at = now;
      patch.paused_at = null;
      patch.archived_at = null;
      break;
    case "archived":
      patch.archived_at = now;
      patch.paused_at = null;
      break;
    default:
      break;
  }

  return patch;
}
