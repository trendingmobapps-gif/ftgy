# Projects Document Builder Contract Compatibility Report

Date: 2026-07-15  
Scope: Invalid prepare-action contract for `document_builder` with null interactive payload

## Verified live sequence

| Field | Value |
|-------|-------|
| Project | `524c0b17-b074-4f86-960c-af9e416926cb` |
| Step | `3edba158-daa1-4956-b38b-54183deab17f` |
| Prepare | HTTP 200 |
| mode | `document_builder` |
| actionType | `generate` |
| title | Centralizează documentele financiare |
| primaryActionLabel | Generează documentul |
| requiredInputsCount | 0 |
| interactivePayloadType | null |
| source | `contextual_fallback` |
| Mobile rejection | `payload_type_mode_mismatch` |

No action execution was performed during this fix.

## Investigation answers

### 1. What payload type is required for `document_builder`?

`structured_form` — enforced in backend `EXECUTION_MODE_PAYLOAD_TYPES` and mobile `MODE_PAYLOAD_TYPES`.

### 2. Can `document_builder` legally have `interactivePayload=null`?

**No.** When `mode=document_builder`, the contract invariant requires `payload.type === "structured_form"`. Null payload is only valid for direct-generation modes (`generator`, `research`, `image_generation`, etc.).

### 3. Why did contextual fallback choose `document_builder`?

`buildContextualExecutionPlanFallback()` matched the step haystack on the substring `"document"` (`isDocument` branch). The title **Centralizează documentele financiare** contains `documente`, triggering document mode selection based on wording — not on interaction model.

### 4. Why did it fail to build the required payload?

`serializeInteractivePayloadFromPlan()` only emits `structured_form` for `document_builder` when `requiredInputs.length > 0`. With zero missing fields / zero inputs, payload remained `null`. Prepare still returned mode `document_builder`, causing the invariant violation.

### 5. What should this step be?

For zero required inputs and no interactive document structure, **generator** (direct result generation) is correct. The user generates a synthesized financial document from project context — not a structured form or upload flow. Upload would require `upload_and_review` with file inputs; structured financial data entry would require `structured_form` with fields.

## Exact root cause

Contextual fallback selected `document_builder` from title keywords while producing zero `requiredInputs`, so no `structured_form` payload was serialized. Backend returned an incompatible contract; mobile validation correctly rejected it with `payload_type_mode_mismatch`.

## Authoritative `document_builder` contract

| Field | Requirement |
|-------|-------------|
| `executionPlan.mode` | `document_builder` |
| `executionDefinition.mode` | `document_builder` |
| `interactivePayload.type` | `structured_form` |
| `interactivePayload.fields` | ≥ 1 valid field when mode is `document_builder` |
| Zero inputs | **Not valid** — normalize to `generator` |

## Deterministic repair

### Rule A — valid document_builder

When mode stays `document_builder` and `requiredInputs.length > 0`, repair serializes payload from plan via `serializeInteractivePayloadFromPlan()`.

### Rule B — zero-input direct generation

When `document_builder` (or `spreadsheet_builder`) has zero inputs and null/mismatched payload, repair normalizes plan mode to **`generator`**, keeps `interactivePayload=null`, preserves document-oriented labels where appropriate.

### Repair order (prepare path)

1. Ensure execution plan
2. Serialize / validate payload
3. `repairExecutionContractModePayload()` — deterministic, no OpenAI
4. Rebuild execution definition + contract
5. `validateActiveExecutionContract()` — `contractValid` only true when compatible

## Logging

When repair runs:

```
[projects-prepare-action] stage=execution_contract_repaired
{
  projectId, stepId, actionId,
  originalMode, originalPayloadType,
  repairedMode, repairedPayloadType,
  repairReason, source
}
```

No raw user content logged.

## Files / functions changed

| File | Change |
|------|--------|
| `lib/projects/brain/execution/active-execution-contract.js` | `EXECUTION_MODE_PAYLOAD_TYPES`, `validateExecutionContractInvariant()`, `repairExecutionContractModePayload()` |
| `lib/projects/brain/execution/execution-plan-generator.js` | Contextual fallback `isDocument` → `generator` for zero-input steps |
| `lib/projects/brain/execution/interactive.js` | Repair before contract build; `execution_contract_repaired` logging |
| `tests/projects-document-builder-contract-compatibility.test.mjs` | 10 contract tests |
| `package.json` | `test:projects-document-builder-contract` + suite inclusion |

Mobile (validation unchanged):

| File | Change |
|------|--------|
| `scripts/projects-atomic-execution-contract.test.ts` | Tests 11–12: reject `document_builder`+null; accept `generator`+null |

## Tests and results

| Suite | Result |
|-------|--------|
| `npm run test:projects-document-builder-contract` | **10/10** |
| `npm run test:projects-intent` | **538/538** |
| Mobile `test:projects-detail-homepage` | **405/405** |

## OpenAI / provider

No OpenAI calls added. Repair is deterministic.

## Deployment

No commit, push, or deployment performed.
