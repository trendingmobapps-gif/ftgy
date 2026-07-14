import { PROJECT_BRAIN_FAILURE_CODES, PROJECT_BRAIN_LIMITS, PROJECT_STEP_ALLOWED_TRANSITIONS } from "./constants.js";
import { generateProjectWorkflowWithModel } from "./generation.js";
import {
  getWorkflowBundle,
  persistGeneratedWorkflow,
  tryClaimProjectGeneration,
  updateProjectBrainMeta,
  updateStepStatusOwned,
  clearFailedWorkflowArtifacts,
} from "./repository.js";
import { calculateWorkflowProgress } from "./progress.js";
import {
  buildWorkflowSummaryFromBundle,
  resolveNextAction,
} from "./next-action.js";
import { getLatestAcceptedResultForStep } from "./actions/repository.js";
import { serializeActionPreviewFromStep } from "./actions/repository.js";
import { checkBrainRateLimit } from "./rate-limit.js";
import {
  isGenerationLocked,
  releaseGenerationLock,
  tryAcquireGenerationLock,
} from "./generation-lock.js";
import { ensureBrainSchema } from "./schema-bootstrap.js";
import { evaluateProjectSafety } from "../project-safety.js";
import { buildGenerationStatusPayload } from "./generation-status.js";
import {
  logRoadmapLifecycleFailure,
  logRoadmapLifecycleStage,
} from "./generation-lifecycle-log.js";
import { logRoadmapDuplicateGenerationWarning } from "./openai-usage-observability.js";
import { computeRoadmapEvidenceHash, extractRoadmapEvidenceHashFromBrainVersion } from "./openai-evidence-hash.js";
import { shouldReuseRoadmapGeneration } from "./openai-model-reuse.js";
import {
  buildBrainSnapshotFromBundle,
  evaluateRoadmapMaterialChange,
  loadBrainSnapshotFromMemory,
  persistBrainSnapshotToMemory,
  ensureBrainSnapshotForReadyWorkflow,
  isSnapshotOnlyPersistenceFailure,
  isSnapshotRecoveryEligible,
} from "./snapshot/index.js";
import { PROJECT_BRAIN_INTERNAL_CODES } from "./project-brain-internal-codes.js";
import { logBrainSnapshotEvent } from "./brain-snapshot-observability.js";
import { assertLazyActionDesignInvariant } from "./snapshot/lazy-action-design.js";

function mapFailureCode(reason) {
  if (reason === "timeout") return PROJECT_BRAIN_FAILURE_CODES.TIMEOUT;
  if (reason === "output_limit") return PROJECT_BRAIN_FAILURE_CODES.INVALID_OUTPUT;
  if (reason === "quota_exceeded") return PROJECT_BRAIN_FAILURE_CODES.PROVIDER_ERROR;
  if (reason === "auth_failed") return PROJECT_BRAIN_FAILURE_CODES.PROVIDER_ERROR;
  if (reason === "invalid_request") return PROJECT_BRAIN_FAILURE_CODES.INVALID_OUTPUT;
  if (reason === "safety_rejected") return PROJECT_BRAIN_FAILURE_CODES.SAFETY_REJECTED;
  if (
    reason === "provider_error" ||
    reason === "missing_api_key" ||
    reason === "invalid_provider_response"
  ) {
    return PROJECT_BRAIN_FAILURE_CODES.PROVIDER_ERROR;
  }
  if (
    reason === "workflow_insert_failed" ||
    reason === "milestone_insert_failed" ||
    reason === "step_insert_failed" ||
    reason === "brain_meta_update_failed"
  ) {
    return PROJECT_BRAIN_FAILURE_CODES.PERSISTENCE_ERROR;
  }
  return PROJECT_BRAIN_FAILURE_CODES.INVALID_OUTPUT;
}

