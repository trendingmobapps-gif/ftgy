# ITER AI — Projects Phase 1C.1 Intent Analysis Report

**Status: COMPLETE** — committed source validated on Preview (7 passed / 0 failed).  
Backend repository: `vercel-api-bridge-for-wix` (local checkout: `/Users/grigorestefanica/Downloads/ftgy-main`)  
Phase focus: `POST /api/projects-analyze-intent` — goal analysis, clarification, safe category detection  
Date: 2026-07-12

---

## Source control

| Field | Value |
|-------|-------|
| Branch | `feature/projects-phase-1c-1-intent-analysis` |
| Commit | `daa8966b5249832d572f300307bdd5a4aa974116` |
| Pushed to `origin` | **YES** — remote head matches local HEAD |
| Source-control blocker | **RESOLVED** — Phase 1C.1 runtime + test closure is committed and pushed |

Committed closure includes: `api/projects-analyze-intent.js`, `lib/auth/resolve-supabase-user.js`, all `lib/projects` intent helpers, `tools/tools-config.js`, `tools/generation-policy.js`, intent tests, `package.json`, `vercel.json`, `.v0/inject-built-with-v0.mjs`.

---

## 1. Existing AI Infrastructure Audited

| Component | Location | Reuse in 1C.1 |
|-----------|----------|---------------|
| OpenAI chat completions + JSON | `api/classify-category.js`, `api/recommend-tool.js` | Same raw `fetch` pattern, no new SDK |
| Structured JSON output | `response_format: { type: "json_object" }` / `json_schema` | Upgraded to strict `json_schema` for intent |
| Safety pre-check | `recommend-tool.js` blocklist | Lightweight blocklist in `intent-analysis.js` |
| Tool ID resolution | `recommend-tool.js` post-model `toolsById.get()` | `lib/projects/tool-catalog.js` resolves against `tools/tools-config.js` |
| Projects category slugs | `lib/projects/constants.js` | Canonical camelCase slugs enforced server-side |

**Not reused:** `classify-category.js` slug mapping (`social-media`, `viata-personala`) — incompatible with Projects catalog.

---

## 2. Authentication Implementation Reused

- **Helper:** `lib/auth/resolve-supabase-user.js`
- **Guard:** `lib/projects/http.js` → `guardRequest(req, res, { authMode: "user" })`
- **Verification:** `GET {SUPABASE_URL}/auth/v1/user` with caller Bearer token + service `apikey`
- **Ownership:** No `memberId` / `user_id` from client used for intent analysis
- **Internal secret:** Not required for mobile user mode
- **Forged memberId:** Rejected with 401 when it mismatches verified user id

Projects CRUD routes were integrated into the checkout (they were missing locally but live on Preview) using the same Phase 1A.1 guard — behavior matches deployed Preview, not changed semantically.

---

## 3. Exact Endpoint Contract

**Route:** `POST /api/projects-analyze-intent`

### Request
```json
{
  "goal": "string (required, 8–5000 chars)",
  "optionalName": "string (optional, max 120)",
  "clarificationAnswers": [
    { "questionId": "string", "answer": "string (max 500)" }
  ]
}
```

Rejected top-level fields: `categorySlug`, `memberId`, `user_id`, etc.

### Success responses (HTTP 200, `{ success: true, ... }`)

**Ready:**
```json
{
  "success": true,
  "status": "ready",
  "categorySlug": "fitness",
  "confidence": 0.92,
  "suggestedName": "Slăbesc 7 kg",
  "normalizedGoal": "...",
  "shortSummary": "...",
  "detectedIntent": "...",
  "firstStepTitle": "...",
  "firstStepDescription": "...",
  "recommendedToolId": "program-incepatori | null",
  "recommendationReason": "... | null"
}
```

**Needs clarification:**
```json
{
  "success": true,
  "status": "needs_clarification",
  "message": "...",
  "questions": [ { "id", "question", "type", "options?" } ]
}
```

**Unsupported:**
```json
{
  "success": true,
  "status": "unsupported",
  "message": "..."
}
```

### Error responses
| HTTP | Code |
|------|------|
| 400 | `PROJECT_INTENT_INVALID_INPUT` |
| 401 | `PROJECT_UNAUTHENTICATED` |
| 429 | `PROJECT_INTENT_RATE_LIMITED` |
| 502 | `PROJECT_INTENT_UPSTREAM_ERROR` / `PROJECT_INTENT_INVALID_RESPONSE` |
| 503 | `PROJECT_INTENT_UNAVAILABLE` |

**Does not create Project rows.**

---

## 4. Validation Rules

Implemented in `lib/projects/intent-validation.js`:

