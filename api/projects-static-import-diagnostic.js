// Preview-only static import diagnostic. All modules imported at top level for Vercel tracing.

import { EXECUTION_MODES } from "../lib/projects/brain/execution/execution-modes.js";
import { buildExecutionPlanJsonSchema } from "../lib/projects/brain/execution/execution-plan-schema.js";
import { ensureExecutionPlan } from "../lib/projects/brain/execution/execution-plan-generator.js";
import { buildExecutionDefinition } from "../lib/projects/brain/execution/definition.js";
import { prepareProjectAction } from "../lib/projects/brain/actions/service.js";
import { getServiceRoleKey } from "../lib/projects/http.js";

console.log("[projects-static-import-diagnostic] module_loaded");

function readEnvPresence() {
  return {
    openAiKeyExists: Boolean(process.env.OPENAI_API_KEY),
    supabaseUrlExists: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseServiceKeyExists: Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    ),
  };
}

export default async function handler(req, res) {
  console.log("[projects-static-import-diagnostic] handler_started");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ success: false, error: { message: "Method not allowed. Use GET or POST." } });
    return;
  }

  res.status(200).json({
    success: true,
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    env: readEnvPresence(),
    modules: {
      executionModes: Array.isArray(EXECUTION_MODES) && EXECUTION_MODES.length > 0,
      executionPlanSchema: typeof buildExecutionPlanJsonSchema === "function",
      executionPlanGenerator: typeof ensureExecutionPlan === "function",
      definition: typeof buildExecutionDefinition === "function",
      actionService: typeof prepareProjectAction === "function",
      httpServiceKeyResolver: typeof getServiceRoleKey === "function",
    },
  });
}
