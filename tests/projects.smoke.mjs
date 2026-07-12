// Live end-to-end smoke test for the Projects endpoints against a REAL deployed
// environment (preview first, then production). This performs real HTTP calls
// with a real Supabase session access token. It never prints the token.
//
// Usage:
//   PROJECTS_BASE_URL="https://<preview>.vercel.app" \
//   PROJECTS_ACCESS_TOKEN="<supabase access_token>" \
//   node tests/projects.smoke.mjs
//
// Optional:
//   PROJECTS_ACCESS_TOKEN_B="<second user's token>"  -> enables cross-user test
//
// The flow: create -> get -> list -> update -> pause -> resume -> complete
//           -> archive -> list(includeArchived) plus negative auth/validation
//           checks. Exit code is non-zero if any assertion fails.

const BASE_URL = (process.env.PROJECTS_BASE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.PROJECTS_ACCESS_TOKEN || "";
const TOKEN_B = process.env.PROJECTS_ACCESS_TOKEN_B || "";

if (!BASE_URL || !TOKEN) {
  console.error(
    "Missing PROJECTS_BASE_URL or PROJECTS_ACCESS_TOKEN. See file header for usage.",
  );
  process.exit(2);
}

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function call(path, { token, body, headers } = {}) {
  const h = { "Content-Type": "application/json", ...(headers || {}) };
  if (token) h.Authorization = `Bearer ${token}`;
  const resp = await fetch(`${BASE_URL}/api/${path}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body || {}),
  });
  let json = null;
  try {
    json = await resp.json();
  } catch {
    json = null;
  }
  return { status: resp.status, json };
}

async function main() {
  console.log(`Projects smoke test against ${BASE_URL}`);

  // 1. Negative: no token -> 401
  const noToken = await call("projects-list", {});
  check("no token -> 401", noToken.status === 401, `got ${noToken.status}`);

  // 2. Negative: invalid token -> 401
  const badToken = await call("projects-list", { token: "invalid.token.value" });
  check("invalid token -> 401", badToken.status === 401, `got ${badToken.status}`);

  // 3. Create
  const created = await call("projects-create", {
    token: TOKEN,
    body: {
      goal: "Smoke test: lansez o campanie de marketing",
      categorySlug: "business",
    },
  });

  check(
    "create -> 201 + project.id",
    created.status === 201 && created.json?.project?.id,
    `status ${created.status}`,
  );
  const projectId = created.json?.project?.id;
  check(
    "create: status is active",
    created.json?.project?.status === "active",
    created.json?.project?.status,
  );
  check(
    "create: no ownership fields leaked",
    created.json?.project && !("user_id" in created.json.project),
    "user_id present in response",
  );

  if (!projectId) {
    console.log("Cannot continue without a created project id.");
    finish();
    return;
  }

  // 4. Get
  const got = await call("projects-get", { token: TOKEN, body: { projectId } });
  check("get -> 200 + same id", got.status === 200 && got.json?.project?.id === projectId);

  // 5. List (should include the new project)
  const listed = await call("projects-list", { token: TOKEN, body: {} });
  check(
    "list -> 200 + contains project",
    listed.status === 200 &&
      Array.isArray(listed.json?.projects) &&
      listed.json.projects.some((p) => p.id === projectId),
  );

  // 6. Update
  const updated = await call("projects-update", {
    token: TOKEN,
    body: { projectId, name: "Smoke test proiect actualizat" },
  });
  check(
    "update -> 200 + new name",
    updated.status === 200 &&
      updated.json?.project?.name === "Smoke test proiect actualizat",
  );

  // 7. Invalid category on update -> 400
  const badCat = await call("projects-update", {
    token: TOKEN,
    body: { projectId, categorySlug: "not-a-category" },
  });
  check("update invalid category -> 400", badCat.status === 400, `got ${badCat.status}`);

  // 8. Invalid status filter on list -> 400
  const badStatus = await call("projects-list", {
    token: TOKEN,
    body: { statuses: ["active", "bogus"] },
  });
  check("list invalid status -> 400", badStatus.status === 400, `got ${badStatus.status}`);

  // 9. Pause -> Resume -> Complete
  const paused = await call("projects-pause", { token: TOKEN, body: { projectId } });
  check("pause -> paused", paused.json?.project?.status === "paused", `${paused.status}`);

  const resumed = await call("projects-resume", { token: TOKEN, body: { projectId } });
  check("resume -> active", resumed.json?.project?.status === "active", `${resumed.status}`);

  const completed = await call("projects-complete", { token: TOKEN, body: { projectId } });
  check(
    "complete -> completed",
    completed.json?.project?.status === "completed",
    `${completed.status}`,
  );

  // 10. Completed cannot be resumed -> 409
  const reopen = await call("projects-resume", { token: TOKEN, body: { projectId } });
  check("completed cannot resume -> 409", reopen.status === 409, `got ${reopen.status}`);

  // 11. Archive
  const archived = await call("projects-archive", { token: TOKEN, body: { projectId } });
  check(
    "archive -> archived",
    archived.json?.project?.status === "archived",
    `${archived.status}`,
  );

  // 12. Archived cannot be edited -> 409
  const editArchived = await call("projects-update", {
    token: TOKEN,
    body: { projectId, name: "nu ar trebui" },
  });
  check("archived cannot edit -> 409", editArchived.status === 409, `got ${editArchived.status}`);

  // 13. List including archived contains it
  const listArchived = await call("projects-list", {
    token: TOKEN,
    body: { includeArchived: true },
  });
  check(
    "list includeArchived -> contains archived project",
    listArchived.status === 200 &&
      listArchived.json?.projects?.some((p) => p.id === projectId),
  );

  // 14. Cross-user isolation (optional, requires a second user's token)
  if (TOKEN_B) {
    const crossGet = await call("projects-get", {
      token: TOKEN_B,
      body: { projectId },
    });
    check("user B cannot get user A project -> 404", crossGet.status === 404, `got ${crossGet.status}`);
  } else {
    console.log("SKIP  cross-user test (set PROJECTS_ACCESS_TOKEN_B to enable)");
  }

  // 15. Forged memberId mismatch -> 401
  const forged = await call("projects-list", {
    token: TOKEN,
    body: { memberId: "00000000-0000-4000-8000-000000000000" },
  });
  check("forged memberId mismatch -> 401", forged.status === 401, `got ${forged.status}`);

  finish();
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err?.message || err);
  process.exit(1);
});
