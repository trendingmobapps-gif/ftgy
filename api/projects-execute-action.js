import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { getProjectOwned } from "../lib/projects/repository.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";
import { executeProjectAction } from "../lib/projects/brain/actions/service.js";
import {
  mapActionServiceError,
  validateExecuteActionRequest,
} from "../lib/projects/brain/actions/validation.js";

export default async function handler(req, res) {
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  const { body, baseUrl, secretKey, authenticatedUser } = guard;
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  const actionId = typeof body.actionId === "string" ? body.actionId.trim() : "";
  const acceptedInput =
    body.acceptedInput && typeof body.acceptedInput === "object" && !Array.isArray(body.acceptedInput)
      ? body.acceptedInput
      : {};

  const validation = validateExecuteActionRequest({ projectId, stepId, actionId, acceptedInput });
  if (!validation.ok) {
    sendError(res, 400, "PROJECT_ACTION_VALIDATION_ERROR", "Datele cererii sunt invalide.", validation.fields);
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
      sendError(res, 500, "PROJECT_ACTION_INTERNAL_ERROR", "Proiectul nu a putut fi încărcat.");
      return;
    }

    if (!owned.project) {
      sendError(res, 404, PROJECT_ERROR_CODES.NOT_FOUND, "Proiectul nu a fost găsit.");
      return;
    }

    const result = await executeProjectAction({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      project: owned.project,
      projectId,
      stepId,
      actionId,
      acceptedInput,
    });

    if (!result.ok) {
      const mapped = mapActionServiceError(result.code);
      sendError(res, mapped.status, mapped.code, mapped.message);
      return;
    }

    sendSuccess(res, 200, {
      action: result.action,
      result: result.result,
      session: result.session,
      requiresReview: Boolean(result.requiresReview),
      ...(result.view || {}),
    });
  } catch {
    sendError(res, 500, "PROJECT_ACTION_INTERNAL_ERROR", "A apărut o eroare internă.");
  }
}
