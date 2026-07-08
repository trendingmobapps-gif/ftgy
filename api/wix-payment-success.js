// Vercel Serverless Function: POST /api/wix-payment-success
// Called by Wix after a successful payment. Saves the order in Supabase and
// grants the correct access based on the purchased plan/productId.
// Uses the Supabase REST API directly via fetch. No new packages.

// Origins allowed to call this endpoint from the browser (Wix web + local dev).
const allowedOrigins = [
  "https://www.iterai.ro",
  "https://iterai.ro",
  "https://iter.ro",
  "http://localhost:3000",
  "http://localhost:5173",
];

// Reflects the request Origin when it is in the allowlist; otherwise falls back
// to the primary production origin. A specific origin (not "*") is required so
// the browser accepts responses when auth headers are involved.
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = allowedOrigins.includes(origin)
    ? origin
    : "https://www.iterai.ro";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-iter-secret, Cache-Control, Pragma, X-Requested-With"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

// Basic, conservative email validation.
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Plan -> access mapping. Access is determined ONLY by plan (or productId),
// never by amount.
const PLAN_ACCESS = {
  business: { access_scope: "category", category_slug: "business" },
  studii: { access_scope: "category", category_slug: "studii" },
  cariera: { access_scope: "category", category_slug: "cariera" },
  fitness: { access_scope: "category", category_slug: "fitness" },
  finante: { access_scope: "category", category_slug: "finante" },
  comunicare: { access_scope: "category", category_slug: "comunicare" },
  socialMedia: { access_scope: "category", category_slug: "socialMedia" },
  viataPersonala: { access_scope: "category", category_slug: "viataPersonala" },
  premium: { access_scope: "all", category_slug: null },
};

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

