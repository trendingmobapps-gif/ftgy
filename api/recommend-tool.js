// Vercel Serverless Function: POST /api/recommend-tool
// Recommends 1-3 AI tools for a Romanian user request: a single best tool for
// specific requests, or 2-3 relevant tools for broad/general requests.
//
// The list of available tools is sent IN THE REQUEST BODY by the Wix Dashboard
// (body.tools). This endpoint does NOT import tools-config.js and contains NO
// hardcoded tools, so it works with any number of tools (160, 500, 1000+)
// without requiring changes in Vercel whenever the Wix CMS is updated.

// Single message returned for any unsafe / non-family-friendly search, whether
// it is caught by the local blocklist, the OpenAI moderation API, or the model.
const UNSAFE_SEARCH_MESSAGE =
  "Nu există un instrument potrivit pentru această căutare. Te rugăm să cauți din nou.";

// Message returned when the request is safe but no suitable tool was found.
const NO_MATCH_MESSAGE =
  "Nu am găsit un instrument potrivit. Te rugăm să cauți din nou.";

// Local blocklist of clearly unsafe terms (Romanian + English): vulgar language,
// insults, sexual/explicit content, hate speech, violence, self-harm, illegal
// activity, fraud, hacking, drugs, weapons, terrorism. This is a fast first pass
// that runs BEFORE any OpenAI call so flagged queries never reach the API.
const BLOCKLIST = [
  // Romanian profanity / insults
  "pula", "pizda", "muie", "muist", "futu", "fut ", "fute", "futut", "fute-",
  "cacat", "căcat", "rahat", "dracu", "dracului", "bou", "boule", "prost",
  "proasta", "proastă", "idiot", "idioata", "cretin", "tampit", "tâmpit",
  "curva", "curvă", "curve", "tarfa", "târfă", "pizda", "sugi", "sug pula",
  "bag pula", "bagpula", "labar", "laba", "coaie", "cur ", "fraier",
  // English profanity / insults
  "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick", "pussy",
  "whore", "slut", "motherfucker", "retard", "faggot", "nigger", "nigga",
  // Sexual / explicit
  "porn", "porno", "pornografie", "sex explicit", "xxx", "nud", "nuduri",
  "masturb", "blowjob", "anal sex", "incest", "pedofil", "pedophile",
  "child porn", "minori sex",
  // Hate speech / violence / threats
  "te omor", "sa te omor", "să te omor", "omor pe", "te bat", "te injunghii",
  "kill you", "i will kill", "school shooting", "genocid", "exterminare",
  // Self-harm
  "sinucid", "sa ma sinucid", "să mă sinucid", "ma sinucid", "mă sinucid",
  "vreau sa mor", "vreau să mor", "tai venele", "îmi tai venele",
  "suicide", "kill myself", "self harm", "self-harm",
  // Illegal / fraud / hacking / drugs / weapons / terrorism
  "cum sa fur", "cum să fur", "spalare de bani", "spălare de bani",
  "card clonat", "clonare card", "frauda card", "fraudă card", "phishing",
  "cum sparg", "cum să sparg", "sparg parola", "hack ", "hacking", "ddos",
  "ransomware", "malware keylogger", "cumpar droguri", "cumpăr droguri",
  "vand droguri", "vând droguri", "cocaina", "cocaină", "heroina", "heroină",
  "metamfetamina", "cum fac o bomba", "cum să fac o bombă", "fac o bomba",
  "build a bomb", "make a bomb", "arma de foc ilegal", "atac terorist",
  "terrorist attack", "isis",
];

// Returns true when the query contains an obviously unsafe term.
function isBlockedQuery(query) {
  const normalized = query.toLowerCase();
  return BLOCKLIST.some((term) => normalized.includes(term));
}

