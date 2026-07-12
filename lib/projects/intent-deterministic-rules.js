import { deriveNameFromGoal } from "./validation.js";
import { attachResolvedIconsToReadyPayload } from "./icon-catalog.js";

const FITNESS_PATTERNS = [
  /\bsl[ăa]besc\b/i,
  /\bsl[ăa]bit\b/i,
  /\bpierd\s+\d+\s*kg\b/i,
  /\bpierdere\s+(?:în\s+)?greutate\b/i,
  /\bmas[ăa]\s+muscular[ăa]\b/i,
  /\bantrenament\b/i,
  /\balergare\b/i,
  /\bmaraton\b/i,
  /\bfitness\b/i,
  /\bsal[ăa]\b/i,
  /\b\d+\s*kg\b/i,
];

const BUSINESS_PATTERNS = [
  /\blansez\b.*\b(?:afacere|platform[ăa]|business|startup)\b/i,
  /\bdeschid\b.*\b(?:firm[ăa]|afacere|cafenea|restaurant|magazin|salon)\b/i,
  /\bplatform[ăa]\s+ai\b/i,
  /\bcresc\s+v[âa]nz[ăa]rile\b/i,
  /\bclien[tț]i\b/i,
  /\bmarketing\b.*\bafacere\b/i,
];

const STUDIES_PATTERNS = [
  /\b[îi]nv[ăa][țt]\b.*\b(?:examen|bac|facultate|lec[țt]ie)\b/i,
  /\bbac\b/i,
  /\bfacultate\b/i,
  /\bexam(en)?\b/i,
  /\bstudiu\b/i,
  /\blec[țt]ie\b/i,
];

const CAREER_PATTERNS = [
  /\bcv\b/i,
  /\bcurriculum\b/i,
  /\binterviu\b/i,
  /\bjob\b/i,
  /\bcarier[ăa]\b/i,
  /\bpromovare\s+profesional[ăa]\b/i,
];

const FINANCE_PATTERNS = [
  /\bbuget\b/i,
  /\beconomisesc\b/i,
  /\bdatorii\b/i,
  /\bcheltuieli\b/i,
  /\binvesti[țt]ii\b/i,
];

const VAGUE_DEVELOPMENT_PATTERNS = [
  /^vreau\s+s[ăa]\s+m[ăa]\s+dezvolt\.?$/i,
  /^vreau\s+s[ăa]\s+fac\s+o\s+schimbare\.?$/i,
  /^ajut[ăa]-m[ăa]\s+s[ăa]\s+progresez\.?$/i,
  /^vreau\s+s[ăa]\s+progresez\.?$/i,
  /^vreau\s+s[ăa]\s+reu[sș]esc\.?$/i,
];

const GENERIC_DEVELOPMENT_QUESTION_PATTERNS = [
  /direc[țt]ie.*dezvol/i,
  /domeniul\s+principal/i,
  /business.*studii.*carier/i,
];

const FITNESS_TOPIC_MARKERS = [
  /\bsl[ăa]b/i,
  /\bkg\b/i,
  /\bgreutate\b/i,
  /\bfitness\b/i,
  /\bantrenament\b/i,
  /\bmaraton\b/i,
  /\bmuscular/i,
];

const CATEGORY_OPTION_MARKERS = {
  fitness: [/\bfitness\b/i, /\bs[ăa]n[ăa]tate\b/i, /\bgreutate\b/i, /\bsl[ăa]b/i],
  business: [/\bbusiness\b/i, /\bafacere\b/i],
  studii: [/\bstudii\b/i],
  cariera: [/\bcarier[ăa]\b/i],
  finante: [/\bfinan[țt]e\b/i],
  viataPersonala: [/\bvia[țt][ăa]\s+personal[ăa]\b/i],
};

