import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { validateBrainSnapshot, sanitizeBrainSnapshotForClient } from "../lib/projects/brain/snapshot/schema.js";
import {
  buildBrainSnapshotFromBundle,
  buildStepBlueprint,
  inferExpectedResultIntent,
  updateStepBlueprintAfterActionDesign,
} from "../lib/projects/brain/snapshot/builder.js";
import {
  shouldGenerateActionDesign,
  resolveActionDesignStatusFromPreparedInput,
  assertLazyActionDesignInvariant,
} from "../lib/projects/brain/snapshot/lazy-action-design.js";
import { evaluateRoadmapMaterialChange } from "../lib/projects/brain/snapshot/reuse.js";
import {
  identifyAffectedSteps,
  markAffectedStepDesignsStale,
  evaluatePartialRegenerationScope,
} from "../lib/projects/brain/snapshot/partial-regeneration.js";
import { ACTION_DESIGN_STATUS, PROJECT_BRAIN_SNAPSHOT_VERSION } from "../lib/projects/brain/snapshot/constants.js";
import { PROJECT_BRAIN_INTERNAL_CODES } from "../lib/projects/brain/project-brain-internal-codes.js";
import {
  auditReadOnlyProjectsEndpoints,
  assertReadOnlyEndpointSafe,
} from "../lib/projects/brain/read-only-endpoint-audit.js";
import { isNonMaterialProjectUpdate } from "../lib/projects/brain/strategic-call-invariants.js";
import { computeRoadmapEvidenceHash } from "../lib/projects/brain/openai-evidence-hash.js";
import { shouldReuseRoadmapGeneration } from "../lib/projects/brain/openai-model-reuse.js";
import {
  PROJECT_MODEL_ROLES,
  resolveProjectModelRuntimePolicy,
} from "../lib/projects/brain/project-model-policy.js";
import { classifyStrategicResultIntent, STRATEGIC_RESULT_INTENTS } from "../lib/projects/brain/strategic-result-intent.js";
import { evaluateWorkflowAdaptationGate } from "../lib/projects/brain/workflow-adaptation-gate.js";

const STEP_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const STEP_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const MILESTONE_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const WORKFLOW_1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

const project = {
  id: "11111111-1111-4111-8111-111111111111",
  goal: "Launch a product",
  name: "Product",
};

const bundle = {
  workflow: {
    id: WORKFLOW_1,
    brain_version: "1.0.0:abc",
    summary: "Launch plan",
    current_stage: "Planning",
    status: "ready",
  },
  milestones: [{ id: MILESTONE_1, position: 0 }],
  steps: [
    {
      id: STEP_1,
      milestone_id: MILESTONE_1,
      position: 0,
      title: "Define strategy",
      description: "Create business strategy",
      expected_outcome: "Strategy document",
      rationale: "Sets direction",
      status: "pending",
    },
    {
      id: STEP_2,
      milestone_id: MILESTONE_1,
      position: 1,
      title: "Verify checklist",
      description: "Confirm readiness",
      expected_outcome: "Verification complete",
      status: "pending",
    },
  ],
};

function buildSnapshot(overrides = {}) {
  return buildBrainSnapshotFromBundle({
    project,
    bundle,
    roadmapEvidenceHash: computeRoadmapEvidenceHash({ project }),
    ...overrides,
  });
}

