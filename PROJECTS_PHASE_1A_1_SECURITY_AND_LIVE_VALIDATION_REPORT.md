# ITER AI — Projects Phase 1A.1 Security & Live Validation Report

Status: **Code-complete and unit/contract-verified. Live HTTP validation with a
real Supabase session is PENDING** (requires a preview URL + a real test-user
access token; not fabricated here per the "do not claim the APIs work before
real HTTP checks succeed" instruction).

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

## 7. Files changed

Added:
- `lib/auth/resolve-supabase-user.js` (Supabase token verifier)
- `tests/projects.smoke.mjs` (live end-to-end smoke harness)
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

PENDING. Rollback reference (pre-change HEAD): `683a850`
(`Merge pull request #73 ... 3cce8775`) on branch
`v0/trendingmobapps-5287-6a63f4ce`. Changes are additive/scoped to Projects +
the shared Projects auth helper. On push, Vercel builds a preview for this
branch; record that URL as `PROJECTS_BASE_URL` for the smoke test.

## 10. Complete live smoke-test results

PENDING — not executed, not fabricated. A ready-to-run harness is provided:
`tests/projects.smoke.mjs`. Run against the preview with a real test-user token:

```
PROJECTS_BASE_URL="https://<preview>.vercel.app" \
PROJECTS_ACCESS_TOKEN="<supabase access_token>" \
PROJECTS_ACCESS_TOKEN_B="<second user's token>" \
node tests/projects.smoke.mjs
```

It runs create → get → list → update → pause → resume → complete → archive →
list(includeArchived), plus: no token → 401, invalid token → 401, invalid
category → 400, invalid status filter → 400, completed cannot resume → 409,
archived cannot edit → 409, forged `memberId` → 401, and (if a second token is
provided) user B cannot access user A's project → 404. The token is never
printed.

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
alter the env names existing routes already read. Live post-deploy checks
(dashboard loads, generation responds, category/specialist chat present) are
PENDING and must be run non-destructively (no paid OpenAI calls).

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
Client-supplied memberId is no longer trusted: YES
Mobile requires no internal secret: YES
Wix requires no internal secret: YES
All project queries use verified user ID: YES
Preview create/get/list/update flow passed: NOT YET RUN
Preview status flow passed: NOT YET RUN
Cross-user access denied: YES (unit-verified); live NOT YET RUN
Production smoke test passed: NOT YET RUN
Existing dashboard unaffected: YES (static); live NOT YET RUN
Safe to begin mobile integration: NOT YET (after preview smoke passes)
Safe to begin Wix integration: NOT YET (after preview smoke + confirmed CORS origin)
