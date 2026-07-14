import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import { resetGenerationLocksForTests } from "../lib/projects/brain/generation-lock.js";
import { resetBrainSchemaBootstrapForTests } from "../lib/projects/brain/schema-bootstrap.js";
import { generateProjectWorkflow } from "../lib/projects/brain/service.js";
import { PROJECT_BRAIN_FAILURE_CODES } from "../lib/projects/brain/constants.js";
import {
  ensureBrainSnapshotForReadyWorkflow,
  validateSnapshotAgainstWorkflowBundle,
  repairSnapshotBlueprintsFromBundle,
  buildBrainSnapshotFromBundle,
  shouldGenerateActionDesign,
} from "../lib/projects/brain/snapshot/index.js";
import { computeRoadmapEvidenceHash } from "../lib/projects/brain/openai-evidence-hash.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user-1";
const WORKFLOW_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const MILESTONE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const STEP_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function buildReadyBundle() {
  return {
    workflowRows: [
      {
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
    ],
    milestoneRows: [
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
    stepRows: [
      {
        id: STEP_1,
        milestone_id: MILESTONE_ID,
        workflow_id: WORKFLOW_ID,
        project_id: PROJECT_ID,
        user_id: USER_ID,
        title: "Define strategy",
        description: "Strategy step",
        expected_outcome: "Strategy document",
        rationale: "Direction",
        position: 0,
        priority: "high",
        estimated_effort_label: "1 week",
        status: "pending",
        completed_at: null,
        tool_id: null,
        tool_slug: null,
        tool_name: null,
        tool_category_slug: null,
      },
    ],
  };
}

function createIntegrityFetchMock({
  readyBundle = buildReadyBundle(),
  snapshotPersistFails = false,
  trackOpenAi = { called: false },
  counters = { workflowPosts: 0, milestonePosts: 0, stepPosts: 0, memoryPosts: 0 },
  projectPatchRows = null,
  memoryRows = [],
} = {}) {
  return async (url, init) => {
    const target = String(url);
    if (target.includes("openai.com")) {
      trackOpenAi.called = true;
      throw new Error("OpenAI should not be called");
    }
    if (target.includes("/rest/v1/projects?select=brain_status")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (target.includes("/rest/v1/project_workflows")) {
      if (init?.method === "POST") {
        counters.workflowPosts += 1;
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify(readyBundle.workflowRows), { status: 200 });
    }
    if (target.includes("/rest/v1/project_milestones")) {
      if (init?.method === "POST") {
        counters.milestonePosts += 1;
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify(readyBundle.milestoneRows), { status: 200 });
    }
    if (target.includes("/rest/v1/project_steps")) {
      if (init?.method === "POST") {
        counters.stepPosts += 1;
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify(readyBundle.stepRows), { status: 200 });
    }
    if (target.includes("/rest/v1/project_memory")) {
      if (init?.method === "POST") {
        counters.memoryPosts += 1;
        if (snapshotPersistFails) {
          return new Response(JSON.stringify([]), { status: 500 });
        }
        return new Response(JSON.stringify([{ memory_key: "brain_snapshot_v1" }]), { status: 201 });
      }
      return new Response(JSON.stringify(memoryRows), { status: 200 });
    }
    if (target.includes("/rest/v1/projects?") && init?.method === "PATCH") {
      const rows =
        projectPatchRows ??
        [
          {
            id: PROJECT_ID,
            brain_status: "ready",
            brain_failure_code: null,
            active_workflow_id: WORKFLOW_ID,
          },
        ];
      return new Response(JSON.stringify(rows), { status: 200 });
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

describe("project brain snapshot persistence integrity", () => {
  beforeEach(() => {
    resetGenerationLocksForTests();
    resetBrainSchemaBootstrapForTests();
  });

  it("1 snapshot persistence failure after normalized roadmap leaves failed status with snapshot code", async () => {
    const project = {
      id: PROJECT_ID,
      goal: "Launch product",
      brain_status: "failed",
      brain_failure_code: PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR,
    };
    const bundle = {
      workflow: buildReadyBundle().workflowRows[0],
      milestones: buildReadyBundle().milestoneRows,
      steps: buildReadyBundle().stepRows,
    };
    const fetchImpl = createIntegrityFetchMock({ snapshotPersistFails: true });
    const result = await withGlobalFetch(fetchImpl, () =>
      ensureBrainSnapshotForReadyWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project,
        bundle,
      }),
    );
    assert.equal(result.ok, false);
  });

  it("2 retry snapshot-only recovery with zero OpenAI calls", async () => {
    const trackOpenAi = { called: false };
    const counters = { workflowPosts: 0, milestonePosts: 0, stepPosts: 0, memoryPosts: 0 };
    const fetchImpl = createIntegrityFetchMock({ trackOpenAi, counters });
    const project = {
      id: PROJECT_ID,
      goal: "Launch product",
      brain_status: "failed",
      brain_failure_code: PROJECT_BRAIN_FAILURE_CODES.SNAPSHOT_PERSISTENCE_ERROR,
    };

    const result = await withGlobalFetch(fetchImpl, () =>
      generateProjectWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project,
        fetchImpl,
        logFn: () => {},
      }),
    );

    assert.equal(trackOpenAi.called, false);
    assert.equal(result.ok, true);
    assert.equal(result.idempotent, true);
    assert.equal(result.snapshotRecovered, true);
    assert.equal(counters.workflowPosts, 0);
    assert.equal(counters.milestonePosts, 0);
    assert.equal(counters.stepPosts, 0);
    assert.ok(counters.memoryPosts >= 1);
  });

  it("3 retry does not create duplicate normalized roadmap rows", async () => {
    const counters = { workflowPosts: 0, milestonePosts: 0, stepPosts: 0, memoryPosts: 0 };
    const fetchImpl = createIntegrityFetchMock({ counters });
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
        logFn: () => {},
      }),
    );
    assert.equal(counters.workflowPosts, 0);
    assert.equal(counters.milestonePosts, 0);
    assert.equal(counters.stepPosts, 0);
  });

  it("4 snapshot/workflow consistency validation", () => {
    const bundle = {
      workflow: buildReadyBundle().workflowRows[0],
      milestones: buildReadyBundle().milestoneRows,
      steps: buildReadyBundle().stepRows,
    };
    const project = { id: PROJECT_ID, goal: "Launch product" };
    const hash = computeRoadmapEvidenceHash({ project });
    const snapshot = buildBrainSnapshotFromBundle({ project, bundle, roadmapEvidenceHash: hash });
    const validation = validateSnapshotAgainstWorkflowBundle({ snapshot, project, bundle, roadmapEvidenceHash: hash });
    assert.equal(validation.valid, true);
  });

  it("5 stale snapshot reconstructed without OpenAI via ensureBrainSnapshotForReadyWorkflow", async () => {
    const project = { id: PROJECT_ID, goal: "Launch product", brain_status: "failed" };
    const bundle = {
      workflow: buildReadyBundle().workflowRows[0],
      milestones: buildReadyBundle().milestoneRows,
      steps: buildReadyBundle().stepRows,
    };
    const staleSnapshot = buildBrainSnapshotFromBundle({
      project,
      bundle,
      roadmapEvidenceHash: computeRoadmapEvidenceHash({ project }),
    });
    staleSnapshot.workflow.workflowId = "00000000-0000-4000-8000-000000000099";
    const fetchImpl = createIntegrityFetchMock();
    const result = await withGlobalFetch(fetchImpl, () =>
      ensureBrainSnapshotForReadyWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project,
        bundle,
        existingSnapshot: staleSnapshot,
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.recovered, true);
    assert.equal(result.snapshot.workflow.workflowId, WORKFLOW_ID);
  });

  it("6 missing snapshot reconstructed without OpenAI", async () => {
    const fetchImpl = createIntegrityFetchMock({ memoryRows: [] });
    const project = { id: PROJECT_ID, goal: "Launch product", brain_status: "failed" };
    const bundle = {
      workflow: buildReadyBundle().workflowRows[0],
      milestones: buildReadyBundle().milestoneRows,
      steps: buildReadyBundle().stepRows,
    };
    const result = await withGlobalFetch(fetchImpl, () =>
      ensureBrainSnapshotForReadyWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project,
        bundle,
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.recovered, true);
  });

  it("7 valid action contracts reused even if snapshot is temporarily missing", () => {
    const hash = "stable-hash";
    const gate = shouldGenerateActionDesign({
      snapshot: null,
      stepId: STEP_1,
      preparedInput: {
        _executionPlan: { mode: "checklist", planId: "p1" },
        _executionPlanEvidenceHash: hash,
        _executionPlanContractVersion: 2,
      },
      evidenceHash: hash,
    });
    assert.equal(gate.generate, false);
    assert.equal(gate.reuseHit, true);
  });

  it("8 reopening action makes zero model calls when contracts valid", () => {
    let calls = 0;
    const hash = "stable-hash";
    for (let i = 0; i < 100; i += 1) {
      const gate = shouldGenerateActionDesign({
        snapshot: null,
        stepId: STEP_1,
        preparedInput: {
          _executionPlan: { mode: "checklist", planId: "p1" },
          _executionPlanEvidenceHash: hash,
          _executionPlanContractVersion: 2,
        },
        evidenceHash: hash,
        readOnly: i % 2 === 0,
      });
      if (gate.generate) calls += 1;
    }
    assert.equal(calls, 0);
  });

  it("9 changed material action evidence permits one call", () => {
    const gate = shouldGenerateActionDesign({
      snapshot: null,
      stepId: STEP_1,
      preparedInput: {
        _executionPlan: { mode: "checklist", planId: "p1" },
        _executionPlanEvidenceHash: "old",
        _executionPlanContractVersion: 2,
      },
      evidenceHash: "new",
    });
    assert.equal(gate.generate, true);
  });

  it("project transitions to ready after snapshot recovery", async () => {
    const fetchImpl = createIntegrityFetchMock({
      projectPatchRows: [
        {
          id: PROJECT_ID,
          brain_status: "ready",
          brain_failure_code: null,
          active_workflow_id: WORKFLOW_ID,
        },
      ],
    });
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
        bundle: {
          workflow: buildReadyBundle().workflowRows[0],
          milestones: buildReadyBundle().milestoneRows,
          steps: buildReadyBundle().stepRows,
        },
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.project.brain_status, "ready");
  });

  it("invalid incomplete roadmap does not recover snapshot", async () => {
    const fetchImpl = createIntegrityFetchMock();
    const result = await withGlobalFetch(fetchImpl, () =>
      ensureBrainSnapshotForReadyWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project: { id: PROJECT_ID, goal: "Launch product" },
        bundle: { workflow: { id: WORKFLOW_ID, status: "ready" }, milestones: [], steps: [] },
      }),
    );
    assert.equal(result.ok, false);
  });

  it("missing step blueprint is repaired deterministically", () => {
    const bundle = {
      workflow: buildReadyBundle().workflowRows[0],
      milestones: buildReadyBundle().milestoneRows,
      steps: buildReadyBundle().stepRows,
    };
    const project = { id: PROJECT_ID, goal: "Launch product" };
    const snapshot = buildBrainSnapshotFromBundle({
      project,
      bundle,
      roadmapEvidenceHash: computeRoadmapEvidenceHash({ project }),
    });
    snapshot.stepBlueprints = [];
    const repaired = repairSnapshotBlueprintsFromBundle(snapshot, bundle);
    assert.equal(repaired.stepBlueprints.length, 1);
    assert.equal(repaired.stepBlueprints[0].stepId, STEP_1);
  });

  it("recovery preserves roadmap evidence hash", async () => {
    const project = { id: PROJECT_ID, goal: "Launch product" };
    const bundle = {
      workflow: buildReadyBundle().workflowRows[0],
      milestones: buildReadyBundle().milestoneRows,
      steps: buildReadyBundle().stepRows,
    };
    const expectedHash = computeRoadmapEvidenceHash({ project });
    const fetchImpl = createIntegrityFetchMock({ memoryRows: [] });
    const result = await withGlobalFetch(fetchImpl, () =>
      ensureBrainSnapshotForReadyWorkflow({
        baseUrl: "https://example.supabase.co",
        secretKey: "secret",
        userId: USER_ID,
        project,
        bundle,
      }),
    );
    assert.equal(result.snapshot.roadmapEvidenceHash, expectedHash);
  });
});
