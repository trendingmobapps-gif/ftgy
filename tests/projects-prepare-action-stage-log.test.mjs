import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  assertValidPrepareStage,
  createPrepareStageUsageLogger,
  logPrepareStage,
} from "../lib/projects/brain/actions/prepare-stage-log.js";
import { logBrainSnapshotEvent } from "../lib/projects/brain/brain-snapshot-observability.js";
import { logProjectBrainDecision } from "../lib/projects/brain/decision/decision-observability.js";
import { logOpenAiUsageEvent } from "../lib/projects/brain/openai-usage-observability.js";

describe("projects-prepare-action stage logging", () => {
  it("1 rejects object-valued stage names", () => {
    assert.throws(() => assertValidPrepareStage({ event: "bad" }), /non-empty string/);
    assert.throws(() => logPrepareStage({ foo: "bar" }), /non-empty string/);
  });

  it("2 Decision Layer logging produces a string stage", () => {
    const events = [];
    const decisionLog = (stage, context) => {
      assertValidPrepareStage(stage);
      events.push({ stage, context });
    };

    logProjectBrainDecision(decisionLog, {
      decision: {
        projectId: "p1",
        stepId: "s1",
        actionId: "a1",
        decisionId: "d1",
        decisionVersion: 1,
        decisionType: "prepare",
        confidence: {},
        userEffort: { questionsRequired: 0, questionsAvoided: 1, estimatedMinutes: 2 },
        policyCompliance: { violations: [] },
      },
      evidence: { knownContext: { memoryRefs: [], resourceRefs: [], resultRefs: [] } },
      decisionReused: false,
      featureFlagEnabled: true,
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].stage, "[ProjectBrainDecision]");
    assert.equal(typeof events[0].stage, "string");
  });

  it("3 execution-plan OpenAI usage logging produces a string stage", () => {
    const events = [];
    const usageLogger = createPrepareStageUsageLogger((stage, extra) => {
      assertValidPrepareStage(stage);
      events.push({ stage, extra });
    });

    logOpenAiUsageEvent(usageLogger, {
      operation: "executionPlan",
      role: "executionPlan",
      model: "gpt-5-mini",
      projectId: "p1",
      stepId: "s1",
      actionId: "a1",
      success: true,
      inputTokens: 100,
      outputTokens: 50,
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].stage, "openai_usage");
    assert.equal(events[0].extra.event, "project_openai_usage");
    assert.equal(events[0].extra.operation, "executionPlan");
  });

  it("4 brain snapshot logging via adapter never emits stage=[object Object]", () => {
    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => {
      lines.push(args.map(String).join(" "));
    };

    try {
      const usageLogger = createPrepareStageUsageLogger(logPrepareStage);
      logBrainSnapshotEvent(usageLogger, {
        projectId: "p1",
        stepId: "s1",
        actionId: "a1",
        artifactType: "action_design",
        evidenceHash: "abc123def456",
        reuseHit: true,
        reuseReason: "unchanged_evidence",
        generationTriggered: false,
      });

      assert.ok(lines.some((line) => line.includes("stage=brain_snapshot")));
      assert.ok(lines.every((line) => !line.includes("stage=[object Object]")));
    } finally {
      console.log = originalLog;
    }
  });

  it("5 service.js wires brain snapshot helpers through prepare structured adapter", () => {
    const source = readFileSync(
      new URL("../lib/projects/brain/actions/service.js", import.meta.url),
      "utf8",
    );
    assert.match(source, /const logPrepareStructuredEvent = createPrepareStageUsageLogger\(logPrepareStage\)/);
    assert.match(source, /logBrainSnapshotEvent\(logPrepareStructuredEvent,/);
    assert.match(source, /logFn: logPrepareStructuredEvent,/);
    assert.doesNotMatch(source, /logBrainSnapshotEvent\(logPrepareStage,/);
  });

  it("6 passing structured payload directly to logPrepareStage is rejected", () => {
    assert.throws(
      () =>
        logPrepareStage({
          event: "project_brain_snapshot",
          projectId: "p1",
        }),
      /non-empty string/,
    );
  });
});
