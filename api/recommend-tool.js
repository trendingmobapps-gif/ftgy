// Vercel Serverless Function: POST /api/recommend-tool
// Recommends exactly ONE AI tool from the platform for a Romanian user request.
// This endpoint does NOT generate the final tool result; it only recommends the
// best matching tool so the Wix Dashboard can redirect to /instrument/{slugInstrument}.

import { TOOLS } from "../tools/tools-config.js";

function setCorsHeaders(res) {
  // Allow the endpoint to be called from your Wix dashboard (and any other origin).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// Build a compact list of tools for the model. tools-config.js has no
// `description` or `slugInstrument` fields, so we fall back to toolId for the
// slug and omit the description when it is not available.
function buildToolList() {
  return Object.values(TOOLS).map((tool) => {
    const slugInstrument = tool.slugInstrument || tool.toolId;
    return {
      toolId: tool.toolId,
      name: tool.name,
      categorySlug: tool.categorySlug,
      description: tool.description || "",
      slugInstrument,
    };
  });
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

  const query = typeof body.query === "string" ? body.query.trim() : "";

  // Validation: missing or shorter than 3 characters. Do NOT call OpenAI.
  if (!query || query.length < 3) {
    res.status(200).json({
      success: false,
      message: "Te rugăm să scrii ce ai nevoie.",
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

  const tools = buildToolList();
  const toolListText = tools
    .map((t) => {
      const desc = t.description ? ` — ${t.description}` : "";
      return `- toolId: ${t.toolId} | nume: ${t.name} | categorie: ${t.categorySlug}${desc}`;
    })
    .join("\n");

  const systemPrompt = `Ești un sistem de recomandare premium care alege EXACT UN SINGUR instrument AI dintr-o platformă, pe baza cererii utilizatorului scrisă în limba română.

Mai întâi verifici siguranța. O cerere este NESIGURĂ dacă implică ceva ilegal, dăunător, vulgar, sexual explicit, instigare la ură, violență, fraudă, hacking, arme, droguri, automutilare (self-harm) sau conținut care nu este potrivit pentru întreaga familie.

Lista de instrumente disponibile (folosește DOAR aceste toolId-uri, nu inventa altele):
${toolListText}

Reguli de răspuns (returnează DOAR un obiect JSON valid, fără text suplimentar):

1. Dacă cererea este NESIGURĂ, returnează EXACT:
{ "status": "unsafe" }

2. Dacă cererea este sigură DAR niciun instrument din listă nu se potrivește, returnează EXACT:
{ "status": "none" }

3. Dacă cererea este sigură și există un instrument potrivit, alege EXACT UNUL singur, cel mai potrivit, și returnează:
{
  "status": "ok",
  "toolId": "<toolId exact din listă>",
  "reason": "<o propoziție scurtă în limba română care explică de ce este cel mai potrivit instrument>"
}

Alege un singur instrument. toolId trebuie să fie identic cu unul din listă.`;

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query },
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
    const content = data?.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      res.status(200).json({
        success: false,
        message: `OpenAI error: invalid JSON response - ${content}`,
      });
      return;
    }

    // Unsafe / non-family-friendly requests.
    if (parsed.status === "unsafe") {
      res.status(200).json({
        success: false,
        message:
          "Nu există un instrument potrivit pentru această căutare. Te rugăm să cauți din nou.",
      });
      return;
    }

    // Resolve the chosen tool from our own config (never trust the model blindly).
    const chosen = parsed.status === "ok" ? TOOLS[parsed.toolId] : null;

    // No relevant tool, or the model returned an unknown toolId.
    if (!chosen) {
      res.status(200).json({
        success: false,
        message: "Nu am găsit un instrument potrivit. Te rugăm să cauți din nou.",
      });
      return;
    }

    res.status(200).json({
      success: true,
      toolId: chosen.toolId,
      toolName: chosen.name,
      categorySlug: chosen.categorySlug,
      slugInstrument: chosen.slugInstrument || chosen.toolId,
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : `Acest instrument este cel mai potrivit pentru cererea ta.`,
    });
  } catch (error) {
    res.status(200).json({
      success: false,
      message: `OpenAI error: ${error.message}`,
    });
  }
}
