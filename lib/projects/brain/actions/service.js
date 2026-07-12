import { getWorkflowBundle, updateStepStatusOwned } from "../repository.js";
import { getProjectWorkflowView, isProjectBrainReady } from "../service.js";
import { buildActionPreparation, buildResultPreview, buildResultTitle } from "./prompt-builder.js";
import { executePreparedAction } from "./generation.js";
import {
  appendUserAnswer,
  buildResultMessage,
  buildReviewMessage,
  buildSessionOpening,
  resolveNextQuestion,
  serializeSession,
} from "./session.js";
import {
  getActionByStepId,
  getLatestAcceptedResultForStep,
  getPendingResultForStep,
  getResultsForProject,
  insertActionResult,
  serializeActionPreviewFromStep,
  serializeActionResultRow,
  serializeActionRow,
  updateActionResultAcceptance,
  updateActionSession,
  updateActionStatus,
  upsertPreparedAction,
} from "./repository.js";

async function loadOwnedStepContext({ baseUrl, secretKey, userId, project, projectId, stepId }) {
  if (!project || project.status === "archived") {
    return { ok: false, code: project ? "ARCHIVED_READONLY" : "NOT_FOUND" };
  }

  const bundle = await getWorkflowBundle({ baseUrl, secretKey, userId, projectId });
  if (!isProjectBrainReady(project, bundle)) {
    return { ok: false, code: "STEP_NOT_ACTIONABLE" };
  }

  const step = bundle.steps.find((row) => row.id === stepId);
  if (!step || step.project_id !== projectId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const milestone = bundle.milestones.find((row) => row.id === step.milestone_id) || null;
  return { ok: true, bundle, step, milestone };
}

async function buildResultsMap({ baseUrl, secretKey, userId, projectId }) {
  const results = await getResultsForProject({ baseUrl, secretKey, userId, projectId });
  const map = new Map();
  if (results.ok) {
    for (const row of results.results) {
      if (row.acceptance_status === "rejected") continue;
      if (!map.has(row.step_id)) {
        map.set(row.step_id, row);
      }
    }
  }
  return map;
}

function buildPreparationFromAction({ project, bundle, step, milestone, actionRow, resultsByStepId }) {
  if (actionRow?.prepared_prompt) {
    return {
      capabilityType: actionRow.capability_type,
      capabilityRef: actionRow.capability_ref,
      title: actionRow.title,
      explanation: actionRow.explanation,
      whyItMatters: actionRow.why_it_matters,
      expectedResult: actionRow.expected_result,
      preparedPrompt: actionRow.prepared_prompt,
      preparedInput: actionRow.prepared_input || {},
      missingFields: Array.isArray(actionRow.missing_fields) ? actionRow.missing_fields : [],
      estimatedEffortLabel: actionRow.estimated_effort_label || null,
      context: {
        project: {
          name: project.name,
          goal: project.goal,
          categorySlug: project.category_slug,
        },
        step: {
          title: step.title,
          expectedOutcome: step.expected_outcome,
          description: step.description,
        },
        completedSteps: [],
      },
    };
  }

  return buildActionPreparation({
    project,
    workflow: bundle.workflow,
    milestone,
    step,
    steps: bundle.steps,
    resultsByStepId,
  });
}

async function loadSessionArtifacts({ baseUrl, secretKey, userId, stepId, actionRow, preparation }) {
  const pending = await getPendingResultForStep({ baseUrl, secretKey, userId, stepId });
  const accepted = await getLatestAcceptedResultForStep({ baseUrl, secretKey, userId, stepId });
  const pendingResult = pending.result || null;
  const session = serializeSession({
    action: actionRow,
    preparation,
    pendingResult,
    phaseOverride: actionRow?.session_status || null,
  });

  return {
    pendingResult,
    acceptedResult: accepted.result || null,
    session,
  };
}

export async function prepareProjectAction({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
}) {
  const loaded = await loadOwnedStepContext({
    baseUrl,
    secretKey,
    userId,
    project,
    projectId,
    stepId,
  });

  if (!loaded.ok) {
    return loaded;
  }

  const { bundle, step, milestone } = loaded;
  if (step.status === "completed" || step.status === "skipped") {
    return { ok: false, code: "STEP_NOT_ACTIONABLE" };
  }

  const resultsByStepId = await buildResultsMap({
    baseUrl,
    secretKey,
    userId,
    projectId,
  });

  const preparation = buildActionPreparation({
    project,
    workflow: bundle.workflow,
    milestone,
    step,
    steps: bundle.steps,
    resultsByStepId,
  });

  const existing = await getActionByStepId({ baseUrl, secretKey, userId, stepId });
  if (existing.action?.conversation?.length) {
    const artifacts = await loadSessionArtifacts({
      baseUrl,
      secretKey,
      userId,
      stepId,
      actionRow: existing.action,
      preparation,
    });

    return {
      ok: true,
      action: serializeActionRow(existing.action, {
        latestResult: artifacts.acceptedResult,
        session: artifacts.session,
      }),
      session: artifacts.session,
      preparation,
    };
  }

  const sessionState = buildSessionOpening({ project, step, preparation });
  const saved = await upsertPreparedAction({
    baseUrl,
    secretKey,
    userId,
    preparation,
    step,
    workflow: bundle.workflow,
    sessionState,
  });

  if (!saved.ok || !saved.action) {
    return { ok: false, code: "INTERNAL" };
  }

  const artifacts = await loadSessionArtifacts({
    baseUrl,
    secretKey,
    userId,
    stepId,
    actionRow: saved.action,
    preparation,
  });

  return {
    ok: true,
    action: serializeActionRow(saved.action, {
      latestResult: artifacts.acceptedResult,
      session: artifacts.session,
    }),
    session: artifacts.session,
    preparation,
  };
}

export async function respondToProjectSession({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
  actionId,
  message,
}) {
  const loaded = await loadOwnedStepContext({
    baseUrl,
    secretKey,
    userId,
    project,
    projectId,
    stepId,
  });

  if (!loaded.ok) {
    return loaded;
  }

  const { bundle, step, milestone } = loaded;
  const actionRow = await getActionByStepId({ baseUrl, secretKey, userId, stepId });
  if (!actionRow.action || actionRow.action.id !== actionId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const resultsByStepId = await buildResultsMap({ baseUrl, secretKey, userId, projectId });
  const preparation = buildPreparationFromAction({
    project,
    bundle,
    step,
    milestone,
    actionRow: actionRow.action,
    resultsByStepId,
  });

  const pendingQuestion = actionRow.action.pending_question;
  if (!pendingQuestion) {
    return { ok: false, code: "VALIDATION" };
  }

  const answered = appendUserAnswer({
    conversation: actionRow.action.conversation,
    pendingQuestion,
    message,
    collectedInput: actionRow.action.collected_input,
  });

  const next = resolveNextQuestion({
    preparation,
    collectedInput: answered.collectedInput,
  });

  const conversation = [...answered.conversation];
  if (next.message) {
    conversation.push(next.message);
  } else {
    conversation.push({
      role: "assistant",
      type: "ready",
      content: "Mulțumesc. Am suficient context. Pot genera rezultatul când ești pregătit.",
      createdAt: new Date().toISOString(),
    });
  }

  const updated = await updateActionSession({
    baseUrl,
    secretKey,
    userId,
    actionId,
    patch: {
      conversation,
      collected_input: answered.collectedInput,
      pending_question: next.pendingQuestion,
      session_status: next.phase === "ready" ? "ready" : "collecting",
    },
  });

  if (!updated.ok || !updated.action) {
    return { ok: false, code: "INTERNAL" };
  }

  const artifacts = await loadSessionArtifacts({
    baseUrl,
    secretKey,
    userId,
    stepId,
    actionRow: updated.action,
    preparation,
  });

  return {
    ok: true,
    action: serializeActionRow(updated.action, {
      latestResult: artifacts.acceptedResult,
      session: artifacts.session,
    }),
    session: artifacts.session,
  };
}

export async function executeProjectAction({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
  actionId,
  acceptedInput = {},
  fetchImpl,
}) {
  const loaded = await loadOwnedStepContext({
    baseUrl,
    secretKey,
    userId,
    project,
    projectId,
    stepId,
  });

  if (!loaded.ok) {
    return loaded;
  }

  const { bundle, step, milestone } = loaded;
  if (step.status === "completed" || step.status === "skipped") {
    return { ok: false, code: "STEP_NOT_ACTIONABLE" };
  }

  const actionRow = await getActionByStepId({ baseUrl, secretKey, userId, stepId });
  if (!actionRow.action || actionRow.action.id !== actionId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  if (actionRow.action.pending_question) {
    return { ok: false, code: "VALIDATION" };
  }

  const resultsByStepId = await buildResultsMap({ baseUrl, secretKey, userId, projectId });
  const preparation = buildPreparationFromAction({
    project,
    bundle,
    step,
    milestone,
    actionRow: actionRow.action,
    resultsByStepId,
  });

  const mergedInput = {
    ...(actionRow.action.collected_input || {}),
    ...(actionRow.action.prepared_input || {}),
    ...(acceptedInput || {}),
  };

  const inProgress = await updateActionSession({
    baseUrl,
    secretKey,
    userId,
    actionId,
    patch: {
      status: "in_progress",
      session_status: "generating",
      started_at: new Date().toISOString(),
    },
  });

  if (!inProgress.ok) {
    return { ok: false, code: "INTERNAL" };
  }

  const generated = await executePreparedAction({
    preparation: {
      ...preparation,
      preparedInput: mergedInput,
    },
    acceptedInput: mergedInput,
    fetchImpl,
  });

  if (!generated.ok) {
    await updateActionSession({
      baseUrl,
      secretKey,
      userId,
      actionId,
      patch: {
        status: "failed",
        session_status: actionRow.action.session_status || "ready",
      },
    });
    return { ok: false, code: "EXECUTION_FAILED" };
  }

  const title = buildResultTitle({ step, project });
  const preview = buildResultPreview(generated.text);
  const savedResult = await insertActionResult({
    baseUrl,
    secretKey,
    userId,
    action: actionRow.action,
    step,
    resultType: "text",
    title,
    preview,
    content: generated.text,
    acceptanceStatus: "pending_review",
  });

  if (!savedResult.ok || !savedResult.result) {
    await updateActionSession({
      baseUrl,
      secretKey,
      userId,
      actionId,
      patch: {
        status: "failed",
        session_status: actionRow.action.session_status || "ready",
      },
    });
    return { ok: false, code: "INTERNAL" };
  }

  const conversation = Array.isArray(actionRow.action.conversation)
    ? [...actionRow.action.conversation]
    : [];
  conversation.push(buildResultMessage({ title, preview }));
  conversation.push(buildReviewMessage());

  const reviewed = await updateActionSession({
    baseUrl,
    secretKey,
    userId,
    actionId,
    patch: {
      status: "in_progress",
      session_status: "review",
      conversation,
      pending_result_id: savedResult.result.id,
    },
  });

  if (!reviewed.ok || !reviewed.action) {
    return { ok: false, code: "INTERNAL" };
  }

  const session = serializeSession({
    action: reviewed.action,
    preparation,
    pendingResult: savedResult.result,
    phaseOverride: "review",
  });

  return {
    ok: true,
    action: serializeActionRow(reviewed.action, { session }),
    result: serializeActionResultRow(savedResult.result),
    session,
    requiresReview: true,
  };
}

export async function reviewProjectSession({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
  actionId,
  resultId,
  decision,
  feedback = "",
  fetchImpl,
}) {
  const loaded = await loadOwnedStepContext({
    baseUrl,
    secretKey,
    userId,
    project,
    projectId,
    stepId,
  });

  if (!loaded.ok) {
    return loaded;
  }

  const { bundle, step, milestone } = loaded;
  const actionRow = await getActionByStepId({ baseUrl, secretKey, userId, stepId });
  if (!actionRow.action || actionRow.action.id !== actionId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const pending = await getPendingResultForStep({ baseUrl, secretKey, userId, stepId });
  if (!pending.result || pending.result.id !== resultId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const resultsByStepId = await buildResultsMap({ baseUrl, secretKey, userId, projectId });
  const preparation = buildPreparationFromAction({
    project,
    bundle,
    step,
    milestone,
    actionRow: actionRow.action,
    resultsByStepId,
  });

  if (decision === "accept") {
    const accepted = await updateActionResultAcceptance({
      baseUrl,
      secretKey,
      userId,
      resultId,
      acceptanceStatus: "accepted",
    });

    if (!accepted.ok) {
      return { ok: false, code: "INTERNAL" };
    }

    const conversation = Array.isArray(actionRow.action.conversation)
      ? [...actionRow.action.conversation]
      : [];
    conversation.push({
      role: "assistant",
      type: "system",
      content: "Rezultat acceptat. Pasul este finalizat în proiect.",
      createdAt: new Date().toISOString(),
    });

    await updateActionSession({
      baseUrl,
      secretKey,
      userId,
      actionId,
      patch: {
        status: "completed",
        session_status: "accepted",
        conversation,
        pending_result_id: null,
        completed_at: new Date().toISOString(),
      },
    });

    await updateStepStatusOwned({
      baseUrl,
      secretKey,
      userId,
      projectId,
      stepId,
      targetStatus: "completed",
    });

    const view = await getProjectWorkflowView({
      baseUrl,
      secretKey,
      userId,
      project,
    });

    const session = serializeSession({
      action: { ...actionRow.action, session_status: "accepted" },
      preparation,
      pendingResult: null,
      phaseOverride: "accepted",
    });

    return {
      ok: true,
      action: serializeActionRow(actionRow.action, {
        latestResult: accepted.result,
        session,
      }),
      result: serializeActionResultRow(accepted.result),
      session,
      view,
    };
  }

  if (decision === "reject" || decision === "cancel") {
    await updateActionResultAcceptance({
      baseUrl,
      secretKey,
      userId,
      resultId,
      acceptanceStatus: "rejected",
    });

    const conversation = Array.isArray(actionRow.action.conversation)
      ? [...actionRow.action.conversation]
      : [];
    conversation.push({
      role: "assistant",
      type: "system",
      content: "Rezultat respins. Pasul rămâne deschis — putem încerca din nou când vrei.",
      createdAt: new Date().toISOString(),
    });

    const updated = await updateActionSession({
      baseUrl,
      secretKey,
      userId,
      actionId,
      patch: {
        status: "prepared",
        session_status: "ready",
        conversation,
        pending_result_id: null,
      },
    });

    const session = serializeSession({
      action: updated.action || actionRow.action,
      preparation,
      pendingResult: null,
      phaseOverride: "ready",
    });

    return {
      ok: true,
      action: serializeActionRow(updated.action || actionRow.action, { session }),
      session,
      stepPending: true,
    };
  }

  if (decision === "improve") {
    await updateActionResultAcceptance({
      baseUrl,
      secretKey,
      userId,
      resultId,
      acceptanceStatus: "rejected",
    });

    const conversation = Array.isArray(actionRow.action.conversation)
      ? [...actionRow.action.conversation]
      : [];
    if (feedback.trim()) {
      conversation.push({
        role: "user",
        type: "answer",
        content: feedback.trim(),
        createdAt: new Date().toISOString(),
      });
    }

    const mergedInput = {
      ...(actionRow.action.collected_input || {}),
      prompt: feedback.trim() || actionRow.action.prepared_prompt,
    };

    const generated = await executePreparedAction({
      preparation: {
        ...preparation,
        preparedInput: mergedInput,
      },
      acceptedInput: mergedInput,
      fetchImpl,
    });

    if (!generated.ok) {
      return { ok: false, code: "EXECUTION_FAILED" };
    }

    const title = buildResultTitle({ step, project });
    const preview = buildResultPreview(generated.text);
    const savedResult = await insertActionResult({
      baseUrl,
      secretKey,
      userId,
      action: actionRow.action,
      step,
      resultType: "text",
      title,
      preview,
      content: generated.text,
      acceptanceStatus: "pending_review",
    });

    if (!savedResult.ok || !savedResult.result) {
      return { ok: false, code: "INTERNAL" };
    }

    conversation.push(buildResultMessage({ title, preview }));
    conversation.push(buildReviewMessage());

    const reviewed = await updateActionSession({
      baseUrl,
      secretKey,
      userId,
      actionId,
      patch: {
        status: "in_progress",
        session_status: "review",
        conversation,
        pending_result_id: savedResult.result.id,
      },
    });

    const session = serializeSession({
      action: reviewed.action || actionRow.action,
      preparation,
      pendingResult: savedResult.result,
      phaseOverride: "review",
    });

    return {
      ok: true,
      action: serializeActionRow(reviewed.action || actionRow.action, { session }),
      result: serializeActionResultRow(savedResult.result),
      session,
      requiresReview: true,
    };
  }

  return { ok: false, code: "VALIDATION" };
}

export async function listProjectActionResults({
  baseUrl,
  secretKey,
  userId,
  projectId,
  stepId,
}) {
  const rows = await getResultsForProject({ baseUrl, secretKey, userId, projectId, stepId });
  if (!rows.ok) {
    return { ok: false, code: "INTERNAL" };
  }

  return {
    ok: true,
    results: rows.results
      .filter((row) => row.acceptance_status !== "rejected")
      .map((row) => serializeActionResultRow(row)),
  };
}

export async function resolveProjectActionForStep({
  baseUrl,
  secretKey,
  userId,
  project,
  step,
}) {
  const existing = await getActionByStepId({ baseUrl, secretKey, userId, stepId: step.id });
  if (existing.action) {
    const latest = await getLatestAcceptedResultForStep({
      baseUrl,
      secretKey,
      userId,
      stepId: step.id,
    });
    return serializeActionRow(existing.action, { latestResult: latest.result });
  }

  const preview = serializeActionPreviewFromStep(step, project);
  preview.whyItMatters = preview.whyItMatters || null;
  return preview;
}

export async function stepHasActionResult({ baseUrl, secretKey, userId, stepId }) {
  const latest = await getLatestAcceptedResultForStep({ baseUrl, secretKey, userId, stepId });
  return Boolean(latest.result);
}
