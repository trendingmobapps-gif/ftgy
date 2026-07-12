// Shared HTTP helpers for Projects endpoints.

import { PROJECT_ERROR_CODES } from "./constants.js";
import { resolveSupabaseUser } from "../auth/resolve-supabase-user.js";
import { isValidUuid } from "./validation.js";

const allowedOrigins = [
  "https://iter.ro",
  "https://www.iter.ro",
  "https://iterai.ro",
  "https://www.iterai.ro",
  "http://localhost:3000",
  "http://localhost:5173",
];

function getExtraOrigins() {
  const raw = process.env.PROJECTS_EXTRA_CORS_ORIGINS || "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
}

export function setCorsHeaders(req, res) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowlist = new Set([...allowedOrigins, ...getExtraOrigins()]);

  if (origin && allowlist.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-iter-secret, Cache-Control, Pragma, X-Requested-With",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

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

export function sendSuccess(res, status, payload) {
  res.status(status).json({ success: true, ...payload });
}

export function sendError(res, status, code, message, fields) {
  const error = { code, message };
  if (fields && typeof fields === "object" && Object.keys(fields).length > 0) {
    error.fields = fields;
  }
  res.status(status).json({ success: false, error });
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return "";
  }
  return authHeader.slice("Bearer ".length).trim();
}

function rejectMemberIdMismatch(body, authenticatedUserId, res) {
  const claimed =
    (typeof body?.memberId === "string" && body.memberId.trim()) ||
    (typeof body?.wixMemberId === "string" && body.wixMemberId.trim()) ||
    "";

  if (claimed && claimed !== authenticatedUserId) {
    sendError(res, 401, PROJECT_ERROR_CODES.UNAUTHENTICATED, "Neautorizat.");
    return true;
  }

  return false;
}

export async function guardRequest(req, res, options = {}) {
  const authMode = options.authMode || "user";
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

  const baseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const secretKey = getServiceRoleKey();
  const body = parseBody(req);

  if (!baseUrl || !secretKey) {
    sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "Serverul nu este configurat corect.");
    return { ok: false, handled: true };
  }

  if (authMode === "internal") {
    const internalSecret = process.env.ITER_INTERNAL_API_SECRET || "";
    const headerSecret = req.headers["x-iter-secret"];
    if (!internalSecret || headerSecret !== internalSecret) {
      sendError(res, 401, PROJECT_ERROR_CODES.UNAUTHENTICATED, "Neautorizat.");
      return { ok: false, handled: true };
    }

    const memberId = typeof body.memberId === "string" ? body.memberId.trim() : "";
    if (!isValidUuid(memberId)) {
      sendError(res, 401, PROJECT_ERROR_CODES.UNAUTHENTICATED, "Neautorizat.");
      return { ok: false, handled: true };
    }

    return {
      ok: true,
      body,
      baseUrl,
      secretKey,
      authenticatedUser: { id: memberId },
    };
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    sendError(res, 401, PROJECT_ERROR_CODES.UNAUTHENTICATED, "Neautorizat.");
    return { ok: false, handled: true };
  }

  const resolved = await resolveSupabaseUser({
    baseUrl,
    secretKey,
    accessToken,
  });

  if (!resolved.ok) {
    sendError(res, 401, PROJECT_ERROR_CODES.UNAUTHENTICATED, "Neautorizat.");
    return { ok: false, handled: true };
  }

  if (rejectMemberIdMismatch(body, resolved.userId, res)) {
    return { ok: false, handled: true };
  }

  try {
    const { ensureBrainSchema } = await import("./brain/schema-bootstrap.js");
    await ensureBrainSchema({ baseUrl, secretKey });
  } catch {
    // Bootstrap is best-effort when disabled or DB URL missing.
  }

  return {
    ok: true,
    body,
    baseUrl,
    secretKey,
    authenticatedUser: {
      id: resolved.userId,
      email: resolved.email || "",
    },
  };
}
