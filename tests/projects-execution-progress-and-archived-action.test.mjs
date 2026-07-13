import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  mapActionServiceError,
  validateExecutionProgressRequest,
} from "../lib/projects/brain/actions/validation.js";
import {
  normalizeExecutionProgress,
  validateExecutionProgressShape,
} from "../lib/projects/brain/actions/execution-progress.js";
import { persistSessionStatus } from "../lib/projects/brain/actions/session-status-store.js";
import { prepareProjectAction, saveExecutionProgress } from "../lib/projects/brain/actions/service.js";
import { resetActionSchemaCapabilitiesForTests } from "../lib/projects/brain/actions/schema-capabilities.js";
import {
  shouldReplaceTerminalAction,
  shouldResumeExistingAction,
  buildActionArchiveSnapshot,
} from "../lib/projects/brain/actions/action-lifecycle.js";

const PROJECT_ID = "6713ef1c-d81c-41d2-9539-608aeca149cb";
const STEP_ID = "dcfc28bf-68b7-4509-b47b-c5d68bc9a116";
const ACTION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKFLOW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MILESTONE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildProject(overrides = {}) {
  return {
    id: PROJECT_ID,
    user_id: USER_ID,
    name: "Promovare platformă iterai.ro",
    goal: "Creștere utilizatori",
    summary: "Plan marketing",
    description: null,
    category_slug: "business",
    status: "active",
    brain_status: "ready",
    ...overrides,
  };
}

function buildBundle(stepStatus = "pending") {
  return {
    workflow: {
      id: WORKFLOW_ID,
      project_id: PROJECT_ID,
      status: "ready",
      summary: "Plan marketing",
      current_stage: "Strategie",
      complexity: "medium",
    },
    milestones: [
      {
        id: MILESTONE_ID,
        workflow_id: WORKFLOW_ID,
        project_id: PROJECT_ID,
        title: "Strategie",
        position: 0,
      },
    ],
    steps: [
      {
        id: STEP_ID,
        project_id: PROJECT_ID,
        milestone_id: MILESTONE_ID,
        workflow_id: WORKFLOW_ID,
        title: "Elaborare strategie de marketing",
        description: "Definește canalele.",
        expected_outcome: "Strategie confirmată",
        rationale: "Canalele potrivite accelerează promovarea.",
        estimated_effort_label: "20 min",
        status: stepStatus,
        position: 0,
        tool_id: null,
      },
    ],
  };
}

function createFetch(bundle, { existingAction = null, patchLog = [] } = {}) {
  return async (url, init = {}) => {
    const method = init.method || "GET";
    const parsed = new URL(String(url));

    if (parsed.pathname.endsWith("/project_step_actions") && parsed.search.includes("select=session_status")) {
      return jsonResponse(200, []);
    }

    if (parsed.pathname.endsWith("/project_action_results") && parsed.search.includes("acceptance_status")) {
      return jsonResponse(200, []);
    }

    if (parsed.pathname.endsWith("/project_resources")) {
      return jsonResponse(200, []);
    }

    if (parsed.pathname.endsWith("/project_memory")) {
      return jsonResponse(200, []);
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
      return jsonResponse(200, existingAction ? [existingAction] : []);
    }

    if (parsed.pathname.endsWith("/project_step_actions") && method === "PATCH") {
      const body = JSON.parse(init.body || "{}");
      patchLog.push(body);
      return jsonResponse(200, [
        {
          ...(existingAction || { id: ACTION_ID, step_id: STEP_ID, project_id: PROJECT_ID }),
          ...body,
        },
      ]);
    }

    if (parsed.pathname.endsWith("/project_step_actions") && method === "POST") {
      const body = JSON.parse(init.body || "{}");
      return jsonResponse(201, [{ id: ACTION_ID, ...body }]);
    }

    if (parsed.pathname.endsWith("/project_action_results")) {
      return jsonResponse(200, []);
    }

    return jsonResponse(404, { message: `Unhandled ${method} ${parsed.pathname}` });
  };
}

