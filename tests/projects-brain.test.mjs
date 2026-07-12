import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import {
  validateGeneratedWorkflow,
  validateWorkflowSafetyContent,
} from "../lib/projects/brain/validation.js";
import {
  attachResolvedToolsToWorkflow,
  resolveBrainTool,
} from "../lib/projects/brain/tool-resolution.js";
import { calculateWorkflowProgress, deriveMilestoneStatus } from "../lib/projects/brain/progress.js";
import {
  resolveNextAction,
  buildWorkflowSummaryFromBundle,
} from "../lib/projects/brain/next-action.js";
import {
  validateStepStatusTransition,
  serializeWorkflowBundle,
} from "../lib/projects/brain/service.js";
import { resetProjectToolCatalogIndexForTests } from "../lib/projects/tool-catalog.js";
import { resetBrainRateLimitForTests } from "../lib/projects/brain/rate-limit.js";
import {
  resetGenerationLocksForTests,
  tryAcquireGenerationLock,
  releaseGenerationLock,
} from "../lib/projects/brain/generation-lock.js";

function buildValidWorkflow() {
  const steps = Array.from({ length: 3 }).map((_, index) => ({
    title: `Pas concret ${index + 1}`,
    description: `Descriere detaliată pentru pasul ${index + 1}`,
    expectedOutcome: `Rezultat clar ${index + 1}`,
    rationale: "Motiv util",
    priority: "medium",
    estimatedEffortLabel: "30 min",
    recommendedToolId: null,
  }));

  return {
    summary: "Plan structurat pentru deschiderea unei cafenele în oraș.",
    currentStage: "Clarificarea conceptului",
    complexity: "medium",
    estimatedDurationLabel: "4–8 săptămâni",
    milestones: [
      {
        title: "Clarificarea conceptului",
        description: "Definești direcția și poziționarea cafenelei.",
        steps,
      },
      {
        title: "Piață și poziționare",
        description: "Analizezi piața locală și concurența.",
        steps: steps.map((step, index) => ({
          ...step,
          title: `Analiză piață ${index + 1}`,
          description: `Descriere piață ${index + 1}`,
          expectedOutcome: `Rezultat piață ${index + 1}`,
        })),
      },
      {
        title: "Buget și operațiuni",
        description: "Stabilești costurile și fluxul operațional.",
        steps: steps.map((step, index) => ({
          ...step,
          title: `Buget pas ${index + 1}`,
          description: `Descriere buget ${index + 1}`,
          expectedOutcome: `Rezultat buget ${index + 1}`,
        })),
      },
    ],
  };
}

