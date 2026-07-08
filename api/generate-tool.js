// Vercel Serverless Function: POST /api/generate-tool
// Generates a tool-specific result using OpenAI, based on the tool config.
//
// Accepts BOTH:
//   1) multipart/form-data  -> fields: toolId, input (JSON string), categorySlug
//      (optional), and an optional file field `fisierMaterial`. The file is
//      parsed in-memory, its text is extracted, and the file is NOT stored.
//   2) application/json      -> { toolId, input | userInput, categorySlug }.
//      For backward compatibility, `fisierMaterial` may be a public URL string.

import { TOOLS } from "../tools/tools-config.js";
import formidable from "formidable";
import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Disable Vercel/Next automatic body parsing so we can read the raw stream for
// multipart/form-data with formidable. (No effect on plain Vercel functions for
// multipart, which is never auto-parsed; kept for correctness/future-proofing.)
export const config = {
  api: {
    bodyParser: false,
  },
};

// Maximum uploaded file size (10MB).
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Maximum number of characters of extracted document text we keep, so we don't
// blow past the model context window.
const MAX_EXTRACTED_CHARS = 40000;

// Preferred models for tool generation, strongest first. We fall back when a
// model is unavailable on the account. gpt-4.1-mini is intentionally NOT here;
// it is only used as a last resort if every model above fails.
const TOOL_GEN_MODELS = ["gpt-5.1", "gpt-5", "gpt-4.1", "gpt-4.1-mini"];

// Only the gpt-4 family accepts custom sampling params (temperature/top_p).
// GPT-5 reasoning models reject them, so we omit them for those.
function supportsCustomSampling(model) {
  return model.startsWith("gpt-4");
}

// Detects OpenAI errors that mean "this model is unavailable for this account",
// so we fall back to the next model instead of failing the request.
function isModelUnavailableError(status, errText) {
  if (status === 404) return true;
  const t = String(errText || "").toLowerCase();
  return (
    t.includes("does not exist") ||
    t.includes("do not have access") ||
    t.includes("not have access") ||
    t.includes("unknown model") ||
    t.includes("invalid model") ||
    t.includes("model_not_found") ||
    t.includes("is not supported")
  );
}

// Robustly extracts the generated text from an OpenAI response, supporting both
// the Responses API (output_text / output[].content[].text) and the older
// chat/completions shape (choices[0].message.content) as a safety net.
function extractResponseText(data) {
  if (!data || typeof data !== "object") return "";

  // Responses API convenience field.
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  // Responses API structured output array.
  if (Array.isArray(data.output)) {
    const text = data.output
      .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }

  // Chat/completions fallback.
  const chat = data?.choices?.[0]?.message?.content;
  if (typeof chat === "string" && chat.trim()) return chat.trim();

  return "";
}

// Calls the OpenAI Responses API, trying TOOL_GEN_MODELS in order. Falls back to
// the next model only on availability errors; other errors stop the loop and are
// surfaced. Returns { data, model } on success or { error } on failure.
// We use the Responses API because GPT-5 reasoning models can return empty
// chat/completions content (reasoning tokens consume the token budget), whereas
// the Responses API reliably exposes the final text via output_text.
async function callToolModel({ systemPrompt, userPrompt, apiKey }) {
  let lastError = "";
  for (const model of TOOL_GEN_MODELS) {
    const body = {
      model,
      instructions: systemPrompt,
      input: userPrompt,
      // Generous budget so GPT-5 reasoning tokens don't starve the final text.
      max_output_tokens: 4000,
    };
    if (supportsCustomSampling(model)) {
      body.temperature = 0.35;
      body.top_p = 0.9;
    }

    let openaiRes;
    try {
      openaiRes = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastError = e?.message || "network error";
      continue;
    }

    if (openaiRes.ok) {
      const data = await openaiRes.json();
      const text = extractResponseText(data);
      if (text) {
        return { data, model, text };
      }
      // Successful HTTP call but no usable text: log server-side and try the
      // next model rather than failing outright.
      console.log(
        "[v0] generate-tool empty response from model",
        model,
        "raw:",
        JSON.stringify(data).slice(0, 2000),
      );
      lastError = "empty response";
      continue;
    }

    const errText = await openaiRes.text();
    lastError = errText;
    if (!isModelUnavailableError(openaiRes.status, errText)) {
      break;
    }
  }
  return { error: lastError };
}

