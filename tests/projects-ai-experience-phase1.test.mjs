import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it, beforeEach, afterEach } from "node:test";

import { adaptStructuredFormPlanToExperience } from "../lib/projects/brain/execution/ai-experience-adapter.js";
import { validateExperienceSchema } from "../lib/projects/brain/execution/ai-experience-validation.js";
import { isAiExperienceV1Enabled, PHASE_1_COMPONENT_TYPES } from "../lib/projects/brain/execution/ai-experience-schema.js";
import {
  buildActiveExecutionContract,
  validateActiveExecutionContract,
} from "../lib/projects/brain/execution/active-execution-contract.js";
import {
  mergeExperienceValues,
  normalizeExperienceProgress,
  normalizeExperienceSubmit,
  validateExperienceValues,
} from "../lib/projects/brain/execution/experience-values-normalizer.js";
import { normalizeAcceptedExecutionInput } from "../lib/projects/brain/actions/accepted-input-normalizer.js";
import { validateStepCompletion, loadCompletionContext } from "../lib/projects/brain/execution/completion-evaluator.js";
import {
  cacheExperienceExecution,
  getCachedExperienceExecution,
  resetExperienceIdempotencyForTests,
} from "../lib/projects/brain/execution/experience-idempotency.js";

const structuredFormPlan = {
  mode: "structured_form",
  title: "Plan de studiu",
  explanation: "Completează detaliile",
  whyThisAction: "Contează pentru progres",
  expectedOutcome: "Plan personalizat",
  primaryActionLabel: "Generează planul",
  requiredInputs: [
    { id: "topic", type: "text", label: "Subiect", required: true },
    { id: "notes", type: "textarea", label: "Note", required: true },
    { id: "hours", type: "number", label: "Ore", required: true, min: 1, max: 12 },
    {
      id: "priority",
      type: "single_choice",
      label: "Prioritate",
      required: true,
      options: [
        { id: "high", label: "Ridicată" },
        { id: "low", label: "Scăzută" },
      ],
    },
    {
      id: "tags",
      type: "multiple_choice",
      label: "Etichete",
      required: false,
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    },
    { id: "reminder", type: "boolean", label: "Reminder", required: false },
  ],
  completionCriteria: { requireUserAcceptance: true, requireGeneratedResult: true },
};

const executionDefinition = {
  mode: "structured_form",
  title: structuredFormPlan.title,
  explanation: structuredFormPlan.explanation,
  whyItMatters: structuredFormPlan.whyThisAction,
  expectedOutcome: structuredFormPlan.expectedOutcome,
  requiredInputs: structuredFormPlan.requiredInputs,
};

function buildSampleExperience() {
  const adapted = adaptStructuredFormPlanToExperience({
    executionPlan: structuredFormPlan,
    executionDefinition,
    actionId: "a1",
    stepId: "s1",
  });
  assert.equal(adapted.ok, true);
  return adapted.experience;
}

