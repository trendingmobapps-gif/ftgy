import { PROJECT_CATEGORY_SLUGS } from "./constants.js";

export const PROJECT_INTENT_ERROR_CODES = {
  INVALID_INPUT: "PROJECT_INTENT_INVALID_INPUT",
  UNAUTHENTICATED: "PROJECT_UNAUTHENTICATED",
  RATE_LIMITED: "PROJECT_INTENT_RATE_LIMITED",
  UPSTREAM_ERROR: "PROJECT_INTENT_UPSTREAM_ERROR",
  UNAVAILABLE: "PROJECT_INTENT_UNAVAILABLE",
  INVALID_RESPONSE: "PROJECT_INTENT_INVALID_RESPONSE",
};

export const PROJECT_INTENT_MODEL = "gpt-4.1-mini";
export const PROJECT_INTENT_TEMPERATURE = 0.1;
export const PROJECT_INTENT_TIMEOUT_MS = 25_000;

export const PROJECT_CATEGORY_GUIDANCE = [
  { slug: "business", label: "Business", hint: "afaceri, antreprenoriat, marketing, vânzări, produse, servicii" },
  { slug: "studii", label: "Studii", hint: "învățare, examene, materii, teme, licență, admitere" },
  { slug: "cariera", label: "Carieră", hint: "job, CV, interviu, promovare, schimbare de carieră" },
  { slug: "fitness", label: "Fitness", hint: "slăbit, masă musculară, antrenament, nutriție, sănătate fizică" },
  { slug: "finante", label: "Finanțe", hint: "buget, economii, datorii, investiții, venituri" },
  { slug: "comunicare", label: "Comunicare", hint: "mesaje, prezentări, negociere, relații profesionale" },
  { slug: "socialMedia", label: "Social Media", hint: "TikTok, Instagram, conținut, creștere cont, postări" },
  { slug: "viataPersonala", label: "Viață Personală", hint: "obiceiuri, organizare personală, obiective de viață, echilibru" },
];

export function buildIntentAnalysisJsonSchema() {
  return {
    name: "project_intent_analysis",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          enum: ["ready", "needs_clarification", "unsupported"],
        },
        categorySlug: {
          anyOf: [
            { type: "string", enum: [...PROJECT_CATEGORY_SLUGS] },
            { type: "null" },
          ],
        },
        confidence: { type: "number" },
        suggestedName: { type: ["string", "null"] },
        normalizedGoal: { type: ["string", "null"] },
        shortSummary: { type: ["string", "null"] },
        detectedIntent: { type: ["string", "null"] },
        firstStepTitle: { type: ["string", "null"] },
        firstStepDescription: { type: ["string", "null"] },
        suggestedToolId: { type: ["string", "null"] },
        recommendationReason: { type: ["string", "null"] },
        message: { type: ["string", "null"] },
        questions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              question: { type: "string" },
              type: { type: "string", enum: ["text", "single_choice"] },
              options: {
                anyOf: [
                  {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        id: { type: "string" },
                        label: { type: "string" },
                        value: { type: "string" },
                      },
                      required: ["id", "label", "value"],
                    },
                  },
                  { type: "null" },
                ],
              },
            },
            required: ["id", "question", "type", "options"],
          },
        },
      },
      required: [
        "status",
        "categorySlug",
        "confidence",
        "suggestedName",
        "normalizedGoal",
        "shortSummary",
        "detectedIntent",
        "firstStepTitle",
        "firstStepDescription",
        "suggestedToolId",
        "recommendationReason",
        "message",
        "questions",
      ],
    },
  };
}

export function buildIntentSystemPrompt({ categoryTools }) {
  const categories = PROJECT_CATEGORY_GUIDANCE.map(
    (item) => `- ${item.label} → ${item.slug} (${item.hint})`,
  ).join("\n");

  const toolLines = Object.entries(categoryTools || {})
    .map(([categorySlug, tools]) => {
      const names = (tools || [])
        .map((tool) => `${tool.toolId}: ${tool.name}`)
        .join("; ");
      return `${categorySlug}: ${names || "(fără instrumente listate)"}`;
    })
    .join("\n");

  return `Ești analistul de intenție pentru proiectele ITER AI.

Analizezi obiectivul utilizatorului în limba română și pregătești date sigure pentru crearea unui proiect.
NU creezi proiectul. NU inventezi categorii sau instrumente în afara listelor permise.

Responsabilități separate (foarte important):
A) Alegerea sigură a UNEI categorii ITER — singura responsabilitate care poate bloca crearea proiectului.
B) Detalii opționale pentru personalizarea viitorului plan — NU blochează crearea proiectului.

Categorii permise (folosește EXACT slug-ul):
${categories}

Reguli de decizie:
1. status=ready când poți alege în siguranță o categorie ȘI există un obiectiv concret.
   Exemple care trebuie să fie ready:
   - "Vreau să lansez propria mea platformă AI pentru piața din România" → business
   - "Vreau să slăbesc 7 kg" → fitness (lipsa termenului sau locației de antrenament NU blochează)
   - "Vreau să deschid o cafenea în Timișoara" → business
2. status=needs_clarification DOAR dacă:
   - obiectivul este prea vag pentru a identifica categoria (ex: "Vreau să mă dezvolt", "Ajută-mă");
   - obiectivul se potrivește clar la două+ categorii și alegerea greșită ar schimba material proiectul;
   - lipsește obiectul de bază al acțiunii (ex: "Vreau să lansez ceva", "Vreau să învăț").
   NU folosi needs_clarification doar pentru: public țintă nespecificat, termen nespecificat, detalii de implementare, nișă de business nespecificată când categoria business este deja clară.
3. status=unsupported când cererea este nesigură, imposibil de clasificat sau în afara categoriilor suportate.
4. Dacă utilizatorul a furnizat deja clarificationAnswers, returnează DOAR ready sau unsupported — niciodată needs_clarification.
5. Maximum 2 întrebări de clarificare, scurte, în română, o idee per întrebare; preferă single_choice când e util.
6. Nu pune exemple lungi în titlul întrebării. Nu repeta informații deja în obiectiv.
7. Nu expune confidence utilizatorului; folosește-l doar intern.
8. suggestedName: 2-6 cuvinte, natural în română, fără "ITER AI".
9. firstStepTitle = PAS DE PROIECT (acțiune), nu numele unui instrument.
10. suggestedToolId = DOAR toolId din lista de mai jos sau null.

Instrumente permise pe categorie:
${toolLines}

Răspunde strict conform schemei JSON cerute.`;
}
