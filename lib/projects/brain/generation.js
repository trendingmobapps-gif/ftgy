import {
  PROJECT_BRAIN_LIMITS,
  PROJECT_BRAIN_VERSION,
} from "./constants.js";
import { buildProjectBrainJsonSchema, buildProjectBrainSystemPrompt } from "./schema.js";
import { callProjectStructuredJson } from "./openai-project-client.js";
import { resolveProjectModelPolicy } from "./project-model-policy.js";
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
  model = resolveProjectModelPolicy("roadmap").model,
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

  const structured = await callProjectStructuredJson({
    operation: "roadmap",
    systemPrompt,
    userPrompt: userLines.join("\n\n"),
    jsonSchema: buildProjectBrainJsonSchema(),
    fetchImpl,
    apiKey,
    timeoutMs,
  });

  if (!structured.ok) {
    return { ok: false, reason: structured.reason || "provider_error" };
  }

  const parsed = structured.parsed;
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "invalid_provider_response" };
  }

  try {
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
      model: structured.model || model,
      transport: structured.transport || "responses",
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "provider_error" };
  }
}
