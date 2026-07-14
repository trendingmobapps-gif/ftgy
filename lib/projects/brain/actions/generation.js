import {
  supportsCustomSampling,
} from "../../../../tools/generation-policy.js";
import { PROJECT_ACTION_LIMITS } from "./constants.js";
import { buildExecutionPrompt } from "./prompt-builder.js";
import { logExecuteStage } from "./execute-action-stage-log.js";
import { logProjectModelUsage, resolveProjectModelRuntimePolicy } from "../project-model-policy.js";
import { classifyOpenAiOperationComplexity } from "../openai-operation-complexity.js";
import { PROJECT_MODEL_ROLES } from "../project-model-policy.js";
import {
  createOperationBudgetTracker,
  evaluateOperationBudget,
  buildOpenAiRequestMetadata,
} from "../openai-cost-guards.js";
import { logOpenAiUsageEvent } from "../openai-usage-observability.js";
import { buildResultGenerationOperationContext } from "../strategic-result-intent.js";

function extractResponseText(data) {
  if (!data || typeof data !== "object") return "";

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data.output)) {
    const text = data.output
      .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
      .map((block) => {
        if (block?.type === "output_text" && typeof block.text === "string") return block.text;
        if (typeof block?.text === "string") return block.text;
        return "";
      })
      .join("")
      .trim();
    if (text) return text;
  }

  const chat = data?.choices?.[0]?.message?.content;
  if (typeof chat === "string" && chat.trim()) return chat.trim();

  return "";
}

function buildResponsesMetadata(data) {
  const output = Array.isArray(data?.output) ? data.output : [];
  const providerStatus = data?.status || null;
  const incompleteReason = data?.incomplete_details?.reason || null;
  return {
    responseId: data?.id || null,
    model: data?.model || null,
    status: providerStatus,
    providerStatus,
    outputItemCount: output.length,
    outputTextExists: Boolean(extractResponseText(data)),
    incompleteReason,
    requiresContinuation: providerStatus === "incomplete",
  };
}

function resolveExecutionRuntimePolicy(preparation = {}, operationContext = {}) {
  const strategicContext = buildResultGenerationOperationContext({
    executionPlan: operationContext.executionPlan || null,
    resultIntent: operationContext.resultIntent || null,
    outputLabel: operationContext.outputLabel || null,
    revisionContext: operationContext.revisionContext || {},
    projectId: operationContext.projectId || null,
    usageState: {
      projectCreationFrontierCalls: operationContext.projectFrontierCallCount,
      actionDesignFrontierCalls: operationContext.actionFrontierCallCount,
    },
  });

  const mergedContext = {
    ...operationContext,
    ...strategicContext,
  };

  const classified = classifyOpenAiOperationComplexity({
    role: PROJECT_MODEL_ROLES.resultGeneration,
    operationContext: mergedContext,
  });

  return resolveProjectModelRuntimePolicy({
    role: PROJECT_MODEL_ROLES.resultGeneration,
    complexity: classified,
    operationContext: {
      ...mergedContext,
      strategicOutput:
        mergedContext.strategicOutput === true ||
        classified.level === "complex" ||
        classified.level === "exceptional",
    },
  });
}

function resolveExecutionModels(preparation = {}, operationContext = {}) {
  const runtimePolicy = resolveExecutionRuntimePolicy(preparation, operationContext);
  const models = [runtimePolicy.model, ...(runtimePolicy.allowedFallbackModels || [])]
    .filter(Boolean)
    .filter((model, index, list) => list.indexOf(model) === index)
    .slice(0, 2);
  return {
    models,
    runtimePolicy,
  };
}

async function requestContinuation({
  fetchImpl,
  apiKey,
  model,
  systemPrompt,
  partialText,
  incompleteReason,
  controller,
  config,
}) {
  const continuationPrompt = `Continuă exact de unde ai rămas. Nu repeta conținutul deja generat. Motiv întrerupere: ${incompleteReason || "incomplete"}.`;

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: systemPrompt,
      input: [
        { role: "user", content: partialText },
        { role: "user", content: continuationPrompt },
      ],
      max_output_tokens: config.maxOutputTokens,
      ...(supportsCustomSampling(model) ? { temperature: config.temperature, top_p: 0.9 } : {}),
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const continuationText = extractResponseText(data);
  if (!continuationText) {
    return null;
  }

  return {
    text: `${partialText}\n\n${continuationText}`.trim(),
    metadata: buildResponsesMetadata(data),
  };
}

