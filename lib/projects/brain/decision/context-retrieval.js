import { createHash } from "node:crypto";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(" ").filter((token) => token.length > 3));
}

function overlapScore(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / Math.max(a.size, b.size);
}

function toSafeRef(id, kind, label, provenance, extras = {}) {
  return {
    id: String(id),
    kind,
    label: String(label || kind).slice(0, 120),
    provenance: String(provenance || "project").slice(0, 80),
    ...extras,
  };
}

function listResultRows(resultsByStepId) {
  if (resultsByStepId instanceof Map) {
    const accepted = Array.isArray(resultsByStepId.acceptedResults)
      ? resultsByStepId.acceptedResults
      : [];
    const combined = [...accepted, ...resultsByStepId.values()];
    return [...new Map(combined.filter(Boolean).map((row) => [row.id, row])).values()];
  }
  if (Array.isArray(resultsByStepId)) return resultsByStepId;
  return Object.values(resultsByStepId || {});
}

function findSatisfyingAcceptedResult(rows, step) {
  const accepted = rows.filter((row) => row?.acceptance_status === "accepted");
  const exact = accepted.find((row) => row.step_id === step?.id);
  if (exact) return exact;

  const objective = `${step?.title || ""} ${step?.expected_outcome || ""}`;
  return (
    accepted
      .map((row) => ({
        row,
        score: overlapScore(objective, `${row.title || ""} ${row.preview || ""}`),
      }))
      .filter((candidate) => candidate.score >= 0.45)
      .sort((a, b) => b.score - a.score)[0]?.row || null
  );
}

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableSort(value[key])]),
  );
}

export function hashProjectBrainDecisionEvidence(evidence) {
  const safeFingerprint = {
    project: {
      id: evidence.projectRef?.id || null,
      version: evidence.projectRef?.version || null,
    },
    step: {
      id: evidence.stepRef?.id || null,
      version: evidence.stepRef?.version || null,
      status: evidence.stepRef?.status || null,
    },
    workflow: evidence.knownContext.workflowRefs.map((ref) => [ref.id, ref.version || null]),
    decisions: evidence.knownContext.decisionRefs.map((ref) => [ref.id, ref.version || null]),
    memory: evidence.knownContext.memoryRefs.map((ref) => [ref.id, ref.version || null]),
    knowledge: evidence.knownContext.knowledgeRefs.map((ref) => [ref.id, ref.version || null]),
    resources: evidence.knownContext.resourceRefs.map((ref) => [ref.id, ref.version || null]),
    results: evidence.knownContext.resultRefs.map((ref) => [
      ref.id,
      ref.version || null,
      ref.acceptanceStatus || null,
    ]),
    missingKeys: evidence.materialMissingInformation.map((item) => item.key).sort(),
    research: {
      required: evidence.research.required,
      available: evidence.research.available,
    },
    safetyStatus: evidence.safetyStatus,
    externalActionRequired: evidence.externalActionRequired,
    verificationOnly: evidence.verificationOnly,
    deferState: evidence.deferState,
    workflowRedundancyStepId: evidence.workflowRedundancy?.stepId || null,
  };

  return createHash("sha256")
    .update(JSON.stringify(stableSort(safeFingerprint)))
    .digest("hex");
}

/**
 * Builds safe, ordered evidence for the deterministic adapter. The order of
 * assembly mirrors the product policy: identity → decisions → memory →
 * knowledge availability → resources → accepted results → workflow →
 * research → remaining questions.
 */
