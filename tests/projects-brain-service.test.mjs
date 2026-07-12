import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import {
  enableProjectBrainSelectColumns,
  resetProjectBrainSelectColumnsForTests,
  getProjectSelectColumns,
} from "../lib/projects/constants.js";
import {
  resetBrainSchemaBootstrapForTests,
  ensureBrainSchema,
} from "../lib/projects/brain/schema-bootstrap.js";
import {
  validateStepStatusTransition,
  hasReadyWorkflowBundle,
  isProjectBrainReady,
  serializeWorkflowBundle,
} from "../lib/projects/brain/service.js";
import { calculateWorkflowProgress } from "../lib/projects/brain/progress.js";
import { resolveNextAction } from "../lib/projects/brain/next-action.js";
import {
  resetGenerationLocksForTests,
  tryAcquireGenerationLock,
  releaseGenerationLock,
} from "../lib/projects/brain/generation-lock.js";

function buildBundle({ stepStatuses = ["pending", "pending"] } = {}) {
  const milestoneId = "11111111-1111-4111-8111-111111111111";
  const workflowId = "22222222-2222-4222-8222-222222222222";
  const steps = stepStatuses.map((status, index) => ({
    id: `33333333-3333-4333-8333-3333333333${index}`,
    milestone_id: milestoneId,
    workflow_id: workflowId,
    project_id: "44444444-4444-4444-8444-444444444444",
    user_id: "55555555-5555-4555-8555-555555555555",
    title: `Step ${index + 1}`,
    description: "desc",
    expected_outcome: "out",
    rationale: null,
    position: index,
    priority: "medium",
    estimated_effort_label: null,
    status,
    completed_at: status === "completed" ? "2026-07-12T10:00:00.000Z" : null,
    tool_id: null,
    tool_slug: null,
    tool_name: null,
    tool_category_slug: null,
  }));

  return {
    workflow: {
      id: workflowId,
      project_id: "44444444-4444-4444-8444-444444444444",
      user_id: "55555555-5555-4555-8555-555555555555",
      summary: "Plan",
      current_stage: "Stage",
      complexity: "medium",
      estimated_duration_label: "2 weeks",
      brain_version: "1.0.0",
      status: "ready",
      generated_at: "2026-07-12T10:00:00.000Z",
    },
    milestones: [
      {
        id: milestoneId,
        workflow_id: workflowId,
        project_id: "44444444-4444-4444-8444-444444444444",
        user_id: "55555555-5555-4555-8555-555555555555",
        title: "Milestone 1",
        description: "desc",
        position: 0,
        status: "in_progress",
      },
    ],
    steps,
  };
}

describe("project brain select columns", () => {
  beforeEach(() => {
    resetProjectBrainSelectColumnsForTests();
    resetBrainSchemaBootstrapForTests();
  });

  it("includes brain columns after schema probe finds brain_status", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes("projects?select=brain_status")) {
        return new Response("[]", { status: 200 });
      }
      return new Response("[]", { status: 404 });
    };

    try {
      const result = await ensureBrainSchema({
        baseUrl: "https://example.supabase.co",
        secretKey: "service-key",
      });
      assert.equal(result.ok, true);
      assert.match(getProjectSelectColumns(), /brain_status/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("enables brain columns when bootstrap is disabled but columns exist", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes("projects?select=brain_status")) {
        return new Response("[]", { status: 200 });
      }
      return new Response("[]", { status: 404 });
    };

    const originalVercelEnv = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";

    try {
      const result = await ensureBrainSchema({
        baseUrl: "https://example.supabase.co",
        secretKey: "service-key",
      });
      assert.equal(result.reason, "bootstrap_disabled_columns_present");
      assert.match(getProjectSelectColumns(), /brain_status/);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.VERCEL_ENV = originalVercelEnv;
    }
  });
});

