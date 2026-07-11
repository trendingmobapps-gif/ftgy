// Vercel Serverless Function: POST /api/projects-get
// Returns a single project owned by the authenticated user. Responds 404 when
// the project does not exist OR belongs to another user (without revealing
// which case occurred).

import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { resolveRequestUser } from "../lib/resolve-request-user.js";
import { isValidUuid } from "../lib/projects/validation.js";
import { getProjectOwned } from "../lib/projects/repository.js";
import { serializeProject } from "../lib/projects/serializer.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";

export default async function handler(req, res) {
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
    const result = await getProjectOwned({
      baseUrl,
      secretKey,
      userId: user.userId,
      projectId,
    });

    if (!result.ok) {
      sendError(
        res,
        500,
        PROJECT_ERROR_CODES.INTERNAL,
        "Proiectul nu a putut fi încărcat.",
      );
      return;
    }

    if (!result.project) {
      sendError(
        res,
        404,
        PROJECT_ERROR_CODES.NOT_FOUND,
        "Proiectul nu a fost găsit.",
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
