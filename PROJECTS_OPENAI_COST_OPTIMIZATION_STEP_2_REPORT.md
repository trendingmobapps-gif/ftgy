# PROJECTS OpenAI Cost Optimization — Step 2 Implementation Report

**Date:** 2026-07-14  
**Scope:** Role-based model policy, persistent reuse, project cost controls  
**Repository:** `ftgy-main` (Projects backend)  
**Builds on:** Step 1 emergency guardrails (unchanged in intent)

---

## 1. Objective

Reduce normal operating cost while preserving frontier quality for strategic Project Brain work. Step 2 centralizes role-based runtime policy, deterministic complexity classification, evidence-based reuse, bounded repair hierarchy, cost guards, and extended observability — without redesigning Project Brain, mobile UI, ProjectModelOrchestrator, Decision Graph, or Research Engine.

---

## 2. Architecture implemented

```
Call site (roadmap / execution plan / result generation)
  → classifyOpenAiOperationComplexity()
  → resolveProjectModelRuntimePolicy({ role, complexity, operationContext })
  → evaluateOperationBudget() [request-scoped]
  → callProjectStructuredJson() / executePreparedAction()
  → repair via formatting/decisionRepair role (max 1)
  → logOpenAiUsageEvent() with role/tier/reuse metadata

Persistence reuse (no migration):
  prepared_input._executionPlanEvidenceHash
  prepared_input._resultIdempotency
  prepared_input._modelUsageState
  project_workflows.brain_version = "{version}:{evidenceHash16}"
  Decision Layer Step 1 _brainDecisionEvidenceHash (preserved)
```

Step 1 ceilings, bounded provider calls, error classification, and live-test opt-in remain active.

---

## 3. Files created

| File | Purpose |
|------|---------|
| `lib/projects/brain/openai-model-tiers.js` | Frontier/efficient model constants and resolvers |
| `lib/projects/brain/openai-operation-complexity.js` | Unified deterministic complexity classifier |
| `lib/projects/brain/openai-evidence-hash.js` | Roadmap/plan/result evidence hashing |
| `lib/projects/brain/openai-model-reuse.js` | Reuse decisions and idempotency ledger helpers |
| `lib/projects/brain/openai-cost-estimation.js` | Centralized cost band estimation |
| `lib/projects/brain/openai-cost-guards.js` | Operation/project/action budget guards |
| `lib/projects/brain/openai-repair-policy.js` | Repair role hierarchy and bounds |
| `lib/projects/brain/project-model-internal-codes.js` | Step 2 internal status codes |
| `tests/projects-openai-cost-step2.test.mjs` | 29 focused Step 2 tests |

---

## 4. Files modified

| File | Change |
|------|--------|
| `lib/projects/brain/project-model-policy.js` | Extended single registry with 13 runtime roles |
| `lib/projects/brain/openai-project-client.js` | Role-aware runtime policy, repair roles, budget gate |
| `lib/projects/brain/openai-usage-observability.js` | Step 2 log fields and warnings |
| `lib/projects/brain/generation.js` | Unified complexity + roadmap role |
| `lib/projects/brain/service.js` | Roadmap evidence reuse |
| `lib/projects/brain/repository.js` | Roadmap evidence hash in `brain_version` |
| `lib/projects/brain/execution/execution-plan-generator.js` | Evidence-based plan reuse |
| `lib/projects/brain/actions/generation.js` | Result generation runtime policy + guards |
| `lib/projects/brain/actions/action-result-generator.js` | Strategic output context |
| `lib/projects/brain/actions/service.js` | Persistent result idempotency + frontier counters |
| `lib/projects/brain/actions/repository.js` | `getActionResultById()` |
| `package.json` | `test:projects-openai-step2`, included in intent suite |
| Tests (guardrails, proactive, generator, lifecycle) | Updated for Step 2 semantics |

---

## 5. Functions created

