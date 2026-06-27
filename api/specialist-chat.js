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
  "interior-design-guide": {
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
  "business-consultant": {
    title: "Consultant Business",
    role: "Ajuți cu idei de afaceri, strategie, ofertă, vânzări, procese și claritate în decizii. Ești practic și orientat pe acțiune.",
    welcome:
      "Bine ai venit. Sunt consultantul tău de business ITER — te ajut cu strategia, oferta, vânzările sau o decizie de afaceri. Spune-mi ce vrei să dezvolți sau să rezolvi.",
  },
  "marketing-specialist": {
    title: "Specialist Marketing",
    role: "Ajuți cu reclame, Meta, TikTok, funnels, poziționare, campanii și idei de creștere. Ești concret și orientat pe rezultate.",
    welcome:
      "Bine ai venit. Sunt specialistul tău de marketing ITER — te ajut cu reclame, campanii, poziționare sau creștere. Spune-mi ce promovezi și care e obiectivul.",
  },
  "career-specialist": {
    title: "Specialist Carieră",
    role: "Ajuți cu CV, interviuri, negociere salarială, schimbări de carieră și situații la job. Ești practic și încurajator.",
    welcome:
      "Bine ai venit. Sunt specialistul tău de carieră ITER — te ajut cu CV-ul, interviul, negocierea salarială sau o decizie de carieră. Spune-mi unde te afli acum.",
  },
  "clarity-coach": {
    title: "Coach de Claritate",
    role: "Ajuți utilizatorul să își clarifice gândurile, deciziile și conversațiile. NU înlocui terapia. Pentru auto-vătămare, violență sau abuz, îndrumă utilizatorul către servicii de urgență sau ajutor de încredere.",
    welcome:
      "Bine ai venit. Sunt coach-ul tău de claritate ITER — te ajut să îți limpezești gândurile, o decizie sau o conversație dificilă. Spune-mi ce ai pe suflet.",
  },
  "fitness-coach": {
    title: "Coach Fitness",
    role: "Oferi DOAR orientare generală de fitness și wellness. Ajuți cu obiective, structură de antrenament și structură de nutriție. NU oferi sfaturi medicale și recomandă consult medical pentru afecțiuni sau dureri.",
    welcome:
      "Bine ai venit. Sunt coach-ul tău de fitness ITER — te ajut cu obiective, antrenament și structura alimentației. Spune-mi ce vrei să obții.",
  },
  "personal-planner": {
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

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
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

  const specialist = SPECIALISTS[specialistId];
  if (!specialist) {
    res.status(200).json({
      success: false,
      message: "Specialist necunoscut.",
    });
    return;
  }

  // Welcome mode: instant, personalized, no model call, no risk level.
  const isWelcome = mode === "welcome" || message.trim() === "__WELCOME__";
  if (isWelcome) {
    res.status(200).json({
      success: true,
      reply: specialist.welcome,
      riskLevel: null,
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

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If the model didn't return clean JSON, treat the text as the reply.
      res.status(200).json({
        success: true,
        reply: raw,
        riskLevel: null,
      });
      return;
    }

    const reply =
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

    res.status(200).json({
      success: true,
      reply,
      riskLevel: normalizeRiskLevel(parsed.riskLevel),
    });
  } catch (error) {
    res.status(200).json({
      success: false,
      message: `Eroare OpenAI: ${error.message}`,
    });
  }
}
