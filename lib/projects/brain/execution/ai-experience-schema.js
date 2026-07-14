export const AI_EXPERIENCE_VERSION = 1;

export const PHASE_1_COMPONENT_TYPES = new Set([
  "text_block",
  "callout",
  "short_text",
  "long_text",
  "number",
  "boolean",
  "single_select",
  "multi_select",
  "confirmation",
]);

export const TEXT_BLOCK_VARIANTS = new Set(["heading", "paragraph", "caption"]);
export const CALLOUT_VARIANTS = new Set(["info", "warning", "example", "recommendation"]);
export const BOOLEAN_PRESENTATIONS = new Set(["checkbox", "toggle"]);
export const SELECT_PRESENTATIONS = new Set(["list", "cards", "segmented"]);

export const EXPERIENCE_LIMITS = {
  maxSections: 10,
  maxComponentsTotal: 40,
  maxOptionsPerSelect: 20,
  maxTextValueLength: 10_000,
  maxLabelLength: 500,
  maxContentLength: 5_000,
};

export function isAiExperienceV1Enabled() {
  const flag = process.env.PROJECT_AI_EXPERIENCE_V1_ENABLED;
  if (flag == null || flag === "") return false;
  return flag === "1" || flag.toLowerCase() === "true";
}

export function countExperienceComponents(experience) {
  if (!experience?.sections) return 0;
  return experience.sections.reduce((sum, section) => sum + (section.components?.length || 0), 0);
}

export function collectComponentTypes(experience) {
  const types = [];
  for (const section of experience?.sections || []) {
    for (const component of section.components || []) {
      if (component?.type) types.push(component.type);
    }
  }
  return types;
}
