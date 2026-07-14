# PROJECTS Project Brain Snapshot and Persistent Reuse — Step 2.1 Report

**Date:** 2026-07-14  
**Scope:** Project Brain Snapshot v1, lazy strategic generation, persistent reuse  
**Repository:** `ftgy-main` (Projects backend)  
**Builds on:** Step 1 guardrails, Step 2 model policy, Universal Lifecycle, Decision Layer Step 1, AIExperienceContract Phase 1

---

## 1. Objective

Reduce OpenAI calls without weakening strategic quality by introducing a versioned Project Brain Snapshot, enforcing lazy action-step generation, and making Supabase the authoritative store for all strategic artifacts.

Core rule: **OpenAI reasons once → backend validates → Supabase persists → mobile reads.**

---

## 2. Product principles enforced

1. Minimize user effort — lazy generation avoids premature questions for future steps  
2. Use memory/resources/results before asking — action design loads context at prepare time  
3. Strongest GPT model for strategic reasoning — unchanged from Step 2  
4. Never regenerate on reopen/refresh/navigate — snapshot + evidence-hash reuse gates  
5. Persist every validated strategic artifact — snapshot in `project_memory`; contracts in `prepared_input`  
6. Regenerate only smallest affected artifact — partial regeneration marks step blueprints `stale`  
7. Preserve visible value and adaptive behavior — workflow adaptation gate preserved  
8. Keep complexity away from user — snapshot is backend-only

---

## 3. Architecture before and after

### Before Step 2.1

- Roadmap persisted in normalized tables with evidence hash in `brain_version`
- Action design reused via `prepared_input` evidence hashes
- No project-level snapshot contract
- Workflow adaptation decisions attempted via unsupported workflow event types

### After Step 2.1

```
Roadmap generation (once per evidence)
  → persist workflow / milestones / steps
  → build Project Brain Snapshot v1 (step blueprints only — no future experiences)
  → persist snapshot to project_memory
  → return success only if all persistence succeeds

Action prepare (lazy, per step)
  → load/reconstruct snapshot
  → compute action-design evidence hash
  → reuse persisted Decision / Experience / Execution Plan when valid
  → at most one frontier call when not_generated / stale / invalid
  → update step blueprint + persist snapshot

Read paths (open / refresh / poll / list)
  → Supabase read only
  → zero OpenAI calls
```

---

## 4. Files created

| File |
|------|
| `lib/projects/brain/snapshot/constants.js` |
| `lib/projects/brain/snapshot/schema.js` |
| `lib/projects/brain/snapshot/builder.js` |
| `lib/projects/brain/snapshot/persistence.js` |
| `lib/projects/brain/snapshot/reuse.js` |
| `lib/projects/brain/snapshot/lazy-action-design.js` |
| `lib/projects/brain/snapshot/partial-regeneration.js` |
| `lib/projects/brain/snapshot/recovery.js` |
| `lib/projects/brain/snapshot/consistency.js` |
| `lib/projects/brain/snapshot/index.js` |
| `lib/projects/brain/project-brain-internal-codes.js` |
| `lib/projects/brain/brain-snapshot-observability.js` |
| `lib/projects/brain/read-only-endpoint-audit.js` |
| `tests/projects-brain-snapshot-step-2-1.test.mjs` |
| `tests/projects-brain-snapshot-persistence-integrity.test.mjs` |

---

## 5. Files modified

| File |
|------|
| `lib/projects/brain/service.js` |
| `lib/projects/brain/constants.js` |
| `lib/projects/brain/actions/service.js` |
| `lib/projects/brain/snapshot/reuse.js` (material-change priority fix) |
| `package.json` |

---

## 6. Functions created

