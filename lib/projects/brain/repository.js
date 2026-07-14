import { encodeRoadmapBrainVersionWithEvidence } from "./openai-evidence-hash.js";
import {
  WORKFLOW_SELECT_COLUMNS,
  MILESTONE_SELECT_COLUMNS,
  STEP_SELECT_COLUMNS,
  PROJECT_BRAIN_VERSION,
} from "./constants.js";
import { deriveMilestoneStatus } from "./progress.js";

async function supabaseFetch(url, options) {
  try {
    const resp = await fetch(url, options);
    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.message || "network error",
    };
  }
}

function authHeaders(secretKey, extra) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
    ...(extra || {}),
  };
}

export async function getWorkflowByProjectId({ baseUrl, secretKey, userId, projectId }) {
  const query =
    `project_id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(WORKFLOW_SELECT_COLUMNS)}` +
    `&limit=1`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/project_workflows?${query}`, {
    method: "GET",
    headers: authHeaders(secretKey),
  });

  const workflow =
    result.ok && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;

  return { ok: result.ok, status: result.status, workflow, data: result.data };
}

export async function getWorkflowBundle({ baseUrl, secretKey, userId, projectId }) {
  const workflowResult = await getWorkflowByProjectId({ baseUrl, secretKey, userId, projectId });
  if (!workflowResult.workflow) {
    return { ok: workflowResult.ok, workflow: null, milestones: [], steps: [] };
  }

  const workflowId = workflowResult.workflow.id;
  const milestoneQuery =
    `workflow_id=eq.${encodeURIComponent(workflowId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(MILESTONE_SELECT_COLUMNS)}` +
    `&order=position.asc`;

  const stepQuery =
    `workflow_id=eq.${encodeURIComponent(workflowId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(STEP_SELECT_COLUMNS)}` +
    `&order=position.asc`;

  const [milestonesResult, stepsResult] = await Promise.all([
    supabaseFetch(`${baseUrl}/rest/v1/project_milestones?${milestoneQuery}`, {
      method: "GET",
      headers: authHeaders(secretKey),
    }),
    supabaseFetch(`${baseUrl}/rest/v1/project_steps?${stepQuery}`, {
      method: "GET",
      headers: authHeaders(secretKey),
    }),
  ]);

  const milestones =
    milestonesResult.ok && Array.isArray(milestonesResult.data) ? milestonesResult.data : [];
  const steps = stepsResult.ok && Array.isArray(stepsResult.data) ? stepsResult.data : [];

  return {
    ok: milestonesResult.ok && stepsResult.ok,
    workflow: workflowResult.workflow,
    milestones,
    steps,
  };
}

export async function updateProjectBrainMeta({
  baseUrl,
  secretKey,
  userId,
  projectId,
  columns,
}) {
  const query =
    `id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/projects?${query}`, {
    method: "PATCH",
    headers: authHeaders(secretKey, { Prefer: "return=representation" }),
    body: JSON.stringify(columns),
  });

  const project =
    result.ok && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;

  return { ok: result.ok && !!project, status: result.status, project, data: result.data };
}

export async function tryClaimProjectGeneration({
  baseUrl,
  secretKey,
  userId,
  projectId,
  nextAttemptCount,
  allowedStatuses = ["pending"],
}) {
  if (!Array.isArray(allowedStatuses) || allowedStatuses.length === 0) {
    return { ok: false, claimed: false, project: null, status: 400 };
  }

  const query =
    `id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&brain_status=in.(${allowedStatuses.map((status) => encodeURIComponent(status)).join(",")})`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/projects?${query}`, {
    method: "PATCH",
    headers: authHeaders(secretKey, { Prefer: "return=representation" }),
    body: JSON.stringify({
      brain_status: "generating",
      brain_attempt_count: nextAttemptCount,
      brain_failure_code: null,
      updated_at: new Date().toISOString(),
    }),
  });

  const project =
    result.ok && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;

  return {
    ok: Boolean(project),
    claimed: Boolean(project),
    status: result.status,
    project,
  };
}

export async function deleteWorkflowByProjectId({ baseUrl, secretKey, userId, projectId }) {
  const query =
    `project_id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/project_workflows?${query}`, {
    method: "DELETE",
    headers: authHeaders(secretKey),
  });

  return { ok: result.ok, status: result.status };
}

