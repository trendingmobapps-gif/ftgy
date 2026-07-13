const WEB_RESEARCH_MARKERS = [
  "lege",
  "tax",
  "autoriz",
  "concurent",
  "piata",
  "furnizor",
  "universitat",
  "job",
  "trend",
];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function evaluateWebSearchNeed({ project, step, memoryMap = new Map() }) {
  const haystack = normalize(`${project?.goal || ""} ${step?.title || ""} ${step?.expected_outcome || ""}`);
  const shouldSearch = WEB_RESEARCH_MARKERS.some((marker) => haystack.includes(marker));

  if (!shouldSearch) {
    return {
      shouldSearch: false,
      query: null,
      executed: false,
      stubbed: true,
    };
  }

  const query = `${step?.title || "proiect"} ${project?.goal || ""}`.trim().slice(0, 180);

  return {
    shouldSearch: true,
    query,
    executed: false,
    stubbed: true,
    note: "Web search decision recorded; execution remains stubbed in Phase 1C.4.",
  };
}

export function applyWebSearchStub(decision) {
  if (!decision?.requiresWebSearch) {
    return { applied: false, snippets: [] };
  }

  return {
    applied: true,
    executed: false,
    snippets: [],
    note: "Fresh information layer deferred; generation proceeds with project memory.",
  };
}
