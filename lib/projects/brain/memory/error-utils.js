export function extractSupabaseError(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return null;
  }
  if (!payload.message && !payload.code) {
    return null;
  }
  return {
    code: payload.code ? String(payload.code) : null,
    message: payload.message ? String(payload.message) : null,
    details: payload.details ? String(payload.details) : null,
    hint: payload.hint ? String(payload.hint) : null,
  };
}

export function sanitizeSupabaseErrorMessage(message) {
  if (!message) return null;
  return String(message)
    .replace(/['"][^'"]{24,}['"]/g, '"[redacted]"')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .slice(0, 300);
}

export function categorizeProjectMemoryWriteError(status, error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");

  if (code === "42P01" || message.includes('relation "') && message.includes("does not exist")) {
    return "snapshot_schema_incompatible";
  }
  if (
    code === "23514" ||
    message.includes("check constraint") ||
    message.includes("violates check")
  ) {
    return "snapshot_schema_incompatible";
  }
  if (code === "23505" || message.includes("duplicate key") || message.includes("unique constraint")) {
    return "snapshot_conflict_failed";
  }
  if (message.includes("on_conflict") || message.includes("no unique or exclusion constraint")) {
    return "snapshot_schema_incompatible";
  }
  if (status === 401 || status === 403 || message.includes("row-level security")) {
    return "snapshot_write_failed";
  }
  return "snapshot_write_failed";
}

export function mapErrorCategoryToInternalCode(category) {
  switch (category) {
    case "snapshot_schema_incompatible":
      return "PROJECT_BRAIN_SNAPSHOT_SCHEMA_INCOMPATIBLE";
    case "snapshot_conflict_failed":
      return "PROJECT_BRAIN_SNAPSHOT_CONFLICT_FAILED";
    case "snapshot_write_failed":
      return "PROJECT_BRAIN_SNAPSHOT_WRITE_FAILED";
    default:
      return "PROJECT_BRAIN_SNAPSHOT_PERSIST_FAILED";
  }
}
