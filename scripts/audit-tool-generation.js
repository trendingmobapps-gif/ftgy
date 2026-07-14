#!/usr/bin/env node
/**
 * Audits all tool configs for generation policy alignment.
 * Run: node scripts/audit-tool-generation.js
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../tools/tools-config.js";
import {
  TOOL_GENERATION_POLICY,
  inferResponseProfile,
  resolveGenerationConfig,
} from "../tools/generation-policy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const VERBOSE_INSTRUCTION_PATTERNS = [
  /complet[ăa]?/i,
  /detaliat[ăa]?/i,
  /comprehensiv/i,
  /extins[ăa]?/i,
  /foarte detaliat/i,
  /maxim/i,
  /amănunt/i,
  /amanunt/i,
];

const REPEATED_INSTRUCTION_MARKERS = [
  "Scrie în limba română",
  "Nu menționa că ești",
  "family-friendly",
];

/**
 * @returns {import('../tools/generation-policy.js').ResponseProfile}
 */
function getResponseProfile(toolId, tool) {
  return inferResponseProfile(toolId, tool);
}

function auditTool(toolId, tool) {
  const systemPrompt = String(tool.systemPrompt || "");
  const responseProfile = getResponseProfile(toolId, tool);
  const config = resolveGenerationConfig(toolId, tool);

  const hasVerboseInstructions = VERBOSE_INSTRUCTION_PATTERNS.some((re) =>
    re.test(systemPrompt),
  );

  const hasRepeatedInstructions = REPEATED_INSTRUCTION_MARKERS.filter((marker) =>
    systemPrompt.includes(marker),
  ).length >= 2;

  const sectionMatch = systemPrompt.match(/Structurează răspunsul astfel:([\s\S]*)/i);
  const expectedOutputType = sectionMatch
    ? sectionMatch[1].trim().split("\n")[0].slice(0, 120)
    : "unspecified";

  return {
    toolSlug: toolId,
    categorySlug: tool.categorySlug || "unknown",
    model: config.models[0],
    modelProfile: config.modelProfile,
    responseProfile,
    maxOutputTokens: config.maxOutputTokens,
    promptCharacterCount: systemPrompt.trim().length,
    hasVerboseInstructions,
    hasRepeatedInstructions,
    expectedOutputType,
    numberedSections: (systemPrompt.match(/^\d+\./gm) || []).length,
    explicitProfile: tool.responseProfile || null,
  };
}

const audits = Object.entries(TOOLS).map(([toolId, tool]) => auditTool(toolId, tool));

const summary = {
  generatedAt: new Date().toISOString(),
  toolCount: audits.length,
  profileCounts: {
    concise: audits.filter((a) => a.responseProfile === "concise").length,
    default: audits.filter((a) => a.responseProfile === "default").length,
    detailed: audits.filter((a) => a.responseProfile === "detailed").length,
  },
  verboseTools: audits.filter((a) => a.hasVerboseInstructions).map((a) => a.toolSlug),
  highSectionTools: audits
    .filter((a) => a.numberedSections >= 6)
    .map((a) => ({ toolSlug: a.toolSlug, sections: a.numberedSections })),
  longPromptTools: audits
    .filter((a) => a.promptCharacterCount >= 900)
    .sort((a, b) => b.promptCharacterCount - a.promptCharacterCount)
    .map((a) => ({
      toolSlug: a.toolSlug,
      promptCharacterCount: a.promptCharacterCount,
    })),
  manualReviewRecommended: audits
    .filter(
      (a) =>
        a.hasVerboseInstructions ||
        a.numberedSections >= 8 ||
        (a.responseProfile === "concise" && a.numberedSections >= 4),
    )
    .map((a) => a.toolSlug),
  policy: TOOL_GENERATION_POLICY,
};

const report = { summary, tools: audits };

const reportsDir = join(root, "reports");
mkdirSync(reportsDir, { recursive: true });
const outPath = join(reportsDir, "tool-generation-audit.json");
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`Wrote ${outPath}`);
console.log("Profile counts:", summary.profileCounts);
console.log("Verbose tools:", summary.verboseTools.length);
console.log("Manual review recommended:", summary.manualReviewRecommended.length);