function isStaleGenerating(project, now = Date.now()) {
  if (project.brain_status !== "generating") return false;
  const updatedAt = project.updated_at ? Date.parse(project.updated_at) : NaN;
  if (!Number.isFinite(updatedAt)) return true;
  return now - updatedAt > PROJECT_BRAIN_LIMITS.staleGeneratingMs;
}

export function hasReadyWorkflowBundle(bundle) {
  return Boolean(bundle?.workflow && bundle.workflow.status === "ready");
}

export function isProjectBrainReady(project, bundle) {
  if (project?.brain_status === "ready") return true;
  return hasReadyWorkflowBundle(bundle);
}

function findSerializedStep(view, stepId) {
  const milestones = view?.workflow?.milestones || [];
  for (const milestone of milestones) {
    const step = (milestone.steps || []).find((row) => row.id === stepId);
    if (step) return step;
  }
  return null;
}

export function serializeWorkflowBundle({ project, workflow, milestones, steps, progress, nextAction, runtimePhase = null }) {
  const bundle = { workflow, milestones, steps };
  const statusPayload = buildGenerationStatusPayload({
    project,
    bundle,
    milestones,
    steps,
    runtimePhase,
  });

  return {
    brainStatus: project.brain_status,
    brainVersion: project.brain_version,
    brainGeneratedAt: project.brain_generated_at,
    brainFailureCode: project.brain_failure_code,
    brainAttemptCount: project.brain_attempt_count ?? 0,
    generationStatus: statusPayload.generationStatus,
    workflowGenerated: statusPayload.workflowGenerated,
    milestonesCount: statusPayload.milestonesCount,
    stepsCount: statusPayload.stepsCount,
    ...(statusPayload.error ? { generationError: statusPayload.error } : {}),
    workflow: workflow
      ? {
          id: workflow.id,
          projectId: workflow.project_id,
          summary: workflow.summary,
          currentStage: workflow.current_stage,
          complexity: workflow.complexity,
          estimatedDurationLabel: workflow.estimated_duration_label,
          brainVersion: workflow.brain_version,
          generatedAt: workflow.generated_at,
          milestones: milestones
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((milestone) => ({
              id: milestone.id,
              title: milestone.title,
              description: milestone.description,
              position: milestone.position,
              status: milestone.status,
              steps: steps
                .filter((step) => step.milestone_id === milestone.id)
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((step) => ({
                  id: step.id,
                  milestoneId: step.milestone_id,
                  title: step.title,
                  description: step.description,
                  expectedOutcome: step.expected_outcome,
                  rationale: step.rationale,
                  position: step.position,
                  priority: step.priority,
                  estimatedEffortLabel: step.estimated_effort_label,
                  status: step.status,
                  completedAt: step.completed_at,
                  action: serializeActionPreviewFromStep(step, project),
                  tool:
                    step.tool_id && step.tool_name
                      ? {
                          id: step.tool_id,
                          slug: step.tool_slug,
                          name: step.tool_name,
                          categorySlug: step.tool_category_slug,
                        }
                      : null,
                })),
            })),
        }
      : null,
    progress,
    nextAction,
    summary: buildWorkflowSummaryFromBundle({ progress, nextAction }),
  };
}

export async function getProjectWorkflowView({
  baseUrl,
  secretKey,
  userId,
  project,
}) {
  const bundle = await getWorkflowBundle({
    baseUrl,
    secretKey,
    userId,
    projectId: project.id,
  });

  const progress = calculateWorkflowProgress(bundle.steps, bundle.milestones);
  const nextAction = bundle.workflow
    ? resolveNextAction({ project, milestones: bundle.milestones, steps: bundle.steps })
    : null;

  return serializeWorkflowBundle({
    project,
    workflow: bundle.workflow,
    milestones: bundle.milestones,
    steps: bundle.steps,
    progress,
    nextAction,
  });
}

