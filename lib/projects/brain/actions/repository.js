import {
  hasPersistedConversation,
  normalizeActionRow,
  buildInMemorySessionFromState,
} from "./normalize.js";
export { hasPersistedConversation, normalizeActionRow, buildInMemorySessionFromState } from "./normalize.js";
import { extractSupabaseErrorPayload, logPrepareWarning } from "./prepare-stage-log.js";
import { getActionSchemaCapabilities } from "./schema-capabilities.js";
import { ACTION_SELECT_COLUMNS } from "./constants.js";

async function resolveSchemaCapabilities({ baseUrl, secretKey, schemaCapabilities }) {
  if (schemaCapabilities) {
    return schemaCapabilities;
  }

  return getActionSchemaCapabilities({ baseUrl, secretKey });
}

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

export async function getActionByStepId({ baseUrl, secretKey, userId, stepId, schemaCapabilities }) {
  const schema = await resolveSchemaCapabilities({ baseUrl, secretKey, schemaCapabilities });
  const query =
    `step_id=eq.${encodeURIComponent(stepId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(schema.actionSelectColumns)}` +
    `&limit=1`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/project_step_actions?${query}`, {
    method: "GET",
    headers: authHeaders(secretKey),
  });

  if (!result.ok) {
    logPrepareWarning("existing_action_loaded", "Action lookup failed", {
      stepId,
      status: result.status,
      supabaseError: extractSupabaseErrorPayload(result.data),
    });
  }

  const action =
    result.ok && Array.isArray(result.data) && result.data.length > 0
      ? normalizeActionRow(result.data[0])
      : null;

  return { ok: result.ok, action, supabaseError: extractSupabaseErrorPayload(result.data) };
}

export async function upsertPreparedAction({
  baseUrl,
  secretKey,
  userId,
  preparation,
  step,
  workflow,
  sessionState,
  nowIso,
  schemaCapabilities,
}) {
  const schema = await resolveSchemaCapabilities({ baseUrl, secretKey, schemaCapabilities });
  const now = nowIso || new Date().toISOString();
  const row = {
    step_id: step.id,
    project_id: step.project_id,
    workflow_id: workflow.id,
    user_id: userId,
    status: "prepared",
    capability_type: preparation.capabilityType,
    capability_ref: preparation.capabilityRef,
    title: preparation.title,
    explanation: preparation.explanation,
    why_it_matters: preparation.whyItMatters,
    expected_result: preparation.expectedResult,
    prepared_prompt: preparation.preparedPrompt,
    prepared_input: preparation.preparedInput,
    missing_fields: preparation.missingFields,
    estimated_effort_label: preparation.estimatedEffortLabel,
    updated_at: now,
  };

  if (schema.sessionColumns && sessionState) {
    row.session_status = sessionState.phase === "ready" ? "ready" : "collecting";
    row.conversation = sessionState.messages;
    row.collected_input = sessionState.collectedInput;
    row.pending_question = sessionState.pendingQuestion;
  }

  const existing = await getActionByStepId({
    baseUrl,
    secretKey,
    userId,
    stepId: step.id,
    schemaCapabilities: schema,
  });
  if (existing.action) {
    const patchQuery =
      `id=eq.${encodeURIComponent(existing.action.id)}` +
      `&user_id=eq.${encodeURIComponent(userId)}` +
      `&select=${encodeURIComponent(schema.actionSelectColumns)}`;

    const patch = await supabaseFetch(`${baseUrl}/rest/v1/project_step_actions?${patchQuery}`, {
      method: "PATCH",
      headers: authHeaders(secretKey, { Prefer: "return=representation" }),
      body: JSON.stringify(row),
    });

    if (!patch.ok) {
      logPrepareWarning("action_initialized", "Action patch failed", {
        stepId: step.id,
        status: patch.status,
        supabaseError: extractSupabaseErrorPayload(patch.data),
      });
    }

    const action =
      patch.ok && Array.isArray(patch.data) && patch.data.length > 0
        ? normalizeActionRow(patch.data[0])
        : null;
    return {
      ok: Boolean(action),
      action,
      sessionState,
      sessionPersisted: schema.sessionColumns,
      supabaseError: extractSupabaseErrorPayload(patch.data),
    };
  }

  const insertBody = {
    ...row,
    created_at: now,
  };

  if (schema.sessionColumns) {
    insertBody.session_status = sessionState?.phase === "ready" ? "ready" : "collecting";
    insertBody.conversation = sessionState?.messages || [];
    insertBody.collected_input = sessionState?.collectedInput || {};
    insertBody.pending_question = sessionState?.pendingQuestion || null;
  }

  const insert = await supabaseFetch(
    `${baseUrl}/rest/v1/project_step_actions?select=${encodeURIComponent(schema.actionSelectColumns)}`,
    {
      method: "POST",
      headers: authHeaders(secretKey, { Prefer: "return=representation" }),
      body: JSON.stringify(insertBody),
    },
  );

  if (!insert.ok) {
    logPrepareWarning("action_initialized", "Action insert failed", {
      stepId: step.id,
      status: insert.status,
      supabaseError: extractSupabaseErrorPayload(insert.data),
    });
  }

  const action =
    insert.ok && Array.isArray(insert.data) && insert.data.length > 0
      ? normalizeActionRow(insert.data[0])
      : null;
  return {
    ok: Boolean(action),
    action,
    sessionState,
    sessionPersisted: schema.sessionColumns,
    supabaseError: extractSupabaseErrorPayload(insert.data),
  };
}

export async function updateActionSession({
  baseUrl,
  secretKey,
  userId,
  actionId,
  patch,
  nowIso,
}) {
  const now = nowIso || new Date().toISOString();
  const query =
    `id=eq.${encodeURIComponent(actionId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(ACTION_SELECT_COLUMNS)}`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/project_step_actions?${query}`, {
    method: "PATCH",
    headers: authHeaders(secretKey, { Prefer: "return=representation" }),
    body: JSON.stringify({ ...patch, updated_at: now }),
  });

  const action =
    result.ok && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;

  return { ok: Boolean(action), action };
}

