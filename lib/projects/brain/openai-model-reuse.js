import { PROJECT_MODEL_INTERNAL_CODES } from "./project-model-internal-codes.js";
import {
  computeExecutionPlanEvidenceHash,
  computeResultGenerationEvidenceHash,
  computeRoadmapEvidenceHash,
  extractRoadmapEvidenceHashFromBrainVersion,
} from "./openai-evidence-hash.js";
import { EXECUTION_PLAN_VERSION } from "./execution/execution-plan-validation.js";

export function shouldReuseRoadmapGeneration({
  project,
  clarificationAnswers = [],
  bundle,
}) {
  if (!bundle?.workflow || bundle.workflow.status !== "ready") {
    return { reuse: false, reason: "workflow_not_ready" };
  }

  const currentHash = computeRoadmapEvidenceHash({ project, clarificationAnswers });
  const persistedHash = extractRoadmapEvidenceHashFromBrainVersion(bundle.workflow.brain_version);
  if (persistedHash && persistedHash === currentHash.slice(0, persistedHash.length)) {
    return {
      reuse: true,
      reason: "roadmap_evidence_unchanged",
      evidenceHash: currentHash,
      internalCode: PROJECT_MODEL_INTERNAL_CODES.REUSE_HIT,
    };
  }

  if (!persistedHash) {
    return {
      reuse: true,
      reason: "workflow_ready_without_hash",
      evidenceHash: currentHash,
      internalCode: PROJECT_MODEL_INTERNAL_CODES.REUSE_HIT,
    };
  }

  return {
    reuse: false,
    reason: "roadmap_evidence_changed",
    evidenceHash: currentHash,
  };
}

export function getExecutionPlanEvidenceFromPreparedInput(preparedInput = {}) {
  return {
    hash: preparedInput?._executionPlanEvidenceHash || null,
    contractVersion: preparedInput?._executionPlanContractVersion || null,
  };
}

export function withExecutionPlanEvidence(preparedInput = {}, { evidenceHash, contractVersion = EXECUTION_PLAN_VERSION }) {
  return {
    ...(preparedInput || {}),
    _executionPlanEvidenceHash: evidenceHash || null,
    _executionPlanContractVersion: contractVersion,
  };
}

export function shouldReuseExecutionPlan({
  preparedInput = {},
  evidenceHash,
  contractVersion = EXECUTION_PLAN_VERSION,
  plan,
}) {
  const persisted = getExecutionPlanEvidenceFromPreparedInput(preparedInput);
  if (!plan) {
    return { reuse: false, reason: "missing_plan" };
  }
  if (persisted.contractVersion !== contractVersion) {
    return { reuse: false, reason: "contract_version_changed" };
  }
  if (persisted.hash && persisted.hash === evidenceHash) {
    return {
      reuse: true,
      reason: "execution_plan_evidence_unchanged",
      evidenceHash,
      internalCode: PROJECT_MODEL_INTERNAL_CODES.REUSE_HIT,
    };
  }
  return { reuse: false, reason: "execution_plan_evidence_changed", evidenceHash };
}

export function getResultIdempotencyFromPreparedInput(preparedInput = {}) {
  return preparedInput?._resultIdempotency || null;
}

export function withResultIdempotency(preparedInput = {}, ledger) {
  return {
    ...(preparedInput || {}),
    _resultIdempotency: ledger,
  };
}

