import {
  PROJECT_CATEGORY_SLUGS,
  PROJECT_FIELD_LIMITS,
  PROJECT_FALLBACK_NAME,
  PROJECT_EDITABLE_FIELDS,
  PROJECT_STATUSES,
  PROJECT_SORT_COLUMNS,
  PROJECT_DEFAULT_LIMIT,
  PROJECT_MAX_LIMIT,
} from "./constants.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

export function isValidCategorySlug(value) {
  return typeof value === "string" && PROJECT_CATEGORY_SLUGS.includes(value.trim());
}

function trimString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

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
  text = text.charAt(0).toUpperCase() + text.slice(1);

  const limit = PROJECT_FIELD_LIMITS.name;
  if (text.length > limit) {
    const truncated = text.slice(0, limit);
    const lastSpace = truncated.lastIndexOf(" ");
    text = (lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated).trim();
  }

  return text || PROJECT_FALLBACK_NAME;
}

export function validateCreateInput(body) {
  const input = body && typeof body === "object" ? body : {};
  const fields = {};
  const value = {};

  const goal = trimString(input.goal);
  if (!goal) {
    fields.goal = "Obiectivul este obligatoriu.";
  } else if (goal.length > PROJECT_FIELD_LIMITS.goal) {
    fields.goal = `Obiectivul poate avea maximum ${PROJECT_FIELD_LIMITS.goal} caractere.`;
  } else {
    value.goal = goal;
  }

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

  const description = trimString(input.description);
  if (description.length > PROJECT_FIELD_LIMITS.description) {
    fields.description = `Descrierea poate avea maximum ${PROJECT_FIELD_LIMITS.description} caractere.`;
  } else {
    value.description = description || null;
  }

  const summary = trimString(input.summary);
  if (summary.length > PROJECT_FIELD_LIMITS.summary) {
    fields.summary = `Rezumatul poate avea maximum ${PROJECT_FIELD_LIMITS.summary} caractere.`;
  } else {
    value.summary = summary || null;
  }

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

  const iconKey = trimString(input.iconKey);
  if (iconKey.length > PROJECT_FIELD_LIMITS.iconKey) {
    fields.iconKey = "iconKey este prea lung.";
  } else {
    value.iconKey = iconKey || null;
  }

  const accentKey = trimString(input.accentKey);
  if (accentKey.length > PROJECT_FIELD_LIMITS.accentKey) {
    fields.accentKey = "accentKey este prea lung.";
  } else if (accentKey && /^#|rgb|hsl/i.test(accentKey)) {
    fields.accentKey = "accentKey trebuie să fie o cheie de token, nu o culoare.";
  } else {
    value.accentKey = accentKey || null;
  }

  return { valid: Object.keys(fields).length === 0, value, fields };
}

export function validateUpdateInput(body) {
  const input = body && typeof body === "object" ? body : {};
  const fields = {};
  const value = {};

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

  if (input.description !== undefined) {
    const description = trimString(input.description);
    if (description.length > PROJECT_FIELD_LIMITS.description) {
      fields.description = `Descrierea poate avea maximum ${PROJECT_FIELD_LIMITS.description} caractere.`;
    } else {
      value.description = description || null;
    }
  }

  if (input.summary !== undefined) {
    const summary = trimString(input.summary);
    if (summary.length > PROJECT_FIELD_LIMITS.summary) {
      fields.summary = `Rezumatul poate avea maximum ${PROJECT_FIELD_LIMITS.summary} caractere.`;
    } else {
      value.summary = summary || null;
    }
  }

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

  if (input.iconKey !== undefined) {
    const iconKey = trimString(input.iconKey);
    if (iconKey.length > PROJECT_FIELD_LIMITS.iconKey) {
      fields.iconKey = "iconKey este prea lung.";
    } else {
      value.iconKey = iconKey || null;
    }
  }

  if (input.accentKey !== undefined) {
    const accentKey = trimString(input.accentKey);
    if (accentKey.length > PROJECT_FIELD_LIMITS.accentKey) {
      fields.accentKey = "accentKey este prea lung.";
    } else if (accentKey && /^#|rgb|hsl/i.test(accentKey)) {
      fields.accentKey = "accentKey trebuie să fie o cheie de token, nu o culoare.";
    } else {
      value.accentKey = accentKey || null;
    }
  }

  return {
    valid: Object.keys(fields).length === 0,
    value,
    fields,
    hasUpdates: Object.keys(value).length > 0,
  };
}

export function validateListInput(body) {
  const input = body && typeof body === "object" ? body : {};
  const fields = {};
  const value = {
    includeArchived: input.includeArchived === true,
    direction: input.direction === "asc" ? "asc" : "desc",
  };

  if (input.categorySlug !== undefined && input.categorySlug !== null && input.categorySlug !== "") {
    const categorySlug = trimString(input.categorySlug);
    if (!isValidCategorySlug(categorySlug)) {
      fields.categorySlug = "Categorie invalidă.";
    } else {
      value.categorySlug = categorySlug;
    }
  }

  if (input.statuses !== undefined) {
    if (!Array.isArray(input.statuses)) {
      fields.statuses = "Statusurile trebuie să fie o listă.";
    } else if (input.statuses.some((status) => !PROJECT_STATUSES.includes(status))) {
      fields.statuses = "Status invalid.";
    } else {
      value.statuses = input.statuses;
    }
  } else {
    value.statuses = [];
  }

  if (input.sort !== undefined) {
    const sort = trimString(input.sort);
    if (!PROJECT_SORT_COLUMNS[sort]) {
      fields.sort = "Sortare invalidă.";
    } else {
      value.sort = sort;
    }
  }

  if (input.search !== undefined) {
    const search = trimString(input.search);
    if (search.length > PROJECT_FIELD_LIMITS.search) {
      fields.search = `Căutarea poate avea maximum ${PROJECT_FIELD_LIMITS.search} caractere.`;
    } else {
      value.search = search;
    }
  } else {
    value.search = "";
  }

  if (input.limit !== undefined) {
    const limit = Number.parseInt(input.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0 || limit > PROJECT_MAX_LIMIT) {
      fields.limit = `Limita trebuie să fie între 1 și ${PROJECT_MAX_LIMIT}.`;
    } else {
      value.limit = limit;
    }
  } else {
    value.limit = PROJECT_DEFAULT_LIMIT;
  }

  if (input.cursor !== undefined && input.cursor !== null && input.cursor !== "") {
    const cursor = String(input.cursor);
    const offset = Number.parseInt(cursor, 10);
    if (!Number.isFinite(offset) || offset < 0) {
      fields.cursor = "Cursor invalid.";
    } else {
      value.cursor = cursor;
    }
  } else {
    value.cursor = "0";
  }

  return {
    valid: Object.keys(fields).length === 0,
    value,
    fields,
  };
}

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
