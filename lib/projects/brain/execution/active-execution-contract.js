import { randomUUID } from "node:crypto";

import { serializeInteractivePayloadFromPlan } from "./execution-plan-generator.js";
import { validateExecutionInputRenderability, validateInteractivePayload } from "./execution-plan-validation.js";
import { EXECUTION_PLAN_VERSION } from "./execution-plan-validation.js";
import { allowsLegacyPendingQuestion } from "./execution-modes.js";
import { validateExperienceSchema } from "./ai-experience-validation.js";

export const EXECUTION_MODE_PAYLOAD_TYPES = {
  assessment: "assessment",
  guided_questions: "guided_questions",
  structured_form: "structured_form",
  spreadsheet_builder: "structured_form",
  choice: "choice",
  checklist: "checklist",
  recommendation_selection: "recommendation_selection",
  generator: null,
  document_builder: "structured_form",
  image_generation: null,
  upload_and_review: null,
  research: null,
  conversation: null,
  result_review: null,
};

function countPayloadItems(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      questionsCount: 0,
      fieldsCount: 0,
      choicesCount: 0,
      checklistCount: 0,
    };
  }

  return {
    questionsCount: Array.isArray(payload.questions) ? payload.questions.length : 0,
    fieldsCount: Array.isArray(payload.fields) ? payload.fields.length : 0,
    choicesCount: Array.isArray(payload.options) ? payload.options.length : 0,
    checklistCount: Array.isArray(payload.items) ? payload.items.length : 0,
  };
}

function resolveExpectedPayloadType(mode) {
  return EXECUTION_MODE_PAYLOAD_TYPES[mode] ?? null;
}

function normalizeZeroInputGenerationPlan(plan) {
  return {
    ...plan,
    mode: "generator",
    primaryActionLabel: plan.primaryActionLabel || "Generează rezultatul",
    outputTypes: plan.outputTypes?.length ? plan.outputTypes : ["text"],
    userAction:
      plan.userAction?.type === "generate"
        ? plan.userAction
        : {
            type: "generate",
            instruction:
              plan.userAction?.instruction ||
              `Generează rezultatul pentru „${plan.title || "acest pas"}”.`,
          },
  };
}

export function validateExecutionContractInvariant({ mode, interactivePayload, executionPlan = null }) {
  const expectedPayloadType = resolveExpectedPayloadType(mode);
  const payloadType = interactivePayload?.type || null;

  if (expectedPayloadType && payloadType !== expectedPayloadType) {
    return {
      valid: false,
      reason: "payload_type_mode_mismatch",
      expectedPayloadType,
      payloadType,
    };
  }

  const planMode = executionPlan?.mode;
  if (planMode && mode && planMode !== mode) {
    return { valid: false, reason: "plan_definition_mode_mismatch", planMode, mode };
  }

  return { valid: true, reason: null, expectedPayloadType, payloadType };
}

