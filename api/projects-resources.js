import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { getProjectOwned } from "../lib/projects/repository.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";
import { getProjectResourcesView } from "../lib/projects/brain/resources/service.js";
import { validateListActionResultsRequest } from "../lib/projects/brain/actions/validation.js";

export default async function handler(req, res) {
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  const { body, baseUrl, secretKey, authenticatedUser } = guard;
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";

  const validation = validateListActionResultsRequest({ projectId, stepId });
  if (!validation.ok) {
    sendError(res, 400, "PROJECT_RESOURCE_VALIDATION_ERROR", "Datele cererii sunt invalide.", validation.fields);
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
      sendError(res, 500, "PROJECT_RESOURCE_INTERNAL_ERROR", "Proiectul nu a putut fi încărcat.");
      return;
    }

    if (!owned.project) {
      sendError(res, 404, PROJECT_ERROR_CODES.NOT_FOUND, "Proiectul nu a fost găsit.");
      return;
    }

    const result = await getProjectResourcesView({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      projectId,
      stepId: stepId || undefined,
    });

    if (!result.ok) {
      sendError(res, 500, "PROJECT_RESOURCE_INTERNAL_ERROR", "Resursele nu au putut fi încărcate.");
      return;
    }

    sendSuccess(res, 200, {
      resources: result.resources,
    });
  } catch {
    sendError(res, 500, "PROJECT_RESOURCE_INTERNAL_ERROR", "A apărut o eroare internă.");
  }
}
