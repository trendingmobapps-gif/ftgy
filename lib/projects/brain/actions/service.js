import { getWorkflowBundle, updateStepStatusOwned } from "../repository.js";
import { getProjectWorkflowView, isProjectBrainReady } from "../service.js";
import { resolveContinueDecision } from "../execution/decision.js";
import { buildExecutionDefinition, serializeExecutionDefinition } from "../execution/definition.js";
import { enrichResponseWithInteractiveState, persistAssessmentProgress, submitAssessmentEvaluation } from "../execution/interactive.js";
import { getExecutionPlanFromPreparedInput } from "../execution/execution-plan-generator.js";
import { loadCompletionContext, validateStepCompletion } from "../execution/completion-evaluator.js";
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
import { generateActionResult } from "./action-result-generator.js";
import { executePreparedAction } from "./generation.js";
import {
  logExecuteFailure,
  logExecuteStage,
  safeAcceptedInputMetadata,
  extractSupabaseErrorPayload,
} from "./execute-action-stage-log.js";
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
  replacePreparedAction,
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
import { persistSessionStatus } from "./session-status-store.js";
import {
  isStepCompleted,
  shouldReplaceTerminalAction,
  shouldResumeExistingAction,
} from "./action-lifecycle.js";
import {
  buildSafeAcceptedInputNormalizationDetails,
  normalizeAcceptedExecutionInput,
} from "./accepted-input-normalizer.js";

