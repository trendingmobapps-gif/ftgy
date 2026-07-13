import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { validateCreateInput } from "../lib/projects/validation.js";
import { createProject, listProjects } from "../lib/projects/repository.js";
import { serializeProject } from "../lib/projects/serializer.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";
import { finalizeProjectIconFields } from "../lib/projects/icon-catalog.js";
import {
  evaluateProjectSafety,
  logProjectSafetyDecision,
  PROJECT_SAFETY_BLOCKED_HTTP_STATUS,
  toBlockedApiPayload,
} from "../lib/projects/project-safety.js";

export default async function handler(req, res) {
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  console.log(JSON.stringify({ event: "project_roadmap_lifecycle", stage: "project_create_received" }));

  const { body, baseUrl, secretKey, authenticatedUser } = guard;
  const { valid, value, fields } = validateCreateInput(body);
  if (!valid) {
    sendError(res, 400, PROJECT_ERROR_CODES.VALIDATION, "Datele proiectului sunt invalide.", fields);
    return;
  }

  const safetyDecision = await evaluateProjectSafety({
    goal: value.goal,
    name: value.name,
    description: value.description,
  });
  logProjectSafetyDecision({
    endpoint: "projects-create",
    decision: safetyDecision,
    correlationId: req.headers["x-request-id"],
  });

  if (safetyDecision.status === "blocked") {
    const blocked = toBlockedApiPayload(safetyDecision);
    sendError(
      res,
      PROJECT_SAFETY_BLOCKED_HTTP_STATUS,
      PROJECT_ERROR_CODES.SAFETY_BLOCKED,
      blocked.message,
      { reasonCode: blocked.reasonCode },
    );
    return;
  }

  try {
    const recentResult = await listProjects({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      filters: {
        statuses: ["active", "paused"],
        limit: 20,
      },
    });

    const recentIconKeys = (recentResult.rows || [])
      .map((row) => row.icon_key)
      .filter(Boolean);
    const recentAccentKeys = (recentResult.rows || [])
      .map((row) => row.accent_key)
      .filter(Boolean);

    const valueWithIcons = finalizeProjectIconFields(value, {
      recentIconKeys,
      recentAccentKeys,
    });

    const result = await createProject({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      value: valueWithIcons,
      nowIso: new Date().toISOString(),
      safetyGatePassed: true,
    });

    if (!result.ok || !result.project) {
      sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "Proiectul nu a putut fi creat.");
      return;
    }

    console.log(
      JSON.stringify({
        event: "project_roadmap_lifecycle",
        stage: "project_row_created",
        projectId: result.project.id,
        generationStatus: "queued",
      }),
    );

    sendSuccess(res, 201, {
      project: serializeProject(result.project),
      projectId: result.project.id,
      generationStatus: "queued",
      workflowGenerated: false,
      milestonesCount: 0,
      stepsCount: 0,
    });

    console.log(
      JSON.stringify({
        event: "project_roadmap_lifecycle",
        stage: "project_create_response_sent",
        projectId: result.project.id,
        generationStatus: "queued",
        workflowGenerated: false,
      }),
    );
  } catch {
    sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "A apărut o eroare internă.");
  }
}
