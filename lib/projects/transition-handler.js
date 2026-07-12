import { guardRequest, sendSuccess, sendError } from "./http.js";
import { isValidUuid } from "./validation.js";
import { getProjectOwned, updateProjectOwned } from "./repository.js";
import { serializeProject } from "./serializer.js";
import { canTransition, buildStatusUpdate } from "./status-transitions.js";
import { PROJECT_ERROR_CODES } from "./constants.js";

export async function handleStatusTransition(req, res, targetStatus) {
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  const { body, baseUrl, secretKey, authenticatedUser } = guard;
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!isValidUuid(projectId)) {
    sendError(
      res,
      400,
      PROJECT_ERROR_CODES.VALIDATION,
      "Identificator proiect invalid.",
      { projectId: "projectId trebuie să fie un UUID valid." },
    );
    return;
  }

  try {
    const existing = await getProjectOwned({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      projectId,
    });

    if (!existing.ok) {
      sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "Proiectul nu a putut fi încărcat.");
      return;
    }
    if (!existing.project) {
      sendError(res, 404, PROJECT_ERROR_CODES.NOT_FOUND, "Proiectul nu a fost găsit.");
      return;
    }

    if (!canTransition(existing.project.status, targetStatus)) {
      sendError(
        res,
        409,
        PROJECT_ERROR_CODES.INVALID_TRANSITION,
        `Tranziția de la „${existing.project.status}” la „${targetStatus}” nu este permisă.`,
      );
      return;
    }

    const result = await updateProjectOwned({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      projectId,
      columns: buildStatusUpdate(targetStatus, new Date().toISOString()),
    });

    if (!result.ok || !result.project) {
      sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "Statusul proiectului nu a putut fi actualizat.");
      return;
    }

    sendSuccess(res, 200, { project: serializeProject(result.project) });
  } catch {
    sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "A apărut o eroare internă.");
  }
}
