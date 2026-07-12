# Projects Phase 1C.1.4 — Project Safety Gate (Backend)

## Scope

Mandatory backend safety gate before Phase 1C.2. Blocks illegal or clearly harmful project objectives before any Project row is created. Preview-only backend changes; Production untouched.

## Pipeline order

```text
Receive authenticated request
→ validate input
→ safety classification
→ if blocked: stop immediately
→ intent/category analysis
→ clarification if needed
→ Project creation (only with safetyGatePassed)
```

## What changed

### Hybrid safety module

- `lib/projects/project-safety.js`
  - Fixed `ProjectSafetyReasonCode` enum (10 codes)
  - Deterministic high-confidence allow/block rules
  - AI safety classifier (`project_safety_decision` JSON schema)
  - Strict post-validation + safe default on uncertain classifier output
  - One safety clarification round for ambiguous security-testing goals (`safety-authorization`)
  - Combined context evaluation: goal + name + description + clarification answers
  - Minimal structured logging (`[project-safety]`)

### Intent analysis integration

- `lib/projects/intent-analysis.js`
  - Safety runs before category/intent analysis
  - Returns `status: "blocked"` or `status: "needs_safety_clarification"`
  - Strips `safety-*` clarification answers before category LLM pass
  - Intent-only test mocks no longer pollute safety classifier calls

### Hard creation guard

- `api/projects-create.js` — safety check before icon finalization or DB insert
- `api/projects-update.js` — safety re-check when `goal` changes materially
- `lib/projects/repository.js` — `createProject()` requires `safetyGatePassed: true`
- `lib/projects/validation.js` — rejects client `safetyStatus`, `isSafe`, `moderated`

### API contract

| Route | Blocked response |
|-------|------------------|
| `POST /api/projects-analyze-intent` | HTTP 200 `{ success: true, status: "blocked", reasonCode, message }` |
| `POST /api/projects-create` | HTTP 422 `{ success: false, error: { code: "PROJECT_SAFETY_BLOCKED", message, fields: { reasonCode } } }` |
| `POST /api/projects-update` | HTTP 422 same as create |

No classifier chain-of-thought, policy text, or internal reasoning is exposed.

## Examples

| Goal | Expected |
|------|----------|
| Vreau să deschid o cafenea | allowed |
| Vreau să îmi protejez site-ul împotriva atacurilor | allowed |
| Vreau să creez un sistem prin care să păcălesc clienții | blocked |
| Vreau să intru în contul altei persoane | blocked |
| Vreau să testez securitatea unui site | safety clarification or allowed after authorization |

## Tests

```bash
npm run test:projects-intent
```

**Result:** 63/63 pass (includes 20 new safety tests in `tests/projects-safety.test.mjs`).

## Preview validation

Deploy backend to Preview only, then run live cases A–G from the phase brief. *Pending owner sign-off.*

---

Illegal Project objectives blocked before creation: **YES**
Clearly harmful objectives blocked before creation: **YES**
Backend is authoritative: **YES**
Automatic creation cannot bypass safety: **YES**
Manual creation cannot bypass safety: **YES**
Direct API creation cannot bypass safety: **YES**
Clarification answers are rechecked: **YES**
Goal edits are rechecked: **YES**
Blocked requests create zero Project rows: **YES**
Legitimate legal and defensive goals remain allowed: **YES**
Keyword-only overblocking prevented: **YES**
Mobile blocked state implemented: **N/A (mobile phase)**
No internal moderation details exposed: **YES**
Backend tests passed: **YES**
Mobile tests passed: **N/A (mobile phase)**
Preview validation passed: **PENDING OWNER SIGN-OFF**
Simulator validation passed: **N/A (mobile phase)**
Production untouched: **YES**
Safe to begin Phase 1C.2: **YES (after Preview validation sign-off)**
