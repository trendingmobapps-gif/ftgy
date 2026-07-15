import {
  evaluateAssessmentAnswers,
  getAssessmentInternalFromPreparedInput,
  readInteractiveState,
  serializeAssessmentPayload,
  withAssessmentInternal,
} from "./assessment.js";
import {
  evaluateAssessmentWithAi,
} from "./interactive-generator.js";
import {
  ensureExecutionPlan,
  executionPlanToAssessmentInternal,
  serializeInteractivePayloadFromPlan,
} from "./execution-plan-generator.js";
import { validateInteractivePayload, validateExecutionInputRenderability, repairExecutionPlanInputRenderability } from "./execution-plan-validation.js";
import { validateStepCompletion } from "./completion-evaluator.js";
import {
  buildActiveExecutionContract,
  repairExecutionContractModePayload,
  serializeContractDiagnostics,
  serializeContractForClient,
  validateActiveExecutionContract,
} from "./active-execution-contract.js";
import { logPrepareStage } from "../actions/prepare-stage-log.js";
import { buildExecutionDefinition, serializeExecutionDefinition } from "./definition.js";
import { serializeSession } from "../actions/session.js";
import { updateActionSession, serializeActionRow } from "../actions/repository.js";
import { isPlanDrivenExecutionMode } from "./execution-modes.js";
import { isAiExperienceV1Enabled, collectComponentTypes } from "./ai-experience-schema.js";
import { adaptExecutionPlanToExperience } from "./ai-experience-adapter.js";
import { getExperienceFromPreparedInput, withExperience } from "./ai-experience-validation.js";
import {
  buildResultMessage,
  buildReviewMessage,
} from "../actions/session.js";
import { buildResultPreview, buildResultTitle } from "../actions/prompt-builder.js";
import { insertActionResult } from "../actions/repository.js";

export const INTERACTIVE_EXECUTION_MODES = new Set([
  "assessment",
  "guided_questions",
  "structured_form",
  "checklist",
  "choice",
  "recommendation_selection",
]);

export function isInteractiveExecutionMode(mode) {
  return INTERACTIVE_EXECUTION_MODES.has(mode);
}

function resolveSanitizedSessionStatus({ mode, action, pendingResult, executionPlan }) {
  if (pendingResult) {
    return "review";
  }

  const sessionStatus = action?.session_status || action?.sessionStatus || null;
  if (sessionStatus && sessionStatus !== "collecting") {
    return sessionStatus;
  }

  const collectingModes = new Set([
    "upload_and_review",
    "structured_form",
    "spreadsheet_builder",
    "guided_questions",
    "assessment",
    "choice",
    "checklist",
    "recommendation_selection",
  ]);

  if (collectingModes.has(mode)) {
    return "collecting";
  }

  if (executionPlan?.requiredInputs?.length) {
    return "collecting";
  }

  return sessionStatus || "ready";
}

export function sanitizeSessionForExecutionMode({
  actionRow,
  executionPlan,
  session = null,
  interactivePayload = null,
  preparation = null,
  pendingResult = null,
}) {
  const mode = executionPlan?.mode || null;
  const hadLegacyPendingQuestion = Boolean(
    actionRow?.pending_question?.key || actionRow?.pendingQuestion?.key,
  );

  if (!isPlanDrivenExecutionMode(mode)) {
    const resolvedSession =
      session ||
      serializeSession({
        action: actionRow,
        preparation,
        pendingResult,
      });

    return {
      action: actionRow,
      session: resolvedSession,
      sanitized: false,
      hadLegacyPendingQuestion,
      patch: null,
    };
  }

  let action = actionRow;
  let patch = null;

  if (hadLegacyPendingQuestion || actionRow?.pending_question) {
    patch = {
      pending_question: null,
      session_status: resolveSanitizedSessionStatus({
        mode,
        action: actionRow,
        pendingResult,
        executionPlan,
      }),
    };
    action = {
      ...actionRow,
      pending_question: null,
      session_status: patch.session_status,
    };
  }

  const actionForSerialization =
    Array.isArray(action.conversation) && action.conversation.length > 0
      ? action
      : Array.isArray(session?.messages) && session.messages.length > 0
        ? { ...action, conversation: session.messages }
        : action;

  const repairedSession = serializeSession({
    action: actionForSerialization,
    preparation,
    pendingResult,
    executionPlan,
    interactivePayload,
  });

  return {
    action,
    session: repairedSession,
    sanitized: Boolean(patch),
    hadLegacyPendingQuestion,
    patch,
  };
}

