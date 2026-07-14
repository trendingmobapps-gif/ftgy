import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOL_WORKFLOW_PRIORITIES } from "./workflow-priorities.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(
  readFileSync(join(__dirname, "registry.json"), "utf8"),
);

const STANDALONE_TOOL_SLUGS = new Set([
  "generator-hook-tiktok",
  "generator-script-video-vanzari",
  "generator-titluri-reclame",
  "consultant-business-ai",
  "profesor-ai",
  "explica-formule",
  "traducere-academica",
  "corectare-eseu",
  "cercetare-academica",
  "bibliografie-automata",
  "rezuma-pdf",
  "generator-referat",
  "generator-eseu",
  "generator-prezentare",
  "plan-licenta",
  "plan-de-invatare",
  "mentor-cariera-ai",
  "obicetive-personale",
  "profil-profesional",
  "optimizare-linkedin",
  "descriere-linkedin",
  "cv-ats-optimized",
  "analiza-oferta-angajare",
  "analiza-competente",
  "negociere-salariu",
  "email-profesional",
  "intrebari-interviu",
  "strategii-aplicare-job",
  "schimbare-cariera",
  "pregatire-evaluare-anuala",
  "plan-promovare",
  "portofoliu-profesional",
  "antrenor-personal-ai",
  "calculator-calorii",
  "calculator-macronutrienti",
  "analiza-alimentatie",
  "program-acasa",
  "program-sala",
  "program-abdomen",
  "program-forta",
  "program-alergare",
  "program-incepatori",
  "program-avansati",
  "plan-deficit-caloric",
  "plan-surplus-caloric",
  "planner-meal-prep",
  "consultant-financiar-ai",
  "calculator-economii",
  "analiza-credit",
  "comparare-credite",
  "analiza-masiva-vs-lesing",
  "analiza-chirie-vs-cumparere",
  "analiza-achizitie-mare",
  "analiza-rentabilitate",
  "plan-investitii",
  "plan-pensie",
  "plan-independeta-financiara",
  "obiective-financiare",
  "fond-de-urgenta",
  "plan-crestere-venituri",
  "strategie-cashflow-personal",
  "plan-financial-lunar",
  "coach-comunicare-ai",
  "feedback-constructiv",
  "cerere-oficiala",
  "prezentare",
  "mesaj-client-nemultumit",
  "comunicare-in-relatii",
  "mesaj-de-despartire",
  "mesaj-de-impacare",
  "raspuns-mesaj-dificil",
  "negociere-comerciala",
  "negociere-profesionala",
  "reclamatie",
  "discurs",
  "scrisoare-formala",
  "raspuns-la-email",
  "networking-message",
  "consultant-social-media-ai",
  "bio-instagram",
  "bio-tiktok",
  "caption-instagram",
  "generator-hook",
  "hashtag-generator",
  "idei-reels",
  "idei-youtube",
  "titluri-youtube",
  "descrieri-youtube",
  "script-youtube",
  "strategie-youtube",
  "repurposing-content",
  "raspuns-comentarii",
  "asistent-personal-ai",
  "organizare-zilnica",
  "organizare-saptamanala",
  "organizare-casa",
  "organizare-eveniment",
  "organizare-mutare",
  "planner-weekend",
  "planner-cumparaturi",
  "planner-concediu",
  "checklist-personalizat",
  "plan-economisire-timp",
  "plan-productivitate",
  "planificare-proiect-personal",
  "organizare-familie",
  "decizie-importanta",
]);

const workflowDefinitions = (registry.workflows ?? []).filter(
  (workflow) => workflow.status !== "archived",
);

export function getLoadedRegistryMetadata() {
  return {
    schemaVersion: registry.schemaVersion ?? registry.version ?? 1,
    sourceHash: registry.sourceHash ?? null,
    workflowCount: registry.workflowCount ?? workflowDefinitions.length,
    generatedAt: registry.generatedAt ?? null,
  };
}

function getWorkflowById(workflowId) {
  return workflowDefinitions.find((workflow) => workflow.id === workflowId);
}

function getWorkflowsForTool(toolId) {
  return workflowDefinitions.filter((workflow) =>
    workflow.nodes.some((node) => node.type === "tool" && node.toolId === toolId),
  );
}

function getNodeById(workflow, nodeId) {
  return workflow.nodes.find((node) => node.id === nodeId);
}

function getOutgoingEdges(workflow, nodeId) {
  return workflow.edges.filter((edge) => edge.from === nodeId);
}

function getNextNodeIds(workflow, currentNodeId) {
  return getOutgoingEdges(workflow, currentNodeId).map((edge) => edge.to);
}

function getPrimaryNextStepId(workflow, currentNodeId) {
  return getNextNodeIds(workflow, currentNodeId)[0] ?? null;
}

function isStandaloneTool(toolSlug) {
  return STANDALONE_TOOL_SLUGS.has(toolSlug);
}

