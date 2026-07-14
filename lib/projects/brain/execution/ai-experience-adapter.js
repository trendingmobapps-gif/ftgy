import { randomUUID } from "node:crypto";

import { AI_EXPERIENCE_VERSION } from "./ai-experience-schema.js";
import { validateExperienceSchema } from "./ai-experience-validation.js";
import { normalizeCompletionCriteria } from "./completion-evaluator.js";

function slugifyId(value, fallback = "field") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function mapInputTypeToComponent(field) {
  const type = String(field.type || "text").toLowerCase();

  if (type === "textarea") {
    return "long_text";
  }
  if (type === "number") {
    return "number";
  }
  if (type === "boolean") {
    return "boolean";
  }
  if (type === "single_choice" || type === "select" || type === "choice") {
    return "single_select";
  }
  if (type === "multiple_choice" || type === "multi_choice") {
    return "multi_select";
  }
  return "short_text";
}

function mapFieldToComponent(field, usedIds) {
  const baseId = slugifyId(field.id || field.key, "field");
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);

  const componentType = mapInputTypeToComponent(field);
  const base = {
    id,
    type: componentType,
    label: field.label || field.id || "Câmp",
    description: field.description || field.placeholder || null,
    placeholder: field.placeholder || null,
    required: field.required !== false,
    defaultValue: field.prefilledValue ?? field.defaultValue ?? null,
  };

  if (componentType === "short_text" || componentType === "long_text") {
    return {
      ...base,
      validation: {
        minLength: field.minLength ?? null,
        maxLength: field.maxLength ?? null,
      },
    };
  }

  if (componentType === "number") {
    return {
      ...base,
      unit: field.unit || null,
      validation: {
        min: field.min ?? null,
        max: field.max ?? null,
        step: field.step ?? null,
      },
    };
  }

  if (componentType === "boolean") {
    return {
      ...base,
      presentation: field.presentation === "toggle" ? "toggle" : "checkbox",
    };
  }

  if (componentType === "single_select" || componentType === "multi_select") {
    const options = (field.options || []).map((option, index) => {
      const optionId = slugifyId(option.id || option.value || option.label, `opt_${index + 1}`);
      return {
        id: optionId,
        label: option.label || option.value || optionId,
        description: option.description || null,
        recommended: option.recommended === true ? true : null,
      };
    });

    const mapped = {
      ...base,
      presentation: field.presentation === "cards" ? "cards" : "list",
      options,
    };

    if (componentType === "multi_select") {
      mapped.minSelections = field.minSelections ?? (base.required ? 1 : 0);
      mapped.maxSelections = field.maxSelections ?? options.length;
    }

    return mapped;
  }

  return base;
}

function buildResultDefinition(executionPlan, executionDefinition) {
  const outputType = executionPlan?.outputTypes?.[0] || "text";
  const typeMap = {
    text: "summary",
    table: "table",
    pdf: "document",
    docx: "document",
    xlsx: "table",
    image: "document",
  };

  return {
    type: typeMap[outputType] || "summary",
    title: executionDefinition?.title || executionPlan?.title || "Rezultat",
    createResource: true,
    updateMemory: true,
    reconsiderWorkflow: false,
    requireReview: executionPlan?.completionCriteria?.requireUserReview !== false,
    requireAcceptance: executionPlan?.completionCriteria?.requireUserAcceptance !== false,
  };
}

function buildCompletionCriteria(executionPlan) {
  const normalized = normalizeCompletionCriteria(executionPlan?.completionCriteria || {});
  return {
    requireAllRequiredComponents: normalized.requireAllInputs !== false,
    requireGeneratedResult: normalized.requireGeneratedResult !== false,
    requireUserReview: normalized.requireUserReview === true,
    requireUserAcceptance: normalized.requireUserAcceptance !== false,
    requireExplicitFinalize: normalized.requireExplicitFinalize !== false,
  };
}

