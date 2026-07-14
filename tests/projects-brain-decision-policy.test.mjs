import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildOrReuseProjectBrainDecision,
  isProjectBrainDecisionLayerEnabled,
  retrieveProjectBrainDecisionContext,
  serializeProjectBrainDecisionDiagnostics,
  serializeSafeProjectBrainDecision,
} from "../lib/projects/brain/decision/index.js";

function buildState() {
  const evidence = retrieveProjectBrainDecisionContext({
    project: { id: "project-1", goal: "Complete goal" },
    step: { id: "step-1", title: "Create result", expected_outcome: "Visible result" },
    workflow: { id: "workflow-1" },
    memoryMap: new Map([["private_key", "PRIVATE MEMORY VALUE"]]),
    preparation: { missingFields: [] },
    executionDecision: { strategy: "generate_resource", requiresWebSearch: false },
  });
  const state = buildOrReuseProjectBrainDecision({
    evidence,
    persistedPreparedInput: {},
    logFn: () => {},
  });
  return { evidence, state };
}

test("21. feature flag off preserves legacy behavior", () => {
  assert.equal(isProjectBrainDecisionLayerEnabled({}), false);
  assert.equal(isProjectBrainDecisionLayerEnabled({ PROJECT_BRAIN_DECISION_LAYER_ENABLED: "false" }), false);
  assert.equal(isProjectBrainDecisionLayerEnabled({ PROJECT_BRAIN_DECISION_LAYER_ENABLED: "true" }), true);
});

test("policy violations are persisted on the contract", () => {
  const evidence = retrieveProjectBrainDecisionContext({
    project: { id: "project-1", goal: "Goal" },
    step: { id: "step-1", title: "Step" },
    workflow: { id: "workflow-1" },
    preparation: {
      missingFields: Array.from({ length: 4 }, (_, index) => ({
        key: `field_${index}`,
        label: `Field ${index}`,
      })),
    },
    executionDecision: { strategy: "ask_clarification", requiresWebSearch: false },
  });
  const { decision } = buildOrReuseProjectBrainDecision({
    evidence,
    persistedPreparedInput: {},
    logFn: () => {},
  });
  assert.ok(decision.policyCompliance.violations.includes("TOO_MANY_USER_QUESTIONS"));
  assert.ok(decision.policyCompliance.violations.includes("LEGACY_FALLBACK_FORM_BIAS"));
});

test("26. prepare metadata serializer exposes only the safe envelope", () => {
  const { state } = buildState();
  const safe = serializeSafeProjectBrainDecision(state.decision);
  assert.deepEqual(Object.keys(safe), [
    "decisionId",
    "decisionVersion",
    "decisionType",
    "reasoningSummary",
    "userEffort",
    "resultIntent",
    "workflowImpact",
    "policyCompliance",
  ]);
  assert.equal("knownContext" in safe, false);
  assert.equal("confidence" in safe, false);
  assert.equal("safety" in safe, false);
  assert.equal("modelMetadata" in safe, false);
});

test("27. diagnostics never log raw context", () => {
  const { evidence, state } = buildState();
  const diagnostics = serializeProjectBrainDecisionDiagnostics({
    decision: state.decision,
    evidence,
    decisionReused: false,
    featureFlagEnabled: true,
  });
  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(serialized, /PRIVATE MEMORY VALUE/);
  assert.equal("knownContext" in diagnostics, false);
  assert.equal("objective" in diagnostics, false);
  assert.equal("reasoningSummary" in diagnostics, false);
});

test("28. AIExperienceContract adapter remains plan-driven", async () => {
  const source = await readFile(
    new URL("../lib/projects/brain/execution/interactive.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /adaptExecutionPlanToExperience/);
  assert.doesNotMatch(source, /DecisionToExperience|decisionToExperience/);
});

test("service invokes Decision Layer only behind the single feature flag", async () => {
  const source = await readFile(
    new URL("../lib/projects/brain/actions/service.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /isProjectBrainDecisionLayerEnabled\(\)/);
  assert.match(source, /prepareDeterministicBrainDecision/);
  assert.match(source, /withProjectBrainDecision/);
  assert.doesNotMatch(source, /PROJECT_BRAIN_DECISION_MODEL_ENABLED/);
});
