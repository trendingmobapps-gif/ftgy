import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOrReuseProjectBrainDecision,
  retrieveProjectBrainDecisionContext,
  withProjectBrainDecision,
} from "../lib/projects/brain/decision/index.js";

function evidence(overrides = {}) {
  return retrieveProjectBrainDecisionContext({
    project: { id: "project-1", goal: "Goal", updated_at: "project-v1" },
    step: {
      id: "step-1",
      title: "Step",
      expected_outcome: "Visible output",
      status: "pending",
      updated_at: "step-v1",
    },
    workflow: { id: "workflow-1", version: 1 },
    preparation: { missingFields: [] },
    executionDecision: { strategy: "generate_resource", requiresWebSearch: false },
    ...overrides,
  });
}

test("22. feature-on state persists the decision without replacing prepared input", () => {
  const state = buildOrReuseProjectBrainDecision({
    evidence: evidence(),
    persistedPreparedInput: { retained: "value" },
    logFn: () => {},
  });
  const prepared = withProjectBrainDecision({ retained: "value" }, state);
  assert.equal(prepared.retained, "value");
  assert.equal(prepared._brainDecision.decisionId, state.decision.decisionId);
  assert.equal(prepared._brainDecisionVersion, 1);
  assert.equal(prepared._brainDecisionEvidenceHash, state.evidenceHash);
});

test("23. refresh reuses the same decision when evidence hash is unchanged", () => {
  const currentEvidence = evidence();
  const first = buildOrReuseProjectBrainDecision({
    evidence: currentEvidence,
    persistedPreparedInput: {},
    logFn: () => {},
  });
  const prepared = withProjectBrainDecision({}, first);
  const refreshed = buildOrReuseProjectBrainDecision({
    evidence: evidence(),
    persistedPreparedInput: prepared,
    logFn: () => {},
  });
  assert.equal(refreshed.decisionReused, true);
  assert.equal(refreshed.decision.decisionId, first.decision.decisionId);
});

test("24. relevant evidence version change regenerates the decision", () => {
  const first = buildOrReuseProjectBrainDecision({
    evidence: evidence(),
    persistedPreparedInput: {},
    logFn: () => {},
  });
  const prepared = withProjectBrainDecision({}, first);
  const changed = buildOrReuseProjectBrainDecision({
    evidence: evidence({
      step: {
        id: "step-1",
        title: "Step",
        expected_outcome: "Visible output",
        status: "pending",
        updated_at: "step-v2",
      },
    }),
    persistedPreparedInput: prepared,
    logFn: () => {},
  });
  assert.equal(changed.decisionReused, false);
  assert.notEqual(changed.decision.decisionId, first.decision.decisionId);
});

test("25. invalid persisted decision is regenerated safely", () => {
  const currentEvidence = evidence();
  const regenerated = buildOrReuseProjectBrainDecision({
    evidence: currentEvidence,
    persistedPreparedInput: {
      _brainDecision: { decisionId: "bad", decisionType: "invalid" },
      _brainDecisionVersion: 1,
      _brainDecisionEvidenceHash: currentEvidence.evidenceHash,
    },
    logFn: () => {},
  });
  assert.equal(regenerated.decisionReused, false);
  assert.equal(regenerated.validation.valid, true);
  assert.equal(regenerated.decision.decisionVersion, 1);
});

test("evidence hash contains no raw values and stays deterministic", () => {
  const first = evidence({ memoryMap: new Map([["budget", "SECRET-1000"]]) });
  const second = evidence({ memoryMap: new Map([["budget", "DIFFERENT-SECRET"]]) });
  assert.equal(first.evidenceHash, second.evidenceHash);
  assert.doesNotMatch(first.evidenceHash, /SECRET/);
});

test("memory evidence version changes invalidate the cached decision", () => {
  const first = evidence({
    memoryMap: new Map([["budget", "PRIVATE"]]),
    memoryVersions: new Map([["budget", "memory-v1"]]),
  });
  const second = evidence({
    memoryMap: new Map([["budget", "PRIVATE-UPDATED"]]),
    memoryVersions: new Map([["budget", "memory-v2"]]),
  });
  assert.notEqual(first.evidenceHash, second.evidenceHash);
});
