import { randomUUID } from "node:crypto";

import {
  classifyOpenAiAbortError,
  classifyOpenAiHttpError,
  classifyOpenAiNetworkError,
  isNonRetryableOpenAiError,
  mapInternalOpenAiReason,
} from "./openai-error-classification.js";
import { OPENAI_INTERNAL_ERROR_CODES } from "./openai-error-codes.js";
import { resolveExceptionalReasonCode } from "./openai-reasoning-effort.js";
import { extractOpenAiUsage, logOpenAiUsageEvent } from "./openai-usage-observability.js";
import {
  createOperationBudgetTracker,
  evaluateOperationBudget,
  recordOperationTokenUsage,
  buildOpenAiRequestMetadata,
} from "./openai-cost-guards.js";
import { resolveRepairRole, canAttemptModelRepair } from "./openai-repair-policy.js";
import { PROJECT_MODEL_INTERNAL_CODES } from "./project-model-internal-codes.js";
import {
  resolveProjectModelRuntimePolicy,
  resolveRuntimeRoleFromLegacyOperation,
  resolveProjectModelPolicy,
} from "./project-model-policy.js";
import { extractStructuredJsonFromProviderPayload } from "./roadmap-response.js";

function resolveChatFallbackModel(policyModel, runtimePolicy) {
  if (runtimePolicy?.allowedFallbackModels?.length) {
    return runtimePolicy.allowedFallbackModels[0];
  }
  const configured = process.env.PROJECT_ROADMAP_FALLBACK_MODEL?.trim();
  const legacy = process.env.PROJECT_BRAIN_MODEL?.trim();
  const candidates = [configured, legacy, "gpt-4.1"].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate !== policyModel) {
      return candidate;
    }
  }
  return "gpt-4.1";
}

function extractChatJson(data) {
  const content = data?.choices?.[0]?.message?.content || "";
  if (!content.trim()) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildResponsesMetadata(data) {
  const extracted = extractStructuredJsonFromProviderPayload(data);
  return {
    responseId: extracted.metadata.responseId,
    model: extracted.metadata.model,
    status: extracted.metadata.status,
    outputItemCount: extracted.metadata.outputItemCount,
    outputTextExists: extracted.metadata.outputTextExists,
    parsedJsonExists: extracted.metadata.parsedJsonExists,
    refusalExists: extracted.metadata.refusalExists,
    incompleteReason: extracted.metadata.incompleteReason,
  };
}

function buildFailureResult({
  reason,
  internalErrorCode,
  httpStatus = null,
  metadata = null,
  fallbackAttempted = false,
  providerCallCount = 0,
  repairUsed = false,
}) {
  return {
    ok: false,
    reason: mapInternalOpenAiReason(reason, internalErrorCode),
    internalErrorCode,
    httpStatus,
    metadata,
    fallbackAttempted,
    providerCallCount,
    repairUsed,
  };
}

async function postResponsesRequest({
  fetchImpl,
  apiKey,
  model,
  providerReasoningEffort,
  maxOutputTokens,
  systemPrompt,
  userPrompt,
  jsonSchema,
  signal,
  requestMetadata = null,
}) {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(requestMetadata ? { "X-Iter-Metadata": JSON.stringify(requestMetadata) } : {}),
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: providerReasoningEffort },
      max_output_tokens: maxOutputTokens,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: jsonSchema.name,
          schema: jsonSchema.schema,
          strict: jsonSchema.strict !== false,
        },
      },
    }),
    signal,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { response, data };
}

