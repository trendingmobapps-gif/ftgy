// Non-destructive unit tests for the Projects backend.
// Run with: node --test tests/projects.test.mjs
//
// These tests exercise ONLY pure logic and the repository query builder with a
// mocked global.fetch. No real network calls, no OpenAI, no Supabase writes.

import test from "node:test";
import assert from "node:assert/strict";

import {
  isValidUuid,
  isValidCategorySlug,
  deriveNameFromGoal,
  validateCreateInput,
  validateUpdateInput,
  mapUpdateValueToColumns,
} from "../lib/projects/validation.js";
import { serializeProject } from "../lib/projects/serializer.js";
import {
  canTransition,
  buildStatusUpdate,
  isValidStatus,
} from "../lib/projects/status-transitions.js";
import { resolveRequestUser } from "../lib/resolve-request-user.js";
import {
  getProjectOwned,
  updateProjectOwned,
  listProjects,
  createProject,
} from "../lib/projects/repository.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";

// --- Identity / auth ------------------------------------------------------

test("resolveRequestUser: missing memberId is unauthenticated", () => {
  const r = resolveRequestUser({ email: "a@b.com" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test("resolveRequestUser: invalid UUID memberId is unauthenticated", () => {
  const r = resolveRequestUser({ memberId: "not-a-uuid" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test("resolveRequestUser: valid memberId resolves userId, normalizes email", () => {
  const r = resolveRequestUser({ memberId: VALID_UUID, email: "  A@B.COM " });
  assert.equal(r.ok, true);
  assert.equal(r.userId, VALID_UUID);
  assert.equal(r.email, "a@b.com");
});

test("resolveRequestUser: verified JWT sub must match memberId", () => {
  const ok = resolveRequestUser(
    { memberId: VALID_UUID },
    { verifiedUserId: VALID_UUID },
  );
  assert.equal(ok.ok, true);
  const bad = resolveRequestUser(
    { memberId: VALID_UUID },
    { verifiedUserId: OTHER_UUID },
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);
});

// --- Validation -----------------------------------------------------------

test("isValidUuid / isValidCategorySlug", () => {
  assert.equal(isValidUuid(VALID_UUID), true);
  assert.equal(isValidUuid("nope"), false);
  assert.equal(isValidCategorySlug("socialMedia"), true);
  assert.equal(isValidCategorySlug("social-media"), false);
  assert.equal(isValidCategorySlug("viataPersonala"), true);
});

test("create: missing goal fails", () => {
  const r = validateCreateInput({});
  assert.equal(r.valid, false);
  assert.ok(r.fields.goal);
});

test("create: empty goal fails", () => {
  const r = validateCreateInput({ goal: "    " });
  assert.equal(r.valid, false);
  assert.ok(r.fields.goal);
});

test("create: goal too long fails", () => {
  const r = validateCreateInput({ goal: "x".repeat(5001) });
  assert.equal(r.valid, false);
  assert.ok(r.fields.goal);
});

test("create: name too long fails", () => {
  const r = validateCreateInput({ goal: "obiectiv", name: "n".repeat(121) });
  assert.equal(r.valid, false);
  assert.ok(r.fields.name);
});

test("create: invalid category fails", () => {
  const r = validateCreateInput({ goal: "obiectiv", categorySlug: "nope" });
  assert.equal(r.valid, false);
  assert.ok(r.fields.categorySlug);
});

test("create: raw color accentKey rejected", () => {
  const r = validateCreateInput({ goal: "obiectiv", accentKey: "#ff0000" });
  assert.equal(r.valid, false);
  assert.ok(r.fields.accentKey);
});

test("create: derives name from goal when missing", () => {
  const r = validateCreateInput({
    goal: "Vreau să deschid un salon de înfrumusețare",
  });
  assert.equal(r.valid, true);
  assert.equal(r.value.name, "Deschid un salon de înfrumusețare");
  assert.equal(r.value.description, null);
  assert.equal(r.value.categorySlug, null);
});

test("deriveNameFromGoal: strips openers, capitalizes, falls back", () => {
  assert.equal(
    deriveNameFromGoal("Vreau să slăbesc 10 kg în patru luni"),
    "Slăbesc 10 kg în patru luni",
  );
  assert.equal(deriveNameFromGoal(""), "Proiect nou");
  assert.equal(deriveNameFromGoal("   "), "Proiect nou");
});

test("update: unsafe fields are ignored (not mapped to columns)", () => {
  const { value } = validateUpdateInput({
    name: "Nume nou",
    status: "archived",
    user_id: OTHER_UUID,
    active_workflow_id: "wf",
    created_at: "2020-01-01",
  });
  const columns = mapUpdateValueToColumns(value);
  assert.deepEqual(Object.keys(columns), ["name"]);
  assert.equal(columns.name, "Nume nou");
  assert.equal("status" in columns, false);
  assert.equal("user_id" in columns, false);
});

test("update: empty payload has no updates", () => {
  const r = validateUpdateInput({});
  assert.equal(r.hasUpdates, false);
});

test("update: empty description/summary become null", () => {
  const r = validateUpdateInput({ description: "", summary: "" });
  assert.equal(r.value.description, null);
  assert.equal(r.value.summary, null);
});

// --- Serializer -----------------------------------------------------------

test("serializeProject: snake_case -> camelCase, excludes ownership", () => {
  const row = {
    id: VALID_UUID,
    user_id: OTHER_UUID,
    email: "secret@b.com",
    profile_id: "p1",
    name: "P",
    goal: "G",
    description: null,
    summary: "",
    category_slug: "business",
    status: "active",
    icon_key: null,
    accent_key: "accentPrimary",
    active_workflow_id: null,
    active_workflow_run_id: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    last_activity_at: "2024-01-03T00:00:00Z",
    paused_at: null,
    completed_at: null,
    archived_at: null,
  };
  const out = serializeProject(row);
  assert.equal(out.id, VALID_UUID);
  assert.equal(out.categorySlug, "business");
  assert.equal(out.accentKey, "accentPrimary");
  assert.equal(out.summary, null); // "" -> null
  assert.equal("user_id" in out, false);
  assert.equal("email" in out, false);
  assert.equal("profile_id" in out, false);
  assert.equal("progress" in out, false);
});

// --- Status transitions ---------------------------------------------------

test("status: allowed transitions", () => {
  assert.equal(canTransition("active", "paused"), true);
  assert.equal(canTransition("paused", "active"), true);
  assert.equal(canTransition("active", "completed"), true);
  assert.equal(canTransition("paused", "completed"), true);
  assert.equal(canTransition("active", "archived"), true);
  assert.equal(canTransition("completed", "archived"), true);
});

test("status: rejected transitions", () => {
  assert.equal(canTransition("completed", "active"), false);
  assert.equal(canTransition("archived", "active"), false);
  assert.equal(canTransition("archived", "paused"), false);
  assert.equal(canTransition("archived", "completed"), false);
  assert.equal(canTransition("paused", "paused"), false);
  assert.equal(isValidStatus("bogus"), false);
});

test("status: buildStatusUpdate timestamp rules", () => {
  const now = "2024-05-05T05:05:05.000Z";

  const paused = buildStatusUpdate("paused", now);
  assert.equal(paused.status, "paused");
  assert.equal(paused.paused_at, now);
  assert.equal(paused.completed_at, null);
  assert.equal(paused.archived_at, null);
  assert.equal(paused.last_activity_at, now);

  const active = buildStatusUpdate("active", now);
  assert.equal(active.paused_at, null);
  // Reopening must NOT clear completed_at/archived_at.
  assert.equal("completed_at" in active, false);
  assert.equal("archived_at" in active, false);

  const completed = buildStatusUpdate("completed", now);
  assert.equal(completed.completed_at, now);
  assert.equal(completed.paused_at, null);
  assert.equal(completed.archived_at, null);

  const archived = buildStatusUpdate("archived", now);
  assert.equal(archived.archived_at, now);
  assert.equal(archived.paused_at, null);
});

// --- Ownership / repository (mocked fetch) --------------------------------

function mockFetchOnce(rows, capture) {
  return async (url, options) => {
    capture.url = url;
    capture.options = options;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(rows),
      headers: { get: () => "0-0/1" },
    };
  };
}

const REPO_ARGS = {
  baseUrl: "https://example.supabase.co",
  secretKey: "test-secret",
  userId: VALID_UUID,
};

test("getProjectOwned always filters by user_id AND id", async () => {
  const capture = {};
  const original = global.fetch;
  global.fetch = mockFetchOnce([{ id: OTHER_UUID, status: "active" }], capture);
  try {
    await getProjectOwned({ ...REPO_ARGS, projectId: OTHER_UUID });
    assert.ok(capture.url.includes(`user_id=eq.${VALID_UUID}`));
    assert.ok(capture.url.includes(`id=eq.${OTHER_UUID}`));
  } finally {
    global.fetch = original;
  }
});

test("updateProjectOwned always filters by user_id AND id (PATCH)", async () => {
  const capture = {};
  const original = global.fetch;
  global.fetch = mockFetchOnce([{ id: OTHER_UUID, status: "paused" }], capture);
  try {
    await updateProjectOwned({
      ...REPO_ARGS,
      projectId: OTHER_UUID,
      columns: { name: "x" },
    });
    assert.equal(capture.options.method, "PATCH");
    assert.ok(capture.url.includes(`user_id=eq.${VALID_UUID}`));
    assert.ok(capture.url.includes(`id=eq.${OTHER_UUID}`));
  } finally {
    global.fetch = original;
  }
});

test("listProjects filters by user_id and excludes archived by default", async () => {
  const capture = {};
  const original = global.fetch;
  global.fetch = mockFetchOnce([], capture);
  try {
    const r = await listProjects({ ...REPO_ARGS, filters: {} });
    assert.ok(capture.url.includes(`user_id=eq.${VALID_UUID}`));
    assert.ok(capture.url.includes("status=in.(active,paused,completed)"));
    assert.equal(r.count, 1); // parsed from content-range "0-0/1"
    assert.deepEqual(r.rows, []);
  } finally {
    global.fetch = original;
  }
});

test("listProjects search builds ilike OR on name and goal", async () => {
  const capture = {};
  const original = global.fetch;
  global.fetch = mockFetchOnce([], capture);
  try {
    await listProjects({
      ...REPO_ARGS,
      filters: { search: "salon", includeArchived: true },
    });
    assert.ok(capture.url.includes("or="));
    assert.ok(capture.url.toLowerCase().includes("name.ilike"));
    assert.ok(capture.url.toLowerCase().includes("goal.ilike"));
    // includeArchived true -> no default status filter
    assert.ok(!capture.url.includes("status=in."));
  } finally {
    global.fetch = original;
  }
});

test("createProject inserts with user_id and status=active", async () => {
  const capture = {};
  const original = global.fetch;
  global.fetch = mockFetchOnce([{ id: VALID_UUID, status: "active" }], capture);
  try {
    const r = await createProject({
      ...REPO_ARGS,
      value: { name: "P", goal: "G", description: null },
      nowIso: "2024-01-01T00:00:00Z",
    });
    const sentBody = JSON.parse(capture.options.body);
    assert.equal(sentBody.user_id, VALID_UUID);
    assert.equal(sentBody.status, "active");
    assert.equal(sentBody.active_workflow_id, null);
    assert.equal(r.ok, true);
  } finally {
    global.fetch = original;
  }
});