export async function sanitizeAndPersistSessionForExecutionMode({
  baseUrl,
  secretKey,
  userId,
  actionRow,
  executionPlan,
  preparation,
  pendingResult = null,
  interactivePayload = null,
  schemaCapabilities = null,
  session = null,
}) {
  const sanitized = sanitizeSessionForExecutionMode({
    actionRow,
    executionPlan,
    session,
    interactivePayload,
    preparation,
    pendingResult,
  });

  if (!sanitized.patch || schemaCapabilities?.sessionColumns === false) {
    return sanitized;
  }

  const updated = await updateActionSession({
    baseUrl,
    secretKey,
    userId,
    actionId: actionRow.id,
    patch: sanitized.patch,
  });

  if (updated.ok && updated.action) {
    const actionForSerialization =
      Array.isArray(updated.action.conversation) && updated.action.conversation.length > 0
        ? updated.action
        : Array.isArray(sanitized.session?.messages) && sanitized.session.messages.length > 0
          ? { ...updated.action, conversation: sanitized.session.messages }
          : updated.action;
    const sessionAfterPersist = serializeSession({
      action: actionForSerialization,
      preparation,
      pendingResult,
      executionPlan,
      interactivePayload,
    });

    return {
      ...sanitized,
      action: updated.action,
      session: sessionAfterPersist,
    };
  }

  return sanitized;
}

function logPrepareSessionSanitization({
  projectId,
  stepId,
  actionId,
  planMode,
  hadLegacyPendingQuestion,
  sessionSanitized,
  contractValid,
  validationErrorCodes,
}) {
  console.log("[ProjectExecutionPrepare]", {
    projectId: projectId || null,
    stepId: stepId || null,
    actionId: actionId || null,
    planMode: planMode || null,
    hadLegacyPendingQuestion: Boolean(hadLegacyPendingQuestion),
    sessionSanitized: Boolean(sessionSanitized),
    contractValid: Boolean(contractValid),
    validationErrorCodes: validationErrorCodes || [],
  });
}

function buildAssessmentConversation({ project, step, internal }) {
  const now = new Date().toISOString();
  return [
    {
      role: "assistant",
      type: "opening",
      content: `Bun! Continuăm proiectul „${project.name}”.`,
      createdAt: now,
    },
    {
      role: "assistant",
      type: "context",
      content: `Pentru pasul „${step.title}”, ${internal.instructions}`,
      createdAt: now,
    },
    {
      role: "assistant",
      type: "question",
      content: `Evaluarea are ${internal.questions.length} întrebări. Răspunsurile corecte nu sunt afișate în timpul testului.`,
      createdAt: now,
    },
  ];
}

function applyAssessmentSessionOverrides(session, interactiveState, pendingResult) {
  const inReview = interactiveState.submitted && Boolean(pendingResult);
  return {
    ...session,
    phase: inReview ? "review" : "collecting",
    canGenerate: false,
    canRespond: false,
    canReview: inReview,
    pendingResult: inReview
      ? session.pendingResult
      : null,
  };
}

