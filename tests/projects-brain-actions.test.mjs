import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildActionPreparation, buildPreparedPrompt, buildExecutionPrompt } from "../lib/projects/brain/actions/prompt-builder.js";
import { buildProjectActionContext } from "../lib/projects/brain/actions/context-builder.js";
import { validatePrepareActionRequest } from "../lib/projects/brain/actions/validation.js";
import { resolveNextAction } from "../lib/projects/brain/next-action.js";

function buildFixture() {
  const project = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Patiserie premium",
    goal: "Vreau să deschid o patiserie premium în Timișoara, buget 80.000 €",
    summary: "Plan pentru deschiderea unei patiserii premium.",
    description: null,
    category_slug: "business",
  };

  const workflow = {
    id: "22222222-2222-4222-8222-222222222222",
    summary: "Plan structurat pentru deschiderea unei patiserii.",
    current_stage: "Concept și poziționare",
    complexity: "medium",
  };

  const milestone = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Clarificarea conceptului",
    description: "Definești direcția patiseriei.",
  };

  const step = {
    id: "33333333-3333-4333-8333-333333333301",
    milestone_id: milestone.id,
    project_id: project.id,
    title: "Plan financiar inițial",
    description: "Stabilești bugetul și costurile de pornire.",
    expected_outcome: "Un plan financiar clar pentru primele 12 luni.",
    rationale: "Fără claritate financiară, deciziile de deschidere devin riscante.",
    estimated_effort_label: "45 min",
    status: "pending",
    tool_id: "plan-de-afaceri",
    tool_slug: "plan-de-afaceri",
    tool_name: "Plan de Afaceri",
    tool_category_slug: "business",
  };

  return { project, workflow, milestone, step };
}

describe("project actions preparation", () => {
  it("reuses known project context in prepared prompt", () => {
    const { project, workflow, milestone, step } = buildFixture();
    const context = buildProjectActionContext({
      project,
      workflow,
      milestone,
      step,
      steps: [step],
    });

    const prompt = buildPreparedPrompt(context);
    assert.match(prompt, /patiserie/i);
    assert.match(prompt, /Timișoara|80\.000/i);
    assert.match(prompt, /Plan financiar inițial/i);
  });

  it("asks only for missing required information", () => {
    const { project, workflow, milestone, step } = buildFixture();
    const preparation = buildActionPreparation({
      project,
      workflow,
      milestone,
      step,
      steps: [step],
      resultsByStepId: new Map(),
    });

    assert.ok(preparation.preparedPrompt.length > 40);
    assert.equal(typeof preparation.preparedInput, "object");
    const missingKeys = preparation.missingFields.map((field) => field.key);
    assert.equal(missingKeys.includes("produs") || missingKeys.length === 0, true);
  });

  it("builds execution prompt from accepted input", () => {
    const { project, workflow, milestone, step } = buildFixture();
    const preparation = buildActionPreparation({
      project,
      workflow,
      milestone,
      step,
      steps: [step],
      resultsByStepId: new Map(),
    });

    const prompts = buildExecutionPrompt({
      preparation,
      acceptedInput: {
        prompt: "Creează un plan financiar pentru o patiserie premium în Timișoara.",
      },
    });

    assert.ok(prompts.systemPrompt.length > 20);
    assert.match(prompts.userPrompt, /patiserie premium/i);
  });

  it("serializes next action as project action instead of recommended tool", () => {
    const { project, step } = buildFixture();
    const next = resolveNextAction({
      project,
      milestones: [{ id: step.milestone_id, position: 0 }],
      steps: [step],
    });

    assert.equal(next.action.title, step.title);
    assert.equal(next.action.expectedResult, step.expected_outcome);
    assert.equal(next.tool, undefined);
  });

  it("validates prepare action request", () => {
    const valid = validatePrepareActionRequest({
      projectId: "44444444-4444-4444-8444-444444444444",
      stepId: "33333333-3333-4333-8333-333333333301",
    });
    assert.equal(valid.ok, true);

    const invalid = validatePrepareActionRequest({ projectId: "bad", stepId: "bad" });
    assert.equal(invalid.ok, false);
  });
});
