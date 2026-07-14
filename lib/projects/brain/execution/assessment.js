import { randomUUID } from "node:crypto";

import { buildContextualInteractiveFallback } from "./interactive-generator.js";

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

function usesLanguageLevelFormat(internal) {
  return internal?.resultFormat === "language_level";
}

export function buildAssessmentInternal({ step, project, assessmentId = null, context = null }) {
  const fallbackContext =
    context ||
    {
      projectName: project?.name || "proiectul tău",
      projectGoal: project?.goal || "",
      projectSummary: project?.summary || project?.description || "",
      categorySlug: project?.category_slug || project?.categorySlug || null,
      stepTitle: step?.title || "Evaluare",
      stepDescription: step?.description || "",
      expectedOutcome: step?.expected_outcome || "",
      whyItMatters: step?.rationale || "",
    };

  return buildContextualInteractiveFallback({
    mode: "assessment",
    context: fallbackContext,
    assessmentId,
  });
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

    if (question.type === "short_text" || question.type === "long_text") {
      if (given.length >= 8) {
        earned += weight;
        strengths.push(`Ai oferit un răspuns util la „${question.prompt.slice(0, 48)}…”.`);
      } else {
        gaps.push(`Completează mai clar răspunsul la „${question.prompt.slice(0, 48)}…”.`);
      }
      continue;
    }

    if (question.type === "single_choice" && question.correctOptionId) {
      if (given && given === question.correctOptionId) {
        earned += weight;
        strengths.push(`Ai răspuns corect la întrebarea despre „${question.prompt.slice(0, 42)}…”.`);
      } else {
        gaps.push(`Revizuiește subiectul din întrebarea: „${question.prompt.slice(0, 42)}…”.`);
      }
      continue;
    }

    if (given) {
      earned += weight;
      strengths.push(`Ai răspuns la „${question.prompt.slice(0, 42)}…”.`);
    } else if (question.required !== false) {
      gaps.push(`Lipsește răspunsul la „${question.prompt.slice(0, 42)}…”.`);
    }
  }

  const percent = total > 0 ? Math.round((earned / total) * 100) : 0;
  const domainLabel = internal?.domainSummary || internal?.title || "această etapă";
  const languageLevel = usesLanguageLevelFormat(internal);
  const level = languageLevel ? scoreToLevel(percent) : null;

  const title = languageLevel
    ? `Nivel estimat: ${level}`
    : `Evaluare pentru „${internal?.title || "această etapă"}”`;

  const summary = languageLevel
    ? `Pe baza răspunsurilor tale, nivelul orientativ este ${levelLabel(level)} (${percent}% din întrebările evaluate corect).`
    : `Pe baza răspunsurilor tale, am sintetizat progresul orientativ pentru „${domainLabel}”.`;

  const recommendations = [
    languageLevel
      ? "Continuă cu exerciții adaptate nivelului estimat și obiectivului proiectului."
      : "Continuă cu pașii următori din proiect pentru a transforma evaluarea în acțiuni concrete.",
    "Folosește recomandările pentru a prioritiza următoarea etapă.",
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
    resultFormat: internal?.resultFormat || "competency_summary",
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

export function createAssessmentId() {
  return randomUUID();
}
