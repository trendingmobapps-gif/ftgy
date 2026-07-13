# PROJECTS Phase 1C.4 — Adaptive Project Brain & Dynamic Resource Engine Report

**Date:** 2026-07-13  
**Backend repo:** `/Users/grigorestefanica/Downloads/ftgy-main`  
**Mobile repo:** `/Users/grigorestefanica/Documents/ITER Mobile/iter-ai-mobile`  
**Branch:** `feature/projects-phase-1c-2-project-brain` (backend)  
**Backend HEAD (pre-commit):** `4bacf98` + uncommitted 1C.4 changes

---

## 1. Objective

Transform Project Brain from a static workflow generator into an **adaptive AI project manager** that decides what the user needs next — without exposing tools, engines, or configuration. The user only sees:

- **Continuă proiectul**
- **Resurse**
- **Progres**

Everything else (resource reuse, memory, workflow evolution, web-search decision) stays invisible.

---

## 2. Architecture

```text
Project Brain (1C.2)
  workflow, milestones, steps, progress

Project AI Sessions (1C.3.1)
  conversation, review, acceptance

Adaptive Project Brain (1C.4)
  Resource Engine      → project_resources
  Project Memory       → project_memory
  Workflow Updater     → project_workflow_events + step mutations
  Execution Decision   → prepare/execute/continue (internal)
  Web Search Layer     → decision only (stub execution)
  Universal category   → intent fallback
```

**Execution priority (internal, never shown to user):**

1. Reuse existing project knowledge (memory)
2. Reuse previous generated resources
3. Use existing ITER tool when it perfectly matches
4. Generate a new AI resource
5. Search the web when fresh information is required (decision only)
6. Combine into one seamless Continue Project action

---

## 3. Resource Engine

| Component | Path |
|-----------|------|
| Constants | `lib/projects/brain/resources/constants.js` |
| Repository | `lib/projects/brain/resources/repository.js` |
| Registry (reuse lookup) | `lib/projects/brain/resources/registry.js` |
| Service | `lib/projects/brain/resources/service.js` |
| API | `api/projects-resources.js` |

**Migration:** `supabase/migrations/20260715_project_adaptive_brain.sql`

- Table `project_resources` stores every accepted/generated asset (PDF, Excel, markdown, checklist, test, etc.)
- Unique index per `(project_id, step_id)` prevents duplicate registration for the same step
- `source_strategy` records how the resource was produced (`reuse_resource`, `use_tool`, `generate_resource`, `web_then_generate`, `project_brain`)

On session **accept**, `registerAcceptedResultAsResource` persists the accepted result into the registry.

---

## 4. Project Memory

| Component | Path |
|-----------|------|
| Constants | `lib/projects/brain/memory/constants.js` |
| Repository | `lib/projects/brain/memory/repository.js` |
| Service | `lib/projects/brain/memory/service.js` |

- Table `project_memory` stores durable facts (`buget`, `locatie`, `public_tinta`, deadlines, etc.)
- `extractMemoryFactsFromInput` derives facts from session `collected_input`
- `mergeMemoryIntoMissingFields` filters questions — **never asks twice**
- Memory upserted on session accept via `recordProjectMemory`

---

## 5. Dynamic Workflow Updater

| Component | Path |
|-----------|------|
| Updater | `lib/projects/brain/workflow/updater.js` |

- `evaluateWorkflowEvolution` inspects completed step, accepted resource, and memory
- Can **skip obsolete pending steps** when outcome already satisfied
- `applyWorkflowEvolution` persists changes and logs to `project_workflow_events`
- Invoked after session accept in `reviewProjectSession`

---

## 6. Dynamic Execution Decisions

| Component | Path |
|-----------|------|
| Decision engine | `lib/projects/brain/execution/decision.js` |
| Web search layer | `lib/projects/brain/execution/web-search.js` |

`decideExecutionStrategy` / `resolveContinueDecision` choose internally among:

- `reuse_resource`
- `ask_clarification`
- `use_tool`
- `generate_resource`
- `web_then_generate`
- `continue_workflow`

Integrated in `lib/projects/brain/actions/service.js`:

- **prepare:** loads memory, filters missing fields, returns `executionDecision`
- **execute:** short-circuits to existing resource when strategy is `reuse_resource`
- **review accept:** registers resource, records memory, evolves workflow

`applyWebSearchStub` returns `{ executed: false }` — decision layer only, no live search yet.

---

## 7. Universal Category

- Added `universal` to `PROJECT_CATEGORY_SLUGS` in `lib/projects/constants.js`
- Intent schema guidance updated in `lib/projects/intent-schema.js`
- `normalizeIntentModelResult` falls back to `universal` for invalid model categories (backward compatible — project still gets full brain, resources, memory, workflow)