export async function ensureAssessmentInteractiveState({
  baseUrl,
  secretKey,
  userId,
  actionRow,
  step,
  project,
  preparation,
  pendingResult,
  schemaCapabilities = null,
  milestone = null,
  memoryMap = new Map(),
  completedSteps = [],
  fetchImpl = fetch,
  executionPlan = null,
}) {
  let action = actionRow;
  const interactiveState = readInteractiveState(action.collected_input);
  let internal = getAssessmentInternalFromPreparedInput(action.prepared_input);

  if (!internal && executionPlan?.mode === "assessment") {
    internal = executionPlanToAssessmentInternal(executionPlan);
  }

  if (!internal) {
    return null;
  }

  const patch = {
    prepared_input: withAssessmentInternal(action.prepared_input, internal),
    session_status: interactiveState.submitted && pendingResult ? "review" : "collecting",
    pending_question: null,
  };

  const shouldResetPrematureResult =
    pendingResult && !interactiveState.submitted;

  if (shouldResetPrematureResult) {
    patch.pending_result_id = null;
    patch.status = "prepared";
  }

  const needsConversationRefresh =
    !Array.isArray(action.conversation) ||
    action.conversation.length === 0 ||
    action.conversation.some((message) => message.type === "ready");

  if (needsConversationRefresh) {
    patch.conversation = buildAssessmentConversation({ project, step, internal });
  }

  const shouldPersist =
    schemaCapabilities?.sessionColumns !== false &&
    (shouldResetPrematureResult ||
      needsConversationRefresh ||
      !getAssessmentInternalFromPreparedInput(action.prepared_input));

  if (shouldPersist) {
    const updated = await updateActionSession({
      baseUrl,
      secretKey,
      userId,
      actionId: action.id,
      patch,
    });
    if (updated.ok && updated.action) {
      action = updated.action;
    }
  } else if (needsConversationRefresh || !getAssessmentInternalFromPreparedInput(action.prepared_input)) {
    action = {
      ...action,
      prepared_input: patch.prepared_input,
      conversation: patch.conversation || action.conversation,
      session_status: patch.session_status,
      pending_question: null,
      pending_result_id: shouldResetPrematureResult ? null : action.pending_result_id,
    };
  }

  const effectivePendingResult = interactiveState.submitted ? pendingResult : null;
  const session = applyAssessmentSessionOverrides(
    serializeSession({
      action,
      preparation,
      pendingResult: effectivePendingResult,
      phaseOverride: interactiveState.submitted && effectivePendingResult ? "review" : "collecting",
    }),
    interactiveState,
    effectivePendingResult,
  );

  return {
    action,
    session,
    interactivePayload: serializeAssessmentPayload(internal),
    savedAnswers: interactiveState.answers,
    currentQuestionIndex: interactiveState.currentQuestionIndex,
    interactiveState,
    internal,
  };
}

