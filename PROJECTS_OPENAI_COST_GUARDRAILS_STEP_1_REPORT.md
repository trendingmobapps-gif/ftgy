# PROJECTS OpenAI Cost Guardrails — Step 1 Implementation Report

**Date:** 2026-07-14  
**Scope:** Emergency guardrails and usage observability only  
**Repository:** `ftgy-main` (Projects backend)  
**Branch context:** `feature/projects-phase-1c-2-project-brain`

---

## 1. Objective

Stop pathological OpenAI token consumption in ITER Projects structured calls while preserving frontier-quality reasoning for roadmap generation and important Project Brain work. Step 1 adds output ceilings, bounded retries/repairs, controlled reasoning-effort mapping, provider error classification, safe usage telemetry, live-test opt-in, and duplicate roadmap-generation hardening — without changing user-visible product behavior when generation succeeds.

---

## 2. Root cause addressed

Live audit evidence showed ~531k output tokens from five `gpt-5.6-sol` requests on 2026-07-14 because:

- Structured roadmap/execution-plan calls used frontier model with **no `max_output_tokens`**
- Legacy `max` / `xhigh` configured effort mapped to provider **`high`** reasoning for ordinary goals
- Structured client could chain **multiple provider calls** (primary + repair + up to four chat fallbacks)
- Execution plan could trigger a **separate repair invocation** outside the shared client budget
- Roadmap duplicate generation relied on **in-memory locks only**
- Live smoke tests could run with **`OPENAI_API_KEY` alone**

Step 1 closes these cost paths without replacing the frontier roadmap model or redesigning Project Brain.

---

## 3. Files created

| File | Purpose |
|------|---------|
| `lib/projects/brain/openai-error-codes.js` | Stable internal OpenAI error codes |
| `lib/projects/brain/openai-error-classification.js` | Deterministic HTTP/provider error mapping |
| `lib/projects/brain/openai-complexity.js` | Minimal deterministic complexity (`simple\|standard\|complex\|exceptional`) |
| `lib/projects/brain/openai-reasoning-effort.js` | `resolveProviderReasoningEffort()` central policy |
| `lib/projects/brain/openai-usage-observability.js` | Token extraction, safe logging, warning thresholds |
| `lib/projects/brain/openai-live-test-guard.js` | `OPENAI_LIVE_TESTS=1` gate and smoke caps |
| `tests/projects-openai-cost-guardrails.test.mjs` | Focused Step 1 test suite (26 tests) |

---

## 4. Files modified

| File | Change summary |
|------|----------------|
| `lib/projects/brain/project-model-policy.js` | Per-role ceilings, attempt limits, runtime policy resolver |
| `lib/projects/brain/openai-project-client.js` | `max_output_tokens`, bounded attempts, usage logging, error classification |
| `lib/projects/brain/generation.js` | Complexity/reasonCode wiring, lifecycle logging fixes |
| `lib/projects/brain/execution/execution-plan-generator.js` | Single structured call; internal repair via shared client |
| `lib/projects/brain/repository.js` | `tryClaimProjectGeneration()` conditional PATCH |
| `lib/projects/brain/service.js` | Duplicate-generation guards, claim-before-OpenAI, failure mapping |
| `package.json` | Added `test:projects-openai-guardrails`; included in `test:projects-intent` |
| `tests/projects-roadmap-generation-lifecycle.test.mjs` | Updated for bounded fallback/repair semantics |
| `tests/projects-ai-execution-plan.test.mjs` | Responses API mock shape for primary-call success |
| Live smoke runners/smokes (7 files) | `OPENAI_LIVE_TESTS=1` opt-in, project cap |

**Not modified:** mobile app, database schema, AI Experience generation surface, result generation cap (4096 preserved).

---

## 5. Functions created

- `OPENAI_INTERNAL_ERROR_CODES` constants
- `classifyOpenAiHttpError()`, `classifyOpenAiAbortError()`, `classifyOpenAiNetworkError()`, `isNonRetryableOpenAiError()`, `mapInternalOpenAiReason()`
- `resolveRoadmapComplexity()`, `resolveExecutionPlanComplexity()`, `resolveStructuredOperationComplexity()`
- `resolveProviderReasoningEffort()`, `resolveExceptionalReasonCode()`, `assertSupportedProviderReasoningEffort()`
- `extractOpenAiUsage()`, `logOpenAiUsageEvent()`, `logRoadmapDuplicateGenerationWarning()`
- `isOpenAiLiveTestsEnabled()`, `requireOpenAiLiveTestsOrSkip()`, `readLiveSmokeProjectCap()`
- `resolveStructuredOutputTokenCeiling()`, `resolveStructuredModelRuntimePolicy()`
- `tryClaimProjectGeneration()`

---

## 6. Functions modified

