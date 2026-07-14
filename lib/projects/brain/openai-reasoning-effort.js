const SUPPORTED_PROVIDER_EFFORTS = new Set(["minimal", "low", "medium", "high"]);

/**
 * Step 1 reasoning policy:
 * - configured max/xhigh never auto-map to high
 * - default provider effort is medium for structured operations
 * - high only for complex/exceptional complexity metadata
 * - exceptional requires explicit reasonCode
 */
export function resolveProviderReasoningEffort({
  operation,
  configuredEffort,
  complexity = "standard",
  reasonCode = null,
}) {
  const normalizedComplexity = complexity || "standard";
  const base = {
    operation: operation || null,
    configuredEffort: configuredEffort || null,
    complexity: normalizedComplexity,
    reasonCode: reasonCode || null,
    highReasoningUsed: false,
  };

  if (normalizedComplexity === "exceptional") {
    if (!reasonCode) {
      return {
        ...base,
        providerReasoningEffort: "medium",
        highReasoningUsed: false,
        highReasonRejected: true,
      };
    }

    return {
      ...base,
      providerReasoningEffort: "high",
      highReasoningUsed: true,
      reasonCode,
    };
  }

  if (normalizedComplexity === "complex") {
    return {
      ...base,
      providerReasoningEffort: "high",
      highReasoningUsed: true,
      reasonCode: reasonCode || "complexity_complex",
    };
  }

  return {
    ...base,
    providerReasoningEffort: "medium",
    highReasoningUsed: false,
    reasonCode: null,
  };
}

export function assertSupportedProviderReasoningEffort(effort) {
  if (!SUPPORTED_PROVIDER_EFFORTS.has(effort)) {
    return "medium";
  }
  return effort;
}

export function resolveExceptionalReasonCode({ complexity, highStakes = false, repairAttempt = false }) {
  if (complexity !== "exceptional") {
    return null;
  }
  if (repairAttempt) {
    return "repair_attempt";
  }
  if (highStakes) {
    return "high_stakes_goal";
  }
  return "multi_constraint_goal";
}
