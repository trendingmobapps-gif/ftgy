import { randomUUID } from "node:crypto";

import { memoryHasKnownField } from "../memory/service.js";
import { evaluateWebSearchNeed } from "./web-search.js";
import { EXECUTION_MODES } from "./execution-modes.js";
import {
  buildExecutionPlanJsonSchema,
  buildExecutionPlanSystemPrompt,
  buildExecutionPlanUserPrompt,
  EXECUTION_PLAN_MODEL,
  EXECUTION_PLAN_TEMPERATURE,
  EXECUTION_PLAN_TIMEOUT_MS,
  isInteractivePlanMode,
} from "./execution-plan-schema.js";
import { containsEnglishGrammarPreset, buildInteractiveGenerationContext } from "./interactive-generator.js";
import { updateActionSession } from "../actions/repository.js";
import {
  attachPlanMetadata,
  buildEnrollmentChecklistFallback,
  EXECUTION_PLAN_VERSION,
  isPersistedPlanExecutable,
  validateExecutionPlanCompleteness,
  validateInteractivePayload,
} from "./execution-plan-validation.js";
import { normalizeCompletionCriteria } from "./completion-evaluator.js";

const ENGLISH_PRESET_MARKERS = [
  "i go to school",
  "childs",
  "childrens",
  "doesn't like coffee",
  "pluralul corect",
  "alege varianta corectă pentru propoziția",
];