- `callProjectStructuredJson()` — output ceiling enforcement, bounded repair/fallback, usage telemetry
- `generateProjectWorkflowWithModel()` — complexity + reasonCode passed to structured client
- `generateProjectWorkflow()` — ready/generating skip paths, repository claim, duplicate warnings
- `generateExecutionPlan()` / `callOpenAiExecutionPlan()` — single bounded structured invocation
- `resolveProjectModelPolicy()` — extended with runtime limits
- `buildFailureResult()` / internal attempt orchestration in structured client

---

## 7. Exact per-operation token ceilings

| Operation | `max_output_tokens` | Policy key |
|-----------|---------------------|------------|
| Roadmap | **16,000** | `roadmap` |
| Execution plan | **8,000** | `executionPlan` |
| Decision (future role) | **4,096** | `decision` |
| Default structured | **8,000** | fallback via `defaultStructured` |
| Result generation | **4,096** (unchanged) | `execution` role |

Every structured Projects OpenAI call resolves a ceiling before request; missing operation maps to **8,000**. Ceilings are sent as Responses API `max_output_tokens` and Chat fallback `max_tokens`. Ceiling is logged in usage events (`maxOutputTokens`).

Output limit failures map to `OPENAI_OUTPUT_LIMIT_REACHED` → recoverable `output_limit` reason; truncated JSON is **not** silently accepted.

---

## 8. Exact reasoning mapping

Central function: `resolveProviderReasoningEffort({ operation, configuredEffort, complexity, reasonCode })`

| Config label (`configuredEffort`) | Complexity | Provider effort | Notes |
|-----------------------------------|------------|-----------------|-------|
| `max`, `xhigh`, `high`, any legacy | `simple`, `standard` | **medium** | Default Step 1 behavior |
| any | `complex` | **high** | `reasonCode` defaults to `complexity_complex` |
| any | `exceptional` | **high** only if explicit `reasonCode` | Without reasonCode → medium + `highReasonRejected` |
| any | `exceptional` + reasonCode | **high** | Logged via `highReasonCode` |

**Operation defaults:**

- **Roadmap:** configured `max` → medium unless complexity is `complex`/`exceptional`
- **Execution plan:** configured `xhigh` → medium unless complexity is `complex`/`exceptional`
- **Result generation:** unchanged (existing behavior preserved)

High reasoning emits safe metadata: `operation`, `complexity`, `highReasonCode`, `providerReasoningEffort`.

No project-category hardcoding; complexity uses structural signals only (see `openai-complexity.js`).

---

## 9. Exact attempt/fallback limits

Per structured logical operation (`roadmap`, `executionPlan`, `decision`):

| Limit | Value |
|-------|-------|
| Primary structured call | **1** |
| Repair / retry call | **1** |
| Chat fallback models | **1** (single fallback model, not 4) |
| **Total provider HTTP calls** | **≤ 2** |

**Retry rules:**

| Condition | Behavior |
|-----------|----------|
| Quota (`insufficient_quota`) | Never retry |
| Auth (401) | Never retry |
| Invalid request (400/404/model_not_found) | Never retry |
| Malformed JSON / validation failure | One repair allowed |
| Timeout / transient 5xx | At most one bounded retry |
| Post-repair validation failure | Deterministic fallback or typed recoverable failure |

Attempt number, fallback reason, and `providerCallCount` are logged.

---

## 10. Provider error mapping

| Provider signal | Internal code | Retryable | Mobile-safe reason |
|-----------------|---------------|-----------|-------------------|
| `insufficient_quota` | `OPENAI_QUOTA_EXCEEDED` | No | `quota_exceeded` |
| HTTP 429 / rate limit | `OPENAI_RATE_LIMITED` | No | `upstream` |
| HTTP 401 / invalid API key | `OPENAI_AUTH_FAILED` | No | `auth_failed` |
| Abort / timeout | `OPENAI_TIMEOUT` | Yes (bounded) | `timeout` |
| HTTP 5xx | `OPENAI_TRANSIENT_ERROR` | Yes (bounded) | `upstream` |
| HTTP 400/404 / invalid | `OPENAI_INVALID_REQUEST` | No | `invalid_request` |
| Bad/truncated payload | `OPENAI_INVALID_RESPONSE` | Repair only on 200 empty/malformed | `upstream` |
| `max_output_tokens` incomplete | `OPENAI_OUTPUT_LIMIT_REACHED` | No | `output_limit` |
| Repair exhausted | `OPENAI_REPAIR_FAILED` | No | `upstream` |

Logs preserve `internalErrorCode`; prompts, raw bodies, and API keys are never logged.

---

## 11. Usage observability fields

Every Projects OpenAI response with usage data emits `project_openai_usage`:

