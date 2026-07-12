import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { resolveSupabaseUser } from "../lib/auth/resolve-supabase-user.js";
import { guardRequest } from "../lib/projects/http.js";
import {
  analyzeProjectIntent,
  applyClarificationRoundGuard,
  hasClarificationAnswers,
  normalizeIntentModelResult,
  CLARIFICATION_ROUND_UNSUPPORTED_MESSAGE,
} from "../lib/projects/intent-analysis.js";
import {
  validateIntentAnalysisInput,
  sanitizeIntentQuestions,
  isValidIntentCategorySlug,
} from "../lib/projects/intent-validation.js";
import {
  checkIntentRateLimit,
  resetIntentRateLimitForTests,
} from "../lib/projects/intent-rate-limit.js";
import {
  resolveRecommendedToolId,
  resetProjectToolCatalogIndexForTests,
} from "../lib/projects/tool-catalog.js";
import { deriveNameFromGoal } from "../lib/projects/validation.js";
import intentHandler from "../api/projects-analyze-intent.js";

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end() {},
  };
  return res;
}

describe("intent validation", () => {
  it("rejects missing goal", () => {
    const result = validateIntentAnalysisInput({});
    assert.equal(result.valid, false);
    assert.ok(result.fields.goal);
  });

  it("rejects overlong goal and optionalName", () => {
    const longGoal = "a".repeat(5001);
    const longName = "b".repeat(121);
    const result = validateIntentAnalysisInput({ goal: longGoal, optionalName: longName });
    assert.equal(result.valid, false);
    assert.ok(result.fields.goal);
    assert.ok(result.fields.optionalName);
  });

  it("rejects unknown top-level fields", () => {
    const result = validateIntentAnalysisInput({
      goal: "Vreau să deschid o cafenea în Timișoara",
      categorySlug: "business",
    });
    assert.equal(result.valid, false);
    assert.ok(result.fields.categorySlug);
  });

  it("accepts valid clarification answers", () => {
    const result = validateIntentAnalysisInput({
      goal: "Vreau să slăbesc 7 kg în 3 luni",
      clarificationAnswers: [{ questionId: "timeline", answer: "3 luni" }],
    });
    assert.equal(result.valid, true);
    assert.equal(result.value.clarificationAnswers.length, 1);
  });
});

describe("intent model normalization", () => {
  beforeEach(() => {
    resetProjectToolCatalogIndexForTests();
  });

  it("accepts ready fitness goal with valid category", () => {
    const normalized = normalizeIntentModelResult(
      {
        status: "ready",
        categorySlug: "fitness",
        confidence: 0.91,
        suggestedName: "Slăbesc 7 kg",
        normalizedGoal: "Vreau să slăbesc 7 kg în 3 luni",
        suggestedToolId: "invented-tool-id",
        recommendationReason: null,
      },
      { goal: "Vreau să slăbesc 7 kg în 3 luni" },
    );

    assert.equal(normalized.ok, true);
    assert.equal(normalized.payload.status, "ready");
    assert.equal(normalized.payload.categorySlug, "fitness");
    assert.equal(normalized.payload.recommendedToolId, null);
  });

  it("rejects invalid model category slug", () => {
    const normalized = normalizeIntentModelResult(
      {
        status: "ready",
        categorySlug: "social-media",
        confidence: 0.8,
        suggestedName: "Test",
      },
      { goal: "Vreau să îmi cresc contul de TikTok" },
    );
    assert.equal(normalized.ok, false);
  });

  it("preserves user-provided optional name", () => {
    const normalized = normalizeIntentModelResult(
      {
        status: "ready",
        categorySlug: "business",
        confidence: 0.88,
        suggestedName: "Alt nume",
      },
      {
        goal: "Vreau să deschid un salon de beauty în Timișoara",
        optionalName: "Lansare Salon Beauty",
      },
    );

    assert.equal(normalized.payload.suggestedName, "Lansare Salon Beauty");
  });

  it("limits clarification questions to 2 and deduplicates ids", () => {
    const questions = sanitizeIntentQuestions([
      { id: "q1", question: "Întrebare 1", type: "text" },
      { id: "q1", question: "Duplicat", type: "text" },
      { id: "q2", question: "Întrebare 2", type: "text" },
      { id: "q3", question: "Întrebare 3", type: "text" },
      { id: "q4", question: "Întrebare 4", type: "text" },
    ]);
    assert.equal(questions.length, 2);
    assert.equal(questions[0].id, "q1");
  });

  it("derives concise fallback project names", () => {
    assert.equal(deriveNameFromGoal("Vreau să slăbesc 7 kg"), "Slăbesc 7 kg");
    assert.ok(!deriveNameFromGoal("Vreau să slăbesc 7 kg").includes("ITER AI"));
  });
});