export async function generateProjectWorkflow({
  baseUrl,
  secretKey,
  userId,
  project,
  clarificationAnswers,
  fetchImpl,
  logFn = console.log,
  forceRetry = false,
}) {
  if (!project) {
    return { ok: false, code: "NOT_FOUND" };
  }

  logRoadmapLifecycleStage(logFn, {
    stage: forceRetry ? "roadmap_regenerate_requested" : "roadmap_generation_started",
    projectId: project.id,
    generationStatus: project.brain_status === "failed" ? "failed" : "queued",
  });

  if (project.status === "archived") {
    return { ok: false, code: "ARCHIVED_READONLY" };
  }

  const schema = await ensureBrainSchema({ baseUrl, secretKey });
  if (!schema.ok) {
    return { ok: false, code: "INTERNAL" };
  }

  const existingBundle = await getWorkflowBundle({
    baseUrl,
    secretKey,
    userId,
    projectId: project.id,
  });

  if (hasReadyWorkflowBundle(existingBundle)) {
    const loadedSnapshot = await loadBrainSnapshotFromMemory({
      baseUrl,
      secretKey,
      userId,
      projectId: project.id,
    });
    const materialGate = evaluateRoadmapMaterialChange({
      project,
      clarificationAnswers,
      bundle: existingBundle,
      persistedEvidenceHash:
        loadedSnapshot.evidenceHash ||
        extractRoadmapEvidenceHashFromBrainVersion(existingBundle.workflow?.brain_version),
    });
    const reuseDecision = shouldReuseRoadmapGeneration({
      project,
      clarificationAnswers,
      bundle: existingBundle,
    });

    const snapshotEnsure = await ensureBrainSnapshotForReadyWorkflow({
      baseUrl,
      secretKey,
      userId,
      project,
      bundle: existingBundle,
      clarificationAnswers,
      logFn,
      existingSnapshot: loadedSnapshot.snapshot,
    });

    logRoadmapDuplicateGenerationWarning(logFn, {
      projectId: project.id,
      brainStatus: project.brain_status,
      reason: reuseDecision.reason || materialGate.reason || "workflow_ready",
    });
    logBrainSnapshotEvent(logFn, {
      projectId: project.id,
      reuseHit: materialGate.reuseHit === true,
      reuseReason: materialGate.reason,
      materialChangeDetected: materialGate.materialChange === true,
      generationTriggered: false,
      persistenceSucceeded: snapshotEnsure.ok,
    });

    if (!snapshotEnsure.ok && isSnapshotOnlyPersistenceFailure(project, existingBundle)) {
      return {
        ok: false,
        code: "GENERATION_FAILED",
        failureCode: PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR,
        internalCode: snapshotEnsure.code,
      };
    }

    const view = await getProjectWorkflowView({
      baseUrl,
      secretKey,
      userId,
      project: snapshotEnsure.ok ? snapshotEnsure.project || project : project,
    });
    return {
      ok: true,
      idempotent: true,
      snapshotRecovered: snapshotEnsure.recovered === true,
      snapshotPersistPending: !snapshotEnsure.ok,
      view,
      evidenceHash: reuseDecision.evidenceHash || materialGate.currentHash || snapshotEnsure.roadmapEvidenceHash || null,
    };
  }

  if (project.brain_status === "ready") {
    logRoadmapDuplicateGenerationWarning(logFn, {
      projectId: project.id,
      brainStatus: project.brain_status,
      reason: "brain_ready",
    });
    const view = await getProjectWorkflowView({ baseUrl, secretKey, userId, project });
    return { ok: true, idempotent: true, view };
  }

  if (forceRetry && project.brain_status === "failed") {
    const retryBundle = await getWorkflowBundle({
      baseUrl,
      secretKey,
      userId,
      projectId: project.id,
    });
    if (isSnapshotOnlyPersistenceFailure(project, retryBundle) || isSnapshotRecoveryEligible(retryBundle)) {
      const recovery = await ensureBrainSnapshotForReadyWorkflow({
        baseUrl,
        secretKey,
        userId,
        project,
        bundle: retryBundle,
        clarificationAnswers,
        logFn,
      });
      if (recovery.ok) {
        const view = await getProjectWorkflowView({
          baseUrl,
          secretKey,
          userId,
          project: recovery.project || project,
        });
        return { ok: true, idempotent: true, snapshotRecovered: true, view };
      }
      if (isSnapshotOnlyPersistenceFailure(project, retryBundle)) {
        return {
          ok: false,
          code: "GENERATION_FAILED",
          failureCode: PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR,
          internalCode: recovery.code,
        };
      }
    }
    await clearFailedWorkflowArtifacts({
      baseUrl,
      secretKey,
      userId,
      projectId: project.id,
    });
    project = {
      ...project,
      brain_status: "pending",
      brain_failure_code: null,
    };
  }

  if (project.brain_status === "generating" && !isStaleGenerating(project)) {
    if (existingBundle.workflow) {
      logRoadmapDuplicateGenerationWarning(logFn, {
        projectId: project.id,
        brainStatus: project.brain_status,
        reason: "generating_with_workflow",
      });
      const view = await getProjectWorkflowView({ baseUrl, secretKey, userId, project });
      return { ok: true, idempotent: true, view };
    }

    logRoadmapDuplicateGenerationWarning(logFn, {
      projectId: project.id,
      brainStatus: project.brain_status,
      reason: "generating_in_progress",
    });
    return { ok: false, code: "GENERATION_IN_PROGRESS" };
  }

  if (project.brain_status === "generating" && isStaleGenerating(project)) {
    await updateProjectBrainMeta({
      baseUrl,
      secretKey,
      userId,
      projectId: project.id,
      columns: {
        brain_status: "pending",
        updated_at: new Date().toISOString(),
      },
    });
    project = { ...project, brain_status: "pending" };
  }

  const attemptCount = Number(project.brain_attempt_count || 0);
  if (attemptCount >= PROJECT_BRAIN_LIMITS.maxAttempts) {
    return { ok: false, code: "GENERATION_LIMIT" };
  }

  const rate = checkBrainRateLimit(userId);
  if (!rate.allowed) {
    return { ok: false, code: "RATE_LIMITED" };
  }

  const safetyDecision = await evaluateProjectSafety({
    goal: project.goal,
    name: project.name,
    description: project.description,
  });

  if (safetyDecision.status === "blocked") {
    return { ok: false, code: "SAFETY_BLOCKED" };
  }

  if (!tryAcquireGenerationLock(project.id)) {
    logRoadmapDuplicateGenerationWarning(logFn, {
      projectId: project.id,
      brainStatus: project.brain_status,
      reason: "in_memory_lock",
    });
    return { ok: false, code: "GENERATION_IN_PROGRESS" };
  }

  const nowIso = new Date().toISOString();
  const claimStatuses = forceRetry && project.brain_status === "failed" ? ["pending", "failed"] : ["pending"];

  try {
    const claim = await tryClaimProjectGeneration({
      baseUrl,
      secretKey,
      userId,
      projectId: project.id,
      nextAttemptCount: attemptCount + 1,
      allowedStatuses: claimStatuses,
    });

    if (!claim.claimed) {
      logRoadmapDuplicateGenerationWarning(logFn, {
        projectId: project.id,
        brainStatus: project.brain_status,
        reason: "generation_claim_lost",
      });
      releaseGenerationLock(project.id);
      if (project.brain_status === "generating" && !isStaleGenerating(project)) {
        return { ok: false, code: "GENERATION_IN_PROGRESS" };
      }
      const view = await getProjectWorkflowView({ baseUrl, secretKey, userId, project });
      return { ok: true, idempotent: true, view };
    }

    if (claim.project) {
      project = { ...project, ...claim.project };
    }

    const generated = await generateProjectWorkflowWithModel({
      project,
      clarificationAnswers,
      fetchImpl,
      logFn,
    });

    if (!generated.ok) {
      await updateProjectBrainMeta({
        baseUrl,
        secretKey,
        userId,
        projectId: project.id,
        columns: {
          brain_status: "failed",
          brain_failure_code: mapFailureCode(generated.reason),
          updated_at: nowIso,
        },
      });
      logRoadmapLifecycleFailure(logFn, {
        stage: "roadmap_generation_failed",
        projectId: project.id,
        model: generated.model || null,
        generationStatus: "failed",
        errorCode: mapFailureCode(generated.reason),
        error: {
          name: "GenerationFailed",
          message: generated.reason || "generation_failed",
        },
      });
      return { ok: false, code: "GENERATION_FAILED", failureCode: mapFailureCode(generated.reason) };
    }

    const lazyInvariant = assertLazyActionDesignInvariant({
      roadmapGeneration: true,
      stepCount: generated.workflow?.milestones?.reduce(
        (total, milestone) => total + milestone.steps.length,
        0,
      ) || 0,
      generatedActionDesignCount: 0,
    });
    if (!lazyInvariant.ok) {
      return { ok: false, code: "GENERATION_FAILED", failureCode: PROJECT_BRAIN_FAILURE_CODES.INVALID_OUTPUT };
    }

    logRoadmapLifecycleStage(logFn, {
      stage: "workflow_persist_started",
      projectId: project.id,
      model: generated.model || null,
      generationStatus: "persisting",
      milestonesCount: generated.workflow.milestones.length,
      stepsCount: generated.workflow.milestones.reduce(
        (total, milestone) => total + milestone.steps.length,
        0,
      ),
    });

    const roadmapEvidenceHash = computeRoadmapEvidenceHash({ project, clarificationAnswers });
    const persisted = await persistGeneratedWorkflow({
      baseUrl,
      secretKey,
      userId,
      projectId: project.id,
      generatedWorkflow: generated.workflow,
      brainVersion: generated.brainVersion,
      evidenceHash: roadmapEvidenceHash,
      nowIso,
    });

    if (!persisted.ok) {
      if (persisted.reason === "workflow_already_exists") {
        const existingAfterRace = await getWorkflowBundle({
          baseUrl,
          secretKey,
          userId,
          projectId: project.id,
        });
        const snapshotEnsure = await ensureBrainSnapshotForReadyWorkflow({
          baseUrl,
          secretKey,
          userId,
          project,
          bundle: existingAfterRace,
          clarificationAnswers,
          logFn,
        });
        const view = await getProjectWorkflowView({
          baseUrl,
          secretKey,
          userId,
          project: snapshotEnsure.project || {
            ...project,
            brain_status: "ready",
            active_workflow_id: persisted.workflow?.id ?? project.active_workflow_id,
          },
        });
        return {
          ok: true,
          idempotent: true,
          snapshotRecovered: snapshotEnsure.recovered === true,
          view,
        };
      }

      await updateProjectBrainMeta({
        baseUrl,
        secretKey,
        userId,
        projectId: project.id,
        columns: {
          brain_status: "failed",
          brain_failure_code: mapFailureCode(persisted.reason),
          updated_at: nowIso,
        },
      });
      return { ok: false, code: "GENERATION_FAILED", failureCode: mapFailureCode(persisted.reason) };
    }

    logRoadmapLifecycleStage(logFn, {
      stage: "workflow_persist_succeeded",
      projectId: project.id,
      generationStatus: "ready",
      milestonesCount: persisted.milestones.length,
      stepsCount: persisted.steps.length,
      workflowGenerated: true,
    });
    logRoadmapLifecycleStage(logFn, {
      stage: "milestones_persist_succeeded",
      projectId: project.id,
      milestonesCount: persisted.milestones.length,
    });
    logRoadmapLifecycleStage(logFn, {
      stage: "steps_persist_succeeded",
      projectId: project.id,
      stepsCount: persisted.steps.length,
    });

    const snapshotBundle = {
      workflow: persisted.workflow,
      milestones: persisted.milestones,
      steps: persisted.steps,
    };
    const snapshot = buildBrainSnapshotFromBundle({
      project,
      bundle: snapshotBundle,
      clarificationAnswers,
      roadmapEvidenceHash,
      generatedWorkflow: generated.workflow,
    });
    const snapshotPersisted = await persistBrainSnapshotToMemory({
      baseUrl,
      secretKey,
      userId,
      projectId: project.id,
      snapshot,
      logFn,
    });

    if (!snapshotPersisted.ok) {
      await updateProjectBrainMeta({
        baseUrl,
        secretKey,
        userId,
        projectId: project.id,
        columns: {
          brain_status: "failed",
          brain_failure_code: PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR,
          updated_at: nowIso,
        },
      });
      return {
        ok: false,
        code: "GENERATION_FAILED",
        failureCode: PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR,
        internalCode: snapshotPersisted.code || PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_PERSIST_FAILED,
      };
    }

    const view = await getProjectWorkflowView({
      baseUrl,
      secretKey,
      userId,
      project: persisted.project,
    });

    return { ok: true, idempotent: false, view };
  } finally {
    releaseGenerationLock(project.id);
  }
}

