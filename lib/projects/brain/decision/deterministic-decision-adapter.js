import { randomUUID } from "node:crypto";

import { PROJECT_BRAIN_DECISION_VERSION } from "./contract-schema.js";
import { applyMinimumUserEffortPolicy } from "./minimum-user-effort-policy.js";

function band(level, signals) {
  return { level, signals: [...new Set(signals.filter(Boolean))] };
}

function countKnownContext(knownContext) {
  return Object.values(knownContext).reduce(
    (sum, refs) => sum + (Array.isArray(refs) ? refs.length : 0),
    0,
  );
}

function resolveDecisionType(evidence) {
  if (["blocked", "unsupported", "needs_authorization"].includes(evidence.safetyStatus)) {
    return "unsupported_or_blocked";
  }
  if (evidence.deferState) return "pause_or_defer";
  if (evidence.workflowRedundancy?.stepId) return "propose_workflow_change";
  if (evidence.reusableResource?.id) return "reuse_existing_resource";
  if (evidence.satisfyingAcceptedResult?.id) return "reuse_existing_result";
  if (evidence.externalActionRequired) return "request_external_user_action";
  if (evidence.verificationOnly) return "verify_completion";
  if (evidence.research.required) return "research_then_generate";
  if (evidence.materialMissingInformation.length > 0) return "collect_minimal_context";
  return "generate_directly";
}

function resolveReasoningSummary(type, evidence) {
  switch (type) {
    case "reuse_existing_resource":
      return "ITER a găsit o resursă existentă care poate acoperi acest pas fără muncă repetată.";
    case "reuse_existing_result":
      return "Un rezultat acceptat anterior acoperă obiectivul acestui pas și poate fi reutilizat.";
    case "research_then_generate":
      return "Pasul depinde de informații actuale; cercetarea trebuie verificată înainte de generarea rezultatului.";
    case "collect_minimal_context":
      return "ITER cere doar informațiile materiale care lipsesc, apoi le va folosi pentru a produce rezultatul pasului.";
    case "request_external_user_action":
      return "Finalizarea depinde de o acțiune externă pe care doar utilizatorul o poate confirma sau efectua.";
    case "verify_completion":
      return "Rezultatul există deja; este necesară doar confirmarea finalizării înainte de închiderea pasului.";
    case "propose_workflow_change":
      return "Dovezile curente indică un pas redundant; ITER propune ajustarea fluxului înainte de continuare.";
    case "pause_or_defer":
      return "Pasul este păstrat pentru mai târziu, iar contextul existent va fi reutilizat la reluare.";
    case "unsupported_or_blocked":
      return "ITER nu poate continua în siguranță cu acest pas și va păstra contextul pentru o alternativă permisă.";
    default:
      return "Contextul disponibil este suficient; ITER poate genera direct valoarea necesară pentru acest pas.";
  }
}

function resolveConfidence(type, evidence, askedItems) {
  const objectiveSignals = [];
  if (evidence.projectGoalAvailable) objectiveSignals.push("project_goal_present");
  if (evidence.stepObjectiveAvailable) objectiveSignals.push("step_objective_present");
  const objectiveLevel =
    evidence.projectGoalAvailable && evidence.stepObjectiveAvailable
      ? "high"
      : evidence.projectGoalAvailable || evidence.stepObjectiveAvailable
        ? "medium"
        : "low";

  const contextSignals = [
    evidence.knownContext.memoryRefs.length > 0 && "memory_evidence_present",
    evidence.knownContext.resourceRefs.length > 0 && "resource_evidence_present",
    evidence.knownContext.resultRefs.length > 0 && "accepted_result_evidence_present",
    askedItems.length === 0 && "no_material_questions_remaining",
  ];
  const contextLevel =
    type === "reuse_existing_resource" ||
    type === "reuse_existing_result" ||
    (askedItems.length === 0 && !evidence.research.required)
      ? "high"
      : askedItems.length <= 3
        ? "medium"
        : "low";

  const resultSignals = [
    ["reuse_existing_resource", "reuse_existing_result"].includes(type) && "visible_value_reusable",
    type === "generate_directly" && "generation_ready",
    evidence.research.required && "research_required",
    evidence.research.available && "research_available",
  ];
  const resultLevel =
    ["reuse_existing_resource", "reuse_existing_result"].includes(type)
      ? "high"
      : type === "generate_directly"
        ? "medium"
        : type === "research_then_generate" && !evidence.research.available
          ? "low"
          : askedItems.length > 0
            ? "low"
            : "medium";

  const workflowSignals = [
    evidence.knownContext.workflowRefs.length > 0 && "workflow_context_present",
    evidence.workflowRedundancy?.stepId && "workflow_redundancy_detected",
  ];
  const workflowLevel = evidence.workflowRedundancy?.stepId
    ? "low"
    : evidence.knownContext.workflowRefs.length > 0
      ? "high"
      : "medium";

  return {
    objectiveUnderstanding: band(objectiveLevel, objectiveSignals),
    contextSufficiency: band(contextLevel, contextSignals),
    resultReadiness: band(resultLevel, resultSignals),
    workflowStability: band(workflowLevel, workflowSignals),
  };
}

