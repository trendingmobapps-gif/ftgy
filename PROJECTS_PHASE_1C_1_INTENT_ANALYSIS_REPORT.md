# Phase 1C.1 — Intent Analysis Endpoint: Live Validation Report

Status: **Authenticated live validation PASSED on preview (7 passed / 0 failed).
Production confirmed untouched.** One blocker for Phase 1C.2 is flagged in §7:
the endpoint source is deployed to the preview but is **not committed to this
branch (or any remote branch)**.

Endpoint: `POST /api/projects-analyze-intent`
Preview tested: `https://vercel-api-bridge-for-5dsf6yoq8-ierai.vercel.app`
(project `vercel-api-bridge-for-wix` / `prj_FcDnNL6...`, target=preview, READY,
aliased only to a branch domain — **not** the production alias).

---

## 1. Authenticated live smoke test — PASSED (owner-run)

The owner ran the authenticated smoke test (two dedicated, namespaced Supabase
test users, tokens minted in-process, cleaned up afterward) against the preview.

Result: **7 passed, 0 failed. Smoke exit code: 0.**

| # | Check | Result |
|---|-------|--------|
| 1 | missing token → 401 | PASS |
| 2 | empty goal → 400 | PASS |
| 3 | clear fitness goal → `ready` + `fitness` | PASS |
| 4 | clear business goal → `ready` + `business` | PASS |
| 5 | vague goal → `needs_clarification` | PASS |
| 6 | clarification re-analysis handled safely | PASS |
| 7 | endpoint created **no** Project rows | PASS |

Cleanup: both temporary test users deleted successfully.

## 2. Independent verification (performed here, no secrets required)

Against the same preview URL:

- `GET /api/projects-analyze-intent` → **405** (route exists, method-guarded).
- `POST` with no `Authorization` → **401**
  `{"code":"PROJECT_UNAUTHENTICATED","message":"Neautorizat."}` — corroborates
  smoke check #1 (identity is never taken from the body).
- `POST` with an invalid bearer token → **401**.

These confirm the endpoint is deployed, method-guarded, and rejects
unauthenticated/invalid requests exactly as the smoke test reported.

## 3. Behavior summary (from live results)

- Analyzes a free-text `goal` and returns a decision of either `ready`
  (with a detected category such as `fitness` or `business`) or
  `needs_clarification` for vague input.
- Validates input: empty goal → 400.
- Is **read-only / non-persistent**: it analyzes intent and does **not** create
  `projects` rows (smoke check #7). Project creation remains the separate
  `projects-create` responsibility.
- Handles a clarification re-analysis round safely.

## 4. Production untouched — CONFIRMED

Verified against the production alias `vercel-api-bridge-for-wix.vercel.app`:

- `GET /api/projects-analyze-intent` → **404** (the new endpoint does **not**
  exist on production — production predates 1C.1).
- `GET /api/projects-list` → **405** (existing Projects routes still respond
  normally; no regression).
- Production alias currently serves `target: production`, commit `a58b4c1`
  ("Merge PR #77"), which is the pre-1C.1 `main`.

No deployment to production was performed, and none is planned in this phase.

## 5. Deployment facts

- The tested preview (`5dsf6yoq8`) is a CLI `vercel deploy --target=preview` on
  the correct project `prj_FcDnNL6...`.
- Its only alias is the branch preview domain
  (`vercel-api-bridge-for-wix-trendingmobapps-5287-ierai.vercel.app`) — not the
  production alias. Production routing is unaffected.

## 6. Data-safety notes

- The endpoint creates no persistent rows (smoke #7), so the shared Supabase
  dataset is not mutated by analysis calls.
- Test users were namespaced and deleted by the orchestrator after the run.

## 7. BLOCKER for Phase 1C.2 — source not in version control

The endpoint is **live on the preview but its source is not committed** to the
current branch (`v0/trendingmobapps-5287-43e9e6ec`) or to any other remote
branch. Searches found:

- No `api/projects-analyze-intent.*` (or any analyze/intent-named file) in the
  working tree.
- No matching file in any `origin/*` branch.

Implication: the preview was built from a working tree whose 1C.1 changes were
never committed/pushed. If Phase 1C.2 is built on this branch as-is, it would
depend on code that does not exist in the repository, and a fresh
build/deploy from `main` or this branch would **not** include the endpoint.

**Required before 1C.2 starts:** commit and push the `projects-analyze-intent`
endpoint source (route + any supporting `lib/projects` helpers and its
validation) to a branch, and confirm a build from that committed source still
passes the smoke test. Until then, the working preview is not reproducible.

## 8. Readiness decision for Phase 1C.2

**Conditionally ready.**

- Functional/behavioral readiness: **YES** — the intent-analysis contract
  (`ready` + category vs. `needs_clarification`, 400 on empty goal, 401 on no
  token, no row creation) is validated live with real Supabase sessions
  (7/0), and production is provably untouched.
- Source-control readiness: **NOT YET** — see §7. The endpoint source must be
  committed and a build from that commit re-verified before 1C.2 builds on it.

Recommendation: proceed to design Phase 1C.2 against the validated contract, but
**gate the start of 1C.2 implementation on committing the 1C.1 source** so the
codebase and the running preview are back in sync. Do not deploy to production.
