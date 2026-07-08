// Vercel Serverless Function: POST /api/specialist-chat
// Powers the "Vorbește cu ITER Specialist" feature as a real, multi-turn chat.
//
// ITER Specialist is a conversational GUIDE — it offers orientation, opinions,
// preparation steps, checklists and questions for a real professional. It never
// gives definitive professional advice (no diagnosis, no final legal/financial
// conclusions, no dangerous technical instructions).
//
// Request body:
//   { specialistId, message, conversation: [{role, content}], mode }
//   - mode "welcome" or message "__WELCOME__" -> short personalized welcome.
//   - otherwise -> conversational reply with a risk level.
//
// Response shape (always JSON):
//   success: { success: true, reply: "<markdown>", riskLevel: "green|yellow|orange|red|null" }
//   error:   { success: false, message: "<error>" }

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

// Generic safe redirect for clearly disallowed requests (illegal, fraud,
// hacking, weapons, drugs, explicit sexual content, hate, violence).
const UNSAFE_MESSAGE =
  "Îmi pare rău, dar nu pot ajuta cu această solicitare. Hai să ne întoarcem la situația ta și să o organizăm împreună.";

// Supportive message for self-harm / suicide / acute crisis. We never refuse
// these coldly — we point the user to immediate human help.
const CRISIS_MESSAGE =
  "Îmi pare rău că treci prin asta și nu ești singur. Nu sunt un serviciu de urgență, dar dacă te gândești să îți faci rău sau ești în pericol, te rog contactează IMEDIAT serviciul de urgență **112** (în România) sau mergi la cea mai apropiată cameră de gardă. Poți suna și la **Telefonul Verde Antisuicid 0800 801 200**. Dacă vrei, pot rămâne aici și putem vorbi despre ce te apasă.";

// Self-harm / suicide / acute crisis terms (Romanian + English). Handled with
// the supportive CRISIS_MESSAGE, NOT the generic refusal.
const CRISIS_LIST = [
  "sinucid", "sa ma sinucid", "să mă sinucid", "ma sinucid", "mă sinucid",
  "vreau sa mor", "vreau să mor", "nu mai vreau sa traiesc",
  "nu mai vreau să trăiesc", "tai venele", "îmi tai venele", "imi tai venele",
  "sa imi fac rau", "să îmi fac rău", "ma tai", "mă tai",
  "suicide", "kill myself", "want to die", "end my life", "self harm",
  "self-harm", "hurt myself",
];

// Hard-blocked terms (vulgar/explicit, hate, violence threats, illegal, fraud,
// hacking, drugs, weapons, terrorism). Handled with UNSAFE_MESSAGE.
const BLOCKLIST = [
  // Romanian profanity / insults
  "pula", "pizda", "muie", "muist", "futu", "fut ", "fute", "futut",
  "cacat", "căcat", "curva", "curvă", "curve", "tarfa", "târfă",
  "sugi", "sug pula", "bag pula", "coaie",
  // English profanity / insults
  "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick", "pussy",
  "whore", "slut", "motherfucker", "faggot", "nigger", "nigga",
  // Sexual / explicit
  "porn", "porno", "pornografie", "sex explicit", "xxx", "masturb",
  "blowjob", "anal sex", "incest", "pedofil", "pedophile", "child porn",
  "minori sex",
  // Hate speech / violence / threats
  "te omor", "sa te omor", "să te omor", "omor pe", "te injunghii",
  "kill you", "i will kill", "school shooting", "genocid", "exterminare",
  // Illegal / fraud / hacking / drugs / weapons / terrorism
  "cum sa fur", "cum să fur", "spalare de bani", "spălare de bani",
  "card clonat", "clonare card", "frauda card", "fraudă card", "phishing",
  "cum sparg", "cum să sparg", "sparg parola", "hack ", "hacking", "ddos",
  "ransomware", "malware keylogger", "cumpar droguri", "cumpăr droguri",
  "vand droguri", "vând droguri", "cocaina", "cocaină", "heroina", "heroină",
  "metamfetamina", "cum fac o bomba", "cum să fac o bombă", "fac o bomba",
  "build a bomb", "make a bomb", "arma de foc ilegal", "atac terorist",
  "terrorist attack", "isis",
];

function containsAny(text, list) {
  const normalized = String(text || "").toLowerCase();
  return list.some((term) => normalized.includes(term));
}

// ---------------------------------------------------------------------------
// Models — strongest first, fall back when unavailable on the account.
// ---------------------------------------------------------------------------

const SPECIALIST_MODELS = ["gpt-5.5", "gpt-5.3", "gpt-5.1", "gpt-5", "gpt-4.1"];

// Newer GPT-5 family models only accept the default temperature.
function supportsCustomTemperature(model) {
  return model.startsWith("gpt-4");
}

function isModelUnavailableError(status, errText) {
  if (status === 404) return true;
  const t = String(errText || "").toLowerCase();
  return (
    t.includes("does not exist") ||
    t.includes("do not have access") ||
    t.includes("not have access") ||
    t.includes("unknown model") ||
    t.includes("invalid model") ||
    t.includes("model_not_found") ||
    t.includes("is not supported")
  );
}

