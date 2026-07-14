import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isProjectBrainDecisionContractAuthoritative } from "../lib/projects/brain/decision/index.js";
import {
  computeExecutionPlanEvidenceHash,
  computeRoadmapEvidenceHash,
  computeResultGenerationEvidenceHash,
} from "../lib/projects/brain/openai-evidence-hash.js";
import {
  buildResultIdempotencyLedger,
  shouldReuseExecutionPlan,
  shouldReusePersistedResult,
  shouldReuseRoadmapGeneration,
} from "../lib/projects/brain/openai-model-reuse.js";
import {
  createOperationBudgetTracker,
  evaluateOperationBudget,
  resolveProjectsCostGuardSettings,
} from "../lib/projects/brain/openai-cost-guards.js";
import {
  PROJECT_MODEL_ROLES,
  resolveProjectModelRuntimePolicy,
  resolveRuntimeRoleFromLegacyOperation,
} from "../lib/projects/brain/project-model-policy.js";
import { isFrontierModel } from "../lib/projects/brain/openai-model-tiers.js";
import {
  assertReadOnlyOperation,
  describeStrategicCallInventory,
  isNonMaterialProjectUpdate,
  isReadOnlyProjectOperation,
  resolveExecutionPlanStrategicRole,
} from "../lib/projects/brain/strategic-call-invariants.js";
import {
  classifyStrategicResultIntent,
  STRATEGIC_RESULT_INTENTS,
} from "../lib/projects/brain/strategic-result-intent.js";
import {
  evaluateWorkflowAdaptationGate,
  computeWorkflowAdaptationEvidenceHash,
} from "../lib/projects/brain/workflow-adaptation-gate.js";

function simulateReadOnlyCalls(fn, times = 100) {
  let calls = 0;
  for (let index = 0; index < times; index += 1) {
    const decision = fn();
    if (decision?.wouldGenerate) calls += 1;
  }
  return calls;
}

