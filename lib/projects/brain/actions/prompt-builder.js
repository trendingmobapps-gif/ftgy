import { TOOLS } from "../../../../tools/tools-config.js";
import { PROJECT_ACTION_LIMITS } from "./constants.js";
import { buildProjectActionContext, buildWhyItMatters } from "./context-builder.js";

const FIELD_LABELS = {
  produs: "Produs sau serviciu",
  produsSauSubiect: "Produs sau subiect",
  publicTinta: "Public țintă",
  obiectiv: "Obiectiv",
  subiect: "Subiect",
  descriere: "Descriere",
  context: "Context",
  cerinta: "Cerință",
  tema: "Temă",
  buget: "Buget",
  locatie: "Locație",
  industrie: "Industrie",
};

function labelForField(key) {
  return FIELD_LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function firstSentence(text, max = 220) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  const sentence = trimmed.split(/[.!?]/)[0]?.trim() || trimmed;
  return sentence.length > max ? `${sentence.slice(0, max)}…` : sentence;
}

function inferFieldValue(fieldKey, context) {
  const key = String(fieldKey || "").toLowerCase();
  const { project, step, workflow, completedSteps } = context;

  if (key.includes("produs") || key.includes("subiect") || key.includes("tema")) {
    return project.name || firstSentence(project.goal);
  }

  if (key.includes("obiectiv") || key.includes("scop")) {
    return firstSentence(step.expectedOutcome) || firstSentence(project.goal);
  }

  if (key.includes("descriere") || key.includes("context") || key.includes("cerinta")) {
    return [step.description, step.expectedOutcome, project.summary].filter(Boolean).join(" ");
  }

  if (key.includes("public")) {
    return firstSentence(project.goal, 180);
  }

  if (key.includes("buget")) {
    const goal = project.goal || "";
    const match = goal.match(/(\d[\d.,\s]*)\s*(€|eur|ron|lei)/i);
    return match ? match[0].trim() : "";
  }

  if (key.includes("locat")) {
    const goal = project.goal || "";
    const match = goal.match(/\b(?:în|in)\s+([A-ZĂÂÎȘȚ][a-zăâîșț]+(?:\s+[A-ZĂÂÎȘȚ][a-zăâîșț]+)?)/);
    return match ? match[1].trim() : "";
  }

  if (key.includes("industrie") || key.includes("domeniu")) {
    return workflow?.currentStage || project.categorySlug || "";
  }

  if (completedSteps.length > 0 && (key.includes("rezultat") || key.includes("input"))) {
    return completedSteps
      .slice(-2)
      .map((item) => `${item.title}: ${item.resultPreview || item.expectedOutcome}`)
      .join("\n");
  }

  return "";
}

export function buildPreparedPrompt(context) {
  const { project, step, workflow, completedSteps } = context;
  const location = inferFieldValue("locatie", context);
  const budget = inferFieldValue("buget", context);

  const fragments = [
    `Creează rezultatul pentru pasul „${step.title}” din proiectul „${project.name}”.`,
    project.goal ? `Obiectiv proiect: ${project.goal}` : null,
    workflow?.summary ? `Context plan: ${workflow.summary}` : null,
    step.expectedOutcome ? `Rezultat așteptat: ${step.expectedOutcome}` : null,
    step.description ? `Detalii pas: ${step.description}` : null,
    location ? `Locație: ${location}` : null,
    budget ? `Buget: ${budget}` : null,
    completedSteps.length
      ? `Pași deja finalizați: ${completedSteps.map((item) => item.title).join(", ")}`
      : null,
  ].filter(Boolean);

  const prompt = fragments.join(" ");
  return prompt.length > PROJECT_ACTION_LIMITS.maxPromptChars
    ? `${prompt.slice(0, PROJECT_ACTION_LIMITS.maxPromptChars)}…`
    : prompt;
}

function resolveCapability(step) {
  if (step.tool_id && TOOLS[step.tool_id]) {
    return {
      capabilityType: "tool",
      capabilityRef: step.tool_id,
      tool: TOOLS[step.tool_id],
    };
  }

  return {
    capabilityType: "project_brain",
    capabilityRef: null,
    tool: null,
  };
}

export function buildActionPreparation({ project, workflow, milestone, step, steps, resultsByStepId }) {
  const context = buildProjectActionContext({
    project,
    workflow,
    milestone,
    step,
    steps,
    resultsByStepId,
  });

  const { capabilityType, capabilityRef, tool } = resolveCapability(step);
  const preparedPrompt = buildPreparedPrompt(context);
  const preparedInput = {};
  const missingFields = [];

  if (tool) {
    const requiredFields = Array.isArray(tool.requiredFields) ? tool.requiredFields : [];
    const primaryField = requiredFields[0] || "descriere";

    for (const fieldKey of requiredFields) {
      const inferred = inferFieldValue(fieldKey, context);
      if (inferred) {
        preparedInput[fieldKey] = inferred;
      }
    }

    if (!preparedInput[primaryField]) {
      preparedInput[primaryField] = preparedPrompt;
    }

    for (const fieldKey of requiredFields) {
      const value = String(preparedInput[fieldKey] || "").trim();
      if (!value) {
        missingFields.push({
          key: fieldKey,
          label: labelForField(fieldKey),
          required: true,
        });
      }
    }
  } else {
    preparedInput.prompt = preparedPrompt;
  }

  return {
    capabilityType,
    capabilityRef,
    title: step.title,
    explanation: step.description,
    whyItMatters: buildWhyItMatters({ step, project }),
    expectedResult: step.expected_outcome,
    preparedPrompt,
    preparedInput,
    missingFields,
    estimatedEffortLabel: step.estimated_effort_label || null,
    context,
  };
}

export function buildExecutionPrompt({ preparation, acceptedInput = {} }) {
  const mergedInput = {
    ...(preparation.preparedInput || {}),
    ...(acceptedInput || {}),
  };

  if (preparation.capabilityType === "tool" && preparation.capabilityRef) {
    const tool = TOOLS[preparation.capabilityRef];
    if (!tool?.buildUserPrompt) {
      return {
        systemPrompt: tool?.systemPrompt || "Ești ITER AI.",
        userPrompt: mergedInput.prompt || preparation.preparedPrompt,
      };
    }

    return {
      systemPrompt: tool.systemPrompt,
      userPrompt: tool.buildUserPrompt(mergedInput),
    };
  }

  const { context, preparedPrompt } = preparation;
  const completed = (context.completedSteps || [])
    .map((item) => `- ${item.title}: ${item.resultPreview || item.expectedOutcome}`)
    .join("\n");

  return {
    systemPrompt: `
Ești ITER AI, un partener competent care ajută utilizatorul să finalizeze un pas concret dintr-un proiect real.
Scrie în limba română. Fii clar, practic și orientat spre rezultat.
Nu cere informații deja furnizate în context. Nu menționa arhitectura internă.
`,
    userPrompt: `
Proiect: ${context.project.name}
Obiectiv: ${context.project.goal}
Pas curent: ${context.step.title}
Rezultat așteptat: ${context.step.expectedOutcome}
Context pas: ${context.step.description}
${completed ? `Pași finalizați anterior:\n${completed}` : ""}

Cerere pregătită:
${acceptedInput.prompt || preparedPrompt}
`,
  };
}

export function buildResultPreview(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return trimmed.length > PROJECT_ACTION_LIMITS.maxPreviewChars
    ? `${trimmed.slice(0, PROJECT_ACTION_LIMITS.maxPreviewChars)}…`
    : trimmed;
}

export function buildResultTitle({ step, project }) {
  return `${step.title} — ${project.name}`;
}
