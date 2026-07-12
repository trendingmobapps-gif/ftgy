/**
 * Progress is derived only from persisted step statuses.
 * Skipped steps are excluded from both numerator and denominator.
 */
export function calculateWorkflowProgress(steps, milestones = []) {
  const countableSteps = (steps || []).filter((step) => step.status !== "skipped");
  const completedSteps = countableSteps.filter((step) => step.status === "completed").length;
  const totalSteps = countableSteps.length;
  const progressPercent =
    totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);

  const milestoneRows = milestones || [];
  const completedMilestones = milestoneRows.filter((m) => m.status === "completed").length;
  const totalMilestones = milestoneRows.length;

  return {
    completedSteps,
    totalSteps,
    progressPercent,
    completedMilestones,
    totalMilestones,
  };
}

export function deriveMilestoneStatus(stepsForMilestone) {
  const steps = stepsForMilestone || [];
  if (steps.length === 0) return "pending";

  const active = steps.filter((s) => s.status !== "skipped");
  if (active.length === 0) return "pending";
  if (active.every((s) => s.status === "completed")) return "completed";
  if (active.some((s) => s.status === "in_progress" || s.status === "completed")) {
    return "in_progress";
  }

  return "pending";
}