export async function clearFailedWorkflowArtifacts({ baseUrl, secretKey, userId, projectId }) {
  await deleteWorkflowByProjectId({ baseUrl, secretKey, userId, projectId });
  return updateProjectBrainMeta({
    baseUrl,
    secretKey,
    userId,
    projectId,
    columns: {
      brain_status: "pending",
      brain_failure_code: null,
      active_workflow_id: null,
      updated_at: new Date().toISOString(),
    },
  });
}

export async function persistGeneratedWorkflow({
  baseUrl,
  secretKey,
  userId,
  projectId,
  generatedWorkflow,
  brainVersion = PROJECT_BRAIN_VERSION,
  evidenceHash = null,
  nowIso,
}) {
  const now = nowIso || new Date().toISOString();

  const workflowRow = {
    project_id: projectId,
    user_id: userId,
    summary: generatedWorkflow.summary,
    current_stage: generatedWorkflow.currentStage,
    complexity: generatedWorkflow.complexity,
    estimated_duration_label: generatedWorkflow.estimatedDurationLabel,
    brain_version: encodeRoadmapBrainVersionWithEvidence({ brainVersion, evidenceHash }),
    status: "ready",
    generated_at: now,
    updated_at: now,
  };

  const workflowInsert = await supabaseFetch(
    `${baseUrl}/rest/v1/project_workflows?select=${encodeURIComponent(WORKFLOW_SELECT_COLUMNS)}`,
    {
      method: "POST",
      headers: authHeaders(secretKey, { Prefer: "return=representation" }),
      body: JSON.stringify(workflowRow),
    },
  );

  const workflow =
    workflowInsert.ok && Array.isArray(workflowInsert.data) && workflowInsert.data.length > 0
      ? workflowInsert.data[0]
      : null;

  if (!workflow) {
    const existing = await getWorkflowByProjectId({ baseUrl, secretKey, userId, projectId });
    if (existing.workflow) {
      return { ok: false, reason: "workflow_already_exists", workflow: existing.workflow };
    }
    return { ok: false, reason: "workflow_insert_failed", data: workflowInsert.data };
  }

  const workflowId = workflow.id;
  const milestoneRows = generatedWorkflow.milestones.map((milestone, index) => ({
    workflow_id: workflowId,
    project_id: projectId,
    user_id: userId,
    title: milestone.title,
    description: milestone.description,
    position: index,
    status: index === 0 ? "in_progress" : "pending",
    updated_at: now,
  }));

  const milestoneInsert = await supabaseFetch(
    `${baseUrl}/rest/v1/project_milestones?select=${encodeURIComponent(MILESTONE_SELECT_COLUMNS)}`,
    {
      method: "POST",
      headers: authHeaders(secretKey, { Prefer: "return=representation" }),
      body: JSON.stringify(milestoneRows),
    },
  );

  const milestones =
    milestoneInsert.ok && Array.isArray(milestoneInsert.data) ? milestoneInsert.data : null;

  if (!milestones || milestones.length !== milestoneRows.length) {
    await deleteWorkflowByProjectId({ baseUrl, secretKey, userId, projectId });
    return { ok: false, reason: "milestone_insert_failed", data: milestoneInsert.data };
  }

  const stepRows = [];
  for (let milestoneIndex = 0; milestoneIndex < generatedWorkflow.milestones.length; milestoneIndex += 1) {
    const milestone = generatedWorkflow.milestones[milestoneIndex];
    const milestoneId = milestones[milestoneIndex].id;

    milestone.steps.forEach((step, stepIndex) => {
      stepRows.push({
        milestone_id: milestoneId,
        workflow_id: workflowId,
        project_id: projectId,
        user_id: userId,
        title: step.title,
        description: step.description,
        expected_outcome: step.expectedOutcome,
        rationale: step.rationale ?? null,
        position: stepIndex,
        priority: step.priority,
        estimated_effort_label: step.estimatedEffortLabel ?? null,
        status: "pending",
        tool_id: step.tool?.toolId ?? null,
        tool_slug: step.tool?.toolSlug ?? null,
        tool_name: step.tool?.toolName ?? null,
        tool_category_slug: step.tool?.toolCategorySlug ?? null,
        completed_at: null,
        updated_at: now,
      });
    });
  }

  const stepInsert = await supabaseFetch(
    `${baseUrl}/rest/v1/project_steps?select=${encodeURIComponent(STEP_SELECT_COLUMNS)}`,
    {
      method: "POST",
      headers: authHeaders(secretKey, { Prefer: "return=representation" }),
      body: JSON.stringify(stepRows),
    },
  );

  const steps =
    stepInsert.ok && Array.isArray(stepInsert.data) ? stepInsert.data : null;

  if (!steps || steps.length !== stepRows.length) {
    await deleteWorkflowByProjectId({ baseUrl, secretKey, userId, projectId });
    return { ok: false, reason: "step_insert_failed", data: stepInsert.data };
  }

  const brainUpdate = await updateProjectBrainMeta({
    baseUrl,
    secretKey,
    userId,
    projectId,
    columns: {
      brain_status: "ready",
      brain_version: brainVersion,
      brain_generated_at: now,
      brain_failure_code: null,
      active_workflow_id: workflowId,
      updated_at: now,
      last_activity_at: now,
    },
  });

  if (!brainUpdate.ok) {
    await deleteWorkflowByProjectId({ baseUrl, secretKey, userId, projectId });
    return { ok: false, reason: "brain_meta_update_failed" };
  }

  return {
    ok: true,
    workflow,
    milestones,
    steps,
    project: brainUpdate.project,
  };
}

