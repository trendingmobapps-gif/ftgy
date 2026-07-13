import { getExecutionPlanFromPreparedInput } from "../execution/execution-plan-generator.js";
import { executePreparedAction } from "./generation.js";
import { buildExecutionPrompt } from "./prompt-builder.js";
import { normalizeActionResultPayload } from "./result-normalizer.js";

function readInteractive(collectedInput = {}) {
  const interactive = collectedInput?.interactive;
  return interactive && typeof interactive === "object" ? interactive : null;
}

function findRecommendationById(plan, recommendationId) {
  for (const group of plan?.recommendationGroups || []) {
    const match = (group.recommendations || []).find((item) => item.id === recommendationId);
    if (match) {
      return { group, recommendation: match };
    }
  }
  return null;
}

function collectSelectedRecommendationDetails(plan, interactive) {
  const selected = interactive?.selectedRecommendations || interactive?.selectedIds || [];
  const selectedIds = Array.isArray(selected) ? selected : [];
  const details = [];

  for (const id of selectedIds) {
    const found = findRecommendationById(plan, id);
    if (found) {
      details.push({
        groupTitle: found.group.title,
        title: found.recommendation.title,
        explanation: found.recommendation.explanation,
        advantages: found.recommendation.advantages || [],
        tradeoffs: found.recommendation.tradeoffs || [],
      });
    }
  }

  const customOptions = Array.isArray(interactive?.customOptions) ? interactive.customOptions : [];
  for (const custom of customOptions) {
    if (!custom || typeof custom !== "object") continue;
    details.push({
      groupTitle: custom.groupTitle || "Opțiuni personalizate",
      title: custom.title || custom.label || "Opțiune personalizată",
      explanation: custom.explanation || custom.reason || "",
      advantages: [],
      tradeoffs: [],
    });
  }

  return details;
}

export function buildRecommendationSelectionResultContent({ plan, interactive }) {
  const details = collectSelectedRecommendationDetails(plan, interactive);
  if (details.length === 0) {
    return null;
  }

  const lines = ["# Strategie confirmată", ""];
  let currentGroup = null;

  for (const item of details) {
    if (item.groupTitle !== currentGroup) {
      currentGroup = item.groupTitle;
      lines.push(`## ${currentGroup}`, "");
    }
    lines.push(`### ${item.title}`);
    if (item.explanation) {
      lines.push(item.explanation);
    }
    if (item.advantages.length > 0) {
      lines.push("", "Avantaje:", ...item.advantages.map((value) => `- ${value}`));
    }
    if (item.tradeoffs.length > 0) {
      lines.push("", "Compromisuri:", ...item.tradeoffs.map((value) => `- ${value}`));
    }
    lines.push("");
  }

  const priorityOrder = Array.isArray(interactive?.priorityOrder) ? interactive.priorityOrder : [];
  if (priorityOrder.length > 0) {
    lines.push("## Prioritizare", "");
    priorityOrder.forEach((id, index) => {
      const found = findRecommendationById(plan, id);
      if (found) {
        lines.push(`${index + 1}. ${found.recommendation.title}`);
      }
    });
    lines.push("");
  }

  return lines.join("\n").trim();
}

function buildRecommendationSynthesisPrompt({ preparation, plan, interactive }) {
  const base = buildExecutionPrompt({
    preparation,
    acceptedInput: {
      prompt: buildRecommendationSelectionResultContent({ plan, interactive }) || preparation.preparedPrompt,
    },
  });

  return {
    systemPrompt: `${base.systemPrompt}

Utilizatorul a confirmat deja recomandările selectate. Generează un rezultat practic, structurat, care sintetizează selecțiile confirmate și explică prioritizarea. Nu cere date noi.`,
    userPrompt: `${base.userPrompt}

Selecții confirmate:
${buildRecommendationSelectionResultContent({ plan, interactive }) || "Selecțiile nu au putut fi reconstruite."}`,
  };
}

export async function generateActionResult({
  preparation,
  collectedInput = {},
  acceptedInput = {},
  preparedInput = {},
  step,
  project,
  fetchImpl,
  logFn = null,
}) {
  const executionPlan = getExecutionPlanFromPreparedInput(preparedInput);
  const interactive = readInteractive({ ...collectedInput, ...acceptedInput });
  const mode = executionPlan?.mode || null;
  const strategy = "generate_resource";

  if (mode === "recommendation_selection") {
    const selectedContent = buildRecommendationSelectionResultContent({
      plan: executionPlan,
      interactive,
    });

    if (!selectedContent) {
      return { ok: false, reason: "missing_recommendation_selection", mode, strategy };
    }

    const synthesisPreparation = {
      ...preparation,
      preparedPrompt: selectedContent,
      preparedInput: {
        ...(preparation.preparedInput || {}),
        prompt: selectedContent,
      },
    };

    const synthesisPrompt = buildRecommendationSynthesisPrompt({
      preparation: synthesisPreparation,
      plan: executionPlan,
      interactive,
    });

    const generated = await executePreparedAction({
      preparation: {
        ...synthesisPreparation,
        preparedPrompt: synthesisPrompt.userPrompt,
      },
      acceptedInput: {
        prompt: synthesisPrompt.userPrompt,
      },
      fetchImpl,
      logFn,
      systemPromptOverride: synthesisPrompt.systemPrompt,
    });

    const text = generated.ok ? generated.text : selectedContent;
    const normalized = normalizeActionResultPayload({
      raw: {
        title: executionPlan?.title || step?.title,
        content: text,
        structuredData: {
          mode: "recommendation_selection",
          selectedRecommendations: interactive?.selectedRecommendations || [],
          priorityOrder: interactive?.priorityOrder || [],
          customOptions: interactive?.customOptions || [],
        },
        metadata: {
          source: generated.ok ? "ai_synthesis" : "selection_snapshot",
          model: generated.model || null,
          transport: generated.transport || null,
        },
      },
      step,
      project,
      resultType: "text",
      outputType: "recommendation",
    });

    if (!normalized.ok) {
      return { ok: false, reason: normalized.reason, mode, strategy };
    }

    return {
      ok: true,
      mode,
      strategy,
      model: generated.model || null,
      transport: generated.transport || "selection_snapshot",
      usedAiSynthesis: generated.ok,
      ...normalized,
    };
  }

  const generated = await executePreparedAction({
    preparation,
    acceptedInput,
    fetchImpl,
    logFn,
  });

  if (!generated.ok) {
    return { ok: false, reason: generated.reason || "provider_error", mode, strategy };
  }

  const normalized = normalizeActionResultPayload({
    raw: {
      title: step?.title,
      content: generated.text,
      metadata: {
        source: "ai_generation",
        model: generated.model || null,
        transport: generated.transport || null,
      },
    },
    step,
    project,
    resultType: "text",
    outputType: "text",
  });

  if (!normalized.ok) {
    return { ok: false, reason: normalized.reason, mode, strategy };
  }

  return {
    ok: true,
    mode,
    strategy,
    model: generated.model || null,
    transport: generated.transport || null,
    ...normalized,
  };
}