- `operation`, `model`, `configuredReasoningEffort`, `providerReasoningEffort`
- `complexity`, `highReasonCode`, `maxOutputTokens`
- `attempt`, `fallbackUsed`, `fallbackReason`, `providerCallCount`, `logicalOperationId`
- `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningTokens`, `totalTokens`
- `latencyMs`, `success`, `internalErrorCode`
- `projectId`, `stepId`, `actionId`, `transport`

**Never logged:** prompts, answers, raw memory, resource contents, full generated output, bearer tokens, API keys.

**Warning events** (`project_openai_usage_warning`):

- `outputTokens > 20,000`
- `reasoningTokens > 15,000`
- `providerCallCount > 1`
- `roadmap_generation_skipped_duplicate`

Structured logs only — **no database usage table** in Step 1.

---

## 12. Duplicate-generation behavior

**Before OpenAI:**

1. If workflow bundle status is `ready` → skip OpenAI, return idempotent view
2. If `brain_status === "ready"` → skip OpenAI
3. If `brain_status === "generating"` and not stale → skip OpenAI (`GENERATION_IN_PROGRESS` or idempotent view if workflow exists)
4. In-memory generation lock per Vercel instance
5. **`tryClaimProjectGeneration()`** — repository conditional PATCH (`brain_status=in.(pending)` → `generating`); only winner proceeds

**Losers:** release lock, log duplicate warning, return current generation status / idempotent view — **no OpenAI call**.

**Stale generating:** reset to `pending` (bounded), then normal claim flow.

**Remaining gap (documented):** in-memory lock + conditional PATCH do **not** guarantee cross-instance idempotency without a durable generation lease/migration. Two Vercel instances can still race before PATCH; only one should win at DB layer if statuses are consistent.

---

## 13. Live-test protection

All live OpenAI smoke paths require **`OPENAI_LIVE_TESTS=1`**:

- Missing flag → safe exit with terminal `SKIP` message (`process.exit(0)`)
- `OPENAI_API_KEY` alone does **not** enable live tests
- Project cap: **2** (`readLiveSmokeProjectCap`)
- Workflow generation attempts in smoke: **1** (existing runner caps preserved)
- Quota errors: never retried in structured client

**Recommended:** separate development OpenAI project/key with low budget.

Protected files: `projects-intent-live-smoke.mjs`, `projects-safety-live-smoke.mjs`, `projects-actions-live-smoke.mjs`, `projects-brain-live-runner.mjs`, `projects-brain-live-smoke.mjs`, `projects-safety-live-runner.mjs`, `projects-live-orchestrator.mjs`.

Unit/integration tests remain mocked by default.

---

## 14. Tests added

`tests/projects-openai-cost-guardrails.test.mjs` — 26 focused tests covering:

1. Roadmap sends `max_output_tokens` 16000  
2. Execution plan sends 8000  
3. Unknown operation default ceiling 8000  
4. Standard roadmap → medium reasoning  
5. Complex roadmap → high reasoning  
6. High reasoning requires complexity/reasonCode  
7. Execution plan defaults to medium  
8. ≤2 provider calls per operation  
9. Malformed JSON → one repair only  
10. Quota → no retry  
11. Auth → no retry  
12. Timeout retry bounded  
13. Fallback chain max one model  
14. `insufficient_quota` → `OPENAI_QUOTA_EXCEEDED`  
15–18. Usage extraction, reasoning tokens, privacy-safe logs, warnings  
19–22. Ready skip, generating skip, claim winner, loser idempotent  
23–24. Live test opt-in and cap  
25–26. Category-agnostic complexity, frontier model preserved  

Updated lifecycle and execution-plan tests for new semantics.

---

## 15. Test results

| Suite | Result |
|-------|--------|
| `npm run test:projects-openai-guardrails` | **26/26 pass** |
| `npm run test:projects-intent` (full Projects backend) | **357/357 pass** |
| AI Experience Phase 1 | **17/17 pass** (included in intent suite) |
| Universal Lifecycle envelope | **pass** (included) |
| Decision Layer Step 1 | **pass** (included) |

---

## 16. Backward compatibility

- Same roadmap schema and validation (`parseValidateAndRecoverRoadmap`)
- Same execution-plan schema and normalization
- Same persisted roadmap/workflow format
- Same AI Experience Contract behavior
- Same Universal Lifecycle behavior
- Same Decision Layer Step 1 behavior
- Frontier roadmap model **`gpt-5.6-sol`** preserved
- User-visible results unchanged when provider succeeds
- Only hidden cost/retry/telemetry behavior changed
- **No mobile changes**

---

## 17. Expected cost reduction

Conservative estimates for pathological cases:

| Lever | Expected impact |
|-------|-----------------|
| Roadmap output cap 16k | Prevents unbounded 100k+ output/token bills per call |
| Medium default reasoning | Large reduction in reasoning-token billing vs prior auto-`high` |
| Max 2 provider calls | Eliminates 3–5× multiplier from repair + 4-model fallback chains |
| Duplicate roadmap skip | Avoids repeat frontier generation for ready/generating projects |
| Live test opt-in | Prevents accidental real-key smoke spend in CI/dev |

