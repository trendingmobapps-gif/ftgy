import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(`${root}/${path}`, "utf8");
}

describe("projects Vercel file tracing", () => {
  it("configures includeFiles for projects API functions", () => {
    const vercel = JSON.parse(read("vercel.json"));
    assert.ok(vercel.functions);
    assert.ok(vercel.functions["api/projects-*.js"]);
    assert.match(vercel.functions["api/projects-*.js"].includeFiles, /lib\//);
    assert.match(vercel.functions["api/projects-*.js"].includeFiles, /tools\//);
    assert.equal(vercel.framework, null);
    assert.ok(vercel.buildCommand);
  });

  it("uses static imports in action service for interactive helpers", () => {
    const service = read("lib/projects/brain/actions/service.js");
    assert.match(
      service,
      /import \{ enrichResponseWithInteractiveState, persistAssessmentProgress, submitAssessmentEvaluation \}/,
    );
    assert.doesNotMatch(service, /await import\("\.\.\/execution\/interactive\.js"\)/);
  });

  it("static import diagnostic uses top-level imports only", () => {
    const diagnostic = read("api/projects-static-import-diagnostic.js");
    assert.match(diagnostic, /import \{ EXECUTION_MODES \}/);
    assert.match(diagnostic, /import \{ prepareProjectAction \}/);
    assert.doesNotMatch(diagnostic, /await import\(/);
  });

  it("does not use variable dynamic imports in production diagnostic removal", () => {
    assert.throws(() => read("api/projects-import-diagnostic.js"));
  });

  it("commits required execution modules including interactive generator", () => {
    const required = [
      "lib/projects/brain/execution/execution-modes.js",
      "lib/projects/brain/execution/execution-plan-schema.js",
      "lib/projects/brain/execution/execution-plan-generator.js",
      "lib/projects/brain/execution/interactive-generator.js",
      "lib/projects/brain/execution/interactive-schema.js",
      "lib/projects/brain/execution/definition.js",
      "lib/projects/brain/execution/interactive.js",
      "lib/projects/brain/actions/service.js",
    ];

    for (const file of required) {
      assert.ok(read(file).length > 0, `missing ${file}`);
    }
  });

  it("local static diagnostic module imports successfully", async () => {
    const mod = await import("../api/projects-static-import-diagnostic.js");
    assert.equal(typeof mod.default, "function");
  });
});
