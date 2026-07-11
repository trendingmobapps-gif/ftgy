// Vercel Serverless Function: POST /api/projects-list
// Lists projects owned by the authenticated Supabase user (memberId) with
// filtering, case-insensitive search, sorting and offset pagination. Archived
// projects are excluded by default.

import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { validateListInput } from "../lib/projects/validation.js";
import { listProjects } from "../lib/projects/repository.js";
import { serializeProjects } from "../lib/projects/serializer.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";

export default async function handler(req, res) {
  const guard = await guardRequest(req, res);
  if (!guard.ok) return;

  const { body, baseUrl, serviceRoleKey, authenticatedUser } = guard;

  // Strictly validate every supplied query field. Invalid values -> 400
  // (never silently ignored). Absent fields fall back to repository defaults.
  const { valid, value, fields } = validateListInput(body);
  if (!valid) {
    sendError(
      res,
      400,
      PROJECT_ERROR_CODES.VALIDATION,
      "Parametrii de listare sunt invalizi.",
      fields,
    );
    return;
  }

  const filters = {
    statuses: value.statuses || [],
    includeArchived: value.includeArchived === true,
    search: value.search || "",
    categorySlug: value.categorySlug || null,
    sort: value.sort,
    direction: value.direction || "desc",
    limit: value.limit,
    cursor: value.cursor,
  };

  try {
    const result = await listProjects({
      baseUrl,
      secretKey: serviceRoleKey,
      userId: authenticatedUser.id,
      filters,
    });

    if (!result.ok) {
      sendError(
        res,
        500,
        PROJECT_ERROR_CODES.INTERNAL,
        "Proiectele nu au putut fi încărcate.",
      );
      return;
    }

    sendSuccess(res, 200, {
      projects: serializeProjects(result.rows),
      count: result.count,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    sendError(
      res,
      500,
      PROJECT_ERROR_CODES.INTERNAL,
      "A apărut o eroare internă.",
    );
  }
}
