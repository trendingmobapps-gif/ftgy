import { isValidUuid } from "../../validation.js";
import { PROJECT_ACTION_ERROR_CODES } from "./constants.js";

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
