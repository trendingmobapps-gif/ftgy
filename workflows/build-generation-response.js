import { TOOLS } from "../tools/tools-config.js";
import { resolveGeneratedNextAction } from "../workflows/resolve-next-action.js";

/**
 * Builds workflow recommendation fields for a successful generation response.
 * Kept separate from AI generation so contract tests can run without paid calls.
 */
export function buildWorkflowRecommendationFields({
  toolId,
  categorySlug,
  workflowContext,
}) {
  try {
    const recommendation = resolveGeneratedNextAction({
      toolSlug: toolId,
      categorySlug,
      workflowContext,
      getToolConfig: (slug) => TOOLS[slug] || null,
    });

    return {
      nextAction: recommendation.nextAction,
      workflowCompletion: recommendation.workflowCompletion,
      workflowMetadata: recommendation.workflowMetadata,
    };
  } catch (error) {
    console.warn("[workflow] next action resolution failed", {
      toolSlug: toolId,
      message: error?.message,
    });

    return {
      nextAction: null,
      workflowCompletion: null,
      workflowMetadata: null,
    };
  }
}

export function buildSuccessfulGenerationResponse({
  toolId,
  result,
  categorySlug,
  workflowContext,
}) {
  const tool = TOOLS[toolId];

  return {
    success: true,
    toolId,
    result,
    ...buildWorkflowRecommendationFields({
      toolId,
      categorySlug: categorySlug || tool?.categorySlug,
      workflowContext,
    }),
  };
}
