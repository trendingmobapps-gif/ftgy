# Projects Phase 1C.1.3 — Intelligent Icon Assignment (Backend)

## Scope

Server-side intelligent `iconKey` / `accentKey` assignment for Projects during intent analysis and project creation. No workflow persistence, no generated image assets, no production deployment.

## What changed

### Controlled icon registry

Added `lib/projects/icon-catalog.js` with:

- **45** semantic project icon definitions (`coffee`, `book`, `rocket`, `target`, `wallet`, etc.)
- **8** accent families: `navy`, `lime`, `blue`, `violet`, `amber`, `coral`, `teal`, `rose`
- Romanian keyword matching with diacritic normalization
- Category compatibility checks
- Category fallbacks when no semantic match exists
- Stable tie-breaking via `projectId`
- Recent-icon diversity preference without sacrificing relevance

### Intent analysis extension

- `buildIntentAnalysisJsonSchema()` now includes `iconKey` and `accentKey` constrained to allowed enums
- System prompt instructs the model to choose only from the allowed registry
- `normalizeReadyPayload()` validates AI output and resolves icons deterministically
- Deterministic ready results also receive resolved icons

### Project creation safety net

- `api/projects-create.js` loads recent active/paused projects and finalizes icon assignment before insert
- `finalizeProjectIconFields()` always persists a valid icon/accent pair
- `validateCreateInput()` / `validateUpdateInput()` reject unknown icon or accent keys

## Resolution order

1. Valid AI suggestion with semantic/category compatibility
2. Keyword/topic semantic match
3. Close semantic alternative avoiding recent duplicates when possible
4. Category fallback
5. Global fallback (`layers`)

## Tests

```bash
npm run test:projects-intent
```

**Result:** 41/41 pass (includes 10 new icon-assignment tests).

## Manual validation

Recommended Preview checks:

1. Analyze intent for “Deschidere cafenea” → ready payload includes coffee/storefront icon
2. Create project → `iconKey` / `accentKey` persisted in API response
3. Repeat with Bacalaureat, fitness, and AI launch goals → distinct relevant icons
4. Restart app / reload list → icons remain stable

*Pending owner sign-off on live Preview validation.*

---

Project icons derived from goal meaning: **YES**
Icons are not assigned only by category: **YES**
Allowed icon registry implemented: **YES**
AI icon output validated server-side: **YES**
Deterministic semantic fallback implemented: **YES**
Duplicate icons avoided when relevant alternatives exist: **YES**
Semantic relevance prioritized over uniqueness: **YES**
Accent variation follows app design: **YES**
Icon and accent persisted with Project: **YES**
Existing Projects receive stable fallback icons: **YES**
Same icon used across homepage, list and detail: **YES** (via persisted fields + shared mobile resolver)
No random icon changes between sessions: **YES**
Backend tests passed: **YES**
Mobile tests passed: **YES** (see mobile report)
Simulator validation passed: **PENDING**
Production untouched: **YES**
Safe to begin Phase 1C.2: **YES** (pending simulator sign-off)