export async function enrichResponseWithInteractiveState({
  response,
  adaptive,
  extras,
  actionRow,
  pendingResult,
  schemaCapabilities = null,
  forceRegenerateInvalidPlan = false,
}) {
  const ensuredPlan = await ensureExecutionPlan({
    baseUrl: extras.baseUrl,
    secretKey: extras.secretKey,
    userId: extras.userId,
    actionRow,
    project: extras.project,
    step: extras.step,
    milestone: extras.milestone,
    preparation: adaptive.adaptedPreparation,
    memoryMap: adaptive.memoryMap,
    completedSteps: adaptive.adaptedPreparation?.context?.completedSteps || [],
    executionDecision: adaptive.executionDecision,
    schemaCapabilities,
    fetchImpl: extras.fetchImpl,
    forceRegenerateInvalidPlan,
  });

  if (!ensuredPlan.ok) {
    return {
      ok: false,
      code: ensuredPlan.code || "ACTION_DESIGN_PERSISTENCE_FAILED",
      recoverable: true,
    };
  }

  let action = ensuredPlan.action;
  let executionPlan = repairExecutionPlanInputRenderability(ensuredPlan.plan);
  const mode = executionPlan?.mode || response.executionDefinition?.mode;

  const sanitizedSession = await sanitizeAndPersistSessionForExecutionMode({
    baseUrl: extras.baseUrl,
    secretKey: extras.secretKey,
    userId: extras.userId,
    actionRow: action,
    executionPlan,
    preparation: adaptive.adaptedPreparation,
    pendingResult,
    schemaCapabilities,
    session: response.session,
  });

  action = sanitizedSession.action;
  let session = sanitizedSession.session;

  let interactivePayload = serializeInteractivePayloadFromPlan(executionPlan);
  const renderability = validateExecutionInputRenderability(executionPlan, interactivePayload);
  if (!renderability.valid) {
    executionPlan = repairExecutionPlanInputRenderability(executionPlan);
    interactivePayload = serializeInteractivePayloadFromPlan(executionPlan);
  }
  const payloadValidation = validateInteractivePayload(mode, interactivePayload);
  const renderabilityAfterRepair = validateExecutionInputRenderability(executionPlan, interactivePayload);
  if (!renderabilityAfterRepair.valid && isInteractiveExecutionMode(mode)) {
    interactivePayload = null;
  } else if (!payloadValidation.valid && isInteractiveExecutionMode(mode)) {
    interactivePayload = null;
  }

  const contractRepair = repairExecutionContractModePayload({
    executionPlan,
    interactivePayload,
    source: executionPlan?.metadata?.source || executionPlan?.source || null,
  });
  if (contractRepair.repaired) {
    executionPlan = contractRepair.executionPlan;
    interactivePayload = contractRepair.interactivePayload;
    logPrepareStage("execution_contract_repaired", {
      projectId: extras.project?.id || null,
      stepId: extras.step?.id || null,
      actionId: action?.id || null,
      originalMode: contractRepair.originalMode,
      originalPayloadType: contractRepair.originalPayloadType,
      repairedMode: contractRepair.repairedMode,
      repairedPayloadType: contractRepair.repairedPayloadType,
      repairReason: contractRepair.repairReason,
      source: contractRepair.source,
    });
  }

  let savedAnswers = null;
  let currentQuestionIndex = 0;

  if (mode === "assessment") {
    const assessment = await ensureAssessmentInteractiveState({
      baseUrl: extras.baseUrl,
      secretKey: extras.secretKey,
      userId: extras.userId,
      actionRow: action,
      step: extras.step,
      project: extras.project,
      preparation: adaptive.adaptedPreparation,
      pendingResult,
      schemaCapabilities,
      milestone: extras.milestone,
      memoryMap: adaptive.memoryMap,
      completedSteps: adaptive.adaptedPreparation?.context?.completedSteps || [],
      fetchImpl: extras.fetchImpl,
      executionPlan,
    });

    if (assessment) {
      action = assessment.action;
      interactivePayload = assessment.interactivePayload;
      savedAnswers = assessment.savedAnswers;
      currentQuestionIndex = assessment.currentQuestionIndex;
      session = assessment.session;
    }
  }

  const executionDefinition = serializeExecutionDefinition(
    buildExecutionDefinition({
      project: extras.project,
      step: extras.step,
      milestone: extras.milestone,
      preparation: adaptive.adaptedPreparation,
      session,
      executionDecision: adaptive.executionDecision,
      memoryMap: adaptive.memoryMap,
      interactivePayload,
      executionPlan,
    }),
  );

  logExecutionPlanDiagnostics(executionPlan, interactivePayload);

  let experience = getExperienceFromPreparedInput(action?.prepared_input);
  let experienceValid = false;
  let experienceValidationReason = null;
  let experienceGeneratedBy = null;

  if (isAiExperienceV1Enabled() && mode === "structured_form") {
    const adaptResult = experience
      ? { ok: true, experience, generatedBy: "persisted" }
      : adaptExecutionPlanToExperience({
          executionPlan,
          executionDefinition,
          actionId: action?.id,
          stepId: extras.step?.id,
        });

    if (adaptResult.ok && adaptResult.experience) {
      experience = adaptResult.experience;
      experienceValid = true;
      experienceGeneratedBy = adaptResult.generatedBy || "adapter";

      const persistedExperience = getExperienceFromPreparedInput(action?.prepared_input);
      if (!persistedExperience || persistedExperience.experienceId !== experience.experienceId) {
        const patch = {
          prepared_input: withExperience(action.prepared_input, experience),
        };
        if (schemaCapabilities?.sessionColumns !== false) {
          const updated = await updateActionSession({
            baseUrl: extras.baseUrl,
            secretKey: extras.secretKey,
            userId: extras.userId,
            actionId: action.id,
            patch,
          });
          if (updated.ok && updated.action) {
            action = updated.action;
          } else {
            action = { ...action, prepared_input: patch.prepared_input };
          }
        } else {
          action = { ...action, prepared_input: patch.prepared_input };
        }
      }
    } else {
      experienceValidationReason = adaptResult.code || "experience_adapt_failed";
    }
  }

  // Universal lifecycle envelope: prepare re-runs the completion evaluator so a
  // refresh reconstructs the same lifecycle deterministically (e.g. a step whose
  // inputs are already complete resumes at ready_to_finalize, not collecting).
  let completionEnvelope = null;
  if (executionPlan) {
    completionEnvelope = validateStepCompletion({
      plan: executionPlan,
      action,
      collectedInput: action?.collected_input || {},
      acceptedResult: null,
      pendingResult,
      experience,
    });

    if (
      completionEnvelope.canFinalize &&
      !pendingResult &&
      session &&
      session.phase !== "ready_to_finalize"
    ) {
      session = {
        ...session,
        phase: "ready_to_finalize",
        canFinalize: true,
        resultAccepted: true,
      };
    }
  }

  const contract = buildActiveExecutionContract({
    projectId: extras.project?.id,
    stepId: extras.step?.id,
    action: serializeActionRow(action, {
      latestResult: response.action?.latestResult || null,
      session,
    }),
    session,
    executionPlan,
    executionDefinition,
    interactivePayload,
    experience,
    experienceValid,
    experienceValidationReason,
    source: executionPlan?.metadata?.source || executionPlan?.source || "openai",
  });

  const contractValidation = validateActiveExecutionContract({
    ...contract,
    actionId: action?.id || contract.actionId,
    session: {
      ...session,
      sessionId: session?.sessionId || action?.id || null,
    },
  });

  const contractValid = contractValidation.valid;

  logPrepareSessionSanitization({
    projectId: extras.project?.id,
    stepId: extras.step?.id,
    actionId: action?.id || null,
    planMode: executionPlan?.mode || null,
    hadLegacyPendingQuestion: sanitizedSession.hadLegacyPendingQuestion,
    sessionSanitized: sanitizedSession.sanitized,
    contractValid,
    validationErrorCodes: contractValid ? [] : [contractValidation.reason],
  });

  if (experience) {
    console.log("[ProjectAiExperience]", {
      projectId: extras.project?.id || null,
      stepId: extras.step?.id || null,
      actionId: action?.id || null,
      experienceId: experience.experienceId || null,
      experienceVersion: experience.experienceVersion || null,
      experienceGeneratedBy: experienceGeneratedBy || null,
      componentTypes: collectComponentTypes(experience),
      componentCount: collectComponentTypes(experience).length,
      experienceValid,
      validationErrorCodes: experienceValid ? [] : [experienceValidationReason],
      usedDynamicRenderer: experienceValid,
    });
  }

  logPrepareContract(contract, contractValid);

  const experienceProgress = action?.collected_input?.experience || null;

  return {
    ...response,
    action: serializeActionRow(action, {
      latestResult: response.action?.latestResult || null,
      session,
    }),
    session,
    canFinalize: completionEnvelope ? completionEnvelope.canFinalize : undefined,
    missingRequirements: completionEnvelope ? completionEnvelope.missingRequirements : undefined,
    executionDefinition,
    executionPlan: serializeExecutionPlanForClient(executionPlan),
    interactivePayload,
    savedAnswers,
    currentQuestionIndex,
    experience: experienceValid ? experience : null,
    experienceValid,
    experienceValidationReason,
    experienceProgress,
    executionContract: serializeContractForClient(contract),
    contractValid,
    contractValidationReason: contractValid ? null : contractValidation.reason,
    ...(adaptive.brainDecisionMetadata
      ? { brainDecision: adaptive.brainDecisionMetadata }
      : {}),
  };
}

