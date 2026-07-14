import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyOpenAiOperationComplexity } from "../lib/projects/brain/openai-operation-complexity.js";
import { estimateOpenAiOperationCost, resolveModelCostBand } from "../lib/projects/brain/openai-cost-estimation.js";
import {
  createOperationBudgetTracker,
  evaluateOperationBudget,
  evaluateOperationTokenBudget,
  resolveProjectsCostGuardSettings,
} from "../lib/projects/brain/openai-cost-guards.js";
import {
  computeExecutionPlanEvidenceHash,
  computeResultGenerationEvidenceHash,
} from "../lib/projects/brain/openai-evidence-hash.js";
import {
  buildResultIdempotencyLedger,
  shouldReuseExecutionPlan,
  shouldReusePersistedResult,
} from "../lib/projects/brain/openai-model-reuse.js";
import { canAttemptModelRepair, resolveRepairRole } from "../lib/projects/brain/openai-repair-policy.js";
import { logOpenAiUsageEvent } from "../lib/projects/brain/openai-usage-observability.js";
import { isOpenAiLiveTestsEnabled } from "../lib/projects/brain/openai-live-test-guard.js";
import { OPENAI_INTERNAL_ERROR_CODES } from "../lib/projects/brain/openai-error-codes.js";
import {
  PROJECT_MODEL_ROLES,
  PROJECT_RUNTIME_ROLE_POLICY,
  resolveProjectModelRuntimePolicy,
} from "../lib/projects/brain/project-model-policy.js";
import { isFrontierModel } from "../lib/projects/brain/openai-model-tiers.js";