// Generic message when a file exists but cannot be read/parsed.
const FILE_UNREADABLE_MESSAGE =
  "Fișierul nu a putut fi citit. Încearcă alt document sau copiază textul manual.";

// Message returned when a PDF has no selectable text (scanned/image-only).
const SCANNED_PDF_MESSAGE =
  "PDF-ul pare scanat sau imagine. Te rog încarcă un PDF text-based sau copiază textul manual.";

// Origins allowed to call this endpoint from the browser (Wix web + local dev).
const allowedOrigins = [
  "https://www.iterai.ro",
  "https://iterai.ro",
  "https://iter.ro",
  "http://localhost:3000",
  "http://localhost:5173",
];

// Reflects the request Origin when it is in the allowlist; otherwise falls back
// to the primary production origin. A specific origin (not "*") is required so
// the browser accepts responses when auth headers are involved.
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = allowedOrigins.includes(origin)
    ? origin
    : "https://www.iterai.ro";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-iter-secret, Cache-Control, Pragma, X-Requested-With",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

// Picks the first non-empty string from a list of candidate values.
function firstNonEmpty(...candidates) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }
  return "";
}

// Builds the base URL of the incoming request so internal API calls target the
// same host/deployment instead of a hardcoded domain.
function getRequestBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  return host ? `${proto}://${host}` : "";
}

// Calls the internal POST /api/check-user-access endpoint. Returns
// { ok, status, data } and never throws.
async function callCheckUserAccess({ baseUrl, secret, email, categorySlug }) {
  try {
    const resp = await fetch(`${baseUrl}/api/check-user-access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-iter-secret": secret,
      },
      body: JSON.stringify({ email, categorySlug }),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error?.message || "network error" };
  }
}

// Calls the internal POST /api/consume-free-generation endpoint. Returns
// { ok, status, data } and never throws.
async function callConsumeFreeGeneration({
  baseUrl,
  secret,
  email,
  categorySlug,
  toolSlug,
  idempotencyKey,
}) {
  try {
    const resp = await fetch(`${baseUrl}/api/consume-free-generation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-iter-secret": secret,
      },
      body: JSON.stringify({
        email,
        categorySlug,
        actionType: "tool_generation",
        toolSlug,
        idempotencyKey,
        metadata: {
          source: "api/generate-tool.js",
        },
      }),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error?.message || "network error" };
  }
}

// --- Supabase REST helpers (generation_history dual-write) ---
// These talk directly to the Supabase REST API using the same conventions as
// the other endpoints in this project. They never throw.

// Select rows from a Supabase table using a filtered GET query.
async function supabaseSelect({ baseUrl, secretKey, table, query }) {
  try {
    const resp = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
      method: "GET",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });
    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error?.message || "network error" };
  }
}