- `validateBrainSnapshot()`, `sanitizeBrainSnapshotForClient()`
- `buildBrainSnapshotFromBundle()`, `buildStepBlueprint()`, `updateStepBlueprintAfterActionDesign()`
- `inferExpectedResultIntent()`, `inferExpectedResourceIntent()`
- `loadBrainSnapshotFromMemory()`, `persistBrainSnapshotToMemory()`, `reconstructBrainSnapshot()`
- `persistWorkflowAdaptationDecisionToMemory()`, `loadWorkflowAdaptationDecisionFromMemory()`
- `evaluateRoadmapMaterialChange()`, `shouldRegenerateRoadmap()`
- `shouldGenerateActionDesign()`, `resolveActionDesignStatusFromPreparedInput()`, `assertLazyActionDesignInvariant()`
- `identifyAffectedSteps()`, `markAffectedStepDesignsStale()`, `evaluatePartialRegenerationScope()`
- `ensureBrainSnapshotForReadyWorkflow()`, `isSnapshotRecoveryEligible()`, `isSnapshotOnlyPersistenceFailure()`
- `validateSnapshotAgainstWorkflowBundle()`, `repairSnapshotBlueprintsFromBundle()`
- `logBrainSnapshotEvent()`
- `auditReadOnlyProjectsEndpoints()`, `assertReadOnlyEndpointSafe()`

---

## 7. Functions modified

- `generateProjectWorkflow()` — snapshot build + persist after workflow persist; snapshot-only failure recovery; idempotent reuse when project already ready
- `prepareProjectAction()` — lazy action-design gate; snapshot blueprint update after design persist
- `applyProjectStepCompletion()` — adaptation decisions in memory; partial regeneration stale marking

---

## 8. Project Brain Snapshot schema

Version: **1** (`PROJECT_BRAIN_SNAPSHOT_VERSION`)

Persisted fields (see `buildBrainSnapshotFromBundle()`):

- `snapshotId`, `snapshotVersion`, `projectId`
- `roadmapVersion`, `roadmapEvidenceHash`
- `objective` — goal, summary, materialConstraints, clarifications
- `strategy` — projectApproach, successDefinition, minimumUserEffortPrinciple, adaptationPolicyVersion
- `workflow` — workflowId, milestoneIds, stepIds, recommendedNextStepId
- `stepBlueprints[]` — stepId, purpose, expectedValue, expectedResultIntent, expectedResourceIntent, dependencyStepIds, adaptationCheckpoint, **actionDesignStatus**, **actionDesignEvidenceHash**
- `modelMetadata` — modelRole, modelPolicyVersion, promptVersion
- `createdAt`, `updatedAt`

Does **not** contain: future AIExperienceContracts, execution plans, chain-of-thought, full roadmap duplication.

---

## 9. Persistence locations

| Artifact | Location |
|----------|----------|
| Snapshot payload | `project_memory.memory_key = brain_snapshot_v1` (JSON text) |
| Snapshot evidence hash | `project_memory.memory_key = brain_snapshot_v1_evidence_hash` |
| Workflow adaptation gate | `project_memory.memory_key = brain_workflow_adaptation_latest` |
| Normalized roadmap | `project_workflows`, `project_milestones`, `project_steps` (source of truth) |
| Action design | `project_step_actions.prepared_input` (`_brainDecision*`, `_experience*`, `_executionPlan*`) |
| Results | `project_action_results` + `_resultIdempotency` |
| Progress | `collected_input` |

**No migration required.** Snapshot uses existing `project_memory` text storage.

---

## 10. Roadmap generation / reuse flow

1. Load existing workflow bundle  
2. `evaluateRoadmapMaterialChange()` — compares snapshot/workflow evidence hash; title-only changes excluded  
3. If valid + unchanged → `{ ok: true, idempotent: true }`, zero OpenAI calls  
4. If material change or missing workflow → one frontier roadmap call  
5. `persistGeneratedWorkflow()`  
6. `buildBrainSnapshotFromBundle()` — all step blueprints `not_generated`  
7. `persistBrainSnapshotToMemory()` — **required for success**  
8. If snapshot persist fails → `brain_status: failed`, no success returned

---

## 11. Lazy action-design flow

1. User opens/prepares a specific step  
2. `reconstructBrainSnapshot()` — from memory or deterministic reconstruction (legacy safe)  
3. `shouldGenerateActionDesign()` — checks blueprint status + persisted contracts + evidence hash  
4. If reuse hit → skip `ensureExecutionPlan()` OpenAI path; use persisted plan  
5. If `not_generated` / `stale` / `invalid` → `ensureExecutionPlan()` (frontier while Decision Contract non-authoritative)  
6. Update step blueprint to `generated` + persist snapshot  
7. Progress save → `collected_input` only, zero action-design calls

