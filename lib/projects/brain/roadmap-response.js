import { PROJECT_BRAIN_LIMITS } from "./constants.js";
import { validateGeneratedWorkflow } from "./validation.js";

function normalizeText(value, maxLength) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function buildStepTemplate(prefix, index) {
  return {
    title: `${prefix} – pasul ${index}`,
    description: `Acțiune concretă pentru ${prefix.toLowerCase()}, adaptată obiectivului proiectului.`,
    expectedOutcome: `Rezultat clar pentru ${prefix.toLowerCase()} (${index}).`,
    rationale: "Pas esențial pentru progres constant.",
    priority: index === 1 ? "high" : "medium",
    estimatedEffortLabel: index === 1 ? "45 min" : "30 min",
    recommendedToolId: null,
  };
}

function buildMilestoneTemplate(title, description, prefix, stepCount = 3) {
  const steps = Array.from({ length: stepCount }).map((_, index) =>
    buildStepTemplate(prefix, index + 1),
  );
  return { title, description, steps };
}

export function extractStructuredJsonFromProviderPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { parsed: null, outputText: null, metadata: { outputItemCount: 0 } };
  }

  if (payload.parsed && typeof payload.parsed === "object") {
    return {
      parsed: payload.parsed,
      outputText: null,
      metadata: payload.metadata || { outputItemCount: 0 },
    };
  }

  let outputText = null;
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    outputText = payload.output_text;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  let refusalExists = false;
  let incompleteReason = payload.incomplete_details?.reason || payload.status || null;

  if (!outputText) {
    for (const item of output) {
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const block of content) {
        if (block?.type === "refusal") {
          refusalExists = true;
        }
        if (block?.type === "output_text" && typeof block.text === "string" && block.text.trim()) {
          outputText = block.text;
        } else if (typeof block?.text === "string" && block.text.trim()) {
          outputText = block.text;
        }
      }
    }
  }

  let parsed = null;
  if (outputText) {
    try {
      parsed = JSON.parse(outputText);
    } catch {
      parsed = null;
    }
  }

  return {
    parsed,
    outputText,
    metadata: {
      responseId: payload.id || null,
      model: payload.model || null,
      status: payload.status || null,
      outputItemCount: output.length,
      outputTextExists: Boolean(outputText),
      parsedJsonExists: Boolean(parsed),
      refusalExists,
      incompleteReason,
    },
  };
}

