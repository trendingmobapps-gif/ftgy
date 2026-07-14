import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildExecutionDefinition, resolveExecutionMode } from "../lib/projects/brain/execution/definition.js";
import {
  buildContextualExecutionPlanFallback,
  buildExecutionPlanContext,
  containsPresetQuestionBank,
  ensureExecutionPlan,
  executionPlanToExecutionDefinition,
  generateExecutionPlan,
  getExecutionPlanFromPreparedInput,
  normalizeExecutionPlan,
  serializeInteractivePayloadFromPlan,
  withExecutionPlan,
} from "../lib/projects/brain/execution/execution-plan-generator.js";
import { EXECUTION_MODES } from "../lib/projects/brain/execution/execution-modes.js";

const medicalProject = {
  id: "med-1",
  name: "Pregătire pentru examen medical",
  goal: "Pregătire pentru examenul de rezidențiat la cardiologie",
  summary: "Plan de studiu medical",
  category_slug: "studii",
};

const medicalStep = {
  id: "med-step",
  title: "Evaluează nivelul actual de cunoștințe",
  description: "Determină lacunele de pregătire.",
  expected_outcome: "Nivelul de pregătire este clar orientativ",
};

const englishProject = {
  id: "en-1",
  name: "Învățare limba engleză",
  goal: "Îmbunătățirea nivelului de engleză",
  category_slug: "studii",
};

const englishStep = {
  id: "en-step",
  title: "Evaluează nivelul actual de engleză",
  description: "Determină punctul de plecare.",
  expected_outcome: "Nivelul de engleză este clar",
};

