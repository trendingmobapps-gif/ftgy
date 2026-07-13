import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { isValidUuid } from "../lib/projects/validation.js";
import { getProjectOwned } from "../lib/projects/repository.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";
import { PROJECT_BRAIN_ERROR_CODES } from "../lib/projects/brain/constants.js";
import { getProjectWorkflowView } from "../lib/projects/brain/service.js";
import { buildGenerationStatusPayload } from "../lib/projects/brain/generation-status.js";
import { getWorkflowBundle } from "../lib/projects/brain/repository.js";

export default async function handler(req, res) {
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  const { body, baseUrl, secretKey, authenticatedUser } = guard;
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!isValidUuid(projectId)) {
    sendError(
      res,
      400,
      PROJECT_BRAIN_ERROR_CODES.VALIDATION,
      "Identificator proiect invalid.",
      { projectId: "projectId trebuie să fie un UUID valid." },
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

    const bundle = await getWorkflowBundle({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      projectId,
    });

    const statusPayload = buildGenerationStatusPayload({
      project: owned.project,
      bundle,
      milestones: bundle.milestones,
      steps: bundle.steps,
    });

    if (statusPayload.generationStatus === "failed") {
      sendError(
        res,
        502,
        PROJECT_BRAIN_ERROR_CODES.GENERATION_FAILED,
        statusPayload.error?.message || "Planul proiectului nu a putut fi generat.",
        statusPayload.error?.failureCode
          ? { failureCode: statusPayload.error.failureCode }
          : undefined,
      );
      return;
    }

    if (statusPayload.generationStatus === "queued" || statusPayload.generationStatus === "generating") {
      sendSuccess(res, 200, {
        generationStatus: statusPayload.generationStatus,
        workflowGenerated: false,
        workflow: null,
        milestonesCount: 0,
        stepsCount: 0,
        brainStatus: owned.project.brain_status,
        brainAttemptCount: owned.project.brain_attempt_count ?? 0,
      });
      return;
    }

    const view = await getProjectWorkflowView({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      project: owned.project,
    });

    sendSuccess(res, 200, view);
  } catch {
    sendError(res, 500, PROJECT_BRAIN_ERROR_CODES.INTERNAL, "A apărut o eroare internă.");
  }
}
