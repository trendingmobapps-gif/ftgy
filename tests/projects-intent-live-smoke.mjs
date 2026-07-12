// Live smoke test for POST /api/projects-analyze-intent against Preview.
// Never prints access tokens or secrets.
//
// Usage:
//   PROJECTS_BASE_URL="https://<preview>.vercel.app" \
//   PROJECTS_ACCESS_TOKEN="<supabase access_token>" \
//   node tests/projects-intent-live-smoke.mjs

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

  const clearFitness = await call(
    {
      goal: "Vreau să slăbesc 7 kg în 3 luni și să mă antrenez acasă",
    },
    { token: TOKEN },
  );
  check(
    "clear fitness goal -> ready + fitness",
    clearFitness.status === 200 &&
      clearFitness.json?.success === true &&
      clearFitness.json?.status === "ready" &&
      clearFitness.json?.categorySlug === "fitness",
    JSON.stringify({
      status: clearFitness.status,
      bodyStatus: clearFitness.json?.status,
      category: clearFitness.json?.categorySlug,
    }),
  );

  const clearBusiness = await call(
    { goal: "Vreau să deschid o cafenea în Timișoara" },
    { token: TOKEN },
  );
  check(
    "clear business goal -> ready + business",
    clearBusiness.status === 200 &&
      clearBusiness.json?.status === "ready" &&
      clearBusiness.json?.categorySlug === "business",
    JSON.stringify({
      status: clearBusiness.status,
      category: clearBusiness.json?.categorySlug,
    }),
  );

  const vague = await call({ goal: "Vreau să mă dezvolt" }, { token: TOKEN });
  check(
    "vague goal -> needs_clarification",
    vague.status === 200 && vague.json?.status === "needs_clarification",
    JSON.stringify({ status: vague.status, bodyStatus: vague.json?.status }),
  );

  if (vague.json?.status === "needs_clarification" && Array.isArray(vague.json?.questions)) {
    const firstQuestionId = vague.json.questions[0]?.id;
    if (firstQuestionId) {
      const clarified = await call(
        {
          goal: "Vreau să mă dezvolt",
          clarificationAnswers: [
            {
              questionId: firstQuestionId,
              answer: "Vreau să îmi îmbunătățesc productivitatea la job în următoarele 3 luni",
            },
          ],
        },
        { token: TOKEN },
      );
      check(
        "clarification re-analysis returns ready or needs_clarification safely",
        clarified.status === 200 &&
          (clarified.json?.status === "ready" || clarified.json?.status === "needs_clarification"),
        JSON.stringify({ status: clarified.status, bodyStatus: clarified.json?.status }),
      );
    } else {
      console.log("SKIP  clarification re-analysis (no question id)");
    }
  }

  check(
    "endpoint does not create project rows",
    clearFitness.json && !clearFitness.json.project && !clearFitness.json.id,
    "project payload leaked",
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Intent live smoke crashed:", error?.message || error);
  process.exit(1);
});
