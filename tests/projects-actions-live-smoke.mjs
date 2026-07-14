// Live action execution smoke extension for Preview deployments.

import { requireOpenAiLiveTestsOrSkip } from "../lib/projects/brain/openai-live-test-guard.js";

requireOpenAiLiveTestsOrSkip("projects-actions-live-smoke");

const BASE_URL = (process.env.PROJECTS_BASE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.PROJECTS_ACCESS_TOKEN || "";

if (!BASE_URL || !TOKEN) {
  console.error("Missing PROJECTS_BASE_URL or PROJECTS_ACCESS_TOKEN.");
  process.exit(2);
}

async function call(path, body) {
  const resp = await fetch(`${BASE_URL}/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body || {}),
  });

  let json = null;
  try {
    json = await resp.json();
  } catch {
    json = null;
  }

  return { status: resp.status, json };
}

function collectSteps(view) {
  return (view?.workflow?.milestones || []).flatMap((m) => m.steps || []);
}

async function main() {
  console.log(`\nCase F — action execution (${BASE_URL})`);

  const created = await call("projects-create", {
    goal: "Vreau să deschid o patiserie premium în Timișoara, buget 80.000 €",
    categorySlug: "business",
    name: "ZZ Action Smoke Patiserie",
  });

  if (created.status !== 201 || !created.json?.project?.id) {
    console.log(`FAIL  F project created -> ${created.status}`);
    process.exit(1);
  }

  const projectId = created.json.project.id;
  const generated = await call("projects-generate-workflow", { projectId });
  if (generated.status !== 200 || generated.json?.brainStatus !== "ready") {
    console.log(`FAIL  F workflow ready -> ${generated.status}`);
    await call("projects-archive", { projectId });
    process.exit(1);
  }

  const steps = collectSteps(generated.json);
  const firstStep = steps[0];
  if (!firstStep?.id) {
    console.log("FAIL  F first step missing");
    await call("projects-archive", { projectId });
    process.exit(1);
  }

  const manualComplete = await call("projects-step-status", {
    projectId,
    stepId: firstStep.id,
    targetStatus: "completed",
  });
  if (manualComplete.status === 409) {
    console.log("PASS  F manual completion blocked without result");
  } else {
    console.log(`FAIL  F manual completion blocked -> ${manualComplete.status}`);
  }

  const prepared = await call("projects-prepare-action", {
    projectId,
    stepId: firstStep.id,
  });

  if (prepared.status !== 200 || !prepared.json?.action?.preparedPrompt) {
    console.log(`FAIL  F prepare action -> ${prepared.status}`);
    await call("projects-archive", { projectId });
    process.exit(1);
  }

  console.log("PASS  F contextual prompt prepared");
  if ((prepared.json.action.preparedPrompt || "").length < 40) {
    console.log("FAIL  F prepared prompt too short");
    await call("projects-archive", { projectId });
    process.exit(1);
  }
  console.log("PASS  F prepared prompt non-empty");

  const executed = await call("projects-execute-action", {
    projectId,
    stepId: firstStep.id,
    actionId: prepared.json.action.actionId,
    acceptedInput: {
      prompt: prepared.json.action.preparedPrompt,
    },
  });

  if (executed.status !== 200 || !executed.json?.result?.preview) {
    console.log(`FAIL  F execute action -> ${executed.status}`);
    await call("projects-archive", { projectId });
    process.exit(1);
  }

  console.log("PASS  F action executed with result");
  const progress = executed.json?.progress?.progressPercent || 0;
  if (progress <= 0) {
    console.log(`FAIL  F progress increased -> ${progress}`);
    await call("projects-archive", { projectId });
    process.exit(1);
  }
  console.log(`PASS  F progress increased -> ${progress}`);

  const completedStep = collectSteps(executed.json).find((step) => step.id === firstStep.id);
  if (completedStep?.status !== "completed") {
    console.log(`FAIL  F step completed -> ${completedStep?.status}`);
    await call("projects-archive", { projectId });
    process.exit(1);
  }
  console.log("PASS  F step completed after result");

  const results = await call("projects-action-results", { projectId, stepId: firstStep.id });
  if (results.status !== 200 || !Array.isArray(results.json?.results) || results.json.results.length < 1) {
    console.log(`FAIL  F result attached -> ${results.status}`);
    await call("projects-archive", { projectId });
    process.exit(1);
  }
  console.log("PASS  F result attached to project");

  await call("projects-archive", { projectId });
  console.log("PASS  F cleanup completed");
  process.exit(0);
}

main().catch((error) => {
  console.error("Action live smoke crashed:", error?.message || error);
  process.exit(1);
});
