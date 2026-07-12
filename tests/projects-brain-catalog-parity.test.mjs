import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { getProjectToolCatalogIndex, resetProjectToolCatalogIndexForTests } from "../lib/projects/tool-catalog.js";

const mobileRoot = "/Users/grigorestefanica/Documents/ITER Mobile/iter-ai-mobile";

function loadMobileToolIds() {
  const catalogPath = join(mobileRoot, "src/data/tools_catalog.json");
  const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
  const ids = new Set((raw.tools || []).map((tool) => tool.toolId).filter(Boolean));
  return ids;
}

describe("backend/mobile tool catalog parity", () => {
  beforeEach(() => {
    resetProjectToolCatalogIndexForTests();
  });

  it("every backend tool id exists in mobile catalog", () => {
    const mobileIds = loadMobileToolIds();
    const { byId } = getProjectToolCatalogIndex();
    const missing = [];

    for (const toolId of byId.keys()) {
      if (!mobileIds.has(toolId)) {
        missing.push(toolId);
      }
    }

    assert.equal(missing.length, 0, `Missing in mobile catalog: ${missing.slice(0, 10).join(", ")}`);
  });

  it("mobile catalog does not introduce ids absent from backend", () => {
    const mobileIds = loadMobileToolIds();
    const { byId } = getProjectToolCatalogIndex();
    const extra = [];

    for (const toolId of mobileIds) {
      if (!byId.has(toolId)) {
        extra.push(toolId);
      }
    }

    assert.equal(extra.length, 0, `Extra mobile ids: ${extra.slice(0, 10).join(", ")}`);
  });
});
