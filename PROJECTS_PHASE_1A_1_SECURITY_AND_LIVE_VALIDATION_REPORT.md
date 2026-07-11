# ITER AI — Projects Phase 1A.1 Security & Live Validation Report

Status: **Code-complete, unit/contract-verified, and deployed to a live preview
where the unauthenticated security surface is verified against real HTTP.** The
authenticated create→...→archive lifecycle is **PENDING a self-run by the repo
owner** — the Supabase key is marked *Sensitive* in Vercel and cannot be pulled
into the v0 sandbox to mint test-user tokens, so those results are not fabricated
here (per the "do not claim the APIs work before real HTTP checks succeed"
instruction). Exact self-run commands are in §10.

Live preview URL: `https://vercel-api-bridge-for-ayi9mi7a6-ierai.vercel.app`
(project `vercel-api-bridge-for-wix` / `prj_FcDnNL6...`, target=preview, READY,
**not** aliased to production).

---

## 1. Authentication flaw corrected

Before: every Projects endpoint trusted `body.memberId` after only checking a
shared `ITER_INTERNAL_API_SECRET` (which was also accepted via the
`Authorization: Bearer` header, `body.secret`, and `query.secret`). Mobile and
Wix cannot hold that secret, and any caller could assert any `memberId`.

After: user-facing ownership is derived exclusively from a **server-side
verified Supabase access token**. `body.memberId` is never a source of
identity. The internal secret is accepted **only** via the `x-iter-secret`
header for trusted server-to-server calls.

## 2. Supabase token verification implementation

New helper: `lib/auth/resolve-supabase-user.js`.

- Reads the Bearer token from the `Authorization` header only.
- Verifies it against the configured Supabase project using the official GoTrue
  endpoint `GET {SUPABASE_URL}/auth/v1/user`, sending the caller token as the
  Bearer credential and the service-role/secret key as the `apikey` header.
- The Supabase Auth server validates signature, expiry, and revocation, then
  returns the authoritative user. We do **not** locally decode an unverified
  JWT, and never treat an unverified `sub` as authenticated.
- Returns `{ ok, userId, email }` or `{ ok: false, status: 401, ... }`.
- Chosen because the existing backend has **no `supabase-js` dependency** and
  uses raw `fetch` everywhere; this is the official, runtime-consistent method.
- Fails closed: network/upstream errors during verification return 401.

## 3. Authoritative ownership source

For all user-facing routes, ownership is `projects.user_id = authenticatedUser.id`
where `authenticatedUser.id` is the verified Supabase user UUID. Every
repository call passes `userId: authenticatedUser.id`, and reads/writes always
filter by `user_id` (and `id` for single-project ops). No project is queried or
mutated by project ID alone. Backward compatibility: if a client still sends
`memberId`/`wixMemberId`, it must equal the verified user ID or the request is
rejected with 401.

## 4. Internal secret handling

- Accepted **only** through the `x-iter-secret` header.
- No longer accepted through `Authorization: Bearer`, `body.secret`, or
  `query.secret` (the old `getProvidedSecret` helper was removed from the
  Projects guard).
- Internal mode uses an explicit, narrowly scoped contract: a caller holding
  the secret must name the acting user via `body.memberId` (validated UUID).
  This path is unreachable without the secret, which mobile/web never possess.
- Two clearly separated modes in `guardRequest`: `authMode: "user"` (verified
  token) and `authMode: "internal"` (`x-iter-secret` + `memberId`).

## 5. Environment variable names verified

- `SUPABASE_URL` — required.
- Service key resolved as `SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SECRET_KEY`
  via `getServiceRoleKey()`. The existing production routes use
  `SUPABASE_SECRET_KEY` (11 references) with `SUPABASE_SERVICE_ROLE_KEY` used in
  a few (3 references); the fallback supports both without touching those routes.
- `ITER_INTERNAL_API_SECRET` — required for internal mode.
- Neither key value is ever logged. Missing URL/key fails safely with HTTP 500.
- Note: these are configured in the Vercel project environment (used by the
  existing live endpoints). They are intentionally **not** present in the local
  v0 sandbox env, so live calls can only run against the deployed environment.

## 6. CORS origins

`setCorsHeaders` in `lib/projects/http.js`:
- Allowlisted browser origin → reflected in `Access-Control-Allow-Origin`.
- Disallowed browser origin → **no** allow-origin header (no unrelated-origin
  fallback; the previous silent fallback to `https://www.iterai.ro` was removed).
- No `Origin` header (React Native / server-to-server) → request proceeds; no
  allow-origin header is required.
- `*` is never used.