describe("tool catalog resolution", () => {
  beforeEach(() => {
    resetProjectToolCatalogIndexForTests();
  });

  it("rejects invented tool ids", () => {
    const resolved = resolveRecommendedToolId({
      categorySlug: "fitness",
      candidateToolId: "totally-made-up-tool",
    });
    assert.equal(resolved, null);
  });

  it("rejects cross-category tool ids", () => {
    const resolved = resolveRecommendedToolId({
      categorySlug: "fitness",
      candidateToolId: "generator-reclame-meta",
    });
    assert.equal(resolved, null);
  });
});

describe("authentication guard", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "service-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 401 when bearer token is missing", async () => {
    const req = { method: "POST", headers: {}, body: {} };
    const res = createMockRes();
    const guard = await guardRequest(req, res, { authMode: "user" });
    assert.equal(guard.ok, false);
    assert.equal(res.statusCode, 401);
  });

  it("verifies supabase user via gotrue endpoint", async () => {
    const fetchFn = async (url, options) => {
      assert.match(url, /\/auth\/v1\/user$/);
      assert.equal(options.headers.apikey, "service-key");
      assert.equal(options.headers.Authorization, "Bearer user-token");
      return {
        ok: true,
        async json() {
          return { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com" };
        },
      };
    };

    const resolved = await resolveSupabaseUser({
      baseUrl: "https://example.supabase.co",
      secretKey: "service-key",
      accessToken: "user-token",
      fetchFn,
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.userId, "11111111-1111-4111-8111-111111111111");
  });
});

describe("intent endpoint handler", () => {
  const originalEnv = { ...process.env };
  const userId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    resetIntentRateLimitForTests();
    resetProjectToolCatalogIndexForTests();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "service-key";
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function callIntent(body, token = "valid-token") {
    const req = {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body,
    };
    const res = createMockRes();
    const fetchFn = async (url) => {
      if (url.includes("/auth/v1/user")) {
        return {
          ok: true,
          async json() {
            return { id: userId, email: "test@example.com" };
          },
        };
      }
      if (url.includes("openai.com")) {
        return {
          ok: true,
          async json() {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      status: "ready",
                      categorySlug: "fitness",
                      confidence: 0.92,
                      suggestedName: "Slăbesc 7 kg",
                      normalizedGoal: body.goal,
                      shortSummary: null,
                      detectedIntent: null,
                      firstStepTitle: "Stabilește obiectivul",
                      firstStepDescription: null,
                      suggestedToolId: null,
                      recommendationReason: null,
                      message: null,
                      questions: [],
                    }),
                  },
                },
              ],
            };
          },
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    global.fetch = fetchFn;
    await intentHandler(req, res);
    return res;
  }

  it("returns 401 without token", async () => {
    const req = { method: "POST", headers: {}, body: { goal: "Vreau să slăbesc 7 kg" } };
    const res = createMockRes();
    await intentHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  it("returns 400 for empty goal", async () => {
    const res = await callIntent({ goal: "   " });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, "PROJECT_INTENT_INVALID_INPUT");
  });

  it("returns ready analysis without creating a project", async () => {
    const res = await callIntent({
      goal: "Vreau să slăbesc 7 kg în 3 luni și să mă antrenez acasă",
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.status, "ready");
    assert.equal(res.body.categorySlug, "fitness");
    assert.equal("project" in res.body, false);
    assert.equal("id" in res.body, false);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    for (let i = 0; i < 30; i += 1) {
      checkIntentRateLimit(userId, { limit: 30, windowMs: 60_000 });
    }
    const res = await callIntent({ goal: "Vreau să deschid o cafenea în Timișoara" });
    assert.equal(res.statusCode, 429);
  });
});

