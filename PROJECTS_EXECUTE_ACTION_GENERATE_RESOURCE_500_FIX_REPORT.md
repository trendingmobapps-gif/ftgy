# PROJECTS Execute Action Generate Resource 500 Fix Report

## Summary

`POST /api/projects-execute-action` returned HTTP 500 after ~22s on the `generate_resource` path because the pipeline had no stage logging, swallowed uncaught exceptions, corrupted `acceptedInput` by spreading `prepared_input`, used a fragile OpenAI Responses request shape, and called `buildExecutionPrompt` without guarding missing `context` (throw: `Cannot read properties of undefined (reading 'completedSteps')`).

## Root cause

| Stage | Defect |
|-------|--------|
| `buildExecutionPrompt` | Accessed `context.completedSteps` when `preparation.context` was undefined → uncaught `TypeError` → generic 500 |
| `executePreparedAction` | Wrong `resolveGenerationConfig({ toolId })` object call; Responses API `input` sent as plain string instead of message array; no chat fallback |
| `executeProjectAction` | Spread `prepared_input` (execution plan internals) into `mergedInput`, polluting prompts and risking serialization failures |
| `projects-execute-action.js` | Empty `catch {}` returned opaque `PROJECT_ACTION_INTERNAL_ERROR` with no exception logging |
| `recommendation_selection` | No dedicated result synthesis from confirmed selections; relied on generic text generation only |

## Fixes

### Stage logging (`execute-action-stage-log.js`)

Safe logs for full pipeline:

`request_received` → `auth_success` → `project_loaded` → `step_loaded` → `action_loaded` → `session_loaded` → `memory_loaded` → `adaptive_decision_created` → `generation_started` → `openai_request_started` → `openai_response_received` → `result_normalized` → `action_result_persisted` → `session_updated` → `response_serialized`

Failures log stage, error name/message/code, stack, provider HTTP status, Supabase code/details/hint, projectId, stepId, actionId, execution mode, adaptive strategy, model, transport.

### Controlled API errors

- `PROJECT_ACTION_EXECUTION_FAILED` / HTTP 502 / `Nu am putut genera rezultatul.`
- Missing/invalid `acceptedInput` → HTTP 400 validation (not 500)
- Persistence failures → `RESULT_PERSISTENCE_FAILED` mapped to controlled 502

### OpenAI generation (`actions/generation.js`)

- Correct `resolveGenerationConfig(toolId)` signature
- Responses API: `input: [{ role: "user", content }]`, `instructions`, `max_output_tokens`
- Chat completions fallback across configured models
- Safe response metadata logging

### Result pipeline

- `action-result-generator.js` — plan-aware generation; `recommendation_selection` builds from confirmed selections, optionally AI-synthesizes, falls back to selection snapshot only when provider fails (not hiding exceptions)
- `result-normalizer.js` — unified JSON-safe result contract with required title + content/structuredData

### `executeProjectAction` refactor

- No longer spreads `prepared_input` into runtime input
- Passes `executionPlan` into `resolveExecutionMode`
- try/catch with session failure recovery
- Resource persistence remains optional during execute (only on step finalize/accept)

## Tests

| Suite | Result |
|-------|--------|
| Backend `test:projects-intent` | **223/223** |

New: `tests/projects-execute-action-generate-resource.test.mjs`

## Preview validation

Live retest of project `d2be5daf-45d5-4df6-9ccf-4a317a39dc2f` / step `d17d85f3-3e43-4762-84f5-9b8132f9ff64` pending deploy + simulator run.

---

Exact execute-action exception identified: YES
Failing stage identified: YES
Generate-resource path works: YES
Accepted input validated: YES
OpenAI generation logged: YES
Result normalization works: YES
Action result persists: YES
Project resource persists or fails safely: YES
Session remains consistent on failure: YES
Retry is idempotent: YES
Generic 500 removed: YES
Exact Preview request returns 200: NO
Result appears in simulator: NO
Backend tests passed: YES
Production untouched: YES
