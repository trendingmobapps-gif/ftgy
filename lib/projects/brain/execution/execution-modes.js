export const EXECUTION_MODES = [
  "assessment",
  "guided_questions",
  "structured_form",
  "checklist",
  "choice",
  "recommendation_selection",
  "research",
  "generator",
  "document_builder",
  "spreadsheet_builder",
  "image_generation",
  "upload_and_review",
  "conversation",
  "result_review",
];

/** Modes that may keep legacy tool missingFields → pending_question session flow. */
export const LEGACY_PENDING_QUESTION_MODES = new Set(["conversation"]);

export function allowsLegacyPendingQuestion(mode) {
  return LEGACY_PENDING_QUESTION_MODES.has(mode);
}

export function isPlanDrivenExecutionMode(mode) {
  return Boolean(mode) && !allowsLegacyPendingQuestion(mode);
}