async function postChatRequest({
  fetchImpl,
  apiKey,
  model,
  maxOutputTokens,
  systemPrompt,
  userPrompt,
  jsonSchema,
  signal,
}) {
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxOutputTokens,
      response_format: {
        type: "json_schema",
        json_schema: jsonSchema,
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    signal,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { response, data };
}

function evaluateParsedResult(parsed, validateParsed) {
  if (typeof validateParsed !== "function") {
    return { ok: true, value: parsed };
  }

  const validation = validateParsed(parsed);
  if (validation?.ok) {
    return { ok: true, value: validation.value ?? parsed };
  }

  return {
    ok: false,
    reason: validation?.reason || "invalid_response",
  };
}

function logAttempt(logFn, input) {
  logOpenAiUsageEvent(logFn, input);
}

export async function callProjectStructuredJson({
  operation = "executionPlan",
  role = null,
  systemPrompt,
  userPrompt,
  jsonSchema,
  fetchImpl = fetch,
  apiKey = process.env.OPENAI_API_KEY || "",
  timeoutMs = 50_000,
  logFn = null,
  projectId = null,
  stepId = null,
  actionId = null,
  complexity = "standard",
  reasonCode = null,
  validateParsed = null,
  buildRepairUserPrompt = null,
  operationContext = {},
  projectFrontierCallCount = 0,
  actionFrontierCallCount = 0,
}) {
  if (!apiKey) {
    return buildFailureResult({
      reason: "missing_api_key",
      internalErrorCode: OPENAI_INTERNAL_ERROR_CODES.INVALID_REQUEST,
    });
  }

  const resolvedRole =
    role || resolveRuntimeRoleFromLegacyOperation(operation, complexity);
  const runtimePolicy = resolveProjectModelRuntimePolicy({
    role: resolvedRole,
    complexity: {
      level: complexity,
      reasonCode:
        reasonCode ||
        resolveExceptionalReasonCode({
          complexity,
          highStakes: complexity === "exceptional",
        }),
    },
    operationContext: {
      ...operationContext,
      reasonCode,
    },
  });
  const maxOutputTokens = runtimePolicy.maxOutputTokens;
  const logicalOperationId = randomUUID();
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const budgetTracker = createOperationBudgetTracker({
    maxTotalTokensPerOperation: runtimePolicy.maxTotalTokensPerOperation,
  });
  const requestMetadata = buildOpenAiRequestMetadata({
    role: resolvedRole,
    projectId,
    liveTest: process.env.OPENAI_LIVE_TESTS === "1",
  });

  let providerCallCount = 0;
  let repairUsed = false;
  let repairRole = null;
  let lastInternalErrorCode = null;
  let lastMetadata = null;
  let activeRuntimePolicy = runtimePolicy;

  const emitUsage = ({
    attempt,
    model,
    transport,
    payload,
    success,
    fallbackUsed = false,
    fallbackReason = null,
    internalErrorCode = null,
    latencyMs = Date.now() - started,
    policy = activeRuntimePolicy,
    repairRoleUsed = repairRole,
  }) => {
    const usage = extractOpenAiUsage(payload);
    recordOperationTokenUsage(budgetTracker, usage);
    const budget = evaluateOperationBudget({
      runtimePolicy: policy,
      tracker: budgetTracker,
      frontierCallCount: projectFrontierCallCount + (policy.modelTier === "frontier" ? providerCallCount : 0),
      actionFrontierCallCount: actionFrontierCallCount + (policy.modelTier === "frontier" ? providerCallCount : 0),
    });
    logAttempt(logFn, {
      operation,
      role: resolvedRole,
      model,
      selectedModelTier: policy.modelTier,
      configuredReasoningEffort: policy.configuredReasoningEffort,
      providerReasoningEffort: policy.providerReasoningEffort,
      complexity: policy.complexityLevel,
      complexityLevel: policy.complexityLevel,
      complexitySignalsCount: policy.complexitySignalsCount,
      highReasonCode: policy.highReasonCode,
      maxOutputTokens,
      maxTotalTokensPerOperation: policy.maxTotalTokensPerOperation,
      attempt,
      fallbackUsed,
      fallbackReason,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
      latencyMs,
      success,
      internalErrorCode,
      projectId,
      stepId,
      actionId,
      transport,
      providerCallCount,
      logicalOperationId,
      operationBudgetStatus: budget.operationBudgetStatus,
      projectFrontierCallCount,
      actionFrontierCallCount,
      repairRole: repairRoleUsed,
      escalationUsed: policy.escalationUsed,
      evidenceHash: operationContext.evidenceHash || null,
    });
  };

  try {
    const budgetScope =
      runtimePolicy?.role === "roadmap" ? "project_creation" : "action";
    const budgetGate = evaluateOperationBudget({
      runtimePolicy,
      tracker: budgetTracker,
      frontierCallCount: projectFrontierCallCount,
      actionFrontierCallCount,
      budgetScope,
    });
    if (!budgetGate.allowed) {
      return buildFailureResult({
        reason: "budget_exceeded",
        internalErrorCode: budgetGate.internalErrorCode || PROJECT_MODEL_INTERNAL_CODES.OPERATION_BUDGET_EXCEEDED,
        providerCallCount: 0,
      });
    }

    const runAttempt = async ({ attempt, userPromptForAttempt, useChatFallback = false, policy = activeRuntimePolicy }) => {
      providerCallCount += 1;

      if (useChatFallback) {
        const chatModel = resolveChatFallbackModel(policy.model, policy);
        const { response, data } = await postChatRequest({
          fetchImpl,
          apiKey,
          model: chatModel,
          maxOutputTokens,
          systemPrompt,
          userPrompt: userPromptForAttempt,
          jsonSchema,
          signal: controller.signal,
        });

        if (!response.ok) {
          const classified = classifyOpenAiHttpError({
            httpStatus: response.status,
            errorBody: data,
          });
          lastInternalErrorCode = classified.code;
          emitUsage({
            attempt,
            model: chatModel,
            transport: "chat_completions",
            payload: data,
            success: false,
            fallbackUsed: true,
            fallbackReason: "responses_unavailable",
            internalErrorCode: classified.code,
          });
          return { ok: false, classified, metadata: null, parsed: null, model: chatModel };
        }

        const parsed = extractChatJson(data);
        emitUsage({
          attempt,
          model: data?.model || chatModel,
          transport: "chat_completions",
          payload: data,
          success: Boolean(parsed),
          fallbackUsed: true,
          fallbackReason: "responses_unavailable",
          internalErrorCode: parsed ? null : OPENAI_INTERNAL_ERROR_CODES.INVALID_RESPONSE,
        });

        return {
          ok: Boolean(parsed),
          parsed,
          model: data?.model || chatModel,
          transport: "chat_completions",
          metadata: {
            responseId: data?.id || null,
            model: data?.model || chatModel,
            parsedJsonExists: Boolean(parsed),
          },
        };
      }

      const { response, data } = await postResponsesRequest({
        fetchImpl,
        apiKey,
        model: policy.model,
        providerReasoningEffort: policy.providerReasoningEffort,
        maxOutputTokens: policy.maxOutputTokens,
        systemPrompt,
        userPrompt: userPromptForAttempt,
        jsonSchema,
        signal: controller.signal,
        requestMetadata,
      });

      const metadata = data ? buildResponsesMetadata(data) : null;
      lastMetadata = metadata;

      if (!response.ok) {
        const classified = classifyOpenAiHttpError({
          httpStatus: response.status,
          errorBody: data,
        });
        lastInternalErrorCode = classified.code;
        emitUsage({
          attempt,
          model: runtimePolicy.model,
          transport: "responses",
          payload: data,
          success: false,
          internalErrorCode: classified.code,
          policy,
        });
        return { ok: false, classified, metadata, parsed: null, model: policy.model };
      }

      if (metadata?.incompleteReason === "max_output_tokens") {
        const classified = classifyOpenAiHttpError({
          httpStatus: response.status,
          errorBody: data,
          incompleteReason: metadata.incompleteReason,
        });
        lastInternalErrorCode = classified.code;
        emitUsage({
          attempt,
          model: data?.model || policy.model,
          transport: "responses",
          payload: data,
          success: false,
          internalErrorCode: classified.code,
          policy,
        });
        return { ok: false, classified, metadata, parsed: null, model: data?.model || policy.model };
      }

      const extracted = extractStructuredJsonFromProviderPayload(data);
      const parsed = extracted.parsed;
      emitUsage({
        attempt,
        model: data?.model || policy.model,
        transport: "responses",
        payload: data,
        success: Boolean(parsed),
        internalErrorCode: parsed ? null : OPENAI_INTERNAL_ERROR_CODES.INVALID_RESPONSE,
        policy,
      });

      return {
        ok: Boolean(parsed),
        parsed,
        model: data?.model || policy.model,
        transport: "responses",
        metadata: extracted.metadata,
      };
    };

    const first = await runAttempt({ attempt: 1, userPromptForAttempt: userPrompt });
    if (first.ok && first.parsed) {
      const validated = evaluateParsedResult(first.parsed, validateParsed);
      if (validated.ok) {
        return {
          ok: true,
          parsed: validated.value,
          model: first.model,
          transport: first.transport,
          metadata: first.metadata,
          providerCallCount,
          repairUsed,
          runtimePolicy,
          maxOutputTokens,
        };
      }
    }

    if (first.classified && isNonRetryableOpenAiError(first.classified.code)) {
      return buildFailureResult({
        reason: "upstream",
        internalErrorCode: first.classified.code,
        metadata: first.metadata || lastMetadata,
        fallbackAttempted: false,
        providerCallCount,
        repairUsed: false,
      });
    }

    const firstValidationFailed = Boolean(first.ok && first.parsed && typeof validateParsed === "function");
    const nonRetryableProviderFailure = Boolean(
      first.classified && isNonRetryableOpenAiError(first.classified.code),
    );
    const canRepair =
      !nonRetryableProviderFailure &&
      providerCallCount < runtimePolicy.maxProviderCalls &&
      runtimePolicy.maxRepairCalls > 0 &&
      (firstValidationFailed ||
        first.classified?.retryable === true ||
        (first.ok && !first.parsed) ||
        (!first.ok && !first.classified));

    if (canRepair) {
      repairUsed = true;
      repairRole = resolveRepairRole({
        originalRole: resolvedRole,
        failureKind: firstValidationFailed ? "validation_failed" : "malformed_json",
        complexity: runtimePolicy.complexityLevel,
      });
      activeRuntimePolicy = resolveProjectModelRuntimePolicy({
        role: repairRole,
        complexity: { level: "standard" },
        operationContext,
      });
      const repairPrompt =
        typeof buildRepairUserPrompt === "function"
          ? buildRepairUserPrompt(firstValidationFailed ? "validation_failed" : first.classified?.code || "invalid")
          : `${userPrompt}\n\nRepară JSON-ul anterior astfel încât să respecte schema.`;

      const retryTransient = Boolean(!first.ok && first.classified?.retryable);
      const useChatFallback = Boolean(!first.ok && !retryTransient && !firstValidationFailed);
      const secondPrompt = firstValidationFailed || !retryTransient ? repairPrompt : userPrompt;

      const second = await runAttempt({
        attempt: 2,
        userPromptForAttempt: secondPrompt,
        useChatFallback,
        policy: activeRuntimePolicy,
      });

      if (second.ok && second.parsed) {
        const validated = evaluateParsedResult(second.parsed, validateParsed);
        if (validated.ok) {
          return {
            ok: true,
            parsed: validated.value,
            model: second.model,
            transport: second.transport,
            metadata: second.metadata,
            providerCallCount,
            repairUsed: true,
            runtimePolicy,
            maxOutputTokens,
          };
        }
      }

      return buildFailureResult({
        reason: "upstream",
        internalErrorCode: OPENAI_INTERNAL_ERROR_CODES.REPAIR_FAILED,
        metadata: second.metadata || first.metadata || lastMetadata,
        fallbackAttempted: Boolean(second.transport === "chat_completions"),
        providerCallCount,
        repairUsed: true,
      });
    }

    if (first.classified) {
      return buildFailureResult({
        reason: "upstream",
        internalErrorCode: first.classified.code,
        metadata: first.metadata || lastMetadata,
        fallbackAttempted: false,
        providerCallCount,
        repairUsed,
      });
    }

    return buildFailureResult({
      reason: "upstream",
      internalErrorCode: lastInternalErrorCode || OPENAI_INTERNAL_ERROR_CODES.INVALID_RESPONSE,
      metadata: first.metadata || lastMetadata,
      fallbackAttempted: false,
      providerCallCount,
      repairUsed,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const classified = classifyOpenAiAbortError();
      logAttempt(logFn, {
        operation: runtimePolicy.operation,
        model: runtimePolicy.model,
        configuredReasoningEffort: runtimePolicy.configuredReasoningEffort,
        providerReasoningEffort: runtimePolicy.providerReasoningEffort,
        complexity: runtimePolicy.complexity,
        maxOutputTokens,
        attempt: providerCallCount + 1,
        success: false,
        internalErrorCode: classified.code,
        projectId,
        stepId,
        actionId,
        providerCallCount,
        logicalOperationId,
      });
      return buildFailureResult({
        reason: "timeout",
        internalErrorCode: classified.code,
        fallbackAttempted: providerCallCount > 1,
        providerCallCount,
        repairUsed,
      });
    }

    const classified = classifyOpenAiNetworkError();
    return buildFailureResult({
      reason: "network",
      internalErrorCode: classified.code,
      fallbackAttempted: providerCallCount > 1,
      providerCallCount,
      repairUsed,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveProjectModelPolicyForTests(operation) {
  return resolveProjectModelPolicy(operation);
}
