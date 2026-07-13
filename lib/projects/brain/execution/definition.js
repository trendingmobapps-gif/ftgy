import { memoryHasKnownField } from "../memory/service.js";
import { evaluateWebSearchNeed } from "./web-search.js";

export const EXECUTION_MODES = [
  "assessment",
  "guided_questions",
  "structured_form",
  "choice",
  "research",
  "generator",
  "document_builder",
  "spreadsheet_builder",
  "image_generation",
  "upload_and_review",
  "conversation",
  "result_review",
];

const ASSESSMENT_MARKERS = ["nivel", "evalu", "test", "plasament", "diagnostic", "chestionar", "emoti", "tipar"];
const CHOICE_MARKERS = ["alege", "direc", "variant", "branding", "optiune"];
const FORM_MARKERS = ["buget", "cost", "financiar", "tabel", "spreadsheet", "excel"];
const DOCUMENT_MARKERS = ["plan", "document", "strategie", "ghid", "raport"];
const IMAGE_MARKERS = ["logo", "imagine", "vizual", "design", "mockup"];
const UPLOAD_MARKERS = ["incarc", "upload", "fisier", "document atasat"];
const RESEARCH_MARKERS = ["concuren", "piata", "analiz", "cercet", "reglement", "autoriz"];

const STRUCTURED_OPTIONS = {
  nivel: ["Începător (A1)", "Elementar (A2)", "Intermediar (B1)", "Intermediar-avansat (B2)", "Avansat (C1)", "Proficient (C2)"],
  nivel_engleza: ["Începător (A1)", "Elementar (A2)", "Intermediar (B1)", "Intermediar-avansat (B2)", "Avansat (C1)", "Proficient (C2)"],
  buget: ["Sub 5.000 EUR", "5.000–15.000 EUR", "15.000–50.000 EUR", "Peste 50.000 EUR"],
  public_tinta: ["Persoane fizice", "Familii", "Companii mici", "Companii mari", "Tineri", "Profesioniști"],
  locatie: ["București", "Cluj-Napoca", "Timișoara", "Iași", "Online", "Altă locație"],
};

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function haystackFor({ step, preparation }) {
  return normalize(`${step?.title || ""} ${step?.description || ""} ${preparation?.title || ""}`);
}

function optionsForField(key) {
  const normalized = normalize(key);
  if (STRUCTURED_OPTIONS[normalized]) return STRUCTURED_OPTIONS[normalized];
  if (normalized.includes("nivel")) return STRUCTURED_OPTIONS.nivel;
  if (normalized.includes("buget")) return STRUCTURED_OPTIONS.buget;
  if (normalized.includes("public") || normalized.includes("tinta")) return STRUCTURED_OPTIONS.public_tinta;
  if (normalized.includes("locat")) return STRUCTURED_OPTIONS.locatie;
  return null;
}

function inputTypeForField(field, memoryMap) {
  const options = optionsForField(field.key);
  if (options?.length) {
    return {
      type: "single_choice",
      options: options.map((label) => ({ value: label, label })),
    };
  }

  const key = normalize(field.key);
  if (key.includes("descriere") || key.includes("context") || key.includes("cerinta")) {
    return { type: "textarea" };
  }
  if (key.includes("buget") || key.includes("numar") || key.includes("suma")) {
    return { type: "number" };
  }
  return { type: "text" };
}

function buildRequiredInputs(preparation, memoryMap) {
  const missing = (preparation?.missingFields || []).filter(
    (field) => !memoryHasKnownField(memoryMap, field.key),
  );

  return missing.map((field) => {
    const shape = inputTypeForField(field, memoryMap);
    const prefilled =
      preparation?.preparedInput?.[field.key] ||
      (memoryMap?.get ? memoryMap.get(field.key) : memoryMap?.[field.key]) ||
      undefined;

    return {
      id: field.key,
      type: shape.type,
      label: field.label,
      placeholder: field.label,
      options: shape.options,
      required: field.required !== false,
      prefilledValue: prefilled || undefined,
    };
  });
}

function resolveOutputTypes(mode, step, preparation) {
  const haystack = haystackFor({ step, preparation });
  if (mode === "assessment") return ["quiz", "text"];
  if (mode === "spreadsheet_builder" || haystack.includes("buget") || haystack.includes("excel")) {
    return ["table", "xlsx"];
  }
  if (mode === "image_generation") return ["image"];
  if (mode === "document_builder") return ["pdf", "docx", "text"];
  if (mode === "structured_form" && haystack.includes("buget")) return ["table", "xlsx", "text"];
  return ["text"];
}

