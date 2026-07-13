import { randomUUID } from "node:crypto";

import {
  INTERACTIVE_GENERATION_MODEL,
  INTERACTIVE_GENERATION_TEMPERATURE,
  INTERACTIVE_GENERATION_TIMEOUT_MS,
  buildInteractiveEvaluationJsonSchema,
  buildInteractiveEvaluationSystemPrompt,
  buildInteractiveGenerationJsonSchema,
  buildInteractiveGenerationSystemPrompt,
  buildInteractiveGenerationUserPrompt,
} from "./interactive-schema.js";

const ENGLISH_GRAMMAR_MARKERS = [
  "i go to school",
  "childs",
  "childrens",
  "doesn't like coffee",
  "i like reading",
  "more better",
  "present perfect",
  "pluralul corect pentru „child”",
  "alege varianta corectă pentru propoziția",
];

function normalizeText(value, max = 4000) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function memoryMapToSummary(memoryMap = new Map()) {
  const lines = [];
  for (const [key, value] of memoryMap) {
    const trimmed = String(value || "").trim();
    if (trimmed) lines.push(`${key}: ${trimmed}`);
  }
  return lines.slice(0, 24).join("\n");
}

function completedStepsToSummary(completedSteps = []) {
  return completedSteps
    .slice(-6)
    .map((item) => `- ${item.title}${item.resultPreview ? `: ${item.resultPreview}` : ""}`)
    .join("\n");
}

function knownInputsToSummary(preparedInput = {}, collectedInput = {}) {
  const merged = { ...(preparedInput || {}), ...(collectedInput || {}) };
  const lines = [];
  for (const [key, value] of Object.entries(merged)) {
    if (key.startsWith("_")) continue;
    const trimmed = String(value || "").trim();
    if (trimmed) lines.push(`${key}: ${trimmed}`);
  }
  return lines.slice(0, 16).join("\n");
}

export function buildInteractiveGenerationContext({
  project,
  step,
  milestone,
  preparation,
  memoryMap = new Map(),
  completedSteps = [],
  collectedInput = {},
}) {
  return {
    projectName: normalizeText(project?.name, 200),
    projectGoal: normalizeText(project?.goal, 2000),
    projectSummary: normalizeText(project?.summary || project?.description, 2000),
    categorySlug: project?.category_slug || project?.categorySlug || null,
    milestoneTitle: normalizeText(milestone?.title, 300),
    stepTitle: normalizeText(step?.title, 300),
    stepDescription: normalizeText(step?.description, 2000),
    expectedOutcome: normalizeText(step?.expected_outcome || preparation?.expectedResult, 1000),
    whyItMatters: normalizeText(preparation?.whyItMatters || step?.rationale, 1000),
    memorySummary: memoryMapToSummary(memoryMap),
    completedStepsSummary: completedStepsToSummary(completedSteps),
    knownInputsSummary: knownInputsToSummary(preparation?.preparedInput, collectedInput),
  };
}

