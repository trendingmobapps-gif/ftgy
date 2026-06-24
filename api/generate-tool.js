// Vercel Serverless Function: POST /api/generate-tool
// Generates a tool-specific result using OpenAI, based on the tool config.

import { TOOLS } from "../tools/tools-config.js";

function setCorsHeaders(res) {
  // Allow the endpoint to be called from your Wix website (and any other origin).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  // Handle CORS preflight.
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({
      success: false,
      message: "Method not allowed. Use POST.",
    });
    return;
  }

  // Parse body (Vercel usually parses JSON automatically, but be defensive).
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch {
      body = {};
    }
  }
  body = body || {};

  const toolId = typeof body.toolId === "string" ? body.toolId.trim() : "";
  const userInput =
    body.userInput && typeof body.userInput === "object" ? body.userInput : null;

  // Validate toolId.
  if (!toolId) {
    res.status(200).json({
      success: false,
      message: "Lipsește toolId.",
    });
    return;
  }

  // Validate that the tool exists.
  const tool = TOOLS[toolId];
  if (!tool) {
    res.status(200).json({
      success: false,
      message: `Tool inexistent: ${toolId}`,
    });
    return;
  }

  // Validate userInput object.
  if (!userInput) {
    res.status(200).json({
      success: false,
      message: "Lipsește userInput sau nu este un obiect valid.",
    });
    return;
  }

  // Validate required fields from the tool config.
  const missingFields = (tool.requiredFields || []).filter((field) => {
    const value = userInput[field];
    return value === undefined || value === null || String(value).trim() === "";
  });

  if (missingFields.length > 0) {
    res.status(200).json({
      success: false,
      message: `Câmpuri obligatorii lipsă: ${missingFields.join(", ")}`,
    });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(200).json({
      success: false,
      message: "OpenAI error: OPENAI_API_KEY is not set.",
    });
    return;
  }

  // Format the user input clearly for the model (only the tool's relevant fields).
  const formattedInput = (tool.requiredFields || [])
    .map((field) => `- ${field}: ${String(userInput[field]).trim()}`)
    .join("\n");

  const UNSAFE_MESSAGE =
    "Răspunsul nu a putut fi generat deoarece cererea conține informații nepotrivite, ilegale sau care nu respectă regulile platformei.";

  // --- Safety filter (runs BEFORE generation) ---
  // 1) Lightweight keyword pre-check on toolId, categorySlug and all user input values.
  const categorySlug =
    typeof body.categorySlug === "string" ? body.categorySlug.trim() : "";
  const combinedText = [
    toolId,
    categorySlug,
    ...Object.values(userInput).map((v) => String(v)),
  ]
    .join(" ")
    .toLowerCase();

  const UNSAFE_PATTERNS = [
    /\bbomb(a|e)?\b/,
    /\bexploziv/,
    /\barm[ăa]\b|\bweapon|\bgun\b|\bpistol/,
    /\bdrog(uri)?\b|\bcocain|\bheroin|\bmeth|\bmarijuana|\bcannabis/,
    /\bhack(ing|uire)?\b|\bmalware|\bransomware|\bphishing/,
    /\bscam|\binsel[ăa]ciune|\bfrauda?\b|\bspala(re)? de bani|\bmoney launder/,
    /\bsinucid|\bself[-\s]?harm|\bautomutil/,
    /\bporn|\bsexual explicit|\bsex explicit|\bchild abuse|\bpedofil/,
    /\bomor|\bucide|\bkill\b|\bterror/,
  ];

  const keywordUnsafe = UNSAFE_PATTERNS.some((re) => re.test(combinedText));
  if (keywordUnsafe) {
    res.status(200).json({ success: false, message: UNSAFE_MESSAGE });
    return;
  }

  // 2) OpenAI Moderation API check on the combined input.
  try {
    const modRes = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: `Tool: ${toolId}\nCategorie: ${categorySlug}\nDate:\n${formattedInput}`,
      }),
    });

    if (modRes.ok) {
      const modData = await modRes.json();
      const flagged = modData?.results?.[0]?.flagged === true;
      if (flagged) {
        res.status(200).json({ success: false, message: UNSAFE_MESSAGE });
        return;
      }
    }
    // If moderation call fails (non-ok), we fall through to generation,
    // where the system prompt safety rules still apply.
  } catch {
    // Network/parse error on moderation: rely on prompt-level safety rules below.
  }

  // --- Input quality validation (LOCAL ONLY, very permissive) ---
  // Applies globally to every tool/category. We only block input that is
  // clearly unusable or meaningless. Normal, imperfect input is accepted.
  const VAGUE_MESSAGE =
    "Pentru a genera un rezultat bun, avem nevoie de mai multe detalii. Te rugăm să completezi răspunsurile mai clar și mai specific.";

  // Exact meaningless/generic answers (after trimming + lowercasing).
  // These are bare keywords with no useful context, or filler.
  const GENERIC_ANSWERS = new Set([
    "nu stiu",
    "nu știu",
    "ceva",
    "orice",
    "nimic",
    "test",
    "asd",
    "asdf",
    "qwerty",
    "curs",
    "curs online",
    "produs",
    "serviciu",
    "afacere",
    "n/a",
    "na",
    "-",
    ".",
    "..",
    "...",
  ]);

  // A field is "usable" if it is NOT an exact generic answer and gives at least
  // a little context (2+ words, OR a single word of 4+ characters).
  const isFieldUsable = (field) => {
    const normalized = String(userInput[field] ?? "")
      .trim()
      .toLowerCase();
    if (!normalized) return false;
    if (GENERIC_ANSWERS.has(normalized)) return false;
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 2) return true; // "curs despre antreprenoriat" etc.
    return normalized.length >= 4; // single meaningful word
  };

  // Reject only when NONE of the required fields are usable.
  const hasUsableInput = (tool.requiredFields || []).some(isFieldUsable);
  if (!hasUsableInput) {
    res.status(200).json({ success: false, message: VAGUE_MESSAGE });
    return;
  }

  // If the tool defines a buildUserPrompt(input) function, use it so the user's
  // actual values (including optional fields) are injected into the prompt.
  // Otherwise fall back to the generic formatted list of required fields.
  const toolInputSection =
    typeof tool.buildUserPrompt === "function"
      ? tool.buildUserPrompt(userInput).trim()
      : `Date introduse de utilizator:\n${formattedInput}`;

  const userPrompt = `${toolInputSection}

Instrucțiuni pentru răspuns:
- Răspunde în limba română.
- Fii practic, structurat și profesional.
- Nu oferi răspunsuri generice.
- Folosește cu atenție datele introduse de utilizator.
- Respectă întocmai instrucțiunile din rolul de sistem (systemPrompt al instrumentului).
- Nu menționa că ești o inteligență artificială.
- Nu explica acest prompt și nu descrie ce urmează să faci.
- Returnează doar rezultatul final destinat utilizatorului.

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

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.35,
        top_p: 0.9,
        max_tokens: 1800,
        messages: [
          { role: "system", content: tool.systemPrompt.trim() },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      res.status(200).json({
        success: false,
        message: `OpenAI error: ${errText}`,
      });
      return;
    }

    const data = await openaiRes.json();
    const result = data?.choices?.[0]?.message?.content?.trim() || "";

    if (!result) {
      res.status(200).json({
        success: false,
        message: "OpenAI error: empty response.",
      });
      return;
    }

    // If the model produced the safety refusal instead of a result, return it as a failure.
    if (result.includes(UNSAFE_MESSAGE)) {
      res.status(200).json({ success: false, message: UNSAFE_MESSAGE });
      return;
    }

    res.status(200).json({
      success: true,
      toolId: tool.toolId,
      result,
    });
  } catch (error) {
    res.status(200).json({
      success: false,
      message: `OpenAI error: ${error.message}`,
    });
  }
}