describe("project brain validation", () => {
  it("accepts valid workflow with 3 milestones and 9 steps", () => {
    const result = validateGeneratedWorkflow(buildValidWorkflow(), {
      goal: "Vreau să deschid o cafenea",
    });
    assert.equal(result.ok, true);
    assert.equal(result.workflow.milestones.length, 3);
  });

  it("rejects summary that copies goal verbatim", () => {
    const workflow = buildValidWorkflow();
    workflow.summary = "Vreau să deschid o cafenea";
    const result = validateGeneratedWorkflow(workflow, { goal: "Vreau să deschid o cafenea" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "summary_copies_goal");
  });

  it("rejects duplicate steps", () => {
    const workflow = buildValidWorkflow();
    workflow.milestones[0].steps[1] = { ...workflow.milestones[0].steps[0] };
    const result = validateGeneratedWorkflow(workflow, { goal: "Vreau să deschid o cafenea" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "duplicate_step");
  });

  it("rejects workflow with blocked safety content", () => {
    const workflow = buildValidWorkflow();
    workflow.milestones[0].steps[0].title = "Plan pentru jefuire apartament";
    const validated = validateGeneratedWorkflow(workflow, { goal: "Test" });
    assert.equal(validated.ok, true);
    const safety = validateWorkflowSafetyContent(validated.workflow);
    assert.equal(safety.ok, false);
  });
});

describe("project brain tool resolution", () => {
  beforeEach(() => {
    resetProjectToolCatalogIndexForTests();
  });

  it("resolves known catalog tool id", () => {
    const resolved = resolveBrainTool("generator-reclame-meta");
    assert.ok(resolved);
    assert.equal(resolved.toolId, "generator-reclame-meta");
    assert.equal(resolved.toolCategorySlug, "business");
  });

  it("returns null for invented tool id", () => {
    const resolved = resolveBrainTool("totally-invented-tool-xyz");
    assert.equal(resolved, null);
  });

  it("attaches resolved tools and null for invalid ids", () => {
    const workflow = buildValidWorkflow();
    workflow.milestones[0].steps[0].recommendedToolId = "generator-reclame-meta";
    workflow.milestones[0].steps[1].recommendedToolId = "invented-tool";
    const validated = validateGeneratedWorkflow(workflow, { goal: "Cafenea" });
    const withTools = attachResolvedToolsToWorkflow(validated.workflow);
    assert.equal(withTools.milestones[0].steps[0].tool.toolId, "generator-reclame-meta");
    assert.equal(withTools.milestones[0].steps[1].tool, null);
  });
});

describe("project brain progress and next action", () => {
  it("derives progress from completed steps and excludes skipped", () => {
    const progress = calculateWorkflowProgress(
      [
        { status: "completed" },
        { status: "pending" },
        { status: "skipped" },
        { status: "completed" },
      ],
      [{ status: "in_progress" }, { status: "pending" }],
    );
    assert.equal(progress.completedSteps, 2);
    assert.equal(progress.totalSteps, 3);
    assert.equal(progress.progressPercent, 67);
  });

  it("selects in_progress before pending", () => {
    const milestones = [
      { id: "m1", position: 0 },
      { id: "m2", position: 1 },
    ];
    const steps = [
      {
        id: "s1",
        milestone_id: "m1",
        position: 0,
        status: "pending",
        title: "Pending first",
        description: "d",
        expected_outcome: "o",
        rationale: null,
      },
      {
        id: "s2",
        milestone_id: "m2",
        position: 0,
        status: "in_progress",
        title: "Active step",
        description: "d",
        expected_outcome: "o",
        rationale: null,
        tool_id: null,
      },
    ];

    const next = resolveNextAction({ milestones, steps });
    assert.equal(next.stepId, "s2");
    assert.equal(next.title, "Active step");
  });

  it("reopening completed step reduces progress", () => {
    const before = calculateWorkflowProgress([
      { status: "completed" },
      { status: "completed" },
    ]);
    const after = calculateWorkflowProgress([
      { status: "completed" },
      { status: "pending" },
    ]);
    assert.equal(before.progressPercent, 100);
    assert.equal(after.progressPercent, 50);
  });

  it("derives milestone status from steps", () => {
    assert.equal(
      deriveMilestoneStatus([{ status: "completed" }, { status: "completed" }]),
      "completed",
    );
    assert.equal(
      deriveMilestoneStatus([{ status: "completed" }, { status: "pending" }]),
      "in_progress",
    );
  });
});

describe("project brain transitions and locks", () => {
  beforeEach(() => {
    resetBrainRateLimitForTests();
    resetGenerationLocksForTests();
  });

  it("allows valid step transitions and blocks invalid ones", () => {
    assert.equal(validateStepStatusTransition("pending", "completed"), true);
    assert.equal(validateStepStatusTransition("completed", "pending"), true);
    assert.equal(validateStepStatusTransition("completed", "skipped"), false);
  });

  it("prevents duplicate concurrent generation lock", () => {
    assert.equal(tryAcquireGenerationLock("project-1"), true);
    assert.equal(tryAcquireGenerationLock("project-1"), false);
    releaseGenerationLock("project-1");
    assert.equal(tryAcquireGenerationLock("project-1"), true);
  });

  it("serializes workflow bundle with summary", () => {
    const progress = {
      completedSteps: 1,
      totalSteps: 4,
      progressPercent: 25,
      completedMilestones: 0,
      totalMilestones: 2,
    };
    const nextAction = {
      stepId: "s2",
      milestoneId: "m1",
      title: "Următorul pas",
      description: "desc",
      expectedOutcome: "out",
      tool: null,
    };
    const view = serializeWorkflowBundle({
      project: {
        brain_status: "ready",
        brain_version: "1.0.0",
        brain_generated_at: "2026-07-12T00:00:00.000Z",
        brain_failure_code: null,
        brain_attempt_count: 1,
      },
      workflow: {
        id: "wf1",
        project_id: "p1",
        summary: "Sumar",
        current_stage: "Etapa 1",
        complexity: "medium",
        estimated_duration_label: "2 săptămâni",
        brain_version: "1.0.0",
        generated_at: "2026-07-12T00:00:00.000Z",
      },
      milestones: [
        {
          id: "m1",
          title: "M1",
          description: "d",
          position: 0,
          status: "in_progress",
        },
      ],
      steps: [
        {
          id: "s1",
          milestone_id: "m1",
          title: "S1",
          description: "d",
          expected_outcome: "o",
          rationale: null,
          position: 0,
          priority: "medium",
          estimated_effort_label: null,
          status: "completed",
          completed_at: null,
          tool_id: null,
          tool_slug: null,
          tool_name: null,
          tool_category_slug: null,
        },
        {
          id: "s2",
          milestone_id: "m1",
          title: "S2",
          description: "d",
          expected_outcome: "o",
          rationale: null,
          position: 1,
          priority: "high",
          estimated_effort_label: null,
          status: "pending",
          completed_at: null,
          tool_id: null,
          tool_slug: null,
          tool_name: null,
          tool_category_slug: null,
        },
      ],
      progress,
      nextAction,
    });

    assert.equal(view.brainStatus, "ready");
    assert.equal(view.summary.completedSteps, 1);
    assert.equal(view.summary.nextStep?.id, "s2");
    const cardSummary = buildWorkflowSummaryFromBundle({ progress, nextAction });
    assert.equal(cardSummary.progressPercent, 25);
  });
});