describe("projects ai experience phase 1", () => {
  let previousFlag;

  beforeEach(() => {
    previousFlag = process.env.PROJECT_AI_EXPERIENCE_V1_ENABLED;
  });

  afterEach(() => {
    if (previousFlag == null) {
      delete process.env.PROJECT_AI_EXPERIENCE_V1_ENABLED;
    } else {
      process.env.PROJECT_AI_EXPERIENCE_V1_ENABLED = previousFlag;
    }
  });

  it("1. structured_form adapter creates valid experience", () => {
    const experience = buildSampleExperience();
    const validation = validateExperienceSchema(experience);
    assert.equal(validation.valid, true);
    assert.equal(experience.experienceVersion, 1);
    assert.ok(experience.sections.length >= 2);
    assert.equal(experience.actions.primary.type, "submit");
    assert.ok(experience.actions.secondary.some((row) => row.type === "save_progress"));
  });

  it("2. every Phase 1 component validates", () => {
    for (const type of PHASE_1_COMPONENT_TYPES) {
      const base = {
        experienceId: `exp_${type}`,
        experienceVersion: 1,
        metadata: {
          title: "Test",
          description: "",
          whyItMatters: "",
          expectedOutcome: "",
        },
        sections: [{ id: "s1", title: null, description: null, components: [] }],
        actions: {
          primary: { id: "submit", type: "submit", label: "Trimite" },
          secondary: [{ id: "save_progress", type: "save_progress", label: "Salvează" }],
        },
        resultDefinition: {
          type: "summary",
          title: "Rezultat",
          createResource: true,
          updateMemory: true,
          reconsiderWorkflow: false,
          requireReview: true,
          requireAcceptance: true,
        },
        completionCriteria: {
          requireAllRequiredComponents: true,
          requireGeneratedResult: true,
          requireUserReview: false,
          requireUserAcceptance: true,
          requireExplicitFinalize: true,
        },
      };

      const componentByType = {
        text_block: { id: "t1", type: "text_block", variant: "paragraph", content: "Hello" },
        callout: { id: "c1", type: "callout", variant: "info", title: null, content: "Info" },
        short_text: { id: "st1", type: "short_text", label: "Nume", required: false },
        long_text: { id: "lt1", type: "long_text", label: "Descriere", required: false },
        number: { id: "n1", type: "number", label: "Număr", required: false },
        boolean: { id: "b1", type: "boolean", label: "Da/Nu", required: false },
        single_select: {
          id: "ss1",
          type: "single_select",
          label: "Alege",
          required: false,
          presentation: "list",
          options: [{ id: "o1", label: "Unu" }],
        },
        multi_select: {
          id: "ms1",
          type: "multi_select",
          label: "Multi",
          required: false,
          presentation: "list",
          options: [{ id: "o1", label: "Unu" }],
        },
        confirmation: { id: "cf1", type: "confirmation", label: "Confirm", required: false },
      };

      base.sections[0].components = [componentByType[type]];
      const validation = validateExperienceSchema(base);
      assert.equal(validation.valid, true, `expected ${type} to validate`);
    }
  });

  it("3. duplicate IDs rejected", () => {
    const experience = buildSampleExperience();
    experience.sections[1].components.push({ ...experience.sections[1].components[0] });
    const validation = validateExperienceSchema(experience);
    assert.equal(validation.valid, false);
  });

  it("4. unsupported component rejected", () => {
    const experience = buildSampleExperience();
    experience.sections[1].components.push({
      id: "quiz_1",
      type: "quiz",
      label: "Quiz",
    });
    const validation = validateExperienceSchema(experience);
    assert.equal(validation.valid, false);
  });

  it("5. option value tampering rejected", () => {
    const experience = buildSampleExperience();
    const validation = validateExperienceValues(
      experience,
      {
        topic: "Bio",
        notes: "Long notes",
        hours: 4,
        priority: "tampered",
        confirm_submission: { confirmed: true },
      },
      { strict: true },
    );
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((row) => row.code === "EXPERIENCE_INVALID_OPTION"));
  });

  it("6. required text missing rejected", () => {
    const experience = buildSampleExperience();
    const validation = validateExperienceValues(
      experience,
      { hours: 4, priority: "high", confirm_submission: { confirmed: true } },
      { strict: true },
    );
    assert.equal(validation.valid, false);
  });

  it("7. number outside min/max rejected", () => {
    const experience = buildSampleExperience();
    const validation = validateExperienceValues(
      experience,
      {
        topic: "Bio",
        notes: "Notes",
        hours: 99,
        priority: "high",
        confirm_submission: { confirmed: true },
      },
      { strict: true },
    );
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((row) => row.code === "EXPERIENCE_NUMBER_ABOVE_MAX"));
  });

  it("8. multi-select limits enforced", () => {
    const experience = buildSampleExperience();
    const validation = validateExperienceValues(
      experience,
      {
        topic: "Bio",
        notes: "Notes",
        hours: 4,
        priority: "high",
        tags: ["a", "b", "c"],
        confirm_submission: { confirmed: true },
      },
      { strict: true },
    );
    assert.equal(validation.valid, false);
  });

  it("9. confirmation required and false rejected", () => {
    const experience = buildSampleExperience();
    const validation = validateExperienceValues(
      experience,
      {
        topic: "Bio",
        notes: "Notes",
        hours: 4,
        priority: "high",
        confirm_submission: { confirmed: false },
      },
      { strict: true },
    );
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((row) => row.code === "EXPERIENCE_CONFIRMATION_REQUIRED"));
  });

  it("10. progress partial merge", () => {
    const experience = buildSampleExperience();
    const merged = mergeExperienceValues({}, { topic: "Bio", hours: 3 }, experience);
    assert.equal(merged.topic, "Bio");
    assert.equal(merged.hours, 3);
    assert.equal(merged.notes, undefined);
  });

  it("11. progress resume", () => {
    const experience = buildSampleExperience();
    const progress = normalizeExperienceProgress(
      {
        type: "experience",
        experienceId: experience.experienceId,
        experienceVersion: 1,
        values: { topic: "Bio", notes: "Saved" },
      },
      experience,
    );
    assert.equal(progress.values.topic, "Bio");
    assert.equal(progress.values.notes, "Saved");
  });

  it("12. submit normalization", () => {
    const experience = buildSampleExperience();
    const normalized = normalizeExperienceSubmit(
      {
        type: "experience",
        contractId: "c1",
        experienceId: experience.experienceId,
        experienceVersion: 1,
        values: {
          topic: "Bio",
          notes: "Notes",
          hours: "4",
          priority: "high",
          confirm_submission: { confirmed: true },
        },
        idempotencyKey: randomUUID(),
      },
      experience,
    );
    assert.equal(normalized.type, "experience");
    assert.equal(normalized.values.hours, 4);
    assert.ok(normalized.idempotencyKey);
  });

  it("13. experience embedded in active contract", () => {
    const experience = buildSampleExperience();
    const contract = buildActiveExecutionContract({
      projectId: "p1",
      stepId: "s1",
      action: { actionId: "a1", id: "a1" },
      session: { sessionId: "a1", phase: "collecting" },
      executionPlan: structuredFormPlan,
      executionDefinition,
      interactivePayload: { type: "structured_form", fields: [] },
      experience,
      experienceValid: true,
    });
    const validation = validateActiveExecutionContract(contract);
    assert.equal(validation.valid, true);
    assert.equal(contract.experience.experienceId, experience.experienceId);
  });

  it("14. feature flag off returns legacy only", () => {
    process.env.PROJECT_AI_EXPERIENCE_V1_ENABLED = "false";
    assert.equal(isAiExperienceV1Enabled(), false);
    const adapted = adaptStructuredFormPlanToExperience({
      executionPlan: structuredFormPlan,
      executionDefinition,
    });
    assert.equal(adapted.ok, true);
  });

  it("15. feature flag on enables adapter attachment path", () => {
    process.env.PROJECT_AI_EXPERIENCE_V1_ENABLED = "true";
    assert.equal(isAiExperienceV1Enabled(), true);
    const adapted = adaptStructuredFormPlanToExperience({
      executionPlan: structuredFormPlan,
      executionDefinition,
    });
    assert.equal(adapted.ok, true);
    assert.equal(adapted.generatedBy, "adapter");
  });

  it("16. completion evaluator uses experience values", () => {
    const experience = buildSampleExperience();
    const incomplete = validateStepCompletion({
      plan: structuredFormPlan,
      collectedInput: { experience: { values: { topic: "Bio" } } },
      experience,
    });
    assert.equal(incomplete.canFinalize, false);

    const complete = validateStepCompletion({
      plan: structuredFormPlan,
      collectedInput: {
        experience: {
          values: {
            topic: "Bio",
            notes: "Notes",
            hours: 4,
            priority: "high",
            confirm_submission: { confirmed: true },
          },
        },
        interactive: { resultAccepted: true, generatedResultId: "r1" },
      },
      pendingResult: { id: "r1" },
      experience,
    });
    assert.equal(complete.canFinalize, true);
  });

  it("17. full structured_form lifecycle helpers", () => {
    const experience = buildSampleExperience();
    const action = {
      prepared_input: { _experience: experience, _executionPlan: structuredFormPlan },
      collected_input: {},
    };

    const progress = normalizeExperienceProgress(
      {
        type: "experience",
        experienceId: experience.experienceId,
        experienceVersion: 1,
        values: { topic: "Bio", notes: "Notes" },
      },
      experience,
    );
    action.collected_input.experience = progress;

    const submitInput = normalizeAcceptedExecutionInput({
      acceptedInput: {
        type: "experience",
        contractId: "a1:plan:structured_form",
        experienceId: experience.experienceId,
        experienceVersion: 1,
        values: {
          topic: "Bio",
          notes: "Notes",
          hours: 4,
          priority: "high",
          confirm_submission: { confirmed: true },
        },
        idempotencyKey: randomUUID(),
      },
      executionPlan: structuredFormPlan,
      action: action,
    });
    assert.equal(submitInput.type, "experience");
    assert.equal(submitInput.interactive.formValues.topic, "Bio");

    const completion = loadCompletionContext(
      {
        prepared_input: action.prepared_input,
        collected_input: {
          ...action.collected_input,
          experience: {
            experienceId: experience.experienceId,
            experienceVersion: 1,
            values: {
              topic: "Bio",
              notes: "Notes",
              hours: 4,
              priority: "high",
              confirm_submission: { confirmed: true },
            },
          },
          interactive: { resultAccepted: true, generatedResultId: "r1" },
        },
      },
      { id: "r1" },
      { id: "r1" },
    );
    assert.equal(completion.canFinalize, true);

    const key = randomUUID();
    cacheExperienceExecution("a1", key, { resultId: "r1" });
    assert.deepEqual(getCachedExperienceExecution("a1", key), { resultId: "r1" });
    resetExperienceIdempotencyForTests();
  });
});
