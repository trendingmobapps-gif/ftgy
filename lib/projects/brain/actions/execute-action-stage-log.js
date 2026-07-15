const LOG_PREFIX = "[projects-execute-action]";

export function assertValidExecuteStage(stage) {
  if (typeof stage !== "string" || !stage.trim()) {
    throw new TypeError(`execute-action stage must be a non-empty string, received ${typeof stage}`);
  }
  if (stage.includes("[object Object]")) {
    throw new TypeError("execute-action stage must not serialize as [object Object]");
  }
}

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
  assertValidExecuteStage(stage);
  console.log(`${LOG_PREFIX} stage=${stage}`, context);
}

export function logExecuteFailure(stage, error, context = {}) {
  assertValidExecuteStage(stage);
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

/**
 * Adapts structured OpenAI usage payloads to execute-action stage logging.
 * Prevents stage=[object Object] when logOpenAiUsageEvent passes an object to logExecuteStage.
 */
export function createExecuteStageUsageLogger(stageLog) {
  if (typeof stageLog !== "function") {
    return () => {};
  }

  return (payload = {}) => {
    if (!payload || typeof payload !== "object") {
      stageLog("openai_usage_invalid_payload", { payloadType: typeof payload });
      return;
    }

    const event = payload.event || "project_openai_usage";
    if (event === "project_openai_usage_warning") {
      stageLog("openai_usage_warning", payload);
      return;
    }

    stageLog("openai_usage", payload);
  };
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
