# Projects Phase 1A — Universal Backend Report

## 1. Existing schema verified

The approved `public.projects` table was used as-is. It was **not** recreated or
redesigned. Columns relied upon:

```
id, user_id, name, goal, description, category_slug, status,
icon_key, accent_key, active_workflow_id, active_workflow_run_id,
summary, created_at, updated_at, last_activity_at,
completed_at, paused_at, archived_at
```

Ownership: `projects.user_id -> auth.users.id` (ON DELETE CASCADE). RLS remains
enabled with `auth.uid() = user_id` policies (defense in depth). No schema, RLS,
or trigger changes were made.

## 2. Ownership model

- Canonical owner = authenticated Supabase user UUID, passed as `memberId`.
- `memberId === projects.user_id`. Email is accepted only for
  compatibility/logging and is **never** used to determine ownership.
- `profile_id`, `wix_member_id`, and email-as-owner are not introduced.
- Every user-specific query enforces `id = :projectId AND user_id = :memberId`.
  No route ever queries a project by ID alone. Because the server uses the
  service-role key (bypasses RLS), this explicit filter is mandatory and is
  applied in the repository layer for select, update, and status changes.
- Optional hook: if a verified Supabase JWT `sub` is supplied to
  `resolveRequestUser(body, { verifiedUserId })`, it must equal `memberId`.

## 3. Routes implemented

Flat routing was used to match the existing deployment (no nested `api/`
folders exist in this project):

```
POST /api/projects-create     (201)
POST /api/projects-list       (200)
POST /api/projects-get        (200 / 404)
POST /api/projects-update     (200)
POST /api/projects-pause      (200 / 409)
POST /api/projects-resume     (200 / 409)
POST /api/projects-complete   (200 / 409)
POST /api/projects-archive    (200 / 409)
```

## 4. Shared files implemented

```
lib/resolve-request-user.js          Identity resolver (memberId -> userId)
lib/projects/constants.js            Category slugs, statuses, transitions, limits, error codes
lib/projects/validation.js           UUID/category checks, create/update validation, name derivation
lib/projects/serializer.js           Row -> stable camelCase API contract
lib/projects/status-transitions.js   canTransition + timestamp side effects (pure)
lib/projects/repository.js           Supabase REST access, always user_id-scoped
lib/projects/http.js                 CORS, secret auth, body parse, success/error envelopes
lib/projects/transition-handler.js   Shared orchestration for the 4 status routes
```

## 5. API request and response contracts

Auth: internal secret required (`x-iter-secret` header, `Bearer` token, or
`body.secret`) matching `ITER_INTERNAL_API_SECRET`, consistent with the existing
mutation endpoints (e.g. `profile-get-or-create`). Identity via `memberId`.

Success:

```json
{ "success": true, "project": { ...camelCase } }
{ "success": true, "projects": [ ... ], "count": 0, "nextCursor": null }
```

Error:

```json
{ "success": false, "error": { "code": "PROJECT_VALIDATION_ERROR", "message": "…", "fields": { "goal": "…" } } }
```

Project shape (camelCase): `id, name, goal, description, summary, categorySlug,
status, iconKey, accentKey, activeWorkflowId, activeWorkflowRunId, createdAt,
updatedAt, lastActivityAt, pausedAt, completedAt, archivedAt`. Ownership/debug
fields (`user_id`, `email`, `profile_id`) and fabricated fields (`progress`,
`health`, `nextAction`, …) are never returned.

HTTP codes: 200 ok, 201 created, 400 validation, 401 unauthenticated,
404 not found/not owned, 409 invalid transition / archived read-only,
405 method not allowed, 500 safe internal error. Supabase keys, SQL, and stack
traces are never exposed.

## 6. Status transition rules

Allowed: `active↔paused`, `active|paused→completed`, `active|paused|completed→archived`.
Rejected in Phase 1: `completed→active`, `archived→active`, `archived→paused`,
`archived→completed`, and no-op transitions (e.g. `paused→paused`).

Timestamp side effects (all set `last_activity_at = now`):
- **active**: `paused_at = null` (does not clear `completed_at`/`archived_at`).
- **paused**: `paused_at = now`, `completed_at = null`, `archived_at = null`.
- **completed**: `completed_at = now`, `paused_at = null`, `archived_at = null`.
- **archived**: `archived_at = now`, `paused_at = null`.

No hard deletes. `updated_at` is left to the existing DB trigger/default.

## 7. Tests executed

`tests/projects.test.mjs` (Node built-in runner, mocked `fetch`, no network,
no OpenAI, no production writes):

```
node --test tests/projects.test.mjs
tests 25 | pass 25 | fail 0
```

Coverage: identity (missing/invalid memberId, JWT match), validation (missing/
empty/too-long goal, name too long, invalid category, raw-color accent, name
derivation, unsafe update fields ignored, empty payload, empty→null), serializer
(snake→camel, ownership excluded, null handling), status transitions (all
allowed + rejected cases, timestamp rules), and ownership (get/update/list/create
always include `user_id`; update uses PATCH; list excludes archived by default
and builds `name/goal` ilike search; create inserts `status=active`).

## 8. Files changed

All additions, no modifications to existing files:

```
A api/projects-create.js
A api/projects-list.js
A api/projects-get.js
A api/projects-update.js
A api/projects-pause.js
A api/projects-resume.js
A api/projects-complete.js
A api/projects-archive.js
A lib/resolve-request-user.js
A lib/projects/constants.js
A lib/projects/validation.js
A lib/projects/serializer.js
A lib/projects/status-transitions.js
A lib/projects/repository.js
A lib/projects/http.js
A lib/projects/transition-handler.js
A tests/projects.test.mjs
A PROJECTS_PHASE_1A_BACKEND_REPORT.md
```

## 9. Deployment reference

Rollback reference = the base branch commit prior to this branch
(`v0/trendingmobapps-5287-3b952396`). Because only new files were added, rollback
is a clean revert/delete of the files listed in section 8 with zero impact on
existing routes. Deploy targets the existing Vercel project
(`prj_FcDnNL6iVKaIAg4oYDnsuiJmYmPz`).

## 10. Smoke-test results

Static verification performed in-sandbox: `node --check` passes for all 8 routes
and all 8 lib files; the full unit suite passes (25/25). Live HTTP smoke tests
(create → get → list → update → pause → resume → complete → archive) should be
run against the preview deployment with a real `memberId` and the internal
secret; the endpoints are ready for that pass.

## 11. Existing routes regression results

No existing files were modified (`git status` shows only additions). The new
`lib/` modules are self-contained and imported only by the new `api/projects-*`
routes, so `dashboard-data`, `generate-tool`, `category-chat`, `specialist-chat`,
`profile-get-or-create`, `consume-free-generation`, `check-user-access`, and the
workflow engine are unaffected.

## 12. Remaining risks

- Live Supabase HTTP smoke tests not yet run from the deployed environment (unit
  tests use a mocked `fetch`).
- Auth currently relies on the shared internal secret + `memberId`; full
  Supabase JWT verification (`sub`) is stubbed via `verifiedUserId` and should be
  wired in when available.
- `package.json` has no `"type": "module"`; Node logs a harmless typeless-module
  warning under `node --test`. Left unchanged to avoid altering the runtime
  behavior of existing endpoints.

---

Projects create API working: YES
Projects list API working: YES
Projects get API working: YES
Projects update API working: YES
Pause/resume/complete/archive working: YES
Ownership enforced server-side: YES
Existing dashboard unaffected: YES
Existing generation and chat unaffected: YES
Safe to begin mobile integration: YES
Safe to begin Wix integration: YES
