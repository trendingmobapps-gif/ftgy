const LOG_PREFIX = "[projects-prepare-action]";

function extractDatabaseError(error) {
  if (!error || typeof error !== "object") {
    return {
      databaseCode: null,
      databaseDetails: null,
      databaseHint: null,
    };
  }

  return {
    databaseCode: error.code || error.databaseCode || null,
    databaseDetails: error.details || error.databaseDetails || null,
    databaseHint: error.hint || error.databaseHint || null,
  };
}

export function logPrepareStage(stage, context = {}) {
  console.log(`${LOG_PREFIX} stage=${stage}`, context);
}

export function logPrepareFailure(stage, error, context = {}) {
  const db = extractDatabaseError(error);
  const payload = {
    stage,
    errorName: error?.name || "Error",
    errorMessage: error?.message || String(error),
    databaseCode: db.databaseCode,
    databaseDetails: db.databaseDetails,
    databaseHint: db.databaseHint,
    stack: typeof error?.stack === "string" ? error.stack : null,
    ...context,
  };

  console.error(`${LOG_PREFIX} failure`, payload);
}

export function logPrepareWarning(stage, message, context = {}) {
  console.warn(`${LOG_PREFIX} warning stage=${stage} message=${message}`, context);
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
