// Shared orchestration for the status-transition endpoints (pause, resume,
// complete, archive). Keeps each route to a single call while enforcing the
// same auth, ownership, transition validation and timestamp rules.

import { guardRequest, sendSuccess, sendError } from "./http.js";
import { resolveRequestUser } from "../resolve-request-user.js";
import { isValidUuid } from "./validation.js";
import { getProjectOwned, updateProjectOwned } from "./repository.js";
import { serializeProject } from "./serializer.js";
import { canTransition, buildStatusUpdate } from "./status-transitions.js";
import { PROJECT_ERROR_CODES } from "./constants.js";

// Runs a full status transition request for the given target status.
export async function handleStatusTransition(req, res, targetStatus) {
  const guard = guardRequest(req, res);
  if (!guard.ok) return;

  const { body, baseUrl, secretKey } = guard;

  const user = resolveRequestUser(body);
  if (!user.ok) {
    sendError(res, user.status, user.code, user.message);
    return;
  }

  const projectId =
    typeof body.projectId === "string" ? body.projectId.trim() : "";
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
      userId: user.userId,
      projectId,
    });

    if (!existing.ok) {
      sendError(
        res,
        500,
        PROJECT_ERROR_CODES.INTERNAL,
        "Proiectul nu a putut fi încărcat.",
      );
      return;
    }
    if (!existing.project) {
      sendError(
        res,
        404,
        PROJECT_ERROR_CODES.NOT_FOUND,
        "Proiectul nu a fost găsit.",
      );
      return;
    }

    const currentStatus = existing.project.status;

    // No-op / disallowed transitions both rejected as invalid transitions.
    if (!canTransition(currentStatus, targetStatus)) {
      sendError(
        res,
        409,
        PROJECT_ERROR_CODES.INVALID_TRANSITION,
        `Tranziția de la „${currentStatus}” la „${targetStatus}” nu este permisă.`,
      );
      return;
    }

    const columns = buildStatusUpdate(targetStatus, new Date().toISOString());

    const result = await updateProjectOwned({
      baseUrl,
      secretKey,
      userId: user.userId,
      projectId,
      columns,
    });

    if (!result.ok || !result.project) {
      sendError(
        res,
        500,
        PROJECT_ERROR_CODES.INTERNAL,
        "Statusul proiectului nu a putut fi actualizat.",
      );
      return;
    }

    sendSuccess(res, 200, { project: serializeProject(result.project) });
  } catch (error) {
    sendError(
      res,
      500,
      PROJECT_ERROR_CODES.INTERNAL,
      "A apărut o eroare internă.",
    );
  }
}
