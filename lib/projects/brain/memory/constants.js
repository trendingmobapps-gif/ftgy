export const PROJECT_MEMORY_SOURCES = ["session", "resource", "upload", "workflow", "system"];

export const PROJECT_MEMORY_SELECT_COLUMNS = [
  "id",
  "project_id",
  "user_id",
  "memory_key",
  "memory_value",
  "source",
  "confidence",
  "created_at",
  "updated_at",
].join(",");

export const MEMORY_FIELD_ALIASES = {
  produs: ["produs", "product", "subiect", "tema"],
  buget: ["buget", "budget"],
  locatie: ["locatie", "location", "oras", "city"],
  publicTinta: ["public", "audience", "clienti"],
  obiectiv: ["obiectiv", "goal", "scop"],
  nume: ["nume", "name", "brand"],
  deadline: ["deadline", "termen", "data"],
  nivel: ["nivel", "level"],
};
