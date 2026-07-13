import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideExecutionStrategy } from "../lib/projects/brain/execution/decision.js";
import { evaluateWebSearchNeed, applyWebSearchStub } from "../lib/projects/brain/execution/web-search.js";
import {
  extractMemoryFactsFromInput,
  mergeMemoryIntoMissingFields,
  memoryHasKnownField,
} from "../lib/projects/brain/memory/service.js";
import { evaluateWorkflowEvolution } from "../lib/projects/brain/workflow/updater.js";
import { PROJECT_CATEGORY_SLUGS } from "../lib/projects/constants.js";
import { normalizeIntentModelResult } from "../lib/projects/intent-analysis.js";

function buildStep(overrides = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333301",
    title: "Plan financiar inițial",
    description: "Stabilești bugetul și costurile de pornire.",
    expected_outcome: "Un plan financiar clar pentru primele 12 luni.",
    status: "pending",
    tool_id: "plan-de-afaceri",
    ...overrides,
  };
}

describe("adaptive project brain execution decisions", () => {
  it("reuses an existing resource instead of generating again", () => {
    const decision = decideExecutionStrategy({
      project: { goal: "Vreau să deschid o patiserie", category_slug: "business" },
      step: buildStep(),
      preparation: { missingFields: [], capabilityType: "tool", capabilityRef: "plan-de-afaceri" },
      memoryMap: new Map(),
      reusableResource: { id: "res-1", type: "spreadsheet", title: "Buget patiserie" },
    });

    assert.equal(decision.strategy, "reuse_resource");
    assert.equal(decision.reusableResourceId, "res-1");
  });

  it("asks only for unknown fields not already in memory", () => {
    const missing = mergeMemoryIntoMissingFields(
      [{ key: "buget", label: "Buget", required: true }, { key: "locatie", label: "Locație", required: true }],
      new Map([["buget", "80.000 euro"]]),
    );

    assert.deepEqual(missing.map((field) => field.key), ["locatie"]);
    assert.equal(memoryHasKnownField(new Map([["buget", "80.000 euro"]]), "buget"), true);
  });

  it("decides web research only when fresh information is likely required", () => {
    const needed = evaluateWebSearchNeed({
      project: { goal: "Vreau autorizații și taxe pentru o patiserie" },
      step: buildStep({ title: "Cerințe legale locale" }),
    });
    const skipped = evaluateWebSearchNeed({
      project: { goal: "Vreau să învăț engleză" },
      step: buildStep({ title: "Test de plasament" }),
    });

    assert.equal(needed.shouldSearch, true);
    assert.equal(skipped.shouldSearch, false);
    assert.equal(applyWebSearchStub({ requiresWebSearch: true }).executed, false);
  });

  it("evolves workflow by skipping obsolete pending steps", () => {
    const completedStep = buildStep({ id: "step-1", status: "completed" });
    const obsolete = buildStep({
      id: "step-2",
      title: "Plan financiar inițial",
      expected_outcome: "Un plan financiar clar pentru primele 12 luni.",
      status: "pending",
    });

    const evolution = evaluateWorkflowEvolution({
      bundle: { steps: [completedStep, obsolete], workflow: { id: "wf-1" } },
      completedStep,
      acceptedResource: { title: "Plan financiar inițial", preview: "Buget și costuri estimate" },
      memoryMap: new Map([["buget", "80.000 euro"]]),
    });

    assert.equal(evolution.changes.length, 1);
    assert.equal(evolution.changes[0].type, "skip_step");
    assert.equal(evolution.changes[0].stepId, "step-2");
  });
});

describe("adaptive project brain categories and memory", () => {
  it("supports universal category slug", () => {
    assert.equal(PROJECT_CATEGORY_SLUGS.includes("universal"), true);
  });

  it("falls back to universal when model category is invalid", () => {
    const normalized = normalizeIntentModelResult(
      {
        status: "ready",
        categorySlug: "unknown-category",
        confidence: 0.42,
        suggestedName: "Proiect personalizat",
      },
      { goal: "Vreau să organizez o expoziție de artă contemporană" },
    );

    assert.equal(normalized.ok, true);
    assert.equal(normalized.payload.categorySlug, "universal");
  });

  it("extracts memory facts from collected session input", () => {
    const facts = extractMemoryFactsFromInput(
      { buget: "80.000 euro", locatie: "Timișoara" },
      { name: "Patiserie", goal: "Deschid o patiserie premium" },
    );

    assert.equal(facts.buget, "80.000 euro");
    assert.equal(facts.locatie, "Timișoara");
    assert.equal(facts.nume, "Patiserie");
  });
});
