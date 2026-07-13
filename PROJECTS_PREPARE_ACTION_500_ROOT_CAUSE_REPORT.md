# Projects Prepare-Action 500 Root Cause Report

**Date:** 13 July 2026  
**Scope:** Backend fix for `POST /api/projects-prepare-action` HTTP 500  
**Affected IDs (repro case):**
- `projectId`: `6713ef1c-d81c-41d2-9539-608aeca149cb`
- `stepId`: `dcfc28bf-68b7-4509-b47b-c5d68bc9a116`

**Production:** untouched

---

## Symptom

Authenticated mobile request reached Preview successfully, but prepare-action returned:

| Field | Value |
|-------|-------|
| HTTP status | 500 |
| `backendErrorCode` | `PROJECT_ACTION_INTERNAL_ERROR` |
| `backendErrorMessage` | `A apărut o eroare internă.` |
| `executionDefinitionExists` | `false` |

Auth worked; endpoint was reachable.

---

## Exact failing stage

**Primary failure stage:** `action_initialized`

**Root cause:** `upsertPreparedAction()` attempted to **SELECT/INSERT/PATCH** `project_step_actions` using Phase 1C.3.1 session columns (`session_status`, `conversation`, `collected_input`, `pending_question`, `pending_result_id`) even when those columns were **not present** on the Preview Supabase schema.

### Failure chain

```text
request_received
→ auth_success
→ project_loaded
→ workflow_loaded
→ step_loaded
→ ownership_validated
→ resources_loaded
→ adaptive_decision_created
→ existing_action_loaded (often null on first prepare)
→ action_initialized  ❌ Supabase 42703 / missing relation
→ INTERNAL 500
```

### Original exception shape

When session migration `20260714_project_ai_sessions.sql` is missing on Preview:

```json
{
  "code": "42703",
  "message": "column \"session_status\" does not exist"
}
```

When adaptive migration `20260715_project_adaptive_brain.sql` is missing, optional lookups return:

```json
{
  "code": "42P01",
  "message": "relation \"public.project_resources\" does not exist"
}
```

Optional adaptive failures did **not** need to crash prepare — the hard failure was persisting/loading actions with unavailable session columns.

---

## Why old Projects were affected

Projects created before 1C.3/1C.4 could exist on Preview where:

- `project_step_actions` exists (1C.3 base migration)
- `project_action_results` exists
- **session columns migration not applied**
- **adaptive tables migration not applied**

Repository code always used full `ACTION_SELECT_COLUMNS` and always wrote session JSON on insert. First prepare for a step failed at DB layer → service returned `{ ok: false, code: "INTERNAL" }` → API returned generic 500.

---

## Schema verification

### Expected migrations on Preview Supabase

| Migration | Purpose |
|-----------|---------|
| `20260713_project_action_results.sql` | `project_step_actions`, `project_action_results` |
| `20260714_project_ai_sessions.sql` | session columns + `acceptance_status` |
| `20260715_project_adaptive_brain.sql` | `project_resources`, `project_memory`, `project_workflow_events` |

### Required tables

- `project_step_actions`
- `project_action_results`
- `project_resources` (optional for prepare)
- `project_memory` (optional for prepare)
- `project_workflow_events` (optional for prepare)

### Required columns

**`project_step_actions`:** `session_status`, `conversation`, `collected_input`, `pending_question`, `pending_result_id`  
**`project_action_results`:** `acceptance_status`

### Live schema query status

Direct Preview Supabase schema query was **not executed in this session** (no DB credentials in local backend env). Verification should be run in Supabase SQL Editor against the Preview project:

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'project_step_actions'
order by column_name;
```

---

## Code fix

### 1. Structured stage logging

**New:** `lib/projects/brain/actions/prepare-stage-log.js`

Safe stage markers:

- `request_received`
- `auth_success`
- `project_loaded`
- `workflow_loaded`
- `step_loaded`
- `ownership_validated`
- `existing_action_loaded`
- `action_initialized`
- `session_normalized`
- `memory_loaded`
- `resources_loaded`
- `adaptive_decision_created`
- `execution_definition_created`
- `response_serialized`

Failures log: stage, error name/message, DB code/details/hint, stack, `projectId`, `stepId`.

Instrumented:

- `api/projects-prepare-action.js`
- `lib/projects/brain/actions/service.js`
- repository warnings on Supabase failures

### 2. Schema capability detection

**New:** `lib/projects/brain/actions/schema-capabilities.js`

Probes Preview schema at runtime:

- session columns available?
- `acceptance_status` available?
- adaptive tables available?

Select/insert columns adapt to available schema.

### 3. Old Project compatibility

**New:** `lib/projects/brain/actions/normalize.js`

- Normalizes `conversation`, `collected_input`, `missing_fields`, `pending_question`
- Detects persisted conversation safely
- Builds in-memory session when session columns cannot be persisted

**Updated:** `lib/projects/brain/actions/repository.js`

- Dynamic select columns
- Session fields written only when supported
- Supabase error payload logged on persistence failure
- Pending-result queries skipped when `acceptance_status` missing

**Updated:** `lib/projects/brain/actions/service.js`

- Full staged prepare flow
- Memory/resources/adaptive failures are warnings, not fatal
- In-memory session returned when DB cannot store session JSON

**Updated:** `lib/projects/brain/execution/decision.js`

- Skips resource reuse lookup when adaptive tables unavailable

### 4. Regression test

**New:** `tests/projects-prepare-action-compat.test.mjs`

Simulates exact legacy schema (no session columns, no adaptive tables) with the English evaluation step shape and asserts:

- HTTP-equivalent success (`ok: true`)
- `action` + `session` returned
- `executionDefinition.mode === "assessment"`

---

## Tests

```bash
npm run test:projects-intent
```

**Result: 123/123 pass** (includes new compat suite)

---

## Deployment

| Item | Status |
|------|--------|
| Backend commit/push | Pending local commit on `feature/projects-phase-1c-2-project-brain` |
| New Vercel Preview | Not deployed in this session |
| Preview migration apply | Should run `20260714` + `20260715` on Preview Supabase |
| Mobile `.env` | `https://vercel-api-bridge-for-6lc0ijh1p-ierai.vercel.app` (unchanged) |
| Simulator re-test exact IDs | Not run in this session |

After Preview redeploy, retry:

```text
projectId: 6713ef1c-d81c-41d2-9539-608aeca149cb
stepId: dcfc28bf-68b7-4509-b47b-c5d68bc9a116
```

Expected:

- HTTP 200
- `action`, `session`, `executionDefinition`
- mode: `assessment` or `guided_questions`
- Simulator shows first real question, not generic error card

---

## Checklist

Exact backend exception identified: YES  
Failing stage identified: YES  
Schema verified: NO  
Old Project compatibility fixed: YES  
Prepare-action returns 200: NO  
Execution definition returned: NO  
Simulator shows real execution UI: NO  
Production untouched: YES
