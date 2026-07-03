// Vercel Serverless Function: POST /api/check-user-access
// Checks whether a user has access to a specific ITER AI category.
// Read-only: never creates or modifies profiles, orders, usage_limits, or
// user_access. Uses the Supabase REST API directly via fetch. No new packages.

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

// True if an access row is currently active (status active and not expired).
function isAccessActive(row, nowMs) {
  if (!row || row.status !== "active") return false;
  if (row.expires_at === null || row.expires_at === undefined) return true;
  const expiresMs = new Date(row.expires_at).getTime();
  if (Number.isNaN(expiresMs)) return true;
  return expiresMs > nowMs;
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

  const categorySlug = rawCategorySlug.trim();

  if (!VALID_CATEGORY_SLUGS.includes(categorySlug)) {
    res.status(400).json({
      success: false,
      error: "Bad request: categorySlug is not valid.",
    });
    return;
  }

  // Normalize base URL (strip trailing slash).
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const nowMs = Date.now();

  try {
    // 1. Fetch the profile by normalized email.
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

    // If no profile exists, the user must go to checkout.
    if (!profile) {
      res.status(200).json({
        success: true,
        email,
        categorySlug,
        hasAccount: false,
        hasAccess: false,
        isPremium: false,
        accessType: "none",
        shouldRedirectToCheckout: true,
        reason: "profile_not_found",
        freeGenerations: {
          total: 0,
          used: 0,
          remaining: 0,
        },
        profile: null,
        matchedAccess: null,
        allActiveAccess: [],
      });
      return;
    }

    const hasAccount = profile.has_account === true;

    // 2. Fetch usage_limits by normalized email.
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

    const freeGenerations = usageRow
      ? {
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
      : { total: 0, used: 0, remaining: 0 };

    // 3. Fetch all active user_access rows for this email, then filter by
    //    expiry in code so null/future expires_at are treated as active.
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

    const allActiveAccess = (
      Array.isArray(accessResult.data) ? accessResult.data : []
    ).filter((row) => isAccessActive(row, nowMs));

    // 4. Premium logic: active row with access_scope "all" and plan "premium".
    const premiumRow = allActiveAccess.find(
      (row) => row.access_scope === "all" && row.plan === "premium"
    );

    if (premiumRow) {
      res.status(200).json({
        success: true,
        email,
        categorySlug,
        hasAccount,
        hasAccess: true,
        isPremium: true,
        accessType: "premium",
        shouldRedirectToCheckout: false,
        reason: "premium_access",
        freeGenerations,
        profile,
        matchedAccess: premiumRow,
        allActiveAccess,
      });
      return;
    }

    // 5. Category access logic: active row scoped to the requested category.
    const categoryRow = allActiveAccess.find(
      (row) =>
        row.access_scope === "category" && row.category_slug === categorySlug
    );

    if (categoryRow) {
      res.status(200).json({
        success: true,
        email,
        categorySlug,
        hasAccount,
        hasAccess: true,
        isPremium: false,
        accessType: "category",
        shouldRedirectToCheckout: false,
        reason: "category_access",
        freeGenerations,
        profile,
        matchedAccess: categoryRow,
        allActiveAccess,
      });
      return;
    }

    // 6. Free generation logic (does NOT consume a generation).
    if (freeGenerations.remaining > 0) {
      res.status(200).json({
        success: true,
        email,
        categorySlug,
        hasAccount,
        hasAccess: true,
        isPremium: false,
        accessType: "free_trial",
        shouldRedirectToCheckout: false,
        reason: "free_generations_available",
        freeGenerations,
        profile,
        matchedAccess: null,
        allActiveAccess,
      });
      return;
    }

    // 7. No paid access and no free generations left.
    res.status(200).json({
      success: true,
      email,
      categorySlug,
      hasAccount,
      hasAccess: false,
      isPremium: false,
      accessType: "none",
      shouldRedirectToCheckout: true,
      reason: "no_paid_access_and_no_free_generations",
      freeGenerations,
      profile,
      matchedAccess: null,
      allActiveAccess,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Supabase request failed.",
      details: error.message,
    });
  }
}
