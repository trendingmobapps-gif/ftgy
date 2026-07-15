import { logOpenAiUsageEvent } from "./openai-usage-observability.js";
import {
  assertSupportedProviderReasoningEffort,
  resolveProviderReasoningEffort,
} from "./openai-reasoning-effort.js";
import { classifyOpenAiOperationComplexity } from "./openai-operation-complexity.js";
import {
  DEFAULT_CHAT_FALLBACK_MODEL,
  DEFAULT_EFFICIENT_MODEL,
  DEFAULT_FRONTIER_MODEL,
  MODEL_TIER,
  resolveChatFallbackModel,
  resolveEfficientModel,
  resolveFrontierModel,
} from "./openai-model-tiers.js";
import { isProjectBrainDecisionContractAuthoritative } from "./decision/index.js";

export const STRUCTURED_OUTPUT_TOKEN_CEILINGS = {
  roadmap: 16_000,
  executionPlan: 8_000,
  decision: 4_096,
  defaultStructured: 8_000,
};

export const PROJECT_MODEL_ROLES = {
  intent: "intent",
  safety: "safety",
  roadmap: "roadmap",
  decision: "decision",
  decisionRepair: "decisionRepair",
  experienceDesign: "experienceDesign",
  executionPlanLegacy: "executionPlanLegacy",
  resultGeneration: "resultGeneration",
  resultRevision: "resultRevision",
  evaluation: "evaluation",
  researchSynthesis: "researchSynthesis",
  extraction: "extraction",
  formatting: "formatting",
};

const REUSE_POLICY = {
  none: "none",
  evidenceHash: "evidenceHash",
  idempotencyKey: "idempotencyKey",
};

const ESCALATION_POLICY = {
  never: "never",
  complexOnly: "complexOnly",
  strategicOnly: "strategicOnly",
};

function resolveModelFromEnv(primaryKey, secondaryKey, fallback) {
  const primary = process.env[primaryKey]?.trim();
  if (primary) return primary;
  const secondary = secondaryKey ? process.env[secondaryKey]?.trim() : "";
  return secondary || fallback;
}

function buildRolePolicy({
  role,
  preferredModelTier,
  defaultModelResolver,
  allowedFallbackModelsResolver,
  defaultComplexity = "standard",
  configuredReasoningEffort = "medium",
  maxOutputTokens,
  maxProviderCalls = 2,
  maxRepairCalls = 1,
  maxTotalTokensPerOperation = 120_000,
  reusePolicy = REUSE_POLICY.none,
  escalationPolicy = ESCALATION_POLICY.never,
  liveTestAllowed = true,
}) {
  return {
    role,
    preferredModelTier,
    get defaultModel() {
      return defaultModelResolver();
    },
    get model() {
      return defaultModelResolver();
    },
    get allowedFallbackModels() {
      return allowedFallbackModelsResolver();
    },
    defaultComplexity,
    configuredReasoningEffort,
    maxOutputTokens,
    maxProviderCalls,
    maxRepairCalls,
    maxTotalTokensPerOperation,
    reusePolicy,
    escalationPolicy,
    liveTestAllowed,
  };
}

