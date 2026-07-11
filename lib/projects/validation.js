// Shared validation layer for the Projects backend. Pure functions with no I/O
// so they are trivially unit-testable and reused by every endpoint. All
// user-facing messages are safe Romanian strings (no internal details).

import {
  PROJECT_CATEGORY_SLUGS,
  PROJECT_FIELD_LIMITS,
  PROJECT_FALLBACK_NAME,
  PROJECT_EDITABLE_FIELDS,
} from "./constants.js";

// Strict RFC-4122-ish UUID check (accepts any version, requires canonical form).
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

export function isValidCategorySlug(value) {
  return (
    typeof value === "string" && PROJECT_CATEGORY_SLUGS.includes(value.trim())
  );
}

// Trims a string-ish value; returns "" for null/undefined/non-strings.
function trimString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// Derives a deterministic project name from a goal (no AI in Phase 1).
// Strips common Romanian opening phrases, capitalizes, and caps length.
export function deriveNameFromGoal(goal) {
  let text = trimString(goal);
  if (!text) return PROJECT_FALLBACK_NAME;

  const openingPhrases = [
    /^vreau să\s+/i,
    /^aș vrea să\s+/i,
    /^as vrea să\s+/i,
    /^doresc să\s+/i,
    /^am nevoie să\s+/i,
    /^am nevoie de\s+/i,
    /^ajută-mă să\s+/i,
    /^ajuta-ma să\s+/i,
  ];
  for (const phrase of openingPhrases) {
    text = text.replace(phrase, "");
  }

  text = text.replace(/\s+/g, " ").trim();
  if (!text) return PROJECT_FALLBACK_NAME;

  // Capitalize first letter.
  text = text.charAt(0).toUpperCase() + text.slice(1);

  // Cap to the name limit without cutting mid-word when avoidable.
  const limit = PROJECT_FIELD_LIMITS.name;
  if (text.length > limit) {
    const truncated = text.slice(0, limit);
    const lastSpace = truncated.lastIndexOf(" ");
    text = (lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated).trim();
  }

  return text || PROJECT_FALLBACK_NAME;
}

// Validates and normalizes create input.
// Returns { valid, value, fields } where `fields` maps field -> safe message.
export function validateCreateInput(body) {
  const input = body && typeof body === "object" ? body : {};
  const fields = {};
  const value = {};

  // Goal (required).
  const goal = trimString(input.goal);
  if (!goal) {
    fields.goal = "Obiectivul este obligatoriu.";
  } else if (goal.length > PROJECT_FIELD_LIMITS.goal) {
    fields.goal = `Obiectivul poate avea maximum ${PROJECT_FIELD_LIMITS.goal} caractere.`;
  } else {
    value.goal = goal;
  }

  // Name (optional on request; derived if missing; validated if present).
  const rawName = trimString(input.name);
  if (rawName) {
    if (rawName.length > PROJECT_FIELD_LIMITS.name) {
      fields.name = `Numele poate avea maximum ${PROJECT_FIELD_LIMITS.name} caractere.`;
    } else {
      value.name = rawName;
    }
  } else if (value.goal) {
    value.name = deriveNameFromGoal(value.goal);
  }

  // Description (optional; empty -> null).
  const description = trimString(input.description);
  if (description.length > PROJECT_FIELD_LIMITS.description) {
    fields.description = `Descrierea poate avea maximum ${PROJECT_FIELD_LIMITS.description} caractere.`;
  } else {
    value.description = description || null;
  }

  // Summary (optional; empty -> null).
  const summary = trimString(input.summary);
  if (summary.length > PROJECT_FIELD_LIMITS.summary) {
    fields.summary = `Rezumatul poate avea maximum ${PROJECT_FIELD_LIMITS.summary} caractere.`;
  } else {
    value.summary = summary || null;
  }

  // Category slug (optional; must be canonical).
  const categorySlug = trimString(input.categorySlug);
  if (categorySlug) {
    if (!isValidCategorySlug(categorySlug)) {
      fields.categorySlug = "Categorie invalidă.";
    } else {
      value.categorySlug = categorySlug;
    }
  } else {
    value.categorySlug = null;
  }

  // Icon key (optional; empty -> null).
  const iconKey = trimString(input.iconKey);
  if (iconKey.length > PROJECT_FIELD_LIMITS.iconKey) {
    fields.iconKey = `iconKey este prea lung.`;
  } else {
    value.iconKey = iconKey || null;
  }

  // Accent key (optional; empty -> null). Must be a token key, not a raw color.
  const accentKey = trimString(input.accentKey);
  if (accentKey.length > PROJECT_FIELD_LIMITS.accentKey) {
    fields.accentKey = `accentKey este prea lung.`;
  } else if (accentKey && /^#|rgb|hsl/i.test(accentKey)) {
    fields.accentKey = "accentKey trebuie să fie o cheie de token, nu o culoare.";
  } else {
    value.accentKey = accentKey || null;
  }

  return { valid: Object.keys(fields).length === 0, value, fields };
}

