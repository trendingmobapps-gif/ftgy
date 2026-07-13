import { TOOLS } from "../../../../tools/tools-config.js";
import { memoryHasKnownField } from "../memory/service.js";
import { findReusableResourceForStep } from "../resources/registry.js";

const WEB_RESEARCH_MARKERS = [
  "lege",
  "legislat",
  "tax",
  "taxe",
  "autoriz",
  "permis",
  "regulament",
  "concurent",
  "preturi",
  "piata",
  "furnizor",
  "universitat",
  "job",
  "salar",
  "trend",
  "stiri",
  "actual",
];

export const EXECUTION_STRATEGIES = [
  "reuse_resource",
  "use_tool",
  "generate_resource",
  "web_then_generate",
  "ask_clarification",
  "continue_workflow",
];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toolMatchesStep(step, toolId) {
  if (!toolId || !TOOLS[toolId]) return false;
  const haystack = normalize(`${step.title} ${step.expected_outcome} ${step.description}`);
  const tool = TOOLS[toolId];
  const toolHaystack = normalize(`${tool.name} ${tool.summary || ""}`);
  const tokens = toolHaystack.split(/\s+/).filter((token) => token.length > 4);
  return tokens.some((token) => haystack.includes(token));
}

function needsFreshInformation({ project, step, memoryMap }) {
  const haystack = normalize(`${project?.goal || ""} ${step?.title || ""} ${step?.expected_outcome || ""}`);
  const markerHit = WEB_RESEARCH_MARKERS.some((marker) => haystack.includes(marker));
  if (!markerHit) return false;

  const freshnessKeys = ["an_fiscal", "reglementare", "piata", "concurenta", "preturi"];
  return !freshnessKeys.some((key) => memoryHasKnownField(memoryMap, key));
}

export function decideExecutionStrategy({
  project,
  step,
  preparation,
  memoryMap = new Map(),
  reusableResource = null,
}) {
  if (reusableResource) {
    return {
      strategy: "reuse_resource",
      reason: "Resursa există deja în proiect.",
      reusableResourceId: reusableResource.id,
      resourceFormat: reusableResource.type,
      requiresWebSearch: false,
      visibleToUser: false,
    };
  }

  const missing = (preparation?.missingFields || []).filter(
    (field) => !memoryHasKnownField(memoryMap, field.key),
  );

  if (missing.length > 0) {
    return {
      strategy: "ask_clarification",
      reason: "Lipsește o singură informație necesară.",
      pendingField: missing[0],
      requiresWebSearch: false,
      visibleToUser: false,
    };
  }

  const toolId = step?.tool_id || preparation?.capabilityRef;
  if (preparation?.capabilityType === "tool" && toolId && toolMatchesStep(step, toolId)) {
    return {
      strategy: "use_tool",
      reason: "Capacitatea existentă acoperă perfect obiectivul.",
      capabilityRef: toolId,
      resourceFormat: "document",
      requiresWebSearch: false,
      visibleToUser: false,
    };
  }

  if (needsFreshInformation({ project, step, memoryMap })) {
    return {
      strategy: "web_then_generate",
      reason: "Este utilă o verificare rapidă a informațiilor actuale.",
      resourceFormat: "document",
      requiresWebSearch: true,
      webSearchExecuted: false,
      visibleToUser: false,
    };
  }

  return {
    strategy: "generate_resource",
    reason: "ITER va crea o resursă nouă pentru acest pas.",
    resourceFormat: "markdown",
    requiresWebSearch: false,
    visibleToUser: false,
  };
}

export async function resolveContinueDecision({
  baseUrl,
  secretKey,
  userId,
  project,
  step,
  preparation,
  memoryMap,
  schemaCapabilities = null,
}) {
  let reusableResource = null;

  if (schemaCapabilities?.adaptiveTables !== false) {
    try {
      reusableResource = await findReusableResourceForStep({
        baseUrl,
        secretKey,
        userId,
        projectId: project.id,
        stepId: step.id,
      });
    } catch {
      reusableResource = null;
    }
  }

  const decision = decideExecutionStrategy({
    project,
    step,
    preparation,
    memoryMap,
    reusableResource,
  });

  return {
    decision,
    reusableResource,
  };
}
