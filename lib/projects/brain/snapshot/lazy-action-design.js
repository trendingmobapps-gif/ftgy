import { getExecutionPlanFromPreparedInput } from "../execution/execution-plan-generator.js";
import { shouldReuseExecutionPlan } from "../openai-model-reuse.js";
import { validateProjectBrainDecisionContract } from "../decision/contract-validator.js";
import { ACTION_DESIGN_STATUS } from "./constants.js";

export function resolveActionDesignStatusFromPreparedInput({
  preparedInput = {},
  evidenceHash = null,
  forceInvalid = false,
}) {
  if (forceInvalid) {
    return { status: ACTION_DESIGN_STATUS.INVALID, reason: "forced_invalid" };
  }

  const plan = getExecutionPlanFromPreparedInput(preparedInput);
  const brainDecision = preparedInput?._brainDecision || null;

  if (!plan && !brainDecision) {
    return { status: ACTION_DESIGN_STATUS.NOT_GENERATED, reason: "missing_contracts" };
  }

  if (brainDecision) {
    const validation = validateProjectBrainDecisionContract(brainDecision);
    if (!validation.valid) {
      return { status: ACTION_DESIGN_STATUS.INVALID, reason: "invalid_brain_decision" };
    }
  }

  if (plan && evidenceHash) {
    const reuse = shouldReuseExecutionPlan({
      preparedInput,
      evidenceHash,
      plan,
    });
    if (reuse.reuse) {
      return { status: ACTION_DESIGN_STATUS.GENERATED, reason: "evidence_unchanged" };
    }
    return { status: ACTION_DESIGN_STATUS.STALE, reason: reuse.reason || "evidence_changed" };
  }

  if (plan || brainDecision) {
    return { status: ACTION_DESIGN_STATUS.GENERATED, reason: "persisted_contracts_present" };
  }

  return { status: ACTION_DESIGN_STATUS.NOT_GENERATED, reason: "missing_contracts" };
}

export function shouldGenerateActionDesign({
  snapshot = null,
  stepId,
  preparedInput = {},
  evidenceHash = null,
  forceRegenerateInvalidPlan = false,
  readOnly = false,
}) {
  if (readOnly) {
    return {
      generate: false,
      reason: "read_only_operation",
      reuseHit: true,
    };
  }

  const blueprint = snapshot?.stepBlueprints?.find((item) => item.stepId === stepId) || null;
  const resolved = resolveActionDesignStatusFromPreparedInput({
    preparedInput,
    evidenceHash,
    forceInvalid: forceRegenerateInvalidPlan,
  });

  if (resolved.status === ACTION_DESIGN_STATUS.GENERATED && evidenceHash) {
    const plan = getExecutionPlanFromPreparedInput(preparedInput);
    const reuse = shouldReuseExecutionPlan({
      preparedInput,
      evidenceHash,
      plan,
    });
    if (reuse.reuse) {
      return {
        generate: false,
        reason: "action_design_reuse_hit",
        reuseHit: true,
        status: resolved.status,
        blueprintStatus: blueprint?.actionDesignStatus || resolved.status,
      };
    }
  }

  if (resolved.status === ACTION_DESIGN_STATUS.NOT_GENERATED) {
    return {
      generate: true,
      reason: "lazy_first_generation",
      reuseHit: false,
      status: resolved.status,
    };
  }

  if (resolved.status === ACTION_DESIGN_STATUS.STALE || resolved.status === ACTION_DESIGN_STATUS.INVALID) {
    return {
      generate: true,
      reason: resolved.reason,
      reuseHit: false,
      status: resolved.status,
    };
  }

  if (forceRegenerateInvalidPlan) {
    return {
      generate: true,
      reason: "explicit_regeneration_requested",
      reuseHit: false,
      status: resolved.status,
    };
  }

  return {
    generate: false,
    reason: "action_design_reuse_hit",
    reuseHit: true,
    status: resolved.status,
  };
}

export function assertLazyActionDesignInvariant({ roadmapGeneration = false, stepCount = 0, generatedActionDesignCount = 0 }) {
  if (roadmapGeneration && generatedActionDesignCount > 0) {
    return {
      ok: false,
      reason: "roadmap_must_not_generate_action_designs",
      stepCount,
      generatedActionDesignCount,
    };
  }
  return { ok: true };
}
