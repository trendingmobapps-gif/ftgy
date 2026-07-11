// Vercel Serverless Function: POST /api/projects-update
// Updates editable fields on a project owned by the authenticated user. This
// generic endpoint never changes status, ownership, workflow or timestamp
// columns. Archived projects are read-only.

import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import {
  isValidUuid,
  validateUpdateInput,
  mapUpdateValueToColumns,
} from "../lib/projects/validation.js";
import {
  getProjectOwned,
  updateProjectOwned,
} from "../lib/projects/repository.js";
import { serializeProject } from "../lib/projects/serializer.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";

export default async function handler(req, res) {
  const guard = await guardRequest(req, res);
  if (!guard.ok) return;

  const { body, baseUrl, serviceRoleKey, authenticatedUser } = guard;

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

  // Validate allowlisted fields only.
  const { valid, value, fields, hasUpdates } = validateUpdateInput(body);
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
  if (!hasUpdates) {
    sendError(
      res,
      400,
      PROJECT_ERROR_CODES.VALIDATION,
      "Nu există modificări de salvat.",
    );
    return;
  }

  try {
    // Ownership check first (also detects archived state).
    const existing = await getProjectOwned({
      baseUrl,
      secretKey: serviceRoleKey,
      userId: authenticatedUser.id,
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
    if (existing.project.status === "archived") {
      sendError(
        res,
        409,
        PROJECT_ERROR_CODES.ARCHIVED_READONLY,
        "Proiectele arhivate nu pot fi editate.",
      );
      return;
    }

    // Meaningful user edit -> bump last_activity_at. updated_at is handled by
    // the existing database trigger/default.
    const columns = mapUpdateValueToColumns(value);
    columns.last_activity_at = new Date().toISOString();

    const result = await updateProjectOwned({
      baseUrl,
      secretKey: serviceRoleKey,
      userId: authenticatedUser.id,
      projectId,
      columns,
    });

    if (!result.ok || !result.project) {
      sendError(
        res,
        500,
        PROJECT_ERROR_CODES.INTERNAL,
        "Proiectul nu a putut fi actualizat.",
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
