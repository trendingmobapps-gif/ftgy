import {
  resolveGenerationConfig,
  supportsCustomSampling,
} from "../../../../tools/generation-policy.js";
import { PROJECT_ACTION_LIMITS } from "./constants.js";
import { buildExecutionPrompt } from "./prompt-builder.js";
import { logExecuteStage } from "./execute-action-stage-log.js";

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
  return {
    responseId: data?.id || null,
    model: data?.model || null,
    status: data?.status || null,
    outputItemCount: output.length,
    outputTextExists: Boolean(extractResponseText(data)),
    incompleteReason: data?.incomplete_details?.reason || data?.status || null,
  };
}

export async function executePreparedAction({
  preparation,
  acceptedInput = {},
  fetchImpl = fetch,
  logFn = logExecuteStage,
  systemPromptOverride = null,
  apiKey = process.env.OPENAI_API_KEY || "",
}) {
  if (!apiKey) {
    return { ok: false, reason: "missing_api_key" };
  }

  const prompt = buildExecutionPrompt({ preparation, acceptedInput });
  const systemPrompt = systemPromptOverride || prompt.systemPrompt;
  const userPrompt = prompt.userPrompt;
  const config = resolveGenerationConfig(preparation.capabilityRef || "project-action");
  const models = Array.isArray(config.models) ? config.models : ["gpt-4.1"];
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROJECT_ACTION_LIMITS.generationTimeoutMs);

  logFn("openai_request_started", {
    model: models[0],
    transport: "responses",
    timeoutMs: PROJECT_ACTION_LIMITS.generationTimeoutMs,
    reasoningEffort: null,
  });

  try {
    let responsesStatus = null;
    let responsesMetadata = null;

    const responses = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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
      const text = extractResponseText(data);
      if (text) {
        logFn("openai_response_received", {
          ...responsesMetadata,
          latencyMs: Date.now() - started,
          transport: "responses",
          parsedJsonExists: false,
          refusalExists: false,
        });
        return { ok: true, text, model: data.model || models[0], transport: "responses" };
      }
    }

    for (const model of models) {
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
