import {
  resolveRoadmapComplexity,
  resolveExecutionPlanComplexity,
} from "./openai-complexity.js";

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

const AMBIGUITY_MARKERS = [
  /\b(?:nu știu|maybe|perhaps|either|sau|or)\b/i,
  /\?/,
];

function countPatternMatches(text, patterns) {
  if (!text || typeof text !== "string") return 0;
  return patterns.reduce((count, pattern) => (pattern.test(text) ? count + 1 : count), 0);
}

function pushSignal(signals, code, weight = 1) {
  signals.push({ code, weight });
}

function resolveReasonCode(level, signals) {
  if (level === "exceptional") {
    const codes = signals.map((signal) => signal.code);
    if (codes.includes("high_stakes")) return "high_stakes_goal";
    if (codes.includes("research_required")) return "research_synthesis_required";
    if (codes.includes("multi_constraint")) return "multi_constraint_goal";
    return "exceptional_structural_signals";
  }
  if (level === "complex") {
    if (signals.some((signal) => signal.code === "research_required")) return "research_required";
    if (signals.some((signal) => signal.code === "workflow_breadth")) return "workflow_breadth";
    return "complexity_complex";
  }
  if (level === "simple") return "simple_mechanical";
  return null;
}

function classifyFromSignals(signals) {
  if (signals.length === 0) {
    return "standard";
  }
  const weighted = signals.reduce((sum, signal) => sum + (signal.weight || 1), 0);
  const strongSignals = signals.filter((signal) => (signal.weight || 1) >= 2);
  const hasHighStakes = signals.some((signal) => signal.code === "high_stakes");
  const hasResearch = signals.some((signal) => signal.code === "research_required");
  const hasRepairHistory = signals.some((signal) => signal.code === "prior_repair");

  if (strongSignals.length >= 2 && (hasHighStakes || hasResearch || weighted >= 6)) {
    return "exceptional";
  }

  if (weighted >= 4 || strongSignals.length >= 1 || hasResearch || hasRepairHistory) {
    return "complex";
  }

  if (weighted <= 1 && signals.length <= 2 && !hasResearch && !hasHighStakes) {
    return "simple";
  }

  return "standard";
}

export function classifyOpenAiOperationComplexity({
  role,
  project,
  clarificationAnswers,
  context,
  executionDecision,
  operationContext = {},
}) {
  const signals = [];
  const repairAttempt = Number(operationContext?.priorRepairCount || 0) > 0;

  if (repairAttempt) {
    pushSignal(signals, "prior_repair", 2);
  }

  const goal = String(project?.goal || context?.projectGoal || "").trim();
  const constraintCount = countPatternMatches(goal, CONSTRAINT_MARKERS);
  const highStakes = countPatternMatches(goal, HIGH_STAKES_MARKERS) > 0;
  const ambiguityCount = countPatternMatches(goal, AMBIGUITY_MARKERS);

  if (constraintCount > 0) pushSignal(signals, "explicit_constraints", constraintCount);
  if (constraintCount >= 3) pushSignal(signals, "multi_constraint", 2);
  if (highStakes) pushSignal(signals, "high_stakes", 2);
  if (ambiguityCount > 0) pushSignal(signals, "goal_ambiguity", ambiguityCount);

  const clarificationCount = Array.isArray(clarificationAnswers) ? clarificationAnswers.length : 0;
  if (clarificationCount > 0) pushSignal(signals, "clarifications_present", 1);

  const dependencyCount = Number(operationContext?.dependencyCount || 0);
  if (dependencyCount >= 3) pushSignal(signals, "dependency_breadth", 2);
  else if (dependencyCount > 0) pushSignal(signals, "dependency_breadth", 1);

  const contextLength =
    Number(operationContext?.contextLength || 0) ||
    String(context?.memorySummary || "").length +
      String(context?.completedStepsSummary || "").length +
      String(context?.stepDescription || "").length;

  if (contextLength >= 1200) pushSignal(signals, "context_breadth", 2);
  else if (contextLength >= 500) pushSignal(signals, "context_breadth", 1);

  const researchRequired =
    operationContext?.researchRequired === true ||
    executionDecision?.strategy === "web_then_generate" ||
    executionDecision?.strategy === "research" ||
    role === "researchSynthesis";

  if (researchRequired) pushSignal(signals, "research_required", 2);

  const artifactComplexity = String(operationContext?.artifactComplexity || "").toLowerCase();
  if (["document", "spreadsheet", "assessment", "recommendation"].includes(artifactComplexity)) {
    pushSignal(signals, "artifact_complexity", 2);
  }

  const synthesisCount = Number(operationContext?.synthesisResourceCount || 0);
  if (synthesisCount >= 2) pushSignal(signals, "multi_resource_synthesis", 2);

  let level = classifyFromSignals(signals);

  if (role === "roadmap") {
    level = resolveRoadmapComplexity({ project, clarificationAnswers, repairAttempt });
  } else if (role === "executionPlanLegacy" || role === "experienceDesign") {
    level = resolveExecutionPlanComplexity({ context, executionDecision, repairAttempt });
  } else if (role === "resultGeneration") {
    if (operationContext?.strategicOutput === true || synthesisCount >= 2) {
      level = level === "exceptional" ? "exceptional" : "complex";
    } else if (operationContext?.mechanicalOutput === true && !researchRequired) {
      level = "simple";
    }
  } else if (["extraction", "formatting", "evaluation"].includes(role)) {
    level = repairAttempt ? "standard" : "simple";
  }

  if (level === "exceptional" && signals.filter((signal) => (signal.weight || 1) >= 2).length < 2) {
    level = "complex";
  }

  if (!level) {
    level = "standard";
  }

  return {
    level,
    signals: signals.map((signal) => signal.code),
    signalsCount: signals.length,
    reasonCode: resolveReasonCode(level, signals),
  };
}

export function resolveComplexityLevel(input) {
  return classifyOpenAiOperationComplexity(input).level;
}