describe("projects execution progress and archived action fixes", () => {
  let originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetActionSchemaCapabilitiesForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exports validateExecutionProgressRequest from validation module", async () => {
    const mod = await import("../lib/projects/brain/actions/validation.js");
    assert.equal(typeof mod.validateExecutionProgressRequest, "function");
    assert.ok(Object.keys(mod).includes("validateExecutionProgressRequest"));
  });

  it("imports execution progress API handler successfully", async () => {
    const mod = await import("../api/projects-execution-progress.js");
    assert.equal(typeof mod.default, "function");
  });

  it("normalizes choice and checklist field aliases", () => {
    const choice = normalizeExecutionProgress({
      type: "choice",
      selectedChoiceIds: ["meta_ads"],
    });
    assert.equal(choice.selectedChoice, "meta_ads");

    const checklist = normalizeExecutionProgress({
      type: "checklist",
      checklistState: { a: true },
    });
    assert.deepEqual(checklist.checklistChecked, { a: true });
  });

  it("rejects invalid progress type with validation fields", () => {
    const result = validateExecutionProgressRequest({
      projectId: PROJECT_ID,
      stepId: STEP_ID,
      actionId: ACTION_ID,
      progress: { type: "unknown_mode" },
    });
    assert.equal(result.ok, false);
    assert.ok(result.fields.type);
  });

  it("maps ready_to_finalize to accepted for DB persistence", () => {
    assert.equal(persistSessionStatus("ready_to_finalize"), "accepted");
    assert.equal(persistSessionStatus("collecting"), "collecting");
  });

  it("saveExecutionProgress persists interactive progress without invalid session_status", async () => {
    const patchLog = [];
    const existingAction = {
      id: ACTION_ID,
      step_id: STEP_ID,
      project_id: PROJECT_ID,
      workflow_id: WORKFLOW_ID,
      user_id: USER_ID,
      status: "in_progress",
      session_status: "collecting",
      capability_type: "project_brain",
      title: "Elaborare strategie de marketing",
      explanation: "Definește canalele.",
      why_it_matters: "Important",
      expected_result: "Strategie confirmată",
      prepared_prompt: "prompt",
      prepared_input: {
        _executionPlan: {
          mode: "choice",
          choices: [
            { id: "a", title: "A", value: "a" },
            { id: "b", title: "B", value: "b" },
          ],
          completionCriteria: { requireGeneratedResult: true, requireUserAcceptance: true },
        },
      },
      missing_fields: [],
      collected_input: {},
      conversation: [],
      pending_question: null,
      estimated_effort_label: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    globalThis.fetch = createFetch(buildBundle(), { existingAction, patchLog });

    const result = await saveExecutionProgress({
      baseUrl: "https://example.supabase.co",
      secretKey: "service-key",
      userId: USER_ID,
      project: buildProject(),
      projectId: PROJECT_ID,
      stepId: STEP_ID,
      actionId: ACTION_ID,
      progress: { type: "choice", selectedChoice: "a" },
    });

    assert.equal(result.ok, true);
    assert.equal(patchLog.length, 1);
    assert.equal(patchLog[0].session_status, "collecting");
    assert.equal(patchLog[0].collected_input.interactive.selectedChoice, "a");
  });

  it("replaces terminal action on pending step during prepare", async () => {
    const patchLog = [];
    const existingAction = {
      id: ACTION_ID,
      step_id: STEP_ID,
      project_id: PROJECT_ID,
      workflow_id: WORKFLOW_ID,
      user_id: USER_ID,
      status: "completed",
      session_status: "accepted",
      capability_type: "project_brain",
      title: "Elaborare strategie de marketing",
      explanation: "Definește canalele.",
      why_it_matters: "Important",
      expected_result: "Strategie confirmată",
      prepared_prompt: "prompt",
      prepared_input: { old: true },
      missing_fields: [],
      collected_input: { interactive: { type: "choice", selectedChoice: "a" } },
      conversation: [{ role: "assistant", type: "opening", content: "Salut" }],
      pending_question: null,
      estimated_effort_label: null,
      completed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    assert.equal(shouldReplaceTerminalAction({ step: buildBundle().steps[0], action: existingAction }), true);
    assert.equal(shouldResumeExistingAction({ step: buildBundle().steps[0], action: existingAction }), false);

    globalThis.fetch = createFetch(buildBundle("pending"), { existingAction, patchLog });

    const result = await prepareProjectAction({
      baseUrl: "https://example.supabase.co",
      secretKey: "service-key",
      userId: USER_ID,
      project: buildProject(),
      projectId: PROJECT_ID,
      stepId: STEP_ID,
    });

    assert.equal(result.ok, true);
    assert.ok(patchLog.length >= 1);
    const replacePatch = patchLog.find((patch) => patch.status === "prepared");
    assert.ok(replacePatch);
    assert.ok(Array.isArray(replacePatch.prepared_input?._actionHistory));
    assert.equal(replacePatch.conversation.length >= 1, true);
  });

  it("returns read-only success for completed step", async () => {
    const existingAction = {
      id: ACTION_ID,
      step_id: STEP_ID,
      project_id: PROJECT_ID,
      workflow_id: WORKFLOW_ID,
      user_id: USER_ID,
      status: "completed",
      session_status: "accepted",
      capability_type: "project_brain",
      title: "Elaborare strategie de marketing",
      explanation: "Definește canalele.",
      why_it_matters: "Important",
      expected_result: "Strategie confirmată",
      prepared_prompt: "prompt",
      prepared_input: {},
      missing_fields: [],
      collected_input: {},
      conversation: [],
      pending_question: null,
      estimated_effort_label: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    globalThis.fetch = createFetch(buildBundle("completed"), { existingAction });

    const result = await prepareProjectAction({
      baseUrl: "https://example.supabase.co",
      secretKey: "service-key",
      userId: USER_ID,
      project: buildProject(),
      projectId: PROJECT_ID,
      stepId: STEP_ID,
    });

    assert.equal(result.ok, true);
    assert.equal(result.readOnly, true);
    assert.equal(result.code, "STEP_COMPLETED_READONLY");
    const mapped = mapActionServiceError("STEP_COMPLETED_READONLY");
    assert.equal(mapped.status, 200);
  });

  it("archived project remains blocked with ARCHIVED_READONLY", async () => {
    globalThis.fetch = createFetch(buildBundle("pending"));

    const result = await prepareProjectAction({
      baseUrl: "https://example.supabase.co",
      secretKey: "service-key",
      userId: USER_ID,
      project: buildProject({ status: "archived" }),
      projectId: PROJECT_ID,
      stepId: STEP_ID,
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "ARCHIVED_READONLY");
  });

  it("validateExecutionProgressShape accepts recommendation_selection progress", () => {
    const shape = validateExecutionProgressShape({
      type: "recommendation_selection",
      selectedRecommendations: ["tiktok_ads"],
      confirmed: true,
    });
    assert.equal(shape.ok, true);
  });

  it("buildActionArchiveSnapshot preserves history payload", () => {
    const snapshot = buildActionArchiveSnapshot({
      id: ACTION_ID,
      status: "completed",
      prepared_input: { plan: 1 },
      collected_input: { interactive: { type: "choice" } },
      conversation: [{ role: "assistant", type: "opening", content: "Hi" }],
    });
    assert.equal(snapshot.actionId, ACTION_ID);
    assert.equal(snapshot.status, "completed");
    assert.ok(snapshot.archivedAt);
  });
});