Roadmap generation asserts `assertLazyActionDesignInvariant()` — zero action designs during roadmap.

---

## 12. Strategic versus mechanical boundary

Unchanged from Step 2:

- Roadmap, action-step strategy, personalized results → **frontier**
- Checklist/reformat with `mechanicalTransformation + authoritativeSourcePersisted` → **efficient**
- `isProjectBrainDecisionContractAuthoritative()` remains **false** — execution plan stays frontier for strategy

---

## 13. Result idempotency flow

Unchanged from Step 2 (preserved):

- `_resultIdempotency` ledger + `project_action_results` row lookup  
- Duplicate submit / retry checks persisted result first  
- Explicit revision uses new idempotency key + revision lineage  
- Persistence failure prevents success

---

## 14. Workflow adaptation and partial regeneration

- `evaluateWorkflowAdaptationGate()` — deterministic material-change detection before any adaptation  
- No material change → `workflow_reconsideration_not_required`, zero model calls  
- Adaptation decisions persisted to **`project_memory`** (avoids unsupported workflow event types)  
- `evaluatePartialRegenerationScope()` — identifies affected vs preserved steps  
- `markAffectedStepDesignsStale()` — localized invalidation; unaffected steps keep `generated` status  
- Full roadmap regeneration only when partial scope not possible — requires user approval flag  
- Frontier OpenAI adaptation generator **not implemented** (gate + stale marking only)

---

## 15. Read-only endpoint audit

| Endpoint | Classification | Strategic imports |
|----------|----------------|-------------------|
| `projects-list.js` | read_only | None |
| `projects-get.js` | read_only | None |
| `projects-workflow.js` | read_only | None |
| `projects-resources.js` | read_only | None |
| `projects-action-results.js` | read_only | None |
| `projects-prepare-action.js` | conditional_read | Delegates to service reuse gate |

`auditReadOnlyProjectsEndpoints()` + `assertReadOnlyEndpointSafe()` in `read-only-endpoint-audit.js`  
Tests verify list/get/workflow pass audit.

---

## 16. Evidence-hash definitions

| Hash | Inputs |
|------|--------|
| Roadmap | goal, clarifications, material constraints, accepted decisions, contract/policy version |
| Snapshot | Same as roadmap (`roadmapEvidenceHash` field) |
| Action design | actionId, step objective, memory, resources, results, workflow version, brain decision hash |
| Result | accepted input (material), plan metadata, idempotency/revision lineage |
| Workflow adaptation | completed step/result/resource ids, memory snapshot, workflow version |

---

## 17. Failure-safety behavior

| Code | Meaning |
|------|---------|
| `PROJECT_BRAIN_SNAPSHOT_PERSIST_FAILED` | Snapshot validation/persist failed — roadmap not marked ready |
| `PROJECT_BRAIN_SNAPSHOT_INVALID` | Snapshot failed schema validation |
| `PROJECT_STRATEGIC_ARTIFACT_REUSE_HIT` | Valid persisted artifact reused |
| `PROJECT_STRATEGIC_ARTIFACT_STALE` | Evidence changed; regeneration permitted |
| `PROJECT_STRATEGIC_ARTIFACT_PERSIST_FAILED` | Action/result persist failed |
| `PROJECT_PARTIAL_REGENERATION_REQUIRED` | Full roadmap regen needed |
| `PROJECT_MATERIAL_CHANGE_NOT_REQUIRED` | Deterministic gate — no model call |

Generation success requires: model OK → validation OK → Supabase persist OK.

---

## 18. Observability fields

`logBrainSnapshotEvent()` logs: projectId, workflowId, stepId, actionId, artifactType, artifactVersion, evidenceHash (truncated), reuseHit, reuseReason, generationTriggered, materialChangeDetected, affectedStepCount, persistenceSucceeded, modelRole, modelTier, providerCallCount.

Warnings: strategic generation on read operation, unchanged-evidence regeneration, artifact missing after model success, full roadmap when localized sufficient, duplicate result attempt.

Never logs: user answers, raw goals, prompts, chain-of-thought, memory contents, document contents, tokens.

