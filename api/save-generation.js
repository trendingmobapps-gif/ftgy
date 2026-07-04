// Vercel Serverless Function: POST /api/save-generation
// Saves a manually-saved tool generation into Supabase public.saved_generations.
// This is a dual-write migration: Wix savedgenerations stays active in
// parallel, and Supabase also receives the saved generation.
//
// This endpoint is called from the Wix frontend (ToolGeneratePage.tsx) on the
// user's "Save" click, so it does NOT require the internal secret. It never
// exposes Supabase keys or internal secrets, and Supabase failures return a
// safe JSON error instead of throwing.

function setCorsHeaders(res) {
  // Permissive CORS, compatible with the other API endpoints (called from Wix).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-iter-secret",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

// Picks the first non-empty string from a list of candidate values.
function firstNonEmpty(...candidates) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }
  return "";
}

// Basic UUID (v1-v5) validation. Returns the normalized string or null.
function normalizeUuid(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRe.test(trimmed) ? trimmed : null;
}

// Select rows from a Supabase table using a filtered GET query. Never throws.
async function supabaseSelect({ baseUrl, secretKey, table, query }) {
  try {
    const resp = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
      method: "GET",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });
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

// Insert a row into a Supabase table (returns the created representation).
// Never throws.
async function supabaseInsert({ baseUrl, secretKey, table, row }) {
  try {
    const resp = await fetch(`${baseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
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

// Upsert a row into a Supabase table, merging on the given conflict column.
// Never throws.
async function supabaseUpsert({ baseUrl, secretKey, table, row, onConflict }) {
  try {
    const url = `${baseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(
      onConflict,
    )}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
    });
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

export default async function handler(req, res) {
  setCorsHeaders(res);

  // Handle CORS preflight.
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({
      success: false,
      message: "Nu am putut salva generarea.",
      errorCode: "method_not_allowed",
    });
    return;
  }

  // --- Parse the request body (supports parsed objects and raw JSON). ---
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = body ? JSON.parse(body) : {};
    } catch {
      res.status(400).json({
        success: false,
        message: "Nu am putut salva generarea.",
        errorCode: "invalid_json",
      });
      return;
    }
  }
  if (!body || typeof body !== "object") {
    body = {};
  }

  // --- Validation ---
  const email = firstNonEmpty(
    body.email,
    body.userEmail,
    body.memberEmail,
    body.clientEmail,
  ).toLowerCase();

  if (!email) {
    res.status(400).json({
      success: false,
      message: "Nu am putut salva generarea.",
      errorCode: "missing_email",
    });
    return;
  }

  const resultMarkdown =
    typeof body.resultMarkdown === "string" && body.resultMarkdown.trim()
      ? body.resultMarkdown
      : null;
  const resultsJson =
    body.resultsJson !== undefined && body.resultsJson !== null
      ? body.resultsJson
      : null;

  if (!resultMarkdown && !resultsJson) {
    res.status(400).json({
      success: false,
      message: "Nu am putut salva generarea.",
      errorCode: "missing_result",
    });
    return;
  }

  // --- Environment (never exposed) ---
  const rawBaseUrl = process.env.SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!rawBaseUrl || !secretKey) {
    res.status(500).json({
      success: false,
      message: "Nu am putut salva generarea.",
      errorCode: "supabase_not_configured",
    });
    return;
  }

  const baseUrl = rawBaseUrl.replace(/\/+$/, "");

  try {
    // --- Profile lookup (best-effort; never fatal). ---
    let profileId = null;
    const profileLookup = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "profiles",
      query: `email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
    });
    if (
      profileLookup.ok &&
      Array.isArray(profileLookup.data) &&
      profileLookup.data.length > 0
    ) {
      profileId = profileLookup.data[0].id || null;
    }

    // --- Field mapping ---
    const toolName = firstNonEmpty(body.toolName) || null;
    const toolSlug = firstNonEmpty(body.toolSlug) || null;
    const toolId = firstNonEmpty(body.toolId) || null;
    const categorySlug = firstNonEmpty(body.categorySlug) || null;
    const categoryName = firstNonEmpty(body.categoryName) || null;
    const memberId = firstNonEmpty(body.memberId, body.wixMemberId) || null;

    const title =
      firstNonEmpty(body.title) ||
      `Salvare - ${toolName || toolSlug || "Instrument AI"}`;

    // generation_id: only persist a valid UUID, otherwise null.
    const generationId = normalizeUuid(body.generationId);

    // wix_item_id: accept several field names.
    const wixItemId =
      firstNonEmpty(body.wixItemId, body.wix_item_id, body.savedGenerationId) ||
      null;

    // user_input_json: accept multiple aliases; must be an object.
    const userInputCandidate =
      body.userInputJson ?? body.userInput ?? body.input ?? {};
    const userInputJson =
      userInputCandidate && typeof userInputCandidate === "object"
        ? userInputCandidate
        : {};

    // variant_count: explicit value, else derive from resultsJson array length.
    let variantCount = null;
    if (
      body.variantCount !== undefined &&
      body.variantCount !== null &&
      Number.isFinite(Number(body.variantCount))
    ) {
      variantCount = Number(body.variantCount);
    } else if (Array.isArray(resultsJson)) {
      variantCount = resultsJson.length;
    }

    // metadata: merge caller metadata with our provenance fields.
    const incomingMetadata =
      body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const metadata = {
      ...incomingMetadata,
      source: "api/save-generation.js",
      generationSessionId: firstNonEmpty(body.generationSessionId) || null,
      sourceHistoryIds: Array.isArray(body.sourceHistoryIds)
        ? body.sourceHistoryIds
        : [],
      savedFrom: "wix_tool_generate_page",
    };

    const row = {
      email,
      member_id: memberId,
      wix_item_id: wixItemId,
      generation_id: generationId,
      title,
      tool_id: toolId,
      tool_name: toolName,
      tool_slug: toolSlug,
      category_slug: categorySlug,
      category_name: categoryName,
      user_input_json: userInputJson,
      result_markdown: resultMarkdown,
      results_json: resultsJson,
      variant_count: variantCount,
      source: "vercel",
      metadata,
    };
    // Only set profile_id when we actually found one.
    if (profileId) {
      row.profile_id = profileId;
    }

    // --- Write to Supabase ---
    // If a wix_item_id is present, try an upsert (in case the table has a
    // unique constraint on wix_item_id). If that fails, fall back to insert.
    // Without a wix_item_id, insert directly.
    let writeResult = null;

    if (wixItemId) {
      const upsertResult = await supabaseUpsert({
        baseUrl,
        secretKey,
        table: "saved_generations",
        row,
        onConflict: "wix_item_id",
      });

      if (upsertResult.ok) {
        writeResult = upsertResult;
      } else {
        // Fallback to a plain insert (e.g. no unique constraint on wix_item_id).
        writeResult = await supabaseInsert({
          baseUrl,
          secretKey,
          table: "saved_generations",
          row,
        });
      }
    } else {
      writeResult = await supabaseInsert({
        baseUrl,
        secretKey,
        table: "saved_generations",
        row,
      });
    }

    if (!writeResult || !writeResult.ok) {
      res.status(500).json({
        success: false,
        message: "Nu am putut salva generarea.",
        errorCode: "supabase_write_failed",
      });
      return;
    }

    const savedGeneration = Array.isArray(writeResult.data)
      ? writeResult.data[0]
      : writeResult.data;

    res.status(200).json({
      success: true,
      savedGenerationId: savedGeneration ? savedGeneration.id || null : null,
      savedGeneration: savedGeneration || null,
    });
  } catch (error) {
    // Log the real cause to Vercel; return a safe message to the client.
    console.error(
      "[v0] save-generation internal error:",
      error?.message || String(error),
    );
    res.status(500).json({
      success: false,
      message: "Nu am putut salva generarea.",
      errorCode: "internal_error",
    });
  }
}
