import { PROJECT_MEMORY_SELECT_COLUMNS, resolveProjectMemorySource } from "./constants.js";
import {
  categorizeProjectMemoryWriteError,
  extractSupabaseError,
  mapErrorCategoryToInternalCode,
  sanitizeSupabaseErrorMessage,
} from "./error-utils.js";

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
  const error = extractSupabaseError(result.data);
  return {
    ok: result.ok,
    rows,
    status: result.status,
    error: error
      ? {
          code: error.code,
          message: sanitizeSupabaseErrorMessage(error.message),
        }
      : null,
  };
}

export async function upsertProjectMemoryFacts({
  baseUrl,
  secretKey,
  userId,
  projectId,
  facts,
  source = "session",
  nowIso,
  logFn = () => {},
}) {
  const resolvedSource = resolveProjectMemorySource(source);
  if (!resolvedSource) {
    const errorCategory = "snapshot_schema_incompatible";
    logFn({
      event: "project_memory_write",
      operation: "upsert",
      projectId,
      memoryKeys: Object.keys(facts || {}),
      httpStatus: null,
      supabaseErrorCode: "invalid_source",
      supabaseErrorMessage: `Unsupported project_memory.source: ${String(source).slice(0, 64)}`,
      errorCategory,
      writeAttempted: false,
    });
    return {
      ok: false,
      rows: [],
      status: 0,
      errorCategory,
      internalCode: mapErrorCategoryToInternalCode(errorCategory),
      error: {
        code: "invalid_source",
        message: `Unsupported project_memory.source: ${String(source).slice(0, 64)}`,
      },
      writeAttempted: false,
      writeMayHaveSucceeded: false,
    };
  }

  const now = nowIso || new Date().toISOString();
  const entries = Object.entries(facts || {}).filter(([, value]) => String(value || "").trim());

  if (entries.length === 0) {
    return { ok: true, rows: [], writeAttempted: false, writeMayHaveSucceeded: false };
  }

  const rows = entries.map(([memory_key, memory_value]) => ({
    project_id: projectId,
    user_id: userId,
    memory_key,
    memory_value: String(memory_value).trim(),
    source: resolvedSource,
    confidence: 1,
    updated_at: now,
  }));

  const memoryKeys = rows.map((row) => row.memory_key);
  const payloadByteLength = Buffer.byteLength(JSON.stringify(rows), "utf8");

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

  const supabaseError = extractSupabaseError(result.data);
  const saved = result.ok && Array.isArray(result.data) ? result.data : [];
  const writeMayHaveSucceeded = result.ok && saved.length === 0;

  if (!result.ok || saved.length === 0) {
    const errorCategory = categorizeProjectMemoryWriteError(result.status, supabaseError);
    logFn({
      event: "project_memory_write",
      operation: "upsert",
      projectId,
      memoryKeys,
      httpStatus: result.status || null,
      supabaseErrorCode: supabaseError?.code || null,
      supabaseErrorMessage: sanitizeSupabaseErrorMessage(supabaseError?.message),
      errorCategory,
      payloadByteLength,
      writeAttempted: true,
      writeMayHaveSucceeded,
    });
    return {
      ok: false,
      rows: saved,
      status: result.status,
      errorCategory,
      internalCode: mapErrorCategoryToInternalCode(errorCategory),
      error: supabaseError
        ? {
            code: supabaseError.code,
            message: sanitizeSupabaseErrorMessage(supabaseError.message),
          }
        : { code: null, message: result.error || "empty_write_response" },
      writeAttempted: true,
      writeMayHaveSucceeded,
      resolvedSource,
    };
  }

  return {
    ok: true,
    rows: saved,
    status: result.status,
    writeAttempted: true,
    writeMayHaveSucceeded: false,
    resolvedSource,
  };
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
