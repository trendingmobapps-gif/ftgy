import { getExecutionPlanFromPreparedInput } from "./execution-plan-generator.js";
import { readInteractiveState } from "./assessment.js";
import { getExperienceFromPreparedInput } from "./ai-experience-validation.js";
import { validateExperienceValues, listInputComponents } from "./experience-values-normalizer.js";

const MISSING_MESSAGES = {
  REQUIRED_ANSWERS: "Răspunde la toate întrebările obligatorii",
  REQUIRED_FORM_FIELDS: "Completează toate câmpurile obligatorii",
  REQUIRED_CHOICE: "Selectează o opțiune",
  REQUIRED_RECOMMENDATIONS: "Confirmă cel puțin o recomandare",
  REQUIRED_CHECKLIST: "Bifează toate acțiunile obligatorii",
  REQUIRED_UPLOAD: "Încarcă documentul",
  REQUIRED_GENERATED_RESULT: "Generează rezultatul pentru această etapă",
  REQUIRED_RESULT_REVIEW: "Revizuiește rezultatul",
  REQUIRED_RESULT_ACCEPTANCE: "Acceptă rezultatul",
  ASSESSMENT_NOT_SUBMITTED: "Finalizează evaluarea înainte de a închide etapa",
};

export function normalizeCompletionCriteria(raw = {}) {
  const modeRequiresResult = raw.requireGeneratedResult;
  return {
    requireAllInputs: raw.requireAllInputs ?? raw.requireAll ?? true,
    minimumAnsweredQuestions:
      raw.minimumAnsweredQuestions ?? raw.minimumResponses ?? null,
    minimumCompletedChecklistItems: raw.minimumCompletedChecklistItems ?? null,
    requireChoice: raw.requireChoice ?? false,
    requireFileUpload: raw.requireFileUpload ?? false,
    requireGeneratedResult:
      modeRequiresResult ?? raw.requiresGeneratedResult ?? false,
    requireUserReview: raw.requireUserReview ?? false,
    requireUserAcceptance:
      raw.requireUserAcceptance ?? raw.requiresUserAcceptance ?? true,
    requireExplicitFinalize: raw.requireExplicitFinalize ?? true,
  };
}

function readExecutionInteractive(collectedInput = {}) {
  const interactive = collectedInput?.interactive;
  if (!interactive || typeof interactive !== "object") {
    return null;
  }
  return interactive;
}

function countAnsweredQuestions(plan, collectedInput, assessmentState) {
  if (plan.mode === "assessment") {
    const answers = assessmentState?.answers || {};
    const required = (plan.questions || []).filter((q) => q.required !== false);
    return required.filter((q) => String(answers[q.id] || "").trim()).length;
  }

  if (plan.mode === "guided_questions") {
    const interactive = readExecutionInteractive(collectedInput);
    const answers =
      interactive?.guidedAnswers ||
      interactive?.answers ||
      collectedInput?.guidedAnswers ||
      collectedInput ||
      {};
    const required = (plan.questions || []).filter((q) => q.required !== false);
    return required.filter((q) => String(answers[q.id] || "").trim()).length;
  }

  return 0;
}

function countCompletedChecklistItems(plan, collectedInput) {
  const interactive = readExecutionInteractive(collectedInput);
  const checked = interactive?.checklistChecked || interactive?.checked || {};
  const required = (plan.checklistItems || []).filter((item) => item.required !== false);
  return required.filter((item) => Boolean(checked[item.id])).length;
}

function hasValidChoice(plan, collectedInput) {
  const interactive = readExecutionInteractive(collectedInput);
  const selected =
    interactive?.selectedChoice ||
    interactive?.selectedChoices ||
    collectedInput?.selected_direction ||
    collectedInput?.selectedChoice ||
    "";
  if (Array.isArray(selected)) {
    return selected.length > 0;
  }
  return String(selected || "").trim().length > 0;
}

function hasValidForm(plan, collectedInput) {
  const interactive = readExecutionInteractive(collectedInput);
  const values = interactive?.formValues || collectedInput || {};
  const required = (plan.requiredInputs || []).filter((field) => field.required !== false);
  return required.every((field) => String(values[field.id] || "").trim().length > 0);
}

function hasValidRecommendationSelection(plan, collectedInput) {
  const interactive = readExecutionInteractive(collectedInput);
  const selected = interactive?.selectedRecommendations || interactive?.selectedIds || [];
  const custom = interactive?.customOptions || [];
  const minimum = plan.selectionRules?.minimumSelections ?? 1;
  const count = (Array.isArray(selected) ? selected.length : 0) + (Array.isArray(custom) ? custom.length : 0);
  if (count < minimum) return false;
  if (!interactive?.confirmed) return false;
  return true;
}

function hasUploadedFile(collectedInput) {
  const interactive = readExecutionInteractive(collectedInput);
  return Boolean(interactive?.uploadedFileId || interactive?.uploadedFile);
}

function inferRequireGeneratedResult(plan) {
  const generatorModes = new Set([
    "generator",
    "document_builder",
    "spreadsheet_builder",
    "image_generation",
    "research",
    "conversation",
  ]);
  return generatorModes.has(plan.mode);
}

function hasValidExperience(experience, collectedInput) {
  if (!experience) return true;
  const values = collectedInput?.experience?.values || {};
  const validation = validateExperienceValues(experience, values, { strict: true });
  return validation.valid;
}

