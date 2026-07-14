import {
  NON_RETRYABLE_OPENAI_ERROR_CODES,
  OPENAI_INTERNAL_ERROR_CODES,
} from "./openai-error-codes.js";

function readErrorMessage(body) {
  if (!body || typeof body !== "object") return "";
  return String(body?.error?.message || body?.error?.code || body?.message || "").toLowerCase();
}

function readErrorType(body) {
  if (!body || typeof body !== "object") return "";
  return String(body?.error?.type || "").toLowerCase();
}

export function classifyOpenAiHttpError({ httpStatus, errorBody, incompleteReason }) {
  const message = readErrorMessage(errorBody);
  const type = readErrorType(errorBody);
  const incomplete = String(incompleteReason || "").toLowerCase();

  if (incomplete === "max_output_tokens") {
    return {
      code: OPENAI_INTERNAL_ERROR_CODES.OUTPUT_LIMIT_REACHED,
      retryable: false,
    };
  }

  if (
    message.includes("insufficient_quota") ||
    message.includes("exceeded your current quota") ||
    type.includes("insufficient_quota")
  ) {
    return {
      code: OPENAI_INTERNAL_ERROR_CODES.QUOTA_EXCEEDED,
      retryable: false,
    };
  }

  if (httpStatus === 401 || message.includes("invalid api key") || message.includes("incorrect api key")) {
    return {
      code: OPENAI_INTERNAL_ERROR_CODES.AUTH_FAILED,
      retryable: false,
    };
  }

  if (httpStatus === 429 || message.includes("rate limit")) {
    return {
      code: OPENAI_INTERNAL_ERROR_CODES.RATE_LIMITED,
      retryable: false,
    };
  }

  if (httpStatus === 400 || httpStatus === 404 || message.includes("invalid") || type.includes("invalid_request") || message.includes("model_not_found")) {
    return {
      code: OPENAI_INTERNAL_ERROR_CODES.INVALID_REQUEST,
      retryable: false,
    };
  }

  if (httpStatus >= 500 && httpStatus <= 599) {
    return {
      code: OPENAI_INTERNAL_ERROR_CODES.TRANSIENT_ERROR,
      retryable: true,
    };
  }

  return {
    code: OPENAI_INTERNAL_ERROR_CODES.INVALID_RESPONSE,
    retryable: false,
  };
}

export function classifyOpenAiAbortError() {
  return {
    code: OPENAI_INTERNAL_ERROR_CODES.TIMEOUT,
    retryable: true,
  };
}

export function classifyOpenAiNetworkError() {
  return {
    code: OPENAI_INTERNAL_ERROR_CODES.TRANSIENT_ERROR,
    retryable: true,
  };
}

export function isNonRetryableOpenAiError(code) {
  return NON_RETRYABLE_OPENAI_ERROR_CODES.has(code);
}

export function mapInternalOpenAiReason(reason, internalErrorCode) {
  if (internalErrorCode === OPENAI_INTERNAL_ERROR_CODES.TIMEOUT) return "timeout";
  if (internalErrorCode === OPENAI_INTERNAL_ERROR_CODES.OUTPUT_LIMIT_REACHED) return "output_limit";
  if (internalErrorCode === OPENAI_INTERNAL_ERROR_CODES.QUOTA_EXCEEDED) return "quota_exceeded";
  if (internalErrorCode === OPENAI_INTERNAL_ERROR_CODES.AUTH_FAILED) return "auth_failed";
  if (internalErrorCode === OPENAI_INTERNAL_ERROR_CODES.INVALID_REQUEST) return "invalid_request";
  return reason || "upstream";
}
