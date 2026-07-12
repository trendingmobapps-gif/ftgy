import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendUserAnswer,
  buildSessionOpening,
  resolveNextQuestion,
  serializeSession,
} from "../lib/projects/brain/actions/session.js";
import { buildActionPreparation } from "../lib/projects/brain/actions/prompt-builder.js";
import { validateSessionRespondRequest, validateSessionReviewRequest } from "../lib/projects/brain/actions/validation.js";

function buildFixture() {
  const project = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Patiserie premium",
    goal: "Vreau să deschid o patiserie premium în Timișoara, buget 80.000 €",
    summary: "Plan pentru deschiderea unei patiserii premium.",
    description: null,
    category_slug: "business",
  };

  const workflow = {
    id: "22222222-2222-4222-8222-222222222222",
    summary: "Plan structurat pentru deschiderea unei patiserii.",
    current_stage: "Concept și poziționare",
    complexity: "medium",
  };

  const milestone = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Clarificarea conceptului",
    description: "Definești direcția patiseriei.",
  };

  const step = {
    id: "33333333-3333-4333-8333-333333333301",
    milestone_id: milestone.id,
    project_id: project.id,
    title: "Plan financiar inițial",
    description: "Stabilești bugetul și costurile de pornire.",
    expected_outcome: "Un plan financiar clar pentru primele 12 luni.",
    rationale: "Fără claritate financiară, deciziile de deschidere devin riscante.",
    estimated_effort_label: "45 min",
    status: "pending",
    tool_id: "plan-de-afaceri",
    tool_slug: "plan-de-afaceri",
    tool_name: "Plan de Afaceri",
    tool_category_slug: "business",
  };

  return { project, workflow, milestone, step };
}

describe("project ai sessions", () => {
  it("opens session with project context and minimal questions", () => {
    const { project, workflow, milestone, step } = buildFixture();
    const preparation = buildActionPreparation({
      project,
      workflow,
      milestone,
      step,
      steps: [step],
      resultsByStepId: new Map(),
    });

    const opening = buildSessionOpening({ project, step, preparation });
    assert.ok(opening.messages.length >= 2);
    assert.match(opening.messages[0].content, /Patiserie premium/i);
    assert.match(opening.messages[1].content, /Plan financiar inițial/i);

    const asksBudget = opening.pendingQuestion?.key === "buget";
    const readyWithoutQuestions = opening.phase === "ready";
    assert.equal(asksBudget || readyWithoutQuestions, true);
  });

  it("reuses collected input and never asks the same field twice", () => {
    const { project, workflow, milestone, step } = buildFixture();
    const preparation = buildActionPreparation({
      project,
      workflow,
      milestone,
      step,
      steps: [step],
      resultsByStepId: new Map(),
    });

    const opening = buildSessionOpening({ project, step, preparation });
    if (!opening.pendingQuestion) {
      assert.equal(opening.phase, "ready");
      return;
    }

    const answered = appendUserAnswer({
      conversation: opening.messages,
      pendingQuestion: opening.pendingQuestion,
      message: "80.000 euro",
      collectedInput: opening.collectedInput,
    });

    const next = resolveNextQuestion({
      preparation,
      collectedInput: answered.collectedInput,
    });

    assert.notEqual(next.pendingQuestion?.key, opening.pendingQuestion.key);
    if (next.pendingQuestion) {
      assert.notEqual(answered.collectedInput[next.pendingQuestion.key], undefined);
    }
  });

  it("serializes review phase with pending result", () => {
    const action = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      session_status: "review",
      conversation: [{ role: "assistant", type: "review", content: "Accepti?" }],
      pending_question: null,
      expected_result: "Un plan financiar clar",
      title: "Plan financiar inițial",
    };

    const pendingResult = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "Plan financiar",
      preview: "Buget estimativ...",
      acceptance_status: "pending_review",
    };

    const session = serializeSession({
      action,
      preparation: { expectedResult: action.expected_result },
      pendingResult,
    });

    assert.equal(session.phase, "review");
    assert.equal(session.canReview, true);
    assert.equal(session.pendingResult.acceptanceStatus, "pending_review");
  });

  it("validates session respond and review requests", () => {
    const respondValid = validateSessionRespondRequest({
      projectId: "44444444-4444-4444-8444-444444444444",
      stepId: "33333333-3333-4333-8333-333333333301",
      actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      message: "80.000 euro",
    });
    assert.equal(respondValid.ok, true);

    const reviewAccept = validateSessionReviewRequest({
      projectId: "44444444-4444-4444-8444-444444444444",
      stepId: "33333333-3333-4333-8333-333333333301",
      actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      resultId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      decision: "accept",
    });
    assert.equal(reviewAccept.ok, true);

    const reviewReject = validateSessionReviewRequest({
      projectId: "44444444-4444-4444-8444-444444444444",
      stepId: "33333333-3333-4333-8333-333333333301",
      actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      resultId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      decision: "reject",
    });
    assert.equal(reviewReject.ok, true);
  });
});