export function validateStepCompletion({
  plan,
  action = null,
  collectedInput = {},
  acceptedResult = null,
  pendingResult = null,
  experience = null,
}) {
  if (!plan) {
    return {
      canFinalize: false,
      missingRequirements: [{ code: "MISSING_PLAN", message: "Planul etapei lipsește." }],
    };
  }

  const criteria = normalizeCompletionCriteria({
    ...plan.completionCriteria,
    requireGeneratedResult:
      plan.completionCriteria?.requireGeneratedResult ?? inferRequireGeneratedResult(plan),
    requireChoice: plan.completionCriteria?.requireChoice ?? plan.mode === "choice",
  });

  const missingRequirements = [];
  const assessmentState = readInteractiveState(collectedInput);
  const interactive = readExecutionInteractive(collectedInput);
  const result = acceptedResult || (interactive?.resultAccepted ? pendingResult : null);

  if (plan.mode === "assessment") {
    if (!assessmentState?.submitted) {
      missingRequirements.push({
        code: "ASSESSMENT_NOT_SUBMITTED",
        message: MISSING_MESSAGES.ASSESSMENT_NOT_SUBMITTED,
      });
    } else {
      const requiredCount = (plan.questions || []).filter((q) => q.required !== false).length;
      const answered = countAnsweredQuestions(plan, collectedInput, assessmentState);
      const minimum = criteria.minimumAnsweredQuestions ?? requiredCount;
      if (criteria.requireAllInputs && answered < minimum) {
        missingRequirements.push({
          code: "REQUIRED_ANSWERS",
          message: MISSING_MESSAGES.REQUIRED_ANSWERS,
        });
      }
    }
  }

  if (plan.mode === "guided_questions") {
    const requiredCount = (plan.questions || []).filter((q) => q.required !== false).length;
    const answered = countAnsweredQuestions(plan, collectedInput, assessmentState);
    const minimum = criteria.minimumAnsweredQuestions ?? requiredCount;
    if (criteria.requireAllInputs && answered < minimum) {
      missingRequirements.push({
        code: "REQUIRED_ANSWERS",
        message: MISSING_MESSAGES.REQUIRED_ANSWERS,
      });
    }
  }

  if (plan.mode === "structured_form" || plan.mode === "spreadsheet_builder") {
    if (experience) {
      if (!hasValidExperience(experience, collectedInput)) {
        missingRequirements.push({
          code: "REQUIRED_FORM_FIELDS",
          message: MISSING_MESSAGES.REQUIRED_FORM_FIELDS,
        });
      }
    } else if (!hasValidForm(plan, collectedInput)) {
      missingRequirements.push({
        code: "REQUIRED_FORM_FIELDS",
        message: MISSING_MESSAGES.REQUIRED_FORM_FIELDS,
      });
    }
  }

  if (plan.mode === "choice" || criteria.requireChoice) {
    if (!hasValidChoice(plan, collectedInput)) {
      missingRequirements.push({
        code: "REQUIRED_CHOICE",
        message: MISSING_MESSAGES.REQUIRED_CHOICE,
      });
    }
  }

  if (plan.mode === "recommendation_selection") {
    if (!hasValidRecommendationSelection(plan, collectedInput)) {
      missingRequirements.push({
        code: "REQUIRED_RECOMMENDATIONS",
        message: MISSING_MESSAGES.REQUIRED_RECOMMENDATIONS,
      });
    }
  }

  if (plan.mode === "checklist") {
    const requiredCount = (plan.checklistItems || []).filter((item) => item.required !== false).length;
    const completed = countCompletedChecklistItems(plan, collectedInput);
    const minimum = criteria.minimumCompletedChecklistItems ?? requiredCount;
    if (criteria.requireAllInputs && completed < minimum) {
      missingRequirements.push({
        code: "REQUIRED_CHECKLIST",
        message: MISSING_MESSAGES.REQUIRED_CHECKLIST,
      });
    }
  }

  if (plan.mode === "upload_and_review" || criteria.requireFileUpload) {
    if (!hasUploadedFile(collectedInput)) {
      missingRequirements.push({
        code: "REQUIRED_UPLOAD",
        message: MISSING_MESSAGES.REQUIRED_UPLOAD,
      });
    }
  }

  if (criteria.requireGeneratedResult) {
    const hasResult = Boolean(acceptedResult || pendingResult || interactive?.generatedResultId);
    if (!hasResult) {
      missingRequirements.push({
        code: "REQUIRED_GENERATED_RESULT",
        message: MISSING_MESSAGES.REQUIRED_GENERATED_RESULT,
      });
    }
  }

  if (criteria.requireUserReview && pendingResult && !acceptedResult && !interactive?.resultAccepted) {
    missingRequirements.push({
      code: "REQUIRED_RESULT_REVIEW",
      message: MISSING_MESSAGES.REQUIRED_RESULT_REVIEW,
    });
  }

  if (criteria.requireUserAcceptance) {
    const accepted =
      Boolean(acceptedResult) ||
      interactive?.resultAccepted === true ||
      (pendingResult?.acceptance_status === "accepted" || pendingResult?.acceptanceStatus === "accepted");
    if (criteria.requireGeneratedResult && !accepted) {
      missingRequirements.push({
        code: "REQUIRED_RESULT_ACCEPTANCE",
        message: MISSING_MESSAGES.REQUIRED_RESULT_ACCEPTANCE,
      });
    }
  }

  return {
    canFinalize: missingRequirements.length === 0,
    missingRequirements,
    criteria,
  };
}

export function loadCompletionContext(actionRow, acceptedResult = null, pendingResult = null) {
  const plan = getExecutionPlanFromPreparedInput(actionRow?.prepared_input);
  const collectedInput = actionRow?.collected_input || {};
  const experience = getExperienceFromPreparedInput(actionRow?.prepared_input);
  return validateStepCompletion({
    plan,
    action: actionRow,
    collectedInput,
    acceptedResult,
    pendingResult,
    experience,
  });
}
