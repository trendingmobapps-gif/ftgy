import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TOOL_GENERATION_POLICY,
  MODEL_PROFILES,
  inferResponseProfile,
  resolveGenerationConfig,
  buildConciseGenerationInstructions,
  countWords,
} from "../tools/generation-policy.js";
import { TOOLS } from "../tools/tools-config.js";

describe("TOOL_GENERATION_POLICY", () => {
  it("defines concise, default, and detailed profiles with token limits", () => {
    assert.equal(TOOL_GENERATION_POLICY.concise.maxOutputTokens, 400);
    assert.equal(TOOL_GENERATION_POLICY.default.maxOutputTokens, 700);
    assert.equal(TOOL_GENERATION_POLICY.detailed.maxOutputTokens, 1000);
    assert.ok(TOOL_GENERATION_POLICY.concise.maxOutputTokens < TOOL_GENERATION_POLICY.default.maxOutputTokens);
    assert.ok(TOOL_GENERATION_POLICY.default.maxOutputTokens < TOOL_GENERATION_POLICY.detailed.maxOutputTokens);
  });

  it("maps model profiles to ordered model lists", () => {
    assert.deepEqual(MODEL_PROFILES.fast[0], "gpt-4.1-mini");
    assert.deepEqual(MODEL_PROFILES.balanced[0], "gpt-4.1");
    assert.ok(MODEL_PROFILES.complex.includes("gpt-4.1"));
  });
});

describe("inferResponseProfile", () => {
  it("classifies CTA and hook tools as concise", () => {
    assert.equal(inferResponseProfile("generator-cta", TOOLS["generator-cta"]), "concise");
    assert.equal(inferResponseProfile("generator-hook", TOOLS["generator-hook"]), "concise");
  });

  it("classifies business plan and marketing strategy as detailed", () => {
    assert.equal(inferResponseProfile("plan-de-afaceri", TOOLS["plan-de-afaceri"]), "detailed");
    assert.equal(
      inferResponseProfile("strategie-marketing", TOOLS["strategie-marketing"]),
      "detailed",
    );
  });

  it("respects explicit tool.responseProfile override", () => {
    assert.equal(
      inferResponseProfile("generator-cta", {
        ...TOOLS["generator-cta"],
        responseProfile: "default",
      }),
      "default",
    );
  });
});

describe("resolveGenerationConfig", () => {
  it("returns lower token limits for concise tools", () => {
    const concise = resolveGenerationConfig("generator-cta", TOOLS["generator-cta"]);
    const detailed = resolveGenerationConfig("plan-de-afaceri", TOOLS["plan-de-afaceri"]);

    assert.equal(concise.responseProfile, "concise");
    assert.equal(concise.maxOutputTokens, 400);
    assert.equal(concise.modelProfile, "fast");

    assert.equal(detailed.responseProfile, "detailed");
    assert.equal(detailed.maxOutputTokens, 1000);
    assert.equal(detailed.modelProfile, "complex");
  });

  it("caps explicit per-tool maxOutputTokens to profile ceiling", () => {
    const config = resolveGenerationConfig("generator-cta", {
      ...TOOLS["generator-cta"],
      maxOutputTokens: 5000,
    });
    assert.equal(config.maxOutputTokens, 400);
  });
});

describe("buildConciseGenerationInstructions", () => {
  it("includes profile-specific word targets", () => {
    const concise = buildConciseGenerationInstructions("concise");
    const detailed = buildConciseGenerationInstructions("detailed");

    assert.match(concise, /150–300/);
    assert.match(detailed, /600–1000/);
    assert.match(concise, /Nu repeta inputul/);
  });
});

describe("tool catalog coverage", () => {
  it("assigns a response profile to every configured tool", () => {
    const toolIds = Object.keys(TOOLS);
    assert.equal(toolIds.length, 160);

    for (const toolId of toolIds) {
      const profile = inferResponseProfile(toolId, TOOLS[toolId]);
      assert.ok(["concise", "default", "detailed"].includes(profile), toolId);
      const config = resolveGenerationConfig(toolId, TOOLS[toolId]);
      assert.ok(config.maxOutputTokens > 0 && config.maxOutputTokens <= 1000, toolId);
      assert.ok(config.models.length >= 1, toolId);
    }
  });
});

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    assert.equal(countWords("one two three"), 3);
    assert.equal(countWords(""), 0);
  });
});
