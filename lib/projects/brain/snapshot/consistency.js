import { PROJECT_BRAIN_SNAPSHOT_VERSION } from "./constants.js";
import { buildStepBlueprint } from "./builder.js";

function sortedIds(values = []) {
  return [...values].map(String).sort();
}

function setsEqual(a = [], b = []) {
  const left = sortedIds(a);
  const right = sortedIds(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateSnapshotAgainstWorkflowBundle({
  snapshot,
  project,
  bundle,
  roadmapEvidenceHash = null,
}) {
  const errors = [];

  if (!snapshot || typeof snapshot !== "object") {
    return { valid: false, errors: ["snapshot_missing"], repairable: true };
  }

  if (snapshot.snapshotVersion !== PROJECT_BRAIN_SNAPSHOT_VERSION) {
    errors.push("snapshot_version_mismatch");
  }

  if (project?.id && snapshot.projectId !== project.id) {
    errors.push("project_id_mismatch");
  }

  const workflowId = bundle?.workflow?.id || null;
  if (!workflowId || snapshot.workflow?.workflowId !== workflowId) {
    errors.push("workflow_id_mismatch");
  }

  const milestoneIds = (bundle?.milestones || []).map((row) => row.id);
  const stepIds = (bundle?.steps || []).map((row) => row.id);

  if (!setsEqual(snapshot.workflow?.milestoneIds || [], milestoneIds)) {
    errors.push("milestone_ids_mismatch");
  }

  if (!setsEqual(snapshot.workflow?.stepIds || [], stepIds)) {
    errors.push("step_ids_mismatch");
  }

  if (roadmapEvidenceHash && snapshot.roadmapEvidenceHash !== roadmapEvidenceHash) {
    errors.push("roadmap_evidence_hash_mismatch");
  }

  const recommended = snapshot.workflow?.recommendedNextStepId || null;
  if (recommended && !stepIds.includes(recommended)) {
    errors.push("recommended_step_missing");
  }

  const blueprintIds = (snapshot.stepBlueprints || []).map((row) => row.stepId);
  const duplicateBlueprintIds = blueprintIds.filter(
    (stepId, index) => blueprintIds.indexOf(stepId) !== index,
  );
  if (duplicateBlueprintIds.length > 0) {
    errors.push("duplicate_blueprint_ids");
  }

  for (const stepId of stepIds) {
    if (!blueprintIds.includes(stepId)) {
      errors.push("missing_step_blueprint");
      break;
    }
  }

  for (const blueprintId of blueprintIds) {
    if (!stepIds.includes(blueprintId)) {
      errors.push("orphan_step_blueprint");
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    repairable: errors.every((error) =>
      [
        "missing_step_blueprint",
        "snapshot_version_mismatch",
        "milestone_ids_mismatch",
        "step_ids_mismatch",
        "recommended_step_missing",
        "duplicate_blueprint_ids",
        "orphan_step_blueprint",
        "roadmap_evidence_hash_mismatch",
      ].includes(error),
    ),
  };
}

export function repairSnapshotBlueprintsFromBundle(snapshot, bundle) {
  if (!snapshot || !bundle?.steps) {
    return snapshot;
  }

  const steps = [...bundle.steps].sort((a, b) => a.position - b.position);
  const existing = new Map((snapshot.stepBlueprints || []).map((row) => [row.stepId, row]));
  snapshot.stepBlueprints = steps.map((step, index) => {
    const current = existing.get(step.id);
    if (current) {
      return current;
    }
    return buildStepBlueprint({
      step,
      index,
      total: steps.length,
      dependencyStepIds: index > 0 ? [steps[index - 1]?.id].filter(Boolean) : [],
    });
  });

  snapshot.workflow = {
    ...(snapshot.workflow || {}),
    workflowId: bundle.workflow?.id || snapshot.workflow?.workflowId || null,
    milestoneIds: (bundle.milestones || []).map((row) => row.id),
    stepIds: steps.map((row) => row.id),
  };
  snapshot.updatedAt = new Date().toISOString();
  return snapshot;
}
