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
  validateListInput,
  mapUpdateValueToColumns,
} from "../lib/projects/validation.js";
import { serializeProject } from "../lib/projects/serializer.js";
import {
  canTransition,
  buildStatusUpdate,
  isValidStatus,
} from "../lib/projects/status-transitions.js";
import {
  getProjectOwned,
  updateProjectOwned,
  listProjects,
  createProject,
} from "../lib/projects/repository.js";
import { resolveSupabaseUser } from "../lib/auth/resolve-supabase-user.js";
import {
  guardRequest,
  setCorsHeaders,
  getServiceRoleKey,
} from "../lib/projects/http.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";

// --- Test harness: mock req/res + Supabase auth fetch ---------------------

function mockReq({ method = "POST", headers = {}, body = {} } = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  return { method, headers: h, body };
}

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    ended: false,
    setHeader(k, v) {
      this.headers[String(k).toLowerCase()] = v;
    },
    getHeader(k) {
      return this.headers[String(k).toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

// Mocks the GoTrue /auth/v1/user verification endpoint. `validToken` is the
// only token treated as a valid session; anything else returns 401.
function installAuthFetch({ validToken, user }) {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).endsWith("/auth/v1/user")) {
      const authHeader = (options && options.headers && options.headers.Authorization) || "";
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length)
        : "";
      if (token && token === validToken) {
        return { ok: true, status: 200, text: async () => JSON.stringify(user) };
      }
      return { ok: false, status: 401, text: async () => "" };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return () => {
    global.fetch = original;
  };
}

function withProjectEnv(overrides, fn) {
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ITER_INTERNAL_API_SECRET",
    "PROJECTS_EXTRA_CORS_ORIGINS",
  ];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, overrides);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

const BASE_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "svc-secret-key",
  ITER_INTERNAL_API_SECRET: "internal-secret-xyz",
};

// --- Supabase token verification -----------------------------------------

