# PROJECTS Phase 1C.2 — Project Brain Foundation Report (Corrective Phase)

**Date:** 2026-07-12  
**Backend repo:** `/Users/grigorestefanica/Downloads/ftgy-main`  
**Branch:** `feature/projects-phase-1c-2-project-brain`  
**HEAD:** `bc8c294` (corrective fix for step mutation + workflow idempotency)

---

## 1. Root cause diagnosis

### `POST /api/projects-step-status` → HTTP 400

| Check | Finding |
|-------|---------|
| Request field names | Smoke + mobile both send `{ projectId, stepId, targetStatus }` — matches endpoint contract ✅ |
| Allowed transitions | `pending → completed`, `completed → pending` are supported ✅ |
| Actual failure | `mutateProjectStepStatus` rejected mutations when `project.brain_status !== "ready"` |
| Why `brain_status` missing | `getProjectSelectColumns()` omitted brain columns unless `enableProjectBrainSelectColumns()` ran |
| When enable skipped | Preview with migration already applied but `POSTGRES_URL` absent → schema bootstrap disabled → brain columns never selected |
| Effect | `brain_status` undefined on loaded project → validation 400; progress/nextAction never returned |

### `POST /api/projects-generate-workflow` → HTTP 502 on second call

| Check | Finding |
|-------|---------|
| First generation | Succeeded (workflow persisted, `brain_status=ready` in DB) |
| Second call path | Idempotency guard checked `project.brain_status === "ready"` before loading workflow |
| Loaded project shape | Same missing `brain_status` column → guard failed → attempted second insert |
| Duplicate insert | `project_workflows.project_id` unique constraint → `workflow_insert_failed` → mapped to 502 |

---

## 2. Corrective fixes (`bc8c294`)

1. **`schema-bootstrap.js`** — Always probe for `brain_status` column and enable brain select columns when present, even when SQL bootstrap is disabled.
2. **`service.js`** — Workflow-first idempotency: load existing bundle before generation; return HTTP 200 when `workflow.status === "ready"`.
3. **`service.js`** — Step mutation readiness via `isProjectBrainReady(project, bundle)` (brain status OR ready workflow bundle).
4. **`repository.js`** — Duplicate workflow insert returns `workflow_already_exists`; service returns idempotent 200.
5. **`projects-step-status.js`** — Stable response adds `step`, `progress`, `nextAction`; Preview-only safe validation logging.
6. **`tests/projects-brain-service.test.mjs`** — 11 new tests for column probe, readiness helpers, progress/nextAction contract.

---

## 3. Backend verification

```bash
npm run test:projects-intent
# 97 passed, 0 failed
```

| Commit | Message |
|--------|---------|
| `bc8c294` | Fix Project Brain step mutation and workflow idempotency on Preview |
| `85ca525` | Fix project reads before brain migration is applied |
| `37edf9b` | Preview schema bootstrap + live smoke harness |
| `88ad5d2` | Project Brain workflow foundation |

---

## 4. Vercel Preview (committed source)

| Item | Value |
|------|-------|
| Branch | `feature/projects-phase-1c-2-project-brain` |
| Validation HEAD | `bc8c294` |
| Preview URL | `https://vercel-api-bridge-for-h0fq5ma3c-ierai.vercel.app` |
| Prior Preview (superseded) | `https://vercel-api-bridge-for-7y0i7vs0e-ierai.vercel.app` @ `85ca525` |
| Environment | Preview |
| Production SHA | `6619602` (unchanged) |

---

## 5. Authenticated live smoke (`bc8c294`)

```bash
export PROJECTS_BASE_URL="https://vercel-api-bridge-for-h0fq5ma3c-ierai.vercel.app"
npm run smoke:projects-brain
```

| Result | Value |
|--------|-------|
| Passed | **23** |
| Failed | **0** |
| Exit code | **0** |

**Case A confirmations:**
- Complete first step → 200 ✅
- Progress increased ✅
- Next action changed ✅
- Reopen step → 200 ✅
- Progress decreased ✅

**Case E confirmations:**
- Second generation idempotent → 200 ✅
- Single workflow row preserved ✅

**Cleanup:** 4 temporary projects archived.

---

## 6. Mobile contract check

| File | Contract |
|------|----------|
| `src/services/projectWorkflowApiService.ts` | Sends `{ projectId, stepId, targetStatus }`; expects `success`, `brainStatus`, `progress` ✅ |
| `src/hooks/projects/useProjectWorkflow.ts` | Toggle `completed` ↔ `pending` via `updateProjectStepStatus` ✅ |

No mobile code changes required — contract already aligned.

```bash
npx tsc --noEmit                    # PASS
npm run test:projects-detail-homepage  # 130/130 PASS
```

**Simulator validation:** Not re-run in this corrective pass (prior branch wiring validated; no mobile contract change).

---

## 7. Step-status response contract

```typescript
{
  success: true,
  step: ProjectStep,
  progress: {
    completedSteps: number;
    totalSteps: number;
    progressPercent: number;
    completedMilestones: number;
    totalMilestones: number;
  },
  nextAction: ProjectNextAction | null,
  updatedStepId: string,
  brainStatus: string,
  workflow: { ... },
  summary: { ... }
}
```

---

## 8. Idempotency decision order (implemented)

```text
Load Project and verify ownership
→ load existing workflow bundle

If existing workflow status = ready:
  return existing workflow, HTTP 200, idempotent: true

If brain_status = generating (not stale) and no workflow:
  return 409 GENERATION_IN_PROGRESS

If failed and retry allowed:
  start controlled retry

If no workflow:
  generate once (lock + single insert)
```

Database uniqueness: `project_workflows.project_id` unique (migration).

---

Step completion live: YES
Step reopening live: YES
Progress increases after completion: YES
Progress decreases after reopening: YES
Next action changes correctly: YES
Second workflow generation idempotent: YES
Duplicate workflow rows prevented: YES
Backend tests passed: YES
Live smoke passed 23/23: YES
Mobile contract validated: YES
Simulator validation passed: NO
Production untouched: YES
Safe to prepare TestFlight build: YES
