import { computeRoadmapEvidenceHash } from "../openai-evidence-hash.js";
import { updateProjectBrainMeta } from "../repository.js";
import { PROJECT_BRAIN_FAILURE_CODES } from "../constants.js";
import { PROJECT_BRAIN_INTERNAL_CODES } from "../project-brain-internal-codes.js";
import { logBrainSnapshotEvent } from "../brain-snapshot-observability.js";
import { buildBrainSnapshotFromBundle } from "./builder.js";
import { validateSnapshotAgainstWorkflowBundle, repairSnapshotBlueprintsFromBundle } from "./consistency.js";
import { loadBrainSnapshotFromMemory, persistBrainSnapshotToMemory } from "./persistence.js";
import { PROJECT_BRAIN_SNAPSHOT_VERSION } from "./constants.js";

export function isSnapshotRecoveryEligible(bundle) {
  return (
    Boolean(bundle?.workflow && bundle.workflow.status === "ready") &&
    Array.isArray(bundle?.milestones) &&
    bundle.milestones.length > 0 &&
    Array.isArray(bundle?.steps) &&
    bundle.steps.length > 0
  );
}

export function resolveRoadmapEvidenceHashForBundle({ project, clarificationAnswers = [], bundle }) {
  return (
    computeRoadmapEvidenceHash({ project, clarificationAnswers }) ||
    bundle?.workflow?.brain_version ||
    null
  );
}

export async function ensureBrainSnapshotForReadyWorkflow({
  baseUrl,
  secretKey,
  userId,
  project,
  bundle,
  clarificationAnswers = [],
  logFn = () => {},
  existingSnapshot = null,
}) {
  if (!isSnapshotRecoveryEligible(bundle)) {
    return {
      ok: false,
      code: PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_INVALID,
      reason: "incomplete_normalized_roadmap",
    };
  }

  const roadmapEvidenceHash = resolveRoadmapEvidenceHashForBundle({
    project,
    clarificationAnswers,
    bundle,
  });

  const loaded =
    existingSnapshot != null
      ? { ok: true, snapshot: existingSnapshot, evidenceHash: existingSnapshot.roadmapEvidenceHash, source: "provided" }
      : await loadBrainSnapshotFromMemory({ baseUrl, secretKey, userId, projectId: project.id });

  if (loaded.ok && loaded.snapshot) {
    const consistency = validateSnapshotAgainstWorkflowBundle({
      snapshot: loaded.snapshot,
      project,
      bundle,
      roadmapEvidenceHash,
    });
    if (consistency.valid) {
      if (project.brain_status !== "ready" || project.brain_failure_code) {
        const repairedProject = await updateProjectBrainMeta({
          baseUrl,
          secretKey,
          userId,
          projectId: project.id,
          columns: {
            brain_status: "ready",
            brain_failure_code: null,
            active_workflow_id: bundle.workflow.id,
            updated_at: new Date().toISOString(),
          },
        });
        return {
          ok: true,
          recovered: false,
          snapshot: loaded.snapshot,
          consistency,
          project: repairedProject.project || project,
          internalCode: PROJECT_BRAIN_INTERNAL_CODES.STRATEGIC_ARTIFACT_REUSE_HIT,
        };
      }
      return {
        ok: true,
        recovered: false,
        snapshot: loaded.snapshot,
        consistency,
        project,
        internalCode: PROJECT_BRAIN_INTERNAL_CODES.STRATEGIC_ARTIFACT_REUSE_HIT,
      };
    }
  }

  let snapshot = buildBrainSnapshotFromBundle({
    project,
    bundle,
    clarificationAnswers,
    roadmapEvidenceHash,
    existingSnapshot: loaded.snapshot || null,
  });
  snapshot = repairSnapshotBlueprintsFromBundle(snapshot, bundle);

  const persisted = await persistBrainSnapshotToMemory({
    baseUrl,
    secretKey,
    userId,
    projectId: project.id,
    snapshot,
    logFn,
  });

  if (!persisted.ok) {
    logBrainSnapshotEvent(logFn, {
      projectId: project.id,
      workflowId: bundle.workflow.id,
      artifactType: "brain_snapshot",
      persistenceSucceeded: false,
      internalErrorCode: persisted.code || PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_PERSIST_FAILED,
    });
    return {
      ok: false,
      code: persisted.code || PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_PERSIST_FAILED,
      reason: "snapshot_persistence_failed",
    };
  }

  const repairedProject = await updateProjectBrainMeta({
    baseUrl,
    secretKey,
    userId,
    projectId: project.id,
    columns: {
      brain_status: "ready",
      brain_failure_code: null,
      active_workflow_id: bundle.workflow.id,
      updated_at: new Date().toISOString(),
    },
  });

  logBrainSnapshotEvent(logFn, {
    projectId: project.id,
    workflowId: bundle.workflow.id,
    artifactType: "brain_snapshot",
    artifactVersion: PROJECT_BRAIN_SNAPSHOT_VERSION,
    evidenceHash: snapshot.roadmapEvidenceHash,
    persistenceSucceeded: true,
    generationTriggered: false,
    reuseReason: "snapshot_recovered_from_normalized_roadmap",
  });

  return {
    ok: true,
    recovered: true,
    snapshot: persisted.snapshot,
    project: repairedProject.project || project,
    roadmapEvidenceHash: snapshot.roadmapEvidenceHash,
    internalCode: PROJECT_BRAIN_INTERNAL_CODES.STRATEGIC_ARTIFACT_REUSE_HIT,
  };
}

export function isSnapshotOnlyPersistenceFailure(project, bundle) {
  return (
    project?.brain_status === "failed" &&
    project?.brain_failure_code === PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR &&
    isSnapshotRecoveryEligible(bundle)
  );
}
