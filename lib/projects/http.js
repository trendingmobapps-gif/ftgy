// Shared HTTP layer for the Projects endpoints: CORS, body parsing, request
// authentication, and the standard success/error response envelopes.
//
// Authentication has two clearly separated modes (see guardRequest):
//   1. User-facing mode  -> verified Supabase Bearer access token (mobile/web)
//   2. Internal mode     -> x-iter-secret matching ITER_INTERNAL_API_SECRET
// The internal secret is NEVER accepted from the Authorization header, the body
// or the query string. The Authorization header is reserved for the Supabase
// access token.

import { PROJECT_ERROR_CODES } from "./constants.js";
import { isValidUuid } from "./validation.js";
import { resolveSupabaseUser } from "../auth/resolve-supabase-user.js";

// Browser origins explicitly allowed to call these endpoints. Non-browser
// clients (React Native, server-to-server) send no Origin header and are not
// subject to this list. Extra origins (e.g. a Wix preview host) can be added
// via PROJECTS_EXTRA_CORS_ORIGINS (comma-separated) without a code change.
const STATIC_ALLOWED_ORIGINS = [
  "https://iter.ro",
  "https://www.iter.ro",
  "https://iterai.ro",
  "https://www.iterai.ro",
  "http://localhost:3000",
  "http://localhost:5173",
];

export function getAllowedOrigins() {
  const extra = String(process.env.PROJECTS_EXTRA_CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return [...STATIC_ALLOWED_ORIGINS, ...extra];
}

// Sets CORS headers safely:
//  - allowlisted browser Origin  -> reflect it
//  - disallowed browser Origin   -> omit Access-Control-Allow-Origin entirely
//  - no Origin (React Native)    -> omit it; request still proceeds
// Never returns an unrelated allowed origin for a disallowed request.
export function setCorsHeaders(req, res) {
  const origin = req.headers && req.headers.origin;

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-iter-secret, Cache-Control, Pragma, X-Requested-With",
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (typeof origin === "string" && origin && getAllowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
}

// Parses the request body whether pre-parsed or a raw JSON string.
export function parseBody(req) {
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

// Standard success envelope.
export function sendSuccess(res, status, payload) {
  res.status(status).json({ success: true, ...payload });
}

// Standard error envelope. `fields` is optional (field -> safe message).
// `debug` is optional and ONLY populated when PROJECTS_AUTH_DEBUG is enabled;
// it carries non-secret auth diagnostics for the temporary 401 investigation.
export function sendError(res, status, code, message, fields, debug) {
  const error = { code, message };
  if (fields && typeof fields === "object" && Object.keys(fields).length > 0) {
    error.fields = fields;
  }
  const payload = { success: false, error };
  if (debug && typeof debug === "object") {
    payload.debug = debug;
  }
  res.status(status).json(payload);
}

// Resolves the Supabase service-role/secret key, supporting both the canonical
// production name and the fallback used elsewhere in this backend. Never logged.
export function getServiceRoleKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""
  );
}

// Full request guard for every Projects route. Performs, in order:
//   1. CORS headers
//   2. OPTIONS preflight handling
//   3. POST method validation
//   4. Supabase environment validation (URL + service-role/secret key)
//   5. authentication (user token OR internal secret)
//   6. safe body parsing
//
// On success returns:
//   { ok: true, body, baseUrl, serviceRoleKey,
//     authenticatedUser: { id, email }, authMode }
// On failure it writes the response and returns { ok: false }. Callers must
// return immediately when ok is false.
export async function guardRequest(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return { ok: false };
  }

  if (req.method !== "POST") {
    sendError(
      res,
      405,
      PROJECT_ERROR_CODES.METHOD_NOT_ALLOWED,
      "Metodă nepermisă. Folosește POST.",
    );
    return { ok: false };
  }

  const baseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = getServiceRoleKey();

  if (!baseUrl || !serviceRoleKey) {
    sendError(
      res,
      500,
      PROJECT_ERROR_CODES.INTERNAL,
      "Serverul nu este configurat corect.",
    );
    return { ok: false };
  }

  const body = parseBody(req);

  // --- Mode 2: internal server-to-server call (x-iter-secret only) ---------
  const internalSecretHeader = req.headers && req.headers["x-iter-secret"];
  const hasInternalHeader =
    typeof internalSecretHeader === "string" && internalSecretHeader.length > 0;

  if (hasInternalHeader) {
    const internalSecret = process.env.ITER_INTERNAL_API_SECRET;
    if (!internalSecret || internalSecretHeader !== internalSecret) {
      sendError(res, 401, PROJECT_ERROR_CODES.UNAUTHENTICATED, "Neautorizat.");
      return { ok: false };
    }

    // Explicit, narrowly scoped internal contract: a trusted internal caller
    // that holds the secret must name the user it acts for via body.memberId
    // (a valid Supabase user UUID). This is only reachable with the secret,
    // which mobile/web never possess.
    const memberId =
      typeof body.memberId === "string" ? body.memberId.trim() : "";
    if (!isValidUuid(memberId)) {
      sendError(
        res,
        401,
        PROJECT_ERROR_CODES.UNAUTHENTICATED,
        "Apel intern invalid: memberId lipsă sau invalid.",
      );
      return { ok: false };
    }

    return {
      ok: true,
      body,
      baseUrl,
      serviceRoleKey,
      authenticatedUser: { id: memberId, email: null },
      authMode: "internal",
    };
  }

  // --- Mode 1: user-facing call (verified Supabase Bearer token) -----------
  const auth = await resolveSupabaseUser({
    req,
    baseUrl,
    apiKey: serviceRoleKey,
  });
  if (!auth.ok) {
    sendError(res, auth.status, auth.code, auth.message, undefined, auth.debug);
    return { ok: false };
  }

  // Backward compatibility: if the client still sends memberId/wixMemberId, it
  // must match the verified token user. It is NEVER the source of identity.
  const suppliedMemberId =
    (typeof body.memberId === "string" && body.memberId.trim()) ||
    (typeof body.wixMemberId === "string" && body.wixMemberId.trim()) ||
    "";
  if (suppliedMemberId && suppliedMemberId !== auth.userId) {
    sendError(
      res,
      401,
      PROJECT_ERROR_CODES.UNAUTHENTICATED,
      "Utilizatorul nu corespunde sesiunii autentificate.",
    );
    return { ok: false };
  }

  return {
    ok: true,
    body,
    baseUrl,
    serviceRoleKey,
    authenticatedUser: { id: auth.userId, email: auth.email },
    authMode: "user",
  };
}
