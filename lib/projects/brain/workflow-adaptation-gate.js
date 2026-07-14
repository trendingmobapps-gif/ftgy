import { createHash } from "node:crypto";

import { PROJECT_MODEL_POLICY_VERSION } from "./openai-evidence-hash.js";

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map(stableSort);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSort(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function hashFingerprint(fingerprint) {
  return createHash("sha256").update(JSON.stringify(stableSort(fingerprint))).digest("hex");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function computeWorkflowAdaptationEvidenceFingerprint({
  completedStep = null,
  acceptedResult = null,
  acceptedResource = null,
  memoryMap = null,
  workflowVersion = null,
  acceptedDecisions = [],
}) {
  const memoryEntries =
    memoryMap instanceof Map
      ? [...memoryMap.entries()]
          .map(([key, value]) => ({ key, value: normalizeText(value) }))
          .sort((a, b) => a.key.localeCompare(b.key))
      : [];

  return {
    modelPolicyVersion: PROJECT_MODEL_POLICY_VERSION,
    workflowVersion: workflowVersion || null,
    completedStepId: completedStep?.id || null,
    completedStepStatus: completedStep?.status || null,
    acceptedResultId: acceptedResult?.id || null,
    acceptedResultType: acceptedResult?.result_type || acceptedResult?.resultType || null,
    acceptedResourceId: acceptedResource?.id || null,
    acceptedResourceType: acceptedResource?.resource_type || acceptedResource?.type || null,
    memorySnapshot: memoryEntries,
    acceptedDecisions: (acceptedDecisions || [])
      .map((item) => ({
        id: item?.id || item?.decisionId || null,
        version: item?.version || null,
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}

export function computeWorkflowAdaptationEvidenceHash(input) {
  return hashFingerprint(computeWorkflowAdaptationEvidenceFingerprint(input));
}

export function detectWorkflowMaterialChanges({
  completedStep = null,
  acceptedResult = null,
  acceptedResource = null,
  memoryMap = null,
}) {
  const signals = [];

  if (completedStep?.status === "completed") {
    signals.push("step_completed");
  }

  if (acceptedResult?.id) {
    signals.push("accepted_result");
  }

  if (acceptedResource?.id) {
    signals.push("accepted_resource");
  }

  if (memoryMap instanceof Map && memoryMap.size > 0) {
    signals.push("memory_updated");
  }

  return {
    materialChange: signals.length > 0,
    signals,
  };
}

/**
 * Deterministic gate before any frontier workflow-adaptation call.
 * OpenAI adaptation is not invoked here; this module only decides whether it would be permitted.
 */
export function evaluateWorkflowAdaptationGate({
  bundle = null,
  completedStep = null,
  acceptedResult = null,
  acceptedResource = null,
  memoryMap = null,
  persistedAdaptation = null,
}) {
  const evidenceHash = computeWorkflowAdaptationEvidenceHash({
    completedStep,
    acceptedResult,
    acceptedResource,
    memoryMap,
    workflowVersion: bundle?.workflow?.brain_version || bundle?.workflow?.version || null,
  });

  if (
    persistedAdaptation?.evidenceHash &&
    persistedAdaptation.evidenceHash === evidenceHash &&
    persistedAdaptation.outcome === "workflow_reconsideration_not_required"
  ) {
    return {
      modelCallPermitted: false,
      reuse: true,
      outcome: "workflow_reconsideration_not_required",
      evidenceHash,
      deterministicEvolutionPermitted: false,
    };
  }

  const material = detectWorkflowMaterialChanges({
    completedStep,
    acceptedResult,
    acceptedResource,
    memoryMap,
  });

  if (!material.materialChange) {
    return {
      modelCallPermitted: false,
      reuse: false,
      outcome: "workflow_reconsideration_not_required",
      evidenceHash,
      persistDecision: true,
      deterministicEvolutionPermitted: false,
      materialSignals: material.signals,
    };
  }

  if (persistedAdaptation?.evidenceHash === evidenceHash) {
    return {
      modelCallPermitted: false,
      reuse: true,
      outcome: persistedAdaptation.outcome || "workflow_adaptation_recorded",
      evidenceHash,
      deterministicEvolutionPermitted: persistedAdaptation.allowDeterministicEvolution !== false,
      requiresUserApproval: persistedAdaptation.requiresUserApproval === true,
    };
  }

  return {
    modelCallPermitted: true,
    maxFrontierCalls: 1,
    reuse: false,
    outcome: "workflow_adaptation_eligible",
    evidenceHash,
    deterministicEvolutionPermitted: true,
    materialSignals: material.signals,
    requiresUserApproval: true,
  };
}

export function buildWorkflowAdaptationPersistencePayload(gateDecision) {
  return {
    outcome: gateDecision.outcome,
    evidenceHash: gateDecision.evidenceHash,
    modelCallPermitted: gateDecision.modelCallPermitted,
    requiresUserApproval: gateDecision.requiresUserApproval === true,
    allowDeterministicEvolution: gateDecision.deterministicEvolutionPermitted === true,
    materialSignals: gateDecision.materialSignals || [],
    recordedAt: new Date().toISOString(),
  };
}

async function supabaseFetch(fetchImpl, url, options) {
  try {
    const resp = await fetchImpl(url, options);
    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error?.message || "network error" };
  }
}

function authHeaders(secretKey, extra) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
    ...(extra || {}),
  };
}

export async function recordWorkflowAdaptationDecision({
  baseUrl,
  secretKey,
  userId,
  projectId,
  workflowId = null,
  stepId = null,
  gateDecision,
  fetchImpl = fetch,
}) {
  const payload = buildWorkflowAdaptationPersistencePayload(gateDecision);
  const eventType =
    gateDecision.outcome === "workflow_reconsideration_not_required"
      ? "workflow_reconsideration_not_required"
      : "workflow_adaptation_gate";

  const response = await supabaseFetch(fetchImpl, `${baseUrl}/rest/v1/project_workflow_events`, {
    method: "POST",
    headers: authHeaders(secretKey),
    body: JSON.stringify({
      project_id: projectId,
      user_id: userId,
      workflow_id: workflowId || null,
      step_id: stepId || null,
      event_type: eventType,
      reason: gateDecision.outcome,
      payload,
    }),
  });

  return {
    ok: response.ok,
    payload,
    eventType,
  };
}
