function hasReadyWorkflowBundle(bundle) {
  return Boolean(bundle?.workflow && bundle.workflow.status === "ready");
}

export const PROJECT_GENERATION_STATUSES = [
  "queued",
  "generating",
  "validating",
  "persisting",
  "ready",
  "failed",
];

export function resolveGenerationStatus({
  project,
  bundle,
  milestones = [],
  steps = [],
  runtimePhase = null,
}) {
  if (runtimePhase && PROJECT_GENERATION_STATUSES.includes(runtimePhase)) {
    return runtimePhase;
  }

  const brainStatus = project?.brain_status || "pending";
  const milestonesCount = Array.isArray(milestones) ? milestones.length : 0;
  const stepsCount = Array.isArray(steps) ? steps.length : 0;
  const workflowReady = hasReadyWorkflowBundle(bundle);

  if (brainStatus === "failed") {
    return "failed";
  }

  if (workflowReady && milestonesCount > 0 && stepsCount > 0 && brainStatus === "ready") {
    return "ready";
  }

  if (brainStatus === "generating") {
    return "generating";
  }

  return "queued";
}

export function buildGenerationStatusPayload({
  project,
  bundle,
  milestones = [],
  steps = [],
  runtimePhase = null,
  error = null,
}) {
  const generationStatus = resolveGenerationStatus({
    project,
    bundle,
    milestones,
    steps,
    runtimePhase,
  });

  const milestonesCount = Array.isArray(milestones) ? milestones.length : 0;
  const stepsCount = Array.isArray(steps) ? steps.length : 0;
  const workflowGenerated =
    generationStatus === "ready" && Boolean(bundle?.workflow) && milestonesCount > 0 && stepsCount > 0;

  const payload = {
    generationStatus,
    workflowGenerated,
    milestonesCount,
    stepsCount,
  };

  if (generationStatus === "failed") {
    payload.error = {
      code: "PROJECT_ROADMAP_GENERATION_FAILED",
      message: "Planul proiectului nu a putut fi generat.",
      failureCode: project?.brain_failure_code || error?.failureCode || null,
    };
  }

  return payload;
}
