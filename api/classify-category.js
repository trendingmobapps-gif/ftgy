// Vercel Serverless Function: POST /api/classify-category
// Classifies a Romanian user request into exactly one category using OpenAI.

const CATEGORIES = [
  { label: "Business", slug: "business" },
  { label: "Studii", slug: "studii" },
  { label: "Carieră", slug: "cariera" },
  { label: "Social Media", slug: "social-media" },
  { label: "Viață Personală", slug: "viata-personala" },
  { label: "Comunicare", slug: "comunicare" },
  { label: "Finanțe", slug: "finante" },
  { label: "Fitness", slug: "fitness" },
];

// Map label -> slug for safe lookup of the model output.
const LABEL_TO_SLUG = CATEGORIES.reduce((acc, c) => {
  acc[c.label.toLowerCase()] = c.slug;
  return acc;
}, {});

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

  const query = typeof body.query === "string" ? body.query.trim() : "";

  // Validation: missing or shorter than 3 characters.
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

  const categoryList = CATEGORIES.map((c) => `- ${c.label} → ${c.slug}`).join("\n");

  const systemPrompt = `Ești un clasificator de siguranță și categorii. Analizezi cererea utilizatorului în limba română.

Mai întâi verifici siguranța. O cerere este NESIGURĂ sau INVALIDĂ dacă implică ceva ilegal, dăunător, neetic, violent, sexual, instigare la ură, fraudă, hacking, droguri, arme, înșelătorii (scams), automutilare (self-harm), SAU dacă pur și simplu nu se potrivește cu niciuna dintre categoriile permise de mai jos.

Categorii permise:
${categoryList}

Reguli de răspuns (returnează DOAR un obiect JSON valid):

1. Dacă cererea este NESIGURĂ sau nu se potrivește cu nicio categorie, returnează EXACT:
{
  "safe": false
}
Nu explica cererile nesigure. Nu sugera alternative. Nu clasifica o cerere nesigură într-o categorie normală.

2. Dacă cererea este SIGURĂ și se potrivește cu o categorie, returnează:
{
  "safe": true,
  "category": "<eticheta exactă a categoriei, ex: Carieră>",
  "categorySlug": "<slug-ul corespunzător, ex: cariera>",
  "reason": "<o propoziție scurtă în limba română care explică alegerea>"
}

Alege exact o singură categorie, cea mai potrivită. Nu inventa categorii noi.`;

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
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
    } catch (e) {
      res.status(200).json({
        success: false,
        message: `OpenAI error: invalid JSON response - ${content}`,
      });
      return;
    }

    // Resolve the slug safely based on the returned label.
    const labelKey = (parsed.category || "").toString().trim().toLowerCase();
    const resolvedSlug = LABEL_TO_SLUG[labelKey] || parsed.categorySlug;

    // Reject unsafe/invalid requests, or anything that didn't resolve to a known category.
    if (parsed.safe === false || !resolvedSlug || !LABEL_TO_SLUG[labelKey]) {
      res.status(200).json({
        success: false,
        message:
          "Nu există o categorie potrivită pentru această căutare. Te rugăm să cauți din nou.",
      });
      return;
    }

    res.status(200).json({
      success: true,
      category: parsed.category,
      categorySlug: resolvedSlug,
      reason: parsed.reason,
    });
  } catch (error) {
    res.status(200).json({
      success: false,
      message: `OpenAI error: ${error.message}`,
    });
  }
}