function normalizeText(value, max = 4000) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function slugify(value, index = 0) {
  const base = String(value || `item_${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return base || `item_${index + 1}`;
}

function memoryMapToSummary(memoryMap = new Map()) {
  const lines = [];
  for (const [key, value] of memoryMap) {
    const trimmed = String(value || "").trim();
    if (trimmed) lines.push(`${key}: ${trimmed}`);
  }
  return lines.slice(0, 24).join("\n");
}

function missingFieldsSummary(preparation, memoryMap) {
  const missing = (preparation?.missingFields || []).filter(
    (field) => !memoryHasKnownField(memoryMap, field.key),
  );
  return missing.map((field) => `- ${field.label || field.key}`).join("\n");
}

function normalizeMode(mode) {
  const normalized = String(mode || "").trim();
  if (EXECUTION_MODES.includes(normalized)) return normalized;
  return null;
}

function normalizeRequiredInput(field, index) {
  const id = slugify(field?.id, index);
  const label = normalizeText(field?.label, 200);
  if (!label) return null;

  const input = {
    id,
    type: field?.type || "text",
    label,
    placeholder: normalizeText(field?.placeholder, 200) || label,
    required: field?.required !== false,
  };

  if (field?.options?.length) {
    input.options = field.options
      .map((option, optionIndex) => {
        const optionLabel = normalizeText(option?.label, 180);
        if (!optionLabel) return null;
        const optionId = slugify(option?.id || option?.value || `opt_${optionIndex + 1}`, optionIndex);
        return { value: String(option?.value || optionId), label: optionLabel };
      })
      .filter(Boolean);
  }

  return input;
}

function normalizeQuestion(question, index) {
  const id = slugify(question?.id, index);
  const prompt = normalizeText(question?.prompt, 500);
  if (!prompt) return null;

  const normalized = {
    id,
    type: question?.type || "short_text",
    prompt,
    required: question?.required !== false,
    weight: 1,
  };

  if (normalized.type === "single_choice" || normalized.type === "multiple_choice") {
    const options = (question?.options || [])
      .map((option, optionIndex) => {
        const label = normalizeText(option?.label, 180);
        if (!label) return null;
        const optionId = slugify(option?.id || option?.value || `opt_${optionIndex + 1}`, optionIndex);
        return { id: optionId, label, value: String(option?.value || optionId) };
      })
      .filter(Boolean);
    if (options.length < 2) return null;
    normalized.options = options.slice(0, 6);
    const correctOptionId = String(question?.correctOptionId || "").trim();
    if (correctOptionId && normalized.options.some((option) => option.id === correctOptionId)) {
      normalized.correctOptionId = correctOptionId;
    }
  }

  if (question?.rubric) normalized.rubric = normalizeText(question.rubric, 300);
  return normalized;
}

function buildCompletionCriteriaForMode(mode, raw = {}) {
  const criteria = normalizeCompletionCriteria(raw);
  if (mode === "checklist" || mode === "choice") {
    return {
      ...criteria,
      requireGeneratedResult: raw.requireGeneratedResult ?? false,
      requireUserAcceptance: raw.requireUserAcceptance ?? false,
      requireChoice: mode === "choice",
    };
  }
  if (mode === "assessment") {
    return {
      ...criteria,
      requireGeneratedResult: true,
      requireUserAcceptance: true,
      requireUserReview: true,
    };
  }
  if (
    mode === "generator" ||
    mode === "document_builder" ||
    mode === "spreadsheet_builder" ||
    mode === "image_generation" ||
    mode === "research" ||
    mode === "conversation"
  ) {
    return {
      ...criteria,
      requireGeneratedResult: true,
      requireUserAcceptance: true,
      requireUserReview: true,
    };
  }
  if (mode === "upload_and_review") {
    return {
      ...criteria,
      requireFileUpload: true,
      requireGeneratedResult: true,
      requireUserAcceptance: true,
    };
  }
  return criteria;
}

function resolveFinalizeActionLabel(mode) {
  if (mode === "assessment") return "Finalizează evaluarea";
  if (mode === "structured_form" || mode === "spreadsheet_builder") return "Finalizează formularul";
  if (mode === "choice") return "Finalizează alegerea";
  return "Finalizează etapa";
}

function normalizeChecklistItem(item, index) {
  const label = normalizeText(item?.label, 200);
  if (!label) return null;
  const id = slugify(item?.id, index);
  return {
    id,
    label,
    description: normalizeText(item?.description, 300) || null,
    required: item?.required !== false,
    completed: Boolean(item?.completed),
  };
}

function normalizeChoice(choice, index) {
  const title = normalizeText(choice?.title, 180);
  if (!title) return null;
  const id = slugify(choice?.id || choice?.value, index);
  return {
    id,
    title,
    description: normalizeText(choice?.description, 300) || null,
    value: String(choice?.value || id),
  };
}

export function buildExecutionPlanContext({
  project,
  step,
  milestone,
  preparation,
  memoryMap = new Map(),
  completedSteps = [],
  collectedInput = {},
  executionDecision = null,
}) {
  const base = buildInteractiveGenerationContext({
    project,
    step,
    milestone,
    preparation,
    memoryMap,
    completedSteps,
    collectedInput,
  });

  return {
    ...base,
    completionCriteria: normalizeText(step?.completion_criteria || step?.expected_outcome, 1000),
    missingFieldsSummary: missingFieldsSummary(preparation, memoryMap),
    memorySummary: memoryMapToSummary(memoryMap) || base.memorySummary,
    executionStrategy: executionDecision?.strategy || null,
  };
}

export function containsPresetQuestionBank(plan) {
  const haystack = JSON.stringify(plan || {}).toLowerCase();
  return ENGLISH_PRESET_MARKERS.some((marker) => haystack.includes(marker));
}

export function normalizeExecutionPlan(raw, context) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "malformed" };
  }

  const mode = normalizeMode(raw.mode);
  if (!mode) {
    return { ok: false, reason: "unsupported_mode" };
  }

  const requiredInputs = (Array.isArray(raw.requiredInputs) ? raw.requiredInputs : [])
    .map((field, index) => normalizeRequiredInput(field, index))
    .filter(Boolean);

  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .map((question, index) => normalizeQuestion(question, index))
    .filter(Boolean);

  const choices = (Array.isArray(raw.choices) ? raw.choices : [])
    .map((choice, index) => normalizeChoice(choice, index))
    .filter(Boolean);

  const checklistItems = (Array.isArray(raw.checklistItems) ? raw.checklistItems : [])
    .map((item, index) => normalizeChecklistItem(item, index))
    .filter(Boolean);

  const plan = {
    planId: randomUUID(),
    version: EXECUTION_PLAN_VERSION,
    mode,
    title: normalizeText(raw.title || context.stepTitle, 200) || context.stepTitle,
    explanation: normalizeText(raw.explanation || context.stepDescription, 1200) || context.stepDescription,
    whyThisAction: normalizeText(raw.whyThisAction || context.whyItMatters, 800) || context.whyItMatters,
    expectedOutcome: normalizeText(raw.expectedOutcome || context.expectedOutcome, 800) || context.expectedOutcome,
    userAction: {
      type: raw.userActionType || inferUserActionType(mode),
      instruction: normalizeText(raw.userActionInstruction, 600) || `Completează pasul „${context.stepTitle}”.`,
    },
    requiredInputs,
    questions,
    choices,
    checklistItems,
    completionCriteria: buildCompletionCriteriaForMode(mode, {
      requireAll: raw.requireAll,
      minimumResponses: raw.minimumResponses,
      requiresUserAcceptance: raw.requiresUserAcceptance,
      requireAllInputs: raw.requireAllInputs,
      minimumAnsweredQuestions: raw.minimumAnsweredQuestions,
      minimumCompletedChecklistItems: raw.minimumCompletedChecklistItems,
      requireChoice: raw.requireChoice,
      requireFileUpload: raw.requireFileUpload,
      requireGeneratedResult: raw.requireGeneratedResult,
      requireUserReview: raw.requireUserReview,
      requireUserAcceptance: raw.requireUserAcceptance,
      requireExplicitFinalize: raw.requireExplicitFinalize,
    }),
    outputTypes: normalizeOutputTypes(raw.outputTypes, mode),
    primaryActionLabel: normalizeText(raw.primaryActionLabel, 120) || defaultPrimaryLabel(mode),
    finalizeActionLabel: normalizeText(raw.finalizeActionLabel, 120) || resolveFinalizeActionLabel(mode),
    evaluationStrategy: raw.evaluationStrategy || (mode === "assessment" ? "ai_evaluated" : "none"),
    resultFormat: raw.resultFormat || (mode === "assessment" ? "competency_summary" : "none"),
    source: "openai",
  };

  const validationError = validatePlanShape(plan, context);
  if (validationError) {
    return { ok: false, reason: validationError };
  }

  const completeness = validateExecutionPlanCompleteness(plan, context);
  if (!completeness.valid) {
    return { ok: false, reason: completeness.reason };
  }

  if (containsPresetQuestionBank(plan) || containsEnglishGrammarPreset(plan)) {
    return { ok: false, reason: "preset_question_bank" };
  }

  return { ok: true, plan: attachPlanMetadata(plan, "openai") };
}

function inferUserActionType(mode) {
  if (mode === "assessment" || mode === "guided_questions") return "answer";
  if (mode === "choice") return "select";
  if (mode === "checklist") return "complete_checklist";
  if (mode === "structured_form" || mode === "spreadsheet_builder") return "complete_form";
  if (mode === "upload_and_review") return "upload";
  if (mode === "research") return "research";
  if (mode === "generator" || mode === "document_builder" || mode === "image_generation") return "generate";
  if (mode === "conversation") return "discuss";
  return "review";
}

function defaultPrimaryLabel(mode) {
  if (mode === "assessment") return "Începe evaluarea";
  if (mode === "choice") return "Confirmă alegerea";
  if (mode === "checklist") return "Continuă";
  if (mode === "structured_form" || mode === "spreadsheet_builder") return "Generează rezultatul";
  if (mode === "research") return "Continuă";
  if (mode === "generator" || mode === "document_builder") return "Generează rezultatul";
  if (mode === "image_generation") return "Generează imaginea";
  if (mode === "upload_and_review") return "Încarcă și analizează";
  return "Continuă";
}

function normalizeOutputTypes(outputTypes, mode) {
  const values = Array.isArray(outputTypes) ? outputTypes.filter(Boolean) : [];
  if (values.length > 0) {
    return values.map((type) => {
      if (type === "quiz_result") return "quiz";
      if (type === "xlsx") return "xlsx";
      if (type === "table") return "table";
      if (type === "image") return "image";
      if (type === "pdf") return "pdf";
      if (type === "docx") return "docx";
      return "text";
    });
  }

  if (mode === "assessment") return ["quiz", "text"];
  if (mode === "spreadsheet_builder") return ["table", "xlsx"];
  if (mode === "image_generation") return ["image"];
  if (mode === "document_builder") return ["pdf", "docx", "text"];
  return ["text"];
}

function validatePlanShape(plan, context) {
  if (plan.mode === "assessment" && plan.questions.length < 1) return "assessment_needs_questions";
  if (plan.mode === "guided_questions" && plan.questions.length < 1 && plan.requiredInputs.length < 1) {
    return "guided_needs_questions";
  }
  if (plan.mode === "choice" && plan.choices.length < 2) {
    return "choice_needs_options";
  }
  if (plan.mode === "checklist" && plan.checklistItems.length < 1) {
    return "checklist_needs_items";
  }
  if (
    (plan.mode === "structured_form" || plan.mode === "spreadsheet_builder") &&
    plan.requiredInputs.length < 1
  ) {
    return "form_needs_fields";
  }

  if (plan.mode === "research") {
    const webNeed = evaluateWebSearchNeed({
      project: { goal: context.projectGoal, category_slug: context.categorySlug },
      step: { title: context.stepTitle, expected_outcome: context.expectedOutcome },
    });
    if (!webNeed.shouldSearch && plan.questions.length === 0 && plan.requiredInputs.length === 0) {
      // still valid - may proceed to generation after brief intro
    }
  }

  return null;
}

export function buildContextualExecutionPlanFallback(context, preparation, memoryMap = new Map()) {
  const missing = (preparation?.missingFields || []).filter(
    (field) => !memoryHasKnownField(memoryMap, field.key),
  );

  if (missing.length >= 3) {
    const isBudget = `${context.stepTitle} ${context.projectGoal}`.toLowerCase().includes("buget");
    return finalizeFallbackPlan({
      mode: isBudget ? "spreadsheet_builder" : "structured_form",
      title: context.stepTitle,
      explanation: context.stepDescription || `Completează informațiile pentru „${context.stepTitle}”.`,
      whyThisAction: context.whyItMatters || "Aceste date sunt necesare pentru a finaliza pasul.",
      expectedOutcome: context.expectedOutcome,
      userAction: {
        type: "complete_form",
        instruction: `Completează câmpurile lipsă pentru „${context.stepTitle}”.`,
      },
      requiredInputs: missing.map((field, index) =>
        normalizeRequiredInput(
          {
            id: field.key,
            type: "text",
            label: field.label || field.key,
            required: field.required !== false,
          },
          index,
        ),
      ),
      primaryActionLabel: "Generează rezultatul",
      outputTypes: isBudget ? ["table", "xlsx"] : ["text"],
      source: "contextual_fallback",
    });
  }

  if (missing.length > 0) {
    return finalizeFallbackPlan({
      mode: "guided_questions",
      title: context.stepTitle,
      explanation: context.stepDescription || `Clarificăm informațiile lipsă pentru „${context.stepTitle}”.`,
      whyThisAction: context.whyItMatters || "Avem nevoie de câteva clarificări înainte de a continua.",
      expectedOutcome: context.expectedOutcome,
      userAction: {
        type: "answer",
        instruction: `Răspunde la întrebările despre „${context.stepTitle}”.`,
      },
      questions: missing.map((field, index) => ({
        id: slugify(field.key, index),
        type: "long_text",
        prompt: field.label || field.key,
        required: field.required !== false,
        weight: 1,
      })),
      primaryActionLabel: "Continuă",
      outputTypes: ["text"],
      source: "contextual_fallback",
    });
  }

  const haystack = `${context.stepTitle} ${context.stepDescription} ${context.expectedOutcome}`.toLowerCase();
  const isEnrollment =
    haystack.includes("inscri") ||
    haystack.includes("enroll") ||
    haystack.includes("scolar") ||
    haystack.includes("scoala") ||
    haystack.includes("școal") ||
    haystack.includes("matricul");

  if (isEnrollment) {
    return finalizeFallbackPlan({
      ...buildEnrollmentChecklistFallback(context),
      source: "contextual_fallback",
    });
  }

  const isResearch =
    haystack.includes("concuren") || haystack.includes("piata") || haystack.includes("cercet");
  const isImage = haystack.includes("logo") || haystack.includes("imagine") || haystack.includes("design");
  const isDocument =
    haystack.includes("plan") || haystack.includes("document") || haystack.includes("strategie");

  if (isResearch) {
    return finalizeFallbackPlan({
      mode: "research",
      title: context.stepTitle,
      explanation: context.stepDescription || `Cercetăm informațiile necesare pentru „${context.stepTitle}”.`,
      whyThisAction: context.whyItMatters || "Informațiile actuale ajută la o decizie mai bună.",
      expectedOutcome: context.expectedOutcome,
      userAction: { type: "research", instruction: "Confirmă contextul, apoi revizuiește concluziile." },
      primaryActionLabel: "Continuă",
      outputTypes: ["text"],
      source: "contextual_fallback",
    });
  }

  if (isImage) {
    return finalizeFallbackPlan({
      mode: "image_generation",
      title: context.stepTitle,
      explanation: context.stepDescription || `Generăm vizualul necesar pentru „${context.stepTitle}”.`,
      whyThisAction: context.whyItMatters || "Vizualul susține obiectivul proiectului.",
      expectedOutcome: context.expectedOutcome,
      userAction: { type: "generate", instruction: "Generează imaginea pentru acest pas." },
      primaryActionLabel: "Generează imaginea",
      outputTypes: ["image"],
      source: "contextual_fallback",
    });
  }

  if (isDocument) {
    return finalizeFallbackPlan({
      mode: "document_builder",
      title: context.stepTitle,
      explanation: context.stepDescription || `Construim documentul pentru „${context.stepTitle}”.`,
      whyThisAction: context.whyItMatters || "Documentul structurează următorii pași.",
      expectedOutcome: context.expectedOutcome,
      userAction: { type: "generate", instruction: "Generează documentul pentru acest pas." },
      primaryActionLabel: "Generează documentul",
      outputTypes: ["pdf", "docx", "text"],
      source: "contextual_fallback",
    });
  }

  return finalizeFallbackPlan({
    mode: "generator",
    title: context.stepTitle,
    explanation: context.stepDescription || `ITER va produce rezultatul pentru „${context.stepTitle}”.`,
    whyThisAction: context.whyItMatters || "Acest pas avansează proiectul spre obiectiv.",
    expectedOutcome: context.expectedOutcome,
    userAction: { type: "generate", instruction: `Generează rezultatul pentru „${context.stepTitle}”.` },
    primaryActionLabel: "Generează rezultatul",
    outputTypes: ["text"],
    source: "contextual_fallback",
  });
}

function finalizeFallbackPlan(partial) {
  const plan = {
    planId: randomUUID(),
    version: EXECUTION_PLAN_VERSION,
    mode: partial.mode,
    title: partial.title,
    explanation: partial.explanation,
    whyThisAction: partial.whyThisAction,
    expectedOutcome: partial.expectedOutcome,
    userAction: partial.userAction,
    requiredInputs: partial.requiredInputs || [],
    questions: partial.questions || [],
    choices: partial.choices || [],
    checklistItems: partial.checklistItems || [],
    completionCriteria: buildCompletionCriteriaForMode(partial.mode, partial.completionCriteria || {}),
    outputTypes: partial.outputTypes || ["text"],
    primaryActionLabel: partial.primaryActionLabel || defaultPrimaryLabel(partial.mode),
    finalizeActionLabel: partial.finalizeActionLabel || resolveFinalizeActionLabel(partial.mode),
    evaluationStrategy: partial.mode === "assessment" ? "ai_evaluated" : "none",
    resultFormat: partial.mode === "assessment" ? "readiness_summary" : "none",
    source: partial.source || "contextual_fallback",
  };
  return attachPlanMetadata(plan, partial.source || "contextual_fallback");
}

function extractChatJson(data) {
  const content = data?.choices?.[0]?.message?.content || "";
  if (!content.trim()) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function callOpenAiExecutionPlan({ context, fetchImpl, apiKey, repair = false, repairReason = null }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXECUTION_PLAN_TIMEOUT_MS);

  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EXECUTION_PLAN_MODEL,
        temperature: EXECUTION_PLAN_TEMPERATURE,
        response_format: {
          type: "json_schema",
          json_schema: buildExecutionPlanJsonSchema(),
        },
        messages: [
          { role: "system", content: buildExecutionPlanSystemPrompt() },
          {
            role: "user",
            content: repair
              ? `${buildExecutionPlanUserPrompt(context)}\n\nRepară JSON-ul anterior. Motiv: ${repairReason || "invalid"}.`
              : buildExecutionPlanUserPrompt(context),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return { ok: false, reason: "upstream" };
    const data = await response.json();
    const parsed = extractChatJson(data);
    if (!parsed) return { ok: false, reason: "invalid_json" };
    return { ok: true, parsed };
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateExecutionPlan({
  project,
  step,
  milestone,
  preparation,
  memoryMap,
  completedSteps,
  collectedInput,
  executionDecision,
  fetchImpl = fetch,
  apiKey = process.env.OPENAI_API_KEY || "",
}) {
  const context = buildExecutionPlanContext({
    project,
    step,
    milestone,
    preparation,
    memoryMap,
    completedSteps,
    collectedInput,
    executionDecision,
  });

  if (!apiKey) {
    const plan = buildContextualExecutionPlanFallback(context, preparation, memoryMap);
    return {
      ok: true,
      plan,
      source: "contextual_fallback",
    };
  }

  const first = await callOpenAiExecutionPlan({ context, fetchImpl, apiKey });
  let normalized = first.ok ? normalizeExecutionPlan(first.parsed, context) : { ok: false, reason: first.reason };
  let source = normalized.ok ? "openai" : first.reason;

  if (!normalized.ok) {
    const repair = await callOpenAiExecutionPlan({
      context,
      fetchImpl,
      apiKey,
      repair: true,
      repairReason: normalized.reason,
    });
    if (repair.ok) {
      normalized = normalizeExecutionPlan(repair.parsed, context);
      if (normalized.ok) {
        source = "repair";
      }
    }
  }

  if (normalized.ok) {
    const plan = attachPlanMetadata(normalized.plan, source);
    const payload = serializeInteractivePayloadFromPlan(plan);
    const payloadValidation = validateInteractivePayload(plan.mode, payload);
    if (payloadValidation.valid || !isInteractivePlanMode(plan.mode)) {
      return { ok: true, plan, source };
    }
  }

  const fallbackPlan = buildContextualExecutionPlanFallback(context, preparation, memoryMap);
  return {
    ok: true,
    plan: fallbackPlan,
    source: "contextual_fallback",
  };
}

export function getExecutionPlanFromPreparedInput(preparedInput = {}) {
  return preparedInput?._executionPlan || null;
}

export function withExecutionPlan(preparedInput = {}, plan) {
  return {
    ...(preparedInput || {}),
    _executionPlan: plan,
  };
}

export function executionPlanToAssessmentInternal(plan) {
  if (!plan || plan.mode !== "assessment") return null;
  return {
    assessmentId: plan.planId,
    type: "assessment",
    title: plan.title,
    instructions: plan.userAction?.instruction || plan.explanation,
    scoringStrategy: plan.evaluationStrategy === "rule_based" ? "rule_based" : "ai_evaluated",
    resultFormat: plan.resultFormat || "competency_summary",
    progressLabel: "Întrebarea",
    domainSummary: plan.expectedOutcome,
    questions: plan.questions || [],
    source: plan.source,
  };
}

export function executionPlanToExecutionDefinition(plan, extras = {}) {
  if (!plan) return null;

  let requiredInputs = [...(plan.requiredInputs || [])];

  if (plan.mode === "choice" && plan.choices?.length) {
    requiredInputs = [
      {
        id: "selected_direction",
        type: "single_choice",
        label: plan.userAction?.instruction || "Alege direcția potrivită",
        placeholder: "Alege o opțiune",
        required: true,
        options: plan.choices.map((choice) => ({
          value: choice.value,
          label: choice.title,
        })),
      },
    ];
  }

  if (plan.mode === "guided_questions" && plan.questions?.length && requiredInputs.length === 0) {
    requiredInputs = plan.questions.slice(0, 1).map((question) => ({
      id: question.id,
      type: question.type === "single_choice" ? "single_choice" : "text",
      label: question.prompt,
      placeholder: question.prompt,
      required: question.required !== false,
      options: question.options?.map((option) => ({ value: option.value, label: option.label })),
    }));
  }

  let researchStatus = null;
  if (plan.mode === "research") {
    researchStatus = extras.executionDecision?.webSearch?.executed ? "completed" : "unavailable";
  }

  return {
    mode: plan.mode,
    title: plan.title,
    explanation: plan.explanation,
    whyItMatters: plan.whyThisAction,
    expectedOutcome: plan.expectedOutcome,
    milestoneTitle: extras.milestoneTitle || null,
    estimatedEffortLabel: extras.estimatedEffortLabel || null,
    requiredInputs,
    outputTypes: plan.outputTypes || ["text"],
    primaryActionLabel: plan.primaryActionLabel || defaultPrimaryLabel(plan.mode),
    finalizeActionLabel: plan.finalizeActionLabel || resolveFinalizeActionLabel(plan.mode),
    researchStatus,
    assessmentQuestionCount: plan.mode === "assessment" ? plan.questions?.length || null : null,
    userAction: plan.userAction,
    completionCriteria: plan.completionCriteria,
    planId: plan.planId,
    planSource: plan.source,
  };
}

export function serializeInteractivePayloadFromPlan(plan) {
  if (!plan || !isInteractivePlanMode(plan.mode)) return null;

  if (plan.mode === "assessment") {
    return {
      type: "assessment",
      assessmentId: plan.planId,
      title: plan.title,
      instructions: plan.userAction?.instruction || plan.explanation,
      scoringStrategy: plan.evaluationStrategy === "rule_based" ? "rule_based" : "ai_evaluated",
      progressLabel: "Întrebarea",
      questions: (plan.questions || []).map((question) => ({
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        required: question.required !== false,
        options: question.options?.map((option) => ({
          id: option.id,
          label: option.label,
          value: option.value,
        })),
      })),
    };
  }

  if (plan.mode === "guided_questions") {
    return {
      type: "guided_questions",
      questions: (plan.questions || []).map((question) => ({
        id: question.id,
        prompt: question.prompt,
        required: question.required !== false,
      })),
    };
  }

  if (plan.mode === "structured_form" || plan.mode === "spreadsheet_builder") {
    return {
      type: "structured_form",
      fields: (plan.requiredInputs || []).map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        required: field.required !== false,
        options: field.options?.map((option) => ({
          id: option.value,
          label: option.label,
          value: option.value,
        })),
      })),
    };
  }

  if (plan.mode === "choice") {
    return {
      type: "choice",
      options: (plan.choices || []).map((choice) => ({
        id: choice.id,
        label: choice.title,
        value: choice.value,
      })),
    };
  }

  if (plan.mode === "checklist") {
    return {
      type: "checklist",
      items: (plan.checklistItems || []).map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description || undefined,
        required: item.required !== false,
        completed: Boolean(item.completed),
      })),
    };
  }

  return null;
}

export async function ensureExecutionPlan({
  baseUrl,
  secretKey,
  userId,
  actionRow,
  project,
  step,
  milestone,
  preparation,
  memoryMap,
  completedSteps,
  executionDecision,
  schemaCapabilities = null,
  fetchImpl = fetch,
  forceRegenerateInvalidPlan = false,
}) {
  let action = actionRow;
  const context = buildExecutionPlanContext({
    project,
    step,
    milestone,
    preparation,
    memoryMap,
    completedSteps,
    collectedInput: action.collected_input,
    executionDecision,
  });

  let plan = getExecutionPlanFromPreparedInput(action.prepared_input);
  let shouldGenerate = forceRegenerateInvalidPlan || !plan;

  if (plan && !shouldGenerate) {
    if (!isPersistedPlanExecutable(plan, context)) {
      shouldGenerate = true;
    } else {
      const payload = serializeInteractivePayloadFromPlan(plan);
      const payloadValidation = validateInteractivePayload(plan.mode, payload);
      if (!payloadValidation.valid) {
        shouldGenerate = true;
      }
    }
  }

  if (shouldGenerate) {
    const generated = await generateExecutionPlan({
      project,
      step,
      milestone,
      preparation,
      memoryMap,
      completedSteps,
      collectedInput: action.collected_input,
      executionDecision,
      fetchImpl,
    });

    let nextPlan = generated.plan;
    const completeness = validateExecutionPlanCompleteness(nextPlan, context);
    if (!completeness.valid) {
      nextPlan = buildContextualExecutionPlanFallback(context, preparation, memoryMap);
    }

    const payload = serializeInteractivePayloadFromPlan(nextPlan);
    const payloadValidation = validateInteractivePayload(nextPlan.mode, payload);
    if (!payloadValidation.valid && isInteractivePlanMode(nextPlan.mode)) {
      nextPlan = buildContextualExecutionPlanFallback(context, preparation, memoryMap);
    }

    plan = attachPlanMetadata(
      nextPlan,
      forceRegenerateInvalidPlan && generated.source !== "contextual_fallback"
        ? generated.source
        : generated.source,
    );

    const patch = {
      prepared_input: withExecutionPlan(action.prepared_input, plan),
    };

    const shouldPersist = schemaCapabilities?.sessionColumns !== false;
    if (shouldPersist) {
      const updated = await updateActionSession({
        baseUrl,
        secretKey,
        userId,
        actionId: action.id,
        patch,
      });
      if (updated.ok && updated.action) {
        action = updated.action;
      } else {
        action = { ...action, prepared_input: patch.prepared_input };
      }
    } else {
      action = { ...action, prepared_input: patch.prepared_input };
    }
  } else if (plan) {
    plan = attachPlanMetadata(plan, plan.metadata?.source || "persisted");
  }

  return { action, plan };
}