test("resolveSupabaseUser: missing token -> 401", async () => {
  const restore = installAuthFetch({ validToken: "good", user: { id: VALID_UUID } });
  try {
    const r = await resolveSupabaseUser({
      req: mockReq({ headers: {} }),
      baseUrl: "https://example.supabase.co",
      apiKey: "svc",
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  } finally {
    restore();
  }
});

test("resolveSupabaseUser: invalid token -> 401", async () => {
  const restore = installAuthFetch({ validToken: "good", user: { id: VALID_UUID } });
  try {
    const r = await resolveSupabaseUser({
      req: mockReq({ headers: { Authorization: "Bearer WRONG" } }),
      baseUrl: "https://example.supabase.co",
      apiKey: "svc",
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  } finally {
    restore();
  }
});

test("resolveSupabaseUser: valid token -> verified user id + email", async () => {
  const restore = installAuthFetch({
    validToken: "good",
    user: { id: VALID_UUID, email: "User@Example.com" },
  });
  try {
    const r = await resolveSupabaseUser({
      req: mockReq({ headers: { Authorization: "Bearer good" } }),
      baseUrl: "https://example.supabase.co",
      apiKey: "svc",
    });
    assert.equal(r.ok, true);
    assert.equal(r.userId, VALID_UUID);
    assert.equal(r.email, "user@example.com");
  } finally {
    restore();
  }
});

// --- guardRequest: user-facing mode ---------------------------------------

test("guardRequest: valid Supabase token authenticates the verified user", async () => {
  await withProjectEnv(BASE_ENV, async () => {
    const restore = installAuthFetch({ validToken: "good", user: { id: VALID_UUID } });
    try {
      const res = mockRes();
      const guard = await guardRequest(
        mockReq({ headers: { Authorization: "Bearer good" }, body: {} }),
        res,
      );
      assert.equal(guard.ok, true);
      assert.equal(guard.authenticatedUser.id, VALID_UUID);
      assert.equal(guard.authMode, "user");
      assert.equal(guard.serviceRoleKey, "svc-secret-key");
    } finally {
      restore();
    }
  });
});

test("guardRequest: missing token -> 401", async () => {
  await withProjectEnv(BASE_ENV, async () => {
    const restore = installAuthFetch({ validToken: "good", user: { id: VALID_UUID } });
    try {
      const res = mockRes();
      const guard = await guardRequest(mockReq({ headers: {}, body: {} }), res);
      assert.equal(guard.ok, false);
      assert.equal(res.statusCode, 401);
    } finally {
      restore();
    }
  });
});

test("guardRequest: invalid token -> 401", async () => {
  await withProjectEnv(BASE_ENV, async () => {
    const restore = installAuthFetch({ validToken: "good", user: { id: VALID_UUID } });
    try {
      const res = mockRes();
      const guard = await guardRequest(
        mockReq({ headers: { Authorization: "Bearer WRONG" }, body: {} }),
        res,
      );
      assert.equal(guard.ok, false);
      assert.equal(res.statusCode, 401);
    } finally {
      restore();
    }
  });
});

test("guardRequest: forged memberId different from JWT user -> 401", async () => {
  await withProjectEnv(BASE_ENV, async () => {
    const restore = installAuthFetch({ validToken: "good", user: { id: VALID_UUID } });
    try {
      const res = mockRes();
      const guard = await guardRequest(
        mockReq({
          headers: { Authorization: "Bearer good" },
          body: { memberId: OTHER_UUID },
        }),
        res,
      );
      assert.equal(guard.ok, false);
      assert.equal(res.statusCode, 401);
    } finally {
      restore();
    }
  });
});

test("guardRequest: matching memberId is accepted (backward compat)", async () => {
  await withProjectEnv(BASE_ENV, async () => {
    const restore = installAuthFetch({ validToken: "good", user: { id: VALID_UUID } });
    try {
      const res = mockRes();
      const guard = await guardRequest(
        mockReq({
          headers: { Authorization: "Bearer good" },
          body: { memberId: VALID_UUID },
        }),
        res,
      );
      assert.equal(guard.ok, true);
      assert.equal(guard.authenticatedUser.id, VALID_UUID);
    } finally {
      restore();
    }
  });
});

// --- guardRequest: internal secret must NOT come from body/query ----------

test("guardRequest: internal secret in body is NOT accepted", async () => {
  await withProjectEnv(BASE_ENV, async () => {
    const restore = installAuthFetch({ validToken: "good", user: { id: VALID_UUID } });
    try {
      const res = mockRes();
      // No Authorization header, secret only in body -> must fail auth.
      const guard = await guardRequest(
        mockReq({
          headers: {},
          body: { secret: "internal-secret-xyz", memberId: VALID_UUID },
        }),
        res,
      );
      assert.equal(guard.ok, false);
      assert.equal(res.statusCode, 401);
    } finally {
      restore();
    }
  });
});

test("guardRequest: internal secret in query is NOT accepted", async () => {
  await withProjectEnv(BASE_ENV, async () => {
    const restore = installAuthFetch({ validToken: "good", user: { id: VALID_UUID } });
    try {
      const res = mockRes();
      const req = mockReq({ headers: {}, body: { memberId: VALID_UUID } });
      req.query = { secret: "internal-secret-xyz" };
      const guard = await guardRequest(req, res);
      assert.equal(guard.ok, false);
      assert.equal(res.statusCode, 401);
    } finally {
      restore();
    }
  });
});

test("guardRequest: internal x-iter-secret + memberId authenticates internal mode", async () => {
  await withProjectEnv(BASE_ENV, async () => {
    const restore = installAuthFetch({ validToken: "good", user: { id: VALID_UUID } });
    try {
      const res = mockRes();
      const guard = await guardRequest(
        mockReq({
          headers: { "x-iter-secret": "internal-secret-xyz" },
          body: { memberId: VALID_UUID },
        }),
        res,
      );
      assert.equal(guard.ok, true);
      assert.equal(guard.authMode, "internal");
      assert.equal(guard.authenticatedUser.id, VALID_UUID);
    } finally {
      restore();
    }
  });
});

test("guardRequest: internal x-iter-secret without valid memberId -> 401", async () => {
  await withProjectEnv(BASE_ENV, async () => {
    const restore = installAuthFetch({ validToken: "good", user: { id: VALID_UUID } });
    try {
      const res = mockRes();
      const guard = await guardRequest(
        mockReq({
          headers: { "x-iter-secret": "internal-secret-xyz" },
          body: {},
        }),
        res,
      );
      assert.equal(guard.ok, false);
      assert.equal(res.statusCode, 401);
    } finally {
      restore();
    }
  });
});

// --- Service role env fallback --------------------------------------------

test("getServiceRoleKey: prefers SERVICE_ROLE, falls back to SECRET_KEY", async () => {
  await withProjectEnv(
    { SUPABASE_SERVICE_ROLE_KEY: "role-key", SUPABASE_SECRET_KEY: "secret-key" },
    () => {
      assert.equal(getServiceRoleKey(), "role-key");
    },
  );
  await withProjectEnv({ SUPABASE_SECRET_KEY: "secret-key" }, () => {
    assert.equal(getServiceRoleKey(), "secret-key");
  });
  await withProjectEnv({}, () => {
    assert.equal(getServiceRoleKey(), "");
  });
});

test("guardRequest: missing Supabase env -> 500", async () => {
  await withProjectEnv({ ITER_INTERNAL_API_SECRET: "x" }, async () => {
    const res = mockRes();
    const guard = await guardRequest(
      mockReq({ headers: { Authorization: "Bearer good" } }),
      res,
    );
    assert.equal(guard.ok, false);
    assert.equal(res.statusCode, 500);
  });
});

// --- CORS ------------------------------------------------------------------

test("CORS: allowed origin is reflected", () => {
  const res = mockRes();
  setCorsHeaders(
    mockReq({ headers: { origin: "https://www.iterai.ro" } }),
    res,
  );
  assert.equal(res.getHeader("access-control-allow-origin"), "https://www.iterai.ro");
});

test("CORS: disallowed origin gets NO allow-origin header (no unrelated fallback)", () => {
  const res = mockRes();
  setCorsHeaders(
    mockReq({ headers: { origin: "https://evil.example.com" } }),
    res,
  );
  assert.equal(res.getHeader("access-control-allow-origin"), undefined);
});

test("CORS: React Native request (no Origin) proceeds without allow-origin", () => {
  const res = mockRes();
  setCorsHeaders(mockReq({ headers: {} }), res);
  assert.equal(res.getHeader("access-control-allow-origin"), undefined);
  // Method/headers negotiation is still advertised.
  assert.ok(res.getHeader("access-control-allow-methods"));
});

test("CORS: extra origin via env is allowed", async () => {
  await withProjectEnv(
    { PROJECTS_EXTRA_CORS_ORIGINS: "https://iter-preview.wixsite.com" },
    () => {
      const res = mockRes();
      setCorsHeaders(
        mockReq({ headers: { origin: "https://iter-preview.wixsite.com" } }),
        res,
      );
      assert.equal(
        res.getHeader("access-control-allow-origin"),
        "https://iter-preview.wixsite.com",
      );
    },
  );
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

// --- List validation ------------------------------------------------------

test("list: invalid category -> 400 validation error", () => {
  const r = validateListInput({ categorySlug: "nope" });
  assert.equal(r.valid, false);
  assert.ok(r.fields.categorySlug);
});

test("list: valid category accepted", () => {
  const r = validateListInput({ categorySlug: "business" });
  assert.equal(r.valid, true);
  assert.equal(r.value.categorySlug, "business");
});

test("list: invalid status in array -> 400 (not silently discarded)", () => {
  const r = validateListInput({ statuses: ["active", "bogus"] });
  assert.equal(r.valid, false);
  assert.ok(r.fields.statuses);
});

test("list: valid statuses accepted", () => {
  const r = validateListInput({ statuses: ["active", "paused"] });
  assert.equal(r.valid, true);
  assert.deepEqual(r.value.statuses, ["active", "paused"]);
});

test("list: invalid sort/direction/limit/cursor rejected", () => {
  assert.equal(validateListInput({ sort: "bogus" }).valid, false);
  assert.equal(validateListInput({ direction: "sideways" }).valid, false);
  assert.equal(validateListInput({ limit: 0 }).valid, false);
  assert.equal(validateListInput({ limit: 9999 }).valid, false);
  assert.equal(validateListInput({ cursor: -5 }).valid, false);
});

test("list: search length limit enforced", () => {
  assert.equal(validateListInput({ search: "x".repeat(201) }).valid, false);
  assert.equal(validateListInput({ search: "salon" }).valid, true);
});

test("list: empty body is valid (defaults applied downstream)", () => {
  const r = validateListInput({});
  assert.equal(r.valid, true);
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
