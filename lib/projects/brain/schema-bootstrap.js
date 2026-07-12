import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { enableProjectBrainSelectColumns } from "../constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = join(__dirname, "../../supabase/migrations/20260712_project_brain_workflow.sql");

let bootstrapPromise = null;

function resolveDbUrl() {
  return (
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
}

function canBootstrapSchema() {
  if (process.env.VERCEL_ENV === "production") return false;
  if (!resolveDbUrl()) return false;
  if (process.env.VERCEL_ENV === "preview") return true;
  return process.env.ALLOW_BRAIN_SCHEMA_BOOTSTRAP === "true";
}

async function tableExists(baseUrl, secretKey, table) {
  const resp = await fetch(`${baseUrl}/rest/v1/${table}?select=id&limit=0`, {
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
    },
  });
  return resp.status === 200;
}

async function brainColumnsExist(baseUrl, secretKey) {
  const resp = await fetch(`${baseUrl}/rest/v1/projects?select=brain_status&limit=0`, {
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
    },
  });
  return resp.status === 200;
}

async function applyMigrationSql() {
  const dbUrl = resolveDbUrl();
  const { default: postgres } = await import("postgres");
  const sql = readFileSync(MIGRATION_FILE, "utf8");
  const client = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 20 });
  try {
    await client.unsafe(sql);
  } finally {
    await client.end({ timeout: 5 });
  }
}

export async function ensureBrainSchema({ baseUrl, secretKey }) {
  if (!canBootstrapSchema()) {
    return { ok: true, bootstrapped: false, reason: "bootstrap_disabled" };
  }

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const workflowTable = await tableExists(baseUrl, secretKey, "project_workflows");
      const brainColumns = await brainColumnsExist(baseUrl, secretKey);
      if (workflowTable && brainColumns) {
        return { ok: true, bootstrapped: false, reason: "already_present" };
      }

      await applyMigrationSql();

      const verifiedWorkflow = await tableExists(baseUrl, secretKey, "project_workflows");
      const verifiedBrain = await brainColumnsExist(baseUrl, secretKey);
      if (!verifiedWorkflow || !verifiedBrain) {
        return { ok: false, bootstrapped: false, reason: "verification_failed" };
      }

      enableProjectBrainSelectColumns();
      return { ok: true, bootstrapped: true, reason: "applied" };
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  const result = await bootstrapPromise;
  if (result.ok && (result.reason === "already_present" || result.bootstrapped)) {
    enableProjectBrainSelectColumns();
  }
  return result;
}

export function resetBrainSchemaBootstrapForTests() {
  bootstrapPromise = null;
}
