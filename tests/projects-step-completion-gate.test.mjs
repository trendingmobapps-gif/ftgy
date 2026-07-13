import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeCompletionCriteria,
  validateStepCompletion,
} from "../lib/projects/brain/execution/completion-evaluator.js";
import { buildContextualExecutionPlanFallback, buildExecutionPlanContext } from "../lib/projects/brain/execution/execution-plan-generator.js";

const checklistPlan = buildContextualExecutionPlanFallback(
  buildExecutionPlanContext({
    project: { name: "Trecerea școlii de șoferi", goal: "Permis", category_slug: "personal" },
    step: {
      title: "Înscrierea la școala de șoferi",
      description: "Pregătește documentele și programează înscrierea.",
      expected_outcome: "Înscriere confirmată",
    },
    preparation: { title: "Înscrierea", explanation: "", whyItMatters: "", expectedResult: "", missingFields: [] },
  }),
  { title: "Înscrierea", explanation: "", whyItMatters: "", expectedResult: "", missingFields: [] },
);

describe("projects step completion gate", () => {
  it("rejects finalize with incomplete checklist", () => {
    const result = validateStepCompletion({
      plan: checklistPlan,
      collectedInput: {
        interactive: { type: "checklist", checklistChecked: { choose_provider: true } },
      },
    });
    assert.equal(result.canFinalize, false);
    assert.ok(result.missingRequirements.some((row) => row.code === "REQUIRED_CHECKLIST"));
  });

  it("allows finalize when checklist required items are complete", () => {
    const checked = {};
    for (const item of checklistPlan.checklistItems.filter((row) => row.required !== false)) {
      checked[item.id] = true;
    }
    const result = validateStepCompletion({
      plan: checklistPlan,
      collectedInput: { interactive: { type: "checklist", checklistChecked: checked } },
    });
    assert.equal(result.canFinalize, true);
  });

  it("rejects finalize without required choice", () => {
    const result = validateStepCompletion({
      plan: {
        mode: "choice",
        choices: [
          { id: "a", title: "A", value: "a" },
          { id: "b", title: "B", value: "b" },
        ],
        completionCriteria: normalizeCompletionCriteria({ requireChoice: true }),
      },
      collectedInput: {},
    });
    assert.equal(result.canFinalize, false);
    assert.ok(result.missingRequirements.some((row) => row.code === "REQUIRED_CHOICE"));
  });

  it("requires generated result acceptance before finalize for generator modes", () => {
    const result = validateStepCompletion({
      plan: {
        mode: "generator",
        completionCriteria: normalizeCompletionCriteria({
          requireGeneratedResult: true,
          requireUserAcceptance: true,
        }),
      },
      collectedInput: {},
      acceptedResult: null,
      pendingResult: { id: "r1", acceptance_status: "pending_review" },
    });
    assert.equal(result.canFinalize, false);
    assert.ok(
      result.missingRequirements.some((row) => row.code === "REQUIRED_RESULT_ACCEPTANCE"),
    );
  });

  it("accepting result alone does not imply checklist completion", () => {
    const result = validateStepCompletion({
      plan: checklistPlan,
      collectedInput: {
        interactive: { resultAccepted: true, acceptedResultId: "r1" },
      },
      acceptedResult: { id: "r1", acceptance_status: "accepted" },
    });
    assert.equal(result.canFinalize, false);
  });

  it("checklist plan does not require generated result by default", () => {
    assert.equal(checklistPlan.completionCriteria.requireGeneratedResult, false);
    assert.equal(checklistPlan.completionCriteria.requireExplicitFinalize, true);
  });
});
