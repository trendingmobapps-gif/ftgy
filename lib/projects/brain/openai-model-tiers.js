export const MODEL_TIER = {
  FRONTIER: "frontier",
  EFFICIENT: "efficient",
  DETERMINISTIC: "deterministic",
};

export const DEFAULT_FRONTIER_MODEL = "gpt-5.6-sol";
export const DEFAULT_EFFICIENT_MODEL = "gpt-4.1-mini";
export const DEFAULT_CHAT_FALLBACK_MODEL = "gpt-4.1";

export function resolveFrontierModel() {
  return (
    process.env.PROJECT_FRONTIER_MODEL?.trim() ||
    process.env.PROJECT_ROADMAP_MODEL?.trim() ||
    process.env.PROJECT_BRAIN_MODEL?.trim() ||
    DEFAULT_FRONTIER_MODEL
  );
}

export function resolveEfficientModel() {
  return (
    process.env.PROJECT_EFFICIENT_MODEL?.trim() ||
    process.env.PROJECT_INTENT_MODEL?.trim() ||
    DEFAULT_EFFICIENT_MODEL
  );
}

export function resolveChatFallbackModel(primaryModel) {
  const configured = process.env.PROJECT_ROADMAP_FALLBACK_MODEL?.trim();
  const legacy = process.env.PROJECT_BRAIN_MODEL?.trim();
  const candidates = [configured, legacy, DEFAULT_CHAT_FALLBACK_MODEL].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate !== primaryModel) {
      return candidate;
    }
  }
  return DEFAULT_CHAT_FALLBACK_MODEL;
}

export function isFrontierModel(model) {
  const frontier = resolveFrontierModel();
  return model === frontier || model === DEFAULT_FRONTIER_MODEL;
}
