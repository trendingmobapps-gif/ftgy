export const PROJECT_BRAIN_STATUSES = ["pending", "generating", "ready", "failed"];

export const PROJECT_WORKFLOW_COMPLEXITIES = ["low", "medium", "high"];

export const PROJECT_MILESTONE_STATUSES = ["pending", "in_progress", "completed"];

export const PROJECT_STEP_STATUSES = ["pending", "in_progress", "completed", "skipped"];

export const PROJECT_STEP_PRIORITIES = ["low", "medium", "high"];

export const PROJECT_BRAIN_ERROR_CODES = {
  VALIDATION: "PROJECT_BRAIN_VALIDATION_ERROR",
  NOT_FOUND: "PROJECT_BRAIN_NOT_FOUND",
  FORBIDDEN: "PROJECT_BRAIN_FORBIDDEN",
  GENERATION_IN_PROGRESS: "PROJECT_BRAIN_GENERATION_IN_PROGRESS",
  GENERATION_FAILED: "PROJECT_BRAIN_GENERATION_FAILED",
  GENERATION_LIMIT: "PROJECT_BRAIN_GENERATION_LIMIT",
  RATE_LIMITED: "PROJECT_BRAIN_RATE_LIMITED",
  ARCHIVED_READONLY: "PROJECT_BRAIN_ARCHIVED_READONLY",
  SAFETY_BLOCKED: "PROJECT_BRAIN_SAFETY_BLOCKED",
  INTERNAL: "PROJECT_BRAIN_INTERNAL_ERROR",
};

export const PROJECT_BRAIN_FAILURE_CODES = {
  PROVIDER_ERROR: "provider_error",
  INVALID_OUTPUT: "invalid_output",
  SAFETY_REJECTED: "safety_rejected",
  PERSISTENCE_ERROR: "persistence_error",
  TIMEOUT: "timeout",
};

export const PROJECT_BRAIN_LIMITS = {
  minMilestones: 3,
  maxMilestones: 6,
  minStepsPerMilestone: 2,
  maxStepsPerMilestone: 6,
  minTotalSteps: 8,
  maxTotalSteps: 24,
  maxGoalContextLength: 6000,
  maxOutputChars: 120_000,
  maxAttempts: 3,
  generationTimeoutMs: 90_000,
  staleGeneratingMs: 10 * 60 * 1000,
};

export const PROJECT_BRAIN_MODEL =
  process.env.PROJECT_BRAIN_MODEL?.trim() || "gpt-4.1";

export const PROJECT_BRAIN_VERSION =
  process.env.PROJECT_BRAIN_VERSION?.trim() || "1.0.0";

export const PROJECT_BRAIN_TEMPERATURE = 0.2;

export const PROJECT_STEP_ALLOWED_TRANSITIONS = {
  pending: ["in_progress", "completed", "skipped"],
  in_progress: ["completed", "pending", "skipped"],
  completed: ["pending", "in_progress"],
  skipped: ["pending", "in_progress"],
};

export const WORKFLOW_SELECT_COLUMNS = [
  "id",
  "project_id",
  "user_id",
  "summary",
  "current_stage",
  "complexity",
  "estimated_duration_label",
  "brain_version",
  "status",
  "generated_at",
  "created_at",
  "updated_at",
].join(",");

export const MILESTONE_SELECT_COLUMNS = [
  "id",
  "workflow_id",
  "project_id",
  "user_id",
  "title",
  "description",
  "position",
  "status",
  "created_at",
  "updated_at",
].join(",");

export const STEP_SELECT_COLUMNS = [
  "id",
  "milestone_id",
  "workflow_id",
  "project_id",
  "user_id",
  "title",
  "description",
  "expected_outcome",
  "rationale",
  "position",
  "priority",
  "estimated_effort_label",
  "status",
  "tool_id",
  "tool_slug",
  "tool_name",
  "tool_category_slug",
  "completed_at",
  "created_at",
  "updated_at",
].join(",");
