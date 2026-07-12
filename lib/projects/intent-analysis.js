import { deriveNameFromGoal } from "./validation.js";
import {
  buildCategoryToolSummary,
  resolveRecommendedToolId,
} from "./tool-catalog.js";
import {
  isValidIntentCategorySlug,
  sanitizeIntentQuestions,
} from "./intent-validation.js";
import {
  PROJECT_CATEGORY_GUIDANCE,
  PROJECT_INTENT_MODEL,
  PROJECT_INTENT_TEMPERATURE,
  PROJECT_INTENT_TIMEOUT_MS,
  buildIntentAnalysisJsonSchema,
  buildIntentSystemPrompt,
} from "./intent-schema.js";
import { PROJECT_CATEGORY_SLUGS } from "./constants.js";

const BLOCKLIST = [
  "pula", "muie", "fuck", "shit", "porn", "suicide", "kill myself", "hack ", "bomb",
];

export const CLARIFICATION_ROUND_UNSUPPORTED_MESSAGE =
  "Nu am reușit să stabilesc suficient de clar proiectul pe baza răspunsurilor tale. Te rog reformulează obiectivul într-un mod mai concret.";

export function hasClarificationAnswers(input) {
  return Array.isArray(input?.clarificationAnswers) && input.clarificationAnswers.length > 0;
}

export function applyClarificationRoundGuard(normalized, input) {
  if (!normalized?.ok || !normalized.payload) {
    return normalized;
  }

  if (hasClarificationAnswers(input) && normalized.payload.status === "needs_clarification") {
    return { ok: false, reason: "second_clarification_round_blocked" };
  }

  return normalized;
}

function isBlockedGoal(goal) {
  const normalized = goal.toLowerCase();
  return BLOCKLIST.some((term) => normalized.includes(term));
}

function buildUserPrompt({ goal, optionalName, clarificationAnswers }) {
  const lines = [`Obiectiv utilizator:\n${goal}`];

  if (optionalName) {
    lines.push(`Nume furnizat de utilizator (păstrează-l dacă este valid): ${optionalName}`);
  }

  if (Array.isArray(clarificationAnswers) && clarificationAnswers.length > 0) {
    lines.push("Răspunsuri de clarificare:");
    for (const answer of clarificationAnswers) {
      lines.push(`- ${answer.questionId}: ${answer.answer}`);
    }
  }

  if (Array.isArray(clarificationAnswers) && clarificationAnswers.length > 0) {
    lines.push(
      "Aceasta este singura rundă de clarificare permisă. Returnează DOAR status=ready (cu categorySlug valid) sau status=unsupported. NU returna needs_clarification.",
    );
  } else {
    lines.push(
      "Returnează doar JSON conform schemei. Dacă numele utilizatorului este furnizat și valid, păstrează-l ca suggestedName.",
    );
  }

  return lines.join("\n\n");
}

