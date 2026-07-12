import { PROJECT_BRAIN_LIMITS } from "./constants.js";

export function buildProjectBrainJsonSchema() {
  const stepSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      expectedOutcome: { type: "string" },
      rationale: { type: ["string", "null"] },
      priority: { type: "string", enum: ["low", "medium", "high"] },
      estimatedEffortLabel: { type: ["string", "null"] },
      recommendedToolId: { type: ["string", "null"] },
    },
    required: [
      "title",
      "description",
      "expectedOutcome",
      "rationale",
      "priority",
      "estimatedEffortLabel",
      "recommendedToolId",
    ],
  };

  const milestoneSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      steps: {
        type: "array",
        minItems: PROJECT_BRAIN_LIMITS.minStepsPerMilestone,
        maxItems: PROJECT_BRAIN_LIMITS.maxStepsPerMilestone,
        items: stepSchema,
      },
    },
    required: ["title", "description", "steps"],
  };

  return {
    name: "project_brain_workflow",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        currentStage: { type: "string" },
        complexity: { type: "string", enum: ["low", "medium", "high"] },
        estimatedDurationLabel: { type: "string" },
        milestones: {
          type: "array",
          minItems: PROJECT_BRAIN_LIMITS.minMilestones,
          maxItems: PROJECT_BRAIN_LIMITS.maxMilestones,
          items: milestoneSchema,
        },
      },
      required: ["summary", "currentStage", "complexity", "estimatedDurationLabel", "milestones"],
    },
  };
}

export function buildProjectBrainSystemPrompt({ categorySlug, toolCatalogSummary }) {
  const toolLines = toolCatalogSummary
    .map((tool) => `- ${tool.toolId} (${tool.categorySlug}): ${tool.name}`)
    .join("\n");

  return `Ești ITER AI Project Brain. Generezi un plan de proiect structurat în limba română.

Reguli obligatorii:
- 3–6 repere (milestones), fiecare cu 2–6 pași concreți.
- Total preferat: 8–24 pași.
- Pașii trebuie să fie acționabili, cu verbe clare, fără sfaturi generice goale.
- Nu copia obiectivul brut ca summary; scrie un rezumat util și distinct.
- Nu include pași ilegali, abuzivi, medicali de diagnostic sau promisiuni financiare garantate.
- Fără umplutură motivațională.
- Ordine logică; fără pași duplicați.
- currentStage = titlul primului reper.
- estimatedDurationLabel = estimare realistă (ex: "4–8 săptămâni"), fără precizie falsă.

Instrumente ITER:
- Recomandă DOAR toolId din catalogul furnizat.
- Dacă niciun instrument nu se potrivește, recommendedToolId = null.
- Poți recomanda instrumente din orice categorie dacă sunt relevante pentru pas.
- Categoria principală a proiectului: ${categorySlug}.

Catalog instrumente (toolId | categorie | nume):
${toolLines}`;
}