- `goal` required, trimmed, min 8 chars, max 5000
- `optionalName` max 120
- `clarificationAnswers` optional, max 6 entries, max 500 chars per answer
- Unknown top-level keys → 400 (consistent with strict Projects input policy)
- `categorySlug` from client rejected (not authoritative)
- Model category slug validated against `PROJECT_CATEGORY_SLUGS` before response

---

## 5. Structured-Output Approach

- Model: `gpt-4.1-mini`
- Temperature: `0.1`
- API: `chat/completions` with `response_format.type = "json_schema"` and `strict: true`
- Schema: `lib/projects/intent-schema.js` → `buildIntentAnalysisJsonSchema()`
- One repair retry when first model output fails normalization
- Timeout: 25s (`AbortSignal.timeout`)
- No raw model output returned to clients

---

## 6. Category Decision Logic

Combines:
- Model semantic classification against 8 canonical categories
- Ambiguity / missing context signals → `needs_clarification`
- Unsafe blocklist hits → `unsupported`
- Invalid model slug → rejected (retry once, then 502)
- Confidence stored but not sole decision driver

Examples aligned with product spec:
- Detailed fitness goal → `ready` + `fitness`
- “Vreau să slăbesc.” → typically `needs_clarification`
- “Vreau să mă dezvolt.” → `needs_clarification`
- “Ajută-mă.” → `needs_clarification` or `unsupported`

---

## 7. Clarification Logic

- Max 3 questions per response (`sanitizeIntentQuestions`)
- Romanian copy from model, server-sanitized structure
- Duplicate question IDs removed
- `single_choice` without options downgraded to `text`
- Re-analysis includes `clarificationAnswers` in user prompt
- No forced manual category selection unless model returns category ambiguity as a question

---

## 8. Project Naming Logic

Priority:
1. Valid `optionalName` from client (preserved)
2. Model `suggestedName`
3. `deriveNameFromGoal()` fallback from `lib/projects/validation.js`

Rules: max 120 chars, no “ITER AI”, prefix stripping for Romanian goal phrases.

---

## 9. Tool Catalog Resolution Strategy

- **Source:** `tools/tools-config.js` (`TOOLS` map, ~160 tools)
- **Index:** `lib/projects/tool-catalog.js` builds `byId` + `byCategory`
- **Model field:** `suggestedToolId` (hint only)
- **Server resolution:** `resolveRecommendedToolId()` — accepts only IDs present in catalog **and** matching `categorySlug`
- **Invented / cross-category IDs:** coerced to `null`
- **No duplicate hardcoded tool list**

---

## 10. Rate Limiting

- **Implementation:** `lib/projects/intent-rate-limit.js`
- **Scope:** per authenticated Supabase user id
- **Default:** 30 requests / rolling 60 minutes (in-memory per serverless instance)
- **Response:** HTTP 429 `PROJECT_INTENT_RATE_LIMITED`
- No client-supplied user id used for limiting

---

## 11. Files Added

- `api/projects-analyze-intent.js`
- `lib/auth/resolve-supabase-user.js`
- `lib/projects/http.js`
- `lib/projects/constants.js`
- `lib/projects/validation.js`
- `lib/projects/serializer.js`
- `lib/projects/repository.js`
- `lib/projects/status-transitions.js`
- `lib/projects/transition-handler.js`
- `lib/projects/intent-analysis.js`
- `lib/projects/intent-validation.js`
- `lib/projects/intent-schema.js`
- `lib/projects/intent-rate-limit.js`
- `lib/projects/tool-catalog.js`
- `api/projects-create.js` … `api/projects-archive.js` (integrated for Preview deploy parity)
- `tests/projects-intent-analysis.test.mjs`
- `tests/projects-intent-live-smoke.mjs`
- `PROJECTS_PHASE_1C_1_INTENT_ANALYSIS_REPORT.md`

---

## 12. Files Modified

- `package.json` — added `test:projects-intent`, `smoke:projects-intent`

**Not modified:** `generate-tool.js`, `recommend-tool.js`, `dashboard-data.js`, `category-chat.js`, workflow engine, Supabase schema/RLS.

---

## 13. Unit-Test Results

```bash
npm run test:projects-intent
```

**Result: 20/20 pass**

Coverage includes: auth 401, validation 400, ready/clarification/unsupported parsing, invalid category rejection, tool ID rejection, rate limit 429, no project creation, no secret fields in request contract.

---

## 14. Preview Deployment URL (committed-source, validated)

| Field | Value |
|-------|-------|
| Project | `vercel-api-bridge-for-wix` |
| Branch | `feature/projects-phase-1c-1-intent-analysis` |
| Commit | `daa8966b5249832d572f300307bdd5a4aa974116` |
| Preview URL | `https://vercel-api-bridge-for-50xi2kb7m-ierai.vercel.app` |
| Target | Preview only |
| Production | **Untouched** (`GET /api/projects-analyze-intent` → **404**) |

