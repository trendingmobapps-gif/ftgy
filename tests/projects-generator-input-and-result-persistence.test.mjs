import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { ACTION_RESULT_SELECT_COLUMNS } from "../lib/projects/brain/actions/constants.js";
import { insertActionResult } from "../lib/projects/brain/actions/repository.js";
import {
  LEGACY_INVENTED_FIELD_KEYS,
  normalizeAcceptedExecutionInput,
} from "../lib/projects/brain/actions/accepted-input-normalizer.js";
import { executePreparedAction } from "../lib/projects/brain/actions/generation.js";
import { generateActionResult } from "../lib/projects/brain/actions/action-result-generator.js";
import { resolveProjectModelPolicy } from "../lib/projects/brain/project-model-policy.js";
import {
  repairExecutionPlanInputRenderability,
  validateExecutionInputRenderability,
} from "../lib/projects/brain/execution/execution-plan-validation.js";
import { serializeInteractivePayloadFromPlan } from "../lib/projects/brain/execution/execution-plan-generator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const usmlePlan = {
  mode: "generator",
  title: "Configurează planul de studiu",
  requiredInputs: [
    {
      id: "exam_date",
      label: "Data estimată a examenului",
      type: "date",
      required: true,
    },
    {
      id: "daily_hours",
      label: "Câte ore poți studia pe zi?",
      type: "number",
      required: true,
    },
  ],
  primaryActionLabel: "Generează planul de studiu",
};