export async function executePreparedAction({
  preparation,
  acceptedInput = {},
  fetchImpl = fetch,
  logFn = logExecuteStage,
  systemPromptOverride = null,
  apiKey = process.env.OPENAI_API_KEY || "",
  operationContext = {},
  projectFrontierCallCount = 0,
  actionFrontierCallCount = 0,
}) {
  if (!apiKey) {
    return { ok: false, reason: "missing_api_key" };
  }

  const prompt = buildExecutionPrompt({ preparation, acceptedInput });
  const systemPrompt = systemPromptOverride || prompt.systemPrompt;
  const userPrompt = prompt.userPrompt;
  const { models, runtimePolicy } = resolveExecutionModels(preparation, operationContext);
  const config = {
    maxOutputTokens: runtimePolicy.maxOutputTokens,
    temperature: 0.35,
  };
  const budgetTracker = createOperationBudgetTracker({
    maxTotalTokensPerOperation: runtimePolicy.maxTotalTokensPerOperation,
  });
  const requestMetadata = buildOpenAiRequestMetadata({
    role: PROJECT_MODEL_ROLES.resultGeneration,
    projectId: operationContext.projectId || null,
    liveTest: process.env.OPENAI_LIVE_TESTS === "1",
  });
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROJECT_ACTION_LIMITS.generationTimeoutMs);

  const budgetGate = evaluateOperationBudget({
    runtimePolicy,
    tracker: budgetTracker,
    frontierCallCount: projectFrontierCallCount,
    actionFrontierCallCount,
    budgetScope: "action",
  });
  if (!budgetGate.allowed) {
    return { ok: false, reason: "budget_exceeded", internalErrorCode: budgetGate.internalErrorCode };
  }

  logProjectModelUsage(logFn, {
    operation: runtimePolicy.role,
    role: runtimePolicy.role,
    model: models[0],
    selectedModelTier: runtimePolicy.modelTier,
    configuredReasoningEffort: runtimePolicy.configuredReasoningEffort,
    providerReasoningEffort: runtimePolicy.providerReasoningEffort,
    complexityLevel: runtimePolicy.complexityLevel,
    maxOutputTokens: runtimePolicy.maxOutputTokens,
    escalationUsed: runtimePolicy.escalationUsed,
  });

  logFn("openai_request_started", {
    model: models[0],
    transport: "responses",
    timeoutMs: PROJECT_ACTION_LIMITS.generationTimeoutMs,
    reasoningEffort: runtimePolicy.providerReasoningEffort,
    operation: runtimePolicy.role,
    role: runtimePolicy.role,
    selectedModelTier: runtimePolicy.modelTier,
  });

  try {
    let responsesStatus = null;
    let responsesMetadata = null;

    const responses = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Iter-Metadata": JSON.stringify(requestMetadata),
      },
      body: JSON.stringify({
        model: models[0],
        instructions: systemPrompt,
        input: [{ role: "user", content: userPrompt }],
        max_output_tokens: config.maxOutputTokens,
        ...(supportsCustomSampling(models[0])
          ? { temperature: config.temperature, top_p: 0.9 }
          : {}),
      }),
      signal: controller.signal,
    });

    responsesStatus = responses.status;

    if (responses.ok) {
      const data = await responses.json();
      responsesMetadata = buildResponsesMetadata(data);
      let text = extractResponseText(data);

      if (text && responsesMetadata.requiresContinuation) {
        const continuation = await requestContinuation({
          fetchImpl,
          apiKey,
          model: models[0],
          systemPrompt,
          partialText: text,
          incompleteReason: responsesMetadata.incompleteReason,
          controller,
          config,
        });

        if (continuation?.text) {
          text = continuation.text;
          responsesMetadata = {
            ...responsesMetadata,
            ...continuation.metadata,
            continuedFromIncomplete: true,
            requiresContinuation: continuation.metadata?.requiresContinuation ?? false,
          };
        }
      }

      if (text) {
        logFn("openai_response_received", {
          ...responsesMetadata,
          latencyMs: Date.now() - started,
          transport: "responses",
          parsedJsonExists: false,
          refusalExists: false,
          contentLength: text.length,
        });
        return {
          ok: true,
          text,
          model: data.model || models[0],
          transport: "responses",
          providerStatus: responsesMetadata.providerStatus,
          incompleteReason: responsesMetadata.incompleteReason,
          requiresContinuation: responsesMetadata.requiresContinuation,
          continuedFromIncomplete: Boolean(responsesMetadata.continuedFromIncomplete),
        };
      }
    }

    for (const model of models.slice(1)) {
      const chatResponse = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          ...(supportsCustomSampling(model)
            ? { temperature: config.temperature, top_p: 0.9 }
            : {}),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!chatResponse.ok) {
        continue;
      }

      const chatData = await chatResponse.json();
      const text = extractResponseText(chatData);
      if (!text) {
        continue;
      }

      logFn("openai_response_received", {
        responseId: chatData.id || null,
        model: chatData.model || model,
        latencyMs: Date.now() - started,
        transport: "chat_completions",
        outputTextExists: true,
        parsedJsonExists: false,
        providerHttpStatus: chatResponse.status,
        responsesHttpStatus: responsesStatus,
        operation: runtimePolicy.role,
        role: runtimePolicy.role,
        reasoningEffort: runtimePolicy.providerReasoningEffort,
        selectedModelTier: runtimePolicy.modelTier,
        fallbackUsed: true,
      });

      return {
        ok: true,
        text,
        model: chatData.model || model,
        transport: "chat_completions",
        usedFallback: true,
      };
    }

    logFn("openai_response_received", {
      latencyMs: Date.now() - started,
      transport: "responses",
      outputTextExists: false,
      providerHttpStatus: responsesStatus,
      incompleteReason: responsesMetadata?.incompleteReason || "upstream_error",
    });

    return {
      ok: false,
      reason: "provider_error",
      httpStatus: responsesStatus,
      metadata: responsesMetadata,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "provider_error", error };
  } finally {
    clearTimeout(timeout);
  }
}
