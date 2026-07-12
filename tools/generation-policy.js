// Central generation policy for ITER AI tool generation.
// Used by /api/generate-tool.js — authoritative for web (Wix) and mobile.

/** @typedef {'concise' | 'default' | 'detailed'} ResponseProfile */
/** @typedef {'fast' | 'balanced' | 'complex'} ModelProfile */

export const TOOL_GENERATION_POLICY = {
  concise: {
    targetSeconds: 6,
    maxOutputTokens: 400,
    temperature: 0.3,
    modelProfile: "fast",
    wordTarget: "150–300",
  },
  default: {
    targetSeconds: 8,
    maxOutputTokens: 700,
    temperature: 0.4,
    modelProfile: "balanced",
    wordTarget: "300–600",
  },
  detailed: {
    targetSeconds: 10,
    maxOutputTokens: 1000,
    temperature: 0.4,
    modelProfile: "complex",
    wordTarget: "600–1000",
  },
};

// Model order per profile. Fallback only on model-unavailability errors.
export const MODEL_PROFILES = {
  fast: ["gpt-4.1-mini", "gpt-4.1"],
  balanced: ["gpt-4.1", "gpt-4.1-mini"],
  complex: ["gpt-4.1", "gpt-5.1", "gpt-4.1-mini"],
};

const CONCISE_TOOL_PATTERNS = [
  /^generator-(cta|hook|titlu|subiect|hashtag|emoji)/,
  /-cta$/,
  /-hook/,
  /-titlu/,
  /-subiect-/,
  /raspuns-rapid/,
  /generator-reply/,
  /calculator-/,
  /generator-idei-scurte/,
];

const DETAILED_TOOL_PATTERNS = [
  /^plan-de-afaceri$/,
  /^strategie-marketing$/,
  /^plan-slabire$/,
  /^plan-lansare/,
  /^plan-fitness/,
  /^plan-nutritie/,
  /^plan-concediu/,
  /^structura-legala/,
  /^plan-cercetare/,
  /^plan-afaceri/,
  /^strategie-continut/,
  /^plan-marketing/,
  /^plan-dezvoltare/,
];

const DETAILED_KEYWORDS = [
  "plan complet",
  "strategie completă",
  "strategie completa",
  "business plan",
  "plan de afaceri",
  "plan de marketing",
  "plan de slabire",
  "plan de slăbire",
];

/**
 * Heuristic response profile when a tool has no explicit `responseProfile`.
 * @param {string} toolId
 * @param {{ systemPrompt?: string, responseProfile?: ResponseProfile }} tool
 * @returns {ResponseProfile}
 */
export function inferResponseProfile(toolId, tool = {}) {
  if (
    tool.responseProfile === "concise" ||
    tool.responseProfile === "default" ||
    tool.responseProfile === "detailed"
  ) {
    return tool.responseProfile;
  }

  const id = String(toolId || "").toLowerCase();
  const prompt = String(tool.systemPrompt || "").toLowerCase();

  if (DETAILED_TOOL_PATTERNS.some((pattern) => pattern.test(id))) {
    return "detailed";
  }

  if (DETAILED_KEYWORDS.some((keyword) => prompt.includes(keyword))) {
    return "detailed";
  }

  if (CONCISE_TOOL_PATTERNS.some((pattern) => pattern.test(id))) {
    return "concise";
  }

  if (
    id.includes("hook") ||
    id.includes("cta") ||
    id.includes("titlu") ||
    id.includes("subiect") ||
    id.includes("hashtag") ||
    id.includes("emoji") ||
    id.includes("calculator")
  ) {
    return "concise";
  }

  const numberedSections = (prompt.match(/^\d+\./gm) || []).length;
  if (numberedSections <= 2 && prompt.includes("scurt")) {
    return "concise";
  }

  return "default";
}

/**
 * @param {string} toolId
 * @param {{ systemPrompt?: string, responseProfile?: ResponseProfile, modelProfile?: ModelProfile, maxOutputTokens?: number, temperature?: number }} tool
 */
