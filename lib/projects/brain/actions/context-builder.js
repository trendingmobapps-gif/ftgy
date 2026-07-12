function normalizeText(value, maxLength = 4000) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function completedStepSummaries({ steps, resultsByStepId }) {
  const completed = (steps || [])
    .filter((step) => step.status === "completed")
    .sort((a, b) => a.position - b.position);

  return completed.map((step) => {
    const result = resultsByStepId?.get(step.id);
    return {
      stepId: step.id,
      title: step.title,
      expectedOutcome: step.expected_outcome,
      resultPreview: result?.preview || null,
    };
  });
}

export function buildProjectActionContext({
  project,
  workflow,
  milestone,
  step,
  steps = [],
  resultsByStepId = new Map(),
}) {
  return {
    project: {
      id: project.id,
      name: normalizeText(project.name, 200),
      goal: normalizeText(project.goal, 2000),
      summary: normalizeText(project.summary, 2000),
      description: normalizeText(project.description, 2000),
      categorySlug: project.category_slug || null,
    },
    workflow: workflow
      ? {
          id: workflow.id,
          summary: normalizeText(workflow.summary, 2000),
          currentStage: normalizeText(workflow.current_stage, 500),
          complexity: workflow.complexity,
        }
      : null,
    milestone: milestone
      ? {
          id: milestone.id,
          title: normalizeText(milestone.title, 300),
          description: normalizeText(milestone.description, 1000),
        }
      : null,
    step: {
      id: step.id,
      title: normalizeText(step.title, 300),
      description: normalizeText(step.description, 2000),
      expectedOutcome: normalizeText(step.expected_outcome, 1000),
      rationale: normalizeText(step.rationale, 1000),
      priority: step.priority,
      estimatedEffortLabel: step.estimated_effort_label || null,
      status: step.status,
    },
    completedSteps: completedStepSummaries({ steps, resultsByStepId }),
  };
}

export function buildWhyItMatters({ step, project }) {
  const rationale = normalizeText(step.rationale, 500);
  if (rationale) return rationale;

  const goal = normalizeText(project.goal, 300);
  const title = normalizeText(step.title, 200);
  if (goal && title) {
    return `Acest pas te aduce mai aproape de obiectivul „${goal}”, prin „${title}”.`;
  }

  return "Acest pas este necesar pentru a avansa ordonat spre rezultatul proiectului.";
}
