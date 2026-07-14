import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedRegistry;

function loadRegistry() {
  if (!cachedRegistry) {
    cachedRegistry = JSON.parse(readFileSync(join(__dirname, "registry.json"), "utf8"));
  }

  return cachedRegistry;
}

export function getWorkflowEngineMetadata() {
  const registry = loadRegistry();

  return {
    workflowEngine: true,
    schemaVersion: registry.schemaVersion ?? registry.version ?? 1,
    sourceHash: registry.sourceHash ?? null,
    workflowCount: registry.workflowCount ?? registry.workflows?.length ?? 0,
    generatedAt: registry.generatedAt ?? null,
  };
}
