import { PROJECT_BRAIN_FAILURE_CODES, PROJECT_BRAIN_LIMITS, PROJECT_STEP_ALLOWED_TRANSITIONS } from "./constants.js";
import { generateProjectWorkflowWithModel } from "./generation.js";
import {
  getWorkflowBundle,
  persistGeneratedWorkflow,
  updateProjectBrainMeta,
  updateStepStatusOwned,
} from "./repository.js";
import { calculateWorkflowProgress } from "./progress.js";
import {
  buildWorkflowSummaryFromBundle,
  resolveNextAction,
} from "./next-action.js";
import { stepHasActionResult } from "./actions/service.js";
import { serializeActionPreviewFromStep } from "./actions/repository.js";
import { checkBrainRateLimit } from "./rate-limit.js";
import {
  isGenerationLocked,
  releaseGenerationLock,
  tryAcquireGenerationLock,
} from "./generation-lock.js";
import { ensureBrainSchema } from "./schema-bootstrap.js";
import { evaluateProjectSafety } from "../project-safety.js";

function mapFailureCode(reason) {
  if (reason === "timeout") return PROJECT_BRAIN_FAILURE_CODES.TIMEOUT;
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

export function serializeWorkflowBundle({ project, workflow, milestones, steps, progress, nextAction }) {
  return {
    brainStatus: project.brain_status,
    brainVersion: project.brain_version,
    brainGeneratedAt: project.brain_generated_at,
    brainFailureCode: project.brain_failure_code,
    brainAttemptCount: project.brain_attempt_count ?? 0,
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
}) {
  if (!project) {
    return { ok: false, code: "NOT_FOUND" };
  }

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
    const view = await getProjectWorkflowView({ baseUrl, secretKey, userId, project });
    return { ok: true, idempotent: true, view };
  }

  if (project.brain_status === "ready") {
    const view = await getProjectWorkflowView({ baseUrl, secretKey, userId, project });
    return { ok: true, idempotent: true, view };
  }

  if (project.brain_status === "generating" && !isStaleGenerating(project)) {
    if (existingBundle.workflow) {
      const view = await getProjectWorkflowView({ baseUrl, secretKey, userId, project });
      return { ok: true, idempotent: true, view };
    }

    return { ok: false, code: "GENERATION_IN_PROGRESS" };
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
    return { ok: false, code: "GENERATION_IN_PROGRESS" };
  }

  const nowIso = new Date().toISOString();

  try {
    const generatingUpdate = await updateProjectBrainMeta({
      baseUrl,
      secretKey,
      userId,
      projectId: project.id,
      columns: {
        brain_status: "generating",
        brain_attempt_count: attemptCount + 1,
        brain_failure_code: null,
        updated_at: nowIso,
      },
    });

    if (!generatingUpdate.ok) {
      return { ok: false, code: "INTERNAL" };
    }

    const generated = await generateProjectWorkflowWithModel({
      project,
      clarificationAnswers,
      fetchImpl,
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
      return { ok: false, code: "GENERATION_FAILED", failureCode: mapFailureCode(generated.reason) };
    }

    const persisted = await persistGeneratedWorkflow({
      baseUrl,
      secretKey,
      userId,
      projectId: project.id,
      generatedWorkflow: generated.workflow,
      brainVersion: generated.brainVersion,
      nowIso,
    });

    if (!persisted.ok) {
      if (persisted.reason === "workflow_already_exists") {
        const view = await getProjectWorkflowView({
          baseUrl,
          secretKey,
          userId,
          project: {
            ...project,
            brain_status: "ready",
            active_workflow_id: persisted.workflow?.id ?? project.active_workflow_id,
          },
        });
        return { ok: true, idempotent: true, view };
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
    const hasResult = await stepHasActionResult({
      baseUrl,
      secretKey,
      userId,
      stepId,
    });
    if (!hasResult) {
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