// Calls chat completions, trying SPECIALIST_MODELS in order. Falls back only on
// availability errors; other errors stop and are surfaced.
async function callSpecialistModel(messages, apiKey) {
  let lastError = "";
  for (const model of SPECIALIST_MODELS) {
    const body = {
      model,
      response_format: { type: "json_object" },
      messages,
    };
    if (supportsCustomTemperature(model)) {
      body.temperature = 0.6;
    }

    let openaiRes;
    try {
      openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastError = e?.message || "network error";
      continue;
    }

    if (openaiRes.ok) {
      const data = await openaiRes.json();
      return { data };
    }

    const errText = await openaiRes.text();
    lastError = errText;
    if (!isModelUnavailableError(openaiRes.status, errText)) break;
  }
  return { error: lastError };
}

// ---------------------------------------------------------------------------
// Specialists
// ---------------------------------------------------------------------------

// Each specialist has a human title, a role description used to steer the model,
// and a personalized welcome message returned instantly in welcome mode.
const SPECIALISTS = {
  "legal-guide": {
    title: "Ghid Juridic",
    role: "Oferi DOAR orientare juridică generală. Ajuți utilizatorul să își organizeze faptele, documentele, riscurile și întrebările pentru un avocat. NU oferi concluzii juridice finale și nu garanta rezultate în instanță.",
    welcome:
      "Bine ai venit. Sunt ghidul tău juridic ITER, te ajut să îți organizezi situația și să înțelegi ce întrebări să pregătești pentru un avocat. Spune-mi pe scurt ce s-a întâmplat.",
  },
  "medical-guide": {
    title: "Ghid Medical",
    role: "Oferi DOAR orientare medicală generală. Ajuți utilizatorul să își descrie simptomele și să pregătească întrebări pentru medic. NU pune diagnostic și NU prescrie tratamente. Pentru simptome urgente (durere în piept, dificultăți de respirație, semne de AVC, sângerări mari, gânduri de auto-vătămare), spune-i clar să sune la 112 sau să meargă la camera de gardă.",
    welcome:
      "Bine ai venit. Sunt ghidul tău medical ITER — te ajut să îți descrii simptomele clar și să pregătești întrebările pentru medic. Nu pun diagnostic. Spune-mi ce te deranjează.",
  },
  "fiscal-guide": {
    title: "Ghid Fiscal",
    role: "Oferi DOAR orientare fiscală generală. Ajuți utilizatorul să înțeleagă SRL, PFA, TVA, facturi, dividende, ANAF și ce întrebări să pună contabilului. NU oferi concluzii fiscale definitive ca un consultant autorizat.",
    welcome:
      "Bine ai venit. Sunt ghidul tău fiscal ITER — te ajut să înțelegi SRL, PFA, TVA, facturi sau ANAF și ce să întrebi contabilul. Spune-mi care e situația ta.",
  },
  "financial-guide": {
    title: "Ghid Financiar",
    role: "Oferi DOAR orientare financiară generală. Ajuți cu bugetare, datorii, economii, credite și încadrarea deciziilor. NU oferi sfaturi de investiții garantate și nu promite randamente.",
    welcome:
      "Bine ai venit. Sunt ghidul tău financiar ITER — te ajut cu bugetul, datoriile, economiile sau o decizie financiară. Spune-mi ce vrei să clarifici.",
  },
  "architecture-guide": {
    title: "Ghid Arhitectură",
    role: "Oferi DOAR orientare generală de pregătire în arhitectură. Ajuți la pregătirea temei de proiectare, întrebărilor de urbanism și a documentelor. NU crea planuri tehnice și nu oferi calcule structurale.",
    welcome:
      "Bine ai venit. Sunt ghidul tău de arhitectură ITER — te ajut să îți pregătești tema de proiectare și întrebările pentru arhitect. Spune-mi ce vrei să construiești sau să amenajezi.",
  },
  "construction-guide": {
    title: "Ghid Construcții",
    role: "Oferi DOAR orientare generală pentru construcții/renovări. Ajuți cu etapele, materialele, întrebări de buget și întrebări pentru constructor. NU oferi instrucțiuni tehnice periculoase (electrice, structurale, gaz).",
    welcome:
      "Bine ai venit. Sunt ghidul tău de construcții ITER — te ajut cu etapele, bugetul și întrebările pentru constructor. Spune-mi ce vrei să construiești sau să renovezi.",
  },
  "interior-guide": {
    title: "Ghid Design Interior",
    role: "Oferi idei de design interior: sugestii de layout, culori, direcție pentru mobilier și orientare la cumpărături. Poți fi creativ și concret.",
    welcome:
      "Bine ai venit. Sunt ghidul tău de design interior ITER — te ajut cu idei de amenajare, culori și mobilier. Spune-mi despre ce spațiu vorbim și ce stil îți place.",
  },
  "auto-guide": {
    title: "Ghid Auto",
    role: "Oferi DOAR orientare auto generală. Ajuți utilizatorul să descrie simptomele mașinii și să pregătească întrebări pentru service. NU înlocui inspecția mecanicului și nu garanta cauza exactă a defecțiunii.",
    welcome:
      "Bine ai venit. Sunt ghidul tău auto ITER — te ajut să descrii problema mașinii și să pregătești întrebările pentru service. Spune-mi ce se întâmplă cu mașina.",
  },
  "business-guide": {
    title: "Consultant Business",
    role: "Ajuți cu idei de afaceri, strategie, ofertă, vânzări, procese și claritate în decizii. Ești practic și orientat pe acțiune.",
    welcome:
      "Bine ai venit. Sunt consultantul tău de business ITER — te ajut cu strategia, oferta, vânzările sau o decizie de afaceri. Spune-mi ce vrei să dezvolți sau să rezolvi.",
  },
  "marketing-guide": {
    title: "Specialist Marketing",
    role: "Ajuți cu reclame, Meta, TikTok, funnels, poziționare, campanii și idei de creștere. Ești concret și orientat pe rezultate.",
    welcome:
      "Bine ai venit. Sunt specialistul tău de marketing ITER — te ajut cu reclame, campanii, poziționare sau creștere. Spune-mi ce promovezi și care e obiectivul.",
  },
  "career-guide": {
    title: "Specialist Carieră",
    role: "Ajuți cu CV, interviuri, negociere salarială, schimbări de carieră și situații la job. Ești practic și încurajator.",
    welcome:
      "Bine ai venit. Sunt specialistul tău de carieră ITER — te ajut cu CV-ul, interviul, negocierea salarială sau o decizie de carieră. Spune-mi unde te afli acum.",
  },
  "clarity-guide": {
    title: "Coach de Claritate",
    role: "Ajuți utilizatorul să își clarifice gândurile, deciziile și conversațiile. NU înlocui terapia. Pentru auto-vătămare, violență sau abuz, îndrumă utilizatorul către servicii de urgență sau ajutor de încredere.",
    welcome:
      "Bine ai venit. Sunt coach-ul tău de claritate ITER — te ajut să îți limpezești gândurile, o decizie sau o conversație dificilă. Spune-mi ce ai pe suflet.",
  },
  "fitness-guide": {
    title: "Coach Fitness",
    role: "Oferi DOAR orientare generală de fitness și wellness. Ajuți cu obiective, structură de antrenament și structură de nutriție. NU oferi sfaturi medicale și recomandă consult medical pentru afecțiuni sau dureri.",
    welcome:
      "Bine ai venit. Sunt coach-ul tău de fitness ITER — te ajut cu obiective, antrenament și structura alimentației. Spune-mi ce vrei să obții.",
  },
  "personal-guide": {
    title: "Planificator Personal",
    role: "Ajuți cu organizare, planificare, obiective, vacanțe, program și logistica vieții. Ești structurat și practic.",
    welcome:
      "Bine ai venit. Sunt planificatorul tău personal ITER — te ajut cu organizarea, programul, un obiectiv sau o vacanță. Spune-mi ce vrei să pui în ordine.",
  },
};

