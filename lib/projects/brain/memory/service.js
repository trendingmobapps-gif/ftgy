import { MEMORY_FIELD_ALIASES } from "./constants.js";
import {
  listProjectMemory,
  memoryRowsToMap,
  upsertProjectMemoryFacts,
} from "./repository.js";

function normalizeKey(key) {
  return String(key || "")
    .trim()
    .replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`)
    .replace(/[^a-z0-9_]/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

export function extractMemoryFactsFromInput(collectedInput = {}, project = null) {
  const facts = {};

  for (const [key, value] of Object.entries(collectedInput || {})) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    facts[normalizeKey(key)] = trimmed;
  }

  if (project?.name?.trim()) {
    facts.nume = project.name.trim();
  }
  if (project?.goal?.trim()) {
    facts.obiectiv = project.goal.trim();
  }

  return facts;
}

export async function getProjectMemoryMap({ baseUrl, secretKey, userId, projectId }) {
  const listed = await listProjectMemory({ baseUrl, secretKey, userId, projectId });
  if (!listed.ok) {
    return { ok: false, map: new Map(), versions: new Map() };
  }

  const versions = new Map();
  for (const row of listed.rows) {
    if (!versions.has(row.memory_key)) {
      versions.set(row.memory_key, row.updated_at || row.created_at || row.id || null);
    }
  }

  return { ok: true, map: memoryRowsToMap(listed.rows), versions };
}

export async function recordProjectMemory({
  baseUrl,
  secretKey,
  userId,
  projectId,
  facts,
  source = "session",
}) {
  return upsertProjectMemoryFacts({
    baseUrl,
    secretKey,
    userId,
    projectId,
    facts,
    source,
  });
}

export function memoryHasKnownField(memoryMap, fieldKey) {
  const normalized = normalizeKey(fieldKey);
  const aliases = MEMORY_FIELD_ALIASES[normalized] || [normalized];
  return aliases.some((alias) => {
    const value = memoryMap.get(alias);
    return Boolean(String(value || "").trim());
  });
}

export function mergeMemoryIntoMissingFields(missingFields = [], memoryMap = new Map()) {
  return missingFields.filter((field) => !memoryHasKnownField(memoryMap, field.key));
}
