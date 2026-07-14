import { computeRoadmapEvidenceHash } from "../openai-evidence-hash.js";
import { isNonMaterialProjectUpdate } from "../strategic-call-invariants.js";
import { PROJECT_BRAIN_INTERNAL_CODES } from "../project-brain-internal-codes.js";
import { shouldReuseRoadmapGeneration } from "../openai-model-reuse.js";

export function evaluateRoadmapMaterialChange({
  project,
  clarificationAnswers = [],
  bundle,
  persistedEvidenceHash = null,
  forceRetry = false,
}) {
  const currentHash = computeRoadmapEvidenceHash({ project, clarificationAnswers });

  if (forceRetry) {
    return {
      materialChange: true,
      regenerate: true,
      reason: "explicit_regeneration_requested",
      currentHash,
      persistedHash: persistedEvidenceHash,
    };
  }

  if (persistedEvidenceHash) {
    if (persistedEvidenceHash === currentHash) {
      return {
        materialChange: false,
        regenerate: false,
        reason: "roadmap_evidence_unchanged",
        reuseHit: true,
        currentHash,
        persistedHash: persistedEvidenceHash,
        internalCode: PROJECT_BRAIN_INTERNAL_CODES.STRATEGIC_ARTIFACT_REUSE_HIT,
      };
    }
    return {
      materialChange: true,
      regenerate: true,
      reason: "roadmap_evidence_changed",
      currentHash,
      persistedHash: persistedEvidenceHash,
    };
  }

  if (bundle?.before && bundle?.after) {
    const nonMaterial = isNonMaterialProjectUpdate({
      before: bundle.before,
      after: bundle.after,
      clarificationAnswers,
    });
    if (nonMaterial) {
      return {
        materialChange: false,
        regenerate: false,
        reason: PROJECT_BRAIN_INTERNAL_CODES.MATERIAL_CHANGE_NOT_REQUIRED,
        currentHash,
        persistedHash: persistedEvidenceHash,
      };
    }
  }

  const reuse = shouldReuseRoadmapGeneration({
    project,
    clarificationAnswers,
    bundle: bundle?.workflow ? { workflow: bundle.workflow } : bundle,
  });

  if (reuse.reuse) {
    return {
      materialChange: false,
      regenerate: false,
      reason: reuse.reason,
      reuseHit: true,
      currentHash,
      persistedHash: persistedEvidenceHash || reuse.evidenceHash,
      internalCode: PROJECT_BRAIN_INTERNAL_CODES.STRATEGIC_ARTIFACT_REUSE_HIT,
    };
  }

  if (persistedEvidenceHash && persistedEvidenceHash !== currentHash) {
    return {
      materialChange: true,
      regenerate: true,
      reason: "roadmap_evidence_changed",
      currentHash,
      persistedHash: persistedEvidenceHash,
    };
  }

  if (!bundle?.workflow || bundle.workflow.status !== "ready") {
    return {
      materialChange: true,
      regenerate: true,
      reason: "workflow_not_ready",
      currentHash,
      persistedHash: persistedEvidenceHash,
    };
  }

  return {
    materialChange: false,
    regenerate: false,
    reason: PROJECT_BRAIN_INTERNAL_CODES.MATERIAL_CHANGE_NOT_REQUIRED,
    currentHash,
    persistedHash: persistedEvidenceHash,
  };
}

export function shouldRegenerateRoadmap(gateDecision) {
  return gateDecision?.regenerate === true;
}
