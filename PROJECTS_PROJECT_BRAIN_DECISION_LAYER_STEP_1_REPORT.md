# Project Brain Decision Layer — Step 1 Report

**Date:** 2026-07-14  
**Repository:** `/Users/grigorestefanica/Downloads/ftgy-main`  
**Scope:** Decision Contract + Deterministic Adapter only

## 1. Objective

Step 1 introduces a strict, versioned, backend-authoritative `ProjectBrainDecisionContract` before execution-plan and experience generation. The contract observes and adapts current decision behavior without changing model prompts, execution modes, AIExperienceContract rendering, Universal Lifecycle behavior, or mobile UI.

Pipeline implemented:

```text
project + step
→ existing adaptive context
→ ordered safe evidence retrieval
→ deterministic decision adapter
→ contract validation
→ prepared_input persistence
→ safe prepare metadata
→ existing execution plan / experience / lifecycle
```

## 2. Architecture implemented

- One feature flag: `PROJECT_BRAIN_DECISION_LAYER_ENABLED`
- Contract schema v1 and deterministic validator
- Ordered evidence collection from project identity, memory, resources, accepted results, workflow, and research signals
- Knowledge slot explicitly recorded as unavailable
- Deterministic mapping from legacy adaptive evidence to ten category-independent decision types
- Four evidence-derived confidence bands
- Minimum User Effort policy evaluator with persisted violation codes
- Privacy-safe evidence hash and structured diagnostics
- Stable decision reuse when the evidence hash is unchanged
- Safe regeneration when persisted contract data is invalid or relevant evidence versions change
- Private contract fields stripped from client-facing `action.preparedInput` and `preparation.preparedInput`

## 3. Files created

- `lib/projects/brain/decision/contract-schema.js`
- `lib/projects/brain/decision/contract-validator.js`
- `lib/projects/brain/decision/deterministic-decision-adapter.js`
- `lib/projects/brain/decision/context-retrieval.js`
- `lib/projects/brain/decision/minimum-user-effort-policy.js`
- `lib/projects/brain/decision/decision-observability.js`
- `lib/projects/brain/decision/index.js`
- `tests/projects-brain-decision-contract.test.mjs`
- `tests/projects-brain-decision-adapter.test.mjs`
- `tests/projects-brain-decision-policy.test.mjs`
- `tests/projects-brain-decision-refresh.test.mjs`
- `PROJECTS_PROJECT_BRAIN_DECISION_LAYER_STEP_1_REPORT.md`

## 4. Files modified

- `lib/projects/brain/actions/service.js`
- `lib/projects/brain/actions/repository.js`
- `lib/projects/brain/execution/interactive.js`
- `lib/projects/brain/execution/decision.js`
- `lib/projects/brain/memory/service.js`
- `tests/projects-prepare-action-compat.test.mjs`
- `package.json`

No model prompt or mobile file was modified.

## 5. Functions created

- `buildProjectBrainDecisionJsonSchema`
- `validateProjectBrainDecisionContract`
- `retrieveProjectBrainDecisionContext`
- `hashProjectBrainDecisionEvidence`
- `createDeterministicProjectBrainDecision`
- `evaluateMinimumUserEffortPolicy`
- `applyMinimumUserEffortPolicy`
- `serializeProjectBrainDecisionDiagnostics`
- `logProjectBrainDecision`
- `isProjectBrainDecisionLayerEnabled`
- `buildOrReuseProjectBrainDecision`
- `withProjectBrainDecision`
- `serializeSafeProjectBrainDecision`
- `prepareDeterministicBrainDecision`

## 6. Functions modified

- `prepareProjectAction` — runs the flagged decision pipeline before plan generation
- `buildAdaptiveContext` — preserves memory evidence versions
- `buildResultsMap` — retains accepted result rows for decision evidence without changing existing map behavior
- `enrichResponseWithInteractiveState` — attaches safe metadata only when present
- `serializeActionRow` — removes private decision persistence keys from API output
- `getProjectMemoryMap` — returns key-to-version metadata in addition to the existing map
- `createLegacySchemaFetch` test helper — captures action persistence for integration assertions

