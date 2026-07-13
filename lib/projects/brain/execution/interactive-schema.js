export const INTERACTIVE_GENERATION_MODEL = "gpt-4.1-mini";
export const INTERACTIVE_GENERATION_TEMPERATURE = 0.35;
export const INTERACTIVE_GENERATION_TIMEOUT_MS = 45_000;

const QUESTION_TYPES = ["single_choice", "multiple_choice", "short_text", "long_text", "number", "scale"];
const EVALUATION_STRATEGIES = ["rule_based", "ai_evaluated", "synthesis_only"];
const RESULT_FORMATS = ["language_level", "competency_summary", "readiness_summary"];

export function buildInteractiveGenerationJsonSchema() {
  return {
    name: "project_interactive_execution",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["assessment", "guided_questions", "structured_form", "choice"],
        },
        title: { type: "string" },
        instructions: { type: "string" },
        evaluationStrategy: {
          type: "string",
          enum: EVALUATION_STRATEGIES,
        },
        resultFormat: {
          type: "string",
          enum: RESULT_FORMATS,
        },
        domainSummary: { type: "string" },
        questions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: QUESTION_TYPES },
              prompt: { type: "string" },
              required: { type: "boolean" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    value: { type: "string" },
                  },
                  required: ["id", "label", "value"],
                },
              },
              correctOptionId: { type: ["string", "null"] },
              rubric: { type: ["string", "null"] },
            },
            required: ["id", "type", "prompt", "required", "options", "correctOptionId", "rubric"],
          },
        },
        minimumAnswers: { type: "number" },
        requireAll: { type: "boolean" },
      },
      required: [
        "mode",
        "title",
        "instructions",
        "evaluationStrategy",
        "resultFormat",
        "domainSummary",
        "questions",
        "minimumAnswers",
        "requireAll",
      ],
    },
  };
}

export function buildInteractiveGenerationSystemPrompt() {
  return [
    "Ești Project Brain pentru ITER AI. Generezi experiențe interactive pentru pașii unui proiect.",
    "",
    "Reguli obligatorii:",
    "- Conținutul trebuie să fie direct relevant pentru proiectul și pasul curent.",
    "- Nu genera întrebări generice de engleză/gramatică decât dacă proiectul este explicit despre învățarea limbii engleze.",
    "- Pentru proiecte medicale/educaționale medicale: întrebări de pregătire/studiu, fără diagnostic medical sau tratament pentru pacient.",
    "- Pentru proiecte business: întrebări de business relevante pasului.",
    "- Interfața este în limba română, cu excepția cazului în care proiectul cere explicit altă limbă.",
    "- Nu include explicații sau răspunsuri corecte în textul vizibil pentru utilizator; câmpurile correctOptionId/rubric sunt doar pentru server.",
    "- Fără întrebări duplicate, fără filler trivial.",
    "- Pentru assessment: 6-10 întrebări, dificultate potrivită contextului.",
    "- Pentru guided_questions: 3-6 întrebări scurte.",
    "- Folosește evaluationStrategy=rule_based când există opțiuni cu răspuns corect clar; altfel ai_evaluated.",
    "- resultFormat=language_level doar pentru proiecte de limbă; altfel competency_summary sau readiness_summary.",
    "",
    "Returnează DOAR JSON conform schemei.",
  ].join("\n");
}

export function buildInteractiveGenerationUserPrompt(context, mode) {
  const lines = [
    `Mod cerut: ${mode}`,
    `Proiect: ${context.projectName}`,
    context.projectGoal ? `Obiectiv proiect: ${context.projectGoal}` : null,
    context.projectSummary ? `Rezumat proiect: ${context.projectSummary}` : null,
    context.categorySlug ? `Categorie: ${context.categorySlug}` : null,
    context.milestoneTitle ? `Etapă curentă: ${context.milestoneTitle}` : null,
    `Pas curent: ${context.stepTitle}`,
    context.stepDescription ? `Descriere pas: ${context.stepDescription}` : null,
    context.expectedOutcome ? `Rezultat așteptat: ${context.expectedOutcome}` : null,
    context.whyItMatters ? `De ce contează: ${context.whyItMatters}` : null,
    context.memorySummary ? `Memorie proiect:\n${context.memorySummary}` : null,
    context.completedStepsSummary ? `Rezultate acceptate anterior:\n${context.completedStepsSummary}` : null,
    context.knownInputsSummary ? `Inputuri cunoscute:\n${context.knownInputsSummary}` : null,
    "",
    "Întrebările trebuie să fie direct relevante pentru acest proiect și acest pas exact.",
    "Nu genera întrebări de învățare a limbii engleze decât dacă proiectul este explicit despre engleză.",
  ].filter(Boolean);

  return lines.join("\n");
}

export function buildInteractiveEvaluationJsonSchema() {
  return {
    name: "project_interactive_evaluation",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        level: { type: ["string", "null"] },
        percent: { type: ["number", "null"] },
        strengths: {
          type: "array",
          items: { type: "string" },
        },
        gaps: {
          type: "array",
          items: { type: "string" },
        },
        recommendations: {
          type: "array",
          items: { type: "string" },
        },
        disclaimer: { type: ["string", "null"] },
      },
      required: ["title", "summary", "level", "percent", "strengths", "gaps", "recommendations", "disclaimer"],
    },
  };
}

export function buildInteractiveEvaluationSystemPrompt() {
  return [
    "Evaluezi răspunsurile unui utilizator la o experiență interactivă dintr-un proiect ITER.",
    "Folosește contextul proiectului, obiectivul pasului și întrebările generate.",
    "Pentru conținut medical: evaluare educațională de pregătire, NU diagnostic medical și NU tratament pentru pacient.",
    "Răspunsul trebuie util, concis, în română, cu recomandări practice pentru următorul pas.",
    "Returnează DOAR JSON conform schemei.",
  ].join("\n");
}
