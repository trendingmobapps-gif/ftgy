import { PROJECT_RESOURCE_SELECT_COLUMNS } from "./constants.js";

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

export async function listProjectResources({ baseUrl, secretKey, userId, projectId, stepId }) {
  const params = [
    `project_id=eq.${encodeURIComponent(projectId)}`,
    `user_id=eq.${encodeURIComponent(userId)}`,
    `select=${encodeURIComponent(PROJECT_RESOURCE_SELECT_COLUMNS)}`,
    `order=created_at.desc`,
  ];

  if (stepId) {
    params.push(`step_id=eq.${encodeURIComponent(stepId)}`);
  }

  const result = await supabaseFetch(`${baseUrl}/rest/v1/project_resources?${params.join("&")}`, {
    method: "GET",
    headers: authHeaders(secretKey),
  });

  const rows = result.ok && Array.isArray(result.data) ? result.data : [];
  return { ok: result.ok, resources: rows };
}

export async function getResourceForStep({ baseUrl, secretKey, userId, projectId, stepId }) {
  const query =
    `project_id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&step_id=eq.${encodeURIComponent(stepId)}` +
    `&select=${encodeURIComponent(PROJECT_RESOURCE_SELECT_COLUMNS)}` +
    `&limit=1`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/project_resources?${query}`, {
    method: "GET",
    headers: authHeaders(secretKey),
  });

  const row =
    result.ok && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;
  return { ok: result.ok, resource: row };
}

export async function insertProjectResource({
  baseUrl,
  secretKey,
  userId,
  projectId,
  stepId,
  actionId,
  resultId,
  resourceType,
  title,
  preview,
  content,
  mimeType,
  fileExtension,
  metadata,
  sourceStrategy,
  nowIso,
}) {
  const now = nowIso || new Date().toISOString();
  const row = {
    project_id: projectId,
    user_id: userId,
    step_id: stepId || null,
    action_id: actionId || null,
    result_id: resultId || null,
    resource_type: resourceType,
    title,
    preview,
    content: content || null,
    mime_type: mimeType || null,
    file_extension: fileExtension || null,
    metadata: metadata || {},
    source_strategy: sourceStrategy,
    created_at: now,
    updated_at: now,
  };

  const result = await supabaseFetch(
    `${baseUrl}/rest/v1/project_resources?select=${encodeURIComponent(PROJECT_RESOURCE_SELECT_COLUMNS)}`,
    {
      method: "POST",
      headers: authHeaders(secretKey, { Prefer: "return=representation" }),
      body: JSON.stringify(row),
    },
  );

  const saved =
    result.ok && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;
  return { ok: Boolean(saved), resource: saved };
}

export function serializeResourceRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    projectId: row.project_id,
    stepId: row.step_id,
    actionId: row.action_id,
    resultId: row.result_id,
    type: row.resource_type,
    title: row.title,
    preview: row.preview,
    mimeType: row.mime_type,
    fileExtension: row.file_extension,
    sourceStrategy: row.source_strategy,
    createdAt: row.created_at,
  };
}
