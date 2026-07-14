import { EXPERIENCE_LIMITS } from "./ai-experience-schema.js";
import { validateExperienceSchema } from "./ai-experience-validation.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toTrimmedString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function findComponentById(experience, componentId) {
  for (const section of experience?.sections || []) {
    for (const component of section.components || []) {
      if (component.id === componentId) return component;
    }
  }
  return null;
}

function listInputComponents(experience) {
  const inputs = [];
  for (const section of experience?.sections || []) {
    for (const component of section.components || []) {
      if (
        component.type === "short_text" ||
        component.type === "long_text" ||
        component.type === "number" ||
        component.type === "boolean" ||
        component.type === "single_select" ||
        component.type === "multi_select" ||
        component.type === "confirmation"
      ) {
        inputs.push(component);
      }
    }
  }
  return inputs;
}

function normalizeComponentValue(component, rawValue) {
  if (component.type === "short_text" || component.type === "long_text") {
    return toTrimmedString(rawValue);
  }

  if (component.type === "number") {
    if (rawValue == null || rawValue === "") return null;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (component.type === "boolean") {
    if (typeof rawValue === "boolean") return rawValue;
    if (rawValue === "true" || rawValue === 1 || rawValue === "1") return true;
    if (rawValue === "false" || rawValue === 0 || rawValue === "0") return false;
    return null;
  }

  if (component.type === "single_select") {
    return toTrimmedString(rawValue);
  }

  if (component.type === "multi_select") {
    if (!Array.isArray(rawValue)) return [];
    return rawValue.map((item) => toTrimmedString(item)).filter(Boolean);
  }

  if (component.type === "confirmation") {
    if (isPlainObject(rawValue)) {
      return { confirmed: rawValue.confirmed === true };
    }
    if (rawValue === true) return { confirmed: true };
    return { confirmed: false };
  }

  return rawValue;
}

function validateComponentValue(component, value, errors) {
  const prefix = component.id;

  if (component.required) {
    if (component.type === "confirmation") {
      if (!value || value.confirmed !== true) {
        errors.push({ code: "EXPERIENCE_CONFIRMATION_REQUIRED", componentId: prefix });
      }
      return;
    }
    if (component.type === "multi_select") {
      if (!Array.isArray(value) || value.length < (component.minSelections ?? 1)) {
        errors.push({ code: "EXPERIENCE_REQUIRED_MULTI_SELECT", componentId: prefix });
      }
      return;
    }
    if (component.type === "boolean") {
      if (value !== true) {
        errors.push({ code: "EXPERIENCE_REQUIRED_BOOLEAN", componentId: prefix });
      }
      return;
    }
    if (component.type === "number") {
      if (value == null || !Number.isFinite(value)) {
        errors.push({ code: "EXPERIENCE_REQUIRED_NUMBER", componentId: prefix });
        return;
      }
    } else if (value == null || toTrimmedString(value) === "") {
      errors.push({ code: "EXPERIENCE_REQUIRED_VALUE", componentId: prefix });
    }
  }

  if (component.type === "short_text" || component.type === "long_text") {
    const text = toTrimmedString(value);
    if (!text) return;
    const minLength = component.validation?.minLength;
    const maxLength = component.validation?.maxLength ?? EXPERIENCE_LIMITS.maxTextValueLength;
    if (minLength != null && text.length < minLength) {
      errors.push({ code: "EXPERIENCE_TEXT_TOO_SHORT", componentId: prefix });
    }
    if (maxLength != null && text.length > maxLength) {
      errors.push({ code: "EXPERIENCE_TEXT_TOO_LONG", componentId: prefix });
    }
  }

  if (component.type === "number" && value != null) {
    const min = component.validation?.min;
    const max = component.validation?.max;
    if (min != null && value < min) {
      errors.push({ code: "EXPERIENCE_NUMBER_BELOW_MIN", componentId: prefix });
    }
    if (max != null && value > max) {
      errors.push({ code: "EXPERIENCE_NUMBER_ABOVE_MAX", componentId: prefix });
    }
  }

  if (component.type === "single_select" && value) {
    const optionIds = new Set((component.options || []).map((option) => option.id));
    if (!optionIds.has(value)) {
      errors.push({ code: "EXPERIENCE_INVALID_OPTION", componentId: prefix });
    }
  }

  if (component.type === "multi_select" && Array.isArray(value)) {
    const optionIds = new Set((component.options || []).map((option) => option.id));
    for (const selected of value) {
      if (!optionIds.has(selected)) {
        errors.push({ code: "EXPERIENCE_INVALID_OPTION", componentId: prefix });
      }
    }
    const min = component.minSelections ?? 0;
    const max = component.maxSelections ?? optionIds.size;
    if (value.length < min || value.length > max) {
      errors.push({ code: "EXPERIENCE_SELECTION_LIMIT", componentId: prefix });
    }
  }
}

export function mergeExperienceValues(existing = {}, incoming = {}, experience) {
  const merged = { ...(existing || {}) };
  const inputs = listInputComponents(experience);

  for (const component of inputs) {
    if (!Object.prototype.hasOwnProperty.call(incoming, component.id)) {
      continue;
    }
    merged[component.id] = normalizeComponentValue(component, incoming[component.id]);
  }

  return merged;
}

export function normalizeExperienceValues(experience, rawValues = {}) {
  const values = {};
  const inputs = listInputComponents(experience);

  for (const component of inputs) {
    if (Object.prototype.hasOwnProperty.call(rawValues, component.id)) {
      values[component.id] = normalizeComponentValue(component, rawValues[component.id]);
    } else if (component.defaultValue != null) {
      values[component.id] = normalizeComponentValue(component, component.defaultValue);
    }
  }

  return values;
}

export function validateExperienceValues(experience, values = {}, { strict = false } = {}) {
  const errors = [];
  const inputs = listInputComponents(experience);

  for (const component of inputs) {
    const value = values[component.id];
    if (strict || component.required || value != null) {
      validateComponentValue(component, value, errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function normalizeExperienceProgress(progress = {}, experience) {
  const source = isPlainObject(progress) ? progress : {};
  const values = normalizeExperienceValues(experience, source.values || {});

  return {
    type: "experience",
    experienceId: experience.experienceId,
    experienceVersion: experience.experienceVersion,
    values,
    navigation: {
      currentSectionId:
        typeof source.navigation?.currentSectionId === "string"
          ? source.navigation.currentSectionId
          : null,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeExperienceSubmit(submit = {}, experience) {
  const source = isPlainObject(submit) ? submit : {};
  const values = normalizeExperienceValues(experience, source.values || {});

  return {
    type: "experience",
    contractId: toTrimmedString(source.contractId) || null,
    experienceId: experience.experienceId,
    experienceVersion: experience.experienceVersion,
    values,
    idempotencyKey: toTrimmedString(source.idempotencyKey) || null,
  };
}

export function experienceValuesToLegacyFormValues(experience, values = {}) {
  const legacy = {};
  for (const component of listInputComponents(experience)) {
    const value = values[component.id];
    if (value == null) continue;

    if (component.type === "confirmation") {
      continue;
    }
    if (component.type === "multi_select") {
      legacy[component.id] = Array.isArray(value) ? value.join(", ") : "";
      continue;
    }
    if (component.type === "boolean") {
      legacy[component.id] = value === true ? "true" : "false";
      continue;
    }
    legacy[component.id] = String(value);
  }
  return legacy;
}

export function validateExperienceProgressRequest(progress, experience) {
  if (!isPlainObject(progress)) {
    return { ok: false, code: "EXPERIENCE_PROGRESS_INVALID" };
  }
  if (progress.type !== "experience") {
    return { ok: false, code: "EXPERIENCE_PROGRESS_INVALID_TYPE" };
  }
  if (progress.experienceId !== experience.experienceId) {
    return { ok: false, code: "EXPERIENCE_ID_MISMATCH" };
  }
  if (progress.experienceVersion !== experience.experienceVersion) {
    return { ok: false, code: "EXPERIENCE_VERSION_MISMATCH" };
  }
  if (!isPlainObject(progress.values)) {
    return { ok: false, code: "EXPERIENCE_VALUES_INVALID" };
  }
  return { ok: true };
}

export function validateExperienceContract(experience) {
  return validateExperienceSchema(experience);
}

export { findComponentById, listInputComponents, normalizeComponentValue };
