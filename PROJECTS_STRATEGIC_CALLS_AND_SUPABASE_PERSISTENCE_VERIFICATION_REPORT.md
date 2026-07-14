# PROJECTS Strategic Calls and Supabase Persistence Verification Report

**Date:** 2026-07-14  
**Scope:** Step 2 revision — strategic-call architecture, Supabase authority, read-only reuse  
**Repository:** `ftgy-main` (Projects backend)  
**Constraints honored:** No commit, no push, no deployment, no migration, no mobile changes

---

## Objective

Revise OpenAI Cost Optimization Step 2 so that:

- Frontier AI reasons once at highest useful quality for strategic work.
- Supabase persists validated artifacts and is the source of truth.
- Vercel orchestrates; mobile renders.
- OpenAI is called again only after material evidence change or explicit regeneration/revision.
- Cost is reduced through reuse and bounded calls, not weaker strategy or more user questions.

---

## Verified root risks (before correction)

| Risk | Status |
|------|--------|
| Execution plan used efficient model while still making strategic decisions | **Fixed** — `resolveRoleForExecutionPlan()` returns `experienceDesign` while `isProjectBrainDecisionContractAuthoritative()` is false |
| Roadmap frontier budget could block first action prepare | **Fixed** — separate `budgetScope: project_creation` vs `action` |
| Result model selected by mode/length instead of strategic intent | **Fixed** — `classifyStrategicResultIntent()` + `buildResultGenerationOperationContext()` |
| Workflow evolution could run without material-change gate | **Fixed** — `evaluateWorkflowAdaptationGate()` before deterministic evolution |
| Step 2 tests expected efficient execution plans | **Fixed** — tests updated; 41 strategic verification tests added |
| Persistence failure could appear as success | **Verified** — roadmap/result paths return failure; legacy no-session-column returns in-memory with `persisted: false` |

---

## Architecture after correction

```
Material change OR explicit user action
  → build evidence hash
  → compare with Supabase persisted hash
  → reuse if valid and unchanged

If regeneration required:
  → frontier model for strategic roles only
  → validate output
  → persist to Supabase
  → return success only if persistence ok

Read paths (open/refresh/poll/resume):
  → Supabase read only
  → zero OpenAI calls
```

---

## Artifacts persisted

| Artifact | Location |
|----------|----------|
| Roadmap | `project_workflows`, `project_milestones`, `project_steps` |
| Brain decision | `project_step_actions.prepared_input._brainDecision*` |
| Experience | `prepared_input._experience*` |
| Execution plan | `prepared_input._executionPlan*` |
| Progress | `collected_input` |
| Results | `project_action_results` + `_resultIdempotency` |
| Resources | `project_resources` |
| Memory | `project_memory` |
| Workflow events | `project_workflow_events` |

---

## Read-only invariants

Enforced via `strategic-call-invariants.js` and service entry points:

- Project open, refresh, list, tab navigation, workflow read/poll
- Action open/refresh/resume when valid contracts exist
- Result/resource open
- Mobile reconnect / background-foreground

Universal rule: **no read operation may generate**.

---

## Strategic vs mechanical model table

| Case | Model |
|------|-------|
| Roadmap | Frontier |
| Action-step strategy (current) | Frontier |
| Checklist from structured answers | Efficient |
| Personalized business strategy | Frontier |
| Personalized study plan | Frontier |
| Reformat accepted plan | Efficient |
| Workflow-impacting diagnostic | Frontier |
| Personalized lesson | Frontier |
| Schema repair / formatting | Efficient |

Efficient model cannot decide missing information, research need, workflow changes, or user question minimum — those remain frontier until Decision Contract is authoritative.

---

## Files created

| File |
|------|
| `lib/projects/brain/strategic-result-intent.js` |
| `lib/projects/brain/workflow-adaptation-gate.js` |
| `lib/projects/brain/strategic-call-invariants.js` |
| `tests/projects-strategic-calls-supabase-persistence.test.mjs` |
| `PROJECTS_STRATEGIC_CALLS_AND_SUPABASE_PERSISTENCE_VERIFICATION_REPORT.md` |

---

## Files modified

