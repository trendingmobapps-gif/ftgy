const TYPE_PLACEHOLDERS = {
  short_text: "Scrie răspunsul tău",
  long_text: "Descrie pe scurt",
  text: "Scrie răspunsul tău",
  textarea: "Descrie pe scurt",
  number: "Introdu o valoare",
  date: "Selectează data",
  single_choice: "Alege o opțiune",
  multiple_choice: "Alege una sau mai multe opțiuni",
  scale: "Alege valoarea",
};

function normalizeText(value, max = 4000) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function normalizeComparable(value) {
  return normalizeText(value, 2000)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isPlaceholderInvalid({ placeholder, prompt, recommendation }) {
  const candidate = normalizeText(placeholder, 120);
  if (!candidate) return true;
  if (candidate.length > 80) return true;

  const promptComparable = normalizeComparable(prompt);
  const candidateComparable = normalizeComparable(candidate);
  const recommendationComparable = normalizeComparable(recommendation);

  if (!promptComparable) return false;
  if (candidateComparable === promptComparable) return true;
  if (promptComparable.includes(candidateComparable) && candidateComparable.length >= promptComparable.length * 0.55) {
    return true;
  }
  if (candidateComparable.includes(promptComparable) && promptComparable.length >= candidateComparable.length * 0.55) {
    return true;
  }
  if (recommendationComparable && candidateComparable === recommendationComparable) return true;
  if (
    recommendationComparable &&
    candidateComparable.includes(recommendationComparable) &&
    recommendationComparable.length >= candidateComparable.length * 0.7
  ) {
    return true;
  }
  return false;
}

export function buildSafeGuidedPlaceholder(inputType = "short_text") {
  return TYPE_PLACEHOLDERS[inputType] || TYPE_PLACEHOLDERS.short_text;
}

export function normalizeGuidedQuestionPlaceholder({
  prompt,
  recommendation = "",
  placeholder = "",
  exampleAnswer = "",
  type = "short_text",
}) {
  if (!isPlaceholderInvalid({ placeholder, prompt, recommendation })) {
    return normalizeText(placeholder, 80);
  }

  const example = normalizeText(exampleAnswer, 80);
  if (!isPlaceholderInvalid({ placeholder: example, prompt, recommendation })) {
    return example.startsWith("Ex:") ? example : `Ex: ${example}`;
  }

  return buildSafeGuidedPlaceholder(type);
}

export function mapGuidedQuestionInputType(type) {
  switch (type) {
    case "long_text":
      return "textarea";
    case "short_text":
      return "text";
    case "multiple_choice":
      return "multi_choice";
    case "single_choice":
      return "single_choice";
    case "number":
    case "date":
    case "scale":
      return type;
    default:
      return "text";
  }
}

export function serializeGuidedQuestionForClient(question) {
  const label = normalizeText(question?.label || question?.prompt, 500);
  const recommendation = normalizeText(question?.recommendation, 500);
  const description = normalizeText(question?.description, 500);
  const inputType = mapGuidedQuestionInputType(question?.type || question?.inputType || "short_text");
  const placeholder = normalizeGuidedQuestionPlaceholder({
    prompt: label,
    recommendation,
    placeholder: question?.placeholder,
    exampleAnswer: question?.exampleAnswer,
    type: question?.type || question?.inputType || "short_text",
  });

  return {
    id: question.id,
    label,
    prompt: label,
    description: description || null,
    recommendation: recommendation || null,
    placeholder,
    exampleAnswer: normalizeText(question?.exampleAnswer, 80) || null,
    inputType,
    type: question?.type || "short_text",
    required: question?.required !== false,
    options: (question?.options || []).map((option) => ({
      id: option.id,
      label: option.label,
      description: normalizeText(option?.description, 240) || null,
      value: option.value,
    })),
  };
}

export function validateGuidedAnswersPayload(answers = {}, plan) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { valid: false, reason: "missing_guided_answers" };
  }

  const questions = Array.isArray(plan?.questions) ? plan.questions : [];
  const required = questions.filter((question) => question?.required !== false);
  const missing = required.filter((question) => !normalizeText(answers[question.id], 4000));

  if (missing.length > 0) {
    return { valid: false, reason: "missing_required_guided_answers", missingIds: missing.map((q) => q.id) };
  }

  return { valid: true, reason: null, count: Object.keys(answers).length };
}

export function buildGuidedAnswersAcceptedInput(guidedAnswers = {}) {
  return {
    mode: "guided_questions",
    guidedAnswers: { ...guidedAnswers },
    interactive: {
      type: "guided_questions",
      guidedAnswers: { ...guidedAnswers },
      answers: { ...guidedAnswers },
      completed: true,
    },
  };
}
