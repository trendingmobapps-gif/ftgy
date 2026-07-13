import { EXECUTION_MODES } from "./execution-modes.js";

export const EXECUTION_PLAN_MODEL = "gpt-4.1-mini";
export const EXECUTION_PLAN_TEMPERATURE = 0.25;
export const EXECUTION_PLAN_TIMEOUT_MS = 50_000;

export const SUPPORTED_USER_ACTION_TYPES = [
  "answer",
  "select",
  "complete_form",
  "upload",
  "review",
  "approve",
  "generate",
  "research",
  "discuss",
  "complete_checklist",
];

export const SUPPORTED_INPUT_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "single_choice",
  "multiple_choice",
  "scale",
  "file",
  "boolean",
];

export const SUPPORTED_OUTPUT_TYPES = [
  "text",
  "quiz_result",
  "checklist",
  "table",
  "pdf",
  "docx",
  "xlsx",
  "image",
];

const INTERACTIVE_MODES = ["assessment", "guided_questions", "structured_form", "choice"];

function questionItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      type: {
        type: "string",
        enum: ["single_choice", "multiple_choice", "short_text", "long_text", "number", "scale"],
      },
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
  };
}

function fieldItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: SUPPORTED_INPUT_TYPES },
      label: { type: "string" },
      placeholder: { type: ["string", "null"] },
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
    },
    required: ["id", "type", "label", "placeholder", "required", "options"],
  };
}

function choiceItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: ["string", "null"] },
      value: { type: "string" },
    },
    required: ["id", "title", "description", "value"],
  };
}

export function buildExecutionPlanJsonSchema() {
  return {
    name: "project_execution_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: [...EXECUTION_MODES, "checklist"] },
        title: { type: "string" },
        explanation: { type: "string" },
        whyThisAction: { type: "string" },
        expectedOutcome: { type: "string" },
        userActionType: { type: "string", enum: SUPPORTED_USER_ACTION_TYPES },
        userActionInstruction: { type: "string" },
        primaryActionLabel: { type: "string" },
        evaluationStrategy: {
          type: "string",
          enum: ["rule_based", "ai_evaluated", "synthesis_only", "none"],
        },
        resultFormat: {
          type: "string",
          enum: ["language_level", "competency_summary", "readiness_summary", "document", "table", "image", "none"],
        },
        outputTypes: {
          type: "array",
          items: { type: "string", enum: SUPPORTED_OUTPUT_TYPES },
        },
        requiredInputs: {
          type: "array",
          items: fieldItemSchema(),
        },
        questions: {
          type: "array",
          items: questionItemSchema(),
        },
        choices: {
          type: "array",
          items: choiceItemSchema(),
        },
        requireAll: { type: "boolean" },
        minimumResponses: { type: "number" },
        requiresUserAcceptance: { type: "boolean" },
      },
      required: [
        "mode",
        "title",
        "explanation",
        "whyThisAction",
        "expectedOutcome",
        "userActionType",
        "userActionInstruction",
        "primaryActionLabel",
        "evaluationStrategy",
        "resultFormat",
        "outputTypes",
        "requiredInputs",
        "questions",
        "choices",
        "requireAll",
        "minimumResponses",
        "requiresUserAcceptance",
      ],
    },
  };
}

export function buildExecutionPlanSystemPrompt() {
  return [
    "Ești Project Brain pentru ITER AI. Pentru fiecare pas de proiect, decizi CE trebuie să facă utilizatorul și CUM trebuie completată etapa.",
    "",
    "Decizie în două straturi:",
    "1) Acțiunea utilizatorului (test, formular, alegere, generare, research, upload, conversație etc.)",
    "2) Conținutul exact (întrebări, câmpuri, opțiuni, instrucțiuni) — generat dinamic pentru proiectul și pasul curent",
    "",
    "Reguli obligatorii:",
    "- Nu presupune că fiecare pas este un test/evaluare.",
    "- Nu presupune că fiecare pas are întrebări.",
    "- Nu presupune că fiecare pas generează text.",
    "- Nu folosi bancuri prestabilite de întrebări pe domenii.",
    "- Reutilizează memoria proiectului și rezultatele acceptate; cere doar informațiile lipsă.",
    "- Selectează un singur mod valid din registrul controlat.",
    "- Pentru mode=generator/document_builder/research/image_generation/upload_and_review: questions și choices pot fi goale.",
    "- Pentru mode=assessment: include 6-10 întrebări relevante proiectului.",
    "- Pentru mode=guided_questions: include 2-5 întrebări scurte.",
    "- Pentru mode=structured_form/spreadsheet_builder: folosește requiredInputs, nu questions.",
    "- Pentru mode=choice: folosește choices contextual generate.",
    "- Interfața în română, cu excepția proiectelor explicite de limbă străină.",
    "- Exemplele din instrucțiuni nu sunt reguli universale; decide din contextul complet.",
    "",
    "Returnează DOAR JSON conform schemei.",
  ].join("\n");
}

export function buildExecutionPlanUserPrompt(context) {
  const lines = [
    `Proiect: ${context.projectName}`,
    context.projectGoal ? `Obiectiv proiect: ${context.projectGoal}` : null,
    context.projectSummary ? `Rezumat proiect: ${context.projectSummary}` : null,
    context.categorySlug ? `Categorie: ${context.categorySlug}` : null,
    context.milestoneTitle ? `Etapă curentă: ${context.milestoneTitle}` : null,
    `Pas curent: ${context.stepTitle}`,
    context.stepDescription ? `Descriere pas: ${context.stepDescription}` : null,
    context.expectedOutcome ? `Rezultat așteptat: ${context.expectedOutcome}` : null,
    context.completionCriteria ? `Criterii finalizare: ${context.completionCriteria}` : null,
    context.memorySummary ? `Memorie proiect (reutilizează, nu re-cere):\n${context.memorySummary}` : null,
    context.completedStepsSummary ? `Rezultate acceptate anterior:\n${context.completedStepsSummary}` : null,
    context.knownInputsSummary ? `Informații deja cunoscute:\n${context.knownInputsSummary}` : null,
    context.missingFieldsSummary ? `Informații încă lipsă (cere doar pe acestea):\n${context.missingFieldsSummary}` : null,
    context.executionStrategy ? `Strategie execuție sugerată: ${context.executionStrategy}` : null,
    "",
    "Decide modul, acțiunea utilizatorului și conținutul necesar pentru finalizarea acestui pas.",
    "Nu transforma automat pasul într-un test dacă contextul nu cere evaluare.",
  ].filter(Boolean);

  return lines.join("\n");
}

export function isInteractivePlanMode(mode) {
  return INTERACTIVE_MODES.includes(mode);
}