export const PROJECT_RUNTIME_ROLE_POLICY = {
  intent: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.intent,
    preferredModelTier: MODEL_TIER.EFFICIENT,
    defaultModelResolver: () => resolveModelFromEnv("PROJECT_INTENT_MODEL", null, DEFAULT_EFFICIENT_MODEL),
    allowedFallbackModelsResolver: () => [DEFAULT_EFFICIENT_MODEL],
    configuredReasoningEffort: "low",
    maxOutputTokens: 1024,
    maxProviderCalls: 1,
    maxRepairCalls: 0,
    maxTotalTokensPerOperation: 8_000,
    liveTestAllowed: true,
  }),
  safety: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.safety,
    preferredModelTier: MODEL_TIER.EFFICIENT,
    defaultModelResolver: () => resolveModelFromEnv("PROJECT_SAFETY_MODEL", null, DEFAULT_EFFICIENT_MODEL),
    allowedFallbackModelsResolver: () => [DEFAULT_EFFICIENT_MODEL],
    configuredReasoningEffort: "low",
    maxOutputTokens: 512,
    maxProviderCalls: 1,
    maxRepairCalls: 0,
    maxTotalTokensPerOperation: 4_000,
    liveTestAllowed: true,
  }),
  roadmap: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.roadmap,
    preferredModelTier: MODEL_TIER.FRONTIER,
    defaultModelResolver: () => resolveModelFromEnv("PROJECT_ROADMAP_MODEL", "PROJECT_BRAIN_MODEL", resolveFrontierModel()),
    allowedFallbackModelsResolver: () => [resolveChatFallbackModel(resolveFrontierModel())],
    configuredReasoningEffort: "max",
    maxOutputTokens: STRUCTURED_OUTPUT_TOKEN_CEILINGS.roadmap,
    maxProviderCalls: 2,
    maxRepairCalls: 1,
    maxTotalTokensPerOperation: 120_000,
    reusePolicy: REUSE_POLICY.evidenceHash,
    escalationPolicy: ESCALATION_POLICY.never,
    liveTestAllowed: true,
  }),
  decision: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.decision,
    preferredModelTier: MODEL_TIER.FRONTIER,
    defaultModelResolver: () => resolveModelFromEnv("PROJECT_BRAIN_DECISION_MODEL", "PROJECT_BRAIN_MODEL", resolveFrontierModel()),
    allowedFallbackModelsResolver: () => [resolveChatFallbackModel(resolveFrontierModel())],
    configuredReasoningEffort: "high",
    maxOutputTokens: STRUCTURED_OUTPUT_TOKEN_CEILINGS.decision,
    maxProviderCalls: 2,
    maxRepairCalls: 1,
    maxTotalTokensPerOperation: 24_000,
    reusePolicy: REUSE_POLICY.evidenceHash,
    escalationPolicy: ESCALATION_POLICY.complexOnly,
    liveTestAllowed: false,
  }),
  decisionRepair: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.decisionRepair,
    preferredModelTier: MODEL_TIER.EFFICIENT,
    defaultModelResolver: () => resolveEfficientModel(),
    allowedFallbackModelsResolver: () => [DEFAULT_EFFICIENT_MODEL],
    configuredReasoningEffort: "medium",
    maxOutputTokens: STRUCTURED_OUTPUT_TOKEN_CEILINGS.decision,
    maxProviderCalls: 1,
    maxRepairCalls: 0,
    maxTotalTokensPerOperation: 12_000,
    liveTestAllowed: false,
  }),
  experienceDesign: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.experienceDesign,
    preferredModelTier: MODEL_TIER.FRONTIER,
    defaultModelResolver: () => resolveModelFromEnv("PROJECT_EXECUTION_MODEL", "PROJECT_BRAIN_MODEL", resolveFrontierModel()),
    allowedFallbackModelsResolver: () => [resolveChatFallbackModel(resolveFrontierModel())],
    configuredReasoningEffort: "xhigh",
    maxOutputTokens: STRUCTURED_OUTPUT_TOKEN_CEILINGS.executionPlan,
    maxProviderCalls: 2,
    maxRepairCalls: 1,
    maxTotalTokensPerOperation: 64_000,
    reusePolicy: REUSE_POLICY.evidenceHash,
    escalationPolicy: ESCALATION_POLICY.complexOnly,
    liveTestAllowed: true,
  }),
  executionPlanLegacy: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.executionPlanLegacy,
    preferredModelTier: MODEL_TIER.EFFICIENT,
    defaultModelResolver: () => resolveModelFromEnv("PROJECT_EXECUTION_PLAN_EFFICIENT_MODEL", "PROJECT_EFFICIENT_MODEL", resolveEfficientModel()),
    allowedFallbackModelsResolver: () => [resolveEfficientModel(), DEFAULT_CHAT_FALLBACK_MODEL],
    configuredReasoningEffort: "medium",
    maxOutputTokens: 4_096,
    maxProviderCalls: 2,
    maxRepairCalls: 1,
    maxTotalTokensPerOperation: 32_000,
    reusePolicy: REUSE_POLICY.evidenceHash,
    escalationPolicy: ESCALATION_POLICY.complexOnly,
    liveTestAllowed: true,
  }),
  resultGeneration: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.resultGeneration,
    preferredModelTier: MODEL_TIER.FRONTIER,
    defaultModelResolver: () => resolveModelFromEnv("PROJECT_EXECUTION_GENERATION_MODEL", "PROJECT_EXECUTION_MODEL", resolveFrontierModel()),
    allowedFallbackModelsResolver: () => [resolveChatFallbackModel(resolveFrontierModel())],
    configuredReasoningEffort: "high",
    maxOutputTokens: 4096,
    maxProviderCalls: 2,
    maxRepairCalls: 1,
    maxTotalTokensPerOperation: 24_000,
    reusePolicy: REUSE_POLICY.idempotencyKey,
    escalationPolicy: ESCALATION_POLICY.never,
    liveTestAllowed: true,
  }),
  resultRevision: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.resultRevision,
    preferredModelTier: MODEL_TIER.FRONTIER,
    defaultModelResolver: () => resolveModelFromEnv("PROJECT_RESULT_REVISION_MODEL", "PROJECT_BRAIN_MODEL", resolveFrontierModel()),
    allowedFallbackModelsResolver: () => [resolveChatFallbackModel(resolveFrontierModel())],
    configuredReasoningEffort: "high",
    maxOutputTokens: 4096,
    maxProviderCalls: 2,
    maxRepairCalls: 1,
    maxTotalTokensPerOperation: 24_000,
    reusePolicy: REUSE_POLICY.idempotencyKey,
    escalationPolicy: ESCALATION_POLICY.complexOnly,
    liveTestAllowed: true,
  }),
  evaluation: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.evaluation,
    preferredModelTier: MODEL_TIER.EFFICIENT,
    defaultModelResolver: () => resolveModelFromEnv("PROJECT_EVALUATION_MODEL", "PROJECT_EFFICIENT_MODEL", resolveEfficientModel()),
    allowedFallbackModelsResolver: () => [resolveEfficientModel()],
    configuredReasoningEffort: "medium",
    maxOutputTokens: STRUCTURED_OUTPUT_TOKEN_CEILINGS.defaultStructured,
    maxProviderCalls: 1,
    maxRepairCalls: 0,
    maxTotalTokensPerOperation: 16_000,
    liveTestAllowed: true,
  }),
  researchSynthesis: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.researchSynthesis,
    preferredModelTier: MODEL_TIER.FRONTIER,
    defaultModelResolver: () => resolveModelFromEnv("PROJECT_RESEARCH_MODEL", "PROJECT_BRAIN_MODEL", resolveFrontierModel()),
    allowedFallbackModelsResolver: () => [resolveChatFallbackModel(resolveFrontierModel())],
    configuredReasoningEffort: "high",
    maxOutputTokens: STRUCTURED_OUTPUT_TOKEN_CEILINGS.defaultStructured,
    maxProviderCalls: 2,
    maxRepairCalls: 1,
    maxTotalTokensPerOperation: 64_000,
    escalationPolicy: ESCALATION_POLICY.strategicOnly,
    liveTestAllowed: false,
  }),
  extraction: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.extraction,
    preferredModelTier: MODEL_TIER.EFFICIENT,
    defaultModelResolver: () => resolveEfficientModel(),
    allowedFallbackModelsResolver: () => [resolveEfficientModel()],
    configuredReasoningEffort: "low",
    maxOutputTokens: 2048,
    maxProviderCalls: 1,
    maxRepairCalls: 0,
    maxTotalTokensPerOperation: 8_000,
    liveTestAllowed: true,
  }),
  formatting: buildRolePolicy({
    role: PROJECT_MODEL_ROLES.formatting,
    preferredModelTier: MODEL_TIER.EFFICIENT,
    defaultModelResolver: () => resolveEfficientModel(),
    allowedFallbackModelsResolver: () => [resolveEfficientModel(), DEFAULT_CHAT_FALLBACK_MODEL],
    configuredReasoningEffort: "low",
    maxOutputTokens: 4096,
    maxProviderCalls: 1,
    maxRepairCalls: 0,
    maxTotalTokensPerOperation: 12_000,
    liveTestAllowed: true,
  }),
};

