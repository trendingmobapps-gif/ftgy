export const PROJECT_ACTION_STATUSES = ["prepared", "in_progress", "completed", "failed"];

export const PROJECT_SESSION_STATUSES = [
  "open",
  "collecting",
  "ready",
  "generating",
  "review",
  "accepted",
  "ready_to_finalize",
  "cancelled",
];

export const PROJECT_RESULT_ACCEPTANCE_STATUSES = ["pending_review", "accepted", "rejected"];

export const PROJECT_ACTION_CAPABILITY_TYPES = ["tool", "project_brain"];

export const PROJECT_ACTION_RESULT_TYPES = ["text", "summary", "document"];

export const PROJECT_ACTION_ERROR_CODES = {
  VALIDATION: "PROJECT_ACTION_VALIDATION_ERROR",
  NOT_FOUND: "PROJECT_ACTION_NOT_FOUND",
  ARCHIVED_READONLY: "PROJECT_ACTION_ARCHIVED_READONLY",
  STEP_COMPLETED_READONLY: "PROJECT_STEP_COMPLETED_READONLY",
  STEP_NOT_ACTIONABLE: "PROJECT_ACTION_STEP_NOT_ACTIONABLE",
  RESULT_REQUIRED: "PROJECT_ACTION_RESULT_REQUIRED",
  EXECUTION_FAILED: "PROJECT_ACTION_EXECUTION_FAILED",
  STEP_INCOMPLETE: "PROJECT_STEP_INCOMPLETE",
  EXECUTION_PROGRESS_VALIDATION: "PROJECT_EXECUTION_PROGRESS_VALIDATION_ERROR",
  EXECUTION_PROGRESS_INTERNAL: "PROJECT_EXECUTION_PROGRESS_INTERNAL_ERROR",
  INTERNAL: "PROJECT_ACTION_INTERNAL_ERROR",
};

export const PROJECT_ACTION_LIMITS = {
  maxPreviewChars: 500,
  maxContentChars: 120_000,
  maxPromptChars: 8_000,
  generationTimeoutMs: 90_000,
};

export const ACTION_SELECT_COLUMNS = [
  "id",
  "step_id",
  "project_id",
  "workflow_id",
  "user_id",
  "status",
  "session_status",
  "capability_type",
  "capability_ref",
  "title",
  "explanation",
  "why_it_matters",
  "expected_result",
  "prepared_prompt",
  "prepared_input",
  "missing_fields",
  "collected_input",
  "conversation",
  "pending_question",
  "pending_result_id",
  "estimated_effort_label",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at",
].join(",");

export const ACTION_RESULT_SELECT_COLUMNS = [
  "id",
  "action_id",
  "step_id",
  "project_id",
  "user_id",
  "result_type",
  "acceptance_status",
  "title",
  "preview",
  "content",
  "created_at",
].join(",");
