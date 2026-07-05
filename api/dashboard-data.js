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
  setCorsHeaders(res);

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
    // --- 1. Profile lookup (best-effort). ---
    let profile = null;
    let profileId = null;
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
      warnings.push("profile_query_failed");
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
      } else if (!byEmail.ok && !warnings.includes("usage_limits_query_failed")) {
        warnings.push("usage_limits_query_failed");
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

    // Free usage defaults to 3/0/3 when no usage row exists.
    const freeGenerationsTotal =
      usageRow && Number.isFinite(Number(usageRow.free_generations_total))
        ? Number(usageRow.free_generations_total)
        : 3;
    const freeGenerationsUsed =
      usageRow && Number.isFinite(Number(usageRow.free_generations_used))
        ? Number(usageRow.free_generations_used)
        : 0;
    const freeGenerationsRemaining =
      usageRow && Number.isFinite(Number(usageRow.free_generations_remaining))
        ? Number(usageRow.free_generations_remaining)
        : Math.max(freeGenerationsTotal - freeGenerationsUsed, 0);

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
    const savedLookup = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "saved_generations",
      query: `email=eq.${encodedEmail}&order=created_at.desc&limit=1000&select=*`,
    });
    if (savedLookup.ok && Array.isArray(savedLookup.data)) {
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
      warnings.push("saved_generations_query_failed");
    }

    // --- 6. generation_history (Wix-compatible shape). ---
    let generationHistory = [];
    const historyLookup = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "generation_history",
      query: `email=eq.${encodedEmail}&order=created_at.desc&limit=1000&select=*`,
    });
    if (historyLookup.ok && Array.isArray(historyLookup.data)) {
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
    } else if (!historyLookup.ok) {
      warnings.push("generation_history_query_failed");
    }

    // --- 7. chat_sessions (Wix-compatible shape). ---
    let chatHistory = [];
    const chatLookup = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "chat_sessions",
      query: `email=eq.${encodedEmail}&order=updated_at.desc&limit=1000&select=*`,
    });
    if (chatLookup.ok && Array.isArray(chatLookup.data)) {
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

        // Resolve the FULL stored messages array from chat_sessions. The field
        // is `messages_json`; accept a couple of legacy fallbacks just in case.
        const rawMessages = Array.isArray(row.messages_json)
          ? row.messages_json
          : Array.isArray(row.messages)
            ? row.messages
            : Array.isArray(row.chat_messages)
              ? row.chat_messages
              : [];
        const fullMessagesArray = rawMessages;

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

        console.log("[dashboard-data chat row]", {
          rowId: row.id,
          rowWixItemId: row.wix_item_id,
          normalizedChatSessionId,
          categorySlug: displayCategorySlug || normalizedCategorySlug,
          messagesCount: fullMessagesArray.length,
          lastMessage,
        });

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
      warnings.push("chat_sessions_query_failed");
    }

    // Structured profile block for the dashboard UI (name/avatar display).
    const profileBlock = {
      email,
      fullName: (profile && profile.full_name) || "",
      avatarUrl: (profile && profile.avatar_url) || "",
      hasAccount: (profile && profile.has_account) || false,
    };

    res.status(200).json({
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
    });
  } catch (error) {
    // Log the real cause to Vercel; return a safe message to the client.
    console.error(
      "[v0] dashboard-data internal error:",
      error?.message || String(error),
    );
    res.status(500).json({
      success: false,
      message: "Nu am putut încărca datele dashboard-ului.",
      errorCode: "internal_error",
    });
  }
}
