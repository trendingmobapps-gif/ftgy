// Vercel Serverless Function: POST /api/projects-analyze-intent
// Analyzes a user's project goal and returns safe structured data for creation.
// Does NOT create a project.

import { guardRequest, sendError, sendSuccess } from "../lib/projects/http.js";
import { analyzeProjectIntent } from "../lib/projects/intent-analysis.js";
import { checkIntentRateLimit } from "../lib/projects/intent-rate-limit.js";
import { validateIntentAnalysisInput } from "../lib/projects/intent-validation.js";
import { PROJECT_INTENT_ERROR_CODES } from "../lib/projects/intent-schema.js";

export default async function handler(req, res) {
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  const { body, authenticatedUser } = guard;
  const rate = checkIntentRateLimit(authenticatedUser.id);
  if (!rate.allowed) {
    sendError(
      res,
      429,
      PROJECT_INTENT_ERROR_CODES.RATE_LIMITED,
      "Prea multe cereri de analiză. Încearcă din nou mai târziu.",
    );
    return;
  }

  const validation = validateIntentAnalysisInput(body);
  if (!validation.valid) {
    sendError(
      res,
      400,
      PROJECT_INTENT_ERROR_CODES.INVALID_INPUT,
      "Datele pentru analiză sunt invalide.",
      validation.fields,
    );
    return;
  }

  const analysis = await analyzeProjectIntent(validation.value);
  if (!analysis.ok) {
    if (analysis.kind === "unavailable") {
      sendError(
        res,
        503,
        PROJECT_INTENT_ERROR_CODES.UNAVAILABLE,
        "Analiza obiectivului nu este disponibilă momentan.",
      );
      return;
    }

    if (analysis.kind === "timeout" || analysis.kind === "network" || analysis.kind === "upstream") {
      sendError(
        res,
        502,
        PROJECT_INTENT_ERROR_CODES.UPSTREAM_ERROR,
        "Serviciul de analiză nu este disponibil momentan.",
      );
      return;
    }

    sendError(
      res,
      502,
      PROJECT_INTENT_ERROR_CODES.INVALID_RESPONSE,
      "Nu am putut interpreta obiectivul în siguranță.",
    );
    return;
  }

  sendSuccess(res, 200, analysis.result);
}
