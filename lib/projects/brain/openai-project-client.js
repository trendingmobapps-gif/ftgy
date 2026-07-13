import { logProjectModelUsage, resolveProjectModelPolicy } from "./project-model-policy.js";
import { extractStructuredJsonFromProviderPayload } from "./roadmap-response.js";

const REASONING_EFFORT_API_MAP = {
  max: "high",
  xhigh: "high",
  high: "high",
  medium: "medium",
  low: "low",
  minimal: "minimal",
};

function normalizeReasoningEffort(effort) {
  if (!effort) return "high";
  return REASONING_EFFORT_API_MAP[effort] || effort;
}

function resolveChatFallbackModels(policyModel) {
  const configured = process.env.PROJECT_ROADMAP_FALLBACK_MODEL?.trim();
  const legacy = process.env.PROJECT_BRAIN_MODEL?.trim();
  const models = [policyModel, configured, legacy, "gpt-4.1"].filter(Boolean);
  return [...new Set(models)];
}

function extractResponsesText(payload) {
  return extractStructuredJsonFromProviderPayload(payload).outputText;
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

export async function callProjectStructuredJson({
  operation = "executionPlan",
  systemPrompt,
  userPrompt,
  jsonSchema,
  fetchImpl = fetch,
  apiKey = process.env.OPENAI_API_KEY || "",
  timeoutMs = 50_000,
  logFn = null,
  projectId = null,
}) {
  if (!apiKey) {
    return { ok: false, reason: "missing_api_key" };
  }

  const policy = resolveProjectModelPolicy(operation);
  const reasoningEffort = normalizeReasoningEffort(policy.reasoningEffort);
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let responsesHttpStatus = null;
  let responsesMetadata = null;
  let usedResponsesFallback = false;

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: policy.model,
        reasoning: { effort: reasoningEffort },
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
      signal: controller.signal,
    });

    responsesHttpStatus = response.status;

    if (response.ok) {
      const data = await response.json();
      responsesMetadata = buildResponsesMetadata(data);
      const extracted = extractStructuredJsonFromProviderPayload(data);
      if (extracted.parsed) {
        logProjectModelUsage(logFn, {
          operation: policy.operation,
          model: policy.model,
          reasoningEffort: policy.reasoningEffort,
          latencyMs: Date.now() - started,
          usedFallback: false,
        });
        return {
          ok: true,
          parsed: extracted.parsed,
          model: policy.model,
          transport: "responses",
          metadata: extracted.metadata,
        };
      }
      usedResponsesFallback = true;
    } else {
      usedResponsesFallback = true;
      try {
        const errorBody = await response.json();
        responsesMetadata = {
          providerStatus: errorBody?.error?.type || null,
          incompleteReason: errorBody?.error?.message || null,
        };
      } catch {
        responsesMetadata = { incompleteReason: `http_${response.status}` };
      }
    }

    const chatModels = resolveChatFallbackModels(policy.model);
    let lastChatStatus = null;

    for (const chatModel of chatModels) {
      const chatResponse = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: chatModel,
          temperature: 0.2,
          response_format: {
            type: "json_schema",
            json_schema: jsonSchema,
          },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      lastChatStatus = chatResponse.status;

      if (!chatResponse.ok) {
        continue;
      }

      const chatData = await chatResponse.json();
      const parsed = extractChatJson(chatData);
      if (!parsed) {
        continue;
      }

      logProjectModelUsage(logFn, {
        operation: policy.operation,
        model: chatModel,
        reasoningEffort: policy.reasoningEffort,
        latencyMs: Date.now() - started,
        usedFallback: true,
        fallbackReason: usedResponsesFallback ? "responses_unavailable" : "chat_retry",
      });

      return {
        ok: true,
        parsed,
        model: chatModel,
        transport: "chat_completions",
        metadata: {
          responseId: chatData.id || null,
          model: chatData.model || chatModel,
          outputTextExists: true,
          parsedJsonExists: true,
          responsesHttpStatus,
          chatHttpStatus: lastChatStatus,
          projectId,
        },
      };
    }

    logProjectModelUsage(logFn, {
      operation: policy.operation,
      model: policy.model,
      reasoningEffort: policy.reasoningEffort,
      latencyMs: Date.now() - started,
      usedFallback: true,
      fallbackReason: "upstream_error",
    });

    return {
      ok: false,
      reason: "upstream",
      httpStatus: lastChatStatus || responsesHttpStatus,
      metadata: responsesMetadata,
      fallbackAttempted: true,
    };
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, reason: "timeout", fallbackAttempted: usedResponsesFallback };
    return { ok: false, reason: "network", fallbackAttempted: usedResponsesFallback };
  } finally {
    clearTimeout(timeout);
  }
}