const LEGACY_OPERATION_TO_ROLE = {
  roadmap: PROJECT_MODEL_ROLES.roadmap,
  executionPlan: PROJECT_MODEL_ROLES.executionPlanLegacy,
  decision: PROJECT_MODEL_ROLES.decision,
  recommendation: PROJECT_MODEL_ROLES.experienceDesign,
  evaluation: PROJECT_MODEL_ROLES.evaluation,
  execution: PROJECT_MODEL_ROLES.resultGeneration,
};

function resolveRolePolicy(role) {
  return PROJECT_RUNTIME_ROLE_POLICY[role] || PROJECT_RUNTIME_ROLE_POLICY.executionPlanLegacy;
}

function resolveRoleForExecutionPlan(complexityLevel) {
  if (!isProjectBrainDecisionContractAuthoritative()) {
    return PROJECT_MODEL_ROLES.experienceDesign;
  }
  if (complexityLevel === "complex" || complexityLevel === "exceptional") {
    return PROJECT_MODEL_ROLES.experienceDesign;
  }
  return PROJECT_MODEL_ROLES.executionPlanLegacy;
}

function resolveRoleForResultGeneration(complexityLevel) {
  if (complexityLevel === "complex" || complexityLevel === "exceptional") {
    return PROJECT_MODEL_ROLES.resultGeneration;
  }
  return PROJECT_MODEL_ROLES.resultGeneration;
}

