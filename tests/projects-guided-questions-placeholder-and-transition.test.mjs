import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildGuidedAnswersAcceptedInput,
  normalizeGuidedQuestionPlaceholder,
  serializeGuidedQuestionForClient,
  validateGuidedAnswersPayload,
} from '../lib/projects/brain/execution/guided-question-contract.js';
import { normalizeAcceptedExecutionInput } from '../lib/projects/brain/actions/accepted-input-normalizer.js';
import { serializeInteractivePayloadFromPlan } from '../lib/projects/brain/execution/execution-plan-generator.js';

const usmleQuestion = {
  id: 'study_rhythm',
  type: 'long_text',
  prompt: 'Ce ritm de studiu ți se potrivește?',
  recommendation: 'ITER recomandă 6 zile de studiu și o zi flexibilă pentru recapitulare.',
  placeholder: 'Ex: 6 zile pe săptămână, cu duminica pentru recapitulare',
  exampleAnswer: '6 zile pe săptămână, cu duminica pentru recapitulare',
  required: true,
  options: [],
  correctOptionId: null,
  rubric: null,
};

describe('projects guided questions placeholder and transition', () => {
  it('1. placeholder is separate from label', () => {
    const serialized = serializeGuidedQuestionForClient(usmleQuestion);
    assert.notEqual(serialized.placeholder, serialized.label);
    assert.match(serialized.placeholder, /^Ex:/);
  });

  it('2. schema accepts recommendation and helper fields', () => {
    const serialized = serializeGuidedQuestionForClient(usmleQuestion);
    assert.equal(serialized.recommendation, usmleQuestion.recommendation);
    assert.ok(serialized.placeholder);
  });

  it('3. generated placeholders stay concise when prompt was overloaded', () => {
    const repaired = normalizeGuidedQuestionPlaceholder({
      prompt: 'Ce ritm să folosesc pentru program?',
      recommendation: 'Recomand 6 zile de studiu și o zi flexibilă pentru recapitulare.',
      placeholder:
        'Ce ritm să folosesc pentru program? Recomand 6 zile de studiu și o zi flexibilă pentru recapitulare.',
      exampleAnswer: 'Ex: 6 zile pe săptămână, cu duminica pentru recapitulare',
      type: 'long_text',
    });
    assert.notEqual(repaired.toLowerCase(), 'ce ritm să folosesc pentru program?');
    assert.ok(repaired.length <= 80);
  });

  it('4. guided answers payload validates', () => {
    const plan = {
      mode: 'guided_questions',
      questions: [
        { id: 'q1', prompt: 'Q1', required: true },
        { id: 'q2', prompt: 'Q2', required: true },
      ],
    };
    const validation = validateGuidedAnswersPayload({ q1: 'a', q2: 'b' }, plan);
    assert.equal(validation.valid, true);
  });

  it('5. all answers reach generation acceptedInput', () => {
    const accepted = buildGuidedAnswersAcceptedInput({
      q1: '2026-09-01',
      q2: '4 ore',
      q3: 'Farmacologie',
      q4: '6 zile + recapitulare',
    });
    const normalized = normalizeAcceptedExecutionInput({
      acceptedInput: accepted,
      executionPlan: {
        mode: 'guided_questions',
        questions: [
          { id: 'q1' },
          { id: 'q2' },
          { id: 'q3' },
          { id: 'q4' },
        ],
      },
      action: {},
    });
    assert.equal(Object.keys(normalized.guidedAnswers).length, 4);
    assert.equal(normalized.interactive.completed, true);
  });

  it('6. serialize payload keeps placeholder and recommendation', () => {
    const payload = serializeInteractivePayloadFromPlan({
      mode: 'guided_questions',
      questions: [usmleQuestion],
    });
    assert.equal(payload.type, 'guided_questions');
    assert.equal(payload.questions[0].label, usmleQuestion.prompt);
    assert.notEqual(payload.questions[0].placeholder, payload.questions[0].label);
    assert.equal(payload.questions[0].recommendation, usmleQuestion.recommendation);
  });
});
