import { listProjectMemory, upsertProjectMemoryFacts } from "../memory/repository.js";
import { PROJECT_MEMORY_ARTIFACT_SOURCES } from "../memory/constants.js";
import {
  PROJECT_BRAIN_INTERNAL_CODES,
  SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES,
} from "../project-brain-internal-codes.js";
import { logBrainSnapshotEvent, logBrainSnapshotPersistenceFailure } from "../brain-snapshot-observability.js";
import { PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS } from "./constants.js";
import { buildBrainSnapshotFromBundle } from "./builder.js";
import { validateBrainSnapshot } from "./schema.js";
import { validateSnapshotAgainstWorkflowBundle } from "./consistency.js";
import {
  deserializeBrainSnapshotFromMemory,
  serializeBrainSnapshotForMemory,
} from "./serialization.js";

function mapCategoryToInternalCode(category) {
  switch (category) {
    case SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.VALIDATION_FAILED:
      return PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_INVALID;
    case SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.SERIALIZATION_FAILED:
      return PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_SERIALIZATION_FAILED;
    case SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.SCHEMA_INCOMPATIBLE:
      return PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_SCHEMA_INCOMPATIBLE;
    case SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.CONFLICT_FAILED:
      return PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_CONFLICT_FAILED;
    case SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.READBACK_FAILED:
      return PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_READBACK_FAILED;
    case SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.WRITE_FAILED:
      return PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_WRITE_FAILED;
    default:
      return PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_PERSIST_FAILED;
  }
}

export async function loadBrainSnapshotFromMemory({
  baseUrl,
  secretKey,
  userId,
  projectId,
}) {
  const listed = await listProjectMemory({ baseUrl, secretKey, userId, projectId });
  if (!listed.ok) {
    return { ok: false, snapshot: null, evidenceHash: null, source: "memory_unavailable" };
  }

  let snapshot = null;
  let evidenceHash = null;

  for (const row of listed.rows) {
    if (row.memory_key === PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.snapshot) {
      const parsed = deserializeBrainSnapshotFromMemory(row.memory_value);
      snapshot = parsed.ok ? parsed.snapshot : null;
    }
    if (row.memory_key === PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.evidenceHash) {
      evidenceHash = String(row.memory_value || "").trim() || null;
    }
  }

  if (!snapshot) {
    return { ok: true, snapshot: null, evidenceHash, source: "missing" };
  }

  return { ok: true, snapshot, evidenceHash, source: "memory" };
}

async function verifySnapshotReadBack({
  baseUrl,
  secretKey,
  userId,
  projectId,
  expectedSnapshot,
  bundle = null,
  project = null,
  logFn = () => {},
}) {
  const loaded = await loadBrainSnapshotFromMemory({ baseUrl, secretKey, userId, projectId });
  if (!loaded.ok || !loaded.snapshot) {
    logBrainSnapshotPersistenceFailure(logFn, {
      operation: "readback",
      projectId,
      memoryKey: PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.snapshot,
      errorCategory: SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.READBACK_FAILED,
      readBackFailed: true,
      writeMayHaveSucceeded: true,
    });
    return {
      ok: false,
      errorCategory: SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.READBACK_FAILED,
      code: PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_READBACK_FAILED,
      reason: "snapshot_missing_after_write",
    };
  }

  if (loaded.snapshot.snapshotId !== expectedSnapshot.snapshotId) {
    return {
      ok: false,
      errorCategory: SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.READBACK_FAILED,
      code: PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_READBACK_FAILED,
      reason: "snapshot_id_mismatch",
    };
  }

  if (bundle && project) {
    const consistency = validateSnapshotAgainstWorkflowBundle({
      snapshot: loaded.snapshot,
      project,
      bundle,
      roadmapEvidenceHash: expectedSnapshot.roadmapEvidenceHash,
    });
    if (!consistency.valid) {
      return {
        ok: false,
        errorCategory: SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.READBACK_FAILED,
        code: PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_READBACK_FAILED,
        reason: "readback_consistency_failed",
        consistencyErrors: consistency.errors,
      };
    }
  }

  return { ok: true, snapshot: loaded.snapshot, evidenceHash: loaded.evidenceHash };
}

