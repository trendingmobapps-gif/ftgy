import { EXECUTION_MODES } from "./execution-modes.js";
import { resolveProjectModelPolicy } from "../project-model-policy.js";

export const EXECUTION_PLAN_MODEL = resolveProjectModelPolicy("executionPlan").model;
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

const INTERACTIVE_MODES = [
  "assessment",
  "guided_questions",
  "structured_form",
  "checklist",
  "choice",
  "recommendation_selection",
];

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
      description: { type: ["string", "null"] },
      recommendation: { type: ["string", "null"] },
      placeholder: { type: ["string", "null"] },
      exampleAnswer: { type: ["string", "null"] },
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
    required: [
      "id",
      "type",
      "prompt",
      "description",
      "recommendation",
      "placeholder",
      "exampleAnswer",
      "required",
      "options",
      "correctOptionId",
      "rubric",
    ],
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

function checklistItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      description: { type: ["string", "null"] },
      required: { type: "boolean" },
    },
    required: ["id", "label", "description", "required"],
  };
}

function recommendationItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      explanation: { type: "string" },
      advantages: { type: "array", items: { type: "string" } },
      tradeoffs: { type: "array", items: { type: "string" } },
      recommended: { type: "boolean" },
      priority: { type: "number" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["id", "title", "explanation", "advantages", "tradeoffs", "recommended", "priority", "confidence"],
  };
}

function recommendationGroupSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: ["string", "null"] },
      recommendations: {
        type: "array",
        items: recommendationItemSchema(),
      },
    },
    required: ["id", "title", "description", "recommendations"],
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
        checklistItems: {
          type: "array",
          items: checklistItemSchema(),
        },
        recommendationGroups: {
          type: "array",
          items: recommendationGroupSchema(),
        },
        selectionRules: {
          type: "object",
          additionalProperties: false,
          properties: {
            minimumSelections: { type: "number" },
            maximumSelections: { type: ["number", "null"] },
            allowCustomOption: { type: "boolean" },
            allowReorder: { type: "boolean" },
          },
          required: ["minimumSelections", "maximumSelections", "allowCustomOption", "allowReorder"],
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
        "checklistItems",
        "recommendationGroups",
        "selectionRules",
        "requireAll",
        "minimumResponses",
        "requiresUserAcceptance",
      ],
    },
  };
}

export function buildExecutionPlanSystemPrompt() {
  return [
    "Ești Project Brain pentru ITER AI — un asistent activ de proiect, nu un constructor de formulare goale.",
    "",
    "Principiu obligatoriu: AI propune primul. Utilizatorul confirmă, selectează, editează sau furnizează doar informații cu adevărat necunoscute.",
    "Nu transforma munca de expert în câmpuri text goale. Nu cere utilizatorului să inventeze strategia, recomandările, prioritățile sau argumentația când le poți genera din context.",
    "",
    "Decizie în două straturi:",
    "1) Acțiunea utilizatorului (test, formular, alegere, recomandări, generare, research, upload, conversație etc.)",
    "2) Conținutul exact (întrebări, câmpuri, opțiuni, recomandări, instrucțiuni) — generat dinamic pentru proiectul și pasul curent",
    "",
    "Reguli obligatorii:",
    "- Nu presupune că fiecare pas este un test/evaluare.",
    "- Nu presupune că fiecare pas are întrebări.",
    "- Nu presupune că fiecare pas generează text.",
    "- Nu folosi bancuri prestabilite de întrebări pe domenii.",
    "- Reutilizează memoria proiectului și rezultatele acceptate; cere doar informațiile lipsă și cu adevărat necunoscute.",
    "- Selectează un singur mod valid din registrul controlat.",
    "- Pentru pași strategici (marketing, canale, poziționare, lansare): folosește mode=recommendation_selection cu recomandări concrete, rationale și opțiuni preselectate.",
    "- Pentru mode=recommendation_selection: folosește recommendationGroups cu minimum 2 recomandări per grup relevant; preselectează recommended=true pentru cele mai potrivite.",
    "- Pentru mode=generator/document_builder/research/image_generation/upload_and_review: questions, choices și recommendationGroups pot fi goale.",
    "- Pentru mode=assessment: include 6-10 întrebări relevante proiectului.",
    "- Pentru mode=guided_questions: include 2-5 întrebări scurte doar pentru informații necunoscute.",
    "- Pentru guided_questions: prompt=întrebarea; recommendation=ghidarea ITER (opțional); placeholder=exemplu scurt de răspuns (max ~80 caractere, începe cu „Ex:” când e exemplu); placeholder NU repetă întrebarea și NU repetă recomandarea.",
    "- Pentru mode=structured_form/spreadsheet_builder: folosește requiredInputs doar pentru date necunoscute; precompletează prefilledValue când poți; nu folosi textarea pentru recomandări strategice.",
    "- Pentru mode=choice: folosește choices contextual generate (minimum 2 opțiuni reale).",
    "- Pentru mode=checklist: folosește checklistItems pentru pași de acțiune (înscriere, documente, programare).",
    "- Nu folosi mode=choice pentru pași de înscriere/proces fără o decizie reală între variante.",
    "- Interfața în română, cu excepția proiectelor explicite de limbă străină.",
    "- Fiecare pas trebuie să avanseze material proiectul; utilizatorul primește asistență maximă practică.",
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
    "Pentru pași strategici, oferă recomandări concrete ITER — nu formulare goale.",
  ].filter(Boolean);

  return lines.join("\n");
}

export function isInteractivePlanMode(mode) {
  return INTERACTIVE_MODES.includes(mode);
}
