const ALLOWED_DB_SESSION_STATUSES = new Set([
  "open",
  "collecting",
  "ready",
  "generating",
  "review",
  "accepted",
  "cancelled",
]);

export function persistSessionStatus(phase) {
  const normalized = String(phase || "").trim();
  if (normalized === "ready_to_finalize") {
    return "accepted";
  }
  if (ALLOWED_DB_SESSION_STATUSES.has(normalized)) {
    return normalized;
  }
  return "collecting";
}

export function isReadyToFinalizeStoredStatus(sessionStatus, collectedInput = {}) {
  const interactive = collectedInput?.interactive;
  return (
    sessionStatus === "accepted" &&
    (interactive?.resultAccepted === true || interactive?.confirmed === true)
  );
}
