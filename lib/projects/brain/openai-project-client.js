import { logProjectModelUsage, resolveProjectModelPolicy } from "./project-model-policy.js";

function extractResponsesText(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (block?.type === "output_text" && typeof block.text === "string") {
        return block.text;
      }
      if (typeof block?.text === "string") return block.text;
    }
  }
  return null;
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

export async function callProjectStructuredJson({
  operation = "executionPlan",
  systemPrompt,
  userPrompt,
  jsonSchema,
  fetchImpl = fetch,
  apiKey = process.env.OPENAI_API_KEY || "",
  timeoutMs = 50_000,
  logFn = null,
}) {
  if (!apiKey) {
    return { ok: false, reason: "missing_api_key" };
  }

  const policy = resolveProjectModelPolicy(operation);
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: policy.model,
        reasoning: { effort: policy.reasoningEffort },
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

    if (response.ok) {
      const data = await response.json();
      const text = extractResponsesText(data);
      if (text) {
        try {
          const parsed = JSON.parse(text);
          logProjectModelUsage(logFn, {
            operation: policy.operation,
            model: policy.model,
            reasoningEffort: policy.reasoningEffort,
            latencyMs: Date.now() - started,
            usedFallback: false,
          });
          return { ok: true, parsed, model: policy.model, transport: "responses" };
        } catch {
          // fall through to chat fallback
        }
      }
    }

    const chatResponse = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: policy.model,
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

    if (!chatResponse.ok) {
      logProjectModelUsage(logFn, {
        operation: policy.operation,
        model: policy.model,
        reasoningEffort: policy.reasoningEffort,
        latencyMs: Date.now() - started,
        usedFallback: true,
        fallbackReason: "upstream_error",
      });
      return { ok: false, reason: "upstream" };
    }

    const chatData = await chatResponse.json();
    const parsed = extractChatJson(chatData);
    if (!parsed) {
      return { ok: false, reason: "invalid_json" };
    }

    logProjectModelUsage(logFn, {
      operation: policy.operation,
      model: policy.model,
      reasoningEffort: policy.reasoningEffort,
      latencyMs: Date.now() - started,
      usedFallback: true,
      fallbackReason: "responses_unavailable",
    });
    return { ok: true, parsed, model: policy.model, transport: "chat_completions" };
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timeout);
  }
}