function setCorsHeaders(res) {
  // Allow the endpoint to be called from your Wix dashboard (and any other origin).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// Normalizes a single tool object received from Wix into a consistent shape.
// Accepts both `toolName` and `name` for the tool's display name, and falls
// back to `toolId` for the slug when `slugInstrument` is missing.
function normalizeTool(tool) {
  if (!tool || typeof tool !== "object") return null;

  const toolId = typeof tool.toolId === "string" ? tool.toolId.trim() : "";
  if (!toolId) return null;

  const toolName =
    (typeof tool.toolName === "string" && tool.toolName.trim()) ||
    (typeof tool.name === "string" && tool.name.trim()) ||
    toolId;

  const categorySlug =
    typeof tool.categorySlug === "string" ? tool.categorySlug.trim() : "";

  const slugInstrument =
    (typeof tool.slugInstrument === "string" && tool.slugInstrument.trim()) ||
    toolId;

  const description =
    typeof tool.description === "string" ? tool.description.trim() : "";

  // Benefits may arrive as an array or as a single string.
  let benefits = [];
  if (Array.isArray(tool.benefits)) {
    benefits = tool.benefits
      .map((b) => (typeof b === "string" ? b.trim() : ""))
      .filter(Boolean);
  } else if (typeof tool.benefits === "string" && tool.benefits.trim()) {
    benefits = [tool.benefits.trim()];
  }

  return { toolId, toolName, categorySlug, slugInstrument, description, benefits };
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

  // Validation: query must exist (and be at least 3 chars). Do NOT call OpenAI.
  if (!query || query.length < 3) {
    res.status(200).json({
      success: false,
      message: "Te rugăm să scrii ce ai nevoie.",
    });
    return;
  }

  // Validation: tools must be a non-empty array sent from Wix.
  if (!Array.isArray(body.tools) || body.tools.length === 0) {
    res.status(200).json({
      success: false,
      message: "Lista de instrumente lipsește. Trimite body.tools din Wix.",
    });
    return;
  }

  // Normalize and keep only valid tools (those with a toolId).
  const tools = body.tools.map(normalizeTool).filter(Boolean);
  if (tools.length === 0) {
    res.status(200).json({
      success: false,
      message: "Lista de instrumente lipsește. Trimite body.tools din Wix.",
    });
    return;
  }

  // Index tools by toolId so we can resolve the model's choice from the
  // request data only (never trust the model to invent a tool).
  const toolsById = new Map(tools.map((t) => [t.toolId, t]));

  // Safety pass 1: local blocklist. If flagged, do NOT call OpenAI at all.
  if (isBlockedQuery(query)) {
    res.status(200).json({
      success: false,
      message: UNSAFE_SEARCH_MESSAGE,
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

  // Build the tool list text for the model entirely from the received tools.
  const toolListText = tools
    .map((t) => {
      const desc = t.description ? ` | descriere: ${t.description}` : "";
      const benefits =
        t.benefits.length > 0 ? ` | beneficii: ${t.benefits.join("; ")}` : "";
      return `- toolId: ${t.toolId} | nume: ${t.toolName} | categorie: ${t.categorySlug}${desc}${benefits}`;
    })
    .join("\n");

  const systemPrompt = `Ești un sistem de recomandare premium care alege instrumentul/instrumentele AI cele mai potrivite dintr-o platformă, pe baza cererii utilizatorului scrisă în limba română.

Mai întâi verifici siguranța. O cerere este NESIGURĂ dacă implică ceva ilegal, dăunător, vulgar, obscen, sexual explicit, instigare la ură, violență, fraudă, scam, hacking, arme, droguri, automutilare (self-harm) sau conținut care nu este potrivit pentru întreaga familie.

Lista de instrumente disponibile (folosește DOAR aceste toolId-uri, nu inventa altele):
${toolListText}

Reguli de alegere:
- Analizează cererea și decide dacă este SPECIFICĂ sau GENERALĂ/AMPLĂ.
- Dacă cererea este SPECIFICĂ (vizează clar un singur obiectiv), recomandă EXACT 1 instrument.
- Dacă cererea este GENERALĂ, amplă sau s-ar potrivi cu mai multe instrumente utile, recomandă 2-3 instrumente relevante.
- Recomandă minim 1 și maxim 3 instrumente.
- Nu recomanda instrumente duplicate (fiecare toolId apare o singură dată).
- Fiecare instrument recomandat trebuie să fie relevant pentru cerere.
- Preferă instrumentele care ajută direct utilizatorul să își atingă obiectivul.
- Folosește descrierea și beneficiile pentru a decide.
- Ordonează recomandările de la cea mai potrivită la cea mai puțin potrivită.

Exemplu de cerere amplă: „Vreau să fac bani” se poate potrivi cu instrumente precum Plan de Afaceri, Strategie Marketing, Generator Reclame Meta.

Reguli de răspuns (returnează DOAR un obiect JSON valid, fără text suplimentar):

1. Dacă cererea este NESIGURĂ, returnează EXACT:
{ "status": "unsafe" }

2. Dacă cererea este sigură DAR niciun instrument din listă nu se potrivește, returnează EXACT:
{ "status": "none" }

3. Dacă cererea este sigură și există unul sau mai multe instrumente potrivite, returnează:
{
  "status": "ok",
  "recommendations": [
    {
      "toolId": "<toolId exact din listă>",
      "reason": "<o propoziție scurtă în limba română care explică de ce este potrivit acest instrument>"
    }
  ]
}

Fiecare toolId trebuie să fie identic cu unul din listă. Returnează între 1 și 3 elemente în "recommendations".`;

  try {
    // Safety pass 2: OpenAI Moderation API. If flagged, do NOT recommend a tool.
    try {
      const modRes = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: query,
        }),
      });

      if (modRes.ok) {
        const modData = await modRes.json();
        const flagged = modData?.results?.[0]?.flagged === true;
        if (flagged) {
          res.status(200).json({
            success: false,
            message: UNSAFE_SEARCH_MESSAGE,
          });
          return;
        }
      }
      // If the moderation call fails (non-ok), fall through: the local blocklist
      // already ran and the recommendation prompt enforces safety rules too.
    } catch {
      // Network/parse error on moderation: rely on blocklist + prompt safety.
    }

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

    // Safety pass 3: model judged the request unsafe / non-family-friendly.
    if (parsed.status === "unsafe") {
      res.status(200).json({
        success: false,
        message: UNSAFE_SEARCH_MESSAGE,
      });
      return;
    }

    // Resolve the chosen tools from the received tools only (never trust the
    // model to invent a tool that was not sent in body.tools). Supports the
    // new `recommendations` array, with a fallback to a single `toolId` for
    // backward compatibility.
    let rawRecommendations = [];
    if (parsed.status === "ok") {
      if (Array.isArray(parsed.recommendations)) {
        rawRecommendations = parsed.recommendations;
      } else if (typeof parsed.toolId === "string") {
        rawRecommendations = [{ toolId: parsed.toolId, reason: parsed.reason }];
      }
    }

    const seen = new Set();
    const recommendations = [];
    for (const rec of rawRecommendations) {
      const toolId = rec && typeof rec.toolId === "string" ? rec.toolId : "";
      const tool = toolsById.get(toolId);
      // Skip unknown toolIds and duplicates.
      if (!tool || seen.has(tool.toolId)) continue;
      seen.add(tool.toolId);
      recommendations.push({
        toolId: tool.toolId,
        toolName: tool.toolName,
        categorySlug: tool.categorySlug,
        slugInstrument: tool.slugInstrument,
        reason:
          typeof rec.reason === "string" && rec.reason.trim()
            ? rec.reason.trim()
            : "Acest instrument este potrivit pentru cererea ta.",
      });
      // Enforce maximum of 3 recommendations.
      if (recommendations.length >= 3) break;
    }

    // No relevant tool, or the model returned only unknown toolIds.
    if (recommendations.length === 0) {
      res.status(200).json({
        success: false,
        message: NO_MATCH_MESSAGE,
      });
      return;
    }

    res.status(200).json({
      success: true,
      recommendations,
    });
  } catch (error) {
    res.status(200).json({
      success: false,
      message: `OpenAI error: ${error.message}`,
    });
  }
}
