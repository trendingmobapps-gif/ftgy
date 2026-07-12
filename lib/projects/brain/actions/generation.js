import { resolveGenerationConfig,
  supportsCustomSampling,
} from "../../../../tools/generation-policy.js";
import { PROJECT_ACTION_LIMITS } from "./constants.js";
import { buildExecutionPrompt } from "./prompt-builder.js";

function extractResponseText(data) {
  if (!data || typeof data !== "object") return "";

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data.output)) {
    const text = data.output
      .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }

  const chat = data?.choices?.[0]?.message?.content;
  if (typeof chat === "string" && chat.trim()) return chat.trim();

  return "";
}

export async function executePreparedAction({ preparation, acceptedInput = {}, fetchImpl = fetch }) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    return { ok: false, reason: "missing_api_key" };
  }

  const { systemPrompt, userPrompt } = buildExecutionPrompt({ preparation, acceptedInput });
  const config = resolveGenerationConfig({
    toolId: preparation.capabilityRef || "project-action",
    categorySlug: preparation.context?.project?.categorySlug || "business",
  });

  const body = {
    model: config.models[0],
    instructions: systemPrompt,
    input: userPrompt,
    max_output_tokens: config.maxOutputTokens,
  };

  if (supportsCustomSampling(body.model)) {
    body.temperature = config.temperature;
    body.top_p = 0.9;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROJECT_ACTION_LIMITS.generationTimeoutMs);

  try {
    const resp = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      return { ok: false, reason: "provider_error" };
    }

    const data = await resp.json();
    const text = extractResponseText(data);
    if (!text) {
      return { ok: false, reason: "empty_response" };
    }

    return { ok: true, text, model: body.model };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "provider_error" };
  } finally {
    clearTimeout(timeout);
  }
}
