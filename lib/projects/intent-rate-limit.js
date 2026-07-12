const DEFAULT_LIMIT = 30;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

const buckets = new Map();

export function checkIntentRateLimit(userId, options = {}) {
  const limit = Number(options.limit) > 0 ? Number(options.limit) : DEFAULT_LIMIT;
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : DEFAULT_WINDOW_MS;
  const now = Date.now();
  const key = typeof userId === "string" ? userId : "";

  if (!key) {
    return { allowed: false, retryAfterSec: 60 };
  }

  const current = buckets.get(key);
  if (!current || now - current.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: limit - 1 };
  }

  if (current.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - current.windowStart)) / 1000));
    return { allowed: false, retryAfterSec };
  }

  current.count += 1;
  buckets.set(key, current);
  return { allowed: true, remaining: limit - current.count };
}

export function resetIntentRateLimitForTests() {
  buckets.clear();
}