export async function regenerateProjectWorkflow(input) {
  return generateProjectWorkflow({
    ...input,
    forceRetry: true,
  });
}

export function validateStepStatusTransition(currentStatus, targetStatus) {
  const allowed = PROJECT_STEP_ALLOWED_TRANSITIONS[currentStatus] || [];
  return allowed.includes(targetStatus);
}

export async function mutateProjectStepStatus({
  baseUrl,
  secretKey,
  userId,
  project,
  stepId,
  targetStatus,
  allowWithoutResultCheck = false,
}) {
  if (!project) {
    return { ok: false, code: "NOT_FOUND" };
  }

  if (project.status === "archived") {
    return { ok: false, code: "ARCHIVED_READONLY" };
  }

  const bundle = await getWorkflowBundle({
    baseUrl,
    secretKey,
    userId,
    projectId: project.id,
  });

  if (!isProjectBrainReady(project, bundle)) {
    return {
      ok: false,
      code: "VALIDATION",
      reason: "brain_not_ready",
      details: {
        brainStatus: project.brain_status ?? null,
        hasWorkflow: Boolean(bundle.workflow),
        workflowStatus: bundle.workflow?.status ?? null,
      },
    };
  }

  const step = bundle.steps.find((row) => row.id === stepId);
  if (!step) {
    return { ok: false, code: "NOT_FOUND" };
  }

  if (!validateStepStatusTransition(step.status, targetStatus)) {
    return {
      ok: false,
      code: "VALIDATION",
      reason: "invalid_transition",
      details: {
        currentStatus: step.status,
        targetStatus,
      },
    };
  }

  if (targetStatus === "completed" && !allowWithoutResultCheck) {
    const latest = await getLatestAcceptedResultForStep({
      baseUrl,
      secretKey,
      userId,
      stepId,
    });
    if (!latest.result) {
      return { ok: false, code: "RESULT_REQUIRED" };
    }
  }

  const updated = await updateStepStatusOwned({
    baseUrl,
    secretKey,
    userId,
    projectId: project.id,
    stepId,
    targetStatus,
  });

  if (!updated.ok) {
    return { ok: false, code: "INTERNAL" };
  }

  const progress = calculateWorkflowProgress(updated.steps, updated.milestones);
  const nextAction = resolveNextAction({
    project,
    milestones: updated.milestones,
    steps: updated.steps,
  });

  const view = serializeWorkflowBundle({
    project,
    workflow: updated.workflow,
    milestones: updated.milestones,
    steps: updated.steps,
    progress,
    nextAction,
  });

  const serializedStep = findSerializedStep(view, stepId);

  return {
    ok: true,
    view,
    updatedStepId: stepId,
    step: serializedStep,
    progress: view.progress,
    nextAction: view.nextAction,
  };
}