describe("projects generator input and result persistence", () => {
  it("1. ACTION_RESULT_SELECT_COLUMNS is defined in constants", () => {
    assert.ok(ACTION_RESULT_SELECT_COLUMNS);
    assert.ok(ACTION_RESULT_SELECT_COLUMNS.includes("id"));
    assert.ok(ACTION_RESULT_SELECT_COLUMNS.includes("action_id"));
    assert.ok(ACTION_RESULT_SELECT_COLUMNS.includes("content"));
  });

  it("2. repository.js imports ACTION_RESULT_SELECT_COLUMNS", () => {
    const source = read("lib/projects/brain/actions/repository.js");
    assert.match(source, /ACTION_RESULT_SELECT_COLUMNS/);
    assert.match(source, /from "\.\/constants\.js"/);
  });

  it("3. insertActionResult executes without ReferenceError", async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      calls.push(String(url));
      assert.match(String(url), /project_action_results/);
      assert.match(String(url), /select=/);
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify([
            {
              id: "result-1",
              action_id: "action-1",
              step_id: "step-1",
              project_id: "project-1",
              user_id: "user-1",
              result_type: "text",
              acceptance_status: "pending_review",
              title: "Rezultat",
              preview: "Preview",
              content: "Content",
              created_at: new Date().toISOString(),
            },
          ]),
      };
    };

    try {
      const saved = await insertActionResult({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: "user-1",
        action: { id: "action-1" },
        step: { id: "step-1", project_id: "project-1" },
        resultType: "text",
        title: "Rezultat",
        preview: "Preview",
        content: "Content",
      });
      assert.equal(saved.ok, true);
      assert.equal(saved.result.id, "result-1");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("4. incomplete OpenAI response is handled with metadata", async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes("/v1/responses")) {
        return new Response(
          JSON.stringify({
            id: "resp_incomplete",
            model: "gpt-5.6-sol",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output_text: "# Plan de studiu USMLE\nContinut partial dar util.",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ output: [] }), { status: 200 });
    };

    const result = await executePreparedAction({
      preparation: {
        capabilityType: "project_brain",
        preparedPrompt: "Generează planul",
        context: {
          project: { name: "USMLE", goal: "Pregătire examen", categorySlug: "medical" },
          step: {
            title: "Studiu teoretic organizat",
            expectedOutcome: "Plan de studiu",
            description: "Organizează studiul teoretic",
          },
          completedSteps: [],
        },
      },
      acceptedInput: { exam_date: "2026-09-01", daily_hours: "4" },
      fetchImpl,
      apiKey: "test-key",
      logFn: () => {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.providerStatus, "incomplete");
    assert.equal(result.incompleteReason, "max_output_tokens");
    assert.equal(result.requiresContinuation, true);
    assert.ok(result.text.includes("Plan de studiu"));
  });

  it("5. generator with required inputs returns renderable controls", () => {
    const repaired = repairExecutionPlanInputRenderability(usmlePlan);
    const payload = serializeInteractivePayloadFromPlan(repaired);
    const validation = validateExecutionInputRenderability(repaired, payload);
    assert.equal(validation.valid, true);
    assert.equal(payload.type, "structured_form");
    assert.equal(payload.fields.length, 2);
  });

  it("6. generator with zero required inputs allows direct generation", () => {
    const plan = {
      mode: "generator",
      title: "Generează planul",
      requiredInputs: [],
      primaryActionLabel: "Generează planul de studiu",
    };
    const payload = serializeInteractivePayloadFromPlan(plan);
    const validation = validateExecutionInputRenderability(plan, payload);
    assert.equal(validation.valid, true);
    assert.equal(payload, null);
  });

  it("7. normalizer does not invent subiectQuiz", () => {
    assert.ok(LEGACY_INVENTED_FIELD_KEYS.has("subiectQuiz"));
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: { subiectQuiz: "Anatomie", mode: "generator" },
      executionPlan: usmlePlan,
      action: { prepared_input: { _executionPlan: usmlePlan, subiectQuiz: "Anatomie" } },
    });
    assert.equal("subiectQuiz" in normalized, false);
    assert.equal(normalized.mode, "generator");
  });

  it("8. result generation uses Project model policy", () => {
    const policy = resolveProjectModelPolicy("execution");
    assert.equal(policy.operation, "execution");
    assert.ok(policy.model);
    assert.equal(policy.reasoningEffort, "high");
    const source = read("lib/projects/brain/actions/generation.js");
    assert.match(source, /resolveProjectModelPolicy\("execution"\)/);
  });

  it("9. USMLE accepted input keeps only plan fields", () => {
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: {
        exam_date: "2026-09-01",
        daily_hours: "4",
        subiectQuiz: "ignored",
      },
      executionPlan: usmlePlan,
      action: { prepared_input: { _executionPlan: usmlePlan } },
    });
    assert.equal(normalized.exam_date, "2026-09-01");
    assert.equal(normalized.daily_hours, "4");
    assert.equal("subiectQuiz" in normalized, false);
  });

  it("10. generateActionResult attaches incomplete metadata", async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    const fetchImpl = async (url) => {
      if (String(url).includes("/v1/responses")) {
        return new Response(
          JSON.stringify({
            id: "resp_1",
            model: "gpt-5.6-sol",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output_text: "Plan USMLE detaliat",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ output: [] }), { status: 200 });
    };

    const result = await generateActionResult({
      preparation: {
        capabilityType: "project_brain",
        preparedPrompt: "Generează",
        context: {
          project: { name: "USMLE", goal: "Examen", categorySlug: "medical" },
          step: {
            title: "Studiu teoretic organizat",
            expectedOutcome: "Plan",
            description: "Plan teoretic",
          },
          completedSteps: [],
        },
      },
      acceptedInput: { exam_date: "2026-09-01", daily_hours: "4" },
      preparedInput: { _executionPlan: usmlePlan },
      step: { title: "Studiu teoretic organizat" },
      project: { name: "Pregătire examen USMLE" },
      fetchImpl,
      logFn: () => {},
    });

    if (previousKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousKey;
    }

    assert.equal(result.ok, true);
    assert.equal(result.payload.metadata.incomplete, true);
    assert.equal(result.payload.metadata.providerStatus, "incomplete");
    assert.equal(result.payload.metadata.incompleteReason, "max_output_tokens");
  });
});
