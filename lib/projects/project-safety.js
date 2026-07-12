export const PROJECT_SAFETY_REASON_CODES = [
  "fraud_or_deception",
  "theft_or_financial_crime",
  "cyber_abuse",
  "violence_or_weapons",
  "illegal_drugs_or_trafficking",
  "sexual_exploitation",
  "harassment_or_abuse",
  "privacy_invasion",
  "evasion_or_concealment",
  "other_illegal_harm",
];

export const PROJECT_SAFETY_BLOCKED_HTTP_STATUS = 422;

export const PROJECT_SAFETY_ERROR_CODE = "PROJECT_SAFETY_BLOCKED";

export const SAFETY_AUTHORIZATION_QUESTION_ID = "safety-authorization";

const DEFAULT_BLOCKED_MESSAGE =
  "Nu putem crea un proiect care facilită activități ilegale sau produce prejudicii altor persoane.";

const REASON_USER_MESSAGES = {
  fraud_or_deception:
    "Nu putem crea un proiect care facilită înșelarea sau frauda.",
  theft_or_financial_crime:
    "Nu putem crea un proiect care implică furt sau infracțiuni financiare.",
  cyber_abuse:
    "Nu putem crea un proiect care implică acces neautorizat sau prejudicierea altor persoane.",
  violence_or_weapons:
    "Nu putem crea un proiect care implică violență sau producerea de arme.",
  illegal_drugs_or_trafficking:
    "Nu putem crea un proiect care implică droguri ilegale sau trafic.",
  sexual_exploitation:
    "Nu putem crea un proiect care implică exploatare sexuală sau abuz.",
  harassment_or_abuse:
    "Nu putem crea un proiect care implică hărțuire, abuz sau intimidare.",
  privacy_invasion:
    "Nu putem crea un proiect care implică urmărire sau încălcarea intimității.",
  evasion_or_concealment:
    "Nu putem crea un proiect care implică evitarea legii sau ascunderea unor fapte ilegale.",
  other_illegal_harm: DEFAULT_BLOCKED_MESSAGE,
};

const DETERMINISTIC_ALLOW_PATTERNS = [
  /\bprotej(ez|are|eză)\b.*\b(site|server|cont|aplica[țt]ie|sistem)\b/i,
  /\b(?:împotriva|de)\s+(?:atacurilor|hackerilor|fraudelor|fraudei)\b/i,
  /\braport(ez|are)\b.*\b(?:fraud|fraudă|înșelătorie)\b/i,
  /\bplângere\s+penală\b/i,
  /\bînțeleg\b.*\b(?:taxe|obliga[țt]ii\s+fiscale)\b/i,
  /\bconform\b.*\b(?:taxe|fiscale|legale)\b/i,
  /\brecuper(are|ez)\b.*\bcont\b.*\bcompromis\b/i,
  /\broman\s+poli[țt]ist\b/i,
  /\b(?:dacă|daca)\b.*\b(?:este|e)\s+legal[ăa]?\b/i,
  /\bpreven(ire|rea)\b.*\b(?:fraud|atac|hack|înșelătorie)\b/i,
  /\beduca[țt]ie\b.*\b(?:securitate|cyber)\b/i,
  /\baudit\b.*\b(?:securitate|defensiv)\b/i,
  /\bdezintoxicare\b|\brecuperare\b.*\b(?:adic[țt]ie|dependen[țt]ă)\b/i,
  /\bplanificare\b.*\b(?:siguran[țt]ă|personală)\b/i,
  /\b(?:securizez|protejez)\b.*\b(?:apartament\w*|locuinț\w*|cas\w*)\b/i,
  /\b(?:împotriva|de)\s+furtur\w*\b/i,
  /\braport(ez|are)\b.*\b(?:furt\w*)\b/i,
  /\broman\b.*\b(?:jaf|furt)\b/i,
  /\bînțeleg\b.*\b(?:anchetă|ancheta|investigație)\b/i,
];

