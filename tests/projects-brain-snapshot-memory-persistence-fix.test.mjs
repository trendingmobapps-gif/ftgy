import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import { resetGenerationLocksForTests } from "../lib/projects/brain/generation-lock.js";
import { resetBrainSchemaBootstrapForTests } from "../lib/projects/brain/schema-bootstrap.js";
import { generateProjectWorkflow } from "../lib/projects/brain/service.js";
import { PROJECT_BRAIN_FAILURE_CODES } from "../lib/projects/brain/constants.js";
import {
  PROJECT_BRAIN_INTERNAL_CODES,
  SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES,
} from "../lib/projects/brain/project-brain-internal-codes.js";
import {
  PROJECT_MEMORY_ARTIFACT_SOURCES,
  resolveProjectMemorySource,
} from "../lib/projects/brain/memory/constants.js";
import { upsertProjectMemoryFacts } from "../lib/projects/brain/memory/repository.js";
import {
  buildBrainSnapshotFromBundle,
  persistBrainSnapshotToMemory,
  serializeBrainSnapshotForMemory,
  deserializeBrainSnapshotFromMemory,
  ensureBrainSnapshotForReadyWorkflow,
} from "../lib/projects/brain/snapshot/index.js";
import { computeRoadmapEvidenceHash } from "../lib/projects/brain/openai-evidence-hash.js";

