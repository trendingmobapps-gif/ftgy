import { PROJECT_BRAIN_LIMITS } from "./constants.js";

function normalizeText(value, maxLength) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeStepKey(step) {
  return `${normalizeText(step.title, 200).toLowerCase()}|${normalizeText(step.description, 400).toLowerCase()}`;
}

export function validateGeneratedWorkflow(raw, { goal }) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "invalid_shape" };
  }

  const summary = normalizeText(raw.summary, 4000);
  const currentStage = normalizeText(raw.currentStage, 200);
  const complexity = raw.complexity;
  const estimatedDurationLabel = normalizeText(raw.estimatedDurationLabel, 120);
  const milestones = Array.isArray(raw.milestones) ? raw.milestones : [];

  if (!summary || !currentStage || !estimatedDurationLabel) {
    return { ok: false, reason: "missing_summary_fields" };
  }

  if (!["low", "medium", "high"].includes(complexity)) {
    return { ok: false, reason: "invalid_complexity" };
  }

  if (
    milestones.length < PROJECT_BRAIN_LIMITS.minMilestones ||
    milestones.length > PROJECT_BRAIN_LIMITS.maxMilestones
  ) {
    return { ok: false, reason: "milestone_count" };
  }

  const normalizedGoal = normalizeText(goal, 5000).toLowerCase();
  if (summary.toLowerCase() === normalizedGoal) {
    return { ok: false, reason: "summary_copies_goal" };
  }

  const seenStepKeys = new Set();
  let totalSteps = 0;
  const normalizedMilestones = [];

  for (const milestone of milestones) {
    const title = normalizeText(milestone?.title, 200);
    const description = normalizeText(milestone?.description, 2000);
    const steps = Array.isArray(milestone?.steps) ? milestone.steps : [];

    if (!title || !description) {
      return { ok: false, reason: "invalid_milestone" };
    }

    if (
      steps.length < PROJECT_BRAIN_LIMITS.minStepsPerMilestone ||
      steps.length > PROJECT_BRAIN_LIMITS.maxStepsPerMilestone
    ) {
      return { ok: false, reason: "step_count_per_milestone" };
    }

    const normalizedSteps = [];
    for (const step of steps) {
      const stepTitle = normalizeText(step?.title, 200);
      const stepDescription = normalizeText(step?.description, 2000);
      const expectedOutcome = normalizeText(step?.expectedOutcome, 2000);
      const rationale = step?.rationale ? normalizeText(step.rationale, 1500) : null;
      const priority = step?.priority;
      const estimatedEffortLabel = step?.estimatedEffortLabel
        ? normalizeText(step.estimatedEffortLabel, 80)
        : null;
      const recommendedToolId =
        typeof step?.recommendedToolId === "string" && step.recommendedToolId.trim()
          ? step.recommendedToolId.trim()
          : null;

      if (!stepTitle || !stepDescription || !expectedOutcome) {
        return { ok: false, reason: "invalid_step" };
      }

      if (!["low", "medium", "high"].includes(priority)) {
        return { ok: false, reason: "invalid_priority" };
      }

      const key = normalizeStepKey({ title: stepTitle, description: stepDescription });
      if (seenStepKeys.has(key)) {
        return { ok: false, reason: "duplicate_step" };
      }
      seenStepKeys.add(key);

      normalizedSteps.push({
        title: stepTitle,
        description: stepDescription,
        expectedOutcome,
        rationale,
        priority,
        estimatedEffortLabel,
        recommendedToolId,
      });
      totalSteps += 1;
    }

    normalizedMilestones.push({ title, description, steps: normalizedSteps });
  }

  if (
    totalSteps < PROJECT_BRAIN_LIMITS.minTotalSteps ||
    totalSteps > PROJECT_BRAIN_LIMITS.maxTotalSteps
  ) {
    return { ok: false, reason: "total_step_count" };
  }

  return {
    ok: true,
    workflow: {
      summary,
      currentStage,
      complexity,
      estimatedDurationLabel,
      milestones: normalizedMilestones,
    },
  };
}

const GENERIC_STEP_PATTERNS = [
  /^fă cercetare$/i,
  /^creează un plan$/i,
  /^execută planul$/i,
  /^monitorizează$/i,
];

export function rejectsGenericOnlySteps(workflow) {
  const titles = workflow.milestones.flatMap((m) => m.steps.map((s) => s.title.trim()));
  if (titles.length === 0) return true;
  const genericCount = titles.filter((title) =>
    GENERIC_STEP_PATTERNS.some((pattern) => pattern.test(title)),
  ).length;
  return genericCount === titles.length;
}

export function validateWorkflowSafetyContent(workflow) {
  const blob = JSON.stringify(workflow).toLowerCase();
  const blockedPatterns = [
    /\bjefu/i,
    /\bfurt\b/i,
    /\bsparg\b/i,
    /\bhack\b/i,
    /\bspionaj\b/i,
    /\bcontrafăcut\b/i,
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(blob)) {
      return { ok: false, reason: "safety_rejected" };
    }
  }

  if (rejectsGenericOnlySteps(workflow)) {
    return { ok: false, reason: "generic_only_steps" };
  }

  return { ok: true };
}