describe("openai cost optimization step 2", () => {
  it("one centralized runtime role policy exists", () => {
    assert.ok(PROJECT_RUNTIME_ROLE_POLICY.roadmap);
    assert.ok(PROJECT_RUNTIME_ROLE_POLICY.executionPlanLegacy);
    assert.ok(PROJECT_RUNTIME_ROLE_POLICY.resultGeneration);
  });

  it("roadmap always selects frontier", () => {
    const runtime = resolveProjectModelRuntimePolicy({ role: PROJECT_MODEL_ROLES.roadmap });
    assert.equal(runtime.modelTier, "frontier");
    assert.equal(isFrontierModel(runtime.model), true);
  });

  it("simple roadmap uses medium reasoning", () => {
    const runtime = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.roadmap,
      complexity: { level: "standard" },
    });
    assert.equal(runtime.providerReasoningEffort, "medium");
  });

  it("complex roadmap may use high reasoning", () => {
    const runtime = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.roadmap,
      complexity: { level: "complex", reasonCode: "complexity_complex" },
    });
    assert.equal(runtime.providerReasoningEffort, "high");
  });

  it("exceptional roadmap requires explicit reason code", () => {
    const withoutReason = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.roadmap,
      complexity: { level: "exceptional" },
    });
    assert.equal(withoutReason.providerReasoningEffort, "medium");

    const withReason = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.roadmap,
      complexity: { level: "exceptional", reasonCode: "high_stakes_goal" },
    });
    assert.equal(withReason.providerReasoningEffort, "high");
  });

  it("execution-plan strategy stays frontier until Decision Contract is authoritative", () => {
    const runtime = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.experienceDesign,
      complexity: { level: "simple" },
    });
    assert.equal(runtime.modelTier, "frontier");
    assert.equal(isFrontierModel(runtime.model), true);
  });

  it("execution-plan legacy efficient role exists only for mechanical rendering path", () => {
    const runtime = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.executionPlanLegacy,
      complexity: { level: "simple" },
    });
    assert.equal(runtime.modelTier, "efficient");
    assert.equal(isFrontierModel(runtime.model), false);
  });

  it("complex experience design may select frontier", () => {
    const runtime = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.experienceDesign,
      complexity: { level: "complex", reasonCode: "complexity_complex" },
    });
    assert.equal(runtime.modelTier, "frontier");
  });

  it("simple result generation may select efficient model for mechanical transformation", () => {
    const runtime = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.resultGeneration,
      complexity: { level: "simple" },
      operationContext: {
        mechanicalTransformation: true,
        authoritativeSourcePersisted: true,
        strategicOutput: false,
        personalizedGeneration: false,
        workflowImpacting: false,
      },
    });
    assert.equal(runtime.modelTier, "efficient");
  });

  it("complex strategic result selects frontier", () => {
    const runtime = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.resultGeneration,
      complexity: { level: "complex", reasonCode: "complexity_complex" },
      operationContext: { strategicOutput: true },
    });
    assert.equal(runtime.modelTier, "frontier");
  });

  it("extraction/formatting never selects frontier by default", () => {
    for (const role of [PROJECT_MODEL_ROLES.extraction, PROJECT_MODEL_ROLES.formatting]) {
      const runtime = resolveProjectModelRuntimePolicy({ role, complexity: { level: "standard" } });
      assert.equal(runtime.modelTier, "efficient");
    }
  });

  it("complexity classifier is category-independent", () => {
    const business = classifyOpenAiOperationComplexity({
      role: PROJECT_MODEL_ROLES.roadmap,
      project: { goal: "Deschid o cafenea cu buget 5000 lei până în 3 luni" },
    });
    const medical = classifyOpenAiOperationComplexity({
      role: PROJECT_MODEL_ROLES.roadmap,
      project: { goal: "Pregătire examen medical cu tratament reglementat" },
    });
    assert.ok(["simple", "standard", "complex", "exceptional"].includes(business.level));
    assert.ok(["simple", "standard", "complex", "exceptional"].includes(medical.level));
    assert.doesNotMatch(JSON.stringify(business.signals), /business|medical|studii/i);
  });

  it("exceptional requires multiple strong signals", () => {
    const weak = classifyOpenAiOperationComplexity({
      role: PROJECT_MODEL_ROLES.roadmap,
      project: { goal: "Plan scurt" },
    });
    assert.notEqual(weak.level, "exceptional");
  });

  it("unknown complexity defaults to standard", () => {
    const classified = classifyOpenAiOperationComplexity({
      role: PROJECT_MODEL_ROLES.decision,
      project: {},
    });
    assert.equal(classified.level, "standard");
  });

  it("execution-plan evidence hash reuse", () => {
    const hash = computeExecutionPlanEvidenceHash({
      actionId: "action-1",
      step: { id: "step-1", title: "Plan", expected_outcome: "Outcome" },
      project: { goal: "Goal" },
      preparation: { missingFields: [] },
      memoryMap: new Map(),
      executionDecision: { strategy: "continue_workflow" },
    });
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it("unchanged evidence avoids regeneration", () => {
    const hash = "abc123";
    const decision = shouldReuseExecutionPlan({
      preparedInput: { _executionPlanEvidenceHash: hash, _executionPlanContractVersion: 2 },
      evidenceHash: hash,
      plan: { mode: "checklist" },
    });
    assert.equal(decision.reuse, true);
  });

  it("changed evidence regenerates", () => {
    const decision = shouldReuseExecutionPlan({
      preparedInput: { _executionPlanEvidenceHash: "old", _executionPlanContractVersion: 2 },
      evidenceHash: "new",
      plan: { mode: "checklist" },
    });
    assert.equal(decision.reuse, false);
  });

  it("result idempotency reuses existing result where possible", () => {
    const hash = computeResultGenerationEvidenceHash({
      actionId: "action-1",
      idempotencyKey: "idem-1",
      acceptedInput: { prompt: "test" },
    });
    const decision = shouldReusePersistedResult({
      preparedInput: {
        _resultIdempotency: buildResultIdempotencyLedger({
          actionId: "action-1",
          idempotencyKey: "idem-1",
          acceptedInput: { prompt: "test" },
          resultId: "result-1",
        }),
      },
      evidenceHash: hash,
      idempotencyKey: "idem-1",
    });
    assert.equal(decision.reuse, true);
    assert.equal(decision.resultId, "result-1");
  });

  it("deterministic repair runs before model repair", () => {
    assert.equal(resolveRepairRole({ originalRole: "roadmap", failureKind: "validation_failed" }), "formatting");
  });

  it("efficient repair precedes frontier repair", () => {
    const repairRole = resolveRepairRole({ originalRole: "experienceDesign", failureKind: "malformed_json" });
    assert.equal(repairRole, "formatting");
  });

  it("no more than one repair allowed by policy", () => {
    assert.equal(
      canAttemptModelRepair({ priorRepairCount: 1, maxRepairCalls: 1, classifiedErrorCode: null }),
      false,
    );
  });

  it("quota/auth errors never repair", () => {
    assert.equal(
      canAttemptModelRepair({
        priorRepairCount: 0,
        maxRepairCalls: 1,
        classifiedErrorCode: OPENAI_INTERNAL_ERROR_CODES.QUOTA_EXCEEDED,
      }),
      false,
    );
  });

  it("operation token budget stops additional call", () => {
    const tracker = createOperationBudgetTracker({ maxTotalTokensPerOperation: 1000 });
    tracker.consumedTokens = 1000;
    const budget = evaluateOperationTokenBudget(tracker);
    assert.equal(budget.allowed, false);
  });

  it("project frontier-call limit is enforced where state is available", () => {
    const settings = resolveProjectsCostGuardSettings();
    const budget = evaluateOperationBudget({
      runtimePolicy: resolveProjectModelRuntimePolicy({ role: PROJECT_MODEL_ROLES.roadmap }),
      tracker: createOperationBudgetTracker({ maxTotalTokensPerOperation: 100000 }),
      frontierCallCount: settings.maxFrontierCallsPerProjectCreation,
      actionFrontierCallCount: 0,
    });
    assert.equal(budget.allowed, false);
  });

  it("action frontier-call limit is enforced", () => {
    const settings = resolveProjectsCostGuardSettings();
    const budget = evaluateOperationBudget({
      runtimePolicy: resolveProjectModelRuntimePolicy({ role: PROJECT_MODEL_ROLES.experienceDesign }),
      tracker: createOperationBudgetTracker({ maxTotalTokensPerOperation: 100000 }),
      frontierCallCount: 0,
      actionFrontierCallCount: settings.maxFrontierCallsPerAction,
      budgetScope: "action",
    });
    assert.equal(budget.allowed, false);
  });

  it("roadmap frontier budget does not block action-scoped frontier calls", () => {
    const settings = resolveProjectsCostGuardSettings();
    const roadmapBudget = evaluateOperationBudget({
      runtimePolicy: resolveProjectModelRuntimePolicy({ role: PROJECT_MODEL_ROLES.roadmap }),
      tracker: createOperationBudgetTracker({ maxTotalTokensPerOperation: 100000 }),
      frontierCallCount: settings.maxFrontierCallsPerProjectCreation,
      actionFrontierCallCount: 0,
      budgetScope: "project_creation",
    });
    const actionBudget = evaluateOperationBudget({
      runtimePolicy: resolveProjectModelRuntimePolicy({ role: PROJECT_MODEL_ROLES.experienceDesign }),
      tracker: createOperationBudgetTracker({ maxTotalTokensPerOperation: 100000 }),
      frontierCallCount: settings.maxFrontierCallsPerProjectCreation,
      actionFrontierCallCount: 0,
      budgetScope: "action",
    });
    assert.equal(roadmapBudget.allowed, false);
    assert.equal(actionBudget.allowed, true);
  });

  it("cost estimation returns cost band", () => {
    assert.equal(resolveModelCostBand("gpt-4.1-mini"), "low");
    assert.equal(estimateOpenAiOperationCost({ model: "gpt-5.6-sol" }).costBand, "high");
  });

  it("logs contain role/tier/complexity/reuse metadata", () => {
    const events = [];
    logOpenAiUsageEvent((payload) => events.push(payload), {
      role: "executionPlanLegacy",
      selectedModelTier: "efficient",
      complexityLevel: "simple",
      reuseHit: true,
      reuseType: "execution_plan_evidence_unchanged",
      success: true,
    });
    assert.ok(events.some((event) => event.role === "executionPlanLegacy"));
    assert.ok(events.some((event) => event.reuseHit === true));
  });

  it("logs exclude user content", () => {
    const events = [];
    logOpenAiUsageEvent((payload) => events.push(payload), {
      role: "resultGeneration",
      operation: "resultGeneration",
      success: true,
      evidenceHash: "abc123",
    });
    const serialized = JSON.stringify(events);
    assert.doesNotMatch(serialized, /prompt|answer|memory|resource content/i);
  });

  it("preview defaults are stricter than production", () => {
    const previous = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "preview";
    const preview = resolveProjectsCostGuardSettings();
    process.env.VERCEL_ENV = "production";
    const production = resolveProjectsCostGuardSettings();
    if (previous) process.env.VERCEL_ENV = previous;
    assert.ok(preview.maxFrontierCallsPerProjectCreation <= production.maxFrontierCallsPerProjectCreation);
    assert.ok(preview.previewDailyBudgetUsd <= production.productionDailyBudgetUsd);
  });

  it("live tests remain explicit opt-in", () => {
    const previous = process.env.OPENAI_LIVE_TESTS;
    delete process.env.OPENAI_LIVE_TESTS;
    assert.equal(isOpenAiLiveTestsEnabled(), false);
    if (previous) process.env.OPENAI_LIVE_TESTS = previous;
  });
});
