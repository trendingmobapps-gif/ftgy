import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { getProjectOwned } from "../lib/projects/repository.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";
import { saveAssessmentProgress } from "../lib/projects/brain/actions/service.js";
import {
  mapActionServiceError,
  validateAssessmentProgressRequest,
} from "../lib/projects/brain/actions/validation.js";

export default async function handler(req, res) {
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  const { body, baseUrl, secretKey, authenticatedUser } = guard;
  const validation = validateAssessmentProgressRequest(body);
  if (!validation.ok) {
    sendError(res, 400, "PROJECT_ACTION_VALIDATION_ERROR", "Datele cererii sunt invalide.", validation.fields);
    return;
  }

  try {
    const owned = await getProjectOwned({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      projectId: body.projectId,
    });

    if (!owned.project) {
      sendError(res, 404, PROJECT_ERROR_CODES.NOT_FOUND, "Proiectul nu a fost găsit.");
      return;
    }

    const result = await saveAssessmentProgress({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      project: owned.project,
      projectId: body.projectId,
      stepId: body.stepId,
      actionId: body.actionId,
      assessmentId: body.assessmentId,
      answers: body.answers,
      currentQuestionIndex: body.currentQuestionIndex,
    });

    if (!result.ok) {
      const mapped = mapActionServiceError(result.code);
      sendError(res, mapped.status, mapped.code, mapped.message);
      return;
    }

    sendSuccess(res, 200, {
      action: result.action,
      session: result.session,
      executionDefinition: result.executionDefinition || null,
      interactivePayload: result.interactivePayload || null,
      savedAnswers: result.savedAnswers || {},
      currentQuestionIndex: result.currentQuestionIndex ?? 0,
    });
  } catch {
    sendError(res, 500, "PROJECT_ACTION_INTERNAL_ERROR", "A apărut o eroare internă.");
  }
}
