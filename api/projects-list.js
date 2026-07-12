import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { validateListInput } from "../lib/projects/validation.js";
import { listProjects } from "../lib/projects/repository.js";
import { serializeProjects } from "../lib/projects/serializer.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";

export default async function handler(req, res) {
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  const { body, baseUrl, secretKey, authenticatedUser } = guard;
  const { valid, value, fields } = validateListInput(body);
  if (!valid) {
    sendError(res, 400, PROJECT_ERROR_CODES.VALIDATION, "Parametrii listei sunt invalizi.", fields);
    return;
  }

  try {
    const result = await listProjects({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      filters: value,
    });

    if (!result.ok) {
      sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "Proiectele nu au putut fi încărcate.");
      return;
    }

    sendSuccess(res, 200, {
      projects: serializeProjects(result.rows),
      count: result.count,
      nextCursor: result.nextCursor,
    });
  } catch {
    sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "A apărut o eroare internă.");
  }
}
