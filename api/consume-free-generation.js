// Vercel Serverless Function: POST /api/consume-free-generation
// Consumes exactly 1 free generation ONLY when a user without paid access
// successfully receives an AI response. Idempotent via idempotency_key.
// Uses the Supabase REST API directly via fetch. No new packages.

import { randomUUID } from "node:crypto";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-iter-secret, Authorization"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

// Basic, conservative email validation.
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Valid ITER AI category slugs.
const VALID_CATEGORY_SLUGS = [
  "business",
  "studii",
  "cariera",
  "fitness",
  "finante",
  "comunicare",
  "socialMedia",
  "viataPersonala",
];

// Valid action types.
const VALID_ACTION_TYPES = [
  "tool_generation",
  "category_chat",
  "specialist_chat",
];

// Action types that operate on an ITER AI tool category and therefore require
// a valid categorySlug.
const CATEGORY_ACTION_TYPES = ["tool_generation", "category_chat"];

// Canonical Wix specialist IDs. Specialist chat is independent from the 8 tool
// categories, so these are validated separately and never mapped to a
// categorySlug.
const VALID_SPECIALIST_SLUGS = [
  "legal-guide",
  "medical-guide",
  "fiscal-guide",
  "financial-guide",
  "architecture-guide",
  "construction-guide",
  "interior-guide",
  "auto-guide",
  "business-guide",
  "marketing-guide",
  "career-guide",
  "clarity-guide",
  "fitness-guide",
  "personal-guide",
];

// Extract the internal secret from any of the supported locations.
function getProvidedSecret(req) {
  const headerSecret = req.headers["x-iter-secret"];
  if (typeof headerSecret === "string" && headerSecret) return headerSecret;

  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token) return token;
  }

  if (
    req.body &&
    typeof req.body === "object" &&
    typeof req.body.secret === "string" &&
    req.body.secret
  ) {
    return req.body.secret;
  }

  if (req.query && typeof req.query.secret === "string" && req.query.secret) {
    return req.query.secret;
  }

  return "";
}

// Parse the request body whether it arrives pre-parsed or as a raw string.
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

