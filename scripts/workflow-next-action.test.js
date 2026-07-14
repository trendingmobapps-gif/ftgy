import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TOOLS } from "../tools/tools-config.js";
import {
  resolveGeneratedNextAction,
  resolveWorkflowForTool,
} from "../workflows/resolve-next-action.js";

function resolve(toolSlug, options = {}) {
  return resolveGeneratedNextAction({
    toolSlug,
    categorySlug: options.categorySlug,
    workflowContext: options.workflowContext,
    getToolConfig: (slug) => TOOLS[slug] || null,
  });
}

describe("backend next action resolution", () => {
  it("returns next action for mapped tool with deterministic next step", () => {
    const result = resolve("plan-de-afaceri", { categorySlug: "business" });

    assert.ok(result.nextAction);
    assert.equal(result.nextAction.workflowId, "business-start-a-business");
    assert.equal(result.nextAction.sourceToolSlug, "plan-de-afaceri");
    assert.ok(result.nextAction.toolSlug);
    assert.equal(result.nextAction.isOptional, true);
  });

  it("returns null for standalone tool", () => {
    const result = resolve("generator-hook-tiktok", { categorySlug: "business" });
    assert.equal(result.nextAction, null);
  });

  it("returns null for ambiguous tool without priority tie-breaker", () => {
    const resolution = resolveWorkflowForTool("generator-landing-page");
    assert.equal(resolution.status, "resolved");
  });

  it("returns completion state on final workflow step", () => {
    const result = resolve("generator-cta", {
      categorySlug: "business",
      workflowContext: { workflowId: "business-create-commercial-offer" },
    });

    assert.equal(result.nextAction, null);
    assert.ok(result.workflowCompletion);
  });

  it("returns null for invalid tool", () => {
    const result = resolve("non-existent-tool");
    assert.equal(result.nextAction, null);
  });

  it("returns null when target tool category mismatches", () => {
    const result = resolve("plan-de-afaceri", { categorySlug: "studii" });
    assert.equal(result.nextAction, null);
  });

  it("ignores invalid workflow context safely", () => {
    const result = resolve("plan-de-afaceri", {
      categorySlug: "business",
      workflowContext: { workflowId: "studii-learn-a-lesson" },
    });

    assert.equal(result.nextAction, null);
  });

  it("uses valid workflow context for continuation", () => {
    const first = resolve("plan-de-afaceri", {
      categorySlug: "business",
      workflowContext: { workflowId: "business-start-a-business" },
    });

    assert.ok(first.nextAction);

    const second = resolve(first.nextAction.toolSlug, {
      categorySlug: "business",
      workflowContext: { workflowId: first.nextAction.workflowId },
    });

    assert.ok(second.nextAction || second.workflowCompletion);
  });

  it("workflow continuation across three mapped tools", () => {
    const stepA = resolve("generator-oferta-comerciala", {
      categorySlug: "business",
      workflowContext: { workflowId: "business-create-commercial-offer" },
    });

    assert.ok(stepA.nextAction);
    assert.equal(stepA.nextAction.toolSlug, "generator-pret-serviciu");

    const stepB = resolve(stepA.nextAction.toolSlug, {
      categorySlug: "business",
      workflowContext: { workflowId: stepA.nextAction.workflowId },
    });

    assert.ok(stepB.nextAction);
    assert.equal(stepB.nextAction.toolSlug, "generator-cta");
  });
});
