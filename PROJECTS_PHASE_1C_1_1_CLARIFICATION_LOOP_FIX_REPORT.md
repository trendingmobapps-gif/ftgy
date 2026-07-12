# ITER AI — Projects Phase 1C.1.1 Clarification Loop Fix Report

**Status:** Code complete, unit tests passed. Preview redeploy + authenticated live smoke pending owner run.  
Backend repository: `vercel-api-bridge-for-wix`  
Date: 2026-07-12

---

## Root cause

The intent-analysis prompt treated **plan personalization** (audience, niche, timeframe, implementation details) as blocking requirements for `needs_clarification`. Clear goals such as launching an AI platform were incorrectly sent through multiple clarification rounds.

There was **no server-side guard** preventing `needs_clarification` after `clarificationAnswers` were submitted. Mobile UI also allowed repeated clarification screens (`Trimite din nou`) alongside the main create CTA.

---

## Backend decision-rule changes

- Separated **category assignment** (may block) from **plan personalization** (must not block).
- `needs_clarification` allowed only for genuinely vague goals, real multi-category ambiguity, or missing action object.
- Clear examples in prompt: platform AI launch → `ready + business`; weight loss → `ready + fitness` without timeframe.
- Maximum **2** clarification questions (was 3).
- Deterministic post-processing:
  - `clarificationAnswers` absent → `ready | needs_clarification | unsupported`
  - `clarificationAnswers` present → `ready | unsupported` only
- If model returns `needs_clarification` after answers: one constrained repair call, then `unsupported` — never another question round.

---

## Files modified (backend)

- `lib/projects/intent-schema.js` — prompt rewrite
- `lib/projects/intent-analysis.js` — round guard, repair flow, exports
- `lib/projects/intent-validation.js` — `maxQuestions: 2`
- `tests/projects-intent-analysis.test.mjs` — 5 new guard tests

**Not modified:** endpoint contract shape, auth, CRUD routes, category slugs, Supabase schema.

---

## Unit-test results

```bash
npm run test:projects-intent
```

**25/25 pass** (was 20/20)

New coverage: platform AI → ready+business, second-round block, repair to ready, repair to unsupported, max 2 questions.

---

## Source control

| Field | Value |
|-------|-------|
| Branch | `feature/projects-phase-1c-1-intent-analysis` (continued) |
| Commit | pending push after this report commit |

---

## Preview / live validation

| Item | Status |
|------|--------|
| Prior validated Preview (1C.1) | `https://vercel-api-bridge-for-50xi2kb7m-ierai.vercel.app` |
| 1C.1.1 Preview redeploy | **Pending** — Vercel CLI unavailable in agent environment |
| Authenticated live smoke A–D | **Pending owner run** after Preview redeploy |

Expected live results after redeploy:

| Case | Goal | Expected |
|------|------|----------|
| A | Lansare platformă AI România | `ready`, `business`, no questions |
| B | Slăbesc 7 kg | `ready`, `fitness`, no blocking clarification |
| C | Vreau să mă dezvolt | `needs_clarification`, ≤2 questions |
| D | Answers for C | `ready` or `unsupported`, never `needs_clarification` |

---

## Production status

**Untouched.** No production deployment.

---

## Remaining risks

1. Prompt-only behavior for edge-case goals — monitor after redeploy.
2. Preview redeploy + live smoke must be run before mobile QA on corrected Preview.

---

Clear goals no longer blocked by plan-personalization questions: YES  
Platform AI launch goal returns ready + business: YES (unit + prompt; live pending)  
Weight-loss goal returns ready + fitness: YES (unit + prompt; live pending)  
Clarification limited to one round: YES  
Maximum two clarification questions enforced: YES  
Second needs_clarification response prevented server-side: YES  
Second needs_clarification response guarded mobile-side: YES  
Only one clarification CTA shown: YES (mobile)  
Clarification CTA labeled “Continuă”: YES (mobile)  
Ready after clarification creates Project automatically: YES (mobile flow unchanged)  
No infinite clarification loop possible: YES  
Backend tests passed: YES  
Mobile tests passed: YES  
Committed-source Preview validation passed: NO (pending redeploy + smoke)  
Production untouched: YES  
Safe to continue to Project workflow backend: YES (after Preview smoke)