**Order-of-magnitude:** prior audit showed ~106k output tokens/request; capped + medium reasoning should reduce worst-case per roadmap call by **~80–95%** while preserving high reasoning for genuinely complex goals.

---

## 18. Remaining cross-instance/idempotency risks

1. **In-memory generation lock** is per Vercel instance — retained in Step 1  
2. **Conditional PATCH claim** reduces but does not eliminate cross-instance races  
3. **No durable generation lease table** — stale recovery depends on `updated_at` heuristics  
4. **Action-result idempotency** for execution still deferred  
5. **No persistent usage ledger** — cost analysis remains log-based  

---

## 19. Technical debt

- In-memory locks remain until distributed lease migration  
- Complexity classifier is intentionally minimal (structural heuristics only)  
- Repository `fetchImpl` injection not wired — tests mock `globalThis.fetch` for service integration  
- `configuredEffort` labels (`max`/`xhigh`) kept for compatibility but overridden at runtime  
- Chat fallback still exists as single-model escape hatch (quality preservation)  
- Usage analytics require log pipeline aggregation (no DB table yet)

---

## 20. What was not implemented

- ProjectModelOrchestrator  
- Full role-based tiering system  
- Cost-ledger database table  
- Decision Graph  
- Mobile UI changes  
- Database migration  
- Deployment  
- Git commit / push  

---

## 21. Confirmation: no commit, push, or deployment

**Confirmed:** No git commit, no push, and no deployment were performed for this Step 1 work.

---

## Architecture Improvement Proposal

**Proposal (not implemented): Durable generation lease row on `projects`**

| Benefit | Trade-off |
|---------|-----------|
| True cross-instance idempotency | Requires migration + lease TTL semantics |
| Observable generation owner | Slightly more repository complexity |
| Safer stale recovery | Must handle orphan leases |

**Migration impact:** Add `brain_generation_lease_id`, `brain_generation_started_at`; claim via single UPDATE … RETURNING. Mobile/API contracts unchanged.

**Awaiting approval before implementation.**

---

## Required YES/NO review

### Cost Control Checklist

1. Does every structured Projects call have an output-token ceiling? **YES**
2. Is roadmap capped at 16,000 output tokens? **YES**
3. Is execution-plan generation capped at 8,000 output tokens? **YES**
4. Is medium reasoning the default? **YES**
5. Is high reasoning explicit and observable? **YES**
6. Are logical structured operations capped at two provider calls? **YES**
7. Are quota errors non-retryable? **YES**
8. Is the fallback chain bounded? **YES**
9. Are usage tokens logged safely? **YES**
10. Are high-token warnings emitted? **YES**

### Quality Checklist

1. Is the frontier roadmap model preserved? **YES**
2. Is roadmap schema unchanged? **YES**
3. Is execution-plan schema unchanged? **YES**
4. Can complex projects still escalate to high reasoning? **YES**
5. Are validation and deterministic fallbacks preserved? **YES**
6. Is user-visible result quality unchanged? **YES**
7. Is no extra user input introduced to save cost? **YES**
8. Is necessary context unchanged? **YES**

### Reliability Checklist

1. Can ready roadmaps avoid duplicate generation? **YES**
2. Can active generating requests avoid duplicate generation? **YES**
3. Is the generation claim repository-backed when possible? **YES**
4. Are retries typed and bounded? **YES**
5. Are quota/auth/invalid-request errors non-retryable? **YES**
6. Are timeouts bounded? **YES**
7. Are repair loops bounded? **YES**
8. Are live tests explicit opt-in? **YES**
9. Do mocked tests remain the default? **YES**
10. Are logs privacy-safe? **YES**

### ITER Product Checklist

1. Does the implementation preserve the AI Objective Completion Engine philosophy? **YES**
2. Does it preserve minimum user effort? **YES**
3. Does it preserve frontier quality for strategic work? **YES**
4. Does it keep technical cost controls invisible to users? **YES**
5. Does it avoid project-category hardcoding? **YES**
6. Does it preserve adaptive project behavior? **YES**

### Technical Debt Checklist

1. Does Step 1 still retain in-memory locks? **YES**
2. Is any cross-instance gap documented? **YES**
3. Is persistent action-result idempotency still deferred? **YES**
4. Is a full ProjectModelOrchestrator deferred? **YES**
5. Is a usage database ledger deferred? **YES**
6. Is complexity classification intentionally minimal? **YES**
7. Are all temporary compromises documented? **YES**
8. Is there a removal or next-step plan? **YES** — Architecture Improvement Proposal + Step 2 orchestrator/ledger deferred explicitly
