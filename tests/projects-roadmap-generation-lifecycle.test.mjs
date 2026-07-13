import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveProjectModelPolicy, PROJECT_MODEL_POLICY } from "../lib/projects/brain/project-model-policy.js";
import {
  buildGenerationStatusPayload,
  resolveGenerationStatus,
} from "../lib/projects/brain/generation-status.js";
import {
  buildContextualRoadmapFallback,
  extractStructuredJsonFromProviderPayload,
  parseValidateAndRecoverRoadmap,
  repairGeneratedWorkflowJson,
} from "../lib/projects/brain/roadmap-response.js";
import { callProjectStructuredJson } from "../lib/projects/brain/openai-project-client.js";
import { generateProjectWorkflowWithModel } from "../lib/projects/brain/generation.js";
import { validateGeneratedWorkflow } from "../lib/projects/brain/validation.js";

function buildValidWorkflow() {
  const steps = Array.from({ length: 3 }).map((_, index) => ({
    title: `Pas concret ${index + 1}`,
    description: `Descriere detaliată pentru pasul ${index + 1}`,
    expectedOutcome: `Rezultat clar ${index + 1}`,
    rationale: "Motiv util",
    priority: "medium",
    estimatedEffortLabel: "30 min",
    recommendedToolId: null,
  }));

  return {
    summary: "Plan structurat pentru deschiderea unei cafenele în oraș.",
    currentStage: "Clarificarea conceptului",
    complexity: "medium",
    estimatedDurationLabel: "4–8 săptămâni",
    milestones: [
      {
        title: "Clarificarea conceptului",
        description: "Definești direcția și poziționarea cafenelei.",
        steps,
      },
      {
        title: "Piață și poziționare",
        description: "Analizezi piața locală și concurența.",
        steps: steps.map((step, index) => ({
          ...step,
          title: `Analiză piață ${index + 1}`,
          description: `Descriere piață ${index + 1}`,
          expectedOutcome: `Rezultat piață ${index + 1}`,
        })),
      },
      {
        title: "Buget și operațiuni",
        description: "Stabilești costurile și fluxul operațional.",
        steps: steps.map((step, index) => ({
          ...step,
          title: `Buget pas ${index + 1}`,
          description: `Descriere buget ${index + 1}`,
          expectedOutcome: `Rezultat buget ${index + 1}`,
        })),
      },
    ],
  };
}

describe("roadmap model policy", () => {
  it("ignores empty env model override", () => {
    const original = process.env.PROJECT_ROADMAP_MODEL;
    process.env.PROJECT_ROADMAP_MODEL = "   ";
    try {
      const policy = resolveProjectModelPolicy("roadmap");
      assert.equal(policy.model, "gpt-5.6-sol");
      assert.equal(policy.reasoningEffort, "max");
    } finally {
      process.env.PROJECT_ROADMAP_MODEL = original;
    }
  });

  it("resolves configured roadmap model", () => {
    const original = process.env.PROJECT_ROADMAP_MODEL;
    process.env.PROJECT_ROADMAP_MODEL = "gpt-4.1";
    try {
      assert.equal(resolveProjectModelPolicy("roadmap").model, "gpt-4.1");
      assert.equal(PROJECT_MODEL_POLICY.roadmap.model, "gpt-4.1");
    } finally {
      process.env.PROJECT_ROADMAP_MODEL = original;
    }
  });
});

describe("generation status contract", () => {
  it("distinguishes queued, generating, ready and failed", () => {
    assert.equal(
      resolveGenerationStatus({ project: { brain_status: "pending" }, bundle: { workflow: null } }),
      "queued",
    );
    assert.equal(
      resolveGenerationStatus({ project: { brain_status: "generating" }, bundle: { workflow: null } }),
      "generating",
    );
    assert.equal(
      resolveGenerationStatus({
        project: { brain_status: "failed" },
        bundle: { workflow: null },
      }),
      "failed",
    );
    assert.equal(
      resolveGenerationStatus({
        project: { brain_status: "ready" },
        bundle: { workflow: { status: "ready" } },
        milestones: [{ id: "m1" }],
        steps: [{ id: "s1" }],
      }),
      "ready",
    );
  });

  it("does not report ready with empty milestones or steps", () => {
    const payload = buildGenerationStatusPayload({
      project: { brain_status: "ready" },
      bundle: { workflow: { status: "ready" } },
      milestones: [],
      steps: [],
    });
    assert.notEqual(payload.generationStatus, "ready");
    assert.equal(payload.workflowGenerated, false);
  });
});

