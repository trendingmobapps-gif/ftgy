import { EXECUTION_MODES } from "./execution-modes.js";
import { isInteractivePlanMode } from "./execution-plan-schema.js";

export const EXECUTION_PLAN_VERSION = 2;

const ENROLLMENT_MARKERS = [
  "inscri",
  "enroll",
  "scolar",
  "scoala",
  "școal",
  "matricul",
  "admitere",
  "documente",
  "dosar",
];

const DECISION_MARKERS = ["alege", "decide", "variant", "optiune", "compar", "select"];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isEnrollmentContext(context = {}) {
  const haystack = normalizeText(
    `${context.projectName || ""} ${context.projectGoal || ""} ${context.stepTitle || ""} ${context.stepDescription || ""} ${context.expectedOutcome || ""}`,
  );
  return ENROLLMENT_MARKERS.some((marker) => haystack.includes(marker));
}

function isDecisionContext(context = {}) {
  const haystack = normalizeText(
    `${context.stepTitle || ""} ${context.stepDescription || ""} ${context.expectedOutcome || ""}`,
  );
  return DECISION_MARKERS.some((marker) => haystack.includes(marker));
}

function countValidChoices(plan) {
  return (plan?.choices || []).filter((choice) => choice?.id && choice?.title).length;
}

function countValidQuestions(plan) {
  return (plan?.questions || []).filter((question) => question?.id && question?.prompt).length;
}

function countValidFields(plan) {
  return (plan?.requiredInputs || []).filter((field) => field?.id && field?.type && field?.label).length;
}

function countValidChecklistItems(plan) {
  return (plan?.checklistItems || []).filter((item) => item?.id && item?.label).length;
}

export function validateModeSpecificContent(plan) {
  if (!plan || typeof plan !== "object") {
    return { valid: false, reason: "malformed_plan" };
  }

  const mode = plan.mode;

  if (mode === "assessment") {
    const questions = countValidQuestions(plan);
    if (questions < 1) return { valid: false, reason: "assessment_needs_questions" };
    for (const question of plan.questions || []) {
      if (!question?.prompt) return { valid: false, reason: "assessment_missing_prompt" };
      if (
        (question.type === "single_choice" || question.type === "multiple_choice") &&
        (question.options || []).length < 2
      ) {
        return { valid: false, reason: "assessment_choice_needs_options" };
      }
    }
    return { valid: true, reason: null };
  }

  if (mode === "guided_questions") {
    const questions = countValidQuestions(plan);
    if (questions < 1) return { valid: false, reason: "guided_needs_questions" };
    for (const question of plan.questions || []) {
      if (!question?.prompt) return { valid: false, reason: "guided_missing_prompt" };
    }
    return { valid: true, reason: null };
  }

  if (mode === "structured_form" || mode === "spreadsheet_builder") {
    const fields = countValidFields(plan);
    if (fields < 1) return { valid: false, reason: "form_needs_fields" };
    for (const field of plan.requiredInputs || []) {
      if (!field?.id || !field?.type || !field?.label) {
        return { valid: false, reason: "form_missing_field_shape" };
      }
    }
    return { valid: true, reason: null };
  }

  if (mode === "choice") {
    const choices = countValidChoices(plan);
    if (choices < 2) return { valid: false, reason: "choice_needs_options" };
    for (const choice of plan.choices || []) {
      if (!choice?.id || !choice?.title) return { valid: false, reason: "choice_missing_shape" };
    }
    return { valid: true, reason: null };
  }

  if (mode === "checklist") {
    const items = countValidChecklistItems(plan);
    if (items < 1) return { valid: false, reason: "checklist_needs_items" };
    for (const item of plan.checklistItems || []) {
      if (!item?.id || !item?.label) return { valid: false, reason: "checklist_missing_shape" };
    }
    return { valid: true, reason: null };
  }

  if (mode === "upload_and_review") {
    const hasUploadHint =
      Boolean(plan.userAction?.instruction) ||
      (plan.requiredInputs || []).some((field) => field?.type === "file");
    if (!hasUploadHint) return { valid: false, reason: "upload_needs_requirements" };
    return { valid: true, reason: null };
  }

  if (mode === "generator" || mode === "document_builder" || mode === "image_generation") {
    const hasContext =
      Boolean(plan.explanation) ||
      Boolean(plan.expectedOutcome) ||
      countValidFields(plan) > 0 ||
      countValidQuestions(plan) > 0;
    if (!hasContext) return { valid: false, reason: "generator_needs_context" };
    return { valid: true, reason: null };
  }

  if (mode === "research") {
    const hasResearchContext =
      Boolean(plan.explanation) ||
      Boolean(plan.userAction?.instruction) ||
      countValidQuestions(plan) > 0;
    if (!hasResearchContext) return { valid: false, reason: "research_needs_requirements" };
    return { valid: true, reason: null };
  }

  if (mode === "conversation" || mode === "result_review") {
    return { valid: true, reason: null };
  }

  if (!EXECUTION_MODES.includes(mode)) {
    return { valid: false, reason: "unsupported_mode" };
  }

  return { valid: true, reason: null };
}

