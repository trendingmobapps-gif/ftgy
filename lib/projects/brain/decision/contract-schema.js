export const PROJECT_BRAIN_DECISION_VERSION = 1;

export const PROJECT_BRAIN_DECISION_TYPES = Object.freeze([
  "reuse_existing_resource",
  "reuse_existing_result",
  "generate_directly",
  "research_then_generate",
  "collect_minimal_context",
  "request_external_user_action",
  "verify_completion",
  "propose_workflow_change",
  "pause_or_defer",
  "unsupported_or_blocked",
]);

export const PROJECT_BRAIN_RESULT_INTENT_TYPES = Object.freeze([
  "context_only",
  "recommendation",
  "plan",
  "document",
  "diagnostic",
  "verification",
  "resource",
  "research_summary",
]);

export const PROJECT_BRAIN_POLICY_VIOLATIONS = Object.freeze([
  "MEMORY_NOT_CHECKED",
  "RESOURCES_NOT_CHECKED",
  "RESULTS_NOT_CHECKED",
  "TOO_MANY_USER_QUESTIONS",
  "QUESTION_WITHOUT_MATERIAL_IMPACT",
  "USER_INPUT_SELECTED_BEFORE_REUSE",
  "USER_INPUT_SELECTED_BEFORE_RESEARCH",
  "VALUE_STEP_WITHOUT_VISIBLE_VALUE",
  "CONTEXT_ONLY_WITHOUT_EXPLANATION",
  "DECISION_EVIDENCE_MISSING",
  "LEGACY_FALLBACK_FORM_BIAS",
  "LEGACY_FALLBACK_ASK_BIAS",
]);

export const PROJECT_BRAIN_CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"]);

export function buildProjectBrainDecisionJsonSchema() {
  const confidenceBand = {
    type: "object",
    additionalProperties: false,
    properties: {
      level: { type: "string", enum: PROJECT_BRAIN_CONFIDENCE_LEVELS },
      score: { type: ["number", "null"], minimum: 0, maximum: 1 },
      signals: { type: "array", items: { type: "string" } },
    },
    required: ["level", "signals"],
  };

  return {
    name: "project_brain_decision_v1",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        decisionId: { type: "string" },
        decisionVersion: { type: "number", enum: [PROJECT_BRAIN_DECISION_VERSION] },
        projectId: { type: "string" },
        stepId: { type: "string" },
        actionId: { type: ["string", "null"] },
        objective: { type: "string" },
        decisionType: { type: "string", enum: PROJECT_BRAIN_DECISION_TYPES },
        reasoningSummary: { type: "string" },
        confidence: {
          type: "object",
          additionalProperties: false,
          properties: {
            objectiveUnderstanding: confidenceBand,
            contextSufficiency: confidenceBand,
            resultReadiness: confidenceBand,
            workflowStability: confidenceBand,
          },
          required: [
            "objectiveUnderstanding",
            "contextSufficiency",
            "resultReadiness",
            "workflowStability",
          ],
        },
        knownContext: { type: "object" },
        missingInformation: { type: "array" },
        userEffort: { type: "object" },
        nextAction: { type: "object" },
        resultIntent: { type: "object" },
        workflowImpact: { type: "object" },
        safety: { type: "object" },
        modelMetadata: { type: "object" },
        policyCompliance: { type: "object" },
        createdAt: { type: "string" },
        expiresAt: { type: ["string", "null"] },
      },
      required: [
        "decisionId",
        "decisionVersion",
        "projectId",
        "stepId",
        "actionId",
        "objective",
        "decisionType",
        "reasoningSummary",
        "confidence",
        "knownContext",
        "missingInformation",
        "userEffort",
        "nextAction",
        "resultIntent",
        "workflowImpact",
        "safety",
        "modelMetadata",
        "policyCompliance",
        "createdAt",
        "expiresAt",
      ],
    },
  };
}
