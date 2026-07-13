const DEFAULT_FRONTIER = "gpt-5.6-sol";

function resolveModelFromEnv(primaryKey, secondaryKey) {
  const primary = process.env[primaryKey]?.trim();
  if (primary) return primary;
  const secondary = secondaryKey ? process.env[secondaryKey]?.trim() : "";
  return secondary || DEFAULT_FRONTIER;
}

export const PROJECT_MODEL_POLICY = {
  roadmap: {
    get model() {
      return resolveModelFromEnv("PROJECT_ROADMAP_MODEL", "PROJECT_BRAIN_MODEL");
    },
    reasoningEffort: "max",
    operation: "roadmap",
  },
  executionPlan: {
    get model() {
      return resolveModelFromEnv("PROJECT_EXECUTION_MODEL", "PROJECT_BRAIN_MODEL");
    },
    reasoningEffort: "xhigh",
    operation: "execution_plan",
  },
  recommendation: {
    get model() {
      return resolveModelFromEnv("PROJECT_RECOMMENDATION_MODEL", "PROJECT_BRAIN_MODEL");
    },
    reasoningEffort: "xhigh",
    operation: "recommendation",
  },
  evaluation: {
    get model() {
      return resolveModelFromEnv("PROJECT_EVALUATION_MODEL", "PROJECT_BRAIN_MODEL");
    },
    reasoningEffort: "xhigh",
    operation: "evaluation",
  },
};

export function resolveProjectModelPolicy(operation = "executionPlan") {
  const key = operation in PROJECT_MODEL_POLICY ? operation : "executionPlan";
  const policy = PROJECT_MODEL_POLICY[key];
  return {
    model: policy.model,
    reasoningEffort: policy.reasoningEffort,
    operation: policy.operation,
  };
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