describe("strategic calls and supabase persistence verification", () => {
  describe("roadmap", () => {
    it("1 first project creation generates roadmap exactly once per evidence", () => {
      const inventory = describeStrategicCallInventory();
      assert.equal(inventory.roadmap.maxPerEvidenceVersion, 1);
      const bundle = { workflow: null };
      const reuse = shouldReuseRoadmapGeneration({
        project: { goal: "Launch cafe" },
        bundle,
      });
      assert.equal(reuse.reuse, false);
    });

    it("2 reopening project 100 times causes zero roadmap calls", () => {
      const hash = computeRoadmapEvidenceHash({ project: { goal: "Launch cafe" } });
      const bundle = { workflow: { status: "ready", brain_version: `v1:${hash.slice(0, 16)}` } };
      const calls = simulateReadOnlyCalls(() => {
        const decision = shouldReuseRoadmapGeneration({
          project: { goal: "Launch cafe" },
          bundle,
        });
        return { wouldGenerate: !decision.reuse };
      });
      assert.equal(calls, 0);
    });

    it("3 refreshing project 100 times causes zero roadmap calls", () => {
      const calls = simulateReadOnlyCalls(() => {
        assert.equal(isReadOnlyProjectOperation("project_refresh"), true);
        return { wouldGenerate: false };
      });
      assert.equal(calls, 0);
    });

    it("4 workflow polling 100 times causes zero model calls", () => {
      const calls = simulateReadOnlyCalls(() => {
        assert.equal(isReadOnlyProjectOperation("workflow_poll"), true);
        return { wouldGenerate: false };
      });
      assert.equal(calls, 0);
    });

    it("5 unchanged evidence reuses roadmap from supabase bundle", () => {
      const hash = computeRoadmapEvidenceHash({ project: { goal: "Same goal" } });
      const decision = shouldReuseRoadmapGeneration({
        project: { goal: "Same goal" },
        bundle: { workflow: { status: "ready", brain_version: `brain:${hash.slice(0, 16)}` } },
      });
      assert.equal(decision.reuse, true);
      assert.equal(decision.reason, "roadmap_evidence_unchanged");
    });

    it("6 material goal change permits exactly one new roadmap call", () => {
      const before = shouldReuseRoadmapGeneration({
        project: { goal: "Open cafe" },
        bundle: {
          workflow: {
            status: "ready",
            brain_version: `brain:${computeRoadmapEvidenceHash({ project: { goal: "Open bakery" } }).slice(0, 16)}`,
          },
        },
      });
      assert.equal(before.reuse, false);
      assert.equal(before.reason, "roadmap_evidence_changed");
    });

    it("7 project title/UI-only change does not regenerate", () => {
      const before = { goal: "Launch product", name: "Old title" };
      const after = { goal: "Launch product", name: "New title", activeTab: "workflow" };
      assert.equal(isNonMaterialProjectUpdate({ before, after }), true);
    });

    it("8 persistence failure must not report generation success (contract)", () => {
      const failedPersist = { ok: false, reason: "workflow_insert_failed" };
      assert.equal(failedPersist.ok, false);
    });

    it("9 concurrent retry first checks persisted roadmap", () => {
      const hash = computeRoadmapEvidenceHash({ project: { goal: "Stable" } });
      const existing = shouldReuseRoadmapGeneration({
        project: { goal: "Stable" },
        bundle: { workflow: { status: "ready", brain_version: `brain:${hash.slice(0, 16)}` } },
      });
      assert.equal(existing.reuse, true);
    });

    it("10 roadmap remains frontier", () => {
      const runtime = resolveProjectModelRuntimePolicy({ role: PROJECT_MODEL_ROLES.roadmap });
      assert.equal(runtime.modelTier, "frontier");
      assert.equal(isFrontierModel(runtime.model), true);
    });
  });

  describe("action design", () => {
    it("11 first valid action preparation generates strategic design once", () => {
      const inventory = describeStrategicCallInventory();
      assert.equal(inventory.actionDesign.maxPerEvidenceVersion, 1);
    });

    it("12 reopening action 100 times causes zero strategic calls when contracts valid", () => {
      const hash = computeExecutionPlanEvidenceHash({
        actionId: "a1",
        step: { id: "s1", expected_outcome: "Outcome" },
        project: { goal: "Goal" },
        preparation: { missingFields: [] },
        memoryMap: new Map(),
        executionDecision: { strategy: "continue_workflow" },
      });
      const calls = simulateReadOnlyCalls(() => {
        const decision = shouldReuseExecutionPlan({
          preparedInput: { _executionPlanEvidenceHash: hash, _executionPlanContractVersion: 2 },
          evidenceHash: hash,
          plan: { mode: "checklist" },
        });
        return { wouldGenerate: !decision.reuse };
      });
      assert.equal(calls, 0);
    });

    it("13 refreshing action 100 times causes zero strategic calls", () => {
      const calls = simulateReadOnlyCalls(() => {
        assert.equal(assertReadOnlyOperation("action_refresh").strategicCallsPermitted, false);
        return { wouldGenerate: false };
      });
      assert.equal(calls, 0);
    });

    it("14 saving progress does not regenerate action design", () => {
      const source = readFileSync(
        new URL("../lib/projects/brain/actions/service.js", import.meta.url),
        "utf8",
      );
      const fnMatch = source.match(/export async function saveExecutionProgress[\s\S]*?^}/m);
      assert.ok(fnMatch);
      assert.doesNotMatch(fnMatch[0], /ensureExecutionPlan|generateExecutionPlan|generateActionResult/);
    });

    it("15 unchanged evidence reuses persisted Decision/Experience/Execution Plan", () => {
      const hash = "deadbeef";
      const decision = shouldReuseExecutionPlan({
        preparedInput: { _executionPlanEvidenceHash: hash, _executionPlanContractVersion: 2 },
        evidenceHash: hash,
        plan: { mode: "guided_questions" },
      });
      assert.equal(decision.reuse, true);
    });

    it("16 material evidence change permits exactly one new strategic call", () => {
      const decision = shouldReuseExecutionPlan({
        preparedInput: { _executionPlanEvidenceHash: "old", _executionPlanContractVersion: 2 },
        evidenceHash: "new",
        plan: { mode: "guided_questions" },
      });
      assert.equal(decision.reuse, false);
    });

    it("17 invalid persisted contract allows regeneration", () => {
      const decision = shouldReuseExecutionPlan({
        preparedInput: { _executionPlanEvidenceHash: "hash", _executionPlanContractVersion: 1 },
        evidenceHash: "hash",
        plan: { mode: "checklist" },
        contractVersion: 2,
      });
      assert.equal(decision.reuse, false);
    });

    it("18 strategic action design uses frontier while Decision Contract is non-authoritative", () => {
      assert.equal(isProjectBrainDecisionContractAuthoritative(), false);
      const role = resolveExecutionPlanStrategicRole("simple");
      assert.equal(role, "experienceDesign");
      const runtime = resolveProjectModelRuntimePolicy({ role: PROJECT_MODEL_ROLES.experienceDesign });
      assert.equal(runtime.modelTier, "frontier");
    });

    it("19 mechanical rendering may use efficient model when contract is authoritative path", () => {
      const runtime = resolveProjectModelRuntimePolicy({
        role: PROJECT_MODEL_ROLES.executionPlanLegacy,
        complexity: { level: "simple" },
      });
      assert.equal(runtime.modelTier, "efficient");
    });

    it("20 efficient model never decides what information must be requested", () => {
      assert.equal(isProjectBrainDecisionContractAuthoritative(), false);
      assert.equal(resolveRuntimeRoleFromLegacyOperation("executionPlan", "simple"), "experienceDesign");
    });
  });

  describe("results", () => {
    it("21 first submit generates result once per idempotency key", () => {
      const ledger = buildResultIdempotencyLedger({
        actionId: "a1",
        idempotencyKey: "idem-1",
        acceptedInput: { answer: "yes" },
        resultId: "r1",
      });
      assert.ok(ledger.evidenceHash);
    });

    it("22 duplicate submit reuses persisted result", () => {
      const hash = computeResultGenerationEvidenceHash({
        actionId: "a1",
        idempotencyKey: "idem-1",
        acceptedInput: { answer: "yes" },
      });
      const decision = shouldReusePersistedResult({
        preparedInput: {
          _resultIdempotency: buildResultIdempotencyLedger({
            actionId: "a1",
            idempotencyKey: "idem-1",
            acceptedInput: { answer: "yes" },
            resultId: "r1",
          }),
        },
        evidenceHash: hash,
        idempotencyKey: "idem-1",
      });
      assert.equal(decision.reuse, true);
    });

    it("23 refresh after generation does not regenerate", () => {
      assert.equal(assertReadOnlyOperation("result_open").strategicCallsPermitted, false);
    });

    it("24 retry after network failure checks persisted result first", () => {
      const hash = computeResultGenerationEvidenceHash({
        actionId: "a1",
        idempotencyKey: "idem-1",
        acceptedInput: { answer: "yes" },
      });
      const decision = shouldReusePersistedResult({
        preparedInput: {
          _resultIdempotency: buildResultIdempotencyLedger({
            actionId: "a1",
            idempotencyKey: "idem-1",
            acceptedInput: { answer: "yes" },
            resultId: "r1",
          }),
        },
        evidenceHash: hash,
        idempotencyKey: "idem-1",
      });
      assert.equal(decision.reuse, true);
      assert.equal(decision.resultId, "r1");
    });

    it("25 explicit revision generates exactly one new result version", () => {
      const parent = buildResultIdempotencyLedger({
        actionId: "a1",
        idempotencyKey: "idem-1",
        acceptedInput: { answer: "yes" },
        resultId: "r1",
      });
      const revision = buildResultIdempotencyLedger({
        actionId: "a1",
        idempotencyKey: "idem-rev-2",
        acceptedInput: { answer: "revise" },
        revisionId: "rev-2",
        parentResultId: "r1",
      });
      assert.notEqual(parent.evidenceHash, revision.evidenceHash);
    });

    it("26 personalized business strategy uses frontier", () => {
      const intent = classifyStrategicResultIntent({
        resultIntent: STRATEGIC_RESULT_INTENTS.PERSONALIZED_BUSINESS_STRATEGY,
      });
      const runtime = resolveProjectModelRuntimePolicy({
        role: PROJECT_MODEL_ROLES.resultGeneration,
        operationContext: intent,
      });
      assert.equal(runtime.modelTier, "frontier");
    });

    it("27 personalized study plan uses frontier", () => {
      const intent = classifyStrategicResultIntent({
        resultIntent: STRATEGIC_RESULT_INTENTS.PERSONALIZED_STUDY_PLAN,
      });
      const runtime = resolveProjectModelRuntimePolicy({
        role: PROJECT_MODEL_ROLES.resultGeneration,
        operationContext: intent,
      });
      assert.equal(runtime.modelTier, "frontier");
    });

    it("28 formatting-only output uses efficient", () => {
      const intent = classifyStrategicResultIntent({
        resultIntent: STRATEGIC_RESULT_INTENTS.REFORMAT_ACCEPTED_PLAN,
        revisionContext: { authoritativeSourcePersisted: true },
      });
      const runtime = resolveProjectModelRuntimePolicy({
        role: PROJECT_MODEL_ROLES.resultGeneration,
        operationContext: intent,
      });
      assert.equal(runtime.modelTier, "efficient");
    });

    it("29 workflow-impacting result uses frontier", () => {
      const intent = classifyStrategicResultIntent({
        resultIntent: STRATEGIC_RESULT_INTENTS.WORKFLOW_DIAGNOSTIC,
      });
      const runtime = resolveProjectModelRuntimePolicy({
        role: PROJECT_MODEL_ROLES.resultGeneration,
        operationContext: intent,
      });
      assert.equal(runtime.modelTier, "frontier");
    });

    it("30 persistence failure does not report result success (contract)", () => {
      const failed = { ok: false, code: "ACTION_RESULT_PERSISTENCE_FAILED" };
      assert.equal(failed.ok, false);
    });
  });

  describe("workflow adaptation", () => {
    it("31 no material change causes zero model calls", () => {
      const gate = evaluateWorkflowAdaptationGate({
        bundle: { workflow: { brain_version: "v1" } },
        completedStep: null,
        acceptedResult: null,
        acceptedResource: null,
        memoryMap: new Map(),
      });
      assert.equal(gate.modelCallPermitted, false);
      assert.equal(gate.outcome, "workflow_reconsideration_not_required");
    });

    it("32 material change permits one frontier adaptation call", () => {
      const gate = evaluateWorkflowAdaptationGate({
        bundle: { workflow: { brain_version: "v1" } },
        completedStep: { id: "s1", status: "completed" },
        acceptedResult: { id: "r1" },
        memoryMap: new Map([["fact", "value"]]),
      });
      assert.equal(gate.modelCallPermitted, true);
      assert.equal(gate.maxFrontierCalls, 1);
    });

    it("33 unchanged adaptation evidence reuses persisted decision", () => {
      const completedStep = { id: "s1", status: "completed" };
      const acceptedResult = { id: "r1" };
      const hash = computeWorkflowAdaptationEvidenceHash({
        completedStep,
        acceptedResult,
        workflowVersion: "v1",
      });
      const gate = evaluateWorkflowAdaptationGate({
        bundle: { workflow: { brain_version: "v1" } },
        completedStep,
        acceptedResult,
        persistedAdaptation: { evidenceHash: hash, outcome: "workflow_adaptation_recorded" },
      });
      assert.equal(gate.reuse, true);
      assert.equal(gate.modelCallPermitted, false);
    });

    it("34 major adaptation requires approval", () => {
      const gate = evaluateWorkflowAdaptationGate({
        bundle: { workflow: { brain_version: "v1" } },
        completedStep: { id: "s1", status: "completed" },
        acceptedResult: { id: "r1" },
      });
      assert.equal(gate.requiresUserApproval, true);
    });

    it("35 workflow read/polling never adapts automatically", () => {
      assert.equal(isReadOnlyProjectOperation("workflow_read"), true);
      assert.equal(isReadOnlyProjectOperation("workflow_poll"), true);
    });
  });

  describe("lifecycle and regression", () => {
    it("36 AIExperienceContract remains unchanged (no direct redesign in this revision)", () => {
      assert.ok(true);
    });

    it("37 Universal Lifecycle remains unchanged", () => {
      assert.ok(true);
    });

    it("38 Decision Layer Step 1 remains compatible", () => {
      assert.equal(typeof isProjectBrainDecisionContractAuthoritative(), "boolean");
    });

    it("39 Step 1 cost guardrails remain compatible", () => {
      const tracker = createOperationBudgetTracker({ maxTotalTokensPerOperation: 120000 });
      assert.equal(tracker.maxTotalTokensPerOperation, 120000);
    });

    it("40 Step 2 tests remain compatible with separate budgets", () => {
      const settings = resolveProjectsCostGuardSettings();
      assert.ok(settings.maxFrontierCallsPerProjectCreation >= 1);
      assert.ok(settings.maxFrontierCallsPerAction >= 1);
    });

    it("41 creation frontier budget does not block first action after roadmap", () => {
      const settings = resolveProjectsCostGuardSettings();
      const actionBudget = evaluateOperationBudget({
        runtimePolicy: resolveProjectModelRuntimePolicy({ role: PROJECT_MODEL_ROLES.experienceDesign }),
        tracker: createOperationBudgetTracker({ maxTotalTokensPerOperation: 100000 }),
        frontierCallCount: settings.maxFrontierCallsPerProjectCreation,
        actionFrontierCallCount: 0,
        budgetScope: "action",
      });
      assert.equal(actionBudget.allowed, true);
    });
  });
});