export function repairExecutionContractModePayload({
  executionPlan,
  interactivePayload = null,
  source = null,
}) {
  if (!executionPlan?.mode) {
    return {
      executionPlan,
      interactivePayload,
      repaired: false,
      repairReason: null,
      originalMode: null,
      originalPayloadType: interactivePayload?.type || null,
      repairedMode: null,
      repairedPayloadType: interactivePayload?.type || null,
      source,
    };
  }

  const originalMode = executionPlan.mode;
  const originalPayloadType = interactivePayload?.type || null;
  const expectedPayloadType = resolveExpectedPayloadType(originalMode);
  const requiredInputsCount = (executionPlan.requiredInputs || []).length;

  if (!expectedPayloadType) {
    return {
      executionPlan,
      interactivePayload,
      repaired: false,
      repairReason: null,
      originalMode,
      originalPayloadType,
      repairedMode: originalMode,
      repairedPayloadType: originalPayloadType,
      source,
    };
  }

  if (interactivePayload?.type === expectedPayloadType) {
    return {
      executionPlan,
      interactivePayload,
      repaired: false,
      repairReason: null,
      originalMode,
      originalPayloadType,
      repairedMode: originalMode,
      repairedPayloadType: originalPayloadType,
      source,
    };
  }

  if (requiredInputsCount > 0) {
    const serialized = serializeInteractivePayloadFromPlan(executionPlan);
    if (serialized?.type === expectedPayloadType) {
      return {
        executionPlan,
        interactivePayload: serialized,
        repaired: true,
        repairReason: "payload_serialized_from_plan",
        originalMode,
        originalPayloadType,
        repairedMode: originalMode,
        repairedPayloadType: serialized.type,
        source,
      };
    }
  }

  if (
    requiredInputsCount === 0 &&
    (originalMode === "document_builder" || originalMode === "spreadsheet_builder")
  ) {
    const repairedPlan = normalizeZeroInputGenerationPlan(executionPlan);
    return {
      executionPlan: repairedPlan,
      interactivePayload: null,
      repaired: true,
      repairReason: "zero_input_direct_generation",
      originalMode,
      originalPayloadType,
      repairedMode: repairedPlan.mode,
      repairedPayloadType: null,
      source,
    };
  }

  return {
    executionPlan,
    interactivePayload,
    repaired: false,
    repairReason: null,
    originalMode,
    originalPayloadType,
    repairedMode: originalMode,
    repairedPayloadType: originalPayloadType,
    source,
  };
}

export function buildActiveExecutionContract({
  projectId,
  stepId,
  action,
  session,
  executionPlan,
  executionDefinition,
  interactivePayload,
  experience = null,
  experienceValid = false,
  experienceValidationReason = null,
  source = "openai",
  contractId = null,
}) {
  const planMode = executionPlan?.mode || executionDefinition?.mode || null;
  const definitionMode = executionDefinition?.mode || planMode;
  const mode = planMode || definitionMode;
  const actionId = action?.actionId || action?.id || null;

  return {
    contractId: contractId || randomUUID(),
    contractVersion: executionPlan?.metadata?.version || executionPlan?.version || EXECUTION_PLAN_VERSION,
    generatedAt: executionPlan?.metadata?.generatedAt || new Date().toISOString(),
    projectId,
    stepId,
    actionId,
    mode,
    executionPlan: executionPlan || null,
    executionDefinition: executionDefinition || null,
    interactivePayload: interactivePayload || null,
    experience: experience || null,
    experienceValid: Boolean(experienceValid),
    experienceValidationReason: experienceValidationReason || null,
    session: session || null,
    requiredInputs: executionDefinition?.requiredInputs || executionPlan?.requiredInputs || [],
    completionCriteria:
      experience?.completionCriteria ||
      executionDefinition?.completionCriteria ||
      executionPlan?.completionCriteria ||
      null,
    source,
  };
}

export function validateActiveExecutionContract(contract) {
  if (!contract || typeof contract !== "object") {
    return { valid: false, reason: "missing_contract" };
  }

  if (!contract.contractId || !contract.mode) {
    return { valid: false, reason: "missing_contract_identity" };
  }

  if (!contract.actionId || !contract.projectId || !contract.stepId) {
    return { valid: false, reason: "missing_contract_scope" };
  }

  const planMode = contract.executionPlan?.mode;
  const definitionMode = contract.executionDefinition?.mode;

  if (planMode && definitionMode && planMode !== definitionMode) {
    return { valid: false, reason: "plan_definition_mode_mismatch" };
  }

  if (contract.mode !== planMode && planMode) {
    return { valid: false, reason: "contract_plan_mode_mismatch" };
  }

  if (contract.mode !== definitionMode && definitionMode) {
    return { valid: false, reason: "contract_definition_mode_mismatch" };
  }

  const expectedPayloadType = resolveExpectedPayloadType(contract.mode);
  const payloadType = contract.interactivePayload?.type || null;

  if (expectedPayloadType && payloadType !== expectedPayloadType) {
    return { valid: false, reason: "payload_type_mode_mismatch" };
  }

  if (contract.session?.sessionId && contract.actionId && contract.session.sessionId !== contract.actionId) {
    return { valid: false, reason: "session_action_mismatch" };
  }

  if (!allowsLegacyPendingQuestion(contract.mode) && contract.session?.pendingQuestion) {
    return { valid: false, reason: "legacy_pending_question_conflict" };
  }

  if (contract.mode === "guided_questions") {
    if (contract.session?.pendingQuestion) {
      return { valid: false, reason: "legacy_pending_question_conflict" };
    }
    if (contract.interactivePayload?.type !== "guided_questions") {
      return { valid: false, reason: "guided_missing_payload" };
    }
  }

  if (contract.experience) {
    const experienceValidation = validateExperienceSchema(contract.experience);
    if (!experienceValidation.valid) {
      return {
        valid: false,
        reason: experienceValidation.errors?.[0]?.code || "experience_invalid",
      };
    }
    if (contract.experienceValid === false) {
      return { valid: false, reason: contract.experienceValidationReason || "experience_invalid" };
    }
  }

  const renderability = validateContractRenderability(contract);
  if (!renderability.valid) {
    return renderability;
  }

  return { valid: true, reason: null };
}

