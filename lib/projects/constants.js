// Shared Projects constants for the universal Projects backend.

export const PROJECT_CATEGORY_SLUGS = [
  "business",
  "studii",
  "cariera",
  "fitness",
  "finante",
  "comunicare",
  "socialMedia",
  "viataPersonala",
  "universal",
];

export const PROJECT_STATUSES = ["active", "paused", "completed", "archived"];

export const PROJECT_STATUS_TRANSITIONS = {
  active: ["paused", "completed", "archived"],
  paused: ["active", "completed", "archived"],
  completed: ["archived"],
  archived: [],
};

export const PROJECT_FIELD_LIMITS = {
  name: 120,
  goal: 5000,
  description: 10000,
  summary: 5000,
  iconKey: 60,
  accentKey: 60,
  search: 200,
};

export const PROJECT_FALLBACK_NAME = "Proiect nou";

export const PROJECT_EDITABLE_FIELDS = [
  "name",
  "goal",
  "description",
  "summary",
  "categorySlug",
  "iconKey",
  "accentKey",
];

export const PROJECT_SORT_COLUMNS = {
  lastActivity: "last_activity_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
  name: "name",
};

export const PROJECT_DEFAULT_SORT = "lastActivity";
export const PROJECT_DEFAULT_DIRECTION = "desc";
export const PROJECT_DEFAULT_LIMIT = 50;
export const PROJECT_MAX_LIMIT = 100;

export const PROJECT_BRAIN_STATUSES = ["pending", "generating", "ready", "failed"];

export const PROJECT_ERROR_CODES = {
  VALIDATION: "PROJECT_VALIDATION_ERROR",
  UNAUTHENTICATED: "PROJECT_UNAUTHENTICATED",
  NOT_FOUND: "PROJECT_NOT_FOUND",
  INVALID_TRANSITION: "PROJECT_INVALID_STATUS_TRANSITION",
  ARCHIVED_READONLY: "PROJECT_ARCHIVED_READONLY",
  METHOD_NOT_ALLOWED: "PROJECT_METHOD_NOT_ALLOWED",
  INTERNAL: "PROJECT_INTERNAL_ERROR",
  SAFETY_BLOCKED: "PROJECT_SAFETY_BLOCKED",
};

export const PROJECT_BASE_SELECT_COLUMNS = [
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
];

export const PROJECT_BRAIN_SELECT_COLUMNS = [
  "brain_status",
  "brain_version",
  "brain_generated_at",
  "brain_failure_code",
  "brain_attempt_count",
];

let brainSelectColumnsEnabled = false;

export function enableProjectBrainSelectColumns() {
  brainSelectColumnsEnabled = true;
}

export function resetProjectBrainSelectColumnsForTests() {
  brainSelectColumnsEnabled = false;
}

export function getProjectSelectColumns() {
  const columns = brainSelectColumnsEnabled
    ? [...PROJECT_BASE_SELECT_COLUMNS, ...PROJECT_BRAIN_SELECT_COLUMNS]
    : PROJECT_BASE_SELECT_COLUMNS;
  return columns.join(",");
}

export const PROJECT_SELECT_COLUMNS = getProjectSelectColumns();