---

## 19. Backward compatibility

- Legacy projects without snapshot → `reconstructBrainSnapshot()` builds from normalized rows; **no automatic OpenAI backfill**  
- Legacy `prepared_input` contracts continue to work  
- Legacy no-session-column schemas retain in-memory fallback (`persisted: false`)  
- Mobile contracts unchanged  
- Normalized roadmap tables unchanged

---

## 20. Tests added

`tests/projects-brain-snapshot-step-2-1.test.mjs` — **55 tests** covering all 51 required scenarios plus snapshot validation helpers.

---

## 21. Test results

| Suite | Result |
|-------|--------|
| `test:projects-brain-snapshot-step-2-1` | 55/55 pass |
| `test:projects-brain-snapshot-integrity` | 13/13 pass |
| `test:projects-openai-guardrails` | 26/26 pass |
| `test:projects-openai-step2` | 31/31 pass |
| `test:projects-strategic-calls` | 41/41 pass |
| `test:projects-intent` (full) | **511/511 pass** |

---

## 22. Expected reduction in model calls

| Scenario | Before | After |
|----------|--------|-------|
| Project reopen ×100 | 0 (Step 2) | 0 + snapshot reuse confirmation |
| Roadmap creation | 1 | 1 (unchanged) |
| Future step prepare (never opened) | 0 | 0 (lazy — no premature generation) |
| Action prepare (valid contracts) | 0–1 | 0 (explicit reuse skip) |
| Step completion (no material change) | 0 | 0 (adaptation gate) |
| Title-only project update | 0 | 0 (material-change gate) |

Primary new savings: **eliminates any accidental action-design path during roadmap** and **skips ensureExecutionPlan entirely when reuse gate hits**.

---

## 23. Quality safeguards

- Frontier model policy unchanged  
- Decision Contract authority gate unchanged (`false`)  
- Snapshot validates before persist  
- Roadmap success blocked on snapshot persist failure  
- Lazy invariant asserted post-roadmap model call  
- Read-only endpoint audit tests

---

## 24. Remaining cross-instance risks

- In-memory generation locks supplemental only  
- `_modelUsageState` per-action, not global  
- Snapshot in `project_memory` subject to same cross-instance eventual consistency as other memory facts  
- Concurrent roadmap retry relies on Supabase claim + workflow_already_exists idempotency

---

## 25. Technical debt

- Frontier workflow adaptation OpenAI generator not built  
- Persistent cross-instance frontier usage ledger deferred (would need migration)  
- `project_workflows.metadata` JSONB would be cleaner snapshot anchor — deferred pending migration approval  
- Step blueprint intent inference is deterministic heuristic; future roadmap schema could emit intents explicitly  
- Partial regeneration marks stale but does not auto-regenerate affected steps until user opens them

---

## 26. What was not implemented

- Database migration  
- Mobile changes  
- Research Engine / Decision Graph / Storage / Knowledge Base / ProjectModelOrchestrator  
- Frontier OpenAI workflow adaptation generator  
- Auto-backfill snapshot for legacy projects via OpenAI  
- Commit, push, deployment

---

## Architecture Improvement Proposal

**Proposal:** Add nullable `metadata jsonb` column to `project_workflows` for snapshot anchor + adaptation state.

**Benefits:** Co-locate snapshot with workflow row; simpler reads; avoids overloading `project_memory`.

**Trade-offs:** Requires migration; JSONB versioning discipline.

**Migration impact:** Single nullable column; backfill from `project_memory` keys optional.

**Status:** Not implemented — awaiting approval.

---

## 27. Confirmation

- **Commit:** No  
- **Push:** No  
- **Deployment:** No  
- **Migration:** No  

---

## Required YES/NO review

### Strategic Quality Checklist

1. YES — roadmap frontier unchanged  
2. YES — action-step strategy frontier while Decision Contract non-authoritative  
3. YES — adaptive/decision layer preserved  
4. YES — personalized results frontier  
5. YES — efficient models mechanical only  
6. YES — no strategic quality reduction  
7. YES — no extra user effort  
8. YES — Objective Completion Engine philosophy preserved  

### Call Reduction Checklist