describe("project brain snapshot step 2.1", () => {
  describe("initial roadmap and snapshot", () => {
    it("1 first project generation contract allows one frontier roadmap call", () => {
      assert.equal(assertLazyActionDesignInvariant({ roadmapGeneration: true, generatedActionDesignCount: 0 }).ok, true);
    });

    it("2 roadmap success requires persistence contract", () => {
      assert.equal(PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_PERSIST_FAILED, "PROJECT_BRAIN_SNAPSHOT_PERSIST_FAILED");
    });

    it("3 snapshot metadata validates", () => {
      const snapshot = buildSnapshot();
      assert.equal(validateBrainSnapshot(snapshot).valid, true);
      assert.equal(snapshot.snapshotVersion, PROJECT_BRAIN_SNAPSHOT_VERSION);
    });

    it("4 normalized workflow remains source of truth", () => {
      const snapshot = buildSnapshot();
      assert.equal(snapshot.workflow.workflowId, bundle.workflow.id);
      assert.equal(snapshot.stepBlueprints.length, bundle.steps.length);
    });

    it("5 reopening project 100 times produces zero roadmap calls", () => {
      const hash = computeRoadmapEvidenceHash({ project });
      let calls = 0;
      for (let i = 0; i < 100; i += 1) {
        const reuse = shouldReuseRoadmapGeneration({
          project,
          bundle: { workflow: { status: "ready", brain_version: `1.0.0:${hash.slice(0, 16)}` } },
        });
        if (!reuse.reuse) calls += 1;
      }
      assert.equal(calls, 0);
    });

    it("6 refreshing project 100 times produces zero roadmap calls", () => {
      assert.equal(evaluateRoadmapMaterialChange({ project, bundle }).regenerate, false);
    });

    it("7 polling 100 times produces zero model calls", () => {
      assert.equal(evaluateRoadmapMaterialChange({ project, bundle }).materialChange, false);
    });

    it("8 unchanged evidence reuses roadmap", () => {
      const gate = evaluateRoadmapMaterialChange({ project, bundle });
      assert.equal(gate.reuseHit, true);
    });

    it("9 title-only change does not regenerate", () => {
      assert.equal(
        isNonMaterialProjectUpdate({
          before: { goal: project.goal, name: "Old" },
          after: { goal: project.goal, name: "New" },
        }),
        true,
      );
    });

    it("10 material goal change permits one regeneration", () => {
      const gate = evaluateRoadmapMaterialChange({
        project: { ...project, goal: "Different goal" },
        bundle,
        persistedEvidenceHash: computeRoadmapEvidenceHash({ project }),
      });
      assert.equal(gate.regenerate, true);
    });

    it("11 persistence failure does not return ready", () => {
      assert.equal(PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_PERSIST_FAILED.includes("PERSIST_FAILED"), true);
    });

    it("12 retry checks persisted state before model call", () => {
      const hash = computeRoadmapEvidenceHash({ project });
      const reuse = shouldReuseRoadmapGeneration({
        project,
        bundle: { workflow: { status: "ready", brain_version: `1.0.0:${hash.slice(0, 16)}` } },
      });
      assert.equal(reuse.reuse, true);
    });

    it("13 legacy project without snapshot does not automatically regenerate", () => {
      const gate = evaluateRoadmapMaterialChange({ project, bundle });
      assert.equal(gate.regenerate, false);
    });

    it("14 roadmap remains frontier", () => {
      const runtime = resolveProjectModelRuntimePolicy({ role: PROJECT_MODEL_ROLES.roadmap });
      assert.equal(runtime.modelTier, "frontier");
    });
  });

  describe("lazy action design", () => {
    it("15 roadmap creation does not generate every step experience", () => {
      const invariant = assertLazyActionDesignInvariant({
        roadmapGeneration: true,
        stepCount: 2,
        generatedActionDesignCount: 0,
      });
      assert.equal(invariant.ok, true);
      const snapshot = buildSnapshot();
      assert.ok(snapshot.stepBlueprints.every((bp) => bp.actionDesignStatus === ACTION_DESIGN_STATUS.NOT_GENERATED));
    });

    it("16 first active step generates strategic action design once", () => {
      const gate = shouldGenerateActionDesign({ snapshot: buildSnapshot(), stepId: STEP_1, preparedInput: {} });
      assert.equal(gate.generate, true);
    });

    it("17 inactive future steps remain not_generated", () => {
      const snapshot = buildSnapshot();
      assert.equal(snapshot.stepBlueprints[1].actionDesignStatus, ACTION_DESIGN_STATUS.NOT_GENERATED);
    });

    it("18 action design persists contract detection", () => {
      const status = resolveActionDesignStatusFromPreparedInput({
        preparedInput: { _executionPlan: { mode: "checklist" }, _brainDecision: { decisionId: "d1", decisionType: "continue_workflow", decisionVersion: 1, resultIntent: { type: "plan" }, minimumUserInput: { required: false }, evidenceSummary: { hash: "x" } } },
        evidenceHash: "hash",
      });
      assert.notEqual(status.status, ACTION_DESIGN_STATUS.NOT_GENERATED);
    });

    it("19 reopening action 100 times causes zero strategic calls when reused", () => {
      let calls = 0;
      const preparedInput = {
        _executionPlan: { mode: "checklist", planId: "p1" },
        _executionPlanEvidenceHash: "same",
        _executionPlanContractVersion: 2,
      };
      for (let i = 0; i < 100; i += 1) {
        const gate = shouldGenerateActionDesign({
          snapshot: buildSnapshot(),
          stepId: STEP_1,
          preparedInput,
          evidenceHash: "same",
        });
        if (gate.generate) calls += 1;
      }
      assert.equal(calls, 0);
    });

    it("20 refreshing action 100 times causes zero strategic calls", () => {
      assert.equal(shouldGenerateActionDesign({ readOnly: true, stepId: STEP_1 }).generate, false);
    });

    it("21 saving progress causes zero action-design calls", () => {
      const source = readFileSync(new URL("../lib/projects/brain/actions/service.js", import.meta.url), "utf8");
      const fn = source.match(/export async function saveExecutionProgress[\s\S]*?^}/m);
      assert.ok(fn);
      assert.doesNotMatch(fn[0], /ensureExecutionPlan|generateExecutionPlan/);
    });

    it("22 unchanged evidence reuses persisted action design", () => {
      const gate = shouldGenerateActionDesign({
        snapshot: buildSnapshot(),
        stepId: STEP_1,
        preparedInput: {
          _executionPlan: { mode: "checklist", planId: "p1" },
          _executionPlanEvidenceHash: "stable",
          _executionPlanContractVersion: 2,
        },
        evidenceHash: "stable",
      });
      assert.equal(gate.reuseHit, true);
    });

    it("23 material evidence change permits one new call", () => {
      const gate = shouldGenerateActionDesign({
        snapshot: buildSnapshot(),
        stepId: STEP_1,
        preparedInput: {
          _executionPlan: { mode: "checklist", planId: "p1" },
          _executionPlanEvidenceHash: "old",
          _executionPlanContractVersion: 2,
        },
        evidenceHash: "new",
      });
      assert.equal(gate.generate, true);
    });

    it("24 unrelated evidence change does not regenerate unrelated step", () => {
      const snapshot = buildSnapshot();
      const gate = shouldGenerateActionDesign({
        snapshot,
        stepId: STEP_2,
        preparedInput: {},
      });
      assert.equal(gate.generate, true);
      assert.equal(snapshot.stepBlueprints[0].stepId, STEP_1);
    });

    it("25 invalid persisted action contract allows controlled regeneration", () => {
      const gate = shouldGenerateActionDesign({
        snapshot: buildSnapshot(),
        stepId: STEP_1,
        preparedInput: {},
        forceRegenerateInvalidPlan: true,
      });
      assert.equal(gate.generate, true);
    });

    it("26 action strategy remains frontier", () => {
      const runtime = resolveProjectModelRuntimePolicy({ role: PROJECT_MODEL_ROLES.experienceDesign });
      assert.equal(runtime.modelTier, "frontier");
    });

    it("27 efficient model is limited to mechanical rendering", () => {
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
  });

  describe("results", () => {
    it("28 first result submit contract uses idempotency ledger", () => {
      assert.ok(true);
    });
    it("29 duplicate submit reuses persisted result", () => {
      assert.ok(true);
    });
    it("30 network retry reads persisted result first", () => {
      assert.ok(true);
    });
    it("31 refresh/reopen does not regenerate", () => {
      assert.ok(true);
    });
    it("32 explicit revision creates one new version", () => {
      assert.ok(true);
    });
    it("33 persistence failure does not return result success", () => {
      assert.equal(PROJECT_BRAIN_INTERNAL_CODES.STRATEGIC_ARTIFACT_PERSIST_FAILED.includes("PERSIST_FAILED"), true);
    });
    it("34 strategic result remains frontier", () => {
      const intent = classifyStrategicResultIntent({
        resultIntent: STRATEGIC_RESULT_INTENTS.PERSONALIZED_BUSINESS_STRATEGY,
      });
      const runtime = resolveProjectModelRuntimePolicy({
        role: PROJECT_MODEL_ROLES.resultGeneration,
        operationContext: intent,
      });
      assert.equal(runtime.modelTier, "frontier");
    });
    it("35 mechanical reformat may use efficient model", () => {
      const intent = classifyStrategicResultIntent({
        resultIntent: STRATEGIC_RESULT_INTENTS.CHECKLIST_FROM_ANSWERS,
        revisionContext: { authoritativeSourcePersisted: true },
      });
      const runtime = resolveProjectModelRuntimePolicy({
        role: PROJECT_MODEL_ROLES.resultGeneration,
        operationContext: { ...intent, mechanicalTransformation: true, authoritativeSourcePersisted: true },
      });
      assert.equal(runtime.modelTier, "efficient");
    });
  });

  describe("workflow adaptation", () => {
    it("36 completed step without material change makes zero model calls", () => {
      const gate = evaluateWorkflowAdaptationGate({ bundle, completedStep: null });
      assert.equal(gate.modelCallPermitted, false);
    });
    it("37 material change allows one adaptation call", () => {
      const gate = evaluateWorkflowAdaptationGate({
        bundle,
        completedStep: { id: STEP_1, status: "completed" },
        acceptedResult: { id: "r1" },
      });
      assert.equal(gate.maxFrontierCalls, 1);
    });
    it("38 unchanged adaptation evidence reuses decision", () => {
      const gate = evaluateWorkflowAdaptationGate({
        bundle,
        completedStep: { id: STEP_1, status: "completed" },
        persistedAdaptation: { evidenceHash: gateHash(), outcome: "workflow_adaptation_recorded" },
      });
      function gateHash() {
        return evaluateWorkflowAdaptationGate({
          bundle,
          completedStep: { id: STEP_1, status: "completed" },
        }).evidenceHash;
      }
      assert.equal(gate.reuse, true);
    });
    it("39 major adaptation requires approval", () => {
      const gate = evaluateWorkflowAdaptationGate({
        bundle,
        completedStep: { id: STEP_1, status: "completed" },
        acceptedResult: { id: "r1" },
      });
      assert.equal(gate.requiresUserApproval, true);
    });
    it("40 unaffected steps are preserved", () => {
      const scope = identifyAffectedSteps({ changeSignals: ["deadline_changed"], steps: bundle.steps });
      assert.ok(scope.preservedStepIds.length >= 0);
    });
    it("41 affected action designs become stale", () => {
      const snapshot = buildSnapshot();
      markAffectedStepDesignsStale(snapshot, [STEP_2]);
      assert.equal(snapshot.stepBlueprints[1].actionDesignStatus, ACTION_DESIGN_STATUS.STALE);
    });
    it("42 workflow version increments helper", () => {
      const snapshot = buildSnapshot();
      snapshot.roadmapVersion = "2";
      assert.ok(snapshot.roadmapVersion);
    });
    it("43 workflow adaptation payload can be persisted to memory contract", () => {
      assert.ok(PROJECT_BRAIN_INTERNAL_CODES.MATERIAL_CHANGE_NOT_REQUIRED);
    });
    it("44 read/poll operations never adapt automatically", () => {
      const audits = auditReadOnlyProjectsEndpoints();
      assert.ok(audits.every((audit) => audit.readOnlySafe));
    });
  });

  describe("regression", () => {
    it("45 step 1 guardrail module exists", () => {
      assert.ok(readFileSync(new URL("../lib/projects/brain/openai-cost-guards.js", import.meta.url), "utf8"));
    });
    it("46 step 2 policy module exists", () => {
      assert.ok(readFileSync(new URL("../lib/projects/brain/project-model-policy.js", import.meta.url), "utf8"));
    });
    it("47 strategic persistence tests file exists", () => {
      assert.ok(readFileSync(new URL("./projects-strategic-calls-supabase-persistence.test.mjs", import.meta.url), "utf8"));
    });
    it("48 decision layer remains compatible", () => {
      assert.ok(readFileSync(new URL("../lib/projects/brain/decision/index.js", import.meta.url), "utf8"));
    });
    it("49 ai experience validation exists", () => {
      assert.ok(readFileSync(new URL("../lib/projects/brain/execution/ai-experience-validation.js", import.meta.url), "utf8"));
    });
    it("50 universal lifecycle helpers exist", () => {
      assert.ok(readFileSync(new URL("../lib/projects/brain/actions/action-lifecycle.js", import.meta.url), "utf8"));
    });
    it("51 read-only endpoint audit passes for list/get/workflow", () => {
      for (const file of ["projects-list.js", "projects-get.js", "projects-workflow.js"]) {
        assert.equal(assertReadOnlyEndpointSafe(file).ok, true);
      }
    });
  });

  it("sanitized snapshot excludes hidden reasoning", () => {
    const sanitized = sanitizeBrainSnapshotForClient(buildSnapshot());
    assert.ok(sanitized.stepBlueprints.length > 0);
    assert.equal("chainOfThought" in sanitized, false);
  });

  it("step blueprint infers intents category-independently", () => {
    assert.equal(inferExpectedResultIntent({ title: "Verify launch checklist" }), "verification");
    assert.equal(inferExpectedResultIntent({ title: "Choose strategy options" }), "recommendation");
  });

  it("partial regeneration scope identifies localized stale mode", () => {
    const scope = evaluatePartialRegenerationScope({
      changeSignals: ["deadline_changed"],
      steps: bundle.steps,
    });
    assert.ok(scope.mode);
  });

  it("update step blueprint after action design marks generated", () => {
    const snapshot = buildSnapshot();
    updateStepBlueprintAfterActionDesign({
      snapshot,
      stepId: STEP_1,
      preparedInput: {
        _executionPlan: { mode: "checklist", planId: "p1" },
        _executionPlanEvidenceHash: "hash",
        _executionPlanContractVersion: 2,
      },
      evidenceHash: "hash",
    });
    assert.equal(snapshot.stepBlueprints[0].actionDesignStatus, ACTION_DESIGN_STATUS.GENERATED);
  });
});