Legacy `decideExecutionStrategy` remains unchanged except for a deprecation-direction comment.

## 7. Contract schema implemented

Required top-level fields:

```text
decisionId, decisionVersion, projectId, stepId, actionId, objective,
decisionType, reasoningSummary, confidence, knownContext,
missingInformation, userEffort, nextAction, resultIntent,
workflowImpact, safety, modelMetadata, policyCompliance,
createdAt, expiresAt
```

Supported decision types:

```text
reuse_existing_resource
reuse_existing_result
generate_directly
research_then_generate
collect_minimal_context
request_external_user_action
verify_completion
propose_workflow_change
pause_or_defer
unsupported_or_blocked
```

Validation includes:

- contract version and supported enums
- all required nested confidence, effort, action, result, workflow, safety, model, and policy fields
- evidence requirements for reuse decisions
- one-to-three `mustAskUser` items for minimal context collection
- material impact for every asked item
- sufficient context for direct generation
- research signal for research decisions
- explanation for context-only decisions
- visible value and generated-result requirements for value-producing decisions

## 8. Deterministic mapping table

| Evidence | Decision type |
|---|---|
| blocked, unsupported, or authorization-required structural signal | `unsupported_or_blocked` |
| defer state | `pause_or_defer` |
| workflow redundancy signal | `propose_workflow_change` |
| reusable project resource | `reuse_existing_resource` |
| accepted same-step or semantically matching result | `reuse_existing_result` |
| explicit external-action signal | `request_external_user_action` |
| explicit verification-only signal | `verify_completion` |
| legacy freshness/research requirement | `research_then_generate` |
| material missing information | `collect_minimal_context` |
| otherwise, sufficient context | `generate_directly` |

External action, verification, defer, workflow-proposal, and blocked mappings are fully supported by the adapter, but current prepare inputs do not yet supply all of these structural signals. Their live activation is deferred rather than inferred from goal-specific keywords.

## 9. Evidence retrieval order

1. Project identity and goal
2. Accepted prior decision slot (current Step 1 loader does not yet query cross-step decisions)
3. Project memory keys and versions
4. Knowledge placeholder (`knowledgeAvailable: false`)
5. Reusable resource metadata
6. Accepted previous result IDs, status, versions, titles/previews for generic semantic comparison
7. Workflow and current step identifiers/versions
8. Existing research requirement and availability
9. Remaining material missing fields

Raw memory values, resource contents, files, full documents, prompts, and result contents are not placed in the evidence hash, response metadata, or logs.

## 10. Confidence rules

Rules are exported as `DETERMINISTIC_CONFIDENCE_RULES`.

- `objectiveUnderstanding`
  - high: project goal and step objective exist
  - medium: one exists
  - low: neither exists
- `contextSufficiency`
  - high: reuse evidence or no missing material facts
  - medium: one-to-three missing facts
  - low: more than three
- `resultReadiness`
  - high: reusable visible value
  - medium: direct generation is ready
  - low: user input or unavailable research remains
- `workflowStability`
  - high: workflow evidence exists and no redundancy is detected
  - medium: workflow evidence unavailable
  - low: redundancy is detected

No numerical scores are generated in Step 1.

## 11. Policy-compliance rules

Persisted violation codes:

- `MEMORY_NOT_CHECKED`
- `RESOURCES_NOT_CHECKED`
- `RESULTS_NOT_CHECKED`
- `TOO_MANY_USER_QUESTIONS`
- `QUESTION_WITHOUT_MATERIAL_IMPACT`
- `USER_INPUT_SELECTED_BEFORE_REUSE`
- `USER_INPUT_SELECTED_BEFORE_RESEARCH`
- `VALUE_STEP_WITHOUT_VISIBLE_VALUE`
- `CONTEXT_ONLY_WITHOUT_EXPLANATION`
- `DECISION_EVIDENCE_MISSING`
- `LEGACY_FALLBACK_FORM_BIAS`
- `LEGACY_FALLBACK_ASK_BIAS`

The adapter caps contract questions at three but records legacy over-questioning and form bias observationally. Violations do not alter legacy execution in Step 1.

## 12. Persistence format

Stored without migration:

