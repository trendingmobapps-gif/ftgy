import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  defaultRequireGeneratedResultForMode,
  REQUIRE_GENERATED_RESULT_DEFAULTS,
} from "../lib/projects/brain/execution/completion-defaults.js";
import { validateStepCompletion } from "../lib/projects/brain/execution/completion-evaluator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("centralized completion-criteria defaults", () => {
  it("exposes one table shared by generator and evaluator", () => {
    assert.equal(REQUIRE_GENERATED_RESULT_DEFAULTS.checklist, false);
    assert.equal(REQUIRE_GENERATED_RESULT_DEFAULTS.structured_form, true);
    assert.equal(REQUIRE_GENERATED_RESULT_DEFAULTS.guided_questions, true);
    assert.equal(REQUIRE_GENERATED_RESULT_DEFAULTS.result_review, false);
    assert.equal(defaultRequireGeneratedResultForMode("generator"), true);
    assert.equal(defaultRequireGeneratedResultForMode(null), false);
    assert.equal(defaultRequireGeneratedResultForMode("unknown_future_mode"), true);
  });

  it("evaluator resolves absent criteria through the table (guided requires a result)", () => {
    const result = validateStepCompletion({
      plan: {
        mode: "guided_questions",
        questions: [{ id: "q1", required: true }],
        completionCriteria: null,
      },
      collectedInput: {
        interactive: { type: "guided_questions", guidedAnswers: { q1: "Da" } },
      },
    });
    assert.equal(result.canFinalize, false);
    assert.ok(
      result.missingRequirements.some((row) => row.code === "REQUIRED_GENERATED_RESULT"),
      "guided plan without explicit criteria must require a generated result",
    );
  });

  it("explicit criteria always win over the table", () => {
    const result = validateStepCompletion({
      plan: {
        mode: "guided_questions",
        questions: [{ id: "q1", required: true }],
        completionCriteria: {
          requireGeneratedResult: false,
          requireUserAcceptance: false,
          requireExplicitFinalize: true,
        },
      },
      collectedInput: {
        interactive: { type: "guided_questions", guidedAnswers: { q1: "Da" } },
      },
    });
    assert.equal(result.canFinalize, true);
  });

  it("plan generator and evaluator both import the shared table", () => {
    const generator = read("lib/projects/brain/execution/execution-plan-generator.js");
    const evaluator = read("lib/projects/brain/execution/completion-evaluator.js");
    assert.match(generator, /from "\.\/completion-defaults\.js"/);
    assert.match(evaluator, /from "\.\/completion-defaults\.js"/);
    assert.match(generator, /defaultRequireGeneratedResultForMode\(mode\)/);
    assert.match(evaluator, /defaultRequireGeneratedResultForMode\(plan\?\.mode\)/);
  });
});

describe("deterministic refresh and result evidence", () => {
  it("accepted result evidence persists through collected_input for later refreshes", () => {
    const result = validateStepCompletion({
      plan: {
        mode: "generator",
        completionCriteria: {
          requireGeneratedResult: true,
          requireUserAcceptance: true,
          requireUserReview: true,
        },
      },
      collectedInput: {
        interactive: {
          type: "generator",
          resultAccepted: true,
          acceptedResultId: "res-1",
          generatedResultId: "res-1",
        },
      },
      acceptedResult: null,
      pendingResult: null,
    });
    assert.equal(result.canFinalize, true, "refresh after accept must stay finalize-ready");
  });

  it("review-accept persists generatedResultId alongside acceptedResultId", () => {
    const source = read("lib/projects/brain/actions/service.js");
    assert.match(source, /acceptedResultId: resultId,[\s\S]{0,220}generatedResultId: resultId,/);
  });

  it("prepare re-runs the completion evaluator and promotes ready sessions deterministically", () => {
    const source = read("lib/projects/brain/execution/interactive.js");
    assert.match(source, /completionEnvelope = validateStepCompletion\(/);
    assert.match(source, /phase: "ready_to_finalize",\s*\n\s*canFinalize: true/);
    assert.match(source, /canFinalize: completionEnvelope \? completionEnvelope\.canFinalize : undefined/);
    assert.match(
      source,
      /missingRequirements: completionEnvelope \? completionEnvelope\.missingRequirements : undefined/,
    );
  });
});

describe("consistent lifecycle envelopes", () => {
  const service = read("lib/projects/brain/actions/service.js");

  it("execute response carries canFinalize + missingRequirements", () => {
    assert.match(
      service,
      /requiresReview: true,\s*\n\s*canFinalize: executeCompletion\.canFinalize,\s*\n\s*missingRequirements: executeCompletion\.missingRequirements,/,
    );
  });

  it("review accept, reject and improve responses carry the envelope", () => {
    assert.match(service, /canFinalize: completion\.canFinalize/);
    assert.match(service, /canFinalize: rejectCompletion\.canFinalize/);
    assert.match(service, /canFinalize: improveCompletion\.canFinalize/);
  });

  it("progress save response keeps the envelope and backend-authoritative phase override", () => {
    assert.match(service, /phaseOverride: validation\.canFinalize \? "ready_to_finalize" : undefined/);
    assert.match(service, /canFinalize: validation\.canFinalize,\s*\n\s*missingRequirements: validation\.missingRequirements,/);
  });

  it("finalize still rejects incomplete steps with missing requirements", () => {
    assert.match(service, /code: "STEP_INCOMPLETE",\s*\n\s*missingRequirements: validation\.missingRequirements,/);
  });
});
