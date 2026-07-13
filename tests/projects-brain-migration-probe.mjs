import { randomUUID } from "node:crypto";

const BASE = (process.env.PROJECTS_BASE_URL || "https://vercel-api-bridge-for-5c4tczvb3-ierai.vercel.app").replace(
  /\/+$/,
  "",
);
const SUPABASE_URL = (process.env.SUPABASE_URL || "https://cvxhuetjondnmjuobcbx.supabase.co").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_EFEzBew5Ws_PAfyOV1453A_4GlE3i5G";

async function signup() {
  const email = `zz-brain-probe-${Date.now()}@example.com`;
  const password = `Sm0ke!${randomUUID()}${randomUUID()}`.replace(/-/g, "");

  const signupResp = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const signupJson = await signupResp.json().catch(() => null);
  if (signupResp.ok && signupJson?.access_token) {
    return signupJson.access_token;
  }

  const loginResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const loginJson = await loginResp.json().catch(() => null);
  if (!loginResp.ok || !loginJson?.access_token) {
    throw new Error(`auth failed signup=${signupResp.status} login=${loginResp.status}`);
  }
  return loginJson.access_token;
}

async function post(path, token, body) {
  const resp = await fetch(`${BASE}/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });
  const json = await resp.json().catch(() => null);
  return { status: resp.status, json };
}

const token = await signup();
const create = await post("projects-create", token, {
  name: "ZZ Brain Probe",
  goal: "Vreau să deschid o cafenea",
  categorySlug: "business",
});

console.log(`CREATE status=${create.status} code=${create.json?.error?.code || "ok"}`);
if (create.json?.project?.id) {
  console.log(`PROJECT_ID ${create.json.project.id}`);
  const gen = await post("projects-generate-workflow", token, { projectId: create.json.project.id });
  console.log(`GENERATE status=${gen.status} code=${gen.json?.error?.code || "ok"} brain=${gen.json?.brainStatus || "n/a"}`);
}