describe("clarification round guard", () => {
  it("blocks second needs_clarification when answers are present", () => {
    const normalized = normalizeIntentModelResult(
      {
        status: "needs_clarification",
        message: "Mai am nevoie de detalii",
        questions: [{ id: "q1", question: "Ce vrei?", type: "text", options: null }],
      },
      { goal: "Vreau să mă dezvolt" },
    );

    const guarded = applyClarificationRoundGuard(normalized, {
      goal: "Vreau să mă dezvolt",
      clarificationAnswers: [{ questionId: "q1", answer: "Carieră" }],
    });

    assert.equal(guarded.ok, false);
    assert.equal(guarded.reason, "second_clarification_round_blocked");
  });

  it("allows needs_clarification on first round without answers", () => {
    const normalized = normalizeIntentModelResult(
      {
        status: "needs_clarification",
        message: "Mai am nevoie de detalii",
        questions: [{ id: "q1", question: "Ce vrei?", type: "text", options: null }],
      },
      { goal: "Vreau să mă dezvolt" },
    );

    const guarded = applyClarificationRoundGuard(normalized, { goal: "Vreau să mă dezvolt" });
    assert.equal(guarded.ok, true);
    assert.equal(guarded.payload.status, "needs_clarification");
  });

  it("repairs second-round clarification to ready when model complies", async () => {
    let callCount = 0;
    const fetchFn = async (url) => {
      if (!url.includes("openai.com")) {
        throw new Error("unexpected");
      }
      callCount += 1;
      const status = callCount === 1 ? "needs_clarification" : "ready";
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    status,
                    categorySlug: status === "ready" ? "cariera" : null,
                    confidence: status === "ready" ? 0.86 : 0.2,
                    suggestedName: status === "ready" ? "Dezvoltare personală" : null,
                    normalizedGoal: null,
                    shortSummary: null,
                    detectedIntent: null,
                    firstStepTitle: null,
                    firstStepDescription: null,
                    suggestedToolId: null,
                    recommendationReason: null,
                    message: status === "needs_clarification" ? "Mai am nevoie de detalii" : null,
                    questions:
                      status === "needs_clarification"
                        ? [{ id: "focus", question: "Pe ce vrei să te focusezi?", type: "text", options: null }]
                        : [],
                  }),
                },
              },
            ],
          };
        },
      };
    };

    const result = await analyzeProjectIntent(
      {
        goal: "Vreau să mă dezvolt",
        clarificationAnswers: [{ questionId: "focus", answer: "Carieră" }],
      },
      { fetchFn, apiKey: "test" },
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.status, "ready");
    assert.equal(result.result.categorySlug, "cariera");
    assert.equal(callCount, 2);
  });

  it("converts persistent second-round clarification to unsupported", async () => {
    const fetchFn = async (url) => {
      if (!url.includes("openai.com")) {
        throw new Error("unexpected");
      }
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    status: "needs_clarification",
                    categorySlug: null,
                    confidence: 0.2,
                    suggestedName: null,
                    normalizedGoal: null,
                    shortSummary: null,
                    detectedIntent: null,
                    firstStepTitle: null,
                    firstStepDescription: null,
                    suggestedToolId: null,
                    recommendationReason: null,
                    message: "Mai am nevoie de detalii",
                    questions: [{ id: "focus", question: "Ce vrei?", type: "text", options: null }],
                  }),
                },
              },
            ],
          };
        },
      };
    };

    const result = await analyzeProjectIntent(
      {
        goal: "Vreau să mă dezvolt",
        clarificationAnswers: [{ questionId: "focus", answer: "Carieră" }],
      },
      { fetchFn, apiKey: "test" },
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.status, "unsupported");
    assert.equal(result.result.message, CLARIFICATION_ROUND_UNSUPPORTED_MESSAGE);
  });

  it("returns ready for clear platform AI launch goal", async () => {
    const fetchFn = async (url) => {
      if (!url.includes("openai.com")) {
        throw new Error("unexpected");
      }
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    status: "ready",
                    categorySlug: "business",
                    confidence: 0.93,
                    suggestedName: "Lansare platformă AI",
                    normalizedGoal:
                      "Vreau să lansez propria mea platformă AI pentru piața din România",
                    shortSummary: null,
                    detectedIntent: null,
                    firstStepTitle: null,
                    firstStepDescription: null,
                    suggestedToolId: null,
                    recommendationReason: null,
                    message: null,
                    questions: [],
                  }),
                },
              },
            ],
          };
        },
      };
    };

    const result = await analyzeProjectIntent(
      { goal: "Vreau să lansez propria mea platformă AI pentru piața din România" },
      { fetchFn, apiKey: "test" },
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.status, "ready");
    assert.equal(result.result.categorySlug, "business");
    assert.equal(hasClarificationAnswers({ clarificationAnswers: [] }), false);
  });
});

describe("analyzeProjectIntent service", () => {
  it("returns needs_clarification for vague goals from model", async () => {
    const fetchFn = async (url) => {
      if (!url.includes("openai.com")) {
        throw new Error("unexpected");
      }
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    status: "needs_clarification",
                    categorySlug: null,
                    confidence: 0.2,
                    suggestedName: null,
                    normalizedGoal: null,
                    shortSummary: null,
                    detectedIntent: null,
                    firstStepTitle: null,
                    firstStepDescription: null,
                    suggestedToolId: null,
                    recommendationReason: null,
                    message: "Am nevoie de puțin mai mult context",
                    questions: [
                      { id: "focus", question: "Ce vrei să îmbunătățești mai exact?", type: "text", options: null },
                    ],
                  }),
                },
              },
            ],
          };
        },
      };
    };

    const result = await analyzeProjectIntent(
      { goal: "Vreau să mă dezvolt" },
      { fetchFn, apiKey: "test" },
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.status, "needs_clarification");
    assert.ok(result.result.questions.length <= 2);
  });

  it("does not expose raw provider errors", async () => {
    const fetchFn = async () => ({ ok: false, status: 500 });
    const result = await analyzeProjectIntent(
      { goal: "Vreau să deschid o cafenea în Timișoara" },
      { fetchFn, apiKey: "test" },
    );
    assert.equal(result.ok, false);
    assert.equal(result.kind, "upstream");
  });
});

describe("category slug constraints", () => {
  it("allows only canonical project slugs", () => {
    assert.equal(isValidIntentCategorySlug("business"), true);
    assert.equal(isValidIntentCategorySlug("socialMedia"), true);
    assert.equal(isValidIntentCategorySlug("social-media"), false);
  });
});
