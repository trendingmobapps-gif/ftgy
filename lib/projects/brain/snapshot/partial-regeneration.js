import { ACTION_DESIGN_STATUS } from "./constants.js";

const SCHEDULING_SIGNALS = /\b(deadline|calendar|schedule|timeline|date|termen|planific)\b/i;
const FINANCIAL_SIGNALS = /\b(budget|buget|cost|finance|financial|invest)\b/i;
const LEARNING_SIGNALS = /\b(learn|study|lesson|training|curs|pregatire)\b/i;
const IDENTITY_SIGNALS = /\b(brand|identity|positioning|nume|name|logo)\b/i;

function stepMatchesSignals(step, signals) {
  const haystack = `${step.title || ""} ${step.description || ""} ${step.expected_outcome || ""} ${step.rationale || ""}`;
  return signals.test(haystack);
}

export function identifyAffectedSteps({ changeSignals = [], steps = [], snapshot = null }) {
  const affected = new Set();
  const preserved = new Set();
  const signalSet = new Set(changeSignals);

  for (const step of steps || []) {
    if (step.status === "completed" || step.status === "skipped") {
      preserved.add(step.id);
      continue;
    }

    let isAffected = false;

    if (signalSet.has("goal_changed") || signalSet.has("scope_changed")) {
      isAffected = true;
    }
    if (signalSet.has("deadline_changed") && stepMatchesSignals(step, SCHEDULING_SIGNALS)) {
      isAffected = true;
    }
    if (signalSet.has("budget_changed") && stepMatchesSignals(step, FINANCIAL_SIGNALS)) {
      isAffected = true;
    }
    if (signalSet.has("diagnostic_accepted") && stepMatchesSignals(step, LEARNING_SIGNALS)) {
      isAffected = true;
    }
    if (signalSet.has("identity_accepted") && stepMatchesSignals(step, IDENTITY_SIGNALS)) {
      isAffected = true;
    }

    if (isAffected) {
      affected.add(step.id);
    } else {
      preserved.add(step.id);
    }
  }

  return {
    affectedStepIds: [...affected],
    preservedStepIds: [...preserved],
    partialRegenerationPossible: affected.size > 0 && preserved.size > 0,
  };
}

export function markAffectedStepDesignsStale(snapshot, affectedStepIds = []) {
  if (!snapshot || !Array.isArray(snapshot.stepBlueprints)) {
    return snapshot;
  }

  const affected = new Set(affectedStepIds);
  snapshot.stepBlueprints = snapshot.stepBlueprints.map((blueprint) =>
    affected.has(blueprint.stepId)
      ? {
          ...blueprint,
          actionDesignStatus: ACTION_DESIGN_STATUS.STALE,
          actionDesignEvidenceHash: null,
        }
      : blueprint,
  );
  snapshot.updatedAt = new Date().toISOString();
  return snapshot;
}

export function evaluatePartialRegenerationScope({
  changeSignals = [],
  steps = [],
  snapshot = null,
}) {
  const scope = identifyAffectedSteps({ changeSignals, steps, snapshot });

  if (!scope.partialRegenerationPossible) {
    return {
      mode: "full_roadmap_regeneration_required",
      requiresUserApproval: true,
      affectedStepCount: scope.affectedStepIds.length,
      preservedStepCount: scope.preservedStepIds.length,
      internalCode: "PROJECT_PARTIAL_REGENERATION_REQUIRED",
    };
  }

  return {
    mode: "localized_action_design_stale",
    requiresUserApproval: changeSignals.includes("goal_changed") || changeSignals.includes("scope_changed"),
    affectedStepCount: scope.affectedStepIds.length,
    preservedStepCount: scope.preservedStepIds.length,
    affectedStepIds: scope.affectedStepIds,
    preservedStepIds: scope.preservedStepIds,
  };
}

export function deriveChangeSignalsFromMaterialGate(gateDecision = {}) {
  const signals = [];
  if (gateDecision.reason === "roadmap_evidence_changed") {
    signals.push("goal_changed");
  }
  return signals;
}

export function incrementWorkflowSnapshotVersion(snapshot) {
  if (!snapshot) return snapshot;
  const current = Number(String(snapshot.roadmapVersion || "1").split(":")[0]) || 1;
  snapshot.roadmapVersion = `${current + 1}`;
  snapshot.updatedAt = new Date().toISOString();
  return snapshot;
}
