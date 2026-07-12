export function resolveNextAction({ milestones, steps }) {
  const orderedMilestones = [...(milestones || [])].sort((a, b) => a.position - b.position);

  const inProgress = (steps || []).find((step) => step.status === "in_progress");
  if (inProgress) {
    return serializeNextAction(inProgress);
  }

  for (const milestone of orderedMilestones) {
    const milestoneSteps = (steps || [])
      .filter((step) => step.milestone_id === milestone.id)
      .sort((a, b) => a.position - b.position);

    const pending = milestoneSteps.find((step) => step.status === "pending");
    if (pending) {
      return serializeNextAction(pending);
    }
  }

  return null;
}

function serializeNextAction(step) {
  const tool =
    step.tool_id && step.tool_slug && step.tool_name && step.tool_category_slug
      ? {
          id: step.tool_id,
          slug: step.tool_slug,
          name: step.tool_name,
          categorySlug: step.tool_category_slug,
        }
      : null;

  return {
    stepId: step.id,
    milestoneId: step.milestone_id,
    title: step.title,
    description: step.description,
    expectedOutcome: step.expected_outcome,
    rationale: step.rationale || undefined,
    tool,
  };
}

export function buildWorkflowSummaryFromBundle({ progress, nextAction }) {
  return {
    completedSteps: progress.completedSteps,
    totalSteps: progress.totalSteps,
    progressPercent: progress.progressPercent,
    nextStep: nextAction
      ? {
          id: nextAction.stepId,
          title: nextAction.title,
          toolId: nextAction.tool?.id,
        }
      : null,
  };
}
