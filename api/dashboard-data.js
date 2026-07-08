// Vercel Serverless Function: POST /api/dashboard-data
// Returns all user-specific dashboard data from Supabase for the Wix
// DashboardPage.tsx. This is part of the pre-launch migration: Wix collections
// stay active in parallel, and Supabase is read here in Wix-compatible shapes.
//
// This endpoint is called from the Wix frontend, so it does NOT require the
// internal secret. It never exposes Supabase keys or internal env values, and
// only returns data for the requested normalized email. Any per-section failure
// degrades to an empty array plus a safe warning instead of failing the whole
// request.

// Origins allowed to call this endpoint from the browser (Wix web + local dev).
const allowedOrigins = [
  "https://www.iterai.ro",
  "https://iterai.ro",
  "https://iter.ro",
  "http://localhost:3000",
  "http://localhost:5173",
];

// Reflects the request Origin when it is in the allowlist; otherwise falls back
// to the primary production origin. Reflecting a specific origin (not "*") is
// required so the browser accepts credentialed/again cross-origin responses.
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = allowedOrigins.includes(origin)
    ? origin
    : "https://www.iterai.ro";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  // Vary on Origin so caches don't serve the wrong allow-origin to a different
  // origin.
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-iter-secret, Cache-Control, Pragma, X-Requested-With",
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

// Canonical dashboard category slugs (frontend camelCase keys).
const CANONICAL_CATEGORIES = [
  "business",
  "studii",
  "cariera",
  "fitness",
  "finante",
  "comunicare",
  "socialMedia",
  "viataPersonala",
];

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

