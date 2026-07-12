import {
  getProjectSelectColumns,
  PROJECT_STATUSES,
  PROJECT_SORT_COLUMNS,
  PROJECT_DEFAULT_SORT,
  PROJECT_DEFAULT_DIRECTION,
  PROJECT_DEFAULT_LIMIT,
  PROJECT_MAX_LIMIT,
} from "./constants.js";

const TABLE = "projects";

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
    return { ok: resp.ok, status: resp.status, data, headers: resp.headers };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      headers: null,
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

function sanitizeSearchTerm(term) {
  return String(term || "")
    .replace(/[,()*\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function createProject({ baseUrl, secretKey, userId, value, nowIso, safetyGatePassed = false }) {
  if (!safetyGatePassed) {
    return {
      ok: false,
      status: 422,
      project: null,
      data: null,
      blockedBySafetyGate: true,
    };
  }

  const now = nowIso || new Date().toISOString();
  const row = {
    user_id: userId,
    name: value.name,
    goal: value.goal,
    description: value.description ?? null,
    summary: value.summary ?? null,
    category_slug: value.categorySlug ?? null,
    icon_key: value.iconKey ?? null,
    accent_key: value.accentKey ?? null,
    status: "active",
    active_workflow_id: null,
    active_workflow_run_id: null,
    last_activity_at: now,
    completed_at: null,
    paused_at: null,
    archived_at: null,
  };

  const url = `${baseUrl}/rest/v1/${TABLE}?select=${encodeURIComponent(getProjectSelectColumns())}`;
  const result = await supabaseFetch(url, {
    method: "POST",
    headers: authHeaders(secretKey, { Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });

  const project =
    result.ok && Array.isArray(result.data) && result.data.length > 0
      ? result.data[0]
      : null;

  return { ok: result.ok && !!project, status: result.status, project, data: result.data };
}

export async function getProjectOwned({ baseUrl, secretKey, userId, projectId }) {
  const query =
    `id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(getProjectSelectColumns())}` +
    `&limit=1`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/${TABLE}?${query}`, {
    method: "GET",
    headers: authHeaders(secretKey),
  });

  const project =
    result.ok && Array.isArray(result.data) && result.data.length > 0
      ? result.data[0]
      : null;

  return { ok: result.ok, status: result.status, project, data: result.data };
}

export async function listProjects({ baseUrl, secretKey, userId, filters }) {
  const f = filters || {};
  const params = [];
  params.push(`user_id=eq.${encodeURIComponent(userId)}`);

  const requestedStatuses = Array.isArray(f.statuses)
    ? f.statuses.filter((s) => PROJECT_STATUSES.includes(s))
    : [];

  if (requestedStatuses.length > 0) {
    params.push(`status=in.(${requestedStatuses.join(",")})`);
  } else if (!f.includeArchived) {
    params.push(`status=in.(active,paused,completed)`);
  }

  if (f.categorySlug) {
    params.push(`category_slug=eq.${encodeURIComponent(f.categorySlug)}`);
  }

  const searchTerm = sanitizeSearchTerm(f.search);
  if (searchTerm) {
    const pattern = `*${searchTerm}*`;
    params.push(
      `or=(name.ilike.${encodeURIComponent(pattern)},goal.ilike.${encodeURIComponent(pattern)})`,
    );
  }

  const sortColumn =
    PROJECT_SORT_COLUMNS[f.sort] || PROJECT_SORT_COLUMNS[PROJECT_DEFAULT_SORT];
  const direction = f.direction === "asc" ? "asc" : PROJECT_DEFAULT_DIRECTION;
  params.push(`order=${sortColumn}.${direction}`);

  let limit = Number.parseInt(f.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = PROJECT_DEFAULT_LIMIT;
  if (limit > PROJECT_MAX_LIMIT) limit = PROJECT_MAX_LIMIT;

  let offset = Number.parseInt(f.cursor, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  params.push(`select=${encodeURIComponent(getProjectSelectColumns())}`);
  params.push(`limit=${limit}`);
  params.push(`offset=${offset}`);

  const result = await supabaseFetch(`${baseUrl}/rest/v1/${TABLE}?${params.join("&")}`, {
    method: "GET",
    headers: authHeaders(secretKey, { Prefer: "count=exact" }),
  });

  const rows = result.ok && Array.isArray(result.data) ? result.data : [];
  let count = rows.length;
  const contentRange = result.headers?.get?.("content-range");
  if (contentRange && contentRange.includes("/")) {
    const totalPart = contentRange.split("/")[1];
    const parsedTotal = Number.parseInt(totalPart, 10);
    if (Number.isFinite(parsedTotal)) count = parsedTotal;
  }

  const nextCursor = rows.length === limit ? String(offset + limit) : null;
  return { ok: result.ok, status: result.status, rows, count, nextCursor };
}

export async function updateProjectOwned({ baseUrl, secretKey, userId, projectId, columns }) {
  const query =
    `id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(getProjectSelectColumns())}`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/${TABLE}?${query}`, {
    method: "PATCH",
    headers: authHeaders(secretKey, { Prefer: "return=representation" }),
    body: JSON.stringify(columns),
  });

  const project =
    result.ok && Array.isArray(result.data) && result.data.length > 0
      ? result.data[0]
      : null;

  return { ok: result.ok, status: result.status, project, data: result.data };
}
