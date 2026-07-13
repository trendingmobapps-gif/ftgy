import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildExecutionPrompt } from "../lib/projects/brain/actions/prompt-builder.js";
import { executePreparedAction } from "../lib/projects/brain/actions/generation.js";
import {
  buildRecommendationSelectionResultContent,
  generateActionResult,
} from "../lib/projects/brain/actions/action-result-generator.js";
import { normalizeActionResultPayload } from "../lib/projects/brain/actions/result-normalizer.js";
import { validateExecuteActionRequest, mapActionServiceError } from "../lib/projects/brain/actions/validation.js";
import { PROJECT_ACTION_ERROR_CODES } from "../lib/projects/brain/actions/constants.js";

const step = {
  id: "d17d85f3-3e43-4762-84f5-9b8132f9ff64",
  title: "Elaborare strategie de marketing",
  expected_outcome: "Strategie de canale confirmată",
  description: "Definește canalele digitale și offline.",
};

const project = {
  id: "d2be5daf-45d5-4df6-9ccf-4a317a39dc2f",
  name: "Promovare platformă iterai.ro",
  goal: "Creșterea notorietății iterai.ro",
  category_slug: "business",
};

const recommendationPlan = {
  mode: "recommendation_selection",
  title: "Elaborare strategie de marketing",
  recommendationGroups: [
    {
      id: "digital_channels",
      title: "Canale digitale",
      recommendations: [
        {
          id: "tiktok",
          title: "TikTok",
          explanation: "Viralitate și reach tânăr",
          advantages: ["Viralitate"],
          tradeoffs: ["Necesită conținut constant"],
        },
        {
          id: "linkedin",
          title: "LinkedIn",
          explanation: "B2B și profesioniști",
          advantages: ["Credibilitate"],
          tradeoffs: ["Reach organic limitat"],
        },
      ],
    },
  ],
  selectionRules: { minimumSelections: 1 },
};

describe("projects execute-action generate_resource", () => {
  it("buildExecutionPrompt does not throw when context is missing", () => {
    const prompt = buildExecutionPrompt({
      preparation: {
        preparedPrompt: "Generează strategia",
        capabilityType: "project_brain",
      },
      acceptedInput: {},
    });
    assert.ok(prompt.userPrompt.includes("Generează strategia"));
  });

  it("validateExecuteActionRequest rejects invalid acceptedInput with 400 semantics", () => {
    const result = validateExecuteActionRequest({
      projectId: "d2be5daf-45d5-4df6-9ccf-4a317a39dc2f",
      stepId: "d17d85f3-3e43-4762-84f5-9b8132f9ff64",
      actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      acceptedInput: [],
    });
    assert.equal(result.ok, false);
    assert.ok(result.fields.acceptedInput);
  });

  it("buildRecommendationSelectionResultContent renders confirmed selections", () => {
    const content = buildRecommendationSelectionResultContent({
      plan: recommendationPlan,
      interactive: {
        selectedRecommendations: ["tiktok", "linkedin"],
        priorityOrder: ["linkedin", "tiktok"],
        confirmed: true,
      },
    });
    assert.ok(content.includes("TikTok"));
    assert.ok(content.includes("LinkedIn"));
    assert.ok(content.includes("Prioritizare"));
  });

  it("normalizeActionResultPayload rejects empty content", () => {
    const result = normalizeActionResultPayload({
      raw: { title: "Test" },
      step,
      project,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing_content");
  });

  it("normalizeActionResultPayload accepts structured recommendation result", () => {
    const result = normalizeActionResultPayload({
      raw: {
        title: "Strategie",
        content: "# Strategie",
        structuredData: { mode: "recommendation_selection", selectedRecommendations: ["tiktok"] },
      },
      step,
      project,
      outputType: "recommendation",
    });
    assert.equal(result.ok, true);
    assert.equal(result.payload.type, "recommendation");
    JSON.stringify(result.payload);
  });

  it("executePreparedAction falls back to chat completions when responses has no text", async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes("/v1/responses")) {
        return new Response(JSON.stringify({ output: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: "chat_1",
          model: "gpt-4.1",
          choices: [{ message: { content: "Strategie recomandată pentru iterai.ro" } }],
        }),
        { status: 200 },
      );
    };

    const result = await executePreparedAction({
      preparation: {
        capabilityType: "project_brain",
        preparedPrompt: "Generează strategia",
        context: {
          project: { name: project.name, goal: project.goal, categorySlug: "business" },
          step: {
            title: step.title,
            expectedOutcome: step.expected_outcome,
            description: step.description,
          },
          completedSteps: [],
        },
      },
      acceptedInput: { prompt: "Generează strategia" },
      fetchImpl,
      apiKey: "test-key",
      logFn: () => {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.transport, "chat_completions");
  });

  it("generateActionResult uses selection snapshot when provider fails for recommendation_selection", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: "model_not_found" } }), { status: 404 });

    const result = await generateActionResult({
      preparation: {
        capabilityType: "project_brain",
        preparedPrompt: "Generează strategia",
        context: {
          project: { name: project.name, goal: project.goal, categorySlug: "business" },
          step: {
            title: step.title,
            expectedOutcome: step.expected_outcome,
            description: step.description,
          },
          completedSteps: [],
        },
      },
      collectedInput: {
        interactive: {
          type: "recommendation_selection",
          selectedRecommendations: ["tiktok", "linkedin"],
          confirmed: true,
        },
      },
      acceptedInput: {},
      preparedInput: { _executionPlan: recommendationPlan },
      step,
      project,
      fetchImpl,
      apiKey: "test-key",
      logFn: () => {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, "recommendation_selection");
    assert.ok(result.content.includes("TikTok"));
    assert.equal(result.transport, "selection_snapshot");
  });

  it("maps execution failures to PROJECT_ACTION_EXECUTION_FAILED", () => {
    const mapped = mapActionServiceError("EXECUTION_FAILED");
    assert.equal(mapped.status, 502);
    assert.equal(mapped.code, PROJECT_ACTION_ERROR_CODES.EXECUTION_FAILED);
    assert.equal(mapped.message, "Nu am putut genera rezultatul.");
  });

  it("maps persistence failures to controlled execution failure", () => {
    const mapped = mapActionServiceError("RESULT_PERSISTENCE_FAILED");
    assert.equal(mapped.status, 502);
    assert.equal(mapped.code, PROJECT_ACTION_ERROR_CODES.EXECUTION_FAILED);
  });
});
