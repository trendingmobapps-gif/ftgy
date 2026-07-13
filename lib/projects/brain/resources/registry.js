import { RESOURCE_TYPE_HINTS } from "./constants.js";
import {
  getResourceForStep,
  insertProjectResource,
  listProjectResources,
  serializeResourceRow,
} from "./repository.js";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function inferResourceType({ step, resultType = "text" }) {
  const haystack = normalizeText(`${step?.title || ""} ${step?.expected_outcome || ""}`);
  for (const [hint, type] of Object.entries(RESOURCE_TYPE_HINTS)) {
    if (haystack.includes(hint)) {
      return type;
    }
  }

  if (resultType === "document") return "document";
  if (resultType === "summary") return "summary";
  return "markdown";
}

function inferFileExtension(resourceType) {
  switch (resourceType) {
    case "spreadsheet":
    case "excel":
      return "xlsx";
    case "pdf":
    case "business_plan":
    case "strategy":
    case "test":
    case "questionnaire":
      return "pdf";
    case "word":
    case "checklist":
      return "docx";
    case "image":
      return "png";
    default:
      return "md";
  }
}

export async function registerAcceptedResultAsResource({
  baseUrl,
  secretKey,
  userId,
  projectId,
  step,
  action,
  result,
  sourceStrategy = "generate_resource",
}) {
  const existing = await getResourceForStep({
    baseUrl,
    secretKey,
    userId,
    projectId,
    stepId: step.id,
  });

  if (existing.resource) {
    return { ok: true, resource: existing.resource, reused: true };
  }

  const resourceType = inferResourceType({ step, resultType: result.result_type });
  const fileExtension = inferFileExtension(resourceType);

  return insertProjectResource({
    baseUrl,
    secretKey,
    userId,
    projectId,
    stepId: step.id,
    actionId: action?.id || result.action_id,
    resultId: result.id,
    resourceType,
    title: result.title,
    preview: result.preview,
    content: result.content,
    mimeType: resourceType === "spreadsheet" ? "application/vnd.ms-excel" : "text/markdown",
    fileExtension,
    metadata: {
      stepTitle: step.title,
      expectedOutcome: step.expected_outcome,
    },
    sourceStrategy,
  });
}

export async function findReusableResourceForStep({
  baseUrl,
  secretKey,
  userId,
  projectId,
  stepId,
}) {
  const found = await getResourceForStep({ baseUrl, secretKey, userId, projectId, stepId });
  return found.resource ? serializeResourceRow(found.resource) : null;
}

export async function listRegisteredProjectResources({
  baseUrl,
  secretKey,
  userId,
  projectId,
  stepId,
}) {
  const rows = await listProjectResources({ baseUrl, secretKey, userId, projectId, stepId });
  if (!rows.ok) {
    return { ok: false, resources: [] };
  }

  return {
    ok: true,
    resources: rows.resources.map((row) => serializeResourceRow(row)),
  };
}

export function buildResourceDisplayName(resource) {
  if (!resource) return null;
  const ext = resource.fileExtension || "md";
  const safeTitle = String(resource.title || "Resursa")
    .replace(/[\\/:*?"<>|]+/g, "")
    .trim()
    .replace(/\s+/g, "");
  return `${safeTitle}.${ext}`;
}
