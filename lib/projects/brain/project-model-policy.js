const DEFAULT_FRONTIER = "gpt-5.6-sol";

export const PROJECT_MODEL_POLICY = {
  roadmap: {
    model: process.env.PROJECT_ROADMAP_MODEL?.trim() || DEFAULT_FRONTIER,
    reasoningEffort: "max",
    operation: "roadmap",
  },
  executionPlan: {
    model: process.env.PROJECT_EXECUTION_MODEL?.trim() || DEFAULT_FRONTIER,
    reasoningEffort: "xhigh",
    operation: "execution_plan",
  },
  recommendation: {
    model: process.env.PROJECT_RECOMMENDATION_MODEL?.trim() || DEFAULT_FRONTIER,
    reasoningEffort: "xhigh",
    operation: "recommendation",
  },
  evaluation: {
    model: process.env.PROJECT_EVALUATION_MODEL?.trim() || DEFAULT_FRONTIER,
    reasoningEffort: "xhigh",
    operation: "evaluation",
  },
};

export function resolveProjectModelPolicy(operation = "executionPlan") {
  const key = operation in PROJECT_MODEL_POLICY ? operation : "executionPlan";
  return PROJECT_MODEL_POLICY[key];
}

export function logProjectModelUsage(logFn, input) {
  if (typeof logFn !== "function") return;
  logFn({
    operation: input.operation,
    model: input.model,
    reasoningEffort: input.reasoningEffort || null,
    latencyMs: input.latencyMs ?? null,
    usedFallback: Boolean(input.usedFallback),
    fallbackReason: input.fallbackReason || null,
  });
}
