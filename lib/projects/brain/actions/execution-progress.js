const ALLOWED_PROGRESS_TYPES = new Set([
  "structured_form",
  "choice",
  "checklist",
  "guided_questions",
  "recommendation_selection",
  "experience",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeExecutionProgress(progress = {}) {
  const source = isPlainObject(progress) ? progress : {};
  const type = typeof source.type === "string" ? source.type.trim() : "";
  const normalized = { ...source, type };

  if (type === "choice") {
    const selected =
      source.selectedChoice ??
      source.selected_direction ??
      (Array.isArray(source.selectedChoiceIds) ? source.selectedChoiceIds[0] : null);
    if (selected != null && String(selected).trim()) {
      normalized.selectedChoice = String(selected).trim();
    }
  }

  if (type === "checklist") {
    const checked = source.checklistChecked ?? source.checklistState;
    if (isPlainObject(checked)) {
      normalized.checklistChecked = { ...checked };
    }
  }

  if (type === "structured_form" || type === "spreadsheet_builder") {
    const values = source.formValues ?? source.values;
    if (isPlainObject(values)) {
      normalized.formValues = { ...values };
      normalized.type = "structured_form";
    }
  }

  if (type === "guided_questions") {
    const answers = source.guidedAnswers ?? source.answers;
    if (isPlainObject(answers)) {
      normalized.guidedAnswers = { ...answers };
    }
  }

  if (type === "recommendation_selection") {
    if (Array.isArray(source.selectedRecommendations)) {
      normalized.selectedRecommendations = [...source.selectedRecommendations];
    }
    if (Array.isArray(source.priorityOrder)) {
      normalized.priorityOrder = [...source.priorityOrder];
    }
    if (Array.isArray(source.customOptions)) {
      normalized.customOptions = [...source.customOptions];
    }
    if (source.confirmed === true) {
      normalized.confirmed = true;
    }
  }

  if (type === "experience") {
    normalized.experienceId = typeof source.experienceId === "string" ? source.experienceId.trim() : "";
    normalized.experienceVersion = source.experienceVersion ?? 1;
    if (isPlainObject(source.values)) {
      normalized.values = { ...source.values };
    }
    normalized.navigation = isPlainObject(source.navigation)
      ? { currentSectionId: source.navigation.currentSectionId ?? null }
      : { currentSectionId: null };
    if (typeof source.updatedAt === "string") {
      normalized.updatedAt = source.updatedAt;
    }
  }

  return normalized;
}

export function validateExecutionProgressShape(progress = {}) {
  const fields = {};
  const normalized = normalizeExecutionProgress(progress);
  const type = normalized.type;

  if (!type) {
    fields.type = "progress.type este obligatoriu.";
    return { ok: false, fields, normalized };
  }

  if (!ALLOWED_PROGRESS_TYPES.has(type)) {
    fields.type = "progress.type nu este suportat.";
    return { ok: false, fields, normalized };
  }

  if (type === "choice" && !String(normalized.selectedChoice || "").trim()) {
    fields.selectedChoice = "Selectează o opțiune înainte de salvare.";
  }

  if (type === "structured_form") {
    if (!isPlainObject(normalized.formValues)) {
      fields.formValues = "formValues trebuie să fie un obiect.";
    }
  }

  if (type === "checklist") {
    if (!isPlainObject(normalized.checklistChecked)) {
      fields.checklistChecked = "checklistChecked trebuie să fie un obiect.";
    }
  }

  if (type === "guided_questions") {
    if (!isPlainObject(normalized.guidedAnswers) && !isPlainObject(normalized.answers)) {
      fields.guidedAnswers = "guidedAnswers trebuie să fie un obiect.";
    }
  }

  if (type === "recommendation_selection") {
    const selectedCount = Array.isArray(normalized.selectedRecommendations)
      ? normalized.selectedRecommendations.length
      : 0;
    const customCount = Array.isArray(normalized.customOptions) ? normalized.customOptions.length : 0;
    if (selectedCount + customCount < 1) {
      fields.selectedRecommendations = "Selectează cel puțin o recomandare.";
    }
  }

  if (type === "experience") {
    if (!normalized.experienceId) {
      fields.experienceId = "experienceId este obligatoriu.";
    }
    if (normalized.experienceVersion !== 1) {
      fields.experienceVersion = "experienceVersion trebuie să fie 1.";
    }
    if (!isPlainObject(normalized.values)) {
      fields.values = "values trebuie să fie un obiect.";
    }
  }

  return { ok: Object.keys(fields).length === 0, fields, normalized };
}
