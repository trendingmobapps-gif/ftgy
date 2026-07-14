# ITER AI Workflow Engine (Backend)

Derived deploy artifact — **not** the source of truth.

## Source of truth

Workflow definitions originate in the mobile repo:

```
iter-ai-mobile/src/workflows/definitions/
```

## Sync workflow

```bash
cd iter-ai-mobile
npm run audit:workflows          # validates + writes reports/workflow-registry.export.json
npm run sync:workflows-backend   # validates, hashes, writes backend registry + manifest

cd ../Downloads/ftgy-main
npm run verify:workflow-registry # fails if backend registry is stale
npm run test:workflows           # resolver + API contract tests
```

## Registry metadata

`workflows/registry.json` includes:

```json
{
  "schemaVersion": 1,
  "generatedAt": "...",
  "sourceHash": "...",
  "workflowCount": 22,
  "workflows": []
}
```

## Production verification

`GET /api/workflow-engine-version` — safe public metadata only.

## Files deployed to Vercel

- `api/generate-tool.js`
- `api/workflow-engine-version.js`
- `workflows/registry.json`
- `workflows/resolve-next-action.js`
- `workflows/workflow-priorities.js`
- `workflows/build-generation-response.js`
- `workflows/registry-metadata.js`
- `tools/tools-config.js`

No `.vercelignore` excludes these paths.
