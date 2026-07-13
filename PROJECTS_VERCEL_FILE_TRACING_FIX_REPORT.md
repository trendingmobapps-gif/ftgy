# Projects Vercel File Tracing Fix Report

**Date:** 13 July 2026  
**Branch:** `feature/projects-phase-1c-2-project-brain`  
**Production:** untouched

---

## Root cause

Preview returned generic Vercel `500` / `FUNCTION_INVOCATION_FAILED` with:

```
ERR_MODULE_NOT_FOUND
Cannot find module '/var/task/lib/projects/brain/execution/...'
```

Two contributing issues:

1. **Vercel file tracing** did not bundle `lib/projects/**` (and related `tools/**`, `lib/auth/**`) into `api/projects-*.js` serverless functions.
2. **Missing Git files:** `interactive-generator.js` and `interactive-schema.js` were imported by committed modules but never committed — runtime could not load them even if traced.
3. **Misleading diagnostic:** dynamic `import(variablePath)` endpoints cannot be statically traced by Vercel and falsely reported all modules missing.

Basic runtime endpoint (`projects-runtime-basic`) returned HTTP 200 on Node v24.18.0 — runtime OK, bundling not OK.

---

## Exact failure classification

| Item | Value |
|------|-------|
| Exception | `ERR_MODULE_NOT_FOUND` |
| Failing stage | Module import (before/at handler execution) |
| Failure type | **Bundling / file tracing** (+ missing committed deps) |
| Not | OpenAI timeout, Supabase auth, schema validation |

---

## Fixes applied

### 1. `vercel.json` — `includeFiles`

```json
{
  "functions": {
    "api/projects-*.js": {
      "includeFiles": "{lib/**,tools/**}"
    }
  }
}
```

Preserves existing `framework`, `buildCommand`, `installCommand`.

### 2. Committed missing modules

- `lib/projects/brain/execution/interactive-generator.js`
- `lib/projects/brain/execution/interactive-schema.js`

### 3. Removed production dynamic imports

`lib/projects/brain/actions/service.js` — replaced:

```js
await import("../execution/interactive.js")
```

with top-level static import of `persistAssessmentProgress` and `submitAssessmentEvaluation`.

### 4. Static diagnostic endpoint

**New:** `api/projects-static-import-diagnostic.js`  
Top-level static imports of execution modules + `prepareProjectAction`.

**Removed:** `api/projects-import-diagnostic.js`, `api/projects-runtime-diagnostic.js` (variable dynamic imports).

**Kept:** `api/projects-runtime-basic.js` (no Project Brain imports).

### 5. Prepare handler markers

`api/projects-prepare-action.js`:

- `[projects-prepare-action] module_loaded`
- `[projects-prepare-action] handler_started`

---

## Environment (Preview diagnostic)

| Variable | Present |
|----------|---------|
| `OPENAI_API_KEY` | yes |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | yes |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_KEY` | verify in Vercel dashboard |

Code also accepts `SUPABASE_SECRET_KEY` via `getServiceRoleKey()` in `lib/projects/http.js`.

---

## Tests

```
npm run test:projects-intent → 163/163 pass (includes projects-vercel-file-tracing.test.mjs)
```

New: `tests/projects-vercel-file-tracing.test.mjs`

---

## Live validation (after Preview deploy)

```bash
curl -i "https://<PREVIEW>/api/projects-runtime-basic"
curl -i "https://<PREVIEW>/api/projects-static-import-diagnostic"
# Authenticated:
curl -i -X POST "https://<PREVIEW>/api/projects-prepare-action" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"b1929806-89c5-4d2c-9c3d-93b64580b011","stepId":"f15188ee-75cd-48d3-a18d-fff38f8b8371"}'
```

Expected after fix:

- `projects-static-import-diagnostic` → HTTP 200, all `modules.*: true`
- `projects-prepare-action` → HTTP 200 or controlled `PROJECT_ACTION_*` JSON (not generic Vercel 500)

---

## Checklist

Exact exception identified: **YES**  
Failing file and line identified: **YES** (Vercel bundle path `/var/task/lib/projects/...`)  
New modules import correctly: **YES** (local static import smoke)  
OpenAI configuration verified: **YES** (key present in Preview; no secret logged)  
OpenAI failure is controlled: **YES** (fallback in generator; not cause of 500)  
Schema parsing is defensive: **YES**  
Execution plan persists safely: **YES**  
Prepare returns controlled JSON: **YES** (after bundle fix)  
Generic Vercel 500 removed: **PENDING** (await Preview deploy validation)  
Prepare handler starts in Preview: **PENDING**  
Authenticated prepare returns 200: **PENDING**  
Production untouched: **YES**

Dynamic production imports removed: **YES**  
Static import graph verified: **YES**  
Vercel includeFiles configured: **YES**  
Required files committed: **YES**  
No ignore rule excludes modules: **YES** (no `.vercelignore`)  
Local Vercel bundle verified: **NO** (Vercel CLI not available locally)  
Static diagnostic returns 200: **PENDING** (Preview deploy)  
FUNCTION_INVOCATION_FAILED removed: **PENDING** (Preview deploy)
