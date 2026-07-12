# PROJECTS Phase 1C.3 — Project Execution Engine Report

**Date:** 2026-07-13  
**Backend repo:** `/Users/grigorestefanica/Downloads/ftgy-main`  
**Mobile repo:** `/Users/grigorestefanica/Documents/ITER Mobile/iter-ai-mobile`  
**Branch:** `feature/projects-phase-1c-2-project-brain` (backend)  
**HEAD:** `a80d381`

---

## 1. Architecture

Phase 1C.3 adds a **Project Actions layer** on top of Project Brain without changing the overall app layout.

```text
Project Brain (1C.2)
  workflow generation
  milestones + steps
  progress + next action

Project Execution Engine (1C.3)
  action preparation   → contextual prompt + missing fields
  action execution     → capability invocation (hidden)
  result persistence   → lightweight project results
  gated completion     → step completes only after saved result
```

**Product rule enforced:** users see **Actions**, not tools, prompts, or orchestration.

---

## 2. Project Actions model

Each workflow step exposes a **Project Action**:

| Field | Purpose |
|-------|---------|
| `title` | Step title |
| `explanation` | What this step does |
| `whyItMatters` | Why it matters for the goal |
| `expectedResult` | What will be generated |
| `preparedPrompt` | Contextual request (never empty) |
| `preparedInput` | Auto-filled capability inputs |
| `missingInformation` | Only fields still unknown |
| `executionState` | `ready` / `prepared` / `in_progress` / `completed` |
| `latestResult` | Attached lightweight result preview |

Internal only (not shown in mobile UI): `capability_type`, `capability_ref`.

---

## 3. Action lifecycle

```text
User opens Project
→ Brain workflow ready
→ User taps "Începe acțiunea"
→ POST /api/projects-prepare-action
→ ITER builds prompt from project context
→ User edits/accepts prepared prompt
→ POST /api/projects-execute-action
→ Capability runs (tool or project_brain fallback)
→ Result saved to project_action_results
→ Step marked completed
→ Progress + next action refresh
```

**Manual step completion without a result is rejected** (`409 PROJECT_ACTION_RESULT_REQUIRED`).

---

## 4. Context preparation

`lib/projects/brain/actions/context-builder.js` assembles:

- project goal, name, summary, category
- workflow summary and current stage
- milestone + step details
- previously completed steps and result previews

`prompt-builder.js` reuses this context to:

- infer tool input fields when possible
- build a non-empty `preparedPrompt`
- expose only truly missing fields

---

## 5. Prompt preparation example

Goal: `Vreau să deschid o patiserie premium în Timișoara, buget 80.000 €`

Prepared prompt (representative):

> Creează rezultatul pentru pasul „Plan financiar inițial” din proiectul „Patiserie premium”. Obiectiv proiect: Vreau să deschid o patiserie premium în Timișoara, buget 80.000 € …

User may edit, then generate.

---

## 6. Result persistence

**Migration:** `supabase/migrations/20260713_project_action_results.sql`

| Table | Role |
|-------|------|
| `project_step_actions` | Prepared/executed action state per step |
| `project_action_results` | Lightweight results (`type`, `title`, `preview`, `content`, `createdAt`) |

RLS: read-own; inserts/updates via service role only.

---

## 7. Backend files

| Path | Role |
|------|------|
| `api/projects-prepare-action.js` | Prepare contextual action |
| `api/projects-execute-action.js` | Execute + save result + complete step |
| `api/projects-action-results.js` | List results for project/step |
| `lib/projects/brain/actions/constants.js` | Statuses, limits, error codes |
| `lib/projects/brain/actions/context-builder.js` | Project context assembly |
| `lib/projects/brain/actions/prompt-builder.js` | Prompt + input inference |
| `lib/projects/brain/actions/generation.js` | OpenAI execution |
| `lib/projects/brain/actions/repository.js` | Supabase CRUD + serializers |
| `lib/projects/brain/actions/service.js` | Orchestration |
| `lib/projects/brain/actions/validation.js` | Request validation |
| `lib/projects/brain/next-action.js` | Next action now exposes `action` |
| `lib/projects/brain/schema-bootstrap.js` | Applies actions migration on Preview |
| `tests/projects-brain-actions.test.mjs` | Unit tests |
| `tests/projects-actions-live-smoke.mjs` | Live patiserie scenario |

---

## 8. Mobile files

| Path | Role |
|------|------|
| `src/types/projectAction.ts` | Action + result types |
| `src/types/projectWorkflow.ts` | `action` on steps/nextAction |
| `src/services/projectActionApiService.ts` | prepare/execute/results APIs |
| `src/hooks/projects/useProjectAction.ts` | Action execution hook |
| `app/proiecte/[projectId]/action.tsx` | Focused action screen |
| `app/proiecte/[projectId].tsx` | Continue Project → action flow |
| `src/components/projects/ProjectWorkflowTab.tsx` | Start Action + View Details |
| `src/components/projects/ProjectWorkflowOverviewCard.tsx` | Action-first next step |
| `src/components/projects/ProjectRecommendedStepCard.tsx` | Continue Project CTA |
| `src/utils/projectWorkflowSummary.ts` | Continue Project labels |
| `scripts/projects-phase-1c-3-execution.test.ts` | Wiring tests |

**UI unchanged structurally** — same tabs/cards; behavior is action-first.

---

## 9. Tests

### Backend (`npm run test:projects-intent`)

- 102 passed / 0 failed (includes 5 new action preparation tests)

### Mobile (`npm run test:projects-detail-homepage`)

- 134 passed / 0 failed (includes 4 new 1C.3 wiring tests)

### Live smoke

| Harness | Target |
|---------|--------|
| `npm run smoke:projects-brain` | Updated Case A uses prepare + execute |
| `npm run smoke:projects-actions` | Patiserie end-to-end scenario |

**Preview URL (latest deploy):** `https://vercel-api-bridge-for-gu73fkwi3-ierai.vercel.app` (commit `92cb180`); subsequent fixes through `a80d381` deploying separately.

---

## 10. Remaining limitations

1. Full document system deferred (lightweight text results only).
2. Project chat / memory not started (per scope).
3. Action execution is synchronous on Vercel (same model as Brain generation).
4. Preview requires `project_step_actions` migration (auto-bootstrap when `POSTGRES_URL` configured).
5. Homepage cards open project detail first; direct action deep-link optional later.

---

## 11. Preview validation status

Live validation re-run pending final Preview deployment (`a80d381`). Initial `92cb180` Preview confirmed:

- Brain smoke regression except Case A (expected: manual completion now blocked)
- Action prepare returned 500 before circular-import fix / actions migration bootstrap

---

Project Actions implemented: YES
Project context reused automatically: YES
Known information reused: YES
Users never start from an empty prompt: YES
Action Results attached to Projects: YES
Workflow upgraded from passive checklist to execution engine: YES
Backend tests passed: YES
Mobile tests passed: YES
Preview validation passed: NO
Production untouched: YES
Safe to begin Phase 1C.4: NO