// Insert a row into a Supabase table (returns the created representation).
async function supabaseInsert({ baseUrl, secretKey, table, row }) {
  try {
    const resp = await fetch(`${baseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error?.message || "network error" };
  }
}

// Dual-write the completed generation into public.generation_history. Returns
// { saved, id, error } and NEVER throws, so a Supabase failure can never break
// the AI response. Wix generationhistory remains active in parallel.
async function saveGenerationHistory({
  email,
  memberId,
  wixItemId,
  toolId,
  toolName,
  toolSlug,
  categorySlug,
  categoryName,
  userInputJson,
  resultMarkdown,
  resultsJson,
  variantNumber,
  metadata,
}) {
  const baseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!baseUrl || !secretKey) {
    return { saved: false, id: null, error: "Supabase is not configured." };
  }

  try {
    // Look up profile_id by email (best-effort; never fatal).
    let profileId = null;
    const profileLookup = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "profiles",
      query: `email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
    });
    if (
      profileLookup.ok &&
      Array.isArray(profileLookup.data) &&
      profileLookup.data.length > 0
    ) {
      profileId = profileLookup.data[0].id || null;
    }

    const row = {
      email,
      member_id: memberId || null,
      wix_item_id: wixItemId || null,
      tool_id: toolId || null,
      tool_name: toolName || null,
      tool_slug: toolSlug || null,
      category_slug: categorySlug || null,
      category_name: categoryName || null,
      user_input_json:
        userInputJson && typeof userInputJson === "object" ? userInputJson : {},
      result_markdown:
        typeof resultMarkdown === "string" ? resultMarkdown : null,
      results_json: resultsJson || null,
      variant_number:
        Number.isFinite(Number(variantNumber)) && variantNumber !== null
          ? Number(variantNumber)
          : null,
      source: "vercel",
      metadata: metadata && typeof metadata === "object" ? metadata : {},
    };
    // Only set profile_id when we actually found one.
    if (profileId) {
      row.profile_id = profileId;
    }

    const result = await supabaseInsert({
      baseUrl,
      secretKey,
      table: "generation_history",
      row,
    });

    if (!result.ok) {
      return {
        saved: false,
        id: null,
        error: "Supabase generation_history insert failed.",
      };
    }

    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    return { saved: true, id: created ? created.id || null : null, error: null };
  } catch (error) {
    return {
      saved: false,
      id: null,
      error: error?.message || "Unexpected error saving generation history.",
    };
  }
}

// Parses a multipart/form-data request using formidable. Returns { fields, files }.
function parseMultipartForm(req) {
  const form = formidable({
    maxFiles: 1,
    maxFileSize: MAX_FILE_SIZE,
    keepExtensions: true,
    multiples: false,
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ fields, files });
    });
  });
}

// formidable v3 returns every field/file as an array. Read the first value.
function firstValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

// Reads and JSON-parses the raw request body from the stream. Used as a fallback
// for the JSON flow when automatic body parsing is disabled (bodyParser: false)
// or unavailable, so the endpoint works regardless of platform behavior.
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// Extracts plain text from an in-memory file buffer based on its filename
// extension and mimetype. Supports PDF, DOCX and TXT. Returns trimmed text.
async function extractTextFromBuffer(buffer, { filename = "", mimetype = "" } = {}) {
  if (!buffer || buffer.length === 0) {
    throw new Error(FILE_UNREADABLE_MESSAGE);
  }

  const lowerName = String(filename).split("?")[0].toLowerCase();
  const ext = lowerName.includes(".")
    ? lowerName.slice(lowerName.lastIndexOf(".") + 1)
    : "";
  const ct = String(mimetype).toLowerCase();

  const isPdf = ext === "pdf" || ct.includes("application/pdf");
  const isDocx =
    ext === "docx" || ct.includes("officedocument.wordprocessingml");
  const isDoc = ext === "doc" || ct === "application/msword";
  const isTxt =
    ext === "txt" || ct.includes("text/plain") || ct.startsWith("text/");

  // Debug: log details about the file being processed.
  console.log("[v0] Extracting file:", filename || "(no name)");
  console.log("[v0] File mimetype:", mimetype || "(none)");
  console.log("[v0] File size:", buffer.length, "bytes");

  let text = "";

  if (isPdf) {
    // pdf-parse v1.1.1 is a pure-Node parser that does NOT require browser APIs
    // like DOMMatrix/document/canvas (unlike pdfjs-dist based versions).
    // Import the lib file directly to skip the package's debug entrypoint.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    try {
      const data = await pdfParse(buffer);
      text = (data?.text || "").trim();
    } catch (error) {
      console.log("[v0] PDF parser error:", error);
      throw new Error(SCANNED_PDF_MESSAGE);
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
      "Formatul .doc nu este suportat. Formatele recomandate sunt .pdf, .docx sau .txt, sau copiază textul manual.",
    );
  } else {
    // Unknown type: best-effort read as plain text.
    text = buffer.toString("utf-8").trim();
    if (!text) {
      throw new Error(FILE_UNREADABLE_MESSAGE);
    }
  }

  if (!text) {
    throw new Error(FILE_UNREADABLE_MESSAGE);
  }

  // Limit extracted text so we don't exceed the model context window.
  if (text.length > MAX_EXTRACTED_CHARS) {
    text =
      text.slice(0, MAX_EXTRACTED_CHARS) +
      "\n\n[Text trunchiat pentru limită de lungime.]";
  }

  return text;
}

