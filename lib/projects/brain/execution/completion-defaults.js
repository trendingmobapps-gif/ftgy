/**
 * Single source of truth for completion-criteria defaults per execution mode.
 *
 * Both the execution-plan generator (stamping new plans) and the completion
 * evaluator (validating steps whose plans lack explicit criteria) must resolve
 * absent values through this table. Explicit plan criteria always win.
 *
 * Mirrored on mobile in src/utils/projectCompletionCriteria.ts.
 */
const REQUIRE_GENERATED_RESULT_DEFAULTS = Object.freeze({
  assessment: true,
  guided_questions: true,
  structured_form: true,
  checklist: false,
  choice: true,
  recommendation_selection: true,
  research: true,
  generator: true,
  document_builder: true,
  spreadsheet_builder: true,
  image_generation: true,
  upload_and_review: true,
  conversation: true,
  result_review: false,
});

export function defaultRequireGeneratedResultForMode(mode) {
  if (!mode) return false;
  const value = REQUIRE_GENERATED_RESULT_DEFAULTS[mode];
  return typeof value === "boolean" ? value : true;
}

export { REQUIRE_GENERATED_RESULT_DEFAULTS };
