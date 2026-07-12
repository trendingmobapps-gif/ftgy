import { serializeActionPreviewFromStep } from "./actions/repository.js";
import { buildWhyItMatters } from "./actions/context-builder.js";

export function resolveNextAction({ project, milestones, steps }) {
  const orderedMilestones = [...(milestones || [])].sort((a, b) => a.position - b.position);

  const inProgress = (steps || []).find((step) => step.status === "in_progress");
  if (inProgress) {
    return serializeNextAction(inProgress, project);
  }

  for (const milestone of orderedMilestones) {
    const milestoneSteps = (steps || [])
      .filter((step) => step.milestone_id === milestone.id)
      .sort((a, b) => a.position - b.position);

    const pending = milestoneSteps.find((step) => step.status === "pending");
    if (pending) {
      return serializeNextAction(pending, project);
    }
  }

  return null;
}

function serializeNextAction(step, project) {
  const action = serializeActionPreviewFromStep(step, project);
  if (!action.whyItMatters && project) {
    action.whyItMatters = buildWhyItMatters({ step, project });
  }

  return {
    stepId: step.id,
    milestoneId: step.milestone_id,
    title: step.title,
    description: step.description,
    expectedOutcome: step.expected_outcome,
    rationale: step.rationale || undefined,
    action,
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
          actionId: nextAction.action?.actionId || null,
        }
      : null,
  };
}