const VALID_RISK = new Set(["green", "yellow", "orange", "red"]);

// Normalizes the model's riskLevel into one of the allowed values or null.
function normalizeRiskLevel(raw) {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return VALID_RISK.has(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(specialist, isFirstProblem) {
  return `Ești ITER Specialist, un ghid conversațional specializat. Rolul tău curent: ${specialist.title}.

Specializarea ta:
${specialist.role}

Ce ești:
- Un ghid care oferă orientare generală, opinii, clarificări, pași de pregătire, checklist-uri, întrebări pentru un specialist real și pașii următori.

Ce NU ești și ce NU faci NICIODATĂ:
- NU oferi sfaturi profesionale definitive.
- NU pui diagnostice medicale și nu prescrii tratamente.
- NU oferi instrucțiuni de tratament.
- NU dai concluzii juridice finale.
- NU garantezi sfaturi financiare sau randamente.
- NU oferi instrucțiuni tehnice de inginerie/proiectare.
- NU oferi instrucțiuni periculoase sau ilegale.
- Reamintește, atunci când e relevant, că decizia finală aparține unui specialist real autorizat.

Siguranță:
- Pentru urgențe medicale, gânduri de auto-vătămare, violență sau abuz: spune clar utilizatorului să contacteze imediat serviciile de urgență, iar în România menționează 112.
- Refuză politicos cererile ilegale, frauduloase, de hacking, arme, droguri, conținut sexual explicit, instigare la ură sau instrucțiuni periculoase și readu conversația pe un teren sigur.

Stil și formatare:
- Scrie în limba română.
- "reply" trebuie să fie Markdown curat: **bold** pentru etichete importante, titluri (##) doar când ajută, buline pentru claritate.
- NU returna HTML. NU încadra răspunsul într-un bloc de cod. NU menționa Markdown.
- Implicit concis și practic: de obicei 80-180 de cuvinte. Mai lung DOAR dacă utilizatorul cere explicit detalii.

${
  isFirstProblem
    ? `Acesta este PRIMUL mesaj în care utilizatorul își descrie problema. Analizează situația, stabilește nivelul de risc și răspunde structurat, dar concis, folosind EXACT aceste secțiuni:
## Pe scurt
## Nivel de risc ITER
## Ce pare important
## Ce poți face acum
## Ce să pregătești pentru specialist
## Întrebări bune pentru specialistul real
Permite utilizatorului să continue conversația după acest răspuns.`
    : `Aceasta este o conversație în curs. Continuă natural, folosește contextul de mai sus, răspunde la întrebarea de follow-up a utilizatorului. NU repeta toată structura inițială de fiecare dată; păstrează răspunsurile mai scurte și conversaționale. Actualizează nivelul de risc doar dacă s-a schimbat ceva relevant.`
}

Nivel de risc (riskLevel):
- "green": orientare simplă, urgență mică.
- "yellow": necesită atenție, mai mult context sau planificare atentă.
- "orange": utilizatorul ar trebui să consulte un specialist real înainte de a acționa.
- "red": urgent/risc mare; utilizatorul nu ar trebui să amâne și ar trebui să contacteze un specialist real sau serviciile de urgență când e cazul.

Răspunde STRICT cu un obiect JSON valid, fără text în plus, în forma:
{"reply": "<răspuns în Markdown>", "riskLevel": "green" | "yellow" | "orange" | "red"}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Origins allowed to call this endpoint from the browser (Wix web + local dev).
const allowedOrigins = [
  "https://www.iterai.ro",
  "https://iterai.ro",
  "https://iter.ro",
  "http://localhost:3000",
  "http://localhost:5173",
];

// Reflects the request Origin when it is in the allowlist; otherwise falls back
// to the primary production origin. A specific origin (not "*") is required so
// the browser accepts responses when auth headers are involved.
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = allowedOrigins.includes(origin)
    ? origin
    : "https://www.iterai.ro";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-iter-secret, Cache-Control, Pragma, X-Requested-With",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

// Picks the first non-empty string from a list of candidate values.
function firstNonEmpty(...candidates) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }
  return "";
}

// --- Chat title helpers (no AI; derived from the first user message) ---
function cleanTextForTitle(value) {
  return String(value || "")
    .replace(/[#*_`>\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstMeaningfulUserMessage(messages = []) {
  if (!Array.isArray(messages)) return "";
  const userMessage = messages.find((msg) => {
    if (!msg || typeof msg !== "object") return false;
    const role = String(msg.role || msg.sender || "").toLowerCase();
    const content = msg.content || msg.message || msg.text || "";
    return role === "user" && String(content).trim().length > 5;
  });
  if (!userMessage) return "";
  return userMessage.content || userMessage.message || userMessage.text || "";
}

// True when a title is empty or a generic auto-title that should be replaced.
function isGenericChatTitle(title) {
  const t = cleanTextForTitle(title).toLowerCase();
  if (!t || t.length <= 3) return true;
  return (
    t === "chat iter" ||
    t.startsWith("chat -") ||
    t.startsWith("chat-") ||
    /^chat\s+\S/.test(t) ||
    t.startsWith("conversație iter") ||
    t.startsWith("conversatie iter") ||
    t.startsWith("specialist chat") ||
    t.startsWith("iter specialist")
  );
}

// Builds a short Romanian topic title (max 10 words) from message text.
function deriveTitleFromText(source) {
  const clean = cleanTextForTitle(source);
  if (!clean) return "";
  const title = clean
    .replace(/^vreau să\s+/i, "")
    .replace(/^aș vrea să\s+/i, "")
    .replace(/^as vrea să\s+/i, "")
    .replace(/^am nevoie de\s+/i, "")
    .replace(/^ajută-mă să\s+/i, "")
    .replace(/^ajuta-ma să\s+/i, "")
    .replace(/^spune-mi\s+/i, "");
  const words = title.split(" ").filter(Boolean).slice(0, 10);
  const finalTitle = words.join(" ");
  if (!finalTitle) return "";
  return finalTitle.charAt(0).toUpperCase() + finalTitle.slice(1);
}

// Resolves the title to save: keep an existing useful title, otherwise derive a
// topic title from the first meaningful user message; else use the fallback.
function resolveChatTitleForSave({ existingTitle, messages, fallback }) {
  if (existingTitle && !isGenericChatTitle(existingTitle)) {
    return cleanTextForTitle(existingTitle).slice(0, 90);
  }
  const derived = deriveTitleFromText(
    extractFirstMeaningfulUserMessage(messages),
  );
  if (derived) return derived.slice(0, 90);
  return existingTitle || fallback;
}

// Builds the base URL of the incoming request so internal API calls target the
// same host/deployment instead of a hardcoded domain.
function getRequestBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  return host ? `${proto}://${host}` : "";
}

// Calls the internal POST /api/consume-free-generation endpoint. Returns
// { ok, status, data } and never throws.
async function callConsumeFreeGeneration({
  baseUrl,
  secret,
  email,
  specialistSlug,
  chatSessionId,
  idempotencyKey,
}) {
  try {
    const resp = await fetch(`${baseUrl}/api/consume-free-generation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-iter-secret": secret,
      },
      body: JSON.stringify({
        email,
        actionType: "specialist_chat",
        specialistSlug,
        chatSessionId,
        idempotencyKey,
        metadata: {
          source: "api/specialist-chat.js",
        },
      }),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.message || "network error",
    };
  }
}

// --- Supabase REST helpers (chat_sessions dual-write) ---
// These talk directly to the Supabase REST API using the same conventions as
// the other endpoints in this project. They never throw.

// Select rows from a Supabase table using a filtered GET query.
async function supabaseSelect({ baseUrl, secretKey, table, query }) {
  try {
    const resp = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
      method: "GET",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });
    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.message || "network error",
    };
  }
}

// Upsert a row into a Supabase table (merge on the given conflict column).
async function supabaseUpsert({ baseUrl, secretKey, table, row, onConflict }) {
  try {
    const url = `${baseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(
      onConflict,
    )}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
    });
    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.message || "network error",
    };
  }
}

