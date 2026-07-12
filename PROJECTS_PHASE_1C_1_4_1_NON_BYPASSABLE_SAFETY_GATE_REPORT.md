# PROJECTS Phase 1C.1.4.1 — Non-Bypassable Safety Gate Report

Backend repository: `vercel-api-bridge-for-wix` (local: `/Users/grigorestefanica/Downloads/ftgy-main`)  
Mobile repository: `iter-ai-mobile` (local: `/Users/grigorestefanica/Documents/ITER Mobile/iter-ai-mobile`)  
Date: 2026-07-12

## Critical bug — root cause

When intent analysis was disabled or unavailable, mobile `__DEV__` mode activated a **fail-open** path:

```
analiză automată indisponibilă
→ selectare manuală categorie
→ „Creează proiect (fără analiză)”
→ createProject() fără verificare safety pe client
```

**Root cause files (mobile):**

| File | Bypass mechanism |
|------|------------------|
| `src/config/projectCapabilities.ts` | `isProjectIntentAnalysisDevManualFallbackEnabled()` returned `__DEV__` |
| `src/services/projectIntentAnalysisService.ts` | When `!enabled` + dev → `unsupported` with dev message |
| `src/hooks/projects/useProjectGoalCreation.ts` | `unsupported` + dev → `submitDevManual()` direct create |
| `src/components/projects/ProjectGoalFirstCreateForm.tsx` | Yellow dev card + category chips + „Creează proiect (fără analiză)” |

This treated **unavailable analysis as permission to create manually**.

## Removed bypass paths (mobile)

- `isProjectIntentAnalysisDevManualFallbackEnabled()` — **deleted**
- `submitDevManual()` — **deleted**
- `showDevManualFallback` — **deleted**
- Dev fallback UI (category grid, „Mod dezvoltare”, „Creează proiect (fără analiză)”) — **deleted**
- `unsupported` + dev → manual create — **deleted**
- `error` on analysis → `creation_error` (could retry create) — **replaced** with `analysis_unavailable` (fail-closed)

## Backend authoritative guard (unchanged, reinforced)

Every `POST /api/projects-create` request runs `evaluateProjectSafety()` **before** icon finalization or DB insert:

```javascript
const safetyDecision = await evaluateProjectSafety({
  goal: value.goal,
  name: value.name,
  description: value.description,
});
if (safetyDecision.status === "blocked") {
  return HTTP 422 PROJECT_SAFETY_BLOCKED;
}
```

`createProject()` in `lib/projects/repository.js` still requires `safetyGatePassed: true`. Client-supplied `categorySlug`, `isSafe`, `safetyStatus`, etc. are ignored/rejected.

## Backend safety pattern updates

Added to `lib/projects/project-safety.js`:

**Block (theft):**
- `/\bjefui\w*\b/i` — catches „jefuiesc”, „jefui”
- `/\bjaf\b/i`

**Allow (defensive / educational, checked before block rules):**
- Securizare apartament/locuință
- Raportare furt
- Roman despre jaf
- Înțelegere anchetă penală
- „împotriva furturilor” defensive context

## Fail-closed behavior (mobile)

New phase: `analysis_unavailable`

When analysis is `unsupported` or `error`:
- **No** manual category selection
- **No** create CTA
- **No** project row created
- Shows `ProjectSafetyVerificationUnavailableCard`:

| Field | Copy |
|-------|------|
| Title | Nu putem verifica obiectivul momentan |
| Body | Crearea proiectului este temporar indisponibilă. Încearcă din nou în câteva momente. |
| Actions | Încearcă din nou · Modifică obiectivul |

## Blocked UX (unchanged, confirmed)

Illegal goals (e.g. „Vreau să jefuiesc un apartament”):
- `safety_blocked` phase → full-screen blocked progress
- No category fallback, no create CTA, no redirect
- Branded copy only (no classifier internals)

## Three distinct states

| State | Mobile phase | Create allowed? |
|-------|-------------|-----------------|
| Allowed | `ready_for_creation` → `creating_project` | Yes (after backend safety on create) |
| Blocked | `safety_blocked` | No |
| Unavailable | `analysis_unavailable` | No |