```text
prepared_input._brainDecision
prepared_input._brainDecisionVersion
prepared_input._brainDecisionEvidenceHash
```

The SHA-256 evidence hash uses safe IDs, statuses, and version/timestamp metadata. It does not contain raw values. Memory values invalidate the cache through their `updated_at` version, not by hashing private content.

On refresh:

- valid contract + same hash → same `decisionId` reused
- changed evidence version/hash → new deterministic contract
- invalid contract → deterministic regeneration

## 13. Prepare response changes

When enabled, prepare returns only:

```json
{
  "brainDecision": {
    "decisionId": "...",
    "decisionVersion": 1,
    "decisionType": "...",
    "reasoningSummary": "...",
    "userEffort": {
      "estimatedMinutes": 0,
      "interactionCount": 0,
      "questionsRequired": 0
    },
    "resultIntent": {
      "type": "...",
      "createVisibleValue": true,
      "createResource": false,
      "requireGeneratedResult": true,
      "requireReview": true,
      "requireAcceptance": true
    },
    "workflowImpact": {
      "reconsiderWorkflow": false,
      "proposalRequired": false
    },
    "policyCompliance": {
      "minimumUserEffortPassed": true,
      "visibleValuePassed": true,
      "violations": []
    }
  }
}
```

Internal confidence scores, evidence refs, model metadata, safety internals, and persistence keys are not returned.

## 14. Feature flag behavior

`PROJECT_BRAIN_DECISION_LAYER_ENABLED`

- missing / false: no contract generation, persistence requirement, or response field
- true / `1`: generate or reuse contract, validate, persist, log safe diagnostics, expose safe response envelope

No additional Decision Layer feature flag was introduced.

## 15. Tests added

Focused coverage includes:

- valid/invalid schema
- reuse evidence requirements
- minimal-context constraints and three-question cap
- material-impact validation
- direct-generation and research gates
- context-only and visible-value rules
- memory/resource/result ordering
- all ten decision mappings
- observational policy violations
- feature flag behavior
- safe response and logs
- persistence and evidence hashing
- refresh reuse, invalid-data recovery, and evidence-version invalidation
- unchanged AIExperienceContract adapter path
- feature-enabled prepare integration
- private persistence fields excluded from responses

## 16. Test results

| Suite | Result |
|---|---|
| `npm run test:projects-brain-decision` | **34/34 passed** |
| prepare + memory compatibility | **11/11 passed** |
| AI Experience + Universal Lifecycle integration | **32/32 passed** |
| `npm run test:projects-intent` (full Projects backend) | **331/331 passed** |
| Node syntax checks | passed |
| IDE lint diagnostics | no errors |

## 17. Backward compatibility

- Flag disabled: response shape and behavior remain unchanged
- Old action without decision: existing prepare path remains valid
- New action with decision: execution plan, AIExperienceContract, and lifecycle still use existing behavior
- Old mobile safely ignores the optional field
- Existing action prepared input is preserved while private decision keys are withheld from clients
- Invalid persisted decisions regenerate safely
- No model prompt changed
- No model call added

## 18. Remaining risks

- Resource reuse remains exact-step only because Step 1 preserves legacy behavior.
- Accepted-result semantic reuse uses a generic, category-independent token-overlap threshold; it is observational and does not change execution.
- Cross-step accepted Decision Contracts are not yet queried; the retrieval slot is present but empty in Step 1.
- Research signals may map to `research_then_generate`, but Research Engine remains unavailable and legacy execution remains unchanged.
- External action, verification, defer, workflow-proposal, and blocked decisions require structural signals not yet supplied by current prepare orchestration.
- A first-time contract can persist `actionId: null` because the action row does not exist until after the decision is created. The field is present and nullable.
- If a persistence write fails, prepare continues with an in-memory contract and emits a safe warning to preserve existing availability.

## 19. Technical debt introduced

- `deterministic-decision-adapter.js` is temporary and must be removed after frontier-model Decision Contract generation is validated and the legacy decision mapping has replacement tests.
- `resultIntent` observationally overlaps execution-plan completion criteria until Step 3 makes Decision Contract authoritative for experience/lifecycle strategy.
- Existing legacy `executionDecision` remains returned and consumed.
- Private contract storage inside `prepared_input` should eventually move to a dedicated JSONB column or decision-history table.

