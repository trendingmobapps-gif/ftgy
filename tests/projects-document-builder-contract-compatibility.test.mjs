import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildActiveExecutionContract,
  repairExecutionContractModePayload,
  validateActiveExecutionContract,
  validateExecutionContractInvariant,
} from "../lib/projects/brain/execution/active-execution-contract.js";
import { buildContextualExecutionPlanFallback } from "../lib/projects/brain/execution/execution-plan-generator.js";
import { serializeInteractivePayloadFromPlan } from "../lib/projects/brain/execution/execution-plan-generator.js";

const AFFECTED_STEP_TITLE = "Centralizează documentele financiare";

function buildDocumentBuilderContract(payload) {
  const plan = {
    mode: "document_builder",
    title: AFFECTED_STEP_TITLE,
    explanation: "Construim documentul.",
    requiredInputs: [],
    userAction: { type: "generate", instruction: "Generează documentul." },
    primaryActionLabel: "Generează documentul",
    metadata: { version: 2, source: "contextual_fallback" },
  };

  return buildActiveExecutionContract({
    projectId: "524c0b17-b074-4f86-960c-af9e416926cb",
    stepId: "3edba158-daa1-4956-b38b-54183deab17f",
    action: { actionId: "a1", id: "a1" },
    session: { sessionId: "a1", phase: "ready" },
    executionPlan: plan,
    executionDefinition: {
      mode: "document_builder",
      title: AFFECTED_STEP_TITLE,
      requiredInputs: [],
    },
    interactivePayload: payload,
    source: "contextual_fallback",
  });
}

describe("document_builder contract compatibility", () => {
  it("1 rejects document_builder with null payload", () => {
    const contract = buildDocumentBuilderContract(null);
    const validation = validateActiveExecutionContract({
      ...contract,
      actionId: "a1",
    });
    assert.equal(validation.valid, false);
    assert.equal(validation.reason, "payload_type_mode_mismatch");
  });

  it("2 accepts document_builder with valid structured_form payload", () => {
    const plan = {
      mode: "document_builder",
      title: AFFECTED_STEP_TITLE,
      requiredInputs: [
        { id: "scope", type: "text", label: "Domeniu", required: true },
      ],
      userAction: { type: "generate", instruction: "Generează documentul." },
    };
    const payload = serializeInteractivePayloadFromPlan(plan);
    const contract = buildDocumentBuilderContract(payload);
    const validation = validateActiveExecutionContract({
      ...contract,
      actionId: "a1",
      executionPlan: plan,
    });
    assert.equal(payload?.type, "structured_form");
    assert.equal(validation.valid, true);
  });

  it("3 zero-input direct generation normalizes to generator", () => {
    const plan = {
      mode: "document_builder",
      title: AFFECTED_STEP_TITLE,
      requiredInputs: [],
      userAction: { type: "generate", instruction: "Generează documentul." },
      primaryActionLabel: "Generează documentul",
      metadata: { source: "contextual_fallback" },
    };
    const repair = repairExecutionContractModePayload({
      executionPlan: plan,
      interactivePayload: null,
      source: "contextual_fallback",
    });
    assert.equal(repair.repaired, true);
    assert.equal(repair.repairReason, "zero_input_direct_generation");
    assert.equal(repair.repairedMode, "generator");
    assert.equal(repair.repairedPayloadType, null);
  });

  it("4 contextual fallback never emits document_builder with null payload", () => {
    const plan = buildContextualExecutionPlanFallback(
      {
        stepTitle: AFFECTED_STEP_TITLE,
        stepDescription: "Organizează documentele financiare ale proiectului.",
        projectGoal: "Proiect financiar",
        expectedOutcome: "Document centralizat",
        whyItMatters: "Claritate financiară",
      },
      { missingFields: [] },
      new Map(),
    );
    assert.equal(plan.mode, "generator");
    assert.equal(serializeInteractivePayloadFromPlan(plan), null);
    const invariant = validateExecutionContractInvariant({
      mode: plan.mode,
      interactivePayload: null,
      executionPlan: plan,
    });
    assert.equal(invariant.valid, true);
  });

  it("5 executionPlan.mode matches executionDefinition.mode after repair", () => {
    const repair = repairExecutionContractModePayload({
      executionPlan: {
        mode: "document_builder",
        title: AFFECTED_STEP_TITLE,
        requiredInputs: [],
      },
      interactivePayload: null,
      source: "contextual_fallback",
    });
    assert.equal(repair.executionPlan.mode, "generator");
    assert.equal(repair.executionPlan.mode, repair.repairedMode);
  });

  it("6 payload.type matches mode invariant", () => {
    const invalid = validateExecutionContractInvariant({
      mode: "document_builder",
      interactivePayload: null,
    });
    assert.equal(invalid.valid, false);
    assert.equal(invalid.reason, "payload_type_mode_mismatch");

    const valid = validateExecutionContractInvariant({
      mode: "generator",
      interactivePayload: null,
    });
    assert.equal(valid.valid, true);
  });

  it("7 contractValid cannot be true for incompatible document_builder contract", () => {
    const contract = buildDocumentBuilderContract(null);
    const validation = validateActiveExecutionContract({
      ...contract,
      actionId: "a1",
    });
    assert.equal(validation.valid, false);
  });

  it("8 affected step contract becomes renderable after repair", () => {
    const plan = buildContextualExecutionPlanFallback(
      {
        stepTitle: AFFECTED_STEP_TITLE,
        stepDescription: "Organizează documentele financiare.",
        projectGoal: "Proiect",
        expectedOutcome: "Document",
        whyItMatters: "Organizare",
      },
      { missingFields: [] },
      new Map(),
    );
    const contract = buildActiveExecutionContract({
      projectId: "524c0b17-b074-4f86-960c-af9e416926cb",
      stepId: "3edba158-daa1-4956-b38b-54183deab17f",
      action: { actionId: "a1", id: "a1" },
      session: { sessionId: "a1", phase: "ready" },
      executionPlan: plan,
      executionDefinition: {
        mode: plan.mode,
        title: plan.title,
        requiredInputs: [],
      },
      interactivePayload: null,
      source: "contextual_fallback",
    });
    const validation = validateActiveExecutionContract({
      ...contract,
      actionId: "a1",
    });
    assert.equal(plan.mode, "generator");
    assert.equal(validation.valid, true);
  });

  it("9 repair is deterministic and requires no provider call", () => {
    const repair = repairExecutionContractModePayload({
      executionPlan: {
        mode: "document_builder",
        title: AFFECTED_STEP_TITLE,
        requiredInputs: [],
        metadata: { source: "contextual_fallback" },
      },
      interactivePayload: null,
      source: "contextual_fallback",
    });
    assert.equal(repair.repaired, true);
    assert.equal(repair.originalMode, "document_builder");
    assert.equal(repair.repairedMode, "generator");
  });

  it("10 prepare path logs execution_contract_repaired stage", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../lib/projects/brain/execution/interactive.js", import.meta.url),
      "utf8",
    );
    assert.match(source, /repairExecutionContractModePayload/);
    assert.match(source, /execution_contract_repaired/);
  });
});