const DETERMINISTIC_BLOCK_RULES = [
  {
    reasonCode: "fraud_or_deception",
    patterns: [
      /\bpăcăl\w*\b/i,
      /\bînșel\w*\b/i,
      /\bescro\w*\b/i,
      /\bfraud\w*\b/i,
      /\bschemă\b.*\b(?:clienți|oameni|persoane)\b/i,
      /\bphishing\b/i,
    ],
  },
  {
    reasonCode: "theft_or_financial_crime",
    patterns: [
      /\bfur\w*\b/i,
      /\bfurt\b/i,
      /\bjefui\w*\b/i,
      /\bjaf\b/i,
      /\blaund(er|ering)\b/i,
      /\bmoney\s+laundering\b/i,
      /\bfalsific\w*\b.*\b(?:document\w*|acte|diplom\w*)\b/i,
    ],
  },
  {
    reasonCode: "cyber_abuse",
    patterns: [
      /\bsparg\s+cont/i,
      /\bintru\s+în\s+contul\b/i,
      /\bhack\w*\s+cont/i,
      /\bacces\s+neautorizat\b/i,
      /\bcredential\s+theft\b/i,
      /\b(?:distribu|lans)(?:ez|ui)\b.*\b(?:malware|ransomware|virus)\b/i,
      /\bspionez\b.*\b(?:cont|email|telefon)\b/i,
    ],
  },
  {
    reasonCode: "violence_or_weapons",
    patterns: [
      /\bconstruiesc\b.*\b(?:armă|bomba|explozibil)\b/i,
      /\bplanific\b.*\b(?:atac|omor|violență)\b/i,
      /\bkill\s+(?:someone|myself)\b/i,
    ],
  },
  {
    reasonCode: "illegal_drugs_or_trafficking",
    patterns: [
      /\bdroguri\b/i,
      /\btrafic\s+de\s+drog/i,
      /\bdistribu\w*\b.*\bdrog/i,
      /\borganizez\b.*\bdistribu\w*\b.*\bdrog/i,
      /\bproduc\w*\b.*\b(?:cocaină|heroină|metamfetamină)\b/i,
    ],
  },
  {
    reasonCode: "sexual_exploitation",
    patterns: [/\bexploatare\s+sexuală\b/i, /\babuz\s+sexual\b/i, /\btrafic\s+de\s+persoane\b/i],
  },
  {
    reasonCode: "harassment_or_abuse",
    patterns: [
      /\bhărțu\w*\b/i,
      /\bintimid\w*\b.*\b(?:țintit|persoană)\b/i,
      /\bcoerc\w*\b/i,
      /\bstalking\b/i,
    ],
  },
  {
    reasonCode: "privacy_invasion",
    patterns: [
      /\burmăresc\b.*\b(?:pe\s+ascuns|ascuns|telefon|partener)\b/i,
      /\bspionez\b.*\b(?:telefon|partener|parteneră)\b/i,
      /\bsurveillance\b.*\b(?:neautorizat|ilegal)\b/i,
      /\btrack\w*\b.*\b(?:fără\s+consimțământ|pe\s+ascuns)\b/i,
    ],
  },
  {
    reasonCode: "evasion_or_concealment",
    patterns: [
      /\bascund\b.*\b(?:bani|sume|profit)\b/i,
      /\bevad\w*\b.*\b(?:taxe|autorități|lege)\b/i,
      /\bascund\b.*\b(?:dovezi|proveniență)\b/i,
      /\bsanctions?\s+evasion\b/i,
    ],
  },
];

const AMBIGUOUS_SECURITY_PATTERNS = [
  /\btestez\s+securitatea\b/i,
  /\bpenetration\s+test\b/i,
  /\bpentest\b/i,
  /\btestez\s+un\s+site\b/i,
];

const AUTHORIZATION_CONTEXT_PATTERNS = [
  /\bal\s+meu\b/i,
  /\bautorizare\b/i,
  /\bpermisiune\b/i,
  /\bpropriu\b/i,
  /\bpropria\b/i,
  /\bam\s+voie\b/i,
];