function serializeExecutionPlanForClient(plan) {
  if (!plan) return null;
  return {
    planId: plan.planId,
    mode: plan.mode,
    title: plan.title,
    primaryActionLabel: plan.primaryActionLabel,
    userAction: plan.userAction,
    completionCriteria: plan.completionCriteria,
    planSource: plan.metadata?.source || plan.source,
    metadata: plan.metadata || {
      source: plan.source || "openai",
      version: plan.version || 2,
      generatedAt: null,
    },
  };
}

function logPrepareContract(contract, compatible) {
  console.log("[ProjectExecutionContract]", serializeContractDiagnostics(contract, compatible));
}

export function logExecutionPlanDiagnostics(plan, interactivePayload) {
  if (process.env.NODE_ENV === "production") return;

  const payload = interactivePayload || serializeInteractivePayloadFromPlan(plan);
  console.log("[ProjectExecutionPlan]", {
    mode: plan?.mode ?? null,
    actionType: plan?.userAction?.type ?? null,
    title: plan?.title ?? null,
    primaryActionLabel: plan?.primaryActionLabel ?? null,
    requiredInputsCount: plan?.requiredInputs?.length ?? 0,
    interactivePayloadType: payload?.type ?? null,
    questionsCount: payload?.questions?.length ?? 0,
    fieldsCount: payload?.fields?.length ?? 0,
    choicesCount: payload?.options?.length ?? payload?.choices?.length ?? 0,
    checklistCount: payload?.items?.length ?? 0,
    recommendationGroupsCount: payload?.groups?.length ?? 0,
    recommendationCount:
      payload?.groups?.reduce?.((sum, group) => sum + (group.recommendations?.length || 0), 0) ?? 0,
    completionCriteria: plan?.completionCriteria ?? null,
    source: plan?.metadata?.source ?? plan?.source ?? null,
  });
}

