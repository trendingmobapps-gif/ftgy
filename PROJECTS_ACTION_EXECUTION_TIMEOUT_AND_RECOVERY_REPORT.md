# Projects Action Execution Timeout and Recovery Report

Date: 2026-07-15  
Scope: Live Preview failure for first action execution on project `087bfdc2-5717-46c2-8d91-eec85ae46e4e`

## Verified live sequence

| Step | Outcome |
|------|---------|
| Prepare action | HTTP 200, mode `research`, session `ready`, zero required questions |
| Execute action | One frontier call (`gpt-5.6-sol`, `resultGeneration`, `reasoningEffort: high`) |
| Failure | ~90s, HTTP 502, `EXECUTION_FAILED`, reason `timeout` |
| Supabase | No error |
| Provider HTTP | No error (local abort before provider response) |

Affected IDs:

- Project: `087bfdc2-5717-46c2-8d91-eec85ae46e4e`
- Step: `032d5975-b8b9-45b2-9914-28a8577f624a`
- Action: `7a1f9a2a-94ca-46ce-9aec-1fd1fc982d0b`

## Exact timeout owner

**Primary owner:** `AbortController` in `lib/projects/brain/actions/generation.js`, driven by `resolveOperationTimeoutMs()`.

**Previous owner (live failure):** hard-coded `PROJECT_ACTION_LIMITS.generationTimeoutMs = 90_000` in `lib/projects/brain/actions/constants.js`.

| Layer | Before | After |
|-------|--------|-------|
| Vercel function | Default (no `maxDuration`) | `maxDuration: 300` on `api/projects-execute-action.js` |
| Handler | No additional timer | No additional timer |
| Service | No additional timer | No additional timer |
| Provider call | 90s AbortController | Operation-aware (standard resultGeneration: 180s, capped below runtime ceiling) |
| OpenAI client | Same AbortController signal | Same |

The live log at ~90s confirms the internal 90s wrapper fired before any Vercel platform kill.

## Action state before and after failure (read-only inference)

| Field | Before execute | After live failure (inferred) |
|-------|----------------|-------------------------------|
| Action status | `prepared` | `failed` (legacy path) |
| Session status | `ready` | reverted to `ready` |
| Result row | none | none |
| OpenAI aborted | n/a | yes (`AbortError`) |
| Provider continued locally | n/a | unknown; no persistence observed |
| Idempotency ledger | started path only | no completed result entry |

**Investigation constraint:** affected action was not re-executed during this fix (per instruction).

## OpenAI abort and persistence

- OpenAI request was **explicitly aborted** by local `AbortController` at configured timeout.
- **No result row** was persisted for this failure path.
- Action was incorrectly marked `failed` with generic `EXECUTION_FAILED` (fixed below).

## Model / reasoning classification

| Signal | Live failure | After fix |
|--------|--------------|-----------|
| Mode | `research` | unchanged |
| Model tier | frontier (`gpt-5.6-sol`) | preserved |
| Reasoning | `high` | `medium` for standard research without complexity signals |
| Complexity driver | `strategicOutput=true` because `executionPlan.mode === "research"` | removed blanket research → strategic mapping |
| Output token cap | 4096 | preserved |
| Provider call cap | 2 | preserved |

High reasoning now requires genuine `complex` / `exceptional` complexity with explicit reason code.

## Timeout policy

### Before

- Single 90s budget for all action generation regardless of operation role.

### After

- `lib/projects/brain/openai-operation-timeout.js` resolves budgets by role + complexity.
- Standard `resultGeneration`: 180s configured, capped at `maxDuration - 20s` buffer.
- Complex / exceptional strategic generation: up to 240s (still below 280s runtime ceiling).
- Vercel `maxDuration: 300` added for execute-action endpoint.

## Retry / idempotency behavior

| Scenario | Behavior |
|----------|----------|
| Completed persisted result | Returned via `shouldReusePersistedResult` / pending result gate |
| In-flight generation | Blocked with `EXECUTION_IN_PROGRESS` |
| Recoverable timeout | Action reset to `prepared` + `session_status: ready` + `_executionRecovery` metadata |
| Duplicate tap while in flight | No second provider call |
| Explicit retry after timeout | Allowed when no active operation / result |

