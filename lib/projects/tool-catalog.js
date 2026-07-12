import { TOOLS } from "../../tools/tools-config.js";

let cachedIndex = null;

export function getProjectToolCatalogIndex() {
  if (cachedIndex) {
    return cachedIndex;
  }

  const byId = new Map();
  const byCategory = new Map();

  for (const [toolId, tool] of Object.entries(TOOLS)) {
    if (!tool || typeof tool !== "object") {
      continue;
    }

    const categorySlug = typeof tool.categorySlug === "string" ? tool.categorySlug : "";
    const name = typeof tool.name === "string" ? tool.name : toolId;
    const entry = { toolId, categorySlug, name };

    byId.set(toolId, entry);

    if (!byCategory.has(categorySlug)) {
      byCategory.set(categorySlug, []);
    }
    byCategory.get(categorySlug).push(entry);
  }

  cachedIndex = { byId, byCategory };
  return cachedIndex;
}

export function buildCategoryToolSummary(categorySlug, limit = 12) {
  const { byCategory } = getProjectToolCatalogIndex();
  const tools = byCategory.get(categorySlug) || [];
  return tools.slice(0, limit).map((tool) => ({
    toolId: tool.toolId,
    name: tool.name,
  }));
}

export function resolveRecommendedToolId({ categorySlug, candidateToolId }) {
  if (!candidateToolId || typeof candidateToolId !== "string") {
    return null;
  }

  const trimmed = candidateToolId.trim();
  if (!trimmed) {
    return null;
  }

  const { byId } = getProjectToolCatalogIndex();
  const tool = byId.get(trimmed);
  if (!tool || tool.categorySlug !== categorySlug) {
    return null;
  }

  return tool.toolId;
}

export function resetProjectToolCatalogIndexForTests() {
  cachedIndex = null;
}
