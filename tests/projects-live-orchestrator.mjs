// Throwaway live-validation orchestrator. Contains NO secrets; reads them only
// from env: SUPABASE_URL, SUPABASE_SECRET_KEY, PROJECTS_BASE_URL, SMOKE_PATH.
//
// Creates two dedicated, clearly-namespaced Supabase test users, mints access
// tokens in-process (NEVER printed), runs the Projects smoke harness against the
// preview deployment, then deletes the test project rows and the test users.
// Prints only non-secret diagnostics (user UUIDs, counts, child output).

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || "";
const BASE_URL = (process.env.PROJECTS_BASE_URL || "").replace(/\/+$/, "");
const SMOKE_PATH = process.env.SMOKE_PATH || "";

if (!SUPABASE_URL || !SERVICE_KEY || !BASE_URL || !SMOKE_PATH) {
  console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY / PROJECTS_BASE_URL / SMOKE_PATH");
  process.exit(2);
}

// Non-secret helper: project ref from a Supabase URL host (abcd.supabase.co).
function refFromUrl(url) {
  try {
    return new URL(url).host.split(".")[0] || "";
  } catch {
    return "";
  }
}

// Non-secret helper: project ref from an access token's unverified `iss` claim.
// Used ONLY to compare projects; never authenticates and never prints the token.
function refFromToken(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    return typeof p.iss === "string" ? refFromUrl(p.iss) : "";
  } catch {
    return "";
  }
}

// The project the minting URL points to. The deployment must verify against the
// SAME project or every token will be rejected as bad_jwt (401).
console.log(`Mint (SUPABASE_URL) project ref: ${refFromUrl(SUPABASE_URL) || "(unknown)"}`);

const adminHeaders = {
  "Content-Type": "application/json",
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

// Strong random password, generated in-process, never logged.
function makePassword() {
  return `Sm0ke!${randomUUID()}${randomUUID()}`.replace(/-/g, "");
}

const stamp = Date.now();
const users = [
  { label: "A", email: `zz-projects-smoke-${stamp}-a@example.com`, password: makePassword() },
  { label: "B", email: `zz-projects-smoke-${stamp}-b@example.com`, password: makePassword() },
];

async function createUser(u) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { purpose: "projects-endpoint-smoke-test", ephemeral: true },
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`create ${u.label} failed: ${resp.status} ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return json.id || json.user?.id;
}

async function login(u) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SERVICE_KEY },
    body: JSON.stringify({ email: u.email, password: u.password }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`login ${u.label} failed: ${resp.status} ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error(`login ${u.label}: no access_token`);
  return json.access_token;
}

async function deleteProjectsFor(userId) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/projects?user_id=eq.${userId}`, {
    method: "DELETE",
    headers: { ...adminHeaders, Prefer: "return=representation" },
  });
  const text = await resp.text();
  if (!resp.ok) return { ok: false, count: 0, detail: `${resp.status} ${text.slice(0, 150)}` };
  let count = 0;
  try {
    count = JSON.parse(text).length;
  } catch {
    count = 0;
  }
  return { ok: true, count };
}

async function deleteUser(userId) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  return resp.ok;
}

function runSmoke(tokenA, tokenB) {
  return new Promise((resolve) => {
    const child = spawn("node", [SMOKE_PATH], {
      env: {
        ...process.env,
        PROJECTS_BASE_URL: BASE_URL,
        PROJECTS_ACCESS_TOKEN: tokenA,
        PROJECTS_ACCESS_TOKEN_B: tokenB,
      },
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code));
  });
}

async function main() {
  const ids = {};
  let smokeCode = 1;
  try {
    console.log("Creating 2 dedicated test users (namespaced zz-projects-smoke-*)...");
    ids.A = await createUser(users[0]);
    ids.B = await createUser(users[1]);
    console.log(`  user A id: ${ids.A}`);
    console.log(`  user B id: ${ids.B}`);

    console.log("Minting access tokens (not printed)...");
    const tokenA = await login(users[0]);
    const tokenB = await login(users[1]);
    console.log(`  token A minted for project ref: ${refFromToken(tokenA) || "(unknown)"}`);

    console.log("Running smoke harness against preview...\n");
    smokeCode = await runSmoke(tokenA, tokenB);
  } catch (err) {
    console.error("Orchestrator error:", err?.message || err);
  } finally {
    console.log("\nCleanup: deleting test project rows + users...");
    for (const label of ["A", "B"]) {
      const uid = ids[label];
      if (!uid) continue;
      const del = await deleteProjectsFor(uid);
      console.log(`  user ${label}: deleted ${del.count} project row(s)${del.ok ? "" : ` (WARN: ${del.detail})`}`);
      const ok = await deleteUser(uid);
      console.log(`  user ${label}: user deleted -> ${ok}`);
    }
  }
  console.log(`\nSmoke exit code: ${smokeCode}`);
  process.exit(smokeCode);
}

main();