import { validateBrainSnapshot } from "./schema.js";

export function serializeBrainSnapshotForMemory(snapshot) {
  const validation = validateBrainSnapshot(snapshot);
  if (!validation.valid) {
    return {
      ok: false,
      errorCategory: "snapshot_validation_failed",
      errors: validation.errors,
    };
  }

  let serialized;
  try {
    serialized = JSON.stringify(snapshot);
  } catch (error) {
    return {
      ok: false,
      errorCategory: "snapshot_serialization_failed",
      reason: error?.message || "json_stringify_failed",
    };
  }

  if (typeof serialized !== "string") {
    return {
      ok: false,
      errorCategory: "snapshot_serialization_failed",
      reason: "serialized_value_not_string",
    };
  }

  const byteLength = Buffer.byteLength(serialized, "utf8");
  return {
    ok: true,
    serialized,
    byteLength,
    snapshot,
  };
}

export function deserializeBrainSnapshotFromMemory(value) {
  if (value == null || value === "") {
    return { ok: false, errorCategory: "snapshot_readback_failed", reason: "empty_value" };
  }

  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch (error) {
    return {
      ok: false,
      errorCategory: "snapshot_readback_failed",
      reason: error?.message || "json_parse_failed",
    };
  }

  const validation = validateBrainSnapshot(parsed);
  if (!validation.valid) {
    return {
      ok: false,
      errorCategory: "snapshot_readback_failed",
      reason: "readback_schema_invalid",
      errors: validation.errors,
    };
  }

  return { ok: true, snapshot: parsed };
}
