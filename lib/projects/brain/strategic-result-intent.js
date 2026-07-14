/**
 * Classifies result-generation intent for frontier vs mechanical model selection.
 * Output labels and short modes must not alone downgrade strategic work.
 */

export const STRATEGIC_RESULT_INTENTS = {
  CHECKLIST_FROM_ANSWERS: "checklist_from_answers",
  PERSONALIZED_BUSINESS_STRATEGY: "personalized_business_strategy",
  PERSONALIZED_STUDY_PLAN: "personalized_study_plan",
  REFORMAT_ACCEPTED_PLAN: "reformat_accepted_plan",
  WORKFLOW_DIAGNOSTIC: "workflow_diagnostic",
  PERSONALIZED_LESSON: "personalized_lesson",
  GENERIC_GENERATION: "generic_generation",
};

const STUDY_PLAN_SIGNALS = /\b(examen|study|plan de studiu|pregătire|availability|disponibilitate|nivel curent|exam date|daily availability)\b/i;
const BUSINESS_STRATEGY_SIGNALS = /\b(strategie|business|afaceri|pia[tț]ă|revenue|monetiz|go-to-market|competitive)\b/i;
const DIAGNOSTIC_SIGNALS = /\b(diagnostic|recomandare|workflow|adapt|reconsider|schimb[aă] workflow|prioritiz)\b/i;
const LESSON_SIGNALS = /\b(lec[tț]ie|lesson|curriculum|modul)\b/i;
const REFORMAT_SIGNALS = /\b(reformat|bullet|concise|prescurt|transform[aă]|convert)\b/i;
const CHECKLIST_SIGNALS = /\b(checklist|list[aă] de verificare|task list|pa[sș]i simpli)\b/i;

