import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { enableProjectBrainSelectColumns } from "../constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_MIGRATION_FILE = join(__dirname, "../../../supabase/migrations/20260712_project_brain_workflow.sql");
const ACTIONS_MIGRATION_FILE = join(__dirname, "../../../supabase/migrations/20260713_project_action_results.sql");
const SESSIONS_MIGRATION_FILE = join(__dirname, "../../../supabase/migrations/20260714_project_ai_sessions.sql");
const ADAPTIVE_MIGRATION_FILE = join(__dirname, "../../../supabase/migrations/20260715_project_adaptive_brain.sql");

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

async function applyMigrationFiles(files) {
  const dbUrl = resolveDbUrl();
  const { default: postgres } = await import("postgres");
  const client = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 20 });
  try {
    for (const file of files) {
      const sql = readFileSync(file, "utf8");
      await client.unsafe(sql);
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function sessionColumnsExist(baseUrl, secretKey) {
  const resp = await fetch(`${baseUrl}/rest/v1/project_step_actions?select=session_status&limit=0`, {
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
    },
  });
  return resp.status === 200;
}

async function adaptiveTablesExist(baseUrl, secretKey) {
  const resp = await fetch(`${baseUrl}/rest/v1/project_resources?select=id&limit=0`, {
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
    },
  });
  return resp.status === 200;
}

async function syncBrainSelectColumns({ baseUrl, secretKey }) {
  const brainColumns = await brainColumnsExist(baseUrl, secretKey);
  if (brainColumns) {
    enableProjectBrainSelectColumns();
  }
  return brainColumns;
}

export async function ensureBrainSchema({ baseUrl, secretKey }) {
  const brainColumnsPresent = await syncBrainSelectColumns({ baseUrl, secretKey });

  if (!canBootstrapSchema()) {
    return {
      ok: true,
      bootstrapped: false,
      reason: brainColumnsPresent ? "bootstrap_disabled_columns_present" : "bootstrap_disabled",
    };
  }

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const workflowTable = await tableExists(baseUrl, secretKey, "project_workflows");
      const actionsTable = await tableExists(baseUrl, secretKey, "project_step_actions");
      const brainColumns = await brainColumnsExist(baseUrl, secretKey);
      const sessionColumns = await sessionColumnsExist(baseUrl, secretKey);
      const adaptiveTables = await adaptiveTablesExist(baseUrl, secretKey);
      if (workflowTable && brainColumns && actionsTable && sessionColumns && adaptiveTables) {
        enableProjectBrainSelectColumns();
        return { ok: true, bootstrapped: false, reason: "already_present" };
      }

      const migrations = [];
      if (!workflowTable || !brainColumns) {
        migrations.push(BRAIN_MIGRATION_FILE);
      }
      if (!actionsTable) {
        migrations.push(ACTIONS_MIGRATION_FILE);
      }
      if (actionsTable && !sessionColumns) {
        migrations.push(SESSIONS_MIGRATION_FILE);
      }
      if (!adaptiveTables) {
        migrations.push(ADAPTIVE_MIGRATION_FILE);
      }

      await applyMigrationFiles(migrations);

      const verifiedWorkflow = await tableExists(baseUrl, secretKey, "project_workflows");
      const verifiedActions = await tableExists(baseUrl, secretKey, "project_step_actions");
      const verifiedBrain = await brainColumnsExist(baseUrl, secretKey);
      const verifiedSessions = await sessionColumnsExist(baseUrl, secretKey);
      const verifiedAdaptive = await adaptiveTablesExist(baseUrl, secretKey);
      if (!verifiedWorkflow || !verifiedBrain || !verifiedActions || !verifiedSessions || !verifiedAdaptive) {
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
