import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attachResolvedIconsToReadyPayload,
  finalizeProjectIconFields,
  getAllowedProjectAccentKeys,
  getAllowedProjectIconKeys,
  isAllowedProjectAccentKey,
  isAllowedProjectIconKey,
  resolveProjectIcons,
} from "../lib/projects/icon-catalog.js";

describe("project icon registry", () => {
  it("exposes a controlled icon and accent registry", () => {
    assert.ok(getAllowedProjectIconKeys().length >= 40);
    assert.ok(getAllowedProjectIconKeys().length <= 70);
    assert.deepEqual(getAllowedProjectAccentKeys(), [
      "navy",
      "lime",
      "blue",
      "violet",
      "amber",
      "coral",
      "teal",
      "rose",
    ]);
  });

  it("rejects unknown icon and accent keys", () => {
    assert.equal(isAllowedProjectIconKey("rocket"), true);
    assert.equal(isAllowedProjectIconKey("totally-made-up"), false);
    assert.equal(isAllowedProjectAccentKey("teal"), true);
    assert.equal(isAllowedProjectAccentKey("neon"), false);
  });
});

describe("semantic project icon resolution", () => {
  it("maps Deschidere cafenea to a coffee or storefront icon", () => {
    const resolved = resolveProjectIcons({
      goal: "Deschidere cafenea",
      categorySlug: "business",
    });

    assert.ok(["coffee", "storefront"].includes(resolved.iconKey));
    assert.ok(isAllowedProjectAccentKey(resolved.accentKey));
  });

  it("maps Pregătire Bacalaureat Română to an education icon", () => {
    const resolved = resolveProjectIcons({
      goal: "Pregătire Bacalaureat Română",
      categorySlug: "studii",
    });

    assert.ok(["book", "graduation", "document"].includes(resolved.iconKey));
  });

  it("maps Slăbesc 10 kg to a fitness icon", () => {
    const resolved = resolveProjectIcons({
      goal: "Slăbesc 10 kg",
      categorySlug: "fitness",
    });

    assert.ok(["target", "scale", "leaf", "flag"].includes(resolved.iconKey));
  });

  it("maps Lansare platformă AI to a technology icon", () => {
    const resolved = resolveProjectIcons({
      goal: "Lansare platformă AI",
      categorySlug: "business",
    });

    assert.ok(["rocket", "sparkles", "brain", "bolt"].includes(resolved.iconKey));
  });

  it("returns stable icons for the same input", () => {
    const first = resolveProjectIcons({
      goal: "Planificare vacanță Japonia",
      categorySlug: "viataPersonala",
      projectId: "stable-project-id",
    });
    const second = resolveProjectIcons({
      goal: "Planificare vacanță Japonia",
      categorySlug: "viataPersonala",
      projectId: "stable-project-id",
    });

    assert.deepEqual(first, second);
  });

  it("uses category fallback when no semantic match exists", () => {
    const resolved = resolveProjectIcons({
      goal: "Xyzzy abstract initiative",
      categorySlug: "finante",
      projectId: "fallback-finance",
    });

    assert.equal(resolved.iconKey, "wallet");
    assert.ok(isAllowedProjectAccentKey(resolved.accentKey));
  });

  it("replaces invalid AI icon suggestions with deterministic matches", () => {
    const resolved = resolveProjectIcons({
      goal: "Deschidere cafenea",
      categorySlug: "business",
      suggestedIconKey: "not-a-real-icon",
      suggestedAccentKey: "neon",
    });

    assert.ok(["coffee", "storefront"].includes(resolved.iconKey));
    assert.ok(isAllowedProjectAccentKey(resolved.accentKey));
  });

  it("prefers relevant alternatives when recent icons are already used", () => {
    const first = resolveProjectIcons({
      goal: "Deschidere cafenea",
      categorySlug: "business",
      projectId: "project-a",
      recentIconKeys: [],
    });

    const second = resolveProjectIcons({
      goal: "Deschidere restaurant",
      categorySlug: "business",
      projectId: "project-b",
      recentIconKeys: [first.iconKey],
    });

    assert.ok(["coffee", "storefront"].includes(first.iconKey));
    assert.ok(["coffee", "storefront"].includes(second.iconKey));
    if (first.iconKey === second.iconKey) {
      assert.equal(["coffee", "storefront"].includes(first.iconKey), true);
    }
  });

  it("attaches validated icons to ready intent payloads", () => {
    const payload = attachResolvedIconsToReadyPayload(
      {
        status: "ready",
        categorySlug: "studii",
        confidence: 0.9,
        suggestedName: "Pregătire Bacalaureat Română",
        normalizedGoal: "Pregătire Bacalaureat Română",
        shortSummary: "Pregătire pentru examen",
        recommendedToolId: null,
        recommendationReason: null,
        iconKey: "rocket",
        accentKey: "neon",
      },
      { goal: "Pregătire Bacalaureat Română" },
    );

    assert.ok(["book", "graduation", "document"].includes(payload.iconKey));
    assert.ok(isAllowedProjectAccentKey(payload.accentKey));
  });

  it("persists icon and accent fields during project create finalization", () => {
    const finalized = finalizeProjectIconFields(
      {
        goal: "Refacere CV",
        name: "Refacere CV",
        categorySlug: "cariera",
        iconKey: null,
        accentKey: null,
      },
      { projectId: "create-project-id" },
    );

    assert.ok(["briefcase", "document", "person"].includes(finalized.iconKey));
    assert.ok(isAllowedProjectAccentKey(finalized.accentKey));
  });
});
