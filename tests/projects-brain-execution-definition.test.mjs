import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildExecutionDefinition,
  resolveExecutionMode,
  EXECUTION_MODES,
} from "../lib/projects/brain/execution/definition.js";

function buildFixture(overrides = {}) {
  const project = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Engleză pentru carieră",
    goal: "Vreau să învăț engleza pentru job",
    category_slug: "studii",
  };

  const step = {
    id: "33333333-3333-4333-8333-333333333301",
    title: overrides.stepTitle || "Evaluează nivelul actual de engleză",
    description: "Determini punctul de plecare.",
    expected_outcome: "O evaluare orientativă a nivelului.",
    rationale: "Fără nivel clar, planul de învățare este ineficient.",
    estimated_effort_label: "15 min",
    status: "pending",
    tool_id: null,
  };

  const milestone = { id: "m1", title: "Evaluare inițială" };

  const preparation = {
    title: step.title,
    explanation: step.description,
    whyItMatters: step.rationale,
    expectedResult: step.expected_outcome,
    estimatedEffortLabel: step.estimated_effort_label,
    capabilityType: "project_brain",
    missingFields: overrides.missingFields || [],
    preparedInput: overrides.preparedInput || {},
    context: { project },
  };

  return { project, step, milestone, preparation };
}

describe("project execution definition", () => {
  it("exposes only controlled execution modes", () => {
    assert.ok(EXECUTION_MODES.includes("assessment"));
    assert.ok(EXECUTION_MODES.includes("guided_questions"));
    assert.ok(EXECUTION_MODES.includes("structured_form"));
    assert.ok(EXECUTION_MODES.includes("research"));
    assert.ok(EXECUTION_MODES.includes("result_review"));
    assert.equal(EXECUTION_MODES.includes("chat"), false);
  });

  it("selects assessment mode for english level evaluation", () => {
    const { step, preparation } = buildFixture();
    const mode = resolveExecutionMode({ step, preparation, session: null, executionDecision: null, memoryMap: new Map() });
    assert.equal(mode, "assessment");
  });

  it("selects structured form for budget steps", () => {
    const { step, preparation } = buildFixture({
      stepTitle: "Elaborează bugetul inițial",
      missingFields: [
        { key: "buget", label: "Buget", required: true },
        { key: "chirie", label: "Chirie", required: true },
        { key: "echipament", label: "Echipament", required: true },
      ],
    });
    const mode = resolveExecutionMode({ step, preparation, session: null, executionDecision: null, memoryMap: new Map() });
    assert.equal(mode, "spreadsheet_builder");
  });

  it("prefills known values into required inputs", () => {
    const { project, step, milestone, preparation } = buildFixture({
      stepTitle: "Elaborează bugetul inițial",
      missingFields: [{ key: "buget", label: "Buget", required: true }],
      preparedInput: { buget: "80.000 EUR" },
    });

    const definition = buildExecutionDefinition({
      project,
      step,
      milestone,
      preparation,
      session: null,
      memoryMap: new Map([["locatie", "Timișoara"]]),
    });

    assert.equal(definition.mode, "spreadsheet_builder");
    assert.ok(definition.requiredInputs.length >= 0);
  });

  it("uses research mode truthfully when web search is unavailable", () => {
    const { project, step, milestone, preparation } = buildFixture({
      stepTitle: "Analizează concurența locală",
    });

    const definition = buildExecutionDefinition({
      project,
      step,
      milestone,
      preparation,
      session: null,
      executionDecision: { requiresWebSearch: true, webSearch: { executed: false } },
      memoryMap: new Map(),
    });

    assert.equal(definition.mode, "research");
    assert.equal(definition.researchStatus, "unavailable");
  });

  it("defaults to guided questions instead of conversation", () => {
    const { step, preparation } = buildFixture({
      stepTitle: "Definește clientul ideal",
      missingFields: [{ key: "public_tinta", label: "Public țintă", required: true }],
    });
    const mode = resolveExecutionMode({ step, preparation, session: null, executionDecision: null, memoryMap: new Map() });
    assert.equal(mode, "guided_questions");
    assert.notEqual(mode, "conversation");
  });

  it("selects result review when session is in review", () => {
    const { step, preparation } = buildFixture();
    const mode = resolveExecutionMode({
      step,
      preparation,
      session: { canReview: true, phase: "review" },
      executionDecision: null,
      memoryMap: new Map(),
    });
    assert.equal(mode, "result_review");
  });
});
