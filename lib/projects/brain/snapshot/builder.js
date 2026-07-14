import { randomUUID } from "node:crypto";

import { resolveNextAction } from "../next-action.js";
import { PROJECT_BRAIN_VERSION } from "../constants.js";
import { getExecutionPlanFromPreparedInput } from "../execution/execution-plan-generator.js";
import { buildExecutionPlanEvidenceInput } from "../openai-model-reuse.js";
import {
  ACTION_DESIGN_STATUS,
  PROJECT_BRAIN_SNAPSHOT_MODEL_METADATA,
  PROJECT_BRAIN_SNAPSHOT_VERSION,
} from "./constants.js";
import { resolveActionDesignStatusFromPreparedInput } from "./lazy-action-design.js";

const VERIFICATION_SIGNALS = /\b(verific|confirm|validate|checklist|review)\b/i;
const DIAGNOSTIC_SIGNALS = /\b(diagnostic|evaluare|assessment|analiz)\b/i;
const DOCUMENT_SIGNALS = /\b(document|plan|raport|report|proposal|propunere)\b/i;
const RECOMMENDATION_SIGNALS = /\b(recomand|choose|select|decide|prioritiz)\b/i;
const RESOURCE_SIGNALS = /\b(resource|asset|template|tool|upload|file)\b/i;

export function inferExpectedResultIntent(step = {}) {
  const haystack = `${step.title || ""} ${step.description || ""} ${step.expected_outcome || ""} ${step.rationale || ""}`;

  if (VERIFICATION_SIGNALS.test(haystack)) return "verification";
  if (DIAGNOSTIC_SIGNALS.test(haystack)) return "diagnostic";
  if (RECOMMENDATION_SIGNALS.test(haystack)) return "recommendation";
  if (DOCUMENT_SIGNALS.test(haystack)) return "document";
  if (RESOURCE_SIGNALS.test(haystack)) return "resource";
  if (/\b(context|clarif|inform)\b/i.test(haystack)) return "context_only";
  if (/\b(plan|strateg|roadmap)\b/i.test(haystack)) return "plan";
  return "other";
}

export function inferExpectedResourceIntent(step = {}) {
  const haystack = `${step.title || ""} ${step.expected_outcome || ""}`;
  if (step.tool_id || step.tool_slug) return "required";
  if (RESOURCE_SIGNALS.test(haystack)) return "possible";
  return "none";
}

export function inferAdaptationCheckpoint(step = {}, index = 0, total = 1) {
  if (step.priority === "high") return true;
  if (index > 0 && index % 3 === 0) return true;
  return index === Math.floor(total / 2);
}

export function buildStepBlueprint({
  step,
  index = 0,
  total = 1,
  dependencyStepIds = [],
  actionRow = null,
  actionDesignEvidenceHash = null,
}) {
  const preparedInput = actionRow?.prepared_input || {};
  const actionDesignStatus = resolveActionDesignStatusFromPreparedInput({
    preparedInput,
    evidenceHash: actionDesignEvidenceHash,
    forceInvalid: false,
  }).status;

  return {
    stepId: step.id,
    purpose: step.expected_outcome || step.description || step.title,
    expectedValue: step.rationale || step.expected_outcome || step.title,
    expectedResultIntent: inferExpectedResultIntent(step),
    expectedResourceIntent: inferExpectedResourceIntent(step),
    dependencyStepIds,
    adaptationCheckpoint: inferAdaptationCheckpoint(step, index, total),
    actionDesignStatus,
    actionDesignEvidenceHash:
      preparedInput._executionPlanEvidenceHash ||
      preparedInput._brainDecisionEvidenceHash ||
      actionDesignEvidenceHash ||
      null,
  };
}

