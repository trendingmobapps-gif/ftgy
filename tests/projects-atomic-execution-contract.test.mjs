import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildActiveExecutionContract,
  validateActiveExecutionContract,
  validateContractRenderability,
} from "../lib/projects/brain/execution/active-execution-contract.js";
import {
  getPersistedExecutionPlan,
  isActionCompatibleWithPlan,
  shouldReplaceIncompatiblePreparedAction,
  shouldResumeExistingAction,
} from "../lib/projects/brain/actions/action-lifecycle.js";
import { serializeInteractivePayloadFromPlan } from "../lib/projects/brain/execution/execution-plan-generator.js";

const guidedPlan = {
  mode: "guided_questions",
  title: "Configurează planul modular de studiu USMLE",
  questions: [
    { id: "q1", prompt: "Când estimezi examenul?", required: true },
    { id: "q2", prompt: "Câte ore pe zi?", required: true },
    { id: "q3", prompt: "Ce materii prioritizezi?", required: true },
    { id: "q4", prompt: "Ce resurse ai deja?", required: true },
  ],
  requiredInputs: [],
  metadata: { version: 2, source: "openai", generatedAt: "2026-07-14T00:00:00.000Z" },
};

describe("projects atomic execution contract", () => {
  it("1. rejects mixed plan/definition modes", () => {
    const contract = buildActiveExecutionContract({
      projectId: "p1",
      stepId: "s1",
      action: { actionId: "a1", id: "a1" },
      session: { sessionId: "a1", phase: "collecting" },
      executionPlan: { mode: "guided_questions" },
      executionDefinition: { mode: "generator", title: "x", requiredInputs: [] },
      interactivePayload: null,
    });
    const validation = validateActiveExecutionContract(contract);
    assert.equal(validation.valid, false);
    assert.equal(validation.reason, "plan_definition_mode_mismatch");
  });

  it("2. rejects mixed payload type", () => {
    const contract = buildActiveExecutionContract({
      projectId: "p1",
      stepId: "s1",
      action: { actionId: "a1", id: "a1" },
      session: { sessionId: "a1", phase: "collecting" },
      executionPlan: guidedPlan,
      executionDefinition: {
        mode: "guided_questions",
        title: guidedPlan.title,
        requiredInputs: [],
      },
      interactivePayload: { type: "structured_form", fields: [] },
    });
    const validation = validateActiveExecutionContract(contract);
    assert.equal(validation.valid, false);
    assert.equal(validation.reason, "payload_type_mode_mismatch");
  });

  it("3. marks incompatible prepared action for replacement", () => {
    const action = {
      id: "a1",
      status: "prepared",
      prepared_input: { _executionPlan: { mode: "generator", metadata: { version: 2 } } },
      conversation: [{ role: "assistant", type: "opening", content: "Hi" }],
    };
    assert.equal(
      shouldReplaceIncompatiblePreparedAction({
        step: { status: "active" },
        action,
        executionPlan: guidedPlan,
      }),
      true,
    );
  });

  it("4. resumes compatible prepared action", () => {
    const action = {
      id: "a1",
      status: "prepared",
      prepared_input: { _executionPlan: guidedPlan },
      conversation: [{ role: "assistant", type: "opening", content: "Hi" }],
    };
    assert.equal(
      shouldResumeExistingAction({
        step: { status: "active" },
        action,
        executionPlan: guidedPlan,
      }),
      true,
    );
  });

  it("5. returns contract id and version", () => {
    const payload = serializeInteractivePayloadFromPlan(guidedPlan);
    const contract = buildActiveExecutionContract({
      projectId: "p1",
      stepId: "s1",
      action: { actionId: "a1", id: "a1" },
      session: { sessionId: "a1", phase: "collecting" },
      executionPlan: guidedPlan,
      executionDefinition: {
        mode: "guided_questions",
        title: guidedPlan.title,
        requiredInputs: [],
      },
      interactivePayload: payload,
    });
    assert.ok(contract.contractId);
    assert.equal(contract.contractVersion, 2);
  });

  it("6. guided question payload stays intact", () => {
    const payload = serializeInteractivePayloadFromPlan(guidedPlan);
    assert.equal(payload.type, "guided_questions");
    assert.equal(payload.questions.length, 4);
  });

  it("7. generator payload stays intact", () => {
    const generatorPlan = {
      mode: "generator",
      title: "Generează",
      requiredInputs: [],
    };
    const payload = serializeInteractivePayloadFromPlan(generatorPlan);
    assert.equal(payload, null);
    const contract = buildActiveExecutionContract({
      projectId: "p1",
      stepId: "s1",
      action: { actionId: "a1", id: "a1" },
      session: { sessionId: "a1", phase: "ready" },
      executionPlan: generatorPlan,
      executionDefinition: { mode: "generator", title: "Generează", requiredInputs: [] },
      interactivePayload: null,
    });
    const validation = validateContractRenderability(contract);
    assert.equal(validation.valid, true);
  });

  it("8. coherent guided contract validates", () => {
    const payload = serializeInteractivePayloadFromPlan(guidedPlan);
    const contract = buildActiveExecutionContract({
      projectId: "p1",
      stepId: "s1",
      action: { actionId: "a1", id: "a1" },
      session: { sessionId: "a1", phase: "collecting" },
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
      session: { sessionId: "a1", phase: "collecting" },
    });
    assert.equal(validation.valid, true);
  });

  it("9. reads persisted plan mode from action", () => {
    const action = {
      prepared_input: { _executionPlan: guidedPlan },
    };
    assert.equal(getPersistedExecutionPlan(action)?.mode, "guided_questions");
    assert.equal(isActionCompatibleWithPlan(action, guidedPlan), true);
    assert.equal(isActionCompatibleWithPlan(action, { mode: "generator", metadata: { version: 2 } }), false);
  });
});