// Backward-compatibility helper for the JSON flow: when `fisierMaterial` is a
// public URL string, download it and extract its text. (No Wix credentials.)
async function extractTextFromUrl(url) {
  const cleanInput = String(url || "").trim();
  if (!/^https?:\/\//i.test(cleanInput)) {
    throw new Error(FILE_UNREADABLE_MESSAGE);
  }

  const response = await fetch(cleanInput);
  if (!response.ok) {
    throw new Error(
      `Nu am putut descărca fișierul (status ${response.status}).`,
    );
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const cleanUrl = cleanInput.split("?")[0];

  return extractTextFromBuffer(buffer, {
    filename: cleanUrl,
    mimetype: contentType,
  });
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

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

  // --- Parse the request: multipart/form-data OR application/json ---
  let toolId = "";
  let userInput = null;
  let categorySlug = "";
  // In-memory uploaded file (multipart only): { buffer, filename, mimetype }.
  let uploadedFile = null;
  // Improve mode: regenerate an improved version of a previous result.
  let improveMode = false;
  let previousResult = "";
  let improvementInstruction = "";
  // Access / free-trial consumption fields (optional; sent by the frontend).
  let userEmailRaw = "";
  let toolSlugRaw = "";
  let idempotencyKeyRaw = "";
  // Category from access-specific body fields (falls back to categorySlug).
  let accessCategoryRaw = "";
  // Optional fields used for the generation_history dual-write.
  let memberIdRaw = "";
  let wixItemIdRaw = "";
  let toolNameRaw = "";
  let categoryNameRaw = "";
  let variantNumberRaw = null;
  let generationTypeRaw = "";

  const contentType = String(req.headers["content-type"] || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    let tmpFilePath = "";
    try {
      const { fields, files } = await parseMultipartForm(req);

      toolId = String(firstValue(fields.toolId) || "").trim();
      categorySlug = String(firstValue(fields.categorySlug) || "").trim();

      // Access / free-trial fields (optional).
      userEmailRaw = firstNonEmpty(
        firstValue(fields.email),
        firstValue(fields.userEmail),
        firstValue(fields.memberEmail),
        firstValue(fields.clientEmail),
      );
      accessCategoryRaw = firstNonEmpty(
        firstValue(fields.categorySlug),
        firstValue(fields.category),
        firstValue(fields.categoryId),
      );
      toolSlugRaw = firstNonEmpty(
        firstValue(fields.toolSlug),
        firstValue(fields.toolId),
        firstValue(fields.slug),
      );
      idempotencyKeyRaw = firstNonEmpty(
        firstValue(fields.idempotencyKey),
        firstValue(fields.generationRequestId),
        firstValue(fields.requestId),
      );

      // generation_history optional fields.
      memberIdRaw = firstNonEmpty(
        firstValue(fields.memberId),
        firstValue(fields.wixMemberId),
      );
      wixItemIdRaw = firstNonEmpty(
        firstValue(fields.generationHistoryId),
        firstValue(fields.wixItemId),
        firstValue(fields.wix_item_id),
        firstValue(fields.historyId),
      );
      toolNameRaw = firstNonEmpty(firstValue(fields.toolName));
      categoryNameRaw = firstNonEmpty(firstValue(fields.categoryName));
      variantNumberRaw = firstValue(fields.variantNumber) ?? null;
      generationTypeRaw = firstNonEmpty(firstValue(fields.generationType));

      // Improve mode fields (optional).
      const improveRaw = firstValue(fields.improveMode);
      improveMode = improveRaw === true || String(improveRaw) === "true";
      previousResult = String(firstValue(fields.previousResult) || "");
      improvementInstruction = String(
        firstValue(fields.improvementInstruction) || "",
      );

      // `input` is a JSON string; accept `userInput` as an alias.
      const inputRaw = firstValue(fields.input) ?? firstValue(fields.userInput);
      if (inputRaw) {
        try {
          userInput =
            typeof inputRaw === "string" ? JSON.parse(inputRaw) : inputRaw;
        } catch {
          userInput = null;
        }
      }

      // Optional uploaded file field: `fisierMaterial`.
      const fileObj = firstValue(files.fisierMaterial);
      if (fileObj && fileObj.filepath) {
        tmpFilePath = fileObj.filepath;
        const buffer = await readFile(fileObj.filepath);
        uploadedFile = {
          buffer,
          filename: fileObj.originalFilename || fileObj.newFilename || "",
          mimetype: fileObj.mimetype || "",
        };
      }
    } catch (error) {
      console.log("[v0] Multipart parse error:", error?.message);
      const tooLarge = /maxFileSize|exceeded|maxTotalFileSize/i.test(
        error?.message || "",
      );
      res.status(200).json({
        success: false,
        message: tooLarge
          ? "Fișierul este prea mare. Limita este de 10MB."
          : "Nu am putut procesa datele trimise. Verifică formularul și încearcă din nou.",
      });
      return;
    } finally {
      // Never persist the uploaded file: delete the temp file after reading.
      if (tmpFilePath) {
        try {
          await unlink(tmpFilePath);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  } else {
    // JSON flow. Use the pre-parsed body if available; otherwise read the raw
    // stream (needed when bodyParser is disabled or not provided by the host).
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        body = {};
      }
    }
    if (!body || typeof body !== "object") {
      body = await readJsonBody(req);
    }
    body = body || {};

    toolId = typeof body.toolId === "string" ? body.toolId.trim() : "";
    categorySlug =
      typeof body.categorySlug === "string" ? body.categorySlug.trim() : "";

    // Access / free-trial fields (optional).
    userEmailRaw = firstNonEmpty(
      body.email,
      body.userEmail,
      body.memberEmail,
      body.clientEmail,
    );
    accessCategoryRaw = firstNonEmpty(
      body.categorySlug,
      body.category,
      body.categoryId,
    );
    toolSlugRaw = firstNonEmpty(body.toolSlug, body.toolId, body.slug);
    idempotencyKeyRaw = firstNonEmpty(
      body.idempotencyKey,
      body.generationRequestId,
      body.requestId,
    );

    // generation_history optional fields.
    memberIdRaw = firstNonEmpty(body.memberId, body.wixMemberId);
    wixItemIdRaw = firstNonEmpty(
      body.generationHistoryId,
      body.wixItemId,
      body.wix_item_id,
      body.historyId,
    );
    toolNameRaw = firstNonEmpty(body.toolName);
    categoryNameRaw = firstNonEmpty(body.categoryName);
    variantNumberRaw =
      body.variantNumber !== undefined && body.variantNumber !== null
        ? body.variantNumber
        : null;
    generationTypeRaw = firstNonEmpty(body.generationType);

    // Improve mode fields (optional).
    improveMode = body.improveMode === true || body.improveMode === "true";
    previousResult =
      typeof body.previousResult === "string" ? body.previousResult : "";
    improvementInstruction =
      typeof body.improvementInstruction === "string"
        ? body.improvementInstruction
        : "";

    // Accept both `userInput` (existing frontend) and `input` (string or object).
    if (body.userInput && typeof body.userInput === "object") {
      userInput = body.userInput;
    } else if (body.input && typeof body.input === "object") {
      userInput = body.input;
    } else if (typeof body.input === "string") {
      try {
        userInput = JSON.parse(body.input);
      } catch {
        userInput = null;
      }
    }
  }

  // Debug: log exactly what arrived so we can confirm the payload shape.
  console.log("[v0] Incoming toolId:", toolId);
  console.log("[v0] Incoming input payload:", JSON.stringify(userInput));
  console.log(
    "[v0] Uploaded file:",
    uploadedFile
      ? `${uploadedFile.filename} (${uploadedFile.mimetype}, ${uploadedFile.buffer.length} bytes)`
      : "(none)",
  );

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
      message:
        "Instrumentul nu a fost găsit în configurația Vercel. Verifică ToolId în Wix CMS și tools-config.js.",
    });
    return;
  }

  // Validate userInput object.
  if (!userInput || typeof userInput !== "object") {
    res.status(200).json({
      success: false,
      message: "Lipsește input sau nu este un obiect valid.",
    });
    return;
  }

  // In improve mode, require a meaningful improvement instruction.
  if (improveMode && improvementInstruction.trim().length < 3) {
    res.status(200).json({
      success: false,
      message: "Te rugăm să scrii ce vrei să modificăm.",
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

  // --- Access control + free-trial consumption setup ---
  // These are resolved once here and reused for the response and, on success,
  // the consume-free-generation call.
  const normalizedEmail = userEmailRaw.trim().toLowerCase();
  const resolvedCategorySlug = firstNonEmpty(accessCategoryRaw, categorySlug);
  const resolvedToolSlug = firstNonEmpty(toolSlugRaw, toolId);
  // Prefer a frontend-supplied idempotency key; otherwise generate a stable
  // fallback per request so consume-free-generation stays idempotent.
  const idempotencyKey = idempotencyKeyRaw || randomUUID();
  const internalSecret = process.env.ITER_INTERNAL_API_SECRET;
  const requestBaseUrl = getRequestBaseUrl(req);

  // When no email is provided, keep the legacy behavior intact (temporary,
  // until the Wix frontend sends the user email). We record why the check was
  // skipped and continue generation as before.
  const accessCheckSkipped = !normalizedEmail;
  // Populated after a successful access check; included in the response.
  let accessCheckResult = null;

  if (!accessCheckSkipped) {
    // With an email present, categorySlug becomes required.
    if (!resolvedCategorySlug) {
      res.status(400).json({
        success: false,
        message: "Lipsește categorySlug.",
      });
      return;
    }
    // toolSlug should always be inferable from toolId; guard just in case.
    if (!resolvedToolSlug) {
      res.status(400).json({
        success: false,
        message: "Lipsește toolSlug.",
      });
      return;
    }
    if (!internalSecret) {
      res.status(500).json({
        success: false,
        message: "Server misconfiguration: internal secret is not set.",
      });
      return;
    }
    if (!requestBaseUrl) {
      res.status(500).json({
        success: false,
        message: "Server misconfiguration: could not resolve request host.",
      });
      return;
    }

    const accessCheck = await callCheckUserAccess({
      baseUrl: requestBaseUrl,
      secret: internalSecret,
      email: normalizedEmail,
      categorySlug: resolvedCategorySlug,
    });

    if (!accessCheck.ok || !accessCheck.data) {
      console.log(
        "[v0] generate-tool access check failed:",
        accessCheck.status,
        accessCheck.error || JSON.stringify(accessCheck.data || {}).slice(0, 500),
      );
      res.status(502).json({
        success: false,
        message: "Nu am putut verifica accesul. Te rugăm să încerci din nou.",
      });
      return;
    }

    accessCheckResult = accessCheck.data;

    if (accessCheck.data.hasAccess !== true) {
      // No paid access and no free generations: stop before calling OpenAI.
      res.status(402).json({
        success: false,
        hasAccess: false,
        shouldRedirectToCheckout: true,
        reason: accessCheck.data.reason,
        freeGenerations: accessCheck.data.freeGenerations,
        message: "No access available. Please upgrade to continue.",
      });
      return;
    }
  }

  // Format the user input clearly for the model (only the tool's relevant fields).
  const formattedInput = (tool.requiredFields || [])
    .map((field) => `- ${field}: ${String(userInput[field]).trim()}`)
    .join("\n");

  const UNSAFE_MESSAGE =
    "Răspunsul nu a putut fi generat deoarece cererea conține informații nepotrivite, ilegale sau care nu respectă regulile platformei.";

  // --- Safety filter (runs BEFORE generation) ---
  // 1) Lightweight keyword pre-check on toolId, categorySlug and all user input values.
  const combinedText = [
    toolId,
    categorySlug,
    improvementInstruction,
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
        input: `Tool: ${toolId}\nCategorie: ${categorySlug}\nDate:\n${formattedInput}${
          improveMode ? `\nModificare cerută:\n${improvementInstruction}` : ""
        }`,
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
  // The uploaded file is optional. When present we extract its text on the
  // server and place it in `continutFisier` so the model receives the actual
  // content, never the raw file. We do not store the document.
  const finalInput = { ...userInput };
  // Whether the request included a file attempt (multipart buffer OR JSON URL).
  const hadFileUpload = !!uploadedFile || !!userInput.fisierMaterial;

  if (uploadedFile) {
    // Primary flow: file uploaded directly via multipart/form-data.
    try {
      finalInput.continutFisier = await extractTextFromBuffer(
        uploadedFile.buffer,
        uploadedFile,
      );
    } catch (error) {
      console.log("[v0] File extraction error (multipart):", error?.message);
      finalInput.continutFisier = "";
      finalInput.eroareFisier = error?.message || FILE_UNREADABLE_MESSAGE;
    }
  } else if (userInput.fisierMaterial) {
    // Backward-compatibility: `fisierMaterial` provided as a public URL string.
    try {
      finalInput.continutFisier = await extractTextFromUrl(
        userInput.fisierMaterial,
      );
    } catch (error) {
      console.log("[v0] File extraction error (url):", error?.message);
      finalInput.continutFisier = "";
      finalInput.eroareFisier = error?.message || FILE_UNREADABLE_MESSAGE;
    }
  }

  // If a file was provided but could not be read, and the user did not paste any
  // manual text alternative, return a clear message instead of a weak result.
  if (hadFileUpload && finalInput.eroareFisier) {
    const manualTextFields = (tool.requiresAnyOf || []).filter(
      (field) => field !== "fisierMaterial",
    );
    const hasManualText = manualTextFields.some((field) => {
      const value = finalInput[field];
      return (
        value !== undefined && value !== null && String(value).trim() !== ""
      );
    });
    if (!hasManualText) {
      res.status(200).json({ success: false, message: finalInput.eroareFisier });
      return;
    }
  }

  // --- requiresAnyOf validation ---
  // For tools that accept either manual text OR an uploaded file, ensure at
  // least one of the listed fields has usable content (file text counts).
  if (tool.requiresAnyOf?.length) {
    const hasAtLeastOne = tool.requiresAnyOf.some((field) => {
      // An uploaded/extracted file satisfies the `fisierMaterial` requirement.
      if (field === "fisierMaterial") {
        return (
          !!finalInput.continutFisier &&
          String(finalInput.continutFisier).trim() !== ""
        );
      }
      const value = finalInput[field];
      return (
        value !== undefined && value !== null && String(value).trim() !== ""
      );
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

  // In improve mode, give the model the previous result plus the user's
  // modification request, and ask it to return only the improved final result.
  const improvementSection = improveMode
    ? `

Aceasta este o cerere de ÎMBUNĂTĂȚIRE a unui rezultat generat anterior cu același instrument și aceleași date.

Rezultatul anterior:
${previousResult || "(rezultatul anterior nu a fost furnizat)"}

Modificarea cerută de utilizator:
${improvementInstruction.trim()}

Reguli pentru îmbunătățire:
- Respectă întocmai cererea de modificare a utilizatorului.
- Păstrează obiectivul original al instrumentului și al datelor introduse.
- Pornește de la rezultatul anterior și îmbunătățește-l, nu o lua de la zero fără motiv.
- Nu explica ce ai schimbat și nu descrie modificările făcute.
- Returnează doar noul rezultat final îmbunătățit, în același format.`
    : "";

  const userPrompt = `${toolInputSection}${improvementSection}

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
    const { text, error: modelError } = await callToolModel({
      systemPrompt: tool.systemPrompt.trim(),
      userPrompt,
      apiKey,
    });

    const result = typeof text === "string" ? text.trim() : "";

    if (!result) {
      // Either every model failed or returned empty text. Details are already
      // logged server-side; show the user a clean, friendly message.
      console.log(
        "[v0] generate-tool failed to produce result. lastError:",
        modelError || "unknown",
      );
      res.status(200).json({
        success: false,
        message: "Nu am putut genera răspunsul. Te rugăm să încerci din nou.",
      });
      return;
    }

    // If the model produced the safety refusal instead of a result, return it as a failure.
    if (result.includes(UNSAFE_MESSAGE)) {
      res.status(200).json({ success: false, message: UNSAFE_MESSAGE });
      return;
    }

    // Legacy path: no email supplied. Preserve existing behavior and flag it.
    if (accessCheckSkipped) {
      res.status(200).json({
        success: true,
        toolId: tool.toolId,
        result,
        accessCheckSkipped: true,
        accessCheckReason: "missing_email",
      });
      return;
    }

    // Authenticated path: the AI response succeeded, so now (and only now)
    // consume a free generation. This never consumes for premium/paid-category
    // users -- consume-free-generation decides that server-side.
    const responsePayload = {
      success: true,
      toolId: tool.toolId,
      result,
      accessCheck: accessCheckResult,
      idempotencyKey,
    };

    const consume = await callConsumeFreeGeneration({
      baseUrl: requestBaseUrl,
      secret: internalSecret,
      email: normalizedEmail,
      categorySlug: resolvedCategorySlug,
      toolSlug: resolvedToolSlug,
      idempotencyKey,
    });

    let usageConsumptionData = null;
    if (consume.ok && consume.data) {
      usageConsumptionData = consume.data;
      responsePayload.usageConsumption = consume.data;
    } else {
      // The AI result is valid; do not fail the request just because the
      // consumption call failed. Surface a safe warning instead.
      console.log(
        "[v0] generate-tool consume-free-generation failed:",
        consume.status,
        consume.error || JSON.stringify(consume.data || {}).slice(0, 500),
      );
      responsePayload.consumptionWarning = true;
      responsePayload.consumptionError =
        "Nu am putut actualiza utilizarea. Rezultatul a fost generat.";
    }

    // --- Dual-write to Supabase public.generation_history ---
    // Wix generationhistory stays active in parallel; this mirrors every
    // successful generation into Supabase. A Supabase failure NEVER blocks the
    // AI response. Saved AFTER consumption so metadata can include usageEventId.
    const usageEvent =
      usageConsumptionData && usageConsumptionData.usageEvent
        ? usageConsumptionData.usageEvent
        : null;
    const uploadedFileName = uploadedFile ? uploadedFile.filename || null : null;
    const hasFile =
      !!uploadedFile ||
      !!(userInput && typeof userInput === "object" && userInput.fisierMaterial);

    const historySave = await saveGenerationHistory({
      email: normalizedEmail,
      memberId: memberIdRaw || null,
      wixItemId: wixItemIdRaw || null,
      toolId: tool.toolId,
      toolName: toolNameRaw || tool.name || null,
      toolSlug: resolvedToolSlug,
      categorySlug: resolvedCategorySlug,
      categoryName: categoryNameRaw || null,
      userInputJson: userInput || {},
      resultMarkdown: result,
      resultsJson: null,
      variantNumber: variantNumberRaw,
      metadata: {
        source: "api/generate-tool.js",
        idempotencyKey,
        accessType: accessCheckResult ? accessCheckResult.accessType : null,
        usageEventId: usageEvent ? usageEvent.id || null : null,
        usageConsumed: usageConsumptionData
          ? usageConsumptionData.wasConsumed || false
          : false,
        generationType: generationTypeRaw || (improveMode ? "improve" : "initial"),
        hasFile,
        fileName: uploadedFileName,
        toolSlug: resolvedToolSlug,
        categorySlug: resolvedCategorySlug,
        consumptionWarning: responsePayload.consumptionWarning || false,
      },
    });

    responsePayload.generationHistorySaved = historySave.saved === true;
    if (historySave.saved) {
      responsePayload.generationHistoryId = historySave.id || null;
    } else {
      console.log(
        "[v0] generate-tool generation_history save failed:",
        historySave.error,
      );
      responsePayload.generationHistorySaveWarning = true;
      responsePayload.generationHistorySaveError =
        "Nu am putut salva generarea în Supabase. Rezultatul a fost generat.";
    }

    res.status(200).json(responsePayload);
  } catch (error) {
    console.log("[v0] generate-tool unexpected error:", error?.message);
    res.status(200).json({
      success: false,
      message: "Nu am putut genera răspunsul. Te rugăm să încerci din nou.",
    });
  }
}
