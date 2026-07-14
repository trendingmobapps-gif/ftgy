import { createDeterministicProjectBrainDecision } from "./deterministic-decision-adapter.js";
import { logProjectBrainDecision } from "./decision-observability.js";
import { validateProjectBrainDecisionContract } from "./contract-validator.js";

export {
  buildProjectBrainDecisionJsonSchema,
  PROJECT_BRAIN_DECISION_TYPES,
  PROJECT_BRAIN_DECISION_VERSION,
  PROJECT_BRAIN_POLICY_VIOLATIONS,
} from "./contract-schema.js";
export { validateProjectBrainDecisionContract } from "./contract-validator.js";
export { retrieveProjectBrainDecisionContext, hashProjectBrainDecisionEvidence } from "./context-retrieval.js";
export { evaluateMinimumUserEffortPolicy } from "./minimum-user-effort-policy.js";
export { createDeterministicProjectBrainDecision, DETERMINISTIC_CONFIDENCE_RULES } from "./deterministic-decision-adapter.js";
export { serializeProjectBrainDecisionDiagnostics } from "./decision-observability.js";

export function isProjectBrainDecisionLayerEnabled(env = process.env) {
  return ["1", "true"].includes(String(env.PROJECT_BRAIN_DECISION_LAYER_ENABLED || "").trim().toLowerCase());
}

export function buildOrReuseProjectBrainDecision({
  evidence,
  persistedPreparedInput = {},
  actionId = null,
  nowIso,
  logFn = console.log,
}) {
  const persistedDecision = persistedPreparedInput?._brainDecision || null;
  const persistedHash = persistedPreparedInput?._brainDecisionEvidenceHash || null;
  const persistedVersion = persistedPreparedInput?._brainDecisionVersion || null;
  const persistedValidation = persistedDecision
    ? validateProjectBrainDecisionContract(persistedDecision)
    : { valid: false, errors: ["persisted_decision_missing"] };

  const decisionReused =
    persistedValidation.valid &&
    persistedVersion === 1 &&
    persistedHash === evidence.evidenceHash;

  const decision = decisionReused
    ? persistedDecision
    : createDeterministicProjectBrainDecision({
        evidence,
        actionId,
        nowIso,
      });

  const validation = validateProjectBrainDecisionContract(decision);
  if (!validation.valid) {
    const error = new Error(`Invalid deterministic ProjectBrainDecisionContract: ${validation.errors.join(",")}`);
    error.code = "PROJECT_BRAIN_DECISION_INVALID";
    error.validationErrors = validation.errors;
    throw error;
  }

  logProjectBrainDecision(logFn, {
    decision,
    evidence,
    decisionReused,
    featureFlagEnabled: true,
  });

  return {
    decision,
    decisionReused,
    regenerated: !decisionReused,
    evidenceHash: evidence.evidenceHash,
    validation,
  };
}

export function withProjectBrainDecision(preparedInput, state) {
  return {
    ...(preparedInput || {}),
    _brainDecision: state.decision,
    _brainDecisionVersion: state.decision.decisionVersion,
    _brainDecisionEvidenceHash: state.evidenceHash,
  };
}

export function serializeSafeProjectBrainDecision(decision) {
  if (!decision) return undefined;
  return {
    decisionId: decision.decisionId,
    decisionVersion: decision.decisionVersion,
    decisionType: decision.decisionType,
    reasoningSummary: decision.reasoningSummary,
    userEffort: {
      estimatedMinutes: decision.userEffort.estimatedMinutes,
      interactionCount: decision.userEffort.interactionCount,
      questionsRequired: decision.userEffort.questionsRequired,
    },
    resultIntent: {
      type: decision.resultIntent.type,
      createVisibleValue: decision.resultIntent.createVisibleValue,
      createResource: decision.resultIntent.createResource,
      requireGeneratedResult: decision.resultIntent.requireGeneratedResult,
      requireReview: decision.resultIntent.requireReview,
      requireAcceptance: decision.resultIntent.requireAcceptance,
    },
    workflowImpact: {
      reconsiderWorkflow: decision.workflowImpact.reconsiderWorkflow,
      proposalRequired: decision.workflowImpact.proposalRequired,
    },
    policyCompliance: {
      minimumUserEffortPassed: decision.policyCompliance.minimumUserEffortPassed,
      visibleValuePassed: decision.policyCompliance.visibleValuePassed,
      violations: decision.policyCompliance.violations,
    },
  };
}