Typed error: `PROJECT_ACTION_GENERATION_TIMEOUT` (`recoverable: true`, `retryAllowed: true`).

## Malformed stage logging fix

**Root cause:** `logOpenAiUsageEvent(stageLog, payload)` passed object as first argument to `logExecuteStage(stage, context)`, producing `stage=[object Object]`.

**Fix:** `createExecuteStageUsageLogger(stageLog)` adapter in `execute-action-stage-log.js` + `assertValidExecuteStage()` guard.

## Files / functions changed

| File | Change |
|------|--------|
| `lib/projects/brain/openai-operation-timeout.js` | New operation-aware timeout resolver |
| `lib/projects/brain/actions/generation.js` | Uses resolver; returns timeout metadata |
| `lib/projects/brain/actions/constants.js` | `GENERATION_TIMEOUT`, `EXECUTION_IN_PROGRESS` codes |
| `lib/projects/brain/actions/validation.js` | Maps typed recoverable timeout |
| `lib/projects/brain/actions/execution-generation-gate.js` | Retry / in-flight / recovery gate |
| `lib/projects/brain/actions/execute-action-stage-log.js` | Stage validation + usage logger adapter |
| `lib/projects/brain/actions/service.js` | Recoverable timeout lifecycle, gates, safe logging |
| `lib/projects/brain/strategic-result-intent.js` | Standard research no longer auto-strategic |
| `lib/projects/brain/project-model-policy.js` | Standard resultGeneration keeps medium reasoning on frontier |
| `api/projects-execute-action.js` | Propagate recoverable flags |
| `vercel.json` | `maxDuration: 300` for execute-action |
| `tests/projects-action-execution-timeout-recovery.test.mjs` | 13 regression tests |

## Tests / results

- New suite: **13/13 pass**
- Full backend `test:projects-intent`: **524/524 pass**

## Remaining synchronous-runtime risk

Even with 300s Vercel limit and 180–240s provider budgets, frontier research with high complexity may still approach the ceiling. Long-running provider responses remain bound to a single serverless invocation.

## Final Lifecycle, Concurrency, and TypeScript Consistency Verification

### Recoverable lifecycle truth (explicit answers)

After a generation timeout, the **authoritative persisted state** is:

| Field | Value |
|-------|-------|
| `project_step_actions.status` | **`prepared`** (not `failed`, not `completed`) |
| `project_step_actions.session_status` | **`ready`** |
| `prepared_input._executionRecovery` | `{ code: "PROJECT_ACTION_GENERATION_TIMEOUT", recoverable: true, retryAllowed: true, … }` |
| `collected_input` | **preserved** (unchanged) |
| `pending_result_id` | **null** |
| Result row | **none** |

**State transition on timeout:** `executing` (in_progress + generating) → **`prepared` + `ready` + recovery metadata** — not a DB enum named `recoverable_error`.

**Is `recoverable_error` persisted?** **NO.** It is a **mobile Universal Lifecycle resolver state** (`ProjectActionLifecycleState`) returned when `processing === 'error'` and `recoverableErrorCode === 'GENERATION_TIMEOUT'`.

**Universal Lifecycle mapping:**

| Layer | State |
|-------|-------|
| DB action status | `prepared` |
| DB session status | `ready` |
| Backend semantic | `ready_to_execute` (via `resolvePersistedTimeoutRecoveryState`) |
| Mobile lifecycle | **`recoverable_error`** with `body: recovery`, retry CTA enabled |
| Mobile legacy phase | `error` |

**Mobile sync after timeout:** `useProjectSession.generate()` calls `prepare(stepId)` on `GENERATION_TIMEOUT` to reload authoritative backend state before retry.

### In-flight duplicate gate truth

