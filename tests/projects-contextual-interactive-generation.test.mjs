import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAssessmentInternal,
  evaluateAssessmentAnswers,
  serializeAssessmentPayload,
  withAssessmentInternal,
  getAssessmentInternalFromPreparedInput,
} from "../lib/projects/brain/execution/assessment.js";
import {
  buildContextualInteractiveFallback,
  buildInteractiveGenerationContext,
  containsEnglishGrammarPreset,
  generateAssessmentInternal,
  isLanguageLearningContext,
  normalizeGeneratedInteractivePayload,
} from "../lib/projects/brain/execution/interactive-generator.js";

const englishStep = {
  id: "dcfc28bf-68b7-4509-b47b-c5d68bc9a116",
  title: "Evaluează nivelul actual de engleză",
  description: "Determină punctul de plecare.",
  expected_outcome: "Nivelul actual de engleză este clar identificat",
};

const englishProject = {
  id: "6713ef1c-d81c-41d2-9539-608aeca149cb",
  name: "Învățare limba engleză",
  goal: "Îmbunătățirea nivelului de engleză",
  category_slug: "studii",
};

const medicalStep = {
  id: "med-step-1",
  title: "Evaluează nivelul actual de cunoștințe",
  description: "Determină punctele forte și lacunele pentru examenul medical.",
  expected_outcome: "Nivelul de pregătire medicală este clar orientativ",
};

const medicalProject = {
  id: "med-project-1",
  name: "Pregătire pentru examen medical",
  goal: "Pregătire pentru examenul de rezidențiat la cardiologie",
  category_slug: "studii",
};

const businessStep = {
  id: "biz-step-1",
  title: "Evaluează poziționarea actuală",
  description: "Clarifică punctele forte ale ofertei.",
  expected_outcome: "Poziționarea în piață este clară",
};

const businessProject = {
  id: "biz-project-1",
  name: "Lansare cafenea",
  goal: "Deschiderea unei cafenele profitabile în Cluj",
  category_slug: "business",
};

function buildMedicalContext() {
  return buildInteractiveGenerationContext({
    project: medicalProject,
    step: medicalStep,
    preparation: {
      expectedResult: medicalStep.expected_outcome,
      whyItMatters: "Fără evaluare, planul de studiu este ineficient.",
    },
  });
}

