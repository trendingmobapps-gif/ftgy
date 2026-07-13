import { getWorkflowBundle, updateStepStatusOwned } from "../repository.js";
import { getProjectWorkflowView, isProjectBrainReady } from "../service.js";
import { resolveContinueDecision } from "../execution/decision.js";
import { buildExecutionDefinition, serializeExecutionDefinition } from "../execution/definition.js";
import { enrichResponseWithInteractiveState } from "../execution/interactive.js";
import { resolveExecutionMode } from "../execution/definition.js";
import { applyWebSearchStub } from "../execution/web-search.js";
import {
  extractMemoryFactsFromInput,
  getProjectMemoryMap,
  mergeMemoryIntoMissingFields,
  recordProjectMemory,
} from "../memory/service.js";
import { registerAcceptedResultAsResource } from "../resources/registry.js";
import { applyWorkflowEvolution, evaluateWorkflowEvolution } from "../workflow/updater.js";
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
  hasPersistedConversation,
  buildInMemorySessionFromState,
} from "./repository.js";
import { getActionSchemaCapabilities } from "./schema-capabilities.js";
import { logPrepareFailure, logPrepareStage, logPrepareWarning } from "./prepare-stage-log.js";

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

async function buildResultsMap({ baseUrl, secretKey, userId, projectId, schemaCapabilities }) {
  const results = await getResultsForProject({
    baseUrl,
    secretKey,
    userId,
    projectId,
    schemaCapabilities,
  });
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

async function loadSessionArtifacts({
  baseUrl,
  secretKey,
  userId,
  stepId,
  actionRow,
  preparation,
  schemaCapabilities,
  sessionState = null,
}) {
  const pending = await getPendingResultForStep({
    baseUrl,
    secretKey,
    userId,
    stepId,
    schemaCapabilities,
  });
  const accepted = await getLatestAcceptedResultForStep({
    baseUrl,
    secretKey,
    userId,
    stepId,
    schemaCapabilities,
  });
  const pendingResult = pending.result || null;
  const session =
    sessionState && !schemaCapabilities?.sessionColumns
      ? buildInMemorySessionFromState(sessionState, actionRow, preparation)
      : serializeSession({
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

async function buildAdaptiveContext({
  baseUrl,
  secretKey,
  userId,
  project,
  step,
  preparation,
  schemaCapabilities,
}) {
  let memoryMap = new Map();

  try {
    const memory = await getProjectMemoryMap({ baseUrl, secretKey, userId, projectId: project.id });
    if (memory.ok) {
      memoryMap = memory.map;
      logPrepareStage("memory_loaded", {
        projectId: project.id,
        factCount: memoryMap.size,
      });
    } else {
      logPrepareWarning("memory_loaded", "Project memory unavailable; continuing with empty memory", {
        projectId: project.id,
      });
    }
  } catch (error) {
    logPrepareWarning("memory_loaded", "Project memory lookup failed; continuing with empty memory", {
      projectId: project.id,
      errorMessage: error?.message || String(error),
    });
  }

  const filteredMissing = mergeMemoryIntoMissingFields(preparation.missingFields, memoryMap);
  const adaptedPreparation = {
    ...preparation,
    missingFields: filteredMissing,
  };

  let reusableResource = null;
  try {
    const resolved = await resolveContinueDecision({
      baseUrl,
      secretKey,
      userId,
      project,
      step,
      preparation: adaptedPreparation,
      memoryMap,
      schemaCapabilities,
    });
    reusableResource = resolved.reusableResource;

    const webSearch = applyWebSearchStub(resolved.decision);

    logPrepareStage("adaptive_decision_created", {
      projectId: project.id,
      stepId: step.id,
      strategy: resolved.decision?.strategy || null,
      reusableResourceId: reusableResource?.id || null,
    });

    return {
      memoryMap,
      adaptedPreparation,
      executionDecision: {
        ...resolved.decision,
        webSearch,
      },
      reusableResource,
    };
  } catch (error) {
    logPrepareWarning("adaptive_decision_created", "Adaptive decision failed; using generate fallback", {
      projectId: project.id,
      stepId: step.id,
      errorMessage: error?.message || String(error),
    });

    return {
      memoryMap,
      adaptedPreparation,
      executionDecision: {
        strategy: "generate_resource",
        reason: "Adaptive decision unavailable.",
        resourceFormat: "markdown",
        requiresWebSearch: false,
        visibleToUser: false,
        webSearch: applyWebSearchStub({ requiresWebSearch: false }),
      },
      reusableResource: null,
    };
  }
}

function attachAdaptiveResponse(base, adaptive, extras = {}) {
  const executionDefinition = serializeExecutionDefinition(
    buildExecutionDefinition({
      project: extras.project,
      step: extras.step,
      milestone: extras.milestone,
      preparation: adaptive.adaptedPreparation,
      session: base.session,
      executionDecision: adaptive.executionDecision,
      memoryMap: adaptive.memoryMap,
    }),
  );

  logPrepareStage("execution_definition_created", {
    projectId: extras.project?.id || null,
    stepId: extras.step?.id || null,
    mode: executionDefinition?.mode || null,
    requiredInputCount: executionDefinition?.requiredInputs?.length || 0,
  });

  const response = {
    ...base,
    executionDecision: adaptive.executionDecision,
    reusableResource: adaptive.reusableResource,
    executionDefinition,
  };

  logPrepareStage("response_serialized", {
    projectId: extras.project?.id || null,
    stepId: extras.step?.id || null,
    hasAction: Boolean(response.action),
    hasSession: Boolean(response.session),
    hasExecutionDefinition: Boolean(response.executionDefinition),
  });

  return response;
}

export async function prepareProjectAction({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
}) {
  const stageContext = { projectId, stepId, userId };

  try {
    logPrepareStage("request_received", stageContext);

    const schemaCapabilities = await getActionSchemaCapabilities({ baseUrl, secretKey });
    logPrepareStage("auth_success", {
      ...stageContext,
      sessionColumns: schemaCapabilities.sessionColumns,
      acceptanceStatusColumn: schemaCapabilities.acceptanceStatusColumn,
      adaptiveTables: schemaCapabilities.adaptiveTables,
    });

    logPrepareStage("project_loaded", {
      ...stageContext,
      projectStatus: project?.status || null,
      brainStatus: project?.brain_status || null,
    });

    const loaded = await loadOwnedStepContext({
      baseUrl,
      secretKey,
      userId,
      project,
      projectId,
      stepId,
    });

    if (!loaded.ok) {
      logPrepareFailure(loaded.code || "workflow_loaded", new Error(`Prepare context failed: ${loaded.code}`), stageContext);
      return loaded;
    }

    const { bundle, step, milestone } = loaded;
    logPrepareStage("workflow_loaded", {
      ...stageContext,
      workflowId: bundle.workflow?.id || null,
      milestoneCount: bundle.milestones?.length || 0,
      stepCount: bundle.steps?.length || 0,
    });
    logPrepareStage("step_loaded", {
      ...stageContext,
      stepTitle: step.title,
      stepStatus: step.status,
      milestoneTitle: milestone?.title || null,
    });
    logPrepareStage("ownership_validated", stageContext);

    if (step.status === "completed" || step.status === "skipped") {
      return { ok: false, code: "STEP_NOT_ACTIONABLE" };
    }

    const resultsByStepId = await buildResultsMap({
      baseUrl,
      secretKey,
      userId,
      projectId,
      schemaCapabilities,
    });
    logPrepareStage("resources_loaded", {
      ...stageContext,
      knownResultCount: resultsByStepId.size,
    });

    const preparation = buildActionPreparation({
      project,
      workflow: bundle.workflow,
      milestone,
      step,
      steps: bundle.steps,
      resultsByStepId,
    });

    const adaptive = await buildAdaptiveContext({
      baseUrl,
      secretKey,
      userId,
      project,
      step,
      preparation,
      schemaCapabilities,
    });

    const existing = await getActionByStepId({
      baseUrl,
      secretKey,
      userId,
      stepId,
      schemaCapabilities,
    });
    logPrepareStage("existing_action_loaded", {
      ...stageContext,
      hasExistingAction: Boolean(existing.action),
      hasConversation: hasPersistedConversation(existing.action),
    });

    if (hasPersistedConversation(existing.action)) {
      const artifacts = await loadSessionArtifacts({
        baseUrl,
        secretKey,
        userId,
        stepId,
        actionRow: existing.action,
        preparation: adaptive.adaptedPreparation,
        schemaCapabilities,
      });
      logPrepareStage("session_normalized", {
        ...stageContext,
        phase: artifacts.session?.phase || null,
        resumed: true,
      });

      return enrichResponseWithInteractiveState({
        response: attachAdaptiveResponse(
          {
            ok: true,
            action: serializeActionRow(existing.action, {
              latestResult: artifacts.acceptedResult,
              session: artifacts.session,
            }),
            session: artifacts.session,
            preparation: adaptive.adaptedPreparation,
          },
          adaptive,
          { project, step, milestone },
        ),
        adaptive,
        extras: { project, step, milestone, baseUrl, secretKey, userId },
        actionRow: existing.action,
        pendingResult: artifacts.pendingResult,
        schemaCapabilities,
      });
    }

    const sessionState = buildSessionOpening({
      project,
      step,
      preparation: adaptive.adaptedPreparation,
    });
    const saved = await upsertPreparedAction({
      baseUrl,
      secretKey,
      userId,
      preparation: adaptive.adaptedPreparation,
      step,
      workflow: bundle.workflow,
      sessionState,
      schemaCapabilities,
    });

    logPrepareStage("action_initialized", {
      ...stageContext,
      saved: Boolean(saved.ok && saved.action),
      sessionPersisted: saved.sessionPersisted,
      supabaseError: saved.supabaseError || null,
    });

    if (!saved.ok || !saved.action) {
      const persistenceError = new Error(saved.supabaseError?.message || "Action persistence failed");
      persistenceError.code = saved.supabaseError?.code || null;
      persistenceError.details = saved.supabaseError?.details || null;
      persistenceError.hint = saved.supabaseError?.hint || null;
      logPrepareFailure("action_initialized", persistenceError, stageContext);
      return { ok: false, code: "INTERNAL" };
    }

    const artifacts = await loadSessionArtifacts({
      baseUrl,
      secretKey,
      userId,
      stepId,
      actionRow: saved.action,
      preparation: adaptive.adaptedPreparation,
      schemaCapabilities,
      sessionState: saved.sessionPersisted ? null : sessionState,
    });
    logPrepareStage("session_normalized", {
      ...stageContext,
      phase: artifacts.session?.phase || null,
      resumed: false,
    });

    return enrichResponseWithInteractiveState({
      response: attachAdaptiveResponse(
        {
          ok: true,
          action: serializeActionRow(saved.action, {
            latestResult: artifacts.acceptedResult,
            session: artifacts.session,
          }),
          session: artifacts.session,
          preparation: adaptive.adaptedPreparation,
        },
        adaptive,
        { project, step, milestone },
      ),
      adaptive,
      extras: { project, step, milestone, baseUrl, secretKey, userId },
      actionRow: saved.action,
      pendingResult: artifacts.pendingResult,
      schemaCapabilities,
    });
  } catch (error) {
    logPrepareFailure("prepare_project_action", error, stageContext);
    throw error;
  }
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

  const executionMode = resolveExecutionMode({
    step,
    preparation,
    session: serializeSession({ action: actionRow.action, preparation }),
  });

  if (executionMode === "assessment") {
    return { ok: false, code: "VALIDATION" };
  }

  const adaptive = await buildAdaptiveContext({
    baseUrl,
    secretKey,
    userId,
    project,
    step,
    preparation,
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

  let generated;
  if (adaptive.executionDecision.strategy === "reuse_resource" && adaptive.reusableResource) {
    generated = {
      ok: true,
      text: adaptive.reusableResource.preview || adaptive.reusableResource.title,
      model: "reuse_resource",
    };
  } else {
    generated = await executePreparedAction({
      preparation: {
        ...adaptive.adaptedPreparation,
        preparedInput: mergedInput,
      },
      acceptedInput: mergedInput,
      fetchImpl,
    });
  }

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

    await recordProjectMemory({
      baseUrl,
      secretKey,
      userId,
      projectId,
      facts: extractMemoryFactsFromInput(actionRow.action.collected_input, project),
      source: "session",
    });

    const registered = await registerAcceptedResultAsResource({
      baseUrl,
      secretKey,
      userId,
      projectId,
      step,
      action: actionRow.action,
      result: accepted.result,
      sourceStrategy: "generate_resource",
    });

    const memory = await getProjectMemoryMap({ baseUrl, secretKey, userId, projectId });
    const evolution = evaluateWorkflowEvolution({
      bundle,
      completedStep: step,
      acceptedResource: registered.resource,
      memoryMap: memory.ok ? memory.map : new Map(),
    });

    if (evolution.changes.length > 0) {
      await applyWorkflowEvolution({
        baseUrl,
        secretKey,
        userId,
        projectId,
        bundle,
        changes: evolution.changes,
      });
    }

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

export async function saveAssessmentProgress({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
  actionId,
  assessmentId,
  answers,
  currentQuestionIndex,
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

  const { persistAssessmentProgress } = await import("../execution/interactive.js");
  const saved = await persistAssessmentProgress({
    baseUrl,
    secretKey,
    userId,
    actionRow: actionRow.action,
    preparation,
    assessmentId,
    answers,
    currentQuestionIndex,
    started: true,
  });

  if (!saved.ok) {
    return saved;
  }

  const adaptive = await buildAdaptiveContext({
    baseUrl,
    secretKey,
    userId,
    project,
    step,
    preparation,
  });

  const executionDefinition = serializeExecutionDefinition(
    buildExecutionDefinition({
      project,
      step,
      milestone,
      preparation: adaptive.adaptedPreparation,
      session: saved.session,
      executionDecision: adaptive.executionDecision,
      memoryMap: adaptive.memoryMap,
      interactivePayload: saved.interactivePayload,
    }),
  );

  return {
    ok: true,
    action: serializeActionRow(saved.action, { session: saved.session }),
    session: saved.session,
    executionDefinition,
    interactivePayload: saved.interactivePayload,
    savedAnswers: saved.savedAnswers,
    currentQuestionIndex: saved.currentQuestionIndex,
  };
}

export async function submitAssessmentAnswers({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
  actionId,
  assessmentId,
  answers,
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

  const resultsByStepId = await buildResultsMap({ baseUrl, secretKey, userId, projectId });
  const preparation = buildPreparationFromAction({
    project,
    bundle,
    step,
    milestone,
    actionRow: actionRow.action,
    resultsByStepId,
  });

  const { submitAssessmentEvaluation } = await import("../execution/interactive.js");
  const submitted = await submitAssessmentEvaluation({
    baseUrl,
    secretKey,
    userId,
    actionRow: actionRow.action,
    step,
    project,
    preparation,
    assessmentId,
    answers,
  });

  if (!submitted.ok) {
    return submitted;
  }

  const adaptive = await buildAdaptiveContext({
    baseUrl,
    secretKey,
    userId,
    project,
    step,
    preparation,
  });

  const executionDefinition = serializeExecutionDefinition(
    buildExecutionDefinition({
      project,
      step,
      milestone,
      preparation: adaptive.adaptedPreparation,
      session: submitted.session,
      executionDecision: adaptive.executionDecision,
      memoryMap: adaptive.memoryMap,
      interactivePayload: submitted.interactivePayload,
    }),
  );

  return {
    ok: true,
    action: serializeActionRow(submitted.action, { session: submitted.session }),
    session: submitted.session,
    result: serializeActionResultRow(submitted.result),
    executionDefinition,
    interactivePayload: submitted.interactivePayload,
    savedAnswers: submitted.savedAnswers,
    currentQuestionIndex: submitted.currentQuestionIndex,
    evaluation: submitted.evaluation,
  };
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
