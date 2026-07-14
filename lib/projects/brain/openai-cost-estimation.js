const MODEL_COST_BANDS = {
  "gpt-5.6-sol": "high",
  "gpt-4.1": "medium",
  "gpt-4.1-mini": "low",
};

const DEFAULT_BAND = "unknown";

export function resolveModelCostBand(model) {
  const normalized = String(model || "").trim();
  if (!normalized) return DEFAULT_BAND;
  if (MODEL_COST_BANDS[normalized]) return MODEL_COST_BANDS[normalized];

  if (/mini|nano|small/i.test(normalized)) return "low";
  if (/4\.1|4o-mini|3\.5/i.test(normalized)) return "medium";
  if (/5\.|o1|o3|sol|frontier/i.test(normalized)) return "high";

  return DEFAULT_BAND;
}

export function estimateOpenAiOperationCost({
  model,
  inputTokens = null,
  outputTokens = null,
  reasoningTokens = null,
}) {
  const costBand = resolveModelCostBand(model);
  const totalTokens =
    (Number(inputTokens) || 0) +
    (Number(outputTokens) || 0) +
    (Number(reasoningTokens) || 0);

  return {
    costBand,
    totalTokens: totalTokens || null,
    estimatedUsd: null,
  };
}

export function registerModelCostBand(model, band) {
  if (!model || !band) return;
  MODEL_COST_BANDS[model] = band;
}

export function getRegisteredModelCostBands() {
  return { ...MODEL_COST_BANDS };
}
