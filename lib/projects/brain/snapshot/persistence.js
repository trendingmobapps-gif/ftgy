import { listProjectMemory, upsertProjectMemoryFacts } from "../memory/repository.js";
import { PROJECT_BRAIN_INTERNAL_CODES } from "../project-brain-internal-codes.js";
import { logBrainSnapshotEvent } from "../brain-snapshot-observability.js";
import { PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS } from "./constants.js";
import { buildBrainSnapshotFromBundle } from "./builder.js";
import { validateBrainSnapshot } from "./schema.js";

function parseSnapshotJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
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
      snapshot = parseSnapshotJson(row.memory_value);
    }
    if (row.memory_key === PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.evidenceHash) {
      evidenceHash = String(row.memory_value || "").trim() || null;
    }
  }

  if (!snapshot) {
    return { ok: true, snapshot: null, evidenceHash, source: "missing" };
  }

  const validation = validateBrainSnapshot(snapshot);
  if (!validation.valid) {
    return {
      ok: false,
      snapshot: null,
      evidenceHash,
      source: "invalid",
      code: PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_INVALID,
      errors: validation.errors,
    };
  }

  return { ok: true, snapshot, evidenceHash, source: "memory" };
}

export async function persistBrainSnapshotToMemory({
  baseUrl,
  secretKey,
  userId,
  projectId,
  snapshot,
  logFn = () => {},
}) {
  const validation = validateBrainSnapshot(snapshot);
  if (!validation.valid) {
    logBrainSnapshotEvent(logFn, {
      projectId,
      artifactType: "brain_snapshot",
      persistenceSucceeded: false,
      internalErrorCode: PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_INVALID,
    });
    return {
      ok: false,
      code: PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_INVALID,
      errors: validation.errors,
    };
  }

  const saved = await upsertProjectMemoryFacts({
    baseUrl,
    secretKey,
    userId,
    projectId,
    facts: {
      [PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.snapshot]: JSON.stringify(snapshot),
      [PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.evidenceHash]: snapshot.roadmapEvidenceHash,
    },
    source: "brain_snapshot",
  });

  if (!saved.ok) {
    logBrainSnapshotEvent(logFn, {
      projectId,
      artifactType: "brain_snapshot",
      persistenceSucceeded: false,
      internalErrorCode: PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_PERSIST_FAILED,
    });
    return {
      ok: false,
      code: PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_PERSIST_FAILED,
    };
  }

  logBrainSnapshotEvent(logFn, {
    projectId,
    workflowId: snapshot.workflow?.workflowId || null,
    artifactType: "brain_snapshot",
    artifactVersion: snapshot.snapshotVersion,
    evidenceHash: snapshot.roadmapEvidenceHash,
    persistenceSucceeded: true,
  });

  return { ok: true, snapshot };
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
}) {
  return upsertProjectMemoryFacts({
    baseUrl,
    secretKey,
    userId,
    projectId,
    facts: {
      [PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS.adaptationLatest]: JSON.stringify(payload),
    },
    source: "workflow_adaptation",
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
