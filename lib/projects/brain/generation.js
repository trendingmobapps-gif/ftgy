import {
  PROJECT_BRAIN_LIMITS,
  PROJECT_BRAIN_VERSION,
} from "./constants.js";
import { buildProjectBrainJsonSchema, buildProjectBrainSystemPrompt } from "./schema.js";
import { callProjectStructuredJson } from "./openai-project-client.js";
import { resolveProjectModelPolicy } from "./project-model-policy.js";
import {
  logRoadmapLifecycleFailure,
  logRoadmapLifecycleStage,
} from "./generation-lifecycle-log.js";
import { parseValidateAndRecoverRoadmap } from "./roadmap-response.js";
import {
  attachResolvedToolsToWorkflow,
  buildToolCatalogSummaryForPrompt,
} from "./tool-resolution.js";
import { validateWorkflowSafetyContent } from "./validation.js";

export async function generateProjectWorkflowWithModel({
  project,
  clarificationAnswers,
  fetchImpl = fetch,
  apiKey = process.env.OPENAI_API_KEY,
  model = resolveProjectModelPolicy("roadmap").model,
  timeoutMs = PROJECT_BRAIN_LIMITS.generationTimeoutMs,
  logFn = console.log,
}) {
  const policy = resolveProjectModelPolicy("roadmap");
  const projectId = project?.id || null;

  if (!apiKey) {
    logRoadmapLifecycleFailure(logFn, {
      stage: "openai_request_started",
      projectId,
      model: policy.model,
      reasoningEffort: policy.reasoningEffort,
      errorCode: "missing_api_key",
      error: { name: "MissingApiKey", message: "OPENAI_API_KEY is not configured" },
    });
    return { ok: false, reason: "missing_api_key" };
  }

  const goal = typeof project.goal === "string" ? project.goal.trim() : "";
  if (!goal || goal.length > PROJECT_BRAIN_LIMITS.maxGoalContextLength) {
    logRoadmapLifecycleFailure(logFn, {
      stage: "roadmap_generation_started",
      projectId,
      model: policy.model,
      reasoningEffort: policy.reasoningEffort,
      errorCode: "invalid_goal_context",
      error: { name: "InvalidGoalContext", message: "Project goal is missing or too long" },
    });
    return { ok: false, reason: "invalid_goal_context" };
  }

  logRoadmapLifecycleStage(logFn, {
    stage: "roadmap_generation_started",
    projectId,
    model: policy.model,
    reasoningEffort: policy.reasoningEffort,
    generationStatus: "generating",
  });

  const categorySlug = project.category_slug || project.categorySlug || "business";
  const toolCatalogSummary = buildToolCatalogSummaryForPrompt();
  const systemPrompt = buildProjectBrainSystemPrompt({ categorySlug, toolCatalogSummary });
  const userLines = [
    `Nume proiect: ${project.name || "Proiect"}`,
    `Obiectiv: ${goal}`,
  ];

  if (project.summary) {
    userLines.push(`Rezumat existent: ${project.summary}`);
  }

  if (project.description) {
    userLines.push(`Descriere: ${project.description}`);
  }

  if (Array.isArray(clarificationAnswers) && clarificationAnswers.length > 0) {
    userLines.push("Răspunsuri clarificare:");
    for (const answer of clarificationAnswers) {
      userLines.push(`- ${answer.questionId}: ${answer.answer}`);
    }
  }

  userLines.push("Generează planul complet conform schemei.");

  logRoadmapLifecycleStage(logFn, {
    stage: "openai_request_started",
    projectId,
    model: policy.model,
    reasoningEffort: policy.reasoningEffort,
    generationStatus: "generating",
  });

  const structured = await callProjectStructuredJson({
    operation: "roadmap",
    systemPrompt,
    userPrompt: userLines.join("\n\n"),
    jsonSchema: buildProjectBrainJsonSchema(),
    fetchImpl,
    apiKey,
    timeoutMs,
    logFn,
    projectId,
  });

  logRoadmapLifecycleStage(logFn, {
    stage: "openai_response_received",
    projectId,
    model: structured.model || policy.model,
    reasoningEffort: policy.reasoningEffort,
    usedFallback: Boolean(structured.transport === "chat_completions"),
    fallbackAttempted: Boolean(structured.fallbackAttempted),
    transport: structured.transport || null,
    generationStatus: "validating",
    responseId: structured.metadata?.responseId || null,
    outputItemCount: structured.metadata?.outputItemCount ?? null,
    outputTextExists: structured.metadata?.outputTextExists ?? null,
    parsedJsonExists: structured.metadata?.parsedJsonExists ?? Boolean(structured.parsed),
    refusalExists: structured.metadata?.refusalExists ?? null,
    incompleteReason: structured.metadata?.incompleteReason || null,
    httpStatus: structured.httpStatus ?? null,
    providerStatus: structured.metadata?.providerStatus || null,
  });

  if (!structured.ok) {
    logRoadmapLifecycleFailure(logFn, {
      stage: "roadmap_parse_started",
      projectId,
      model: policy.model,
      reasoningEffort: policy.reasoningEffort,
      fallbackAttempted: Boolean(structured.fallbackAttempted),
      errorCode: structured.reason || "provider_error",
      httpStatus: structured.httpStatus ?? null,
      error: {
        name: "ProviderError",
        message: structured.reason || "provider_error",
        providerStatus: structured.metadata?.providerStatus || null,
      },
    });
    return { ok: false, reason: structured.reason || "provider_error" };
  }

  logRoadmapLifecycleStage(logFn, {
    stage: "roadmap_parse_started",
    projectId,
    model: structured.model || model,
    reasoningEffort: policy.reasoningEffort,
    generationStatus: "validating",
  });

  try {
    const recovered = parseValidateAndRecoverRoadmap({
      raw: structured.parsed,
      goal,
      project,
      allowFallback: true,
    });

    if (!recovered.ok) {
      logRoadmapLifecycleFailure(logFn, {
        stage: "roadmap_validation_started",
        projectId,
        model: structured.model || model,
        reasoningEffort: policy.reasoningEffort,
        fallbackAttempted: true,
        errorCode: recovered.reason || "invalid_output",
        error: {
          name: "RoadmapValidationError",
          message: recovered.reason || "invalid_output",
        },
      });
      return { ok: false, reason: recovered.reason || "invalid_output" };
    }

    logRoadmapLifecycleStage(logFn, {
      stage: "roadmap_validation_succeeded",
      projectId,
      model: structured.model || model,
      reasoningEffort: policy.reasoningEffort,
      usedFallback: recovered.source !== "provider",
      fallbackAttempted: recovered.source !== "provider",
      generationStatus: "validating",
      milestonesCount: recovered.workflow.milestones.length,
      stepsCount: recovered.workflow.milestones.reduce(
        (total, milestone) => total + milestone.steps.length,
        0,
      ),
    });

    const withTools = attachResolvedToolsToWorkflow(recovered.workflow);
    const safety = validateWorkflowSafetyContent(withTools);
    if (!safety.ok) {
      logRoadmapLifecycleFailure(logFn, {
        stage: "roadmap_validation_started",
        projectId,
        model: structured.model || model,
        reasoningEffort: policy.reasoningEffort,
        errorCode: safety.reason || "safety_rejected",
        error: {
          name: "RoadmapSafetyError",
          message: safety.reason || "safety_rejected",
        },
      });
      return { ok: false, reason: safety.reason || "safety_rejected" };
    }

    logRoadmapLifecycleStage(logFn, {
      stage: "roadmap_parse_succeeded",
      projectId,
      model: structured.model || model,
      reasoningEffort: policy.reasoningEffort,
      usedFallback: recovered.source !== "provider",
      generationStatus: "persisting",
      milestonesCount: withTools.milestones.length,
      stepsCount: withTools.milestones.reduce(
        (total, milestone) => total + milestone.steps.length,
        0,
      ),
    });

    return {
      ok: true,
      workflow: withTools,
      brainVersion: PROJECT_BRAIN_VERSION,
      model: structured.model || model,
      transport: structured.transport || "responses",
      recoverySource: recovered.source,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    logRoadmapLifecycleFailure(logFn, {
      stage: "roadmap_validation_started",
      projectId,
      model: structured.model || model,
      reasoningEffort: policy.reasoningEffort,
      error,
    });
    return { ok: false, reason: "provider_error" };
  }
}
