// Serializes a raw Supabase `projects` row (snake_case) into the stable
// camelCase API contract shared by mobile and web. Ownership and internal
// debugging fields (user_id, email, profile_id, raw columns) are never
// exposed, and no fabricated progress/health fields are added.

// Converts an empty string to null; passes through other values unchanged.
function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

export function serializeProject(row) {
  if (!row || typeof row !== "object") return null;

  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    description: emptyToNull(row.description),
    summary: emptyToNull(row.summary),
    categorySlug: emptyToNull(row.category_slug),
    status: row.status,
    iconKey: emptyToNull(row.icon_key),
    accentKey: emptyToNull(row.accent_key),
    activeWorkflowId: emptyToNull(row.active_workflow_id),
    activeWorkflowRunId: emptyToNull(row.active_workflow_run_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
    pausedAt: emptyToNull(row.paused_at),
    completedAt: emptyToNull(row.completed_at),
    archivedAt: emptyToNull(row.archived_at),
  };
}

// Serializes an array of rows, dropping any null/invalid entries.
export function serializeProjects(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(serializeProject).filter(Boolean);
}
