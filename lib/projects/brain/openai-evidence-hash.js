import { createHash } from "node:crypto";

import { EXECUTION_PLAN_VERSION } from "./execution/execution-plan-validation.js";
import { PROJECT_BRAIN_VERSION } from "./constants.js";

export const PROJECT_MODEL_POLICY_VERSION = "projects-strategic-calls-v1";
export const RESULT_CONTRACT_VERSION = 1;

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map(stableSort);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSort(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function hashFingerprint(fingerprint) {
  return createHash("sha256").update(JSON.stringify(stableSort(fingerprint))).digest("hex");
}

function normalizeMaterialValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeMaterialValue);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .filter(
        (key) =>
          ![
            "activeTab",
            "currentQuestionIndex",
            "navigation",
            "pollingTimestamp",
            "updatedAt",
            "updated_at",
          ].includes(key),
      )
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeMaterialValue(value[key]);
        return acc;
      }, {});
  }
  if (typeof value === "string") {
    return value.trim().replace(/\s+/g, " ");
  }
  return value ?? null;
}

export function computeRoadmapEvidenceFingerprint({ project, clarificationAnswers = [] }) {
  return {
    contractVersion: PROJECT_BRAIN_VERSION,
    modelPolicyVersion: PROJECT_MODEL_POLICY_VERSION,
    goal: normalizeMaterialValue(project?.goal),
    materialConstraints: normalizeMaterialValue(
      project?.constraints || project?.material_constraints || project?.description,
    ),
    clarificationAnswers: (clarificationAnswers || [])
      .map((answer) => ({
        questionId: String(answer?.questionId || "").trim(),
        answer: normalizeMaterialValue(answer?.answer),
      }))
      .sort((a, b) => a.questionId.localeCompare(b.questionId)),
    acceptedProjectDecisions: normalizeMaterialValue(
      project?.accepted_decisions || project?.acceptedDecisions || [],
    ),
  };
}

export function computeRoadmapEvidenceHash(input) {
  return hashFingerprint(computeRoadmapEvidenceFingerprint(input));
}

export function extractRoadmapEvidenceHashFromBrainVersion(brainVersion) {
  const value = String(brainVersion || "");
  const parts = value.split(":");
  if (parts.length >= 2 && parts[1].length >= 8) {
    return parts.slice(1).join(":");
  }
  return null;
}

export function encodeRoadmapBrainVersionWithEvidence({ brainVersion = PROJECT_BRAIN_VERSION, evidenceHash }) {
  const hash = String(evidenceHash || "").slice(0, 16);
  return hash ? `${brainVersion}:${hash}` : brainVersion;
}

export function computeExecutionPlanEvidenceFingerprint({
  actionId,
  step,
  project,
  preparation,
  memoryMap,
  executionDecision,
  workflowVersion = null,
  brainDecisionEvidenceHash = null,
  memoryVersions = null,
  resourceReferences = [],
  resultReferences = [],
  acceptedOutputReferences = [],
  contractVersion = EXECUTION_PLAN_VERSION,
}) {
  const memoryEntries = memoryMap instanceof Map
    ? [...memoryMap.entries()].map(([key, value]) => ({
        key,
        value: normalizeMaterialValue(value),
        version: memoryVersions?.get?.(key) || memoryVersions?.[key] || null,
      }))
    : [];

  return {
    contractVersion,
    modelPolicyVersion: PROJECT_MODEL_POLICY_VERSION,
    actionId: actionId || null,
    stepId: step?.id || null,
    stepObjective: normalizeMaterialValue(step?.expected_outcome || step?.description),
    workflowVersion: workflowVersion || project?.brain_version || null,
    brainDecisionEvidenceHash,
    strategy: executionDecision?.strategy || null,
    missingFieldCount: Array.isArray(preparation?.missingFields) ? preparation.missingFields.length : 0,
    relevantMemory: memoryEntries.sort((a, b) => String(a.key).localeCompare(String(b.key))),
    resourceReferences: normalizeMaterialValue(resourceReferences),
    resultReferences: normalizeMaterialValue(resultReferences),
    acceptedOutputReferences: normalizeMaterialValue(acceptedOutputReferences),
    researchRequired: Boolean(executionDecision?.webSearch?.required),
  };
}

export function computeExecutionPlanEvidenceHash(input) {
  return hashFingerprint(computeExecutionPlanEvidenceFingerprint(input));
}

export function computeAcceptedInputHash(acceptedInput = {}) {
  const { idempotencyKey: _idempotencyKey, ...materialInput } = acceptedInput || {};
  return hashFingerprint(normalizeMaterialValue(materialInput));
}

export function computeResultGenerationEvidenceFingerprint({
  actionId,
  idempotencyKey,
  acceptedInput = {},
  executionPlan = null,
  contextVersions = {},
  resultContractVersion = RESULT_CONTRACT_VERSION,
  revisionId = null,
  parentResultId = null,
}) {
  return {
    actionId: actionId || null,
    idempotencyKey: idempotencyKey || null,
    acceptedInputHash: computeAcceptedInputHash(acceptedInput),
    resultContractVersion,
    planId: executionPlan?.planId || null,
    planMode: executionPlan?.mode || null,
    planVersion: executionPlan?.metadata?.version || null,
    contextVersions: normalizeMaterialValue(contextVersions),
    revisionId,
    parentResultId,
  };
}

export function computeResultGenerationEvidenceHash(input) {
  return hashFingerprint(computeResultGenerationEvidenceFingerprint(input));
}
