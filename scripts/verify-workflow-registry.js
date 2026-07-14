import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRegistryPath = join(__dirname, "../workflows/registry.json");

const DEFAULT_MOBILE_MANIFEST_PATH = resolve(
  process.env.ITER_MOBILE_MANIFEST_PATH ||
    join(process.env.HOME || "", "Documents/ITER Mobile/iter-ai-mobile/reports/workflow-registry.manifest.json"),
);

function fail(message) {
  console.error(`[verify-workflow-registry] ${message}`);
  process.exitCode = 1;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  if (!existsSync(backendRegistryPath)) {
    fail(`Backend registry missing at ${backendRegistryPath}`);
    return;
  }

  if (!existsSync(DEFAULT_MOBILE_MANIFEST_PATH)) {
    fail(
      `Mobile manifest missing at ${DEFAULT_MOBILE_MANIFEST_PATH}. Run: cd iter-ai-mobile && npm run sync:workflows-backend`,
    );
    return;
  }

  const backendRegistry = readJson(backendRegistryPath);
  const mobileManifest = readJson(DEFAULT_MOBILE_MANIFEST_PATH);

  if (!backendRegistry.schemaVersion || !backendRegistry.sourceHash) {
    fail("Backend registry is missing schemaVersion/sourceHash metadata. Re-sync from mobile.");
    return;
  }

  if (backendRegistry.schemaVersion !== mobileManifest.schemaVersion) {
    fail(
      `Schema version mismatch. backend=${backendRegistry.schemaVersion} mobile=${mobileManifest.schemaVersion}`,
    );
    return;
  }

  if (backendRegistry.sourceHash !== mobileManifest.sourceHash) {
    fail("Backend registry is stale compared with mobile manifest sourceHash.");
    console.error("[verify-workflow-registry] backend:", backendRegistry.sourceHash);
    console.error("[verify-workflow-registry] mobile: ", mobileManifest.sourceHash);
    console.error("[verify-workflow-registry] Fix: cd iter-ai-mobile && npm run sync:workflows-backend");
    return;
  }

  if (backendRegistry.workflowCount !== mobileManifest.workflowCount) {
    fail(
      `Workflow count mismatch. backend=${backendRegistry.workflowCount} mobile=${mobileManifest.workflowCount}`,
    );
    return;
  }

  console.log("[verify-workflow-registry] OK", {
    schemaVersion: backendRegistry.schemaVersion,
    sourceHash: backendRegistry.sourceHash,
    workflowCount: backendRegistry.workflowCount,
    generatedAt: backendRegistry.generatedAt,
  });
}

main();