export function resolveWorkflowForTool(toolId, options = {}) {
  if (options.workflowId) {
    const explicit = getWorkflowById(options.workflowId);
    const containsTool = explicit?.nodes.some(
      (node) => node.type === "tool" && node.toolId === toolId,
    );

    if (explicit && containsTool) {
      return { status: "resolved", selectedWorkflowId: explicit.id };
    }

    return { status: "not_found" };
  }

  let candidates = getWorkflowsForTool(toolId);

  if (options.categorySlug) {
    candidates = candidates.filter(
      (workflow) => workflow.categorySlug === options.categorySlug,
    );
  }

  if (candidates.length === 0) {
    if (isStandaloneTool(toolId)) {
      return { status: "standalone" };
    }

    return { status: "not_found" };
  }

  if (candidates.length === 1) {
    return { status: "resolved", selectedWorkflowId: candidates[0].id };
  }

  const priorities = TOOL_WORKFLOW_PRIORITIES[toolId];
  if (priorities) {
    const scored = candidates
      .map((workflow) => ({
        workflow,
        score: priorities[workflow.id] ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.score - b.score);

    const bestScore = scored[0]?.score;
    const bestMatches = scored.filter((entry) => entry.score === bestScore);

    if (bestMatches.length === 1 && bestScore !== Number.MAX_SAFE_INTEGER) {
      return {
        status: "resolved",
        selectedWorkflowId: bestMatches[0].workflow.id,
      };
    }
  }

  const workflowPriority = candidates
    .map((workflow) => ({
      workflow,
      priority: workflow.priority ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.priority - b.priority);

  if (
    workflowPriority.length > 1 &&
    workflowPriority[0].priority !== workflowPriority[1].priority
  ) {
    return {
      status: "resolved",
      selectedWorkflowId: workflowPriority[0].workflow.id,
    };
  }

  return {
    status: "ambiguous",
    candidateWorkflowIds: candidates.map((workflow) => workflow.id).sort(),
  };
}

function findToolNodeInWorkflow(workflowId, toolSlug, sourceStepId) {
  const workflow = getWorkflowById(workflowId);
  if (!workflow) {
    return { workflow: undefined, currentNode: undefined };
  }

  if (sourceStepId) {
    const explicitNode = getNodeById(workflow, sourceStepId);
    if (explicitNode?.type === "tool" && explicitNode.toolId === toolSlug) {
      return { workflow, currentNode: explicitNode };
    }
  }

  const currentNode = workflow.nodes.find(
    (node) => node.type === "tool" && node.toolId === toolSlug,
  );

  return { workflow, currentNode };
}

export function resolveGeneratedNextAction({
  toolSlug,
  categorySlug,
  workflowContext,
  getToolConfig,
}) {
  const sourceTool = getToolConfig(toolSlug);
  if (!sourceTool) {
    return { nextAction: null, workflowCompletion: null, workflowMetadata: null };
  }

  const resolution = resolveWorkflowForTool(toolSlug, {
    workflowId: workflowContext?.workflowId,
    categorySlug: categorySlug || sourceTool.categorySlug,
  });

  if (resolution.status !== "resolved" || !resolution.selectedWorkflowId) {
    return { nextAction: null, workflowCompletion: null, workflowMetadata: null };
  }

  const { workflow, currentNode } = findToolNodeInWorkflow(
    resolution.selectedWorkflowId,
    toolSlug,
    workflowContext?.sourceStepId,
  );

  if (!workflow || !currentNode) {
    return { nextAction: null, workflowCompletion: null, workflowMetadata: null };
  }

  const nextNodeId = getPrimaryNextStepId(workflow, currentNode.id);
  const workflowMetadata = {
    workflowId: workflow.id,
    sourceStepId: currentNode.id,
    recommendedNextStepId: nextNodeId || undefined,
  };

  if (!nextNodeId) {
    return { nextAction: null, workflowCompletion: null, workflowMetadata };
  }

  const nextNode = getNodeById(workflow, nextNodeId);
  if (!nextNode) {
    return { nextAction: null, workflowCompletion: null, workflowMetadata };
  }

  if (nextNode.type === "completion") {
    return {
      nextAction: null,
      workflowCompletion: {
        workflowId: workflow.id,
        workflowTitle: workflow.goalTitle,
        message: "Ai finalizat acest parcurs.",
      },
      workflowMetadata: {
        ...workflowMetadata,
        recommendedNextStepId: nextNode.id,
      },
    };
  }

  if (nextNode.type !== "tool" || !nextNode.toolId || nextNode.toolId === toolSlug) {
    return { nextAction: null, workflowCompletion: null, workflowMetadata };
  }

  const nextTool = getToolConfig(nextNode.toolId);
  if (!nextTool || nextTool.categorySlug !== workflow.categorySlug) {
    return { nextAction: null, workflowCompletion: null, workflowMetadata };
  }

  const edge = getOutgoingEdges(workflow, currentNode.id).find(
    (entry) => entry.to === nextNodeId,
  );

  const nextAction = {
    workflowId: workflow.id,
    workflowTitle: workflow.goalTitle,
    workflowObjective: workflow.goalDescription,
    sourceToolSlug: toolSlug,
    sourceStepId: currentNode.id,
    toolId: nextTool.toolId,
    toolSlug: nextTool.toolId,
    toolName: nextTool.name,
    categorySlug: nextTool.categorySlug,
    title: edge?.title || nextNode.userFacingAction || nextNode.title,
    reason: edge?.reason || nextNode.reason,
    userOutcome: edge?.userOutcome || nextNode.userOutcome || nextNode.reason,
    estimatedMinutes: nextNode.estimatedMinutes,
    isOptional: true,
  };

  workflowMetadata.recommendedToolSlug = nextTool.toolId;

  return { nextAction, workflowCompletion: null, workflowMetadata };
}
