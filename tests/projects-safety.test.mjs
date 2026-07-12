import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeProjectIntent } from "../lib/projects/intent-analysis.js";
import { createProject } from "../lib/projects/repository.js";
import {
  applyDeterministicSafetyRules,
  evaluateProjectSafety,
  evaluateSafetyClarificationAnswers,
  normalizeSafetyClassifierResult,
  normalizeSafetyReasonCode,
  SAFETY_AUTHORIZATION_QUESTION_ID,
} from "../lib/projects/project-safety.js";
import { validateCreateInput } from "../lib/projects/validation.js";

describe("project safety deterministic rules", () => {
  it("blocks explicit robbery goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să jefuiesc un apartament",
    });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "theft_or_financial_crime");
  });

  it("blocks robbery goals even when a manual category is supplied", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să jefuiesc un apartament",
      categorySlug: "business",
    });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "theft_or_financial_crime");
  });

  it("allows defensive apartment security goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să îmi securizez apartamentul împotriva furturilor",
    });
    assert.equal(decision.status, "allowed");
  });

  it("allows reporting theft goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să raportez un furt",
    });
    assert.equal(decision.status, "allowed");
  });

  it("allows fictional robbery writing goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să scriu un roman despre un jaf",
    });
    assert.equal(decision.status, "allowed");
  });

  it("allows understanding criminal investigation goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să înțeleg cum funcționează o anchetă penală",
    });
    assert.equal(decision.status, "allowed");
  });

  it("blocks explicit fraud goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să creez o schemă prin care să păcălesc clienții.",
    });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "fraud_or_deception");
  });

  it("blocks unauthorized hacking goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să sparg contul unei persoane.",
    });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "cyber_abuse");
  });

  it("blocks illegal trafficking goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să organizez distribuția de droguri.",
    });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "illegal_drugs_or_trafficking");
  });

  it("blocks stalking and surveillance goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să urmăresc pe ascuns telefonul partenerei.",
    });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "privacy_invasion");
  });

  it("allows defensive cybersecurity goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să îmi protejez site-ul împotriva hackerilor.",
    });
    assert.equal(decision.status, "allowed");
  });

  it("allows legal complaint and reporting goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să raportez o fraudă.",
    });
    assert.equal(decision.status, "allowed");
  });

  it("allows tax compliance goals", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să înțeleg ce taxe trebuie să plătesc.",
    });
    assert.equal(decision.status, "allowed");
  });

  it("does not block fictional writing solely by keywords", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să scriu un roman polițist.",
    });
    assert.equal(decision.status, "allowed");
  });

  it("returns one authorization clarification for ambiguous security goals", () => {
    const decision = applyDeterministicSafetyRules("Vreau să testez securitatea unui site.", {});
    assert.equal(decision.status, "needs_safety_clarification");
    assert.equal(decision.payload.questions.length, 1);
    assert.equal(decision.payload.questions[0].id, SAFETY_AUTHORIZATION_QUESTION_ID);
  });

  it("blocks harmful clarification answers without authorization", () => {
    const decision = evaluateSafetyClarificationAnswers([
      {
        questionId: SAFETY_AUTHORIZATION_QUESTION_ID,
        answer: "nu-autorizare",
      },
    ]);
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "cyber_abuse");
  });

  it("allows safe authorization clarification answers", () => {
    const decision = evaluateSafetyClarificationAnswers([
      {
        questionId: SAFETY_AUTHORIZATION_QUESTION_ID,
        answer: "da-autorizare",
      },
    ]);
    assert.equal(decision.status, "allowed");
  });

  it("normalizes invalid model reason codes safely", () => {
    const decision = normalizeSafetyClassifierResult({
      status: "blocked",
      reasonCode: "totally_invalid_code",
      userMessage: null,
    });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "other_illegal_harm");
  });
});

describe("project safety intent integration", () => {
  it("returns blocked status from intent analysis before category work", async () => {
    const result = await analyzeProjectIntent(
      { goal: "Vreau să falsific documente." },
      { fetchFn: async () => { throw new Error("OpenAI should not be called"); }, apiKey: "test" },
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.status, "blocked");
    assert.ok(result.result.reasonCode);
    assert.ok(result.result.message);
  });

  it("returns blocked status for robbery goals before category work", async () => {
    const result = await analyzeProjectIntent(
      { goal: "Vreau să jefuiesc un apartament" },
      { fetchFn: async () => { throw new Error("OpenAI should not be called"); }, apiKey: "test" },
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.status, "blocked");
    assert.equal(result.result.reasonCode, "theft_or_financial_crime");
  });

  it("keeps normal project creation analysis unchanged for allowed goals", async () => {
    const result = await analyzeProjectIntent(
      { goal: "Vreau să deschid o cafenea în Timișoara" },
      { fetchFn: async () => { throw new Error("OpenAI should not be called"); }, apiKey: "test" },
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.status, "ready");
    assert.equal(result.result.categorySlug, "business");
  });
});

describe("project safety create/update guards", () => {
  it("rejects client-supplied safety fields on create validation", () => {
    const result = validateCreateInput({
      goal: "Vreau să deschid o cafenea",
      categorySlug: "business",
      safetyStatus: "allowed",
      isSafe: true,
      moderated: true,
    });

    assert.equal(result.valid, false);
    assert.ok(result.fields.safetyStatus);
    assert.ok(result.fields.isSafe);
    assert.ok(result.fields.moderated);
  });

  it("requires safety gate flag before repository insert", async () => {
    const result = await createProject({
      baseUrl: "https://example.supabase.co",
      secretKey: "secret",
      userId: "user-1",
      value: {
        name: "Test",
        goal: "Vreau să deschid o cafenea",
        description: null,
        summary: null,
        categorySlug: "business",
        iconKey: null,
        accentKey: null,
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.blockedBySafetyGate, true);
    assert.equal(result.project, null);
  });

  it("blocks harmful goals before any project row can be created", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să intru în contul altei persoane",
      categorySlug: "business",
    });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "cyber_abuse");
  });

  it("blocks manual category selection when the goal is harmful", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să creez un sistem prin care să păcălesc clienții",
      categorySlug: "business",
    });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "fraud_or_deception");
  });

  it("rejects harmful goal edits during safety evaluation", async () => {
    const decision = await evaluateProjectSafety({
      goal: "Vreau să ascund bani de autorități",
    });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "evasion_or_concealment");
  });
});

describe("project safety classifier fallback", () => {
  it("defaults to blocked for uncertain high-risk classifier output", () => {
    const decision = normalizeSafetyClassifierResult({ status: "uncertain", reasonCode: null, userMessage: null });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reasonCode, "other_illegal_harm");
  });

  it("allows classifier allowed output", () => {
    const decision = normalizeSafetyClassifierResult({ status: "allowed", reasonCode: null, userMessage: null });
    assert.equal(decision.status, "allowed");
  });

  it("maps known classifier reason codes", () => {
    const decision = normalizeSafetyClassifierResult({
      status: "blocked",
      reasonCode: "fraud_or_deception",
      userMessage: "Nu putem crea un proiect care facilită înșelarea sau frauda.",
    });
    assert.equal(decision.reasonCode, normalizeSafetyReasonCode("fraud_or_deception"));
    assert.equal(decision.status, "blocked");
  });
});
