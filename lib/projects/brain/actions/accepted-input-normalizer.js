function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toTrimmedString(value) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return text.trim();
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (isPlainObject(item)) {
        const id = toTrimmedString(item.id || item.recommendationId || item.value || item.slug);
        return id;
      }
      return "";
    })
    .filter(Boolean);
}

function normalizeRecommendationSelectionInput(raw = {}) {
  const source = isPlainObject(raw) ? raw : {};
  const interactiveSource = isPlainObject(source.interactive) ? source.interactive : {};

  const rawSelected =
    source.selectedRecommendations ??
    source.selected_recommendations ??
    source.selectedIds ??
    source.selected_ids ??
    interactiveSource.selectedRecommendations ??
    interactiveSource.selected_recommendations ??
    interactiveSource.selectedIds ??
    interactiveSource.selected_ids ??
    [];

  const rawPriorityOrder =
    source.priorityOrder ??
    source.priority_order ??
    interactiveSource.priorityOrder ??
    interactiveSource.priority_order ??
    [];

  const selectedIds = normalizeIdList(rawSelected);
  const priorityOrderIds = normalizeIdList(rawPriorityOrder);

  const priorityIndex = new Map();
  priorityOrderIds.forEach((id, index) => {
    if (!priorityIndex.has(id)) priorityIndex.set(id, index + 1);
  });

  const selectedRecommendations = selectedIds.map((id, index) => {
    const existing = Array.isArray(rawSelected)
      ? rawSelected.find((item) => isPlainObject(item) && toTrimmedString(item.id) === id)
      : null;
    const explicitPriority = existing && Number.isFinite(Number(existing.priority)) ? Number(existing.priority) : null;

    return {
      id,
      selected: true,
      priority: priorityIndex.get(id) ?? explicitPriority ?? index + 1,
    };
  });

  const priorityOrder =
    priorityOrderIds.length > 0 ? priorityOrderIds : selectedRecommendations.map((item) => item.id);

  const customOptions =
    (Array.isArray(source.customOptions) && source.customOptions) ||
    (Array.isArray(source.custom_options) && source.custom_options) ||
    (Array.isArray(interactiveSource.customOptions) && interactiveSource.customOptions) ||
    (Array.isArray(interactiveSource.custom_options) && interactiveSource.custom_options) ||
    [];

  const channelStrategySummary =
    typeof source.channelStrategySummary === "string"
      ? source.channelStrategySummary
      : typeof source.channel_strategy_summary === "string"
        ? source.channel_strategy_summary
        : typeof interactiveSource.channelStrategySummary === "string"
          ? interactiveSource.channelStrategySummary
          : typeof interactiveSource.channel_strategy_summary === "string"
            ? interactiveSource.channel_strategy_summary
            : undefined;

  return {
    ...source,
    mode: "recommendation_selection",
    interactive: {
      ...interactiveSource,
      type: "recommendation_selection",
      confirmed: true,
      selectedRecommendations,
      priorityOrder,
      customOptions,
      ...(channelStrategySummary ? { channelStrategySummary } : {}),
    },
  };
}

export function normalizeAcceptedExecutionInput({ acceptedInput, executionPlan, action }) {
  const raw = isPlainObject(acceptedInput) ? acceptedInput : {};

  const mode =
    toTrimmedString(raw.mode) ||
    toTrimmedString(executionPlan?.mode) ||
    toTrimmedString(action?.prepared_input?._executionPlan?.mode) ||
    null;

  if (mode === "recommendation_selection") {
    return normalizeRecommendationSelectionInput({ ...raw, mode });
  }

  return {
    ...raw,
    mode,
  };
}

export function buildSafeAcceptedInputNormalizationDetails({ mode, rawInput, normalizedInput }) {
  const raw = isPlainObject(rawInput) ? rawInput : {};
  const normalized = isPlainObject(normalizedInput) ? normalizedInput : {};

  return {
    mode: mode || null,
    receivedKeys: Object.keys(raw).slice(0, 48),
    normalizedKeys: Object.keys(normalized).slice(0, 48),
  };
}
