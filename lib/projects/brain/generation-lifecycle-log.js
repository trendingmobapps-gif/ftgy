function safeError(error) {
  if (!error) return null;
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    code: error.code || null,
    httpStatus: error.httpStatus ?? error.status ?? null,
    providerStatus: error.providerStatus ?? null,
    stack: typeof error.stack === "string" ? error.stack.split("\n").slice(0, 6).join("\n") : null,
  };
}

export function logRoadmapLifecycleStage(logFn, input) {
  if (typeof logFn !== "function") return;

  const payload = {
    event: "project_roadmap_lifecycle",
    stage: input.stage,
    projectId: input.projectId || null,
    model: input.model || null,
    reasoningEffort: input.reasoningEffort || null,
    usedFallback: Boolean(input.usedFallback),
    fallbackAttempted: Boolean(input.fallbackAttempted),
    transport: input.transport || null,
    generationStatus: input.generationStatus || null,
    milestonesCount: input.milestonesCount ?? null,
    stepsCount: input.stepsCount ?? null,
    workflowGenerated: input.workflowGenerated ?? null,
    responseId: input.responseId || null,
    outputItemCount: input.outputItemCount ?? null,
    outputTextExists: input.outputTextExists ?? null,
    parsedJsonExists: input.parsedJsonExists ?? null,
    refusalExists: input.refusalExists ?? null,
    incompleteReason: input.incompleteReason || null,
    httpStatus: input.httpStatus ?? null,
    providerStatus: input.providerStatus ?? null,
    errorCode: input.errorCode || null,
    error: input.error ? safeError(input.error) : null,
  };

  logFn(payload);
}

export function logRoadmapLifecycleFailure(logFn, input) {
  logRoadmapLifecycleStage(logFn, {
    ...input,
    stage: input.stage || "roadmap_generation_failed",
  });
}
