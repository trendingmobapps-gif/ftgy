import {
  PROJECT_BRAIN_CONFIDENCE_LEVELS,
  PROJECT_BRAIN_DECISION_TYPES,
  PROJECT_BRAIN_DECISION_VERSION,
  PROJECT_BRAIN_POLICY_VIOLATIONS,
  PROJECT_BRAIN_RESULT_INTENT_TYPES,
} from "./contract-schema.js";

const REQUIRED_TOP_LEVEL_FIELDS = [
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
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateConfidenceBand(value, path, errors) {
  if (!isObject(value)) {
    errors.push(`${path}_required`);
    return;
  }
  if (!PROJECT_BRAIN_CONFIDENCE_LEVELS.includes(value.level)) {
    errors.push(`${path}_invalid_level`);
  }
  if (
    value.score !== undefined &&
    value.score !== null &&
    (typeof value.score !== "number" || value.score < 0 || value.score > 1)
  ) {
    errors.push(`${path}_invalid_score`);
  }
  if (!Array.isArray(value.signals) || value.signals.some((signal) => typeof signal !== "string")) {
    errors.push(`${path}_invalid_signals`);
  }
}

function validateKnownContext(value, errors) {
  if (!isObject(value)) {
    errors.push("known_context_required");
    return;
  }
  for (const key of ["memoryRefs", "knowledgeRefs", "resourceRefs", "resultRefs", "workflowRefs", "decisionRefs"]) {
    if (!Array.isArray(value[key])) {
      errors.push(`known_context_${key}_required`);
    }
  }
}

function validateMissingInformation(items, errors) {
  if (!Array.isArray(items)) {
    errors.push("missing_information_required");
    return [];
  }

  for (const item of items) {
    if (!isObject(item) || !String(item.key || "").trim()) {
      errors.push("missing_information_invalid_key");
      continue;
    }
    if (item.mustAskUser === true && !String(item.materialImpact || "").trim()) {
      errors.push("asked_item_requires_material_impact");
    }
    for (const key of ["canInfer", "canResearch", "mustAskUser"]) {
      if (typeof item[key] !== "boolean") {
        errors.push(`missing_information_${key}_required`);
      }
    }
  }
  return items.filter((item) => item?.mustAskUser === true);
}

function validateResultIntent(value, decision, errors) {
  if (!isObject(value) || !PROJECT_BRAIN_RESULT_INTENT_TYPES.includes(value.type)) {
    errors.push("result_intent_invalid");
    return;
  }
  for (const key of [
    "createVisibleValue",
    "createResource",
    "requireGeneratedResult",
    "requireReview",
    "requireAcceptance",
  ]) {
    if (typeof value[key] !== "boolean") {
      errors.push(`result_intent_${key}_required`);
    }
  }

  const valueProducing = !["context_only", "verification"].includes(value.type);
  if (valueProducing && value.createVisibleValue !== true) {
    errors.push("value_step_requires_visible_value");
  }
  if (valueProducing && value.requireGeneratedResult !== true) {
    errors.push("value_step_requires_result");
  }
  if (value.type === "context_only" && String(decision.reasoningSummary || "").trim().length < 20) {
    errors.push("context_only_requires_explanation");
  }
}

export function validateProjectBrainDecisionContract(decision) {
  const errors = [];
  if (!isObject(decision)) {
    return { valid: false, errors: ["decision_required"] };
  }

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in decision)) errors.push(`missing_${field}`);
  }

  if (decision.decisionVersion !== PROJECT_BRAIN_DECISION_VERSION) {
    errors.push("unsupported_decision_version");
  }
  if (!PROJECT_BRAIN_DECISION_TYPES.includes(decision.decisionType)) {
    errors.push("invalid_decision_type");
  }
  if (!String(decision.decisionId || "").trim()) errors.push("decision_id_required");
  if (!String(decision.projectId || "").trim()) errors.push("project_id_required");
  if (!String(decision.stepId || "").trim()) errors.push("step_id_required");
  if (decision.actionId !== null && typeof decision.actionId !== "string") {
    errors.push("action_id_invalid");
  }
  if (!String(decision.objective || "").trim()) errors.push("objective_required");
  if (!String(decision.reasoningSummary || "").trim()) errors.push("reasoning_summary_required");
  if (!Number.isFinite(Date.parse(decision.createdAt))) errors.push("created_at_invalid");
  if (decision.expiresAt !== null && !Number.isFinite(Date.parse(decision.expiresAt))) {
    errors.push("expires_at_invalid");
  }

  const confidence = isObject(decision.confidence) ? decision.confidence : {};
  for (const key of [
    "objectiveUnderstanding",
    "contextSufficiency",
    "resultReadiness",
    "workflowStability",
  ]) {
    validateConfidenceBand(confidence[key], `confidence_${key}`, errors);
  }

  validateKnownContext(decision.knownContext, errors);
  const askedItems = validateMissingInformation(decision.missingInformation, errors);

  if (decision.decisionType === "collect_minimal_context") {
    if (askedItems.length < 1) errors.push("collect_context_requires_question");
    if (askedItems.length > 3) errors.push("collect_context_question_limit");
  }
  if (
    decision.decisionType === "reuse_existing_resource" &&
    (!Array.isArray(decision.knownContext?.resourceRefs) || decision.knownContext.resourceRefs.length === 0)
  ) {
    errors.push("reuse_resource_requires_evidence");
  }
  if (
    decision.decisionType === "reuse_existing_result" &&
    (!Array.isArray(decision.knownContext?.resultRefs) || decision.knownContext.resultRefs.length === 0)
  ) {
    errors.push("reuse_result_requires_evidence");
  }
  if (
    decision.decisionType === "generate_directly" &&
    (confidence.contextSufficiency?.level === "low" || askedItems.length > 0)
  ) {
    errors.push("generate_directly_requires_sufficient_context");
  }
  if (
    decision.decisionType === "research_then_generate" &&
    decision.nextAction?.requiresResearch !== true
  ) {
    errors.push("research_decision_requires_signal");
  }

  validateResultIntent(decision.resultIntent, decision, errors);

  if (!isObject(decision.userEffort)) {
    errors.push("user_effort_required");
  } else {
    for (const key of [
      "estimatedMinutes",
      "interactionCount",
      "questionsRequired",
      "questionsAvoided",
      "knownInformationCount",
      "missingMaterialInformationCount",
    ]) {
      if (!Number.isFinite(decision.userEffort[key]) || decision.userEffort[key] < 0) {
        errors.push(`user_effort_${key}_invalid`);
      }
    }
    if (typeof decision.userEffort.isMinimumNecessary !== "boolean") {
      errors.push("user_effort_minimum_flag_required");
    }
  }

  if (!isObject(decision.nextAction)) {
    errors.push("next_action_required");
  } else {
    for (const key of [
      "requiresUserInput",
      "requiresResearch",
      "requiresGeneration",
      "requiresExternalAction",
      "requiresReview",
      "requiresAcceptance",
    ]) {
      if (typeof decision.nextAction[key] !== "boolean") {
        errors.push(`next_action_${key}_required`);
      }
    }
  }

  if (!isObject(decision.workflowImpact)) {
    errors.push("workflow_impact_required");
  } else {
    if (typeof decision.workflowImpact.reconsiderWorkflow !== "boolean") {
      errors.push("workflow_reconsider_flag_required");
    }
    if (typeof decision.workflowImpact.proposalRequired !== "boolean") {
      errors.push("workflow_proposal_flag_required");
    }
    if (!Array.isArray(decision.workflowImpact.proposals)) {
      errors.push("workflow_proposals_required");
    }
  }

  if (
    !isObject(decision.safety) ||
    !["allowed", "blocked", "needs_authorization", "professional_review_recommended"].includes(
      decision.safety.status,
    )
  ) {
    errors.push("safety_status_invalid");
  }

  if (
    !isObject(decision.modelMetadata) ||
    decision.modelMetadata.role !== "deterministic_adapter" ||
    decision.modelMetadata.source !== "deterministic"
  ) {
    errors.push("model_metadata_invalid");
  }

  if (!isObject(decision.policyCompliance)) {
    errors.push("policy_compliance_required");
  } else {
    if (!Array.isArray(decision.policyCompliance.violations)) {
      errors.push("policy_violations_required");
    } else if (
      decision.policyCompliance.violations.some(
        (code) => !PROJECT_BRAIN_POLICY_VIOLATIONS.includes(code),
      )
    ) {
      errors.push("unsupported_policy_violation");
    }
    for (const key of [
      "minimumUserEffortPassed",
      "visibleValuePassed",
      "contextReuseChecked",
    ]) {
      if (typeof decision.policyCompliance[key] !== "boolean") {
        errors.push(`policy_${key}_required`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