- Model tiers: `resolveFrontierModel()`, `resolveEfficientModel()`, `isFrontierModel()`
- Complexity: `classifyOpenAiOperationComplexity()`, `resolveComplexityLevel()`
- Evidence: `computeRoadmapEvidenceHash()`, `computeExecutionPlanEvidenceHash()`, `computeResultGenerationEvidenceHash()`, `encodeRoadmapBrainVersionWithEvidence()`
- Reuse: `shouldReuseRoadmapGeneration()`, `shouldReuseExecutionPlan()`, `shouldReusePersistedResult()`, `withExecutionPlanEvidence()`, `withResultIdempotency()`, `readModelUsageState()`, `incrementFrontierUsageState()`
- Cost: `resolveProjectsCostGuardSettings()`, `evaluateOperationBudget()`, `estimateOpenAiOperationCost()`, `resolveModelCostBand()`
- Repair: `resolveRepairRole()`, `canAttemptModelRepair()`, `resolveOutputLimitRecoveryStrategy()`
- Policy: `resolveProjectModelRuntimePolicy()`, `resolveRuntimeRoleFromLegacyOperation()`

---

## 6. Functions modified

- `callProjectStructuredJson()` — role, budget gate, repair role switching
- `resolveProjectModelPolicy()` / `resolveStructuredModelRuntimePolicy()` — delegate to runtime policy
- `generateExecutionPlan()` / `ensureExecutionPlan()` — evidence hash persistence/reuse
- `generateProjectWorkflow()` / `persistGeneratedWorkflow()` — roadmap evidence encoding
- `executePreparedAction()` / `executeProjectAction()` — runtime policy + idempotency
- `logOpenAiUsageEvent()` — extended Step 2 fields

---

## 7. Role-based policy table

| Role | Preferred tier | Default model (repo) | Max output | Max calls | Max repair | Reuse |
|------|----------------|----------------------|------------|-----------|------------|-------|
| `intent` | efficient | `gpt-4.1-mini` | 1,024 | 1 | 0 | none |
| `safety` | efficient | `gpt-4.1-mini` | 512 | 1 | 0 | none |
| `roadmap` | **frontier** | `gpt-5.6-sol` | 16,000 | 2 | 1 | evidenceHash |
| `decision` | **frontier** | `gpt-5.6-sol` | 4,096 | 2 | 1 | evidenceHash (no live call Step 1) |
| `decisionRepair` | efficient | `gpt-4.1-mini` | 4,096 | 1 | 0 | none |
| `experienceDesign` | **frontier** | `gpt-5.6-sol` | 8,000 | 2 | 1 | evidenceHash |
| `executionPlanLegacy` | efficient | `gpt-4.1-mini` | 4,096 | 2 | 1 | evidenceHash |
| `resultGeneration` | efficient→frontier | `gpt-4.1-mini` / escalates | 4,096 | 2 | 1 | idempotencyKey |
| `resultRevision` | frontier | `gpt-5.6-sol` | 4,096 | 2 | 1 | idempotencyKey |
| `evaluation` | efficient | `gpt-4.1-mini` | 8,000 | 1 | 0 | none |
| `researchSynthesis` | frontier | `gpt-5.6-sol` | 8,000 | 2 | 1 | none (deferred engine) |
| `extraction` | efficient | `gpt-4.1-mini` | 2,048 | 1 | 0 | none |
| `formatting` | efficient | `gpt-4.1-mini` | 4,096 | 1 | 0 | none |

Env overrides: `PROJECT_FRONTIER_MODEL`, `PROJECT_EFFICIENT_MODEL`, `PROJECT_ROADMAP_MODEL`, `PROJECT_BRAIN_MODEL`, `PROJECT_EXECUTION_PLAN_EFFICIENT_MODEL`, etc.

---

## 8. Complexity classification rules

**Levels:** `simple`, `standard`, `complex`, `exceptional`  
**Default:** `standard` when no structural signals