// Select rows from a Supabase table using a filtered GET query.
async function supabaseSelect({ baseUrl, secretKey, table, query }) {
  const url = `${baseUrl}/rest/v1/${table}?${query}`;

  const resp = await fetch(url, {
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
}

// Insert a row into a Supabase table (returns the created representation).
async function supabaseInsert({ baseUrl, secretKey, table, row }) {
  const url = `${baseUrl}/rest/v1/${table}`;

  const resp = await fetch(url, {
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
}

// Update rows in a Supabase table matching a filter (returns representation).
async function supabaseUpdate({ baseUrl, secretKey, table, query, row }) {
  const url = `${baseUrl}/rest/v1/${table}?${query}`;

  const resp = await fetch(url, {
    method: "PATCH",
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
}

// True if an access row is currently active (status active and not expired).
function isAccessActive(row, nowMs) {
  if (!row || row.status !== "active") return false;
  if (row.expires_at === null || row.expires_at === undefined) return true;
  const expiresMs = new Date(row.expires_at).getTime();
  if (Number.isNaN(expiresMs)) return true;
  return expiresMs > nowMs;
}

// Build a usage_events row with sensible defaults.
function buildUsageEvent(base) {
  return {
    email: base.email,
    category_slug: base.categorySlug,
    action_type: base.actionType,
    idempotency_key: base.idempotencyKey,
    consumed_amount: 0,
    was_consumed: false,
    access_type: "none",
    reason: base.reason,
    metadata: base.metadata,
    ...base.extra,
  };
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
      error: "Method not allowed. Use POST.",
    });
    return;
  }

  // --- Environment validation ---
  const baseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const internalSecret = process.env.ITER_INTERNAL_API_SECRET;

  if (!internalSecret) {
    res.status(500).json({
      success: false,
      error: "Server misconfigured: ITER_INTERNAL_API_SECRET is not set.",
    });
    return;
  }

  if (!baseUrl || !secretKey) {
    res.status(500).json({
      success: false,
      error:
        "Server misconfigured: SUPABASE_URL and/or SUPABASE_SECRET_KEY is not set.",
    });
    return;
  }

  // --- Auth: require the internal secret ---
  const providedSecret = getProvidedSecret(req);

  if (!providedSecret || providedSecret !== internalSecret) {
    res.status(401).json({
      success: false,
      error: "Unauthorized: missing or invalid secret.",
    });
    return;
  }

  // --- Input validation ---
  const body = parseBody(req);

  const rawEmail = body.email;
  if (!rawEmail || typeof rawEmail !== "string" || !rawEmail.trim()) {
    res.status(400).json({
      success: false,
      error: "Bad request: email is required.",
    });
    return;
  }

  const email = rawEmail.trim().toLowerCase();

  if (!isValidEmail(email)) {
    res.status(400).json({
      success: false,
      error: "Bad request: email is not valid.",
    });
    return;
  }

  // Validate actionType first, because whether categorySlug is required depends
  // on it (specialist_chat does not use categorySlug).
  const rawActionType = body.actionType;
  if (
    !rawActionType ||
    typeof rawActionType !== "string" ||
    !rawActionType.trim()
  ) {
    res.status(400).json({
      success: false,
      error: "Bad request: actionType is required.",
    });
    return;
  }

  const actionType = rawActionType.trim();

  if (!VALID_ACTION_TYPES.includes(actionType)) {
    res.status(400).json({
      success: false,
      error: "Bad request: actionType is not valid.",
    });
    return;
  }

  const isSpecialistChat = actionType === "specialist_chat";

  // categorySlug handling:
  // - tool_generation / category_chat: required and must be a valid category.
  // - specialist_chat: optional; always stored as null in usage_events.
  let categorySlug = null;

  if (CATEGORY_ACTION_TYPES.includes(actionType)) {
    const rawCategorySlug = body.categorySlug;
    if (
      !rawCategorySlug ||
      typeof rawCategorySlug !== "string" ||
      !rawCategorySlug.trim()
    ) {
      res.status(400).json({
        success: false,
        error: "Bad request: categorySlug is required.",
      });
      return;
    }

    const trimmedCategorySlug = rawCategorySlug.trim();

    if (!VALID_CATEGORY_SLUGS.includes(trimmedCategorySlug)) {
      res.status(400).json({
        success: false,
        error: "Bad request: categorySlug is not valid.",
      });
      return;
    }

    categorySlug = trimmedCategorySlug;
  }

  // Optional fields.
  const toolSlug =
    typeof body.toolSlug === "string" && body.toolSlug.trim()
      ? body.toolSlug.trim()
      : null;
  const specialistSlug =
    typeof body.specialistSlug === "string" && body.specialistSlug.trim()
      ? body.specialistSlug.trim()
      : null;

  // specialist_chat requires a valid canonical specialist slug.
  if (isSpecialistChat) {
    if (!specialistSlug) {
      res.status(400).json({
        success: false,
        error: "Bad request: specialistSlug is required for specialist_chat.",
      });
      return;
    }

    if (!VALID_SPECIALIST_SLUGS.includes(specialistSlug)) {
      res.status(400).json({
        success: false,
        error: "Bad request: specialistSlug is not valid.",
      });
      return;
    }
  }

  // idempotencyKey is preferred from the caller, but we generate a stable
  // fallback so the endpoint stays idempotent per request.
  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : randomUUID();
  const chatSessionId =
    typeof body.chatSessionId === "string" && body.chatSessionId.trim()
      ? body.chatSessionId.trim()
      : null;
  const metadata =
    body.metadata && typeof body.metadata === "object" ? body.metadata : {};

  // Normalize base URL (strip trailing slash).
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const nowMs = Date.now();
  const nowIso = new Date().toISOString();

  try {
    // --- 1. Idempotency check: look up existing usage_event by key. ---
    const existingEventResult = await supabaseSelect({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "usage_events",
      query: `idempotency_key=eq.${encodeURIComponent(
        idempotencyKey
      )}&select=*&limit=1`,
    });

    if (!existingEventResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: existingEventResult.data,
      });
      return;
    }

    const existingEvent =
      Array.isArray(existingEventResult.data) &&
      existingEventResult.data.length > 0
        ? existingEventResult.data[0]
        : null;

    if (existingEvent) {
      // Already processed. Do NOT consume again. Fetch usage_limits for
      // current free-generation values, if available.
      const usageResult = await supabaseSelect({
        baseUrl: normalizedBaseUrl,
        secretKey,
        table: "usage_limits",
        query: `email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
      });

      const usageRow =
        usageResult.ok &&
        Array.isArray(usageResult.data) &&
        usageResult.data.length > 0
          ? usageResult.data[0]
          : null;

      const freeGenerations = usageRow
        ? {
            before: null,
            after: null,
            total:
              typeof usageRow.free_generations_total === "number"
                ? usageRow.free_generations_total
                : 0,
            used:
              typeof usageRow.free_generations_used === "number"
                ? usageRow.free_generations_used
                : 0,
            remaining:
              typeof usageRow.free_generations_remaining === "number"
                ? usageRow.free_generations_remaining
                : 0,
          }
        : null;

      res.status(200).json({
        success: true,
        email,
        categorySlug,
        actionType,
        specialistSlug,
        hasAccess: existingEvent.was_consumed
          ? true
          : existingEvent.access_type === "premium" ||
            existingEvent.access_type === "category" ||
            existingEvent.access_type === "free_trial",
        accessType: existingEvent.access_type || "none",
        wasConsumed: existingEvent.was_consumed === true,
        alreadyProcessed: true,
        shouldRedirectToCheckout: false,
        reason: existingEvent.reason || "already_processed",
        freeGenerations,
        usageEvent: existingEvent,
      });
      return;
    }

    // --- 2. Fetch profile by normalized email. ---
    const profileResult = await supabaseSelect({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "profiles",
      query: `email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    });

    if (!profileResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: profileResult.data,
      });
      return;
    }

    const profile =
      Array.isArray(profileResult.data) && profileResult.data.length > 0
        ? profileResult.data[0]
        : null;

    // --- 3. No profile: record event, do NOT create profile here. ---
    if (!profile) {
      const eventResult = await supabaseInsert({
        baseUrl: normalizedBaseUrl,
        secretKey,
        table: "usage_events",
        row: buildUsageEvent({
          email,
          categorySlug,
          actionType,
          idempotencyKey,
          reason: "profile_not_found",
          metadata,
          extra: {
            tool_slug: toolSlug,
            specialist_slug: specialistSlug,
            chat_session_id: chatSessionId,
            access_type: "none",
          },
        }),
      });

      if (!eventResult.ok) {
        res.status(500).json({
          success: false,
          error: "Supabase request failed.",
          details: eventResult.data,
        });
        return;
      }

      const usageEvent = Array.isArray(eventResult.data)
        ? eventResult.data[0]
        : eventResult.data;

      res.status(200).json({
        success: false,
        email,
        categorySlug,
        actionType,
        specialistSlug,
        hasAccess: false,
        accessType: "none",
        wasConsumed: false,
        alreadyProcessed: false,
        shouldRedirectToCheckout: true,
        reason: "profile_not_found",
        freeGenerations: null,
        usageEvent,
      });
      return;
    }

    // --- 4. Fetch active user_access rows and filter by expiry in code. ---
    const accessResult = await supabaseSelect({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "user_access",
      query: `email=eq.${encodeURIComponent(
        email
      )}&status=eq.active&select=*`,
    });

    if (!accessResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: accessResult.data,
      });
      return;
    }

    const activeAccess = (
      Array.isArray(accessResult.data) ? accessResult.data : []
    ).filter((row) => isAccessActive(row, nowMs));

    // --- 5. Premium access: do NOT consume. ---
    const premiumRow = activeAccess.find(
      (row) => row.access_scope === "all" && row.plan === "premium"
    );

    if (premiumRow) {
      const eventResult = await supabaseInsert({
        baseUrl: normalizedBaseUrl,
        secretKey,
        table: "usage_events",
        row: buildUsageEvent({
          email,
          categorySlug,
          actionType,
          idempotencyKey,
          reason: "paid_access_premium",
          metadata,
          extra: {
            profile_id: profile.id,
            tool_slug: toolSlug,
            specialist_slug: specialistSlug,
            chat_session_id: chatSessionId,
            access_type: "premium",
          },
        }),
      });

      if (!eventResult.ok) {
        res.status(500).json({
          success: false,
          error: "Supabase request failed.",
          details: eventResult.data,
        });
        return;
      }

      const usageEvent = Array.isArray(eventResult.data)
        ? eventResult.data[0]
        : eventResult.data;

      res.status(200).json({
        success: true,
        email,
        categorySlug,
        actionType,
        specialistSlug,
        hasAccess: true,
        accessType: "premium",
        wasConsumed: false,
        alreadyProcessed: false,
        shouldRedirectToCheckout: false,
        reason: "paid_access_premium",
        freeGenerations: null,
        usageEvent,
      });
      return;
    }

    // --- 6. Category access for the requested category: do NOT consume. ---
    // Specialist chat is independent from the 8 tool categories, so category-
    // only paid access must NOT count as paid access for specialist_chat.
    const categoryRow = isSpecialistChat
      ? null
      : activeAccess.find(
          (row) =>
            row.access_scope === "category" &&
            row.category_slug === categorySlug
        );

    if (categoryRow) {
      const eventResult = await supabaseInsert({
        baseUrl: normalizedBaseUrl,
        secretKey,
        table: "usage_events",
        row: buildUsageEvent({
          email,
          categorySlug,
          actionType,
          idempotencyKey,
          reason: "paid_access_category",
          metadata,
          extra: {
            profile_id: profile.id,
            tool_slug: toolSlug,
            specialist_slug: specialistSlug,
            chat_session_id: chatSessionId,
            access_type: "category",
          },
        }),
      });

      if (!eventResult.ok) {
        res.status(500).json({
          success: false,
          error: "Supabase request failed.",
          details: eventResult.data,
        });
        return;
      }

      const usageEvent = Array.isArray(eventResult.data)
        ? eventResult.data[0]
        : eventResult.data;

      res.status(200).json({
        success: true,
        email,
        categorySlug,
        actionType,
        specialistSlug,
        hasAccess: true,
        accessType: "category",
        wasConsumed: false,
        alreadyProcessed: false,
        shouldRedirectToCheckout: false,
        reason: "paid_access_category",
        freeGenerations: null,
        usageEvent,
      });
      return;
    }

    // --- 7. Fetch usage_limits by normalized email. ---
    const usageResult = await supabaseSelect({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "usage_limits",
      query: `email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    });

    if (!usageResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: usageResult.data,
      });
      return;
    }

    const usageRow =
      Array.isArray(usageResult.data) && usageResult.data.length > 0
        ? usageResult.data[0]
        : null;

    // --- 8. No usage_limits row: record event, redirect to checkout. ---
    if (!usageRow) {
      const eventResult = await supabaseInsert({
        baseUrl: normalizedBaseUrl,
        secretKey,
        table: "usage_events",
        row: buildUsageEvent({
          email,
          categorySlug,
          actionType,
          idempotencyKey,
          reason: "usage_limits_not_found",
          metadata,
          extra: {
            profile_id: profile.id,
            tool_slug: toolSlug,
            specialist_slug: specialistSlug,
            chat_session_id: chatSessionId,
            access_type: "none",
          },
        }),
      });

      if (!eventResult.ok) {
        res.status(500).json({
          success: false,
          error: "Supabase request failed.",
          details: eventResult.data,
        });
        return;
      }

      const usageEvent = Array.isArray(eventResult.data)
        ? eventResult.data[0]
        : eventResult.data;

      res.status(200).json({
        success: false,
        email,
        categorySlug,
        actionType,
        specialistSlug,
        hasAccess: false,
        accessType: "none",
        wasConsumed: false,
        alreadyProcessed: false,
        shouldRedirectToCheckout: true,
        reason: "usage_limits_not_found",
        freeGenerations: null,
        usageEvent,
      });
      return;
    }

    const total =
      typeof usageRow.free_generations_total === "number"
        ? usageRow.free_generations_total
        : 0;
    const used =
      typeof usageRow.free_generations_used === "number"
        ? usageRow.free_generations_used
        : 0;
    const remaining =
      typeof usageRow.free_generations_remaining === "number"
        ? usageRow.free_generations_remaining
        : 0;

    // --- 9. No free generations remaining: record event, redirect. ---
    if (remaining <= 0) {
      const eventResult = await supabaseInsert({
        baseUrl: normalizedBaseUrl,
        secretKey,
        table: "usage_events",
        row: buildUsageEvent({
          email,
          categorySlug,
          actionType,
          idempotencyKey,
          reason: "no_free_generations_remaining",
          metadata,
          extra: {
            profile_id: profile.id,
            tool_slug: toolSlug,
            specialist_slug: specialistSlug,
            chat_session_id: chatSessionId,
            access_type: "none",
          },
        }),
      });

      if (!eventResult.ok) {
        res.status(500).json({
          success: false,
          error: "Supabase request failed.",
          details: eventResult.data,
        });
        return;
      }

      const usageEvent = Array.isArray(eventResult.data)
        ? eventResult.data[0]
        : eventResult.data;

      res.status(200).json({
        success: true,
        email,
        categorySlug,
        actionType,
        specialistSlug,
        hasAccess: false,
        accessType: "none",
        wasConsumed: false,
        alreadyProcessed: false,
        shouldRedirectToCheckout: true,
        reason: "no_free_generations_remaining",
        freeGenerations: {
          before: remaining,
          after: remaining,
          total,
          used,
          remaining,
        },
        usageEvent,
      });
      return;
    }

    // --- 10. Consume exactly 1 free generation. ---
    const freeBefore = remaining;
    const freeAfter = remaining - 1;
    const usedAfter = used + 1;

    const updateResult = await supabaseUpdate({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "usage_limits",
      query: `email=eq.${encodeURIComponent(email)}`,
      row: {
        free_generations_used: usedAfter,
        free_generations_remaining: freeAfter,
        last_generation_at: nowIso,
        updated_at: nowIso,
      },
    });

    if (!updateResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: updateResult.data,
      });
      return;
    }

    // Record the consumption event.
    const eventResult = await supabaseInsert({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "usage_events",
      row: buildUsageEvent({
        email,
        categorySlug,
        actionType,
        idempotencyKey,
        reason: "free_generation_consumed",
        metadata,
        extra: {
          profile_id: profile.id,
          tool_slug: toolSlug,
          specialist_slug: specialistSlug,
          chat_session_id: chatSessionId,
          consumed_amount: 1,
          was_consumed: true,
          free_generations_before: freeBefore,
          free_generations_after: freeAfter,
          access_type: "free_trial",
        },
      }),
    });

    if (!eventResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: eventResult.data,
      });
      return;
    }

    const usageEvent = Array.isArray(eventResult.data)
      ? eventResult.data[0]
      : eventResult.data;

    res.status(200).json({
      success: true,
      email,
      categorySlug,
      actionType,
      specialistSlug,
      hasAccess: true,
      accessType: "free_trial",
      wasConsumed: true,
      alreadyProcessed: false,
      shouldRedirectToCheckout: false,
      reason: "free_generation_consumed",
      freeGenerations: {
        before: freeBefore,
        after: freeAfter,
        total,
        used: usedAfter,
        remaining: freeAfter,
      },
      usageEvent,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Supabase request failed.",
      details: error.message,
    });
  }
}
