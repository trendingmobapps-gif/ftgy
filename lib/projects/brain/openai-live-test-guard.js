export function isOpenAiLiveTestsEnabled() {
  return process.env.OPENAI_LIVE_TESTS === "1";
}

export function requireOpenAiLiveTestsOrSkip(label = "live OpenAI smoke") {
  if (isOpenAiLiveTestsEnabled()) {
    return true;
  }

  console.log(
    `SKIP  ${label}: set OPENAI_LIVE_TESTS=1 to run live OpenAI smoke tests against Preview. ` +
      "Use a separate development OpenAI project/key with a low budget.",
  );
  process.exit(0);
}

export function readLiveSmokeProjectCap(defaultCap = 2) {
  const parsed = Number(process.env.OPENAI_LIVE_SMOKE_PROJECT_CAP || defaultCap);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultCap;
  }
  return Math.min(parsed, defaultCap);
}
