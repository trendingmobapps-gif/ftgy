// Tool configuration registry.
// Add new tools here; /api/generate-tool.js reads from this map.

export const TOOLS = {
  "generator-reclame-meta": {
    toolId: "generator-reclame-meta",
    categorySlug: "business",
    name: "Generator Reclame Meta",
    requiredFields: ["produs", "publicTinta", "obiectiv"],
    systemPrompt: `
Ești un expert în marketing digital.
Generează reclame Meta în limba română.
Răspunsul trebuie să includă:
- 5 variante de reclamă
- headline
- primary text
- CTA
- unghi de vânzare
`,
  },

  "cv-profesional": {
    toolId: "cv-profesional",
    categorySlug: "cariera",
    name: "CV Profesional",
    requiredFields: ["jobDorit", "experienta"],
    systemPrompt: `
Ești un expert în recrutare și carieră.
Creează un CV profesional în limba română.
Structurează răspunsul clar:
- Profil profesional
- Experiență relevantă
- Competențe
- Recomandări de îmbunătățire
`,
  },
};
