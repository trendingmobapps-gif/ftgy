const LOG_PREFIX = "[projects-execute-action]";

function safeError(error) {
  if (!error) return null;
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    code: error.code || null,
    httpStatus: error.httpStatus ?? error.status ?? null,
    providerStatus: error.providerStatus ?? null,
    stack: typeof error.stack === "string" ? error.stack.split("\n").slice(0, 8).join("\n") : null,
  };
}

export function logExecuteStage(stage, context = {}) {
  console.log(`${LOG_PREFIX} stage=${stage}`, context);
}

export function logExecuteFailure(stage, error, context = {}) {
  const payload = {
    stage,
    errorName: error?.name || "Error",
    errorMessage: error?.message || String(error),
    errorCode: error?.code || context.errorCode || null,
    providerHttpStatus: context.providerHttpStatus ?? error?.httpStatus ?? null,
    supabaseCode: context.supabaseCode || error?.supabaseCode || null,
    supabaseDetails: context.supabaseDetails || error?.supabaseDetails || null,
    supabaseHint: context.supabaseHint || error?.supabaseHint || null,
    stack: typeof error?.stack === "string" ? error.stack.split("\n").slice(0, 8).join("\n") : null,
    ...context,
  };

  console.error(`${LOG_PREFIX} failure`, payload);
}

export function extractSupabaseErrorPayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  return {
    code: data.code || null,
    message: data.message || null,
    details: data.details || null,
    hint: data.hint || null,
  };
}

export function safeAcceptedInputMetadata(acceptedInput) {
  if (!acceptedInput || typeof acceptedInput !== "object" || Array.isArray(acceptedInput)) {
    return {
      acceptedInputPresent: false,
      acceptedInputKeys: [],
      acceptedInputType: typeof acceptedInput,
    };
  }

  return {
    acceptedInputPresent: true,
    acceptedInputKeys: Object.keys(acceptedInput).slice(0, 24),
    acceptedInputType: "object",
  };
}
