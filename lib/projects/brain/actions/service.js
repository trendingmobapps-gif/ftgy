import { getWorkflowBundle } from "../repository.js";
import { mutateProjectStepStatus, isProjectBrainReady } from "../service.js";
import { buildActionPreparation, buildResultPreview, buildResultTitle } from "./prompt-builder.js";
import { executePreparedAction } from "./generation.js";
import {
  getActionByStepId,
  getLatestResultForStep,
  getResultsForProject,
  insertActionResult,
  serializeActionPreviewFromStep,
  serializeActionResultRow,
  serializeActionRow,
  updateActionStatus,
  upsertPreparedAction,
} from "./repository.js";

async function loadOwnedStepContext({ baseUrl, secretKey, userId, project, projectId, stepId }) {
  if (!project || project.status === "archived") {
    return { ok: false, code: project ? "ARCHIVED_READONLY" : "NOT_FOUND" };
  }

  const bundle = await getWorkflowBundle({ baseUrl, secretKey, userId, projectId });
  if (!isProjectBrainReady(project, bundle)) {
    return { ok: false, code: "STEP_NOT_ACTIONABLE" };
  }

  const step = bundle.steps.find((row) => row.id === stepId);
  if (!step || step.project_id !== projectId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const milestone = bundle.milestones.find((row) => row.id === step.milestone_id) || null;
  return { ok: true, bundle, step, milestone };
}

async function buildResultsMap({ baseUrl, secretKey, userId, projectId, steps }) {
  const results = await getResultsForProject({ baseUrl, secretKey, userId, projectId });
  const map = new Map();
  if (results.ok) {
    for (const row of results.results) {
      if (!map.has(row.step_id)) {
        map.set(row.step_id, row);
      }
    }
  }
  return map;
}

export async function prepareProjectAction({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
}) {
  const loaded = await loadOwnedStepContext({
    baseUrl,
    secretKey,
    userId,
    project,
    projectId,
    stepId,
  });

  if (!loaded.ok) {
    return loaded;
  }

  const { bundle, step, milestone } = loaded;
  if (step.status === "completed" || step.status === "skipped") {
    return { ok: false, code: "STEP_NOT_ACTIONABLE" };
  }

  const resultsByStepId = await buildResultsMap({
    baseUrl,
    secretKey,
    userId,
    projectId,
    steps: bundle.steps,
  });

  const preparation = buildActionPreparation({
    project,
    workflow: bundle.workflow,
    milestone,
    step,
    steps: bundle.steps,
    resultsByStepId,
  });

  const saved = await upsertPreparedAction({
    baseUrl,
    secretKey,
    userId,
    preparation,
    step,
    workflow: bundle.workflow,
  });

  if (!saved.ok || !saved.action) {
    return { ok: false, code: "INTERNAL" };
  }

  return {
    ok: true,
    action: serializeActionRow(saved.action),
    preparation,
  };
}

export async function executeProjectAction({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
  actionId,
  acceptedInput = {},
  fetchImpl,
}) {
  const loaded = await loadOwnedStepContext({
    baseUrl,
    secretKey,
    userId,
    project,
    projectId,
    stepId,
  });

  if (!loaded.ok) {
    return loaded;
  }

  const { bundle, step } = loaded;
  if (step.status === "completed" || step.status === "skipped") {
    return { ok: false, code: "STEP_NOT_ACTIONABLE" };
  }

  const actionRow = await getActionByStepId({ baseUrl, secretKey, userId, stepId });
  if (!actionRow.action || actionRow.action.id !== actionId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const preparation = {
    capabilityType: actionRow.action.capability_type,
    capabilityRef: actionRow.action.capability_ref,
    preparedPrompt: actionRow.action.prepared_prompt,
    preparedInput: actionRow.action.prepared_input || {},
    context: {
      project: {
        name: project.name,
        goal: project.goal,
        categorySlug: project.category_slug,
      },
      step: {
        title: step.title,
        expectedOutcome: step.expected_outcome,
        description: step.description,
      },
      completedSteps: [],
    },
  };

  const inProgress = await updateActionStatus({
    baseUrl,
    secretKey,
    userId,
    actionId,
    status: "in_progress",
  });

  if (!inProgress.ok) {
    return { ok: false, code: "INTERNAL" };
  }

  const generated = await executePreparedAction({
    preparation,
    acceptedInput,
    fetchImpl,
  });

  if (!generated.ok) {
    await updateActionStatus({
      baseUrl,
      secretKey,
      userId,
      actionId,
      status: "failed",
    });
    return { ok: false, code: "EXECUTION_FAILED" };
  }

  const title = buildResultTitle({ step, project });
  const preview = buildResultPreview(generated.text);
  const savedResult = await insertActionResult({
    baseUrl,
    secretKey,
    userId,
    action: actionRow.action,
    step,
    resultType: "text",
    title,
    preview,
    content: generated.text,
  });

  if (!savedResult.ok || !savedResult.result) {
    await updateActionStatus({
      baseUrl,
      secretKey,
      userId,
      actionId,
      status: "failed",
    });
    return { ok: false, code: "INTERNAL" };
  }

  await updateActionStatus({
    baseUrl,
    secretKey,
    userId,
    actionId,
    status: "completed",
  });

  const completion = await mutateProjectStepStatus({
    baseUrl,
    secretKey,
    userId,
    project,
    stepId,
    targetStatus: "completed",
    allowWithoutResultCheck: true,
  });

  if (!completion.ok) {
    return { ok: false, code: "INTERNAL" };
  }

  const action = serializeActionRow(actionRow.action, {
    latestResult: savedResult.result,
  });

  return {
    ok: true,
    action,
    result: serializeActionResultRow(savedResult.result),
    view: completion.view,
  };
}

export async function listProjectActionResults({
  baseUrl,
  secretKey,
  userId,
  projectId,
  stepId,
}) {
  const rows = await getResultsForProject({ baseUrl, secretKey, userId, projectId, stepId });
  if (!rows.ok) {
    return { ok: false, code: "INTERNAL" };
  }

  return {
    ok: true,
    results: rows.results.map((row) => serializeActionResultRow(row)),
  };
}

export async function resolveProjectActionForStep({
  baseUrl,
  secretKey,
  userId,
  project,
  step,
}) {
  const existing = await getActionByStepId({ baseUrl, secretKey, userId, stepId: step.id });
  if (existing.action) {
    const latest = await getLatestResultForStep({ baseUrl, secretKey, userId, stepId: step.id });
    return serializeActionRow(existing.action, { latestResult: latest.result });
  }

  const preview = serializeActionPreviewFromStep(step, project);
  preview.whyItMatters = preview.whyItMatters || null;
  return preview;
}

export async function stepHasActionResult({ baseUrl, secretKey, userId, stepId }) {
  const latest = await getLatestResultForStep({ baseUrl, secretKey, userId, stepId });
  return Boolean(latest.result);
}
