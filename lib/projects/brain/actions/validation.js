import { isValidUuid } from "../../validation.js";
import { PROJECT_ACTION_ERROR_CODES } from "./constants.js";
import { validateExecutionProgressShape } from "./execution-progress.js";

export function validatePrepareActionRequest({ projectId, stepId }) {
  const fields = {};
  if (!isValidUuid(projectId)) fields.projectId = "projectId trebuie să fie un UUID valid.";
  if (!isValidUuid(stepId)) fields.stepId = "stepId trebuie să fie un UUID valid.";
  return { ok: Object.keys(fields).length === 0, fields };
}

export function validateExecuteActionRequest({ projectId, stepId, actionId, acceptedInput }) {
  const fields = validatePrepareActionRequest({ projectId, stepId }).fields || {};
  if (!isValidUuid(actionId)) fields.actionId = "actionId trebuie să fie un UUID valid.";
  if (acceptedInput !== undefined && (typeof acceptedInput !== "object" || acceptedInput === null || Array.isArray(acceptedInput))) {
    fields.acceptedInput = "acceptedInput trebuie să fie un obiect.";
  }
  return { ok: Object.keys(fields).length === 0, fields };
}

export function validateListActionResultsRequest({ projectId, stepId }) {
  const fields = {};
  if (!isValidUuid(projectId)) fields.projectId = "projectId trebuie să fie un UUID valid.";
  if (stepId && !isValidUuid(stepId)) fields.stepId = "stepId trebuie să fie un UUID valid.";
  return { ok: Object.keys(fields).length === 0, fields };
}

export function validateSessionRespondRequest({ projectId, stepId, actionId, message }) {
  const fields = validatePrepareActionRequest({ projectId, stepId }).fields || {};
  if (!isValidUuid(actionId)) fields.actionId = "actionId trebuie să fie un UUID valid.";
  if (!message || message.length < 1) fields.message = "message este obligatoriu.";
  return { ok: Object.keys(fields).length === 0, fields };
}

const SESSION_REVIEW_DECISIONS = new Set(["accept", "reject", "cancel", "improve"]);

export function validateSessionReviewRequest({
  projectId,
  stepId,
  actionId,
  resultId,
  decision,
  feedback,
}) {
  const fields = validatePrepareActionRequest({ projectId, stepId }).fields || {};
  if (!isValidUuid(actionId)) fields.actionId = "actionId trebuie să fie un UUID valid.";
  if (!isValidUuid(resultId)) fields.resultId = "resultId trebuie să fie un UUID valid.";
  if (!SESSION_REVIEW_DECISIONS.has(decision)) {
    fields.decision = "decision trebuie să fie accept, reject, cancel sau improve.";
  }
  if (decision === "improve" && feedback !== undefined && typeof feedback !== "string") {
    fields.feedback = "feedback trebuie să fie text.";
  }
  return { ok: Object.keys(fields).length === 0, fields };
}

export function validateAssessmentProgressRequest({
  projectId,
  stepId,
  actionId,
  assessmentId,
  answers,
  currentQuestionIndex,
}) {
  const fields = validatePrepareActionRequest({ projectId, stepId }).fields || {};
  if (!isValidUuid(actionId)) fields.actionId = "actionId trebuie să fie un UUID valid.";
  if (!assessmentId || typeof assessmentId !== "string") {
    fields.assessmentId = "assessmentId este obligatoriu.";
  }
  if (answers !== undefined && (typeof answers !== "object" || answers === null || Array.isArray(answers))) {
    fields.answers = "answers trebuie să fie un obiect.";
  }
  if (
    currentQuestionIndex !== undefined &&
    (!Number.isInteger(currentQuestionIndex) || currentQuestionIndex < 0)
  ) {
    fields.currentQuestionIndex = "currentQuestionIndex trebuie să fie un număr întreg pozitiv.";
  }
  return { ok: Object.keys(fields).length === 0, fields };
}

