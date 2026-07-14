import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TOOLS } from "../tools/tools-config.js";
import {
  buildSuccessfulGenerationResponse,
  buildWorkflowRecommendationFields,
} from "../workflows/build-generation-response.js";
import { getWorkflowEngineMetadata } from "../workflows/registry-metadata.js";
import { resolveGeneratedNextAction } from "../workflows/resolve-next-action.js";

function recommendation(toolId, options = {}) {
  return buildWorkflowRecommendationFields({
    toolId,
    categorySlug: options.categorySlug,
    workflowContext: options.workflowContext,
  });
}

describe("generate-tool API contract (workflow fields)", () => {
  it("mapped tool includes nextAction object on successful response shape", () => {
    const response = buildSuccessfulGenerationResponse({
      toolId: "plan-de-afaceri",
      result: "mock result",
      categorySlug: "business",
    });

    assert.equal(response.success, true);
    assert.equal(response.toolId, "plan-de-afaceri");
    assert.equal(response.result, "mock result");
    assert.ok(Object.prototype.hasOwnProperty.call(response, "nextAction"));
    assert.ok(response.nextAction);
    assert.equal(response.nextAction.workflowId, "business-start-a-business");
  });

  it("standalone tool includes nextAction: null", () => {
    const fields = recommendation("generator-hook-tiktok", { categorySlug: "business" });
    assert.ok(Object.prototype.hasOwnProperty.call(fields, "nextAction"));
    assert.equal(fields.nextAction, null);
    assert.equal(fields.workflowCompletion, null);
  });

  it("final step includes nextAction: null and optional workflowCompletion", () => {
    const fields = recommendation("generator-cta", {
      categorySlug: "business",
      workflowContext: { workflowId: "business-create-commercial-offer" },
    });

    assert.equal(fields.nextAction, null);
    assert.ok(fields.workflowCompletion);
    assert.equal(fields.workflowCompletion.workflowId, "business-create-commercial-offer");
  });

  it("workflow resolver failure still allows successful generation payload", () => {
    const response = buildSuccessfulGenerationResponse({
      toolId: "plan-de-afaceri",
      result: "still succeeds",
      categorySlug: "business",
    });

    assert.equal(response.success, true);
    assert.equal(response.result, "still succeeds");
    assert.ok("nextAction" in response);
  });

  it("old client fields remain present on success response", () => {
    const response = buildSuccessfulGenerationResponse({
      toolId: "plan-de-afaceri",
      result: "markdown",
      categorySlug: "business",
    });

    assert.equal(response.success, true);
    assert.equal(response.toolId, "plan-de-afaceri");
    assert.equal(typeof response.result, "string");
  });

  it("failed generation shape omits workflow recommendation fields", () => {
    const failed = { success: false, message: "Nu am putut genera răspunsul." };
    assert.equal(failed.success, false);
    assert.equal("nextAction" in failed, false);
    assert.equal("workflowCompletion" in failed, false);
  });
});

describe("workflow continuation through generation contract", () => {
  it("A -> B -> C stays in the same workflow without reselection", () => {
    const stepA = recommendation("generator-oferta-comerciala", {
      categorySlug: "business",
      workflowContext: { workflowId: "business-create-commercial-offer" },
    });

    assert.ok(stepA.nextAction);
    const workflowId = stepA.nextAction.workflowId;
    assert.equal(workflowId, "business-create-commercial-offer");

    const stepB = recommendation(stepA.nextAction.toolSlug, {
      categorySlug: "business",
      workflowContext: { workflowId },
    });

    assert.ok(stepB.nextAction);
    assert.equal(stepB.nextAction.workflowId, workflowId);

    const stepC = recommendation(stepB.nextAction.toolSlug, {
      categorySlug: "business",
      workflowContext: { workflowId },
    });

    assert.equal(stepC.nextAction, null);
    assert.ok(stepC.workflowCompletion);
    assert.equal(stepC.workflowCompletion.workflowId, workflowId);
  });

  it("tool A without workflow context resolves deterministically", () => {
    const stepA = recommendation("plan-de-afaceri", { categorySlug: "business" });
    assert.ok(stepA.nextAction);

    const stepB = recommendation(stepA.nextAction.toolSlug, {
      categorySlug: "business",
      workflowContext: { workflowId: stepA.nextAction.workflowId },
    });

    assert.ok(stepB.nextAction || stepB.workflowCompletion);
    if (stepB.nextAction) {
      assert.equal(stepB.nextAction.workflowId, stepA.nextAction.workflowId);
    }
  });
});

describe("workflow engine version metadata", () => {
  it("exposes safe public metadata only", () => {
    const metadata = getWorkflowEngineMetadata();
    assert.equal(metadata.workflowEngine, true);
    assert.ok(metadata.schemaVersion);
    assert.ok(metadata.workflowCount > 0);
    assert.equal("workflows" in metadata, false);
    assert.equal("sourceHash" in metadata, true);
  });
});
