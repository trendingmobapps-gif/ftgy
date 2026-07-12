// One-time migration runner for Project Brain schema.
// Requires SUPABASE_DB_URL (direct Postgres connection string) OR runs statements
// individually via Supabase SQL API when SUPABASE_ACCESS_TOKEN is set.
//
// Never prints secrets.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(__dirname, "../supabase/migrations/20260712_project_brain_workflow.sql");
const PROJECT_REF = (process.env.SUPABASE_PROJECT_REF || "cvxhuetjondnmjuobcbx").trim();
const DB_URL = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const ACCESS_TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();

async function runWithPg(sql) {
  const { default: postgres } = await import("postgres");
  const sqlClient = postgres(DB_URL, { max: 1 });
  try {
    await sqlClient.unsafe(sql);
    return { ok: true };
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

async function runWithManagementApi(sql) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    return { ok: false, status: resp.status, detail: text.slice(0, 300) };
  }
  return { ok: true, detail: text.slice(0, 200) };
}

async function verifySchema() {
  const SUPABASE_URL = (process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`).replace(/\/+$/, "");
  const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || "";
  if (!SERVICE_KEY) {
    return { ok: false, detail: "missing service key for verification" };
  }

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };

  const checks = [];
  for (const table of ["project_workflows", "project_milestones", "project_steps"]) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=0`, { headers });
    checks.push({ table, status: resp.status, ok: resp.status === 200 });
  }

  const brainResp = await fetch(
    `${SUPABASE_URL}/rest/v1/projects?select=brain_status&limit=0`,
    { headers },
  );
  checks.push({ table: "projects.brain_status", status: brainResp.status, ok: brainResp.status === 200 });

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

async function main() {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  console.log(`Applying migration from ${MIGRATION_PATH}`);
  console.log(`Target Supabase ref: ${PROJECT_REF}`);

  let result;
  if (DB_URL) {
    console.log("Mode: direct Postgres (SUPABASE_DB_URL)");
    result = await runWithPg(sql);
  } else if (ACCESS_TOKEN) {
    console.log("Mode: Supabase Management API");
    result = await runWithManagementApi(sql);
  } else {
    console.error("Missing SUPABASE_DB_URL or SUPABASE_ACCESS_TOKEN.");
    process.exit(2);
  }

  if (!result.ok) {
    console.error("Migration failed:", result.detail || result);
    process.exit(1);
  }

  console.log("Migration SQL executed successfully.");
  const verify = await verifySchema();
  for (const check of verify.checks || []) {
    console.log(`  verify ${check.table}: ${check.ok ? "OK" : `FAIL (${check.status})`}`);
  }
  console.log(`Schema verification: ${verify.ok ? "PASS" : "FAIL"}`);
  process.exit(verify.ok ? 0 : 1);
}

main().catch((error) => {
  console.error("Migration runner crashed:", error?.message || error);
  process.exit(1);
});