export function validateContractRenderability(contract) {
  if (!contract?.mode) {
    return { valid: false, reason: "missing_mode" };
  }

  if (contract.experienceValid === true && contract.experience) {
    return { valid: true, reason: null };
  }

  const plan = contract.executionPlan || { mode: contract.mode, requiredInputs: contract.requiredInputs || [] };
  const payload = contract.interactivePayload;

  if (contract.mode === "guided_questions") {
    const questions = payload?.type === "guided_questions" ? payload.questions || [] : [];
    if (questions.length < 1) {
      return { valid: false, reason: "guided_needs_questions" };
    }
    for (const question of questions) {
      if (!question?.id || !question?.prompt) {
        return { valid: false, reason: "guided_missing_question_shape" };
      }
    }
    return { valid: true, reason: null };
  }

  return validateExecutionInputRenderability(plan, payload);
}

export function serializeContractDiagnostics(contract, compatible = true) {
  const payload = contract?.interactivePayload;
  const counts = countPayloadItems(payload);

  return {
    contractId: contract?.contractId || null,
    contractVersion: contract?.contractVersion || null,
    actionId: contract?.actionId || null,
    planMode: contract?.executionPlan?.mode || null,
    definitionMode: contract?.executionDefinition?.mode || null,
    payloadType: payload?.type || null,
    mode: contract?.mode || null,
    questionsCount: counts.questionsCount,
    fieldsCount: counts.fieldsCount,
    choicesCount: counts.choicesCount,
    checklistCount: counts.checklistCount,
    requiredInputCount: (contract?.requiredInputs || []).length,
    source: contract?.source || null,
    compatible,
  };
}

export function serializeContractForClient(contract) {
  if (!contract) return null;

  return {
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    generatedAt: contract.generatedAt,
    projectId: contract.projectId,
    stepId: contract.stepId,
    actionId: contract.actionId,
    mode: contract.mode,
    executionPlan: contract.executionPlan
      ? {
          planId: contract.executionPlan.planId,
          mode: contract.executionPlan.mode,
          title: contract.executionPlan.title,
          primaryActionLabel: contract.executionPlan.primaryActionLabel,
          userAction: contract.executionPlan.userAction,
          completionCriteria: contract.executionPlan.completionCriteria,
          metadata: contract.executionPlan.metadata,
          source: contract.executionPlan.source,
        }
      : null,
    executionDefinition: contract.executionDefinition,
    interactivePayload: contract.interactivePayload,
    experience: contract.experience || null,
    experienceValid: contract.experienceValid === true,
    experienceValidationReason: contract.experienceValidationReason || null,
    session: contract.session,
    requiredInputs: contract.requiredInputs || [],
    completionCriteria: contract.completionCriteria || null,
    source: contract.source,
  };
}

export { resolveExpectedPayloadType, countPayloadItems };
