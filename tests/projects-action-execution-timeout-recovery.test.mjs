import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { resolveOperationTimeoutMs, VERCEL_EXECUTE_ACTION_MAX_DURATION_MS } from "../lib/projects/brain/openai-operation-timeout.js";
import { executePreparedAction } from "../lib/projects/brain/actions/generation.js";
import {
  assertValidExecuteStage,
  createExecuteStageUsageLogger,
  logExecuteStage,
} from "../lib/projects/brain/actions/execute-action-stage-log.js";
import { mapActionServiceError } from "../lib/projects/brain/actions/validation.js";
import { PROJECT_ACTION_ERROR_CODES } from "../lib/projects/brain/actions/constants.js";
import {
  buildExecutionRecoveryMetadata,
  resolveExecutionGenerationGate,
  resolvePersistedTimeoutRecoveryState,
  withExecutionRecovery,
} from "../lib/projects/brain/actions/execution-generation-gate.js";
import { classifyOpenAiOperationComplexity } from "../lib/projects/brain/openai-operation-complexity.js";
import { classifyStrategicResultIntent } from "../lib/projects/brain/strategic-result-intent.js";
import { resolveProjectModelRuntimePolicy } from "../lib/projects/brain/project-model-policy.js";
import { PROJECT_MODEL_ROLES } from "../lib/projects/brain/project-model-policy.js";

