import { TOOLS } from "../../../tools/tools-config.js";
import { getProjectToolCatalogIndex } from "../tool-catalog.js";

function normalizeCandidate(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function scoreToolMatch(candidate, tool) {
  const normalizedCandidate = normalizeCandidate(candidate);
  if (!normalizedCandidate) return 0;

  const id = normalizeCandidate(tool.toolId);
  const name = normalizeCandidate(tool.name);

  if (id === normalizedCandidate) return 100;
  if (name === normalizedCandidate) return 95;
  if (id.includes(normalizedCandidate) || normalizedCandidate.includes(id)) return 80;
  if (name.includes(normalizedCandidate) || normalizedCandidate.includes(name)) return 70;

  const candidateTokens = normalizedCandidate.split(/[\s-_]+/).filter(Boolean);
  const nameTokens = name.split(/[\s-_]+/).filter(Boolean);
  const overlap = candidateTokens.filter((token) => nameTokens.includes(token)).length;
  return overlap > 0 ? overlap * 10 : 0;
}

export function resolveBrainTool(candidateToolId, { stepTitle, stepDescription } = {}) {
  if (!candidateToolId || typeof candidateToolId !== "string") {
    return null;
  }

  const trimmed = candidateToolId.trim();
  if (!trimmed) return null;

  const { byId } = getProjectToolCatalogIndex();
  const direct = byId.get(trimmed);
  if (direct) {
    const tool = TOOLS[direct.toolId];
    return {
      toolId: direct.toolId,
      toolSlug: direct.toolId,
      toolName: direct.name,
      toolCategorySlug: direct.categorySlug,
    };
  }

  const context = `${stepTitle || ""} ${stepDescription || ""}`.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const [toolId, tool] of Object.entries(TOOLS)) {
    const baseScore = scoreToolMatch(trimmed, { toolId, name: tool.name });
    let score = baseScore;

    if (context && tool.name) {
      const nameTokens = tool.name.toLowerCase().split(/[\s-_]+/).filter(Boolean);
      const contextOverlap = nameTokens.filter((token) => context.includes(token)).length;
      score += contextOverlap * 3;
    }

    if (score > bestScore) {
      bestScore = score;
      best = tool;
    }
  }

  if (!best || bestScore < 40) {
    return null;
  }

  return {
    toolId: best.toolId,
    toolSlug: best.toolId,
    toolName: best.name,
    toolCategorySlug: best.categorySlug,
  };
}

export function attachResolvedToolsToWorkflow(workflow) {
  const milestones = workflow.milestones.map((milestone) => ({
    ...milestone,
    steps: milestone.steps.map((step) => {
      const resolved = resolveBrainTool(step.recommendedToolId, {
        stepTitle: step.title,
        stepDescription: step.description,
      });

      return {
        ...step,
        tool: resolved,
      };
    }),
  }));

  return { ...workflow, milestones };
}

export function buildToolCatalogSummaryForPrompt(limitPerCategory = 8) {
  const { byCategory } = getProjectToolCatalogIndex();
  const summary = [];

  for (const [, tools] of byCategory) {
    for (const tool of tools.slice(0, limitPerCategory)) {
      summary.push({
        toolId: tool.toolId,
        categorySlug: tool.categorySlug,
        name: tool.name,
      });
    }
  }

  return summary;
}
