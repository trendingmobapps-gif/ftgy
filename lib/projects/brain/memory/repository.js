import { PROJECT_MEMORY_SELECT_COLUMNS } from "./constants.js";

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

export async function listProjectMemory({ baseUrl, secretKey, userId, projectId }) {
  const query =
    `project_id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(PROJECT_MEMORY_SELECT_COLUMNS)}` +
    `&order=updated_at.desc`;

  const result = await supabaseFetch(`${baseUrl}/rest/v1/project_memory?${query}`, {
    method: "GET",
    headers: authHeaders(secretKey),
  });

  const rows = result.ok && Array.isArray(result.data) ? result.data : [];
  return { ok: result.ok, rows };
}

export async function upsertProjectMemoryFacts({
  baseUrl,
  secretKey,
  userId,
  projectId,
  facts,
  source = "session",
  nowIso,
}) {
  const now = nowIso || new Date().toISOString();
  const entries = Object.entries(facts || {}).filter(([, value]) => String(value || "").trim());

  if (entries.length === 0) {
    return { ok: true, rows: [] };
  }

  const rows = entries.map(([memory_key, memory_value]) => ({
    project_id: projectId,
    user_id: userId,
    memory_key,
    memory_value: String(memory_value).trim(),
    source,
    confidence: 1,
    updated_at: now,
  }));

  const result = await supabaseFetch(
    `${baseUrl}/rest/v1/project_memory?on_conflict=project_id,user_id,memory_key&select=${encodeURIComponent(PROJECT_MEMORY_SELECT_COLUMNS)}`,
    {
      method: "POST",
      headers: authHeaders(secretKey, {
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      body: JSON.stringify(rows),
    },
  );

  const saved = result.ok && Array.isArray(result.data) ? result.data : [];
  return { ok: Boolean(saved.length), rows: saved };
}

export function memoryRowsToMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.memory_key)) {
      map.set(row.memory_key, row.memory_value);
    }
  }
  return map;
}
