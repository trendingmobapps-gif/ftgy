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

// Maximum number of characters of extracted document text we keep, so we don't
// blow past the model context window.
const MAX_EXTRACTED_CHARS = 40000;

// Message returned when a PDF has no selectable text (scanned/image-only).
const SCANNED_PDF_MESSAGE =
  "Documentul pare scanat sau nu conține text selectabil. Te rog încarcă un PDF text-based sau copiază textul manual.";

// Converts a Wix internal media URI (wix:image://, wix:document://, wix:video://)
// into a publicly accessible HTTPS URL that the backend can download.
// Returns the original string if it is not a recognized Wix URI.
function convertWixInternalUrl(value) {
  if (typeof value !== "string") return "";
  const str = value.trim();

  // wix:image://v1/<mediaId>/<filename>#... -> https://static.wixstatic.com/media/<mediaId>
  if (str.startsWith("wix:image://")) {
    const withoutPrefix = str.replace("wix:image://v1/", "").replace("wix:image://", "");
    const mediaId = withoutPrefix.split("/")[0].split("#")[0];
    return mediaId ? `https://static.wixstatic.com/media/${mediaId}` : "";
  }

  // wix:document://v1/<docPath>/<filename> -> https://docs.wixstatic.com/ugd/<docPath>
  // The docPath may itself contain slashes, so strip only the trailing filename.
  if (str.startsWith("wix:document://")) {
    const withoutPrefix = str
      .replace("wix:document://v1/", "")
      .replace("wix:document://", "")
      .split("#")[0];
    const lastSlash = withoutPrefix.lastIndexOf("/");
    const docPath =
      lastSlash > 0 ? withoutPrefix.slice(0, lastSlash) : withoutPrefix;
    if (!docPath) return "";
    // Wix serves uploaded documents from the docs CDN.
    const normalized = docPath.startsWith("ugd/") ? docPath : `ugd/${docPath}`;
    return `https://docs.wixstatic.com/${normalized}`;
  }

  return str;
}

// Wix upload fields can arrive as a plain URL string or as an object that
// contains the URL under various keys (url, fileUrl, mediaUrl, src, ...).
// Normalize all of those to a single string URL, converting Wix internal URIs.
function getFileUrl(fileInput) {
  if (!fileInput) return "";
  if (typeof fileInput === "string") {
    return convertWixInternalUrl(fileInput.trim());
  }
  if (Array.isArray(fileInput)) {
    return getFileUrl(fileInput[0]);
  }
  if (typeof fileInput === "object") {
    const candidate =
      fileInput.url ||
      fileInput.fileUrl ||
      fileInput.mediaUrl ||
      fileInput.src ||
      fileInput.downloadUrl ||
      fileInput.link ||
      fileInput.fileUri ||
      fileInput.uri ||
      "";
    return convertWixInternalUrl(String(candidate).trim());
  }
  return "";
}

