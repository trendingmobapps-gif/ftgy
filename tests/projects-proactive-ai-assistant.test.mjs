import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  repairPlanForAssistantValue,
  validateAssistantValueContribution,
} from "../lib/projects/brain/execution/assistant-value-validation.js";
import {
  buildContextualExecutionPlanFallback,
  buildExecutionPlanContext,
  normalizeExecutionPlan,
  serializeInteractivePayloadFromPlan,
} from "../lib/projects/brain/execution/execution-plan-generator.js";
import { PROJECT_MODEL_POLICY, resolveProjectModelPolicy } from "../lib/projects/brain/project-model-policy.js";
import {
  validateExecutionPlanCompleteness,
  validateInteractivePayload,
} from "../lib/projects/brain/execution/execution-plan-validation.js";
import { validateStepCompletion } from "../lib/projects/brain/execution/completion-evaluator.js";

const marketingProject = {
  id: "iter-marketing",
  name: "Promovare platformă iterai.ro",
  goal: "Creșterea notorietății și a utilizării platformei iterai.ro",
  category_slug: "business",
};

const marketingStep = {
  id: "marketing-strategy",
  title: "Elaborare strategie de marketing",
  description: "Definește canalele digitale și offline, prioritizarea și argumentarea.",
  expected_outcome: "Strategie de canale confirmată",
};

function buildPreparation(step, project) {
  return {
    title: step.title,
    explanation: step.description,
    whyItMatters: "Canalele potrivite accelerează promovarea.",
    expectedResult: step.expected_outcome,
    missingFields: [],
    preparedInput: {},
    context: {
      project: {
        name: project.name,
        goal: project.goal,
        categorySlug: project.category_slug,
      },
      completedSteps: [],
    },
  };
}

function buildContext(step = marketingStep, project = marketingProject) {
  return buildExecutionPlanContext({
    project,
    step,
    preparation: buildPreparation(step, project),
  });
}

describe("projects proactive AI assistant", () => {
  it("uses frontier model policy defaults", () => {
    assert.equal(PROJECT_MODEL_POLICY.roadmap.model, "gpt-5.6-sol");
    assert.equal(PROJECT_MODEL_POLICY.executionPlan.model, "gpt-5.6-sol");
    assert.equal(resolveProjectModelPolicy("roadmap").reasoningEffort, "max");
    assert.equal(resolveProjectModelPolicy("executionPlan").reasoningEffort, "xhigh");
  });

  it("rejects blank expert-work structured forms for strategic marketing steps", () => {
    const blankForm = {
      mode: "structured_form",
      title: marketingStep.title,
      explanation: "Completează",
      requiredInputs: [
        { id: "digital", type: "textarea", label: "Selectează canalele digitale potrivite", required: true },
        { id: "offline", type: "textarea", label: "Selectează canalele offline potrivite", required: true },
        {
          id: "priority",
          type: "textarea",
          label: "Prioritizează canalele selectate și argumentează alegerea ta",
          required: true,
        },
      ],
    };

    const evaluation = validateAssistantValueContribution(blankForm, buildContext());
    assert.equal(evaluation.valid, false);
    assert.ok(evaluation.reasons.includes("user_asked_to_perform_expert_analysis"));
  });

  it("repairs strategic marketing steps into recommendation_selection", () => {
    const repaired = repairPlanForAssistantValue(
      {
        mode: "structured_form",
        requiredInputs: [
          { id: "digital", type: "textarea", label: "Selectează canalele digitale", required: true },
        ],
      },
      buildContext(),
    );

    assert.equal(repaired.mode, "recommendation_selection");
    assert.ok(repaired.recommendationGroups.length >= 1);
    const digital = repaired.recommendationGroups.find((group) => group.id === "digital_channels");
    assert.ok(digital);
    assert.ok(digital.recommendations.some((item) => item.title.includes("TikTok")));
    assert.ok(digital.recommendations.some((item) => item.recommended));
  });

  it("contextual fallback for marketing step returns recommendations not blank fields", () => {
    const plan = buildContextualExecutionPlanFallback(buildContext(), buildPreparation(marketingStep, marketingProject));
    assert.equal(plan.mode, "recommendation_selection");
    const payload = serializeInteractivePayloadFromPlan(plan);
    assert.equal(payload.type, "recommendation_selection");
    assert.ok(payload.groups.length >= 1);
    assert.ok(
      payload.groups.some((group) => group.recommendations.some((item) => item.recommended && item.explanation)),
    );
  });

  it("validates recommendation_selection payload shape", () => {
    const plan = buildContextualExecutionPlanFallback(buildContext(), buildPreparation(marketingStep, marketingProject));
    const completeness = validateExecutionPlanCompleteness(plan, buildContext());
    assert.equal(completeness.valid, true);
    const payload = serializeInteractivePayloadFromPlan(plan);
    const payloadValidation = validateInteractivePayload(plan.mode, payload);
    assert.equal(payloadValidation.valid, true);
  });

  it("normalizes repaired recommendation plan with assistant value metadata", () => {
    const repaired = repairPlanForAssistantValue({ mode: "structured_form", requiredInputs: [] }, buildContext());
    const normalized = normalizeExecutionPlan(repaired, buildContext());
    assert.equal(normalized.ok, true);
    assert.equal(normalized.plan.mode, "recommendation_selection");
    const valueEval = validateAssistantValueContribution(normalized.plan, buildContext());
    assert.equal(valueEval.valid, true);
    assert.ok(valueEval.aiContributionScore >= 60);
  });

  it("requires confirmation before finalize for recommendation selection", () => {
    const plan = buildContextualExecutionPlanFallback(buildContext(), buildPreparation(marketingStep, marketingProject));
    const beforeConfirm = validateStepCompletion({
      plan,
      collectedInput: {
        interactive: {
          type: "recommendation_selection",
          selectedRecommendations: ["tiktok_ads"],
        },
      },
    });
    assert.equal(beforeConfirm.canFinalize, false);

    const afterConfirm = validateStepCompletion({
      plan,
      collectedInput: {
        interactive: {
          type: "recommendation_selection",
          selectedRecommendations: ["tiktok_ads", "meta_ads"],
          confirmed: true,
        },
      },
      pendingResult: { id: "result-1" },
      acceptedResult: { id: "result-1" },
    });
    assert.equal(afterConfirm.canFinalize, true);
  });

  it("produces different recommendations for different business contexts", () => {
    const iterPlan = repairPlanForAssistantValue({ mode: "structured_form", requiredInputs: [] }, buildContext());
    const bakeryPlan = repairPlanForAssistantValue(
      { mode: "structured_form", requiredInputs: [] },
      buildContext(
        {
          ...marketingStep,
          title: "Strategie marketing brutărie locală",
          description: "Promovare brutărie de cartier",
        },
        {
          ...marketingProject,
          name: "Brutărie de cartier",
          goal: "Mărirea vânzărilor locale la brutărie",
        },
      ),
    );

    const iterTitles = iterPlan.recommendationGroups
      .flatMap((group) => group.recommendations.map((item) => item.title))
      .join(" ");
    const bakeryTitles = bakeryPlan.recommendationGroups
      .flatMap((group) => group.recommendations.map((item) => item.title))
      .join(" ");

    assert.notEqual(iterTitles, bakeryTitles);
  });
});