---

## 8. Mobile UX (no new complexity)

| File | Change |
|------|--------|
| `src/types/projectResource.ts` | Resource types + display helpers |
| `src/services/projectResourcesApiService.ts` | `POST /api/projects-resources` |
| `src/hooks/projects/useProjectResources.ts` | Load/reload hook |
| `src/components/projects/ProjectResourcesTab.tsx` | Resources tab UI |
| `app/proiecte/[projectId].tsx` | New **Resurse** tab; focus reload includes resources |
| `src/types/projectCatalog.ts` | `universal` slug |
| `src/utils/projectDisplay.ts` | `Universal` label |
| `src/components/projects/ProjectWorkflowOverviewCard.tsx` | Removed duplicate resource placeholder |
| `scripts/projects-phase-1c-4-adaptive.test.ts` | Contract tests |

**Unchanged UX principles:**

- Single primary CTA: **Continuă proiectul**
- No engine selection, no workflow editor, no resource manager UI
- Resources appear automatically in the **Resurse** tab

---

## 9. Backward Compatibility

- Existing tables and APIs unchanged (additive migration only)
- `projects-prepare-action`, `projects-execute-action`, `projects-session-*` remain compatible; new fields (`executionDecision`, `reusableResource`) are optional
- `projects-action-results` still works; `projects-resources` is a parallel read endpoint
- Invalid intent categories no longer fail — they map to `universal` instead of blocking creation
- Existing projects without `project_resources` / `project_memory` rows continue to work

---

## 10. Tests

### Backend (`npm run test:projects-intent`)

**113/113 passed**

New suite `tests/projects-brain-adaptive.test.mjs` covers:

| Area | Tests |
|------|-------|
| Resource reuse decision | `reuse_resource` when registry match exists |
| Memory persistence | `mergeMemoryIntoMissingFields`, `extractMemoryFactsFromInput` |
| Workflow evolution | skip obsolete pending steps |
| Universal projects | slug in constants + intent fallback |
| Internet search decision | markers trigger `shouldSearch`; stub does not execute |
| Continue decision logic | missing fields filtered by memory |

Updated `tests/projects-intent-analysis.test.mjs`: invalid category now expects `universal` fallback.

### Mobile (`npm run test:projects-detail-homepage`)

**151/151 passed** (includes 6 new 1C.4 tests)

`npm run test:projects-data`: **12/12 passed**

---

## 11. Preview Validation

**Target URL tested:** `https://vercel-api-bridge-for-3txrtq4hi-ierai.vercel.app`  
**Command:** `PROJECTS_BASE_URL=... npm run smoke:projects-brain`

| Result | Detail |
|--------|--------|
| Safety cases (D) | PASS — blocked goals rejected |
| Project create (A/B/C/E) | PASS — projects created |
| Workflow generation | **FAIL** — `projects-generate-workflow` returns **404** on Preview |
| Adaptive resources API | Not deployed on tested Preview (1C.4 code not pushed) |

**Smoke summary:** 8 passed, 10 failed (exit code 1)

**Root cause:** 1C.4 backend changes are **local/uncommitted** on branch `feature/projects-phase-1c-2-project-brain`. Preview deployment is behind HEAD and may also need adaptive migration applied:

```bash
# After push + Preview deploy:
SUPABASE_DB_URL=... node scripts/apply-project-brain-migration.mjs
PROJECTS_BASE_URL=https://<new-preview>.vercel.app npm run smoke:projects-brain
```

**Status: NO** — Preview validation did not succeed in this session.

**Production:** untouched.

---

## 12. Checklist

| Requirement | Status |
|-------------|--------|
| Resource Engine implemented | **YES** |
| Project Memory implemented | **YES** |
| Dynamic Workflow implemented | **YES** |
| Universal category implemented | **YES** |
| Resource Registry implemented | **YES** |
| Dynamic execution decisions implemented | **YES** |
| Internet Research decision layer implemented | **YES** (stub execution) |
| Existing projects compatible | **YES** |
| Tests passed | **YES** (113 backend + 151 mobile detail + 12 data) |
| Preview validation | **NO** — deploy + migration required |
| Production untouched | **YES** |

---

## 13. Next Steps (blocker for Phase 1C.5)

1. Commit and push backend 1C.4 changes to `feature/projects-phase-1c-2-project-brain`
2. Wait for Vercel Preview deploy
3. Apply full migration chain on Preview Supabase (`cvxhuetjondnmjuobcbx`) including `20260715_project_adaptive_brain.sql`
4. Re-run `npm run smoke:projects-brain` until all cases pass
5. Point mobile `EXPO_PUBLIC_PROJECTS_API_BASE_URL` to validated Preview URL

**Do not proceed to the next phase until Preview validation succeeds.**