function clampConfidence(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function buildCategoryToolMap() {
  const map = {};
  for (const category of PROJECT_CATEGORY_SLUGS) {
    map[category] = buildCategoryToolSummary(category, 10);
  }
  return map;
}

function normalizeReadyPayload(modelResult, input) {
  const categorySlug = typeof modelResult.categorySlug === "string" ? modelResult.categorySlug.trim() : "";
  if (!isValidIntentCategorySlug(categorySlug)) {
    return { ok: false, reason: "invalid_category" };
  }

  const suggestedName =
    (input.optionalName && input.optionalName.trim()) ||
    (typeof modelResult.suggestedName === "string" && modelResult.suggestedName.trim()) ||
    deriveNameFromGoal(input.goal);

  const recommendedToolId = resolveRecommendedToolId({
    categorySlug,
    candidateToolId: modelResult.suggestedToolId,
  });

  const payload = {
    status: "ready",
    categorySlug,
    confidence: clampConfidence(modelResult.confidence),
    suggestedName,
    recommendedToolId,
    recommendationReason:
      typeof modelResult.recommendationReason === "string"
        ? modelResult.recommendationReason.trim() || null
        : null,
  };

  if (typeof modelResult.normalizedGoal === "string" && modelResult.normalizedGoal.trim()) {
    payload.normalizedGoal = modelResult.normalizedGoal.trim();
  }
  if (typeof modelResult.shortSummary === "string" && modelResult.shortSummary.trim()) {
    payload.shortSummary = modelResult.shortSummary.trim();
  }
  if (typeof modelResult.detectedIntent === "string" && modelResult.detectedIntent.trim()) {
    payload.detectedIntent = modelResult.detectedIntent.trim();
  }
  if (typeof modelResult.firstStepTitle === "string" && modelResult.firstStepTitle.trim()) {
    payload.firstStepTitle = modelResult.firstStepTitle.trim();
  }
  if (typeof modelResult.firstStepDescription === "string" && modelResult.firstStepDescription.trim()) {
    payload.firstStepDescription = modelResult.firstStepDescription.trim();
  }

  return { ok: true, payload };
}

function normalizeClarificationPayload(modelResult) {
  const message =
    (typeof modelResult.message === "string" && modelResult.message.trim()) ||
    "Am nevoie de puțin mai mult context ca să creez proiectul potrivit.";

  return {
    status: "needs_clarification",
    message,
    questions: sanitizeIntentQuestions(modelResult.questions),
  };
}

function normalizeUnsupportedPayload(modelResult) {
  return {
    status: "unsupported",
    message:
      (typeof modelResult.message === "string" && modelResult.message.trim()) ||
      "Nu pot pregăti un proiect sigur pentru acest obiectiv momentan.",
  };
}

export function normalizeIntentModelResult(modelResult, input) {
  if (!modelResult || typeof modelResult !== "object") {
    return { ok: false, reason: "malformed" };
  }

  const status = modelResult.status;
  if (status === "ready") {
    return normalizeReadyPayload(modelResult, input);
  }
  if (status === "needs_clarification") {
    return { ok: true, payload: normalizeClarificationPayload(modelResult) };
  }
  if (status === "unsupported") {
    return { ok: true, payload: normalizeUnsupportedPayload(modelResult) };
  }

  return { ok: false, reason: "unknown_status" };
}

async function callOpenAiIntent({
  goal,
  optionalName,
  clarificationAnswers,
  fetchFn = fetch,
  apiKey,
  finalClassificationOnly = false,
}) {
  const categoryTools = buildCategoryToolMap();
  const schema = buildIntentAnalysisJsonSchema();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROJECT_INTENT_TIMEOUT_MS);

  try {
    const response = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: PROJECT_INTENT_MODEL,
        temperature: PROJECT_INTENT_TEMPERATURE,
        response_format: {
          type: "json_schema",
          json_schema: schema,
        },
        messages: [
          {
            role: "system",
            content: finalClassificationOnly
              ? `${buildIntentSystemPrompt({ categoryTools })}\n\nMod final de clasificare: utilizatorul a răspuns deja la clarificări. Returnează DOAR ready sau unsupported.`
              : buildIntentSystemPrompt({ categoryTools }),
          },
          {
            role: "user",
            content: buildUserPrompt({ goal, optionalName, clarificationAnswers }),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, kind: "upstream", status: response.status };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, kind: "invalid_json" };
    }

    return { ok: true, parsed };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, kind: "timeout" };
    }
    return { ok: false, kind: "network" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeProjectIntent(input, deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const apiKey = deps.apiKey || process.env.OPENAI_API_KEY || "";

  if (isBlockedGoal(input.goal)) {
    return {
      ok: true,
      result: {
        status: "unsupported",
        message: "Nu pot pregăti un proiect sigur pentru acest obiectiv.",
      },
    };
  }

  if (!apiKey) {
    return { ok: false, kind: "unavailable" };
  }

  const first = await callOpenAiIntent({
    goal: input.goal,
    optionalName: input.optionalName,
    clarificationAnswers: input.clarificationAnswers,
    fetchFn,
    apiKey,
  });

  if (!first.ok) {
    return first;
  }

  let normalized = normalizeIntentModelResult(first.parsed, input);

  if (normalized.ok) {
    const guarded = applyClarificationRoundGuard(normalized, input);
    if (guarded.ok) {
      return { ok: true, result: guarded.payload };
    }
  } else if (!hasClarificationAnswers(input)) {
    const repair = await callOpenAiIntent({
      goal: `${input.goal}\n\nCorectează răspunsul anterior: folosește doar slug-uri de categorie valide și status valid.`,
      optionalName: input.optionalName,
      clarificationAnswers: input.clarificationAnswers,
      fetchFn,
      apiKey,
    });

    if (!repair.ok) {
      return repair;
    }

    normalized = normalizeIntentModelResult(repair.parsed, input);
    if (normalized.ok) {
      const guarded = applyClarificationRoundGuard(normalized, input);
      if (guarded.ok) {
        return { ok: true, result: guarded.payload };
      }
    }
  }

  if (hasClarificationAnswers(input)) {
    const finalRepair = await callOpenAiIntent({
      goal: input.goal,
      optionalName: input.optionalName,
      clarificationAnswers: input.clarificationAnswers,
      fetchFn,
      apiKey,
      finalClassificationOnly: true,
    });

    if (!finalRepair.ok) {
      return finalRepair;
    }

    const finalNormalized = normalizeIntentModelResult(finalRepair.parsed, input);
    if (finalNormalized.ok && finalNormalized.payload.status !== "needs_clarification") {
      return { ok: true, result: finalNormalized.payload };
    }

    return {
      ok: true,
      result: {
        status: "unsupported",
        message: CLARIFICATION_ROUND_UNSUPPORTED_MESSAGE,
      },
    };
  }

  if (!normalized.ok) {
    return { ok: false, kind: "invalid_response" };
  }

  return { ok: true, result: normalized.payload };
}

export function getCategoryGuidanceForTests() {
  return PROJECT_CATEGORY_GUIDANCE;
}