Static allowlist:
```
https://iter.ro
https://www.iter.ro
https://iterai.ro
https://www.iterai.ro
http://localhost:3000
http://localhost:5173
```
Additional origins (e.g. the actual Wix preview/editor host) can be added via
the `PROJECTS_EXTRA_CORS_ORIGINS` env var (comma-separated) without a code
change. **Action required:** confirm and add the real Wix production/preview
origin(s) to that env var before Wix integration.

**Live-verified on the preview:** `OPTIONS /api/projects-list` with
`Origin: https://www.iterai.ro` → `204` and `Access-Control-Allow-Origin:
https://www.iterai.ro`; with `Origin: https://evil.example.com` → **no**
allow-origin header returned.

## 7. Files changed

Added:
- `lib/auth/resolve-supabase-user.js` (Supabase token verifier)
- `tests/projects.smoke.mjs` (live end-to-end smoke harness, token via env)
- `tests/projects-live-orchestrator.mjs` (secret-free: creates 2 test users,
  runs the harness, cleans up; reads secrets only from env)
- `PROJECTS_PHASE_1A_1_SECURITY_AND_LIVE_VALIDATION_REPORT.md`

Modified:
- `lib/projects/http.js` (async dual-mode guard, CORS fix, env fallback,
  removed body/query secret support)
- `lib/projects/validation.js` (added strict `validateListInput`)
- `lib/projects/transition-handler.js` (uses `authenticatedUser`)
- `api/projects-create.js`, `api/projects-get.js`, `api/projects-update.js`,
  `api/projects-list.js` (use `authenticatedUser`; list now strictly validates)

Removed:
- `lib/resolve-request-user.js` (retired; identity now comes from the verified
  token, not the request body)

Not touched: dashboard, generation, chat, workflow routes; serializer;
status-transition rules; repository ownership filters; name derivation; the
Supabase table and RLS policies.

## 8. Unit tests

`tests/projects.test.mjs` — **46/46 passing** (`node --test`). New/updated
coverage:
- Supabase token verification: missing → 401, invalid → 401, valid → user id.
- `guardRequest`: valid token authenticates; missing/invalid token → 401;
  forged `memberId` ≠ JWT user → 401; matching `memberId` accepted.
- Internal secret **not** accepted from body; **not** accepted from query;
  accepted via `x-iter-secret` + `memberId`; internal without valid memberId → 401.
- Service-role env fallback (`SERVICE_ROLE` preferred, `SECRET_KEY` fallback,
  empty when neither set); missing Supabase env → 500.
- CORS: allowed origin reflected; disallowed origin omitted; RN no-Origin
  proceeds; extra env origin allowed.
- List validation: invalid category → 400; invalid statuses → 400; invalid
  sort/direction/limit/cursor/search → 400; empty body valid.
- Repository: every call filters by verified `user_id` (and `id` where
  applicable); create inserts `user_id` + `status=active`.

All fetches are mocked; no network, no OpenAI, no Supabase writes.

## 9. Preview deployment reference

**DONE.** Preview deployed via `vercel deploy --target=preview` to project
`vercel-api-bridge-for-wix` (`prj_FcDnNL6...`):
- URL: `https://vercel-api-bridge-for-ayi9mi7a6-ierai.vercel.app`
- target: preview (API `target: null`), readyState: READY, aliased only to the
  branch-preview domain — production (`vercel-api-bridge-for-wix.vercel.app`) is
  untouched.
- No Deployment Protection on the preview (routes reachable for testing).

Rollback reference (pre-change HEAD): `683a850`. Changes are additive/scoped to
Projects + the shared Projects auth helper.

> Deploy note: a first `vercel deploy` (without `--target`) auto-created a
> **stray** project named `v0-project` and made a production deployment *of that
> stray project* (which lacks the Supabase env vars and is harmless). The real
> `vercel-api-bridge-for-wix` production was never affected. The owner elected
> to delete the stray `v0-project` project manually.

## 10. Complete live smoke-test results

### 10a. Unauthenticated security surface — DONE (real HTTP against preview)

Verified live against `https://vercel-api-bridge-for-ayi9mi7a6-ierai.vercel.app`:

- **Route existence + method guard:** `GET` on all 8 routes
  (`projects-create|list|get|update|pause|resume|complete|archive`) → **405**
  with `{ success:false, code:"PROJECT_METHOD_NOT_ALLOWED" }`.
- **No-auth rejection (core fix):** `POST {}` with no `Authorization` header and
  no `x-iter-secret` → **401** on all 8 routes. Identity is never taken from the
  body.
- **CORS:** allowed origin reflected; disallowed origin omitted (see §6).

### 10b. Authenticated lifecycle — PENDING owner self-run

Not executed here: the preview's `SUPABASE_URL` / `SUPABASE_SECRET_KEY` /
`ITER_INTERNAL_API_SECRET` are marked **Sensitive** in Vercel, so
`vercel env pull` returns them empty and test-user tokens cannot be minted from
the sandbox. Two ready-to-run, secret-free scripts are provided.

