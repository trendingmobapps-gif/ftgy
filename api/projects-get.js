import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { isValidUuid } from "../lib/projects/validation.js";
import { getProjectOwned } from "../lib/projects/repository.js";
import { serializeProject } from "../lib/projects/serializer.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";

export default async function handler(req, res) {
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
    const result = await getProjectOwned({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      projectId,
    });

    if (!result.ok) {
      sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "Proiectul nu a putut fi încărcat.");
      return;
    }
    if (!result.project) {
      sendError(res, 404, PROJECT_ERROR_CODES.NOT_FOUND, "Proiectul nu a fost găsit.");
      return;
    }

    sendSuccess(res, 200, { project: serializeProject(result.project) });
  } catch {
    sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "A apărut o eroare internă.");
  }
}