1. YES  
2. YES  
3. YES  
4. YES  
5. YES — step blueprints `not_generated` at roadmap; no future experiences  
6. YES  
7. YES — valid persisted contracts skip ensureExecutionPlan  
8. YES  
9. YES — Step 2 result idempotency preserved  
10. YES — adaptation gate before model call  

### Supabase Checklist

1. YES  
2. YES  
3. YES — snapshot in project_memory + reconstructable from normalized rows  
4. YES  
5. YES  
6. YES  
7. YES  
8. YES — snapshot persist failure blocks roadmap success  
9. YES  
10. YES — state reconstructable after Vercel restart  

### Read-Only Checklist

1. YES  
2. YES  
3. YES  
4. YES  
5. YES — prepare reuses when gate hits  
6. YES  
7. YES  
8. YES  
9. NO — prepare-action can still invoke generation when contracts missing (by design, not on pure refresh)  
10. YES — audit tests included  

### Reliability Checklist

1. YES  
2. YES  
3. YES  
4. YES  
5. YES  
6. YES — partial stale marking preserves unaffected steps  
7. YES  
8. YES  
9. YES — 511/511  
10. NO — no deployment  

---

## 28. Final Persistence Integrity Verification

**Date:** 2026-07-15  
**Scope:** Partial persistence recovery, snapshot/workflow consistency, prepare-action generation boundary

### 28.1 Exact recovery behavior

When workflow, milestones, and steps persist successfully but snapshot persistence fails:

| Artifact | State after snapshot failure |
|----------|------------------------------|
| `project_workflows` | `status: ready` (unchanged) |
| `project_milestones` | persisted rows (unchanged) |
| `project_steps` | persisted rows (unchanged) |
| `projects.brain_status` | `failed` |
| `projects.brain_failure_code` | `snapshot_persistence_error` |
| `project_memory` brain snapshot keys | absent or stale |

**Retry path (zero OpenAI):**

1. `generateProjectWorkflow()` detects `hasReadyWorkflowBundle(existingBundle)` OR `isSnapshotOnlyPersistenceFailure(project, bundle)` on `forceRetry`.
2. Calls `ensureBrainSnapshotForReadyWorkflow()` — loads/validates snapshot via `validateSnapshotAgainstWorkflowBundle()`, or reconstructs from normalized rows via `buildBrainSnapshotFromBundle()` + `repairSnapshotBlueprintsFromBundle()`.
3. Persists snapshot to `project_memory`; sets `brain_status: ready`, clears `brain_failure_code`.
4. Returns `{ ok: true, idempotent: true, snapshotRecovered: true }` with zero workflow/milestone/step POSTs.

**Idempotent read path (project already `ready`):**

- If snapshot ensure fails transiently, normalized roadmap remains authoritative; returns `{ ok: true, idempotent: true, snapshotPersistPending: true }` without OpenAI.
- Only blocks when `isSnapshotOnlyPersistenceFailure()` — i.e. project is `failed` with `snapshot_persistence_error` and recovery itself fails.

**Invalid/incomplete roadmap:**

- `isSnapshotRecoveryEligible()` returns false when milestones or steps are empty.
- Recovery returns `{ ok: false, reason: "incomplete_normalized_roadmap" }` — controlled full regeneration remains permitted via `forceRetry` + `clearFailedWorkflowArtifacts()`.

### 28.2 Source-of-truth definition

| Layer | Role |
|-------|------|
| `project_workflows`, `project_milestones`, `project_steps` | **Authoritative roadmap** — titles, descriptions, ordering, status |
| `project_memory.brain_snapshot_v1` | Strategic metadata + step blueprint references only |
| `project_step_actions.prepared_input` | Authoritative action design contracts |
| Snapshot | Cannot overwrite normalized roadmap content; reconstruction reads normalized rows |

### 28.3 Consistency validation

`validateSnapshotAgainstWorkflowBundle()` validates:

- `projectId`
- `workflowId`
- milestone IDs (set equality)
- step IDs (set equality)
- `roadmapEvidenceHash`
- `snapshotVersion`
- referenced recommended step exists in bundle
- no duplicate blueprint IDs
- every step has a blueprint; no orphan blueprints

