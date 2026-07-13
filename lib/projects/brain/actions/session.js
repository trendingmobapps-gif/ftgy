import { buildWhyItMatters } from "./context-builder.js";

export const SESSION_PHASES = ["collecting", "ready", "generating", "review", "accepted", "ready_to_finalize", "cancelled"];

export const SESSION_MESSAGE_TYPES = ["opening", "context", "question", "answer", "ready", "result", "review", "system"];

function firstMissingField(missingFields = []) {
  return missingFields.find((field) => field.required) || missingFields[0] || null;
}

export function buildSessionOpening({ project, step, preparation }) {
  const messages = [];
  const why = preparation.whyItMatters || buildWhyItMatters({ step, project });
  const expected = preparation.expectedResult || step.expected_outcome;

  messages.push({
    role: "assistant",
    type: "opening",
    content: `Bun! Continuăm proiectul „${project.name}”.`,
    createdAt: new Date().toISOString(),
  });

  messages.push({
    role: "assistant",
    type: "context",
    content: `Pentru pasul „${step.title}”, obiectivul este: ${expected}.${why ? ` ${why}` : ""}`,
    createdAt: new Date().toISOString(),
  });

  const missing = firstMissingField(preparation.missingFields);
  let pendingQuestion = null;
  let phase = "ready";

  if (missing) {
    phase = "collecting";
    pendingQuestion = {
      key: missing.key,
      label: missing.label,
    };
    messages.push({
      role: "assistant",
      type: "question",
      content: `Am nevoie doar de un detaliu: ${missing.label.toLowerCase()}.`,
      fieldKey: missing.key,
      createdAt: new Date().toISOString(),
    });
  } else {
    messages.push({
      role: "assistant",
      type: "ready",
      content: "Am suficient context din proiect. Pot genera rezultatul când ești pregătit.",
      createdAt: new Date().toISOString(),
    });
  }

  return {
    phase,
    messages,
    pendingQuestion,
    collectedInput: {},
  };
}

export function appendUserAnswer({ conversation, pendingQuestion, message, collectedInput }) {
  const nextConversation = Array.isArray(conversation) ? [...conversation] : [];
  const nextCollected = { ...(collectedInput || {}) };

  nextConversation.push({
    role: "user",
    type: "answer",
    content: String(message || "").trim(),
    fieldKey: pendingQuestion?.key || null,
    createdAt: new Date().toISOString(),
  });

  if (pendingQuestion?.key) {
    nextCollected[pendingQuestion.key] = String(message || "").trim();
  }

  return { conversation: nextConversation, collectedInput: nextCollected };
}

export function resolveNextQuestion({ preparation, collectedInput }) {
  const missing = (preparation.missingFields || []).filter((field) => {
    const value = String(collectedInput?.[field.key] || "").trim();
    return !value;
  });

  const next = missing[0] || null;
  if (!next) {
    return { phase: "ready", pendingQuestion: null, message: null };
  }

  return {
    phase: "collecting",
    pendingQuestion: { key: next.key, label: next.label },
    message: {
      role: "assistant",
      type: "question",
      content: `Am nevoie doar de un detaliu: ${next.label.toLowerCase()}.`,
      fieldKey: next.key,
      createdAt: new Date().toISOString(),
    },
  };
}

export function buildReviewPrompt() {
  return "Vrei să folosim acest rezultat în proiect? Poți accepta, cere îmbunătățiri sau anula.";
}

export function buildResultMessage({ title, preview }) {
  return {
    role: "assistant",
    type: "result",
    content: title,
    preview,
    createdAt: new Date().toISOString(),
  };
}

export function buildReviewMessage() {
  return {
    role: "assistant",
    type: "review",
    content: buildReviewPrompt(),
    createdAt: new Date().toISOString(),
  };
}

export function serializeSession({
  action,
  preparation,
  pendingResult = null,
  phaseOverride = null,
}) {
  const conversation = Array.isArray(action?.conversation) ? action.conversation : [];
  const pendingQuestion = action?.pending_question || action?.pendingQuestion || null;
  const sessionStatus = action?.session_status || action?.sessionStatus || null;
  const phase =
    phaseOverride ||
    sessionStatus ||
    (pendingResult ? "review" : pendingQuestion ? "collecting" : "ready");

  const acceptedResult =
    pendingResult?.acceptance_status === "accepted" ||
    pendingResult?.acceptanceStatus === "accepted";

  return {
    sessionId: action?.id || action?.actionId || null,
    phase,
    objective: preparation?.expectedResult || action?.expected_result || action?.expectedResult || null,
    title: action?.title || null,
    messages: conversation,
    pendingQuestion,
    pendingResult: pendingResult
      ? {
          id: pendingResult.id,
          title: pendingResult.title,
          preview: pendingResult.preview,
          content: pendingResult.content || pendingResult.preview || "",
          acceptanceStatus: pendingResult.acceptance_status || pendingResult.acceptanceStatus || "pending_review",
        }
      : null,
    canGenerate: phase === "ready" || (phase === "collecting" && !pendingQuestion),
    canRespond: Boolean(pendingQuestion),
    canReview: phase === "review" && Boolean(pendingResult),
    canFinalize: phase === "ready_to_finalize" || (phase === "accepted" && acceptedResult),
    resultAccepted: acceptedResult || phase === "ready_to_finalize",
  };
}