describe("project brain readiness helpers", () => {
  it("detects ready workflow bundle for idempotent generation", () => {
    const bundle = buildBundle();
    assert.equal(hasReadyWorkflowBundle(bundle), true);
    assert.equal(hasReadyWorkflowBundle({ workflow: null }), false);
  });

  it("treats project as brain-ready when workflow exists even if brain_status missing", () => {
    const bundle = buildBundle();
    assert.equal(isProjectBrainReady({ brain_status: undefined }, bundle), true);
    assert.equal(isProjectBrainReady({ brain_status: "ready" }, { workflow: null }), true);
    assert.equal(isProjectBrainReady({ brain_status: "pending" }, { workflow: null }), false);
  });
});

describe("project brain step mutation contract", () => {
  it("allows pending to completed and completed to pending", () => {
    assert.equal(validateStepStatusTransition("pending", "completed"), true);
    assert.equal(validateStepStatusTransition("completed", "pending"), true);
    assert.equal(validateStepStatusTransition("completed", "in_progress"), true);
    assert.equal(validateStepStatusTransition("pending", "skipped"), true);
  });

  it("rejects invalid transitions with stable validation semantics", () => {
    assert.equal(validateStepStatusTransition("completed", "skipped"), false);
    assert.equal(validateStepStatusTransition("skipped", "completed"), false);
  });

  it("increases progress after completing first pending step", () => {
    const bundle = buildBundle({ stepStatuses: ["pending", "pending"] });
    const before = calculateWorkflowProgress(bundle.steps, bundle.milestones);
    bundle.steps[0].status = "completed";
    bundle.steps[0].completed_at = "2026-07-12T10:00:00.000Z";
    const after = calculateWorkflowProgress(bundle.steps, bundle.milestones);
    assert.equal(before.progressPercent, 0);
    assert.equal(after.progressPercent, 50);
    assert.equal(after.completedSteps, 1);
  });

  it("decreases progress after reopening completed step", () => {
    const bundle = buildBundle({ stepStatuses: ["completed", "pending"] });
    const before = calculateWorkflowProgress(bundle.steps, bundle.milestones);
    bundle.steps[0].status = "pending";
    bundle.steps[0].completed_at = null;
    const after = calculateWorkflowProgress(bundle.steps, bundle.milestones);
    assert.equal(before.progressPercent, 50);
    assert.equal(after.progressPercent, 0);
  });

  it("changes next action after completing first step", () => {
    const bundle = buildBundle({ stepStatuses: ["pending", "pending"] });
    const before = resolveNextAction({
      project: { goal: "Test", name: "Test" },
      milestones: bundle.milestones,
      steps: bundle.steps,
    });
    bundle.steps[0].status = "completed";
    const after = resolveNextAction({
      project: { goal: "Test", name: "Test" },
      milestones: bundle.milestones,
      steps: bundle.steps,
    });
    assert.equal(before.stepId, bundle.steps[0].id);
    assert.equal(after.stepId, bundle.steps[1].id);
  });

  it("serializes stable step-status response fields", () => {
    const bundle = buildBundle({ stepStatuses: ["completed", "pending"] });
    const progress = calculateWorkflowProgress(bundle.steps, bundle.milestones);
    const nextAction = resolveNextAction({
      project: { goal: "Test", name: "Test" },
      milestones: bundle.milestones,
      steps: bundle.steps,
    });
    const view = serializeWorkflowBundle({
      project: {
        brain_status: "ready",
        brain_version: "1.0.0",
        brain_generated_at: "2026-07-12T10:00:00.000Z",
        brain_failure_code: null,
        brain_attempt_count: 1,
      },
      workflow: bundle.workflow,
      milestones: bundle.milestones,
      steps: bundle.steps,
      progress,
      nextAction,
    });

    assert.equal(view.progress.completedSteps, 1);
    assert.equal(view.progress.totalSteps, 2);
    assert.equal(view.nextAction.stepId, bundle.steps[1].id);
    assert.equal(view.workflow.milestones[0].steps[0].completedAt, "2026-07-12T10:00:00.000Z");
  });
});

describe("project brain generation lock", () => {
  beforeEach(() => {
    resetGenerationLocksForTests();
  });

  it("prevents concurrent generation for same project", () => {
    assert.equal(tryAcquireGenerationLock("project-a"), true);
    assert.equal(tryAcquireGenerationLock("project-a"), false);
    releaseGenerationLock("project-a");
    assert.equal(tryAcquireGenerationLock("project-a"), true);
  });
});