**Signals (category-agnostic):**
- Explicit constraints (regex markers: deadlines, budget, legal, research)
- Goal ambiguity markers
- Clarification count
- Dependency breadth
- Context length (memory + completed + step description)
- Research requirement
- Artifact complexity (document/spreadsheet/assessment/recommendation)
- Multi-resource synthesis count
- Prior repair count

**Exceptional gate:** requires ≥2 strong signals (weight ≥2) plus high-stakes or research or weighted score ≥6

**Role-specific refinement:** roadmap and execution-plan delegate to Step 1 heuristics; extraction/formatting default to simple mechanical work

**Privacy:** logs emit signal codes/counts only — never raw goal text

---

## 9. Runtime model selection table

| Condition | Selected tier | Reasoning |
|-----------|---------------|-----------|
| Roadmap any complexity | frontier | Always strategic |
| Roadmap simple/standard | frontier + medium | Step 1 preserved |
| Roadmap complex | frontier + high | `complexity_complex` |
| Roadmap exceptional | frontier + high only with reasonCode | |
| Execution plan simple/standard | efficient (`executionPlanLegacy`) | Default cost save |
| Execution plan complex/exceptional | frontier (`experienceDesign`) | Escalation |
| Result simple mechanical | efficient | Default |
| Result complex/strategic | frontier | Escalation |
| Repair after failure | efficient (`formatting` / `decisionRepair`) | Not original expensive role |
| Extraction/formatting/evaluation | efficient | Never frontier unless `forceFrontier` |

---

## 10. Exact reuse/idempotency behavior

### Roadmap
- Hash: goal, name, description, summary, category, clarifications
- Stored: `project_workflows.brain_version` as `{PROJECT_BRAIN_VERSION}:{hash16}`
- Skip OpenAI when ready workflow + hash matches (or legacy ready without hash)
- Step 1 claim lock + in-memory lock retained

### Execution plan
- Hash: actionId, step objective, strategy, memory keys, contract version inputs
- Stored: `prepared_input._executionPlanEvidenceHash`, `_executionPlanContractVersion`
- Reuse when hash + contract version match and plan executable
- Regenerate when hash changes or plan invalid

### Result generation
- Ledger: `prepared_input._resultIdempotency` `{ actionId, idempotencyKey, evidenceHash, resultId }`
- Reuse: lookup persisted result by `resultId` when idempotencyKey or evidenceHash matches
- Frontier usage tracked in `prepared_input._modelUsageState`

### Decision (Step 1 preserved)
- `_brainDecisionEvidenceHash` reuse unchanged

**Cross-instance gap:** reuse depends on DB read/write of `prepared_input` and workflow rows; no distributed lock beyond Step 1 claim. Concurrent execute on same action may race before ledger write — documented, not migrated.

---

## 11. Repair hierarchy

1. Deterministic/local validation repair (existing assistant-value / contextual fallbacks)
2. One model repair via **`formatting`** or **`decisionRepair`** role (efficient model)
3. Frontier repair for strategic artifacts only if efficient repair fails and complexity is complex/exceptional (policy hook; not recursive)
4. Output-limit → simplified schema / deterministic fallback / typed `output_limit` (no blind same-request retry)
5. Quota/auth/invalid-request → terminal (no repair)

Max **1** repair; original role cannot repair itself by default.

---

## 12. Budget/limit behavior

**Environment settings (safe defaults):**

| Setting | Preview default | Production default |
|---------|-----------------|-------------------|
| `PROJECTS_MAX_FRONTIER_CALLS_PER_PROJECT_CREATION` | 1 | 2 |
| `PROJECTS_MAX_FRONTIER_CALLS_PER_ACTION` | 1 | 3 |
| `PROJECTS_MAX_TOTAL_MODEL_TOKENS_PER_OPERATION` | 120,000 | 120,000 |
| `PROJECTS_PREVIEW_DAILY_MODEL_BUDGET_USD` | 5 | — |
| `PROJECTS_PRODUCTION_DAILY_MODEL_BUDGET_USD` | — | 50 |

