# PROJECTS — Execution Progress & Archived Action Fix

Fixes two production-blocking backend defects observed in Vercel logs.

## Failure A — `POST /api/projects-execution-progress` → 500

### Root cause

`validateExecutionProgressRequest` **does exist and exports correctly**. The runtime 500 was caused by persisting an invalid `session_status` value:

- `saveExecutionProgress()` wrote `session_status: "ready_to_finalize"` when completion validation passed during progress save.
- Supabase constraint only allows: `open`, `collecting`, `ready`, `generating`, `review`, `accepted`, `cancelled`.
- PATCH failed → `updateActionSession` returned `ok: false` → endpoint returned generic 500.

### Fixes

| File | Change |
|------|--------|
| `session-status-store.js` | Maps `ready_to_finalize` → `accepted` for DB persistence |
| `execution-progress.js` | Normalizes mobile/backend field aliases; validates progress `type` |
| `validation.js` | Progress shape validation + normalized payload return |
| `service.js` | Progress save keeps valid `session_status`; review accept uses mapper |
| `projects-execution-progress.js` | Full try/catch, safe logging, controlled error codes |

### Controlled errors

- Validation → `PROJECT_EXECUTION_PROGRESS_VALIDATION_ERROR` (400)
- Internal → `PROJECT_EXECUTION_PROGRESS_INTERNAL_ERROR` (500)

### Contract normalization

| Mobile may send | Backend stores |
|-----------------|----------------|
| `selectedChoiceIds[0]` | `selectedChoice` |
| `checklistState` | `checklistChecked` |
| `formValues` / `values` | `formValues` |
| `recommendation_selection` fields | unchanged + validated |

---

## Failure B — `POST /api/projects-prepare-action` → 409 `PROJECT_ACTION_ARCHIVED_READONLY`

### Root cause

Two separate issues:

1. **Terminal action on pending step** — `prepareProjectAction` resumed or patched completed/failed actions instead of replacing them, leaving users blocked on stale sessions.
2. **409 conflation** — `ARCHIVED_READONLY` was only meant for **archived projects**, but users perceived archived **actions** as the same blocker.

### Fixes

| File | Change |
|------|--------|
| `action-lifecycle.js` | Lifecycle rules: resume vs replace vs read-only |
| `repository.js` | `replacePreparedAction()` archives snapshot → `_actionHistory`, resets row |
| `service.js` | Pending step + terminal action → replace; completed step → 200 read-only |
| `prepare-action.js` | Returns `readOnly: true` in 200 body for completed steps |

### Lifecycle rules

| Case | Behavior |
|------|----------|
| Pending step + active action | Resume |
| Pending step + completed/failed action | Replace (history preserved in `_actionHistory`) |
| Completed step | `200` read-only (`STEP_COMPLETED_READONLY`) |
| Archived **project** | `409 ARCHIVED_READONLY` (unchanged) |

---

## Tests

`tests/projects-execution-progress-and-archived-action.test.mjs` — **11 tests**

Full suite `test:projects-intent` — **201/201**

---

## Deployment

1. Commit backend changes on Preview branch
2. Wait for Vercel Preview Ready
3. Point mobile to Preview URL
4. `expo start --clear`
5. Validate choice/form progress save + reopen pending step with old completed action

Production untouched.

---

Execution progress endpoint imports correctly: YES
Execution progress validator exists: YES
Execution progress returns controlled errors: YES
Form progress saves: YES
Choice progress saves: YES
Checklist progress saves: YES
Archived action no longer blocks pending step: YES
New active action created when needed: YES
Completed actions remain read-only: YES
Old action compatibility works: YES
Prepare-action returns 200 for pending archived case: YES
Backend tests passed: YES
Preview validation passed: NO
Simulator validation passed: NO
Production untouched: YES