describe("projects action execution timeout and recovery", () => {
  it("9 timeout ownership is deterministic via resolveOperationTimeoutMs", () => {
    const resolution = resolveOperationTimeoutMs({
      role: PROJECT_MODEL_ROLES.resultGeneration,
      complexityLevel: "standard",
    });

    assert.equal(resolution.abortSource, "operation_timeout_controller");
    assert.equal(resolution.configuredBudgetMs, 180_000);
    assert.ok(resolution.timeoutMs <= VERCEL_EXECUTE_ACTION_MAX_DURATION_MS - resolution.runtimeBufferMs);
    assert.ok(resolution.timeoutMs >= 30_000);
  });

  it("10 provider timeout maps to typed recoverable GENERATION_TIMEOUT", () => {
    const mapped = mapActionServiceError("GENERATION_TIMEOUT");
    assert.equal(mapped.code, PROJECT_ACTION_ERROR_CODES.GENERATION_TIMEOUT);
    assert.equal(mapped.recoverable, true);
    assert.equal(mapped.retryAllowed, true);
    assert.match(mapped.message, /relua generarea/i);
  });

  it("11 timeout recovery metadata marks action recoverable without completion", () => {
    const recovery = buildExecutionRecoveryMetadata({
      code: "PROJECT_ACTION_GENERATION_TIMEOUT",
      projectId: "087bfdc2-5717-46c2-8d91-eec85ae46e4e",
      stepId: "032d5975-b8b9-45b2-9914-28a8577f624a",
      actionId: "7a1f9a2a-94ca-46ce-9aec-1fd1fc982d0b",
      configuredTimeoutMs: 90_000,
      elapsedMs: 90_120,
      resultExists: false,
      persistenceOccurred: false,
    });
    assert.equal(recovery.recoverable, true);
    assert.equal(recovery.retrySafe, true);
    assert.equal(recovery.resultExists, false);
    assert.equal(recovery.persistenceOccurred, false);
  });

  it("12 timeout does not imply completed action state in recovery metadata", () => {
    const recovery = buildExecutionRecoveryMetadata({ code: "PROJECT_ACTION_GENERATION_TIMEOUT" });
    assert.notEqual(recovery.code, "completed");
    assert.equal(recovery.persistenceOccurred, false);
  });

  it("13 timeout recovery metadata records no fake result persistence", () => {
    const recovery = buildExecutionRecoveryMetadata({
      code: "PROJECT_ACTION_GENERATION_TIMEOUT",
      resultExists: false,
      persistenceOccurred: false,
    });
    assert.equal(recovery.resultExists, false);
    assert.equal(recovery.persistenceOccurred, false);
  });

  it("14 retry gate allows recoverable timeout when action is prepared", () => {
    const gate = resolveExecutionGenerationGate({
      action: {
        status: "prepared",
        session_status: "ready",
        prepared_input: {
          _executionRecovery: {
            code: "PROJECT_ACTION_GENERATION_TIMEOUT",
            recoverable: true,
          },
        },
      },
    });
    assert.equal(gate.allowed, true);
    assert.equal(gate.reason, "recoverable_timeout_retry");
  });

  it("15 duplicate retry blocked while generation is in flight", () => {
    const gate = resolveExecutionGenerationGate({
      action: {
        status: "in_progress",
        session_status: "generating",
        started_at: new Date().toISOString(),
      },
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "EXECUTION_IN_PROGRESS");
  });

  it("16 operation-aware timeout resolver is used by executePreparedAction abort timer", async () => {
    let aborted = false;
    const fetchImpl = async (_url, options) => {
      options?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (options?.signal?.aborted) {
        const error = new Error("Aborted");
        error.name = "AbortError";
        throw error;
      }
      return new Response(JSON.stringify({ output_text: "ok" }), { status: 200 });
    };

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((handler, timeoutMs, ...args) => {
      return originalSetTimeout(handler, Math.min(Number(timeoutMs) || 0, 5), ...args);
    });

    try {
      const result = await executePreparedAction({
        preparation: {
          capabilityType: "project_brain",
          preparedPrompt: "Test prompt",
        },
        acceptedInput: { prompt: "Test prompt" },
        fetchImpl,
        apiKey: "test-key",
        operationContext: {
          projectId: "087bfdc2-5717-46c2-8d91-eec85ae46e4e",
        },
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "timeout");
      assert.ok(typeof result.timeoutMs === "number");
      assert.equal(aborted, true);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it("17 high reasoning requires explicit complexity reason code", () => {
    const policy = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.resultGeneration,
      complexity: { level: "exceptional", signals: [], signalsCount: 0, reasonCode: null },
      operationContext: { strategicOutput: true },
    });
    assert.notEqual(policy.providerReasoningEffort, "high");
    assert.equal(policy.providerReasoningEffort, "medium");
  });

  it("18 standard research mode does not automatically force high reasoning", () => {
    const classified = classifyStrategicResultIntent({
      executionPlan: { mode: "research", title: "Analiză piață" },
    });
    assert.equal(classified.strategicOutput, false);

    const complexity = classifyOpenAiOperationComplexity({
      role: PROJECT_MODEL_ROLES.resultGeneration,
      operationContext: {
        strategicOutput: classified.strategicOutput,
        executionPlanMode: "research",
      },
    });

    const policy = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.resultGeneration,
      complexity,
      operationContext: {
        strategicOutput: classified.strategicOutput,
      },
    });

    assert.equal(policy.providerReasoningEffort, "medium");
    assert.equal(policy.modelTier, "frontier");
  });

  it("19 result token caps remain enforced in runtime policy", () => {
    const policy = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.resultGeneration,
      complexity: { level: "standard", signals: [], signalsCount: 0, reasonCode: null },
      operationContext: { strategicOutput: false },
    });
    assert.equal(policy.maxOutputTokens, 4096);
    assert.equal(policy.maxProviderCalls, 2);
  });

  it("20 provider calls remain bounded to role policy max", () => {
    const policy = resolveProjectModelRuntimePolicy({
      role: PROJECT_MODEL_ROLES.resultGeneration,
      complexity: { level: "complex", signals: ["multi_resource_synthesis"], signalsCount: 1, reasonCode: "complexity_complex" },
      operationContext: { strategicOutput: true, synthesisResourceCount: 2 },
    });
    assert.ok(policy.maxProviderCalls <= 2);
  });

  it("21 stage logger rejects object-valued stage names", () => {
    assert.throws(() => assertValidExecuteStage({ event: "bad" }), /non-empty string/);
    const events = [];
    const usageLogger = createExecuteStageUsageLogger((stage, extra) => {
      assertValidExecuteStage(stage);
      events.push({ stage, extra });
    });
    usageLogger({ event: "project_openai_usage", role: "resultGeneration" });
    assert.equal(events[0]?.stage, "openai_usage");
    assert.throws(() => logExecuteStage({ foo: "bar" }), /non-empty string/);
  });

  it("1 exact persisted timeout state is prepared + ready + recovery metadata", () => {
    const recovery = buildExecutionRecoveryMetadata({
      code: "PROJECT_ACTION_GENERATION_TIMEOUT",
    });
    const persisted = resolvePersistedTimeoutRecoveryState({
      status: "prepared",
      session_status: "ready",
      prepared_input: withExecutionRecovery({}, recovery),
      collected_input: { interactive: { confirmed: true } },
      pending_result_id: null,
    });
    assert.equal(persisted.actionStatus, "prepared");
    assert.equal(persisted.sessionStatus, "ready");
    assert.equal(persisted.recoveryCode, "PROJECT_ACTION_GENERATION_TIMEOUT");
    assert.equal(persisted.resultExists, false);
    assert.equal(persisted.collectedInputPreserved, true);
    assert.equal(persisted.dbLifecycleState, "ready_to_execute");
    assert.equal(persisted.mobileLifecycleState, "recoverable_error");
  });

  it("2 mobile lifecycle recoverable_error is client-only not a DB enum", () => {
    const persisted = resolvePersistedTimeoutRecoveryState({
      status: "prepared",
      session_status: "ready",
      prepared_input: {
        _executionRecovery: { code: "PROJECT_ACTION_GENERATION_TIMEOUT", recoverable: true },
      },
    });
    assert.notEqual(persisted.actionStatus, "recoverable_error");
    assert.equal(persisted.mobileLifecycleState, "recoverable_error");
  });

  it("3 generation claim lock requires prepared status in Supabase filter", () => {
    const source = readFileSync(
      new URL("../lib/projects/brain/actions/repository.js", import.meta.url),
      "utf8",
    );
    assert.match(source, /claimActionGenerationLock/);
    assert.match(source, /status=eq\.prepared/);
  });

  it("7 cross-instance gate is best-effort via persisted row not in-memory", () => {
    const gateSource = readFileSync(
      new URL("../lib/projects/brain/actions/execution-generation-gate.js", import.meta.url),
      "utf8",
    );
    assert.match(gateSource, /session_status === "generating"/);
    assert.match(gateSource, /started_at/);
    assert.doesNotMatch(gateSource, /Map\(/);
    assert.doesNotMatch(gateSource, /global\./);
  });
});