export function buildBrainSnapshotFromBundle({
  project,
  bundle,
  clarificationAnswers = [],
  roadmapEvidenceHash,
  generatedWorkflow = null,
  existingSnapshot = null,
  actionsByStepId = new Map(),
}) {
  const now = new Date().toISOString();
  const milestones = [...(bundle?.milestones || [])].sort((a, b) => a.position - b.position);
  const steps = [...(bundle?.steps || [])].sort((a, b) => a.position - b.position);
  const nextAction = resolveNextAction({
    project,
    milestones,
    steps,
  });

  const previousBlueprints = new Map(
    (existingSnapshot?.stepBlueprints || []).map((blueprint) => [blueprint.stepId, blueprint]),
  );

  const stepBlueprints = steps.map((step, index) => {
    const previous = previousBlueprints.get(step.id);
    const actionRow = actionsByStepId.get(step.id) || null;
    const blueprint = buildStepBlueprint({
      step,
      index,
      total: steps.length,
      dependencyStepIds: index > 0 ? [steps[index - 1]?.id].filter(Boolean) : [],
      actionRow,
    });

    if (previous?.actionDesignStatus === ACTION_DESIGN_STATUS.STALE) {
      blueprint.actionDesignStatus = ACTION_DESIGN_STATUS.STALE;
    }

    return blueprint;
  });

  const materialConstraints = [];
  if (project?.description?.trim()) {
    materialConstraints.push(project.description.trim());
  }

  return {
    snapshotId: existingSnapshot?.snapshotId || randomUUID(),
    snapshotVersion: PROJECT_BRAIN_SNAPSHOT_VERSION,
    projectId: project.id,
    roadmapVersion: bundle?.workflow?.brain_version || PROJECT_BRAIN_VERSION,
    roadmapEvidenceHash,
    objective: {
      goal: project.goal || "",
      summary: project.summary || generatedWorkflow?.summary || bundle?.workflow?.summary || "",
      materialConstraints,
      clarifications: (clarificationAnswers || []).map((answer) => ({
        questionId: answer.questionId,
        answer: answer.answer,
      })),
    },
    strategy: {
      projectApproach: generatedWorkflow?.currentStage || bundle?.workflow?.current_stage || null,
      successDefinition: generatedWorkflow?.summary || bundle?.workflow?.summary || project.goal || null,
      minimumUserEffortPrinciple: true,
      adaptationPolicyVersion: PROJECT_BRAIN_SNAPSHOT_MODEL_METADATA.adaptationPolicyVersion,
    },
    workflow: {
      workflowId: bundle?.workflow?.id || null,
      milestoneIds: milestones.map((milestone) => milestone.id),
      stepIds: steps.map((step) => step.id),
      recommendedNextStepId: nextAction?.stepId || null,
    },
    stepBlueprints,
    modelMetadata: {
      ...PROJECT_BRAIN_SNAPSHOT_MODEL_METADATA,
    },
    createdAt: existingSnapshot?.createdAt || now,
    updatedAt: now,
  };
}

export function updateStepBlueprintAfterActionDesign({
  snapshot,
  stepId,
  preparedInput = {},
  evidenceHash = null,
}) {
  if (!snapshot || !Array.isArray(snapshot.stepBlueprints)) {
    return snapshot;
  }

  const status = resolveActionDesignStatusFromPreparedInput({
    preparedInput,
    evidenceHash,
  }).status;

  snapshot.stepBlueprints = snapshot.stepBlueprints.map((blueprint) =>
    blueprint.stepId === stepId
      ? {
          ...blueprint,
          actionDesignStatus: status,
          actionDesignEvidenceHash:
            preparedInput._executionPlanEvidenceHash ||
            preparedInput._brainDecisionEvidenceHash ||
            evidenceHash ||
            blueprint.actionDesignEvidenceHash,
        }
      : blueprint,
  );
  snapshot.updatedAt = new Date().toISOString();
  return snapshot;
}

export function computeActionDesignEvidenceHashInput({
  actionId,
  step,
  project,
  preparation,
  memoryMap,
  executionDecision,
  workflowVersion = null,
}) {
  return buildExecutionPlanEvidenceInput({
    actionId,
    step,
    project,
    preparation,
    memoryMap,
    executionDecision,
    workflowVersion,
    brainDecisionEvidenceHash: null,
  });
}