export async function updateActionStatus({
  baseUrl,
  secretKey,
  userId,
  actionId,
  status,
  nowIso,
}) {
  const now = nowIso || new Date().toISOString();
  const patch = {
    status,
    updated_at: now,
  };

  if (status === "in_progress") {
    patch.started_at = now;
  }

  if (status === "completed" || status === "failed") {
    patch.completed_at = now;
  }

  const query =
    `id=eq.${encodeURIComponent(actionId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(ACTION_SELECT_COLUMNS)}`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/project_step_actions?${query}`, {
    method: "PATCH",
    headers: authHeaders(secretKey, { Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });

  const action =
    result.ok && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;

  return { ok: Boolean(action), action };
}

export async function insertActionResult({
  baseUrl,
  secretKey,
  userId,
  action,
  step,
  resultType,
  title,
  preview,
  content,
  acceptanceStatus = "pending_review",
  nowIso,
}) {
  const now = nowIso || new Date().toISOString();
  const row = {
    action_id: action.id,
    step_id: step.id,
    project_id: step.project_id,
    user_id: userId,
    result_type: resultType,
    acceptance_status: acceptanceStatus,
    title,
    preview,
    content,
    created_at: now,
  };

  const result = await supabaseFetch(
    `${baseUrl}/rest/v1/project_action_results?select=${encodeURIComponent(ACTION_RESULT_SELECT_COLUMNS)}`,
    {
      method: "POST",
      headers: authHeaders(secretKey, { Prefer: "return=representation" }),
      body: JSON.stringify(row),
    },
  );

  const saved =
    result.ok && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;

  return { ok: Boolean(saved), result: saved };
}

export async function getResultsForProject({
  baseUrl,
  secretKey,
  userId,
  projectId,
  stepId,
  schemaCapabilities,
}) {
  const schema = await resolveSchemaCapabilities({ baseUrl, secretKey, schemaCapabilities });
  const params = [
    `project_id=eq.${encodeURIComponent(projectId)}`,
    `user_id=eq.${encodeURIComponent(userId)}`,
    `select=${encodeURIComponent(schema.actionResultSelectColumns)}`,
    `order=created_at.desc`,
  ];

  if (stepId) {
    params.push(`step_id=eq.${encodeURIComponent(stepId)}`);
  }

  const result = await supabaseFetch(`${baseUrl}/rest/v1/project_action_results?${params.join("&")}`, {
    method: "GET",
    headers: authHeaders(secretKey),
  });

  if (!result.ok) {
    logPrepareWarning("resources_loaded", "Action results lookup failed", {
      projectId,
      stepId: stepId || null,
      status: result.status,
      supabaseError: extractSupabaseErrorPayload(result.data),
    });
  }

  const rows = result.ok && Array.isArray(result.data) ? result.data : [];
  return { ok: result.ok, results: rows };
}

export async function updateActionResultAcceptance({
  baseUrl,
  secretKey,
  userId,
  resultId,
  acceptanceStatus,
}) {
  const query =
    `id=eq.${encodeURIComponent(resultId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(ACTION_RESULT_SELECT_COLUMNS)}`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/project_action_results?${query}`, {
    method: "PATCH",
    headers: authHeaders(secretKey, { Prefer: "return=representation" }),
    body: JSON.stringify({ acceptance_status: acceptanceStatus }),
  });

  const row =
    result.ok && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;

  return { ok: Boolean(row), result: row };
}