function resolveResultIntent(type) {
  if (type === "verify_completion" || type === "request_external_user_action") {
    return {
      type: "verification",
      createVisibleValue: true,
      createResource: false,
      resourceFormats: [],
      requireReview: false,
      requireAcceptance: false,
      requireGeneratedResult: false,
    };
  }
  if (["pause_or_defer", "propose_workflow_change", "unsupported_or_blocked"].includes(type)) {
    return {
      type: "context_only",
      createVisibleValue: false,
      createResource: false,
      resourceFormats: [],
      requireReview: false,
      requireAcceptance: false,
      requireGeneratedResult: false,
    };
  }
  if (type === "research_then_generate") {
    return {
      type: "research_summary",
      createVisibleValue: true,
      createResource: true,
      resourceFormats: ["markdown"],
      requireReview: true,
      requireAcceptance: true,
      requireGeneratedResult: true,
    };
  }
  if (type === "reuse_existing_resource") {
    return {
      type: "resource",
      createVisibleValue: true,
      createResource: false,
      resourceFormats: [],
      requireReview: true,
      requireAcceptance: true,
      requireGeneratedResult: true,
    };
  }
  if (type === "reuse_existing_result") {
    return {
      type: "resource",
      createVisibleValue: true,
      createResource: false,
      resourceFormats: [],
      requireReview: false,
      requireAcceptance: true,
      requireGeneratedResult: true,
    };
  }
  return {
    type: "resource",
    createVisibleValue: true,
    createResource: true,
    resourceFormats: ["markdown"],
    requireReview: true,
    requireAcceptance: true,
    requireGeneratedResult: true,
  };
}

function resolveNextAction(type) {
  return {
    type,
    requiresUserInput: [
      "collect_minimal_context",
      "request_external_user_action",
      "verify_completion",
      "propose_workflow_change",
    ].includes(type),
    requiresResearch: type === "research_then_generate",
    requiresGeneration: ["generate_directly", "research_then_generate", "collect_minimal_context"].includes(
      type,
    ),
    requiresExternalAction: type === "request_external_user_action",
    requiresReview: [
      "generate_directly",
      "research_then_generate",
      "collect_minimal_context",
      "reuse_existing_resource",
    ].includes(type),
    requiresAcceptance: !["pause_or_defer", "unsupported_or_blocked"].includes(type),
  };
}

export function createDeterministicProjectBrainDecision({
  evidence,
  actionId = null,
  nowIso = new Date().toISOString(),
  decisionId = randomUUID(),
}) {
  const type = resolveDecisionType(evidence);
  const cappedMissingInformation = evidence.materialMissingInformation.map((item, index) => ({
    ...item,
    mustAskUser: type === "collect_minimal_context" && index < 3,
  }));
  const askedItems = cappedMissingInformation.filter((item) => item.mustAskUser);
  const resultIntent = resolveResultIntent(type);
  const knownInformationCount = countKnownContext(evidence.knownContext);
  const questionsAvoided =
    evidence.knownContext.memoryRefs.length +
    Math.max(0, Number(evidence.legacyQuestionCount || 0) - askedItems.length) +
    (["reuse_existing_resource", "reuse_existing_result"].includes(type) ? 1 : 0);

  const decision = {
    decisionId,
    decisionVersion: PROJECT_BRAIN_DECISION_VERSION,
    projectId: evidence.projectRef.id,
    stepId: evidence.stepRef.id,
    actionId: actionId || null,
    objective: evidence.objective,
    decisionType: type,
    reasoningSummary: resolveReasoningSummary(type, evidence),
    confidence: resolveConfidence(type, evidence, askedItems),
    knownContext: evidence.knownContext,
    missingInformation: cappedMissingInformation,
    userEffort: {
      estimatedMinutes: askedItems.length,
      interactionCount: askedItems.length,
      questionsRequired: askedItems.length,
      questionsAvoided,
      knownInformationCount,
      missingMaterialInformationCount: evidence.materialMissingInformation.length,
      isMinimumNecessary: askedItems.length <= 3,
    },
    nextAction: resolveNextAction(type),
    resultIntent,
    workflowImpact: {
      reconsiderWorkflow: type === "propose_workflow_change",
      proposalRequired: type === "propose_workflow_change",
      proposals: evidence.workflowRedundancy?.stepId
        ? [
            {
              type: "skip_step",
              stepId: evidence.workflowRedundancy.stepId,
              reason: evidence.workflowRedundancy.reason || "Pasul pare deja acoperit de dovezile proiectului.",
              requiresUserApproval: true,
              confidence: band("medium", ["workflow_redundancy_detected"]),
            },
          ]
        : [],
    },
    safety: {
      status:
        evidence.safetyStatus === "needs_authorization"
          ? "needs_authorization"
          : evidence.safetyStatus === "blocked" || evidence.safetyStatus === "unsupported"
            ? "blocked"
            : "allowed",
      reasonCode: null,
      safeAlternative: null,
    },
    modelMetadata: {
      role: "deterministic_adapter",
      model: null,
      source: "deterministic",
    },
    policyCompliance: {
      minimumUserEffortPassed: true,
      visibleValuePassed: true,
      contextReuseChecked: true,
      violations: [],
    },
    createdAt: nowIso,
    expiresAt: null,
  };

  return applyMinimumUserEffortPolicy(decision, evidence);
}

export const DETERMINISTIC_CONFIDENCE_RULES = Object.freeze({
  objectiveUnderstanding:
    "high when both project goal and step objective exist; medium when one exists; low otherwise",
  contextSufficiency:
    "high for reuse or no missing material facts; medium for up to three facts; low beyond three",
  resultReadiness:
    "high for reusable visible value; medium for direct generation; low while input or unavailable research is required",
  workflowStability:
    "high with workflow evidence and no redundancy; medium without workflow evidence; low on redundancy",
});
