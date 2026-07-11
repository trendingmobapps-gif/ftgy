// Vercel Serverless Function: POST /api/projects-list
// Lists projects owned by the authenticated Supabase user (memberId) with
// filtering, case-insensitive search, sorting and offset pagination. Archived
// projects are excluded by default.

import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { resolveRequestUser } from "../lib/resolve-request-user.js";
import { isValidCategorySlug } from "../lib/projects/validation.js";
import { listProjects } from "../lib/projects/repository.js";
import { serializeProjects } from "../lib/projects/serializer.js";
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

  // Only pass through a valid category slug; ignore invalid values silently.
  const categorySlug =
    typeof body.categorySlug === "string" &&
    isValidCategorySlug(body.categorySlug)
      ? body.categorySlug.trim()
      : null;

  const filters = {
    statuses: Array.isArray(body.statuses) ? body.statuses : [],
    includeArchived: body.includeArchived === true,
    search: typeof body.search === "string" ? body.search : "",
    categorySlug,
    sort: typeof body.sort === "string" ? body.sort : undefined,
    direction: body.direction === "asc" ? "asc" : "desc",
    limit: body.limit,
    cursor: body.cursor,
  };

  try {
    const result = await listProjects({
      baseUrl,
      secretKey,
      userId: user.userId,
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
