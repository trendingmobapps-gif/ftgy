import {
  buildAssessmentInternal,
  evaluateAssessmentAnswers,
  getAssessmentInternalFromPreparedInput,
  readInteractiveState,
  serializeAssessmentPayload,
  withAssessmentInternal,
} from "./assessment.js";
import { buildExecutionDefinition, serializeExecutionDefinition } from "./definition.js";
import { serializeSession } from "../actions/session.js";
import { updateActionSession, serializeActionRow } from "../actions/repository.js";
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
  "choice",
]);

export function isInteractiveExecutionMode(mode) {
  return INTERACTIVE_EXECUTION_MODES.has(mode);
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
}) {
  let action = actionRow;
  const interactiveState = readInteractiveState(action.collected_input);
  let internal = getAssessmentInternalFromPreparedInput(action.prepared_input);

  if (!internal) {
    internal = buildAssessmentInternal({
      step,
      project,
      assessmentId: interactiveState.assessmentId || null,
    });
  } else if (interactiveState.assessmentId && internal.assessmentId !== interactiveState.assessmentId) {
    internal = buildAssessmentInternal({
      step,
      project,
      assessmentId: interactiveState.assessmentId,
    });
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
}) {
  const mode = response.executionDefinition?.mode;
  if (mode !== "assessment") {
    return response;
  }

  const assessment = await ensureAssessmentInteractiveState({
    baseUrl: extras.baseUrl,
    secretKey: extras.secretKey,
    userId: extras.userId,
    actionRow,
    step: extras.step,
    project: extras.project,
    preparation: adaptive.adaptedPreparation,
    pendingResult,
    schemaCapabilities,
  });

  const executionDefinition = serializeExecutionDefinition(
    buildExecutionDefinition({
      project: extras.project,
      step: extras.step,
      milestone: extras.milestone,
      preparation: adaptive.adaptedPreparation,
      session: assessment.session,
      executionDecision: adaptive.executionDecision,
      memoryMap: adaptive.memoryMap,
      interactivePayload: assessment.interactivePayload,
    }),
  );

  return {
    ...response,
    action: serializeActionRow(assessment.action, {
      latestResult: response.action?.latestResult || null,
      session: assessment.session,
    }),
    session: assessment.session,
    executionDefinition,
    interactivePayload: assessment.interactivePayload,
    savedAnswers: assessment.savedAnswers,
    currentQuestionIndex: assessment.currentQuestionIndex,
  };
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
}) {
  const internal = getAssessmentInternalFromPreparedInput(actionRow.prepared_input);
  if (!internal || internal.assessmentId !== assessmentId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const evaluation = evaluateAssessmentAnswers(internal, answers);
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
