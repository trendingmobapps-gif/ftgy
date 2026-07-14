import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function readApi(name) {
  return readFileSync(join(root, "api", name), "utf8");
}

function readLib(name) {
  return readFileSync(join(root, "lib", name), "utf8");
}

describe("backend route inventory", () => {
  const requiredRoutes = [
    "generate-tool.js",
    "category-chat.js",
    "specialist-chat.js",
    "recommend-tool.js",
    "classify-category.js",
    "transcribe-audio.js",
    "workflow-engine-version.js",
    "dashboard-data.js",
    "profile-get-or-create.js",
    "consume-free-generation.js",
    "check-user-access.js",
  ];

  for (const route of requiredRoutes) {
    it(`includes api/${route}`, () => {
      const content = readApi(route);
      assert.ok(content.length > 0, `missing ${route}`);
      assert.match(content, /export default (async )?function handler/);
    });
  }
});

describe("dashboard-data contract (static)", () => {
  const source = readApi("dashboard-data.js");

  it("supports mobile-homepage limit params", () => {
    assert.match(source, /mobile-homepage/);
    assert.match(source, /chatLimit/);
    assert.match(source, /generationLimit/);
    assert.match(source, /previewOnly/);
  });

  it("reads generation_history and chat_sessions", () => {
    assert.match(source, /generation_history/);
    assert.match(source, /chat_sessions/);
    assert.match(source, /usage_limits/);
    assert.match(source, /profiles/);
    assert.match(source, /user_access/);
  });
});

describe("profile-get-or-create contract (static)", () => {
  const source = readApi("profile-get-or-create.js");

  it("accepts mobile sync payload fields", () => {
    assert.match(source, /supabaseUserId/);
    assert.match(source, /fullName/);
    assert.match(source, /avatarUrl/);
    assert.match(source, /createdFrom/);
  });

  it("uses shared profile resolver", () => {
    assert.match(source, /resolveProfileFromRequest/);
  });
});

describe("consume-free-generation contract (static)", () => {
  const source = readApi("consume-free-generation.js");

  it("requires internal secret header", () => {
    assert.match(source, /x-iter-secret/);
    assert.match(source, /ITER_INTERNAL_API_SECRET/);
  });

  it("delegates to shared usage event helper", () => {
    assert.match(source, /consumeFreeGeneration/);
  });
});

describe("category-chat production persistence (static)", () => {
  const source = readApi("category-chat.js");

  it("dual-writes chat_sessions and calls consume-free-generation", () => {
    assert.match(source, /chat_sessions/);
    assert.match(source, /consume-free-generation/);
    assert.match(source, /check-user-access/);
  });
});

describe("generate-tool persistence contract (static)", () => {
  const source = readApi("generate-tool.js");

  it("parses authenticated client fields", () => {
    assert.match(source, /normalizedEmail/);
    assert.match(source, /idempotencyKey/);
    assert.match(source, /memberId/);
  });

  it("persists generation_history and records usage events", () => {
    assert.match(source, /persistGenerationHistory/);
    assert.match(source, /consumeFreeGeneration/);
    assert.match(source, /resolveCategoryAccess/);
  });
});

describe("shared lib helpers", () => {
  it("documents usage_events schema migration", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/20260712_document_usage_events.sql"),
      "utf8",
    );
    assert.match(sql, /create table if not exists public\.usage_events/);
    assert.match(sql, /idempotency_key/);
  });

  it("exposes profile and usage helpers", () => {
    assert.match(readLib("profile.js"), /resolveProfileFromRequest/);
    assert.match(readLib("usage-events.js"), /findUsageEventByIdempotencyKey/);
    assert.match(readLib("generation-persistence.js"), /generation_history/);
  });
});
