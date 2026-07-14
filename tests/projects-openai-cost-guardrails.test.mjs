import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import {
  classifyOpenAiHttpError,
  isNonRetryableOpenAiError,
} from "../lib/projects/brain/openai-error-classification.js";
import { OPENAI_INTERNAL_ERROR_CODES } from "../lib/projects/brain/openai-error-codes.js";
import {
  resolveExecutionPlanComplexity,
  resolveRoadmapComplexity,
} from "../lib/projects/brain/openai-complexity.js";
import { requireOpenAiLiveTestsOrSkip, isOpenAiLiveTestsEnabled, readLiveSmokeProjectCap } from "../lib/projects/brain/openai-live-test-guard.js";
import {
  extractOpenAiUsage,
  logOpenAiUsageEvent,
  OPENAI_USAGE_WARNING_THRESHOLDS,
} from "../lib/projects/brain/openai-usage-observability.js";
import {
  resolveExceptionalReasonCode,
  resolveProviderReasoningEffort,
} from "../lib/projects/brain/openai-reasoning-effort.js";
import { callProjectStructuredJson } from "../lib/projects/brain/openai-project-client.js";
import {
  PROJECT_MODEL_POLICY,
  resolveProjectModelPolicy,
  resolveStructuredModelRuntimePolicy,
  resolveStructuredOutputTokenCeiling,
} from "../lib/projects/brain/project-model-policy.js";
import { resetGenerationLocksForTests } from "../lib/projects/brain/generation-lock.js";
import { resetBrainSchemaBootstrapForTests } from "../lib/projects/brain/schema-bootstrap.js";
import { generateProjectWorkflow } from "../lib/projects/brain/service.js";
import { tryClaimProjectGeneration } from "../lib/projects/brain/repository.js";

