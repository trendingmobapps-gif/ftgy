export function logBrainSnapshotEvent(logFn, input = {}) {
  if (typeof logFn !== "function") return;

  logFn({
    event: "project_brain_snapshot",
    projectId: input.projectId || null,
    workflowId: input.workflowId || null,
    stepId: input.stepId || null,
    actionId: input.actionId || null,
    artifactType: input.artifactType || "brain_snapshot",
    artifactVersion: input.artifactVersion ?? null,
    evidenceHash: input.evidenceHash ? String(input.evidenceHash).slice(0, 16) : null,
    reuseHit: Boolean(input.reuseHit),
    reuseReason: input.reuseReason || null,
    generationTriggered: Boolean(input.generationTriggered),
    materialChangeDetected: Boolean(input.materialChangeDetected),
    affectedStepCount: input.affectedStepCount ?? null,
    persistenceSucceeded: input.persistenceSucceeded ?? null,
    modelRole: input.modelRole || null,
    modelTier: input.modelTier || null,
    providerCallCount: input.providerCallCount ?? null,
    internalErrorCode: input.internalErrorCode || null,
  });

  if (input.warning === "strategic_generation_on_read_operation") {
    logFn({
      event: "project_brain_snapshot_warning",
      warning: "strategic_generation_on_read_operation",
      projectId: input.projectId || null,
      endpoint: input.endpoint || null,
    });
  }

  if (input.warning === "roadmap_regenerated_unchanged_evidence") {
    logFn({
      event: "project_brain_snapshot_warning",
      warning: "roadmap_regenerated_unchanged_evidence",
      projectId: input.projectId || null,
      evidenceHash: input.evidenceHash ? String(input.evidenceHash).slice(0, 16) : null,
    });
  }

  if (input.warning === "action_design_regenerated_unchanged_evidence") {
    logFn({
      event: "project_brain_snapshot_warning",
      warning: "action_design_regenerated_unchanged_evidence",
      projectId: input.projectId || null,
      stepId: input.stepId || null,
      actionId: input.actionId || null,
    });
  }

  if (input.warning === "artifact_missing_after_model_success") {
    logFn({
      event: "project_brain_snapshot_warning",
      warning: "artifact_missing_after_model_success",
      projectId: input.projectId || null,
      artifactType: input.artifactType || null,
    });
  }

  if (input.warning === "full_roadmap_when_localized_sufficient") {
    logFn({
      event: "project_brain_snapshot_warning",
      warning: "full_roadmap_when_localized_sufficient",
      projectId: input.projectId || null,
      affectedStepCount: input.affectedStepCount ?? null,
    });
  }

  if (input.warning === "duplicate_result_generation_attempt") {
    logFn({
      event: "project_brain_snapshot_warning",
      warning: "duplicate_result_generation_attempt",
      projectId: input.projectId || null,
      actionId: input.actionId || null,
    });
  }
}

export function logBrainSnapshotPersistenceFailure(logFn, input = {}) {
  if (typeof logFn !== "function") return;

  logFn({
    event: "project_brain_snapshot_persistence_failure",
    operation: input.operation || null,
    projectId: input.projectId || null,
    memoryKey: input.memoryKey || null,
    httpStatus: input.httpStatus ?? null,
    supabaseErrorCode: input.supabaseErrorCode || null,
    supabaseErrorMessage: input.supabaseErrorMessage || null,
    errorCategory: input.errorCategory || null,
    payloadByteLength: input.payloadByteLength ?? null,
    serializationSucceeded: input.serializationSucceeded ?? null,
    writeAttempted: input.writeAttempted ?? null,
    writeMayHaveSucceeded: input.writeMayHaveSucceeded ?? null,
    readBackFailed: input.readBackFailed ?? null,
    resolvedSource: input.resolvedSource || null,
  });
}