function slugifyId(value, index) {
  const base = String(value || `q${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return base || `q${index + 1}`;
}

function normalizeQuestion(question, index) {
  const id = slugifyId(question?.id, index);
  const type = question?.type || "short_text";
  const prompt = normalizeText(question?.prompt, 500);
  if (!prompt) return null;

  const normalized = {
    id,
    type,
    prompt,
    required: question?.required !== false,
    weight: 1,
  };

  if (type === "single_choice" || type === "multiple_choice") {
    const options = (question?.options || [])
      .map((option, optionIndex) => {
        const label = normalizeText(option?.label, 180);
        if (!label) return null;
        const optionId = slugifyId(option?.id || option?.value || `opt_${optionIndex + 1}`, optionIndex);
        return {
          id: optionId,
          label,
          value: String(option?.value || optionId),
        };
      })
      .filter(Boolean);

    if (options.length < 2) return null;
    normalized.options = options.slice(0, 6);

    const correctOptionId = String(question?.correctOptionId || "").trim();
    if (correctOptionId && normalized.options.some((option) => option.id === correctOptionId)) {
      normalized.correctOptionId = correctOptionId;
    }
  }

  if (question?.rubric) {
    normalized.rubric = normalizeText(question.rubric, 300);
  }

  return normalized;
}

export function containsEnglishGrammarPreset(payload) {
  const haystack = JSON.stringify(payload || {}).toLowerCase();
  return ENGLISH_GRAMMAR_MARKERS.some((marker) => haystack.includes(marker));
}

export function isLanguageLearningContext(context) {
  const haystack = [
    context?.projectName,
    context?.projectGoal,
    context?.projectSummary,
    context?.stepTitle,
    context?.stepDescription,
    context?.expectedOutcome,
    context?.categorySlug,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    haystack.includes("englez") ||
    haystack.includes("english") ||
    haystack.includes("limba eng") ||
    haystack.includes("language learning")
  );
}

export function normalizeGeneratedInteractivePayload(raw, mode, context) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "malformed" };
  }

  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .map((question, index) => normalizeQuestion(question, index))
    .filter(Boolean);

  if (questions.length < 3) {
    return { ok: false, reason: "too_few_questions" };
  }

  const payload = {
    mode: raw.mode || mode,
    title: normalizeText(raw.title || context.stepTitle, 200) || context.stepTitle,
    instructions:
      normalizeText(raw.instructions, 600) ||
      "Răspunde la fiecare întrebare. Nu vei vedea evaluarea finală până după trimitere.",
    evaluationStrategy: raw.evaluationStrategy || "ai_evaluated",
    resultFormat: raw.resultFormat || "competency_summary",
    domainSummary: normalizeText(raw.domainSummary, 300) || context.stepTitle,
    questions: questions.slice(0, 10),
    completionCriteria: {
      minimumAnswers: Number.isFinite(raw.minimumAnswers) ? raw.minimumAnswers : questions.length,
      requireAll: raw.requireAll !== false,
    },
  };

  if (!isLanguageLearningContext(context) && containsEnglishGrammarPreset(payload)) {
    return { ok: false, reason: "unrelated_english_preset" };
  }

  if (payload.evaluationStrategy === "rule_based") {
    const scorable = payload.questions.filter((question) => question.type === "single_choice");
    const withKeys = scorable.filter((question) => question.correctOptionId);
    if (scorable.length > 0 && withKeys.length < Math.ceil(scorable.length / 2)) {
      payload.evaluationStrategy = "ai_evaluated";
    }
  }

  return { ok: true, payload };
}

export function buildContextualInteractiveFallback({ mode = "assessment", context, assessmentId = null }) {
  const id = assessmentId || randomUUID();
  const projectRef = context.projectName || "proiectul tău";
  const stepRef = context.stepTitle || "această etapă";

  const questions = [
    {
      id: "focus_area",
      type: "long_text",
      prompt: `Ce anume vrei să evaluezi în etapa „${stepRef}” pentru ${projectRef}?`,
      required: true,
      weight: 1,
      rubric: "specificity",
    },
    {
      id: "current_level",
      type: "single_choice",
      prompt: "Care este nivelul tău actual în domeniul acestei etape?",
      required: true,
      weight: 1,
      options: [
        { id: "beginner", label: "Începător", value: "beginner" },
        { id: "intermediate", label: "Intermediar", value: "intermediate" },
        { id: "advanced", label: "Avansat", value: "advanced" },
        { id: "unsure", label: "Nu sunt sigur", value: "unsure" },
      ],
    },
    {
      id: "difficult_topics",
      type: "long_text",
      prompt: `Ce subiecte sau aspecte ți se par cele mai dificile pentru „${context.expectedOutcome || stepRef}”?`,
      required: true,
      weight: 1,
      rubric: "gap_identification",
    },
    {
      id: "concrete_goal",
      type: "short_text",
      prompt: `Care este obiectivul tău concret în această etapă a proiectului „${projectRef}”?`,
      required: true,
      weight: 1,
      rubric: "goal_clarity",
    },
  ];

  return {
    assessmentId: id,
    type: "assessment",
    title: context.stepTitle || "Evaluare contextuală",
    instructions:
      "Răspunde sincer la întrebările de mai jos. Evaluarea va folosi contextul proiectului tău.",
    scoringStrategy: "ai_evaluated",
    resultFormat: "readiness_summary",
    progressLabel: "Întrebarea",
    domainSummary: context.expectedOutcome || context.stepTitle,
    questions,
    source: "contextual_fallback",
  };
}

export function toAssessmentInternal(generated, context, assessmentId = null) {
  const id = assessmentId || randomUUID();
  return {
    assessmentId: id,
    type: "assessment",
    title: generated.title || context.stepTitle,
    instructions: generated.instructions,
    scoringStrategy: generated.evaluationStrategy || "ai_evaluated",
    resultFormat: generated.resultFormat || "competency_summary",
    progressLabel: "Întrebarea",
    domainSummary: generated.domainSummary || context.stepTitle,
    questions: generated.questions,
    completionCriteria: generated.completionCriteria || { requireAll: true },
    source: generated.source || "ai_generated",
  };
}

function extractChatJson(data) {
  const content = data?.choices?.[0]?.message?.content || "";
  if (!content.trim()) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function callOpenAiInteractive({
  context,
  mode,
  fetchImpl = fetch,
  apiKey,
  repair = false,
  repairReason = null,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INTERACTIVE_GENERATION_TIMEOUT_MS);

  try {
    const messages = [
      { role: "system", content: buildInteractiveGenerationSystemPrompt() },
      {
        role: "user",
        content: repair
          ? `${buildInteractiveGenerationUserPrompt(context, mode)}\n\nRepară JSON-ul anterior. Motiv respingere: ${repairReason || "invalid"}.`
          : buildInteractiveGenerationUserPrompt(context, mode),
      },
    ];

    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: INTERACTIVE_GENERATION_MODEL,
        temperature: INTERACTIVE_GENERATION_TEMPERATURE,
        response_format: {
          type: "json_schema",
          json_schema: buildInteractiveGenerationJsonSchema(),
        },
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: "upstream" };
    }

    const data = await response.json();
    const parsed = extractChatJson(data);
    if (!parsed) {
      return { ok: false, reason: "invalid_json" };
    }

    return { ok: true, parsed };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateAssessmentInternal({
  project,
  step,
  milestone,
  preparation,
  memoryMap,
  completedSteps,
  collectedInput,
  assessmentId = null,
  fetchImpl = fetch,
  apiKey = process.env.OPENAI_API_KEY || "",
}) {
  const context = buildInteractiveGenerationContext({
    project,
    step,
    milestone,
    preparation,
    memoryMap,
    completedSteps,
    collectedInput,
  });

  if (!apiKey) {
    return {
      ok: true,
      internal: buildContextualInteractiveFallback({ mode: "assessment", context, assessmentId }),
      source: "contextual_fallback",
    };
  }

  const first = await callOpenAiInteractive({
    context,
    mode: "assessment",
    fetchImpl,
    apiKey,
  });

  let normalized = null;
  if (first.ok) {
    normalized = normalizeGeneratedInteractivePayload(first.parsed, "assessment", context);
  }

  if (!normalized?.ok) {
    const repair = await callOpenAiInteractive({
      context,
      mode: "assessment",
      fetchImpl,
      apiKey,
      repair: true,
      repairReason: normalized?.reason || first.reason || "invalid",
    });

    if (repair.ok) {
      normalized = normalizeGeneratedInteractivePayload(repair.parsed, "assessment", context);
    }
  }

  if (normalized?.ok) {
    return {
      ok: true,
      internal: toAssessmentInternal(
        { ...normalized.payload, source: "ai_generated" },
        context,
        assessmentId,
      ),
      source: "ai_generated",
    };
  }

  return {
    ok: true,
    internal: buildContextualInteractiveFallback({ mode: "assessment", context, assessmentId }),
    source: "contextual_fallback",
  };
}

function buildEvaluationUserPrompt({ internal, answers, context }) {
  const questionLines = (internal.questions || []).map((question) => {
    const answer = String(answers[question.id] || "").trim() || "(fără răspuns)";
    const options =
      question.options?.map((option) => `${option.id}: ${option.label}`).join(" | ") || "";
    return [
      `Întrebare [${question.id}] (${question.type}): ${question.prompt}`,
      options ? `Opțiuni: ${options}` : null,
      `Răspuns utilizator: ${answer}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    `Proiect: ${context.projectName}`,
    context.projectGoal ? `Obiectiv: ${context.projectGoal}` : null,
    `Pas: ${context.stepTitle}`,
    context.expectedOutcome ? `Rezultat așteptat: ${context.expectedOutcome}` : null,
    `Format rezultat: ${internal.resultFormat || "competency_summary"}`,
    "",
    "Întrebări și răspunsuri:",
    questionLines.join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function evaluateAssessmentWithAi({
  internal,
  answers,
  project,
  step,
  preparation,
  fetchImpl = fetch,
  apiKey = process.env.OPENAI_API_KEY || "",
}) {
  const context = buildInteractiveGenerationContext({
    project,
    step,
    preparation,
  });

  if (!apiKey) {
    return {
      ok: true,
      evaluation: buildFallbackEvaluation({ internal, answers, context }),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INTERACTIVE_GENERATION_TIMEOUT_MS);

  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: INTERACTIVE_GENERATION_MODEL,
        temperature: 0.2,
        response_format: {
          type: "json_schema",
          json_schema: buildInteractiveEvaluationJsonSchema(),
        },
        messages: [
          { role: "system", content: buildInteractiveEvaluationSystemPrompt() },
          {
            role: "user",
            content: buildEvaluationUserPrompt({ internal, answers, context }),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: true,
        evaluation: buildFallbackEvaluation({ internal, answers, context }),
      };
    }

    const data = await response.json();
    const parsed = extractChatJson(data);
    if (!parsed) {
      return {
        ok: true,
        evaluation: buildFallbackEvaluation({ internal, answers, context }),
      };
    }

    return {
      ok: true,
      evaluation: formatAiEvaluation(parsed, context, internal),
    };
  } catch {
    return {
      ok: true,
      evaluation: buildFallbackEvaluation({ internal, answers, context }),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildFallbackEvaluation({ internal, answers, context }) {
  const answered = (internal.questions || []).filter((question) =>
    String(answers[question.id] || "").trim(),
  ).length;
  const total = internal.questions?.length || 0;
  const title = `Evaluare pentru „${context.stepTitle}”`;
  const summary = `Ai răspuns la ${answered} din ${total} întrebări pentru pasul „${context.stepTitle}” din proiectul „${context.projectName}”.`;
  const preview = [
    summary,
    "",
    "Recomandări:",
    "- Continuă cu pașii următori din proiect pentru a transforma evaluarea în acțiuni concrete.",
    "- Revizuiește subiectele marcate ca dificile în răspunsurile tale.",
  ].join("\n");

  return {
    title,
    summary,
    level: null,
    percent: total > 0 ? Math.round((answered / total) * 100) : null,
    strengths: answered > 0 ? ["Ai oferit suficiente răspunsuri pentru o evaluare orientativă."] : [],
    gaps:
      answered < total
        ? ["Completează toate întrebările pentru o evaluare mai precisă."]
        : ["Identifică subiectele care necesită consolidare în contextul proiectului."],
    recommendations: [
      "Folosește rezultatul acceptat pentru a avansa la următorul pas al proiectului.",
    ],
    preview,
    content: preview,
  };
}

function formatAiEvaluation(parsed, context, internal) {
  const strengths = Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : [];
  const gaps = Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 5) : [];
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations.slice(0, 5)
    : [];

  const title = normalizeText(parsed.title, 200) || `Evaluare pentru „${context.stepTitle}”`;
  const summary =
    normalizeText(parsed.summary, 1200) ||
    `Evaluare orientativă pentru pasul „${context.stepTitle}”.`;

  const disclaimer =
    normalizeText(parsed.disclaimer, 400) ||
    (context.categorySlug === "studii" && /medical|medic|examen/.test(`${context.projectGoal} ${context.stepTitle}`.toLowerCase())
      ? "Această evaluare are scop educațional de pregătire și nu reprezintă un diagnostic medical."
      : null);

  const previewParts = [summary, ""];
  if (disclaimer) {
    previewParts.push(disclaimer, "");
  }
  if (strengths.length) {
    previewParts.push("Puncte forte:", ...strengths.map((item) => `- ${item}`), "");
  }
  if (gaps.length) {
    previewParts.push("De îmbunătățit:", ...gaps.map((item) => `- ${item}`), "");
  }
  if (recommendations.length) {
    previewParts.push("Recomandări:", ...recommendations.map((item) => `- ${item}`));
  }

  const preview = previewParts.join("\n");

  return {
    title,
    summary,
    level: parsed.level || null,
    percent: Number.isFinite(parsed.percent) ? parsed.percent : null,
    strengths,
    gaps,
    recommendations,
    disclaimer,
    preview,
    content: preview,
    resultFormat: internal.resultFormat || "competency_summary",
  };
}
