// Vercel Serverless Function: POST /api/profile-get-or-create
// Gets or creates a profile (keyed by email), ensures a usage_limits row
// exists (without resetting existing usage), and returns active access rows.
// Uses the Supabase REST API directly via fetch. No new packages.

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

// Extract the internal secret from any of the supported locations.
function getProvidedSecret(req) {
  const headerSecret = req.headers["x-iter-secret"];
  if (typeof headerSecret === "string" && headerSecret) return headerSecret;

  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token) return token;
  }

  if (req.body && typeof req.body === "object" && typeof req.body.secret === "string" && req.body.secret) {
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

// Upsert a row into a Supabase table and return the row(s).
async function supabaseUpsert({ baseUrl, secretKey, table, row, onConflict }) {
  const url = `${baseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;

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

  const wixMemberId =
    typeof body.wixMemberId === "string" && body.wixMemberId.trim()
      ? body.wixMemberId.trim()
      : null;
  const fullName =
    typeof body.fullName === "string" && body.fullName.trim()
      ? body.fullName.trim()
      : null;
  // Optional fields from Supabase Auth (e.g. Google login).
  const avatarUrl =
    typeof body.avatarUrl === "string" && body.avatarUrl.trim()
      ? body.avatarUrl.trim()
      : null;
  const supabaseUserId =
    typeof body.supabaseUserId === "string" && body.supabaseUserId.trim()
      ? body.supabaseUserId.trim()
      : null;
  const allowedCreatedFrom = [
    "wix_member",
    "purchase",
    "mobile",
    "manual",
    "supabase_auth",
    "unknown",
  ];
  const createdFrom =
    typeof body.createdFrom === "string" &&
    allowedCreatedFrom.includes(body.createdFrom)
      ? body.createdFrom
      : "unknown";

  // A user that reaches this endpoint via an authenticated session has an
  // account. Once true, has_account is never downgraded below.
  const hasAccount =
    createdFrom === "wix_member" ||
    createdFrom === "mobile" ||
    createdFrom === "supabase_auth";

  // Normalize base URL (strip trailing slash).
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const nowIso = new Date().toISOString();

  try {
    // 0. Fetch the existing profile (if any) so we can merge without
    //    overwriting existing values with empty/null.
    const existingProfileLookup = await supabaseSelect({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "profiles",
      query: `email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    });

    const existingProfile =
      existingProfileLookup.ok &&
      Array.isArray(existingProfileLookup.data) &&
      existingProfileLookup.data.length > 0
        ? existingProfileLookup.data[0]
        : null;

    // Preserve an existing created_from when it is already set; otherwise use
    // the incoming value.
    const resolvedCreatedFrom =
      existingProfile && existingProfile.created_from
        ? existingProfile.created_from
        : createdFrom;

    // has_account is sticky: once true it stays true.
    const resolvedHasAccount =
      (existingProfile && existingProfile.has_account === true) || hasAccount;

    // Merge metadata so we never drop previously stored keys.
    const mergedMetadata = {
      ...(existingProfile && existingProfile.metadata &&
      typeof existingProfile.metadata === "object"
        ? existingProfile.metadata
        : {}),
      source: "api/profile-get-or-create",
      updated_at: nowIso,
    };

    // 1. Upsert the profile (keyed by email). Only include full_name,
    //    avatar_url, and supabase_user_id when we actually have a value, so an
    //    existing value is never overwritten with empty/null.
    const profileRow = {
      email,
      has_account: resolvedHasAccount,
      created_from: resolvedCreatedFrom,
      metadata: mergedMetadata,
    };
    if (wixMemberId) profileRow.wix_member_id = wixMemberId;
    if (fullName) profileRow.full_name = fullName;
    if (avatarUrl) profileRow.avatar_url = avatarUrl;
    if (supabaseUserId) profileRow.supabase_user_id = supabaseUserId;

    const profileResult = await supabaseUpsert({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "profiles",
      onConflict: "email",
      row: profileRow,
    });

    if (!profileResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: profileResult.data,
      });
      return;
    }

    const profile = Array.isArray(profileResult.data)
      ? profileResult.data[0]
      : profileResult.data;

    if (!profile || !profile.id) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: "Profile upsert did not return an id.",
      });
      return;
    }

    // 2. Ensure a usage_limits row exists WITHOUT resetting existing usage.
    const existingUsage = await supabaseSelect({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "usage_limits",
      query: `email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    });

    if (!existingUsage.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: existingUsage.data,
      });
      return;
    }

    const existingUsageRow =
      Array.isArray(existingUsage.data) && existingUsage.data.length > 0
        ? existingUsage.data[0]
        : null;

    let usageLimits;

    if (existingUsageRow) {
      // Preserve existing used/remaining values; only ensure profile_id link.
      if (existingUsageRow.profile_id !== profile.id) {
        const updatedUsage = await supabaseUpsert({
          baseUrl: normalizedBaseUrl,
          secretKey,
          table: "usage_limits",
          onConflict: "email",
          row: {
            email,
            profile_id: profile.id,
          },
        });

        usageLimits =
          updatedUsage.ok && Array.isArray(updatedUsage.data)
            ? updatedUsage.data[0]
            : existingUsageRow;
      } else {
        usageLimits = existingUsageRow;
      }
    } else {
      // No row yet: create with defaults.
      const usageResult = await supabaseUpsert({
        baseUrl: normalizedBaseUrl,
        secretKey,
        table: "usage_limits",
        onConflict: "email",
        row: {
          email,
          profile_id: profile.id,
          free_generations_total: 3,
          free_generations_used: 0,
          free_generations_remaining: 3,
        },
      });

      if (!usageResult.ok) {
        res.status(500).json({
          success: false,
          error: "Supabase request failed.",
          details: usageResult.data,
        });
        return;
      }

      usageLimits = Array.isArray(usageResult.data)
        ? usageResult.data[0]
        : usageResult.data;
    }

    // 3. Fetch active user_access rows for this email.
    const accessResult = await supabaseSelect({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "user_access",
      query: `email=eq.${encodeURIComponent(email)}&status=eq.active&select=*`,
    });

    if (!accessResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: accessResult.data,
      });
      return;
    }

    const access = Array.isArray(accessResult.data) ? accessResult.data : [];

    // 4. Success.
    res.status(200).json({
      success: true,
      profile,
      usageLimits,
      access,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Supabase request failed.",
      details: error.message,
    });
  }
}