export async function updateStepStatusOwned({
  baseUrl,
  secretKey,
  userId,
  projectId,
  stepId,
  targetStatus,
  nowIso,
}) {
  const now = nowIso || new Date().toISOString();

  const stepQuery =
    `id=eq.${encodeURIComponent(stepId)}` +
    `&project_id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(STEP_SELECT_COLUMNS)}` +
    `&limit=1`;

  const existingResult = await supabaseFetch(`${baseUrl}/rest/v1/project_steps?${stepQuery}`, {
    method: "GET",
    headers: authHeaders(secretKey),
  });

  const existing =
    existingResult.ok && Array.isArray(existingResult.data) && existingResult.data.length > 0
      ? existingResult.data[0]
      : null;

  if (!existing) {
    return { ok: false, status: 404, reason: "step_not_found" };
  }

  const patch = {
    status: targetStatus,
    updated_at: now,
    completed_at: targetStatus === "completed" ? now : null,
  };

  const patchQuery =
    `id=eq.${encodeURIComponent(stepId)}` +
    `&project_id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(STEP_SELECT_COLUMNS)}`;

  const patchResult = await supabaseFetch(`${baseUrl}/rest/v1/project_steps?${patchQuery}`, {
    method: "PATCH",
    headers: authHeaders(secretKey, { Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });

  const step =
    patchResult.ok && Array.isArray(patchResult.data) && patchResult.data.length > 0
      ? patchResult.data[0]
      : null;

  if (!step) {
    return { ok: false, status: 500, reason: "step_update_failed" };
  }

  const bundle = await getWorkflowBundle({ baseUrl, secretKey, userId, projectId });
  if (!bundle.workflow) {
    return { ok: false, status: 500, reason: "workflow_missing_after_update" };
  }

  const stepsByMilestone = new Map();
  for (const row of bundle.steps) {
    if (!stepsByMilestone.has(row.milestone_id)) {
      stepsByMilestone.set(row.milestone_id, []);
    }
    stepsByMilestone.get(row.milestone_id).push(row);
  }

  for (const milestone of bundle.milestones) {
    const milestoneSteps = stepsByMilestone.get(milestone.id) || [];
    const derivedStatus = deriveMilestoneStatus(milestoneSteps);
    if (derivedStatus !== milestone.status) {
      const milestonePatchQuery =
        `id=eq.${encodeURIComponent(milestone.id)}` +
        `&user_id=eq.${encodeURIComponent(userId)}`;

      await supabaseFetch(`${baseUrl}/rest/v1/project_milestones?${milestonePatchQuery}`, {
        method: "PATCH",
        headers: authHeaders(secretKey),
        body: JSON.stringify({ status: derivedStatus, updated_at: now }),
      });
      milestone.status = derivedStatus;
    }
  }

  await updateProjectBrainMeta({
    baseUrl,
    secretKey,
    userId,
    projectId,
    columns: {
      last_activity_at: now,
      updated_at: now,
    },
  });

  return {
    ok: true,
    step,
    workflow: bundle.workflow,
    milestones: bundle.milestones,
    steps: bundle.steps.map((row) => (row.id === step.id ? step : row)),
  };
}