describe("responses parsing and repair", () => {
  it("handles missing output_text via nested output blocks", () => {
    const extracted = extractStructuredJsonFromProviderPayload({
      id: "resp_1",
      model: "gpt-5.6-sol",
      output: [
        {
          content: [{ type: "output_text", text: JSON.stringify({ ok: true }) }],
        },
      ],
    });
    assert.equal(extracted.metadata.outputTextExists, true);
    assert.deepEqual(extracted.parsed, { ok: true });
  });

  it("repairs malformed JSON shape once before fallback", () => {
    const repaired = repairGeneratedWorkflowJson(
      {
        summary: "",
        milestones: [],
      },
      { goal: "Deschid o cafenea" },
    );
    assert.ok(repaired);
    const validated = validateGeneratedWorkflow(repaired, { goal: "Deschid o cafenea" });
    assert.equal(validated.ok, true);
  });

  it("uses contextual fallback when provider JSON is unusable", () => {
    const recovered = parseValidateAndRecoverRoadmap({
      raw: { summary: "Deschid o cafenea", milestones: [] },
      goal: "Deschid o cafenea",
      project: { name: "Cafenea" },
      allowFallback: true,
    });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.source, "contextual_fallback");
    assert.ok(recovered.workflow.milestones.length >= 3);
  });

  it("rejects empty milestones without fallback", () => {
    const recovered = parseValidateAndRecoverRoadmap({
      raw: { summary: "Deschid o cafenea", milestones: [] },
      goal: "Deschid o cafenea",
      project: { name: "Cafenea" },
      allowFallback: false,
    });
    assert.equal(recovered.ok, false);
  });

  it("contextual fallback produces valid roadmap", () => {
    const fallback = buildContextualRoadmapFallback({
      project: { name: "ITER" },
      goal: "Promovez iterai.ro",
    });
    const validated = validateGeneratedWorkflow(fallback, { goal: "Promovez iterai.ro" });
    assert.equal(validated.ok, true);
  });
});

describe("openai structured client", () => {
  it("falls back to chat completions when responses has no parseable JSON", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(String(url));
      if (String(url).includes("/v1/responses")) {
        return new Response(JSON.stringify({ output: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: "chat_1",
          model: "gpt-4.1",
          choices: [{ message: { content: JSON.stringify(buildValidWorkflow()) } }],
        }),
        { status: 200 },
      );
    };

    const result = await callProjectStructuredJson({
      operation: "roadmap",
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { name: "project_brain_workflow", strict: true, schema: { type: "object" } },
      fetchImpl,
      apiKey: "test-key",
      timeoutMs: 5_000,
      logFn: null,
    });

    assert.equal(result.ok, true);
    assert.equal(result.transport, "chat_completions");
    assert.ok(calls.some((url) => url.includes("/v1/responses")));
    assert.ok(calls.some((url) => url.includes("/v1/chat/completions")));
  });

  it("returns upstream failure when provider rejects all models", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: "model_not_found" } }), {
      status: 404,
    });

    const result = await callProjectStructuredJson({
      operation: "roadmap",
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { name: "project_brain_workflow", strict: true, schema: { type: "object" } },
      fetchImpl,
      apiKey: "test-key",
      timeoutMs: 5_000,
      logFn: null,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "upstream");
    assert.equal(result.fallbackAttempted, true);
  });
});

describe("roadmap generation integration", () => {
  it("does not swallow provider failure", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: "rate_limit" } }), {
      status: 429,
    });

    const result = await generateProjectWorkflowWithModel({
      project: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Test",
        goal: "Deschid o cafenea",
        category_slug: "business",
      },
      fetchImpl,
      apiKey: "test-key",
      logFn: null,
    });

    assert.equal(result.ok, false);
    assert.ok(result.reason);
  });

  it("persists-ready workflow payload from chat fallback", async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes("/v1/responses")) {
        return new Response(JSON.stringify({ output: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(buildValidWorkflow()) } }],
        }),
        { status: 200 },
      );
    };

    const result = await generateProjectWorkflowWithModel({
      project: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Cafenea",
        goal: "Deschid o cafenea",
        category_slug: "business",
      },
      fetchImpl,
      apiKey: "test-key",
      logFn: null,
    });

    assert.equal(result.ok, true);
    assert.ok(result.workflow);
    assert.ok(result.workflow.milestones.length >= 3);
  });
});