const budgetStep = {
  id: "budget-step",
  title: "Creează bugetul inițial",
  description: "Structurează costurile de lansare.",
  expected_outcome: "Buget inițial complet",
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

describe("projects AI execution plan", () => {
  it("different steps can produce different execution modes from AI plan", () => {
    const assessmentPlan = normalizeExecutionPlan(
      {
        mode: "assessment",
        title: medicalStep.title,
        explanation: medicalStep.description,
        whyThisAction: "Trebuie evaluat nivelul de pregătire.",
        expectedOutcome: medicalStep.expected_outcome,
        userActionType: "answer",
        userActionInstruction: "Răspunde la întrebările de pregătire medicală.",
        primaryActionLabel: "Începe evaluarea",
        evaluationStrategy: "ai_evaluated",
        resultFormat: "readiness_summary",
        outputTypes: ["quiz_result", "text"],
        requiredInputs: [],
        questions: [
          {
            id: "q1",
            type: "single_choice",
            prompt: "Care este rolul principal al valvei mitrale?",
            required: true,
            options: [
              { id: "a", label: "Separă atriul stâng de ventriculul stâng", value: "a" },
              { id: "b", label: "Pompează sângele spre plămâni", value: "b" },
            ],
            correctOptionId: null,
            rubric: null,
          },
          {
            id: "q2",
            type: "long_text",
            prompt: "Ce subiecte medicale consideri cele mai dificile?",
            required: true,
            options: [],
            correctOptionId: null,
            rubric: null,
          },
          {
            id: "q3",
            type: "single_choice",
            prompt: "Ce clasă de medicamente include atorvastatina?",
            required: true,
            options: [
              { id: "a", label: "Statine", value: "a" },
              { id: "b", label: "Beta-blocante", value: "b" },
            ],
            correctOptionId: null,
            rubric: null,
          },
        ],
        choices: [],
        requireAll: true,
        minimumResponses: 3,
        requiresUserAcceptance: true,
      },
      buildExecutionPlanContext({
        project: medicalProject,
        step: medicalStep,
        preparation: buildPreparation(medicalStep, medicalProject),
      }),
    );

    const formPlan = normalizeExecutionPlan(
      {
        mode: "structured_form",
        title: budgetStep.title,
        explanation: budgetStep.description,
        whyThisAction: "Bugetul structurează deciziile.",
        expectedOutcome: budgetStep.expected_outcome,
        userActionType: "complete_form",
        userActionInstruction: "Completează câmpurile bugetului.",
        primaryActionLabel: "Generează rezultatul",
        evaluationStrategy: "none",
        resultFormat: "table",
        outputTypes: ["table", "xlsx"],
        requiredInputs: [
          {
            id: "rent",
            type: "number",
            label: "Chirie lunară",
            placeholder: "Chirie",
            required: true,
            options: [],
          },
          {
            id: "equipment",
            type: "number",
            label: "Echipament",
            placeholder: "Echipament",
            required: true,
            options: [],
          },
        ],
        questions: [],
        choices: [],
        requireAll: true,
        minimumResponses: 2,
        requiresUserAcceptance: true,
      },
      buildExecutionPlanContext({
        project: { name: "Lansare cafenea", goal: "Deschid cafenea", category_slug: "business" },
        step: budgetStep,
        preparation: buildPreparation(budgetStep, { name: "Lansare cafenea", goal: "Deschid cafenea" }),
      }),
    );

    assert.equal(assessmentPlan.ok, true);
    assert.equal(formPlan.ok, true);
    assert.equal(assessmentPlan.plan.mode, "assessment");
    assert.equal(formPlan.plan.mode, "structured_form");
    assert.notEqual(assessmentPlan.plan.mode, formPlan.plan.mode);
  });

  it("uses execution plan mode instead of keyword heuristics", () => {
    const plan = normalizeExecutionPlan(
      {
        mode: "generator",
        title: medicalStep.title,
        explanation: medicalStep.description,
        whyThisAction: "ITER generează sinteza.",
        expectedOutcome: medicalStep.expected_outcome,
        userActionType: "generate",
        userActionInstruction: "Generează rezultatul pentru acest pas.",
        primaryActionLabel: "Generează rezultatul",
        evaluationStrategy: "none",
        resultFormat: "none",
        outputTypes: ["text"],
        requiredInputs: [],
        questions: [],
        choices: [],
        requireAll: false,
        minimumResponses: 0,
        requiresUserAcceptance: true,
      },
      buildExecutionPlanContext({
        project: medicalProject,
        step: medicalStep,
        preparation: buildPreparation(medicalStep, medicalProject),
      }),
    ).plan;

    const keywordMode = resolveExecutionMode({
      step: medicalStep,
      preparation: buildPreparation(medicalStep, medicalProject),
      session: null,
      executionDecision: null,
      memoryMap: new Map(),
    });

    const plannedMode = resolveExecutionMode({
      step: medicalStep,
      preparation: buildPreparation(medicalStep, medicalProject),
      session: null,
      executionDecision: null,
      memoryMap: new Map(),
      executionPlan: plan,
    });

    assert.equal(keywordMode, "assessment");
    assert.equal(plannedMode, "generator");
  });

  it("not every step becomes assessment in contextual fallback", () => {
    const context = buildExecutionPlanContext({
      project: { name: "Lansare cafenea", goal: "Deschid cafenea", category_slug: "business" },
      step: budgetStep,
      preparation: buildPreparation(budgetStep, { name: "Lansare cafenea", goal: "Deschid cafenea" }, [
        { key: "rent", label: "Chirie", required: true },
        { key: "equipment", label: "Echipament", required: true },
        { key: "marketing", label: "Marketing", required: true },
      ]),
    });

    const fallback = buildContextualExecutionPlanFallback(
      context,
      buildPreparation(budgetStep, { name: "Lansare cafenea" }, [
        { key: "rent", label: "Chirie", required: true },
        { key: "equipment", label: "Echipament", required: true },
        { key: "marketing", label: "Marketing", required: true },
      ]),
    );

    assert.notEqual(fallback.mode, "assessment");
    assert.equal(fallback.mode, "spreadsheet_builder");
  });

  it("rejects unsupported model modes and preset banks", () => {
    const context = buildExecutionPlanContext({
      project: medicalProject,
      step: medicalStep,
      preparation: buildPreparation(medicalStep, medicalProject),
    });

    const unsupported = normalizeExecutionPlan({ mode: "custom_chat_ui" }, context);
    assert.equal(unsupported.ok, false);

    assert.equal(containsPresetQuestionBank({ questions: [{ prompt: "Alege pluralul corect pentru „child”." }] }), true);
  });

  it("persists and reuses execution plan on resume", async () => {
    const existingPlan = buildContextualExecutionPlanFallback(
      buildExecutionPlanContext({
        project: englishProject,
        step: englishStep,
        preparation: buildPreparation(englishStep, englishProject),
      }),
      buildPreparation(englishStep, englishProject),
    );

    const actionRow = {
      id: "action-1",
      prepared_input: withExecutionPlan({}, existingPlan),
      collected_input: {},
    };

    const ensured = await ensureExecutionPlan({
      baseUrl: "https://example.supabase.co",
      secretKey: "key",
      userId: "user-1",
      actionRow,
      project: englishProject,
      step: englishStep,
      preparation: buildPreparation(englishStep, englishProject),
      memoryMap: new Map(),
      schemaCapabilities: { sessionColumns: false },
    });

    assert.equal(ensured.plan.planId, existingPlan.planId);
    assert.equal(getExecutionPlanFromPreparedInput(ensured.action.prepared_input).planId, existingPlan.planId);
  });

  it("serializes interactive payloads only for interactive modes", () => {
    const choicePlan = {
      planId: "plan-choice",
      mode: "choice",
      title: "Alege direcția",
      explanation: "Alege varianta potrivită.",
      whyThisAction: "Direcția influențează restul proiectului.",
      expectedOutcome: "Direcție clară",
      userAction: { type: "select", instruction: "Alege o direcție." },
      choices: [
        { id: "a", title: "Modern", value: "modern", description: null },
        { id: "b", title: "Clasic", value: "classic", description: null },
      ],
      requiredInputs: [],
      questions: [],
      completionCriteria: { requireAll: true, requiresUserAcceptance: true },
      outputTypes: ["text"],
      primaryActionLabel: "Confirmă alegerea",
      evaluationStrategy: "none",
      resultFormat: "none",
      source: "ai_generated",
    };

    const payload = serializeInteractivePayloadFromPlan(choicePlan);
    assert.equal(payload.type, "choice");
    assert.equal(payload.options.length, 2);

    const generatorPayload = serializeInteractivePayloadFromPlan({
      ...choicePlan,
      mode: "generator",
      choices: [],
    });
    assert.equal(generatorPayload, null);
  });

  it("builds execution definition from plan for mobile rendering", () => {
    const definition = executionPlanToExecutionDefinition(
      normalizeExecutionPlan(
        {
          mode: "choice",
          title: "Alege brandingul",
          explanation: "Selectează direcția vizuală.",
          whyThisAction: "Brandingul ghidează materialele.",
          expectedOutcome: "Direcție aleasă",
          userActionType: "select",
          userActionInstruction: "Alege o direcție de branding.",
          primaryActionLabel: "Confirmă alegerea",
          evaluationStrategy: "none",
          resultFormat: "none",
          outputTypes: ["text"],
          requiredInputs: [],
          questions: [],
          choices: [
            { id: "a", title: "Minimal", description: "Curat", value: "minimal" },
            { id: "b", title: "Expresiv", description: "Îndrăzneț", value: "expresiv" },
          ],
          requireAll: true,
          minimumResponses: 1,
          requiresUserAcceptance: true,
        },
        buildExecutionPlanContext({
          project: { name: "Brand startup", goal: "Branding", category_slug: "business" },
          step: { title: "Alege direcția de branding", description: "", expected_outcome: "Branding ales" },
          preparation: buildPreparation(
            { title: "Alege direcția de branding", description: "", expected_outcome: "Branding ales" },
            { name: "Brand startup", goal: "Branding" },
          ),
        }),
      ).plan,
    );

    assert.equal(definition.mode, "choice");
    assert.ok(definition.requiredInputs[0]?.options?.length >= 2);
  });

  it("generates execution plan from OpenAI using project context", async () => {
    const generated = await generateExecutionPlan({
      project: medicalProject,
      step: medicalStep,
      preparation: buildPreparation(medicalStep, medicalProject),
      memoryMap: new Map([["specialitate", "cardiologie"]]),
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  mode: "assessment",
                  title: "Evaluare pregătire medicală",
                  explanation: "Evaluare orientativă pentru cardiologie.",
                  whyThisAction: "Trebuie să înțelegem nivelul actual.",
                  expectedOutcome: medicalStep.expected_outcome,
                  userActionType: "answer",
                  userActionInstruction: "Răspunde la întrebările de pregătire.",
                  primaryActionLabel: "Începe evaluarea",
                  evaluationStrategy: "ai_evaluated",
                  resultFormat: "readiness_summary",
                  outputTypes: ["quiz_result", "text"],
                  requiredInputs: [],
                  questions: [
                    {
                      id: "q1",
                      type: "single_choice",
                      prompt: "Care este rolul principal al valvei mitrale?",
                      required: true,
                      options: [
                        { id: "a", label: "Separă atriul stâng de ventriculul stâng", value: "a" },
                        { id: "b", label: "Pompează sângele spre plămâni", value: "b" },
                      ],
                      correctOptionId: null,
                      rubric: null,
                    },
                    {
                      id: "q2",
                      type: "long_text",
                      prompt: "Ce capitole ți se par cele mai dificile?",
                      required: true,
                      options: [],
                      correctOptionId: null,
                      rubric: null,
                    },
                    {
                      id: "q3",
                      type: "single_choice",
                      prompt: "Ce clasă include atorvastatina?",
                      required: true,
                      options: [
                        { id: "a", label: "Statine", value: "a" },
                        { id: "b", label: "Beta-blocante", value: "b" },
                      ],
                      correctOptionId: null,
                      rubric: null,
                    },
                  ],
                  choices: [],
                  requireAll: true,
                  minimumResponses: 3,
                  requiresUserAcceptance: true,
                }),
              },
            },
          ],
        }),
      }),
    });

    assert.equal(generated.source, "openai");
    assert.equal(generated.plan.mode, "assessment");
    assert.doesNotMatch(JSON.stringify(generated.plan), /I go to school|childs/i);
  });

  it("exposes only controlled execution modes", () => {
    assert.ok(EXECUTION_MODES.includes("generator"));
    assert.ok(EXECUTION_MODES.includes("research"));
    assert.equal(EXECUTION_MODES.includes("custom_widget"), false);
  });

  it("buildExecutionDefinition prefers persisted plan over keywords", () => {
    const plan = buildContextualExecutionPlanFallback(
      buildExecutionPlanContext({
        project: medicalProject,
        step: medicalStep,
        preparation: buildPreparation(medicalStep, medicalProject),
      }),
      buildPreparation(medicalStep, medicalProject),
    );

    const definition = buildExecutionDefinition({
      project: medicalProject,
      step: medicalStep,
      milestone: { title: "Evaluare" },
      preparation: buildPreparation(medicalStep, medicalProject),
      executionPlan: plan,
    });

    assert.equal(definition.mode, plan.mode);
  });
});
