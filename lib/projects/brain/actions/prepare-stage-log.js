const LOG_PREFIX = "[projects-prepare-action]";

export function assertValidPrepareStage(stage) {
  if (typeof stage !== "string" || !stage.trim()) {
    throw new TypeError(`prepare-action stage must be a non-empty string, received ${typeof stage}`);
  }
  if (stage.includes("[object Object]")) {
    throw new TypeError("prepare-action stage must not serialize as [object Object]");
  }
}

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
  assertValidPrepareStage(stage);
  console.log(`${LOG_PREFIX} stage=${stage}`, context);
}

export function logPrepareFailure(stage, error, context = {}) {
  assertValidPrepareStage(stage);
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
  assertValidPrepareStage(stage);
  console.warn(`${LOG_PREFIX} warning stage=${stage} message=${message}`, context);
}

/**
 * Adapts structured observability payloads to prepare-action stage logging.
 * Used when logOpenAiUsageEvent, logBrainSnapshotEvent, or similar helpers
 * call logFn(payload) instead of logPrepareStage(stage, context).
 */
export function createPrepareStageUsageLogger(stageLog) {
  if (typeof stageLog !== "function") {
    return () => {};
  }

  return (payload = {}, context = undefined) => {
    if (typeof payload === "string") {
      stageLog(payload, context && typeof context === "object" ? context : {});
      return;
    }

    if (!payload || typeof payload !== "object") {
      stageLog("prepare_usage_invalid_payload", { payloadType: typeof payload });
      return;
    }

    const event = payload.event || "project_openai_usage";
    switch (event) {
      case "project_openai_usage_warning":
        stageLog("openai_usage_warning", payload);
        return;
      case "project_brain_snapshot":
        stageLog("brain_snapshot", payload);
        return;
      case "project_brain_snapshot_warning":
        stageLog("brain_snapshot_warning", payload);
        return;
      case "project_brain_snapshot_persistence_failure":
        stageLog("brain_snapshot_persistence_failure", payload);
        return;
      case "project_openai_usage":
      default:
        stageLog("openai_usage", payload);
    }
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