// Downloads an uploaded file (PDF / DOCX / TXT) and extracts its plain text.
// Accepts either a direct URL string or an object with a url/fileUrl property.
async function extractTextFromUploadedFile(fileInput) {
  const url = getFileUrl(fileInput);

  // Debug: log exactly what we resolved from the raw file input.
  console.log("[v0] Resolved file URL:", url || "(empty)");

  if (!url) {
    throw new Error(
      "Fișierul nu are un URL valid. Verifică upload-ul din Wix (trimite url/fileUrl/mediaUrl).",
    );
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(
      "Fișierul nu are un URL public valid. Verifică upload-ul din Wix (URL intern wix: trebuie convertit în URL public).",
    );
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Nu am putut descărca fișierul (status ${response.status}).`,
    );
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Detect type from the file extension (ignoring any query string) and the
  // content-type header.
  const cleanUrl = url.split("?")[0].toLowerCase();
  const ext = cleanUrl.slice(cleanUrl.lastIndexOf(".") + 1);

  const isPdf = ext === "pdf" || contentType.includes("application/pdf");
  const isDocx =
    ext === "docx" ||
    contentType.includes("officedocument.wordprocessingml");
  const isDoc = ext === "doc" || contentType === "application/msword";
  const isTxt =
    ext === "txt" ||
    contentType.includes("text/plain") ||
    contentType.startsWith("text/");

  let text = "";

  if (isPdf) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      text = (result?.text || "").trim();
    } finally {
      await parser.destroy();
    }
    if (!text) {
      // Parsed fine but contains no extractable text -> scanned/image PDF.
      throw new Error(SCANNED_PDF_MESSAGE);
    }
  } else if (isDocx) {
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.extractRawText({ buffer });
    text = (result?.value || "").trim();
  } else if (isTxt) {
    text = buffer.toString("utf-8").trim();
  } else if (isDoc) {
    // Legacy binary .doc is not reliably parseable here.
    throw new Error(
      "Formatul .doc nu este suportat. Te rog încarcă un PDF, DOCX sau TXT, sau copiază textul manual.",
    );
  } else {
    // Unknown type: best-effort read as plain text.
    text = buffer.toString("utf-8").trim();
    if (!text) {
      throw new Error("Tip de fișier nesuportat sau fișier gol.");
    }
  }

  // Limit extracted text so we don't exceed the model context window.
  if (text.length > MAX_EXTRACTED_CHARS) {
    text =
      text.slice(0, MAX_EXTRACTED_CHARS) +
      "\n\n[Text trunchiat pentru limită de lungime.]";
  }

  return text;
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
  // Accept both `userInput` (existing frontend) and `input` (new structure) for
  // backward compatibility. The first valid object wins.
  const rawInput =
    body.userInput && typeof body.userInput === "object"
      ? body.userInput
      : body.input && typeof body.input === "object"
        ? body.input
        : null;
  const userInput = rawInput;

  // Debug: log the incoming payload so we can see exactly what Wix sends,
  // including the shape of any uploaded file field (e.g. `fisierMaterial`).
  console.log("[v0] Incoming toolId:", toolId);
  console.log("[v0] Incoming input payload:", JSON.stringify(userInput));
  if (userInput && userInput.fisierMaterial !== undefined) {
    console.log(
      "[v0] fisierMaterial raw value:",
      JSON.stringify(userInput.fisierMaterial),
    );
  }

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

  // --- Build the final input and extract uploaded document text (if any) ---
  // The uploaded file (Wix CMS key: `fisierMaterial`) is optional. When present,
  // we download it on the server, extract the text, and place it in
  // `continutFisier` so the model receives the actual content, not just a URL.
  let finalInput = { ...userInput };

  if (finalInput.fisierMaterial) {
    try {
      const extractedText = await extractTextFromUploadedFile(
        finalInput.fisierMaterial,
      );
      finalInput.continutFisier = extractedText;
    } catch (error) {
      console.error("File extraction error:", error);
      finalInput.continutFisier = "";
      finalInput.eroareFisier =
        error?.message || "Fișierul nu a putut fi citit automat.";
    }
  }

  // If the only content source was an uploaded file that we could not read, and
  // the user did not paste any manual text alternative, return a clear message
  // instead of generating a low-quality result.
  if (finalInput.fisierMaterial && finalInput.eroareFisier) {
    const manualTextFields = (tool.requiresAnyOf || []).filter(
      (field) => field !== "fisierMaterial",
    );
    const hasManualText = manualTextFields.some((field) => {
      const value = finalInput[field];
      return value !== undefined && value !== null && String(value).trim() !== "";
    });
    if (!hasManualText) {
      res.status(200).json({ success: false, message: finalInput.eroareFisier });
      return;
    }
  }

  // --- requiresAnyOf validation ---
  // For tools that accept either manual text OR an uploaded file, ensure at
  // least one of the listed fields has usable content.
  if (tool.requiresAnyOf?.length) {
    const hasAtLeastOne = tool.requiresAnyOf.some((field) => {
      const value = finalInput[field];
      return value !== undefined && value !== null && String(value).trim() !== "";
    });

    if (!hasAtLeastOne) {
      res.status(200).json({
        success: false,
        message: "Completează textul manual sau încarcă un fișier.",
        requiredAnyOf: tool.requiresAnyOf,
      });
      return;
    }
  }

  // If the tool defines a buildUserPrompt(input) function, use it so the user's
  // actual values (including optional fields and extracted file text) are
  // injected into the prompt. Otherwise fall back to the generic formatted list.
  const toolInputSection =
    typeof tool.buildUserPrompt === "function"
      ? tool.buildUserPrompt(finalInput).trim()
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