const PROJECT_ID = "c1daf2f8-4576-4dfb-9213-8b88e637fe19";
const USER_ID = "user-preview-1";
const WORKFLOW_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const MILESTONE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const STEP_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function buildReadyBundle() {
  return {
    workflow: {
      id: WORKFLOW_ID,
      project_id: PROJECT_ID,
      user_id: USER_ID,
      summary: "Plan",
      current_stage: "Start",
      complexity: "medium",
      estimated_duration_label: "4-8 saptamani",
      brain_version: "1.0.0:abc1234567890ab",
      status: "ready",
      generated_at: "2026-07-14T10:00:00.000Z",
    },
    milestones: [
      {
        id: MILESTONE_ID,
        workflow_id: WORKFLOW_ID,
        project_id: PROJECT_ID,
        user_id: USER_ID,
        title: "M1",
        description: "D1",
        position: 0,
        status: "pending",
      },
    ],
    steps: Array.from({ length: 20 }, (_, index) => ({
      id: `0000000${index + 1}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      milestone_id: MILESTONE_ID,
      workflow_id: WORKFLOW_ID,
      project_id: PROJECT_ID,
      user_id: USER_ID,
      title: `Step ${index + 1}`,
      description: "Description",
      expected_outcome: "Outcome",
      rationale: "Rationale",
      position: index,
      priority: "high",
      estimated_effort_label: "1 week",
      status: "pending",
      completed_at: null,
      tool_id: null,
      tool_slug: null,
      tool_name: null,
      tool_category_slug: null,
    })),
  };
}

function buildSnapshot(project = { id: PROJECT_ID, goal: "Launch product" }) {
  const bundle = buildReadyBundle();
  return buildBrainSnapshotFromBundle({
    project,
    bundle,
    roadmapEvidenceHash: computeRoadmapEvidenceHash({ project }),
  });
}

function createMemoryFetchMock({
  rejectSource = null,
  failReadBack = false,
  trackOpenAi = { called: false },
  counters = { workflowPosts: 0, milestonePosts: 0, stepPosts: 0, memoryPosts: 0 },
  memoryRows = [],
} = {}) {
  return async (url, init) => {
    const target = String(url);
    if (target.includes("openai.com")) {
      trackOpenAi.called = true;
      throw new Error("OpenAI should not be called");
    }
    if (target.includes("/rest/v1/project_workflows")) {
      if (init?.method === "POST") {
        counters.workflowPosts += 1;
      }
      const bundle = buildReadyBundle();
      return new Response(JSON.stringify([bundle.workflow]), { status: 200 });
    }
    if (target.includes("/rest/v1/project_milestones")) {
      if (init?.method === "POST") {
        counters.milestonePosts += 1;
      }
      return new Response(JSON.stringify(buildReadyBundle().milestones), { status: 200 });
    }
    if (target.includes("/rest/v1/project_steps")) {
      if (init?.method === "POST") {
        counters.stepPosts += 1;
      }
      return new Response(JSON.stringify(buildReadyBundle().steps), { status: 200 });
    }
    if (target.includes("/rest/v1/project_memory")) {
      if (init?.method === "POST") {
        counters.memoryPosts += 1;
        const body = JSON.parse(String(init.body || "[]"));
        const postedSource = body[0]?.source || null;
        if (rejectSource && postedSource === rejectSource) {
          return new Response(
            JSON.stringify({
              code: "23514",
              message: 'new row for relation "project_memory" violates check constraint "project_memory_source_check"',
            }),
            { status: 400 },
          );
        }
        memoryRows.push(...body);
        return new Response(
          JSON.stringify(
            body.map((row) => ({
              ...row,
              id: "mem-1",
              created_at: new Date().toISOString(),
            })),
          ),
          { status: 201 },
        );
      }
      if (failReadBack) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify(memoryRows), { status: 200 });
    }
    if (target.includes("/rest/v1/projects?") && init?.method === "PATCH") {
      return new Response(
        JSON.stringify([
          {
            id: PROJECT_ID,
            brain_status: "ready",
            brain_failure_code: null,
            active_workflow_id: WORKFLOW_ID,
          },
        ]),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };
}

async function withGlobalFetch(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("live preview snapshot persistence fix", () => {
  beforeEach(() => {
    resetGenerationLocksForTests();
    resetBrainSchemaBootstrapForTests();
  });

  it("1 uses authoritative project_memory repository contract with schema-allowed source", () => {
    assert.equal(resolveProjectMemorySource("brain_snapshot"), PROJECT_MEMORY_ARTIFACT_SOURCES.brainSnapshot);
    assert.equal(resolveProjectMemorySource("system"), "system");
    assert.equal(resolveProjectMemorySource("invalid_source"), null);
  });

  it("2 valid snapshot serializes and deserializes deterministically", () => {
    const snapshot = buildSnapshot();
    const serialized = serializeBrainSnapshotForMemory(snapshot);
    assert.equal(serialized.ok, true);
    assert.equal(typeof serialized.serialized, "string");
    assert.ok(serialized.byteLength > 0);

    const parsed = deserializeBrainSnapshotFromMemory(serialized.serialized);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.snapshot.projectId, PROJECT_ID);
    assert.equal(parsed.snapshot.stepBlueprints.length, 20);
  });

  it("3 snapshot write posts correct columns and source=system", async () => {
    let postedBody = null;
    const fetchImpl = async (url, init) => {
      if (String(url).includes("/rest/v1/project_memory") && init?.method === "POST") {
        postedBody = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify(
            postedBody.map((row) => ({
              ...row,
              id: "mem-1",
              created_at: new Date().toISOString(),
            })),
          ),
          { status: 201 },
        );
      }
      if (String(url).includes("/rest/v1/project_memory")) {
        return new Response(JSON.stringify(postedBody || []), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    await withGlobalFetch(fetchImpl, () =>
      persistBrainSnapshotToMemory({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        projectId: PROJECT_ID,
        snapshot: buildSnapshot(),
        project: { id: PROJECT_ID, goal: "Launch product" },
        bundle: buildReadyBundle(),
      }),
    );

    assert.ok(Array.isArray(postedBody));
    assert.equal(postedBody[0].source, "system");
    assert.equal(postedBody[0].memory_key, "brain_snapshot_v1");
    assert.equal(typeof postedBody[0].memory_value, "string");
    assert.equal(postedBody[0].project_id, PROJECT_ID);
    assert.equal(postedBody[0].user_id, USER_ID);
  });

  it("4 write failure exposes sanitized Supabase error metadata", async () => {
    const logs = [];
    const fetchImpl = async (url, init) => {
      if (String(url).includes("/rest/v1/project_memory") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            code: "23514",
            message: 'violates check constraint "project_memory_source_check"',
          }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const result = await withGlobalFetch(fetchImpl, () =>
      persistBrainSnapshotToMemory({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        projectId: PROJECT_ID,
        snapshot: buildSnapshot(),
        logFn: (entry) => logs.push(entry),
      }),
    );

    assert.equal(result.ok, false);
    assert.equal(result.errorCategory, SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.SCHEMA_INCOMPATIBLE);
    assert.equal(result.code, PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_SCHEMA_INCOMPATIBLE);
    const failureLog = logs.find((row) => row.event === "project_brain_snapshot_persistence_failure");
    assert.ok(failureLog);
    assert.equal(failureLog.httpStatus, 400);
    assert.equal(failureLog.supabaseErrorCode, "23514");
    assert.ok(failureLog.payloadByteLength > 0);
  });

  it("5 snapshot read-back succeeds after write", async () => {
    const fetchImpl = createMemoryFetchMock();
    const result = await withGlobalFetch(fetchImpl, () =>
      persistBrainSnapshotToMemory({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        projectId: PROJECT_ID,
        snapshot: buildSnapshot(),
        project: { id: PROJECT_ID, goal: "Launch product" },
        bundle: buildReadyBundle(),
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.readBackVerified, true);
  });

  it("6 read-back failure has distinct error", async () => {
    const fetchImpl = createMemoryFetchMock({ failReadBack: true });
    const result = await withGlobalFetch(fetchImpl, () =>
      persistBrainSnapshotToMemory({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        projectId: PROJECT_ID,
        snapshot: buildSnapshot(),
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.errorCategory, SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.READBACK_FAILED);
    assert.equal(result.code, PROJECT_BRAIN_INTERNAL_CODES.SNAPSHOT_READBACK_FAILED);
  });

  it("7 normalized roadmap exists + snapshot missing recovers with zero OpenAI", async () => {
    const trackOpenAi = { called: false };
    const fetchImpl = createMemoryFetchMock({ trackOpenAi });
    const result = await withGlobalFetch(fetchImpl, () =>
      generateProjectWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project: {
          id: PROJECT_ID,
          goal: "Launch product",
          brain_status: "failed",
          brain_failure_code: PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR,
        },
        fetchImpl,
        logFn: () => {},
      }),
    );
    assert.equal(trackOpenAi.called, false);
    assert.equal(result.ok, true);
    assert.equal(result.snapshotRecovered, true);
  });

  it("8 recovery creates no duplicate workflow rows", async () => {
    const counters = { workflowPosts: 0, milestonePosts: 0, stepPosts: 0, memoryPosts: 0 };
    const fetchImpl = createMemoryFetchMock({ counters });
    await withGlobalFetch(fetchImpl, () =>
      generateProjectWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project: {
          id: PROJECT_ID,
          goal: "Launch product",
          brain_status: "failed",
          brain_failure_code: PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR,
        },
        fetchImpl,
      }),
    );
    assert.equal(counters.workflowPosts, 0);
  });

  it("9 recovery creates no duplicate milestone rows", async () => {
    const counters = { workflowPosts: 0, milestonePosts: 0, stepPosts: 0, memoryPosts: 0 };
    const fetchImpl = createMemoryFetchMock({ counters });
    await withGlobalFetch(fetchImpl, () =>
      generateProjectWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project: {
          id: PROJECT_ID,
          goal: "Launch product",
          brain_status: "failed",
          brain_failure_code: PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR,
        },
        fetchImpl,
      }),
    );
    assert.equal(counters.milestonePosts, 0);
  });

  it("10 recovery creates no duplicate step rows", async () => {
    const counters = { workflowPosts: 0, milestonePosts: 0, stepPosts: 0, memoryPosts: 0 };
    const fetchImpl = createMemoryFetchMock({ counters });
    await withGlobalFetch(fetchImpl, () =>
      generateProjectWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project: {
          id: PROJECT_ID,
          goal: "Launch product",
          brain_status: "failed",
          brain_failure_code: PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR,
        },
        fetchImpl,
      }),
    );
    assert.equal(counters.stepPosts, 0);
  });

  it("11 recovery sets project brain status to ready", async () => {
    const fetchImpl = createMemoryFetchMock();
    const result = await withGlobalFetch(fetchImpl, () =>
      ensureBrainSnapshotForReadyWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project: {
          id: PROJECT_ID,
          goal: "Launch product",
          brain_status: "failed",
          brain_failure_code: PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR,
        },
        bundle: buildReadyBundle(),
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.project.brain_status, "ready");
  });

  it("12 malformed snapshot is reconstructed without OpenAI", async () => {
    const fetchImpl = createMemoryFetchMock();
    const stale = buildSnapshot();
    stale.workflow.workflowId = "00000000-0000-4000-8000-000000000099";
    const result = await withGlobalFetch(fetchImpl, () =>
      ensureBrainSnapshotForReadyWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project: { id: PROJECT_ID, goal: "Launch product", brain_status: "failed" },
        bundle: buildReadyBundle(),
        existingSnapshot: stale,
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.recovered, true);
    assert.equal(result.snapshot.workflow.workflowId, WORKFLOW_ID);
  });

  it("13 project_memory schema incompatibility detected explicitly for invalid source", async () => {
    const result = await upsertProjectMemoryFacts({
      baseUrl: "https://example.supabase.co",
      secretKey: "secret",
      userId: USER_ID,
      projectId: PROJECT_ID,
      facts: { test_key: "value" },
      source: "totally_invalid_source",
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCategory, SNAPSHOT_PERSISTENCE_ERROR_CATEGORIES.SCHEMA_INCOMPATIBLE);
    assert.equal(result.writeAttempted, false);
  });

  it("14 legacy brain_snapshot source alias maps to schema-allowed system source", async () => {
    let postedSource = null;
    const fetchImpl = async (url, init) => {
      if (String(url).includes("/rest/v1/project_memory") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        postedSource = body[0]?.source || null;
        return new Response(JSON.stringify(body.map((row) => ({ ...row, id: "mem-1" }))), {
          status: 201,
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    await withGlobalFetch(fetchImpl, () =>
      upsertProjectMemoryFacts({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        projectId: PROJECT_ID,
        facts: { brain_snapshot_v1: "{}" },
        source: "brain_snapshot",
      }),
    );
    assert.equal(postedSource, "system");
  });
});