| Protection | Scope | Mechanism |
|------------|-------|-----------|
| Mobile `inFlightRef` | **Single instance / single session** | Blocks duplicate tap before second request |
| Backend read gate | **Cross-instance best effort** | Reads persisted `status`, `session_status`, `started_at` from Supabase |
| Backend claim lock | **Cross-instance best effort** | `claimActionGenerationLock()` PATCH with `status=eq.prepared` — only one instance wins |

**Not guaranteed across instances:** two concurrent requests that both read `prepared` before either PATCH could theoretically race. The conditional PATCH reduces but does not eliminate this window. **Honest classification: cross-instance best effort, not guaranteed.**

No migration added. No in-memory-only gate on backend.

### TypeScript Delta Verification

| Item | Value |
|------|-------|
| Command | `npx tsc --noEmit` |
| Total current errors | **17** |
| Changed-file errors (new implementation) | **0** |
| `[projectId].tsx` errors | **5** (`workflowView` possibly null — pre-existing, unrelated to timeout fix) |
| New files type-clean | **YES** — `ProjectActionResultGenerationState`, `projectActionResultGenerationPresentation`, `projectActionLifecycle`, `ProjectExecutionRenderer`, `IterThinkingState` (steps guard fixed) |

### Verification tests (this pass)

| # | Test | Result |
|---|------|--------|
| 1 | Exact persisted timeout state | backend test 1 |
| 2 | Lifecycle state returned to mobile | mobile lifecycle test |
| 3 | Timeout is recoverable | backend + mobile |
| 4 | Retry preserves prior input | `collected_input` preserved in persisted state test |
| 5 | No result row after timeout | backend test 13 |
| 6 | Duplicate tap blocked (single instance) | mobile inFlightRef test |
| 7 | Cross-instance honesty documented | backend test 7 |
| 8 | Changed mobile files zero new TS errors | verified |
| 9 | Backend full suite | **528/528** |
| 10 | Mobile suite | **383/383** |

## Remaining Prepare-Action Stage Logger Fix

### Root cause

After `adaptive_decision_created`, `logBrainSnapshotEvent()` and `persistBrainSnapshotToMemory()` called `logFn(payload)` with a structured object. Those helpers were wired directly to `logPrepareStage`, which expects `(stage: string, context: object)`. The object became the `stage` argument, producing `[projects-prepare-action] stage=[object Object] {}` in logs.

### Files / functions changed

| File | Change |
|------|--------|
| `lib/projects/brain/actions/prepare-stage-log.js` | Added `assertValidPrepareStage()`, `createPrepareStageUsageLogger()`; validation on `logPrepareStage`, `logPrepareFailure`, `logPrepareWarning` |
| `lib/projects/brain/actions/service.js` | Module-level `logPrepareStructuredEvent` adapter; brain snapshot event + persistence now use adapter instead of raw `logPrepareStage` |

No OpenAI provider behavior, Project Brain decision logic, or prepare/execute API contracts were changed.

### Tests

| Test | File |
|------|------|
| Prepare stage rejects object-valued stage names | `tests/projects-prepare-action-stage-log.test.mjs` |
| Decision Layer string stage | same |
| Execution-plan OpenAI usage string stage via adapter | same |
| No `stage=[object Object]` in brain snapshot path | same |
| Execute-action stage logger regression | `tests/projects-action-execution-timeout-recovery.test.mjs` (test 21) |
| Dedicated timeout npm script | `npm run test:projects-action-execution-timeout-recovery` |
| Full backend suite | `npm run test:projects-intent` |

### Deployment status

No commit, push, or deployment performed for this fix.

## Architecture Improvement Proposal (durable async execution)

If strategic research routinely exceeds ~3 minutes wall time:

1. **Persist `executing` before provider call** (already partially done via `in_progress` + `session_status: generating`).
2. **Return 202 Accepted** with `operationId` instead of holding the HTTP connection.
3. **Background worker / queue** completes provider call and writes result.
4. **Mobile polls** action session / pending result endpoint; no duplicate provider calls via idempotency ledger.
5. **Recovery** on timeout becomes “still executing” rather than recoverable retry, unless worker also fails.

This avoids coupling UX quality to synchronous function duration while preserving frontier quality and bounded provider calls.
