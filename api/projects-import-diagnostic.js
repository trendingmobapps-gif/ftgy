// Preview-only import diagnostic. Dynamic per-module imports inside handler.
// Does not call Supabase or OpenAI.

console.log("[projects-import-diagnostic] module_loaded");

const IMPORT_TARGETS = [
  { name: "execution-modes", path: "../lib/projects/brain/execution/execution-modes.js" },
  { name: "execution-plan-schema", path: "../lib/projects/brain/execution/execution-plan-schema.js" },
  { name: "execution-plan-generator", path: "../lib/projects/brain/execution/execution-plan-generator.js" },
  { name: "definition", path: "../lib/projects/brain/execution/definition.js" },
  { name: "action-service", path: "../lib/projects/brain/actions/service.js" },
  { name: "projects-prepare-action", path: "./projects-prepare-action.js" },
];

function safeExportedKeys(moduleNamespace) {
  if (!moduleNamespace || typeof moduleNamespace !== "object") {
    return [];
  }

  return Object.keys(moduleNamespace).sort();
}

function safeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    code: error?.code || null,
    stack: typeof error?.stack === "string" ? error.stack : null,
  };
}

function readEnvPresence() {
  return {
    openAiKeyExists: Boolean(process.env.OPENAI_API_KEY),
    supabaseUrlExists: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseServiceKeyExists: Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    ),
  };
}

async function probeImport(target) {
  try {
    const loaded = await import(target.path);
    return {
      module: target.name,
      path: target.path,
      ok: true,
      exportedKeys: safeExportedKeys(loaded),
      error: null,
    };
  } catch (error) {
    console.error("[projects-import-diagnostic] import_failed", {
      module: target.name,
      path: target.path,
      ...safeError(error),
    });

    return {
      module: target.name,
      path: target.path,
      ok: false,
      exportedKeys: [],
      error: safeError(error),
    };
  }
}

export default async function handler(req, res) {
  console.log("[projects-import-diagnostic] handler_started");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ success: false, error: { message: "Method not allowed. Use GET or POST." } });
    return;
  }

  try {
    const imports = [];
    for (const target of IMPORT_TARGETS) {
      imports.push(await probeImport(target));
    }

    const allOk = imports.every((entry) => entry.ok);

    res.status(allOk ? 200 : 500).json({
      success: allOk,
      runtime: process.version,
      platform: process.platform,
      arch: process.arch,
      env: readEnvPresence(),
      imports,
    });
  } catch (error) {
    console.error("[projects-import-diagnostic] handler_failed", safeError(error));

    res.status(500).json({
      success: false,
      runtime: process.version,
      platform: process.platform,
      arch: process.arch,
      env: readEnvPresence(),
      imports: [],
      error: safeError(error),
    });
  }
}
