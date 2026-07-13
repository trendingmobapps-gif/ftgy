import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildContextualExecutionPlanFallback,
  buildExecutionPlanContext,
  ensureExecutionPlan,
  generateExecutionPlan,
  normalizeExecutionPlan,
  serializeInteractivePayloadFromPlan,
  withExecutionPlan,
} from "../lib/projects/brain/execution/execution-plan-generator.js";
import {
  EXECUTION_PLAN_VERSION,
  validateExecutionPlanCompleteness,
  validateInteractivePayload,
} from "../lib/projects/brain/execution/execution-plan-validation.js";

const drivingSchoolProject = {
  id: "ds-1",
  name: "Trecerea școlii de șoferi",
  goal: "Obținerea permisului de conducere",
  category_slug: "personal",
};

const enrollmentStep = {
  id: "ds-step-enroll",
  title: "Înscrierea la școala de șoferi",
  description: "Alege școala, pregătește documentele și programează înscrierea.",
  expected_outcome: "Înscriere confirmată la școala aleasă",
};

function buildPreparation(step, project, missingFields = []) {
  return {
    title: step.title,
    explanation: step.description,
    whyItMatters: "Important pentru proiect.",
    expectedResult: step.expected_outcome,
    missingFields,
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

function buildContext(step = enrollmentStep, project = drivingSchoolProject) {
  return buildExecutionPlanContext({
    project,
    step,
    preparation: buildPreparation(step, project),
  });
}

describe("projects execution plan completeness", () => {
  it("choice with zero options is invalid", () => {
    const result = validateExecutionPlanCompleteness(
      { mode: "choice", choices: [], title: "Alege", explanation: "x" },
      buildContext(),
    );
    assert.equal(result.valid, false);
    assert.equal(result.reason, "choice_needs_options");
  });

  it("choice with one option is invalid", () => {
    const result = validateExecutionPlanCompleteness(
      {
        mode: "choice",
        choices: [{ id: "a", title: "Singura", value: "a" }],
        title: "Alege",
        explanation: "x",
      },
      buildContext(),
    );
    assert.equal(result.valid, false);
  });

  it("choice with two valid options is accepted for decision steps", () => {
    const decisionStep = {
      ...enrollmentStep,
      title: "Alege școala de șoferi",
      description: "Compară opțiunile și alege varianta potrivită.",
    };
    const result = validateExecutionPlanCompleteness(
      {
        mode: "choice",
        choices: [
          { id: "a", title: "Școala A", value: "a" },
          { id: "b", title: "Școala B", value: "b" },
        ],
        title: decisionStep.title,
        explanation: decisionStep.description,
      },
      buildContext(decisionStep),
    );
    assert.equal(result.valid, true);
  });

  it("structured form with no fields is invalid", () => {
    const result = validateExecutionPlanCompleteness(
      { mode: "structured_form", requiredInputs: [], title: "Form", explanation: "x" },
      buildContext(),
    );
    assert.equal(result.valid, false);
    assert.equal(result.reason, "form_needs_fields");
  });

  it("assessment with no questions is invalid", () => {
    const result = validateExecutionPlanCompleteness(
      { mode: "assessment", questions: [], title: "Test", explanation: "x" },
      buildContext(),
    );
    assert.equal(result.valid, false);
  });

  it("guided questions with no questions is invalid", () => {
    const result = validateExecutionPlanCompleteness(
      { mode: "guided_questions", questions: [], title: "Q", explanation: "x" },
      buildContext(),
    );
    assert.equal(result.valid, false);
  });

  it("checklist with no items is invalid", () => {
    const result = validateExecutionPlanCompleteness(
      { mode: "checklist", checklistItems: [], title: "Listă", explanation: "x" },
      buildContext(),
    );
    assert.equal(result.valid, false);
  });

  it("incomplete AI plan triggers repair then contextual fallback", async () => {
    let callCount = 0;
    const generated = await generateExecutionPlan({
      project: drivingSchoolProject,
      step: enrollmentStep,
      preparation: buildPreparation(enrollmentStep, drivingSchoolProject),
      memoryMap: new Map(),
      apiKey: "test-key",
      fetchImpl: async () => {
        callCount += 1;
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    mode: "choice",
                    title: "Alege direcția potrivită",
                    explanation: "Generic",
                    whyThisAction: "Important",
                    expectedOutcome: enrollmentStep.expected_outcome,
                    userActionType: "select",
                    userActionInstruction: "Alege",
                    primaryActionLabel: "Confirmă alegerea",
                    evaluationStrategy: "none",
                    resultFormat: "none",
                    outputTypes: ["text"],
                    requiredInputs: [],
                    questions: [],
                    choices: [],
                    checklistItems: [],
                    requireAll: true,
                    minimumResponses: 0,
                    requiresUserAcceptance: true,
                  }),
                },
              },
            ],
          }),
        };
      },
    });

    assert.ok(callCount >= 2);
    assert.equal(generated.source, "contextual_fallback");
    assert.notEqual(generated.plan.mode, "choice");
    assert.ok(generated.plan.checklistItems?.length >= 1 || generated.plan.requiredInputs?.length >= 1);
  });

  it("invalid persisted choice plan is regenerated", async () => {
    const invalidPlan = {
      planId: "broken-plan",
      version: 1,
      mode: "choice",
      title: "Alege direcția potrivită",
      explanation: "Generic",
      whyThisAction: "Important",
      expectedOutcome: enrollmentStep.expected_outcome,
      userAction: { type: "select", instruction: "Alege" },
      choices: [],
      requiredInputs: [],
      questions: [],
      checklistItems: [],
      completionCriteria: { requireAll: true, requiresUserAcceptance: true },
      outputTypes: ["text"],
      primaryActionLabel: "Confirmă alegerea",
      source: "openai",
    };

    const ensured = await ensureExecutionPlan({
      baseUrl: "https://example.supabase.co",
      secretKey: "key",
      userId: "user-1",
      actionRow: {
        id: "action-1",
        prepared_input: withExecutionPlan({}, invalidPlan),
        collected_input: {},
      },
      project: drivingSchoolProject,
      step: enrollmentStep,
      preparation: buildPreparation(enrollmentStep, drivingSchoolProject),
      memoryMap: new Map(),
      schemaCapabilities: { sessionColumns: false },
      fetchImpl: async () => ({ ok: false }),
    });

    assert.notEqual(ensured.plan.planId, invalidPlan.planId);
    assert.notEqual(ensured.plan.mode, "choice");
    const payload = serializeInteractivePayloadFromPlan(ensured.plan);
    const validation = validateInteractivePayload(ensured.plan.mode, payload);
    assert.equal(validation.valid, true);
  });

  it("driving-school enrollment step receives a usable checklist action", () => {
    const fallback = buildContextualExecutionPlanFallback(
      buildContext(),
      buildPreparation(enrollmentStep, drivingSchoolProject),
    );

    assert.equal(fallback.mode, "checklist");
    assert.ok(fallback.checklistItems.length >= 3);
    const payload = serializeInteractivePayloadFromPlan(fallback);
    assert.equal(payload.type, "checklist");
    assert.ok(payload.items.length >= 3);
    assert.equal(validateInteractivePayload("checklist", payload).valid, true);
  });

  it("runtime never emits empty generic interactive choice payload", () => {
    const emptyChoicePlan = {
      mode: "choice",
      choices: [],
      title: "Alege",
      explanation: "x",
    };
    const payload = serializeInteractivePayloadFromPlan(emptyChoicePlan);
    assert.equal(validateInteractivePayload("choice", payload).valid, false);
  });

  it("executable plans include metadata version 2", () => {
    const fallback = buildContextualExecutionPlanFallback(
      buildContext(),
      buildPreparation(enrollmentStep, drivingSchoolProject),
    );
    assert.equal(fallback.metadata?.version, EXECUTION_PLAN_VERSION);
    assert.ok(fallback.metadata?.generatedAt);
    assert.equal(fallback.metadata?.source, "contextual_fallback");
  });

  it("normalize rejects empty choice plans from AI", () => {
    const normalized = normalizeExecutionPlan(
      {
        mode: "choice",
        title: "Alege",
        explanation: "x",
        whyThisAction: "y",
        expectedOutcome: "z",
        userActionType: "select",
        userActionInstruction: "Alege",
        primaryActionLabel: "Confirmă",
        evaluationStrategy: "none",
        resultFormat: "none",
        outputTypes: ["text"],
        requiredInputs: [],
        questions: [],
        choices: [],
        checklistItems: [],
        requireAll: true,
        minimumResponses: 0,
        requiresUserAcceptance: true,
      },
      buildContext(),
    );
    assert.equal(normalized.ok, false);
  });
});