export function resolveGenerationConfig(toolId, tool = {}) {
  const responseProfile = inferResponseProfile(toolId, tool);
  const policy = TOOL_GENERATION_POLICY[responseProfile];
  const modelProfile =
    tool.modelProfile && MODEL_PROFILES[tool.modelProfile]
      ? tool.modelProfile
      : policy.modelProfile;

  return {
    responseProfile,
    modelProfile,
    models: MODEL_PROFILES[modelProfile],
    maxOutputTokens:
      typeof tool.maxOutputTokens === "number" && tool.maxOutputTokens > 0
        ? Math.min(tool.maxOutputTokens, policy.maxOutputTokens)
        : policy.maxOutputTokens,
    temperature:
      typeof tool.temperature === "number"
        ? tool.temperature
        : policy.temperature,
    targetSeconds: policy.targetSeconds,
    wordTarget: policy.wordTarget,
  };
}

export function supportsCustomSampling(model) {
  return String(model || "").startsWith("gpt-4");
}

export function buildConciseGenerationInstructions(responseProfile) {
  const policy = TOOL_GENERATION_POLICY[responseProfile] || TOOL_GENERATION_POLICY.default;

  const profileLimit = `Profil de răspuns: ${responseProfile}.
Țintește aproximativ ${policy.wordTarget} cuvinte, dacă formatul cerut nu impune mai puțin.
Nu depăși lungimea necesară pentru a rezolva complet sarcina.`;

  return `Reguli de concizie (obligatorii):
- Returnează un rezultat concis, practic și imediat utilizabil.
- Nu repeta inputul utilizatorului.
- Nu adăuga introduceri lungi.
- Nu adăuga concluzii generice.
- Nu supra-explica.
- Folosește secțiuni scurte și bullet points doar când sunt utile.
- Prioritizează conținutul acționabil în locul teoriei.
- Respectă structura cerută de instrument.
- Păstrează răspunsul cât mai scurt posibil, fără a compromite utilitatea.

${profileLimit}`;
}

export function buildSharedUserPromptSuffix({
  responseProfile = "default",
  improvementSection = "",
}) {
  const conciseBlock = buildConciseGenerationInstructions(responseProfile);

  return `${improvementSection}

Instrucțiuni pentru răspuns:
- Răspunde în limba română.
- Fii practic, structurat și profesional.
- Nu oferi răspunsuri generice.
- Folosește cu atenție datele introduse de utilizator.
- Respectă întocmai instrucțiunile din rolul de sistem (systemPrompt al instrumentului).
- Nu menționa că ești o inteligență artificială.
- Nu explica acest prompt și nu descrie ce urmează să faci.
- Returnează doar rezultatul final destinat utilizatorului.

${conciseBlock}

Reguli de siguranță (obligatorii):
- Nu genera conținut ilegal, dăunător, vulgar, sexual explicit, instigare la ură, violent, fraudulos, legat de înșelătorii (scams), hacking, arme, droguri sau automutilare (self-harm).
- Nu explica niciodată cum se efectuează acțiuni ilegale sau dăunătoare.
- Păstrează conținutul potrivit pentru întreaga familie (family-friendly) și profesional.
- Dacă datele introduse de utilizator sunt nepotrivite sau încalcă aceste reguli, NU genera rezultatul. Returnează exact textul: "Răspunsul nu a putut fi generat deoarece cererea conține informații nepotrivite, ilegale sau care nu respectă regulile platformei."

Instrucțiuni de formatare:
- Returnează răspunsul final în Markdown curat.
- Folosește **bold** pentru etichete importante, titluri de secțiuni, recomandări cheie și expresii importante.
- Folosește titluri cu ## și ### acolo unde este util.
- Folosește liste cu puncte (bullet points) și liste numerotate acolo unde este util.
- Păstrează formatarea curată și ușor de citit pe mobil.
- Nu încadra întregul răspuns într-un bloc de cod.
- Nu returna HTML.
- Nu menționa Markdown.`;
}

export function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
