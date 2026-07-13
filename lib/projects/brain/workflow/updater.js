import { updateStepStatusOwned } from "../repository.js";

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
    return { ok: false, status: 0, data: null, error: error?.message || "network error" };
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

async function insertWorkflowEvent({
  baseUrl,
  secretKey,
  userId,
  projectId,
  workflowId,
  stepId,
  eventType,
  reason,
  payload,
}) {
  const row = {
    project_id: projectId,
    user_id: userId,
    workflow_id: workflowId || null,
    step_id: stepId || null,
    event_type: eventType,
    reason,
    payload: payload || {},
  };

  await supabaseFetch(`${baseUrl}/rest/v1/project_workflow_events`, {
    method: "POST",
    headers: authHeaders(secretKey),
    body: JSON.stringify(row),
  });
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function overlapScore(a, b) {
  const tokensA = new Set(normalize(a).split(/\s+/).filter((token) => token.length > 4));
  const tokensB = new Set(normalize(b).split(/\s+/).filter((token) => token.length > 4));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

export function evaluateWorkflowEvolution({ bundle, completedStep, acceptedResource, memoryMap }) {
  const changes = [];
  if (!bundle?.steps || !completedStep) {
    return { changes };
  }

  const completedHaystack = normalize(
    `${completedStep.title} ${completedStep.expected_outcome} ${acceptedResource?.title || ""} ${acceptedResource?.preview || ""}`,
  );

  for (const step of bundle.steps) {
    if (step.id === completedStep.id) continue;
    if (step.status !== "pending") continue;

    const score = overlapScore(
      `${step.title} ${step.expected_outcome}`,
      completedHaystack,
    );

    const memoryKeyHit = [...memoryMap.keys()].some((key) =>
      normalize(step.title).includes(normalize(key)),
    );

    if (score >= 0.45 || memoryKeyHit) {
      changes.push({
        type: "skip_step",
        stepId: step.id,
        reason: "Pasul este deja acoperit de progresul și memoria proiectului.",
      });
    }
  }

  return { changes };
}

export async function applyWorkflowEvolution({
  baseUrl,
  secretKey,
  userId,
  projectId,
  bundle,
  changes = [],
}) {
  const applied = [];

  for (const change of changes) {
    if (change.type !== "skip_step") continue;

    const updated = await updateStepStatusOwned({
      baseUrl,
      secretKey,
      userId,
      projectId,
      stepId: change.stepId,
      targetStatus: "skipped",
    });

    if (updated.ok) {
      applied.push(change);
      await insertWorkflowEvent({
        baseUrl,
        secretKey,
        userId,
        projectId,
        workflowId: bundle?.workflow?.id,
        stepId: change.stepId,
        eventType: "skip_step",
        reason: change.reason,
        payload: change,
      });
    }
  }

  return { ok: true, applied };
}
