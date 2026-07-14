import {
  experienceValuesToLegacyFormValues,
  normalizeExperienceSubmit,
  validateExperienceValues,
} from "../execution/experience-values-normalizer.js";
import { getExperienceFromPreparedInput } from "../execution/ai-experience-validation.js";

const LEGACY_INVENTED_FIELD_KEYS = new Set([
  "subiectQuiz",
  "limbaEngleza",
  "medicalTopic",
]);

const ALWAYS_ALLOWED_KEYS = new Set([
  "mode",
  "type",
  "contractId",
  "experienceId",
  "experienceVersion",
  "values",
  "idempotencyKey",
  "interactive",
  "prompt",
  "researchMode",
  "guidedAnswers",
  "answers",
  "selected_recommendations",
  "selectedRecommendations",
  "priority_order",
  "priorityOrder",
  "channel_strategy_summary",
  "channelStrategySummary",
  "custom_options",
  "customOptions",
  "selected_direction",
  "selectedChoice",
]);

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

function allowedAcceptedInputKeys(executionPlan) {
  const keys = new Set(ALWAYS_ALLOWED_KEYS);
  for (const field of executionPlan?.requiredInputs || []) {
    if (field?.id) keys.add(field.id);
  }
  return keys;
}

function filterAcceptedInputKeys(raw, executionPlan) {
  const source = isPlainObject(raw) ? raw : {};
  const allowed = allowedAcceptedInputKeys(executionPlan);
  const filtered = {};

  for (const [key, value] of Object.entries(source)) {
    if (LEGACY_INVENTED_FIELD_KEYS.has(key)) {
      continue;
    }
    if (allowed.has(key) || executionPlan?.requiredInputs?.some((field) => field.id === key)) {
      filtered[key] = value;
    }
  }

  return filtered;
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

function normalizeGuidedQuestionsInput(raw = {}, executionPlan) {
  const source = isPlainObject(raw) ? raw : {};
  const interactiveSource = isPlainObject(source.interactive) ? source.interactive : {};
  const guidedAnswers = {};

  const mergeAnswers = (answers) => {
    if (!isPlainObject(answers)) return;
    for (const [key, value] of Object.entries(answers)) {
      const trimmed = toTrimmedString(value);
      if (trimmed) guidedAnswers[key] = trimmed;
    }
  };

  mergeAnswers(source.guidedAnswers);
  mergeAnswers(interactiveSource.guidedAnswers);
  mergeAnswers(interactiveSource.answers);
  mergeAnswers(source.answers);

  for (const question of executionPlan?.questions || []) {
    if (!question?.id) continue;
    const trimmed = toTrimmedString(source[question.id]);
    if (trimmed) guidedAnswers[question.id] = trimmed;
  }

  return {
    ...source,
    mode: "guided_questions",
    guidedAnswers,
    interactive: {
      ...interactiveSource,
      type: "guided_questions",
      guidedAnswers,
      answers: guidedAnswers,
      completed: true,
    },
  };
}

function normalizeExperienceInput(raw = {}, executionPlan, action) {
  const experience = getExperienceFromPreparedInput(action?.prepared_input);

  if (!experience) {
    return { ...raw, mode: executionPlan?.mode || "structured_form" };
  }

  const normalizedSubmit = normalizeExperienceSubmit(raw, experience);
  const valueValidation = validateExperienceValues(experience, normalizedSubmit.values, {
    strict: true,
  });

  if (!valueValidation.valid) {
    return {
      ...normalizedSubmit,
      mode: executionPlan?.mode || "structured_form",
      _experienceValidationErrors: valueValidation.errors,
    };
  }

  const legacyFormValues = experienceValuesToLegacyFormValues(experience, normalizedSubmit.values);

  return {
    ...legacyFormValues,
    mode: executionPlan?.mode || "structured_form",
    type: "experience",
    contractId: normalizedSubmit.contractId,
    experienceId: normalizedSubmit.experienceId,
    experienceVersion: normalizedSubmit.experienceVersion,
    values: normalizedSubmit.values,
    idempotencyKey: normalizedSubmit.idempotencyKey,
    interactive: {
      type: "structured_form",
      formValues: legacyFormValues,
    },
  };
}

export function normalizeAcceptedExecutionInput({ acceptedInput, executionPlan, action }) {
  const raw = filterAcceptedInputKeys(acceptedInput, executionPlan);

  const mode =
    toTrimmedString(raw.mode) ||
    toTrimmedString(executionPlan?.mode) ||
    toTrimmedString(action?.prepared_input?._executionPlan?.mode) ||
    null;

  if (raw.type === "experience") {
    const experience = getExperienceFromPreparedInput(action?.prepared_input);
    if (experience) {
      return normalizeExperienceInput({ ...raw, mode }, executionPlan, action);
    }
  }

  if (mode === "recommendation_selection") {
    return normalizeRecommendationSelectionInput({ ...raw, mode });
  }

  if (mode === "guided_questions") {
    return normalizeGuidedQuestionsInput({ ...raw, mode }, executionPlan);
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

export { LEGACY_INVENTED_FIELD_KEYS };
