const inFlight = new Map();

export function tryAcquireGenerationLock(projectId) {
  if (!projectId) return false;
  if (inFlight.has(projectId)) return false;
  inFlight.set(projectId, Date.now());
  return true;
}

export function releaseGenerationLock(projectId) {
  if (!projectId) return;
  inFlight.delete(projectId);
}

export function resetGenerationLocksForTests() {
  inFlight.clear();
}

export function isGenerationLocked(projectId) {
  return inFlight.has(projectId);
}