export function retrieveProjectBrainDecisionContext({
  project,
  step,
  action = null,
  workflow = null,
  memoryMap = new Map(),
  memoryVersions = new Map(),
  reusableResource = null,
  resultsByStepId = new Map(),
  preparation = null,
  executionDecision = null,
  knowledgeAvailable = false,
  researchAvailable = false,
  safetyStatus = "allowed",
  externalActionRequired = false,
  verificationOnly = false,
  deferState = false,
  workflowRedundancy = null,
  retrievalStatus: retrievalStatusOverrides = {},
}) {
  const memoryEntries = memoryMap instanceof Map ? [...memoryMap.keys()] : Object.keys(memoryMap || {});
  const resultRows = listResultRows(resultsByStepId);
  const acceptedRows = resultRows.filter((row) => row?.acceptance_status === "accepted");
  const satisfyingAcceptedResult = findSatisfyingAcceptedResult(resultRows, step);

  // The current action's persisted decision is a cache candidate, not prior
  // evidence. Prior decisions from other steps are not loaded by Step 1 yet.
  const decisionRefs = [];

  const memoryRefs = memoryEntries.map((key) =>
    toSafeRef(key, "memory", key, "project_memory", {
      version: memoryVersions.get?.(key) || null,
    }),
  );

  const resourceRefs = reusableResource?.id
    ? [
        toSafeRef(
          reusableResource.id,
          "resource",
          reusableResource.title || reusableResource.type || "Project resource",
          "project_resources",
          {
            version: reusableResource.updatedAt || reusableResource.createdAt || null,
            stepId: reusableResource.stepId || step?.id || null,
          },
        ),
      ]
    : [];

  const resultRefs = acceptedRows.map((row) =>
    toSafeRef(row.id, "result", row.title || "Accepted result", "project_action_results", {
      version: row.updated_at || row.created_at || null,
      stepId: row.step_id || null,
      acceptanceStatus: "accepted",
    }),
  );

  const workflowRefs = workflow?.id
    ? [
        toSafeRef(workflow.id, "workflow", "Current workflow", "project_workflows", {
          version: workflow.updated_at || workflow.version || null,
        }),
      ]
    : [];

  const missingFields = Array.isArray(preparation?.missingFields) ? preparation.missingFields : [];
  const researchRequired = Boolean(executionDecision?.requiresWebSearch);
  const materialMissingInformation = missingFields.map((field) => ({
    key: String(field.key || field.id || "missing_information"),
    reason: `Informația este necesară pentru a adapta rezultatul pasului curent.`,
    materialImpact: `Poate schimba conținutul sau recomandarea livrată pentru „${String(
      step?.title || "acest pas",
    ).slice(0, 100)}”.`,
    canInfer: false,
    canResearch: researchRequired,
    mustAskUser: true,
  }));

  const evidence = {
    projectRef: {
      id: project?.id || null,
      version: project?.updated_at || project?.version || null,
    },
    stepRef: {
      id: step?.id || null,
      version: step?.updated_at || step?.version || null,
      status: step?.status || null,
    },
    objective: String(step?.expected_outcome || step?.title || project?.goal || "").trim(),
    projectGoalAvailable: Boolean(String(project?.goal || "").trim()),
    stepObjectiveAvailable: Boolean(String(step?.expected_outcome || step?.title || "").trim()),
    knownContext: {
      decisionRefs,
      memoryRefs,
      knowledgeRefs: [],
      resourceRefs,
      resultRefs,
      workflowRefs,
    },
    retrievalStatus: {
      projectChecked: true,
      priorDecisionsChecked: true,
      memoryChecked: true,
      knowledgeChecked: true,
      knowledgeAvailable: Boolean(knowledgeAvailable),
      resourcesChecked: true,
      resultsChecked: true,
      workflowChecked: true,
      researchChecked: true,
      ...retrievalStatusOverrides,
    },
    materialMissingInformation,
    reusableResource,
    satisfyingAcceptedResult,
    research: {
      required: researchRequired,
      available: Boolean(researchAvailable),
    },
    safetyStatus,
    externalActionRequired: Boolean(externalActionRequired),
    verificationOnly: Boolean(verificationOnly),
    deferState: Boolean(deferState),
    workflowRedundancy,
    legacyDecision: executionDecision || null,
    legacyQuestionCount: missingFields.length,
  };

  return {
    ...evidence,
    evidenceHash: hashProjectBrainDecisionEvidence(evidence),
  };
}
