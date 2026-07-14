import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildActiveExecutionContract,
  validateActiveExecutionContract,
} from "../lib/projects/brain/execution/active-execution-contract.js";
import {
  canSafelySanitizeLegacySession,
  hasLegacySessionConflict,
  shouldReplaceIncompatiblePreparedAction,
} from "../lib/projects/brain/actions/action-lifecycle.js";
import { serializeSession } from "../lib/projects/brain/actions/session.js";
import { sanitizeSessionForExecutionMode } from "../lib/projects/brain/execution/interactive.js";

const uploadPlan = {
  mode: "upload_and_review",
  title: "Încarcă materialele de studiu",
  requiredInputs: [],
  metadata: { version: 2, source: "openai" },
};

const structuredFormPlan = {
  mode: "structured_form",
  title: "Completează datele",
  fields: [{ id: "subject", label: "Materia", type: "text", required: true }],
  requiredInputs: [{ id: "subject", label: "Materia", type: "text", required: true }],
  metadata: { version: 2, source: "openai" },
};

const generatorPlan = {
  mode: "generator",
  title: "Generează planul",
  requiredInputs: [],
  metadata: { version: 2, source: "openai" },
};

const guidedPlan = {
  mode: "guided_questions",
  title: "Întrebări ghidate",
  questions: [{ id: "q1", prompt: "Când estimezi examenul?", required: true }],
  requiredInputs: [],
  metadata: { version: 2, source: "openai" },
};

function actionWithLegacyPending(mode) {
  return {
    id: "a1",
    status: "prepared",
    pending_question: { key: "materie", label: "Materie" },
    missing_fields: [{ key: "materie", label: "Materie", required: true }],
    prepared_input: { _executionPlan: { mode, metadata: { version: 2 } } },
    conversation: [{ role: "assistant", type: "opening", content: "Hi" }],
    session_status: "collecting",
    collected_input: { materie: "Anatomie" },
  };
}