Stale/missing snapshots trigger deterministic reconstruction without OpenAI. Mismatched IDs or evidence hash mark snapshot invalid → repair via `repairSnapshotBlueprintsFromBundle()`.

### 28.4 Prepare-action generation boundary

| Scenario | Model calls |
|----------|-------------|
| First prepare without persisted contracts | May generate (one controlled call) |
| Refresh/reopen with valid contracts | Zero |
| Missing snapshot + valid action contracts | Zero (`shouldGenerateActionDesign` reuse hit) |
| Changed material action evidence hash | One controlled call |
| Concurrent prepare | Per-action evidence hash + Supabase upsert; no independent duplicate contracts where schema permits prevention |

### 28.5 Files / functions changed (integrity pass)

| File | Change |
|------|--------|
| `lib/projects/brain/snapshot/recovery.js` | **New** — `ensureBrainSnapshotForReadyWorkflow()`, eligibility helpers |
| `lib/projects/brain/snapshot/consistency.js` | **New** — `validateSnapshotAgainstWorkflowBundle()`, `repairSnapshotBlueprintsFromBundle()` |
| `lib/projects/brain/constants.js` | Added `SNAPSHOT_PERSISTENCE_ERROR` |
| `lib/projects/brain/service.js` | Snapshot recovery on idempotent/forceRetry paths; snapshot-only failure gate |
| `lib/projects/brain/snapshot/index.js` | Export recovery + consistency |
| `tests/projects-brain-snapshot-persistence-integrity.test.mjs` | **New** — 13 integrity tests |
| `package.json` | Added `test:projects-brain-snapshot-integrity`; included in `test:projects-intent` |

### 28.6 Tests and results

| # | Test | Result |
|---|------|--------|
| 1 | Snapshot failure after normalized roadmap persistence | Pass |
| 2 | Retry snapshot-only recovery, zero OpenAI | Pass |
| 3 | No duplicate workflow/milestone/step rows | Pass |
| 4 | Snapshot/workflow consistency validation | Pass |
| 5 | Stale snapshot reconstructed without OpenAI | Pass |
| 6 | Missing snapshot reconstructed without OpenAI | Pass |
| 7 | Valid action contracts reused without snapshot | Pass |
| 8 | Reopening action, zero model calls | Pass |
| 9 | Changed material action evidence permits one call | Pass |
| 10 | Full Projects backend suite | **511/511 pass** |

### 28.7 Remaining transactional risk

- Workflow persist + snapshot persist are **not a single Supabase transaction** — partial state (ready roadmap + failed brain) is possible by design; recovery path closes the gap deterministically.
- `project_memory` upsert and `projects` PATCH are separate writes — transient failure between them can leave snapshot persisted but `brain_status` still `failed` until next recovery attempt.
- Cross-instance concurrent `forceRetry` relies on generation claim + idempotent early return; duplicate workflow rows prevented by existing `workflow_already_exists` guard, not a new mechanism.
- `forceRetry` attempts snapshot recovery when `isSnapshotRecoveryEligible()` even if failure code is not snapshot-specific — safe when bundle is complete; edge case if unrelated failure left a ready bundle.

### 28.8 Final YES/NO checklist

1. **Can snapshot persistence fail after roadmap persistence?** — **YES** (by design; separate writes)
2. **If yes, can retry recover without OpenAI?** — **YES** (`ensureBrainSnapshotForReadyWorkflow`)
3. **Can retry create duplicate roadmap rows?** — **NO** (early return + zero POST counters verified)
4. **Are normalized roadmap tables authoritative?** — **YES**
5. **Is snapshot metadata reconstructable?** — **YES** (from normalized rows + evidence hash)
6. **Can stale snapshot force unnecessary roadmap regeneration?** — **NO** (consistency check → reconstruct)
7. **Can valid action contracts be reused without a snapshot?** — **YES**
8. **Does reopening a valid action make zero model calls?** — **YES**
9. **Did all regression suites pass?** — **YES** (511/511)
10. **Was any deployment performed?** — **NO**

---

## 29. Live Preview Snapshot Persistence Failure — Root Cause and Fix

