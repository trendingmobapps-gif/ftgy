import { PROJECT_CATEGORY_SLUGS } from "./constants.js";

export const PROJECT_ACCENT_KEYS = [
  "navy",
  "lime",
  "blue",
  "violet",
  "amber",
  "coral",
  "teal",
  "rose",
];

/** @deprecated alias kept for persisted rows */
export const LEGACY_ACCENT_ALIASES = {
  accent: "lime",
};

export const PROJECT_ICON_DEFINITIONS = [
  {
    key: "coffee",
    keywords: ["cafea", "cafenea", "coffee", "espresso", "barista", "cafe-bar"],
    categories: ["business"],
    accentFamilies: ["amber", "coral", "teal"],
    priority: 12,
  },
  {
    key: "storefront",
    keywords: ["magazin", "retail", "salon", "butic", "shop", "storefront", "restaurant"],
    categories: ["business"],
    accentFamilies: ["amber", "coral", "navy"],
    priority: 11,
  },
  {
    key: "rocket",
    keywords: ["lansare", "lansez", "startup", "platforma", "platformă", "launch", "go-to-market"],
    categories: ["business"],
    accentFamilies: ["navy", "violet", "blue"],
    priority: 10,
  },
  {
    key: "sparkles",
    keywords: ["ai", "inteligent", "automat", "automatizare", "iter", "asistent"],
    categories: ["business", "comunicare", "socialMedia"],
    accentFamilies: ["violet", "blue", "lime"],
    priority: 10,
  },
  {
    key: "brain",
    keywords: ["creier", "machine learning", "ml", "model", "neural"],
    categories: ["business", "studii"],
    accentFamilies: ["violet", "navy", "blue"],
    priority: 9,
  },
  {
    key: "bolt",
    keywords: ["aplicatie", "aplicație", "app", "software", "produs digital", "mvp"],
    categories: ["business"],
    accentFamilies: ["blue", "violet", "navy"],
    priority: 9,
  },
  {
    key: "megaphone",
    keywords: ["marketing", "promovare", "promovez", "publicitate", "ads", "campanie"],
    categories: ["business", "socialMedia", "comunicare"],
    accentFamilies: ["coral", "amber", "rose"],
    priority: 10,
  },
  {
    key: "chartLine",
    keywords: ["vanzari", "vânzări", "analiza", "analiză", "kpi", "raport", "crestere", "creștere"],
    categories: ["business", "finante"],
    accentFamilies: ["navy", "teal", "blue"],
    priority: 8,
  },
  {
    key: "book",
    keywords: [
      "carte",
      "lectura",
      "lectură",
      "invat",
      "învăț",
      "studiu",
      "pregatire",
      "pregătire",
      "materie",
      "lectie",
      "lecție",
      "bacalaureat",
      "bac",
    ],
    categories: ["studii"],
    accentFamilies: ["blue", "teal", "navy"],
    priority: 12,
  },
  {
    key: "graduation",
    keywords: ["facultate", "admitere", "licenta", "licență", "diploma", "diplomă", "absolvire"],
    categories: ["studii"],
    accentFamilies: ["navy", "violet", "blue"],
    priority: 11,
  },
  {
    key: "document",
    keywords: ["document", "fisier", "fișier", "examen", "test", "tema", "temă", "referat"],
    categories: ["studii", "cariera", "finante"],
    accentFamilies: ["navy", "blue", "teal"],
    priority: 9,
  },
  {
    key: "pencil",
    keywords: ["scriu", "scriere", "redactare", "eseu", "eseuri", "notite", "notițe"],
    categories: ["studii", "comunicare", "socialMedia"],
    accentFamilies: ["teal", "blue", "violet"],
    priority: 8,
  },
  {
    key: "briefcase",
    keywords: ["cv", "curriculum", "job", "interviu", "angajare", "cariera", "carieră", "profesional"],
    categories: ["cariera"],
    accentFamilies: ["navy", "teal", "blue"],
    priority: 12,
  },
  {
    key: "person",
    keywords: ["profil", "personal branding", "linkedin", "networking"],
    categories: ["cariera", "comunicare"],
    accentFamilies: ["navy", "teal", "violet"],
    priority: 8,
  },
  {
    key: "target",
    keywords: ["obiectiv", "tinta", "țintă", "slabesc", "slăbesc", "slabit", "slăbit", "fitness", "kg"],
    categories: ["fitness", "viataPersonala"],
    accentFamilies: ["lime", "teal", "coral"],
    priority: 12,
  },
  {
    key: "scale",
    keywords: ["greutate", "cantar", "cântar", "pierd", "masa", "masă", "macro"],
    categories: ["fitness"],
    accentFamilies: ["teal", "lime", "coral"],
    priority: 11,
  },
  {
    key: "leaf",
    keywords: ["nutritie", "nutriție", "sanatate", "sănătate", "wellness", "alimentatie", "alimentație"],
    categories: ["fitness", "viataPersonala"],
    accentFamilies: ["lime", "teal", "rose"],
    priority: 9,
  },
  {
    key: "flag",
    keywords: ["maraton", "alergare", "cursa", "probă", "proba", "challenge"],
    categories: ["fitness"],
    accentFamilies: ["coral", "amber", "lime"],
    priority: 8,
  },
  {
    key: "wallet",
    keywords: ["buget", "economii", "economisesc", "bani", "venit", "cheltuieli", "datorii"],
    categories: ["finante"],
    accentFamilies: ["teal", "navy", "blue"],
    priority: 12,
  },
  {
    key: "home",
    keywords: ["casa", "casă", "apartament", "locuinta", "locuință", "chirie", "imobiliare"],
    categories: ["finante", "viataPersonala"],
    accentFamilies: ["teal", "amber", "coral"],
    priority: 11,
  },
  {
    key: "building",
    keywords: ["constructie", "construcție", "renovare", "proprietate"],
    categories: ["finante", "business"],
    accentFamilies: ["navy", "teal", "amber"],
    priority: 8,
  },
  {
    key: "airplane",
    keywords: ["vacanta", "vacanță", "calatorie", "călătorie", "zbor", "avion", "turism"],
    categories: ["viataPersonala"],
    accentFamilies: ["blue", "teal", "violet"],
    priority: 12,
  },
  {
    key: "map",
    keywords: ["harta", "hartă", "itinerar", "ruta", "rută", "planificare vacanta"],
    categories: ["viataPersonala"],
    accentFamilies: ["blue", "teal", "violet"],
    priority: 10,
  },
  {
    key: "suitcase",
    keywords: ["bagaj", "valiza", "valiză", "city break", "excursie"],
    categories: ["viataPersonala"],
    accentFamilies: ["coral", "amber", "blue"],
    priority: 9,
  },
  {
    key: "mapPin",
    keywords: ["destinatie", "destinație", "locatie", "locație", "oras", "oraș", "japonia", "timisoara"],
    categories: ["viataPersonala", "business"],
    accentFamilies: ["violet", "blue", "coral"],
    priority: 8,
  },
  {
    key: "chat",
    keywords: ["comunicare", "mesaje", "conversatie", "conversație", "negociere", "prezentare"],
    categories: ["comunicare"],
    accentFamilies: ["rose", "violet", "teal"],
    priority: 10,
  },
  {
    key: "paperplane",
    keywords: ["outreach", "pitch", "email", "mesaj", "propunere"],
    categories: ["comunicare", "business"],
    accentFamilies: ["blue", "navy", "teal"],
    priority: 7,
  },
  {
    key: "camera",
    keywords: ["instagram", "tiktok", "continut", "conținut", "video", "foto", "reels", "postari"],
    categories: ["socialMedia"],
    accentFamilies: ["rose", "coral", "violet"],
    priority: 12,
  },
  {
    key: "mic",
    keywords: ["podcast", "muzica", "muzică", "voce", "audio"],
    categories: ["socialMedia", "comunicare"],
    accentFamilies: ["violet", "rose", "coral"],
    priority: 9,
  },
  {
    key: "waveform",
    keywords: ["podcast", "sound", "inregistrare", "înregistrare"],
    categories: ["socialMedia", "comunicare"],
    accentFamilies: ["violet", "blue", "rose"],
    priority: 7,
  },
  {
    key: "heart",
    keywords: ["relatie", "relație", "cuplu", "familie", "emotional", "emoțional", "echilibru"],
    categories: ["viataPersonala", "comunicare"],
    accentFamilies: ["rose", "coral", "violet"],
    priority: 10,
  },
  {
    key: "shield",
    keywords: ["protectie", "protecție", "siguranta", "siguranță", "preventie", "prevenție"],
    categories: ["fitness", "viataPersonala"],
    accentFamilies: ["teal", "navy", "blue"],
    priority: 7,
  },
  {
    key: "calendar",
    keywords: ["organizare", "planificare", "agenda", "program", "termen", "deadline"],
    categories: ["viataPersonala", "business", "cariera"],
    accentFamilies: ["navy", "teal", "blue"],
    priority: 9,
  },
  {
    key: "folder",
    keywords: ["arhiva", "arhivă", "structura", "structură", "sistem", "organizez"],
    categories: ["viataPersonala", "business"],
    accentFamilies: ["navy", "teal", "lime"],
    priority: 8,
  },
  {
    key: "listBullet",
    keywords: ["checklist", "pasi", "pași", "todo", "task", "sarcini"],
    categories: ["viataPersonala", "business", "cariera"],
    accentFamilies: ["teal", "navy", "lime"],
    priority: 8,
  },
  {
    key: "lightbulb",
    keywords: ["idee", "idei", "creativ", "inovare", "strategie"],
    categories: ["business", "cariera", "studii"],
    accentFamilies: ["amber", "violet", "lime"],
    priority: 8,
  },
  {
    key: "scissors",
    keywords: ["frizerie", "beauty", "coafor", "design", "tailoring"],
    categories: ["business"],
    accentFamilies: ["rose", "coral", "violet"],
    priority: 8,
  },
  {
    key: "crown",
    keywords: ["excelenta", "excelență", "premium", "leadership"],
    categories: ["cariera", "business"],
    accentFamilies: ["amber", "navy", "violet"],
    priority: 6,
  },
  {
    key: "clock",
    keywords: ["timp", "rutina", "rutină", "productivitate", "ore"],
    categories: ["viataPersonala", "cariera"],
    accentFamilies: ["navy", "teal", "blue"],
    priority: 7,
  },
  {
    key: "tag",
    keywords: ["brand", "branding", "eticheta", "etichetă", "identitate"],
    categories: ["business", "socialMedia"],
    accentFamilies: ["violet", "coral", "amber"],
    priority: 7,
  },
  {
    key: "specialist",
    keywords: ["mentor", "coach", "consultant", "specialist"],
    categories: ["cariera", "business"],
    accentFamilies: ["navy", "teal", "violet"],
    priority: 6,
  },
  {
    key: "sliders",
    keywords: ["optimizare", "setari", "setări", "ajustare", "fine-tune"],
    categories: ["business"],
    accentFamilies: ["blue", "navy", "teal"],
    priority: 5,
  },
  {
    key: "wind",
    keywords: ["mindfulness", "relaxare", "meditatie", "meditație", "respiratie"],
    categories: ["viataPersonala", "fitness"],
    accentFamilies: ["teal", "blue", "lime"],
    priority: 6,
  },
  {
    key: "checkmark",
    keywords: ["obicei", "habit", "finalizare", "complet"],
    categories: ["viataPersonala"],
    accentFamilies: ["lime", "teal", "navy"],
    priority: 5,
  },
  {
    key: "layers",
    keywords: ["proiect", "general", "diverse"],
    categories: [...PROJECT_CATEGORY_SLUGS],
    accentFamilies: ["navy", "lime", "teal"],
    priority: 1,
  },
];