Removal condition: frontier decision generation must pass deterministic validation/repair tests, refresh tests, feature-flag rollback tests, and full Projects regression suites before the adapter or legacy heuristics are removed.

## 20. Not implemented

- Frontier-model Decision Contract generation
- Decision repair model
- Decision Graph
- Direct AIExperienceContract generation
- Research Engine
- Knowledge Base
- Storage or file generation
- Upload changes
- Workflow proposal execution
- Mobile redesign
- Database migration
- New model call or prompt changes

## Architecture Improvement Proposal

No alternative architecture was implemented. The previously identified Objective-Scoped Decision Graph remains explicitly deferred. Step 1 keeps the approved per-action contract boundary so a future graph can compose decisions without changing this implementation now.

## Required YES/NO review

### Architecture Checklist

1. YES — The contract contains no project-category decision rules.
2. YES — It contains no mobile component or renderer types.
3. YES — Backend creates, validates, persists, and serializes the decision.
4. YES — `decisionVersion` is required and fixed to v1.
5. YES — The deterministic validator enforces schema and cross-field invariants.
6. YES — It is persisted and reconstructable from versioned evidence.
7. YES — Universal Lifecycle remains unchanged and passes regression tests.
8. YES — AIExperienceContract remains plan-driven and unchanged.
9. YES — One feature flag controls the complete Step 1 path.
10. YES — No model or arbitrary executable logic is used for decisions.

### ITER Product Checklist

1. YES — Memory lookup precedes question mapping.
2. YES — Resource reuse precedes question mapping.
3. YES — Accepted results precede question mapping.
4. YES — Over-questioning and ask bias are persisted violations.
5. YES — The contract caps `mustAskUser` items at three.
6. YES — `resultIntent` distinguishes context-only and value-producing work.
7. YES — Validation requires visible value for value-producing decisions.
8. YES — Reuse, accepted results, research, and generation precede user input.
9. YES — New decision logic has no category or goal-specific hardcoding.
10. YES — The contract is objective- and evidence-based.
11. YES — It formalizes minimum necessary user effort and visible value.
12. YES — All strategy, policy, validation, persistence, and logging live in backend.

### Future Compatibility Checklist

1. YES — A future model can emit the same validated v1 contract.
2. YES — `resultIntent` and `nextAction` provide the future Experience Layer boundary.
3. YES — Research need and availability are explicit evidence fields.
4. YES — `knowledgeRefs` and availability are present without invented data.
5. YES — Workflow impact and proposals are contract fields.
6. YES — Decisions can become nodes in a future Decision Graph.
7. YES — The temporary adapter isolates legacy heuristics for later removal.
8. YES — Removal conditions are documented in this report.

### Reliability Checklist

1. YES — Same evidence hash reuses the same contract and decision ID.
2. YES — Invalid persisted contracts are deterministically regenerated.
3. YES — The hash contains IDs/versions, never raw private content.
4. YES — Diagnostics contain counts, bands, codes, and identifiers only.
5. YES — Disabling the single flag restores legacy-only behavior.
6. YES — Existing execution, plan, experience, and lifecycle tests pass.
7. YES — The validator accepts only the ten supported decision types.
8. YES — Violations are persisted and logged as safe codes.
9. YES — Blocked/authorization states map to conservative decisions when signaled.
10. YES — All focused and full Projects backend tests passed.

### Technical Debt Checklist

1. YES — Step 1 intentionally introduces a temporary deterministic adapter.
2. YES — Its temporary role is documented in code and this report.
3. YES — Removal conditions are specified above.
4. YES — `resultIntent` temporarily overlaps execution-plan completion criteria.
5. YES — The overlap and Step 3 removal path are documented.
6. NO — Step 1 introduces no database migration.
7. NO — Step 1 introduces no model call.
8. YES — Unsupported live signal gaps are listed in Remaining Risks.
9. YES — Model token and API costs are unchanged.
10. YES — Decision Graph is explicitly deferred.

## Delivery confirmation

No commit, push, deployment, migration, production change, Preview change, or mobile redesign was performed.