**Date:** 2026-07-15  
**Affected project:** `c1daf2f8-4576-4dfb-9213-8b88e637fe19`  
**Internal error:** `PROJECT_BRAIN_SNAPSHOT_PERSIST_FAILED`

### 29.1 Verified live sequence

1. One frontier roadmap OpenAI call succeeded (`gpt-5.6-sol`, medium reasoning, 5212 total tokens).
2. Roadmap validation succeeded — 5 milestones, 20 steps.
3. `project_workflows`, `project_milestones`, `project_steps` persisted successfully.
4. `persistBrainSnapshotToMemory()` failed at `upsertProjectMemoryFacts()`.
5. Endpoint returned HTTP 502 / `PROJECT_BRAIN_GENERATION_FAILED`.
6. `brain_status` set to `failed`, `brain_failure_code: snapshot_persistence_error`.
7. Repeated `/api/projects-workflow` reads succeeded (read-only, zero OpenAI).

### 29.2 Exact root cause

**`project_memory.source` CHECK constraint violation.**

Migration `20260715_project_adaptive_brain.sql` defines:

```sql
source text not null default 'session'
  check (source in ('session', 'resource', 'upload', 'workflow', 'system'))
```

Step 2.1 snapshot persistence wrote `source: "brain_snapshot"` — **not in the allowed set**. Supabase rejected the upsert with HTTP 400 / PostgreSQL code `23514` (check constraint violation). The repository swallowed the error and returned generic `PROJECT_BRAIN_SNAPSHOT_PERSIST_FAILED` with no Supabase metadata in logs.

Workflow adaptation persistence had the same class of bug (`source: "workflow_adaptation"`).

### 29.3 Actual project_memory schema contract

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | uuid | auto | PK |
| `project_id` | uuid | yes | FK → projects |
| `user_id` | uuid | yes | owner |
| `memory_key` | text | yes | unique per (project_id, user_id, memory_key) |
| `memory_value` | text | yes | JSON snapshot stored as string |
| `source` | text | yes | **only** session/resource/upload/workflow/system |
| `confidence` | numeric(4,3) | yes | default 1.000 |
| `created_at`, `updated_at` | timestamptz | auto | |

Upsert: `POST /rest/v1/project_memory?on_conflict=project_id,user_id,memory_key` with `Prefer: resolution=merge-duplicates,return=representation`.

Snapshot keys: `brain_snapshot_v1`, `brain_snapshot_v1_evidence_hash`.

### 29.4 Why existing tests did not catch it

- Unit mocks returned HTTP 201 with `[{ memory_key: "brain_snapshot_v1" }]` without enforcing the `source` CHECK constraint.
- No test asserted the posted `source` value against the migration schema.
- Repository did not surface Supabase error codes, masking the constraint failure category.

### 29.5 Files / functions changed

| File | Change |
|------|--------|
| `lib/projects/brain/memory/constants.js` | `PROJECT_MEMORY_ARTIFACT_SOURCES`, `resolveProjectMemorySource()` |
| `lib/projects/brain/memory/error-utils.js` | **New** — Supabase error extraction + categorization |
| `lib/projects/brain/memory/repository.js` | Source validation, sanitized error logging, structured failure returns |
| `lib/projects/brain/snapshot/serialization.js` | **New** — validate + JSON.stringify once + byte length |
| `lib/projects/brain/snapshot/persistence.js` | Use `source: system`, read-back verification, typed errors |
| `lib/projects/brain/brain-snapshot-observability.js` | `logBrainSnapshotPersistenceFailure()` |
| `lib/projects/brain/project-brain-internal-codes.js` | Granular internal codes + error categories |
| `scripts/inspect-project-brain-snapshot-state.mjs` | **New** — read-only live inspection |
| `tests/projects-brain-snapshot-memory-persistence-fix.test.mjs` | **New** — 14 regression tests |

### 29.6 Persistence payload shape (no private values)

```json
[
  {
    "project_id": "<uuid>",
    "user_id": "<uuid>",
    "memory_key": "brain_snapshot_v1",
    "memory_value": "<JSON string, ~8–15 KB for 20 steps>",
    "source": "system",
    "confidence": 1,
    "updated_at": "<ISO8601>"
  },
  {
    "project_id": "<uuid>",
    "user_id": "<uuid>",
    "memory_key": "brain_snapshot_v1_evidence_hash",
    "memory_value": "<roadmap evidence hash>",
    "source": "system",
    "confidence": 1,
    "updated_at": "<ISO8601>"
  }
]
```