**Enforced (request-scoped):** operation token budget, frontier call limits when counters available  
**Soft-only:** daily USD budgets (structured log ready; no persistent ledger)  
**Internal codes:** `PROJECT_MODEL_OPERATION_BUDGET_EXCEEDED`, `PROJECT_FRONTIER_CALL_LIMIT_EXCEEDED`, `PROJECT_MODEL_TOKEN_LIMIT_EXCEEDED`, `PROJECT_MODEL_REUSE_HIT`, `PROJECT_MODEL_ESCALATION_REQUIRED`

---

## 13. Cost estimation behavior

- Single map in `openai-cost-estimation.js`
- `gpt-5.6-sol` → `high`, `gpt-4.1` → `medium`, `gpt-4.1-mini` → `low`
- Unknown models → heuristic band or `unknown`
- `estimatedUsd` intentionally null (replaceable metadata; not a correctness boundary)
- Logged as `estimatedCostBand` only

---

## 14. Observability fields (Step 2 additions)

- `role`, `selectedModelTier`, `complexityLevel`, `complexitySignalsCount`
- `reuseHit`, `reuseType`, `evidenceHash` (truncated)
- `maxTotalTokensPerOperation`, `operationBudgetStatus`
- `projectFrontierCallCount`, `actionFrontierCallCount`
- `repairRole`, `escalationUsed`, `estimatedCostBand`

**New warnings:** frontier for mechanical role, plan regen unchanged evidence, result duplicate miss, frontier limit exceeded, efficient→frontier repair escalation, operation token ceiling approaching

---

## 15. Preview vs production defaults

- Preview: stricter frontier caps (1/1 vs 2/3), lower daily budget default ($5 vs $50)
- `iter_environment`, `iter_operation_role`, `iter_project_id_hash`, `iter_live_test` attached to OpenAI requests via `X-Iter-Metadata`
- Live tests still require `OPENAI_LIVE_TESTS=1`; max 2 smoke projects (Step 1)

---

## 16. Tests added

`tests/projects-openai-cost-step2.test.mjs` — 29 tests covering requirements 1–30 (duplicate provider call covered by Step 1 suite)

---

## 17. Test results

| Suite | Result |
|-------|--------|
| `npm run test:projects-openai-step2` | **29/29 pass** |
| `npm run test:projects-openai-guardrails` | **26/26 pass** |
| `npm run test:projects-intent` | **386/386 pass** |
| AI Experience Phase 1 | pass (included) |
| Universal Lifecycle | pass (included) |
| Decision Layer Step 1 | pass (included) |

---

## 18. Backward compatibility

- Roadmap/execution-plan schemas unchanged
- AIExperienceContract, Universal Lifecycle, Decision Layer Step 1 preserved
- Mobile contracts unchanged
- Frontier roadmap model `gpt-5.6-sol` preserved
- Successful feature behavior unchanged; simple execution plans now use efficient model by design
- Legacy `PROJECT_MODEL_POLICY.execution` / `.executionPlan` aliases retained

---

## 19. Expected cost reduction

| Area | Impact |
|------|--------|
| Simple execution plans → `gpt-4.1-mini` | Large savings on high-volume prepare paths |
| Evidence-based plan/roadmap/result reuse | Avoids duplicate frontier calls |
| Repair via formatting role | Avoids frontier repair for JSON/schema fixes |
| Frontier call caps | Prevents runaway strategic spend per project/action |
| Step 1 + Step 2 combined | Estimated **50–80%** reduction on typical dev/preview sessions with many prepare/execute cycles |

---

## 20. Quality safeguards

- Roadmap always frontier with Step 1 medium/high reasoning rules
- Complex/exceptional paths still escalate to frontier + high reasoning
- Deterministic contextual fallbacks preserved
- No extra user input for cost saving
- Necessary context unchanged
- Tests required before broader model downgrades (eval path deferred Step 3)