export function validateModeAppropriateness(plan, context = {}) {
  if (!plan?.mode) return { valid: false, reason: "missing_mode" };

  if (plan.mode === "choice") {
    const choices = countValidChoices(plan);
    if (choices < 2) return { valid: false, reason: "choice_needs_options" };
    if (isEnrollmentContext(context) && !isDecisionContext(context)) {
      return { valid: false, reason: "choice_inappropriate_for_enrollment" };
    }
  }

  if (plan.mode === "assessment") {
    const haystack = normalizeText(`${context.stepTitle || ""} ${context.expectedOutcome || ""}`);
    const isAssessmentStep =
      haystack.includes("evalu") ||
      haystack.includes("test") ||
      haystack.includes("nivel") ||
      haystack.includes("chestionar");
    if (!isAssessmentStep && isEnrollmentContext(context)) {
      return { valid: false, reason: "assessment_inappropriate_for_enrollment" };
    }
  }

  return { valid: true, reason: null };
}

export function validateExecutionPlanCompleteness(plan, context = {}) {
  if (!plan || typeof plan !== "object") {
    return { valid: false, reason: "malformed_plan" };
  }

  if (!EXECUTION_MODES.includes(plan.mode) && plan.mode !== "checklist") {
    return { valid: false, reason: "unsupported_mode" };
  }

  const content = validateModeSpecificContent(plan);
  if (!content.valid) return content;

  const appropriateness = validateModeAppropriateness(plan, context);
  if (!appropriateness.valid) return appropriateness;

  return { valid: true, reason: null };
}

export function validateInteractivePayload(mode, payload) {
  if (!isInteractivePlanMode(mode)) {
    return { valid: true, reason: null };
  }

  if (!payload || typeof payload !== "object") {
    return { valid: false, reason: "missing_interactive_payload" };
  }

  if (mode === "assessment") {
    if (payload.type !== "assessment") return { valid: false, reason: "assessment_type_mismatch" };
    const questions = Array.isArray(payload.questions) ? payload.questions : [];
    if (questions.length < 1) return { valid: false, reason: "assessment_needs_questions" };
    return { valid: true, reason: null };
  }

  if (mode === "guided_questions") {
    if (payload.type !== "guided_questions") return { valid: false, reason: "guided_type_mismatch" };
    const questions = Array.isArray(payload.questions) ? payload.questions : [];
    if (questions.length < 1) return { valid: false, reason: "guided_needs_questions" };
    return { valid: true, reason: null };
  }

  if (mode === "structured_form" || mode === "spreadsheet_builder") {
    if (payload.type !== "structured_form") return { valid: false, reason: "form_type_mismatch" };
    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    if (fields.length < 1) return { valid: false, reason: "form_needs_fields" };
    return { valid: true, reason: null };
  }

  if (mode === "choice") {
    if (payload.type !== "choice") return { valid: false, reason: "choice_type_mismatch" };
    const options = Array.isArray(payload.options) ? payload.options : [];
    if (options.length < 2) return { valid: false, reason: "choice_needs_options" };
    return { valid: true, reason: null };
  }

  if (mode === "checklist") {
    if (payload.type !== "checklist") return { valid: false, reason: "checklist_type_mismatch" };
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length < 1) return { valid: false, reason: "checklist_needs_items" };
    return { valid: true, reason: null };
  }

  return { valid: true, reason: null };
}

export function isPersistedPlanExecutable(plan, context = {}) {
  if (!plan) return false;
  const version = plan.metadata?.version ?? plan.version ?? 1;
  if (version < EXECUTION_PLAN_VERSION) return false;
  const validation = validateExecutionPlanCompleteness(plan, context);
  return validation.valid;
}

export function attachPlanMetadata(plan, source) {
  if (!plan) return plan;
  return {
    ...plan,
    version: EXECUTION_PLAN_VERSION,
    metadata: {
      source: source || plan.metadata?.source || plan.source || "openai",
      version: EXECUTION_PLAN_VERSION,
      generatedAt: new Date().toISOString(),
    },
    source: source || plan.source || plan.metadata?.source || "openai",
  };
}

export function buildEnrollmentChecklistFallback(context) {
  const stepTitle = context.stepTitle || "această etapă";
  return {
    mode: "checklist",
    title: context.stepTitle,
    explanation:
      context.stepDescription ||
      `Parcurge acțiunile necesare pentru „${stepTitle}”. Bifează fiecare pas pe măsură ce îl finalizezi.`,
    whyThisAction:
      context.whyItMatters ||
      "Înscrierea necesită pași concreți: alegerea școlii, documentele și programarea.",
    expectedOutcome: context.expectedOutcome,
    userAction: {
      type: "complete_checklist",
      instruction: `Bifează acțiunile necesare pentru „${stepTitle}”.`,
    },
    checklistItems: [
      {
        id: "choose_provider",
        label: "Alege școala / furnizorul potrivit",
        description: "Compară opțiunile locale și alege varianta care ți se potrivește.",
        required: true,
      },
      {
        id: "prepare_documents",
        label: "Pregătește documentele necesare",
        description: "Act de identitate, fotografii, adeverințe sau alte acte cerute.",
        required: true,
      },
      {
        id: "schedule_registration",
        label: "Programează înscrierea",
        description: "Contactează școala și stabilește data înscrierii.",
        required: true,
      },
      {
        id: "confirm_requirements",
        label: "Confirmă cerințele și costurile",
        description: "Verifică taxele, programul și condițiile de finalizare.",
        required: false,
      },
    ],
    primaryActionLabel: "Continuă",
    outputTypes: ["text", "checklist"],
  };
}