function normalizeGoalText(goal) {
  return typeof goal === "string" ? goal.trim() : "";
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function detectDeterministicCategory(goal) {
  const text = normalizeGoalText(goal);
  if (!text) {
    return null;
  }

  if (matchesAny(text, FITNESS_PATTERNS)) return "fitness";
  if (matchesAny(text, BUSINESS_PATTERNS)) return "business";
  if (matchesAny(text, STUDIES_PATTERNS)) return "studii";
  if (matchesAny(text, CAREER_PATTERNS)) return "cariera";
  if (matchesAny(text, FINANCE_PATTERNS)) return "finante";

  return null;
}

export function isObviouslyClearGoal(goal) {
  return Boolean(detectDeterministicCategory(goal));
}

export function isObviouslyVagueDevelopmentGoal(goal) {
  const text = normalizeGoalText(goal);
  return matchesAny(text, VAGUE_DEVELOPMENT_PATTERNS);
}

export function buildDeterministicReadyResult(goal, input = {}) {
  const categorySlug = detectDeterministicCategory(goal);
  if (!categorySlug) {
    return null;
  }

  return attachResolvedIconsToReadyPayload(
    {
      status: "ready",
      categorySlug,
      confidence: 0.95,
      suggestedName:
        (input.optionalName && input.optionalName.trim()) || deriveNameFromGoal(goal),
      normalizedGoal: goal.trim(),
      recommendedToolId: null,
      recommendationReason: null,
    },
    input,
  );
}

function questionText(question) {
  return typeof question?.question === "string" ? question.question.trim() : "";
}

function optionLabels(question) {
  if (!Array.isArray(question?.options)) {
    return [];
  }

  return question.options
    .map((option) => (typeof option?.label === "string" ? option.label.trim() : ""))
    .filter(Boolean);
}

export function isGenericDevelopmentClarificationQuestion(question) {
  const text = questionText(question);
  return GENERIC_DEVELOPMENT_QUESTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isClarificationCompatibleWithGoal(goal, questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return false;
  }

  const text = normalizeGoalText(goal);
  const deterministicCategory = detectDeterministicCategory(goal);

  if (deterministicCategory) {
    return false;
  }

  const isFitnessTopic = matchesAny(text, FITNESS_TOPIC_MARKERS);

  for (const question of questions) {
    if (isFitnessTopic && isGenericDevelopmentClarificationQuestion(question)) {
      return false;
    }

    if (isFitnessTopic) {
      const labels = optionLabels(question).join(" ").toLowerCase();
      const hasFitnessOption = CATEGORY_OPTION_MARKERS.fitness.some((pattern) => pattern.test(labels));
      const onlyGenericCareerOptions =
        /\bcarier[ăa]\b/i.test(labels) &&
        /\bbusiness\b/i.test(labels) &&
        /\bstudii\b/i.test(labels) &&
        !hasFitnessOption;

      if (onlyGenericCareerOptions) {
        return false;
      }
    }
  }

  return true;
}

export function buildVagueDevelopmentClarification() {
  return {
    status: "needs_clarification",
    message: "Am nevoie de un singur detaliu în plus",
    questions: [
      {
        id: "goal-focus",
        question: "În ce zonă vrei să progresezi?",
        type: "single_choice",
        options: [
          { id: "cariera", label: "Carieră", value: "cariera" },
          { id: "business", label: "Afacere", value: "business" },
          { id: "studii", label: "Studii", value: "studii" },
          { id: "fitness", label: "Sănătate și fitness", value: "fitness" },
          { id: "viataPersonala", label: "Viață personală", value: "viataPersonala" },
        ],
      },
    ],
  };
}

export function applyDeterministicIntentRules(input) {
  if (hasClarificationAnswers(input)) {
    return null;
  }

  const ready = buildDeterministicReadyResult(input.goal, input);
  if (ready) {
    return ready;
  }

  if (isObviouslyVagueDevelopmentGoal(input.goal)) {
    return buildVagueDevelopmentClarification();
  }

  return null;
}

function hasClarificationAnswers(input) {
  return Array.isArray(input?.clarificationAnswers) && input.clarificationAnswers.length > 0;
}

export function validateClarificationQuestionsForGoal(goal, questions) {
  const sanitized = Array.isArray(questions) ? questions : [];

  if (isObviouslyClearGoal(goal)) {
    return { ok: false, reason: "clear_goal_should_not_clarify" };
  }

  if (!isClarificationCompatibleWithGoal(goal, sanitized)) {
    return { ok: false, reason: "incompatible_clarification" };
  }

  return { ok: true, questions: sanitized };
}
