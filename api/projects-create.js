// Vercel Serverless Function: POST /api/projects-create
// Creates a new project owned by the authenticated Supabase user (memberId).
// Universal endpoint used identically by mobile and web. No workflows, no
// OpenAI calls in Phase 1.

import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { resolveRequestUser } from "../lib/resolve-request-user.js";
import { validateCreateInput } from "../lib/projects/validation.js";
import { createProject } from "../lib/projects/repository.js";
import { serializeProject } from "../lib/projects/serializer.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";

export default async function handler(req, res) {
  const guard = guardRequest(req, res);
  if (!guard.ok) return;

  const { body, baseUrl, secretKey } = guard;

  // Authoritative ownership via memberId (Supabase user UUID).
  const user = resolveRequestUser(body);
  if (!user.ok) {
    sendError(res, user.status, user.code, user.message);
    return;
  }

  // Validate + normalize input; derive name from goal when omitted.
  const { valid, value, fields } = validateCreateInput(body);
  if (!valid) {
    sendError(
      res,
      400,
      PROJECT_ERROR_CODES.VALIDATION,
      "Datele proiectului sunt invalide.",
      fields,
    );
    return;
  }

  try {
    const nowIso = new Date().toISOString();
    const result = await createProject({
      baseUrl,
      secretKey,
      userId: user.userId,
      value,
      nowIso,
    });

    if (!result.ok || !result.project) {
      sendError(
        res,
        500,
        PROJECT_ERROR_CODES.INTERNAL,
        "Proiectul nu a putut fi creat.",
      );
      return;
    }

    sendSuccess(res, 201, { project: serializeProject(result.project) });
  } catch (error) {
    sendError(
      res,
      500,
      PROJECT_ERROR_CODES.INTERNAL,
      "A apărut o eroare internă.",
    );
  }
}