export async function persistBrainSnapshotToMemory({
  baseUrl,
  secretKey,
  userId,
  projectId,
  snapshot,
  bundle = null,
  project = null,
  logFn = () => {},
}) {
  const serialized = serializeBrainSnapshotForMemory(snapshot);
  if (!serialized.ok) {
    logBrainSnapshotPersistenceFailure(logFn, {
      operation: "serialize",
      projectId,
      memoryKey: PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.snapshot,
      errorCategory: serialized.errorCategory,
      serializationSucceeded: false,
      writeAttempted: false,
    });
    return {
      ok: false,
      code: mapCategoryToInternalCode(serialized.errorCategory),
      errorCategory: serialized.errorCategory,
      errors: serialized.errors || null,
      reason: serialized.reason || null,
    };
  }

  const saved = await upsertProjectMemoryFacts({
    baseUrl,
    secretKey,
    userId,
    projectId,
    facts: {
      [PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.snapshot]: serialized.serialized,
      [PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.evidenceHash]: serialized.snapshot.roadmapEvidenceHash,
    },
    source: PROJECT_MEMORY_ARTIFACT_SOURCES.brainSnapshot,
    logFn,
  });

  if (!saved.ok) {
    logBrainSnapshotPersistenceFailure(logFn, {
      operation: "write",
      projectId,
      memoryKey: PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.snapshot,
      httpStatus: saved.status ?? null,
      supabaseErrorCode: saved.error?.code ?? null,
      supabaseErrorMessage: saved.error?.message ?? null,
      errorCategory: saved.errorCategory || SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.WRITE_FAILED,
      payloadByteLength: serialized.byteLength,
      serializationSucceeded: true,
      writeAttempted: saved.writeAttempted !== false,
      writeMayHaveSucceeded: saved.writeMayHaveSucceeded === true,
      resolvedSource: saved.resolvedSource || null,
    });
    logBrainSnapshotEvent(logFn, {
      projectId,
      artifactType: "brain_snapshot",
      persistenceSucceeded: false,
      internalErrorCode: saved.internalCode || PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_PERSIST_FAILED,
    });
    return {
      ok: false,
      code: saved.internalCode || mapCategoryToInternalCode(saved.errorCategory),
      errorCategory: saved.errorCategory || SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.WRITE_FAILED,
      httpStatus: saved.status ?? null,
      supabaseErrorCode: saved.error?.code ?? null,
      writeMayHaveSucceeded: saved.writeMayHaveSucceeded === true,
    };
  }

  const readBack = await verifySnapshotReadBack({
    baseUrl,
    secretKey,
    userId,
    projectId,
    expectedSnapshot: serialized.snapshot,
    bundle,
    project,
    logFn,
  });

  if (!readBack.ok) {
    logBrainSnapshotEvent(logFn, {
      projectId,
      artifactType: "brain_snapshot",
      persistenceSucceeded: false,
      internalErrorCode: readBack.code,
    });
    return readBack;
  }

  logBrainSnapshotEvent(logFn, {
    projectId,
    workflowId: readBack.snapshot.workflow?.workflowId || null,
    artifactType: "brain_snapshot",
    artifactVersion: readBack.snapshot.snapshotVersion,
    evidenceHash: readBack.snapshot.roadmapEvidenceHash,
    persistenceSucceeded: true,
  });

  return { ok: true, snapshot: readBack.snapshot, readBackVerified: true };
}

export async function reconstructBrainSnapshot({
  baseUrl,
  secretKey,
  userId,
  project,
  bundle,
  clarificationAnswers = [],
  roadmapEvidenceHash,
  actionsByStepId = new Map(),
}) {
  const loaded = await loadBrainSnapshotFromMemory({ baseUrl, secretKey, userId, projectId: project.id });
  if (loaded.ok && loaded.snapshot) {
    return { ok: true, snapshot: loaded.snapshot, source: "memory", reconstructed: false };
  }

  if (!bundle?.workflow) {
    return { ok: false, snapshot: null, source: "workflow_missing" };
  }

  const snapshot = buildBrainSnapshotFromBundle({
    project,
    bundle,
    clarificationAnswers,
    roadmapEvidenceHash,
    actionsByStepId,
  });

  return {
    ok: true,
    snapshot,
    source: "reconstructed",
    reconstructed: true,
    persistRequired: false,
  };
}

export async function persistWorkflowAdaptationDecisionToMemory({
  baseUrl,
  secretKey,
  userId,
  projectId,
  payload,
  logFn = () => {},
}) {
  return upsertProjectMemoryFacts({
    baseUrl,
    secretKey,
    userId,
    projectId,
    facts: {
      [PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.adaptationLatest]: JSON.stringify(payload),
    },
    source: PROJECT_MEMORY_ARTIFACT_SOURCES.workflowAdaptation,
    logFn,
  });
}

export async function loadWorkflowAdaptationDecisionFromMemory({
  baseUrl,
  secretKey,
  userId,
  projectId,
}) {
  const listed = await listProjectMemory({ baseUrl, secretKey, userId, projectId });
  if (!listed.ok) return { ok: false, decision: null };

  const row = listed.rows.find(
    (item) => item.memory_key === PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.adaptationLatest,
  );
  if (!row) return { ok: true, decision: null };

  try {
    return { ok: true, decision: JSON.parse(row.memory_value) };
  } catch {
    return { ok: false, decision: null };
  }
}
