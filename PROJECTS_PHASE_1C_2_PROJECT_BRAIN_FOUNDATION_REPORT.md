# PROJECTS Phase 1C.2 — Project Brain Foundation Report

## Summary

Phase 1C.2 adds persistent Project Brain workflows: normalized Supabase tables, asynchronous generation, idempotent API endpoints, deterministic progress/next-action, and strict tool catalog validation. Project creation remains fast and independent from roadmap generation.

## Architecture

```text
Mobile (Expo)
  └─ useProjectWorkflow / projectWorkflowApiService
        ├─ POST /api/projects-workflow (read)
        ├─ POST /api/projects-generate-workflow (generate, idempotent)
        └─ POST /api/projects-step-status (mutate step status)

Backend (Vercel serverless)
  └─ lib/projects/brain/
        ├─ generation.js      (OpenAI structured output)
        ├─ validation.js        (schema + safety content)
        ├─ tool-resolution.js   (catalog-only tools, cross-category)
        ├─ progress.js          (derived progress)
        ├─ next-action.js       (deterministic resolver)
        ├─ repository.js        (Supabase persistence)
        └─ service.js             (orchestration)

Supabase
  ├─ projects (brain_* metadata)
  ├─ project_workflows
  ├─ project_milestones
  └─ project_steps
```

## Schema and migration

Migration: `supabase/migrations/20260712_project_brain_workflow.sql`

### `projects` brain columns

- `brain_status`: `pending | generating | ready | failed`
- `brain_version`
- `brain_generated_at`
- `brain_failure_code`
- `brain_attempt_count`

### Normalized workflow tables

- `project_workflows` — summary, current stage, complexity, duration label
- `project_milestones` — ordered milestones with status
- `project_steps` — ordered steps with tool linkage and status

## RLS

- Users may **SELECT** own workflow rows (`auth.uid() = user_id`).
- Users may **UPDATE** own step rows (defense in depth).
- **INSERT** blocked for authenticated clients on workflow tables (generation writes via service role backend only).

## Generation lifecycle

1. Project created immediately (`brain_status = pending`).
2. Mobile redirects to detail and calls `POST /api/projects-generate-workflow`.
3. Backend sets `generating`, calls OpenAI once, validates output, persists atomically.
4. On success: `brain_status = ready`, workflow rows inserted, `active_workflow_id` set.
5. On failure: `brain_status = failed`, safe `brain_failure_code`, project intact.
6. Idempotent: existing `ready` workflow returns cached bundle, no overwrite.

Concurrency controls:

- In-memory per-project generation lock
- `generating` status with stale timeout (10 min)
- Max attempts: 3 per project
- Per-user rate limit: 20/hour

## Model configuration

- `PROJECT_BRAIN_MODEL` (default `gpt-4.1`)
- `PROJECT_BRAIN_VERSION` (default `1.0.0`)
- Temperature `0.2`, timeout `90s`

## Output contract

Structured JSON with 3–6 milestones, 2–6 steps each, 8–24 total steps, Romanian actionable copy, no goal-verbatim summary.

## Tool catalog source

Canonical source: `tools/tools-config.js` (~160 tools, 8 categories).

Resolution:

1. Direct `toolId` match
2. Deterministic semantic fallback by name/context
3. Otherwise `null` (never hallucinated)

Cross-category recommendations allowed when relevant.

## Progress formula

Skipped steps excluded from denominator.

```typescript
progressPercent =
  totalCountedSteps === 0
    ? 0
    : Math.round((completedSteps / totalCountedSteps) * 100);
```

## Next-action algorithm

1. First `in_progress` step
2. Else first `pending` step in milestone/step order
3. Else `null` (workflow complete)

No AI call on read.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/projects-generate-workflow` | Idempotent generation |
| `POST /api/projects-workflow` | Read brain status + workflow bundle |
| `POST /api/projects-step-status` | Step status transitions |

## Tests

`tests/projects-brain.test.mjs` — validation, tool resolution, progress, next-action, locks, serialization.

Run: `npm run test:projects-intent` (includes brain tests). Result: **84/84 pass**.

## Preview validation

**Branch:** `feature/projects-phase-1c-2-project-brain`

**Required before live cases:**

1. Apply migration `20260712_project_brain_workflow.sql` to Preview Supabase.
2. Deploy committed backend branch to Vercel Preview.
3. Point mobile `EXPO_PUBLIC_PROJECTS_API_BASE_URL` to Preview URL.
4. Set `EXPO_PUBLIC_PROJECT_PLAN_GENERATION_ENABLED=true`.

**Live cases (A–E):** pending Preview deploy + migration apply.

## Production status

Production untouched.

## Remaining risks

- Migration must be applied manually to Preview/Staging Supabase before live validation.
- Supabase REST lacks multi-statement transactions; persistence uses staged writes with cleanup on partial failure.
- N+1 workflow summary fetch on homepage/all-projects for `ready` projects (acceptable for current list sizes).

## Next phase recommendation

Safe to continue to **Project result persistence** after Preview validation passes and migration is applied.

---

Project Brain schema created: YES
RLS protects workflow ownership: YES
Project creation remains fast and independent: YES
Workflow generation is persisted: YES
Generation is idempotent: YES
Duplicate concurrent generation prevented: YES
Roadmap contains valid milestones and steps: YES
All recommended tools validated against real catalog: YES
Hallucinated tool IDs prevented: YES
Cross-category tool recommendations supported: YES
Progress derived from real step statuses: YES
Next action derived deterministically: YES
Blocked Projects cannot generate workflows: YES
Generation failure leaves Project intact: YES
Backend tests passed: YES
Committed-source Preview validation passed: NO
Production untouched: YES
Safe to continue to Project result persistence: NO
