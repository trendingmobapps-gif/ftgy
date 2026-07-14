#!/usr/bin/env node
/**
 * Read-only inspection helper for Project Brain snapshot persistence state.
 *
 * Usage (requires Preview Supabase service credentials in env):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... USER_ID=... \
 *     node scripts/inspect-project-brain-snapshot-state.mjs c1daf2f8-4576-4dfb-9213-8b88e637fe19
 *
 * Does not modify live data. Does not call OpenAI.
 */

const PROJECT_ID = process.argv[2] || "c1daf2f8-4576-4dfb-9213-8b88e637fe19";

const SQL = `
-- Run in Supabase SQL Editor (read-only):
select id, brain_status, brain_failure_code, active_workflow_id, goal, updated_at
from public.projects
where id = '${PROJECT_ID}';

select id, status, brain_version, summary, generated_at
from public.project_workflows
where project_id = '${PROJECT_ID}'
order by generated_at desc;

select count(*) as milestone_count
from public.project_milestones
where project_id = '${PROJECT_ID}';

select count(*) as step_count
from public.project_steps
where project_id = '${PROJECT_ID}';

select memory_key, source, length(memory_value) as value_bytes, updated_at
from public.project_memory
where project_id = '${PROJECT_ID}'
  and memory_key in ('brain_snapshot_v1', 'brain_snapshot_v1_evidence_hash')
order by memory_key;
`;

async function supabaseFetch(baseUrl, secretKey, path) {
  const resp = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
    },
  });
  const text = await resp.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: resp.ok, status: resp.status, data };
}

async function inspectViaApi() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const userId = process.env.USER_ID;

  if (!baseUrl || !secretKey) {
    console.log("No Supabase credentials in env. SQL inspection instructions:\n");
    console.log(SQL);
    return;
  }

  const projectQuery = `projects?id=eq.${encodeURIComponent(PROJECT_ID)}&select=id,brain_status,brain_failure_code,active_workflow_id,goal,updated_at,user_id`;
  const projectResult = await supabaseFetch(baseUrl, secretKey, projectQuery);
  const project = Array.isArray(projectResult.data) ? projectResult.data[0] : null;
  const effectiveUserId = userId || project?.user_id;

  console.log(JSON.stringify({ projectId: PROJECT_ID, inspection: "read_only" }, null, 2));
  console.log("\n[projects]");
  console.log(JSON.stringify(project || projectResult, null, 2));

  const workflowQuery = `project_workflows?project_id=eq.${encodeURIComponent(PROJECT_ID)}&select=id,status,brain_version,summary,generated_at&order=generated_at.desc`;
  const workflowResult = await supabaseFetch(baseUrl, secretKey, workflowQuery);
  console.log("\n[project_workflows]");
  console.log(JSON.stringify(workflowResult.data || workflowResult, null, 2));

  const milestonesQuery = `project_milestones?project_id=eq.${encodeURIComponent(PROJECT_ID)}&select=id,title,position`;
  const milestonesResult = await supabaseFetch(baseUrl, secretKey, milestonesQuery);
  const milestones = Array.isArray(milestonesResult.data) ? milestonesResult.data : [];
  console.log("\n[project_milestones count]", milestones.length);

  const stepsQuery = `project_steps?project_id=eq.${encodeURIComponent(PROJECT_ID)}&select=id,title,position`;
  const stepsResult = await supabaseFetch(baseUrl, secretKey, stepsQuery);
  const steps = Array.isArray(stepsResult.data) ? stepsResult.data : [];
  console.log("[project_steps count]", steps.length);

  if (effectiveUserId) {
    const memoryQuery =
      `project_memory?project_id=eq.${encodeURIComponent(PROJECT_ID)}` +
      `&user_id=eq.${encodeURIComponent(effectiveUserId)}` +
      `&memory_key=in.(brain_snapshot_v1,brain_snapshot_v1_evidence_hash)` +
      `&select=memory_key,source,memory_value,updated_at`;
    const memoryResult = await supabaseFetch(baseUrl, secretKey, memoryQuery);
    const memoryRows = Array.isArray(memoryResult.data) ? memoryResult.data : [];
    console.log("\n[project_memory snapshot keys]");
    console.log(
      JSON.stringify(
        memoryRows.map((row) => ({
          memory_key: row.memory_key,
          source: row.source,
          value_bytes: String(row.memory_value || "").length,
          updated_at: row.updated_at,
        })),
        null,
        2,
      ),
    );
  } else {
    console.log("\n[project_memory] skipped — set USER_ID or ensure project row includes user_id");
  }

  console.log("\n[SQL fallback]\n");
  console.log(SQL);
}

await inspectViaApi();