// Extracts a full messages array from a chat_sessions row regardless of which
// column/shape the data was stored under. Returns [] when nothing is found.
function extractMessagesArray(row) {
  if (!row || typeof row !== "object") return [];
  const candidates = [
    row.messages_json,
    row.messages,
    row.chatMessages,
    row.chat_messages,
    row.conversation,
    row.conversationMessages,
    row.conversation_json,
    row.metadata && row.metadata.messages,
    row.metadata && row.metadata.chatMessages,
    row.data && row.data.messages,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  // Also accept an empty array if messages_json is explicitly an empty array.
  if (Array.isArray(row.messages_json)) return row.messages_json;
  return [];
}

// Safely stringify a JSON-ish value, falling back to a default string.
function safeStringify(value, fallback) {
  try {
    if (value === undefined || value === null) return fallback;
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  // Handle CORS preflight.
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({
      success: false,
      message: "Nu am putut încărca datele dashboard-ului.",
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
        message: "Nu am putut încărca datele dashboard-ului.",
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
      message: "Nu am putut încărca datele dashboard-ului.",
      errorCode: "missing_email",
    });
    return;
  }

  const memberId = firstNonEmpty(body.memberId, body.wixMemberId) || null;

  // --- Mobile homepage limited-history mode ---
  // The mobile homepage sends source: "mobile-homepage" and only needs the
  // latest few rows. Limits are applied ONLY in that mode; every other request
  // (web + full mobile history pages) keeps the current full-history behavior.
  const source = firstNonEmpty(body.source);
  const isMobileHomepageRequest = source === "mobile-homepage";
  // Preview-only mode returns a lightweight payload (no full messages, no full
  // generation output, no saved generations). Only ever true for the mobile
  // homepage; every other request keeps the full behavior.
  const isPreviewOnly =
    isMobileHomepageRequest && body.previewOnly === true;

  // Parses a client-supplied limit into a safe integer (1..50) or null.
  const parseSafeLimit = (value, fallback) => {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.min(Math.floor(parsed), 50);
  };

  // Default full-history limit used for every non-mobile-homepage request. This
  // preserves the previous hardcoded behavior exactly.
  const FULL_HISTORY_LIMIT = 1000;

  // In mobile-homepage mode, an invalid/zero client limit falls back to 3 so
  // the query is never built with a null limit.
  const finalChatLimit = isMobileHomepageRequest
    ? parseSafeLimit(body.chatLimit, 3) || 3
    : FULL_HISTORY_LIMIT;
  const finalGenerationLimit = isMobileHomepageRequest
    ? parseSafeLimit(body.generationLimit, 3) || 3
    : FULL_HISTORY_LIMIT;
  const finalSavedGenerationLimit = isMobileHomepageRequest
    ? parseSafeLimit(body.savedGenerationLimit ?? body.generationLimit, 3) || 3
    : FULL_HISTORY_LIMIT;

  console.log("[dashboard-data] request mode", {
    source: source || null,
    isMobileHomepageRequest,
    finalChatLimit,
    finalGenerationLimit,
    finalSavedGenerationLimit,
  });

  // --- Environment (never exposed) ---
  const rawBaseUrl = process.env.SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!rawBaseUrl || !secretKey) {
    res.status(500).json({
      success: false,
      message: "Nu am putut încărca datele dashboard-ului.",
      errorCode: "supabase_not_configured",
    });
    return;
  }

  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const encodedEmail = encodeURIComponent(email);
  const warnings = [];
  const nowMs = Date.now();

  try {
    // --- 1. Profile lookup (by supabase_user_id = memberId OR email). ---
    let profile = null;
    let profileId = null;

    // 1a. Try by supabase_user_id when a memberId was provided.
    if (memberId) {
      const byMember = await supabaseSelect({
        baseUrl,
        secretKey,
        table: "profiles",
        query: `supabase_user_id=eq.${encodeURIComponent(memberId)}&select=*&limit=1`,
      });
      if (
        byMember.ok &&
        Array.isArray(byMember.data) &&
        byMember.data.length > 0
      ) {
        profile = byMember.data[0];
        profileId = profile.id || null;
      } else if (!byMember.ok) {
        console.error("[dashboard-data] profiles (by memberId) error", {
          status: byMember.status,
          data: byMember.data,
          error: byMember.error,
        });
      }
    }

    // 1b. Fall back to lookup by email.
    if (!profile) {
      const profileLookup = await supabaseSelect({
        baseUrl,
        secretKey,
        table: "profiles",
        query: `email=eq.${encodedEmail}&select=*&limit=1`,
      });
      if (
        profileLookup.ok &&
        Array.isArray(profileLookup.data) &&
        profileLookup.data.length > 0
      ) {
        profile = profileLookup.data[0];
        profileId = profile.id || null;
      } else if (!profileLookup.ok) {
        console.error("[dashboard-data] profiles (by email) error", {
          status: profileLookup.status,
          data: profileLookup.data,
          error: profileLookup.error,
        });
        warnings.push("profile_query_failed");
      }
    }

    // 1c. Create the profile if it does not exist yet. Never fatal.
    if (!profile) {
      const createProfile = await supabaseInsert({
        baseUrl,
        secretKey,
        table: "profiles",
        row: {
          email,
          supabase_user_id: memberId || null,
          has_account: true,
          created_from: "web_dashboard_data",
        },
      });
      if (
        createProfile.ok &&
        Array.isArray(createProfile.data) &&
        createProfile.data.length > 0
      ) {
        profile = createProfile.data[0];
        profileId = profile.id || null;
      } else {
        console.error("[dashboard-data] profiles insert error", {
          status: createProfile.status,
          data: createProfile.data,
          error: createProfile.error,
        });
        warnings.push("profile_create_failed");
      }
    }

    // --- 2. Active user_access rows. ---
    let activeAccess = [];
    const accessLookup = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "user_access",
      query: `email=eq.${encodedEmail}&status=eq.active&select=*`,
    });
    if (accessLookup.ok && Array.isArray(accessLookup.data)) {
      activeAccess = accessLookup.data.filter((row) => {
        if (!row || row.status !== "active") return false;
        // starts_at is null OR starts_at <= now
        if (row.starts_at) {
          const startMs = new Date(row.starts_at).getTime();
          if (!Number.isNaN(startMs) && startMs > nowMs) return false;
        }
        // expires_at is null OR expires_at > now
        if (row.expires_at) {
          const expMs = new Date(row.expires_at).getTime();
          if (!Number.isNaN(expMs) && expMs <= nowMs) return false;
        }
        return true;
      });
    } else if (!accessLookup.ok) {
      console.error("[dashboard-data] user_access error", {
        status: accessLookup.status,
        data: accessLookup.data,
        error: accessLookup.error,
      });
      warnings.push("user_access_query_failed");
    }

    // --- 3. usage_limits (by profile_id first, then email fallback). ---
    let usageRow = null;
    if (profileId) {
      const byProfile = await supabaseSelect({
        baseUrl,
        secretKey,
        table: "usage_limits",
        query: `profile_id=eq.${encodeURIComponent(profileId)}&select=*&limit=1`,
      });
      if (
        byProfile.ok &&
        Array.isArray(byProfile.data) &&
        byProfile.data.length > 0
      ) {
        usageRow = byProfile.data[0];
      } else if (!byProfile.ok) {
        console.error("[dashboard-data] usage_limits (by profile_id) error", {
          status: byProfile.status,
          data: byProfile.data,
          error: byProfile.error,
        });
        warnings.push("usage_limits_query_failed");
      }
    }
    if (!usageRow) {
      const byEmail = await supabaseSelect({
        baseUrl,
        secretKey,
        table: "usage_limits",
        query: `email=eq.${encodedEmail}&select=*&limit=1`,
      });
      if (
        byEmail.ok &&
        Array.isArray(byEmail.data) &&
        byEmail.data.length > 0
      ) {
        usageRow = byEmail.data[0];
      } else if (!byEmail.ok) {
        console.error("[dashboard-data] usage_limits (by email) error", {
          status: byEmail.status,
          data: byEmail.data,
          error: byEmail.error,
        });
        if (!warnings.includes("usage_limits_query_failed")) {
          warnings.push("usage_limits_query_failed");
        }
      }
    }

    // Create a default usage_limits row (3 free generations) when none exists
    // and we know the profile id. Never fatal.
    if (!usageRow && profileId) {
      const createUsage = await supabaseInsert({
        baseUrl,
        secretKey,
        table: "usage_limits",
        row: {
          profile_id: profileId,
          email,
          free_generations_total: 3,
          free_generations_used: 0,
          free_generations_remaining: 3,
        },
      });
      if (
        createUsage.ok &&
        Array.isArray(createUsage.data) &&
        createUsage.data.length > 0
      ) {
        usageRow = createUsage.data[0];
      } else {
        console.error("[dashboard-data] usage_limits insert error", {
          status: createUsage.status,
          data: createUsage.data,
          error: createUsage.error,
        });
        warnings.push("usage_limits_create_failed");
      }
    }

    // --- 4. Derive access flags. ---
    const isPremium = activeAccess.some(
      (row) => row.access_scope === "all" || row.plan === "premium",
    );

    const unlockedCategories = Array.from(
      new Set(
        activeAccess
          .filter((row) => row.access_scope === "category" && row.category_slug)
          .map((row) => row.category_slug),
      ),
    );

    // Free usage defaults to 3/0/3 when no usage row exists. Read from whatever
    // field names exist so schema variations never crash.
    const pickNumber = (...values) => {
      for (const v of values) {
        if (v === undefined || v === null) continue;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return null;
    };

    const freeGenerationsTotal =
      pickNumber(
        usageRow?.free_generations_total,
        usageRow?.freeGenerationsTotal,
        usageRow?.total,
      ) ?? 3;
    const freeGenerationsUsed =
      pickNumber(
        usageRow?.free_generations_used,
        usageRow?.freeGenerationsUsed,
        usageRow?.used,
      ) ?? 0;
    const freeGenerationsRemaining =
      pickNumber(
        usageRow?.free_generations_remaining,
        usageRow?.freeGenerationsRemaining,
        usageRow?.remaining,
      ) ?? Math.max(freeGenerationsTotal - freeGenerationsUsed, 0);

    // Build the categoryAccess map keyed by canonical slugs.
    const categoryAccess = {};
    for (const slug of CANONICAL_CATEGORIES) {
      if (isPremium) {
        categoryAccess[slug] = true;
      } else {
        categoryAccess[slug] = unlockedCategories.includes(slug);
      }
    }

    const accessScope = isPremium
      ? "all"
      : unlockedCategories.length > 0
        ? "category"
        : "free";

    const userAccess = {
      _source: "supabase",
      email,
      buyerEmail: email,
      memberId: memberId || email,
      isPremium,
      hasPremiumAccess: isPremium,
      accessScope,
      unlockedCategories,
      categoryAccess,
      freeGenerationsTotal,
      freeGenerationsUsed,
      freeGenerationsRemaining,
      activeAccess,
    };

    // --- 5. saved_generations (Wix-compatible shape). ---
    let savedGenerations = [];
    // Preview-only (mobile homepage) does not need saved generations at all, so
    // skip the query entirely and return an empty array.
    const savedLookup = isPreviewOnly
      ? { ok: true, data: [] }
      : await supabaseSelect({
          baseUrl,
          secretKey,
          table: "saved_generations",
          query: `email=eq.${encodedEmail}&order=created_at.desc&limit=${finalSavedGenerationLimit}&select=*`,
        });
    if (!isPreviewOnly && savedLookup.ok && Array.isArray(savedLookup.data)) {
      savedGenerations = savedLookup.data.map((row) => {
        // resultsJson: use results_json, else derive from result_markdown.
        let resultsJsonStr;
        if (row.results_json !== undefined && row.results_json !== null) {
          resultsJsonStr = safeStringify(row.results_json, "[]");
        } else if (row.result_markdown) {
          resultsJsonStr = safeStringify(
            [{ variantNumber: 1, result: row.result_markdown }],
            "[]",
          );
        } else {
          resultsJsonStr = "[]";
        }

        // variantCount: explicit, else results_json array length, else 1.
        let variantCount = 1;
        if (
          row.variant_count !== undefined &&
          row.variant_count !== null &&
          Number.isFinite(Number(row.variant_count))
        ) {
          variantCount = Number(row.variant_count);
        } else if (Array.isArray(row.results_json)) {
          variantCount = row.results_json.length || 1;
        }

        return {
          _id: row.wix_item_id || row.id,
          supabaseId: row.id,
          dataSource: "supabase",
          memberId: row.member_id || email,
          buyerEmail: row.email,
          title: row.title || "",
          toolId: row.tool_id || "",
          toolName: row.tool_name || "",
          toolSlug: row.tool_slug || "",
          categorySlug: row.category_slug || "",
          categoryName: row.category_name || "",
          userInputJson: safeStringify(row.user_input_json || {}, "{}"),
          resultsJson: resultsJsonStr,
          resultMarkdown: row.result_markdown || "",
          variantCount,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });
    } else if (!savedLookup.ok) {
      console.error("[dashboard-data] saved_generations error", {
        status: savedLookup.status,
        data: savedLookup.data,
        error: savedLookup.error,
      });
      warnings.push("saved_generations_query_failed");
    }

    // --- 6. generation_history (Wix-compatible shape). ---
    let generationHistory = [];
    const historyLookup = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "generation_history",
      query: `email=eq.${encodedEmail}&order=created_at.desc&limit=${finalGenerationLimit}&select=*`,
    });
    if (historyLookup.ok && Array.isArray(historyLookup.data)) {
      if (isPreviewOnly) {
        // Lightweight generation previews: NO full result/output/content. Only
        // ids, tool/category labels, and a short trimmed preview string.
        generationHistory = historyLookup.data.map((row) => {
          const generationId = row.generation_id || row.id;

          const title =
            row.title || row.tool_name || row.tool_id || "Generare ITER";

          const previewSource =
            row.preview ||
            row.input_summary ||
            row.result_markdown ||
            "";

          const preview = String(previewSource || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180);

          return {
            _id: row.wix_item_id || row.id,
            supabaseId: row.id,
            id: row.id,
            dataSource: "supabase",
            generationId,
            generation_id: generationId,
            toolId: row.tool_id || "",
            tool_id: row.tool_id || "",
            toolName: row.tool_name || "",
            tool_name: row.tool_name || "",
            toolSlug: row.tool_slug || "",
            tool_slug: row.tool_slug || "",
            categorySlug: row.category_slug || "",
            category_slug: row.category_slug || "",
            categoryName: row.category_name || "",
            title,
            preview,
            createdAt: row.created_at,
            created_at: row.created_at,
            updatedAt: row.updated_at,
            updated_at: row.updated_at,
          };
        });
      } else {
        generationHistory = historyLookup.data.map((row) => ({
          _id: row.wix_item_id || row.id,
          supabaseId: row.id,
          dataSource: "supabase",
          memberId: row.member_id || email,
          buyerEmail: row.email,
          toolId: row.tool_id || "",
          toolName: row.tool_name || "",
          toolSlug: row.tool_slug || "",
          categorySlug: row.category_slug || "",
          categoryName: row.category_name || "",
          userInputJson: safeStringify(row.user_input_json || {}, "{}"),
          resultMarkdown: row.result_markdown || "",
          variantNumber:
            row.variant_number !== undefined &&
            row.variant_number !== null &&
            Number.isFinite(Number(row.variant_number))
              ? Number(row.variant_number)
              : 1,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
      }
    } else if (!historyLookup.ok) {
      console.error("[dashboard-data] generation_history error", {
        status: historyLookup.status,
        data: historyLookup.data,
        error: historyLookup.error,
      });
      warnings.push("generation_history_query_failed");
    }

    // --- 7. chat_sessions (Wix-compatible shape). ---
    let chatHistory = [];
    // In preview-only mode we select only the light columns needed for a card
    // (never messages_json / tools_json / heavy blobs), which keeps the payload
    // small. Normal mode keeps select=* so full history is unchanged.
    const chatSelect = isPreviewOnly
      ? "id,wix_item_id,chat_session_id,chat_type,category_slug,specialist_slug,category_name,chat_title,last_message_preview,member_id,email,profile_id,created_at,updated_at"
      : "*";
    const chatLookup = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "chat_sessions",
      query: `email=eq.${encodedEmail}&order=updated_at.desc&limit=${finalChatLimit}&select=${chatSelect}`,
    });
    if (chatLookup.ok && Array.isArray(chatLookup.data) && isPreviewOnly) {
      // Lightweight chat previews: NO message parsing, NO per-item logging, NO
      // conversation/metadata. Empty messages arrays so mobile cards render.
      chatHistory = chatLookup.data.map((row) => {
        const displayCategorySlug =
          row.chat_type === "category"
            ? row.category_slug
            : row.specialist_slug;

        const normalizedChatSessionId =
          row.wix_item_id || row.chat_session_id || row.id;

        const categorySlug = displayCategorySlug || row.category_slug || "";

        const lastMessage = row.last_message_preview || "";

        const title = row.chat_title || row.category_name || "Chat ITER";

        return {
          _id: row.wix_item_id || row.id,
          supabaseId: row.id,
          id: row.id,
          dataSource: "supabase",
          memberId: row.member_id || email,
          buyerEmail: row.email,
          chatType: row.chat_type,
          type: row.chat_type || "category",
          categorySlug,
          category_slug: categorySlug,
          realCategorySlug: row.category_slug || "",
          specialistSlug: row.specialist_slug || "",
          categoryName: row.category_name || "",
          title,
          chatSessionId: normalizedChatSessionId,
          chat_session_id: normalizedChatSessionId,
          wixItemId: normalizedChatSessionId,
          wix_item_id: normalizedChatSessionId,
          lastMessage,
          last_message: lastMessage,
          lastMessagePreview: String(lastMessage || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180),
          messageCount: 0,
          messages: [],
          chatMessages: [],
          messagesJson: "[]",
          createdAt: row.created_at,
          created_at: row.created_at,
          updatedAt: row.updated_at,
          updated_at: row.updated_at,
          profileId: row.profile_id,
          profile_id: row.profile_id,
        };
      });
    } else if (chatLookup.ok && Array.isArray(chatLookup.data)) {
      chatHistory = chatLookup.data.map((row) => {
        // For specialist chats, expose specialist_slug as categorySlug so that
        // existing dashboard cards can display something, while still including
        // the real category slug, specialist slug, and chat type.
        const displayCategorySlug =
          row.chat_type === "category"
            ? row.category_slug
            : row.specialist_slug;

        // Canonical chat session id: prefer wix_item_id so web and mobile open
        // the SAME conversation. Only fall back to the Supabase row id when no
        // wix_item_id (or legacy chat_session_id) exists.
        const normalizedChatSessionId =
          row.wix_item_id || row.chat_session_id || row.id;

        // Resolve the FULL stored messages array from chat_sessions, accepting
        // any of the column/shape variants the data may have been stored under.
        const fullMessagesArray = extractMessagesArray(row);

        // Category slug resolution (supports metadata fallback).
        const normalizedCategorySlug =
          row.category_slug ||
          row.categorySlug ||
          (row.metadata && row.metadata.categorySlug) ||
          "";

        // Last message: prefer stored preview, else derive from the last
        // message's text content. Never return only lastMessage.
        const lastStored =
          fullMessagesArray.length > 0
            ? fullMessagesArray[fullMessagesArray.length - 1]
            : null;
        const derivedLast =
          lastStored && typeof lastStored === "object"
            ? lastStored.content ||
              lastStored.text ||
              lastStored.message ||
              ""
            : "";
        const lastMessage = row.last_message_preview || derivedLast || "";

        const title = row.chat_title || row.category_name || "Chat ITER";

        console.log("[dashboard-data chatHistory normalized item]", {
          rowId: row.id,
          rowWixItemId: row.wix_item_id,
          canonicalChatSessionId: normalizedChatSessionId,
          categorySlug: displayCategorySlug || normalizedCategorySlug,
          messagesCount: fullMessagesArray.length,
          lastMessage,
        });

        // Temporary targeted diagnostic for the specific chat reported as
        // failing to open on web. Remove once confirmed working.
        if (
          row.id === "85151135-c745-4742-8588-1721dcc4217f" ||
          row.wix_item_id === "99dce5a7-cedb-4dde-9f2f-89a6f9dcecad"
        ) {
          console.log("[dashboard-data TARGET CHAT FOUND]", {
            canonicalChatSessionId: normalizedChatSessionId,
            returnedFields: {
              chatSessionId: normalizedChatSessionId,
              wixItemId: normalizedChatSessionId,
              wix_item_id: normalizedChatSessionId,
              id: row.id,
            },
          });
        }

        return {
          // --- Existing fields (unchanged, do not remove) ---
          _id: row.wix_item_id || row.id,
          supabaseId: row.id,
          dataSource: "supabase",
          memberId: row.member_id || email,
          buyerEmail: row.email,
          chatType: row.chat_type,
          categorySlug: displayCategorySlug || "",
          realCategorySlug: row.category_slug || "",
          specialistSlug: row.specialist_slug || "",
          categoryName: row.category_name || "",
          title,
          messagesJson: safeStringify(fullMessagesArray, "[]"),
          toolsJson: safeStringify(row.tools_json || [], "[]"),
          lastMessagePreview: row.last_message_preview || "",
          createdAt: row.created_at,
          updatedAt: row.updated_at,

          // --- Normalized id fields (canonical: wix_item_id) ---
          id: row.id,
          chatSessionId: normalizedChatSessionId,
          chat_session_id: normalizedChatSessionId,
          wixItemId: normalizedChatSessionId,
          wix_item_id: normalizedChatSessionId,

          // --- Normalized category + type ---
          category_slug: displayCategorySlug || normalizedCategorySlug,
          type: row.chat_type || row.type || "category",

          // --- Full messages under all expected field names ---
          messageCount: fullMessagesArray.length,
          messages: fullMessagesArray,
          chatMessages: fullMessagesArray,

          // --- Last message under both casings ---
          lastMessage,
          last_message: lastMessage,

          // --- Timestamps under both casings ---
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      });
    } else if (!chatLookup.ok) {
      console.error("[dashboard-data] chat_sessions error", {
        status: chatLookup.status,
        data: chatLookup.data,
        error: chatLookup.error,
      });
      warnings.push("chat_sessions_query_failed");
    }

    // Structured profile block for the dashboard UI (name/avatar display).
    const profileBlock = {
      email,
      fullName: (profile && profile.full_name) || "",
      avatarUrl: (profile && profile.avatar_url) || "",
      hasAccount: (profile && profile.has_account) || false,
    };

    const responsePayload = {
      success: true,
      source: "supabase",
      email,
      profile: profileBlock,
      profileRaw: profile || null,
      userAccess,
      savedGenerations,
      generationHistory,
      chatHistory,
      warnings,
    };

    let responseSizeKb = 0;
    try {
      responseSizeKb = Math.round(
        Buffer.byteLength(JSON.stringify(responsePayload), "utf8") / 1024,
      );
    } catch {
      responseSizeKb = -1;
    }

    console.log("[dashboard-data] Response summary:", {
      email,
      source: source || null,
      isMobileHomepageRequest,
      isPreviewOnly,
      finalChatLimit,
      finalGenerationLimit,
      finalSavedGenerationLimit,
      userAccessPresent: !!userAccess,
      savedGenerationsCount: savedGenerations.length,
      generationHistoryCount: generationHistory.length,
      chatHistoryCount: chatHistory.length,
      responseSizeKb,
    });

    res.status(200).json(responsePayload);
  } catch (error) {
    // Log the real cause to Vercel and surface it to the client so the failure
    // is debuggable instead of a generic 500. CORS headers were already set at
    // the very top of the handler, so this response is still cross-origin safe.
    console.error("[dashboard-data] internal error", {
      message: error?.message || String(error),
      stack: error?.stack,
    });
    res.status(500).json({
      success: false,
      source: "supabase",
      message: "Dashboard data failed",
      error: error?.message || String(error),
      stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined,
      errorCode: "internal_error",
    });
  }
}