const ICON_KEY_SET = new Set(PROJECT_ICON_DEFINITIONS.map((item) => item.key));

const CATEGORY_FALLBACK_ICONS = {
  business: "rocket",
  studii: "book",
  cariera: "briefcase",
  fitness: "target",
  finante: "wallet",
  comunicare: "chat",
  socialMedia: "camera",
  viataPersonala: "heart",
};

const CATEGORY_FALLBACK_ACCENTS = {
  business: "navy",
  studii: "blue",
  cariera: "navy",
  fitness: "lime",
  finante: "teal",
  comunicare: "rose",
  socialMedia: "rose",
  viataPersonala: "coral",
};

const GLOBAL_FALLBACK_ICON = "layers";
const GLOBAL_FALLBACK_ACCENT = "teal";

const DIACRITICS_MAP = {
  ă: "a",
  â: "a",
  î: "i",
  ș: "s",
  ş: "s",
  ț: "t",
  ţ: "t",
};

export function normalizeProjectIconText(value) {
  return String(value || "")
    .toLowerCase()
    .split("")
    .map((char) => DIACRITICS_MAP[char] ?? char)
    .join("")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isAllowedProjectIconKey(value) {
  return typeof value === "string" && ICON_KEY_SET.has(value.trim());
}

export function isAllowedProjectAccentKey(value) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  if (PROJECT_ACCENT_KEYS.includes(trimmed)) {
    return true;
  }

  return Boolean(LEGACY_ACCENT_ALIASES[trimmed]);
}

