import {
  PROJECT_BRAIN_LIMITS,
  PROJECT_BRAIN_MODEL,
  PROJECT_BRAIN_TEMPERATURE,
  PROJECT_BRAIN_VERSION,
} from "./constants.js";
import { buildProjectBrainJsonSchema, buildProjectBrainSystemPrompt } from "./schema.js";
import {
  validateGeneratedWorkflow,
  validateWorkflowSafetyContent,
} from "./validation.js";
import {
  attachResolvedToolsToWorkflow,
  buildToolCatalogSummaryForPrompt,
} from "./tool-resolution.js";

export async function generateProjectWorkflowWithModel({
  project,
  clarificationAnswers,
  fetchImpl = fetch,
  apiKey = process.env.OPENAI_API_KEY,
  model = PROJECT_BRAIN_MODEL,
  timeoutMs = PROJECT_BRAIN_LIMITS.generationTimeoutMs,
}) {
  if (!apiKey) {
    return { ok: false, reason: "missing_api_key" };
  }

  const goal = typeof project.goal === "string" ? project.goal.trim() : "";
  if (!goal || goal.length > PROJECT_BRAIN_LIMITS.maxGoalContextLength) {
    return { ok: false, reason: "invalid_goal_context" };
  }

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: PROJECT_BRAIN_TEMPERATURE,
        response_format: {
          type: "json_schema",
          json_schema: buildProjectBrainJsonSchema(),
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userLines.join("\n\n") },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: "provider_error" };
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return { ok: false, reason: "invalid_provider_response" };
    }

    if (content.length > PROJECT_BRAIN_LIMITS.maxOutputChars) {
      return { ok: false, reason: "output_too_large" };
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }

    const validated = validateGeneratedWorkflow(parsed, { goal });
    if (!validated.ok) {
      return { ok: false, reason: validated.reason || "invalid_output" };
    }

    const withTools = attachResolvedToolsToWorkflow(validated.workflow);
    const safety = validateWorkflowSafetyContent(withTools);
    if (!safety.ok) {
      return { ok: false, reason: safety.reason || "safety_rejected" };
    }

    return {
      ok: true,
      workflow: withTools,
      brainVersion: PROJECT_BRAIN_VERSION,
      model,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "provider_error" };
  } finally {
    clearTimeout(timeout);
  }
}
