import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(__dirname, "../../../api");

export const PROJECT_ENDPOINT_CLASSIFICATION = Object.freeze({
  "projects-list.js": { operation: "project_list", mode: "read_only" },
  "projects-get.js": { operation: "project_open", mode: "read_only" },
  "projects-workflow.js": { operation: "workflow_read", mode: "read_only" },
  "projects-resources.js": { operation: "resource_open", mode: "read_only" },
  "projects-action-results.js": { operation: "result_open", mode: "read_only" },
  "projects-prepare-action.js": { operation: "action_open", mode: "conditional_read" },
  "projects-generate-workflow.js": { operation: "roadmap_generation", mode: "strategic_generation" },
  "projects-regenerate-workflow.js": { operation: "roadmap_regeneration", mode: "strategic_generation" },
  "projects-execute-action.js": { operation: "result_generation", mode: "strategic_generation" },
  "projects-execution-progress.js": { operation: "action_progress_save", mode: "state_mutation" },
  "projects-finalize-step.js": { operation: "step_completion", mode: "state_mutation" },
  "projects-session-respond.js": { operation: "action_progress_save", mode: "state_mutation" },
  "projects-session-review.js": { operation: "result_review", mode: "state_mutation" },
});

const READ_ONLY_MODES = new Set(["read_only"]);
const STRATEGIC_IMPORT_PATTERNS = [
  /generateProjectWorkflowWithModel/,
  /callProjectStructuredJson/,
  /executePreparedAction\(/,
  /generateExecutionPlan\(/,
];

export function classifyProjectsEndpoint(fileName) {
  return PROJECT_ENDPOINT_CLASSIFICATION[fileName] || { operation: "unknown", mode: "unknown" };
}

export function isReadOnlyEndpointClassification(classification) {
  return READ_ONLY_MODES.has(classification?.mode);
}

export function auditEndpointSourceForStrategicImports(relativePath) {
  const absolutePath = join(API_ROOT, relativePath);
  const source = readFileSync(absolutePath, "utf8");
  const classification = classifyProjectsEndpoint(relativePath);
  const directStrategicImports = STRATEGIC_IMPORT_PATTERNS.filter((pattern) => pattern.test(source));

  return {
    file: relativePath,
    classification,
    directStrategicImports: directStrategicImports.map((pattern) => String(pattern)),
    readOnlySafe:
      isReadOnlyEndpointClassification(classification) && directStrategicImports.length === 0,
  };
}

export function auditReadOnlyProjectsEndpoints() {
  return Object.keys(PROJECT_ENDPOINT_CLASSIFICATION)
    .filter((fileName) => isReadOnlyEndpointClassification(classifyProjectsEndpoint(fileName)))
    .map((fileName) => auditEndpointSourceForStrategicImports(fileName));
}

export function assertReadOnlyEndpointSafe(relativePath) {
  const audit = auditEndpointSourceForStrategicImports(relativePath);
  if (!audit.readOnlySafe) {
    return {
      ok: false,
      reason: audit.classification.mode === "read_only" ? "read_only_endpoint_imports_strategic_generation" : "not_read_only",
      audit,
    };
  }
  return { ok: true, audit };
}