function selectModelForRole(rolePolicy, complexityLevel, operationContext = {}) {
  if (rolePolicy.role === PROJECT_MODEL_ROLES.roadmap || rolePolicy.role === PROJECT_MODEL_ROLES.decision) {
    return {
      model: rolePolicy.defaultModel,
      modelTier: MODEL_TIER.FRONTIER,
      escalationUsed: false,
    };
  }

  const escalate =
    operationContext.forceFrontier === true ||
    (rolePolicy.escalationPolicy === ESCALATION_POLICY.complexOnly &&
      (complexityLevel === "complex" || complexityLevel === "exceptional")) ||
    (rolePolicy.escalationPolicy === ESCALATION_POLICY.strategicOnly &&
      operationContext.strategicOutput === true);

  if (rolePolicy.preferredModelTier === MODEL_TIER.FRONTIER) {
    return {
      model: resolveFrontierModel(),
      modelTier: MODEL_TIER.FRONTIER,
      escalationUsed: false,
    };
  }

  if (escalate) {
    return {
      model: resolveFrontierModel(),
      modelTier: MODEL_TIER.FRONTIER,
      escalationUsed: true,
      escalationReasonCode: operationContext.escalationReasonCode || "complexity_escalation",
    };
  }

  return {
    model: rolePolicy.defaultModel,
    modelTier: rolePolicy.preferredModelTier,
    escalationUsed: false,
  };
}

export function resolveProjectModelRuntimePolicy({
  role,
  complexity = null,
  operationContext = {},
}) {
  const rolePolicy = resolveRolePolicy(role);
  const classified = complexity?.level
    ? complexity
    : classifyOpenAiOperationComplexity({
        role,
        project: operationContext.project,
        clarificationAnswers: operationContext.clarificationAnswers,
        context: operationContext.context,
        executionDecision: operationContext.executionDecision,
        operationContext,
      });

  const complexityLevel = classified.level || rolePolicy.defaultComplexity || "standard";
  const reasonCode =
    operationContext.reasonCode ||
    classified.reasonCode ||
    (complexityLevel === "exceptional" ? null : null);

  const reasoning = resolveProviderReasoningEffort({
    operation: role,
    configuredEffort: rolePolicy.configuredReasoningEffort,
    complexity: complexityLevel,
    reasonCode,
  });

  const modelSelection = selectModelForRole(rolePolicy, complexityLevel, operationContext);

  if (modelSelection.modelTier === MODEL_TIER.FRONTIER && reasoning.providerReasoningEffort === "medium") {
    // frontier strategic roles keep medium unless complex/exceptional already mapped to high
  }

  if (role === PROJECT_MODEL_ROLES.experienceDesign && modelSelection.modelTier === MODEL_TIER.FRONTIER) {
    reasoning.providerReasoningEffort = assertSupportedProviderReasoningEffort(
      complexityLevel === "simple" || complexityLevel === "standard" ? "medium" : reasoning.providerReasoningEffort,
    );
  }

  if (
    role === PROJECT_MODEL_ROLES.executionPlanLegacy &&
    isProjectBrainDecisionContractAuthoritative()
  ) {
    modelSelection.model = rolePolicy.defaultModel;
    modelSelection.modelTier = MODEL_TIER.EFFICIENT;
    reasoning.providerReasoningEffort = "medium";
  }

  if (role === PROJECT_MODEL_ROLES.resultGeneration) {
    const mechanicalTransformation =
      operationContext.mechanicalTransformation === true &&
      operationContext.authoritativeSourcePersisted === true &&
      operationContext.strategicOutput !== true &&
      operationContext.workflowImpacting !== true &&
      operationContext.personalizedGeneration !== true;

    if (mechanicalTransformation) {
      modelSelection.model = resolveEfficientModel();
      modelSelection.modelTier = MODEL_TIER.EFFICIENT;
      modelSelection.escalationUsed = false;
      reasoning.providerReasoningEffort = "low";
    } else {
      modelSelection.model = rolePolicy.defaultModel;
      modelSelection.modelTier = MODEL_TIER.FRONTIER;
      if (complexityLevel === "simple" || complexityLevel === "standard") {
        reasoning.providerReasoningEffort = "medium";
        reasoning.highReasoningUsed = false;
        reasoning.reasonCode = null;
      }
    }
  }

  if (["extraction", "formatting", "evaluation"].includes(role) && !operationContext.forceFrontier) {
    modelSelection.model = rolePolicy.defaultModel;
    modelSelection.modelTier = MODEL_TIER.EFFICIENT;
    reasoning.providerReasoningEffort = "low";
  }

  return {
    role,
    model: modelSelection.model,
    modelTier: modelSelection.modelTier,
    preferredModelTier: rolePolicy.preferredModelTier,
    allowedFallbackModels: rolePolicy.allowedFallbackModels.filter((item) => item !== modelSelection.model).slice(0, 1),
    configuredReasoningEffort: rolePolicy.configuredReasoningEffort,
    providerReasoningEffort: assertSupportedProviderReasoningEffort(reasoning.providerReasoningEffort),
    complexity: complexityLevel,
    complexityLevel,
    complexitySignals: classified.signals || [],
    complexitySignalsCount: classified.signalsCount || 0,
    reasonCode: reasoning.reasonCode,
    highReasonCode: reasoning.highReasoningUsed ? reasoning.reasonCode : null,
    highReasoningUsed: reasoning.highReasoningUsed,
    maxOutputTokens: rolePolicy.maxOutputTokens,
    maxProviderCalls: rolePolicy.maxProviderCalls,
    maxRepairCalls: rolePolicy.maxRepairCalls,
    maxTotalTokensPerOperation: rolePolicy.maxTotalTokensPerOperation,
    reusePolicy: rolePolicy.reusePolicy,
    escalationPolicy: rolePolicy.escalationPolicy,
    escalationUsed: modelSelection.escalationUsed,
    escalationReasonCode: modelSelection.escalationReasonCode || null,
    liveTestAllowed: rolePolicy.liveTestAllowed,
    operation: role,
  };
}

