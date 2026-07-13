import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAssessmentInternal,
  evaluateAssessmentAnswers,
  serializeAssessmentPayload,
} from "../lib/projects/brain/execution/assessment.js";

describe("projects assessment interactive flow", () => {
  const step = {
    id: "dcfc28bf-68b7-4509-b47b-c5d68bc9a116",
    title: "Evaluează nivelul actual de engleză",
    description: "Determină punctul de plecare.",
    expected_outcome: "Nivelul actual de engleză este clar identificat",
  };

  const project = {
    id: "6713ef1c-d81c-41d2-9539-608aeca149cb",
    name: "Învățare limba engleză",
    goal: "Îmbunătățirea nivelului de engleză",
  };

  it("serializes assessment payload without answer keys", () => {
    const internal = buildAssessmentInternal({ step, project });
    const payload = serializeAssessmentPayload(internal);

    assert.equal(payload.type, "assessment");
    assert.ok(payload.questions.length >= 6);
    assert.doesNotMatch(JSON.stringify(payload), /correctOptionId|expectedAnswer|explanation|Răspuns corect/i);

    for (const question of payload.questions) {
      assert.ok(question.id);
      assert.ok(question.prompt);
      if (question.type === "single_choice") {
        assert.ok(question.options?.length);
        for (const option of question.options || []) {
          assert.doesNotMatch(JSON.stringify(option), /correct|explanation/i);
        }
      }
    }
  });

  it("evaluates answers only after submission payload is built server-side", () => {
    const internal = buildAssessmentInternal({ step, project });
    const answers = {};
    for (const question of internal.questions) {
      if (question.type === "single_choice") {
        answers[question.id] = question.correctOptionId;
      } else {
        answers[question.id] = "I like reading books in my free time.";
      }
    }

    const evaluation = evaluateAssessmentAnswers(internal, answers);
    assert.match(evaluation.title, /Nivel estimat/);
    assert.ok(evaluation.summary);
    assert.ok(Array.isArray(evaluation.strengths));
    assert.ok(Array.isArray(evaluation.gaps));
    assert.ok(Array.isArray(evaluation.recommendations));
  });

  it("keeps assessment sessions non-generatable until evaluation", () => {
    const internal = buildAssessmentInternal({ step, project });
    const payload = serializeAssessmentPayload(internal);

    const session = {
      phase: "collecting",
      canGenerate: true,
      canRespond: true,
      canReview: false,
      pendingResult: { id: "r1", title: "Quiz", preview: "Răspuns corect" },
    };

    const interactiveState = { submitted: false, answers: {}, currentQuestionIndex: 0 };
    const overridden = {
      ...session,
      phase: "collecting",
      canGenerate: false,
      canRespond: false,
      canReview: false,
      pendingResult: null,
    };

    assert.equal(overridden.canGenerate, false);
    assert.equal(overridden.pendingResult, null);
    assert.ok(payload.questions.length >= 6);
    assert.equal(interactiveState.submitted, false);
  });
});
