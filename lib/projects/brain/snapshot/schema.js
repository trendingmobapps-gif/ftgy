import {
  ACTION_DESIGN_STATUS,
  EXPECTED_RESOURCE_INTENTS,
  EXPECTED_RESULT_INTENTS,
  PROJECT_BRAIN_SNAPSHOT_VERSION,
} from "./constants.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isUuidLike(value) {
  return typeof value === "string" && /^[0-9a-f-]{8,}$/i.test(value.trim());
}

export function validateBrainSnapshot(snapshot) {
  const errors = [];

  if (!snapshot || typeof snapshot !== "object") {
    return { valid: false, errors: ["snapshot_missing"] };
  }

  if (snapshot.snapshotVersion !== PROJECT_BRAIN_SNAPSHOT_VERSION) {
    errors.push("snapshot_version_invalid");
  }

  if (!isUuidLike(snapshot.projectId)) {
    errors.push("project_id_invalid");
  }

  if (!isNonEmptyString(snapshot.roadmapEvidenceHash)) {
    errors.push("roadmap_evidence_hash_missing");
  }

  if (!snapshot.objective || !isNonEmptyString(snapshot.objective.goal)) {
    errors.push("objective_goal_missing");
  }

  if (!snapshot.workflow || !isUuidLike(snapshot.workflow.workflowId)) {
    errors.push("workflow_id_missing");
  }

  if (!Array.isArray(snapshot.stepBlueprints)) {
    errors.push("step_blueprints_missing");
  } else {
    for (const blueprint of snapshot.stepBlueprints) {
      if (!isUuidLike(blueprint.stepId)) {
        errors.push("step_blueprint_id_invalid");
        break;
      }
      if (!Object.values(ACTION_DESIGN_STATUS).includes(blueprint.actionDesignStatus)) {
        errors.push("action_design_status_invalid");
        break;
      }
      if (!EXPECTED_RESULT_INTENTS.includes(blueprint.expectedResultIntent)) {
        errors.push("expected_result_intent_invalid");
        break;
      }
      if (!EXPECTED_RESOURCE_INTENTS.includes(blueprint.expectedResourceIntent)) {
        errors.push("expected_resource_intent_invalid");
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function sanitizeBrainSnapshotForClient(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  return {
    snapshotId: snapshot.snapshotId || null,
    snapshotVersion: snapshot.snapshotVersion,
    projectId: snapshot.projectId,
    roadmapVersion: snapshot.roadmapVersion || null,
    roadmapEvidenceHash: snapshot.roadmapEvidenceHash || null,
    objective: {
      goal: snapshot.objective?.goal || null,
      summary: snapshot.objective?.summary || null,
      materialConstraints: snapshot.objective?.materialConstraints || [],
      clarifications: snapshot.objective?.clarifications || [],
    },
    strategy: {
      projectApproach: snapshot.strategy?.projectApproach || null,
      successDefinition: snapshot.strategy?.successDefinition || null,
      minimumUserEffortPrinciple: snapshot.strategy?.minimumUserEffortPrinciple !== false,
      adaptationPolicyVersion: snapshot.strategy?.adaptationPolicyVersion || null,
    },
    workflow: {
      workflowId: snapshot.workflow?.workflowId || null,
      milestoneIds: snapshot.workflow?.milestoneIds || [],
      stepIds: snapshot.workflow?.stepIds || [],
      recommendedNextStepId: snapshot.workflow?.recommendedNextStepId || null,
    },
    stepBlueprints: (snapshot.stepBlueprints || []).map((blueprint) => ({
      stepId: blueprint.stepId,
      purpose: blueprint.purpose || null,
      expectedValue: blueprint.expectedValue || null,
      expectedResultIntent: blueprint.expectedResultIntent,
      expectedResourceIntent: blueprint.expectedResourceIntent,
      dependencyStepIds: blueprint.dependencyStepIds || [],
      adaptationCheckpoint: Boolean(blueprint.adaptationCheckpoint),
      actionDesignStatus: blueprint.actionDesignStatus,
      actionDesignEvidenceHash: blueprint.actionDesignEvidenceHash || null,
    })),
    modelMetadata: snapshot.modelMetadata || null,
    createdAt: snapshot.createdAt || null,
    updatedAt: snapshot.updatedAt || null,
  };
}