const HIGH_RISK_KEYWORDS = [
  "păcăl",
  "înșel",
  "fraud",
  "sparg cont",
  "intru în cont",
  "droguri",
  "trafic de drog",
  "falsific",
  "ascund bani",
  "stalking",
  "malware",
  "ransomware",
];

export const PROJECT_SAFETY_MODEL = "gpt-4.1-mini";
export const PROJECT_SAFETY_TEMPERATURE = 0;
export const PROJECT_SAFETY_TIMEOUT_MS = 20_000;

export function normalizeSafetyReasonCode(value) {
  if (typeof value !== "string") {
    return "other_illegal_harm";
  }

  const normalized = value.trim();
  if (PROJECT_SAFETY_REASON_CODES.includes(normalized)) {
    return normalized;
  }

  return "other_illegal_harm";
}

export function getSafetyUserMessage(reasonCode) {
  const code = normalizeSafetyReasonCode(reasonCode);
  return REASON_USER_MESSAGES[code] || DEFAULT_BLOCKED_MESSAGE;
}

export function buildBlockedSafetyDecision(reasonCode, userMessage) {
  const normalizedCode = normalizeSafetyReasonCode(reasonCode);
  return {
    status: "blocked",
    reasonCode: normalizedCode,
    userMessage: userMessage || getSafetyUserMessage(normalizedCode),
  };
}

export function buildAllowedSafetyDecision() {
  return { status: "allowed" };
}

export function buildCombinedSafetyContext(input = {}) {
  const parts = [];

  if (typeof input.goal === "string" && input.goal.trim()) {
    parts.push(input.goal.trim());
  }

  const optionalName =
    (typeof input.optionalName === "string" && input.optionalName.trim()) ||
    (typeof input.name === "string" && input.name.trim()) ||
    "";

  if (optionalName) {
    parts.push(optionalName);
  }

  if (typeof input.description === "string" && input.description.trim()) {
    parts.push(input.description.trim());
  }

  if (Array.isArray(input.clarificationAnswers)) {
    for (const answer of input.clarificationAnswers) {
      if (typeof answer?.answer === "string" && answer.answer.trim()) {
        parts.push(answer.answer.trim());
      }
    }
  }

  return parts.join("\n");
}

export function splitClarificationAnswers(clarificationAnswers) {
  const safety = [];
  const category = [];

  for (const answer of clarificationAnswers || []) {
    if (typeof answer?.questionId === "string" && answer.questionId.startsWith("safety-")) {
      safety.push(answer);
      continue;
    }
    category.push(answer);
  }

  return { safety, category };
}

export function hasSafetyClarificationAnswers(clarificationAnswers) {
  return splitClarificationAnswers(clarificationAnswers).safety.length > 0;
}

export function buildSecurityAuthorizationClarification() {
  return {
    status: "needs_safety_clarification",
    message: "Am nevoie de o clarificare scurtă înainte de a continua.",
    questions: [
      {
        id: SAFETY_AUTHORIZATION_QUESTION_ID,
        question: "Este site-ul tău sau ai permisiunea explicită să îl testezi?",
        type: "single_choice",
        options: [
          {
            id: "yes",
            label: "Da, este al meu sau am autorizare",
            value: "da-autorizare",
          },
          {
            id: "no",
            label: "Nu",
            value: "nu-autorizare",
          },
          {
            id: "other",
            label: "Alt context",
            value: "alt-context",
          },
        ],
      },
    ],
  };
}

function matchesAnyPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function matchesHighRiskKeywords(context) {
  const normalized = context.toLowerCase();
  return HIGH_RISK_KEYWORDS.some((term) => normalized.includes(term));
}

