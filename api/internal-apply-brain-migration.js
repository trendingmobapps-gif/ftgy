import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getServiceRoleKey, setCorsHeaders, sendSuccess, sendError } from "../lib/projects/http.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = join(__dirname, "../supabase/migrations/20260712_project_brain_workflow.sql");

function resolveDbUrl() {
  return (
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
}

async function verifySchema(baseUrl, secretKey) {
  const headers = {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
  };

  const checks = [];
  for (const table of ["project_workflows", "project_milestones", "project_steps"]) {
    const resp = await fetch(`${baseUrl}/rest/v1/${table}?select=id&limit=0`, { headers });
    checks.push({ table, ok: resp.status === 200, status: resp.status });
  }

  const brain = await fetch(`${baseUrl}/rest/v1/projects?select=brain_status&limit=0`, { headers });
  checks.push({ table: "projects.brain_status", ok: brain.status === 200, status: brain.status });

  return { ok: checks.every((c) => c.ok), checks };
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (process.env.ALLOW_BRAIN_MIGRATION_ENDPOINT !== "true") {
    sendError(res, 404, PROJECT_ERROR_CODES.NOT_FOUND, "Endpoint indisponibil.");
    return;
  }

  if (req.method !== "POST") {
    sendError(res, 405, PROJECT_ERROR_CODES.METHOD_NOT_ALLOWED, "Metodă nepermisă. Folosește POST.");
    return;
  }

  const internalSecret = process.env.ITER_INTERNAL_API_SECRET || "";
  const headerSecret = req.headers["x-iter-secret"];
  if (!internalSecret || headerSecret !== internalSecret) {
    sendError(res, 401, PROJECT_ERROR_CODES.UNAUTHENTICATED, "Neautorizat.");
    return;
  }

  const baseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const secretKey = getServiceRoleKey();
  const dbUrl = resolveDbUrl();

  if (!baseUrl || !secretKey) {
    sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "Serverul nu este configurat corect.");
    return;
  }

  if (!dbUrl) {
    sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "Conexiunea la baza de date nu este configurată.");
    return;
  }

  try {
    const { default: postgres } = await import("postgres");
    const sql = readFileSync(MIGRATION_FILE, "utf8");
    const client = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 15 });

    try {
      await client.unsafe(sql);
    } finally {
      await client.end({ timeout: 5 });
    }

    const verification = await verifySchema(baseUrl, secretKey);
    sendSuccess(res, 200, {
      applied: true,
      migrationFile: "20260712_project_brain_workflow.sql",
      verification,
    });
  } catch {
    sendError(res, 500, PROJECT_ERROR_CODES.INTERNAL, "Migrarea nu a putut fi aplicată.");
  }
}