**Prior working-tree preview** (pre-commit, superseded for reproducibility):  
`https://vercel-api-bridge-for-5dsf6yoq8-ierai.vercel.app`

Independent verification on committed-source Preview:
- `GET /api/projects-analyze-intent` → **405**
- `POST` without token → **401**

---

## 15. Authenticated live smoke — PASSED (committed-source Preview)

Run against `https://vercel-api-bridge-for-50xi2kb7m-ierai.vercel.app` at commit `daa8966`.

**Result: 7 passed, 0 failed. Smoke exit code: 0.**

| # | Check | Result |
|---|-------|--------|
| 1 | missing token → 401 | PASS |
| 2 | empty goal → 400 | PASS |
| 3 | clear fitness goal → `ready` + `fitness` | PASS |
| 4 | clear business goal → `ready` + `business` | PASS |
| 5 | vague goal → `needs_clarification` | PASS |
| 6 | clarification re-analysis handled safely | PASS |
| 7 | endpoint created **no** Project rows | PASS |

Cleanup: both temporary test users deleted successfully.

---

## 16. Live Clarification Result

**PASSED** — vague goal returned `needs_clarification` (smoke check #5).

---

## 17. Live Re-Analysis After Clarification

**PASSED** — clarification re-analysis handled safely (smoke check #6).

---

## 18. Invalid-Input and Unauthenticated Results

| Case | Live result |
|------|-------------|
| Missing token | **401** (smoke #1) |
| Empty goal | **400** (smoke #2) |
| GET method | **405** (independent verification) |

---

## 19. Mobile Contract Compatibility

Compared against:
- `iter-ai-mobile/src/types/projectIntentAnalysis.ts`
- `iter-ai-mobile/src/services/projectIntentAnalysisParsing.ts`
- `iter-ai-mobile/src/services/projectIntentAnalysisService.ts`

| Mobile expectation | Backend response | Compatible |
|--------------------|------------------|------------|
| `status: ready` + `categorySlug` + `confidence` + `suggestedName` | Top-level on `{ success: true, ... }` | YES |
| `needs_clarification` + `questions[]` | Same | YES |
| `unsupported` + `message` | Same | YES |
| Parser `root.result ?? root` | Fields at top level | YES |
| Endpoint path `/api/projects-analyze-intent` | Exact match | YES |
| Bearer auth only | No internal secret for user mode | YES |

**No mobile changes required.** Enable with `EXPO_PUBLIC_PROJECT_INTENT_ANALYSIS_ENABLED=true` and point `EXPO_PUBLIC_PROJECTS_API_BASE_URL` to the committed-source Preview URL in §14.

---

## 20. Security Verification

- No access tokens logged
- No `ITER_INTERNAL_API_SECRET` required for user-facing intent calls
- No `memberId` / `user_id` accepted as ownership
- No raw model output, prompts, or provider metadata in responses
- No Project rows created by analysis endpoint
- Tool IDs validated against canonical catalog only

---

## 21. Production Status

**Production untouched.** Verified 2026-07-12:

- `GET https://vercel-api-bridge-for-wix.vercel.app/api/projects-analyze-intent` → **404** (endpoint not on production)
- No production deployment was performed for Phase 1C.1

---

## 22. Remaining Risks

1. **In-memory rate limit** is per-instance (serverless) — sufficient for initial protection, not global.
2. **AI variability** — edge-case goals may need prompt tuning after real user traffic.
3. **Workflow regression script** (`npm run test:workflows`) still expects legacy routes (`profile-get-or-create`, etc.) not present in this checkout — pre-existing, unrelated to 1C.1.

---

## 23. Readiness for Phase 1C.2 Project Workflow Backend

Phase 1C.1 is **complete**. The intent-analysis contract is implemented, committed, pushed, and validated live from committed source. Safe next steps for 1C.2:

- Project workflow persistence API
- Plan generation endpoint (gated in mobile UI)
- `firstStepTitle` / `workflowStepId` linkage from analysis → workflow engine

---

## Phase 1C.1 completion checklist

Projects intent endpoint implemented: YES  
Source committed and pushed to `origin`: YES  
Supabase Bearer authentication enforced: YES  
Automatic category detection works live: YES  
All 8 category slugs constrained safely: YES  
Vague goals return clarification: YES  
Clarification re-analysis works live: YES  
Project name suggestion works live: YES  
Invented tool IDs rejected: YES  
Endpoint creates no Project data: YES  
Mobile parser contract compatible: YES  
Unit tests passed: YES (20/20)  
Committed-source live Preview validation passed: YES (7/0)  
No secrets or raw model internals exposed: YES  
Production untouched: YES  
**Phase 1C.1 complete: YES**  
**Safe to begin Phase 1C.2: YES**