| File |
|------|
| `lib/projects/brain/project-model-policy.js` |
| `lib/projects/brain/openai-project-client.js` |
| `lib/projects/brain/execution/execution-plan-generator.js` |
| `lib/projects/brain/actions/generation.js` |
| `lib/projects/brain/actions/service.js` |
| `lib/projects/brain/actions/action-result-generator.js` |
| `package.json` |
| `PROJECTS_OPENAI_COST_OPTIMIZATION_STEP_2_REPORT.md` |
| `tests/projects-openai-cost-step2.test.mjs` |
| `tests/projects-openai-cost-guardrails.test.mjs` |
| `tests/projects-proactive-ai-assistant.test.mjs` |

---

## Functions created

- `classifyStrategicResultIntent()`
- `buildResultGenerationOperationContext()`
- `computeWorkflowAdaptationEvidenceHash()` / `computeWorkflowAdaptationEvidenceFingerprint()`
- `detectWorkflowMaterialChanges()`
- `evaluateWorkflowAdaptationGate()`
- `recordWorkflowAdaptationDecision()`
- `buildWorkflowAdaptationPersistencePayload()`
- `isReadOnlyProjectOperation()` / `assertReadOnlyOperation()`
- `isNonMaterialProjectUpdate()`
- `resolveExecutionPlanStrategicRole()`
- `describeStrategicCallInventory()`

---

## Functions modified

- `resolveRoleForExecutionPlan()` — frontier until authoritative contract
- `resolveProjectModelRuntimePolicy()` — result mechanicalTransformation gate
- `evaluateOperationBudget()` — separate creation/action scopes (verified)
- `callProjectStructuredJson()` — explicit `budgetScope`
- `ensureExecutionPlan()` — reuse + legacy in-memory fallback
- `prepareDeterministicBrainDecision()` — legacy in-memory fallback
- `applyProjectStepCompletion()` — adaptation gate before evolution
- `executePreparedAction()` / `generateActionResult()` — strategic result context

---

## Tests

| Suite | Count | Status |
|-------|-------|--------|
| `test:projects-strategic-calls` | 41 | Pass |
| `test:projects-openai-step2` | 31 | Pass |
| `test:projects-openai-guardrails` | 26 | Pass |
| `test:projects-intent` | 429 | Pass |

Strategic test coverage includes all required scenarios 1–41 from the revision spec (roadmap, action design, results, workflow adaptation, lifecycle/regression).

---

## Remaining risks

- Cross-instance frontier counters not globally persisted on `projects` row.
- OpenAI workflow adaptation generator not implemented — gate records eligibility only.
- `project_workflow_events` persistence for adaptation gate depends on Supabase availability (non-blocking on failure).
- File/resource Storage persistence still deferred.

---

## Technical debt

- Implement frontier Project Brain decision generator to flip `isProjectBrainDecisionContractAuthoritative()` to true.
- Add project-level `_modelUsageState` or usage ledger table for cross-instance budget enforcement (would require migration — not done).
- Wire result intent metadata from AI Experience Contract on all execution plans.

---

## What was not implemented

- Database migration
- Mobile changes
- Research Engine / Decision Graph / ProjectModelOrchestrator
- Frontier OpenAI workflow adaptation generator (gate only)
- Supabase Storage for resource files
- Commit, push, or deployment

---

## Architecture Improvement Proposal

**Proposal:** Persist project-level `_frontierUsageLedger` on `projects.brain_version` metadata or dedicated JSON column.

**Benefits:** Cross-instance enforcement of creation/action frontier budgets; auditable cost history per project.

**Trade-offs:** Requires schema migration; write contention on hot projects.

**Migration impact:** Add nullable JSON column or extend brain metadata; backfill not required.

**Status:** Not implemented — awaiting approval.

---

## Confirmation

- **Commit:** No  
- **Push:** No  
- **Deployment:** No  
- **Migration:** No  

---

## Required YES/NO review

### Strategic Quality — all YES except #6

6. Can a short output label incorrectly downgrade a strategic result? **NO**

### OpenAI Call — all YES

### Supabase — all YES (item 7 allows documented legacy in-memory fallback for pre-session-column schemas)

### Cost — all YES

### Reliability — all YES except #10

10. Was any deployment performed? **NO**