// Dual-write the completed specialist chat into public.chat_sessions. Returns
// { saved, error } and NEVER throws, so a Supabase failure can never break the
// AI response. Wix chathistory remains the source of truth in parallel.
async function saveSpecialistChatToSupabase({
  email,
  chatSessionId,
  specialistSlug,
  specialistName,
  memberId,
  messagesJson,
  assistantReply,
  idempotencyKey,
  accessType,
}) {
  const baseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!baseUrl || !secretKey) {
    return { saved: false, error: "Supabase is not configured." };
  }

  try {
    // Look up profile_id by email (best-effort; never fatal).
    let profileId = null;
    const profileLookup = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "profiles",
      query: `email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
    });
    if (
      profileLookup.ok &&
      Array.isArray(profileLookup.data) &&
      profileLookup.data.length > 0
    ) {
      profileId = profileLookup.data[0].id || null;
    }

    // Preserve an existing chat_title if this session already exists.
    let existingTitle = null;
    const existing = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "chat_sessions",
      query: `wix_item_id=eq.${encodeURIComponent(
        chatSessionId,
      )}&select=chat_title&limit=1`,
    });
    if (
      existing.ok &&
      Array.isArray(existing.data) &&
      existing.data.length > 0 &&
      existing.data[0].chat_title
    ) {
      existingTitle = existing.data[0].chat_title;
    }

    const preview =
      typeof assistantReply === "string" ? assistantReply.slice(0, 100) : "";

    // Derive a topic title once, from the first meaningful user message, unless
    // a useful (non-generic) title already exists. Never calls AI.
    const resolvedTitle = resolveChatTitleForSave({
      existingTitle,
      messages: messagesJson,
      fallback: `Specialist Chat - ${specialistName || specialistSlug}`,
    });

    console.log("[chat title generated]", {
      chatSessionId,
      source: "specialist-chat",
      title: resolvedTitle,
    });

    const row = {
      email,
      wix_item_id: chatSessionId,
      member_id: memberId || null,
      chat_type: "specialist",
      category_slug: null,
      category_name: specialistName || null,
      specialist_slug: specialistSlug,
      chat_title: resolvedTitle,
      messages_json: Array.isArray(messagesJson) ? messagesJson : [],
      tools_json: [],
      last_message_preview: preview,
      source: "vercel",
      metadata: {
        source: "api/specialist-chat.js",
        lastIdempotencyKey: idempotencyKey || null,
        accessType: accessType || null,
        updatedFrom: "specialist_chat",
        chatTitle: resolvedTitle,
      },
      updated_at: new Date().toISOString(),
    };
    // Only set profile_id when we actually found one, so we never overwrite an
    // existing linkage with null.
    if (profileId) {
      row.profile_id = profileId;
    }

    const result = await supabaseUpsert({
      baseUrl,
      secretKey,
      table: "chat_sessions",
      row,
      onConflict: "wix_item_id",
    });

    if (!result.ok) {
      return {
        saved: false,
        error: "Supabase chat_sessions upsert failed.",
      };
    }

    return { saved: true, error: null };
  } catch (error) {
    return {
      saved: false,
      error: error?.message || "Unexpected error saving chat session.",
    };
  }
}

// Resolves specialist-chat access DIRECTLY against Supabase (no internal HTTP
// hop). Specialist chat is independent from the 8 tool categories:
//   - categorySlug is never required or used.
//   - Only premium / all access counts as paid access.
//   - Category-only access does NOT count as paid access here.
//   - Free users may use free generations.
// Returns one of:
//   { internalError: true, errorCode, errorMessage }        -> true server error
//   { internalError: false, access: { ...accessShape } }    -> resolved access
// NEVER throws and NEVER exposes secrets.
async function resolveSpecialistAccess({ email }) {
  const baseUrl = process.env.SUPABASE_URL;
  // Support either secret key name; use whichever exists.
  const secretKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!baseUrl || !secretKey) {
    return {
      internalError: true,
      errorCode: "missing_supabase_env",
      errorMessage: "Supabase environment is not configured.",
    };
  }

  try {
    const nowMs = Date.now();

    // 1. Find the profile by email.
    const profileLookup = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "profiles",
      query: `email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    });

    if (!profileLookup.ok) {
      return {
        internalError: true,
        errorCode: "profile_query_failed",
        errorMessage: "Could not query the profiles table.",
      };
    }

    const profile =
      Array.isArray(profileLookup.data) && profileLookup.data.length > 0
        ? profileLookup.data[0]
        : null;

    // Profile not found: treat like no access (not an internal error).
    if (!profile) {
      return {
        internalError: false,
        access: {
          success: true,
          email,
          hasAccess: false,
          accessType: null,
          shouldRedirectToCheckout: true,
          reason: "profile_not_found",
          freeGenerations: 0,
        },
      };
    }

    // 2. Fetch active user_access rows for this email.
    const accessLookup = await supabaseSelect({
      baseUrl,
      secretKey,
      table: "user_access",
      query: `email=eq.${encodeURIComponent(
        email,
      )}&status=eq.active&select=*`,
    });

    if (!accessLookup.ok) {
      return {
        internalError: true,
        errorCode: "access_query_failed",
        errorMessage: "Could not query the user_access table.",
      };
    }

    const accessRows = Array.isArray(accessLookup.data)
      ? accessLookup.data
      : [];
    // Active = status active AND (no expiry OR expiry in the future).
    const activeRows = accessRows.filter((row) => {
      if (!row || row.status !== "active") return false;
      if (!row.expires_at) return true;
      const t = new Date(row.expires_at).getTime();
      return Number.isNaN(t) ? true : t > nowMs;
    });

    // Premium: access_scope = "all" OR plan = "premium".
    // Category-only access is intentionally ignored for specialist chat.
    const isPremium = activeRows.some(
      (row) => row.access_scope === "all" || row.plan === "premium",
    );

    if (isPremium) {
      return {
        internalError: false,
        access: {
          success: true,
          email,
          hasAccess: true,
          accessType: "premium",
          shouldRedirectToCheckout: false,
          reason: "premium_access",
          freeGenerations: null,
        },
      };
    }

    // 3. Not premium: check free generations via usage_limits
    //    (by profile_id first, then by email as a fallback).
    let usageRow = null;

    if (profile.id) {
      const byProfile = await supabaseSelect({
        baseUrl,
        secretKey,
        table: "usage_limits",
        query: `profile_id=eq.${encodeURIComponent(
          profile.id,
        )}&select=*&limit=1`,
      });
      if (
        byProfile.ok &&
        Array.isArray(byProfile.data) &&
        byProfile.data.length > 0
      ) {
        usageRow = byProfile.data[0];
      }
    }

    if (!usageRow) {
      const byEmail = await supabaseSelect({
        baseUrl,
        secretKey,
        table: "usage_limits",
        query: `email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
      });
      if (
        byEmail.ok &&
        Array.isArray(byEmail.data) &&
        byEmail.data.length > 0
      ) {
        usageRow = byEmail.data[0];
      }
    }

    const remaining =
      usageRow && Number.isFinite(Number(usageRow.free_generations_remaining))
        ? Number(usageRow.free_generations_remaining)
        : 0;

    if (remaining > 0) {
      return {
        internalError: false,
        access: {
          success: true,
          email,
          hasAccess: true,
          accessType: "free_trial",
          shouldRedirectToCheckout: false,
          reason: "free_trial_available",
          freeGenerations: remaining,
        },
      };
    }

    // No paid access and no free generations left.
    return {
      internalError: false,
      access: {
        success: true,
        email,
        hasAccess: false,
        accessType: null,
        shouldRedirectToCheckout: true,
        reason: "no_paid_access_and_no_free_generations",
        freeGenerations: 0,
      },
    };
  } catch (error) {
    return {
      internalError: true,
      errorCode: "access_check_internal_error",
      errorMessage: error?.message || "Unexpected error during access check.",
    };
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(200).json({
      success: false,
      message: "Metodă invalidă. Folosește POST.",
    });
    return;
  }

  // Parse body (may arrive as a JSON string).
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(200).json({
        success: false,
        message: "Body invalid. Trimite JSON valid.",
      });
      return;
    }
  }
  body = body || {};

  const specialistId =
    typeof body.specialistId === "string" ? body.specialistId.trim() : "";
  const message = typeof body.message === "string" ? body.message : "";
  const mode = typeof body.mode === "string" ? body.mode.trim() : "";
  const conversation = Array.isArray(body.conversation)
    ? body.conversation
    : [];

  // Prefer the explicit specialistSlug; fall back to the legacy specialistId.
  const specialistSlug = firstNonEmpty(body.specialistSlug, specialistId);

  const specialist = SPECIALISTS[specialistSlug];
  if (!specialist) {
    res.status(200).json({
      success: false,
      message: "Specialist necunoscut.",
    });
    return;
  }

  // Access / free-trial consumption fields (optional; sent by the frontend).
  const normalizedEmail = firstNonEmpty(
    body.email,
    body.userEmail,
    body.memberEmail,
    body.clientEmail,
  ).toLowerCase();
  // Prefer a frontend-supplied chat session id; otherwise generate a fallback.
  const chatSessionId =
    firstNonEmpty(body.chatSessionId, body.sessionId, body.conversationId) ||
    randomUUID();
  // Prefer a frontend-supplied idempotency key; otherwise generate a fallback so
  // consume-free-generation stays idempotent per request.
  const idempotencyKey =
    firstNonEmpty(
      body.idempotencyKey,
      body.messageId,
      body.chatMessageId,
      body.requestId,
    ) || randomUUID();
  // Optional Wix member id and display name, used for the chat_sessions row.
  const memberId = firstNonEmpty(body.memberId, body.wixMemberId) || null;
  const specialistName =
    firstNonEmpty(body.specialistName) || specialist.title || null;

  // Welcome mode: instant, personalized, no model call, no risk level.
  // Welcome messages are system/init messages: never check access, never
  // consume free generations, and never save to Supabase.
  const isWelcome = mode === "welcome" || message.trim() === "__WELCOME__";
  if (isWelcome) {
    res.status(200).json({
      success: true,
      reply: specialist.welcome,
      riskLevel: null,
      accessCheckSkipped: true,
      accessCheckReason: "welcome_message",
      usageConsumptionSkipped: true,
      chatSessionSaved: false,
    });
    return;
  }

  if (!message.trim()) {
    res.status(200).json({
      success: false,
      message: "Te rugăm să scrii un mesaj.",
    });
    return;
  }

  // Safety pass 1a: crisis / self-harm -> supportive message with 112.
  if (containsAny(message, CRISIS_LIST)) {
    res.status(200).json({
      success: true,
      reply: CRISIS_MESSAGE,
      riskLevel: "red",
    });
    return;
  }

  // Safety pass 1b: hard blocklist -> safe redirect.
  if (containsAny(message, BLOCKLIST)) {
    res.status(200).json({
      success: true,
      reply: UNSAFE_MESSAGE,
      riskLevel: null,
    });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(200).json({
      success: false,
      message: "OPENAI_API_KEY nu este setat în mediul Vercel.",
    });
    return;
  }

  // --- Access control (direct Supabase check) + free-trial consumption setup ---
  // The consumption call after OpenAI still uses these (non-fatal if missing).
  const internalSecret = process.env.ITER_INTERNAL_API_SECRET;
  const requestBaseUrl = getRequestBaseUrl(req);

  // When no email is provided, keep the legacy behavior intact (temporary,
  // until the Wix frontend sends the user email). We flag why the check was
  // skipped and continue the specialist chat flow exactly as before.
  const accessCheckSkipped = !normalizedEmail;
  // Populated after a successful access check; included in the response.
  let accessCheckResult = null;
  // Resolved after a successful access check; used for consumption + save.
  let accessType = null;

  if (!accessCheckSkipped) {
    // Direct Supabase access check (no internal HTTP hop). Specialist chat does
    // NOT use categorySlug, and only premium/all access counts as paid access.
    const resolved = await resolveSpecialistAccess({ email: normalizedEmail });

    if (resolved.internalError) {
      // TRUE internal error only (missing env / query failure / unexpected
      // throw). Log the real cause to Vercel; return a safe message + code.
      console.error(
        "[v0] specialist-chat access check internal error:",
        resolved.errorCode,
        resolved.errorMessage,
      );
      res.status(200).json({
        success: false,
        message: "Nu am putut verifica accesul. Te rugăm să încerci din nou.",
        accessCheckErrorCode: resolved.errorCode,
        accessCheckErrorMessage: resolved.errorMessage,
      });
      return;
    }

    // Attach specialistSlug to the access result for the success response.
    accessCheckResult = { ...resolved.access, specialistSlug };
    accessType = resolved.access.accessType || null;

    if (resolved.access.hasAccess !== true) {
      // Normal no-access case (no premium and no free generations): do NOT call
      // OpenAI and do NOT consume usage. Return a structured "free limit
      // reached" response so the frontend can keep the chat open and show an
      // in-chat upgrade CTA instead of auto-redirecting to the pricing page.
      res.status(402).json({
        success: false,
        code: "FREE_LIMIT_REACHED",
        upgradeRequired: true,
        shouldRedirectToCheckout: false,
        upgradeUrl: "/preturi",
        hasAccess: false,
        reason:
          resolved.access.reason || "no_paid_access_and_no_free_generations",
        freeGenerations: resolved.access.freeGenerations,
        message:
          "Ai folosit toate generările gratuite. Pentru a continua conversația și pentru a folosi platforma mai departe, alege un plan Premium.",
      });
      return;
    }
  }

  try {
    // Safety pass 2: OpenAI Moderation API. If flagged, do NOT continue.
    try {
      const modRes = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: message,
        }),
      });
      if (modRes.ok) {
        const modData = await modRes.json();
        const result = modData?.results?.[0];
        if (result?.flagged === true) {
          const cats = result.categories || {};
          const selfHarm =
            cats["self-harm"] ||
            cats["self-harm/intent"] ||
            cats["self-harm/instructions"];
          res.status(200).json({
            success: true,
            reply: selfHarm ? CRISIS_MESSAGE : UNSAFE_MESSAGE,
            riskLevel: selfHarm ? "red" : null,
          });
          return;
        }
      }
    } catch {
      // If moderation fails, continue — the local blocklist already ran.
    }

    // A real problem exists the first time there is no prior assistant turn.
    const hasAssistantTurn = conversation.some(
      (t) => t && t.role === "assistant" && String(t.content || "").trim(),
    );
    const isFirstProblem = !hasAssistantTurn;

    // Build messages: system + recent history (capped) + new message.
    const MAX_HISTORY_TURNS = 12;
    const recentConversation =
      conversation.length > MAX_HISTORY_TURNS
        ? conversation.slice(-MAX_HISTORY_TURNS)
        : conversation;

    const messages = [
      { role: "system", content: buildSystemPrompt(specialist, isFirstProblem) },
    ];
    for (const turn of recentConversation) {
      if (!turn || typeof turn !== "object") continue;
      const role = turn.role === "assistant" ? "assistant" : "user";
      const content = typeof turn.content === "string" ? turn.content : "";
      if (content.trim()) messages.push({ role, content });
    }
    messages.push({ role: "user", content: message });

    const { data, error: modelError } = await callSpecialistModel(
      messages,
      apiKey,
    );

    if (!data) {
      res.status(200).json({
        success: false,
        message: `Eroare OpenAI: ${modelError || "model indisponibil"}`,
      });
      return;
    }

    const raw = data?.choices?.[0]?.message?.content?.trim() || "";
    if (!raw) {
      res.status(200).json({
        success: false,
        message: "Eroare OpenAI: răspuns gol.",
      });
      return;
    }

    // Resolve the reply + riskLevel. If the model didn't return clean JSON,
    // treat the raw text as the reply (with a null risk level).
    let reply = "";
    let riskLevel = null;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    if (parsed) {
      reply =
        typeof parsed.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : "";
      if (!reply) {
        res.status(200).json({
          success: false,
          message: "Eroare OpenAI: răspuns gol.",
        });
        return;
      }
      riskLevel = normalizeRiskLevel(parsed.riskLevel);
    } else {
      reply = raw;
      riskLevel = null;
    }

    // Legacy path: no email supplied. Preserve existing behavior and flag it.
    // Do NOT consume free generations or save to Supabase without an email.
    if (accessCheckSkipped) {
      res.status(200).json({
        success: true,
        reply,
        riskLevel,
        accessCheckSkipped: true,
        accessCheckReason: "missing_email",
      });
      return;
    }

    // Authenticated path: the AI response succeeded, so now (and only now)
    // consume a free generation. consume-free-generation decides server-side
    // whether to actually consume (never for premium/all-access users).
    const responsePayload = {
      success: true,
      reply,
      riskLevel,
      accessCheck: accessCheckResult,
      idempotencyKey,
      chatSessionId,
    };

    const consume = await callConsumeFreeGeneration({
      baseUrl: requestBaseUrl,
      secret: internalSecret,
      email: normalizedEmail,
      specialistSlug,
      chatSessionId,
      idempotencyKey,
    });

    if (consume.ok && consume.data) {
      responsePayload.usageConsumption = consume.data;
    } else {
      // The AI reply is valid; do not fail the request just because the
      // consumption call failed. Surface a safe warning instead.
      console.log(
        "[v0] specialist-chat consume-free-generation failed:",
        consume.status,
        consume.error || JSON.stringify(consume.data || {}).slice(0, 500),
      );
      responsePayload.consumptionWarning = true;
      responsePayload.consumptionError =
        "Nu am putut actualiza utilizarea. Răspunsul a fost generat.";
    }

    // --- Dual-write to Supabase public.chat_sessions ---
    // Wix chathistory stays active in parallel; this mirrors the same chat into
    // Supabase. A Supabase failure NEVER blocks the AI response.
    // The incoming conversation already contains the user message; append the
    // assistant reply (preserving riskLevel).
    const messagesJson = [
      ...conversation,
      {
        role: "assistant",
        content: reply,
        riskLevel: riskLevel || null,
      },
    ];

    const chatSave = await saveSpecialistChatToSupabase({
      email: normalizedEmail,
      chatSessionId,
      specialistSlug,
      specialistName,
      memberId,
      messagesJson,
      assistantReply: reply,
      idempotencyKey,
      accessType,
    });

    responsePayload.chatSessionSaved = chatSave.saved === true;
    if (!chatSave.saved) {
      console.log(
        "[v0] specialist-chat chat_sessions save failed:",
        chatSave.error,
      );
      responsePayload.chatSessionSaveWarning = true;
      responsePayload.chatSessionSaveError =
        "Nu am putut salva conversația în Supabase. Răspunsul a fost generat.";
    }

    res.status(200).json(responsePayload);
  } catch (error) {
    res.status(200).json({
      success: false,
      message: `Eroare OpenAI: ${error.message}`,
    });
  }
}
