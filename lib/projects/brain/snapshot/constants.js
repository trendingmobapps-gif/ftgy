export const PROJECT_BRAIN_SNAPSHOT_VERSION = 1;

export const PROJECT_BRAIN_SNAPSHOT_MEMORY_KEYS = {
  snapshot: "brain_snapshot_v1",
  evidenceHash: "brain_snapshot_v1_evidence_hash",
  adaptationLatest: "brain_workflow_adaptation_latest",
};

export const ACTION_DESIGN_STATUS = {
  NOT_GENERATED: "not_generated",
  GENERATED: "generated",
  STALE: "stale",
  INVALID: "invalid",
};

export const EXPECTED_RESULT_INTENTS = [
  "context_only",
  "plan",
  "recommendation",
  "diagnostic",
  "document",
  "verification",
  "resource",
  "other",
];

export const EXPECTED_RESOURCE_INTENTS = ["none", "possible", "required"];

export const PROJECT_BRAIN_SNAPSHOT_MODEL_METADATA = {
  modelRole: "roadmap",
  modelPolicyVersion: "projects-strategic-calls-v1",
  promptVersion: "brain-snapshot-v1",
  adaptationPolicyVersion: "workflow-adaptation-gate-v1",
};