---

## 21. Remaining risks

1. Cross-instance action execute race before `_resultIdempotency` write
2. Daily USD budget is observability-only without persistent ledger
3. `project_workflows.brain_version` hash encoding is compact (16 chars) — collision risk negligible but not zero
4. Intent/safety not fully migrated to runtime orchestrator (metadata-only alignment)
5. Experience in-memory idempotency cache still supplements persistent ledger

---

## 22. Technical debt

- In-memory generation lock (Step 1) retained
- No ProjectModelOrchestrator yet
- No usage DB ledger
- Complexity classifier minimal/conservative
- Daily budget soft warnings only
- Research synthesis role defined but engine deferred

---

## 23. What was not implemented

- ProjectModelOrchestrator
- Decision Graph
- Research Engine live calls
- Direct AI Experience generation changes
- Database migration / usage table
- Hard global daily budget enforcement
- Mobile changes
- Commit / push / deploy

---

## 24. Confirmation: no commit, push, or deployment

**Confirmed:** No git commit, no push, and no deployment were performed.

---

## Architecture Improvement Proposal

**Proposal (not implemented): Unified `project_model_operations` JSONB on `projects`**

| Benefit | Trade-off |
|---------|-----------|
| Durable frontier counters + daily budget across instances | Requires migration |
| Single source for reuse audit | Write contention on hot projects |

**Migration impact:** Add optional JSONB column; backfill empty `{}`; mobile unchanged.

**Awaiting approval.**

---

## Strategic Calls, Supabase Persistence, and Read-Only Reuse Verification

**Revision date:** 2026-07-14  
**Objective:** Enforce OpenAI-reasons-once → validate → Supabase-persists → mobile-reads architecture without weakening strategic quality.

### 1. Strategic call inventory

| Operation | Role | Budget scope | Max per evidence/idempotency | OpenAI when |
|-----------|------|--------------|------------------------------|-------------|
| Roadmap generation | `roadmap` | `project_creation` | 1 | First valid evidence version only |
| Action-step strategy / execution plan | `experienceDesign` (frontier until Decision Contract authoritative) | `action` | 1 | Missing/invalid `_brainDecision`, `_experience`, `_executionPlan` or evidence change |
| Result generation | `resultGeneration` | `action` | 1 per idempotency key | No persisted `project_action_results` row for key |
| Result revision | `resultRevision` | `action` | 1 per revision id | Explicit user revision with new idempotency key |
| Workflow adaptation (frontier) | `decision` | `action` | 1 per adaptation evidence | Material change + no persisted adaptation decision |
| Mechanical repair/formatting | `formatting` / `decisionRepair` | n/a | 1 bounded repair | Schema/parse repair only |

Read-only operations (`project_open`, `project_refresh`, `workflow_poll`, `action_open`, `action_resume`, `result_open`, etc.) make **zero** strategic calls.

### 2. Exact frontier call count per project lifecycle

For one unchanged objective + evidence version:

| Lifecycle phase | Frontier calls |
|-----------------|----------------|
| Project creation (roadmap) | **1** |
| Reopen/refresh/poll project (×100) | **0** |
| First action prepare (design) | **1** |
| Reopen/refresh/resume action (×100) | **0** |
| Progress save | **0** |
| First result submit | **0–1** (0 if mechanical-only formatting path; 1 for strategic result) |
| Duplicate submit/retry | **0** (reuse Supabase) |
| Step completion without material workflow change | **0** |
| Step completion with material change | **≤1** adaptation-eligible (OpenAI adaptation not yet implemented; gate only) |

Creation and action frontier budgets are **separate** (`budgetScope: project_creation` vs `action`).

### 3. Supabase persistence locations

