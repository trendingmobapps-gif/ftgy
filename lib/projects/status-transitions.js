// Pure status-transition logic for the Projects backend. No I/O.
// Encodes the Phase 1 transition rules and the timestamp side effects that
// must accompany each target status.

import {
  PROJECT_STATUSES,
  PROJECT_STATUS_TRANSITIONS,
} from "./constants.js";

export function isValidStatus(status) {
  return PROJECT_STATUSES.includes(status);
}

// True when `from -> to` is an allowed Phase 1 transition.
export function canTransition(from, to) {
  if (!isValidStatus(from) || !isValidStatus(to)) return false;
  const allowed = PROJECT_STATUS_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

// Builds the DB column patch for a status change, including timestamp rules.
// `nowIso` is injected so tests are deterministic. Always bumps
// last_activity_at. Returns a snake_case column object.
//
// Timestamp rules:
//   active    -> paused_at = null (does NOT clear completed_at/archived_at)
//   paused    -> paused_at = now, completed_at = null, archived_at = null
//   completed -> completed_at = now, paused_at = null, archived_at = null
//   archived  -> archived_at = now, paused_at = null
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
