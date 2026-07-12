# PROJECTS Phase 1C.3.1 — Project AI Sessions Report

**Date:** 2026-07-13  
**Backend repo:** `/Users/grigorestefanica/Downloads/ftgy-main`  
**Mobile repo:** `/Users/grigorestefanica/Documents/ITER Mobile/iter-ai-mobile`  
**Branch:** `feature/projects-phase-1c-2-project-brain` (backend)  
**HEAD:** `e7595d0`

---

## 1. Architecture refinement

Phase 1C.3 introduced Project Actions (prepare → execute → save). Product review showed users still felt they were opening a tool and editing prompts.

Phase 1C.3.1 refactors the same infrastructure into **Project AI Sessions**:

```text
Project Brain (1C.2)
  workflow, milestones, steps, progress

Project Actions tables (1C.3)
  project_step_actions
  project_action_results

Project AI Sessions (1C.3.1)
  conversation state on project_step_actions
  acceptance review on project_action_results
  session APIs layered on existing prepare/execute endpoints
```

**Core UX rule:** the user continues their Project — never opens a tool, never edits prompts by default.

---

## 2. Project AI Session model

A Session reuses the `project_step_actions` row and adds:

| Column | Purpose |
|--------|---------|
| `session_status` | `open` / `collecting` / `ready` / `generating` / `review` / `accepted` / `cancelled` |
| `conversation` | JSON message history |
| `collected_input` | User answers merged with inferred context |
| `pending_question` | At most one active question |
| `pending_result_id` | Result awaiting review |

Results gain `acceptance_status`: `pending_review` / `accepted` / `rejected`.

Migration: `supabase/migrations/20260714_project_ai_sessions.sql`

---

## 3. Session lifecycle

```text
Open Session (prepare-action)
→ ITER explains objective from project context
→ Ask ONLY missing information (one question at a time)
→ User answers naturally (session-respond)
→ Generate when ready (execute-action)
→ Present result for review
→ Accept / Improve / Cancel (session-review)
→ Accept saves result + completes step
→ Reject keeps step pending
```

**Step completion is gated on accepted results only** — pending or rejected results do not complete the step.

---

## 4. Conversation model

`lib/projects/brain/actions/session.js`:

- Opening messages reference project name, step title, expected outcome
- Questions use `pending_question` with a single `key` + `label`
- User answers append to `conversation` and `collected_input`
- Known project context is inferred before asking (budget, location, product from goal)
- Result messages include preview; review prompt asks for acceptance

API `session` object returned on prepare, respond, execute, review:

- `phase`, `messages`, `pendingQuestion`, `pendingResult`
- `canGenerate`, `canRespond`, `canReview`

---

## 5. Prompt abstraction

- `preparedPrompt` remains internal on the action row for capability execution
- Mobile UI no longer shows prompt editor
- `buildExecutionPrompt` merges `collected_input` + inferred `prepared_input`
- Advanced inspection of prepared instructions is possible via API but not exposed in default mobile flow

---

## 6. Context reuse

Unchanged from 1C.3 context builder, now consumed by session opening:

- Project goal, name, summary, category
- Workflow summary and stage
- Milestone + step details
- Completed steps and prior **accepted** result previews
- Field inference (`buget`, `locatie`, `produs`, etc.) from goal text

**Never ask twice:** `resolveNextQuestion` skips fields already in `collected_input`.

---

## 7. Action Result evolution

- Results saved with `acceptance_status: pending_review` after generation
- Only `accepted` results count for step completion and progress
- `rejected` results are excluded from project asset maps
- Existing `project_action_results` rows remain compatible (default `pending_review` on new column)

---

## 8. Backend changes

| Area | Change |
|------|--------|
| `lib/projects/brain/actions/session.js` | Session opening, Q&A, review serialization |
| `lib/projects/brain/actions/service.js` | Session respond, review; execute no longer auto-completes step |
| `lib/projects/brain/actions/repository.js` | Session columns, acceptance filters |
| `api/projects-prepare-action.js` | Returns `session` |
| `api/projects-execute-action.js` | Returns `session`, `requiresReview` |
| `api/projects-session-respond.js` | **New** — user message during collection |
| `api/projects-session-review.js` | **New** — accept / reject / improve / cancel |
| `lib/projects/brain/schema-bootstrap.js` | Applies sessions migration on Preview |
| `lib/projects/brain/service.js` | Step completion checks **accepted** results only |
| `scripts/apply-project-brain-migration.mjs` | Includes sessions migration |
| `tests/projects-brain-sessions.test.mjs` | Session unit tests |
| `tests/projects-brain-live-smoke.mjs` | Case A: prepare → generate → review accept |

**API compatibility:** `projects-prepare-action` and `projects-execute-action` remain; clients opt into session fields. Step completion semantics change: execute alone no longer completes a step.

---

## 9. Mobile changes

| File | Change |
|------|--------|
| `src/types/projectAction.ts` | `ProjectSession`, message types, review responses |
| `src/services/projectActionApiService.ts` | `respondToProjectSession`, `reviewProjectSession` |
| `src/hooks/projects/useProjectSession.ts` | Conversation-first hook |
| `app/proiecte/[projectId]/action.tsx` | Objective header, message list, single input, review actions |
| `scripts/projects-phase-1c-3-1-sessions.test.ts` | Contract tests |

**Removed from default UX:** prompt textarea, raw JSON, tool/model selection.

---

## 10. Tests

### Backend (`npm run test:projects-intent`)

- **106/106 passed** (includes 4 new session tests)

Session tests prove:

- Sessions reuse project context in opening messages
- Missing fields produce at most one question at a time
- Collected input prevents repeat questions
- Review phase serializes pending result
- Respond/review request validation

### Mobile (`npm run test:projects-detail-homepage`)

- **138/138 passed** (includes 4 new 1C.3.1 session tests)

---

## 11. Preview validation

**Scenario:** Project goal *"Vreau să deschid o patiserie."*

Expected flow:

```text
Open Project → Continue Project → Session opens
→ ITER continues naturally → Minimal questions
→ Generate → Review → Accept → Saved → Step completed
```

**Status:** Deploy pushed (`e7595d0`); live smoke not run in this session (missing `PROJECTS_BASE_URL` / `PROJECTS_ACCESS_TOKEN` in shell). Run after Preview build:

```bash
npm run smoke:projects-brain
```

**Production:** untouched.

---

## 12. Checklist

Project AI Sessions implemented: YES  
Projects no longer feel tool-driven: YES  
Prompt editing no longer required: YES  
Conversation-first experience implemented: YES  
Known context automatically reused: YES  
Minimal information collection implemented: YES  
Action Results preserved: YES  
Backend tests passed: YES  
Mobile tests passed: YES  
Preview validation passed: NO  
Production untouched: YES  
Safe to continue to Phase 1C.4: YES