export async function getLatestResultForStep({
  baseUrl,
  secretKey,
  userId,
  stepId,
  acceptanceStatus,
  schemaCapabilities,
}) {
  const schema = await resolveSchemaCapabilities({ baseUrl, secretKey, schemaCapabilities });
  const params = [
    `step_id=eq.${encodeURIComponent(stepId)}`,
    `user_id=eq.${encodeURIComponent(userId)}`,
    `select=${encodeURIComponent(schema.actionResultSelectColumns)}`,
    `order=created_at.desc`,
    `limit=1`,
  ];

  if (acceptanceStatus && schema.acceptanceStatusColumn) {
    params.push(`acceptance_status=eq.${encodeURIComponent(acceptanceStatus)}`);
  }

  const result = await supabaseFetch(`${baseUrl}/rest/v1/project_action_results?${params.join("&")}`, {
    method: "GET",
    headers: authHeaders(secretKey),
  });

  if (!result.ok) {
    logPrepareWarning("session_normalized", "Latest action result lookup failed", {
      stepId,
      acceptanceStatus: acceptanceStatus || null,
      status: result.status,
      supabaseError: extractSupabaseErrorPayload(result.data),
    });
    return { ok: false, result: null };
  }

  const row =
    result.ok && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;

  return { ok: result.ok, result: row };
}

export async function getLatestAcceptedResultForStep(args) {
  return getLatestResultForStep({ ...args, acceptanceStatus: "accepted" });
}

export async function getPendingResultForStep(args) {
  const schema = await resolveSchemaCapabilities(args);
  if (!schema.acceptanceStatusColumn) {
    return { ok: true, result: null };
  }

  return getLatestResultForStep({ ...args, acceptanceStatus: "pending_review" });
}

export function serializeActionRow(row, { latestResult = null, session = null } = {}) {
  if (!row) return null;

  return {
    actionId: row.id,
    stepId: row.step_id,
    title: row.title,
    explanation: row.explanation,
    whyItMatters: row.why_it_matters,
    expectedResult: row.expected_result,
    preparedPrompt: row.prepared_prompt,
    preparedInput: row.prepared_input || {},
    missingInformation: Array.isArray(row.missing_fields) ? row.missing_fields : [],
    executionState:
      row.status === "completed"
        ? "completed"
        : row.status === "in_progress"
          ? "in_progress"
          : row.status === "failed"
            ? "failed"
            : "ready",
    estimatedEffort: row.estimated_effort_label || null,
    latestResult: latestResult ? serializeActionResultRow(latestResult) : null,
    session: session || null,
  };
}

export function serializeActionResultRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    actionId: row.action_id,
    stepId: row.step_id,
    type: row.result_type,
    title: row.title,
    preview: row.preview,
    content: row.content || row.preview || "",
    acceptanceStatus: row.acceptance_status || "accepted",
    createdAt: row.created_at,
  };
}

export function serializeActionPreviewFromStep(step, project) {
  return {
    actionId: null,
    stepId: step.id,
    title: step.title,
    explanation: step.description,
    whyItMatters: step.rationale || null,
    expectedResult: step.expected_outcome,
    preparedPrompt: null,
    preparedInput: {},
    missingInformation: [],
    executionState:
      step.status === "completed"
        ? "completed"
        : step.status === "in_progress"
          ? "in_progress"
          : "ready",
    estimatedEffort: step.estimated_effort_label || null,
    latestResult: null,
  };
}