function normalizeIntent(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function resolveExplicitIntent(resultIntent) {
  const normalized = normalizeIntent(resultIntent);
  const values = Object.values(STRATEGIC_RESULT_INTENTS);
  if (values.includes(normalized)) {
    return normalized;
  }
  if (normalized.includes("checklist")) return STRATEGIC_RESULT_INTENTS.CHECKLIST_FROM_ANSWERS;
  if (normalized.includes("study") || normalized.includes("examen")) {
    return STRATEGIC_RESULT_INTENTS.PERSONALIZED_STUDY_PLAN;
  }
  if (normalized.includes("strategy") || normalized.includes("strategie")) {
    return STRATEGIC_RESULT_INTENTS.PERSONALIZED_BUSINESS_STRATEGY;
  }
  if (normalized.includes("reformat") || normalized.includes("bullet")) {
    return STRATEGIC_RESULT_INTENTS.REFORMAT_ACCEPTED_PLAN;
  }
  if (normalized.includes("diagnostic") || normalized.includes("workflow")) {
    return STRATEGIC_RESULT_INTENTS.WORKFLOW_DIAGNOSTIC;
  }
  if (normalized.includes("lesson") || normalized.includes("lectie")) {
    return STRATEGIC_RESULT_INTENTS.PERSONALIZED_LESSON;
  }
  return null;
}

function inferIntentFromSignals({ executionPlan, outputLabel, revisionContext = {} }) {
  const haystack = [
    outputLabel,
    executionPlan?.title,
    executionPlan?.mode,
    executionPlan?.metadata?.resultIntent,
    executionPlan?.metadata?.outputLabel,
    revisionContext?.reason,
  ]
    .filter(Boolean)
    .join(" ");

  if (CHECKLIST_SIGNALS.test(haystack) || executionPlan?.mode === "checklist") {
    return STRATEGIC_RESULT_INTENTS.CHECKLIST_FROM_ANSWERS;
  }
  if (STUDY_PLAN_SIGNALS.test(haystack)) {
    return STRATEGIC_RESULT_INTENTS.PERSONALIZED_STUDY_PLAN;
  }
  if (BUSINESS_STRATEGY_SIGNALS.test(haystack)) {
    return STRATEGIC_RESULT_INTENTS.PERSONALIZED_BUSINESS_STRATEGY;
  }
  if (DIAGNOSTIC_SIGNALS.test(haystack)) {
    return STRATEGIC_RESULT_INTENTS.WORKFLOW_DIAGNOSTIC;
  }
  if (REFORMAT_SIGNALS.test(haystack) || revisionContext?.authoritativeSourcePersisted === true) {
    return STRATEGIC_RESULT_INTENTS.REFORMAT_ACCEPTED_PLAN;
  }
  if (LESSON_SIGNALS.test(haystack)) {
    return STRATEGIC_RESULT_INTENTS.PERSONALIZED_LESSON;
  }
  if (["recommendation_selection", "research", "assessment"].includes(executionPlan?.mode)) {
    return STRATEGIC_RESULT_INTENTS.GENERIC_GENERATION;
  }
  return STRATEGIC_RESULT_INTENTS.GENERIC_GENERATION;
}

export function classifyStrategicResultIntent({
  executionPlan = null,
  resultIntent = null,
  outputLabel = null,
  revisionContext = {},
} = {}) {
  const intent =
    resolveExplicitIntent(resultIntent) ||
    resolveExplicitIntent(executionPlan?.metadata?.resultIntent) ||
    inferIntentFromSignals({ executionPlan, outputLabel, revisionContext });

  const authoritativeSourcePersisted =
    revisionContext?.authoritativeSourcePersisted === true ||
    intent === STRATEGIC_RESULT_INTENTS.REFORMAT_ACCEPTED_PLAN;

  const mechanicalTransformation =
    intent === STRATEGIC_RESULT_INTENTS.CHECKLIST_FROM_ANSWERS ||
    (intent === STRATEGIC_RESULT_INTENTS.REFORMAT_ACCEPTED_PLAN && authoritativeSourcePersisted);

  const personalizedGeneration =
    intent === STRATEGIC_RESULT_INTENTS.PERSONALIZED_BUSINESS_STRATEGY ||
    intent === STRATEGIC_RESULT_INTENTS.PERSONALIZED_STUDY_PLAN ||
    (intent === STRATEGIC_RESULT_INTENTS.PERSONALIZED_LESSON && !authoritativeSourcePersisted);

  const workflowImpacting =
    intent === STRATEGIC_RESULT_INTENTS.WORKFLOW_DIAGNOSTIC ||
    executionPlan?.metadata?.workflowImpacting === true;

  const strategicOutput =
    personalizedGeneration ||
    workflowImpacting ||
    intent === STRATEGIC_RESULT_INTENTS.GENERIC_GENERATION ||
    executionPlan?.mode === "recommendation_selection" ||
    executionPlan?.mode === "research";

  return {
    intent,
    mechanicalTransformation,
    personalizedGeneration,
    workflowImpacting,
    strategicOutput,
    authoritativeSourcePersisted,
  };
}

export function buildResultGenerationOperationContext({
  executionPlan = null,
  resultIntent = null,
  outputLabel = null,
  revisionContext = {},
  projectId = null,
  usageState = {},
} = {}) {
  const classified = classifyStrategicResultIntent({
    executionPlan,
    resultIntent,
    outputLabel,
    revisionContext,
  });

  return {
    projectId,
    projectFrontierCallCount: usageState.projectCreationFrontierCalls ?? usageState.projectFrontierCalls ?? 0,
    actionFrontierCallCount: usageState.actionDesignFrontierCalls ?? usageState.actionFrontierCalls ?? 0,
    mechanicalTransformation: classified.mechanicalTransformation,
    mechanicalOutput: classified.mechanicalTransformation,
    authoritativeSourcePersisted: classified.authoritativeSourcePersisted,
    personalizedGeneration: classified.personalizedGeneration,
    workflowImpacting: classified.workflowImpacting,
    strategicOutput: classified.strategicOutput,
    resultIntent: classified.intent,
  };
}
