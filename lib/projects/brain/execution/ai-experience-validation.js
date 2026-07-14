import {
  AI_EXPERIENCE_VERSION,
  BOOLEAN_PRESENTATIONS,
  CALLOUT_VARIANTS,
  EXPERIENCE_LIMITS,
  PHASE_1_COMPONENT_TYPES,
  SELECT_PRESENTATIONS,
  TEXT_BLOCK_VARIANTS,
  countExperienceComponents,
} from "./ai-experience-schema.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pushError(errors, code, message) {
  errors.push({ code, message });
}

function validateOption(option, errors, prefix) {
  if (!isPlainObject(option)) {
    pushError(errors, "EXPERIENCE_INVALID_OPTION", `${prefix} option must be an object`);
    return;
  }
  const id = typeof option.id === "string" ? option.id.trim() : "";
  const label = typeof option.label === "string" ? option.label.trim() : "";
  if (!id) pushError(errors, "EXPERIENCE_INVALID_OPTION", `${prefix} option.id is required`);
  if (!label) pushError(errors, "EXPERIENCE_INVALID_OPTION", `${prefix} option.label is required`);
  if (label.length > EXPERIENCE_LIMITS.maxLabelLength) {
    pushError(errors, "EXPERIENCE_LABEL_TOO_LONG", `${prefix} option.label exceeds limit`);
  }
}

function validateInputComponent(component, errors) {
  const label = typeof component.label === "string" ? component.label.trim() : "";
  if (!label) {
    pushError(errors, "EXPERIENCE_MISSING_LABEL", `Component ${component.id} missing label`);
  }
  if (label.length > EXPERIENCE_LIMITS.maxLabelLength) {
    pushError(errors, "EXPERIENCE_LABEL_TOO_LONG", `Component ${component.id} label too long`);
  }

  const validation = component.validation;
  if (validation != null && !isPlainObject(validation)) {
    pushError(errors, "EXPERIENCE_INVALID_VALIDATION", `Component ${component.id} validation must be object`);
  }

  if (component.type === "single_select" || component.type === "multi_select") {
    const options = Array.isArray(component.options) ? component.options : [];
    if (options.length < 1) {
      pushError(errors, "EXPERIENCE_MISSING_OPTIONS", `Component ${component.id} needs options`);
    }
    if (options.length > EXPERIENCE_LIMITS.maxOptionsPerSelect) {
      pushError(errors, "EXPERIENCE_OPTION_LIMIT_EXCEEDED", `Component ${component.id} too many options`);
    }
    const optionIds = new Set();
    for (const option of options) {
      validateOption(option, errors, component.id);
      if (option?.id && optionIds.has(option.id)) {
        pushError(errors, "EXPERIENCE_DUPLICATE_OPTION_ID", `Component ${component.id} duplicate option id`);
      }
      if (option?.id) optionIds.add(option.id);
    }
    const presentation = component.presentation || "list";
    if (!SELECT_PRESENTATIONS.has(presentation)) {
      pushError(errors, "EXPERIENCE_INVALID_PRESENTATION", `Component ${component.id} invalid presentation`);
    }
    if (component.type === "multi_select") {
      const min = component.minSelections ?? 0;
      const max = component.maxSelections ?? options.length;
      if (min > max) {
        pushError(errors, "EXPERIENCE_INVALID_SELECTION_LIMITS", `Component ${component.id} min > max`);
      }
    }
  }

  if (component.type === "boolean") {
    const presentation = component.presentation || "checkbox";
    if (!BOOLEAN_PRESENTATIONS.has(presentation)) {
      pushError(errors, "EXPERIENCE_INVALID_PRESENTATION", `Component ${component.id} invalid boolean presentation`);
    }
  }
}

function validateComponent(component, errors, componentIds) {
  if (!isPlainObject(component)) {
    pushError(errors, "EXPERIENCE_INVALID_COMPONENT", "Component must be an object");
    return;
  }

  const id = typeof component.id === "string" ? component.id.trim() : "";
  const type = typeof component.type === "string" ? component.type.trim() : "";

  if (!id) pushError(errors, "EXPERIENCE_MISSING_COMPONENT_ID", "Component id is required");
  if (!type) pushError(errors, "EXPERIENCE_MISSING_COMPONENT_TYPE", "Component type is required");

  if (id && componentIds.has(id)) {
    pushError(errors, "EXPERIENCE_DUPLICATE_COMPONENT_ID", `Duplicate component id: ${id}`);
  }
  if (id) componentIds.add(id);

  if (type && !PHASE_1_COMPONENT_TYPES.has(type)) {
    pushError(errors, "EXPERIENCE_UNSUPPORTED_COMPONENT", `Unsupported component type: ${type}`);
    return;
  }

  if (type === "text_block") {
    const variant = component.variant || "paragraph";
    if (!TEXT_BLOCK_VARIANTS.has(variant)) {
      pushError(errors, "EXPERIENCE_INVALID_VARIANT", `Component ${id} invalid text_block variant`);
    }
    const content = typeof component.content === "string" ? component.content : "";
    if (!content.trim()) {
      pushError(errors, "EXPERIENCE_MISSING_CONTENT", `Component ${id} missing content`);
    }
    if (content.length > EXPERIENCE_LIMITS.maxContentLength) {
      pushError(errors, "EXPERIENCE_CONTENT_TOO_LONG", `Component ${id} content too long`);
    }
  }

  if (type === "callout") {
    const variant = component.variant || "info";
    if (!CALLOUT_VARIANTS.has(variant)) {
      pushError(errors, "EXPERIENCE_INVALID_VARIANT", `Component ${id} invalid callout variant`);
    }
    const content = typeof component.content === "string" ? component.content : "";
    if (!content.trim()) {
      pushError(errors, "EXPERIENCE_MISSING_CONTENT", `Component ${id} missing callout content`);
    }
  }

  if (
    type === "short_text" ||
    type === "long_text" ||
    type === "number" ||
    type === "boolean" ||
    type === "single_select" ||
    type === "multi_select" ||
    type === "confirmation"
  ) {
    validateInputComponent(component, errors);
  }
}