export function adaptStructuredFormPlanToExperience({
  executionPlan,
  executionDefinition,
  actionId = null,
  stepId = null,
}) {
  if (!executionPlan || executionPlan.mode !== "structured_form") {
    return { ok: false, code: "ADAPTER_UNSUPPORTED_MODE" };
  }

  const fields = executionPlan.requiredInputs || [];
  const usedIds = new Set();
  const inputComponents = fields.map((field) => mapFieldToComponent(field, usedIds));

  const criteria = buildCompletionCriteria(executionPlan);
  const components = [...inputComponents];

  if (criteria.requireUserAcceptance) {
    const confirmId = "confirm_submission";
    if (!usedIds.has(confirmId)) {
      components.push({
        id: confirmId,
        type: "confirmation",
        label: "Confirm că informațiile introduse sunt corecte.",
        description: null,
        required: true,
      });
    }
  }

  const experienceId = `exp_${stepId || actionId || randomUUID().slice(0, 8)}_${AI_EXPERIENCE_VERSION}`;

  const experience = {
    experienceId,
    experienceVersion: AI_EXPERIENCE_VERSION,
    metadata: {
      title: executionDefinition?.title || executionPlan.title || "Completează informațiile",
      description: executionDefinition?.explanation || executionPlan.explanation || "",
      whyItMatters: executionDefinition?.whyItMatters || executionPlan.whyThisAction || "",
      expectedOutcome: executionDefinition?.expectedOutcome || executionPlan.expectedOutcome || "",
    },
    sections: [
      {
        id: "context",
        title: null,
        description: null,
        components: [
          {
            id: "intro_heading",
            type: "text_block",
            variant: "heading",
            content: executionDefinition?.title || executionPlan.title || "Completează informațiile",
          },
          ...(executionDefinition?.explanation || executionPlan.explanation
            ? [
                {
                  id: "intro_body",
                  type: "text_block",
                  variant: "paragraph",
                  content: executionDefinition?.explanation || executionPlan.explanation,
                },
              ]
            : []),
          ...(executionDefinition?.whyItMatters || executionPlan.whyThisAction
            ? [
                {
                  id: "intro_why",
                  type: "callout",
                  variant: "info",
                  title: "De ce contează",
                  content: executionDefinition?.whyItMatters || executionPlan.whyThisAction,
                },
              ]
            : []),
          ...(executionDefinition?.expectedOutcome || executionPlan.expectedOutcome
            ? [
                {
                  id: "intro_outcome",
                  type: "callout",
                  variant: "recommendation",
                  title: "Ce vei primi",
                  content: executionDefinition?.expectedOutcome || executionPlan.expectedOutcome,
                },
              ]
            : []),
        ],
      },
      {
        id: "inputs",
        title: "Informații necesare",
        description: null,
        components,
      },
    ],
    actions: {
      primary: {
        id: "submit",
        type: "submit",
        label:
          executionPlan.primaryActionLabel ||
          executionDefinition?.primaryActionLabel ||
          "Generează rezultatul",
      },
      secondary: [
        {
          id: "save_progress",
          type: "save_progress",
          label: "Salvează progresul",
        },
      ],
    },
    resultDefinition: buildResultDefinition(executionPlan, executionDefinition),
    completionCriteria: criteria,
  };

  const validation = validateExperienceSchema(experience);
  if (!validation.valid) {
    return {
      ok: false,
      code: "EXPERIENCE_VALIDATION_FAILED",
      errors: validation.errors,
    };
  }

  return {
    ok: true,
    experience: validation.normalized,
    generatedBy: "adapter",
  };
}

export function adaptExecutionPlanToExperience({ executionPlan, executionDefinition, actionId, stepId }) {
  if (executionPlan?.mode === "structured_form") {
    return adaptStructuredFormPlanToExperience({ executionPlan, executionDefinition, actionId, stepId });
  }
  return { ok: false, code: "ADAPTER_UNSUPPORTED_MODE" };
}
