import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { getProjectOwned } from "../lib/projects/repository.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";
import { PROJECT_ACTION_ERROR_CODES } from "../lib/projects/brain/actions/constants.js";
import { saveExecutionProgress } from "../lib/projects/brain/actions/service.js";
import {
  mapActionServiceError,
  validateExecutionProgressRequest,
} from "../lib/projects/brain/actions/validation.js";
import { logPrepareFailure } from "../lib/projects/brain/actions/prepare-stage-log.js";

function logExecutionProgressFailure(stage, error, context = {}) {
  logPrepareFailure(stage, error, {
    endpoint: "/api/projects-execution-progress",
    projectId: context.projectId || null,
    stepId: context.stepId || null,
    actionId: context.actionId || null,
    progressType: context.progressType || null,
    stage,
  });
}

export default async function handler(req, res) {
  let requestContext = {
    projectId: null,
    stepId: null,
    actionId: null,
    progressType: null,
  };

  try {
    const guard = await guardRequest(req, res, { authMode: "user" });
    if (!guard.ok) return;

    const { body, baseUrl, secretKey, authenticatedUser } = guard;
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
    const actionId = typeof body.actionId === "string" ? body.actionId.trim() : "";
    const progress = body.progress && typeof body.progress === "object" ? body.progress : {};

    requestContext = {
      projectId,
      stepId,
      actionId,
      progressType: typeof progress.type === "string" ? progress.type : null,
    };

    if (typeof validateExecutionProgressRequest !== "function") {
      const error = new Error("validateExecutionProgressRequest is unavailable");
      logExecutionProgressFailure("validator_missing", error, requestContext);
      sendError(
        res,
        500,
        PROJECT_ACTION_ERROR_CODES.EXECUTION_PROGRESS_INTERNAL,
        "Nu am putut salva progresul.",
      );
      return;
    }

    const validation = validateExecutionProgressRequest({ projectId, stepId, actionId, progress });
    if (!validation.ok) {
      sendError(
        res,
        400,
        PROJECT_ACTION_ERROR_CODES.EXECUTION_PROGRESS_VALIDATION,
        "Datele progresului sunt invalide.",
        validation.fields,
      );
      return;
    }

    const owned = await getProjectOwned({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      projectId,
    });

    if (!owned.ok) {
      logExecutionProgressFailure(
        "project_loaded",
        new Error("Project lookup failed"),
        requestContext,
      );
      sendError(
        res,
        500,
        PROJECT_ACTION_ERROR_CODES.EXECUTION_PROGRESS_INTERNAL,
        "Nu am putut salva progresul.",
      );
      return;
    }

    if (!owned.project) {
      sendError(res, 404, PROJECT_ERROR_CODES.NOT_FOUND, "Proiectul nu a fost găsit.");
      return;
    }

    const result = await saveExecutionProgress({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      project: owned.project,
      projectId,
      stepId,
      actionId,
      progress: validation.normalizedProgress || progress,
    });

    if (!result.ok) {
      const mapped = mapActionServiceError(result.code);
      sendError(res, mapped.status, mapped.code, mapped.message);
      return;
    }

    sendSuccess(res, 200, {
      action: result.action,
      session: result.session,
      canFinalize: Boolean(result.canFinalize),
      missingRequirements: result.missingRequirements || [],
    });
  } catch (error) {
    logExecutionProgressFailure("handler", error, requestContext);
    sendError(
      res,
      500,
      PROJECT_ACTION_ERROR_CODES.EXECUTION_PROGRESS_INTERNAL,
      "Nu am putut salva progresul.",
    );
  }
}
