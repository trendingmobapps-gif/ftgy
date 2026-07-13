import { randomUUID } from "node:crypto";

const ENGLISH_ASSESSMENT_QUESTIONS = [
  {
    id: "q1",
    type: "single_choice",
    prompt: "Alege varianta corectă pentru propoziția: „Eu merg la școală în fiecare zi.”",
    options: [
      { id: "q1_a", label: "I am go to school every day.", value: "q1_a" },
      { id: "q1_b", label: "I go to school every day.", value: "q1_b" },
      { id: "q1_c", label: "I goes to school every day.", value: "q1_c" },
      { id: "q1_d", label: "I went to school every day.", value: "q1_d" },
    ],
    correctOptionId: "q1_b",
    explanation: "Pentru acțiuni obișnuite se folosește prezentul simplu.",
    weight: 1,
  },
  {
    id: "q2",
    type: "single_choice",
    prompt: "Alege pluralul corect pentru „child”.",
    options: [
      { id: "q2_a", label: "childs", value: "q2_a" },
      { id: "q2_b", label: "children", value: "q2_b" },
      { id: "q2_c", label: "childes", value: "q2_c" },
      { id: "q2_d", label: "childrens", value: "q2_d" },
    ],
    correctOptionId: "q2_b",
    explanation: "Pluralul neregulat al lui child este children.",
    weight: 1,
  },
  {
    id: "q3",
    type: "single_choice",
    prompt: "Completează: „She ___ to the office yesterday.”",
    options: [
      { id: "q3_a", label: "go", value: "q3_a" },
      { id: "q3_b", label: "goes", value: "q3_b" },
      { id: "q3_c", label: "went", value: "q3_c" },
      { id: "q3_d", label: "going", value: "q3_d" },
    ],
    correctOptionId: "q3_c",
    explanation: "Yesterday cere timpul trecut.",
    weight: 1,
  },
  {
    id: "q4",
    type: "single_choice",
    prompt: "Care propoziție este corectă?",
    options: [
      { id: "q4_a", label: "He don't like coffee.", value: "q4_a" },
      { id: "q4_b", label: "He doesn't likes coffee.", value: "q4_b" },
      { id: "q4_c", label: "He doesn't like coffee.", value: "q4_c" },
      { id: "q4_d", label: "He not like coffee.", value: "q4_d" },
    ],
    correctOptionId: "q4_c",
    explanation: "La persoana a III-a singular se folosește doesn't + verb la forma de bază.",
    weight: 1,
  },
  {
    id: "q5",
    type: "single_choice",
    prompt: "Alege traducerea corectă pentru „Îmi place să citesc.”",
    options: [
      { id: "q5_a", label: "I like reading.", value: "q5_a" },
      { id: "q5_b", label: "I like to reading.", value: "q5_b" },
      { id: "q5_c", label: "I likes read.", value: "q5_c" },
      { id: "q5_d", label: "I am like read.", value: "q5_d" },
    ],
    correctOptionId: "q5_a",
    explanation: "Like poate fi urmat de gerunziu sau infinitiv cu to.",
    weight: 1,
  },
  {
    id: "q6",
    type: "single_choice",
    prompt: "Care este forma corectă?",
    options: [
      { id: "q6_a", label: "more better", value: "q6_a" },
      { id: "q6_b", label: "gooder", value: "q6_b" },
      { id: "q6_c", label: "better", value: "q6_c" },
      { id: "q6_d", label: "bestest", value: "q6_d" },
    ],
    correctOptionId: "q6_c",
    explanation: "Better este comparativul neregulat al lui good.",
    weight: 1,
  },
  {
    id: "q7",
    type: "short_text",
    prompt: "Scrie o propoziție scurtă în engleză despre ce faci în timpul liber.",
    required: true,
    rubric: "basic_sentence",
    weight: 1,
  },
  {
    id: "q8",
    type: "single_choice",
    prompt: "Alege varianta cea mai naturală:",
    options: [
      { id: "q8_a", label: "I have been living here since five years.", value: "q8_a" },
      { id: "q8_b", label: "I have been living here for five years.", value: "q8_b" },
      { id: "q8_c", label: "I am living here since five years.", value: "q8_c" },
      { id: "q8_d", label: "I live here since five years.", value: "q8_d" },
    ],
    correctOptionId: "q8_b",
    explanation: "For se folosește cu perioade de timp în present perfect continuous.",
    weight: 1,
  },
];

function normalizeHaystack(step, project) {
  return `${step?.title || ""} ${step?.description || ""} ${project?.goal || ""}`.toLowerCase();
}

export function isEnglishAssessmentStep(step, project) {
  const haystack = normalizeHaystack(step, project);
  return haystack.includes("englez") || haystack.includes("english") || haystack.includes("nivel");
}