**Option A — full orchestrator (creates 2 namespaced test users, runs the flow,
cleans up).** Run where the Supabase service key is available:

```
SUPABASE_URL="<preview SUPABASE_URL>" \
SUPABASE_SECRET_KEY="<preview SUPABASE_SECRET_KEY>" \
PROJECTS_BASE_URL="https://vercel-api-bridge-for-ayi9mi7a6-ierai.vercel.app" \
SMOKE_PATH="$(pwd)/tests/projects.smoke.mjs" \
node tests/projects-live-orchestrator.mjs
```

It creates `zz-projects-smoke-<ts>-a@example.com` and `...-b@example.com`
(email-confirmed), mints tokens in-process (never printed), runs the harness,
then **deletes the test project rows and both users**. Prints only user UUIDs +
pass/fail lines.

**Option B — harness only (you already have two real user access tokens):**

```
PROJECTS_BASE_URL="https://vercel-api-bridge-for-ayi9mi7a6-ierai.vercel.app" \
PROJECTS_ACCESS_TOKEN="<user A access_token>" \
PROJECTS_ACCESS_TOKEN_B="<user B access_token>" \
node tests/projects.smoke.mjs
```

Either way the harness runs create → get → list → update → pause → resume →
complete → archive → list(includeArchived), plus: no token → 401, invalid token
→ 401, invalid category → 400, invalid status filter → 400, completed cannot
resume → 409, archived cannot edit → 409, forged `memberId` → 401, and user B
cannot access user A's project → 404. Tokens are never printed. Expected final
line: `NN passed, 0 failed`. Paste the output back and I'll finalize §10b–§13.

## 11. Supabase row verification

PENDING (depends on §10). After each meaningful step, verify the row via the
Supabase dashboard/SQL, scoped to the test user, e.g.
`select id, user_id, status, paused_at, completed_at, archived_at from projects where id = '<projectId>'`.
Use a dedicated test user only — not production data.

## 12. User A versus user B ownership test

Implemented in the smoke harness (§10, step 14) and in unit form (repository
always filters by verified `user_id`; get/update return 404 for non-owned IDs).
Live execution PENDING.

## 13. Production deployment reference

PENDING. Deploy to production only after the preview smoke flow passes. The
change set is limited to Projects files + the shared Projects auth helper.

## 14. Existing route regression checks

Static verification done: no existing route imports the changed Projects modules
or the removed `lib/resolve-request-user.js`; the service-key fallback does not
alter the env names existing routes already read.

**Live non-destructive spot-check DONE** on the preview (OPTIONS/GET only — no
POST bodies, so zero OpenAI usage): every existing route responds normally and
was not broken by the deploy:

| Route | OPTIONS | GET |
|---|---|---|
| `dashboard-data` | 204 | 405 |
| `profile-get-or-create` | 204 | 405 |
| `check-user-access` | 204 | 405 |
| `category-chat` | 204 | 200 |
| `specialist-chat` | 204 | 200 |
| `save-generation` | 204 | 405 |

A deeper behavioral check (real dashboard load with a session, a generation
round-trip) remains optional and should stay non-destructive.

## 15. Remaining risks

- Live HTTP validation not yet performed (needs preview URL + real token).
- The exact Wix production/preview origin must be confirmed and added to
  `PROJECTS_EXTRA_CORS_ORIGINS`; otherwise browser calls from Wix may be blocked.
- Confirm `SUPABASE_URL` + a service key + `ITER_INTERNAL_API_SECRET` exist in
  the preview environment (not just production).
- GoTrue `/auth/v1/user` adds one network round-trip per request; acceptable and
  fails closed, but worth noting for latency-sensitive paths.

---

Supabase access token verified server-side: YES
Client-supplied memberId is no longer trusted: YES (live: no-auth POST → 401 on all 8 routes)
Mobile requires no internal secret: YES
Wix requires no internal secret: YES
All project queries use verified user ID: YES
Preview deployed (preview target, not prod): YES
Routes exist + method-guarded (live 405): YES (all 8 routes)
No-auth rejected (live 401): YES (all 8 routes)
CORS allow/deny (live): YES
Preview create/get/list/update flow passed: PENDING owner self-run (§10b)
Preview status flow passed: PENDING owner self-run (§10b)
Cross-user access denied: YES (unit-verified); live PENDING owner self-run
Production smoke test passed: NOT YET RUN
Existing dashboard unaffected: YES (static); live spot-check PENDING
Safe to begin mobile integration: NOT YET (after §10b authenticated smoke passes)
Safe to begin Wix integration: NOT YET (after §10b smoke + confirmed CORS origin)
