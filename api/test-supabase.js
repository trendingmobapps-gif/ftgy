// Vercel Serverless Function: GET /api/test-supabase
// Safe connection test that verifies Vercel can talk to Supabase by
// upserting and reading back a test profile + usage_limits row.
// This endpoint does NOT touch any live platform logic.

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-iter-secret");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// Upsert a row into a Supabase table using the REST API and return the row(s).
async function supabaseUpsert({ baseUrl, secretKey, table, row, onConflict }) {
  const url = `${baseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      // merge-duplicates => upsert; return=representation => return the row(s).
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

export default async function handler(req, res) {
  setCorsHeaders(res);

  // Handle CORS preflight.
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({
      success: false,
      error: "Method not allowed. Use GET.",
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

  // --- Auth: require the internal secret via header or query param ---
  const providedSecret =
    req.headers["x-iter-secret"] ||
    (req.query && typeof req.query.secret === "string" ? req.query.secret : "");

  if (!providedSecret || providedSecret !== internalSecret) {
    res.status(401).json({
      success: false,
      error: "Unauthorized: missing or invalid secret.",
    });
    return;
  }

  // Normalize base URL (strip trailing slash).
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  const email = "supabase-test@iter.local".trim().toLowerCase();
  const testedAt = new Date().toISOString();
  const testMetadata = {
    test: true,
    source: "api/test-supabase",
    tested_at: testedAt,
  };

  try {
    // 1. Upsert the test profile.
    const profileResult = await supabaseUpsert({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "profiles",
      onConflict: "email",
      row: {
        email,
        has_account: false,
        created_from: "vercel_test",
        metadata: testMetadata,
      },
    });

    if (!profileResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase test failed.",
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
        error: "Supabase test failed.",
        details: "Profile upsert did not return an id.",
      });
      return;
    }

    // 2. Upsert the usage_limits row linked to the profile.
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
        metadata: testMetadata,
      },
    });

    if (!usageResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase test failed.",
        details: usageResult.data,
      });
      return;
    }

    const usageLimit = Array.isArray(usageResult.data)
      ? usageResult.data[0]
      : usageResult.data;

    // 3. Success.
    res.status(200).json({
      success: true,
      message: "Vercel connected successfully to Supabase.",
      profile,
      usageLimit,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Supabase test failed.",
      details: error.message,
    });
  }
}