export function shouldReusePersistedResult({
  preparedInput = {},
  evidenceHash,
  idempotencyKey = null,
  revisionId = null,
}) {
  const ledger = getResultIdempotencyFromPreparedInput(preparedInput);
  if (!ledger) {
    return { reuse: false, reason: "missing_ledger" };
  }
  if (ledger.invalidatedAt || ledger.acceptanceStatus === "rejected") {
    return { reuse: false, reason: "ledger_invalidated" };
  }
  if (revisionId && ledger.revisionId !== revisionId) {
    return { reuse: false, reason: "revision_changed" };
  }
  if (idempotencyKey && ledger.idempotencyKey === idempotencyKey) {
    return {
      reuse: true,
      reason: "idempotency_key_match",
      resultId: ledger.resultId || null,
      evidenceHash,
      internalCode: PROJECT_MODEL_INTERNAL_CODES.REUSE_HIT,
    };
  }
  if (ledger.evidenceHash && ledger.evidenceHash === evidenceHash) {
    return {
      reuse: true,
      reason: "accepted_input_hash_match",
      resultId: ledger.resultId || null,
      evidenceHash,
      internalCode: PROJECT_MODEL_INTERNAL_CODES.REUSE_HIT,
    };
  }
  return { reuse: false, reason: "result_evidence_changed", evidenceHash };
}

export function buildResultIdempotencyLedger({
  actionId,
  idempotencyKey,
  acceptedInput,
  resultId,
  executionPlan = null,
  contextVersions = {},
  revisionId = null,
  parentResultId = null,
}) {
  const evidenceHash = computeResultGenerationEvidenceHash({
    actionId,
    idempotencyKey,
    acceptedInput,
    executionPlan,
    contextVersions,
    revisionId,
    parentResultId,
  });
  return {
    actionId,
    idempotencyKey: idempotencyKey || null,
    evidenceHash,
    resultId: resultId || null,
    revisionId,
    parentResultId,
    acceptanceStatus: "pending_review",
    updatedAt: new Date().toISOString(),
  };
}

export function invalidateResultIdempotency(preparedInput = {}, {
  resultId = null,
  acceptanceStatus = "rejected",
} = {}) {
  const current = getResultIdempotencyFromPreparedInput(preparedInput);
  if (!current || (resultId && current.resultId !== resultId)) {
    return preparedInput || {};
  }
  return {
    ...(preparedInput || {}),
    _resultIdempotency: {
      ...current,
      acceptanceStatus,
      invalidatedAt: new Date().toISOString(),
    },
  };
}

export function readModelUsageState(preparedInput = {}) {
  return preparedInput?._modelUsageState || {
    projectCreationFrontierCalls: 0,
    actionDesignFrontierCalls: 0,
    resultFrontierCalls: 0,
    revisionFrontierCalls: 0,
  };
}

export function withModelUsageState(preparedInput = {}, state) {
  return {
    ...(preparedInput || {}),
    _modelUsageState: {
      projectCreationFrontierCalls: Number(
        state?.projectCreationFrontierCalls ?? state?.projectFrontierCalls ?? 0,
      ),
      actionDesignFrontierCalls: Number(state?.actionDesignFrontierCalls || 0),
      resultFrontierCalls: Number(
        state?.resultFrontierCalls ?? state?.actionFrontierCalls ?? 0,
      ),
      revisionFrontierCalls: Number(state?.revisionFrontierCalls || 0),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function incrementFrontierUsageState(state = {}, {
  projectCreationDelta = 0,
  actionDesignDelta = 0,
  resultDelta = 0,
  revisionDelta = 0,
  projectDelta = 0,
  actionDelta = 0,
} = {}) {
  return {
    projectCreationFrontierCalls:
      Number(state.projectCreationFrontierCalls ?? state.projectFrontierCalls ?? 0) +
      projectCreationDelta +
      projectDelta,
    actionDesignFrontierCalls:
      Number(state.actionDesignFrontierCalls || 0) + actionDesignDelta,
    resultFrontierCalls:
      Number(state.resultFrontierCalls ?? state.actionFrontierCalls ?? 0) +
      resultDelta +
      actionDelta,
    revisionFrontierCalls:
      Number(state.revisionFrontierCalls || 0) + revisionDelta,
  };
}

export function buildExecutionPlanEvidenceInput({
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
}) {
  return computeExecutionPlanEvidenceHash({
    actionId,
    step,
    project,
    preparation,
    memoryMap,
    executionDecision,
    workflowVersion,
    brainDecisionEvidenceHash,
    memoryVersions,
    resourceReferences,
    resultReferences,
    acceptedOutputReferences,
  });
}