### 29.7 Error handling improvement

New event: `project_brain_snapshot_persistence_failure` logs:

- operation, projectId, memoryKey
- httpStatus, supabaseErrorCode, sanitized supabaseErrorMessage
- errorCategory (`snapshot_validation_failed`, `snapshot_serialization_failed`, `snapshot_write_failed`, `snapshot_readback_failed`, `snapshot_schema_incompatible`, `snapshot_conflict_failed`)
- payloadByteLength, serializationSucceeded, writeAttempted, writeMayHaveSucceeded, readBackFailed, resolvedSource

Internal codes now distinguish write / readback / schema / conflict / serialization failures.

### 29.8 Recovery behavior for affected project

On next generation retry (or explicit recovery):

1. Load existing workflow (5 milestones, 20 steps) — **zero OpenAI**.
2. `ensureBrainSnapshotForReadyWorkflow()` reconstructs snapshot from normalized rows.
3. Persist with `source: system` + read-back validation.
4. Set `brain_status: ready`, clear `snapshot_persistence_error`.
5. No duplicate workflow/milestone/step rows.

Inspection: `node scripts/inspect-project-brain-snapshot-state.mjs c1daf2f8-4576-4dfb-9213-8b88e637fe19` (or SQL in script output).

### 29.9 Tests and results

| Suite | Result |
|-------|--------|
| `test:projects-brain-snapshot-memory-fix` | 14/14 pass |
| `test:projects-brain-snapshot-integrity` | 13/13 pass |
| `test:projects-intent` (full) | **511/511 pass** |

### 29.10 Polling observation (mobile, report-only)

From `useProjectWorkflow.ts`:

- **Interval:** `POLL_INTERVAL_MS = 2000` (2 seconds).
- **Endpoint:** `GET /api/projects-workflow` (read-only, zero OpenAI).
- **Stops on terminal status:** `ready` or `failed` (`isTerminalGenerationStatus`).
- **Stops on unmount / projectId change:** clears poll timer and orchestration ref.
- **Duplicate poll prevention:** `pollActive` guard + single `pollTimerRef`.

Live Vercel logs showing many successful workflow reads during generation failure are **expected** — mobile polls while `brain_status` is non-terminal; polling does not trigger regeneration or OpenAI.

### 29.11 Migration required?

**NO** for this fix. The existing schema supports snapshot persistence when `source` uses an allowed value (`system`).

Optional future migration (not implemented): extend CHECK to include `brain_snapshot` as explicit source label for observability.

### 29.12 Investigation confirmations

- **OpenAI called during investigation:** NO
- **Commit:** NO
- **Push:** NO
- **Deployment:** NO
- **Live data modified:** NO

### 29.13 Live Preview YES/NO

1. **Did the original roadmap OpenAI call succeed?** — **YES**
2. **Were workflow, milestones and steps persisted?** — **YES**
3. **Was snapshot persistence the only failed stage?** — **YES**
4. **Is the exact Supabase error now visible safely?** — **YES** (sanitized metadata in logs)
5. **Does the implementation use the real project_memory contract?** — **YES**
6. **Can the affected project recover with zero OpenAI calls?** — **YES**
7. **Can recovery create duplicate roadmap rows?** — **NO**
8. **Does snapshot success require read-back validation?** — **YES**
9. **Is a database migration required?** — **NO**
10. **Did all tests pass?** — **YES** (511/511)
11. **Was any OpenAI call made during this investigation?** — **NO**
12. **Was any deployment performed?** — **NO**

### Technical Debt Checklist

1. YES — durable distributed lease still needed  
2. YES — persistent usage ledger deferred  
3. YES — in-memory locks still present  
4. YES — partial regeneration limited without workflow metadata column  
5. YES — reconstruction documented  
6. YES — Storage deferred  
7. YES — Knowledge Base deferred  
8. YES — migration plan in Architecture Improvement Proposal  