export function repairGeneratedWorkflowJson(raw, { goal }) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const normalizedGoal = normalizeText(goal, 500);
  const repaired = { ...raw };

  repaired.summary =
    normalizeText(repaired.summary, 4000) ||
    (normalizedGoal
      ? `Plan structurat pentru: ${normalizedGoal}`
      : "Plan structurat pentru obiectivul proiectului.");
  repaired.currentStage =
    normalizeText(repaired.currentStage, 200) || "Clarificarea obiectivului";
  repaired.estimatedDurationLabel =
    normalizeText(repaired.estimatedDurationLabel, 120) || "4–8 săptămâni";

  if (!["low", "medium", "high"].includes(repaired.complexity)) {
    repaired.complexity = "medium";
  }

  if (!Array.isArray(repaired.milestones)) {
    repaired.milestones = [];
  }

  repaired.milestones = repaired.milestones
    .filter((milestone) => milestone && typeof milestone === "object")
    .map((milestone, index) => {
      const title =
        normalizeText(milestone.title, 200) || `Etapa ${index + 1}`;
      const description =
        normalizeText(milestone.description, 2000) ||
        `Repere pentru ${title.toLowerCase()}.`;
      const steps = Array.isArray(milestone.steps) ? milestone.steps : [];
      const normalizedSteps = steps
        .filter((step) => step && typeof step === "object")
        .map((step, stepIndex) => ({
          title: normalizeText(step.title, 200) || `Pas ${stepIndex + 1}`,
          description:
            normalizeText(step.description, 2000) ||
            `Descriere pentru ${title.toLowerCase()}.`,
          expectedOutcome:
            normalizeText(step.expectedOutcome, 2000) ||
            `Rezultat pentru pasul ${stepIndex + 1}.`,
          rationale: step.rationale ? normalizeText(step.rationale, 1500) : null,
          priority: ["low", "medium", "high"].includes(step.priority) ? step.priority : "medium",
          estimatedEffortLabel: step.estimatedEffortLabel
            ? normalizeText(step.estimatedEffortLabel, 80)
            : "30 min",
          recommendedToolId:
            typeof step.recommendedToolId === "string" && step.recommendedToolId.trim()
              ? step.recommendedToolId.trim()
              : null,
        }));

      while (normalizedSteps.length < PROJECT_BRAIN_LIMITS.minStepsPerMilestone) {
        normalizedSteps.push(buildStepTemplate(title, normalizedSteps.length + 1));
      }

      return { title, description, steps: normalizedSteps };
    });

  while (repaired.milestones.length < PROJECT_BRAIN_LIMITS.minMilestones) {
    const index = repaired.milestones.length + 1;
    repaired.milestones.push(
      buildMilestoneTemplate(
        `Etapa ${index}`,
        `Repere pentru etapa ${index} a proiectului.`,
        `Etapa ${index}`,
        PROJECT_BRAIN_LIMITS.minStepsPerMilestone,
      ),
    );
  }

  let totalSteps = repaired.milestones.reduce(
    (total, milestone) => total + (milestone.steps?.length || 0),
    0,
  );
  while (totalSteps < PROJECT_BRAIN_LIMITS.minTotalSteps) {
    const targetMilestone = repaired.milestones[repaired.milestones.length - 1];
    const nextIndex = targetMilestone.steps.length + 1;
    targetMilestone.steps.push(buildStepTemplate(targetMilestone.title, nextIndex));
    totalSteps += 1;
  }

  return repaired;
}

export function buildContextualRoadmapFallback({ project, goal }) {
  const normalizedGoal = normalizeText(goal, 500) || "obiectivul proiectului";
  const projectName = normalizeText(project?.name, 200) || "Proiect";

  return {
    summary: `Plan practic pentru ${projectName}: ${normalizedGoal}.`,
    currentStage: "Clarificarea obiectivului",
    complexity: "medium",
    estimatedDurationLabel: "4–8 săptămâni",
    milestones: [
      buildMilestoneTemplate(
        "Clarificarea obiectivului",
        `Definești direcția și rezultatele așteptate pentru ${normalizedGoal}.`,
        "Clarificare",
        3,
      ),
      buildMilestoneTemplate(
        "Pregătirea resurselor",
        "Identifici resursele, bugetul și instrumentele necesare.",
        "Resurse",
        3,
      ),
      buildMilestoneTemplate(
        "Execuția și monitorizarea",
        "Implementezi pașii și urmărești progresul către obiectiv.",
        "Execuție",
        3,
      ),
    ],
  };
}

export function parseValidateAndRecoverRoadmap({
  raw,
  goal,
  project,
  allowFallback = true,
}) {
  const candidates = [];

  if (raw && typeof raw === "object") {
    candidates.push({ source: "provider", value: raw });
    const repaired = repairGeneratedWorkflowJson(raw, { goal });
    if (repaired) {
      candidates.push({ source: "repair", value: repaired });
    }
  }

  if (allowFallback) {
    candidates.push({
      source: "contextual_fallback",
      value: buildContextualRoadmapFallback({ project, goal }),
    });
  }

  const attempts = [];
  for (const candidate of candidates) {
    const validated = validateGeneratedWorkflow(candidate.value, { goal });
    attempts.push({ source: candidate.source, ok: validated.ok, reason: validated.reason || null });
    if (validated.ok) {
      return {
        ok: true,
        workflow: validated.workflow,
        source: candidate.source,
        attempts,
      };
    }
  }

  return {
    ok: false,
    reason: attempts[0]?.reason || "invalid_output",
    attempts,
  };
}
