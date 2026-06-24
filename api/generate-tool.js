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

  // --- Input quality validation (runs BEFORE generation) ---
  // Goal: don't generate a weak result from vague/generic/incomplete input.
  const VAGUE_MESSAGE =
    "Pentru a genera un rezultat bun, avem nevoie de mai multe detalii. Te rugăm să completezi răspunsurile mai clar și mai specific.";

  // 1) Lightweight local pre-check for EXTREMELY vague / unusable answers only.
  // Single bare keywords with no extra context, or meaningless filler.
  const GENERIC_ANSWERS = new Set([
    "curs",
    "produs",
    "serviciu",
    "afacere",
    "ceva",
    "orice",
    "nu stiu",
    "nu știu",
    "nimic",
    "test",
    "asd",
    "asdf",
    "qwerty",
    "n/a",
    "na",
    "-",
    ".",
    "..",
    "...",
  ]);

  // Only reject if EVERY required field is essentially unusable.
  // This avoids blocking inputs that give at least basic context in one field.
  const allFieldsVague = (tool.requiredFields || []).every((field) => {
    const raw = String(userInput[field] ?? "").trim();
    const normalized = raw.toLowerCase();
    if (GENERIC_ANSWERS.has(normalized)) return true;
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    // Truly unusable: a single short word with no surrounding context.
    if (wordCount <= 1 && normalized.length < 4) return true;
    return false;
  });

  if (allFieldsVague) {
    res.status(200).json({ success: false, message: VAGUE_MESSAGE });
    return;
  }

  // 2) Lightweight OpenAI validation call that returns ONLY JSON.
  /*
  try {
    const valRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Ești un validator de calitate a datelor introduse de utilizator pentru un instrument numit "${tool.toolId}".
            Rolul instrumentului: ${tool.systemPrompt.trim()}

            Sarcina ta: decide dacă datele introduse sunt suficient de clare, specifice și complete pentru a genera un rezultat profesional cu acest instrument.

            Consideră datele INVALIDE dacă sunt: prea vagi, prea scurte, generice, ambigue, incomplete, răspunsuri dintr-un singur cuvânt pentru câmpuri care necesită context, sau dacă nu explică efectiv ce este produsul/serviciul/contextul.
            Consideră datele VALIDE dacă oferă suficient context pentru un rezultat de calitate. Nu respinge datele bune.

            Returnează DOAR un obiect JSON valid în acest format exact:
            { "isValid": true sau false, "reason": "motiv scurt în limba română" }`,
          },
          {
            role: "user",
            content: `Categorie: ${categorySlug}\nDate introduse:\n${formattedInput}`,
          },
        ],
      }),
    });

    if (valRes.ok) {
      const valData = await valRes.json();
      const valContent = valData?.choices?.[0]?.message?.content?.trim() || "";
      try {
        const parsed = JSON.parse(valContent);
        if (parsed && parsed.isValid === false) {
          res.status(200).json({ success: false, message: VAGUE_MESSAGE });
          return;
        }
      } catch {
        // If validation output isn't parseable, fall through to generation.
      }
    }
    // If the validation call fails (non-ok), fall through to generation.
  } catch {
    // Network error during validation: don't block good inputs, continue.
  }
    */

  const userPrompt = `Date introduse de utilizator:
${formattedInput}

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
      toolId: tool.toolId,m
      result,
    });
  } catch (error) {
    res.status(200).json({
      success: false,
      message: `OpenAI error: ${error.message}`,
    });
  }
}
