import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { isValidUuid } from "../lib/projects/validation.js";
import { getProjectOwned } from "../lib/projects/repository.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";
import { prepareProjectAction } from "../lib/projects/brain/actions/service.js";
import {
  mapActionServiceError,
  validatePrepareActionRequest,
} from "../lib/projects/brain/actions/validation.js";
import { logPrepareFailure, logPrepareStage } from "../lib/projects/brain/actions/prepare-stage-log.js";

console.log("[projects-prepare-action] module_loaded");

export default async function handler(req, res) {
  console.log("[projects-prepare-action] handler_started");
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  const { body, baseUrl, secretKey, authenticatedUser } = guard;
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  const forceRegenerateInvalidPlan = body.forceRegenerateInvalidPlan === true;

  logPrepareStage("request_received", {
    projectId,
    stepId,
    userId: authenticatedUser.id,
    endpoint: "/api/projects-prepare-action",
  });

  const validation = validatePrepareActionRequest({ projectId, stepId });
  if (!validation.ok) {
    sendError(res, 400, "PROJECT_ACTION_VALIDATION_ERROR", "Datele cererii sunt invalide.", validation.fields);
    return;
  }

  try {
    logPrepareStage("auth_success", { projectId, stepId, userId: authenticatedUser.id });

    const owned = await getProjectOwned({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      projectId,
    });

    if (!owned.ok) {
      logPrepareFailure("project_loaded", new Error("Project lookup failed"), {
        projectId,
        stepId,
        status: owned.status,
      });
      sendError(res, 500, "PROJECT_ACTION_INTERNAL_ERROR", "Proiectul nu a putut fi încărcat.");
      return;
    }

    if (!owned.project) {
      sendError(res, 404, PROJECT_ERROR_CODES.NOT_FOUND, "Proiectul nu a fost găsit.");
      return;
    }

    logPrepareStage("project_loaded", {
      projectId,
      stepId,
      projectStatus: owned.project.status,
      brainStatus: owned.project.brain_status,
    });

    const result = await prepareProjectAction({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      project: owned.project,
      projectId,
      stepId,
      forceRegenerateInvalidPlan,
    });

    if (!result.ok) {
      const mapped = mapActionServiceError(result.code);
      logPrepareFailure(mapped.code || "prepare_project_action", new Error(mapped.message), {
        projectId,
        stepId,
        serviceCode: result.code,
      });
      sendError(res, mapped.status, mapped.code, mapped.message);
      return;
    }

    sendSuccess(res, 200, {
      readOnly: Boolean(result.readOnly),
      action: result.action,
      session: result.session,
      executionDefinition: result.executionDefinition || null,
      executionPlan: result.executionPlan || null,
      interactivePayload: result.interactivePayload || null,
      executionContract: result.executionContract || null,
      contractValid: result.contractValid !== false,
      savedAnswers: result.savedAnswers || {},
      currentQuestionIndex: result.currentQuestionIndex ?? 0,
    });
  } catch (error) {
    logPrepareFailure("prepare_project_action", error, { projectId, stepId });
    sendError(res, 500, "PROJECT_ACTION_INTERNAL_ERROR", "A apărut o eroare internă.");
  }
}