export function resolveRuntimeRoleFromLegacyOperation(operation, complexityLevel = "standard") {
  if (operation === "executionPlan") {
    return resolveRoleForExecutionPlan(complexityLevel);
  }
  if (operation in LEGACY_OPERATION_TO_ROLE) {
    return LEGACY_OPERATION_TO_ROLE[operation];
  }
  return PROJECT_MODEL_ROLES.executionPlanLegacy;
}

export function resolveStructuredOutputTokenCeiling(operation = "executionPlan") {
  if (!(operation in LEGACY_OPERATION_TO_ROLE)) {
    return STRUCTURED_OUTPUT_TOKEN_CEILINGS.defaultStructured;
  }
  const role = resolveRuntimeRoleFromLegacyOperation(operation);
  return resolveRolePolicy(role).maxOutputTokens || STRUCTURED_OUTPUT_TOKEN_CEILINGS.defaultStructured;
}

export function resolveProjectModelPolicy(operation = "executionPlan") {
  const legacyExecution = operation === "execution";
  const role = legacyExecution
    ? PROJECT_MODEL_ROLES.resultGeneration
    : resolveRuntimeRoleFromLegacyOperation(operation);
  const runtime = resolveProjectModelRuntimePolicy({ role, operationContext: {} });
  return {
    model: runtime.model,
    reasoningEffort: runtime.configuredReasoningEffort,
    configuredReasoningEffort: runtime.configuredReasoningEffort,
    operation: legacyExecution ? "execution" : operation,
    role: runtime.role,
    maxOutputTokens: runtime.maxOutputTokens,
    maxProviderCalls: runtime.maxProviderCalls,
    maxRepairCalls: runtime.maxRepairCalls,
    maxTotalTokensPerOperation: runtime.maxTotalTokensPerOperation,
  };
}

export function resolveStructuredModelRuntimePolicy({
  operation = "executionPlan",
  complexity = "standard",
  reasonCode = null,
  operationContext = {},
}) {
  const role = resolveRuntimeRoleFromLegacyOperation(operation, complexity);
  return resolveProjectModelRuntimePolicy({
    role,
    complexity: { level: complexity, reasonCode },
    operationContext: {
      ...operationContext,
      reasonCode,
    },
  });
}

export const PROJECT_MODEL_POLICY = {
  ...PROJECT_RUNTIME_ROLE_POLICY,
  execution: PROJECT_RUNTIME_ROLE_POLICY.resultGeneration,
  recommendation: PROJECT_RUNTIME_ROLE_POLICY.experienceDesign,
  executionPlan: PROJECT_RUNTIME_ROLE_POLICY.experienceDesign,
};

export function logProjectModelUsage(logFn, input) {
  logOpenAiUsageEvent(logFn, input);
}

export function resolveChatFallbackForRuntimePolicy(runtimePolicy) {
  const fallback = runtimePolicy?.allowedFallbackModels?.[0];
  if (fallback) return fallback;
  return resolveChatFallbackModel(runtimePolicy?.model);
}
