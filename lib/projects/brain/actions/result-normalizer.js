import { PROJECT_ACTION_LIMITS } from "./constants.js";
import { buildResultPreview, buildResultTitle } from "./prompt-builder.js";

function trimText(value, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function jsonSafeClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeActionResultPayload({
  raw,
  step,
  project,
  resultType = "text",
  outputType = "text",
}) {
  const title = trimText(raw?.title || buildResultTitle({ step, project }), 300);
  const content = trimText(raw?.content, PROJECT_ACTION_LIMITS.maxContentChars);
  const structuredData =
    raw?.structuredData && typeof raw.structuredData === "object" && !Array.isArray(raw.structuredData)
      ? jsonSafeClone(raw.structuredData)
      : undefined;

  if (!title) {
    return { ok: false, reason: "missing_title" };
  }

  if (!content && !structuredData) {
    return { ok: false, reason: "missing_content" };
  }

  const preview = trimText(raw?.preview || buildResultPreview(content || JSON.stringify(structuredData)), PROJECT_ACTION_LIMITS.maxPreviewChars);

  const payload = {
    type: outputType || resultType || "text",
    title,
    content: content || undefined,
    structuredData,
    preview,
    metadata: raw?.metadata && typeof raw.metadata === "object" ? jsonSafeClone(raw.metadata) : undefined,
  };

  try {
    JSON.stringify(payload);
  } catch {
    return { ok: false, reason: "not_json_serializable" };
  }

  return {
    ok: true,
    payload,
    resultType: resultType || "text",
    title,
    preview,
    content: content || preview,
    structuredData,
  };
}
