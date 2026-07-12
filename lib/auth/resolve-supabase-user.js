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
  const token = extractBearerToken(req);

  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "PROJECT_UNAUTHENTICATED",
      message: "Token de autentificare lipsă.",
    };
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
  } catch {
    // Network / upstream failure verifying the token: fail closed as 401.
    return {
      ok: false,
      status: 401,
      code: "PROJECT_UNAUTHENTICATED",
      message: "Autentificarea nu a putut fi verificată.",
    };
  }

  if (!resp || !resp.ok) {
    return {
      ok: false,
      status: 401,
      code: "PROJECT_UNAUTHENTICATED",
      message: "Sesiune invalidă sau expirată.",
    };
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
    return {
      ok: false,
      status: 401,
      code: "PROJECT_UNAUTHENTICATED",
      message: "Utilizator neidentificat.",
    };
  }

  const email =
    user && typeof user.email === "string" && user.email.trim()
      ? user.email.trim().toLowerCase()
      : null;

  return { ok: true, userId, email };
}
