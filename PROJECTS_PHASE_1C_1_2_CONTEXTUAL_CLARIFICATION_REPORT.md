# Projects Phase 1C.1.2 — Contextual Clarification Quality Report

**Date:** 2026-07-12  
**Branch:** `feature/projects-phase-1c-1-intent-analysis`  
**Scope:** Backend corrective phase for contextual clarification quality and obvious-intent deterministic rules.

---

## 1. Exact root cause

The screenshot defect had **two contributing causes**:

| Layer | Cause |
|-------|-------|
| **Mobile (primary for "Slăbesc 10 kg")** | `isObviouslyVagueGoal()` treated short clear goals (`length < 18 && wordCount <= 3`) as vague. `"Slăbesc 10 kg"` matched locally and returned `buildLocalVagueGoalClarification()` with the generic question *„În ce direcție vrei să te dezvolți?”* **without calling the API**. |
| **Backend (defense in depth)** | No deterministic override existed when the model returned irrelevant category clarification for obvious fitness goals. |

**Conclusion:** The screenshot was caused **primarily by mobile local vague-goal logic**, not by a stale API response. Stale-state risk on goal change was also real and fixed on mobile in the paired phase.

---

## 2. Deterministic obvious-intent rules

New module: `lib/projects/intent-deterministic-rules.js`

High-confidence pre-LLM rules return `ready` for obvious goals:

| Goal pattern | Category |
|--------------|----------|
| slăbesc / kg / pierdere în greutate / masă musculară / maraton / fitness | `fitness` |
| lansez platformă / deschid cafenea / clienți / marketing afacere | `business` |
| bac / examen / facultate / lecție | `studii` |
| CV / interviu / job / carieră | `cariera` |
| buget / economisesc / datorii | `finante` |

Vague development goals (`"Vreau să mă dezvolt"`) return contextual clarification with **Sănătate și fitness** included.

---

## 3. Contextual question validation

`validateClarificationQuestionsForGoal()` rejects:

- clarification for goals already covered by deterministic rules;
- generic development-direction questions for fitness/weight-loss goals;
- career/business/studies-only option sets for fitness topics.

Post-model override: if LLM still returns `needs_clarification` for a clear goal, deterministic `ready` overrides when possible.

---

## 4. Files modified

- `lib/projects/intent-deterministic-rules.js` (new)
- `lib/projects/intent-analysis.js`
- `tests/projects-intent-analysis.test.mjs`

---

## 5. Test results

`npm run test:projects-intent` → **29/29 PASS**

New tests cover:
- `"Slăbesc 10 kg"` → ready + fitness (no OpenAI)
- `"Vreau să mă dezvolt"` → needs_clarification with fitness option
- model clarification override for clear fitness goals

---

## 6. Preview / Production

- **Production:** untouched
- **Preview deploy:** pending owner push validation

---

“Slăbesc 10 kg” returns ready + fitness: YES
Clear fitness goals bypass clarification: YES
Clarification questions match current goal: YES
Irrelevant category options prevented: YES
Maximum two questions preserved: YES
One clarification round preserved: YES
Clarification occurs before Project creation when needed: YES
Backend tests passed: YES
Preview validation passed: PENDING
Production untouched: YES
Safe to begin Phase 1C.2: PENDING
