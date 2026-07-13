export function normalizeJsonObject(value, fallback = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }

  return { ...value };
}

export function normalizeJsonArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export function normalizePendingQuestion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const key = typeof value.key === "string" ? value.key.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";

  if (!key || !label) {
    return null;
  }

  return { key, label };
}

export function normalizeActionRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    prepared_input: normalizeJsonObject(row.prepared_input),
    missing_fields: normalizeJsonArray(row.missing_fields),
    collected_input: normalizeJsonObject(row.collected_input),
    conversation: normalizeJsonArray(row.conversation),
    pending_question: normalizePendingQuestion(row.pending_question),
  };
}

export function hasPersistedConversation(row) {
  return normalizeJsonArray(row?.conversation).length > 0;
}

export function buildInMemorySessionFromState(sessionState, actionRow, preparation) {
  const normalized = normalizeActionRow(actionRow) || {};
  return {
    sessionId: normalized.id || null,
    phase: sessionState?.phase || "collecting",
    objective: preparation?.expectedResult || normalized.expected_result || null,
    title: normalized.title || preparation?.title || null,
    messages: normalizeJsonArray(sessionState?.messages),
    pendingQuestion: normalizePendingQuestion(sessionState?.pendingQuestion),
    pendingResult: null,
    canGenerate:
      sessionState?.phase === "ready" ||
      (sessionState?.phase === "collecting" && !normalizePendingQuestion(sessionState?.pendingQuestion)),
    canRespond: Boolean(normalizePendingQuestion(sessionState?.pendingQuestion)),
    canReview: false,
  };
}