// Validates and normalizes update input. Only allowlisted fields are
// considered. Returns { valid, value, fields, hasUpdates }.
export function validateUpdateInput(body) {
  const input = body && typeof body === "object" ? body : {};
  const fields = {};
  const value = {};

  // name
  if (input.name !== undefined) {
    const name = trimString(input.name);
    if (!name) {
      fields.name = "Numele nu poate fi gol.";
    } else if (name.length > PROJECT_FIELD_LIMITS.name) {
      fields.name = `Numele poate avea maximum ${PROJECT_FIELD_LIMITS.name} caractere.`;
    } else {
      value.name = name;
    }
  }

  // goal
  if (input.goal !== undefined) {
    const goal = trimString(input.goal);
    if (!goal) {
      fields.goal = "Obiectivul nu poate fi gol.";
    } else if (goal.length > PROJECT_FIELD_LIMITS.goal) {
      fields.goal = `Obiectivul poate avea maximum ${PROJECT_FIELD_LIMITS.goal} caractere.`;
    } else {
      value.goal = goal;
    }
  }

  // description (empty -> null)
  if (input.description !== undefined) {
    const description = trimString(input.description);
    if (description.length > PROJECT_FIELD_LIMITS.description) {
      fields.description = `Descrierea poate avea maximum ${PROJECT_FIELD_LIMITS.description} caractere.`;
    } else {
      value.description = description || null;
    }
  }

  // summary (empty -> null)
  if (input.summary !== undefined) {
    const summary = trimString(input.summary);
    if (summary.length > PROJECT_FIELD_LIMITS.summary) {
      fields.summary = `Rezumatul poate avea maximum ${PROJECT_FIELD_LIMITS.summary} caractere.`;
    } else {
      value.summary = summary || null;
    }
  }

  // categorySlug
  if (input.categorySlug !== undefined) {
    const categorySlug = trimString(input.categorySlug);
    if (!categorySlug) {
      value.categorySlug = null;
    } else if (!isValidCategorySlug(categorySlug)) {
      fields.categorySlug = "Categorie invalidă.";
    } else {
      value.categorySlug = categorySlug;
    }
  }

  // iconKey (empty -> null)
  if (input.iconKey !== undefined) {
    const iconKey = trimString(input.iconKey);
    if (iconKey.length > PROJECT_FIELD_LIMITS.iconKey) {
      fields.iconKey = "iconKey este prea lung.";
    } else {
      value.iconKey = iconKey || null;
    }
  }

  // accentKey (empty -> null)
  if (input.accentKey !== undefined) {
    const accentKey = trimString(input.accentKey);
    if (accentKey.length > PROJECT_FIELD_LIMITS.accentKey) {
      fields.accentKey = "accentKey este prea lung.";
    } else if (accentKey && /^#|rgb|hsl/i.test(accentKey)) {
      fields.accentKey =
        "accentKey trebuie să fie o cheie de token, nu o culoare.";
    } else {
      value.accentKey = accentKey || null;
    }
  }

  const hasUpdates = Object.keys(value).length > 0;

  return {
    valid: Object.keys(fields).length === 0,
    value,
    fields,
    hasUpdates,
  };
}

// Maps a validated camelCase update value object to snake_case DB columns.
// Only editable fields are mapped.
export function mapUpdateValueToColumns(value) {
  const columns = {};
  if (!value || typeof value !== "object") return columns;
  const map = {
    name: "name",
    goal: "goal",
    description: "description",
    summary: "summary",
    categorySlug: "category_slug",
    iconKey: "icon_key",
    accentKey: "accent_key",
  };
  for (const field of PROJECT_EDITABLE_FIELDS) {
    if (value[field] !== undefined) {
      columns[map[field]] = value[field];
    }
  }
  return columns;
}
