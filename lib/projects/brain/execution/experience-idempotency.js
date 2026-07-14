const CACHE = new Map();
const TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(actionId, idempotencyKey) {
  return `${actionId}:${idempotencyKey}`;
}

export function getCachedExperienceExecution(actionId, idempotencyKey) {
  if (!actionId || !idempotencyKey) return null;
  const key = cacheKey(actionId, idempotencyKey);
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return entry.result;
}

export function cacheExperienceExecution(actionId, idempotencyKey, result) {
  if (!actionId || !idempotencyKey || !result) return;
  CACHE.delete(cacheKey(actionId, idempotencyKey));
  CACHE.set(cacheKey(actionId, idempotencyKey), {
    createdAt: Date.now(),
    result,
  });
}

export function resetExperienceIdempotencyForTests() {
  CACHE.clear();
}