export function evaluateSafetyClarificationAnswers(clarificationAnswers) {
  const { safety } = splitClarificationAnswers(clarificationAnswers);
  const authorizationAnswer = safety.find(
    (item) => item.questionId === SAFETY_AUTHORIZATION_QUESTION_ID,
  );

  if (!authorizationAnswer) {
    return buildBlockedSafetyDecision("cyber_abuse");
  }

  const value = String(authorizationAnswer.answer || "").toLowerCase();

  if (
    value.includes("nu-autorizare") ||
    value === "nu" ||
    value.includes("fără autorizare") ||
    value.includes("fara autorizare")
  ) {
    return buildBlockedSafetyDecision("cyber_abuse");
  }

  if (
    value.includes("da-autorizare") ||
    value.includes("autorizare") ||
    value.includes("al meu") ||
    value.includes("permisiune")
  ) {
    return buildAllowedSafetyDecision();
  }

  return null;
}

export function applyDeterministicSafetyRules(context, input = {}) {
  if (!context.trim()) {
    return buildAllowedSafetyDecision();
  }

  if (matchesAnyPattern(context, DETERMINISTIC_ALLOW_PATTERNS)) {
    return buildAllowedSafetyDecision();
  }

  for (const rule of DETERMINISTIC_BLOCK_RULES) {
    if (matchesAnyPattern(context, rule.patterns)) {
      return buildBlockedSafetyDecision(rule.reasonCode);
    }
  }

  if (matchesAnyPattern(context, AMBIGUOUS_SECURITY_PATTERNS)) {
    if (matchesAnyPattern(context, AUTHORIZATION_CONTEXT_PATTERNS)) {
      return buildAllowedSafetyDecision();
    }

    if (hasSafetyClarificationAnswers(input.clarificationAnswers)) {
      return null;
    }

    return {
      status: "needs_safety_clarification",
      payload: buildSecurityAuthorizationClarification(),
    };
  }

  return null;
}

function buildSafetyJsonSchema() {
  return {
    name: "project_safety_decision",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          enum: ["allowed", "blocked", "uncertain"],
        },
        reasonCode: {
          anyOf: [
            { type: "string", enum: [...PROJECT_SAFETY_REASON_CODES] },
            { type: "null" },
          ],
        },
        userMessage: { type: ["string", "null"] },
      },
      required: ["status", "reasonCode", "userMessage"],
    },
  };
}

function buildSafetySystemPrompt() {
  return `Ești evaluatorul de siguranță pentru proiectele ITER AI.

Analizezi obiectivul utilizatorului în limba română și decizi dacă proiectul poate fi creat în siguranță.

Permite proiecte legitime precum:
- înțelegerea legii, taxelor sau obligațiilor legale;
- raportarea unei fraude sau depunerea unei plângeri;
- protecția defensivă a site-urilor, conturilor sau sistemelor proprii;
- recuperarea unui cont compromis;
- educație în securitate cibernetică;
- scriere ficțională fără intenție operațională de rău;
- întrebări despre legalitatea unei acțiuni.

Blochează proiectele al căror scop principal este să faciliteze:
- fraudă, înșelăciune sau escrocherie;
- furt, spălare de bani sau infracțiuni financiare;
- acces neautorizat, malware, furt de credențiale;
- violență, arme sau planificarea unui prejudiciu fizic;
- droguri ilegale, trafic sau distribuție;
- exploatare sexuală sau abuz;
- hărțuire, stalking, intimidare;
- urmărire sau invazie a intimității fără consimțământ;
- evitarea legii, taxelor, sancțiunilor sau ascunderea unor fapte ilegale.

Nu bloca doar pe baza unor cuvinte izolate dacă intenția este legitimă și defensivă.
Nu returna detalii despre politici interne.
Folosește status=uncertain doar dacă nu poți decide în siguranță și există risc material.

reasonCode trebuie să fie EXACT unul din enum când status=blocked.
userMessage trebuie să fie scurt, în română, fără acuzații directe, fără detalii tehnice interne.`;
}