function normalizeComponent(component) {
  const normalized = { ...component };
  if (normalized.type === "boolean" && !normalized.presentation) {
    normalized.presentation = "checkbox";
  }
  if (
    (normalized.type === "single_select" || normalized.type === "multi_select") &&
    !normalized.presentation
  ) {
    normalized.presentation = "list";
  }
  if (normalized.type === "multi_select") {
    normalized.minSelections = normalized.minSelections ?? 0;
    normalized.maxSelections =
      normalized.maxSelections ?? (Array.isArray(normalized.options) ? normalized.options.length : 1);
  }
  if (normalized.required == null) {
    normalized.required = false;
  }
  return normalized;
}

function normalizeSection(section) {
  return {
    id: section.id,
    title: section.title ?? null,
    description: section.description ?? null,
    components: (section.components || []).map(normalizeComponent),
  };
}

export function validateExperienceSchema(experience) {
  const errors = [];

  if (!isPlainObject(experience)) {
    return { valid: false, normalized: null, errors: [{ code: "EXPERIENCE_SCHEMA_INVALID", message: "Not an object" }] };
  }

  const experienceId = typeof experience.experienceId === "string" ? experience.experienceId.trim() : "";
  if (!experienceId) {
    pushError(errors, "EXPERIENCE_MISSING_ID", "experienceId is required");
  }

  if (experience.experienceVersion !== AI_EXPERIENCE_VERSION) {
    pushError(errors, "EXPERIENCE_VERSION_MISMATCH", "experienceVersion must be 1");
  }

  if (!isPlainObject(experience.metadata)) {
    pushError(errors, "EXPERIENCE_MISSING_METADATA", "metadata is required");
  } else {
    const title = typeof experience.metadata.title === "string" ? experience.metadata.title.trim() : "";
    if (!title) pushError(errors, "EXPERIENCE_MISSING_TITLE", "metadata.title is required");
  }

  const sections = Array.isArray(experience.sections) ? experience.sections : [];
  if (sections.length < 1) {
    pushError(errors, "EXPERIENCE_MISSING_SECTIONS", "At least one section is required");
  }
  if (sections.length > EXPERIENCE_LIMITS.maxSections) {
    pushError(errors, "EXPERIENCE_SECTION_LIMIT_EXCEEDED", "Too many sections");
  }

  const sectionIds = new Set();
  const componentIds = new Set();

  for (const section of sections) {
    if (!isPlainObject(section)) {
      pushError(errors, "EXPERIENCE_INVALID_SECTION", "Section must be an object");
      continue;
    }
    const sectionId = typeof section.id === "string" ? section.id.trim() : "";
    if (!sectionId) pushError(errors, "EXPERIENCE_MISSING_SECTION_ID", "Section id required");
    if (sectionId && sectionIds.has(sectionId)) {
      pushError(errors, "EXPERIENCE_DUPLICATE_SECTION_ID", `Duplicate section id: ${sectionId}`);
    }
    if (sectionId) sectionIds.add(sectionId);

    for (const component of section.components || []) {
      validateComponent(component, errors, componentIds);
    }
  }

  const totalComponents = countExperienceComponents(experience);
  if (totalComponents > EXPERIENCE_LIMITS.maxComponentsTotal) {
    pushError(errors, "EXPERIENCE_COMPONENT_LIMIT_EXCEEDED", "Too many components");
  }

  if (!isPlainObject(experience.actions?.primary)) {
    pushError(errors, "EXPERIENCE_MISSING_PRIMARY_ACTION", "actions.primary is required");
  }

  if (!isPlainObject(experience.resultDefinition)) {
    pushError(errors, "EXPERIENCE_MISSING_RESULT_DEFINITION", "resultDefinition is required");
  }

  if (!isPlainObject(experience.completionCriteria)) {
    pushError(errors, "EXPERIENCE_MISSING_COMPLETION_CRITERIA", "completionCriteria is required");
  }

  if (errors.length > 0) {
    return { valid: false, normalized: null, errors };
  }

  const normalized = {
    experienceId,
    experienceVersion: AI_EXPERIENCE_VERSION,
    metadata: {
      title: experience.metadata.title.trim(),
      description: typeof experience.metadata.description === "string" ? experience.metadata.description.trim() : "",
      whyItMatters: typeof experience.metadata.whyItMatters === "string" ? experience.metadata.whyItMatters.trim() : "",
      expectedOutcome:
        typeof experience.metadata.expectedOutcome === "string" ? experience.metadata.expectedOutcome.trim() : "",
    },
    sections: sections.map(normalizeSection),
    actions: {
      primary: {
        id: experience.actions.primary.id || "submit",
        type: experience.actions.primary.type || "submit",
        label: experience.actions.primary.label || "Continuă",
      },
      secondary: Array.isArray(experience.actions.secondary) ? experience.actions.secondary : [],
    },
    resultDefinition: { ...experience.resultDefinition },
    completionCriteria: { ...experience.completionCriteria },
  };

  return { valid: true, normalized, errors: [] };
}

export function getExperienceFromPreparedInput(preparedInput) {
  if (!preparedInput || typeof preparedInput !== "object") return null;
  return preparedInput._experience || null;
}

export function withExperience(preparedInput = {}, experience) {
  const base = preparedInput && typeof preparedInput === "object" ? { ...preparedInput } : {};
  return {
    ...base,
    _experience: experience,
  };
}
