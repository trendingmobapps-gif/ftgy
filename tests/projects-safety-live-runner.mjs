// Self-contained safety live runner: mints an ephemeral Supabase user via public
// signup (no service-role key required), runs projects-safety-live-smoke.mjs, and
// never prints tokens or passwords.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = (process.env.PROJECTS_BASE_URL || "").replace(/\/+$/, "");
const SUPABASE_URL = (process.env.SUPABASE_URL || "https://cvxhuetjondnmjuobcbx.supabase.co").replace(
  /\/+$/,
  "",
);
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "sb_publishable_EFEzBew5Ws_PAfyOV1453A_4GlE3i5G";

if (!BASE_URL) {
  console.error("Missing PROJECTS_BASE_URL.");
  process.exit(2);
}

function makePassword() {
  return `Sm0ke!${randomUUID()}${randomUUID()}`.replace(/-/g, "");
}

async function signupEphemeralUser() {
  const email = `zz-safety-smoke-${Date.now()}@example.com`;
  const password = makePassword();

  const signup = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });

  const signupJson = await signup.json().catch(() => null);
  if (signup.ok && signupJson?.access_token) {
    return { token: signupJson.access_token, userId: signupJson.user?.id || "" };
  }

  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });

  const loginJson = await login.json().catch(() => null);
  if (!login.ok || !loginJson?.access_token) {
    throw new Error(`Ephemeral auth failed (signup ${signup.status}, login ${login.status})`);
  }

  return { token: loginJson.access_token, userId: loginJson.user?.id || "" };
}

function runSmoke(token) {
  const smokePath = path.join(__dirname, "projects-safety-live-smoke.mjs");
  return new Promise((resolve) => {
    const child = spawn("node", [smokePath], {
      env: {
        ...process.env,
        PROJECTS_BASE_URL: BASE_URL,
        PROJECTS_ACCESS_TOKEN: token,
        SUPABASE_URL,
      },
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log(`Safety live runner against ${BASE_URL}`);
  console.log(`Supabase project ref: ${new URL(SUPABASE_URL).host.split(".")[0]}`);

  const { token, userId } = await signupEphemeralUser();
  console.log(`Ephemeral test user created: ${userId || "(unknown)"}`);

  const code = await runSmoke(token);
  console.log(`\nSafety live runner exit code: ${code}`);
  process.exit(code);
}

main().catch((error) => {
  console.error("Safety live runner crashed:", error?.message || error);
  process.exit(1);
});