async function loadOwnedStepContext({ baseUrl, secretKey, userId, project, projectId, stepId }) {
  if (!project) {
    return { ok: false, code: "NOT_FOUND" };
  }

  if (project.status === "archived") {
    return { ok: false, code: "ARCHIVED_READONLY" };
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
  forceRegenerateInvalidPlan = false,
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

    if (isStepCompleted(step)) {
      const actionRow = await getActionByStepId({
        baseUrl,
        secretKey,
        userId,
        stepId,
        schemaCapabilities,
      });
      const artifacts = await loadSessionArtifacts({
        baseUrl,
        secretKey,
        userId,
        stepId,
        actionRow: actionRow.action,
        preparation: adaptive.adaptedPreparation,
        schemaCapabilities,
      });
      return {
        ok: true,
        readOnly: true,
        code: "STEP_COMPLETED_READONLY",
        action: serializeActionRow(actionRow.action, {
          latestResult: artifacts.acceptedResult,
          session: artifacts.session,
        }),
        session: artifacts.session,
        preparation: adaptive.adaptedPreparation,
      };
    }

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
      existingActionStatus: existing.action?.status || null,
      hasConversation: hasPersistedConversation(existing.action),
      shouldReplace: shouldReplaceTerminalAction({ step, action: existing.action }),
      shouldResume: shouldResumeExistingAction({ step, action: existing.action }),
    });

    if (shouldResumeExistingAction({ step, action: existing.action })) {
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
        forceRegenerateInvalidPlan,
      });
    }

    const sessionState = buildSessionOpening({
      project,
      step,
      preparation: adaptive.adaptedPreparation,
    });

    const saved =
      existing.action && shouldReplaceTerminalAction({ step, action: existing.action })
        ? await replacePreparedAction({
            baseUrl,
            secretKey,
            userId,
            preparation: adaptive.adaptedPreparation,
            step,
            workflow: bundle.workflow,
            sessionState,
            existingAction: existing.action,
            schemaCapabilities,
          })
        : await upsertPreparedAction({
            baseUrl,
            secretKey,
            userId,
            preparation: adaptive.adaptedPreparation,
            step,
            workflow: bundle.workflow,
            sessionState,
            schemaCapabilities,
          });

    logPrepareStage(saved.replaced ? "action_replaced" : "action_initialized", {
      ...stageContext,
      saved: Boolean(saved.ok && saved.action),
      sessionPersisted: saved.sessionPersisted,
      replaced: Boolean(saved.replaced),
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
      forceRegenerateInvalidPlan,
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
  const startedAt = Date.now();
  let currentStage = "service_execution_started";

  const stageLog = (stage, extra = {}) => {
    currentStage = stage;
    logExecuteStage(stage, {
      projectId,
      stepId,
      actionId,
      elapsedMs: Date.now() - startedAt,
      ...extra,
    });
  };

  try {
    stageLog("service_execution_started", safeAcceptedInputMetadata(acceptedInput));

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

    stageLog("project_loaded", { projectStatus: project?.status || null });
    const { bundle, step, milestone } = loaded;
    stageLog("step_loaded", { stepStatus: step.status });

    if (step.status === "completed" || step.status === "skipped") {
      return { ok: false, code: "STEP_NOT_ACTIONABLE" };
    }

    const actionRow = await getActionByStepId({ baseUrl, secretKey, userId, stepId });
    if (!actionRow.action || actionRow.action.id !== actionId) {
      return { ok: false, code: "NOT_FOUND" };
    }

    stageLog("action_loaded", { actionStatus: actionRow.action.status });

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

    const executionPlan = getExecutionPlanFromPreparedInput(actionRow.action.prepared_input);
    stageLog("session_loaded", {
      sessionStatus: actionRow.action.session_status || null,
      executionMode: executionPlan?.mode || null,
      executionPlanVersion: executionPlan?.version || executionPlan?.metadata?.version || null,
    });

    const executionMode = resolveExecutionMode({
      step,
      preparation,
      session: serializeSession({ action: actionRow.action, preparation }),
      executionPlan,
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

    stageLog("memory_loaded", { factCount: adaptive.memoryMap?.size || 0 });
    stageLog("adaptive_decision_created", {
      strategy: adaptive.executionDecision?.strategy || null,
      reusableResourceId: adaptive.reusableResource?.id || null,
      outputType: executionPlan?.outputTypes?.[0] || "text",
    });

    const mergedInput = {
      ...(actionRow.action.collected_input || {}),
      ...(acceptedInput || {}),
    };

    const normalizedInput = normalizeAcceptedExecutionInput({
      acceptedInput: mergedInput,
      executionPlan,
      action: actionRow.action,
    });

    stageLog("accepted_input_normalized", {
      mode: normalizedInput?.mode || executionPlan?.mode || executionMode || null,
      rawKeys: Object.keys(acceptedInput || {}).slice(0, 48),
      normalizedKeys: Object.keys(normalizedInput || {}).slice(0, 48),
      selectedRecommendationsCount: Array.isArray(normalizedInput?.interactive?.selectedRecommendations)
        ? normalizedInput.interactive.selectedRecommendations.length
        : 0,
    });

    if (executionPlan?.mode === "recommendation_selection") {
      const interactive = normalizedInput?.interactive;
      const selectedCount = Array.isArray(interactive?.selectedRecommendations)
        ? interactive.selectedRecommendations.length
        : 0;
      const priorityCount = Array.isArray(interactive?.priorityOrder) ? interactive.priorityOrder.length : 0;

      const invalidFields = [];
      const missingFields = [];

      if (selectedCount < 1) missingFields.push("selectedRecommendations");
      if (!interactive || interactive.type !== "recommendation_selection") invalidFields.push("interactive.type");
      if (interactive?.confirmed !== true) missingFields.push("confirmed");

      if (missingFields.length > 0 || invalidFields.length > 0) {
        stageLog("accepted_input_validation_failed", {
          mode: "recommendation_selection",
          missingFields,
          invalidFields,
          selectedCount,
          priorityCount,
        });

        return {
          ok: false,
          code: "VALIDATION",
          fields: {
            ...buildSafeAcceptedInputNormalizationDetails({
              mode: "recommendation_selection",
              rawInput: acceptedInput,
              normalizedInput,
            }),
            missingFields,
            invalidFields,
          },
        };
      }
    }

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
      const supabaseError = extractSupabaseErrorPayload(inProgress.data);
      logExecuteFailure("session_loaded", new Error("session_update_failed"), {
        projectId,
        stepId,
        actionId,
        stage: currentStage,
        ...supabaseError,
      });
      return { ok: false, code: "INTERNAL" };
    }

    stageLog("generation_started", {
      strategy: adaptive.executionDecision?.strategy || "generate_resource",
      executionMode,
      model: null,
      reasoningEffort: null,
    });

    let generated;
    if (adaptive.executionDecision.strategy === "reuse_resource" && adaptive.reusableResource) {
      generated = {
        ok: true,
        title: buildResultTitle({ step, project }),
        preview: buildResultPreview(adaptive.reusableResource.preview || adaptive.reusableResource.title),
        content: adaptive.reusableResource.preview || adaptive.reusableResource.title,
        resultType: "text",
        strategy: "reuse_resource",
        transport: "reuse_resource",
      };
    } else {
      generated = await generateActionResult({
        preparation: {
          ...adaptive.adaptedPreparation,
          preparedInput: actionRow.action.prepared_input || {},
        },
        collectedInput: actionRow.action.collected_input || {},
        acceptedInput: normalizedInput,
        preparedInput: actionRow.action.prepared_input || {},
        step,
        project,
        fetchImpl,
        logFn: stageLog,
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
      logExecuteFailure("openai_response_received", new Error(generated.reason || "generation_failed"), {
        projectId,
        stepId,
        actionId,
        stage: currentStage,
        executionMode,
        adaptiveStrategy: adaptive.executionDecision?.strategy || null,
        model: generated.model || null,
      });
      return { ok: false, code: "EXECUTION_FAILED", failureReason: generated.reason || null };
    }

    stageLog("result_normalized", {
      resultType: generated.resultType,
      outputType: generated.payload?.type || generated.resultType,
      model: generated.model || null,
      transport: generated.transport || null,
      contentLength: generated.content?.length || 0,
    });

    const savedResult = await insertActionResult({
      baseUrl,
      secretKey,
      userId,
      action: actionRow.action,
      step,
      resultType: generated.resultType || "text",
      title: generated.title,
      preview: generated.preview,
      content: generated.content,
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
      const supabaseError = extractSupabaseErrorPayload(savedResult.data);
      logExecuteFailure("action_result_persisted", new Error("action_result_insert_failed"), {
        projectId,
        stepId,
        actionId,
        stage: currentStage,
        ...supabaseError,
      });
      return { ok: false, code: "RESULT_PERSISTENCE_FAILED" };
    }

    stageLog("action_result_persisted", { resultId: savedResult.result.id });

    const conversation = Array.isArray(actionRow.action.conversation)
      ? [...actionRow.action.conversation]
      : [];
    conversation.push(buildResultMessage({ title: generated.title, preview: generated.preview }));
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
      const supabaseError = extractSupabaseErrorPayload(reviewed.data);
      logExecuteFailure("session_updated", new Error("session_review_update_failed"), {
        projectId,
        stepId,
        actionId,
        stage: currentStage,
        ...supabaseError,
      });
      return { ok: false, code: "RESULT_PERSISTENCE_FAILED" };
    }

    stageLog("session_updated", { sessionStatus: "review" });

    const session = serializeSession({
      action: reviewed.action,
      preparation,
      pendingResult: savedResult.result,
      phaseOverride: "review",
    });

    const response = {
      ok: true,
      action: serializeActionRow(reviewed.action, { session }),
      result: serializeActionResultRow(savedResult.result),
      session,
      requiresReview: true,
    };

    stageLog("response_serialized", {
      totalMs: Date.now() - startedAt,
      generationStatus: "review",
    });

    return response;
  } catch (error) {
    logExecuteFailure(currentStage, error, {
      projectId,
      stepId,
      actionId,
      stage: currentStage,
    });

    try {
      await updateActionSession({
        baseUrl,
        secretKey,
        userId,
        actionId,
        patch: {
          status: "failed",
          session_status: "ready",
        },
      });
    } catch {
      // preserve original failure
    }

    return { ok: false, code: "EXECUTION_FAILED", failureReason: error?.message || "unexpected_error" };
  }
}

async function applyProjectStepCompletion({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
  step,
  bundle,
  actionRow,
  preparation,
  acceptedResult,
}) {
  const conversation = Array.isArray(actionRow.conversation) ? [...actionRow.conversation] : [];
  conversation.push({
    role: "assistant",
    type: "system",
    content: "Etapa a fost finalizată în proiect.",
    createdAt: new Date().toISOString(),
  });

  await updateActionSession({
    baseUrl,
    secretKey,
    userId,
    actionId: actionRow.id,
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
    facts: extractMemoryFactsFromInput(actionRow.collected_input, project),
    source: "session",
  });

  let registered = { resource: null };
  if (acceptedResult) {
    registered = await registerAcceptedResultAsResource({
      baseUrl,
      secretKey,
      userId,
      projectId,
      step,
      action: actionRow,
      result: acceptedResult,
      sourceStrategy: "generate_resource",
    });
  }

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

  return { view, registered };
}

export async function saveExecutionProgress({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
  actionId,
  progress = {},
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

  const actionRow = await getActionByStepId({ baseUrl, secretKey, userId, stepId });
  if (!actionRow.action || actionRow.action.id !== actionId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const plan = getExecutionPlanFromPreparedInput(actionRow.action.prepared_input);
  const collectedInput = {
    ...(actionRow.action.collected_input || {}),
    interactive: {
      ...(actionRow.action.collected_input?.interactive || {}),
      type: plan?.mode || progress.type || "interactive",
      ...progress,
      updatedAt: new Date().toISOString(),
    },
  };

  const validation = validateStepCompletion({
    plan,
    action: actionRow.action,
    collectedInput,
    acceptedResult: null,
    pendingResult: null,
  });

  const updated = await updateActionSession({
    baseUrl,
    secretKey,
    userId,
    actionId,
    patch: {
      collected_input: collectedInput,
      session_status: persistSessionStatus(actionRow.action.session_status || "collecting"),
      status: "in_progress",
    },
  });

  if (!updated.ok || !updated.action) {
    return { ok: false, code: "INTERNAL" };
  }

  const resultsByStepId = await buildResultsMap({ baseUrl, secretKey, userId, projectId });
  const preparation = buildPreparationFromAction({
    project,
    bundle: loaded.bundle,
    step: loaded.step,
    milestone: loaded.milestone,
    actionRow: updated.action,
    resultsByStepId,
  });

  const session = serializeSession({
    action: updated.action,
    preparation,
    pendingResult: null,
    phaseOverride: validation.canFinalize ? "ready_to_finalize" : undefined,
  });

  return {
    ok: true,
    action: serializeActionRow(updated.action, { session }),
    session,
    canFinalize: validation.canFinalize,
    missingRequirements: validation.missingRequirements,
  };
}

export async function finalizeProjectStep({
  baseUrl,
  secretKey,
  userId,
  project,
  projectId,
  stepId,
  actionId,
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

  if (step.status === "completed") {
    const view = await getProjectWorkflowView({ baseUrl, secretKey, userId, project });
    const actionRow = await getActionByStepId({ baseUrl, secretKey, userId, stepId });
    const resultsByStepId = await buildResultsMap({ baseUrl, secretKey, userId, projectId });
    const preparation = buildPreparationFromAction({
      project,
      bundle,
      step,
      milestone,
      actionRow: actionRow.action,
      resultsByStepId,
    });
    const session = serializeSession({
      action: actionRow.action,
      preparation,
      pendingResult: null,
      phaseOverride: "accepted",
    });
    return {
      ok: true,
      alreadyCompleted: true,
      action: serializeActionRow(actionRow.action, { session }),
      session,
      view,
    };
  }

  const actionRow = await getActionByStepId({ baseUrl, secretKey, userId, stepId });
  if (!actionRow.action || actionRow.action.id !== actionId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const acceptedLookup = await getLatestAcceptedResultForStep({ baseUrl, secretKey, userId, stepId });
  const pendingLookup = await getPendingResultForStep({ baseUrl, secretKey, userId, stepId });
  const plan = getExecutionPlanFromPreparedInput(actionRow.action.prepared_input);
  const validation = validateStepCompletion({
    plan,
    action: actionRow.action,
    collectedInput: actionRow.action.collected_input,
    acceptedResult: acceptedLookup.result,
    pendingResult: pendingLookup.result,
  });

  if (!validation.canFinalize) {
    return {
      ok: false,
      code: "STEP_INCOMPLETE",
      missingRequirements: validation.missingRequirements,
    };
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

  let acceptedResult = acceptedLookup.result;
  if (!acceptedResult && (plan?.mode === "checklist" || plan?.mode === "choice")) {
    const interactive = actionRow.action.collected_input?.interactive || {};
    const summaryParts = [];
    if (plan.mode === "checklist") {
      const checked = interactive.checklistChecked || interactive.checked || {};
      for (const item of plan.checklistItems || []) {
        if (checked[item.id]) summaryParts.push(item.label);
      }
    }
    if (plan.mode === "choice") {
      summaryParts.push(String(interactive.selectedChoice || interactive.selected_direction || ""));
    }
    const title = buildResultTitle({ step, project });
    const content = summaryParts.filter(Boolean).join("\n") || plan.expectedOutcome || step.title;
    const preview = buildResultPreview(content);
    const saved = await insertActionResult({
      baseUrl,
      secretKey,
      userId,
      action: actionRow.action,
      step,
      resultType: "summary",
      title,
      preview,
      content,
      acceptanceStatus: "accepted",
    });
    if (saved.ok && saved.result) {
      acceptedResult = saved.result;
    }
  }

  const completion = await applyProjectStepCompletion({
    baseUrl,
    secretKey,
    userId,
    project,
    projectId,
    stepId,
    step,
    bundle,
    actionRow: actionRow.action,
    preparation,
    acceptedResult,
  });

  const session = serializeSession({
    action: { ...actionRow.action, session_status: "accepted", status: "completed" },
    preparation,
    pendingResult: null,
    phaseOverride: "accepted",
  });

  return {
    ok: true,
    action: serializeActionRow(actionRow.action, {
      latestResult: acceptedResult,
      session,
    }),
    result: acceptedResult ? serializeActionResultRow(acceptedResult) : null,
    session,
    view: completion.view,
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
      content: "Rezultat acceptat. Poți închide etapa când ești gata.",
      createdAt: new Date().toISOString(),
    });

    const collectedInput = {
      ...(actionRow.action.collected_input || {}),
      interactive: {
        ...(actionRow.action.collected_input?.interactive || {}),
        resultAccepted: true,
        resultAcceptedAt: new Date().toISOString(),
        acceptedResultId: resultId,
      },
    };

    const updated = await updateActionSession({
      baseUrl,
      secretKey,
      userId,
      actionId,
      patch: {
        status: "in_progress",
        session_status: persistSessionStatus("accepted"),
        conversation,
        collected_input: collectedInput,
        pending_result_id: null,
      },
    });

    const acceptedAction = updated.action || actionRow.action;
    const completion = loadCompletionContext(acceptedAction, accepted.result, null);
    const session = serializeSession({
      action: acceptedAction,
      preparation,
      pendingResult: accepted.result,
      phaseOverride: "ready_to_finalize",
    });

    return {
      ok: true,
      action: serializeActionRow(acceptedAction, {
        latestResult: accepted.result,
        session,
      }),
      result: serializeActionResultRow(accepted.result),
      session,
      stepPending: true,
      canFinalize: completion.canFinalize,
      missingRequirements: completion.missingRequirements,
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
