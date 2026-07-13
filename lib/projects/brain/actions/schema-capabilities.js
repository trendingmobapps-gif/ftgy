const BASE_ACTION_SELECT_COLUMNS = [
  "id",
  "step_id",
  "project_id",
  "workflow_id",
  "user_id",
  "status",
  "capability_type",
  "capability_ref",
  "title",
  "explanation",
  "why_it_matters",
  "expected_result",
  "prepared_prompt",
  "prepared_input",
  "missing_fields",
  "estimated_effort_label",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at",
].join(",");

const SESSION_ACTION_SELECT_COLUMNS = [
  "session_status",
  "conversation",
  "collected_input",
  "pending_question",
  "pending_result_id",
].join(",");

const BASE_ACTION_RESULT_SELECT_COLUMNS = [
  "id",
  "action_id",
  "step_id",
  "project_id",
  "user_id",
  "result_type",
  "title",
  "preview",
  "content",
  "created_at",
].join(",");

let cachedCapabilities = null;

async function probeSelect({ baseUrl, secretKey, table, column }) {
  const resp = await fetch(`${baseUrl}/rest/v1/${table}?select=${encodeURIComponent(column)}&limit=0`, {
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
    },
  });

  return resp.status === 200;
}

export function resetActionSchemaCapabilitiesForTests() {
  cachedCapabilities = null;
}

export async function getActionSchemaCapabilities({ baseUrl, secretKey, forceRefresh = false }) {
  if (!forceRefresh && cachedCapabilities) {
    return cachedCapabilities;
  }

  const [sessionColumns, acceptanceStatusColumn, adaptiveTables] = await Promise.all([
    probeSelect({ baseUrl, secretKey, table: "project_step_actions", column: "session_status" }),
    probeSelect({ baseUrl, secretKey, table: "project_action_results", column: "acceptance_status" }),
    probeSelect({ baseUrl, secretKey, table: "project_resources", column: "id" }),
  ]);

  cachedCapabilities = {
    sessionColumns,
    acceptanceStatusColumn,
    adaptiveTables,
    memoryTable: adaptiveTables,
    actionSelectColumns: sessionColumns
      ? `${BASE_ACTION_SELECT_COLUMNS},${SESSION_ACTION_SELECT_COLUMNS}`
      : BASE_ACTION_SELECT_COLUMNS,
    actionResultSelectColumns: acceptanceStatusColumn
      ? `${BASE_ACTION_RESULT_SELECT_COLUMNS},acceptance_status`
      : BASE_ACTION_RESULT_SELECT_COLUMNS,
  };

  return cachedCapabilities;
}

export function getCachedActionSchemaCapabilities() {
  return cachedCapabilities;
}
