// Live smoke test for POST /api/projects-analyze-intent against Preview.
// Never prints access tokens or secrets.
//
// Usage:
//   PROJECTS_BASE_URL="https://<preview>.vercel.app" \
//   PROJECTS_ACCESS_TOKEN="<supabase access_token>" \
//   node tests/projects-intent-live-smoke.mjs

import { requireOpenAiLiveTestsOrSkip, readLiveSmokeProjectCap } from "../lib/projects/brain/openai-live-test-guard.js";

requireOpenAiLiveTestsOrSkip("projects-intent-live-smoke");

const BASE_URL = (process.env.PROJECTS_BASE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.PROJECTS_ACCESS_TOKEN || "";

if (!BASE_URL || !TOKEN) {
  console.error("Missing PROJECTS_BASE_URL or PROJECTS_ACCESS_TOKEN.");
  process.exit(2);
}

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function call(body, { token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(`${BASE_URL}/api/projects-analyze-intent`, {
    method: "POST",
    headers,
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

async function main() {
  console.log(`Intent analysis live smoke against ${BASE_URL}`);

  const noToken = await call({ goal: "Vreau să slăbesc 7 kg" });
  check("missing token -> 401", noToken.status === 401, `got ${noToken.status}`);

  const emptyGoal = await call({ goal: "" }, { token: TOKEN });
  check("empty goal -> 400", emptyGoal.status === 400, `got ${emptyGoal.status}`);

  const caseA = await call(
    {
      goal: "Vreau să lansez propria mea platformă AI pentru piața din România",
    },
    { token: TOKEN },
  );
  check(
    "Case A: platform AI launch -> ready + business, no clarification",
    caseA.status === 200 &&
      caseA.json?.success === true &&
      caseA.json?.status === "ready" &&
      caseA.json?.categorySlug === "business" &&
      caseA.json?.status !== "needs_clarification",
    JSON.stringify({
      status: caseA.status,
      bodyStatus: caseA.json?.status,
      category: caseA.json?.categorySlug,
    }),
  );

  const caseB = await call({ goal: "Vreau să slăbesc 7 kg" }, { token: TOKEN });
  check(
    "Case B: weight-loss goal -> ready + fitness, no blocking clarification",
    caseB.status === 200 &&
      caseB.json?.success === true &&
      caseB.json?.status === "ready" &&
      caseB.json?.categorySlug === "fitness",
    JSON.stringify({
      status: caseB.status,
      bodyStatus: caseB.json?.status,
      category: caseB.json?.categorySlug,
    }),
  );

  const caseC = await call({ goal: "Vreau să mă dezvolt" }, { token: TOKEN });
  const caseCQuestions = Array.isArray(caseC.json?.questions) ? caseC.json.questions : [];
  check(
    "Case C: vague goal -> needs_clarification with 1-2 questions",
    caseC.status === 200 &&
      caseC.json?.status === "needs_clarification" &&
      caseCQuestions.length >= 1 &&
      caseCQuestions.length <= 2,
    JSON.stringify({
      status: caseC.status,
      bodyStatus: caseC.json?.status,
      questionCount: caseCQuestions.length,
    }),
  );

  if (caseC.json?.status === "needs_clarification" && caseCQuestions.length > 0) {
    const clarificationAnswers = caseCQuestions.map((question, index) => ({
      questionId: question.id,
      answer:
        question.type === "single_choice" && Array.isArray(question.options) && question.options[0]
          ? question.options[0].value
          : index === 0
            ? "Carieră și productivitate la job"
            : "În următoarele 3 luni",
    }));

    const caseD = await call(
      {
        goal: "Vreau să mă dezvolt",
        clarificationAnswers,
      },
      { token: TOKEN },
    );

    check(
      "Case D: clarification resubmit -> ready or unsupported, never needs_clarification",
      caseD.status === 200 &&
        (caseD.json?.status === "ready" || caseD.json?.status === "unsupported") &&
        caseD.json?.status !== "needs_clarification",
      JSON.stringify({ status: caseD.status, bodyStatus: caseD.json?.status }),
    );
  } else {
    console.log("SKIP  Case D (Case C did not return clarification questions)");
    failed += 1;
  }

  check(
    "endpoint does not create project rows",
    caseB.json && !caseB.json.project && !caseB.json.id,
    "project payload leaked",
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Intent live smoke crashed:", error?.message || error);
  process.exit(1);
});
