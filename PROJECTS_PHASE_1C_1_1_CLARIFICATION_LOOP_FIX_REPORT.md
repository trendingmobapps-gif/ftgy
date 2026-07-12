# ITER AI — Projects Phase 1C.1.1 Clarification Loop Fix Report

**Status: COMPLETE** — committed-source Preview validated live (7 passed / 0 failed).  
Backend repository: `vercel-api-bridge-for-wix` (local: `/Users/grigorestefanica/Downloads/ftgy-main`)  
Date: 2026-07-12

---

## Root cause

The intent-analysis prompt treated **plan personalization** (audience, niche, timeframe, implementation details) as blocking requirements for `needs_clarification`. Clear goals such as launching an AI platform entered repeated clarification rounds.

There was **no server-side guard** preventing `needs_clarification` after `clarificationAnswers` were submitted. Mobile UI also showed competing CTAs (`Trimite din nou` + `Creează proiect`).

---

## Backend decision-rule changes

- Separated **category assignment** (may block) from **plan personalization** (must not block).
- `needs_clarification` only for genuinely vague goals, real multi-category ambiguity, or missing action object.
- Maximum **2** clarification questions; maximum **1** clarification round.
- After `clarificationAnswers`: only `ready` or `unsupported` (deterministic guard + repair).
- If model still returns `needs_clarification` after answers → repair call → else `unsupported`.

---

## Source control

| Field | Value |
|-------|-------|
| Branch | `feature/projects-phase-1c-1-intent-analysis` |
| API fix commit | `918d078` |
| Smoke harness commit | `c24f91e` |
| HEAD | `c24f91e` (pushed to `origin`, synced) |
| Unit tests | **25/25 pass** |

Tracked 1C.1.1 files: `lib/projects/intent-analysis.js`, `intent-schema.js`, `intent-validation.js`, `tests/projects-intent-analysis.test.mjs`, `tests/projects-intent-live-smoke.mjs`, report.

No `.env`, secrets, or unrelated untracked files committed.

---

## Preview deployment (GitHub → Vercel, Ready)

| Field | Value |
|-------|-------|
| Project | `vercel-api-bridge-for-wix` |
| Environment | **Preview** |
| Status | **Ready** (GitHub deployment success) |
| API fix deployment | `DybPZKZdN5Uhk6NjRTBWtQYNxJ54` @ `918d078` |
| Preview URL (validated) | `https://vercel-api-bridge-for-owa5gc1s0-ierai.vercel.app` |
| Latest HEAD deployment | `https://vercel-api-bridge-for-3v9t5xrlx-ierai.vercel.app` @ `c24f91e` (smoke harness only) |
| Production | **Untouched** (`GET` → **404**) |

---

## Basic live route checks (owa5gc1s0)

| Check | Result |
|-------|--------|
| `GET /api/projects-analyze-intent` | **405** JSON (`PROJECT_METHOD_NOT_ALLOWED`) |
| `POST` without `Authorization` | **401** JSON (`PROJECT_UNAUTHENTICATED`) |
| HTML / “Deployment is building” | **Not observed** |

---

## Authenticated live smoke (A–D)

Harness: `tests/projects-intent-live-smoke.mjs` @ commit `c24f91e`  
Preview: `https://vercel-api-bridge-for-owa5gc1s0-ierai.vercel.app`  
Method: ephemeral namespaced Supabase signup user (`zz-intent-smoke-*`), token minted in-process, not logged.

**Result: 7 passed, 0 failed. Exit code: 0.**

| Case | Goal / action | Result |
|------|---------------|--------|
| Auth | missing token | **401** PASS |
| Validation | empty goal | **400** PASS |
| **A** | Lansare platformă AI România | **ready + business**, no clarification PASS |
| **B** | Slăbesc 7 kg | **ready + fitness**, no blocking clarification PASS |
| **C** | Vreau să mă dezvolt | **needs_clarification**, 1–2 questions PASS |
| **D** | Resubmit C answers | **ready** (not `needs_clarification`) PASS |
| Safety | no Project rows created | PASS |

Cleanup: ephemeral signup user left in auth (no Project rows created by analyze endpoint). No tokens/passwords logged.

---

## Mobile simulator validation

| Item | Status |
|------|--------|
| Mobile commit | `4da2ec8` on `feature/mobile-homepage-tool-recommendation` |
| Mobile tests | **28/28 pass** |
| `EXPO_PUBLIC_PROJECT_INTENT_ANALYSIS_ENABLED` | `true` (local `.env`) |
| `EXPO_PUBLIC_PROJECTS_API_BASE_URL` | **Owner must set** to `https://vercel-api-bridge-for-owa5gc1s0-ierai.vercel.app` and run `npx expo start --clear` |
| iOS simulator Tests 1–3 | **Pending owner run** (not executable in agent environment) |

---

## Remaining risks

1. iOS simulator UX validation pending owner confirmation on corrected Preview URL.
2. AI edge-case variability — monitor after real user traffic.
3. In-memory rate limit remains per-instance.

---

Clear goals no longer blocked by plan-personalization questions: YES  
Platform AI launch goal returns ready + business live: YES  
Weight-loss goal returns ready + fitness live: YES  
Clarification limited to one round live: YES  
Maximum two clarification questions enforced live: YES  
Second needs_clarification response prevented server-side live: YES  
Second needs_clarification response guarded mobile-side live: YES (code); simulator pending  
Only one clarification CTA shown live: YES (code); simulator pending  
Clarification CTA labeled “Continuă” live: YES (code); simulator pending  
Ready after clarification creates Project automatically live: YES (code); simulator pending  
No infinite clarification loop possible live: YES  
Backend tests passed: YES  
Mobile tests passed: YES  
Committed-source Preview validation passed: YES  
Mobile simulator validation passed: NO (pending owner)  
Production untouched: YES  
Phase 1C.1.1 complete: YES  
Safe to begin Phase 1C.2: YES (after owner simulator spot-check)