export async function persistAssessmentProgress({
  baseUrl,
  secretKey,
  userId,
  actionRow,
  preparation,
  assessmentId,
  answers,
  currentQuestionIndex,
  started = true,
}) {
  const internal = getAssessmentInternalFromPreparedInput(actionRow.prepared_input);
  if (!internal || internal.assessmentId !== assessmentId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const collectedInput = {
    ...(actionRow.collected_input || {}),
    interactive: {
      type: "assessment",
      assessmentId,
      started,
      submitted: false,
      answers: answers || {},
      currentQuestionIndex: Number.isFinite(currentQuestionIndex) ? currentQuestionIndex : 0,
    },
  };

  const updated = await updateActionSession({
    baseUrl,
    secretKey,
    userId,
    actionId: actionRow.id,
    patch: {
      collected_input: collectedInput,
      session_status: "collecting",
      status: "in_progress",
      pending_question: null,
    },
  });

  if (!updated.ok || !updated.action) {
    return { ok: false, code: "INTERNAL" };
  }

  const session = applyAssessmentSessionOverrides(
    serializeSession({
      action: updated.action,
      preparation,
      pendingResult: null,
      phaseOverride: "collecting",
    }),
    readInteractiveState(collectedInput),
    null,
  );

  return {
    ok: true,
    action: updated.action,
    session,
    interactivePayload: serializeAssessmentPayload(internal),
    savedAnswers: collectedInput.interactive.answers,
    currentQuestionIndex: collectedInput.interactive.currentQuestionIndex,
  };
}

export async function submitAssessmentEvaluation({
  baseUrl,
  secretKey,
  userId,
  actionRow,
  step,
  project,
  preparation,
  assessmentId,
  answers,
  fetchImpl = fetch,
}) {
  const internal = getAssessmentInternalFromPreparedInput(actionRow.prepared_input);
  if (!internal || internal.assessmentId !== assessmentId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  let evaluation;
  if (internal.scoringStrategy === "ai_evaluated" || internal.scoringStrategy === "synthesis_only") {
    const aiResult = await evaluateAssessmentWithAi({
      internal,
      answers,
      project,
      step,
      preparation,
      fetchImpl,
    });
    evaluation = aiResult.evaluation;
  } else {
    evaluation = evaluateAssessmentAnswers(internal, answers);
  }
  const title = evaluation.title || buildResultTitle({ step, project });
  const preview = evaluation.preview || buildResultPreview(evaluation.content);

  const savedResult = await insertActionResult({
    baseUrl,
    secretKey,
    userId,
    action: actionRow,
    step,
    resultType: "text",
    title,
    preview,
    content: evaluation.content,
    acceptanceStatus: "pending_review",
  });

  if (!savedResult.ok || !savedResult.result) {
    return { ok: false, code: "INTERNAL" };
  }

  const collectedInput = {
    ...(actionRow.collected_input || {}),
    interactive: {
      type: "assessment",
      assessmentId,
      started: true,
      submitted: true,
      answers: answers || {},
      currentQuestionIndex: internal.questions.length - 1,
      evaluatedAt: new Date().toISOString(),
      level: evaluation.level,
      percent: evaluation.percent,
    },
  };

  const conversation = Array.isArray(actionRow.conversation) ? [...actionRow.conversation] : [];
  conversation.push(buildResultMessage({ title, preview }));
  conversation.push(buildReviewMessage());

  const updated = await updateActionSession({
    baseUrl,
    secretKey,
    userId,
    actionId: actionRow.id,
    patch: {
      collected_input: collectedInput,
      conversation,
      pending_result_id: savedResult.result.id,
      session_status: "review",
      status: "in_progress",
      pending_question: null,
    },
  });

  if (!updated.ok || !updated.action) {
    return { ok: false, code: "INTERNAL" };
  }

  const pendingResult = savedResult.result;
  const session = applyAssessmentSessionOverrides(
    serializeSession({
      action: updated.action,
      preparation,
      pendingResult,
      phaseOverride: "review",
    }),
    readInteractiveState(collectedInput),
    pendingResult,
  );

  return {
    ok: true,
    action: updated.action,
    session,
    result: savedResult.result,
    evaluation,
    interactivePayload: serializeAssessmentPayload(internal),
    savedAnswers: collectedInput.interactive.answers,
    currentQuestionIndex: collectedInput.interactive.currentQuestionIndex,
  };
}