| Artifact | Tables / fields |
|----------|-----------------|
| Project identity & brain state | `projects` — goal, brain_status, active_workflow_id, brain_version, brain_generated_at |
| Roadmap | `project_workflows`, `project_milestones`, `project_steps`; `brain_version` encodes evidence hash |
| Brain decision | `project_step_actions.prepared_input._brainDecision`, `_brainDecisionVersion`, `_brainDecisionEvidenceHash` |
| AI experience | `prepared_input._experience`, `_experienceVersion` |
| Execution plan | `prepared_input._executionPlan`, `_executionPlanEvidenceHash`, `_executionPlanContractVersion` |
| Progress | `project_step_actions.collected_input` |
| Results | `project_action_results`; ledger in `prepared_input._resultIdempotency` |
| Resources | `project_resources` (metadata; Storage deferred) |
| Memory | `project_memory` |
| Workflow events | `project_workflow_events` — includes `workflow_reconsideration_not_required` |

Persistence failure returns typed failure — generation success is **not** reported when Supabase insert/update fails (legacy no-session-column paths return in-memory plan with `persisted: false` for backward compatibility only).

### 4. Evidence-hash fields

| Hash | Material inputs |
|------|-----------------|
| Roadmap | goal, clarifications, material constraints, accepted decisions, contract/policy version; excludes title, activeTab, pollingTimestamp |
| Action design | actionId, step objective, memory versions, resource/result references, workflow version, brain decision hash, strategy |
| Result | actionId, normalized accepted input (excludes idempotencyKey from material input), plan metadata, result contract version, revision lineage |
| Workflow adaptation | completed step/result/resource ids, memory snapshot, workflow version |

### 5. Project open / refresh / polling

- `generateProjectWorkflow()` checks `shouldReuseRoadmapGeneration()` against Supabase bundle **before** OpenAI.
- Ready workflow + unchanged evidence → `{ ok: true, idempotent: true }` with zero model calls.
- Title/UI-only updates do not change roadmap hash (`isNonMaterialProjectUpdate()`).

### 6. Action open / refresh / resume

- `prepareDeterministicBrainDecision()` reuses `_brainDecision` when evidence hash matches.
- `ensureExecutionPlan()` reuses `_executionPlan` when hash valid; returns without OpenAI on read paths.
- Completed steps return `readOnly: true` with zero strategic calls.
- `saveExecutionProgress()` updates `collected_input` only — no `ensureExecutionPlan` / `generateActionResult`.

### 7. Result idempotency

- `shouldReusePersistedResult()` checks `_resultIdempotency` ledger then Supabase row via `getActionResultById()`.
- Duplicate tap/submit/retry reuses persisted result.
- Explicit revision uses new `idempotencyKey` + `revisionId` → exactly one new generation.

### 8. Workflow-adaptation gating

- New `evaluateWorkflowAdaptationGate()` runs deterministic material-change detection **before** any adaptation.
- No material change → `workflow_reconsideration_not_required`, zero model calls, deterministic skip evolution suppressed.
- Material change → at most one frontier adaptation permitted per evidence version; major changes require approval flag.
- Recorded via `project_workflow_events` through `recordWorkflowAdaptationDecision()`.
- Frontier OpenAI adaptation generator **not implemented** (gate + persistence only).

### 9. Model boundary: strategic vs mechanical

| Work | Model |
|------|-------|
| Roadmap | Frontier always |
| Action-step strategy (Decision Contract **not** authoritative) | Frontier (`experienceDesign`) |
| Execution plan when contract authoritative + simple/standard | Efficient (`executionPlanLegacy`) — future path |
| Personalized business strategy / study plan / workflow diagnostic / lesson | Frontier |
| Checklist from answers / reformat accepted plan | Efficient (requires `mechanicalTransformation` + `authoritativeSourcePersisted`) |
| Schema repair / formatting | Efficient |

`isProjectBrainDecisionContractAuthoritative()` remains **`false`** — efficient execution-plan path is disabled for live strategy.

### 10. Files / functions changed (revision)

**Created:** `strategic-result-intent.js`, `workflow-adaptation-gate.js`, `strategic-call-invariants.js`, `tests/projects-strategic-calls-supabase-persistence.test.mjs`