export function buildAssessmentInternal({ step, project, assessmentId = null }) {
  const id = assessmentId || randomUUID();
  const title = step?.title || "Evaluare";
  const instructions =
    "Răspunde la fiecare întrebare. Nu vei vedea răspunsurile corecte până după finalizarea evaluării.";

  const questions = isEnglishAssessmentStep(step, project)
    ? ENGLISH_ASSESSMENT_QUESTIONS
    : ENGLISH_ASSESSMENT_QUESTIONS.slice(0, 6);

  return {
    assessmentId: id,
    type: "assessment",
    title,
    instructions,
    scoringStrategy: "rule_based",
    progressLabel: "Întrebarea",
    questions,
  };
}

export function serializeAssessmentPayload(internal) {
  if (!internal) return null;

  return {
    type: "assessment",
    assessmentId: internal.assessmentId,
    title: internal.title,
    instructions: internal.instructions,
    scoringStrategy: internal.scoringStrategy,
    progressLabel: internal.progressLabel || "Întrebarea",
    questions: (internal.questions || []).map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      required: question.required !== false,
      options: question.options?.map((option) => ({
        id: option.id,
        label: option.label,
        value: option.value,
      })),
    })),
  };
}

export function readInteractiveState(collectedInput = {}) {
  const interactive = collectedInput?.interactive;
  if (!interactive || interactive.type !== "assessment") {
    return {
      started: false,
      submitted: false,
      assessmentId: null,
      answers: {},
      currentQuestionIndex: 0,
    };
  }

  return {
    started: Boolean(interactive.started),
    submitted: Boolean(interactive.submitted),
    assessmentId: interactive.assessmentId || null,
    answers: interactive.answers || {},
    currentQuestionIndex: Number.isFinite(interactive.currentQuestionIndex)
      ? interactive.currentQuestionIndex
      : 0,
  };
}

export function buildInteractiveCollectedInput(current = {}, patch = {}) {
  const existing = readInteractiveState(current);
  return {
    ...current,
    interactive: {
      type: "assessment",
      assessmentId: patch.assessmentId ?? existing.assessmentId,
      started: patch.started ?? existing.started,
      submitted: patch.submitted ?? existing.submitted,
      answers: patch.answers ?? existing.answers,
      currentQuestionIndex: patch.currentQuestionIndex ?? existing.currentQuestionIndex,
    },
  };
}

function scoreToLevel(percent) {
  if (percent >= 90) return "C1";
  if (percent >= 78) return "B2";
  if (percent >= 64) return "B1";
  if (percent >= 48) return "A2";
  return "A1";
}

function levelLabel(level) {
  const labels = {
    A1: "Începător (A1)",
    A2: "Elementar (A2)",
    B1: "Intermediar (B1)",
    B2: "Intermediar-avansat (B2)",
    C1: "Avansat (C1)",
  };
  return labels[level] || level;
}

export function evaluateAssessmentAnswers(internal, answers = {}) {
  const questions = internal?.questions || [];
  let earned = 0;
  let total = 0;
  const strengths = [];
  const gaps = [];

  for (const question of questions) {
    const weight = question.weight || 1;
    total += weight;
    const given = String(answers[question.id] || "").trim();

    if (question.type === "short_text") {
      if (given.length >= 8 && /[a-zA-Z]/.test(given)) {
        earned += weight;
        strengths.push("Poți formula propoziții simple în engleză.");
      } else {
        gaps.push("Ai nevoie de mai multă practică la exprimarea liberă în engleză.");
      }
      continue;
    }

    if (given && given === question.correctOptionId) {
      earned += weight;
      strengths.push(`Ai răspuns corect la întrebarea despre „${question.prompt.slice(0, 42)}…”.`);
    } else {
      gaps.push(`Revizuiește subiectul din întrebarea: „${question.prompt.slice(0, 42)}…”.`);
    }
  }

  const percent = total > 0 ? Math.round((earned / total) * 100) : 0;
  const level = scoreToLevel(percent);
  const title = `Nivel estimat: ${level}`;
  const summary = `Pe baza răspunsurilor tale, nivelul orientativ este ${levelLabel(level)} (${percent}% din întrebările evaluate corect).`;
  const recommendations = [
    level === "A1" || level === "A2"
      ? "Începe cu vocabular de bază și propoziții simple zilnic."
      : "Consolidează gramatica și conversația aplicată pe obiectivul proiectului.",
    "Continuă cu pașii următori din proiect pentru a transforma evaluarea în plan concret.",
  ];

  const preview = [
    summary,
    "",
    "Puncte forte:",
    ...strengths.slice(0, 3).map((item) => `- ${item}`),
    "",
    "De îmbunătățit:",
    ...gaps.slice(0, 3).map((item) => `- ${item}`),
    "",
    "Recomandări:",
    ...recommendations.map((item) => `- ${item}`),
  ].join("\n");

  return {
    title,
    summary,
    level,
    percent,
    strengths: strengths.slice(0, 5),
    gaps: gaps.slice(0, 5),
    recommendations,
    preview,
    content: preview,
  };
}

export function getAssessmentInternalFromPreparedInput(preparedInput = {}) {
  return preparedInput?._assessmentInternal || null;
}

export function withAssessmentInternal(preparedInput = {}, internal) {
  return {
    ...(preparedInput || {}),
    _assessmentInternal: internal,
  };
}