export function normalizeProjectAccentKey(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (PROJECT_ACCENT_KEYS.includes(trimmed)) {
    return trimmed;
  }

  return LEGACY_ACCENT_ALIASES[trimmed] ?? null;
}

function isCategoryCompatible(definition, categorySlug) {
  if (!categorySlug) {
    return true;
  }

  return definition.categories.includes(categorySlug);
}

function scoreDefinition(definition, normalizedText) {
  if (!normalizedText) {
    return 0;
  }

  let score = 0;

  for (const keyword of definition.keywords) {
    const normalizedKeyword = normalizeProjectIconText(keyword);
    if (!normalizedKeyword) {
      continue;
    }

    if (normalizedText.includes(normalizedKeyword)) {
      score += Math.max(3, Math.min(12, normalizedKeyword.length));
    }
  }

  return score > 0 ? score + definition.priority : 0;
}

function stableHash(value) {
  let hash = 0;
  const text = String(value || "project");

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function pickAccent(definition, categorySlug, projectSeed, recentAccentKeys = []) {
  const families = definition?.accentFamilies?.length
    ? definition.accentFamilies
    : [CATEGORY_FALLBACK_ACCENTS[categorySlug] || GLOBAL_FALLBACK_ACCENT];

  const unused = families.filter((accent) => !recentAccentKeys.includes(accent));
  const pool = unused.length > 0 ? unused : families;
  const index = stableHash(`${projectSeed}:accent`) % pool.length;
  return pool[index] || GLOBAL_FALLBACK_ACCENT;
}

function rankDefinitions({ normalizedText, categorySlug }) {
  return PROJECT_ICON_DEFINITIONS.map((definition) => ({
    definition,
    score: scoreDefinition(definition, normalizedText),
    compatible: isCategoryCompatible(definition, categorySlug),
  }))
    .filter((entry) => entry.compatible && entry.score > 0)
    .sort((left, right) => right.score - left.score || right.definition.priority - left.definition.priority);
}

function chooseIconFromRanked(ranked, recentIconKeys = [], projectSeed = "project") {
  if (!ranked.length) {
    return null;
  }

  const topScore = ranked[0].score;
  const topTier = ranked.filter((entry) => entry.score >= topScore - 2);
  const unused = topTier.filter((entry) => !recentIconKeys.includes(entry.definition.key));
  const pool = unused.length > 0 ? unused : topTier;
  const index = stableHash(`${projectSeed}:icon`) % pool.length;
  return pool[index]?.definition ?? null;
}

function getCategoryFallbackDefinition(categorySlug) {
  const fallbackKey = CATEGORY_FALLBACK_ICONS[categorySlug] || GLOBAL_FALLBACK_ICON;
  return (
    PROJECT_ICON_DEFINITIONS.find((definition) => definition.key === fallbackKey) ||
    PROJECT_ICON_DEFINITIONS.find((definition) => definition.key === GLOBAL_FALLBACK_ICON)
  );
}

export function getAllowedProjectIconKeys() {
  return [...ICON_KEY_SET];
}

export function getAllowedProjectAccentKeys() {
  return [...PROJECT_ACCENT_KEYS];
}

export function resolveProjectIcons({
  goal = "",
  name = "",
  summary = "",
  categorySlug = null,
  suggestedIconKey = null,
  suggestedAccentKey = null,
  recentIconKeys = [],
  recentAccentKeys = [],
  projectId = null,
}) {
  const normalizedText = normalizeProjectIconText([goal, name, summary].filter(Boolean).join(" "));
  const projectSeed = projectId || normalizedText || "project";
  const ranked = rankDefinitions({ normalizedText, categorySlug });

  let selectedDefinition = null;

  if (isAllowedProjectIconKey(suggestedIconKey)) {
    const suggested = PROJECT_ICON_DEFINITIONS.find((item) => item.key === suggestedIconKey.trim());
    const semanticScore = suggested ? scoreDefinition(suggested, normalizedText) : 0;
    const compatible = suggested ? isCategoryCompatible(suggested, categorySlug) : false;

    if (suggested && compatible && (semanticScore > 0 || ranked.length === 0)) {
      selectedDefinition = suggested;
    }
  }

  if (!selectedDefinition) {
    selectedDefinition = chooseIconFromRanked(ranked, recentIconKeys, projectSeed);
  }

  if (!selectedDefinition && isAllowedProjectIconKey(suggestedIconKey)) {
    selectedDefinition = PROJECT_ICON_DEFINITIONS.find((item) => item.key === suggestedIconKey.trim()) || null;
  }

  if (!selectedDefinition) {
    selectedDefinition = getCategoryFallbackDefinition(categorySlug);
  }

  const iconKey = selectedDefinition?.key || GLOBAL_FALLBACK_ICON;

  let accentKey = normalizeProjectAccentKey(suggestedAccentKey);
  if (!accentKey || !isAllowedProjectAccentKey(accentKey)) {
    accentKey = pickAccent(selectedDefinition, categorySlug, projectSeed, recentAccentKeys);
  }

  if (!isCategoryCompatible(selectedDefinition, categorySlug)) {
    const fallbackDefinition = getCategoryFallbackDefinition(categorySlug);
    return {
      iconKey: fallbackDefinition?.key || GLOBAL_FALLBACK_ICON,
      accentKey: CATEGORY_FALLBACK_ACCENTS[categorySlug] || GLOBAL_FALLBACK_ACCENT,
    };
  }

  return { iconKey, accentKey };
}

export function attachResolvedIconsToReadyPayload(payload, input = {}, options = {}) {
  const resolved = resolveProjectIcons({
    goal: payload.normalizedGoal || input.goal || "",
    name: payload.suggestedName || input.optionalName || "",
    summary: payload.shortSummary || "",
    categorySlug: payload.categorySlug,
    suggestedIconKey: payload.iconKey,
    suggestedAccentKey: payload.accentKey,
    recentIconKeys: options.recentIconKeys || [],
    recentAccentKeys: options.recentAccentKeys || [],
    projectId: options.projectId || null,
  });

  return {
    ...payload,
    iconKey: resolved.iconKey,
    accentKey: resolved.accentKey,
  };
}

export function finalizeProjectIconFields(value, options = {}) {
  const resolved = resolveProjectIcons({
    goal: value.goal,
    name: value.name,
    summary: value.description || value.summary || "",
    categorySlug: value.categorySlug,
    suggestedIconKey: value.iconKey,
    suggestedAccentKey: value.accentKey,
    recentIconKeys: options.recentIconKeys || [],
    recentAccentKeys: options.recentAccentKeys || [],
    projectId: options.projectId || null,
  });

  return {
    ...value,
    iconKey: resolved.iconKey,
    accentKey: resolved.accentKey,
  };
}

export function sanitizeProjectIconFields(value) {
  const next = { ...value };

  if (next.iconKey && !isAllowedProjectIconKey(next.iconKey)) {
    next.iconKey = null;
  }

  const normalizedAccent = normalizeProjectAccentKey(next.accentKey);
  next.accentKey = normalizedAccent;

  return next;
}
