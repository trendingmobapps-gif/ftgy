// Shared HTTP helpers for the Projects endpoints: CORS, body parsing, internal
// secret auth, and the standard success/error response envelopes. Mirrors the
// conventions already used by the existing ITER API (profile-get-or-create,
// dashboard-data) so behavior stays consistent across the deployment.

import { PROJECT_ERROR_CODES } from "./constants.js";

// Origins allowed to call these endpoints from the browser (Wix web + dev).
const allowedOrigins = [
  "https://www.iterai.ro",
  "https://iterai.ro",
  "https://iter.ro",
  "http://localhost:3000",
  "http://localhost:5173",
];

// Reflects an allowlisted Origin; otherwise falls back to the primary origin.
export function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = allowedOrigins.includes(origin)
    ? origin
    : "https://www.iterai.ro";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-iter-secret, Cache-Control, Pragma, X-Requested-With",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
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

// Extracts the internal secret from header / bearer token / body / query.
export function getProvidedSecret(req, body) {
  const headerSecret = req.headers["x-iter-secret"];
  if (typeof headerSecret === "string" && headerSecret) return headerSecret;

  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token) return token;
  }

  if (body && typeof body === "object" && typeof body.secret === "string" && body.secret) {
    return body.secret;
  }

  if (req.query && typeof req.query.secret === "string" && req.query.secret) {
    return req.query.secret;
  }

  return "";
}

// Standard success envelope.
export function sendSuccess(res, status, payload) {
  res.status(status).json({ success: true, ...payload });
}

// Standard error envelope. `fields` is optional (field -> safe message).
export function sendError(res, status, code, message, fields) {
  const error = { code, message };
  if (fields && typeof fields === "object" && Object.keys(fields).length > 0) {
    error.fields = fields;
  }
  res.status(status).json({ success: false, error });
}

// Validates required env + method + internal secret in one place.
// Returns { ok, body } on success, or writes an error response and returns
// { ok: false }. Callers should return immediately when ok is false.
export function guardRequest(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return { ok: false, handled: true };
  }

  if (req.method !== "POST") {
    sendError(
      res,
      405,
      PROJECT_ERROR_CODES.METHOD_NOT_ALLOWED,
      "Metodă nepermisă. Folosește POST.",
    );
    return { ok: false, handled: true };
  }

  const baseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const internalSecret = process.env.ITER_INTERNAL_API_SECRET;

  if (!baseUrl || !secretKey || !internalSecret) {
    sendError(
      res,
      500,
      PROJECT_ERROR_CODES.INTERNAL,
      "Serverul nu este configurat corect.",
    );
    return { ok: false, handled: true };
  }

  const body = parseBody(req);
  const providedSecret = getProvidedSecret(req, body);
  if (!providedSecret || providedSecret !== internalSecret) {
    sendError(
      res,
      401,
      PROJECT_ERROR_CODES.UNAUTHENTICATED,
      "Neautorizat.",
    );
    return { ok: false, handled: true };
  }

  return {
    ok: true,
    body,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    secretKey,
  };
}