export function validateAssessmentSubmitRequest({
  projectId,
  stepId,
  actionId,
  assessmentId,
  answers,
}) {
  const fields = validatePrepareActionRequest({ projectId, stepId }).fields || {};
  if (!isValidUuid(actionId)) fields.actionId = "actionId trebuie să fie un UUID valid.";
  if (!assessmentId || typeof assessmentId !== "string") {
    fields.assessmentId = "assessmentId este obligatoriu.";
  }
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    fields.answers = "answers trebuie să fie un obiect.";
  }
  return { ok: Object.keys(fields).length === 0, fields };
}

export function validateExecutionProgressRequest({ projectId, stepId, actionId, progress }) {
  const fields = validatePrepareActionRequest({ projectId, stepId }).fields || {};
  if (!isValidUuid(actionId)) fields.actionId = "actionId trebuie să fie un UUID valid.";
  if (progress !== undefined && (typeof progress !== "object" || progress === null || Array.isArray(progress))) {
    fields.progress = "progress trebuie să fie un obiect.";
    return { ok: false, fields, normalizedProgress: {} };
  }

  const shape = validateExecutionProgressShape(progress || {});
  if (!shape.ok) {
    return {
      ok: false,
      fields: { ...fields, ...shape.fields },
      normalizedProgress: shape.normalized,
    };
  }

  return { ok: Object.keys(fields).length === 0, fields, normalizedProgress: shape.normalized };
}

export function validateFinalizeStepRequest({ projectId, stepId, actionId, executionPlanVersion }) {
  const fields = validatePrepareActionRequest({ projectId, stepId }).fields || {};
  if (!isValidUuid(actionId)) fields.actionId = "actionId trebuie să fie un UUID valid.";
  if (
    executionPlanVersion !== undefined &&
    (!Number.isInteger(executionPlanVersion) || executionPlanVersion < 1)
  ) {
    fields.executionPlanVersion = "executionPlanVersion trebuie să fie un număr întreg pozitiv.";
  }
  return { ok: Object.keys(fields).length === 0, fields };
}

export function mapActionServiceError(code) {
  switch (code) {
    case "NOT_FOUND":
      return { status: 404, code: PROJECT_ACTION_ERROR_CODES.NOT_FOUND, message: "Acțiunea nu a fost găsită." };
    case "ARCHIVED_READONLY":
      return {
        status: 409,
        code: PROJECT_ACTION_ERROR_CODES.ARCHIVED_READONLY,
        message: "Proiectele arhivate sunt doar pentru vizualizare.",
      };
    case "STEP_COMPLETED_READONLY":
      return {
        status: 200,
        code: PROJECT_ACTION_ERROR_CODES.STEP_COMPLETED_READONLY,
        message: "Etapa este finalizată și poate fi consultată doar în mod read-only.",
      };
    case "STEP_NOT_ACTIONABLE":
      return {
        status: 409,
        code: PROJECT_ACTION_ERROR_CODES.STEP_NOT_ACTIONABLE,
        message: "Acest pas nu poate fi executat acum.",
      };
    case "RESULT_REQUIRED":
      return {
        status: 409,
        code: PROJECT_ACTION_ERROR_CODES.RESULT_REQUIRED,
        message: "Pasul se finalizează doar după generarea rezultatului.",
      };
    case "STEP_INCOMPLETE":
      return {
        status: 409,
        code: PROJECT_ACTION_ERROR_CODES.STEP_INCOMPLETE,
        message: "Etapa nu este completă.",
      };
    case "EXECUTION_FAILED":
      return {
        status: 502,
        code: PROJECT_ACTION_ERROR_CODES.EXECUTION_FAILED,
        message: "Acțiunea nu a putut fi finalizată.",
      };
    case "VALIDATION":
      return {
        status: 400,
        code: PROJECT_ACTION_ERROR_CODES.VALIDATION,
        message: "Datele cererii sunt invalide.",
      };
    default:
      return {
        status: 500,
        code: PROJECT_ACTION_ERROR_CODES.INTERNAL,
        message: "A apărut o eroare internă.",
      };
  }
}
