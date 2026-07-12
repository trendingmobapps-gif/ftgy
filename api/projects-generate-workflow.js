import { guardRequest, sendSuccess, sendError } from "../lib/projects/http.js";
import { isValidUuid } from "../lib/projects/validation.js";
import { getProjectOwned } from "../lib/projects/repository.js";
import { PROJECT_ERROR_CODES } from "../lib/projects/constants.js";
import { PROJECT_BRAIN_ERROR_CODES } from "../lib/projects/brain/constants.js";
import { generateProjectWorkflow } from "../lib/projects/brain/service.js";

function mapServiceError(code, failureCode) {
  switch (code) {
    case "NOT_FOUND":
      return { status: 404, code: PROJECT_ERROR_CODES.NOT_FOUND, message: "Proiectul nu a fost găsit." };
    case "ARCHIVED_READONLY":
      return {
        status: 409,
        code: PROJECT_BRAIN_ERROR_CODES.ARCHIVED_READONLY,
        message: "Proiectele arhivate nu pot genera planuri noi.",
      };
    case "GENERATION_IN_PROGRESS":
      return {
        status: 409,
        code: PROJECT_BRAIN_ERROR_CODES.GENERATION_IN_PROGRESS,
        message: "Planul proiectului este deja în curs de generare.",
      };
    case "GENERATION_LIMIT":
      return {
        status: 429,
        code: PROJECT_BRAIN_ERROR_CODES.GENERATION_LIMIT,
        message: "Numărul maxim de încercări de generare a fost atins.",
      };
    case "RATE_LIMITED":
      return {
        status: 429,
        code: PROJECT_BRAIN_ERROR_CODES.RATE_LIMITED,
        message: "Prea multe cereri de generare. Încearcă din nou mai târziu.",
      };
    case "SAFETY_BLOCKED":
      return {
        status: 422,
        code: PROJECT_BRAIN_ERROR_CODES.SAFETY_BLOCKED,
        message: "Acest proiect nu poate primi un plan din motive de siguranță.",
      };
    case "GENERATION_FAILED":
      return {
        status: 502,
        code: PROJECT_BRAIN_ERROR_CODES.GENERATION_FAILED,
        message: "Planul proiectului nu a putut fi generat.",
        fields: failureCode ? { failureCode } : undefined,
      };
    default:
      return {
        status: 500,
        code: PROJECT_BRAIN_ERROR_CODES.INTERNAL,
        message: "A apărut o eroare internă.",
      };
  }
}

export default async function handler(req, res) {
  const guard = await guardRequest(req, res, { authMode: "user" });
  if (!guard.ok) return;

  const { body, baseUrl, secretKey, authenticatedUser } = guard;
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!isValidUuid(projectId)) {
    sendError(
      res,
      400,
      PROJECT_BRAIN_ERROR_CODES.VALIDATION,
      "Identificator proiect invalid.",
      { projectId: "projectId trebuie să fie un UUID valid." },
    );
    return;
  }

  try {
    const owned = await getProjectOwned({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      projectId,
    });

    if (!owned.ok) {
      sendError(res, 500, PROJECT_BRAIN_ERROR_CODES.INTERNAL, "Proiectul nu a putut fi încărcat.");
      return;
    }

    if (!owned.project) {
      sendError(res, 404, PROJECT_ERROR_CODES.NOT_FOUND, "Proiectul nu a fost găsit.");
      return;
    }

    const result = await generateProjectWorkflow({
      baseUrl,
      secretKey,
      userId: authenticatedUser.id,
      project: owned.project,
      clarificationAnswers: undefined,
    });

    if (!result.ok) {
      const mapped = mapServiceError(result.code, result.failureCode);
      sendError(res, mapped.status, mapped.code, mapped.message, mapped.fields);
      return;
    }

    sendSuccess(res, 200, {
      idempotent: Boolean(result.idempotent),
      ...result.view,
    });
  } catch {
    sendError(res, 500, PROJECT_BRAIN_ERROR_CODES.INTERNAL, "A apărut o eroare internă.");
  }
}
