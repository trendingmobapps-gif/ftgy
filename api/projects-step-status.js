import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { isValidUuid } from "../lib/projects/validation.js";
import { getProjectOwned } from "../lib/projects/repository.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";
import {
  PROJECT_BRAIN_ERROR_CODES,
  PROJECT_STEP_STATUSES,
} from "../lib/projects/brain/constants.js";
import { mutateProjectStepStatus } from "../lib/projects/brain/service.js";

export default async function handler(req, res) {
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  const { body, baseUrl, secretKey, authenticatedUser } = guard;
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  const targetStatus =
    typeof body.targetStatus === "string" ? body.targetStatus.trim() : "";

  const fields = {};
  if (!isValidUuid(projectId)) fields.projectId = "projectId trebuie să fie un UUID valid.";
  if (!isValidUuid(stepId)) fields.stepId = "stepId trebuie să fie un UUID valid.";
  if (!PROJECT_STEP_STATUSES.includes(targetStatus)) {
    fields.targetStatus = "targetStatus trebuie să fie un status valid.";
  }

  if (Object.keys(fields).length > 0) {
    sendError(
      res,
      400,
      PROJECT_BRAIN_ERROR_CODES.VALIDATION,
      "Datele cererii sunt invalide.",
      fields,
    );
    return;
  }

  try {
    const owned = await getProjectOwned({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      projectId,
    });

    if (!owned.ok) {
      sendError(res, 500, PROJECT_BRAIN_ERROR_CODES.INTERNAL, "Proiectul nu a putut fi încărcat.");
      return;
    }

    if (!owned.project) {
      sendError(res, 404, PROJECT_ERROR_CODES.NOT_FOUND, "Proiectul nu a fost găsit.");
      return;
    }

    const result = await mutateProjectStepStatus({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      project: owned.project,
      stepId,
      targetStatus,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        sendError(res, 404, PROJECT_ERROR_CODES.NOT_FOUND, "Pasul nu a fost găsit.");
        return;
      }
      if (result.code === "ARCHIVED_READONLY") {
        sendError(
          res,
          409,
          PROJECT_BRAIN_ERROR_CODES.ARCHIVED_READONLY,
          "Proiectele arhivate sunt doar pentru vizualizare.",
        );
        return;
      }
      if (result.code === "VALIDATION") {
        sendError(
          res,
          400,
          PROJECT_BRAIN_ERROR_CODES.VALIDATION,
          "Tranziția de status nu este permisă.",
        );
        return;
      }
      sendError(res, 500, PROJECT_BRAIN_ERROR_CODES.INTERNAL, "A apărut o eroare internă.");
      return;
    }

    sendSuccess(res, 200, {
      updatedStepId: result.updatedStepId,
      ...result.view,
    });
  } catch {
    sendError(res, 500, PROJECT_BRAIN_ERROR_CODES.INTERNAL, "A apărut o eroare internă.");
  }
}