**Modified:** `project-model-policy.js`, `openai-project-client.js`, `openai-cost-guards.js`, `execution-plan-generator.js`, `actions/generation.js`, `actions/service.js`, `actions/action-result-generator.js`, `package.json`, Step 1/2/proactive/guardrails tests

**Key functions:** `classifyStrategicResultIntent()`, `buildResultGenerationOperationContext()`, `evaluateWorkflowAdaptationGate()`, `recordWorkflowAdaptationDecision()`, `resolveExecutionPlanStrategicRole()`, `isNonMaterialProjectUpdate()`, `describeStrategicCallInventory()`

### 11. Tests added

- `tests/projects-strategic-calls-supabase-persistence.test.mjs` — **41** scenarios (roadmap, action design, results, adaptation, lifecycle)
- Step 2 suite expanded to **31** tests (separate creation/action budgets, frontier execution-plan boundary)

### 12. Test results

| Suite | Result |
|-------|--------|
| `test:projects-openai-guardrails` | 26/26 pass |
| `test:projects-openai-step2` | 31/31 pass |
| `test:projects-strategic-calls` | 41/41 pass |
| `test:projects-intent` (full) | **429/429 pass** |

### 13. Remaining cross-instance risks

- In-memory generation locks remain supplemental; concurrent instances rely on Supabase claim + persisted reuse.
- `_modelUsageState` on `prepared_input` is per-action, not globally replicated across instances.
- Workflow adaptation OpenAI call path not implemented — gate prevents blind calls but cannot yet produce frontier adaptations.
- Daily USD budget guards are env-configured but not persisted ledger-backed.

### 14. Technical debt

- Frontier Project Brain decision generator required before `isProjectBrainDecisionContractAuthoritative()` can become `true` and unlock efficient mechanical execution-plan rendering.
- Persistent cross-instance frontier counters need project-level ledger (no migration added).
- Result intent classification uses explicit intent + conservative signals; full result-contract metadata not yet on all plans.

### 15. Deployment / commit confirmation

**No commit. No push. No deployment. No database migration.**

---

## Required YES/NO review (Strategic Revision)

### Strategic Quality Checklist

1. Is roadmap always generated with the strongest configured GPT model? **YES**
2. Is action-step strategy generated with the strongest configured GPT model? **YES** (while Decision Contract non-authoritative)
3. Does the strategic model decide the minimum necessary user input? **YES** (via existing adaptive/decision layer; frontier path preserved)
4. Are important personalized results frontier-generated? **YES**
5. Are efficient models limited to mechanical work? **YES**
6. Can a short output label incorrectly downgrade a strategic result? **NO** — intent classifier ignores label-only downgrade
7. Is no extra user work introduced to save cost? **YES**
8. Is Project Brain intelligence preserved? **YES**

### OpenAI Call Checklist

1. Is initial roadmap generated only once for unchanged evidence? **YES**
2. Does reopening a project cause zero roadmap calls? **YES**
3. Does refreshing a project cause zero roadmap calls? **YES**
4. Does workflow polling cause zero model calls? **YES**
5. Is action-step strategy generated only once for unchanged evidence? **YES**
6. Does reopening an action cause zero strategic calls? **YES** (valid persisted contracts)
7. Does progress save cause zero action-design calls? **YES**
8. Does duplicate submit reuse a persisted result? **YES**
9. Is workflow adaptation model-called only after material change? **YES** (gate; OpenAI adaptation not built)
10. Are retries and repairs bounded? **YES**

### Supabase Checklist

1. Is Supabase the source of truth for roadmap? **YES**
2. Is roadmap persisted in workflows, milestones and steps? **YES**
3. Is Supabase the source of truth for action design? **YES**
4. Are Decision, Experience and Execution Plan persisted? **YES**
5. Is Supabase the source of truth for results? **YES**
6. Are evidence hashes persisted? **YES**
7. Does a persistence failure prevent success? **YES** (except documented legacy no-session-column in-memory fallback)
8. Are in-memory locks supplemental only? **YES**
9. Are read operations generation-free? **YES**
10. Can refresh reconstruct state deterministically? **YES**