// Upsert a row into a Supabase table and return the row(s).
async function supabaseUpsert({ baseUrl, secretKey, table, row, onConflict }) {
  const url = `${baseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(
    onConflict
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
}

// Insert a row into a Supabase table and return the row(s).
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

// Update rows in a Supabase table using a filtered PATCH query.
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
  setCorsHeaders(req, res);

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

  const plan =
    typeof body.plan === "string" && body.plan.trim() ? body.plan.trim() : null;

  if (!plan) {
    res.status(400).json({
      success: false,
      error: "Bad request: plan is required.",
    });
    return;
  }

  const planAccess = PLAN_ACCESS[plan];
  if (!planAccess) {
    res.status(400).json({
      success: false,
      error: "Bad request: plan is not valid.",
    });
    return;
  }

  const orderId =
    typeof body.orderId === "string" && body.orderId.trim()
      ? body.orderId.trim()
      : null;

  if (!orderId) {
    res.status(400).json({
      success: false,
      error: "Bad request: orderId is required.",
    });
    return;
  }

  // paymentStatus is optional, but if provided it must be "paid".
  if (
    typeof body.paymentStatus === "string" &&
    body.paymentStatus.trim() &&
    body.paymentStatus.trim().toLowerCase() !== "paid"
  ) {
    res.status(400).json({
      success: false,
      error: "Bad request: paymentStatus must be 'paid'.",
    });
    return;
  }

  // Optional fields.
  const productId =
    typeof body.productId === "string" && body.productId.trim()
      ? body.productId.trim()
      : null;

  const hasAmount =
    body.amount !== undefined && body.amount !== null && body.amount !== "";
  const amount = hasAmount ? body.amount : null;

  const currency =
    typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim()
      : "RON";

  // Normalize base URL (strip trailing slash).
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const nowIso = new Date().toISOString();

  try {
    // 1. Ensure the profile exists (keyed by email), preserving has_account.
    const existingProfile = await supabaseSelect({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "profiles",
      query: `email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    });

    if (!existingProfile.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: existingProfile.data,
      });
      return;
    }

    const existingProfileRow =
      Array.isArray(existingProfile.data) && existingProfile.data.length > 0
        ? existingProfile.data[0]
        : null;

    // Payment info to record in profile metadata.
    const paymentMetadata = {
      source: "api/wix-payment-success",
      last_payment: {
        order_id: orderId,
        plan,
        product_id: productId || null,
        amount: hasAmount ? amount : null,
        currency,
        processed_at: nowIso,
      },
      updated_at: nowIso,
    };

    let profileResult;

    if (existingProfileRow) {
      // Existing profile: preserve has_account, created_from, and identity
      // fields. Only update metadata (merged) and updated_at.
      const mergedMetadata =
        existingProfileRow.metadata &&
        typeof existingProfileRow.metadata === "object"
          ? { ...existingProfileRow.metadata, ...paymentMetadata }
          : paymentMetadata;

      profileResult = await supabaseUpdate({
        baseUrl: normalizedBaseUrl,
        secretKey,
        table: "profiles",
        query: `email=eq.${encodeURIComponent(email)}`,
        row: {
          metadata: mergedMetadata,
          updated_at: nowIso,
        },
      });
    } else {
      // No profile: create a new one.
      profileResult = await supabaseInsert({
        baseUrl: normalizedBaseUrl,
        secretKey,
        table: "profiles",
        row: {
          email,
          has_account: false,
          created_from: "purchase",
          metadata: paymentMetadata,
        },
      });
    }

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

    if (!existingUsageRow) {
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
    }

    // 3. Upsert the order (idempotent on wix_order_id).
    const orderRow = {
      email,
      profile_id: profile.id,
      wix_order_id: orderId,
      plan,
      amount: hasAmount ? amount : null,
      currency,
      payment_status: "paid",
      processed: true,
      processed_at: nowIso,
      raw_payload: body,
    };
    if (productId) orderRow.wix_product_id = productId;

    const orderResult = await supabaseUpsert({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "orders",
      onConflict: "wix_order_id",
      row: orderRow,
    });

    if (!orderResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: orderResult.data,
      });
      return;
    }

    const order = Array.isArray(orderResult.data)
      ? orderResult.data[0]
      : orderResult.data;

    // 4. Grant access (idempotent). Reuse an existing active row for the same
    // email + plan + scope + category if present; otherwise insert a new one.
    const accessMetadata = {
      source: "api/wix-payment-success",
      productId: productId || null,
      currency,
    };
    if (hasAmount) accessMetadata.amount = amount;

    const categoryFilter =
      planAccess.category_slug === null
        ? "category_slug=is.null"
        : `category_slug=eq.${encodeURIComponent(planAccess.category_slug)}`;

    const existingAccess = await supabaseSelect({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "user_access",
      query: `email=eq.${encodeURIComponent(
        email
      )}&status=eq.active&plan=eq.${encodeURIComponent(
        plan
      )}&access_scope=eq.${encodeURIComponent(
        planAccess.access_scope
      )}&${categoryFilter}&select=*&limit=1`,
    });

    if (!existingAccess.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: existingAccess.data,
      });
      return;
    }

    const existingAccessRow =
      Array.isArray(existingAccess.data) && existingAccess.data.length > 0
        ? existingAccess.data[0]
        : null;

    let grantedAccess;

    if (existingAccessRow) {
      // Keep active and refresh metadata/order reference; no duplicate created.
      const updatedAccess = await supabaseUpdate({
        baseUrl: normalizedBaseUrl,
        secretKey,
        table: "user_access",
        query: `id=eq.${encodeURIComponent(existingAccessRow.id)}`,
        row: {
          status: "active",
          source_order_id: orderId,
          metadata: accessMetadata,
        },
      });

      grantedAccess =
        updatedAccess.ok && Array.isArray(updatedAccess.data)
          ? updatedAccess.data[0]
          : existingAccessRow;
    } else {
      const insertedAccess = await supabaseInsert({
        baseUrl: normalizedBaseUrl,
        secretKey,
        table: "user_access",
        row: {
          profile_id: profile.id,
          email,
          access_scope: planAccess.access_scope,
          category_slug: planAccess.category_slug,
          plan,
          status: "active",
          access_type: "lifetime",
          source: "wix",
          source_order_id: orderId,
          starts_at: nowIso,
          metadata: accessMetadata,
        },
      });

      if (!insertedAccess.ok) {
        res.status(500).json({
          success: false,
          error: "Supabase request failed.",
          details: insertedAccess.data,
        });
        return;
      }

      grantedAccess = Array.isArray(insertedAccess.data)
        ? insertedAccess.data[0]
        : insertedAccess.data;
    }

    // 5. Fetch all active user_access rows for this email.
    const allAccessResult = await supabaseSelect({
      baseUrl: normalizedBaseUrl,
      secretKey,
      table: "user_access",
      query: `email=eq.${encodeURIComponent(
        email
      )}&status=eq.active&select=*`,
    });

    if (!allAccessResult.ok) {
      res.status(500).json({
        success: false,
        error: "Supabase request failed.",
        details: allAccessResult.data,
      });
      return;
    }

    const allAccess = Array.isArray(allAccessResult.data)
      ? allAccessResult.data
      : [];

    // 6. Success.
    res.status(200).json({
      success: true,
      message: "Wix payment processed successfully.",
      profile,
      order,
      grantedAccess,
      allAccess,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Supabase request failed.",
      details: error.message,
    });
  }
}
