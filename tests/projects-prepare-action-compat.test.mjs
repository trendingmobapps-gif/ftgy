import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { prepareProjectAction } from "../lib/projects/brain/actions/service.js";
import { resetActionSchemaCapabilitiesForTests } from "../lib/projects/brain/actions/schema-capabilities.js";
import {
  hasPersistedConversation,
  normalizeActionRow,
  buildInMemorySessionFromState,
} from "../lib/projects/brain/actions/normalize.js";

const PROJECT_ID = "6713ef1c-d81c-41d2-9539-608aeca149cb";
const STEP_ID = "dcfc28bf-68b7-4509-b47b-c5d68bc9a116";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKFLOW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MILESTONE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildProject() {
  return {
    id: PROJECT_ID,
    user_id: USER_ID,
    name: "Engleză pentru carieră",
    goal: "Vreau să învăț engleza pentru job",
    summary: "Plan de învățare",
    description: null,
    category_slug: "studii",
    status: "active",
    brain_status: "ready",
  };
}

function buildBundle() {
  return {
    workflow: {
      id: WORKFLOW_ID,
      project_id: PROJECT_ID,
      status: "ready",
      summary: "Plan de învățare",
      current_stage: "Evaluare",
      complexity: "medium",
    },
    milestones: [
      {
        id: MILESTONE_ID,
        workflow_id: WORKFLOW_ID,
        project_id: PROJECT_ID,
        title: "Evaluare inițială",
        position: 0,
      },
    ],
    steps: [
      {
        id: STEP_ID,
        project_id: PROJECT_ID,
        milestone_id: MILESTONE_ID,
        workflow_id: WORKFLOW_ID,
        title: "Evaluează nivelul actual de engleză",
        description: "Determini punctul de plecare.",
        expected_outcome: "O evaluare orientativă a nivelului.",
        rationale: "Fără nivel clar, planul este ineficient.",
        estimated_effort_label: "15 min",
        status: "pending",
        position: 0,
        tool_id: null,
      },
    ],
  };
}

function createLegacySchemaFetch(bundle) {
  return async (url, init = {}) => {
    const method = init.method || "GET";
    const parsed = new URL(String(url));

    if (parsed.pathname.endsWith("/project_step_actions") && parsed.search.includes("select=session_status")) {
      return jsonResponse(400, {
        code: "42703",
        message: 'column "session_status" does not exist',
      });
    }

    if (parsed.pathname.endsWith("/project_action_results") && parsed.search.includes("acceptance_status")) {
      return jsonResponse(400, {
        code: "42703",
        message: 'column "acceptance_status" does not exist',
      });
    }

    if (parsed.pathname.endsWith("/project_resources")) {
      return jsonResponse(404, {
        code: "42P01",
        message: 'relation "public.project_resources" does not exist',
      });
    }

    if (parsed.pathname.endsWith("/project_memory")) {
      return jsonResponse(404, {
        code: "42P01",
        message: 'relation "public.project_memory" does not exist',
      });
    }

    if (parsed.pathname.endsWith("/project_workflows")) {
      return jsonResponse(200, [bundle.workflow]);
    }

    if (parsed.pathname.endsWith("/project_milestones")) {
      return jsonResponse(200, bundle.milestones);
    }

    if (parsed.pathname.endsWith("/project_steps")) {
      return jsonResponse(200, bundle.steps);
    }

    if (parsed.pathname.endsWith("/project_step_actions") && method === "GET") {
      return jsonResponse(200, []);
    }

    if (parsed.pathname.endsWith("/project_step_actions") && method === "POST") {
      const body = JSON.parse(init.body || "{}");
      return jsonResponse(201, [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          ...body,
        },
      ]);
    }

    if (parsed.pathname.endsWith("/project_action_results")) {
      return jsonResponse(200, []);
    }

    return jsonResponse(404, { message: `Unhandled ${method} ${parsed.pathname}` });
  };
}

describe("prepare action compatibility", () => {
  let originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetActionSchemaCapabilitiesForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("normalizes legacy action JSON fields", () => {
    const row = normalizeActionRow({
      id: "action-1",
      conversation: "[]",
      collected_input: null,
      missing_fields: null,
      pending_question: { key: "nivel", label: "Nivel" },
    });

    assert.deepEqual(row.conversation, []);
    assert.deepEqual(row.collected_input, {});
    assert.deepEqual(row.missing_fields, []);
    assert.equal(row.pending_question.label, "Nivel");
    assert.equal(hasPersistedConversation(row), false);
  });

  it("prepares an old project without session/resource/memory schema", async () => {
    const bundle = buildBundle();
    globalThis.fetch = createLegacySchemaFetch(bundle);

    const result = await prepareProjectAction({
      baseUrl: "https://example.supabase.co",
      secretKey: "service-role-key",
      userId: USER_ID,
      project: buildProject(),
      projectId: PROJECT_ID,
      stepId: STEP_ID,
    });

    assert.equal(result.ok, true);
    assert.ok(result.action);
    assert.ok(result.session);
    assert.ok(result.executionDefinition);
    assert.equal(result.executionDefinition.mode, "assessment");
    assert.ok(result.executionDefinition.primaryActionLabel);
    assert.ok(result.session.messages.length >= 2);
  });

  it("builds in-memory session when session columns are unavailable", () => {
    const session = buildInMemorySessionFromState(
      {
        phase: "collecting",
        messages: [{ role: "assistant", type: "question", content: "Care este nivelul?" }],
        pendingQuestion: { key: "nivel", label: "Nivel" },
      },
      { id: "action-1", title: "Evaluează nivelul actual de engleză", expected_result: "Evaluare" },
      { expectedResult: "Evaluare", title: "Evaluează nivelul actual de engleză" },
    );

    assert.equal(session.phase, "collecting");
    assert.equal(session.canRespond, true);
    assert.equal(session.messages.length, 1);
  });
});