describe("projects contextual interactive generation", () => {
  it("removes hardcoded English grammar runtime questions from assessment builder", () => {
    const internal = buildAssessmentInternal({ step: medicalStep, project: medicalProject });
    const serialized = JSON.stringify(internal);

    assert.doesNotMatch(serialized, /I go to school|childs|childrens|doesn't like coffee/i);
    assert.doesNotMatch(serialized, /alege varianta corectă pentru propoziția/i);
    assert.ok(internal.questions.length >= 3);
    assert.match(internal.questions[0].prompt, /Pregătire pentru examen medical|nivelul actual|cunoștințe/i);
  });

  it("rejects unrelated English preset payloads for non-language projects", () => {
    const context = buildMedicalContext();
    const rejected = normalizeGeneratedInteractivePayload(
      {
        mode: "assessment",
        title: "Evaluare",
        instructions: "Test",
        evaluationStrategy: "rule_based",
        resultFormat: "competency_summary",
        domainSummary: "Medical",
        minimumAnswers: 6,
        requireAll: true,
        questions: [
          {
            id: "q1",
            type: "single_choice",
            prompt: "Alege varianta corectă pentru propoziția: „Eu merg la școală în fiecare zi.”",
            required: true,
            options: [
              { id: "q1_a", label: "I am go to school every day.", value: "q1_a" },
              { id: "q1_b", label: "I go to school every day.", value: "q1_b" },
            ],
            correctOptionId: "q1_b",
            rubric: null,
          },
          {
            id: "q2",
            type: "single_choice",
            prompt: "Alege pluralul corect pentru „child”.",
            required: true,
            options: [
              { id: "q2_a", label: "childs", value: "q2_a" },
              { id: "q2_b", label: "children", value: "q2_b" },
            ],
            correctOptionId: "q2_b",
            rubric: null,
          },
          {
            id: "q3",
            type: "long_text",
            prompt: "Scrie o propoziție în engleză.",
            required: true,
            options: [],
            correctOptionId: null,
            rubric: null,
          },
        ],
      },
      "assessment",
      context,
    );

    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "unrelated_english_preset");
  });

  it("accepts language-relevant generated payloads for English-learning projects", () => {
    const context = buildInteractiveGenerationContext({ project: englishProject, step: englishStep });
    assert.equal(isLanguageLearningContext(context), true);

    const accepted = normalizeGeneratedInteractivePayload(
      {
        mode: "assessment",
        title: "Evaluare engleză",
        instructions: "Răspunde la întrebări.",
        evaluationStrategy: "rule_based",
        resultFormat: "language_level",
        domainSummary: "Engleză",
        minimumAnswers: 3,
        requireAll: true,
        questions: [
          {
            id: "q1",
            type: "single_choice",
            prompt: "Alege forma corectă: She ___ to work every day.",
            required: true,
            options: [
              { id: "a", label: "go", value: "a" },
              { id: "b", label: "goes", value: "b" },
            ],
            correctOptionId: "b",
            rubric: null,
          },
          {
            id: "q2",
            type: "single_choice",
            prompt: "Care este pluralul pentru child?",
            required: true,
            options: [
              { id: "a", label: "childs", value: "a" },
              { id: "b", label: "children", value: "b" },
            ],
            correctOptionId: "b",
            rubric: null,
          },
          {
            id: "q3",
            type: "short_text",
            prompt: "Scrie o propoziție scurtă despre hobby-urile tale în engleză.",
            required: true,
            options: [],
            correctOptionId: null,
            rubric: "sentence",
          },
        ],
      },
      "assessment",
      context,
    );

    assert.equal(accepted.ok, true);
    assert.equal(accepted.payload.resultFormat, "language_level");
  });

  it("builds contextual fallback tied to the current project step", () => {
    const context = buildMedicalContext();
    const fallback = buildContextualInteractiveFallback({ mode: "assessment", context });

    assert.match(JSON.stringify(fallback), /examen medical|cardiologie|nivelul actual/i);
    assert.doesNotMatch(JSON.stringify(fallback), /I go to school|childs/i);
    assert.equal(fallback.scoringStrategy, "ai_evaluated");
  });

  it("generates assessment from OpenAI using project context when API key is present", async () => {
    const context = buildMedicalContext();
    let callCount = 0;

    const generated = await generateAssessmentInternal({
      project: medicalProject,
      step: medicalStep,
      preparation: {
        expectedResult: medicalStep.expected_outcome,
        context: { completedSteps: [] },
      },
      memoryMap: new Map([["specialitate", "cardiologie"]]),
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
                    mode: "assessment",
                    title: "Evaluare pregătire medicală",
                    instructions: "Răspunde la întrebările de pregătire.",
                    evaluationStrategy: "ai_evaluated",
                    resultFormat: "readiness_summary",
                    domainSummary: "Pregătire examen cardiologie",
                    minimumAnswers: 4,
                    requireAll: true,
                    questions: [
                      {
                        id: "anatomy",
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
                        id: "pharma",
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
                      {
                        id: "confidence",
                        type: "scale",
                        prompt: "Cât de pregătit te simți pentru examenul de cardiologie?",
                        required: true,
                        options: [],
                        correctOptionId: null,
                        rubric: null,
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        };
      },
    });

    assert.equal(callCount, 1);
    assert.equal(generated.source, "ai_generated");
    assert.match(JSON.stringify(generated.internal), /cardiologie|valvei mitrale|atorvastatina/i);
    assert.doesNotMatch(JSON.stringify(generated.internal), /I go to school|childs/i);
  });

  it("falls back to contextual guided questions when OpenAI generation fails", async () => {
    const generated = await generateAssessmentInternal({
      project: businessProject,
      step: businessStep,
      apiKey: "test-key",
      fetchImpl: async () => ({ ok: false, status: 500 }),
    });

    assert.equal(generated.source, "contextual_fallback");
    assert.match(JSON.stringify(generated.internal), /Lansare cafenea|poziționarea|obiectivul tău concret/i);
    assert.doesNotMatch(JSON.stringify(generated.internal), /I go to school|childs|engleză/i);
  });

  it("serializes payload without answer keys and persists internal state", () => {
    const context = buildMedicalContext();
    const internal = buildContextualInteractiveFallback({ mode: "assessment", context });
    const payload = serializeAssessmentPayload(internal);
    const prepared = withAssessmentInternal({}, internal);
    const restored = getAssessmentInternalFromPreparedInput(prepared);

    assert.equal(payload.type, "assessment");
    assert.doesNotMatch(JSON.stringify(payload), /correctOptionId|explanation|Răspuns corect/i);
    assert.equal(restored.assessmentId, internal.assessmentId);
    assert.deepEqual(restored.questions.map((q) => q.id), internal.questions.map((q) => q.id));
  });

  it("evaluates with project-aware summary for non-language assessments", () => {
    const internal = buildContextualInteractiveFallback({ mode: "assessment", context: buildMedicalContext() });
    const answers = {
      focus_area: "Vreau să evaluez anatomie și farmacologie pentru cardiologie.",
      current_level: "intermediate",
      difficult_topics: "ECG și aritmii",
      concrete_goal: "Să trec examenul de rezidențiat la cardiologie",
    };

    const evaluation = evaluateAssessmentAnswers(internal, answers);
    assert.match(evaluation.title, /Evaluare/);
    assert.doesNotMatch(evaluation.title, /Nivel estimat: A1|Nivel estimat: B1/);
    assert.ok(evaluation.summary);
  });

  it("detects English grammar preset markers", () => {
    assert.equal(
      containsEnglishGrammarPreset({
        questions: [{ prompt: "Alege pluralul corect pentru „child”." }],
      }),
      true,
    );
    assert.equal(
      containsEnglishGrammarPreset({
        questions: [{ prompt: "Care este mecanismul de acțiune al betablocantelor?" }],
      }),
      false,
    );
  });
});

describe("projects assessment interactive flow", () => {
  it("serializes assessment payload without answer keys", () => {
    const internal = buildAssessmentInternal({ step: englishStep, project: englishProject });
    const payload = serializeAssessmentPayload(internal);

    assert.equal(payload.type, "assessment");
    assert.ok(payload.questions.length >= 3);
    assert.doesNotMatch(JSON.stringify(payload), /correctOptionId|expectedAnswer|explanation|Răspuns corect/i);
  });

  it("evaluates answers only after submission payload is built server-side", () => {
    const internal = buildAssessmentInternal({ step: englishStep, project: englishProject });
    const answers = {
      focus_area: "Vreau să îmi evaluez gramatica și vocabularul.",
      current_level: "intermediate",
      difficult_topics: "Timpurile verbale",
      concrete_goal: "Să ajung la B2",
    };

    const evaluation = evaluateAssessmentAnswers(internal, answers);
    assert.match(evaluation.title, /Evaluare/);
    assert.ok(evaluation.summary);
    assert.ok(Array.isArray(evaluation.strengths));
    assert.ok(Array.isArray(evaluation.gaps));
    assert.ok(Array.isArray(evaluation.recommendations));
  });

  it("keeps assessment sessions non-generatable until evaluation", () => {
    const internal = buildAssessmentInternal({ step: medicalStep, project: medicalProject });
    const payload = serializeAssessmentPayload(internal);

    const session = {
      phase: "collecting",
      canGenerate: true,
      canRespond: true,
      canReview: false,
      pendingResult: { id: "r1", title: "Quiz", preview: "Răspuns corect" },
    };

    const interactiveState = { submitted: false, answers: {}, currentQuestionIndex: 0 };
    const overridden = {
      ...session,
      phase: "collecting",
      canGenerate: false,
      canRespond: false,
      canReview: false,
      pendingResult: null,
    };

    assert.equal(overridden.canGenerate, false);
    assert.equal(overridden.pendingResult, null);
    assert.ok(payload.questions.length >= 3);
    assert.equal(interactiveState.submitted, false);
    assert.doesNotMatch(JSON.stringify(payload), /I go to school|childs/i);
  });
});
