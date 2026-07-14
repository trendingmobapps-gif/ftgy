function effortBucket(minutes) {
  if (minutes <= 0) return "0m";
  if (minutes <= 2) return "1_2m";
  if (minutes <= 5) return "3_5m";
  return "over_5m";
}

export function serializeProjectBrainDecisionDiagnostics({
  decision,
  evidence,
  decisionReused,
  featureFlagEnabled,
}) {
  return {
    projectId: decision?.projectId || null,
    stepId: decision?.stepId || null,
    actionId: decision?.actionId || null,
    decisionId: decision?.decisionId || null,
    decisionVersion: decision?.decisionVersion || null,
    decisionType: decision?.decisionType || null,
    confidenceBands: {
      objectiveUnderstanding: decision?.confidence?.objectiveUnderstanding?.level || null,
      contextSufficiency: decision?.confidence?.contextSufficiency?.level || null,
      resultReadiness: decision?.confidence?.resultReadiness?.level || null,
      workflowStability: decision?.confidence?.workflowStability?.level || null,
    },
    memoryRefCount: evidence?.knownContext?.memoryRefs?.length || 0,
    resourceRefCount: evidence?.knownContext?.resourceRefs?.length || 0,
    resultRefCount: evidence?.knownContext?.resultRefs?.length || 0,
    questionsRequired: decision?.userEffort?.questionsRequired || 0,
    questionsAvoided: decision?.userEffort?.questionsAvoided || 0,
    estimatedUserEffortBucket: effortBucket(decision?.userEffort?.estimatedMinutes || 0),
    policyViolationCodes: decision?.policyCompliance?.violations || [],
    decisionSource: "deterministic_adapter",
    decisionReused: Boolean(decisionReused),
    featureFlagEnabled: Boolean(featureFlagEnabled),
  };
}

export function logProjectBrainDecision(logFn, input) {
  if (typeof logFn !== "function") return;
  logFn("[ProjectBrainDecision]", serializeProjectBrainDecisionDiagnostics(input));
}
