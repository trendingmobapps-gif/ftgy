// Shared Projects constants for the universal Projects backend.
// These values are the single source of truth for category slugs, statuses,
// allowed status transitions, field limits, and error codes. Mobile and web
// consume the same API, so these must never diverge per-client.

// Canonical category slugs. Use EXACT values (no kebab/snake conversion).
export const PROJECT_CATEGORY_SLUGS = [
  "business",
  "studii",
  "cariera",
  "fitness",
  "finante",
  "comunicare",
  "socialMedia",
  "viataPersonala",
];

// Allowed project statuses.
export const PROJECT_STATUSES = ["active", "paused", "completed", "archived"];

// Allowed Phase 1 status transitions (from -> set of allowed target statuses).
// Reopening completed/archived projects is intentionally not supported.
export const PROJECT_STATUS_TRANSITIONS = {
  active: ["paused", "completed", "archived"],
  paused: ["active", "completed", "archived"],
  completed: ["archived"],
  archived: [],
};

// Conservative field length limits (characters).
export const PROJECT_FIELD_LIMITS = {
  name: 120,
  goal: 5000,
  description: 10000,
  summary: 5000,
  iconKey: 60,
  accentKey: 60,
  search: 200,
};

// Fallback project name when nothing usable can be derived from the goal.
export const PROJECT_FALLBACK_NAME = "Proiect nou";

// Editable fields for the generic update endpoint. Status, ownership, workflow
// and timestamp columns are intentionally excluded.
export const PROJECT_EDITABLE_FIELDS = [
  "name",
  "goal",
  "description",
  "summary",
  "categorySlug",
  "iconKey",
  "accentKey",
];

// Phase 1 sort keys mapped to their underlying database columns. This is a
// strict allowlist: user input is never used directly as a column name.
export const PROJECT_SORT_COLUMNS = {
  lastActivity: "last_activity_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
  name: "name",
};

export const PROJECT_DEFAULT_SORT = "lastActivity";
export const PROJECT_DEFAULT_DIRECTION = "desc";

// Pagination guards.
export const PROJECT_DEFAULT_LIMIT = 50;
export const PROJECT_MAX_LIMIT = 100;

// Stable error codes returned in the API error envelope.
export const PROJECT_ERROR_CODES = {
  VALIDATION: "PROJECT_VALIDATION_ERROR",
  UNAUTHENTICATED: "PROJECT_UNAUTHENTICATED",
  NOT_FOUND: "PROJECT_NOT_FOUND",
  INVALID_TRANSITION: "PROJECT_INVALID_STATUS_TRANSITION",
  ARCHIVED_READONLY: "PROJECT_ARCHIVED_READONLY",
  METHOD_NOT_ALLOWED: "PROJECT_METHOD_NOT_ALLOWED",
  INTERNAL: "PROJECT_INTERNAL_ERROR",
};

// Columns selected from the projects table. Ownership-only debugging columns
// are still selected server-side (needed for logic) but never serialized out.
export const PROJECT_SELECT_COLUMNS = [
  "id",
  "user_id",
  "name",
  "goal",
  "description",
  "summary",
  "category_slug",
  "status",
  "icon_key",
  "accent_key",
  "active_workflow_id",
  "active_workflow_run_id",
  "created_at",
  "updated_at",
  "last_activity_at",
  "paused_at",
  "completed_at",
  "archived_at",
].join(",");
