import test from "node:test";
import assert from "node:assert/strict";

import {
  createDeterministicProjectBrainDecision,
  retrieveProjectBrainDecisionContext,
  validateProjectBrainDecisionContract,
} from "../lib/projects/brain/decision/index.js";

function evidence(overrides = {}) {
  return retrieveProjectBrainDecisionContext({
    project: { id: "project-1", goal: "Complete the objective", updated_at: "2026-07-14" },
    step: {
      id: "step-1",
      title: "Create the useful result",
      expected_outcome: "A visible and useful project result",
      status: "pending",
    },
    workflow: { id: "workflow-1", version: 1 },
    preparation: { missingFields: [] },
    executionDecision: { strategy: "generate_resource", requiresWebSearch: false },
    ...overrides,
  });
}

function decision(overrides = {}) {
  const base = createDeterministicProjectBrainDecision({
    evidence: evidence(),
    decisionId: "decision-1",
    nowIso: "2026-07-14T10:00:00.000Z",
  });
  return { ...base, ...overrides };
}

test("1. valid contract passes", () => {
  assert.deepEqual(validateProjectBrainDecisionContract(decision()), { valid: true, errors: [] });
});

test("2. invalid decision type is rejected", () => {
  const result = validateProjectBrainDecisionContract(decision({ decisionType: "industry_specific" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("invalid_decision_type"));
});

test("3. reuse requires matching evidence", () => {
  const result = validateProjectBrainDecisionContract(
    decision({ decisionType: "reuse_existing_resource" }),
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("reuse_resource_requires_evidence"));
});

test("4. collect_minimal_context requires mustAskUser items", () => {
  const result = validateProjectBrainDecisionContract(
    decision({ decisionType: "collect_minimal_context", missingInformation: [] }),
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("collect_context_requires_question"));
});

test("5. deterministic adapter caps user questions at three", () => {
  const missingFields = Array.from({ length: 5 }, (_, index) => ({
    key: `field_${index}`,
    label: `Field ${index}`,
  }));
  const mapped = createDeterministicProjectBrainDecision({
    evidence: evidence({
      preparation: { missingFields },
      executionDecision: { strategy: "ask_clarification", requiresWebSearch: false },
    }),
  });
  assert.equal(mapped.userEffort.questionsRequired, 3);
  assert.equal(mapped.missingInformation.filter((item) => item.mustAskUser).length, 3);
  assert.ok(mapped.policyCompliance.violations.includes("TOO_MANY_USER_QUESTIONS"));
});

test("6. asked items require material impact", () => {
  const mapped = createDeterministicProjectBrainDecision({
    evidence: evidence({ preparation: { missingFields: [{ key: "budget", label: "Budget" }] } }),
  });
  mapped.missingInformation[0].materialImpact = "";
  const result = validateProjectBrainDecisionContract(mapped);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("asked_item_requires_material_impact"));
});

test("7. generate_directly requires sufficient context", () => {
  const mapped = decision();
  mapped.confidence.contextSufficiency.level = "low";
  const result = validateProjectBrainDecisionContract(mapped);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("generate_directly_requires_sufficient_context"));
});

test("8. research_then_generate requires a research signal", () => {
  const mapped = decision({
    decisionType: "research_then_generate",
    nextAction: { ...decision().nextAction, requiresResearch: false },
  });
  const result = validateProjectBrainDecisionContract(mapped);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("research_decision_requires_signal"));
});

test("9. context_only requires an explanation", () => {
  const mapped = createDeterministicProjectBrainDecision({
    evidence: evidence({ deferState: true }),
  });
  mapped.reasoningSummary = "Later";
  const result = validateProjectBrainDecisionContract(mapped);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("context_only_requires_explanation"));
});

test("10. value-producing decisions require visible value", () => {
  const mapped = decision();
  mapped.resultIntent.createVisibleValue = false;
  const result = validateProjectBrainDecisionContract(mapped);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("value_step_requires_visible_value"));
});
