import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { isValidUuid } from "../lib/projects/validation.js";
import { getProjectOwned } from "../lib/projects/repository.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";
import { PROJECT_BRAIN_ERROR_CODES } from "../lib/projects/brain/constants.js";
import { getProjectWorkflowView } from "../lib/projects/brain/service.js";

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