function createSupabaseFetchMock({
  workflowRows = [],
  milestoneRows = [],
  stepRows = [],
  projectPatchRows = null,
  trackOpenAi = null,
} = {}) {
  return async (url, init) => {
    const target = String(url);
    if (target.includes("openai.com")) {
      if (trackOpenAi) {
        trackOpenAi.called = true;
      }
      throw new Error("OpenAI should not be called");
    }
    if (target.includes("/rest/v1/projects?select=brain_status")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (target.includes("/rest/v1/project_workflows")) {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify(workflowRows), { status: 200 });
    }
    if (target.includes("/rest/v1/project_milestones")) {
      return new Response(JSON.stringify(milestoneRows), { status: 200 });
    }
    if (target.includes("/rest/v1/project_steps")) {
      return new Response(JSON.stringify(stepRows), { status: 200 });
    }
    if (target.includes("/rest/v1/projects?") && init?.method === "PATCH") {
      return new Response(JSON.stringify(projectPatchRows ?? []), { status: 200 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };
}

async function withGlobalFetch(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function buildReadyWorkflowRows(projectId = "project-1") {
  const workflowId = "wf-1";
  const milestoneId = "ms-1";
  return {
    workflowRows: [
      {
        id: workflowId,
        project_id: projectId,
        user_id: "user-1",
        summary: "Plan",
        current_stage: "Start",
        complexity: "medium",
        estimated_duration_label: "4-8 saptamani",
        brain_version: "1.0.0",
        status: "ready",
        generated_at: "2026-07-14T10:00:00.000Z",
      },
    ],
    milestoneRows: [
      {
        id: milestoneId,
        workflow_id: workflowId,
        project_id: projectId,
        user_id: "user-1",
        title: "M1",
        description: "D1",
        position: 0,
        status: "pending",
      },
    ],
    stepRows: [
      {
        id: "step-1",
        milestone_id: milestoneId,
        workflow_id: workflowId,
        project_id: projectId,
        user_id: "user-1",
        title: "S1",
        description: "D",
        expected_outcome: "O",
        rationale: null,
        position: 0,
        priority: "high",
        estimated_effort_label: "1 sapt",
        status: "pending",
        completed_at: null,
        tool_id: null,
        tool_slug: null,
        tool_name: null,
        tool_category_slug: null,
      },
    ],
  };
}

function buildValidWorkflow() {
  return {
    summary: "Plan",
    currentStage: "Start",
    complexity: "medium",
    estimatedDurationLabel: "4-8 saptamani",
    milestones: [
      {
        title: "M1",
        description: "D1",
        steps: [
          {
            title: "S1",
            description: "D",
            expectedOutcome: "O",
            rationale: null,
            priority: "high",
            estimatedEffortLabel: "1 sapt",
            recommendedToolId: null,
          },
          {
            title: "S2",
            description: "D",
            expectedOutcome: "O",
            rationale: null,
            priority: "medium",
            estimatedEffortLabel: "1 sapt",
            recommendedToolId: null,
          },
        ],
      },
      {
        title: "M2",
        description: "D2",
        steps: [
          {
            title: "S3",
            description: "D",
            expectedOutcome: "O",
            rationale: null,
            priority: "medium",
            estimatedEffortLabel: "1 sapt",
            recommendedToolId: null,
          },
          {
            title: "S4",
            description: "D",
            expectedOutcome: "O",
            rationale: null,
            priority: "low",
            estimatedEffortLabel: "1 sapt",
            recommendedToolId: null,
          },
        ],
      },
      {
        title: "M3",
        description: "D3",
        steps: [
          {
            title: "S5",
            description: "D",
            expectedOutcome: "O",
            rationale: null,
            priority: "low",
            estimatedEffortLabel: "1 sapt",
            recommendedToolId: null,
          },
          {
            title: "S6",
            description: "D",
            expectedOutcome: "O",
            rationale: null,
            priority: "low",
            estimatedEffortLabel: "1 sapt",
            recommendedToolId: null,
          },
        ],
      },
    ],
  };
}

describe("openai cost guardrails step 1", () => {
  beforeEach(() => {
    resetGenerationLocksForTests();
    resetBrainSchemaBootstrapForTests();
  });

  it("roadmap always sends max_output_tokens 16000", async () => {
    const bodies = [];
    const fetchImpl = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          id: "resp_1",
          model: "gpt-5.6-sol",
          output: [],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
        { status: 200 },
      );
    };

    await callProjectStructuredJson({
      operation: "roadmap",
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { name: "project_brain_workflow", strict: true, schema: { type: "object" } },
      fetchImpl,
      apiKey: "test-key",
      complexity: "standard",
    });

    assert.equal(bodies[0].max_output_tokens, 16_000);
  });

  it("execution plan always sends max_output_tokens 8000", async () => {
    const bodies = [];
    const fetchImpl = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          id: "resp_1",
          model: "gpt-5.6-sol",
          output: [],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
        { status: 200 },
      );
    };

    await callProjectStructuredJson({
      operation: "executionPlan",
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { name: "project_execution_plan", strict: true, schema: { type: "object" } },
      fetchImpl,
      apiKey: "test-key",
      complexity: "standard",
    });

    assert.equal(bodies[0].max_output_tokens, 8_000);
  });

  it("unknown structured operation gets safe default ceiling", () => {
    assert.equal(resolveStructuredOutputTokenCeiling("unknown"), 8_000);
    assert.equal(PROJECT_MODEL_POLICY.decision.maxOutputTokens, 4_096);
  });

  it("standard roadmap uses medium reasoning", () => {
    const runtime = resolveStructuredModelRuntimePolicy({
      operation: "roadmap",
      complexity: "standard",
    });
    assert.equal(runtime.providerReasoningEffort, "medium");
    assert.equal(runtime.highReasoningUsed, false);
  });

  it("complex roadmap may use high reasoning", () => {
    const runtime = resolveStructuredModelRuntimePolicy({
      operation: "roadmap",
      complexity: "complex",
    });
    assert.equal(runtime.providerReasoningEffort, "high");
    assert.equal(runtime.highReasonCode, "complexity_complex");
  });

  it("high reasoning requires explicit complexity/reason code", () => {
    const exceptionalWithoutReason = resolveProviderReasoningEffort({
      operation: "roadmap",
      configuredEffort: "max",
      complexity: "exceptional",
    });
    assert.equal(exceptionalWithoutReason.providerReasoningEffort, "medium");

    const exceptionalWithReason = resolveProviderReasoningEffort({
      operation: "roadmap",
      configuredEffort: "max",
      complexity: "exceptional",
      reasonCode: "multi_constraint_goal",
    });
    assert.equal(exceptionalWithReason.providerReasoningEffort, "high");
  });

  it("execution plan defaults to medium", () => {
    const runtime = resolveStructuredModelRuntimePolicy({
      operation: "executionPlan",
      complexity: "standard",
    });
    assert.equal(runtime.providerReasoningEffort, "medium");
  });

  it("total provider calls per structured operation never exceed 2", async () => {
    let callCount = 0;
    const fetchImpl = async (url) => {
      callCount += 1;
      if (String(url).includes("/v1/responses")) {
        return new Response(JSON.stringify({ output: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: "model_not_found" } }), { status: 404 });
    };

    const result = await callProjectStructuredJson({
      operation: "roadmap",
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { name: "project_brain_workflow", strict: true, schema: { type: "object" } },
      fetchImpl,
      apiKey: "test-key",
      complexity: "standard",
    });

    assert.equal(result.ok, false);
    assert.equal(result.providerCallCount, 2);
    assert.equal(callCount, 2);
  });

  it("malformed JSON allows one repair only", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return new Response(JSON.stringify({ output: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: "chat_1",
          model: "gpt-4.1",
          choices: [{ message: { content: JSON.stringify(buildValidWorkflow()) } }],
          usage: { input_tokens: 1, output_tokens: 2 },
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
      complexity: "standard",
    });

    assert.equal(result.ok, true);
    assert.equal(result.providerCallCount, 2);
    assert.equal(calls.length, 2);
  });

  it("quota error does not retry", async () => {
    let callCount = 0;
    const fetchImpl = async () => {
      callCount += 1;
      return new Response(JSON.stringify({ error: { message: "insufficient_quota" } }), { status: 429 });
    };

    const result = await callProjectStructuredJson({
      operation: "roadmap",
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { name: "project_brain_workflow", strict: true, schema: { type: "object" } },
      fetchImpl,
      apiKey: "test-key",
      complexity: "standard",
    });

    assert.equal(callCount, 1);
    assert.equal(result.internalErrorCode, OPENAI_INTERNAL_ERROR_CODES.QUOTA_EXCEEDED);
  });

  it("auth error does not retry", async () => {
    let callCount = 0;
    const fetchImpl = async () => {
      callCount += 1;
      return new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 });
    };

    const result = await callProjectStructuredJson({
      operation: "roadmap",
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { name: "project_brain_workflow", strict: true, schema: { type: "object" } },
      fetchImpl,
      apiKey: "test-key",
      complexity: "standard",
    });

    assert.equal(callCount, 1);
    assert.equal(result.internalErrorCode, OPENAI_INTERNAL_ERROR_CODES.AUTH_FAILED);
  });

  it("timeout retry is bounded", async () => {
    let callCount = 0;
    const fetchImpl = async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: { message: "server error" } }), { status: 500 });
      }
      return new Response(
        JSON.stringify({
          id: "resp_2",
          model: "gpt-5.6-sol",
          output: [
            {
              content: [{ type: "output_text", text: JSON.stringify(buildValidWorkflow()) }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 2 },
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
      complexity: "standard",
      timeoutMs: 5_000,
    });

    assert.equal(callCount, 2);
    assert.equal(result.providerCallCount, 2);
  });

  it("fallback chain contains maximum one fallback model", async () => {
    const chatModels = [];
    const fetchImpl = async (url, init) => {
      if (String(url).includes("/v1/chat/completions")) {
        chatModels.push(JSON.parse(init.body).model);
        return new Response(JSON.stringify({ error: { message: "model_not_found" } }), { status: 404 });
      }
      return new Response(JSON.stringify({ output: [] }), { status: 200 });
    };

    await callProjectStructuredJson({
      operation: "roadmap",
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { name: "project_brain_workflow", strict: true, schema: { type: "object" } },
      fetchImpl,
      apiKey: "test-key",
      complexity: "standard",
    });

    assert.equal(chatModels.length, 1);
  });

  it("insufficient_quota maps to OPENAI_QUOTA_EXCEEDED", () => {
    const classified = classifyOpenAiHttpError({
      httpStatus: 429,
      errorBody: { error: { message: "You exceeded your current quota, please check your plan and billing details." } },
    });
    assert.equal(classified.code, OPENAI_INTERNAL_ERROR_CODES.QUOTA_EXCEEDED);
    assert.equal(isNonRetryableOpenAiError(classified.code), true);
  });

  it("usage tokens are extracted from Responses API payload", () => {
    const usage = extractOpenAiUsage({
      usage: {
        input_tokens: 100,
        output_tokens: 250,
        output_tokens_details: { reasoning_tokens: 180 },
        total_tokens: 350,
      },
    });
    assert.equal(usage.inputTokens, 100);
    assert.equal(usage.outputTokens, 250);
    assert.equal(usage.reasoningTokens, 180);
    assert.equal(usage.totalTokens, 350);
  });

  it("reasoning tokens are extracted when present", () => {
    const usage = extractOpenAiUsage({
      usage: {
        output_tokens: 900,
        output_tokens_details: { reasoning_tokens: 850 },
      },
    });
    assert.equal(usage.reasoningTokens, 850);
  });

  it("token usage log excludes prompts/content", () => {
    const events = [];
    logOpenAiUsageEvent((payload) => events.push(payload), {
      operation: "roadmap",
      model: "gpt-5.6-sol",
      providerReasoningEffort: "medium",
      maxOutputTokens: 16_000,
      attempt: 1,
      inputTokens: 100,
      outputTokens: 25_000,
      reasoningTokens: 16_000,
      success: true,
      projectId: "project-1",
    });

    const serialized = JSON.stringify(events);
    assert.doesNotMatch(serialized, /systemPrompt|userPrompt|prompt|answer|memory/i);
    assert.ok(events.some((event) => event.event === "project_openai_usage_warning"));
  });

  it("output above warning threshold emits safe warning", () => {
    const warnings = [];
    logOpenAiUsageEvent((payload) => warnings.push(payload), {
      operation: "roadmap",
      outputTokens: OPENAI_USAGE_WARNING_THRESHOLDS.outputTokens + 1,
      reasoningTokens: OPENAI_USAGE_WARNING_THRESHOLDS.reasoningTokens + 1,
      providerCallCount: 2,
      success: true,
    });

    assert.ok(warnings.some((event) => event.warning === "high_output_tokens"));
    assert.ok(warnings.some((event) => event.warning === "high_reasoning_tokens"));
    assert.ok(warnings.some((event) => event.warning === "multiple_provider_calls"));
  });

  it("ready roadmap state skips OpenAI", async () => {
    const trackOpenAi = { called: false };
    const readyBundle = buildReadyWorkflowRows("project-1");
    const fetchImpl = createSupabaseFetchMock({ ...readyBundle, trackOpenAi });

    const result = await withGlobalFetch(fetchImpl, () =>
      generateProjectWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: "user-1",
        project: {
          id: "project-1",
          brain_status: "ready",
          goal: "Deschid o cafenea",
        },
        fetchImpl,
        logFn: () => {},
      }),
    );

    assert.equal(trackOpenAi.called, false);
    assert.equal(result.ok, true);
    assert.equal(result.idempotent, true);
  });

  it("active generating state skips duplicate OpenAI", async () => {
    const trackOpenAi = { called: false };
    const fetchImpl = createSupabaseFetchMock({ trackOpenAi });

    const result = await withGlobalFetch(fetchImpl, () =>
      generateProjectWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: "user-1",
        project: {
          id: "project-2",
          brain_status: "generating",
          updated_at: new Date().toISOString(),
          goal: "Deschid o cafenea",
        },
        fetchImpl,
        logFn: () => {},
      }),
    );

    assert.equal(trackOpenAi.called, false);
    assert.equal(result.ok, false);
    assert.equal(result.code, "GENERATION_IN_PROGRESS");
  });

  it("conditional generation claim allows one winner", async () => {
    const fetchImpl = createSupabaseFetchMock({
      projectPatchRows: [
        {
          id: "project-3",
          brain_status: "generating",
          brain_attempt_count: 1,
        },
      ],
    });

    const result = await withGlobalFetch(fetchImpl, () =>
      tryClaimProjectGeneration({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: "user-1",
        projectId: "project-3",
        nextAttemptCount: 1,
        allowedStatuses: ["pending"],
      }),
    );

    assert.equal(result.claimed, true);
  });

  it("loser returns existing generation status", async () => {
    const trackOpenAi = { called: false };
    const fetchImpl = createSupabaseFetchMock({ projectPatchRows: [], trackOpenAi });

    const result = await withGlobalFetch(fetchImpl, () =>
      generateProjectWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: "user-1",
        project: {
          id: "project-4",
          brain_status: "pending",
          brain_attempt_count: 0,
          goal: "Deschid o cafenea",
          name: "Test",
        },
        fetchImpl,
        logFn: () => {},
      }),
    );

    assert.equal(trackOpenAi.called, false);
    assert.equal(result.ok, true);
    assert.equal(result.idempotent, true);
  });

  it("live smoke with explicit flag remains capped", () => {
    assert.equal(readLiveSmokeProjectCap(2), 2);
    process.env.OPENAI_LIVE_SMOKE_PROJECT_CAP = "99";
    assert.equal(readLiveSmokeProjectCap(2), 2);
    delete process.env.OPENAI_LIVE_SMOKE_PROJECT_CAP;
  });

  it("live smoke without OPENAI_LIVE_TESTS=1 makes zero OpenAI calls", () => {
    const previous = process.env.OPENAI_LIVE_TESTS;
    delete process.env.OPENAI_LIVE_TESTS;
    assert.equal(isOpenAiLiveTestsEnabled(), false);
    if (previous) {
      process.env.OPENAI_LIVE_TESTS = previous;
    }
  });

  it("complexity rules stay category-agnostic", () => {
    assert.equal(
      resolveRoadmapComplexity({
        project: { goal: "Deschid o cafenea" },
        clarificationAnswers: [],
      }),
      "simple",
    );
    assert.equal(
      resolveExecutionPlanComplexity({
        context: {
          projectGoal: "Deschid o cafenea",
          stepTitle: "Checklist",
          memorySummary: "",
          completedStepsSummary: "",
        },
        executionDecision: { strategy: "continue_workflow" },
      }),
      "simple",
    );
    assert.equal(
      resolveExceptionalReasonCode({
        complexity: "exceptional",
        highStakes: true,
      }),
      "high_stakes_goal",
    );
  });

  it("frontier roadmap model preserved in policy", () => {
    assert.equal(resolveProjectModelPolicy("roadmap").model, "gpt-5.6-sol");
    assert.equal(resolveProjectModelPolicy("executionPlan").model, "gpt-5.6-sol");
  });
});
