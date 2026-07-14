const MINIMUM_EFFORT_BLOCKING_VIOLATIONS = new Set([
  "MEMORY_NOT_CHECKED",
  "RESOURCES_NOT_CHECKED",
  "RESULTS_NOT_CHECKED",
  "TOO_MANY_USER_QUESTIONS",
  "QUESTION_WITHOUT_MATERIAL_IMPACT",
  "USER_INPUT_SELECTED_BEFORE_REUSE",
  "USER_INPUT_SELECTED_BEFORE_RESEARCH",
]);

const VISIBLE_VALUE_BLOCKING_VIOLATIONS = new Set([
  "VALUE_STEP_WITHOUT_VISIBLE_VALUE",
  "CONTEXT_ONLY_WITHOUT_EXPLANATION",
]);

function add(violations, code, condition) {
  if (condition && !violations.includes(code)) violations.push(code);
}

export function evaluateMinimumUserEffortPolicy(decision, evidence) {
  const violations = [];
  const retrieval = evidence?.retrievalStatus || {};
  const asked = (decision.missingInformation || []).filter((item) => item.mustAskUser === true);
  const isCollecting = decision.decisionType === "collect_minimal_context";
  const isContextOnly = decision.resultIntent?.type === "context_only";
  const isValueProducing = !["context_only", "verification"].includes(decision.resultIntent?.type);
  const knownContext = decision.knownContext || {};
  const evidenceCount = [
    ...(knownContext.decisionRefs || []),
    ...(knownContext.memoryRefs || []),
    ...(knownContext.resourceRefs || []),
    ...(knownContext.resultRefs || []),
    ...(knownContext.workflowRefs || []),
  ].length;

  add(violations, "MEMORY_NOT_CHECKED", retrieval.memoryChecked !== true);
  add(violations, "RESOURCES_NOT_CHECKED", retrieval.resourcesChecked !== true);
  add(violations, "RESULTS_NOT_CHECKED", retrieval.resultsChecked !== true);
  add(
    violations,
    "TOO_MANY_USER_QUESTIONS",
    asked.length > 3 || Number(evidence?.legacyQuestionCount || 0) > 3,
  );
  add(
    violations,
    "QUESTION_WITHOUT_MATERIAL_IMPACT",
    asked.some((item) => !String(item.materialImpact || "").trim()),
  );
  add(
    violations,
    "USER_INPUT_SELECTED_BEFORE_REUSE",
    isCollecting &&
      ((knownContext.resourceRefs || []).length > 0 || Boolean(evidence?.satisfyingAcceptedResult)),
  );
  add(
    violations,
    "USER_INPUT_SELECTED_BEFORE_RESEARCH",
    isCollecting &&
      evidence?.research?.required === true &&
      asked.some((item) => item.canResearch === true),
  );
  add(
    violations,
    "VALUE_STEP_WITHOUT_VISIBLE_VALUE",
    isValueProducing && decision.resultIntent?.createVisibleValue !== true,
  );
  add(
    violations,
    "CONTEXT_ONLY_WITHOUT_EXPLANATION",
    isContextOnly && String(decision.reasoningSummary || "").trim().length < 20,
  );
  add(
    violations,
    "DECISION_EVIDENCE_MISSING",
    evidenceCount === 0 || !evidence?.projectRef?.id || !evidence?.stepRef?.id,
  );
  add(
    violations,
    "LEGACY_FALLBACK_FORM_BIAS",
    evidence?.legacyDecision?.strategy === "ask_clarification" &&
      Number(evidence?.legacyQuestionCount || 0) >= 3,
  );
  add(
    violations,
    "LEGACY_FALLBACK_ASK_BIAS",
    evidence?.legacyDecision?.strategy === "ask_clarification" &&
      (Boolean(evidence?.satisfyingAcceptedResult) ||
        (knownContext.resourceRefs || []).length > 0 ||
        evidence?.research?.required === true),
  );

  const minimumUserEffortPassed = !violations.some((code) =>
    MINIMUM_EFFORT_BLOCKING_VIOLATIONS.has(code),
  );
  const visibleValuePassed = !violations.some((code) =>
    VISIBLE_VALUE_BLOCKING_VIOLATIONS.has(code),
  );

  return {
    minimumUserEffortPassed,
    visibleValuePassed,
    contextReuseChecked:
      retrieval.memoryChecked === true &&
      retrieval.resourcesChecked === true &&
      retrieval.resultsChecked === true,
    violations,
  };
}

export function applyMinimumUserEffortPolicy(decision, evidence) {
  return {
    ...decision,
    policyCompliance: evaluateMinimumUserEffortPolicy(decision, evidence),
  };
}
