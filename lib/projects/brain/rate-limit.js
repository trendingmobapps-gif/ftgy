const buckets = new Map();

export function checkBrainRateLimit(userId, { maxPerHour = 20, now = Date.now() } = {}) {
  if (!userId) {
    return { allowed: false };
  }

  const windowMs = 60 * 60 * 1000;
  const key = String(userId);
  const current = buckets.get(key) || [];
  const fresh = current.filter((timestamp) => now - timestamp < windowMs);

  if (fresh.length >= maxPerHour) {
    buckets.set(key, fresh);
    return { allowed: false, retryAfterMs: windowMs - (now - fresh[0]) };
  }

  fresh.push(now);
  buckets.set(key, fresh);
  return { allowed: true };
}

export function resetBrainRateLimitForTests() {
  buckets.clear();
}
