import {
  PROJECT_CATEGORY_SLUGS,
  PROJECT_FIELD_LIMITS,
} from "./constants.js";

export const PROJECT_INTENT_LIMITS = {
  minGoalLength: 8,
  maxGoalLength: PROJECT_FIELD_LIMITS.goal,
  maxOptionalNameLength: PROJECT_FIELD_LIMITS.name,
  maxClarificationAnswers: 6,
  maxClarificationAnswerLength: 500,
  maxQuestions: 2,
};

const ALLOWED_REQUEST_KEYS = new Set([
  "goal",
  "optionalName",
  "clarificationAnswers",
]);

function trimString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function validateIntentAnalysisInput(body) {
  const input = body && typeof body === "object" ? body : {};
  const fields = {};

  for (const key of Object.keys(input)) {
    if (!ALLOWED_REQUEST_KEYS.has(key)) {
      fields[key] = "Câmp necunoscut.";
    }
  }

  const goal = trimString(input.goal);
  if (!goal) {
    fields.goal = "Obiectivul este obligatoriu.";
  } else if (goal.length < PROJECT_INTENT_LIMITS.minGoalLength) {
    fields.goal = "Obiectivul este prea scurt. Descrie puțin mai concret ce vrei să realizezi.";
  } else if (goal.length > PROJECT_INTENT_LIMITS.maxGoalLength) {
    fields.goal = `Obiectivul poate avea maximum ${PROJECT_INTENT_LIMITS.maxGoalLength} caractere.`;
  }

  const optionalName = trimString(input.optionalName);
  if (optionalName.length > PROJECT_INTENT_LIMITS.maxOptionalNameLength) {
    fields.optionalName = `Numele poate avea maximum ${PROJECT_INTENT_LIMITS.maxOptionalNameLength} caractere.`;
  }

  let clarificationAnswers = [];
  if (input.clarificationAnswers !== undefined) {
    if (!Array.isArray(input.clarificationAnswers)) {
      fields.clarificationAnswers = "Răspunsurile de clarificare trebuie să fie o listă.";
    } else if (input.clarificationAnswers.length > PROJECT_INTENT_LIMITS.maxClarificationAnswers) {
      fields.clarificationAnswers = "Prea multe răspunsuri de clarificare.";
    } else {
      clarificationAnswers = input.clarificationAnswers
        .map((item, index) => {
          if (!item || typeof item !== "object") {
            fields[`clarificationAnswers[${index}]`] = "Răspuns invalid.";
            return null;
          }

          const questionId = trimString(item.questionId);
          const answer = trimString(item.answer);
          if (!questionId || !answer) {
            fields[`clarificationAnswers[${index}]`] = "Răspunsul de clarificare este incomplet.";
            return null;
          }
          if (answer.length > PROJECT_INTENT_LIMITS.maxClarificationAnswerLength) {
            fields[`clarificationAnswers[${index}]`] = "Răspunsul este prea lung.";
            return null;
          }

          return { questionId, answer };
        })
        .filter(Boolean);
    }
  }

  if (Object.keys(fields).length > 0) {
    return { valid: false, fields };
  }

  return {
    valid: true,
    value: {
      goal,
      optionalName: optionalName || undefined,
      clarificationAnswers,
    },
  };
}

export function isValidIntentCategorySlug(value) {
  return typeof value === "string" && PROJECT_CATEGORY_SLUGS.includes(value.trim());
}

export function sanitizeIntentQuestions(questions) {
  if (!Array.isArray(questions)) {
    return [];
  }

  const seen = new Set();
  const sanitized = [];

  for (const item of questions) {
    if (!item || typeof item !== "object" || sanitized.length >= PROJECT_INTENT_LIMITS.maxQuestions) {
      continue;
    }

    const id = trimString(item.id);
    const question = trimString(item.question);
    const type = item.type;
    if (!id || !question || seen.has(id)) {
      continue;
    }
    if (type !== "text" && type !== "single_choice") {
      continue;
    }

    const parsed = { id, question, type };
    if (type === "single_choice" && Array.isArray(item.options)) {
      const options = item.options
        .map((option, index) => {
          if (!option || typeof option !== "object") {
            return null;
          }
          const optionId = trimString(option.id) || `${id}-opt-${index + 1}`;
          const label = trimString(option.label);
          const value = trimString(option.value);
          if (!label || !value) {
            return null;
          }
          return { id: optionId, label, value };
        })
        .filter(Boolean);

      if (options.length > 0) {
        parsed.options = options;
      } else {
        parsed.type = "text";
      }
    }

    seen.add(id);
    sanitized.push(parsed);
  }

  return sanitized;
}