describe("projects execution session conflict repair", () => {
  it("1. upload_and_review clears legacy pendingQuestion and validates", () => {
    const action = actionWithLegacyPending("upload_and_review");
    const sanitized = sanitizeSessionForExecutionMode({
      actionRow: action,
      executionPlan: uploadPlan,
      preparation: { expectedResult: "Rezultat" },
    });

    assert.equal(sanitized.session.pendingQuestion, null);
    assert.equal(sanitized.session.canRespond, false);
    assert.equal(sanitized.sanitized, true);
    assert.equal(sanitized.hadLegacyPendingQuestion, true);

    const contract = buildActiveExecutionContract({
      projectId: "p1",
      stepId: "s1",
      action: { actionId: "a1", id: "a1" },
      session: sanitized.session,
      executionPlan: uploadPlan,
      executionDefinition: { mode: "upload_and_review", title: uploadPlan.title, requiredInputs: [] },
      interactivePayload: null,
    });

    const validation = validateActiveExecutionContract({
      ...contract,
      actionId: "a1",
      session: { ...sanitized.session, sessionId: "a1" },
    });
    assert.equal(validation.valid, true);
  });

  it("2. resumed upload_and_review preserves collected progress when sanitized", () => {
    const action = actionWithLegacyPending("upload_and_review");
    action.prepared_input._executionPlan = uploadPlan;

    assert.equal(hasLegacySessionConflict(action, uploadPlan), true);
    assert.equal(canSafelySanitizeLegacySession(action, uploadPlan), true);
    assert.equal(
      shouldReplaceIncompatiblePreparedAction({
        step: { status: "active" },
        action,
        executionPlan: uploadPlan,
      }),
      false,
    );

    const sanitized = sanitizeSessionForExecutionMode({
      actionRow: action,
      executionPlan: uploadPlan,
      preparation: { expectedResult: "Rezultat" },
    });

    assert.equal(sanitized.session.pendingQuestion, null);
    assert.equal(action.collected_input.materie, "Anatomie");
  });

  it("3. structured_form uses plan inputs without legacy pending question", () => {
    const action = actionWithLegacyPending("structured_form");
    const payload = { type: "structured_form", fields: structuredFormPlan.fields };

    const sanitized = sanitizeSessionForExecutionMode({
      actionRow: action,
      executionPlan: structuredFormPlan,
      interactivePayload: payload,
      preparation: { expectedResult: "Rezultat" },
    });

    assert.equal(sanitized.session.pendingQuestion, null);

    const contract = buildActiveExecutionContract({
      projectId: "p1",
      stepId: "s1",
      action: { actionId: "a1", id: "a1" },
      session: sanitized.session,
      executionPlan: structuredFormPlan,
      executionDefinition: {
        mode: "structured_form",
        title: structuredFormPlan.title,
        requiredInputs: structuredFormPlan.requiredInputs,
      },
      interactivePayload: payload,
    });

    const validation = validateActiveExecutionContract({
      ...contract,
      actionId: "a1",
      session: { ...sanitized.session, sessionId: "a1" },
    });
    assert.equal(validation.valid, true);
  });

  it("4. generator clears legacy pending question", () => {
    const action = actionWithLegacyPending("generator");
    const sanitized = sanitizeSessionForExecutionMode({
      actionRow: action,
      executionPlan: generatorPlan,
      preparation: { expectedResult: "Rezultat" },
    });

    assert.equal(sanitized.session.pendingQuestion, null);
    assert.equal(sanitized.session.canRespond, false);
  });

  it("5. conversation mode may keep pending question", () => {
    const action = actionWithLegacyPending("conversation");
    action.prepared_input._executionPlan = { mode: "conversation", metadata: { version: 2 } };

    const session = serializeSession({
      action,
      preparation: { expectedResult: "Rezultat" },
      executionPlan: { mode: "conversation" },
    });

    assert.equal(session.pendingQuestion?.key, "materie");
    assert.equal(session.canRespond, true);
  });

  it("6. guided_questions uses interactive payload not tool missingFields", () => {
    const action = actionWithLegacyPending("guided_questions");
    const payload = { type: "guided_questions", questions: guidedPlan.questions };

    const sanitized = sanitizeSessionForExecutionMode({
      actionRow: action,
      executionPlan: guidedPlan,
      interactivePayload: payload,
      preparation: { expectedResult: "Rezultat" },
    });

    assert.equal(sanitized.session.pendingQuestion, null);

    const contract = buildActiveExecutionContract({
      projectId: "p1",
      stepId: "s1",
      action: { actionId: "a1", id: "a1" },
      session: sanitized.session,
      executionPlan: guidedPlan,
      executionDefinition: {
        mode: "guided_questions",
        title: guidedPlan.title,
        requiredInputs: [],
      },
      interactivePayload: payload,
    });

    const validation = validateActiveExecutionContract({
      ...contract,
      actionId: "a1",
      session: { ...sanitized.session, sessionId: "a1" },
    });
    assert.equal(validation.valid, true);
    assert.equal(contract.interactivePayload.questions.length, 1);
  });

  it("7. rejects non-conversation contract with pendingQuestion after failed sanitization", () => {
    const contract = buildActiveExecutionContract({
      projectId: "p1",
      stepId: "s1",
      action: { actionId: "a1", id: "a1" },
      session: {
        sessionId: "a1",
        phase: "collecting",
        pendingQuestion: { key: "materie", label: "Materie" },
        canRespond: true,
        canGenerate: false,
      },
      executionPlan: uploadPlan,
      executionDefinition: { mode: "upload_and_review", title: uploadPlan.title, requiredInputs: [] },
      interactivePayload: null,
    });

    const validation = validateActiveExecutionContract({
      ...contract,
      actionId: "a1",
    });
    assert.equal(validation.valid, false);
    assert.equal(validation.reason, "legacy_pending_question_conflict");
  });

  it("8. upload mode canGenerate is not blocked by legacy missingFields alone", () => {
    const action = actionWithLegacyPending("upload_and_review");
    const sanitized = sanitizeSessionForExecutionMode({
      actionRow: action,
      executionPlan: uploadPlan,
      preparation: { expectedResult: "Rezultat", missingFields: [{ key: "materie", label: "Materie" }] },
    });

    assert.equal(sanitized.session.canGenerate, true);
    assert.equal(sanitized.session.pendingQuestion, null);
  });
});
