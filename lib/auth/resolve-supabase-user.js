// Server-side Supabase access-token verification for user-facing Projects
// endpoints (mobile + Wix web).
//
// Verification method: the official Supabase GoTrue endpoint
//   GET {SUPABASE_URL}/auth/v1/user
// with the caller's access token as the Bearer credential and the project
// service-role/secret key as the `apikey` header. This asks the Supabase Auth
// server to validate the token (signature, expiry, revocation) and return the
// authenticated user. This is consistent with the existing fetch-based backend
// runtime (no supabase-js dependency is used anywhere in this project).
//
// This intentionally does NOT decode the JWT payload locally. An unverified
// JWT `sub` is never treated as authenticated.

// --- SAFE TEMPORARY DIAGNOSTICS ------------------------------------------
// Everything below (guarded by PROJECTS_AUTH_DEBUG === "1") logs ONLY
// non-secret metadata to explain a 401. It never logs the access token, the
// secret key, passwords, or the full Authorization header. Remove once the
// live smoke test passes.
function authDebugEnabled() {
  return process.env.PROJECTS_AUTH_DEBUG === "1";
}

// Extracts the Supabase project ref from a project URL host, e.g.
// https://abcd1234.supabase.co -> "abcd1234". Project ref is not a secret
// (it is present in every client request host). Returns "" if not derivable.
function projectRefFromUrl(url) {
  try {
    const host = new URL(url).host; // e.g. abcd1234.supabase.co
    const first = host.split(".")[0];
    return first || "";
  } catch {
    return "";
  }
}

// Classifies an API key by prefix WITHOUT revealing it.
function apiKeyFormat(key) {
  if (!key) return "missing";
  if (key.startsWith("sb_secret_")) return "sb_secret";
  if (key.startsWith("sb_publishable_")) return "sb_publishable";
  if (key.startsWith("eyJ")) return "legacy_jwt";
  return "other";
}

// DIAGNOSTIC-ONLY unverified decode of a JWT payload. This is used purely to
// surface the token's issuer/ref/role/expiry for log correlation. It is NEVER
// used to authenticate — the authoritative check is still GoTrue /auth/v1/user.
function decodeJwtClaimsUnsafe(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { shape: "not-a-jwt" };
    const payloadJson = Buffer.from(parts[1], "base64").toString("utf8");
    const p = JSON.parse(payloadJson);
    const issRef = (() => {
      if (typeof p.iss !== "string") return "";
      // iss like https://<ref>.supabase.co/auth/v1
      return projectRefFromUrl(p.iss);
    })();
    return {
      shape: "jwt",
      issRef, // project ref the token was minted for
      role: typeof p.role === "string" ? p.role : null,
      aud: typeof p.aud === "string" ? p.aud : null,
      hasSub: typeof p.sub === "string" && p.sub.length > 0,
      expiresInSec:
        typeof p.exp === "number"
          ? Math.round(p.exp - Date.now() / 1000)
          : null,
    };
  } catch {
    return { shape: "undecodable" };
  }
}

// Extracts the Bearer access token from the Authorization header only.
// (The internal secret uses a separate `x-iter-secret` header, so the
// Authorization header is reserved exclusively for the Supabase access token.)
export function extractBearerToken(req) {
  const header =
    (req.headers && (req.headers.authorization || req.headers.Authorization)) ||
    "";
  if (typeof header !== "string") return "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

// Verifies the access token and returns the authoritative Supabase user.
// Returns:
//   { ok: true, userId, email }
//   { ok: false, status, code, message }
export async function resolveSupabaseUser({ req, baseUrl, apiKey }) {
  const debug = authDebugEnabled();
  const token = extractBearerToken(req);
  const rawHeader =
    (req.headers &&
      (req.headers.authorization || req.headers.Authorization)) ||
    "";

  // Non-secret diagnostics, only populated/returned when debug is enabled.
  const debugInfo = debug
    ? {
        urlPresent: Boolean(baseUrl),
        serverProjectRef: projectRefFromUrl(baseUrl),
        apiKeyPresent: Boolean(apiKey),
        apiKeyFormat: apiKeyFormat(apiKey),
        authHeaderPresent: Boolean(rawHeader),
        startsWithBearer:
          typeof rawHeader === "string" && rawHeader.startsWith("Bearer "),
        tokenLength: token.length,
        tokenClaims: token ? decodeJwtClaimsUnsafe(token) : null,
        gotrueStatus: null,
        gotrueBody: null,
        stage: "start",
      }
    : undefined;

  const withDebug = (result) => (debug ? { ...result, debug: debugInfo } : result);

  if (debug) {
    console.log("[v0] auth-debug request:", JSON.stringify(debugInfo));
  }

  if (!token) {
    if (debugInfo) debugInfo.stage = "no-token";
    return withDebug({
      ok: false,
      status: 401,
      code: "PROJECT_UNAUTHENTICATED",
      message: "Token de autentificare lipsă.",
    });
  }

  let resp;
  try {
    resp = await fetch(`${baseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: apiKey,
      },
    });
  } catch (err) {
    if (debugInfo) {
      debugInfo.stage = "gotrue-fetch-threw";
      debugInfo.gotrueBody = String(err?.message || err).slice(0, 160);
    }
    // Network / upstream failure verifying the token: fail closed as 401.
    return withDebug({
      ok: false,
      status: 401,
      code: "PROJECT_UNAUTHENTICATED",
      message: "Autentificarea nu a putut fi verificată.",
    });
  }

  if (!resp || !resp.ok) {
    if (debugInfo) {
      debugInfo.stage = "gotrue-rejected";
      debugInfo.gotrueStatus = resp ? resp.status : null;
      try {
        // GoTrue error bodies contain a short code + message, no secrets.
        debugInfo.gotrueBody = String((await resp.text()) || "").slice(0, 200);
      } catch {
        debugInfo.gotrueBody = "(body unreadable)";
      }
      console.log("[v0] auth-debug gotrue-rejected:", JSON.stringify(debugInfo));
    }
    return withDebug({
      ok: false,
      status: 401,
      code: "PROJECT_UNAUTHENTICATED",
      message: "Sesiune invalidă sau expirată.",
    });
  }

  if (debugInfo) {
    debugInfo.stage = "gotrue-ok";
    debugInfo.gotrueStatus = resp.status;
  }

  let user;
  try {
    const text = await resp.text();
    user = text ? JSON.parse(text) : null;
  } catch {
    user = null;
  }

  const userId =
    user && typeof user.id === "string" && user.id.trim() ? user.id.trim() : "";

  if (!userId) {
    if (debugInfo) debugInfo.stage = "gotrue-ok-no-user-id";
    return withDebug({
      ok: false,
      status: 401,
      code: "PROJECT_UNAUTHENTICATED",
      message: "Utilizator neidentificat.",
    });
  }

  const email =
    user && typeof user.email === "string" && user.email.trim()
      ? user.email.trim().toLowerCase()
      : null;

  return withDebug({ ok: true, userId, email });
}