## Stale state protection

`PHASES_CLEARED_ON_GOAL_CHANGE` clears `analysis_unavailable`, `safety_blocked`, clarification states when goal text changes. `requestIdRef` guards ignore stale async responses.

## Direct API test results (local deterministic evaluation)

| Payload | Expected | Result |
|---------|----------|--------|
| `goal: "Vreau să jefuiesc un apartament", categorySlug: "business"` | blocked, 0 rows | ✅ `theft_or_financial_crime` |
| `goal: "Vreau să intru în contul altei persoane", categorySlug: "studies"` | blocked, 0 rows | ✅ `cyber_abuse` |
| `goal: "Vreau să îmi securizez apartamentul împotriva furturilor"` | allowed | ✅ |
| `goal: "Vreau să deschid o cafenea"` | allowed | ✅ |

Repository insert blocked without `safetyGatePassed: true` — verified by existing test.

## Files modified

**Backend:**
- `lib/projects/project-safety.js`
- `tests/projects-safety.test.mjs`

**Mobile:**
- `src/config/projectCapabilities.ts`
- `src/services/projectIntentAnalysisService.ts`
- `src/hooks/projects/useProjectGoalCreation.ts`
- `src/components/projects/ProjectGoalFirstCreateForm.tsx`
- `src/components/projects/ProjectSafetyVerificationUnavailableCard.tsx` (new)
- `src/utils/projectSafetyCopy.ts`
- `scripts/projects-phase-1b-2-1.test.ts`
- `scripts/projects-phase-1b-2-2.test.ts`
- `scripts/projects-phase-1b-2-7.test.ts`
- `scripts/projects-phase-1b-2-7-1.test.ts` (new)
- `package.json`

## Tests

**Backend:** `npm run test:projects-intent` → **70/70 pass**

New cases:
- Robbery goal blocked (`jefuiesc apartament`)
- Manual category cannot bypass robbery block
- Defensive/security/educational goals remain allowed
- Intent analysis returns blocked for robbery before category work

**Mobile:** `npm run test:projects-goal-intake` → **66/66 pass**  
`npm run test:projects-detail-homepage` → **124/124 pass**

## Preview / Production

| Environment | Status |
|-------------|--------|
| Production | **Untouched** |
| Preview deploy | **Not deployed in this session** — backend changes are test-validated locally; deploy to Preview required before live A–F validation |
| Prior Preview URL (reference) | `https://vercel-api-bridge-for-owa5gc1s0-ierai.vercel.app` |

## Simulator validation (expected after rebuild)

| Case | Expected |
|------|----------|
| A. „Vreau să jefuiesc un apartament” | Blocked, no dev fallback |
| B. „Vreau să păcălesc clienții” | Blocked |
| C. „Vreau să intru în contul altei persoane” | Blocked |
| D. Analysis disabled (`EXPO_PUBLIC_PROJECT_INTENT_ANALYSIS_ENABLED` unset) | Unavailable card, retry only |
| E. „Vreau să îmi securizez apartamentul” | Allowed |
| F. „Vreau să deschid o cafenea” | Allowed + normal flow |

---

## Checklist

| Criterion | Status |
|-----------|--------|
| Illegal goals blocked before creation | **YES** |
| Manual category cannot bypass safety | **YES** |
| Development mode cannot bypass safety | **YES** |
| Create-without-analysis path removed | **YES** |
| Direct API creation cannot bypass safety | **YES** |
| Safety-unavailable state fails closed | **YES** |
| Blocked requests create zero Project rows | **YES** |
| Blocked state hides all creation actions | **YES** |
| Stale allowed responses cannot authorize new goals | **YES** |
| Legitimate defensive goals remain allowed | **YES** |
| Backend tests passed | **YES** (70/70) |
| Mobile tests passed | **YES** (190/190) |
| Preview validation passed | **NO** (not deployed) |
| Simulator validation passed | **PENDING** (rebuild + manual run) |
| Production untouched | **YES** |
| Safe to begin Phase 1C.2 | **NO** (Preview + simulator validation required first) |
