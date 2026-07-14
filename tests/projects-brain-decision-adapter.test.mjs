import test from "node:test";
import assert from "node:assert/strict";

import {
  createDeterministicProjectBrainDecision,
  retrieveProjectBrainDecisionContext,
} from "../lib/projects/brain/decision/index.js";

function build(overrides = {}) {
  const evidence = retrieveProjectBrainDecisionContext({
    project: { id: "project-1", goal: "Launch the project" },
    step: { id: "step-1", title: "Prepare result", expected_outcome: "Useful result", status: "pending" },
    workflow: { id: "workflow-1", version: 1 },
    memoryMap: new Map(),
    resultsByStepId: new Map(),
    preparation: { missingFields: [] },
    executionDecision: { strategy: "generate_resource", requiresWebSearch: false },
    ...overrides,
  });
  return {
    evidence,
    decision: createDeterministicProjectBrainDecision({ evidence }),
  };
}

test("11. memory is recorded as checked before asking", () => {
  const { decision } = build({
    memoryMap: new Map([["budget", "private-value-not-exposed"]]),
    preparation: { missingFields: [{ key: "location", label: "Location" }] },
  });
  assert.equal(decision.policyCompliance.contextReuseChecked, true);
  assert.ok(!decision.policyCompliance.violations.includes("MEMORY_NOT_CHECKED"));
  assert.deepEqual(decision.knownContext.memoryRefs.map((ref) => ref.id), ["budget"]);
  assert.doesNotMatch(JSON.stringify(decision.knownContext), /private-value-not-exposed/);
});

test("12. resources are checked before asking", () => {
  const { decision } = build({
    reusableResource: { id: "resource-1", title: "Existing result", type: "markdown" },
    preparation: { missingFields: [{ key: "location", label: "Location" }] },
    executionDecision: { strategy: "reuse_resource", requiresWebSearch: false },
  });
  assert.equal(decision.decisionType, "reuse_existing_resource");
  assert.ok(!decision.policyCompliance.violations.includes("RESOURCES_NOT_CHECKED"));
});

test("13. accepted results are checked before asking", () => {
  const result = {
    id: "result-1",
    step_id: "step-1",
    title: "Useful result",
    preview: "Safe preview",
    acceptance_status: "accepted",
  };
  const { decision } = build({
    resultsByStepId: new Map([["step-1", result]]),
    preparation: { missingFields: [{ key: "location", label: "Location" }] },
  });
  assert.equal(decision.decisionType, "reuse_existing_result");
  assert.ok(!decision.policyCompliance.violations.includes("RESULTS_NOT_CHECKED"));
});

test("14. reusable resource maps to reuse_existing_resource", () => {
  const { decision } = build({
    reusableResource: { id: "resource-1", title: "Resource", type: "markdown" },
  });
  assert.equal(decision.decisionType, "reuse_existing_resource");
  assert.equal(decision.resultIntent.createResource, false);
});

test("15. reusable accepted result maps to reuse_existing_result", () => {
  const { decision } = build({
    resultsByStepId: new Map([
      [
        "step-1",
        {
          id: "result-1",
          step_id: "step-1",
          title: "Result",
          acceptance_status: "accepted",
        },
      ],
    ]),
  });
  assert.equal(decision.decisionType, "reuse_existing_result");
});

test("16. no material missing information maps to generate_directly", () => {
  assert.equal(build().decision.decisionType, "generate_directly");
});

test("17. material missing facts map to collect_minimal_context", () => {
  const { decision } = build({
    preparation: {
      missingFields: [
        { key: "budget", label: "Budget" },
        { key: "deadline", label: "Deadline" },
      ],
    },
    executionDecision: { strategy: "ask_clarification", requiresWebSearch: false },
  });
  assert.equal(decision.decisionType, "collect_minimal_context");
  assert.equal(decision.userEffort.questionsRequired, 2);
});

test("18. explicit external action maps to request_external_user_action", () => {
  assert.equal(build({ externalActionRequired: true }).decision.decisionType, "request_external_user_action");
});

test("19. verification-only evidence maps to verify_completion", () => {
  assert.equal(build({ verificationOnly: true }).decision.decisionType, "verify_completion");
});

test("20. blocked evidence maps conservatively", () => {
  const { decision } = build({ safetyStatus: "blocked" });
  assert.equal(decision.decisionType, "unsupported_or_blocked");
  assert.equal(decision.safety.status, "blocked");
});

test("research signal is evaluated before remaining questions", () => {
  const { decision } = build({
    preparation: { missingFields: [{ key: "current_data", label: "Current data" }] },
    executionDecision: { strategy: "web_then_generate", requiresWebSearch: true },
  });
  assert.equal(decision.decisionType, "research_then_generate");
  assert.equal(decision.userEffort.questionsRequired, 0);
});

test("workflow redundancy and defer states map without goal-specific rules", () => {
  assert.equal(
    build({ workflowRedundancy: { stepId: "step-2", reason: "Already covered" } }).decision.decisionType,
    "propose_workflow_change",
  );
  assert.equal(build({ deferState: true }).decision.decisionType, "pause_or_defer");
});