async function callSafetyClassifier(context, deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const apiKey = deps.apiKey || process.env.OPENAI_API_KEY || "";

  if (!apiKey) {
    return { ok: false, kind: "unavailable" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROJECT_SAFETY_TIMEOUT_MS);

  try {
    const response = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: PROJECT_SAFETY_MODEL,
        temperature: PROJECT_SAFETY_TEMPERATURE,
        response_format: {
          type: "json_schema",
          json_schema: buildSafetyJsonSchema(),
        },
        messages: [
          { role: "system", content: buildSafetySystemPrompt() },
          {
            role: "user",
            content: `Evaluează următorul obiectiv de proiect:\n\n${context}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, kind: "upstream", status: response.status };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, kind: "invalid_json" };
    }

    return { ok: true, parsed };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, kind: "timeout" };
    }
    return { ok: false, kind: "network" };
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeSafetyClassifierResult(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return buildBlockedSafetyDecision("other_illegal_harm");
  }

  const status = parsed.status;
  if (status === "allowed") {
    return buildAllowedSafetyDecision();
  }

  if (status === "blocked") {
    const reasonCode = normalizeSafetyReasonCode(parsed.reasonCode);
    const userMessage =
      (typeof parsed.userMessage === "string" && parsed.userMessage.trim()) ||
      getSafetyUserMessage(reasonCode);
    return buildBlockedSafetyDecision(reasonCode, userMessage);
  }

  return buildBlockedSafetyDecision("other_illegal_harm");
}

export async function evaluateProjectSafety(input = {}, deps = {}) {
  const context = buildCombinedSafetyContext(input);

  if (hasSafetyClarificationAnswers(input.clarificationAnswers)) {
    const clarificationDecision = evaluateSafetyClarificationAnswers(input.clarificationAnswers);
    if (clarificationDecision?.status === "blocked") {
      return clarificationDecision;
    }
  }

  const deterministic = applyDeterministicSafetyRules(context, input);
  if (deterministic?.status === "blocked") {
    return deterministic;
  }

  if (deterministic?.status === "needs_safety_clarification") {
    return deterministic;
  }

  if (deterministic?.status === "allowed") {
    return deterministic;
  }

  if (hasSafetyClarificationAnswers(input.clarificationAnswers)) {
    const clarificationDecision = evaluateSafetyClarificationAnswers(input.clarificationAnswers);
    if (clarificationDecision?.status === "allowed") {
      return clarificationDecision;
    }
    if (clarificationDecision?.status === "blocked") {
      return clarificationDecision;
    }
  }

  const classifier = await callSafetyClassifier(context, deps);
  if (!classifier.ok) {
    if (matchesHighRiskKeywords(context)) {
      return buildBlockedSafetyDecision("other_illegal_harm");
    }
    return buildAllowedSafetyDecision();
  }

  return normalizeSafetyClassifierResult(classifier.parsed);
}

export function assertProjectSafetyAllowed(safetyDecision) {
  if (!safetyDecision || safetyDecision.status !== "allowed") {
    const reasonCode = normalizeSafetyReasonCode(safetyDecision?.reasonCode);
    const error = new Error("PROJECT_SAFETY_GATE_BLOCKED");
    error.code = PROJECT_SAFETY_ERROR_CODE;
    error.reasonCode = reasonCode;
    error.userMessage = safetyDecision?.userMessage || getSafetyUserMessage(reasonCode);
    throw error;
  }
}

export function toBlockedApiPayload(safetyDecision) {
  const reasonCode = normalizeSafetyReasonCode(safetyDecision?.reasonCode);
  return {
    status: "blocked",
    reasonCode,
    message: safetyDecision?.userMessage || getSafetyUserMessage(reasonCode),
  };
}

export function logProjectSafetyDecision({
  endpoint,
  decision,
  correlationId,
  timestamp = new Date().toISOString(),
}) {
  const payload = {
    endpoint,
    timestamp,
    correlationId: correlationId || null,
    status: decision?.status || "unknown",
    reasonCode: decision?.status === "blocked" ? normalizeSafetyReasonCode(decision.reasonCode) : null,
  };

  console.info("[project-safety]", JSON.stringify(payload));
}
