export const PROJECT_MEMORY_SOURCES = ["session", "resource", "upload", "workflow", "system"];

/** Maps artifact-specific labels to schema-allowed `project_memory.source` values. */
export const PROJECT_MEMORY_ARTIFACT_SOURCES = {
  brainSnapshot: "system",
  workflowAdaptation: "workflow",
  sessionFact: "session",
};

export function resolveProjectMemorySource(source) {
  const normalized = String(source || "").trim();
  if (PROJECT_MEMORY_SOURCES.includes(normalized)) {
    return normalized;
  }
  if (normalized === "brain_snapshot") {
    return PROJECT_MEMORY_ARTIFACT_SOURCES.brainSnapshot;
  }
  if (normalized === "workflow_adaptation") {
    return PROJECT_MEMORY_ARTIFACT_SOURCES.workflowAdaptation;
  }
  return null;
}

export function isProjectMemorySourceAllowed(source) {
  return resolveProjectMemorySource(source) != null;
}

export const PROJECT_MEMORY_SELECT_COLUMNS = [
  "id",
  "project_id",
  "user_id",
  "memory_key",
  "memory_value",
  "source",
  "confidence",
  "created_at",
  "updated_at",
].join(",");

export const MEMORY_FIELD_ALIASES = {
  produs: ["produs", "product", "subiect", "tema"],
  buget: ["buget", "budget"],
  locatie: ["locatie", "location", "oras", "city"],
  publicTinta: ["public", "audience", "clienti"],
  obiectiv: ["obiectiv", "goal", "scop"],
  nume: ["nume", "name", "brand"],
  deadline: ["deadline", "termen", "data"],
  nivel: ["nivel", "level"],
};
