import { computeRoadmapEvidenceHash } from "./openai-evidence-hash.js";
import { isProjectBrainDecisionContractAuthoritative } from "./decision/index.js";

export const READ_ONLY_PROJECT_OPERATIONS = Object.freeze([
  "project_open",
  "project_refresh",
  "project_list",
  "workflow_read",
  "workflow_poll",
  "project_tab_navigation",
  "action_open",
  "action_refresh",
  "action_resume",
  "resource_open",
  "result_open",
  "mobile_reconnect",
  "app_background_foreground",
]);

export const STRATEGIC_GENERATION_OPERATIONS = Object.freeze([
  "roadmap_generation",
  "roadmap_regeneration",
  "action_design",
  "action_design_regeneration",
  "result_generation",
  "result_revision",
  "workflow_adaptation",
]);

export function isReadOnlyProjectOperation(operation) {
  return READ_ONLY_PROJECT_OPERATIONS.includes(operation);
}

export function isStrategicGenerationOperation(operation) {
  return STRATEGIC_GENERATION_OPERATIONS.includes(operation);
}

export function assertReadOnlyOperation(operation) {
  if (!isReadOnlyProjectOperation(operation)) {
    return { ok: false, reason: "unknown_read_operation" };
  }
  return { ok: true, strategicCallsPermitted: false };
}

export function isNonMaterialProjectUpdate({ before = {}, after = {}, clarificationAnswers = [] } = {}) {
  const beforeHash = computeRoadmapEvidenceHash({ project: before, clarificationAnswers });
  const afterHash = computeRoadmapEvidenceHash({ project: after, clarificationAnswers });
  return beforeHash === afterHash;
}

export function resolveExecutionPlanStrategicRole(complexityLevel = "standard") {
  if (!isProjectBrainDecisionContractAuthoritative()) {
    return "experienceDesign";
  }
  if (complexityLevel === "complex" || complexityLevel === "exceptional") {
    return "experienceDesign";
  }
  return "executionPlanLegacy";
}

export function describeStrategicCallInventory() {
  return {
    roadmap: { role: "roadmap", budgetScope: "project_creation", maxPerEvidenceVersion: 1 },
    actionDesign: {
      role: "experienceDesign",
      budgetScope: "action",
      maxPerEvidenceVersion: 1,
      frontierUntilDecisionContractAuthoritative: !isProjectBrainDecisionContractAuthoritative(),
    },
    resultGeneration: { role: "resultGeneration", budgetScope: "action", maxPerIdempotencyKey: 1 },
    workflowAdaptation: { role: "decision", budgetScope: "action", maxPerEvidenceVersion: 1, gated: true },
  };
}
