import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { validateCreateInput } from "../lib/projects/validation.js";
import { createProject } from "../lib/projects/repository.js";
import { serializeProject } from "../lib/projects/serializer.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";

export default async function handler(req, res) {
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  const { body, baseUrl, secretKey, authenticatedUser } = guard;
  const { valid, value, fields } = validateCreateInput(body);
  if (!valid) {
    sendError(res, 400, PROJECT_ERROR_CODES.VALIDATION, "Datele proiectului sunt invalide.", fields);
    return;
  }

  try {
    const result = await createProject({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      value,
      nowIso: new Date().toISOString(),
    });

    if (!result.ok || !result.project) {
      sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "Proiectul nu a putut fi creat.");
      return;
    }

    sendSuccess(res, 201, { project: serializeProject(result.project) });
  } catch {
    sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "A apărut o eroare internă.");
  }
}