function resolvePrimaryActionLabel(mode, session, requiredInputs, interactivePayload = null) {
  if (session?.canReview) return "Folosește rezultatul";
  if (mode === "assessment") {
    if (interactivePayload?.questions?.length) {
      return "Începe evaluarea";
    }
    return "Începe evaluarea";
  }
  if (session?.canGenerate && requiredInputs.length === 0) return "Generează rezultatul";
  if (mode === "research") return "Continuă";
  if (mode === "choice") return "Confirmă alegerea";
  if (requiredInputs.length > 0) return "Continuă";
  return "Continuă etapa";
}

export function resolveExecutionMode({ step, preparation, session, executionDecision, memoryMap }) {
  if (session?.canReview || session?.phase === "review") {
    return "result_review";
  }

  const haystack = haystackFor({ step, preparation });

  if (ASSESSMENT_MARKERS.some((marker) => haystack.includes(marker))) {
    return "assessment";
  }

  if (CHOICE_MARKERS.some((marker) => haystack.includes(marker))) {
    return "choice";
  }

  const webNeed = evaluateWebSearchNeed({ project: preparation?.context?.project, step });
  if (
    RESEARCH_MARKERS.some((marker) => haystack.includes(marker)) &&
    (executionDecision?.requiresWebSearch || webNeed.shouldSearch)
  ) {
    return "research";
  }

  if (IMAGE_MARKERS.some((marker) => haystack.includes(marker))) {
    return "image_generation";
  }

  if (UPLOAD_MARKERS.some((marker) => haystack.includes(marker))) {
    return "upload_and_review";
  }

  if (FORM_MARKERS.some((marker) => haystack.includes(marker))) {
    return haystack.includes("buget") || haystack.includes("excel") ? "spreadsheet_builder" : "structured_form";
  }

  if (DOCUMENT_MARKERS.some((marker) => haystack.includes(marker))) {
    return "document_builder";
  }

  const requiredInputs = buildRequiredInputs(preparation, memoryMap);
  if (requiredInputs.length >= 3) {
    return "structured_form";
  }

  if (requiredInputs.length > 0) {
    return "guided_questions";
  }

  if (session?.canGenerate) {
    return preparation?.capabilityType === "tool" ? "document_builder" : "generator";
  }

  return "guided_questions";
}

export function buildExecutionDefinition({
  project,
  step,
  milestone,
  preparation,
  session = null,
  executionDecision = null,
  memoryMap = new Map(),
  interactivePayload = null,
}) {
  const mode = resolveExecutionMode({
    step,
    preparation,
    session,
    executionDecision,
    memoryMap,
  });

  const requiredInputs = buildRequiredInputs(preparation, memoryMap);
  const title = preparation?.title || step?.title || "Continuă etapa";
  const explanation = preparation?.explanation || step?.description || "";
  const whyItMatters = preparation?.whyItMatters || step?.rationale || "";
  const expectedOutcome = preparation?.expectedResult || step?.expected_outcome || "";

  let researchStatus = null;
  if (mode === "research") {
    researchStatus = executionDecision?.webSearch?.executed ? "completed" : "unavailable";
  }

  return {
    mode,
    title,
    explanation,
    whyItMatters,
    expectedOutcome,
    milestoneTitle: milestone?.title || null,
    estimatedEffortLabel: preparation?.estimatedEffortLabel || step?.estimated_effort_label || null,
    requiredInputs,
    outputTypes: resolveOutputTypes(mode, step, preparation),
    primaryActionLabel: resolvePrimaryActionLabel(mode, session, requiredInputs, interactivePayload),
    researchStatus,
    assessmentQuestionCount:
      mode === "assessment"
        ? interactivePayload?.questions?.length ||
          Math.min(10, Math.max(6, requiredInputs.length || 8))
        : null,
  };
}

export function serializeExecutionDefinition(definition) {
  if (!definition) return null;
  return {
    mode: definition.mode,
    title: definition.title,
    explanation: definition.explanation,
    whyItMatters: definition.whyItMatters,
    expectedOutcome: definition.expectedOutcome,
    milestoneTitle: definition.milestoneTitle,
    estimatedEffortLabel: definition.estimatedEffortLabel,
    requiredInputs: definition.requiredInputs,
    outputTypes: definition.outputTypes,
    primaryActionLabel: definition.primaryActionLabel,
    researchStatus: definition.researchStatus,
    assessmentQuestionCount: definition.assessmentQuestionCount,
  };
}
