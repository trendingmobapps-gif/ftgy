import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  buildSafeAcceptedInputNormalizationDetails,
  normalizeAcceptedExecutionInput,
} from "../lib/projects/brain/actions/accepted-input-normalizer.js";
import { validateExecuteActionRequest } from "../lib/projects/brain/actions/validation.js";
import { buildRecommendationSelectionResultContent } from "../lib/projects/brain/actions/action-result-generator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const recommendationPlan = {
  mode: "recommendation_selection",
  title: "Strategie",
  recommendationGroups: [
    {
      id: "channels",
      title: "Canale",
      recommendations: [
        { id: "meta-ads", title: "Meta Ads", explanation: "Meta", advantages: [], tradeoffs: [] },
        { id: "tiktok-ads", title: "TikTok Ads", explanation: "TikTok", advantages: [], tradeoffs: [] },
      ],
    },
  ],
  selectionRules: { minimumSelections: 1 },
};

describe("projects execute-action mode-aware acceptedInput normalization", () => {
  it("1. handler-level validation accepts a valid object payload", () => {
    const result = validateExecuteActionRequest({
      projectId: "d2be5daf-45d5-4df6-9ccf-4a317a39dc2f",
      stepId: "d17d85f3-3e43-4762-84f5-9b8132f9ff64",
      actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      acceptedInput: { selected_recommendations: ["meta-ads"] },
    });
    assert.equal(result.ok, true);
  });

  it("2. resolves mode from persisted execution plan when acceptedInput.mode missing", () => {
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: { selected_recommendations: ["meta-ads"] },
      executionPlan: recommendationPlan,
      action: { prepared_input: { _executionPlan: recommendationPlan } },
    });
    assert.equal(normalized.mode, "recommendation_selection");
    assert.equal(normalized.interactive.type, "recommendation_selection");
  });

  it("3. snake_case recommendation input normalizes to canonical interactive shape", () => {
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: {
        selected_recommendations: ["meta-ads", "tiktok-ads"],
        priority_order: ["tiktok-ads", "meta-ads"],
        channel_strategy_summary: "optional summary",
      },
      executionPlan: recommendationPlan,
      action: { prepared_input: { _executionPlan: recommendationPlan } },
    });

    assert.equal(normalized.mode, "recommendation_selection");
    assert.equal(normalized.interactive.confirmed, true);
    assert.equal(Array.isArray(normalized.interactive.selectedRecommendations), true);
    assert.equal(normalized.interactive.selectedRecommendations.length, 2);
    assert.deepEqual(normalized.interactive.priorityOrder, ["tiktok-ads", "meta-ads"]);
    assert.equal(normalized.interactive.channelStrategySummary, "optional summary");
  });

  it("4. camelCase recommendation input remains valid", () => {
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: {
        selectedRecommendations: ["meta-ads"],
        priorityOrder: ["meta-ads"],
      },
      executionPlan: recommendationPlan,
      action: { prepared_input: { _executionPlan: recommendationPlan } },
    });

    assert.equal(normalized.mode, "recommendation_selection");
    assert.equal(normalized.interactive.selectedRecommendations[0].id, "meta-ads");
    assert.deepEqual(normalized.interactive.priorityOrder, ["meta-ads"]);
  });

  it("5. missing mode is inferred (falls back to plan)", () => {
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: {},
      executionPlan: recommendationPlan,
      action: { prepared_input: { _executionPlan: recommendationPlan } },
    });
    assert.equal(normalized.mode, "recommendation_selection");
  });

  it("6. string ID selections normalize to objects", () => {
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: { selected_recommendations: ["meta-ads"] },
      executionPlan: recommendationPlan,
      action: { prepared_input: { _executionPlan: recommendationPlan } },
    });
    assert.deepEqual(normalized.interactive.selectedRecommendations, [
      { id: "meta-ads", selected: true, priority: 1 },
    ]);
  });

  it("7. object selections remain usable for result snapshot rendering", () => {
    const content = buildRecommendationSelectionResultContent({
      plan: recommendationPlan,
      interactive: {
        selectedRecommendations: [{ id: "meta-ads", selected: true, priority: 2 }],
        priorityOrder: [{ id: "meta-ads" }],
        confirmed: true,
      },
    });

    assert.ok(content.includes("Meta Ads"));
  });

  it("8. priority is inferred from priorityOrder when present", () => {
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: {
        selected_recommendations: ["meta-ads", "tiktok-ads"],
        priority_order: ["tiktok-ads", "meta-ads"],
      },
      executionPlan: recommendationPlan,
      action: { prepared_input: { _executionPlan: recommendationPlan } },
    });

    assert.equal(normalized.interactive.selectedRecommendations[0].id, "meta-ads");
    assert.equal(normalized.interactive.selectedRecommendations[0].priority, 2);
    assert.equal(normalized.interactive.selectedRecommendations[1].id, "tiktok-ads");
    assert.equal(normalized.interactive.selectedRecommendations[1].priority, 1);
  });

  it("9. strategy summary is optional", () => {
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: {
        selected_recommendations: ["meta-ads"],
        priority_order: ["meta-ads"],
      },
      executionPlan: recommendationPlan,
      action: { prepared_input: { _executionPlan: recommendationPlan } },
    });

    assert.equal("channelStrategySummary" in normalized.interactive, false);
  });

  it("10. exact Preview payload normalizes successfully for recommendation_selection", () => {
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: {
        selected_recommendations: ["meta-ads", "tiktok-ads"],
        priority_order: ["tiktok-ads", "meta-ads"],
        channel_strategy_summary: "...",
      },
      executionPlan: recommendationPlan,
      action: { prepared_input: { _executionPlan: recommendationPlan } },
    });

    const details = buildSafeAcceptedInputNormalizationDetails({
      mode: normalized.mode,
      rawInput: {
        selected_recommendations: ["meta-ads"],
        priority_order: ["meta-ads"],
        channel_strategy_summary: "...",
      },
      normalizedInput: normalized,
    });

    assert.equal(details.mode, "recommendation_selection");
    assert.ok(details.receivedKeys.includes("selected_recommendations"));
    assert.ok(details.normalizedKeys.includes("interactive"));
  });

  it("11. handler preserves safe details fields on service validation errors", () => {
    const source = read("api/projects-execute-action.js");
    assert.ok(source.includes("result.details || result.fields || result.missingRequirements"));
    assert.ok(source.includes("sendError("));
  });

  it("12. existing choice/checklist/structured_form flows remain compatible (no forced normalization)", () => {
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: { interactive: { type: "choice", selectedChoice: "a" } },
      executionPlan: { mode: "choice" },
      action: { prepared_input: { _executionPlan: { mode: "choice" } } },
    });
    assert.equal(normalized.mode, "choice");
    assert.deepEqual(normalized.interactive, { type: "choice", selectedChoice: "a" });
  });
});

