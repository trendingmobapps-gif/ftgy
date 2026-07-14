/**
 * Step 1 minimal deterministic complexity signals.
 * Category-agnostic structural heuristics only.
 */

const CONSTRAINT_MARKERS = [
  /\b\d+\s*(?:kg|luni|săpt|zile|ani)\b/i,
  /\b(?:până|until|deadline|termen)\b/i,
  /\b(?:buget|budget|cost|investiție)\b/i,
  /\b(?:reglementat|conform|legal|licen[țt][ăa])\b/i,
  /\b(?:research|cercetare|analiz[ăa]\s+pia[țt][ăa])\b/i,
];

const HIGH_STAKES_MARKERS = [
  /\b(?:medical|diagnostic|tratament|medication)\b/i,
  /\b(?:investi[țt]ii|trading|crypto)\b/i,
  /\b(?:copii|minor|vulnerabil)\b/i,
];

function countPatternMatches(text, patterns) {
  if (!text || typeof text !== "string") return 0;
  return patterns.reduce((count, pattern) => (pattern.test(text) ? count + 1 : count), 0);
}

/**
 * Roadmap complexity rules:
 * - simple: short clear goal, no clarifications, <=1 constraint marker
 * - standard: default when signals are mixed or unavailable
 * - complex: long goal (>=220 chars) OR >=2 constraint markers OR clarifications present OR high-stakes marker
 * - exceptional: >=3 constraint markers AND (high-stakes OR goal length >=400)
 */
export function resolveRoadmapComplexity({ project, clarificationAnswers, repairAttempt = false }) {
  if (repairAttempt) {
    return "standard";
  }

  const goal = typeof project?.goal === "string" ? project.goal.trim() : "";
  const clarificationCount = Array.isArray(clarificationAnswers) ? clarificationAnswers.length : 0;
  const constraintCount = countPatternMatches(goal, CONSTRAINT_MARKERS);
  const highStakes = countPatternMatches(goal, HIGH_STAKES_MARKERS) > 0;

  if (constraintCount >= 3 && (highStakes || goal.length >= 400)) {
    return "exceptional";
  }

  if (goal.length >= 220 || constraintCount >= 2 || clarificationCount > 0 || highStakes) {
    return "complex";
  }

  if (goal.length <= 120 && constraintCount <= 1 && clarificationCount === 0) {
    return "simple";
  }

  return "standard";
}

/**
 * Execution-plan complexity rules:
 * - simple: checklist/choice mode likely, narrow step, no research strategy, short memory
 * - standard: default
 * - complex: assessment/guided/recommendation modes, research strategy, broad memory/completed context
 * - exceptional: research strategy + long aggregated context (>=1200 chars) + high-stakes project goal
 */
export function resolveExecutionPlanComplexity({ context, executionDecision, repairAttempt = false }) {
  if (repairAttempt) {
    return "standard";
  }

  const strategy = executionDecision?.strategy || context?.executionStrategy || "";
  const memoryLen = String(context?.memorySummary || "").length;
  const completedLen = String(context?.completedStepsSummary || "").length;
  const goalLen = String(context?.projectGoal || "").length;
  const highStakes = countPatternMatches(String(context?.projectGoal || ""), HIGH_STAKES_MARKERS) > 0;
  const researchRequired = strategy === "web_then_generate" || strategy === "research";

  const aggregatedContextLen = memoryLen + completedLen + String(context?.stepDescription || "").length;

  if (researchRequired && aggregatedContextLen >= 1200 && highStakes) {
    return "exceptional";
  }

  if (
    researchRequired ||
    aggregatedContextLen >= 900 ||
    /assessment|recommendation|guided|structured_form/i.test(String(context?.stepTitle || ""))
  ) {
    return "complex";
  }

  if (aggregatedContextLen <= 200 && goalLen <= 160 && !researchRequired) {
    return "simple";
  }

  return "standard";
}

export function resolveStructuredOperationComplexity({
  operation,
  project,
  clarificationAnswers,
  context,
  executionDecision,
  repairAttempt = false,
}) {
  if (operation === "roadmap") {
    return resolveRoadmapComplexity({ project, clarificationAnswers, repairAttempt });
  }

  if (operation === "executionPlan") {
    return resolveExecutionPlanComplexity({ context, executionDecision, repairAttempt });
  }

  return "standard";
}
