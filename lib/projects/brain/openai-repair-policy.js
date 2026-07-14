import { isNonRetryableOpenAiError } from "./openai-error-classification.js";
import { OPENAI_INTERNAL_ERROR_CODES } from "./openai-error-codes.js";

export const REPAIR_ROLE = {
  FORMATTING: "formatting",
  DECISION_REPAIR: "decisionRepair",
};

export function resolveRepairRole({ originalRole, failureKind, complexity = "standard" }) {
  if (originalRole === "decision" || originalRole === "decisionRepair") {
    return REPAIR_ROLE.DECISION_REPAIR;
  }

  if (failureKind === "validation_failed" || failureKind === "malformed_json") {
    return REPAIR_ROLE.FORMATTING;
  }

  if (complexity === "complex" || complexity === "exceptional") {
    return originalRole === "roadmap" ? "roadmap" : REPAIR_ROLE.FORMATTING;
  }

  return REPAIR_ROLE.FORMATTING;
}

export function shouldAttemptDeterministicRepair({ failureKind }) {
  return failureKind === "validation_failed" || failureKind === "malformed_json";
}

export function shouldEscalateRepairToFrontier({
  originalRole,
  repairRole,
  efficientRepairFailed = false,
  complexity = "standard",
}) {
  if (!efficientRepairFailed) return false;
  if (originalRole === "roadmap") return false;
  if (["decision", "resultGeneration", "resultRevision", "experienceDesign", "researchSynthesis"].includes(originalRole)) {
    return complexity === "complex" || complexity === "exceptional";
  }
  return false;
}

export function canAttemptModelRepair({
  priorRepairCount = 0,
  maxRepairCalls = 1,
  classifiedErrorCode = null,
}) {
  if (priorRepairCount >= maxRepairCalls) {
    return false;
  }
  if (classifiedErrorCode && isNonRetryableOpenAiError(classifiedErrorCode)) {
    return false;
  }
  if (
    classifiedErrorCode === OPENAI_INTERNAL_ERROR_CODES.QUOTA_EXCEEDED ||
    classifiedErrorCode === OPENAI_INTERNAL_ERROR_CODES.AUTH_FAILED ||
    classifiedErrorCode === OPENAI_INTERNAL_ERROR_CODES.INVALID_REQUEST
  ) {
    return false;
  }
  return true;
}

export function resolveOutputLimitRecoveryStrategy({ role }) {
  return {
    simplifySchema: true,
    useDeterministicFallback: true,
    allowSameRequestRetry: false,
    recoverableFailureCode:
      role === "roadmap" || role === "executionPlanLegacy" || role === "experienceDesign"
        ? "output_limit"
        : "output_limit",
  };
}