### Cost Checklist

1. Are duplicate strategic calls prevented? **YES**
2. Are structured calls still token-capped? **YES**
3. Is pathological reasoning still controlled? **YES**
4. Are quota errors non-retryable? **YES**
5. Are repair loops bounded? **YES**
6. Are live tests opt-in? **YES**
7. Are cost logs privacy-safe? **YES**
8. Is frontier preserved for strategic work? **YES**
9. Are mechanical tasks optimized? **YES**
10. Is production economics materially safer? **YES**

### Reliability Checklist

1. Are project-creation and action frontier budgets separate? **YES**
2. Can a complex first action run after roadmap generation? **YES**
3. Is persistent reuse preferred over in-memory state? **YES**
4. Are cross-instance gaps documented honestly? **YES**
5. Are result revisions versioned? **YES**
6. Is material-change detection deterministic? **YES**
7. Does unchanged evidence always reuse valid state? **YES**
8. Can invalid persisted state recover safely? **YES**
9. Do all regression suites pass? **YES** (429/429)
10. Was any deployment performed? **NO**

---

## Required YES/NO review (Original Step 2)

### Cost Control Checklist

1. Is model selection centralized? **YES**
2. Does every role have a runtime policy? **YES**
3. Is frontier restricted to strategic/complex work? **YES**
4. Is roadmap still frontier? **YES**
5. Are mechanical repairs non-frontier by default? **YES**
6. Is execution-plan reuse evidence-based? **YES**
7. Is result reuse/idempotency persistent where possible? **YES**
8. Are project/action frontier limits enforced where safe? **YES**
9. Are operation token budgets enforced? **YES**
10. Are cost estimates centralized? **YES**

### Quality Checklist

1. Is roadmap quality preserved? **YES**
2. Are important Project Brain decisions still frontier-capable? **YES**
3. Are complex outputs still frontier-capable? **YES**
4. Can simple tasks use efficient models without schema changes? **YES**
5. Are deterministic fallbacks preserved? **YES**
6. Is necessary context unchanged? **YES**
7. Is user effort unchanged or reduced? **YES**
8. Are evals/tests required before broader model downgrades? **YES**

### Reliability Checklist

1. Is complexity classification deterministic? **YES**
2. Is it category-independent? **YES**
3. Is persistent reuse preferred over in-memory reuse? **YES**
4. Are repair loops bounded? **YES**
5. Are quota/auth errors terminal? **YES**
6. Are duplicate provider calls prevented where schema permits? **YES**
7. Are cross-instance gaps documented honestly? **YES**
8. Are logs privacy-safe? **YES**
9. Are preview limits stricter? **YES**
10. Do all full regression suites pass? **YES**

### ITER Product Checklist

1. Does the implementation preserve the AI Objective Completion Engine vision? **YES**
2. Does it preserve minimum-user-effort behavior? **YES**
3. Does it preserve visible value? **YES**
4. Does it preserve adaptive planning? **YES**
5. Does it avoid exposing cost logic to users? **YES**
6. Does it avoid category-specific hardcoding? **YES**
7. Does it preserve the strongest model for important work? **YES**
8. Does it make production economics materially safer? **YES**

### Technical Debt Checklist

1. Is ProjectModelOrchestrator still deferred? **YES**
2. Is persistent usage ledger still deferred? **YES**
3. Are any in-memory limits still present? **YES**
4. Are cross-instance gaps documented? **YES**
5. Is pricing metadata replaceable? **YES**
6. Is complexity classification intentionally conservative? **YES**
7. Are temporary adapters documented? **YES**
8. Is there a clear Step 3/evals path? **YES** — eval-gated downgrades + optional orchestrator/ledger migration
