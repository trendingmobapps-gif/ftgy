// Vercel Serverless Function: POST /api/transcribe-audio
// Converts a user voice recording into Romanian text for ITER chat input.
//
// Accepts multipart/form-data with a single file field named `audio`.
// The audio is parsed in-memory, sent to the OpenAI Audio Transcriptions API,
// and is NOT stored anywhere. Only the transcript text is returned.

import formidable from "formidable";
import { readFile, unlink } from "node:fs/promises";

// Disable Vercel/Next automatic body parsing so we can read the raw stream for
// multipart/form-data with formidable.
export const config = {
  api: {
    bodyParser: false,
  },
};

// Maximum uploaded audio size (10MB).
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// OpenAI transcription model.
const TRANSCRIBE_MODEL = "gpt-4o-transcribe";

// Friendly, generic error message (Romanian) shown to the user on any failure.
const ERROR_MESSAGE =
  "Nu am putut transcrie mesajul vocal. Te rugăm să încerci din nou.";

// Common audio formats accepted by the endpoint (matched against filename
// extension and/or mimetype). OpenAI supports these container/codec types.
const ALLOWED_EXTENSIONS = ["webm", "mp3", "mp4", "m4a", "wav", "ogg", "mpeg", "mpga"];
const ALLOWED_MIME_HINTS = [
  "audio/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "video/webm", // browsers often record voice as video/webm
  "video/mp4",
];

function setCorsHeaders(res) {
  // Allow the endpoint to be called from your Wix website (and any other origin).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
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

// Derives a usable filename + extension for the upload sent to OpenAI. OpenAI
// uses the file extension to detect the format, so we ensure one is present.
function resolveFilename(file) {
  const original =
    (file && (file.originalFilename || file.newFilename)) || "audio.webm";
  const hasExt = /\.[a-z0-9]{2,4}$/i.test(original);
  if (hasExt) return original;
  return `${original}.webm`;
}

// Best-effort check that the uploaded file looks like an accepted audio format.
function isAllowedAudio(file) {
  const name = (file?.originalFilename || file?.newFilename || "").toLowerCase();
  const mime = (file?.mimetype || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";

  if (ext && ALLOWED_EXTENSIONS.includes(ext)) return true;
  if (mime && ALLOWED_MIME_HINTS.some((m) => mime.startsWith(m))) return true;
  // If neither extension nor mimetype is informative, allow it and let OpenAI
  // decide — this avoids rejecting valid recordings with odd metadata.
  if (!ext && !mime) return true;
  return false;
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  // Preflight.
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(200).json({ success: false, message: ERROR_MESSAGE });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("[v0] transcribe-audio: OPENAI_API_KEY is not set");
    res.status(200).json({ success: false, message: ERROR_MESSAGE });
    return;
  }

  let tempFilePath = null;

  try {
    let parsed;
    try {
      parsed = await parseMultipartForm(req);
    } catch (err) {
      const tooLarge = /maxFileSize|exceeded|maxTotalFileSize/i.test(
        String(err?.message || ""),
      );
      console.log(
        "[v0] transcribe-audio: form parse error:",
        err?.message,
        tooLarge ? "(file too large)" : "",
      );
      res.status(200).json({ success: false, message: ERROR_MESSAGE });
      return;
    }

    const audioFile = firstValue(parsed?.files?.audio);
    if (!audioFile || !audioFile.filepath) {
      console.log("[v0] transcribe-audio: no `audio` file in request");
      res.status(200).json({ success: false, message: ERROR_MESSAGE });
      return;
    }

    tempFilePath = audioFile.filepath;

    if (!isAllowedAudio(audioFile)) {
      console.log(
        "[v0] transcribe-audio: unsupported audio format:",
        audioFile.originalFilename,
        audioFile.mimetype,
      );
      res.status(200).json({ success: false, message: ERROR_MESSAGE });
      return;
    }

    // Read the file into memory and build a multipart upload for OpenAI.
    const buffer = await readFile(tempFilePath);
    const filename = resolveFilename(audioFile);
    const blob = new Blob([buffer], {
      type: audioFile.mimetype || "application/octet-stream",
    });

    const openaiForm = new FormData();
    openaiForm.append("file", blob, filename);
    openaiForm.append("model", TRANSCRIBE_MODEL);
    // Romanian transcription when supported by the model.
    openaiForm.append("language", "ro");
    openaiForm.append("response_format", "json");

    const openaiRes = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          // Do NOT set Content-Type; fetch sets the multipart boundary itself.
          Authorization: `Bearer ${apiKey}`,
        },
        body: openaiForm,
      },
    );

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.log(
        "[v0] transcribe-audio: OpenAI error",
        openaiRes.status,
        errText.slice(0, 500),
      );
      res.status(200).json({ success: false, message: ERROR_MESSAGE });
      return;
    }

    const data = await openaiRes.json();
    const text = typeof data?.text === "string" ? data.text.trim() : "";

    if (!text) {
      console.log("[v0] transcribe-audio: empty transcript from OpenAI");
      res.status(200).json({ success: false, message: ERROR_MESSAGE });
      return;
    }

    res.status(200).json({ success: true, text });
  } catch (error) {
    console.log("[v0] transcribe-audio: unexpected error:", error?.message);
    res.status(200).json({ success: false, message: ERROR_MESSAGE });
  } finally {
    // Never store recordings: always remove the temp file formidable created.
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}
